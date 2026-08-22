# TediaPros

Trình tải video & audio đa nền tảng — chạy trên **Windows** và **macOS**.

Xây bằng **Electron + React + TypeScript** (electron-vite).

Repo chính thức của dự án này: <https://github.com/nhathaofn/reup>.

## Tính năng (MVP)

- Dán URL → xem tiêu đề, thumbnail, thời lượng
- Tải **Video (mp4)** với chọn độ phân giải, hoặc **Audio** (mp3/m4a/opus/flac/wav)
- Nhúng ảnh bìa + metadata
- Chọn thư mục lưu (mặc định: Downloads)
- **Progress bar** thời gian thực (tốc độ, ETA)
- **Tự kiểm tra & tải** các thành phần cần thiết khi thiếu (màn hình Setup lúc khởi động)
- Bản Windows đóng gói sẵn cặp FFmpeg/FFprobe đồng bộ; không phụ thuộc FFmpeg trong `PATH` của máy người dùng
- Tạo hàng loạt **project CapCut đa ngôn ngữ** từ một video và số bộ SRT + voice tùy ý
- **Dịch SRT tiếng Trung chỉ từ văn bản bằng Gemini**, phục hồi ASR theo ngữ cảnh toàn file, bản địa hóa nhiều locale và xuất từng/tất cả file dịch

## Dịch SRT chỉ từ file SRT

Feature Dịch SRT mặc định chỉ cần file `.srt` tiếng Trung và API key Gemini. Kết quả được đánh dấu chưa kiểm chứng vì SRT không thể xác nhận lời nói hoặc hình ảnh gốc; khi xuất sẽ có hậu tố `_unverified.srt`.

Quy trình UI gồm 5 bước:

1. **Nguồn:** chọn SRT tiếng Trung và kết nối Gemini.
2. **Phục hồi:** Gemini đọc toàn bộ SRT, dùng ngữ pháp, cấu trúc lặp, cue trước–sau, đồng âm/âm gần của ASR, tiếng lóng, phương ngữ, tên riêng, thuật ngữ, số và đơn vị.
3. **Duyệt:** hệ thống chạy audit độc lập sau pass phục hồi; các cue còn mơ hồ được đưa ra bằng tiếng Việt để chọn phương án trước khi dịch.
4. **Bản địa hóa:** chọn locale; văn phong, tiền tệ, đơn vị đo, tên loài và tên riêng được điều chỉnh theo khu vực đích nhưng không đổi dữ kiện nguồn. Các target chạy tuần tự và target lỗi không làm mất preview/export của target đã thành công.
5. **Xuất:** xem SRT nguồn đã phục hồi, xem trước từng bản dịch và xuất một hoặc tất cả file.

Không có video/audio nào được yêu cầu hoặc upload trong workflow này. Nhánh media cũ vẫn được giữ tương thích nội bộ nhưng không còn xuất hiện trong UI.

Trong lúc chạy, tab **Hỗ trợ → Xem chi tiết kỹ thuật** có thể mở file `userData/logs/tediapros.log`. Dịch SRT ghi phase, thao tác Gemini, request/response JSON đầy đủ theo từng attempt, số cue/target, retry, thời lượng và heartbeat mỗi 30 giây; phase chạy từ 3 phút trở lên sẽ có cảnh báo `warn`. Request/response có thể chứa toàn bộ SRT và prompt, nên hãy coi file log là dữ liệu riêng tư; API key và URI file Gemini được che.

Tiền tệ được hiển thị theo locale đích, giữ giá trị nguồn trong ngoặc và dùng từ chỉ mức xấp xỉ. Đây chỉ là hỗ trợ lời thoại, không phải giá trị thanh toán, giao dịch, kế toán hay báo giá. Khi dùng tỷ giá, UI ghi công **Rates By ExchangeRate-API** ([ExchangeRate-API](https://www.exchangerate-api.com)); snapshot cũng giữ thời điểm cập nhật nguồn.

## Yêu cầu môi trường

- **Node.js** ≥ 18 (khuyến nghị 20+)
- Khi build bản **macOS** (`.dmg`) cần chạy trên máy Mac hoặc GitHub Actions.

## Lệnh

```bash
npm install       # cài dependencies
npm run dev       # chạy chế độ phát triển (hot reload)
npm start         # chạy bản build production (preview)
npm run build     # build ra out/
npm run typecheck # kiểm tra kiểu TypeScript
npm run check:architecture # kiểm tra IPC và feature registry
npm run test:unit # bộ test offline, không gọi Gemini/rate API thật
npm run test:smoke:srt # live smoke opt-in, chỉ chạy khi đã cấu hình đủ 4 biến môi trường bên dưới
npm run verify    # typecheck + architecture check + production build
npm run package:win   # đóng gói .exe (NSIS installer) -> dist/
npm run package:win:local # đóng gói .exe portable vào thư mục release riêng (xem docs/LOCAL_PORTABLE_BUILD.md)
npm run package:mac   # đóng gói .dmg (cần macOS)
```

Live smoke SRT là tùy chọn, không chạy trong `npm run test:unit` và không nên đặt key thật cố định trong shell profile. Khi có video/SRT mẫu đã duyệt và muốn chạy kiểm thử Gemini thật, cấu hình tạm thời:

```powershell
$env:TEDIAPROS_GEMINI_SMOKE_KEY = Read-Host 'Gemini API key dùng riêng cho smoke test'
$env:TEDIAPROS_SRT_SMOKE_VIDEO = Read-Host 'Đường dẫn tuyệt đối tới video mẫu'
$env:TEDIAPROS_SRT_SMOKE_SRT = Read-Host 'Đường dẫn tuyệt đối tới SRT tiếng Trung khớp video'
$env:TEDIAPROS_SRT_SMOKE_OUTPUT_DIR = Read-Host 'Thư mục output dùng một lần'
npm run test:smoke:srt
```

Sau khi chạy, xóa bốn biến môi trường. Smoke test cần xác nhận remote Gemini file đã được cleanup; không dùng nó như bài test offline.

> ⚠️ **Lưu ý môi trường:** Nếu Electron khởi động mà báo `Cannot read properties of undefined (reading 'whenReady')`,
> nghĩa là biến `ELECTRON_RUN_AS_NODE=1` đang bật (làm Electron chạy như Node thuần).
> Khắc phục: xoá biến đó trước khi chạy — PowerShell: `Remove-Item Env:\ELECTRON_RUN_AS_NODE`.

## Cấu trúc

```
src/
  main/        # tiến trình chính: cửa sổ, IPC, kiểm tra/tải thành phần, gọi công cụ tải
  preload/     # cầu nối an toàn (contextBridge) main <-> renderer
  renderer/    # giao diện React
  shared/      # kiểu dữ liệu dùng chung
```

## Phát triển feature mới

Tạo một vertical slice Shared/Main/Preload/Renderer và tự đăng ký an toàn:

    npm.cmd run feature:create -- media-inspector "Kiểm tra media"

- [Bản đồ kiến trúc và chức năng](docs/PROJECT_ARCHITECTURE.md)
- [Bản đồ đọc nhanh toàn bộ codebase](CODEBASE.md)
- [Bản đồ module và entrypoint](docs/CODEBASE_MAP.md)
- [Hợp đồng IPC và feature registry](docs/IPC_AND_FEATURES.md)
- [Runtime, engine và phát hành](docs/ENGINES_AND_RUNTIME.md)
- [Ghi chú rủi ro/mismatch đã xác minh](docs/CODEBASE_NOTES.md)
- [Quy trình thêm feature](docs/ADDING_A_FEATURE.md)
- [Thiết kế và vận hành CapCut Factory](docs/CAPCUT_FACTORY.md)

## Hướng phát triển tiếp

- Phụ đề (tải + nhúng), SponsorBlock, cắt theo thời gian
- Đổi định dạng đầu ra, mẫu tên file, tiếp tục tải dở
- Hỗ trợ Douyin (engine riêng)

## Font phụ đề

Binary font **không** nằm trên GitHub (bản quyền). Khi build App trên máy bạn: đặt nguồn trong `font/` → `npm run fonts:copy` → xem [resources/fonts/README.md](resources/fonts/README.md).

## Giấy phép

TediaPros phát hành theo **PolyForm Noncommercial License 1.0.0** (source-available, **phi thương mại** + bắt buộc ghi công).

- Toàn văn: [LICENSE](LICENSE)
- Ghi công / NOTICE: [NOTICE](NOTICE)
- Dùng cá nhân, học tập, nghiên cứu, tổ chức phi thương mại: được phép theo license.
- **Dùng thương mại** (bán, SaaS, tích hợp sản phẩm thương mại…): cần thỏa thuận riêng với **NeeyuBL**.

Đây **không** phải giấy phép OSI “Open Source” (vì cấm thương mại).

### Ghi công (bên thứ ba)

TediaPros dùng các công cụ/thư viện bên thứ ba (tải khi cần hoặc đóng gói riêng), mỗi thành phần giữ giấy phép gốc — xem [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) và tab **Giấy phép** trong app. Ví dụ:

- **ffmpeg** — LGPL/GPL: <https://ffmpeg.org/legal.html>
- **Video2X** — AGPL-3.0: <https://github.com/k4yt3x/video2x>
- Bộ tải xuống mã nguồn mở (Unlicense / phạm vi công cộng).

> Người dùng chịu trách nhiệm tuân thủ điều khoản của các nền tảng và luật bản quyền khi tải nội dung.
