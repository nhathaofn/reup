# Kiến trúc và bản đồ chức năng TediaPros

Tài liệu này là kết quả đọc mã nguồn hiện có tại nhánh main, phiên bản 0.1.16,
ngày 2026-08-12. Phạm vi gồm Electron/React/TypeScript, ba engine Python,
script build, cấu hình đóng gói và workflow GitHub. Các thư mục sinh tự động
như node_modules, out, dist, build và binary bên thứ ba không được xem là mã
nguồn cần phân tích.

## 1. Kết luận kiến trúc

TediaPros là ứng dụng desktop theo mô hình bốn lớp:

1. Renderer React giữ giao diện, hàng đợi và trạng thái tương tác.
2. Preload là API công khai duy nhất cho Renderer.
3. Electron Main giữ quyền hệ thống, IPC, tiến trình con, file và mạng.
4. Engine/binary thực hiện tải, OCR, nhận dạng giọng nói và xử lý video.

Core hiện hoạt động theo mô hình module nghiệp vụ ở Main nhưng việc nối module
vào ứng dụng vẫn tập trung tại App.tsx, preload/index.ts và main/index.ts. Vì
vậy sửa trực tiếp ba file này để thêm tính năng có nguy cơ gây trùng tab, trùng
API hoặc trùng IPC. Lớp feature registry mới giải quyết đúng điểm nối đó mà
không di chuyển hoặc viết lại các chức năng hiện hành.

~~~mermaid
flowchart LR
  UI["React Renderer<br/>tab, form, queue"] -->|"window.api"| PRE["Preload<br/>contextBridge"]
  PRE -->|"invoke / on"| MAIN["Electron Main<br/>IPC + services"]
  MAIN --> DL["yt-dlp / FFmpeg"]
  MAIN --> DY["Douyin Python engine"]
  MAIN --> OCR["OCR Python engine"]
  MAIN --> WH["Whisper Python engine"]
  MAIN --> VX["Video2X"]
  MAIN --> AI["Gemini / OpenAI"]
  MAIN --> FS["File system / safeStorage"]
  MAIN -->|"progress events"| PRE
  PRE --> UI
~~~

## 2. Luồng khởi động

1. Main đăng ký protocol tediapros để phát file cục bộ và hỗ trợ HTTP Range.
2. Electron app sẵn sàng, tạo BrowserWindow 1320 x 820.
3. Main đăng ký 60 IPC request/response của core.
4. Main đăng ký các module trong feature registry. Registry rỗng nên hành vi
   hiện tại không đổi.
5. Preload tạo coreApi, gộp featureApi sau khi kiểm tra không ghi đè tên hàm,
   rồi expose đúng một object window.api.
6. Renderer kiểm tra dependency. Nếu thiếu, SetupScreen tải/cài dependency và
   nhận tiến độ; nếu đủ, App hiển thị tab mặc định Tải xuống.
7. Trình cập nhật chỉ chạy ở bản packaged và đẩy trạng thái về Renderer.

Thiết lập bảo mật cửa sổ hiện tại:

- contextIsolation bật.
- nodeIntegration tắt.
- sandbox tắt.
- Renderer chỉ dùng quyền hệ thống qua window.api.
- Protocol tediapros nhận đường dẫn file cục bộ được mã hóa base64; tầng protocol
  chưa có allowlist thư mục riêng, nên mọi nơi tạo URL phải tiếp tục coi đường
  dẫn là dữ liệu tin cậy từ Main.

## 3. Chức năng Electron Main

| Module | Chức năng | Dữ liệu vào/ra và hành vi đáng chú ý |
| --- | --- | --- |
| main/index.ts | Khởi động app, BrowserWindow, protocol file, nối toàn bộ IPC | Phục vụ Range cho preview; điều phối dialog, shell, key, font và các service; nay gọi feature registry sau core |
| deps.ts | Quản lý dependency nền | Ưu tiên cặp FFmpeg/FFprobe đồng phiên bản trong resources/ffmpeg của bản đóng gói; fallback userData/bin và chỉ dùng PATH khi dev; phát setup progress; cập nhật yt-dlp; dùng assets-v1 cho gói lớn |
| ytdlp.ts | Đọc metadata và tải media đa nền tảng | Đọc video/playlist, chọn format, tải video/audio/subtitle/metadata, archive, proxy, progress; khi gặp 403 có thể thử lại không dùng cookie |
| cookies.ts | Phiên đăng nhập và cookies cho yt-dlp | Mở phiên Electron persistent, xuất cookies theo Netscape format để binary dùng |
| proxy.ts | Kiểm tra proxy | Xác thực HTTP/SOCKS URL và chạy yêu cầu thử bằng yt-dlp trước khi lưu/dùng |
| douyinCookies.ts | Phiên và cookie riêng cho Douyin | Không dùng chung với cookie yt-dlp; xuất JSON phù hợp engine |
| douyin.ts | Cầu nối Douyin engine | Cài/kiểm tra engine, sinh config, spawn tiến trình, đọc Rich output, tải video/kênh và quản lý thư viện kênh |
| whisper.ts | Cầu nối Speech-to-Text | Cài engine/model, tùy chọn CUDA khoảng 1 GB, truyền request bằng JSONL, đọc progress/result và hủy tiến trình |
| gpu.ts | Phát hiện tăng tốc Whisper | Kiểm tra GPU NVIDIA và điều kiện CUDA từ hệ thống |
| ocr.ts | Cầu nối OCR | Cài engine, gửi video/vùng quét bằng JSONL, nhận SRT, đổi sang TXT/VTT/JSON và hủy |
| burn.ts | Hậu kỳ subtitle/video | Đọc SRT nhiều encoding, crop, sinh ASS, đo và xuống dòng, font/màu/nền, blur nhiều vùng, trộn audio, encode |
| fontMeasure.ts | Đo chữ phụ đề | Dùng OpenType để đo chiều rộng chính xác trước khi wrap |
| fonts.ts | Font bundled và hệ thống | Liệt kê font, tạo URL tediapros và chọn fallback |
| video2x.ts | Nâng cấp/chuyển động video | Cài/kiểm tra engine, liệt kê device, RealESRGAN/RealCUGAN/libplacebo/RIFE, parse progress và hủy; macOS chưa hỗ trợ |
| gemini.ts | Dịch subtitle bằng Gemini | Quản lý key, model/fallback, timeout, ép JSON schema và trả đoạn dịch giữ timestamp cục bộ |
| openai.ts | Dịch subtitle bằng OpenAI | Luồng tương tự Gemini, dùng endpoint/model của OpenAI |
| translate-shared.ts | Logic dịch dùng chung | Chia đoạn, kiểm tra cấu trúc/timestamp và chuẩn hóa lỗi giữa hai provider |
| logger.ts | Log ứng dụng | Log bộ nhớ + file + UI; thông báo người dùng được làm sạch, lỗi kỹ thuật thô chỉ hiện ở dev console |
| engines-update.ts | Kiểm tra phiên bản engine | So manifest local/remote và quyết định tải lại từng engine |
| updater.ts | Cập nhật ứng dụng | electron-updater, chỉ kích hoạt khi packaged; phát checking/available/progress/downloaded/error |

### Pipeline encode của burn.ts

Encode ưu tiên GPU theo thứ tự NVENC, AMF, QSV rồi mới libx264. Đây là fallback
thực thi, không nên thay bằng kết luận chỉ dựa trên một probe nhỏ. Pipeline còn
ghép crop, ASS, blur và audio thành một filter graph; thay đổi một nhánh phải
kiểm tra cả trường hợp không có subtitle, không blur và không audio phụ.

### Quản lý secret

Gemini/OpenAI key được lưu qua Electron safeStorage khi hệ điều hành hỗ trợ.
Code hiện có nhánh fallback lưu nội dung không mã hóa khi safeStorage không khả
dụng. Đây là hành vi tương thích hiện tại nhưng cần được hiển thị rõ cho người
dùng nếu sản phẩm nâng yêu cầu bảo mật.

## 4. Preload và hợp đồng dùng chung

preload/index.ts là cổng quyền duy nhất. Nó ánh xạ 60 lời gọi invoke và 19 kênh
sự kiện tiến độ/trạng thái sang các hàm có kiểu trong window.api. Các callback
onX trả về hàm cleanup ở những luồng dài để component có thể gỡ listener.

shared/types.ts chứa hợp đồng của core: download, metadata, setup, log, OCR,
Whisper, burn, Video2X, dịch và cập nhật. shared/subWrap.ts là thuật toán wrap
phụ đề dùng chung. Với feature mới, hợp đồng được tách thành
shared/features/<feature-id>.ts để không tiếp tục làm shared/types.ts phình to.

Quy tắc bất biến:

- Renderer không import electron, fs, child_process hay secret.
- Preload chỉ chuyển kiểu dữ liệu serializable qua IPC.
- Main phải xác thực lại đường dẫn, URL và tham số dù Renderer đã validate.
- Mỗi feature mới chỉ dùng channel bắt đầu bằng feature-id:.

## 5. Chức năng giao diện Renderer

Các tab Download, Douyin, AudioText, ScreenText và VideoEnhance luôn được mount
để hàng đợi/progress không mất khi đổi tab. Tab đơn giản có thể unmount.

| Component | Chức năng | Trạng thái và luồng chính |
| --- | --- | --- |
| App.tsx | Shell, sidebar, setup/update, chọn tab | Giữ stage checking/setup/ready; core tab không đổi; ghép thêm tab từ renderer feature registry |
| SetupScreen.tsx | Cài dependency ban đầu | Nhận tiến độ theo bước và chỉ mở app khi dependency sẵn sàng |
| Downloader.tsx | Tải video/audio đa nền tảng | Nhiều URL, playlist lồng, chọn range/item/format, cookie/proxy, tùy chọn lưu, archive, hàng đợi tuần tự; có thể chuyển file sang AudioText |
| LinkInput.tsx | Nhập và chuẩn hóa URL | Tách danh sách URL trước khi gọi lấy metadata |
| Douyin.tsx | Tải Douyin | Setup/cookie, video hoặc kênh, all/batch/new, media options, queue tuần tự và refresh thư viện kênh |
| AudioText.tsx | Chuyển giọng nói thành chữ | Chọn model/language/format/diarization, CPU/GPU, hàng đợi, dịch tùy chọn, nhận file từ Download |
| ScreenText.tsx | OCR và biên tập video | Preview đúng tỉ lệ, kéo vùng OCR/blur/subtitle, chọn format, dịch AI, style font/nền, burn/blur/audio |
| RegionBox.tsx | Vùng tương tác trên preview | Kéo và đổi kích thước vùng theo tọa độ video, không làm méo preview |
| VideoEnhance.tsx | Nâng cấp video | Auto queue, cấu hình chung, processor/codec, progress/statistics, dừng sau item hiện tại hoặc hủy item |
| RunControls.tsx | Điều khiển tác vụ dùng chung | Start/pause/stop và trạng thái nút |
| GeminiKey.tsx | Nhập/xóa/test key Gemini | Không đọc secret trực tiếp về UI sau khi lưu |
| GeminiHelp.tsx | Hướng dẫn lấy key Gemini | Modal đóng bằng nút, click ngoài hoặc Escape |
| OpenAIHelp.tsx | Hướng dẫn key OpenAI | Cùng mô hình modal trợ giúp |
| Logs.tsx | Nhật ký UI | Nhận log realtime, định dạng thời gian, hỗ trợ xem trạng thái tác vụ |
| License.tsx | Giấy phép | Hiển thị license sản phẩm và ghi công bên thứ ba |

### Thư viện Renderer

| File | Vai trò |
| --- | --- |
| lib/useQueueRunner.ts | Chạy hàng đợi tuần tự; pause/stop có hiệu lực ở ranh giới item |
| lib/persist.ts | Hook trạng thái localStorage có kiểu và fallback |
| lib/outputDir.ts | Thư mục đầu ra riêng theo nhóm tính năng |
| lib/dichProvider.ts | Điều phối provider dịch từ UI |
| lib/format.ts | Format thời lượng, dung lượng và chuỗi hiển thị |
| lib/license.ts | Cờ/license helper hiện là stub cho phép |
| public/pcm-tap.js | AudioWorklet thu PCM cho đường live audio |

## 6. Các engine và binary

### OCR engine

engines/ocr-engine/engine.py:

1. Đọc request JSONL.
2. Trích frame khoảng 2 FPS trong vùng đã chọn.
3. Tạo mask chữ trắng và dùng Jaccard để gom các frame ổn định.
4. Chọn frame đại diện.
5. Chạy RapidOCR DirectML, fallback CPU.
6. Phát progress JSONL và kết quả SRT.

Main chịu trách nhiệm đổi SRT sang TXT/VTT/JSON và quản lý tiến trình.

### Whisper engine

engines/whisper-engine/engine.py dùng faster-whisper, nhận/trả JSONL, hỗ trợ
nhiều format và diarization tùy chọn. rthook_whisper.py cùng file spec phục vụ
PyInstaller. Kiến trúc có nhánh live ASR/fallback, trong khi luồng desktop
chính hiện chạy theo file.

### Douyin engine

| Nhóm | Module và trách nhiệm |
| --- | --- |
| config | default_config và config_loader gộp mặc định, file và biến môi trường |
| auth | cookie_manager và ms_token_manager quản lý thông tin xác thực |
| URL/factory | url_parser nhận video, user, gallery, collection, music, live và short link; downloader_factory chọn downloader |
| download | downloader_base dùng chung; video, user, mix, music và live downloader triển khai từng loại |
| user mode | registry + strategy cho post, like, mix, music, collect và collect-mix |
| API/signing | api_client cùng ABogus/XBogus tạo request Douyin |
| control | rate_limiter, retry_handler và queue_manager điều tiết mạng/tác vụ |
| dữ liệu phụ | comments_collector, transcript_manager và discovery |
| CLI/server | cli/main, progress_display; FastAPI app/jobs cho REST job |
| utils/tools | cookie fetch, validator, logger, notifier và helper |

Có hai cây mã nguồn Douyin: cây hoạt động và douyin-downloader-main lồng bên
trong. Kiểm tra hash cho thấy 91/93 file chung giống hệt; khác biệt nằm ở run.py
và test_file_manager.py. Hai bản sao làm tăng nguy cơ sửa một nơi nhưng build
nơi khác.

Quan trọng: .gitignore có mẫu engines/**/storage/. Cả hai cây hiện thiếu package
storage mặc dù code, test và dy-engine.spec đều import Database, FileManager và
MetadataHandler. Vì vậy checkout này không thể tái tạo/chạy đầy đủ Douyin engine
từ source cho đến khi package bị thiếu được khôi phục và quy tắc ignore được
sửa. Không nên tạo implementation giả vì sẽ làm sai định dạng database/file.

### Video2X và dependency tải ngoài

Video2X không có source trong repo; Main tải và gọi binary tương ứng platform.
yt-dlp/FFmpeg được resolve từ tài nguyên app hoặc userData/bin. Bản Windows đóng
gói chứa sẵn `resources/ffmpeg/ffmpeg.exe` và `resources/ffmpeg/ffprobe.exe`; PATH
chỉ là fallback của môi trường dev. Khi debug, phải ghi nhận chính xác
binary/path/version đang được chọn thay vì chỉ xem máy đã cài gì trong PATH.

engines-manifest.json hiện chỉ có khóa ocr và video2x, trong khi code còn hỏi
Douyin và Whisper/CUDA. Khóa vắng mặt khiến kiểm tra cập nhật các engine đó
không thể phản ánh phiên bản remote đầy đủ.

## 7. Dữ liệu, trạng thái và khả năng hủy

| Loại | Nơi lưu/sở hữu |
| --- | --- |
| Tùy chọn UI | localStorage qua usePersistedState |
| Download/Douyin/AudioText/Enhance queue | State trong component luôn mount |
| Binary/model/engine | Electron userData và thư mục bin/model tương ứng |
| Cookie yt-dlp | Electron persistent session rồi xuất file Netscape |
| Cookie Douyin | Session/file JSON riêng |
| API key | File qua safeStorage, có plaintext fallback |
| Log | Bộ nhớ, file và stream về UI |
| Tiến trình con đang chạy | Service Main tương ứng, mỗi service có cancel/kill riêng |

Không có task manager trung tâm. Mỗi subsystem tự giữ process/cancel state.
Feature mới chạy lâu nên giữ process/AbortController trong module Main của
chính nó và định nghĩa channel cancel riêng; không đặt process handle trong
Renderer.

## 8. Build, test và phát hành

- TypeScript strict được tách thành tsconfig.node.json và tsconfig.web.json.
- electron-vite build tạo ba bundle Main/Preload/Renderer.
- electron-builder đóng gói Windows hoặc macOS.
- copy-fonts.mjs sao chép bộ font được cho phép từ thư mục font cục bộ.
- release-app.yml hiện tập trung vào release macOS.
- build-mac-engines.yml build engine cho macOS.
- Chưa có workflow CI tổng quát chạy typecheck, architecture check và build cho
  mọi pull request.
- Chưa có test tự động cho TypeScript/React.
- Hai cây Douyin chứa tổng cộng 211 hàm test được khai báo (106 + 105), nhưng
  môi trường hiện tại chưa cài pytest và source còn thiếu package storage.

Kết quả baseline trong lần phân tích:

- npm run typecheck: đạt.
- npm run check:architecture: đạt, 60 request channels và 19 event channels.
- Parse AST Python: đạt cho 166 file .py, không import dependency và không chạy nghiệp vụ.
- python -m pytest -q: chưa chạy được; dừng ngay vì Python 3.13 không có pytest.
- Douyin test vẫn sẽ bị chặn bởi package storage bị thiếu sau khi cài pytest.

## 9. Điểm dễ vỡ và thứ tự nên xử lý

### Ưu tiên cao

1. Khôi phục source storage của Douyin và bỏ ignore nhầm package source.
2. Chọn một cây Douyin làm nguồn chuẩn; xóa hoặc tự động đồng bộ bản sao.
3. Thêm CI chạy npm run verify trên Windows và ít nhất một job macOS.
4. Thêm test cho hợp đồng IPC, queue/cancel và parser tiến độ.

### Ưu tiên vừa

1. Tách registerIpc trong main/index.ts thành registry theo domain cho core.
2. Tách preload/index.ts thành API domain, nhưng vẫn expose đúng một window.api.
3. Chia các component rất lớn như Downloader, ScreenText và VideoEnhance thành
   state hook + view component + adapter.
4. Hoàn chỉnh engines-manifest cho Douyin/Whisper/CUDA.
5. Quyết định chính sách khi safeStorage không khả dụng.
6. Cân nhắc bật sandbox sau khi kiểm tra toàn bộ preload/binary flow.

## 10. Cấu trúc mở rộng đã thêm

Feature mới là một vertical slice, có cùng ID ở bốn lớp:

~~~
src/
  shared/features/<id>.ts
  main/features/<id>.ts
  preload/features/<id>.ts
  renderer/src/features/<id>/index.tsx
~~~

Ba registry chỉ chứa module mới; registry rỗng không thay đổi core. Runtime và
script kiểm tra chặn:

- ID trùng tab/namespace core.
- ID hoặc API preload bị trùng.
- IPC feature không bắt đầu bằng feature-id:.
- Feature chỉ được thêm ở một hoặc hai lớp.
- File feature mồ côi không có trong registry.
- Hai handler cùng literal IPC của core.
- invoke/handler hoặc event sender/listener không có cặp.

Quy trình chi tiết nằm trong ADDING_A_FEATURE.md.
