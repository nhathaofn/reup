# T-blao — đọc nhanh codebase

> Đây là điểm đọc đầu tiên cho AI hoặc developer trước khi tìm kiếm rộng trong repository. Snapshot này được đối chiếu ngày **2026-08-17** với version ứng dụng **0.1.25** trong `package.json`.

## Nếu chỉ có vài phút

T-blao là ứng dụng desktop Electron cho tải và xử lý video/audio. Luồng chính là:

```text
React Renderer
  → window.api (Preload/contextBridge)
  → IPC
  → Electron Main
  → yt-dlp / FFmpeg / engine Python / AI provider / filesystem
```

Đọc tiếp theo nhu cầu:

| Câu hỏi | Tài liệu nên đọc trước |
| --- | --- |
| Tôi cần biết file nào sở hữu chức năng hoặc state? | [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md) |
| Tôi cần thêm/sửa IPC hoặc feature? | [docs/IPC_AND_FEATURES.md](docs/IPC_AND_FEATURES.md) và [docs/ADDING_A_FEATURE.md](docs/ADDING_A_FEATURE.md) |
| Tôi cần debug engine, binary, setup hoặc package? | [docs/ENGINES_AND_RUNTIME.md](docs/ENGINES_AND_RUNTIME.md) |
| Tôi cần biết điểm dễ vỡ hoặc thông tin nào chưa chắc? | [docs/CODEBASE_NOTES.md](docs/CODEBASE_NOTES.md) |
| Tôi cần hiểu kiến trúc tổng thể? | [docs/PROJECT_ARCHITECTURE.md](docs/PROJECT_ARCHITECTURE.md) |
| Tôi cần hiểu CapCut Factory? | [docs/CAPCUT_FACTORY.md](docs/CAPCUT_FACTORY.md) |

## Bản đồ repository

| Path | Vai trò | Đọc khi |
| --- | --- | --- |
| `src/main/` | Electron Main: cửa sổ, IPC core, file/network, child process và service | Sửa nghiệp vụ có quyền hệ thống |
| `src/preload/` | API typed duy nhất từ Main sang Renderer | Thêm/sửa `window.api`, listener hoặc cleanup |
| `src/renderer/` | React UI, tab, queue và trạng thái tương tác | Sửa giao diện hoặc flow người dùng |
| `src/shared/` | Type, contract, parser dùng chung giữa các layer | Đổi dữ liệu qua boundary |
| `engines/` | Source Python và spec PyInstaller cho runtime chuyên biệt | Sửa OCR, Whisper hoặc Douyin engine |
| `scripts/` | Generator và architecture/package checks | Thêm feature hoặc kiểm tra release |
| `.github/workflows/` | Build engine và release app | Sửa CI, asset hoặc phát hành |
| `resources/` | Catalog font và tài nguyên được phép đóng gói | Sửa phụ đề/font |
| `docs/` | Kiến trúc, feature guide, CapCut và knowledge base | Cần context trước khi sửa code |
| `test-artifacts/` | Output thử nghiệm CapCut/video, không phải source | Chỉ đọc khi task yêu cầu tái hiện artifact |

Các thư mục `node_modules`, `out`, `dist`, `build` và binary/runtime tải ngoài không được dùng làm bản đồ source. `build/` chứa resource đóng gói như icon; `out/` và `dist/` là output build/package nếu được sinh ra.

## Entry point và luồng khởi động

1. `src/main/index.ts` đăng ký protocol `tblao`, tạo BrowserWindow với `contextIsolation: true`, `nodeIntegration: false`, đăng ký IPC core và feature Main.
2. Main tạo cửa sổ, tải `ELECTRON_RENDERER_URL` ở dev hoặc `src/renderer/index.html` trong bản build.
3. `src/preload/index.ts` tạo `coreApi`, merge với `featureApi`, kiểm tra collision rồi expose đúng một `window.api` qua `contextBridge`.
4. `src/renderer/src/App.tsx` kiểm tra runtime core; nếu thiếu thì hiển thị setup, nếu đủ thì mount các tab Download, Douyin, Phụ đề, Đọc chữ video, Nâng cấp video và các feature registry.
5. Runtime core dùng `src/main/deps.ts`; các engine theo feature được cài on-demand trong tab tương ứng.

Protocol `tblao://` dùng base64url để truyền path file cục bộ và tự trả `Range` response cho preview video/font. Mọi path đi vào protocol vẫn là dữ liệu nhạy cảm do Main tạo; không mở rộng giao thức này từ Renderer.

## Các đường đi nghiệp vụ chính

| Nghiệp vụ | Renderer | Main adapter/service | Runtime/output |
| --- | --- | --- | --- |
| Tải đa nền tảng | `components/Downloader.tsx` | `ytdlp.ts`, `cookies.ts`, `proxy.ts` | yt-dlp + FFmpeg, file media và progress |
| Tải Douyin | `components/Douyin.tsx` | `douyin.ts`, `douyinCookies.ts` | `dy-engine`, `dy-library.db`, channel metadata |
| Tạo phụ đề | `components/AudioText.tsx` | `whisper.ts`, `gpu.ts`, translation modules | Whisper engine, model cache, SRT/TXT/VTT |
| Đọc chữ video | `components/ScreenText.tsx` | `ocr.ts`, `burn.ts`, `fonts.ts` | OCR engine, SRT/format conversion, FFmpeg |
| Nâng cấp video | `components/VideoEnhance.tsx` | `video2x.ts` | Video2X trên Windows/Linux; macOS hiện không hỗ trợ |
| Tách cảnh | `features/scene-splitter/` | `services/sceneSplitter.ts` | PySceneDetect + FFmpeg, `scene-splitter.json` |
| CapCut đa ngôn ngữ | `features/capcut-factory/` | `services/capCutFactory.ts` và generator/portability | draft CapCut, asset copy, scene links |
| Dịch subtitle | `ScreenText.tsx`, `AudioText.tsx` | `gemini.ts`, `openai.ts`, `translate-shared.ts` | API key qua safeStorage/fallback, SRT dịch |
| Dịch SRT chuyên dụng | `features/srt-translator/` | `features/srt-translator.ts`, `services/srt-translator-job.ts` và các service SRT thuần | SRT-only, phục hồi/audit nguồn theo ngữ cảnh, bản địa hóa locale tuần tự, xuất từng/tất cả file |

### Workflow Dịch SRT chỉ từ văn bản

Feature `srt-translator` là một vertical slice Shared/Main/Preload/Renderer với workflow 5 bước:

1. **Nguồn:** Renderer chọn SRT tiếng Trung; Main parse SRT nghiêm ngặt và kiểm tra fingerprint. Video/audio không phải input của workflow.
2. **Phục hồi:** Gemini nhận toàn bộ ngữ cảnh SRT theo từng cửa sổ. Pass phục hồi suy luận ngữ pháp, ngữ cảnh trước–sau, đồng âm/âm gần của ASR, tiếng lóng/phương ngữ, tên riêng, thuật ngữ, số, tiền và đơn vị; không tạo bằng chứng hình/âm thanh.
3. **Duyệt:** pass audit độc lập kiểm tra lại canonical source. Cue còn mơ hồ được trình bày bằng tiếng Việt; user phải chọn đủ candidate trước khi qua bước dịch.
4. **Bản địa hóa:** target dùng `LocaleProfile`; văn phong, tiền tệ, đơn vị đo, tên loài và tên riêng theo locale/khu vực đích nhưng giữ nguyên identity và dữ kiện. Target chạy tuần tự; target lỗi không xóa kết quả target trước.
5. **Xuất:** Renderer preview nguồn đã phục hồi và từng target, sau đó export một hoặc tất cả SRT.

Mặc định mọi job là text-only và kết quả luôn được đánh dấu `_unverified.srt`: SRT giúp kiểm tra rất mạnh về ngôn ngữ/ASR nhưng không xác minh được lời nói hoặc hình ảnh gốc. Nhánh video cũ vẫn được giữ tương thích nội bộ nhưng không còn được UI yêu cầu. Currency conversion chỉ là trợ giúp lời thoại xấp xỉ, không phải giá trị thanh toán/giao dịch/kế toán. Khi có snapshot tỷ giá, UI ghi công **Rates By ExchangeRate-API** ([ExchangeRate-API](https://www.exchangerate-api.com)).

Video remote được upload một lần cho một job và Main cố gắng delete ở mọi đường kết thúc (hoàn tất, lỗi, cancel, release). Nếu cleanup không xác nhận được, Gemini Files có thể còn giữ upload lỗi tối đa 48 giờ trước khi tự hết hạn.

### Ownership của module SRT

| Module | Trách nhiệm duy nhất |
| --- | --- |
| `src/shared/features/srt-translator.ts` | DTO, locale preset, 9 channel name và hợp đồng load/analyze/review/translate/progress/export; không có quyền hệ thống |
| `src/main/features/srt-translator.ts` | Main IPC adapter, dialog chọn video, đọc SRT, export file và nối controller; không chứa prompt nghiệp vụ |
| `src/main/services/srt-translator-production.ts` | Composition root: inject API key, text generation transport, rate provider, logger và nhánh media legacy vào controller |
| `src/main/services/srt-translator-job.ts` | Vòng đời job SRT-only, fingerprint gate, cancel/release, progress và lỗi an toàn; giữ nhánh media cũ tương thích |
| `src/main/services/srt-source-validation.ts` | Parse SRT, kiểm tra video type/size/duration, fingerprint và FFprobe |
| `src/main/services/gemini-files.ts` | Gemini Files upload/poll/generate/delete, model fallback, retry/timeout/abort và làm sạch lỗi công khai |
| `src/main/services/srt-source-restoration.ts` | Chia cue window, prompt/schema pass phục hồi, repair schema một lần và canonical restoration draft |
| `src/main/services/srt-source-audit.ts` | Audit pass độc lập, policy accept/replace/review, merge canonical source và áp dụng lựa chọn tiếng Việt |
| `src/main/services/srt-locale-profiles.ts` | Locale profile, style guide, currency mặc định và unit system cho vi-VN/id-ID/ja-JP/th-TH/ko-KR/en-US |
| `src/main/services/exchange-rates.ts` | Snapshot/cache tỷ giá, chuyển đổi tiền tệ, token/instruction và attribution ExchangeRate-API |
| `src/main/services/measurement-conversion.ts` | Chuyển đổi measurement theo metric/US customary, token/instruction và format locale |
| `src/main/services/srt-localization.ts` | Khóa fact token, prompt bản địa hóa, validate output SRT, repair schema một lần và partial target result |
| `src/main/services/srt-translator-logging.ts` | Contract trace phase, request/response Gemini, retry, heartbeat và thời lượng; serializer che key/URI nhưng payload có thể chứa SRT/prompt |
| `src/preload/features/srt-translator.ts` | Typed `window.api` adapter và listener cleanup cho đúng 9 channel |
| `src/renderer/src/features/srt-translator/` | UI 5 bước, reducer/gate stale-job, review tiếng Việt, target locale, progress, preview và export |

Các service thuần không import Electron/React; boundary quyền hệ thống và dependency thật chỉ nằm ở Main adapter/composition.

## Chọn file khi bắt đầu task

| Loại task | Thứ tự đọc tối thiểu |
| --- | --- |
| Đổi UI/tab/queue | `App.tsx` → component hoặc feature renderer → `useQueueRunner.ts` nếu có queue → preload method tương ứng |
| Đổi dữ liệu IPC | `src/shared/types.ts` hoặc `src/shared/features/<id>.ts` → `src/preload/index.ts`/feature adapter → `src/main/index.ts`/feature handler → caller Renderer |
| Thêm feature mới | `docs/ADDING_A_FEATURE.md` → `scripts/create-feature.mjs` → shared/main/preload/renderer registry |
| Sửa tải video | `Downloader.tsx` → `ytdlp.ts` → `deps.ts`/`cookies.ts`/`sitePolicy.ts` → types |
| Sửa xử lý subtitle/OCR | `ScreenText.tsx` → `ocr.ts`/`burn.ts`/`services/voiceSync.ts` → `shared/types.ts` |
| Sửa engine/runtime | `docs/ENGINES_AND_RUNTIME.md` → adapter `src/main/*.ts` → engine source/spec → workflow |
| Sửa CapCut | `docs/CAPCUT_FACTORY.md` → shared contract → feature adapter → `services/capCutFactory.ts`, `nativeCapCutGenerator.ts`, `capcutPortability.ts` |
| Debug lỗi đóng gói | `electron.vite.config.ts` → `electron-builder.yml` → `scripts/check-package-runtime-assets.mjs` → workflow release |

## Lệnh phát triển và kiểm tra

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run typecheck
npm.cmd run check:architecture
npm.cmd run test:unit
npm run test:smoke:srt  # live Gemini smoke opt-in, cần 4 biến môi trường riêng
npm.cmd run build
npm.cmd run verify
npm.cmd run package:win
npm.cmd run package:win:local
npm.cmd run package:mac
```

`npm.cmd run verify` là `typecheck` + `check:architecture` + production build. `npm.cmd run verify:package:win` kiểm tra gói Windows không chứa runtime/binary bị cấm; engine và FFmpeg được tải từ asset release khi app chạy, không được nhét vào installer.

`npm.cmd run package:win:local` dùng `electron-builder.local.yml` để tạo `dist-local/T-blao Local-<version>-portable.exe`. Bản này dùng `T-blao Local Data` cạnh executable và bỏ qua auto-update GitHub; xem [docs/LOCAL_PORTABLE_BUILD.md](docs/LOCAL_PORTABLE_BUILD.md).

Khi chạy dev có thể dùng `TBLAO_DEV_ALLOW_MISSING_RUNTIME=1` để bỏ qua màn hình cài runtime core cho mục đích test UI. `TBLAO_USER_DATA_DIR` dùng để tách dữ liệu `userData` trong smoke test. Không dùng các biến này làm chính sách phát hành.

`npm run test:unit` là bộ kiểm thử offline, không gọi Gemini/rate API thật. `npm run test:smoke:srt` chỉ chạy khi chủ động cấu hình live smoke bằng bốn biến môi trường tạm thời: `TBLAO_GEMINI_SMOKE_KEY`, `TBLAO_SRT_SMOKE_VIDEO`, `TBLAO_SRT_SMOKE_SRT` và `TBLAO_SRT_SMOKE_OUTPUT_DIR`. Sau smoke test phải xóa các biến này; không ghi API key vào tài liệu hoặc log.

## Phạm vi và nguyên tắc đọc source

- Source chính là file được theo dõi trong `src`, `engines`, `scripts`, `.github`, `resources`, test và cấu hình.
- `test-artifacts/` là dữ liệu sinh; không cần quét toàn bộ để hiểu logic.
- Runtime lớn như yt-dlp, FFmpeg, engine, model và CUDA được resolve/tải lúc chạy; hãy kiểm tra path/version thực tế thay vì suy ra từ PATH của máy.
- Renderer chỉ gọi `window.api`; Main phải validate lại URL, path, options và dữ liệu từ engine/AI.
- Secret, cookie và token không được ghi vào tài liệu hoặc log người dùng.
- Có hai cây Douyin: workflow build dùng `engines/douyin-engine`; cây `douyin-downloader-main` lồng bên trong là bản sao cần được coi là duplicate cho đến khi có quyết định hợp nhất.

## Quy tắc cập nhật knowledge base

| Thay đổi | Tài liệu phải xem lại |
| --- | --- |
| Đổi entrypoint, layer, tab hoặc ownership | `CODEBASE.md`, `docs/CODEBASE_MAP.md`, `docs/PROJECT_ARCHITECTURE.md` |
| Thêm/sửa IPC hoặc feature registry | `docs/IPC_AND_FEATURES.md`, `docs/ADDING_A_FEATURE.md` |
| Thêm/sửa luồng dịch SRT chuyên dụng | `docs/IPC_AND_FEATURES.md`, `docs/CODEBASE_MAP.md`, `src/shared/features/srt-translator.ts` |
| Đổi engine asset, model, userData, manifest hoặc workflow | `docs/ENGINES_AND_RUNTIME.md` |
| Phát hiện mismatch/risk mới | `docs/CODEBASE_NOTES.md` |
| Đổi schema/draft/scene/voice của CapCut | `docs/CAPCUT_FACTORY.md`, `docs/CODEBASE_MAP.md` |

Sau khi cập nhật tài liệu, kiểm tra link nội bộ và chạy `npm.cmd run typecheck`, `npm.cmd run check:architecture`; chạy `npm.cmd run build` nếu môi trường có đủ dependency. Ghi rõ kết quả thực tế trong task, không dùng tài liệu cũ làm bằng chứng cho source mới.
