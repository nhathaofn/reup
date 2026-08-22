# Content Blocks V1

Content Blocks là tab mới cho workflow **manifest-first**: phân tích source thành các block có thể review, nhập voice theo cue ID, tạo variant deterministic, dựng timeline riêng cho từng locale rồi xuất draft CapCut qua adapter. V1 không render MP4, không gọi AI, không freeze/loop và không thay đổi workflow legacy.

## 1. Hai chế độ timing

| Chế độ | Tab sở hữu | Ý nghĩa |
| --- | --- | --- |
| `preserve-source-timeline` | `CapCut Factory` | Giữ cửa sổ SRT source và map voice theo thứ tự tự nhiên; phù hợp workflow cũ. |
| `block-render-timeline` | `Khối nội dung` | Dùng block order của variant, voice duration của từng locale làm master và sinh SRT mới. |

Hai chế độ độc lập. Content Blocks không chèn grouping/shuffle vào `capCutFactory.ts`; CapCut Factory cũng không đọc artifact block.

## 2. Artifact tree và fingerprint gates

Một project Content Block điển hình:

```text
<project>/
├─ analysis/source-blocks.json             # SourceBlockManifest
├─ locales/<locale>/assets.json            # LocaleAssetManifest
├─ variants/<variant-id>.json              # VariantPlan
├─ timelines/<variant-id>.<locale>.json    # RenderTimeline
└─ exports/subtitles/<variant-id>.<locale>.srt

<drafts>/<project-name>/
├─ draft_content.json
├─ tblao-content-blocks.json               # provenance: order + artifact paths
├─ tblao-portable.json                     # portable asset manifest
└─ assets/{video,audio}/                   # asset copy đã deduplicate
```

Quan hệ bắt buộc:

1. `SourceBlockManifest.source.fingerprint` nhận diện video source và `revision` tăng khi merge/split/boundary/semantic edit.
2. `LocaleAssetManifest.sourceManifestFingerprint` phải bằng fingerprint của source manifest; tất cả cue ID phải khớp đúng một lần.
3. `VariantPlan.sourceManifestFingerprint` phải bằng source fingerprint; `blockOrder` phải chứa mỗi block đúng một lần.
4. `RenderTimeline.sourceManifestFingerprint` phải bằng source fingerprint, `variantId` phải khớp variant, các block/cue phải liên tục và `reviewBlockIds` phải đúng với adaptation `needs-review`.

Workflow export re-hash video source, đọc lại bốn artifact và từ chối stale fingerprint trước khi ghi draft.

## 3. Nhập voice theo cue ID

Tên file có thể dùng stem cue ID (`cue-001.wav`) hoặc khai báo map rõ ràng:

```json
{
  "cue-001": "question-01.wav",
  "cue-002": "answer-01.wav"
}
```

Lưu map tại `voice-map.json` rồi chọn trong ô `Voice map (tùy chọn)`. Import kiểm tra SRT locale, voice file, duration qua FFprobe và báo riêng `missingCueIds`, `invalidCueIds`, `extraFiles`. Import lỗi không xóa locale đã nhập trước đó; nhập lại chỉ thay locale cùng mã.

## 4. Grouping và review boundary

- Cue có dấu hiệu là câu hỏi sẽ mở một block; mọi cue tiếp theo được giữ trong block đó cho tới trước câu hỏi kế tiếp. Cue thứ nhất nhận role `question`, cue thứ hai nhận `answer`, các cue còn lại nhận `statement` để giữ các dòng tiếp diễn như tiền lương.
- Nếu một block chỉ có câu hỏi mà chưa có câu trả lời, block được đánh dấu `odd-unpaired-cue`. Nếu source không có anchor câu hỏi đủ tin cậy, các cue liên quan được giữ nguyên trong một block `grouping-review`, tắt `shuffleEligible` và buộc review thủ công.
- `scene-splitter.json` được ưu tiên để chọn boundary gần SRT; nếu không đủ thì dùng SRT fallback và gắn `srt-fallback`.
- `Merge` gộp hai block liền kề; `Split` tách sau cue được chọn.
- Boundary editor dùng integer microseconds trong artifact; UI chỉ hiển thị giây. Khóa boundary tạo trạng thái `locked`.
- `set-semantic` là thao tác chấp nhận có chủ đích cho block cần review/role/dependency; không tự động làm mất cảnh báo boundary hoặc các cảnh báo khác.

Không tiếp tục sang locale/variant khi boundary còn `needs-review`, `odd-unpaired-cue`, `grouping-review` hoặc `srt-fallback` chưa được xử lý. V1 dùng heuristic deterministic; AI reviewer chỉ nên là lớp đề xuất tùy chọn, không được tự ghi đè manifest.

## 5. Chính sách speed

| Khoảng speed video | `adaptation` | Export |
| --- | --- | --- |
| `0.92 ≤ speed ≤ 1.08` | `stretch-within-soft-limit` | Cho phép, không cảnh báo. |
| `0.90 ≤ speed < 0.92` hoặc `1.08 < speed ≤ 1.12` | `stretch-with-warning` | Cho phép, phải hiển thị cảnh báo. |
| `speed < 0.90` hoặc `speed > 1.12` | `needs-review` | Chặn export cho tới khi xử lý. |

V1 không trim voice và không speed voice. Voice duration là master của target block; video source được speed trong CapCut adapter để khớp tổng target duration. Nếu muốn giữ video tự nhiên, cần sửa grouping/voice hoặc loại block khỏi variant.

## 6. Variant deterministic

Variant lưu `variantId`, `seed`, `blockOrder` và constraints:

- `lockedStartBlockIds` giữ intro ở đầu;
- `lockedEndBlockIds` giữ outro/CTA ở cuối;
- `preserveDependencyChains: true` giữ block có dependency sau block được yêu cầu.

Cùng source manifest, constraints và seed sẽ cho cùng `blockOrder`. V1 chỉ hỗ trợ dependency chain tuyến tính đã khai báo; không tự suy luận quan hệ nội dung, không trộn intro/outro/CTA vào phần shuffle tự do.

## 7. CapCut adapter và portability

`capCutBlockAdapter.ts` là biên duy nhất giữa `RenderTimeline` trung lập và `nativeCapCutGenerator.ts`. Adapter tạo một video segment cho mỗi block, một audio segment và một subtitle segment cho mỗi cue; asset trùng path được copy một lần vào `assets/video` hoặc `assets/audio`.

Template CapCut phải là project mẫu do chính phiên bản CapCut hiện tại tạo, có tối thiểu video, voice và subtitle segment để lấy schema/style. Hãy đóng CapCut trước khi export. Generator không ghi đè project có sẵn và phát hiện draft đang mở.

`tblao-content-blocks.json` là provenance bắt buộc về source/locale/timeline path, fingerprint, locale, variant và block order. `tblao-portable.json` ghi asset files để hỗ trợ di chuyển draft.

## 8. Troubleshooting

| Triệu chứng | Cách xử lý |
| --- | --- |
| Stale fingerprint | Phân tích lại đúng video source; không sửa tay fingerprint trong artifact. |
| Missing voice | Kiểm tra cue ID trong SRT, tên stem hoặc `voice-map.json`; import lại sau khi bổ sung file. |
| Fallback boundary | Mở Review block, merge/split hoặc chỉnh boundary rồi khóa boundary hợp lệ. |
| Grouping review | Kiểm tra cue đầu block và dùng `set-semantic`, merge/split hoặc chỉnh source grouping trước khi cho phép shuffle. |
| Hard speed | Xem speed/adaptation trong Timeline; chỉnh grouping, voice hoặc loại block khỏi variant. `needs-review` không được export. |
| Draft đang mở / project đã tồn tại | Đóng CapCut, đổi project name hoặc xóa project tạo dở theo quy trình vận hành của bạn; ứng dụng không tự xóa project cũ. |

## 9. Real smoke config

Smoke chỉ ghi vào project test riêng, không dùng CapCut default store:

```json
{
  "projectDir": "F:\\content-block-smoke",
  "videoPath": "F:\\content-block-smoke\\fixtures\\source.mp4",
  "sourceSrtPath": "F:\\content-block-smoke\\fixtures\\source.srt",
  "sceneManifestPath": "F:\\content-block-smoke\\fixtures\\scene-splitter.json",
  "templateDir": "F:\\content-block-smoke\\fixtures\\capcut-template",
  "draftsDir": "F:\\content-block-smoke\\smoke-drafts",
  "locales": [
    { "locale": "vi-VN", "localizedSrtPath": "F:\\content-block-smoke\\fixtures\\vi.srt", "voiceDir": "F:\\content-block-smoke\\fixtures\\vi-voice" },
    { "locale": "th-TH", "localizedSrtPath": "F:\\content-block-smoke\\fixtures\\th.srt", "voiceDir": "F:\\content-block-smoke\\fixtures\\th-voice" }
  ]
}
```

Chạy khi đã có fixture được duyệt:

```powershell
$env:RUN_CONTENT_BLOCK_CAPCUT_SMOKE='1'
$env:CONTENT_BLOCK_SMOKE_CONFIG='F:\\content-block-smoke\\smoke-config.json'
npm.cmd run test:smoke:content-blocks
```

Test bắt buộc `draftsDir` là thư mục con có basename `smoke-drafts`, có ít nhất hai locale và source phân tích được ít nhất ba block.

## 10. Human QA metrics

Với mỗi source/locale, ghi lại:

- tổng block và số block phải regroup thủ công;
- tổng boundary và số `srt-fallback`;
- số soft/hard speed warning theo locale;
- số Q/A mismatch sau shuffle;
- số lỗi lệch media/voice/subtitle nhìn hoặc nghe được;
- phiên bản CapCut và template đã dùng.

Release gate: không missing/duplicate cue, không content mismatch, không SRT ngoài timeline, và mọi hard-speed case phải được xử lý hoặc loại khỏi export một cách rõ ràng.

## 11. Rights và policy

Shuffle block chỉ là thao tác biên tập. Nó không chứng minh tính nguyên bản, không cấp quyền sử dụng source media và không miễn trừ nghĩa vụ tuân thủ chính sách reused-content/copyright của nền tảng. Người vận hành phải tự xác nhận quyền sử dụng source, voice và template.
