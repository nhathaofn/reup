# CapCut Factory đa ngôn ngữ

## Mục tiêu

Feature `capcut-factory` là một bước độc lập sau pipeline xử lý video hiện có. Một batch nhận:

- một video nền dùng chung;
- một hoặc nhiều bộ `SRT + Voice Folder`;
- draft store của CapCut và, tùy chọn, một project CapCut trống làm template.

Mỗi bộ đầu vào tạo đúng một project CapCut độc lập. Số bộ do người dùng thêm/xóa trên UI, không có giới hạn cố định là 5.

## Timeline được tạo

Mỗi project gồm ba track có thể tiếp tục chỉnh sửa trong CapCut:

1. `Video nền`: mặc định là một clip phủ toàn bộ thời lượng video. Nếu chọn output của tab `Tách cảnh` (thư mục có `scene-splitter.json`), track này sẽ chứa từng file scene riêng, giữ đúng `start/end` của manifest để CapCut hiển thị các đoạn cắt độc lập. Tiếng gốc mặc định bị tắt, có thể bật lại trên UI.
2. `Voice`: toàn bộ file audio được sắp xếp tự nhiên theo tên và đặt tại timestamp bắt đầu của cue SRT tương ứng. Mỗi voice vẫn là một clip riêng. Target duration của clip là đúng khoảng SRT và `speed = duration voice gốc / duration cue`, nên voice tự tăng tốc hoặc giảm tốc trong CapCut mà không thay đổi hoặc cắt file gốc.
3. `Phụ đề`: mỗi cue SRT được tạo thành caption segment thật, giữ nguyên start/end và nội dung.

Preflight bắt buộc số voice khớp 1:1 với số cue, mọi file đọc được duration và SRT không vượt quá video. Khi dùng scene manifest, preflight kiểm tra scene thuộc đúng video nền, file scene tồn tại, không có gap/overlap và phủ đủ thời lượng video. Voice được tăng/giảm tốc theo từng khoảng SRT; voice chồng nhau vẫn được giữ nguyên và báo cảnh báo để người dùng chỉnh trong CapCut.

Khi một cue SRT đi qua ranh giới nhiều scene, hệ thống **không cắt subtitle hoặc voice**. Thay vào đó, các scene liền kề được ghi vào cùng một nhóm logic và mapping được lưu trong `tblao-scene-links.json` bên trong từng draft. Manifest này chứa `sceneId`, `cueId`, segment ID CapCut và các nhóm liên kết để hỗ trợ di chuyển/chỉnh sửa mà không làm mất nội dung voice.

## Hai timing mode

- CapCut Factory hiện tại giữ mode `preserve-source-timeline`: voice theo thứ tự tự nhiên được đặt vào các cửa sổ SRT source hiện có.
- Tab `Khối nội dung` dùng mode `block-render-timeline`: block order, voice duration theo locale và SRT mới được dựng qua `capCutBlockAdapter.ts`.
- Hai mode độc lập, không gọi lẫn nhau. Grouping và shuffle block không được triển khai trong `capCutFactory.ts`.

## Kiến trúc

```text
Renderer feature
  └─ form động + preflight + progress/result
       ↓ typed preload API
Preload feature
       ↓ capcut-factory:* IPC
Main feature
  └─ queue tuần tự + dialog + cancel
       ↓
CapCutFactory service
  ├─ tự phát hiện draft store
  ├─ FFprobe video/voice
  ├─ đối chiếu SRT ↔ voice
  └─ native schema/style template + new draft JSON
       ├─ scene manifest (optional) → nhiều video segment trên cùng track
       └─ non-destructive scene links → tblao-scene-links.json
```

Contract nằm ở `src/shared/features/capcut-factory.ts`; implementation không thêm kiểu vào `src/shared/types.ts` và không thay đổi các service burn/voice hiện tại. Feature được mount `keepAlive` để progress/result không mất khi đổi tab. Main chỉ chạy một batch tại một thời điểm và tạo từng project tuần tự để tránh tranh chấp `root_meta_info.json`.

## Đường dẫn và tính portable

Không có username, ổ đĩa hoặc thư mục cá nhân cố định trong source:

- Windows: ứng dụng thử đường dẫn dưới `LOCALAPPDATA`/`APPDATA`.
- macOS: ứng dụng thử đường dẫn dưới `HOME/Movies`.
- UI luôn cho nhập/chọn draft store và template thủ công.
- Các lựa chọn máy hiện tại được lưu trong local storage của app; khi copy app sang máy khác người dùng có thể chọn lại.
- Đường dẫn media trong draft là kết quả của input runtime. Adapter copy video/voice vào thư mục `assets` của từng project để tránh liên kết gãy khi file gốc bị di chuyển.
- Scene được lấy từ output runtime của tab `Tách cảnh`; manifest cho phép dùng lại các file đã cắt mà không hard-code tên hoặc đường dẫn máy.

Template là bắt buộc. Hãy tạo một project mẫu ngay trên CapCut của máy hiện tại, có ít nhất một segment video, một segment voice và một segment subtitle, sau đó chọn thư mục project đó. T-blao chỉ đọc schema native và style subtitle từ template để dựng một project mới; không clone media, track thừa hoặc nội dung cũ của template. Video/scene, voice và nội dung SRT mới được copy/map vào project mới; không cần `capcut-cli` hoặc runtime Node phụ trên máy người dùng.

## Tương thích và an toàn dữ liệu

Định dạng project CapCut không phải API công khai. Native generator lấy schema track/material từ template do chính CapCut của người dùng tạo, tạo draft mới chỉ với track video, voice và subtitle, sau đó tạo material mới cho từng asset. Material text được kế thừa style của subtitle mẫu (font, cỡ, màu, typesetting và caption metadata); material video/audio chỉ được dùng làm khuôn schema rồi thay hoàn toàn bằng asset mới. Metadata mới được ghi vào `draft_content.json`, `draft_info.json`, `draft_meta_info.json` cùng `root_meta_info.json`. Cách này tránh phụ thuộc adapter đóng gói trong T-blao.

Nguyên tắc vận hành:

- đóng CapCut trước khi tạo project; nếu draft đang mở, preflight hiển thị cảnh báo;
- không ghi đè project có sẵn: tên trùng được cấp hậu tố `(2)`, `(3)`, ...;
- không xóa project cũ hoặc project tạo dở;
- cancel chỉ kết thúc process con do batch hiện tại tạo;
- một project lỗi không ngăn các bộ sau tiếp tục chạy; kết quả ghi rõ thành công/thất bại từng bộ.

Khi CapCut nâng phiên bản và thay đổi schema, tạo một project mẫu bằng phiên bản mới trên chính máy đó, chọn thư mục ở ô `Template CapCut của máy này`, chạy preflight và kiểm tra một batch nhỏ trước.

## Kiểm tra phát hành

```powershell
npm.cmd run verify
```

Smoke test cần dùng draft store tạm, video/audio tổng hợp ngắn và SRT có ít nhất hai cue. Gate đạt khi:

- native draft được ghi thành công;
- `draft_content.json` parse được, chỉ có track dữ liệu mới và các material/segment đều trỏ tới asset tồn tại;
- draft có một video segment, đúng số audio segment và đúng số caption segment;
- media nằm trong `assets/video` và `assets/audio` của project;
- draft store thật không bị thay đổi trong smoke test.
