## TediaPros v0.1.27

### Tải video YouTube

- Sửa lỗi tải video YouTube dừng giữa chừng với `HTTP 403`.
- Tự động tạo lại luồng tải bằng client tương thích khi luồng mặc định bị từ chối.
- Giữ ưu tiên chất lượng và độ phân giải đã chọn trước khi lùi về luồng progressive.
- Áp dụng cơ chế phục hồi cho cả tải video và audio.

### Windows runtime

- Installer đóng gói sẵn cặp `ffmpeg.exe` và `ffprobe.exe` đồng phiên bản trong `resources/ffmpeg`.
- Bản đã đóng gói không còn lấy FFmpeg từ `PATH` của máy người dùng; runtime chỉ dùng cặp đã kiểm tra của app.

## TediaPros v0.1.26

### Tải audio YouTube

- Sửa lỗi YouTube trả `HTTP 403` khi tải luồng audio-only.
- Tự động thử luồng YouTube tương thích và trích xuất MP3 khi luồng audio mặc định bị từ chối.
- Bổ sung JavaScript runtime cho yt-dlp để xử lý các định dạng YouTube mới ổn định hơn.
- Phân loại đúng lỗi HTTP 403 thay vì hiển thị nhầm là định dạng hoặc độ phân giải không khả dụng.

## TediaPros v0.1.25

### CapCut đa ngôn ngữ

- Bỏ hoàn toàn dependency và runtime `capcut-cli`.
- Tạo draft native mới từ schema template, không clone media hoặc nội dung cũ của template.
- Đọc video/scene, voice và SRT mới; copy asset vào project mới và cập nhật timeline/metadata CapCut.
- Kế thừa style subtitle từ template như font, cỡ chữ, màu và typesetting.
- Bắt buộc chọn template CapCut thật của máy để bám đúng schema phiên bản đang cài.

## TediaPros v0.1.23

### CapCut đa ngôn ngữ

- Sửa lỗi `ENOENT: no such file or directory, opendir` khi tạo project trên bản Windows đã cài.
- Đưa runtime tạo draft native vào ứng dụng để chạy ổn định trên máy khác.
- Tự tạo draft store CapCut khi máy mới chưa có thư mục `com.lveditor.draft`.
- Gỡ mục sửa project portable khỏi giao diện; project vẫn ghi manifest portable khi tạo.

## TediaPros v0.1.22

### Windows release

- Bản cài Windows chỉ chứa ứng dụng; yt-dlp, FFmpeg và các engine được tải theo đúng bản Windows khi chạy lần đầu.
- Sửa đường dẫn và asset CapCut khi mở project trên máy Windows khác.
- Cải thiện thay thế engine theo kiểu an toàn: bản đang chạy không bị xóa nếu tải hoặc kiểm tra bản mới thất bại.
- Bổ sung pipeline phát hành installer và runtime asset Windows riêng.

## TediaPros v0.1.21

### CapCut Factory

- Giữ liên kết cue/scene không phá huỷ khi neo subtitle và voice theo mốc scene.

## TediaPros v0.1.17

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
- Cookie, phiên đăng nhập và thông tin nhạy cảm được tách riêng theo từng website.
