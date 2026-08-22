# Phục hồi SRT đa phương thức và bản địa hóa theo quốc gia — Đặc tả thiết kế

**Ngày:** 2026-08-18

**Trạng thái:** Thiết kế hội thoại đã duyệt; chờ người dùng review đặc tả

**Phạm vi:** Nâng cấp tab `Dịch SRT` hiện có để dùng video gốc kiểm chứng phụ đề tiếng Trung do ASR tạo ra, tạo một nguồn chuẩn bằng hai lượt Gemini, cho người dùng Việt xử lý chỗ mơ hồ bằng ý nghĩa tiếng Việt, rồi bản địa hóa sang từng ngôn ngữ/quốc gia trước khi xuất SRT.

## 1. Bối cảnh

Tab `Dịch SRT` hiện tại nhận một file SRT tiếng Trung, gọi Gemini riêng cho từng ngôn ngữ đích, giữ timestamp tại máy và cho phép xem trước/xuất từng file hoặc tất cả. Prompt hiện tại bảo toàn cấu trúc tốt nhưng chỉ yêu cầu dịch chuyên nghiệp, sát nghĩa và tự nhiên; nó chưa có một giai đoạn phục hồi source riêng và chưa có hồ sơ bản địa hóa theo quốc gia.

Đánh giá thực tế trên bốn bản Việt, Nhật, Thái và Indonesia cho thấy nội dung truyền đạt đúng khoảng 90–97%, nhưng:

- tiếng Việt và Indonesia còn giống văn dịch hoặc văn viết;
- tiếng Nhật có một số cách gọi mang giọng tài liệu;
- cách gọi chung `鹅` bị ép thành “ngỗng” ngay cả khi hình ảnh là thiên nga;
- biệt danh hoặc cách gọi dân gian có nguy cơ bị biến thành tên loài chính thức;
- prompt chưa bắt Gemini đối chiếu lỗi ASR, đồng âm, tiếng lóng và hình ảnh trước khi dịch;
- tiền tệ, đơn vị, tên loài và thuật ngữ chưa được chuyển theo locale đích.

Vì người dùng không đọc được tiếng Trung, việc chỉ hiển thị bản Trung đã sửa để người dùng tự chỉnh không giải quyết được vấn đề. Hệ thống phải dùng video làm bằng chứng, tự phản biện thay đổi, và trình bày chỗ mơ hồ bằng tiếng Việt.

Đặc tả này mở rộng đặc tả ban đầu tại `docs/superpowers/specs/2026-08-17-srt-gemini-translator-design.md`. Các hành vi xem trước, xuất file, giữ timestamp và partial success của đặc tả cũ vẫn được giữ nếu không bị thay thế rõ ràng ở đây.

## 2. Mục tiêu

1. Chọn đồng thời video gốc và SRT tiếng Trung do ASR tạo ra.
2. Upload video một lần để Gemini nghe, xem và đối chiếu cue theo timestamp.
3. Phục hồi source qua hai lượt độc lập: đề xuất và phản biện.
4. Tạo một nguồn chuẩn duy nhất dùng chung cho mọi ngôn ngữ đích.
5. Không bắt người dùng đọc hoặc sửa tiếng Trung; chỉ yêu cầu chọn giữa các ý nghĩa tiếng Việt khi thật sự mơ hồ.
6. Bản địa hóa văn phong, tiền tệ, đơn vị, tên loài, thuật ngữ, thành ngữ và cách gọi theo quốc gia đích.
7. Giữ tuyệt đối số cue, số thứ tự, timestamp và nhãn speaker của SRT gốc.
8. Cho phép hủy, retry và cleanup video từ xa trong mọi trạng thái.
9. Giữ API key, video, URI upload và nội dung Gemini khỏi log và persistence không cần thiết.
10. Đưa chất lượng Việt, Nhật, Thái và Indonesia lên tối thiểu 9/10 theo rubric đã dùng trong bản đánh giá đầu vào.

## 3. Ngoài phạm vi

- Không cam kết độ chính xác ngôn ngữ 100%; video và hai lượt kiểm tra giảm rủi ro nhưng không tạo ra ground truth tuyệt đối.
- Không thay thế engine ASR/Whisper hiện có và không thêm phiên âm thời gian thực.
- Không thêm lịch sử cloud hoặc khôi phục job sau khi app khởi động lại.
- Không yêu cầu người dùng chỉnh trực tiếp chữ Trung.
- Không dùng tỷ giá cho thanh toán, giao dịch hoặc báo cáo tài chính; chỉ tạo con số gần đúng cho lời thoại video.
- Không thay dữ kiện Trung Quốc bằng dữ kiện của nước đích.
- Không đổi luồng OpenAI hoặc các API dịch core hiện có ngoài việc giữ tương thích với helper dùng chung.
- Không dịch song song mọi target trong phiên bản đầu; tiếp tục dịch tuần tự để kiểm soát quota và tiến trình.

## 4. Quyết định đã duyệt

- Người dùng luôn có video gốc và chấp nhận upload toàn bộ video lên Gemini.
- Dùng kiến trúc phục hồi + phản biện hai lượt trước khi dịch.
- Video được upload một lần và URI được tái sử dụng trong các lượt Gemini của job.
- Người dùng xử lý chỗ mơ hồ bằng nghĩa tiếng Việt và video tại timestamp, không bằng cách sửa tiếng Trung.
- Cue tin cậy cao được tự chấp nhận; cue trung bình/thấp chỉ được chốt sau lượt phản biện và, nếu vẫn mơ hồ, lựa chọn của người dùng.
- Mỗi target gắn với một locale/quốc gia, không chỉ một nhãn ngôn ngữ.
- Tiền địa phương đứng trước, số tiền nguồn nằm trong ngoặc và giá trị quy đổi luôn mang nghĩa “khoảng”.
- App lấy tỷ giá và tính conversion; Gemini chỉ diễn đạt giá trị đã tính, không được tự đoán tỷ giá hoặc tự làm phép tính.
- Nếu không có tỷ giá, giữ nguyên tiền nguồn và hiển thị cảnh báo.
- Tên loài được đổi sang tên thông dụng/chuyên ngành chuẩn của locale đích khi danh tính đã được xác minh; không thay bằng một loài khác.
- Video từ xa được xóa khi job hoàn tất, hủy, lỗi hoặc được giải phóng.

## 5. Luồng người dùng

### 5.1. Năm bước

~~~text
1. Chọn nguồn
   -> 2. Kiểm tra và phục hồi
   -> 3. Rà soát ý nghĩa mơ hồ
   -> 4. Dịch và bản địa hóa
   -> 5. Xem trước và xuất
~~~

### 5.2. Chọn nguồn

Người dùng chọn:

- một video gốc;
- một file `.srt` tiếng Trung;
- Gemini API key theo cơ chế hiện tại.

Main kiểm tra file tồn tại, định dạng video, cue SRT, timestamp cuối, thời lượng video và fingerprint nguồn trước khi upload. Timestamp cuối không được vượt thời lượng video quá 2 giây. Đổi video hoặc SRT làm mất hiệu lực nguồn chuẩn và mọi bản dịch của job cũ.

### 5.3. Kiểm tra và phục hồi

Nút chính là `Kiểm tra và phục hồi tiếng Trung`. UI hiển thị tuần tự:

- Đang kiểm tra nguồn.
- Đang tải video lên Gemini.
- Gemini đang xử lý video.
- Đang nghe, xem và đối chiếu SRT.
- Đang phản biện các câu đã sửa.
- Đã tạo nguồn chuẩn hoặc cần rà soát.

Kết quả tóm tắt số cue giữ nguyên, số cue sửa tự động và số cue cần người dùng xác nhận.

### 5.4. Rà soát bằng tiếng Việt

Chỉ cue còn mơ hồ xuất hiện trong danh sách review. Mỗi thẻ có:

- số cue và timestamp;
- nút phát video tại đúng mốc;
- 1–3 phương án ý nghĩa bằng tiếng Việt;
- lý do nghi vấn đã làm sạch, ví dụ lỗi đồng âm, tiếng lóng, taxonomy hoặc tên riêng;
- thông tin hình ảnh liên quan;
- confidence sau phản biện;
- phần tiếng Trung gốc/phục hồi được thu gọn mặc định.

Người dùng chọn phương án theo hình ảnh và mạch nội dung. Không thể bắt đầu dịch khi còn cue chưa giải quyết. Nếu không có cue mơ hồ, bước này tự hoàn tất.

### 5.5. Chọn target và locale

Preset đầu tiên:

| Ngôn ngữ | Locale | Quốc gia | Tiền tệ |
|---|---|---|---|
| Tiếng Việt | `vi-VN` | Việt Nam | `VND` |
| Tiếng Indonesia | `id-ID` | Indonesia | `IDR` |
| Tiếng Nhật | `ja-JP` | Nhật Bản | `JPY` |
| Tiếng Thái | `th-TH` | Thái Lan | `THB` |
| Tiếng Hàn | `ko-KR` | Hàn Quốc | `KRW` |
| Tiếng Anh | `en-US` | Hoa Kỳ | `USD` |

Ngôn ngữ tùy chỉnh bắt buộc có quốc gia/region và mã tiền tệ ISO 4217. App điền tiền tệ mặc định theo locale, người dùng có thể đổi trước khi dịch. Ví dụ `Tiếng Anh · Hoa Kỳ · USD` và `Tiếng Anh · Vương quốc Anh · GBP` là hai target khác nhau.

### 5.6. Dịch và xuất

- Mỗi target được dịch tuần tự từ cùng canonical source.
- Video URI của job được gắn vào từng request dịch để giữ ngữ cảnh hình ảnh; đây là tái sử dụng file đã upload, không upload lại. Model không được thay đổi canonical meaning đã chốt.
- Mỗi target có tab xem trước, trạng thái, lỗi và nút xuất riêng.
- `Xuất tất cả` chỉ xuất target thành công.
- Timestamp và số cue được ghép lại tại máy từ source gốc.

## 6. Kiến trúc tổng thể

Đây vẫn là vertical slice `srt-translator`, nhưng Main feature chuyển từ adapter dịch đơn giản thành job orchestrator có trạng thái.

~~~text
Renderer
  -> Preload API
    -> Main feature / job controller
       -> source validator + media probe
       -> Gemini Files adapter
       -> restoration service (pass 1)
       -> audit service (pass 2)
       -> locale profile service
       -> exchange-rate provider
       -> localized translation service
       -> SRT merge/export
~~~

### 6.1. Ranh giới module

#### Main feature adapter

`src/main/features/srt-translator.ts` chỉ:

- đăng ký IPC;
- validate request sơ bộ;
- gọi job controller;
- phát progress;
- mở dialog đọc/ghi;
- chuyển lỗi đã làm sạch về renderer.

Nghiệp vụ upload, phục hồi, audit, tỷ giá và dịch không đặt trực tiếp trong feature adapter.

#### Job controller

Một service riêng quản lý đúng một active job:

- `jobId` ngẫu nhiên;
- source fingerprint;
- trạng thái và `AbortController`;
- tên/URI file Gemini chỉ tồn tại trong Main;
- canonical source;
- review resolution;
- translation results;
- cleanup idempotent.

Renderer không nhận Gemini file name, file URI, API key hoặc dữ liệu request thô.

#### Gemini Files adapter

Adapter tách biệt cung cấp:

- upload resumable;
- poll trạng thái file tới `ACTIVE`;
- tạo multimodal request bằng file URI;
- delete file;
- retry và timeout;
- abort.

Phiên bản đầu tiếp tục dùng REST transport hiện có để giới hạn phạm vi thay đổi. Giao diện nội bộ không phụ thuộc chi tiết endpoint, nhờ đó có thể thay transport mà không đổi job controller hoặc các service nghiệp vụ.

#### Restoration và audit services

Hai service thuần điều phối prompt, schema, validator và merge kết quả. Chúng nhận một Gemini transport interface để test không cần mạng.

#### Locale profile service

Xây dựng profile xác định:

- language/locale/region;
- currency;
- unit conventions;
- number formatting;
- target-specific style guide;
- proper-name transliteration policy;
- species/terminology policy.

#### Exchange-rate provider

Provider trả một snapshot immutable cho toàn batch. Translation service chỉ dùng snapshot, không tự gọi mạng và không cho model tự sinh rate.

## 7. Hợp đồng dữ liệu

Các type dưới đây là hợp đồng mặc định cho implementation plan. Chỉ được đổi tên khi plan ghi rõ mapping một-một; shape và invariant không được thay đổi.

~~~ts
type Confidence = 'high' | 'medium' | 'low'

type RestorationIssue =
  | 'none'
  | 'homophone'
  | 'asr-omission'
  | 'asr-segmentation'
  | 'dialect'
  | 'slang'
  | 'taxonomy'
  | 'proper-name'
  | 'technical-term'
  | 'number-or-currency'
  | 'other'

interface SourceFingerprint {
  path: string
  size: number
  modifiedMs: number
}

interface RestorationCandidate {
  id: string
  correctedZh: string
  meaningVi: string
  evidenceVi: string
}

interface RestoredCue {
  n: number
  time: string
  originalZh: string
  correctedZh: string
  meaningVi: string
  changed: boolean
  confidence: Confidence
  issue: RestorationIssue
  evidenceVi: string
  visualContextVi?: string
  candidates: RestorationCandidate[]
  needsReview: boolean
}

interface CanonicalEntity {
  id: string
  sourceForms: string[]
  category: 'species' | 'person' | 'place' | 'brand' | 'food' | 'technical' | 'other'
  canonicalMeaningVi: string
  scientificName?: string
  confidence: Confidence
  useNeutralReference: boolean
}

interface CanonicalMoneyMention {
  id: string
  cueNumber: number
  sourceAmount: number
  sourceCurrencyCode: string
  sourceSurface: string
  confidence: Confidence
  shouldConvert: boolean
}

interface CanonicalMeasurementMention {
  id: string
  cueNumber: number
  sourceValue: number
  sourceUnitCode: string
  sourceSurface: string
  confidence: Confidence
  shouldConvert: boolean
}

interface CanonicalSource {
  jobId: string
  topicVi: string
  cues: RestoredCue[]
  entities: CanonicalEntity[]
  moneyMentions: CanonicalMoneyMention[]
  measurementMentions: CanonicalMeasurementMention[]
  unresolvedCueNumbers: number[]
}

interface ReviewSelection {
  cueNumber: number
  candidateId: string
}

interface LocaleProfile {
  id: string
  languageLabel: string
  locale: string
  regionLabel: string
  currencyCode: string
  unitSystem: 'metric' | 'us-customary'
  styleGuide: string
}

interface ExchangeRateSnapshot {
  provider: 'exchange-rate-api-open'
  baseCode: 'USD'
  capturedAt: string
  sourceUpdatedAt: string
  rates: Record<string, number>
  attributionUrl: string
}

interface CurrencyConversionInstruction {
  moneyMentionId: string
  cueNumber: number
  sourceDisplay: string
  targetDisplay: string
  approximationMarker: string
  rateCapturedAt: string
}

interface MeasurementConversionInstruction {
  measurementMentionId: string
  cueNumber: number
  sourceDisplay: string
  targetDisplay: string
}

interface LocalizedTarget {
  id: string
  profile: LocaleProfile
}
~~~

Invariants:

- `RestoredCue.n` là 1-based và phủ đúng toàn bộ cue source.
- `RestoredCue.time` được app copy từ source theo `n`, không lấy từ model, và phải bằng từng ký tự với timestamp source tương ứng.
- `CanonicalSource` không được dùng để dịch khi `unresolvedCueNumbers` còn phần tử.
- Mọi target trong batch tham chiếu cùng `CanonicalSource` và cùng `ExchangeRateSnapshot` nếu có, hoặc cùng trạng thái rate unavailable.
- `CurrencyConversionInstruction` được app tính bằng số học xác định từ snapshot; Gemini không được nhận nhiệm vụ tự suy ra tỷ giá hoặc tự tính conversion.
- Mọi money mention phải trỏ tới cue tồn tại; amount/currency không chắc chắn phải có `shouldConvert = false` hoặc đi qua review.
- `MeasurementConversionInstruction` được app tính bằng bảng/hàm conversion đã kiểm thử; measurement không chắc chắn phải có `shouldConvert = false` hoặc đi qua review.
- `jobId`, không phải URI upload, là capability renderer được phép giữ.

## 8. IPC và trạng thái job

Feature contract mở rộng namespace `srt-translator`:

- `choose-video`: chọn video nguồn qua Main dialog.
- `load`: đọc và validate SRT như hiện tại, bổ sung fingerprint.
- `analyze`: tạo job, upload video, chạy restoration/audit, trả kết quả review đã làm sạch.
- `resolve`: áp dụng toàn bộ lựa chọn cho cue mơ hồ và chốt canonical source.
- `translate`: nhận `jobId` và locale targets; chỉ chạy khi source đã chốt.
- `cancel`: hủy active operation của job.
- `release`: cleanup job khi đổi nguồn, reset tab hoặc đóng feature.
- `progress`: phát trạng thái theo phase.
- `export-one` và `export-all`: giữ hành vi hiện tại.

Progress phase tối thiểu:

~~~ts
type SrtLocalizationPhase =
  | 'validating'
  | 'uploading-video'
  | 'processing-video'
  | 'restoring-source'
  | 'auditing-source'
  | 'review-required'
  | 'fetching-rates'
  | 'translating'
  | 'cleaning-up'
  | 'completed'
  | 'cancelled'
  | 'error'
~~~

Mỗi event có `jobId`, `phase`, message đã làm sạch, percent nếu xác định được và target metadata khi phase là `translating`.

### 8.1. Phân cửa sổ cue

Để tránh prompt quá lớn nhưng vẫn giữ ngữ cảnh:

- mỗi restoration request xử lý tối đa 60 cue lõi;
- request kèm tối đa 3 cue chỉ-đọc trước và 3 cue chỉ-đọc sau làm overlap;
- model chỉ được trả record cho cue lõi;
- mọi cửa sổ dùng cùng video URI và timestamp tuyệt đối;
- Main merge theo `n`, từ chối duplicate/missing/out-of-range record;
- provisional entity glossary được tích lũy sau mỗi cửa sổ và toàn bộ glossary được đưa vào pass 2 để kiểm tra consistency xuyên cửa sổ;
- pass 2 audit các cue changed/medium/low theo batch tối đa 60 cue với cùng quy tắc overlap.

SRT từ 60 cue trở xuống dùng một cửa sổ. Việc chia cửa sổ không thay đổi quy tắc hai pass và không cho phép upload video lần nữa.

## 9. Gemini pass 1 — phục hồi source

Pass 1 nhận:

- video file URI;
- một cửa sổ tối đa 60 cue lõi cùng overlap theo mục 8.1;
- source language cố định là tiếng Trung;
- JSON schema cho restoration result.

Prompt bắt buộc:

1. Xem/nghe toàn bộ phạm vi trước khi sửa từng cue.
2. Đối chiếu lời nói, hình ảnh, cue trước/sau và chủ đề.
3. Phát hiện lỗi đồng âm, sai chữ, mất chữ, ngắt câu, phương ngữ, tiếng lóng và thuật ngữ ASR nhận nhầm.
4. Chỉ sửa khi có bằng chứng; không biến lời nói đời thường thành văn viết.
5. Không tự tạo tên loài, tên riêng hoặc thuật ngữ khi chưa đủ bằng chứng.
6. Khi `鹅` hoặc từ tương tự được dùng chung chung, dựa vào hình ảnh để xác định; nếu vẫn không chắc, dùng entity trung tính.
7. Không dịch source trong `correctedZh`; `meaningVi` chỉ là diễn giải cho người dùng.
8. Trả đúng một record cho mỗi `n`; không xuất hoặc sửa timestamp. App luôn ghép timestamp gốc tại máy sau khi validate đủ và không trùng `n`.
9. Tạo 1–3 candidate khi confidence thấp, mỗi candidate có nghĩa tiếng Việt.
10. Trích xuất entity, money mention và measurement mention có cấu trúc; item không chắc chắn phải hạ confidence và không được tự gán currency/unit/taxonomy.
11. Chỉ trả JSON đúng schema.

## 10. Gemini pass 2 — phản biện

Pass 2 nhận video URI, source cue, đề xuất pass 1, context và entity glossary tạm. Vai trò là reviewer, không phải người viết lại.

Nó phải:

- kiểm tra mọi cue `changed`, `medium` hoặc `low`;
- bác thay đổi không có bằng chứng âm thanh/hình ảnh/ngữ cảnh;
- kiểm tra consistency của tên loài, tên riêng, thuật ngữ, số, tiền tệ và đơn vị;
- phân biệt tên chính thức, biệt danh và mô tả dân gian;
- hạ confidence khi hai cách hiểu đều hợp lý;
- sinh candidate tiếng Việt rõ khác biệt về ý nghĩa;
- không tự chấp nhận cue low-confidence còn mơ hồ.

Chính sách chốt:

- `high` và pass 2 đồng ý: tự động chấp nhận.
- `medium` được pass 2 nâng lên `high`: tự động chấp nhận.
- `medium/low` còn nhiều cách hiểu: `needsReview = true`.
- Pass 2 lỗi: mọi cue đã thay đổi chưa được audit trở thành unresolved; không dịch âm thầm.

## 11. Prompt dịch và bản địa hóa

Mỗi target request nhận:

- canonical cues đã chốt;
- entity glossary;
- locale profile;
- danh sách `CurrencyConversionInstruction` và `MeasurementConversionInstruction` đã được app tính sẵn; currency list rỗng khi rate unavailable;
- video URI của cùng job để giữ visual context;
- JSON schema `{ n, t }`.

### 11.1. Quy tắc chung

- Ưu tiên ý định nguồn, sau đó lời thoại tự nhiên, không bám cú pháp Trung.
- Không thay đổi canonical meaning đã chốt.
- Nhịp ngắn, dễ đọc voice-over, hợp TikTok/Douyin/Reels/Shorts.
- Giữ mức độ, cảm xúc, hài hước và quan hệ giữa các câu.
- Không thêm facts, không giải thích ngoài lời thoại.
- Không lạm dụng slang hoặc trợ từ; chỉ dùng khi người bản địa thật sự dùng trong ngữ cảnh đó.
- Giữ entity consistency trong toàn file.
- Chỉ diễn đạt các conversion instruction app cung cấp; không tự tính, sửa hoặc bổ sung số tiền/đơn vị.
- Không gộp/tách cue và không xuất timestamp/Markdown.
- Giữ nhãn `[SPEAKER_xx]` đúng vị trí.

### 11.2. Hồ sơ ngôn ngữ ban đầu

#### `vi-VN`

- Văn nói nhanh, gọn, giàu biểu cảm như reviewer/TikToker Việt.
- Tránh Hán–Việt và cấu trúc dịch máy nếu có cách nói phổ thông tự nhiên hơn.
- Dùng “con này/loài này” khi taxonomy chưa chắc.

#### `id-ID`

- Bahasa Gaul tự nhiên, không phải văn hành chính.
- Dùng `nggak`, `banget`, `bakal`, `nih/sih` có chọn lọc.
- Tránh mẫu cứng như `apakah`, `ini adalah`, `memiliki`, `berinisiatif` khi lời nói đời thường phù hợp hơn.

#### `ja-JP`

- Văn nói thân thiện; dùng Tameguchi hoặc Desu/Masu nhẹ theo ngữ cảnh và giữ register nhất quán.
- Tránh giọng documentary khi source là video ngắn đời thường.
- Dùng `この子/この鳥` khi cách gọi loài chưa chắc.

#### `th-TH`

- Thân thiện, sống động, ưu tiên hành động trực tiếp.
- Dùng trợ từ ngữ khí tự nhiên nhưng không rải máy móc.
- Dùng `ตัวนี้` khi taxonomy chưa chắc.

#### `ko-KR`

- Văn nói tự nhiên cho voice-over, Banmal hoặc đuôi lịch sự nhẹ theo ngữ cảnh.
- Không trộn register trong cùng video.

#### `en-US`

- Spoken English cho Reels/Shorts, ngắn và bắt tai.
- Dùng slang khi đúng ngữ cảnh, không biến thành caricature.
- Dùng US customary units theo profile, nhưng giữ metric gốc ngắn gọn khi giá trị chính xác quan trọng.

#### Locale tùy chỉnh

Prompt yêu cầu văn nói mạng xã hội phổ biến của đúng region. Nếu không xác định được locale/country, UI không cho thêm target.

## 12. Tiền tệ, đơn vị và entity

### 12.1. Nguồn tỷ giá

Phiên bản đầu dùng endpoint mở:

~~~text
GET https://open.er-api.com/v6/latest/USD
~~~

Lý do:

- không cần API key;
- cập nhật mỗi ngày;
- hỗ trợ CNY, VND, IDR, JPY, THB, KRW, USD và các currency thông dụng;
- cho phép cache;
- phù hợp với con số tham khảo, không dùng cho giao dịch.

App phải hiển thị attribution kín đáo theo điều khoản endpoint: `Rates By ExchangeRate-API` liên kết tới `https://www.exchangerate-api.com`.

Snapshot USD-base cho phép app đổi source -> target bằng:

~~~text
targetAmount = sourceAmount * rates[targetCode] / rates[sourceCode]
~~~

Snapshot được fetch một lần mỗi batch, cache tối đa 24 giờ và đóng băng cho toàn bộ target. Main process tính `CurrencyConversionInstruction` cho từng money mention/target trước khi gọi Gemini; model chỉ bản địa hóa cách đọc của các giá trị đã tính. UI hiển thị `sourceUpdatedAt`.

### 12.2. Quy tắc tiền tệ

- Chỉ đổi khi source currency được xác định chắc chắn và snapshot có cả hai code.
- Target amount đứng trước, source amount nằm trong ngoặc.
- Luôn dùng từ/cấu trúc tương đương “khoảng”.
- Làm tròn theo lời nói tự nhiên, không hiển thị độ chính xác giả.
- Giá trị số và cách làm tròn được app xác định; output model bị validate để không xuất một conversion khác với instruction.
- Nếu rate unavailable/unsupported: giữ source amount, không đoán.
- Nếu số tiền là tên sản phẩm, mã, thành ngữ hoặc dữ kiện lịch sử cần giữ nguyên, không áp conversion máy móc.

### 12.3. Tên loài

- Entity đã xác minh có thể mang scientific name hoặc canonical identity nội bộ.
- Target dùng tên thông dụng/chuyên ngành chuẩn của locale.
- Không đổi sang loài khác chỉ vì phổ biến tại target country.
- Biệt danh vẫn là biệt danh.
- Entity chưa chắc dùng neutral reference, không tự gán taxonomy.

### 12.4. Đơn vị và dữ kiện khác

- Main tạo `MeasurementConversionInstruction` bằng bảng/hàm xác định cho nhiệt độ, chiều dài, khối lượng, thể tích, diện tích và tốc độ; Gemini không tự làm phép đổi đơn vị.
- Metric locale giữ hệ metric và cách đọc địa phương.
- `en-US` đổi sang US customary khi phù hợp với lời thoại; có thể giữ giá trị metric gốc ngắn gọn nếu cần chính xác.
- Giá trị sau conversion và mức làm tròn do app quyết định theo locale; model chỉ diễn đạt tự nhiên.
- Output validator từ chối target tự đổi số hoặc unit khác instruction; lỗi này đi qua một lần regenerate rồi fail target nếu vẫn sai.
- Measurement không nhận diện chắc chắn hoặc không có unit mapping thì giữ nguyên source value/unit.
- Tên người, địa danh, thương hiệu được phiên âm theo locale nhưng không đổi danh tính/nguồn gốc.
- Món ăn hoặc khái niệm không có từ tương đương giữ tên gốc kèm diễn giải ngắn khi cue cho phép.

## 13. Giao diện

### 13.1. Stepper

~~~text
[1. Chọn nguồn] -> [2. Phục hồi] -> [3. Rà soát] -> [4. Dịch] -> [5. Xuất]
~~~

### 13.2. Nguồn

Card nguồn hiển thị video, SRT, số cue, thời lượng và trạng thái khớp timestamp. Card Gemini giữ cơ chế key hiện tại.

### 13.3. Video review

Renderer dùng pattern video local hiện có qua `tediapros://b64/...`. Nút xem cue seek tới `max(0, cueStart - 1.5s)` và tự dừng ở `cueEnd + 2s`; người dùng vẫn có thể phát/seek thủ công. Không gửi local path trực tiếp tới web origin hoặc đưa path vào Gemini logs.

### 13.4. Review card

Mỗi unresolved cue có candidate tiếng Việt dạng radio, confidence, evidence và visual context. Chinese details nằm trong disclosure đóng mặc định. Có bộ đếm cue còn lại; nút tiếp tục bị khóa tới khi hết unresolved.

### 13.5. Locale selector

Preset hiển thị language, country và currency. Target tùy chỉnh có language input, country/locale selector và currency selector. UI hiển thị ngày tỷ giá và attribution khi conversion khả dụng.

### 13.6. Preview/export

Giữ tabs target, preview read-only, export-one/export-all và partial success hiện tại. Mỗi tab hiển thị locale, currency/rate status và lỗi riêng.

## 14. State machine, retry và cancel

### 14.1. Validation trước mạng

Không upload nếu:

- video/SRT không tồn tại hoặc không đọc được;
- MIME/extension video không được hỗ trợ;
- SRT không có cue;
- timestamp cuối vượt thời lượng video quá 2 giây;
- API key thiếu;
- source fingerprint đã thay đổi.

### 14.2. Retry

- Network, `429` và `5xx`: tối đa 3 lần gọi cho mỗi request, chờ 1 giây rồi 2 giây cộng jitter 0–250 ms; nếu server trả `Retry-After` hợp lệ thì ưu tiên giá trị đó nhưng không chờ quá 30 giây.
- Uploaded file đã `ACTIVE`: retry dùng lại URI.
- Poll trạng thái file tối đa 20 phút; timeout chuyển job sang lỗi có thể retry và vẫn cleanup.
- JSON sai schema hoặc cue count mismatch: yêu cầu regenerate đúng schema một lần; nếu vẫn sai, fail stage.
- Không retry vô hạn và không nhảy model sau cancel.

### 14.3. Cancel

- `cancel` đặt cờ job và abort request đang chạy.
- Hủy trong restoration/audit: bỏ canonical result dở dang.
- Hủy trong translation: giữ target đã hoàn thành, dừng target còn lại.
- Sau cancel luôn cleanup remote file và active job.

### 14.4. Cleanup

Cleanup idempotent chạy trong `finally` và khi `release`:

- abort pending request;
- xóa file Gemini nếu đã có remote name;
- xóa temp files nếu có;
- clear remote identifiers;
- release active job.

Delete từ xa được thử tối đa 2 lần trong cleanup. App cố cleanup khi đóng; nếu crash hoặc cả hai lần delete thất bại, Files API tự hết hạn file sau 48 giờ và UI chỉ hiển thị cảnh báo đã làm sạch, không lộ remote identifier.

### 14.5. Fallback

- Không tự động rơi xuống text-only khi video verification lỗi.
- UI có nút retry và một hành động riêng `Tiếp tục chỉ với SRT`. Hành động text-only cần hộp xác nhận nêu rõ không kiểm chứng được âm thanh/hình ảnh; mọi kết quả của nhánh này có badge `Chưa kiểm chứng bằng video`, và file export thêm hậu tố `_unverified` trước `.srt`.
- Tỷ giá lỗi không làm fail translation; nó chỉ tắt currency conversion và giữ source currency.

## 15. Quyền riêng tư và logging

- Gemini key tiếp tục lưu bằng Electron `safeStorage`.
- Không gửi key, URI upload hoặc raw payload sang renderer.
- Không ghi API key, source/video content, file URI hoặc full Gemini response vào log.
- Log chỉ chứa job phase, số cue/target, percent và lỗi đã chuẩn hóa.
- Canonical source và translation chỉ tồn tại trong memory của phiên/tab.
- Không lưu chúng vào localStorage hoặc tài liệu project.
- Video local không bị copy nếu upload có thể stream trực tiếp từ source.
- Remote file được xóa ở mọi terminal path.

## 16. Kiểm thử

### 16.1. Unit tests

- Prompt restoration có ASR, homophone, dialect/slang, evidence và anti-hallucination rules.
- Prompt audit kiểm tra changed/uncertain cue và không auto-accept low confidence.
- Locale prompts Việt, Indonesia, Nhật, Thái, Hàn, Anh và generic fallback.
- Locale tùy chỉnh thiếu country hoặc currency ISO 4217 hợp lệ bị từ chối.
- Rate conversion dùng snapshot injected, đúng công thức và rounding policy.
- Unit conversion dùng bảng/hàm injected, đúng công thức và rounding policy theo locale.
- Gemini không được nhận yêu cầu tự đoán rate.
- Validator từ chối missing/duplicate/out-of-range cue, timestamp thay đổi và confidence sai.
- Review state chỉ complete khi mọi unresolved cue có selection hợp lệ.
- Đổi fingerprint invalidate canonical source/translations.
- Cancel transitions đúng theo stage.
- Cleanup idempotent và chạy đúng một lần.
- Partial target success được giữ.

### 16.2. Integration tests với fake transports

Mô phỏng:

~~~text
upload -> processing -> active
-> restoration -> audit -> translation -> delete
~~~

Bao phủ upload fail, timeout, `429`, `503`, processing failed, invalid JSON, schema retry, audit fail, cancel mỗi stage, delete fail, rate unavailable và target partial failure.

Fake transports phải cho phép assert:

- video chỉ upload một lần;
- cùng file URI được tái sử dụng;
- delete được gọi trên success/error/cancel;
- API key/URI/content không lọt vào log;
- không gọi translation khi canonical source unresolved.

### 16.3. Renderer model/style tests

- Stepper và button gate theo state.
- Review counter và candidate selection.
- Video seek dùng đúng timestamp.
- Progress không giảm trong cùng phase.
- Scroll vẫn hoạt động khi danh sách review dài.
- Target locale chips và rate warning hiển thị đúng.

### 16.4. Real Gemini smoke test

Lệnh riêng, không nằm trong unit suite mặc định, dùng video Trung ngắn có:

- lỗi ASR đồng âm cố ý;
- đối tượng cần hình ảnh để xác định tên loài;
- slang hoặc cách nói địa phương;
- tiền tệ/đơn vị;
- ít nhất bốn target Việt, Nhật, Thái, Indonesia.

Sau job phải kiểm tra remote file đã bị xóa.

## 17. Tiêu chí nghiệm thu

### 17.1. Cấu trúc

- 100% cue count được giữ.
- 100% timestamp giống từng ký tự với SRT gốc.
- Không gộp/tách cue.
- Nhãn speaker không đổi.
- Mọi target dùng cùng canonical source.
- Không dịch khi còn unresolved cue.
- Target failure không xóa target thành công.

### 17.2. Source restoration

- Gemini dùng audio + image + timestamp, không chỉ text.
- Cue sửa có evidence/confidence.
- Pass 2 audit mọi cue changed/uncertain.
- Taxonomy mơ hồ không bị ép thành tên loài cụ thể.
- Người dùng có thể giải quyết mọi ambiguity bằng tiếng Việt và video.

### 17.3. Localization

- Việt, Nhật, Thái, Indonesia đạt tối thiểu 9/10 theo rubric: đúng nghĩa, tự nhiên bản địa, hợp Shorts, thuật ngữ/tên loài và voice-over cadence.
- Tiền local đứng trước và tiền nguồn trong ngoặc khi rate hợp lệ.
- Rate unavailable không tạo số giả.
- Units, proper names và domain terms theo locale mà không thay facts.

### 17.4. Vận hành

- Cancel hoạt động ở upload, restoration, audit và translation.
- Cleanup chạy trên success/error/cancel.
- Không có secret/media URI/raw response trong log.
- Unit/integration tests, typecheck Node/Web, architecture check và Electron production build đều pass.
- Thực hiện manual flow chọn nguồn -> phục hồi -> review -> dịch -> xuất trên app thật.

## 18. File dự kiến thay đổi

Danh sách chính để implementation plan phân rã:

~~~text
src/shared/features/srt-translator.ts
src/main/features/srt-translator.ts
src/main/services/srt-translator-job.ts
src/main/services/gemini-files.ts
src/main/services/srt-source-restoration.ts
src/main/services/srt-source-audit.ts
src/main/services/srt-localization.ts
src/main/services/srt-locale-profiles.ts
src/main/services/exchange-rates.ts
src/main/services/measurement-conversion.ts
src/preload/features/srt-translator.ts
src/renderer/src/features/srt-translator/index.tsx
src/renderer/src/features/srt-translator/model.ts
src/renderer/src/features/srt-translator/styles.css
src/shared/types.ts
src/main/gemini.ts
package.json
tests/
docs/
~~~

Implementation plan dùng các tên module trên. Nếu codebase buộc phải đổi tên do xung đột có sẵn, plan phải ghi mapping một-một; các ranh giới job controller, Files adapter, restoration/audit, locale profile và exchange-rate provider không được gộp lại thành một file lớn.

## 19. Tương thích và migration

- `translateSrt` và các IPC core cũ giữ signature/hành vi.
- OpenAI không nhận prompt multimodal mới.
- Existing export format và collision avoidance giữ nguyên.
- Thêm `SrtLocaleTarget` làm contract mới cho feature nâng cấp. Giữ `SrtTargetLanguage` cho API cũ và cung cấp adapter một chiều từ preset cũ sang `SrtLocaleTarget`; không đổi signature của caller hiện hữu.
- Renderer state cũ chỉ được migrate trong memory; không có persisted state cần chuyển đổi.
- Architecture registry vẫn dùng namespace `srt-translator`, không thêm handler feature vào core.

## 20. Tài liệu tham khảo

- Gemini video understanding: https://ai.google.dev/gemini-api/docs/video-understanding
- Gemini audio understanding: https://ai.google.dev/gemini-api/docs/audio
- Gemini Files API và delete/48-hour expiry: https://ai.google.dev/gemini-api/docs/files
- Gemini structured output: https://ai.google.dev/gemini-api/docs/structured-output
- ExchangeRate-API open endpoint: https://www.exchangerate-api.com/docs/free
- ExchangeRate-API supported currencies: https://www.exchangerate-api.com/docs/supported-currencies
