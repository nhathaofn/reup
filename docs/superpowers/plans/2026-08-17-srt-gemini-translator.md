# Dịch SRT bằng Gemini Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Thêm tab 'Dịch SRT' để chọn SRT tiếng Trung, dịch tuần tự sang nhiều ngôn ngữ bằng Gemini, xem trước trong app và xuất riêng hoặc xuất tất cả các file SRT.

**Status:** Đã triển khai và xác minh ngày 2026-08-17. `npm run test:unit` đạt 9/9; `npm run verify` đạt typecheck, architecture và build.

**Architecture:** Tạo một vertical slice feature có namespace 'srt-translator' ở Shared/Main/Preload/Renderer. Main đọc file, gọi lại nghiệp vụ Gemini/SRT hiện có qua hàm dịch nội dung ở bộ nhớ, phát tiến trình và chịu trách nhiệm ghi file qua dialog; Renderer chỉ quản lý state, preview và gọi API an toàn đã expose. Giữ nguyên các IPC core đang phục vụ tab Phụ đề và Đọc chữ video.

**Tech Stack:** Electron 34, React 19, TypeScript strict, Electron IPC/contextBridge, Node built-in test runner với --experimental-strip-types, CSS hiện có của T-blao.

## Global Constraints

- Nguồn luôn được hiển thị là tiếng Trung ở phiên bản đầu; người dùng chọn hoặc nhập nhiều ngôn ngữ đích.
- Mỗi ngôn ngữ đích là một file SRT riêng; preview phải hiển thị trước khi xuất.
- Có nút xuất riêng từng file và nút 'Xuất tất cả'; không ghi đè âm thầm file nguồn hoặc file đầu ra đã tồn tại.
- Timestamp và số cue không được gửi cho Gemini; chỉ text cue được dịch, sau đó ghép lại bằng timestamp tại máy.
- API key chỉ dùng cơ chế lưu key Gemini hiện có; không lưu key hoặc nội dung dịch vào localStorage.
- Một target lỗi không làm mất các target đã thành công; batch chạy tuần tự để kiểm soát rate limit và tiến trình.
- Không thêm dependency runtime mới; dùng dialog/API và mẫu feature hiện có.
- Không sửa luồng OpenAI hiện tại.
- Ảnh đính kèm là tham chiếu bố cục, không phải nguồn yêu cầu chức năng.
- Repository hiện không có thư mục .git, vì vậy không tạo commit giả; thay checkpoint commit bằng kiểm tra diff và trạng thái file.

---

## Bản đồ file trước khi triển khai

### Tạo mới

- tests/srt-translator-contract.test.ts: test helper target language, slug và tên file.
- tests/translate-shared.test.ts: test ghép bản dịch vào SRT mà không đổi timestamp.
- tests/srt-translator-batch.test.ts: test batch partial success và progress.
- tests/srt-translator-ui-model.test.ts: test điều kiện chạy và trạng thái preview.
- src/shared/features/srt-translator.ts: metadata, IPC channels, type contract và helper thuần.
- src/main/services/srt-translator-logic.ts: orchestration batch thuần, nhận translator qua dependency injection.
- src/main/features/srt-translator.ts: Main IPC load/translate/export.
- src/preload/features/srt-translator.ts: API contextBridge của feature.
- src/renderer/src/features/srt-translator/model.ts: state helper thuần cho renderer.
- src/renderer/src/features/srt-translator/index.tsx: giao diện tab.
- src/renderer/src/features/srt-translator/styles.css: CSS riêng của tab.

### Chỉnh sửa

- src/shared/types.ts: thêm preset tiếng Thái vào danh sách gợi ý chung để prompt Gemini có nhãn đúng.
- src/main/translate-shared.ts: thêm helper ghép rows dịch vào blocks SRT.
- src/main/gemini.ts: tách hàm dịch raw SRT ở bộ nhớ; giữ wrapper file hiện tại.
- src/main/features/registry.ts: đăng ký Main feature.
- src/preload/features/registry.ts: đăng ký Preload feature.
- src/renderer/src/features/registry.ts: đăng ký Renderer feature.
- package.json: thêm script test:unit dùng Node test runner.
- CODEBASE.md, docs/CODEBASE_MAP.md, docs/IPC_AND_FEATURES.md, README.md: ghi nhận feature mới sau khi code hoàn tất.

---

### Task 1: Contract, target language helpers và test harness

**Files:**
- Create: tests/srt-translator-contract.test.ts
- Create: src/shared/features/srt-translator.ts
- Modify: src/shared/types.ts
- Modify: package.json

**Interfaces:**
- Produces FEATURE_ID, FEATURE_META, FEATURE_CHANNELS.
- Produces SrtTargetLanguage, SrtLoadRequest, SrtLoadResult, SrtTranslateRequest, SrtTranslationResult, SrtTranslateResult, SrtTranslateProgress, SrtExportItem, SrtExportOneRequest, SrtExportAllRequest, SrtExportResult.
- Produces createTargetLanguage(label, code?), dedupeTargetLanguages(targets), slugifyLanguage(target, fallbackIndex?), makeOutputFileName(sourceName, target, fallbackIndex).

- [ ] **Step 1: Viết test đỏ cho helper target và tên file**

Tạo test với đúng hành vi sau:

~~~ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createTargetLanguage,
  dedupeTargetLanguages,
  makeOutputFileName,
  type SrtTargetLanguage
} from '../src/shared/features/srt-translator.ts'

test('chuẩn hóa ngôn ngữ tự nhập và mã preset', () => {
  assert.deepEqual(createTargetLanguage('  Tiếng Thái  '), {
    id: 'tieng-thai',
    label: 'Tiếng Thái'
  })
  assert.deepEqual(createTargetLanguage('Tiếng Nhật', 'ja'), {
    id: 'ja',
    label: 'Tiếng Nhật',
    code: 'ja'
  })
  assert.equal(createTargetLanguage('   '), null)
})

test('loại target trùng theo mã hoặc nhãn chuẩn hóa', () => {
  const targets = [
    { id: 'vi', label: 'Tiếng Việt', code: 'vi' },
    { id: 'vi-2', label: ' tiếng việt ' },
    { id: 'tieng-thai', label: 'Tiếng Thái' }
  ] satisfies SrtTargetLanguage[]

  assert.deepEqual(dedupeTargetLanguages(targets), [
    { id: 'vi', label: 'Tiếng Việt', code: 'vi' },
    { id: 'tieng-thai', label: 'Tiếng Thái' }
  ])
})

test('tạo tên file không chứa path traversal và giữ basename nguồn', () => {
  assert.equal(
    makeOutputFileName('C:\\subs\\video.srt', { id: 'ja', label: 'Tiếng Nhật', code: 'ja' }, 0),
    'video.ja.srt'
  )
  assert.equal(
    makeOutputFileName('/tmp/clip.srt', { id: 'tieng-thai', label: 'Tiếng Thái' }, 1),
    'clip.tieng-thai.srt'
  )
  assert.equal(
    makeOutputFileName('../clip.srt', { id: 'x', label: '../../' }, 2),
    'clip.lang-3.srt'
  )
})
~~~

- [ ] **Step 2: Chạy test để xác nhận đang đỏ**

Run:

~~~text
node --experimental-strip-types --test tests/srt-translator-contract.test.ts
~~~

Expected: FAIL với lỗi không tìm thấy module src/shared/features/srt-translator.ts hoặc các export chưa tồn tại.

- [ ] **Step 3: Implement contract và helper tối thiểu**

Tạo src/shared/features/srt-translator.ts với các quy tắc:

- FEATURE_ID là 'srt-translator'.
- Metadata: label 'Dịch SRT', icon '🌐', title 'Dịch file SRT bằng Gemini', subtitle mô tả dịch phụ đề tiếng Trung, placement là 'main', keepAlive là true.
- Channels chỉ dùng prefix feature: load, translate, progress, exportOne, exportAll.
- createTargetLanguage trim và gộp whitespace; nếu có code thì id là code lowercase, nếu không thì id là slug nhãn; nhãn rỗng trả null.
- Slug dùng Unicode NFD, bỏ dấu và ký tự không phải chữ/số, đổi chuỗi phân cách thành '-'; không cho phép dấu chấm đường dẫn, slash hoặc backslash.
- dedupeTargetLanguages giữ phần tử đầu tiên; mỗi target đóng góp cả key code (nếu có) và key nhãn chuẩn hóa lowercase, nên target trùng mã hoặc trùng nhãn đều bị loại.
- makeOutputFileName lấy basename sau dấu slash/backslash, bỏ đuôi .srt không phân biệt hoa thường, thêm .<slug>.srt; slug rỗng dùng lang-<fallbackIndex + 1>.

Contract phải có shape sau để Main, Preload và Renderer dùng cùng một kiểu dữ liệu:

~~~ts
export interface SrtTargetLanguage {
  id: string
  label: string
  code?: string
}

export interface SrtLoadRequest { sourcePath: string }
export interface SrtLoadResult {
  ok: boolean
  sourcePath: string
  sourceText?: string
  count?: number
  error?: string
}

export interface SrtTranslateRequest {
  sourcePath: string
  targets: SrtTargetLanguage[]
}

export interface SrtTranslationResult {
  target: SrtTargetLanguage
  ok: boolean
  srt?: string
  count?: number
  error?: string
}

export interface SrtTranslateResult {
  ok: boolean
  sourcePath: string
  sourceText?: string
  translations: SrtTranslationResult[]
  error?: string
}

export interface SrtTranslateProgress {
  targetId: string
  targetLabel: string
  targetIndex: number
  totalTargets: number
  done: number
  total: number
  percent: number
  message: string
}

export interface SrtExportItem {
  target: SrtTargetLanguage
  ok: boolean
  srt?: string
  count?: number
  error?: string
}

export interface SrtExportOneRequest {
  sourceName: string
  item: SrtExportItem
}

export interface SrtExportAllRequest {
  sourceName: string
  items: SrtExportItem[]
}

export interface SrtExportResult {
  ok: boolean
  cancelled?: boolean
  paths?: string[]
  error?: string
}
~~~

Bổ sung { code: 'th', label: 'Tiếng Thái' } vào DICH_LANGS trong src/shared/types.ts.

Thêm vào package.json:

~~~json
"test:unit": "node --experimental-strip-types --test tests/srt-translator-contract.test.ts tests/translate-shared.test.ts tests/srt-translator-batch.test.ts tests/srt-translator-ui-model.test.ts"
~~~

Ở thời điểm thêm script, các test chưa tồn tại vẫn được tạo ở task tương ứng trước khi chạy toàn bộ script.

- [ ] **Step 4: Chạy test để xác nhận xanh**

Run:

~~~text
node --experimental-strip-types --test tests/srt-translator-contract.test.ts
~~~

Expected: PASS toàn bộ test helper.

- [ ] **Step 5: Kiểm tra nhanh contract không trùng reserved ID**

Run:

~~~text
node scripts/check-architecture.mjs
~~~

Expected: unit contract xanh. Architecture checker sẽ báo thiếu registry trong checkpoint trung gian cho tới khi Task 4 đăng ký đủ ba layer; đó là trạng thái tạm thời, không phải kết quả cuối.

---

### Task 2: Refactor Gemini thành hàm dịch raw SRT và bảo toàn timestamp

**Files:**
- Create: tests/translate-shared.test.ts
- Modify: src/main/translate-shared.ts
- Modify: src/main/gemini.ts

**Interfaces:**
- Produces mergeTranslatedBlocks(blocks, rows).
- Produces translateSrtText(raw, dich, onProgress?) => Promise<{ ok: boolean; srt?: string; count?: number; error?: string }>.
- Keeps existing translateSrt(srtPath, outPath, dich, onProgress?) signature and return shape unchanged.
- Consumes SrtBlock, parseSrt, buildSrt, chia, huongDan.

- [ ] **Step 1: Viết test đỏ cho ghép bản dịch**

Tạo tests/translate-shared.test.ts:

~~~ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeTranslatedBlocks } from '../src/shared/features/srt-translator.ts'

test('ghép bản dịch theo số cue nhưng giữ nguyên timestamp', () => {
  const source = parseSrt(
    [
      '1',
      '00:00:01,000 --> 00:00:02,000',
      '你好',
      '',
      '2',
      '00:00:03,000 --> 00:00:04,000',
      '再见'
    ].join('\\n')
  )

  const merged = mergeTranslatedBlocks(source, [
    { n: 1, t: 'Xin chào' },
    { n: 2, t: 'Tạm biệt' }
  ])

  assert.deepEqual(merged, [
    { time: '00:00:01,000 --> 00:00:02,000', text: 'Xin chào' },
    { time: '00:00:03,000 --> 00:00:04,000', text: 'Tạm biệt' }
  ])
  assert.equal(
    buildSrt(merged),
    [
      '1',
      '00:00:01,000 --> 00:00:02,000',
      'Xin chào',
      '',
      '2',
      '00:00:03,000 --> 00:00:04,000',
      'Tạm biệt',
      ''
    ].join('\\n')
  )
})

test('thiếu row dịch thì giữ nguyên text gốc', () => {
  const source = parseSrt('1\\n00:00:01,000 --> 00:00:02,000\\n原文\\n')
  const merged = mergeTranslatedBlocks(source, [])
  assert.equal(merged[0]?.text, '原文')
})
~~~

- [ ] **Step 2: Chạy test để xác nhận đang đỏ**

Run:

~~~text
node --experimental-strip-types --test tests/translate-shared.test.ts
~~~

Expected: FAIL vì mergeTranslatedBlocks chưa được export từ shared contract.

- [ ] **Step 3: Implement helper và refactor Gemini**

Trong src/shared/features/srt-translator.ts, thêm:

~~~ts
export function mergeTranslatedBlocks(
  blocks: SrtBlock[],
  rows: readonly { n: number; t: string }[]
): SrtBlock[] {
  const map = new Map(rows.map((row) => [row.n, row.t]))
  return blocks.map((block, index) => ({
    time: block.time,
    text: map.get(index + 1) || block.text
  }))
}
~~~

Trong src/main/gemini.ts:

1. Di chuyển phần đọc key, parse blocks, lấy model, chia chunk, gọi goiCoLui, parse JSON và build kết quả vào translateSrtText.
2. Dùng mergeTranslatedBlocks thay cho Map/map inline.
3. Khi thành công trả { ok: true, srt: buildSrt(translatedBlocks), count: translatedBlocks.length }.
4. Khi lỗi giữ nguyên các thông báo hiện tại: Chưa có API key., File phụ đề trống., Kết quả dịch không đọc được. và lỗi Gemini qua errLabel.
5. Giữ callback progress theo số chunk của một target.
6. Đổi translateSrt thành wrapper: đọc srtPath, gọi translateSrtText, nếu thành công ghi result.srt vào outPath, rồi trả ok/count như trước. Không thay đổi các alias core ở src/main/index.ts.

- [ ] **Step 4: Chạy test và kiểm tra type của refactor**

Run:

~~~text
node --experimental-strip-types --test tests/translate-shared.test.ts tests/srt-translator-contract.test.ts
npm run typecheck:node
~~~

Expected: test xanh; typecheck node xanh khi dependency đã được cài. Nếu môi trường chưa có node_modules, chạy npm ci trước các script dự án và không đổi version trong lockfile.

---

### Task 3: Batch orchestration, load IPC và export IPC ở Main

**Files:**
- Create: tests/srt-translator-batch.test.ts
- Create: src/main/services/srt-translator-logic.ts
- Create: src/main/features/srt-translator.ts

**Interfaces:**
- Produces runSrtTranslationBatch(sourcePath, sourceText, targets, translateTarget, emitProgress).
- Produces Main handlers cho FEATURE_CHANNELS.load, translate, exportOne, exportAll.
- Consumes translateSrtText, geminiHasKey, parseSrt, makeOutputFileName và shared feature contract.

- [ ] **Step 1: Viết test đỏ cho batch partial success**

Tạo test dùng translator giả để không gọi mạng:

~~~ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  runSrtTranslationBatch,
  type TranslateTarget
} from '../src/main/services/srt-translator-logic.ts'

test('giữ target thành công khi target sau bị lỗi', async () => {
  const progress: { targetId: string; targetIndex: number; done: number; total: number }[] = []
  const targets = [
    { id: 'vi', label: 'Tiếng Việt', code: 'vi' },
    { id: 'ja', label: 'Tiếng Nhật', code: 'ja' }
  ]

  const translateTarget: TranslateTarget = async (_raw, target, onChunk) => {
    onChunk(1, 1)
    return target.id === 'vi'
      ? { ok: true, srt: '1\\n00:00:01,000 --> 00:00:02,000\\nXin chào\\n', count: 1 }
      : { ok: false, error: 'Giới hạn Gemini.' }
  }

  const result = await runSrtTranslationBatch(
    'video.srt',
    '1\\n00:00:01,000 --> 00:00:02,000\\n你好\\n',
    targets,
    translateTarget,
    (event) => progress.push({
      targetId: event.targetId,
      targetIndex: event.targetIndex,
      done: event.done,
      total: event.total
    })
  )

  assert.equal(result.ok, true)
  assert.equal(result.translations[0]?.srt?.includes('Xin chào'), true)
  assert.equal(result.translations[1]?.error, 'Giới hạn Gemini.')
  assert.deepEqual(progress.map((item) => item.targetId), ['vi', 'ja'])
  assert.equal(progress.at(-1)?.targetIndex, 1)
})
~~~

- [ ] **Step 2: Chạy test để xác nhận đang đỏ**

Run:

~~~text
node --experimental-strip-types --test tests/srt-translator-batch.test.ts
~~~

Expected: FAIL vì module orchestration chưa tồn tại.

- [ ] **Step 3: Implement orchestration thuần**

Tạo src/main/services/srt-translator-logic.ts:

~~~ts
import type {
  SrtTargetLanguage,
  SrtTranslateProgress,
  SrtTranslateResult,
  SrtTranslationResult
} from '../../shared/features/srt-translator'

export type TranslateTarget = (
  sourceText: string,
  target: SrtTargetLanguage,
  onChunk: (done: number, total: number) => void
) => Promise<{ ok: boolean; srt?: string; count?: number; error?: string }>

export async function runSrtTranslationBatch(
  sourcePath: string,
  sourceText: string,
  targets: readonly SrtTargetLanguage[],
  translateTarget: TranslateTarget,
  emitProgress: (progress: SrtTranslateProgress) => void
): Promise<SrtTranslateResult> {
  const translations: SrtTranslationResult[] = []

  for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
    const target = targets[targetIndex]
    const result = await translateTarget(sourceText, target, (done, total) => {
      const fraction = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0
      emitProgress({
        targetId: target.id,
        targetLabel: target.label,
        targetIndex,
        totalTargets: targets.length,
        done,
        total,
        percent: ((targetIndex + fraction) / targets.length) * 100,
        message: 'Đang dịch ' + target.label + '…'
      })
    })
    translations.push({ target, ...result })
  }

  const successCount = translations.filter((item) => item.ok && Boolean(item.srt)).length
  return {
    ok: successCount > 0,
    sourcePath,
    sourceText,
    translations,
    error: successCount > 0 ? undefined : 'Không có ngôn ngữ nào dịch thành công.'
  }
}
~~~

- [ ] **Step 4: Chạy test để xác nhận xanh**

Run:

~~~text
node --experimental-strip-types --test tests/srt-translator-batch.test.ts tests/translate-shared.test.ts
~~~

Expected: PASS; target lỗi vẫn nằm trong translations[], target thành công vẫn có srt.

- [ ] **Step 5: Implement Main feature handlers**

Tạo src/main/features/srt-translator.ts với các phần sau:

1. Import dialog từ Electron, readFile/writeFile/access từ node:fs/promises, basename/extname/join từ node:path, shared contract, parseSrt, geminiHasKey, translateSrtText, runSrtTranslationBatch.
2. Handler load:
   - kiểm tra sourcePath là chuỗi không rỗng và có đuôi .srt;
   - đọc UTF-8;
   - parse bằng parseSrt;
   - trả { ok: false, sourcePath, error: 'File phụ đề trống hoặc không đúng định dạng SRT.' } nếu không có cue;
   - thành công trả { ok: true, sourcePath, sourceText, count }.
3. Handler translate:
   - validate source path và target list sau dedupeTargetLanguages;
   - đọc/parse nguồn một lần;
   - nếu geminiHasKey() false, trả source text và lỗi 'Chưa có API key Gemini. Hãy kết nối Gemini trước khi dịch.';
   - gọi runSrtTranslationBatch, truyền translateSrtText(sourceText, target.code ?? target.label, onChunk);
   - dùng emit(FEATURE_CHANNELS.progress, event) cho mọi chunk;
   - bắt lỗi riêng từng target để batch tiếp tục và tạo { ok: false, error }.
4. Handler exportOne:
   - chỉ nhận item có ok: true và srt không rỗng;
   - đề xuất tên từ makeOutputFileName(sourceName, target, 0);
   - mở dialog.showSaveDialog với filter Phụ đề (*.srt);
   - hủy dialog trả { ok: false, cancelled: true };
   - ghi UTF-8 và trả { ok: true, paths: [filePath] }.
5. Handler exportAll:
   - lọc target thành công;
   - mở dialog.showOpenDialog với openDirectory/createDirectory;
   - hủy trả cancelled:true;
   - sinh tên bằng makeOutputFileName;
   - nếu file tồn tại, thử (1), (2) trước đuôi .srt tới khi tên chưa tồn tại;
   - ghi từng file UTF-8 và trả toàn bộ paths;
   - không bao giờ dùng sourcePath làm output path.

- [ ] **Step 6: Chạy kiểm tra Main feature**

Run:

~~~text
npm run typecheck:node
node scripts/check-architecture.mjs
~~~

Expected: typecheck node và kiểm tra architecture xanh sau khi registry được cập nhật ở Task 4; nếu chạy riêng trước Task 4 thì chỉ ghi nhận import chưa đăng ký.

---

### Task 4: Preload API và registry

**Files:**
- Create: src/preload/features/srt-translator.ts
- Modify: src/main/features/registry.ts
- Modify: src/preload/features/registry.ts
- Modify: src/renderer/src/features/registry.ts

**Interfaces:**
- Produces window.api.loadSrtTranslator, window.api.runSrtTranslator, window.api.exportSrtTranslatorOne, window.api.exportSrtTranslatorAll, window.api.onSrtTranslatorProgress.
- Consumes FEATURE_CHANNELS và các type từ src/shared/features/srt-translator.ts.
- Không sửa src/main/index.ts; registerMainFeatures(() => mainWindow) đã đăng ký registry.

- [ ] **Step 1: Viết preload feature theo contract**

Tạo API với shape:

~~~ts
const api = {
  loadSrtTranslator: (request: SrtLoadRequest): Promise<SrtLoadResult> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.load, request),
  runSrtTranslator: (request: SrtTranslateRequest): Promise<SrtTranslateResult> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.translate, request),
  exportSrtTranslatorOne: (request: SrtExportOneRequest): Promise<SrtExportResult> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.exportOne, request),
  exportSrtTranslatorAll: (request: SrtExportAllRequest): Promise<SrtExportResult> =>
    ipcRenderer.invoke(FEATURE_CHANNELS.exportAll, request),
  onSrtTranslatorProgress: (
    listener: (progress: SrtTranslateProgress) => void
  ): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: SrtTranslateProgress): void =>
      listener(progress)
    ipcRenderer.on(FEATURE_CHANNELS.progress, wrapped)
    return () => ipcRenderer.removeListener(FEATURE_CHANNELS.progress, wrapped)
  }
}
~~~

Export object srtTranslatorPreloadFeature với id FEATURE_ID.

- [ ] **Step 2: Đăng ký cả ba lớp**

Chèn import và module sau marker feature-scaffold:imports và feature-scaffold:modules:

- Main: srtTranslatorMainFeature.
- Preload: srtTranslatorPreloadFeature.
- Renderer: srtTranslatorRendererFeature khi file renderer đã tồn tại.

Không thêm method trùng coreApi; mergeFeatureApis phải giữ collision guard.

- [ ] **Step 3: Chạy architecture/typecheck**

Run:

~~~text
node scripts/check-architecture.mjs
npm run typecheck:node
npm run typecheck:web
~~~

Expected: registry nhận feature ID không reserved; preload API có type inference qua TblaoApi = typeof api; không có channel ngoài namespace srt-translator:.

---

### Task 5: Renderer state model và giao diện tab

**Files:**
- Create: tests/srt-translator-ui-model.test.ts
- Create: src/renderer/src/features/srt-translator/model.ts
- Create: src/renderer/src/features/srt-translator/index.tsx
- Create: src/renderer/src/features/srt-translator/styles.css
- Modify: src/renderer/src/features/registry.ts

**Interfaces:**
- Produces SrtTargetView, createTargetViews(targets), applyTranslationResults(views, results), progressPercent(progress), canStartTranslation(sourcePath, targets, geminiReady, running).
- Consumes các preload methods từ Task 4 và shared contract từ Task 1.
- Produces Renderer metadata object srtTranslatorRendererFeature với keepAlive true.

- [ ] **Step 1: Viết test đỏ cho state model**

Tạo test:

~~~ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyTranslationResults,
  canStartTranslation,
  createTargetViews,
  progressPercent
} from '../src/renderer/src/features/srt-translator/model.ts'

const targets = [
  { id: 'vi', label: 'Tiếng Việt', code: 'vi' },
  { id: 'ja', label: 'Tiếng Nhật', code: 'ja' }
]

test('chỉ cho chạy khi có nguồn, target, key và không đang chạy', () => {
  assert.equal(canStartTranslation('video.srt', targets, true, false), true)
  assert.equal(canStartTranslation('', targets, true, false), false)
  assert.equal(canStartTranslation('video.srt', [], true, false), false)
  assert.equal(canStartTranslation('video.srt', targets, false, false), false)
  assert.equal(canStartTranslation('video.srt', targets, true, true), false)
})

test('apply kết quả giữ trạng thái lỗi và thành công theo target', () => {
  const views = createTargetViews(targets)
  const next = applyTranslationResults(views, [
    { target: targets[0], ok: true, srt: 'vi.srt', count: 1 },
    { target: targets[1], ok: false, error: 'Rate limit' }
  ])
  assert.equal(next[0]?.status, 'done')
  assert.equal(next[0]?.srt, 'vi.srt')
  assert.equal(next[1]?.status, 'error')
  assert.equal(next[1]?.error, 'Rate limit')
})

test('tính phần trăm progress an toàn', () => {
  assert.equal(progressPercent({
    targetId: 'vi',
    targetLabel: 'Tiếng Việt',
    targetIndex: 0,
    totalTargets: 2,
    done: 1,
    total: 2,
    percent: 25,
    message: ''
  }), 25)
  assert.equal(progressPercent(null), 0)
})
~~~

- [ ] **Step 2: Chạy test để xác nhận đang đỏ**

Run:

~~~text
node --experimental-strip-types --test tests/srt-translator-ui-model.test.ts
~~~

Expected: FAIL vì model.ts chưa tồn tại.

- [ ] **Step 3: Implement state model tối thiểu**

Tạo các type/hàm:

~~~ts
export type SrtTargetStatus = 'queued' | 'running' | 'done' | 'error'

export interface SrtTargetView extends SrtTargetLanguage {
  status: SrtTargetStatus
  srt?: string
  count?: number
  error?: string
  exportedPath?: string
}

export function createTargetViews(targets: readonly SrtTargetLanguage[]): SrtTargetView[]
export function applyTranslationResults(
  views: readonly SrtTargetView[],
  results: readonly SrtTranslationResult[]
): SrtTargetView[]
export function progressPercent(progress: SrtTranslateProgress | null): number
export function canStartTranslation(
  sourcePath: string,
  targets: readonly SrtTargetLanguage[],
  geminiReady: boolean,
  running: boolean
): boolean
~~~

applyTranslationResults cập nhật theo target.id, đặt done chỉ khi ok && srt, đặt error khi target thất bại và không xóa target khác.

- [ ] **Step 4: Chạy test để xác nhận xanh**

Run:

~~~text
node --experimental-strip-types --test tests/srt-translator-ui-model.test.ts tests/srt-translator-contract.test.ts
~~~

Expected: PASS.

- [ ] **Step 5: Implement component theo bố cục đã duyệt**

Trong index.tsx:

1. State: sourcePath, sourceText, sourceCount; targets, draftTarget, selectedTargetId; targetViews, running, progress, error, geminiReady, keyInput, keyStatus, exportMessage.
2. Khi mount: gọi window.api.geminiHasKey(); đăng ký window.api.onSrtTranslatorProgress và cleanup unsubscribe.
3. Chọn nguồn: gọi window.api.chooseSrt(); gọi window.api.loadSrtTranslator({ sourcePath }); thành công hiển thị raw SRT ngay, lưu số cue và reset bản dịch cũ; lỗi hiển thị message, không làm mất source cũ nếu dialog bị hủy.
4. Preset: render các DICH_LANGS trừ zh thành nút thêm nhanh; ô nhập cho nhãn tự do; Enter và nút Thêm đều gọi createTargetLanguage; dùng dedupeTargetLanguages, chọn target đầu tiên sau khi thêm.
5. Gemini connection: hiển thị trạng thái Đã kết nối hoặc Chưa kết nối; nhập key chỉ giữ trong state tạm thời; nếu có input, gọi geminiSaveKey rồi geminiCheckKey; nếu input rỗng và đã lưu, chỉ gọi geminiCheckKey(''); khi thành công xóa input và cập nhật geminiReady; nút ngắt kết nối gọi geminiSaveKey('').
6. Dịch: canStartTranslation điều khiển nút; đặt mọi view về queued, reset error/export message; gọi runSrtTranslator({ sourcePath, targets }); dùng applyTranslationResults, chọn target đầu tiên thành công hoặc target đầu tiên; nếu result.ok false hiển thị lỗi batch nhưng vẫn giữ result thành công.
7. Preview: cột trái là textarea readOnly với source SRT; cột phải là textarea readOnly của target đang chọn; chip target hiển thị label và trạng thái; chip done có nút Xuất; target queued/running/error hiển thị dòng thông báo trạng thái.
8. Xuất: exportSrtTranslatorOne({ sourceName: sourcePath, item }) cho target done; exportSrtTranslatorAll({ sourceName: sourcePath, items: doneItems }) cho nút chung; sau khi thành công lưu đường dẫn và hiển thị tên file; khi hủy không hiện lỗi.
9. Không cho sửa trực tiếp nội dung preview; không tự dịch khi vừa chọn file.

Trong styles.css:

- workspace fill chiều cao tab, cuộn theo nội dung;
- card chọn file/key/target dùng card, btn, btn primary, muted hiện có;
- grid preview hai cột minmax(0, 1fr) minmax(0, 1fr), khoảng cách 12px;
- textarea nền var(--panel-2), border var(--control-border), min-height tối thiểu 360px, resize theo chiều dọc;
- target chips cuộn ngang, status dùng màu var(--ok), var(--fail), var(--muted);
- breakpoint khoảng 900px chuyển preview thành một cột;
- không chỉnh global selector để tránh ảnh hưởng các tab khác.

- [ ] **Step 6: Đăng ký Renderer feature và chạy kiểm tra**

Đăng ký srtTranslatorRendererFeature trong registry, sau đó chạy:

~~~text
npm run typecheck:web
node scripts/check-architecture.mjs
~~~

Expected: tab renderer có metadata hợp lệ; window.api nhận đủ method; không trùng feature ID hoặc API method.

---

### Task 6: Cập nhật tài liệu codebase và script kiểm tra

**Files:**
- Modify: CODEBASE.md
- Modify: docs/CODEBASE_MAP.md
- Modify: docs/IPC_AND_FEATURES.md
- Modify: README.md

**Interfaces:**
- Documents the new feature ID, file map, IPC channels, Gemini text helper, output behavior and test command.
- Does not alter runtime behavior.

- [ ] **Step 1: Cập nhật bản đồ codebase**

Bổ sung feature srt-translator vào các bảng/danh sách tương ứng:

- Renderer tab: component, keepAlive true, hai cột preview, target chips.
- Main: load/translate/export handlers và reuse translateSrtText.
- Preload: 5 method API và listener cleanup.
- Shared: contract/helper và preset language.
- Tests: bốn file Node test.

- [ ] **Step 2: Cập nhật tài liệu IPC**

Trong docs/IPC_AND_FEATURES.md, ghi chính xác:

~~~text
srt-translator:load
srt-translator:translate
srt-translator:progress
srt-translator:export-one
srt-translator:export-all
~~~

Nêu rõ renderer không tự đọc/ghi file; Main đọc UTF-8, gọi Gemini, mở save/folder dialog và tránh ghi đè.

- [ ] **Step 3: Cập nhật README và chạy kiểm tra link**

README chỉ mô tả ngắn tính năng mới và lưu ý cần Gemini API key. Chạy script/kiểm tra Markdown hiện có trong tài liệu codebase để bảo đảm không thêm link tương đối hỏng.

---

### Task 7: Verification và handoff

**Files:**
- Verify: toàn bộ file đã tạo/chỉnh sửa trong các task trước.
- Modify: không thêm file runtime ở bước này.

- [ ] **Step 1: Chạy unit test đầy đủ**

Run:

~~~text
npm run test:unit
~~~

Expected: PASS các test contract, SRT merge, batch partial success và UI model.

- [ ] **Step 2: Chạy architecture và typecheck**

Run:

~~~text
node scripts/check-architecture.mjs
npm run typecheck
~~~

Expected: architecture xanh; typecheck node/web xanh khi dependencies sẵn sàng. Nếu thiếu node_modules, chạy npm ci rồi lặp lại; nếu môi trường vẫn chặn, ghi đúng command và lỗi vào báo cáo, không tuyên bố build pass.

- [ ] **Step 3: Chạy build**

Run:

~~~text
npm run build
~~~

Expected: Electron Vite build tạo output thành công. Nếu build bị chặn bởi dependency/runtime ngoài thay đổi, ghi rõ đó là giới hạn xác minh.

- [ ] **Step 4: Rà soát thay đổi và acceptance checklist**

Dùng các lệnh read-only:

~~~text
rg -n "srt-translator|Dịch SRT|runSrtTranslator|exportSrtTranslator" src docs README.md package.json
Get-ChildItem src/shared/features/srt-translator.ts,src/main/features/srt-translator.ts,src/preload/features/srt-translator.ts,src/renderer/src/features/srt-translator
~~~

Kiểm tra thủ công theo acceptance:

1. Tab xuất hiện trong sidebar.
2. Chọn SRT hiển thị raw source ngay.
3. Chọn hai target, dịch một lượt, thấy progress/chip.
4. Chuyển chip xem đúng preview.
5. Xuất từng target tạo file UTF-8.
6. Xuất tất cả tạo file riêng và tránh overwrite.
7. Target lỗi không xóa target thành công.
8. Thiếu key/file lỗi hiển thị dễ hiểu, app không crash.

- [ ] **Step 5: Báo cáo trung thực**

Bàn giao danh sách file thay đổi, test đã chạy và kết quả thực tế. Không tạo commit vì repository không có Git metadata; không ghi nhận kiểm thử UI/Gemini mạng nếu chưa có API key hoặc chưa chạy app thực tế.


