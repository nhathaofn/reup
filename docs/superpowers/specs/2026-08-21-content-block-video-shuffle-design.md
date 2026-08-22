# Thiết kế Content Block và xáo trộn video đa ngôn ngữ

**Ngày:** 2026-08-21

**Trạng thái:** Đề xuất để duyệt

**Phạm vi:** Phân tích video/SRT thành block nội dung, tạo biến thể xáo trộn, dựng timeline riêng cho từng ngôn ngữ và xuất project CapCut.

**Quyết định chính:** Core phải `manifest-first`, độc lập renderer; CapCut là adapter đầu tiên, không phải nền móng của hệ thống.

## 1. Mục tiêu

Dự án cần xử lý nhiều video cho nhiều thị trường. Mỗi bản đầu ra có:

- media gồm nhiều cảnh;
- lời thoại và subtitle;
- voice khác nhau theo ngôn ngữ;
- thứ tự các đoạn nội dung có thể được xáo trộn;
- hình, voice và subtitle luôn nói về cùng một nội dung;
- timeline cuối được tính lại thay vì giữ timestamp nguồn.

Mục tiêu kỹ thuật là biến mỗi đơn vị nội dung thành một block nguyên tử có ID ổn định. Mọi thao tác xáo trộn chỉ thay đổi thứ tự block; không xáo trộn riêng media, subtitle hoặc voice.

## 2. Kết luận tổng quát

Không nên cắt độc lập theo SRT, voice hoặc scene detection.

Mô hình hợp lý là:

```text
SRT xác định vùng nội dung dự kiến
Scene và silence cung cấp ứng viên điểm cắt
Grouping rule xác định block ngữ nghĩa
Boundary Resolver chọn ranh giới kỹ thuật
Voice xác định thời lượng bản render theo từng locale
SRT cuối được sinh lại từ timeline render
```

Đơn vị xử lý trung tâm là `Content Block`:

```text
CONTENT BLOCK
├── ID ổn định
├── source video fingerprint
├── source range
├── dialogue/cue membership
├── boundary evidence
├── semantic constraints
└── trạng thái review
```

Voice, bản dịch và timeline theo ngôn ngữ không được nhúng trực tiếp vào source block. Chúng được lưu trong các manifest riêng để source analysis không bị vô hiệu khi thay voice hoặc thêm locale.

## 3. Tổng hợp các ý tưởng từ cuộc trao đổi

### 3.1. Không cắt theo từng dòng SRT

Một dòng SRT thường chỉ là một phần câu hoặc một nửa hội thoại. Với video dạng hỏi–đáp, đơn vị nhỏ nhất nên là toàn bộ cặp câu hỏi và câu trả lời.

Ví dụ:

```text
Block 001
  Question: Đây là cây mọng nước gì vậy?
  Answer:   Đây là Conophytum môi đỏ.
  Source:   00:00.000 → 00:03.800
```

Cắt từng cue sẽ tạo nguy cơ câu hỏi và câu trả lời bị xáo trộn độc lập hoặc hình chuyển sang sản phẩm khác giữa hội thoại.

### 3.2. Scene detection chỉ là evidence

Scene detection hữu ích để tìm điểm đổi hình thật, nhưng không hiểu ngữ nghĩa. Zoom, flash, thay góc máy hoặc transition có thể bị nhận thành scene mới; ngược lại một cảnh dài có thể chứa nhiều nội dung.

Vì vậy scene không tự quyết định block. Nó chỉ cung cấp boundary candidate gần mốc nội dung do SRT gợi ý.

### 3.3. Voice chỉ làm master ở bước render locale

Voice tiếng Việt, Thái, Nhật hoặc Indonesia có duration khác nhau. Một thứ tự block có thể dùng chung cho các locale, nhưng mỗi locale phải có timeline riêng.

```text
Variant order chung
├── Timeline vi-VN theo voice vi-VN
├── Timeline th-TH theo voice th-TH
├── Timeline ja-JP theo voice ja-JP
└── Timeline id-ID theo voice id-ID
```

Không tồn tại một bộ timestamp cuối dùng chung cho mọi locale.

### 3.4. SRT cuối là output

Sau khi shuffle, timestamp nguồn không còn ý nghĩa trên timeline mới. Hệ thống phải tạo timeline mới, sau đó sinh SRT theo timeline đó.

```text
block order
  → duration voice thực tế
  → duration block render
  → cumulative timeline
  → subtitle start/end mới
  → SRT mới
```

### 3.5. Voice theo cue, media theo block

Media thuộc block, nhưng voice nên giữ theo từng cue trong block. Với block hỏi–đáp:

```text
question voice
  + configurable gap
  + answer voice
```

Cách này cho phép căn thời lượng và subtitle chính xác hơn một file voice đã ghép sẵn.

### 3.6. Điều chỉnh media theo voice

Không nên cắt voice để ép vào timestamp nguồn. Media được điều chỉnh có giới hạn:

- vùng mềm: `0.92x–1.08x`;
- vùng cứng: `0.90x–1.12x`, phải có cảnh báo;
- ngoài vùng cứng: không tự động kéo tốc độ trong V1, đưa block vào `needs-review`.

Freeze, loop hoặc B-roll là chiến lược tương lai. Chúng không thuộc V1 vì dễ tạo hình ảnh bất thường, đặc biệt khi có người nói hoặc chuyển động rõ.

### 3.7. Grouping cần nhiều profile

Ba kiểu grouping được xác định:

- `pair`: hai cue liên tiếp tạo thành một block hỏi–đáp;
- `pattern`: nhận diện câu mở đầu lặp lại để bắt đầu block mới;
- `manual`: người dùng gán cue vào block.

V1 chỉ triển khai `pair` và manual correction. `pattern` và AI classification thuộc giai đoạn sau.

### 3.8. Shuffle phải dùng block ID

Variant không lưu source timestamp. Nó chỉ lưu thứ tự block ID cùng seed và constraint.

```json
{
  "variantId": "variant-001",
  "seed": "392831",
  "blockOrder": ["block-004", "block-001", "block-005", "block-002"]
}
```

Cùng một `blockOrder` có thể được dựng thành nhiều timeline locale khác nhau.

## 4. Hiện trạng dự án

Dự án đã có phần lớn hạ tầng cần thiết nhưng chưa có domain `Content Block`.

| Module hiện tại | Khả năng có sẵn | Khoảng trống |
| --- | --- | --- |
| `src/main/services/sceneSplitter.ts` | PySceneDetect, cắt scene, tạo `scene-splitter.json` | Scene đang là clip trực tiếp, chưa phải boundary candidate của semantic block |
| `src/main/services/voiceSync.ts` | Đọc SRT, ánh xạ voice 1:1 theo thứ tự file, FFprobe duration | SRT đang làm timeline; mapping theo thứ tự tên file dễ vỡ |
| `src/main/services/capCutFactory.ts` | Neo cue vào scene, tạo scene links, dựng draft CapCut | Chưa có block catalog, variant plan hoặc timeline theo locale |
| `src/main/services/nativeCapCutGenerator.ts` | Hỗ trợ video segment có `sourceStartSeconds` | Chưa được dùng làm adapter cho source block range |
| `src/main/services/srt-localization.ts` | Bản địa hóa SRT nhiều locale | Prompt hiện yêu cầu giữ nguyên cue window nguồn |
| `src/main/services/subtitle-pipeline.ts` | ASR/OCR/evidence và provenance | Chưa cần cho V1; có thể dùng cho video khó ở giai đoạn sau |
| `src/renderer/src/features/capcut-factory/` | UI video + scene + nhiều bộ SRT/voice | Chưa có bước analyze/review/shuffle |

### 4.1. Điểm đã phù hợp

- Scene splitter đã tạo manifest có source path, start, end và duration.
- CapCut Factory đã giữ voice nguyên vẹn khi cue đi qua scene boundary.
- Voice Sync đã đo duration audio thật bằng FFprobe.
- Native CapCut Generator đã hỗ trợ source range, nên không cần cắt vật lý mọi block trước.
- Feature architecture hiện dùng vertical slice Shared/Main/Preload/Renderer, phù hợp để thêm subsystem mới.

### 4.2. Điểm đang xung đột với thiết kế mới

- `CapCut Factory` lấy SRT làm timeline chính và thay đổi speed voice để vừa cue.
- `Voice Sync` yêu cầu số voice khớp 1:1 và dựa vào natural file ordering.
- `SRT localization` yêu cầu giữ nguyên cửa sổ thời gian nguồn.
- Chưa có test chuyên biệt cho scene splitter, voice timeline, CapCut Factory, block shuffle hoặc boundary resolver.

Không được thay đổi hành vi hiện tại trên toàn ứng dụng. Hệ thống cần hai timing mode tách biệt:

```text
preserve-source-timeline
  Giữ workflow CapCut/SRT hiện tại để tương thích ngược.

block-render-timeline
  Voice quyết định duration locale; SRT được sinh lại.
```

## 5. Phản biện các giả định ban đầu

### 5.1. `Scene = Content` là quá tuyệt đối

Một nội dung có thể gồm nhiều cú máy, và một cảnh có thể chứa nhiều ý. Quyết định đúng là:

```text
Scene = visual boundary candidate
Content Block = semantic grouping + selected boundaries
```

### 5.2. `Voice = Timeline` chỉ đúng theo locale

Source analysis vẫn cần timeline nguồn. Voice chỉ trở thành master sau khi locale asset đã tồn tại. Vì vậy source block không chứa timestamp render cuối.

### 5.3. `Scene > Silence > SRT` không đủ an toàn

Scene cut hoặc silence có thể nằm giữa câu. Boundary Resolver phải áp dụng hard constraints trước khi chấm điểm ứng viên.

### 5.4. Q+A không phải data model tổng quát

Pair Q+A là profile phù hợp video mẫu, không phải định nghĩa của block. Data model phải hỗ trợ một hoặc nhiều cue với role tùy chọn.

### 5.5. Shuffle thuần ngẫu nhiên phá mạch nội dung

Block có thể chứa intro, outro, CTA, đại từ phụ thuộc, số thứ tự hoặc câu nối tiếp. Variant Planner phải hỗ trợ block cố định và dependency, không chỉ random permutation.

### 5.6. Cắt MP4 block quá sớm gây lãng phí

Materialize media ngay sau analyze sẽ:

- tốn dung lượng;
- re-encode nhiều lần;
- làm boundary edit trở nên chậm;
- tạo asset lỗi thời khi source hoặc manifest thay đổi.

Source range phải là canonical. Media chỉ được cắt/copy khi adapter xuất cần nó.

### 5.7. Numeric confidence dễ gây chính xác giả

Không xuất `confidence: 0.96` trong V1 nếu chưa có tập dữ liệu hiệu chỉnh. V1 dùng reason code và review state:

```text
exact-scene-match
scene-near-srt
srt-fallback
manual-adjusted
needs-review
```

### 5.8. CapCut không nên trở thành core

CapCut draft schema không phải API công khai và có thể thay đổi. Domain block, variant và timeline phải kiểm thử được mà không cần CapCut. CapCut Factory chỉ chuyển `RenderTimeline` thành draft.

### 5.9. Shuffle không giải quyết quyền nội dung

Đảo thứ tự block không tự động biến nguồn thành nội dung nguyên bản và không đảm bảo vượt kiểm tra reused-content. Vận hành vẫn phải tuân thủ quyền sử dụng nguồn và chính sách nền tảng.

## 6. Kiến trúc đã chỉnh

```text
Source Video + Source SRT
          │
          ├── Existing Scene Manifest
          │
          ▼
┌────────────────────────────┐
│ Content Block Analyzer     │
│ - parse cues               │
│ - pair grouping            │
│ - collect candidates       │
│ - resolve boundaries       │
└─────────────┬──────────────┘
              ▼
      SourceBlockManifest
              │
              ├── Review / manual correction
              │
              ├── LocaleAssetManifest vi-VN
              ├── LocaleAssetManifest th-TH
              └── LocaleAssetManifest ja-JP
              │
              ▼
        Variant Planner
              │
              ▼
          VariantPlan
              │
              ▼
        Timeline Builder
              │
              ├── RenderTimeline vi-VN
              ├── RenderTimeline th-TH
              └── RenderTimeline ja-JP
              │
              ▼
         Export Adapters
              ├── CapCut adapter — V1
              └── FFmpeg renderer — tương lai
```

## 7. Trách nhiệm các thành phần

### 7.1. Content Block Analyzer

Nhận video fingerprint, SRT cues và scene candidates. Kết quả chỉ là manifest; không cắt media.

### 7.2. Dialogue Grouper

Gán cue vào block. V1 cung cấp:

- `pair` profile;
- manual merge/split;
- block role gồm `normal`, `intro`, `outro`, `cta`;
- cờ `shuffleEligible`.

### 7.3. Boundary Resolver

Tìm source range cho block bằng candidate generation, hard constraints và ranking.

### 7.4. Manifest Store

Đọc, validate và ghi manifest theo schema version. Manifest lưu fingerprint nguồn và revision để phát hiện source thay đổi.

### 7.5. Locale Asset Importer

Ánh xạ voice bằng cue ID rõ ràng, không dựa duy nhất vào thứ tự tự nhiên của file. Nó đo duration và báo file thiếu/dư/lỗi.

### 7.6. Variant Planner

Tạo block order xác định bởi seed và constraint. Variant không chứa timestamp render.

### 7.7. Timeline Builder

Kết hợp source blocks, locale assets và variant plan để tạo timeline locale, subtitle cues mới và media adaptation decision.

### 7.8. CapCut Adapter

Chuyển timeline trung lập thành `NativeCapCutVideoItem`, `NativeCapCutAudioItem` và `NativeCapCutTextItem`. Adapter tái sử dụng source ranges và generator hiện tại.

## 8. Mô hình dữ liệu

### 8.1. SourceBlockManifest

```json
{
  "schemaVersion": 1,
  "source": {
    "path": "source/video.mp4",
    "fingerprint": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "durationUs": 7333000,
    "fps": 30
  },
  "revision": 1,
  "blocks": [
    {
      "id": "block-01K3M0Y7J65M8YJ4S2J72XKQK5",
      "sourceRange": {
        "startUs": 0,
        "endUs": 3800000
      },
      "cueIds": ["cue-001", "cue-002"],
      "dialogue": [
        {
          "cueId": "cue-001",
          "role": "question",
          "text": "Đây là cây mọng nước gì vậy?",
          "sourceStartUs": 0,
          "sourceEndUs": 1080000
        },
        {
          "cueId": "cue-002",
          "role": "answer",
          "text": "Đây là Conophytum môi đỏ.",
          "sourceStartUs": 1080000,
          "sourceEndUs": 3560000
        }
      ],
      "boundary": {
        "targetUs": 3560000,
        "selectedUs": 3800000,
        "reason": "scene-near-srt",
        "reviewState": "accepted"
      },
      "semantic": {
        "role": "normal",
        "shuffleEligible": true,
        "requiresPreviousBlockId": null
      }
    }
  ]
}
```

Block ID được tạo một lần và lưu bền vững; không suy ra từ vị trí `scene_001`, vì re-analysis có thể thay đổi thứ tự scene.

Fingerprint video V1 là SHA-256 của toàn bộ file nguồn, được tính theo stream. Fingerprint của source manifest là SHA-256 của JSON canonical UTF-8 với key được sắp xếp ổn định và không chứa trường thời gian sinh file.

### 8.2. LocaleAssetManifest

```json
{
  "schemaVersion": 1,
  "sourceManifestFingerprint": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "locale": "th-TH",
  "blocks": {
    "block-01K3M0Y7J65M8YJ4S2J72XKQK5": {
      "cues": [
        {
          "cueId": "cue-001",
          "text": "ข้อความคำถามภาษาไทย",
          "voicePath": "voices/th-TH/cue-001.wav",
          "voiceDurationUs": 1300000
        },
        {
          "cueId": "cue-002",
          "text": "ข้อความคำตอบภาษาไทย",
          "voicePath": "voices/th-TH/cue-002.wav",
          "voiceDurationUs": 2500000
        }
      ]
    }
  }
}
```

### 8.3. VariantPlan

```json
{
  "schemaVersion": 1,
  "variantId": "variant-001",
  "sourceManifestFingerprint": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "seed": "392831",
  "blockOrder": [
    "block-004",
    "block-001",
    "block-005",
    "block-002"
  ],
  "constraints": {
    "lockedStartBlockIds": ["block-intro"],
    "lockedEndBlockIds": ["block-outro"],
    "preserveDependencyChains": true
  }
}
```

### 8.4. RenderTimeline

```json
{
  "schemaVersion": 1,
  "variantId": "variant-001",
  "locale": "th-TH",
  "durationUs": 3900000,
  "items": [
    {
      "blockId": "block-01K3M0Y7J65M8YJ4S2J72XKQK5",
      "timelineStartUs": 0,
      "timelineEndUs": 3900000,
      "sourceStartUs": 0,
      "sourceEndUs": 3800000,
      "mediaSpeed": 0.9744,
      "adaptation": "stretch-within-soft-limit",
      "subtitleCues": [
        {
          "cueId": "cue-001",
          "startUs": 0,
          "endUs": 1300000,
          "text": "ข้อความคำถาม"
        },
        {
          "cueId": "cue-002",
          "startUs": 1400000,
          "endUs": 3900000,
          "text": "ข้อความคำตอบ"
        }
      ]
    }
  ]
}
```

Tất cả thời gian canonical được lưu bằng integer microseconds. Giá trị giây chỉ dùng cho UI.

## 9. Boundary Resolver

### 9.1. Target boundary

Với `pair` profile, target mặc định là cuối cue answer.

### 9.2. Candidate window

V1 tìm visual boundary trong `±500 ms` quanh target. Giá trị này là cấu hình project, không phải hằng số domain.

### 9.3. Hard constraints

Candidate bị loại nếu:

- nằm trong khoảng phát âm của cue thuộc block;
- chia đôi một cue;
- làm source range chồng block kế tiếp;
- tạo block ngắn hơn minimum duration;
- vượt maximum snap distance;
- vi phạm boundary đã được user khóa.

### 9.4. Ranking

Các candidate còn lại được xếp hạng dựa trên:

- khoảng cách đến target;
- scene evidence;
- khoảng im lặng nếu feature này được bật trong tương lai;
- tính liên tục với boundary trước;
- pre-roll/post-roll hợp lệ.

### 9.5. Fallback

Nếu không có visual candidate hợp lệ, V1 dùng `SRT end + configurable padding` và đánh dấu `srt-fallback`. Block fallback xuất hiện trong danh sách review.

### 9.6. Pre-roll và post-roll

- pre-roll mặc định: `0–100 ms` nếu không lấn block trước;
- post-roll mặc định: `100 ms` nếu không vượt selected boundary;
- mọi điều chỉnh phải giữ các block liên tiếp không overlap.

## 10. Tạo timeline theo locale

### 10.1. Duration block

V1 tính target duration từ:

```text
pre-roll
+ tổng voice cue duration
+ gap giữa các cue
+ post-roll
```

Gap Q/A mặc định là `100 ms`, có thể cấu hình theo locale/project.

### 10.2. Media adaptation

```text
requiredMediaSpeed = sourceMediaDuration / targetBlockDuration
```

Policy V1:

- trong `0.92–1.08`: tự động chấp nhận;
- ngoài vùng mềm nhưng trong `0.90–1.12`: cho phép và cảnh báo;
- ngoài `0.90–1.12`: block `needs-review`, không tự freeze/loop;
- voice không bị trim;
- không thay đổi tốc độ voice trong `block-render-timeline`.

### 10.3. Sinh subtitle

Subtitle cue bắt đầu theo cumulative voice position trong block. Timeline Builder tạo SRT mới hoàn toàn và validate:

- start nhỏ hơn end;
- cue tăng dần;
- không overlap ngoài policy;
- cue cuối không vượt output duration;
- số cue khớp locale asset manifest.

## 11. Variant Planner và constraint

Shuffle phải deterministic theo seed. V1 hỗ trợ:

- block `shuffleEligible: false` giữ vị trí;
- intro khóa đầu;
- outro/CTA khóa cuối;
- dependency chain được di chuyển như một đơn vị;
- mọi block ID xuất hiện đúng một lần;
- cùng input + seed + constraint tạo cùng `blockOrder`.

Các constraint nâng cao như quota theo source, tránh category lặp hoặc tối ưu diversity thuộc giai đoạn cross-source library.

## 12. Cấu trúc thư mục artifact

```text
project/
├── source/
│   ├── source.mp4
│   └── source.srt
├── analysis/
│   ├── scene-splitter.json
│   └── source-blocks.json
├── locales/
│   ├── vi-VN/
│   │   ├── assets.json
│   │   └── voices/
│   └── th-TH/
│       ├── assets.json
│       └── voices/
├── variants/
│   └── variant-001.json
├── timelines/
│   ├── variant-001.vi-VN.json
│   └── variant-001.th-TH.json
└── exports/
    ├── capcut/
    └── subtitles/
```

Không tạo `blocks/*/media.mp4` mặc định. Adapter chỉ materialize media khi format đầu ra yêu cầu.

## 13. Áp dụng vào kiến trúc repo

### 13.1. Shared contract mới

```text
src/shared/features/content-blocks.ts
```

File này sở hữu DTO, schema version, IPC request/result và progress types. Không đưa các kiểu mới vào `src/shared/types.ts` nếu chúng chỉ thuộc feature này.

### 13.2. Main services

```text
src/main/services/contentBlockAnalyzer.ts
src/main/services/dialogueGrouper.ts
src/main/services/boundaryResolver.ts
src/main/services/contentBlockManifest.ts
src/main/services/blockTimeline.ts
src/main/services/capCutBlockAdapter.ts
```

Trách nhiệm phải tách rõ:

- analyzer điều phối I/O;
- grouper và resolver là hàm thuần để unit test;
- manifest module validate/read/write;
- timeline module không biết CapCut;
- CapCut adapter không quyết định grouping hoặc boundary.

### 13.3. Feature vertical slice

```text
src/main/features/content-blocks.ts
src/preload/features/content-blocks.ts
src/renderer/src/features/content-blocks/
```

UI dự kiến có năm bước:

1. Chọn nguồn.
2. Analyze block.
3. Review grouping/boundary.
4. Thêm locale voice và tạo variant.
5. Preview timeline và xuất CapCut.

### 13.4. Tái sử dụng module hiện có

- `sceneSplitter.ts`: cung cấp scene manifest/candidates.
- `voiceSync.ts`: tách helper probe duration dùng chung; không tái sử dụng contract natural-ordering làm canonical mapping.
- `nativeCapCutGenerator.ts`: tạo draft từ timeline adapter.
- `capCutFactory.ts`: giữ workflow cũ để tương thích; không nhồi block engine vào file này.
- `srt-localization.ts`: giữ chế độ preserve timeline; block workflow gọi mode hoặc entry point riêng.

## 14. Phạm vi V1

V1 là một lát cắt có thể kiểm chứng:

1. Một source video và một source SRT.
2. Scene manifest từ feature hiện có.
3. `pair` grouping profile.
4. Manual merge/split và chỉnh boundary.
5. Boundary Resolver dùng scene candidate, fallback SRT.
6. SourceBlockManifest, LocaleAssetManifest, VariantPlan và RenderTimeline.
7. Một hoặc nhiều locale voice đã có sẵn.
8. Shuffle deterministic với locked block/dependency cơ bản.
9. Sinh SRT mới theo locale.
10. Xuất draft CapCut qua adapter.

## 15. Ngoài phạm vi V1

- AI dialogue classification;
- ASR/OCR tự động cho block analysis;
- silence detector;
- TTS trực tiếp trong app;
- duplicate/global question optimization;
- freeze, loop hoặc B-roll tự động;
- render MP4 cuối bằng FFmpeg;
- thư viện block kết hợp nhiều source video;
- semantic diversity optimization;
- numeric confidence đã hiệu chỉnh.

Các mục này chỉ được thêm sau khi V1 chứng minh grouping, boundary và timeline hoạt động trên dữ liệu thật.

## 16. Chiến lược kiểm thử

### 16.1. Unit tests

Dialogue Grouper:

- hai cue tạo một pair;
- số cue lẻ tạo block reviewable;
- intro/outro không bị pair sai;
- manual merge/split giữ ID hợp lệ.

Boundary Resolver:

- chọn scene gần cuối answer;
- bỏ scene cut nằm giữa Q và A;
- fallback SRT khi không có candidate;
- không tạo overlap/gap ngoài tolerance;
- boundary khóa thủ công luôn được giữ.

Variant Planner:

- deterministic theo seed;
- block xuất hiện đúng một lần;
- intro/outro được khóa;
- dependency chain không bị tách.

Timeline Builder:

- mỗi locale có duration riêng;
- không trim voice;
- speed policy được áp dụng đúng;
- SRT monotonic, không vượt output duration;
- block ngoài hard speed limit được gắn `needs-review`.

### 16.2. Integration tests

- load scene manifest + SRT → source block manifest;
- source blocks + voice manifest + variant → render timeline;
- render timeline → CapCut item arrays;
- manifest fingerprint mismatch bị chặn;
- thiếu voice chỉ làm locale đó thất bại, không phá source analysis hoặc locale khác.

### 16.3. Smoke test

Dùng video ngắn có tối thiểu ba Q+A block và hai locale voice. Gate đạt khi:

- draft CapCut parse được;
- số video/audio/text segment khớp timeline;
- mọi asset tồn tại;
- subtitle và voice cùng block có cùng timeline region;
- cùng seed tạo cùng thứ tự;
- không sửa draft store thật ngoài thư mục test.

### 16.4. Human QA

Trước khi mở rộng V1, chạy một tập video đại diện và ghi lại:

- tỷ lệ block phải chỉnh grouping;
- tỷ lệ boundary fallback;
- số block vượt media speed limit;
- lỗi nội dung sau shuffle;
- lỗi sync nhìn/nghe được.

## 17. Tiêu chí nghiệm thu V1

- Không cue nào bị chia sang hai block.
- Không block nào bị thiếu hoặc lặp trong variant.
- Cùng seed luôn sinh cùng thứ tự.
- Mỗi locale có timeline riêng.
- Voice không bị cắt hoặc ép theo timestamp nguồn.
- SRT mới tăng dần và nằm trong output duration.
- Source block edit không yêu cầu re-encode media.
- Fallback và speed violation luôn xuất hiện trong review state.
- Workflow CapCut/SRT cũ tiếp tục hoạt động không đổi.
- Core analyzer/planner/timeline chạy test mà không cần CapCut.

## 18. Rủi ro và giảm thiểu

| Rủi ro | Giảm thiểu |
| --- | --- |
| Scene detector cắt sai | Scene chỉ là candidate; hard constraints + review |
| Pair grouping không phù hợp video khác | Profile rõ ràng; manual correction; không khóa data model vào Q+A |
| Voice locale quá dài | Per-locale timeline; media speed limit; `needs-review` |
| Shuffle làm mất mạch | Locked blocks, dependency chain, semantic role |
| Source video bị thay đổi | Fingerprint + manifest revision gate |
| File voice ánh xạ sai | Mapping bằng cue ID, validate duration và duplicate/missing |
| CapCut đổi schema | Adapter riêng, template validation, core không phụ thuộc CapCut |
| Re-encode nhiều lần | Manifest-first, materialize khi export |
| Numeric confidence gây hiểu nhầm | Reason code + review state trong V1 |
| Phạm vi phình quá nhanh | Giữ danh sách ngoài phạm vi V1 và chỉ mở rộng sau dữ liệu QA |

## 19. Thứ tự triển khai đề xuất

### Giai đoạn 1: Domain và test thuần

- DTO/schema;
- dialogue grouping;
- boundary resolver;
- manifest validation;
- unit tests.

### Giai đoạn 2: Analyze và review

- đọc SRT + scene manifest;
- tạo SourceBlockManifest;
- UI merge/split và chỉnh boundary;
- fingerprint/revision.

### Giai đoạn 3: Locale timeline

- voice mapping bằng cue ID;
- FFprobe duration;
- LocaleAssetManifest;
- Timeline Builder và SRT generation.

### Giai đoạn 4: Variant và CapCut

- deterministic shuffle;
- locked block/dependency;
- CapCut adapter;
- integration và smoke test.

### Giai đoạn sau V1

- silence evidence;
- pattern/AI grouping;
- multi-source block pool;
- FFmpeg final renderer;
- freeze/loop/B-roll;
- TTS integration.

## 20. Quyết định chốt

1. `Content Block` là semantic unit, không đồng nhất với visual scene.
2. Source block lưu source ranges; không lưu timeline cuối.
3. Mỗi locale có LocaleAssetManifest và RenderTimeline riêng.
4. SRT cuối được sinh lại trong block-render mode.
5. Workflow preserve-source-timeline hiện tại được giữ tương thích.
6. Shuffle dùng block ID, seed và constraint.
7. Không materialize block media trong bước analyze.
8. V1 không dùng AI, silence detection hoặc direct MP4 render.
9. CapCut là adapter xuất đầu tiên; core không phụ thuộc CapCut.
10. Reason code + review state được dùng thay numeric confidence trong V1.

Tài liệu này là cơ sở để duyệt thiết kế. Implementation plan chỉ nên được viết sau khi phạm vi V1 và các quyết định trên được xác nhận.
