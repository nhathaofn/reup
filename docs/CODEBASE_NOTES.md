# Ghi chú mismatch, risk và giới hạn đã xác minh

> Đọc tài liệu này khi một task đụng tới điểm dễ vỡ, thông tin tài liệu cũ hoặc môi trường build. Các mục dưới đây là snapshot đối chiếu ngày **2026-08-17** với version **0.1.25**; đây không phải backlog tự động và không thay thế issue tracker.

## Cách đọc mức độ

- **Đã xác minh:** có bằng chứng trực tiếp từ file/lệnh nêu trong mục.
- **Giới hạn môi trường:** không kết luận code sai; chỉ nói kiểm tra chưa thực hiện được trên workspace hiện tại.
- **Rủi ro thiết kế:** hành vi hiện tại có thể đúng nhưng dễ gây lỗi khi mở rộng.
- **Cần quyết định:** cần chủ động chọn hướng trước khi sửa implementation.

## 1. Tài liệu kiến trúc cũ hơn source hiện tại

**Mức:** Đã xác minh  
**Hiện trạng:** `docs/PROJECT_ARCHITECTURE.md` trước khi cập nhật ghi version `0.1.16`, ngày `2026-08-12`; `package.json` hiện ghi `0.1.25`. Tài liệu cũ cũng ghi 60 request/19 event, registry rỗng và mô tả release workflow macOS không khớp source hiện tại.

**Bằng chứng:** `package.json`, `docs/PROJECT_ARCHITECTURE.md`, `src/main/index.ts`, `src/preload/index.ts`, `.github/workflows/release-app.yml`.

**Tác động:** AI/developer có thể chọn sai entrypoint, tưởng feature chưa đăng ký hoặc bỏ sót channel. Bản kiến trúc đã được cập nhật và liên kết từ [CODEBASE.md](../CODEBASE.md); khi đổi IPC/registry/version snapshot cần cập nhật lại.

## 2. Core IPC hiện có 68 request và 20 event

**Mức:** Đã xác minh  
**Hiện trạng:** Literal handler/invoke trong `src/main/index.ts`/`src/preload/index.ts` cho 68 request channel. Sender/listener trong `src/` cho 20 event channel, trong đó `update:status` được publish từ `src/main/updater.ts`.

**Bằng chứng:** regex source-level trên các file `.ts/.tsx`; `scripts/check-architecture.mjs` là guard chính thức khi dependency đã cài.

**Tác động:** Không thêm channel chỉ ở một phía. Khi đổi một method, kiểm tra shared type → Main handler → Preload adapter → Renderer caller/listener và chạy architecture check.

## 3. Hai cây Douyin trùng nhau

**Mức:** Đã xác minh / cần quyết định  
**Hiện trạng:**

- `engines/douyin-engine`: 102 file trong snapshot so sánh, gồm `storage/`, `dy-engine.spec`, `rthook_dy.py` và tài liệu/batch file.
- `engines/douyin-engine/douyin-downloader-main`: 93 file.
- Có 93 file chung; 91 file giống SHA-256; khác `run.py` và `tests/test_file_manager.py`.
- Workflow engine build dùng `engines/douyin-engine`, không dùng cây lồng.

**Bằng chứng:** so sánh SHA-256 theo relative path; `.github/workflows/build-windows-engines.yml`, `.github/workflows/build-mac-engines.yml`, `engines/douyin-engine/dy-engine.spec`.

**Tác động:** Sửa cây lồng có thể không ảnh hưởng binary phát hành; sửa cây ngoài có thể làm bản sao lồng lệch thêm. Không xóa/hợp nhất trong task tài liệu; cần quyết định một source of truth và cơ chế đồng bộ riêng.

## 4. Package `storage` chỉ đầy đủ ở cây Douyin hoạt động

**Mức:** Đã xác minh  
**Hiện trạng:** Cây hoạt động có `storage/__init__.py`, `database.py`, `file_manager.py`, `metadata_handler.py`; cây lồng thiếu toàn bộ package này dù test/spec của cây hoạt động dùng Database/FileManager/MetadataHandler.

**Bằng chứng:** `Get-ChildItem engines/douyin-engine/storage`, inventory `engines/douyin-engine/douyin-downloader-main`, import trong `engines/douyin-engine/dy-engine.spec` và source/test.

**Tác động:** Không thể coi hai cây là checkout tương đương; không tạo stub storage trong tài liệu hoặc source chỉ để làm import pass. Nếu cần chạy test cây lồng, phải có quyết định phục hồi/loại bỏ cây đó.

## 5. Manifest engine hiện đã đủ năm key

**Mức:** Đã xác minh; tài liệu cũ stale  
**Hiện trạng:** `engines-manifest.json` hiện có `ocr`, `whisper`, `douyin`, `whisperCuda`, `video2x`. `src/main/engines-update.ts` định nghĩa cùng năm `EngineKind`.

**Bằng chứng:** `engines-manifest.json`, `src/main/engines-update.ts`, `.github/workflows/build-windows-engines.yml`.

**Tác động:** Không giữ lại kết luận “manifest chỉ có OCR/Video2X”. Tuy nhiên release macOS workflow không ghi manifest mới và không build CUDA bundle, nên cần kiểm tra asset/tag thực tế theo platform trước khi khẳng định update engine macOS hoạt động.

## 6. App release workflow hiện package Windows

**Mức:** Đã xác minh  
**Hiện trạng:** `electron-builder.yml` khai báo Windows NSIS và macOS DMG/ZIP, nhưng `.github/workflows/release-app.yml` matrix hiện chỉ có Windows, chạy `package:win` và `verify:package:win`. Workflow macOS hiện chỉ build engine assets.

**Bằng chứng:** `electron-builder.yml`, `.github/workflows/release-app.yml`, `.github/workflows/build-mac-engines.yml`.

**Tác động:** Không nói “CI đã phát hành macOS app” nếu chưa có job `package:mac`. Khi thêm job cần cập nhật [ENGINES_AND_RUNTIME.md](ENGINES_AND_RUNTIME.md) và kiểm tra publish artifact.

## 7. SafeStorage có plaintext fallback

**Mức:** Rủi ro bảo mật đã xác minh  
**Hiện trạng:** `src/main/gemini.ts` ghi `safeStorage.encryptString()` khi encryption available; nếu không, ghi `Buffer.from(key, 'utf-8')`. `src/main/openai.ts` dùng cùng pattern. Khi đọc, code cũng giải mã hoặc đọc plaintext tùy khả năng hệ điều hành.

**Bằng chứng:** `src/main/gemini.ts`, `src/main/openai.ts`.

**Tác động:** API key có thể nằm dạng plaintext trong `userData` trên môi trường không hỗ trợ safeStorage. Đây là hành vi tương thích hiện tại, chưa tự sửa trong task tài liệu; product cần quyết định fail-closed, cảnh báo người dùng hoặc giữ fallback.

## 8. Runtime lớn được tải ngoài installer

**Mức:** Đã xác minh / invariant cần giữ  
**Hiện trạng:** `electron-builder.yml` loại `engines/**`, test artifacts và ZIP khỏi package; `scripts/check-package-runtime-assets.mjs` chặn engine/FFmpeg/yt-dlp/ZIP/CapCut CLI history. Main tải asset vào `userData/bin`.

**Bằng chứng:** `electron-builder.yml`, `src/main/deps.ts`, `scripts/check-package-runtime-assets.mjs`, release workflow.

**Tác động:** Không giải quyết lỗi runtime bằng cách commit binary hoặc copy vào installer. Khi đổi asset path/tên file, phải sửa adapter, workflow và package verification cùng nhau.

## 9. Kiểm tra TypeScript/architecture bị giới hạn bởi dependency workspace

**Mức:** Giới hạn môi trường  
**Hiện trạng:** Chạy `npm.cmd run check:architecture` trong snapshot trả `ERR_MODULE_NOT_FOUND: Cannot find package 'typescript'` từ `scripts/check-architecture.mjs`; workspace chưa có `node_modules`.

**Bằng chứng:** output lệnh ngày 2026-08-17; `package.json` vẫn khai báo `typescript` trong devDependencies.

**Tác động:** Không được gọi architecture check/typecheck là pass dựa trên tài liệu cũ. Sau `npm.cmd install` hoặc `npm.cmd ci`, chạy lại `npm.cmd run typecheck`, `npm.cmd run check:architecture` và `npm.cmd run build`.

## 10. Test coverage hiện chủ yếu ở Python engine

**Mức:** Đã xác minh  
**Hiện trạng:** Root `package.json` không có script JavaScript/React test. Cây Douyin hoạt động có 30 `test_*.py` và 168 hàm test; cây lồng có 30 file và 167 hàm; Whisper có 1 test file cho subtitle segments.

**Bằng chứng:** `package.json`, file inventory và pattern test trong `engines/*/tests`.

**Tác động:** `npm run verify` không kiểm tra regression UI/IPC nghiệp vụ ngoài typecheck/architecture/build. Khi thêm core queue/cancel hoặc feature contract quan trọng, cần cân nhắc test cấp service/contract.

## 11. macOS runtime có nhánh code nhưng còn điểm chưa được test thật

**Mức:** Rủi ro cần xác minh  
**Hiện trạng:** `deps.ts` có nhánh tải FFmpeg/FFprobe static cho macOS và comment ghi chưa kiểm thử trên Mac thật. `sceneSplitter.ts` yêu cầu PATH `scenedetect` trên macOS/Linux; `video2x.ts` trả unsupported trên macOS; release workflow chưa package app macOS.

**Bằng chứng:** `src/main/deps.ts`, `src/main/services/sceneSplitter.ts`, `src/main/video2x.ts`, `.github/workflows/release-app.yml`.

**Tác động:** Không suy luận “macOS đã được phát hành/kiểm thử đầy đủ” chỉ từ target trong electron-builder. Cần smoke test trên macOS thật trước khi đổi tài liệu release.

## 12. Main và Preload là hotspot mở rộng

**Mức:** Rủi ro thiết kế đã xác minh  
**Hiện trạng:** Core IPC tập trung trong `src/main/index.ts`; core API tập trung trong `src/preload/index.ts`; Renderer shell/tab tập trung trong `App.tsx`. Feature registry đã tách ba feature mới nhưng core vẫn dùng các file tập trung này.

**Tác động:** Sửa core có nguy cơ collision channel/API hoặc làm hỏng listener cleanup. Khi mở rộng, đọc [IPC_AND_FEATURES.md](IPC_AND_FEATURES.md), giữ channel pairing và dùng registry cho feature mới; không refactor lớn trong task nghiệp vụ nhỏ.

## 13. Dịch SRT chỉ từ văn bản; media path chỉ tương thích cũ

**Mức:** Đã xác minh; giới hạn vận hành cần ghi nhớ  
**Hiện trạng:** Feature `srt-translator` chạy theo 5 bước Nguồn → Phục hồi → Duyệt → Bản địa hóa → Xuất. Mặc định request chỉ có SRT; Main kiểm tra SRT/fingerprint, gửi toàn bộ ngữ cảnh văn bản cho restoration/audit và luôn đánh dấu file xuất `_unverified.srt`. Nhánh verified/video vẫn giữ cho caller cũ nhưng không có trong UI.

**Bằng chứng:** `src/shared/features/srt-translator.ts`, `src/main/features/srt-translator.ts`, `src/main/services/srt-source-validation.ts`, `src/main/services/srt-translator-job.ts`, `src/renderer/src/features/srt-translator/`.

**Privacy/cleanup:** Workflow mặc định không upload media và không có remote cleanup. Nếu caller cũ dùng verified/video, Main vẫn cố gắng delete ở các terminal path; API key và remote URI không ghi vào log. File log chẩn đoán có raw request/response Gemini và vì vậy có thể chứa SRT/prompt riêng tư; progress public chỉ giữ thông điệp aggregate.

**Ngữ nghĩa/bản địa hóa:** Restoration pass chỉ dùng SRT để phục hồi lỗi ASR, đồng âm/âm gần, slang/phương ngữ, taxonomy, tên riêng, thuật ngữ, số và đơn vị; audit pass độc lập tạo canonical source và candidate/evidence tiếng Việt. Locale profile điều chỉnh văn phong, tiền tệ, đơn vị đo, tên loài và tên riêng theo khu vực đích nhưng giữ identity/dữ kiện. Tỷ giá có attribution **Rates By ExchangeRate-API** ([ExchangeRate-API](https://www.exchangerate-api.com)); số tiền chuyển đổi chỉ là lời thoại xấp xỉ, không phải giá trị thanh toán, trading, kế toán hay báo giá.

**Kiểm thử:** `npm run test:unit` là đường chạy offline, không gọi Gemini/rate API thật. `npm run test:smoke:srt` là live smoke opt-in, cần bốn biến `TBLAO_GEMINI_SMOKE_KEY`, `TBLAO_SRT_SMOKE_VIDEO`, `TBLAO_SRT_SMOKE_SRT`, `TBLAO_SRT_SMOKE_OUTPUT_DIR`, rồi phải xóa chúng. Tài liệu này không coi smoke là bằng chứng offline.
