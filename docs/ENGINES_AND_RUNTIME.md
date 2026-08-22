# Runtime, engines và phát hành

> Đọc tài liệu này khi debug setup, binary, engine version, model, userData, package hoặc workflow release. Snapshot được đối chiếu ngày **2026-08-17**, version **0.1.25**.

## Nguyên tắc runtime

Ứng dụng không nhét runtime nặng vào installer. `electron-builder.yml` loại `engines/**`, ZIP và test artifacts khỏi package; khi chạy, Main tải/cài binary vào `app.getPath('userData')/bin` từ asset release hoặc nguồn upstream được code chỉ định.

```text
app.getPath('userData')
├─ bin/
│  ├─ yt-dlp(.exe)
│  ├─ ffmpeg(.exe)
│  ├─ ffprobe(.exe)
│  ├─ dy-engine(.exe)
│  ├─ whisper-engine/<engine(.exe) + _internal>/
│  ├─ whisper-cuda/
│  ├─ ocr-engine/<engine(.exe)>/
│  ├─ video2x/<engine(.exe)>/
│  ├─ pyscenedetect/<scenedetect(.exe)>
│  └─ engines-local.json
├─ whisper-models/
├─ cookies/
├─ dy-config.yml
├─ dy-library.db
└─ dy-channels.json
```

`src/main/deps.ts` là nơi dùng chung cho `binDir()`, download file, extract ZIP, staged activation và rollback. Adapter riêng chịu trách nhiệm chọn asset, verify executable và gọi `markEngineInstalled()`.

## Bootstrap core

### Kiểm tra lúc khởi động

`src/main/runtimeSetup.ts` gọi `checkDependencies()` trong `src/main/deps.ts`.

- Setup gate yêu cầu **managed** `yt-dlp` và cả `ffmpeg` + `ffprobe` trong `userData/bin`.
- Resolve khi chạy ưu tiên managed binary; một số operation có thể fallback sang PATH (`yt-dlp`, `ffmpeg/ffprobe`) sau khi setup hoặc trong môi trường dev.
- `TEDIAPROS_DEV_ALLOW_MISSING_RUNTIME=1` đánh dấu `devRuntimeBypass`, cho phép Renderer vào app dù core runtime thiếu; đây là test UI, không phải release mode.
- Optional engine (`Douyin`, `Whisper`, `OCR`, `Video2X`, PySceneDetect) được cài từ tab/feature riêng, không chặn lần boot đầu.

### Asset base và version

`src/main/deps.ts` dùng:

- `ASSET_TAG = 'assets-v1'`;
- mặc định `https://github.com/nhathaofn/releases/releases/download/assets-v1`;
- override dev bằng `TEDIAPROS_ASSET_BASE`.

`src/main/engines-update.ts` đọc `${ASSET_BASE}/engines-manifest.json`, so version remote với `userData/bin/engines-local.json`. Engine key hiện được code định nghĩa là `ocr`, `whisper`, `douyin`, `whisperCuda`, `video2x`; manifest hiện tại có đủ 5 key với giá trị `2, 2, 2, 1, 1` tương ứng.

Khi cài thành công, adapter ghi version remote nếu đọc được; nếu không đọc được thì fallback version local hoặc `1`. Mất mạng khi fetch manifest không tự làm app fail; update status trả `false`/không update.

## Dependency matrix

| Runtime | Owner | Path/asset | Platform | Protocol/verify | Cancel/update |
| --- | --- | --- | --- | --- | --- |
| yt-dlp | `src/main/deps.ts`, `ytdlp.ts` | `userData/bin/yt-dlp(.exe)`; official release asset theo OS/arch | Windows/macOS/Linux | probe `--version`, `--list-impersonate-targets`; download metadata bằng JSON `-J` | update staged binary, checksum nếu có; download process theo task |
| FFmpeg/FFprobe | `deps.ts`, `burn.ts`, `ytdlp.ts`, services | `userData/bin/ffmpeg(.exe)` + `ffprobe(.exe)` | Windows/macOS; Linux yêu cầu system install | probe `-version`; FFprobe JSON cho media duration/size | replace binary có `.previous`; process burn/service tự cancel |
| Douyin | `douyin.ts` | `userData/bin/dy-engine(.exe)`; `dy-engine.exe`, `dy-engine-macos`, hoặc `dy-engine-linux` | Windows/macOS/Linux asset name trong code | download file + `--help`; stdout/stderr progress/summary | `engineNeedsUpdate('douyin')`; task spawn Main |
| Whisper | `whisper.ts` | `userData/bin/whisper-engine/<exe>` từ ZIP onedir | Windows/macOS/Linux asset name trong code | extract executable, `--help`; stdout JSON-lines | engine update; child process kết thúc/cancel theo adapter |
| Whisper model | `whisper.ts` + engine | `userData/whisper-models` | theo faster-whisper/CTranslate2 | engine tự tải/cache model lần đầu | không phải engine manifest binary |
| Whisper CUDA | `whisper.ts` | `userData/bin/whisper-cuda` từ `whisper-cuda-<os>.zip` | code có tên asset cho OS; workflow hiện chuẩn bị Windows bundle | tìm `.dll`/`.so`/`.dylib`; chọn device sau khi status | `engineNeedsUpdate('whisperCuda')` |
| OCR | `ocr.ts` | `userData/bin/ocr-engine/<exe>` từ ZIP onedir | Windows/macOS/Linux asset name trong code | engine CLI args; stdout JSON-lines `progress/status/done/error` | `cancelOcr()` kill child |
| Video2X | `video2x.ts` | `userData/bin/video2x/<exe>`; Windows dùng upstream 6.4.0 URL, Linux asset `video2x-linux.zip` | Windows/Linux; macOS trả unsupported | list device `-l`, progress text `frame=...`, args filter/interpolate | `cancelVideo2x()` kill child |
| PySceneDetect | `services/sceneSplitter.ts` | managed `userData/bin/pyscenedetect/scenedetect(.exe)` hoặc PATH `scenedetect` | installer managed Windows; macOS/Linux dùng Python system | version probe; Windows asset size/SHA-256/executable hash | `cancelSceneSplitter()` kill process tree |
| CapCut | `services/capCutFactory.ts` | draft store/template do user chọn; không phải binary repo | Windows/macOS path candidates | FFprobe JSON, native template validation, preflight | batch process Main; `cancelCapCutFactory()` |

### Core yt-dlp

`deps.ts` chọn binary managed trước PATH để tránh dùng bản pip thiếu capability. `ytdlp.ts`:

- gọi `-J --no-playlist` để lấy metadata;
- gọi `-J --flat-playlist` để thăm dò playlist/nested playlist;
- truyền cookie Netscape theo domain khi bật cookie;
- truyền proxy nếu có;
- parse progress marker `TEDIAPROSPROG`/`TEDIAPROSFILE` và postprocess tags;
- resolve output theo sidecar/ID và validate file vẫn nằm trong output dir;
- có archive, subtitle/metadata/thumbnail, H.264 conversion và phân loại error theo site.

Auto-update yt-dlp được `main/index.ts` kiểm tra tối đa một lần/ngày khi đã có managed binary; trạng thái ngày lưu ở `userData/update-check.json`.

### FFmpeg/FFprobe

`deps.ts` có nhánh platform:

- Windows tải `ffmpeg-win.zip` từ `ASSET_BASE`, fallback về gói essentials của gyan.dev; verify được cả `ffmpeg.exe` và `ffprobe.exe` trước khi activate.
- macOS tải riêng static `ffmpeg` và `ffprobe` từ evermeet.cx, chmod executable; code ghi rõ nhánh này chưa được test trên máy Mac thật.
- Linux không tự tải trong core setup; yêu cầu user cài FFmpeg qua system package.

`burn.ts` probe video bằng FFprobe, dựng filter graph cho subtitle/blur/crop/audio và spawn FFmpeg. Khi không có filter video, có nhánh copy stream; khi có blur/ASS/audio mix phải encode lại. Không kết luận GPU chỉ từ một probe: xem danh sách encoder/fallback thực tế trong file khi sửa pipeline.

## Engine protocol và cancellation

| Engine/flow | Input | Output | Progress | Cancel owner |
| --- | --- | --- | --- | --- |
| Douyin | config JSON/YAML-compatible, cookie JSON, CLI binary | file/download metadata, stdout/stderr summary | parser trong `douyin.ts` → `DouyinProgress` | Main `downloadDouyin` process |
| Whisper | CLI args: input/output/model/language/task/formats/device/diarization | JSON-lines và files SRT/TXT/VTT | `WhisperProgress` từ stdout | Main `transcribeAudio` child |
| OCR | CLI args input/output/rectangle/FFmpeg | JSON-lines rồi SRT | `OcrProgress` và done metadata | `cancelOcr()` |
| Video2X | CLI args input/output/processor/device/mode/codec | output video, text progress | parser `frame=x/y (...)` | `cancelVideo2x()` |
| PySceneDetect | CLI args detector/CSV/output/FFmpeg | scene clips + `scene-splitter.json` | capture stdout/stderr + phase | active job trong `sceneSplitter.ts` |
| Burn | FFmpeg args/filter graph | output video/soft subtitle | đọc `time=` từ stderr | `cancelBurn()` + voice timeline cancel |

Không dùng output console trang trí làm protocol máy đọc. Nếu engine đổi schema, cập nhật contract, parser và tài liệu cùng task.

## Feature-specific runtime

### OCR

OCR được tách bundle riêng vì OpenCV/ONNX lớn và chỉ cần cho tab Đọc chữ video. Main kiểm tra FFmpeg, gửi vùng tọa độ pixel video gốc, đọc JSON-lines, rồi đổi SRT sang format người dùng chọn. Không gộp OCR vào Whisper.

### Whisper/CUDA

Whisper chạy CPU mặc định; `device='cuda'` chỉ có hiệu lực khi `whisperCudaStatus().has`. Model cache có thể được tải lần đầu từ Hugging Face/engine; việc có engine executable không đồng nghĩa model đã có sẵn.

### Video2X

Source repository không chứa Video2X. Windows dùng URL upstream pinned `6.4.0`; Video2X không hỗ trợ macOS trong `video2x.ts`. Các processor/model như RealESRGAN, RealCUGAN, libplacebo và RIFE được đóng vào args, không phải source engine trong repo.

### Tách cảnh

PySceneDetect contract pin version `0.7.1`. Windows installer verify asset size, ZIP SHA-256 và executable SHA-256; macOS/Linux status có thể nhận `scenedetect` từ PATH và hướng dẫn cài Python package. Output manifest là input tùy chọn cho CapCut Factory.

### CapCut Factory

CapCut Factory không spawn CapCut. Nó:

1. phát hiện candidate draft store/template;
2. probe video bằng FFprobe;
3. preflight số cue SRT và voice 1:1;
4. nếu có scene manifest thì kiểm tra đúng video, gap/overlap và scene boundary;
5. tạo từng project tuần tự từ template/native schema;
6. copy asset và ghi portability/scene-link manifest.

Chi tiết schema/timeline nằm ở [CAPCUT_FACTORY.md](CAPCUT_FACTORY.md).

## Build runtime assets

### Windows engine workflow

`.github/workflows/build-windows-engines.yml`:

- setup Python 3.10 + PyInstaller;
- build `engines/douyin-engine` → `dy-engine.exe` và smoke test `--help`;
- build Whisper/OCR onedir ZIP;
- build optional CUDA DLL bundle;
- tải và đóng gói pinned FFmpeg/FFprobe;
- ghi `engines-manifest.json` với đủ `ocr`, `whisper`, `douyin`, `whisperCuda`, `video2x`;
- publish asset lên public `nhathaofn/releases`, tag `assets-v1`.

Workflow này không build Video2X từ source repo vì adapter tải upstream pinned khi app chạy.

### macOS engine workflow

`.github/workflows/build-mac-engines.yml` build/publish Douyin, Whisper và OCR asset trên `macos-latest`. FFmpeg macOS được adapter tải trực tiếp từ evermeet.cx. Workflow hiện không tạo CUDA bundle hoặc manifest mới như workflow Windows; khi debug asset macOS phải kiểm tra release artifact thực tế.

### App release workflow

`.github/workflows/release-app.yml` hiện có matrix Windows:

1. `npm ci` bằng Node 20;
2. `npm run typecheck`;
3. `npm run package:win`;
4. `npm run verify:package:win`;
5. upload `.exe`, `.blockmap`, `latest.yml`;
6. publish sang `nhathaofn/releases` khi push tag `v*`.

`electron-builder.yml` khai báo cả NSIS Windows và DMG/ZIP macOS, nhưng workflow release hiện không có job `package:mac`.

Build local portable dùng `electron-builder.local.yml` và lệnh `npm run package:win:local`. Nó tạo một `.exe` trong `dist-local`, dùng app ID/tên riêng, đặt `userData` vào `TediaPros Local Data` cạnh executable qua `PORTABLE_EXECUTABLE_DIR`, và tắt electron-updater. Lệnh `npm run package:win` cùng config release không thay đổi.

## Packaging invariants

`electron-builder.yml` loại các runtime sau khỏi installer:

- `engines/**`, `dist-engine/**`, `test-artifacts/**`;
- các file `.zip`, session/cookie/secret và source font local;
- runtime binaries yt-dlp, FFmpeg và engine không được commit/package.

`scripts/check-package-runtime-assets.mjs` quét `app.asar` và resources, chặn tên engine/FFmpeg/yt-dlp, ZIP và CapCut CLI history. Font được copy có chọn lọc từ `resources/fonts` vào extraResources.

## Debug checklist

Khi một chức năng runtime lỗi, ghi lại:

1. platform/arch và packaged hay dev;
2. `app.getPath('userData')` thực tế;
3. binary path được resolve và `--version`/`--help` output;
4. manifest key/local version/asset tag;
5. input path có Unicode/khoảng trắng hay không;
6. stdout/stderr tail đã được làm sạch secret chưa;
7. process có cleanup khi cancel/đóng app hay không;
8. package có vô tình chứa binary/ZIP không.

Không sửa bằng cách đặt binary vào repository hoặc dùng PATH ngẫu nhiên nếu adapter được thiết kế để chọn managed asset.


