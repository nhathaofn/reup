# Thêm feature mới mà không phá core

## Cách nhanh nhất

Từ thư mục gốc dự án:

~~~powershell
npm.cmd run feature:create -- media-inspector "Kiểm tra media"
~~~

Lệnh sẽ:

1. Kiểm tra ID và từ chối namespace core.
2. Tạo bốn file Shared/Main/Preload/Renderer.
3. Cập nhật ba registry.
4. Chạy cả hai TypeScript typecheck.
5. Chạy architecture check.
6. Hoàn tác toàn bộ file/registry nếu một kiểm tra thất bại.

Xem trước mà không ghi file:

~~~powershell
npm.cmd run feature:create -- media-inspector "Kiểm tra media" --dry-run
~~~

Feature ID phải là kebab-case, ví dụ media-inspector hoặc batch-rename. Không
dùng ID của core như download, douyin, whisper, ocr, burn hoặc video2x.

## Cấu trúc được sinh

~~~
src/
  shared/features/media-inspector.ts
  main/features/media-inspector.ts
  preload/features/media-inspector.ts
  renderer/src/features/media-inspector/index.tsx
~~~

Và ba điểm đăng ký:

~~~
src/main/features/registry.ts
src/preload/features/registry.ts
src/renderer/src/features/registry.ts
~~~

Không sửa marker feature-scaffold bằng tay. Generator dùng marker để thực hiện
thay đổi có thể kiểm tra và hoàn tác.

## Trách nhiệm của bốn lớp

### Shared: hợp đồng

Chỉ đặt dữ liệu serializable:

- FEATURE_ID và metadata tab.
- FEATURE_CHANNELS.
- Request, Result, Progress và Error code.
- Enum/union thuần TypeScript.

Không import Electron, React, fs hay implementation.

### Main: nghiệp vụ có quyền hệ thống

Đặt ở đây:

- Đọc/ghi file.
- Mạng cần secret/cookie.
- Spawn FFmpeg, Python hoặc binary.
- Validate dữ liệu lần cuối.
- Progress, cancel và cleanup.

Mọi channel phải nằm trong namespace của feature. Ví dụ media-inspector:run,
media-inspector:cancel và media-inspector:progress.

Nếu tác vụ dài, module Main nên sở hữu process hoặc AbortController:

~~~ts
let current: AbortController | null = null

handle(CHANNELS.run, async (_event, request) => {
  current = new AbortController()
  try {
    return await service.run(request, current.signal)
  } finally {
    current = null
  }
})

handle(CHANNELS.cancel, () => {
  current?.abort()
})
~~~

Không giữ child process trong Renderer. Trong finally phải đóng stream, xóa file
tạm và đặt lại state ngay cả khi task lỗi hoặc bị hủy.

### Preload: adapter nhỏ nhất

Mỗi method chỉ nên:

- Gọi ipcRenderer.invoke.
- Đăng ký ipcRenderer.on.
- Trả hàm cleanup listener.

Không đưa ipcRenderer hoặc object Electron thô sang Renderer. Registry sẽ dừng
khởi động nếu tên method feature ghi đè API core/feature khác.

### Renderer: UI và state tương tác

Component chỉ gọi window.api. Metadata quyết định:

- placement: main hoặc bottom.
- keepAlive: true nếu đổi tab không được làm mất queue/progress.
- keepAlive: false cho form hoặc màn hình không có tác vụ nền.

Generator mặc định keepAlive false. Hãy đổi thành true trước khi thêm queue hoặc
tiến trình dài.

## Khi feature lớn hơn một file

Giữ index.tsx là entry module và tách bên trong thư mục feature:

~~~
features/media-inspector/
  index.tsx
  MediaInspectorPanel.tsx
  useMediaInspector.ts
  validation.ts
  components/
~~~

Ở Main có thể tạo service theo domain:

~~~
main/features/media-inspector.ts
main/services/media-inspector/
  service.ts
  parser.ts
  process.ts
~~~

Registry chỉ import entry module. Không import ngược từ Main vào Preload hoặc
Renderer.

## Feature dùng Python/binary

Không chép engine vào Main. Dùng cấu trúc:

~~~
engines/<feature>-engine/
  engine.py
  <feature>-engine.spec
  requirements.txt
~~~

Main adapter chịu trách nhiệm:

1. Resolve đúng binary theo platform/arch.
2. Gửi JSONL hoặc argument đã validate.
3. Parse stdout có schema rõ ràng.
4. Chuyển stderr thành log kỹ thuật, không đưa secret lên UI.
5. Kill process tree khi cancel/app quit.
6. Version engine trong engines-manifest.

Không dùng output console trang trí làm protocol. Dòng máy đọc nên là JSONL;
progress hiển thị cho người dùng là field riêng.

## Quy tắc tương thích

- Không đổi tên/xóa method window.api của core trong cùng feature PR.
- Không tái sử dụng channel của core.
- Không thay cấu trúc localStorage đang tồn tại nếu chưa có migration.
- Không unmount tab có queue đang chạy.
- Không đổi format config/database engine mà không version/migrate.
- Không cho Renderer tự tạo đường dẫn shell command.
- Luôn quote/escape qua API spawn argument, không ghép chuỗi lệnh.
- Dữ liệu từ AI, URL, subtitle và engine đều là input không tin cậy.

## Kiểm tra trước khi bàn giao

Chạy toàn bộ:

~~~powershell
npm.cmd run verify
~~~

Hoặc tách riêng:

~~~powershell
npm.cmd run typecheck
npm.cmd run check:architecture
npm.cmd run build
~~~

Checklist cho feature:

- Happy path.
- Input rỗng/sai kiểu/sai đường dẫn.
- Binary hoặc mạng không sẵn sàng.
- Cancel giữa chừng và cleanup.
- Đổi tab khi đang chạy.
- Đóng cửa sổ khi đang chạy.
- Hai yêu cầu liên tiếp hoặc nhấn Run hai lần.
- Không log cookie, API key hay URL có token.
- Windows path có dấu cách và Unicode.
- Bản packaged dùng đúng resource path, không chỉ dev path.

Architecture check là hàng rào cấu trúc, không thay thế test nghiệp vụ hoặc smoke
test thật với binary/engine.
