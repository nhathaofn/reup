# Bản portable local độc lập

**Ngày:** 2026-08-17  
**Trạng thái:** Đã được người dùng duyệt

## Mục tiêu

Tạo một bản Windows portable từ codebase hiện tại để chạy song song với bản T-blao cài từ GitHub mà không dùng chung dữ liệu, single-instance lock hoặc cơ chế tự cập nhật.

## Ranh giới

- Giữ nguyên `electron-builder.yml` và lệnh `package:win` của bản phát hành hiện tại.
- Thêm config riêng `electron-builder.local.yml`, target `portable`, output `dist-local`.
- Định danh bản local là `com.nhathaofn.tblao.local` và `T-blao Local`.
- Khi chạy portable packaged, dùng `PORTABLE_EXECUTABLE_DIR` để lưu `userData` vào thư mục `T-blao Local Data` cạnh file `.exe`.
- Ưu tiên `TBLAO_USER_DATA_DIR` hiện có để phục vụ smoke test hoặc override có chủ đích.
- Tắt check/download/install update GitHub cho bản portable local.
- Không thay đổi logic tải video, Gemini, engine hoặc giao diện ngoài việc đổi tiêu đề cửa sổ local nếu cần nhận diện.

## Luồng build và runtime

1. `npm run package:win:local` chạy `electron-vite build`, sau đó gọi electron-builder với config local.
2. electron-builder kế thừa rule đóng gói/resource từ config chuẩn, chỉ thay app ID, product name, target và output.
3. File đầu ra có dạng `dist-local/T-blao-Local-<version>-portable.exe`.
4. Khi file portable khởi động, Main đổi `userData` sang `<thư mục exe>/T-blao Local Data` trước `requestSingleInstanceLock()`.
5. Updater kiểm tra cờ local portable và trả trạng thái ổn định `none`, không gọi GitHub Releases.

## Kiểm tra chấp nhận

- Config chuẩn vẫn giữ `appId: com.nhathaofn.tblao`, `productName: T-blao`, output `dist` và publish GitHub.
- Config local dùng target `portable`, output `dist-local`, app ID/tên khác bản chuẩn và không có publish provider.
- Unit test xác nhận chỉ môi trường packaged có `PORTABLE_EXECUTABLE_DIR` mới được nhận là local portable.
- `npm run typecheck`, `npm run check:architecture`, `npm run test:unit` pass.
- `npm run package:win:local` tạo được `.exe` portable trong `dist-local`.
- Bản build hiện tại không bị overwrite; nếu `dist-local` đã có artifact cũ, electron-builder tạo artifact mới hoặc được dọn theo cách recoverable trước build.

## Ghi chú vận hành

Bản portable không tạo mục cài đặt/uninstall Windows. Khi di chuyển `.exe` sang máy/thư mục khác, nên di chuyển cùng thư mục `T-blao Local Data` nếu muốn giữ API key, engine và thiết lập local.


