# Codebase Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo một bộ tài liệu Markdown có điểm đọc đầu tiên, bản đồ module, hợp đồng IPC/feature, bản đồ runtime/engine và ghi chú rủi ro để giảm số lần phải quét lại toàn bộ codebase T-blao.

**Architecture:** Dùng `CODEBASE.md` làm index ở root và chia kiến thức theo năm miền trong `docs/`. Tài liệu mới tham chiếu trực tiếp tới source/config/workflow hiện tại; các tài liệu kiến trúc và feature cũ được giữ lại, cập nhật những điểm đã lệch và nối liên kết từ index.

**Tech Stack:** Markdown, PowerShell read-only inventory/checks, Node.js npm scripts (`typecheck`, `check:architecture`, `build`), source hiện có Electron + React + TypeScript + Python.

## Global Constraints

- Snapshot tài liệu: 2026-08-17; version ứng dụng được lấy từ `package.json` là `0.1.25`.
- Chỉ tạo/cập nhật Markdown và liên kết tài liệu; không thay đổi logic TypeScript, React, Python, workflow hoặc package.
- Phạm vi source gồm `src`, `engines`, `scripts`, `.github`, `resources`, file cấu hình và test; loại trừ `node_modules`, `out`, `dist`, binary và dữ liệu sinh trong `test-artifacts`.
- Giữ nguyên cây Douyin trùng/lồng và chỉ mô tả khác biệt đã xác minh; không hợp nhất, xóa hoặc phục hồi source ngoài phạm vi.
- Mọi kết luận về module, IPC, runtime hoặc workflow phải có đường dẫn source/config để kiểm tra lại.
- Liên kết nội bộ dùng đường dẫn tương đối; không ghi secret, cookie, token, đường dẫn cá nhân hoặc dữ liệu nhị phân.
- Workspace không có `.git`; không chạy thao tác commit hoặc giả lập lịch sử commit.
- Nếu `npm.cmd run build` không chạy được do dependency/môi trường, ghi nguyên văn lỗi và không gọi build là thành công.

---

## File Map

| File | Trách nhiệm |
| --- | --- |
| `CODEBASE.md` | Cửa vào duy nhất, hướng dẫn đọc tài liệu và quy tắc cập nhật |
| `docs/CODEBASE_MAP.md` | Bản đồ thư mục, entrypoint, module sở hữu state/process và test liên quan |
| `docs/IPC_AND_FEATURES.md` | Luồng Renderer/Preload/Main, nhóm IPC core, feature registry và contracts |
| `docs/ENGINES_AND_RUNTIME.md` | Dependency/runtime, binary, JSONL, userData, engine install/update và release |
| `docs/CODEBASE_NOTES.md` | Mismatch/risk đã xác minh, bằng chứng, tác động và hướng xử lý |
| `docs/PROJECT_ARCHITECTURE.md` | Kiến trúc tổng quan được cập nhật theo snapshot hiện tại |
| `docs/ADDING_A_FEATURE.md` | Quy trình thêm feature hiện có, chỉ chỉnh khi có thông tin sai hoặc cần liên kết |
| `docs/CAPCUT_FACTORY.md` | Thiết kế CapCut Factory hiện có, chỉ chỉnh khi có thông tin sai hoặc cần liên kết |
| `README.md` | Liên kết người dùng/developer tới `CODEBASE.md` và tài liệu chuyên sâu |

---

### Task 1: Tạo điểm đọc đầu tiên ở root

**Files:**
- Create: `CODEBASE.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `package.json`, root directory inventory, `README.md`, tài liệu trong `docs/`.
- Produces: một index ổn định để chọn tài liệu trước khi đọc source.

- [ ] **Step 1: Xác minh metadata và root map**

Run:

```powershell
Get-Content package.json | Select-String '"version"'
Get-ChildItem -Force | Select-Object Name,Mode
```

Expected: version `0.1.25` và các root entry `src`, `engines`, `scripts`, `docs`, `resources`, `.github`, `build`, `test-artifacts` cùng các file cấu hình hiện có.

- [ ] **Step 2: Viết `CODEBASE.md`**

Bao gồm các mục: “Đọc file này trước”, snapshot, phạm vi/loại trừ, bản đồ nhanh, bảng câu hỏi → tài liệu, lệnh kiểm tra và quy tắc cập nhật. Liên kết tới toàn bộ tài liệu trong File Map, `package.json`, các script npm và các tài liệu feature hiện có.

- [ ] **Step 3: Thêm liên kết từ `README.md`**

Đặt liên kết tới `CODEBASE.md` gần phần cấu trúc/phát triển và không sao chép nội dung kiến trúc dài vào README.

- [ ] **Step 4: Kiểm tra link đích**

Run:

```powershell
@('CODEBASE.md','README.md','docs/PROJECT_ARCHITECTURE.md','docs/ADDING_A_FEATURE.md','docs/CAPCUT_FACTORY.md') | ForEach-Object { if (-not (Test-Path -LiteralPath $_)) { throw "Missing $_" } }
```

Expected: không có file bắt buộc nào bị thiếu.

### Task 2: Tạo bản đồ module và entrypoint

**Files:**
- Create: `docs/CODEBASE_MAP.md`

**Interfaces:**
- Consumes: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/App.tsx`, `src/shared/*`, `engines/*`, `scripts/*`, `.github/workflows/*`.
- Produces: bản đồ module có thể dùng để chọn file cần đọc cho từng loại task.

- [ ] **Step 1: Tạo inventory source có loại trừ**

Run:

```powershell
rg --files --hidden -g '!.git' -g '!node_modules' -g '!out' -g '!dist' -g '!build' -g '!test-artifacts' | Sort-Object
```

Expected: inventory có source/config/test/tài liệu; không biến dữ liệu sinh trong `test-artifacts` thành module.

- [ ] **Step 2: Ghi lớp thực thi**

Mô tả luồng Main khởi động BrowserWindow/protocol/IPC, Preload expose `window.api`, Renderer mount tab/queue, Shared giữ type/contract và Python engine xử lý workload chuyên biệt. Gắn path entrypoint ở mỗi lớp.

- [ ] **Step 3: Ghi bảng module theo miền**

Tạo các bảng cho download/core services, cookies/proxy, OCR/Whisper/burn/translate, Video2X, CapCut/scene splitter, renderer components/libs, scripts/workflows và Douyin packages. Với file lớn, ghi rõ trách nhiệm thay vì liệt kê mọi hàm.

- [ ] **Step 4: Ghi ownership của state/process và test**

Nêu module Main sở hữu child process/cancel, component Renderer sở hữu queue/UI state, engine sở hữu protocol JSONL hoặc CLI; nối mỗi domain tới test directory/file hiện có.

- [ ] **Step 5: Ghi chú cây Douyin trùng**

Đối chiếu `engines/douyin-engine` với `engines/douyin-engine/douyin-downloader-main`, xác định cây được workflow build dùng và ghi khác biệt hiện tại mà không gọi cây lồng là source hoạt động nếu chưa có bằng chứng.

### Task 3: Tạo bản đồ IPC và feature registry

**Files:**
- Create: `docs/IPC_AND_FEATURES.md`

**Interfaces:**
- Consumes: `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/shared/types.ts`, `src/shared/features/*`, ba registry và `scripts/check-architecture.mjs`.
- Produces: bản đồ boundary và quy tắc thay đổi an toàn cho IPC/feature.

- [ ] **Step 1: Trích danh sách handler/invoke/event**

Run:

```powershell
rg -n "ipcMain\.handle|ipcRenderer\.invoke|ipcRenderer\.on|webContents\.send|FEATURE_CHANNELS|register.*Features" src scripts
```

Expected: các channel được nhóm theo `deps`, `ytdlp`, `cookies`, `douyin`, `whisper`, `ocr`, `burn`, `video2x`, `translate`, `logs`, `update`, `app` và feature namespace.

- [ ] **Step 2: Mô tả contract và lifecycle**

Ghi vị trí type shared, adapter preload, listener cleanup, event progress, cancel, lỗi và nguyên tắc Main validate lại input. Ghi rõ Renderer không import Electron/fs/child_process.

- [ ] **Step 3: Mô tả vertical slice feature**

Liệt kê các file shared/main/preload/renderer/registry của feature; ghi metadata `placement`, `keepAlive`, namespace `<feature-id>:` và vai trò `scripts/create-feature.mjs`.

- [ ] **Step 4: Đối chiếu guard architecture**

Run:

```powershell
npm.cmd run check:architecture
```

Expected: architecture check hoàn tất với exit code `0`; nếu không, tài liệu phải ghi lỗi thực tế thay vì khẳng định registry hợp lệ.

### Task 4: Tạo bản đồ engines và runtime

**Files:**
- Create: `docs/ENGINES_AND_RUNTIME.md`

**Interfaces:**
- Consumes: `src/main/runtimeSetup.ts`, `src/main/deps.ts`, `src/main/engines-update.ts`, `src/main/douyin.ts`, `src/main/whisper.ts`, `src/main/ocr.ts`, `src/main/video2x.ts`, `src/main/services/sceneSplitter.ts`, `src/main/services/capCutFactory.ts`, engine source/spec/requirements, `engines-manifest.json`, workflows.
- Produces: hướng dẫn chọn đúng runtime path, engine protocol và workflow build/package.

- [ ] **Step 1: Đối chiếu dependency matrix**

Ghi cho từng runtime: owner adapter, binary/package, nguồn cài, nơi lưu dưới `userData`, manifest key/version, platform support, input/output protocol và cancel behavior.

- [ ] **Step 2: Đối chiếu engine source**

Đọc `engines/ocr-engine/engine.py`, `engines/whisper-engine/engine.py`, `engines/douyin-engine/run.py`, `dy-engine.spec`, `whisper-engine.spec`, `ocr-engine.spec` và requirements để phân biệt source, bundle và optional model/CUDA.

- [ ] **Step 3: Đối chiếu workflow phát hành**

Đọc `.github/workflows/build-windows-engines.yml`, `.github/workflows/build-mac-engines.yml`, `.github/workflows/release-app.yml`; ghi rõ workflow nào build engine, workflow nào package app, asset release repository và các smoke check.

- [ ] **Step 4: Ghi dev/packaged behavior**

Mô tả `TBLAO_USER_DATA_DIR`, `TBLAO_DEV_ALLOW_MISSING_RUNTIME`, resolve PATH/managed binary, runtime setup lúc khởi động và giới hạn khi engine chưa cài.

- [ ] **Step 5: Kiểm tra tên asset/manifest**

Run:

```powershell
rg -n "engines-manifest|whisperCuda|video2x|douyin|ocr|whisper|assets-v1|package:win|package:mac" src engines-manifest.json .github package.json
```

Expected: tài liệu phản ánh đúng các key code/workflow đang đọc/ghi, kể cả khi chúng chưa đồng nhất.

### Task 5: Cập nhật kiến trúc và ghi chú rủi ro đã xác minh

**Files:**
- Create: `docs/CODEBASE_NOTES.md`
- Modify: `docs/PROJECT_ARCHITECTURE.md`
- Modify: `docs/ADDING_A_FEATURE.md`
- Modify: `docs/CAPCUT_FACTORY.md`

**Interfaces:**
- Consumes: bốn tài liệu mới, source/config/workflow đã đối chiếu ở Task 1–4 và các tài liệu hiện có.
- Produces: tài liệu hiện có khớp snapshot hiện tại, ghi chú risk có bằng chứng và liên kết chéo rõ ràng.

- [ ] **Step 1: Lập bảng mismatch trước khi sửa**

Đối chiếu version/date, engine manifest, release workflow, duplicate Douyin tree, runtime storage, test/CI và secret behavior; ghi path bằng chứng cho mỗi nhận định.

- [ ] **Step 2: Viết `docs/CODEBASE_NOTES.md`**

Mỗi mục có trạng thái, ảnh hưởng, bằng chứng, cách kiểm tra lại và hướng xử lý tương lai. Phân biệt bug đã chứng minh với risk cần xác minh thêm.

- [ ] **Step 3: Cập nhật `PROJECT_ARCHITECTURE.md`**

Sửa các phần snapshot sai; thêm liên kết tới `CODEBASE.md`, `CODEBASE_MAP.md`, `IPC_AND_FEATURES.md`, `ENGINES_AND_RUNTIME.md` và `CODEBASE_NOTES.md`; giữ các mô tả chi tiết vẫn còn đúng.

- [ ] **Step 4: Kiểm tra tài liệu feature hiện có**

Chỉ chỉnh `ADDING_A_FEATURE.md` hoặc `CAPCUT_FACTORY.md` khi path, tên feature, contract hoặc flow đã lệch source; nếu nội dung vẫn đúng thì chỉ thêm liên kết chéo ở phần đầu/cuối.

- [ ] **Step 5: Tìm thông tin cũ chưa được giải quyết**

Run:

```powershell
rg -n -i "0\.1\.16|macOS|release-app|engines-manifest|storage|douyin-downloader-main" README.md docs engines-manifest.json .github src
```

Expected: mỗi kết quả liên quan được xác định là còn đúng, được cập nhật hoặc được ghi vào `CODEBASE_NOTES.md`.

### Task 6: Kiểm tra liên kết, độ bao phủ và regression của repository

**Files:**
- Verify: `CODEBASE.md`, `README.md`, `docs/*.md`, source/config/workflow paths referenced by the documents.

**Interfaces:**
- Consumes: toàn bộ tài liệu sau Task 1–5.
- Produces: bộ tài liệu có link hợp lệ, kết luận có bằng chứng và không có thay đổi logic ngoài phạm vi.

- [ ] **Step 1: Kiểm tra đường dẫn Markdown nội bộ**

Dùng PowerShell để trích link dạng relative trong các tài liệu mới/cập nhật, bỏ qua URL web và anchor, sau đó kiểm tra từng target bằng `Test-Path`.

- [ ] **Step 2: Kiểm tra các section bắt buộc**

Xác nhận mỗi tài liệu mới có ngày/version, phạm vi, source paths, hướng dẫn khi nào đọc và điều kiện cập nhật.

- [ ] **Step 3: Chạy typecheck**

Run:

```powershell
npm.cmd run typecheck
```

Expected: exit code `0`; nếu environment thiếu dependency thì ghi output và không suy diễn.

- [ ] **Step 4: Chạy architecture check**

Run:

```powershell
npm.cmd run check:architecture
```

Expected: exit code `0` và không có thay đổi source IPC/registry ngoài ý muốn.

- [ ] **Step 5: Chạy production build**

Run:

```powershell
npm.cmd run build
```

Expected: exit code `0`; nếu thất bại do môi trường, ghi rõ lỗi trong bàn giao và không gọi build là đạt.

- [ ] **Step 6: Kiểm tra diff/workspace thực tế**

Run:

```powershell
Get-ChildItem -LiteralPath 'CODEBASE.md','docs' -File -Recurse | Sort-Object FullName | Select-Object FullName,Length
git rev-parse --is-inside-work-tree 2>$null
```

Expected: danh sách chỉ chứa các tài liệu trong phạm vi; lệnh Git xác nhận workspace không có metadata hoặc trả lỗi rõ ràng, không được dùng làm bằng chứng thay đổi đã commit.


