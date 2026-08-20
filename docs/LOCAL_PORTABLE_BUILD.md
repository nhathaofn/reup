# Bản portable local

Bản local dùng để chạy song song với bản T-blao cài từ GitHub. Nó không tạo installer Windows, không dùng chung dữ liệu runtime và không tự cập nhật từ GitHub Releases.

## Build

Trong PowerShell tại thư mục repository:

```powershell
npm.cmd run package:win:local
```

Mỗi lần chạy được đóng gói vào một thư mục release mới để không ghi đè
`app.asar` của bản portable đang chạy:

```text
dist-local/releases/<timestamp>-<pid>/T-blao Local-0.1.25-portable.exe
```

Tên version sẽ thay đổi theo `package.json`. Bản build release chuẩn vẫn dùng `npm.cmd run package:win` và không bị thay đổi bởi config local.

Có thể chỉ định thư mục output riêng cho một lần chạy bằng biến môi trường
`TBLAO_PORTABLE_OUTPUT`, nhưng không nên trỏ vào thư mục của một portable app
đang mở.

## Dữ liệu và cập nhật

Khi chạy portable packaged, electron-builder cung cấp `PORTABLE_EXECUTABLE_DIR`. Main dùng biến này để đặt:

```text
<thư mục chứa exe>/T-blao Local Data
```

Thư mục này chứa API key, cookies, logs, engine, lịch sử và cache của bản local. Nếu di chuyển bản portable sang thư mục khác, di chuyển cả thư mục dữ liệu nếu muốn giữ thiết lập.

Bản local bỏ qua `check`, `download` và `install` của `electron-updater`, nên không liên quan đến bản phát hành GitHub. Biến `TBLAO_USER_DATA_DIR` vẫn được ưu tiên cho smoke test có chủ đích.

## Lưu ý

- Portable `.exe` không tạo shortcut, uninstall entry hoặc registry cài đặt như NSIS.
- Nên đặt file ở thư mục người dùng có quyền ghi, ví dụ `Downloads` hoặc `Desktop`, không đặt vào `Program Files` nếu muốn lưu data cạnh file `.exe`.
- Build local không ký code; Windows SmartScreen có thể hiển thị cảnh báo cho file tự build.

