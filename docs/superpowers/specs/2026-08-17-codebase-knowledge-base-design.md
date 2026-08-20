# Bộ tài liệu hiểu nhanh codebase — Design Spec

**Ngày:** 2026-08-17  
**Phạm vi:** repository `F:/Son/reup-main`  
**Mục tiêu:** Tạo một hệ thống tài liệu Markdown giúp AI hoặc developer hiểu đúng cấu trúc và các luồng chính của codebase trước khi phải quét lại toàn bộ mã nguồn.

## Bối cảnh

Repository là ứng dụng desktop T-blao, dùng Electron, React, TypeScript và các engine Python cho tải Douyin, OCR và Whisper. Ngoài mã nguồn runtime còn có script build, workflow phát hành, tài liệu hiện có và dữ liệu thử nghiệm CapCut.

Repository đã có `docs/PROJECT_ARCHITECTURE.md`, `docs/ADDING_A_FEATURE.md` và `docs/CAPCUT_FACTORY.md`. Tuy nhiên tài liệu kiến trúc là một snapshot cũ hơn version hiện tại và một số mô tả cần đối chiếu lại với code. Bộ tài liệu mới phải bổ sung điểm vào duy nhất, chia nội dung theo miền và ghi rõ các điểm cần kiểm tra khi code thay đổi.

## Mục tiêu và tiêu chí thành công

Bộ tài liệu phải giúp người đọc trả lời nhanh các câu hỏi sau mà không cần mở toàn bộ repository:

1. Ứng dụng khởi động từ đâu và dữ liệu đi qua Main, Preload, Renderer như thế nào?
2. Khi sửa một tính năng, cần đọc và thay đổi những file nào?
3. IPC, contract dùng chung và feature registry được nối với nhau ra sao?
4. Engine/binary nào được dùng, được cài ở đâu, giao tiếp bằng giao thức nào và có thể hủy ra sao?
5. Build, test, package và release dùng lệnh/workflow nào?
6. Những điểm bất nhất, rủi ro hoặc giới hạn nào đã được xác minh?

Tiêu chí kiểm chứng:

- `CODEBASE.md` là điểm đọc đầu tiên và liên kết được tới mọi tài liệu miền.
- Mỗi tài liệu miền có phạm vi, file nguồn quan trọng, ngày xác minh và điều kiện cần cập nhật.
- Các luồng quan trọng có đường dẫn file cụ thể, không chỉ mô tả khái quát.
- Tài liệu phân biệt mã nguồn hoạt động, mã nguồn trùng/lồng, binary/runtime và dữ liệu sinh.
- Các kết luận có thể kiểm tra lại bằng lệnh trong repository.
- Không thêm implementation hoặc thay đổi hành vi ứng dụng; công việc chỉ tạo/cập nhật tài liệu và liên kết.

## Phương án đã chọn

Dùng tài liệu phân lớp thay vì gom toàn bộ kiến thức vào một file hoặc tự động sinh toàn bộ tài liệu.

- File root ngắn làm mục lục và quy trình đọc.
- Tài liệu `docs/` chia theo kiến trúc, bản đồ module, IPC/feature, runtime/engine và ghi chú rủi ro.
- Tài liệu hiện có vẫn được giữ làm tài liệu chuyên sâu; chỉ cập nhật các phần sai hoặc thêm liên kết đến điểm vào mới.
- Nội dung inventory và kết luận được viết thủ công dựa trên source hiện tại để có thể giải thích nguyên nhân và trade-off, không chỉ liệt kê tên file.

Phương án này giảm context phải nạp trong những lần sau, nhưng vẫn giữ đủ đường dẫn để đi sâu có mục tiêu khi code đã thay đổi.

## Cấu trúc file

### `CODEBASE.md`

File “đọc đầu tiên” ở root. Nội dung gồm:

- mục tiêu tài liệu và trạng thái snapshot;
- version ứng dụng hiện tại (`package.json` version `0.1.25`);
- phạm vi quét và các thư mục không xem là source (`node_modules`, `out`, `dist`, binary và dữ liệu trong `test-artifacts`);
- bản đồ nhanh các thư mục root;
- bảng “câu hỏi → tài liệu cần đọc”;
- lệnh xác minh cơ bản;
- quy tắc cập nhật tài liệu khi thay đổi entrypoint, IPC, engine, package hoặc workflow.

### `docs/CODEBASE_MAP.md`

Bản đồ module chi tiết:

- `src/main`, `src/preload`, `src/renderer`, `src/shared`;
- `src/main/services` và các service xử lý video/CapCut;
- `engines/douyin-engine`, `engines/ocr-engine`, `engines/whisper-engine`;
- `scripts`, `.github/workflows`, `resources` và file cấu hình root;
- entrypoint, module sở hữu state/process và file test liên quan;
- phân biệt cây Douyin hoạt động với `douyin-downloader-main` lồng bên trong.

### `docs/IPC_AND_FEATURES.md`

Tài liệu hợp đồng ứng dụng:

- luồng `Renderer → window.api → Preload → ipcMain → Main service`;
- các nhóm IPC core và event progress/cancel;
- vai trò của `src/shared/types.ts` và `src/shared/features/*`;
- ba feature registry và feature vertical slice;
- quy tắc namespace, cleanup listener, validate ở Main và giữ process ở Main;
- liên kết tới `docs/ADDING_A_FEATURE.md` và các feature hiện có.

### `docs/ENGINES_AND_RUNTIME.md`

Bản đồ runtime/deployment:

- yt-dlp và FFmpeg/FFprobe;
- Douyin engine và cookie riêng;
- Whisper, model, CUDA bundle và JSONL;
- OCR engine và pipeline SRT;
- Video2X và PySceneDetect/scene splitter;
- CapCut Factory và phụ thuộc FFprobe/draft store;
- đường dẫn `userData`, resolve binary, manifest version và tải asset release;
- khác biệt dev, packaged Windows và macOS;
- workflow build engine và workflow release app.

### `docs/CODEBASE_NOTES.md`

Danh sách ghi chú có bằng chứng:

- mức độ ảnh hưởng;
- file hoặc lệnh dùng để xác minh;
- hiện trạng quan sát được;
- tác động khi sửa code;
- hướng xử lý được đề xuất nếu cần, nhưng không tự sửa ngoài phạm vi tài liệu.

Các ghi chú ban đầu phải bao gồm sự khác nhau giữa tài liệu cũ và source hiện tại, duplicate Douyin tree, manifest engine, giới hạn test/CI và các điểm liên quan đến secret/runtime.

### Các tài liệu hiện có

- `docs/PROJECT_ARCHITECTURE.md`: giữ vai trò kiến trúc tổng quan và được cập nhật để khớp snapshot hiện tại.
- `docs/ADDING_A_FEATURE.md`: giữ quy trình thêm feature, được liên kết từ tài liệu IPC.
- `docs/CAPCUT_FACTORY.md`: giữ thiết kế/định dạng CapCut Factory, được liên kết từ bản đồ module và runtime.
- `README.md`: thêm liên kết đến `CODEBASE.md` và không lặp lại toàn bộ nội dung tài liệu chuyên sâu.

## Quy tắc nội dung

Mỗi tài liệu mới hoặc tài liệu được cập nhật phải:

- ghi ngày xác minh và version/snapshot liên quan;
- dùng đường dẫn repository tương đối trong các liên kết nội bộ;
- nêu “khi nào nên đọc tài liệu này” ở phần đầu;
- chỉ gọi một thư mục là source khi đã kiểm tra file thực tế;
- đánh dấu rõ thông tin suy luận, thông tin runtime phụ thuộc máy và thông tin đã kiểm tra bằng lệnh;
- không đưa secret, cookie, token, đường dẫn cá nhân hoặc dữ liệu nhị phân vào tài liệu;
- không biến `test-artifacts` thành danh sách source vì đây là output thử nghiệm.

## Luồng cập nhật trong tương lai

Khi bắt đầu một task mới, đọc theo thứ tự:

1. `CODEBASE.md`.
2. Tài liệu miền tương ứng.
3. Các file source được tài liệu chỉ ra.
4. Chỉ quét rộng hơn nếu tài liệu và code hiện tại mâu thuẫn hoặc task đi qua boundary chưa được mô tả.

Khi có thay đổi:

- đổi entrypoint/layer/IPC: cập nhật `CODEBASE.md`, `CODEBASE_MAP.md` và `IPC_AND_FEATURES.md`;
- đổi engine, binary, manifest hoặc workflow: cập nhật `ENGINES_AND_RUNTIME.md`;
- phát hiện mismatch hoặc risk mới: thêm mục vào `CODEBASE_NOTES.md`;
- đổi kiến trúc tổng quan: cập nhật `PROJECT_ARCHITECTURE.md`;
- thêm feature: cập nhật tài liệu feature và bảng liên kết nếu boundary mới xuất hiện.

## Kiểm tra dự kiến

Sau khi tạo tài liệu:

1. Kiểm tra mọi file được liên kết đều tồn tại.
2. Tìm các đường dẫn nội bộ sai hoặc trỏ tới file đã xóa.
3. Đối chiếu version, entrypoint, tên registry, channel và script với source/config hiện tại.
4. Chạy `npm.cmd run typecheck` và `npm.cmd run check:architecture` để bảo đảm tài liệu không đi kèm thay đổi TypeScript ngoài ý muốn.
5. Chạy `npm.cmd run build` nếu môi trường đủ dependency; nếu không, ghi rõ lý do và output thực tế.

## Ngoài phạm vi

- Không sửa logic TypeScript/Python.
- Không hợp nhất hoặc xóa cây Douyin trùng nhau.
- Không khôi phục các file engine bị thiếu chỉ để làm cho tài liệu đẹp hơn.
- Không thêm công cụ sinh tài liệu mới trong đợt này.
- Không đưa binary, font có bản quyền, cookie hoặc dữ liệu cá nhân vào commit/tài liệu.

## Trạng thái triển khai

Design này đã được người dùng duyệt. Implementation sẽ tạo/cập nhật các file Markdown nêu trên, tự kiểm tra liên kết và đối chiếu lại các kết luận với source trước khi bàn giao.


