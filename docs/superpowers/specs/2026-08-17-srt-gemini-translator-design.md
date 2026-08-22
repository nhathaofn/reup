# Dịch file SRT bằng Gemini — Đặc tả thiết kế

**Ngày:** 2026-08-17  
**Trạng thái:** Chờ duyệt đặc tả  
**Phạm vi:** Thêm một tab mới vào ứng dụng TediaPros để dịch một file SRT tiếng Trung sang nhiều ngôn ngữ đích bằng Gemini.

## 1. Bối cảnh và mục tiêu

Ứng dụng đã có luồng dịch SRT bằng Gemini trong tab Phụ đề và Đọc chữ video, bao gồm lưu API key, chia chunk, giữ timestamp và báo tiến trình. Luồng mới không tạo lại nghiệp vụ Gemini; nó cung cấp một giao diện chuyên biệt để người dùng:

1. Chọn một file `.srt` tiếng Trung.
2. Chọn hoặc tự nhập một hay nhiều ngôn ngữ đích.
3. Dịch các ngôn ngữ trong một lượt.
4. Xem file gốc và từng bản dịch ngay trong app.
5. Xuất thủ công từng bản dịch hoặc xuất tất cả các bản dịch đã hoàn tất.

Ảnh giao diện người dùng cung cấp chỉ là tham chiếu trực quan: tab mới giữ phong cách dark/sidebar hiện tại và gần với bố cục hai vùng của ảnh phác thảo. Nội dung triển khai được quyết định bởi yêu cầu ở trên.

## 2. Yêu cầu đã xác nhận

### 2.1. Chức năng

- Có một tab sidebar mới, nhãn ngắn là `Dịch SRT`, dùng Gemini.
- Nguồn được hiển thị là `Tiếng Trung`; phiên bản đầu không cần cho đổi ngôn ngữ nguồn.
- Cho phép chọn các ngôn ngữ có sẵn và nhập tên ngôn ngữ tùy ý, ví dụ `Tiếng Thái`.
- Một lượt dịch có thể chứa nhiều ngôn ngữ đích.
- Hiển thị nội dung SRT gốc và bản dịch trong app trước khi xuất.
- Có nút xuất riêng trên từng ngôn ngữ đã dịch thành công.
- Có nút `Xuất tất cả` để xuất mọi bản dịch đã hoàn tất.
- File xuất giữ nguyên timestamp và số cue theo format SRT; không sửa file gốc.
- Mỗi ngôn ngữ đích tạo một file SRT riêng, với hậu tố ngôn ngữ.

### 2.2. Trải nghiệm và trạng thái

- Khi chưa chọn file, vùng xem trước hiển thị empty state rõ ràng.
- Khi chưa chọn ngôn ngữ, nút dịch bị khóa và có hướng dẫn ngắn.
- Trong lúc dịch, khóa các điều khiển làm thay đổi đầu vào và hiển thị tiến trình theo ngôn ngữ/chunk.
- Một ngôn ngữ lỗi không xóa các bản dịch đã thành công của các ngôn ngữ khác.
- Có thể chọn một ngôn ngữ trong hàng tab/chip để xem bản dịch tương ứng ở vùng phải.
- Bản dịch chưa hoàn tất hiển thị trạng thái `Đang chờ`, `Đang dịch` hoặc `Lỗi` thay vì dữ liệu giả.
- API key Gemini dùng khoá đã lưu trong cơ chế hiện tại; không đưa key vào renderer state, URL hoặc file xuất.

## 3. Bố cục giao diện

Tab mới dùng `keepAlive: true` để nội dung đã dịch không mất khi người dùng chuyển sang tab khác trong cùng phiên.

### 3.1. Khu vực cấu hình

- Card chọn file:
  - nút `Chọn file SRT` gọi dialog chọn `.srt` hiện có;
  - tên file và đường dẫn rút gọn;
  - số cue sau khi đọc file;
  - nút `Đổi file` khi đã có nguồn.
- Card Gemini:
  - hiển thị trạng thái đã kết nối/chưa kết nối;
  - dùng lại cơ chế `translateHasKey`, `translateSaveKey`, `translateCheckKey` với provider cố định là `gemini`;
  - có liên kết hoặc khu vực thao tác để nhập/kiểm tra key mà không cần rời tab.
- Hàng ngôn ngữ đích:
  - các preset lấy từ danh sách ngôn ngữ chung hiện có;
  - ô nhập tự do và nút `Thêm`;
  - mỗi lựa chọn là một chip có nút xóa;
  - chuẩn hóa trùng lặp theo mã hoặc tên đã chuẩn hóa.
- Nút hành động chính `Dịch bằng Gemini`.

### 3.2. Khu vực xem trước

- Hai cột lớn theo ảnh phác thảo:
  - trái: `SRT tiếng Trung`, read-only, hiển thị toàn bộ nội dung gốc;
  - phải: bản dịch của ngôn ngữ đang chọn, read-only.
- Trên vùng phải có hàng chip/tab ngôn ngữ đích. Chip thể hiện:
  - tên ngôn ngữ;
  - trạng thái đang dịch/đã xong/lỗi;
  - nút xuất riêng khi đã xong.
- Thanh hành động kết quả:
  - `Xuất tất cả` chỉ xuất các bản dịch đã thành công;
  - nếu chưa có bản dịch thành công, nút bị khóa;
  - sau khi xuất hiển thị danh sách đường dẫn hoặc nút mở thư mục.
- Trên màn hình hẹp, hai cột chuyển thành xếp dọc; chip ngôn ngữ vẫn cuộn ngang.

## 4. Kiến trúc kỹ thuật

Đây là một feature dọc có namespace riêng `srt-translator`, nhưng gọi lại nghiệp vụ Gemini dùng chung.

### 4.1. Các file dự kiến

~~~text
src/shared/features/srt-translator.ts
src/main/features/srt-translator.ts
src/preload/features/srt-translator.ts
src/renderer/src/features/srt-translator/index.tsx
src/renderer/src/features/srt-translator/styles.css
~~~

Đăng ký feature trong ba registry hiện có:

~~~text
src/main/features/registry.ts
src/preload/features/registry.ts
src/renderer/src/features/registry.ts
~~~

Không thêm handler vào namespace core nếu handler đó chỉ phục vụ tab mới. Các API dịch Gemini core hiện tại vẫn giữ tương thích cho tab Phụ đề và Đọc chữ video.

### 4.2. Tái sử dụng Gemini và SRT

- Dùng `src/main/translate-shared.ts` cho parse/build SRT và chia chunk.
- Tách phần nghiệp vụ hiện có trong `src/main/gemini.ts` thành một hàm dịch nội dung ở bộ nhớ, ví dụ `translateSrtText(raw, dich, onProgress)`, trả về nội dung SRT đã build.
- Giữ `translateSrt(srtPath, outPath, dich, onProgress)` hiện tại bằng cách gọi lại hàm mới rồi ghi file, để không phá các tab đang dùng.
- Feature Main đọc file nguồn một lần, dịch tuần tự từng ngôn ngữ bằng Gemini, và trả về nội dung SRT từng ngôn ngữ cho renderer để xem trước.
- Timestamp không gửi vào payload Gemini; chỉ phần text cue được gửi như logic hiện tại.
- Với tên ngôn ngữ tùy ý, prompt dùng đúng nhãn người dùng nhập. Với preset, dùng mã/ngôn ngữ chuẩn và nhãn hiển thị rõ ràng.

### 4.3. IPC feature

Shared contract định nghĩa tối thiểu:

- `srt-translator:load`: đọc và kiểm tra file nguồn để renderer có thể hiển thị SRT gốc ngay sau khi chọn file.
- `srt-translator:translate`: nhận `sourcePath` và danh sách target language; trả về source text cùng kết quả độc lập của từng target.
- `srt-translator:progress`: gửi `targetId`, vị trí target, chunk hoàn tất/tổng chunk, phần trăm và thông báo.
- `srt-translator:export-one`: mở Save dialog cho một target, ghi nội dung SRT và trả về đường dẫn.
- `srt-translator:export-all`: mở chọn thư mục, ghi các target thành công và trả về danh sách file đã tạo.

Renderer không được tự đọc/ghi đường dẫn file bằng Node API. Main chịu trách nhiệm dialog, đọc nguồn, gọi Gemini và ghi file.

### 4.4. Tên file và an toàn xuất file

- Tên cơ sở lấy từ tên file nguồn, bỏ đuôi `.srt`.
- Tên riêng có dạng `<base>.<language-slug>.srt`, ví dụ `video.tieng-viet.srt` hoặc `video.ja.srt`.
- Slug loại bỏ dấu, ký tự đường dẫn và ký tự điều khiển; nếu rỗng dùng `lang-<n>`.
- File nguồn không bao giờ là đích ghi.
- `Xuất từng file` dùng Save dialog để người dùng chọn tên/vị trí.
- `Xuất tất cả` dùng folder dialog; nếu tên đầu ra đã tồn tại thì không ghi đè âm thầm, tạo tên tăng dần hoặc báo danh sách xung đột rõ ràng.
- Nội dung SRT được ghi UTF-8.

## 5. Hợp đồng dữ liệu dự kiến

Tên cụ thể có thể tinh chỉnh trong kế hoạch, nhưng phải giữ các đặc tính sau:

~~~ts
interface SrtTargetLanguage {
  id: string
  label: string
  code?: string
}

interface SrtTranslateRequest {
  sourcePath: string
  targets: SrtTargetLanguage[]
}

interface SrtLoadResult {
  ok: boolean
  sourcePath: string
  sourceText?: string
  count?: number
  error?: string
}

interface SrtTranslationResult {
  target: SrtTargetLanguage
  ok: boolean
  srt?: string
  count?: number
  error?: string
}

interface SrtTranslateResult {
  ok: boolean
  sourcePath: string
  sourceText?: string
  translations: SrtTranslationResult[]
  error?: string
}

interface SrtTranslateProgress {
  targetId: string
  targetLabel: string
  targetIndex: number
  totalTargets: number
  done: number
  total: number
  percent: number
  message: string
}
~~~

Kết quả batch dùng `translations[]` thay vì fail-fast để UI có thể hiển thị bản thành công khi một ngôn ngữ khác bị lỗi.

## 6. Xử lý lỗi và giới hạn

- File không tồn tại, không đọc được hoặc không có cue hợp lệ: trả lỗi trước khi gọi Gemini.
- Không có API key: trả thông báo hướng dẫn kết nối, không gửi request dịch.
- Gemini trả JSON không hợp lệ hoặc thiếu cue: giữ nguyên hành vi fallback hiện tại của engine; nếu toàn bộ target thất bại thì hiển thị lỗi batch.
- Lỗi mạng/rate limit chỉ đánh dấu target hiện tại lỗi; các target trước đó vẫn xem/xuất được.
- Không lưu nội dung SRT dịch vào localStorage; chỉ giữ trong state của tab.
- Không thực hiện song song các target ở phiên bản đầu để tránh tăng đột biến rate limit và khó đọc tiến trình.

## 7. Kiểm thử và tiêu chí chấp nhận

### 7.1. Kiểm thử tự động

- Hàm chuẩn hóa target: trim, loại bỏ trùng, giữ mã preset và sinh ID ổn định cho tên tùy ý.
- Hàm slug/tên file: không chứa path traversal, giữ base name, tạo hậu tố khác nhau cho target khác nhau.
- Contract/logic batch: target thành công được giữ khi target sau lỗi; tiến trình có target index đúng.
- SRT text translation: timestamp và số cue được giữ nguyên sau build.
- Registry/TypeScript/build của app phải kiểm tra được bằng các script hiện có; nếu môi trường thiếu dependency thì ghi nhận chính xác lỗi môi trường.

### 7.2. Tiêu chí chấp nhận thủ công

1. Tab `Dịch SRT` xuất hiện trong sidebar theo phong cách hiện tại.
2. Chọn file SRT tiếng Trung thấy nội dung ở vùng trái.
3. Thêm ít nhất hai ngôn ngữ, bấm dịch và thấy từng chip chuyển trạng thái.
4. Chọn từng chip thấy đúng bản dịch ở vùng phải.
5. Xuất một ngôn ngữ tạo đúng một file `.srt` UTF-8, timestamp không đổi.
6. `Xuất tất cả` tạo các file riêng cho mọi ngôn ngữ đã thành công.
7. Một target lỗi không xóa target thành công.
8. Không có API key hoặc file không hợp lệ cho thông báo dễ hiểu và không làm app crash.

## 8. Ngoài phạm vi phiên bản đầu

- Không chỉnh sửa nội dung thủ công trực tiếp trong preview.
- Không dịch tự động khi người dùng chọn file; phải bấm nút rõ ràng.
- Không song song hóa nhiều target.
- Không thêm lịch sử bản dịch lâu dài hoặc khôi phục sau khi khởi động lại app.
- Không đổi luồng dịch OpenAI hiện có.


