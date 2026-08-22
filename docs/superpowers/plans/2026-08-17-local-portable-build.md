# Bản portable local độc lập Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo bản Windows portable `T-blao Local` có app ID, dữ liệu, output và updater tách khỏi bản T-blao phát hành từ GitHub.

**Status:** Đã triển khai và xác minh; artifact portable đã tạo tại `dist-local/T-blao Local-0.1.25-portable.exe`. Smoke test packaged/unpacked xác nhận thư mục `T-blao Local Data` được tạo cạnh output khi có `PORTABLE_EXECUTABLE_DIR`.

**Architecture:** Giữ nguyên `electron-builder.yml` cho release hiện tại và thêm `electron-builder.local.yml` kế thừa config chuẩn nhưng đổi target sang `portable`, output sang `dist-local`, app ID và product name. Main nhận biết portable packaged qua `PORTABLE_EXECUTABLE_DIR`, đổi `userData` trước single-instance lock, còn updater bỏ qua hoàn toàn bản local.

**Tech Stack:** Electron 34, electron-builder 25, electron-vite, TypeScript strict, Node test runner.

## Execution record

- `npm.cmd run package:win:local`: tạo portable `.exe` x64, Windows metadata có `ProductName: T-blao Local`.
- Smoke test: tạo được `dist-local/T-blao Local Data`; process test đã dừng sau khi kiểm tra.
- `npm.cmd run test:unit`: 10/10 pass.
- `npm.cmd run verify`: typecheck Node/Web, architecture và production build pass.
- `electron-builder.yml` vẫn là config release NSIS; `electron-builder.local.yml` dùng app ID/output/target riêng.

## Global Constraints

- Không sửa hành vi/lệnh build release `npm run package:win`.
- Artifact local là `.exe` portable, không tạo installer Windows.
- Local app ID là `com.nhathaofn.tblao.local`; product name là `T-blao Local`.
- Local output là `dist-local`; dữ liệu runtime là thư mục `T-blao Local Data` cạnh portable executable.
- Bản local không gọi GitHub Releases qua electron-updater.
- `TBLAO_USER_DATA_DIR` vẫn được ưu tiên cho smoke test/override có chủ đích.
- Không thêm runtime dependency.
- Workspace không có `.git`; không tạo commit giả.

## Bản đồ file

### Tạo mới

- `src/shared/build-variant.ts`: helper thuần nhận biết môi trường local portable.
- `tests/build-variant.test.ts`: test detection packaged/non-packaged và env trống/có giá trị.
- `electron-builder.local.yml`: config portable kế thừa config release.
- `docs/LOCAL_PORTABLE_BUILD.md`: hướng dẫn build/chạy và vị trí dữ liệu local.

### Chỉnh sửa

- `src/main/index.ts`: áp dụng userData local trước single-instance lock và đặt tiêu đề cửa sổ local.
- `src/main/updater.ts`: bỏ qua check/download/install update cho local portable.
- `package.json`: thêm `package:win:local` và thêm test mới vào `test:unit`.
- `README.md`, `CODEBASE.md`, `docs/CODEBASE_MAP.md`, `docs/ENGINES_AND_RUNTIME.md`: ghi nhận lệnh/config local.

---

### Task 1: Helper nhận biết local portable theo TDD

**Files:**
- Create: `tests/build-variant.test.ts`
- Create: `src/shared/build-variant.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `LOCAL_APP_ID`, `LOCAL_APP_NAME`, `LOCAL_USER_DATA_DIRECTORY`.
- Produces `isLocalPortableBuild(env, isPackaged): boolean`.

- [ ] **Step 1: Viết test đỏ**

```ts
test('chỉ nhận local portable khi app đã packaged và có PORTABLE_EXECUTABLE_DIR', () => {
  assert.equal(isLocalPortableBuild({ PORTABLE_EXECUTABLE_DIR: 'F:\\Apps' }, true), true)
  assert.equal(isLocalPortableBuild({ PORTABLE_EXECUTABLE_DIR: 'F:\\Apps' }, false), false)
  assert.equal(isLocalPortableBuild({}, true), false)
  assert.equal(isLocalPortableBuild({ PORTABLE_EXECUTABLE_DIR: '   ' }, true), false)
})
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

```powershell
node --experimental-strip-types --test tests/build-variant.test.ts
```

Expected: FAIL vì `src/shared/build-variant.ts` chưa tồn tại.

- [ ] **Step 3: Implement helper tối thiểu**

```ts
export const LOCAL_APP_ID = 'com.nhathaofn.tblao.local'
export const LOCAL_APP_NAME = 'T-blao Local'
export const LOCAL_USER_DATA_DIRECTORY = 'T-blao Local Data'

export function isLocalPortableBuild(
  env: Record<string, string | undefined>,
  isPackaged: boolean
): boolean {
  return isPackaged && Boolean(env.PORTABLE_EXECUTABLE_DIR?.trim())
}
```

- [ ] **Step 4: Chạy test xanh và đăng ký script**

Thêm test file vào `test:unit`, rồi chạy `npm.cmd run test:unit`. Expected: toàn bộ test pass, gồm test mới.

---

### Task 2: Cô lập runtime Main và updater

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/updater.ts`

**Interfaces:**
- Consumes `isLocalPortableBuild`, `LOCAL_APP_ID`, `LOCAL_USER_DATA_DIRECTORY` từ `src/shared/build-variant.ts`.
- `src/main/index.ts` gọi `app.setPath('userData', join(PORTABLE_EXECUTABLE_DIR, LOCAL_USER_DATA_DIRECTORY))` trước `app.requestSingleInstanceLock()` nếu không có `TBLAO_USER_DATA_DIR` override.
- `src/main/updater.ts` giữ status `none` và không gọi autoUpdater trong local portable.

- [ ] **Step 1: Áp dụng userData trước single-instance lock**

Giữ precedence: `TBLAO_USER_DATA_DIR` trước; nếu không có thì packaged portable có `PORTABLE_EXECUTABLE_DIR` dùng thư mục `T-blao Local Data` cạnh executable. Đặt AppUserModelId local và tiêu đề `T-blao Local`; bản thường vẫn là `T-blao`.

- [ ] **Step 2: Tắt updater đúng cả ba đường gọi**

Trong `initAutoUpdate`, `checkForUpdates` và `quitAndInstall`, điều kiện local portable phải trả sớm. `checkForUpdates` publish `{ state: 'none' }` để UI không treo ở `checking`.

- [ ] **Step 3: Chạy typecheck**

```powershell
npm.cmd run typecheck
```

Expected: Node/Web typecheck pass.

---

### Task 3: Config và lệnh build portable local

**Files:**
- Create: `electron-builder.local.yml`
- Modify: `package.json`

**Interfaces:**
- Produces `npm run package:win:local`.
- Produces `dist-local/T-blao-Local-<version>-portable.exe`.

- [ ] **Step 1: Tạo config kế thừa config chuẩn**

```yaml
extends: electron-builder.yml
appId: com.nhathaofn.tblao.local
productName: T-blao Local
directories:
  output: dist-local
win:
  target:
    - portable
  icon: build/icon.ico
  signAndEditExecutable: false
  artifactName: ${productName}-${version}-portable.${ext}
publish: null
```

- [ ] **Step 2: Thêm script riêng**

```json
"package:win:local": "electron-vite build && electron-builder --config electron-builder.local.yml --win portable -p never"
```

Không đổi `package:win`.

- [ ] **Step 3: Kiểm tra config và build output**

```powershell
npx.cmd electron-builder --config electron-builder.local.yml --win portable --dir
npm.cmd run package:win:local
```

Expected: config resolve được, output nằm trong `dist-local`, artifact có `T-blao-Local` và `portable` trong tên.

---

### Task 4: Tài liệu vận hành

**Files:**
- Create: `docs/LOCAL_PORTABLE_BUILD.md`
- Modify: `README.md`
- Modify: `CODEBASE.md`
- Modify: `docs/CODEBASE_MAP.md`
- Modify: `docs/ENGINES_AND_RUNTIME.md`

- [ ] **Step 1: Ghi lệnh build và data directory**

Tài liệu phải nói rõ `npm run package:win:local`, artifact `dist-local`, thư mục `T-blao Local Data`, khác biệt với `package:win`, và việc không có auto-update GitHub.

- [ ] **Step 2: Rà soát tài liệu không mâu thuẫn**

```powershell
rg -n "package:win:local|electron-builder\.local|T-blao Local|dist-local|PORTABLE_EXECUTABLE_DIR" README.md CODEBASE.md docs
```

Expected: các đường dẫn/lệnh đều trỏ tới config local, không mô tả local như bản release.

---

### Task 5: Xác minh cuối

- [ ] **Step 1: Chạy unit test**

```powershell
npm.cmd run test:unit
```

- [ ] **Step 2: Chạy architecture và typecheck**

```powershell
npm.cmd run typecheck
npm.cmd run check:architecture
```

- [ ] **Step 3: Build production renderer/main**

```powershell
npm.cmd run build
```

- [ ] **Step 4: Kiểm tra artifact local**

```powershell
Get-ChildItem -LiteralPath dist-local -Filter '*portable*.exe' | Select-Object FullName,Length,LastWriteTime
```

Expected: có ít nhất một `.exe` portable, không nằm trong `dist` và không đổi config release.

- [ ] **Step 5: Báo cáo trung thực**

Báo rõ đường dẫn `.exe`, các lệnh đã chạy, và giới hạn: chưa click smoke test trên desktop nếu không khởi chạy artifact trong phiên hiện tại.


