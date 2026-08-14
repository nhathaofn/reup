## T-blao v0.1.21

### Phát hành không lộ mã nguồn

- Repo mã nguồn có thể để private; các bản build được publish riêng tại `nhathaofn/releases`.
- `electron-updater` tải metadata và installer từ repo release public.
- GitHub Actions kiểm tra artifact Windows/macOS trước khi publish.

## T-blao v0.1.20

### Cập nhật ứng dụng

- Tự kiểm tra bản phát hành mới trên GitHub khi khởi động và định kỳ trong lúc sử dụng.
- Hiển thị trạng thái cập nhật ở góc trên bên phải; người dùng có thể bấm để cài bản đã tải hoặc kiểm tra lại.
- Bản phát hành GitHub được xuất bản tự động để `electron-updater` có thể nhận diện.

### CapCut Factory

- Giữ liên kết cue/scene không phá huỷ khi neo subtitle và voice theo mốc scene.

## T-blao v0.1.17

### Bản cài đặt gọn

- File `.exe` chỉ chứa ứng dụng, không đóng gói FFmpeg, yt-dlp hoặc các engine xử lý.
- Trong lần chạy đầu tiên, ứng dụng tự tải toàn bộ thành phần phù hợp với máy và hiển thị tiến độ trực tiếp.
- Các thành phần đã tải được lưu trong thư mục dữ liệu của ứng dụng; những lần chạy sau không phải tải lại nếu không có bản cập nhật.

### Tải video ổn định hơn

- Cải thiện tải Facebook và Bilibili với phiên đăng nhập riêng cho từng website.
- Tự quản lý yt-dlp kèm khả năng giả lập trình duyệt cần thiết cho Facebook.
- Nhận diện lỗi theo từng nền tảng và giảm các lần kiểm tra URL không cần thiết.
- Bổ sung lựa chọn chuyển video sang H.264 để tăng khả năng phát trên thiết bị phổ biến.
- Xử lý an toàn tên file Unicode khi hậu kỳ bằng FFmpeg.
- Hiển thị đúng trạng thái mục đã được bỏ qua trong lịch sử tải.

### Giao diện

- Làm mới màu sắc theo hướng Signal Journey.
- Tinh gọn các thông tin kỹ thuật và cải thiện bố cục phần nhập liên kết.
- Cải thiện trạng thái hàng đợi, lỗi tải và tiến trình hậu kỳ.

### Riêng tư và an toàn

- Cookie được lưu riêng theo tên miền và chỉ dùng cho đúng website cần tải.
- Cookie, phiên đăng nhập và file bí mật bị loại khỏi Git cũng như gói cài đặt.

### Cập nhật ứng dụng

- Khôi phục gói Windows trong quy trình phát hành tự động.
- Bổ sung ZIP macOS và metadata cần thiết cho cơ chế tự cập nhật.
