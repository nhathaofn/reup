# Short Video Multi-Language Pipeline

## 1. Luồng xử lý tổng thể

```mermaid
flowchart TD

    START([Bắt đầu])

    START --> INPUT_VIDEO[Thêm N video nguồn]

    INPUT_VIDEO --> SELECT_BLUR[Chọn vùng cần kiểm tra và làm mờ chữ]

    SELECT_BLUR --> SOURCE_PROCESSING[Chuẩn hóa video nguồn]

    SOURCE_PROCESSING --> SUBTITLE_CREATE[Tạo phụ đề + SRT gốc]

    SUBTITLE_CREATE --> SELECT_COUNTRY[Chọn N quốc gia / ngôn ngữ đầu ra]

    SELECT_COUNTRY --> LANGUAGE_FANOUT{Tạo phiên bản theo từng quốc gia}

    LANGUAGE_FANOUT --> TRANSLATE[Chuyển phụ đề + SRT sang ngôn ngữ đích]

    TRANSLATE --> LOCALIZE[Điều chỉnh cách diễn đạt phù hợp quốc gia / trend<br/>không thay đổi nội dung]

    LOCALIZE --> VOICE[Tạo Voice theo phiên bản phụ đề + SRT]

    VOICE --> LANGUAGE_PACKAGE[Đóng gói Language Package]

    LANGUAGE_PACKAGE --> SCENE_SPLIT[Tách cảnh bằng hệ thống tách Content hiện tại]

    SCENE_SPLIT --> MAP_CONTENT[Map Scene + SRT + Voice<br/>theo từng quốc gia / ngôn ngữ]

    MAP_CONTENT --> CONTEXT_GROUP[Nhóm các Scene thuộc cùng / gần cùng ngữ cảnh]

    CONTEXT_GROUP --> VARIANT_SHUFFLE[Xáo trộn Scene / Content<br/>tạo Variant riêng cho từng quốc gia]

    VARIANT_SHUFFLE --> SHORT_BUILD[Build Video Short]

    SHORT_BUILD --> EXPORT[Export từng Video]

    EXPORT --> OUTPUT_VIDEO[(Output<br/>N Video nguồn × N Quốc gia)]

    OUTPUT_VIDEO --> END([Hoàn thành])
```

## 2. Fan-out theo quốc gia / ngôn ngữ

```mermaid
flowchart LR

    INPUT[(Video nguồn)]

    INPUT --> COMMON[Pipeline chung cho Video nguồn]

    COMMON --> BLUR[Blur vùng chữ]
    BLUR --> SUB[SRT + Subtitle gốc]
    SUB --> SCENE[Scene / Content gốc]

    SCENE --> FANOUT{Country / Language Fan-out}

    FANOUT --> VN[Việt Nam]
    FANOUT --> US[Mỹ]
    FANOUT --> JP[Nhật]
    FANOUT --> KR[Hàn Quốc]
    FANOUT --> OTHER[... N quốc gia]

    VN --> VN_DATA[SRT VN + Subtitle VN + Voice VN]
    US --> US_DATA[SRT EN-US + Subtitle EN-US + Voice EN-US]
    JP --> JP_DATA[SRT JP + Subtitle JP + Voice JP]
    KR --> KR_DATA[SRT KR + Subtitle KR + Voice KR]
    OTHER --> OTHER_DATA[SRT + Subtitle + Voice]

    VN_DATA --> VN_MAP[Map Scene]
    US_DATA --> US_MAP[Map Scene]
    JP_DATA --> JP_MAP[Map Scene]
    KR_DATA --> KR_MAP[Map Scene]
    OTHER_DATA --> OTHER_MAP[Map Scene]

    VN_MAP --> VN_SHUFFLE[Shuffle Variant VN]
    US_MAP --> US_SHUFFLE[Shuffle Variant US]
    JP_MAP --> JP_SHUFFLE[Shuffle Variant JP]
    KR_MAP --> KR_SHUFFLE[Shuffle Variant KR]
    OTHER_MAP --> OTHER_SHUFFLE[Shuffle Variant ...]

    VN_SHUFFLE --> VN_OUT[(Short VN)]
    US_SHUFFLE --> US_OUT[(Short US)]
    JP_SHUFFLE --> JP_OUT[(Short JP)]
    KR_SHUFFLE --> KR_OUT[(Short KR)]
    OTHER_SHUFFLE --> OTHER_OUT[(Short ...)]
```

## 3. Kiến trúc Client + AI Server

```mermaid
flowchart LR

    subgraph CLIENT["CLIENT / DỰ ÁN HIỆN TẠI"]
        UI[UI]
        VIDEO_INPUT[Import N Video]
        REGION[Chọn vùng chữ]
        VIDEO_PROCESS[Video Processing]
        SUBTITLE_SOURCE[SRT / Subtitle]
        EXISTING_SCENE[Content / Scene Split hiện tại]
        CONTENT_MAP[Scene Mapping hiện tại]
        VARIANT[Variant / Shuffle]
        RENDER[Short Renderer]
        EXPORT[Export]

        UI --> VIDEO_INPUT
        VIDEO_INPUT --> REGION
        REGION --> VIDEO_PROCESS
        VIDEO_PROCESS --> SUBTITLE_SOURCE
        SUBTITLE_SOURCE --> EXISTING_SCENE
        EXISTING_SCENE --> CONTENT_MAP
        CONTENT_MAP --> VARIANT
        VARIANT --> RENDER
        RENDER --> EXPORT
    end

    subgraph AI_SERVER["AI SERVER - DỰ ÁN RIÊNG"]
        API[AI API Gateway]

        TRANSLATE[Translation Service]
        LOCALIZE[Localization / Trend Rewrite Service]
        VOICE[Voice Service]
        VISION[Vision Service]

        MODEL_TRANSLATE[(Local Translation LLM)]
        MODEL_LLM[(Local LLM)]
        MODEL_TTS[(Local Voice / TTS Model)]
        MODEL_VISION[(Local Vision Model)]

        API --> TRANSLATE
        API --> LOCALIZE
        API --> VOICE
        API --> VISION

        TRANSLATE --> MODEL_TRANSLATE
        LOCALIZE --> MODEL_LLM
        VOICE --> MODEL_TTS
        VISION --> MODEL_VISION
    end

    SUBTITLE_SOURCE -->|SRT + Subtitle + Target Countries| API

    API -->|Translated SRT / Subtitle| SUBTITLE_SOURCE
    API -->|Localized SRT / Subtitle| SUBTITLE_SOURCE
    API -->|Voice Files + Timeline Metadata| CONTENT_MAP

    REGION -->|Selected Region + Frames| API
    API -->|Text / Detection Result| VIDEO_PROCESS
```

## 4. Cấu trúc dự án đề xuất

```mermaid
flowchart TD

    PROJECT["PROJECT ROOT"]

    PROJECT --> CLIENT["client/ - ứng dụng hiện tại"]
    PROJECT --> SERVER["ai-server/ - dự án AI riêng"]

    CLIENT --> C1["video-source"]
    CLIENT --> C2["blur-region"]
    CLIENT --> C3["subtitle-srt"]
    CLIENT --> C4["scene-content"]
    CLIENT --> C5["scene-mapping"]
    CLIENT --> C6["variant-builder"]
    CLIENT --> C7["short-renderer"]
    CLIENT --> C8["export"]
    CLIENT --> C9["ai-server-client"]

    SERVER --> S1["api"]
    SERVER --> S2["translation"]
    SERVER --> S3["localization"]
    SERVER --> S4["voice"]
    SERVER --> S5["vision"]
    SERVER --> S6["models"]
    SERVER --> S7["runtime"]
```

## 5. Quan hệ Input → Output

```text
N VIDEO NGUỒN
      │
      ▼
[VIDEO 1] ─┬─> [VN] ─> [Variant VN] ─> short_vn.mp4
           ├─> [US] ─> [Variant US] ─> short_us.mp4
           ├─> [JP] ─> [Variant JP] ─> short_jp.mp4
           └─> [...] ─> [Variant ...] ─> short_x.mp4

[VIDEO 2] ─┬─> [VN] ─> [Variant VN] ─> short_vn.mp4
           ├─> [US] ─> [Variant US] ─> short_us.mp4
           ├─> [JP] ─> [Variant JP] ─> short_jp.mp4
           └─> [...] ─> [Variant ...] ─> short_x.mp4

...

[VIDEO N] ─┬─> [Language 1] ─> [Variant 1] ─> short_1.mp4
           ├─> [Language 2] ─> [Variant 2] ─> short_2.mp4
           └─> [Language N] ─> [Variant N] ─> short_n.mp4


OUTPUT = SỐ VIDEO NGUỒN × SỐ QUỐC GIA / NGÔN NGỮ ĐƯỢC CHỌN
```
