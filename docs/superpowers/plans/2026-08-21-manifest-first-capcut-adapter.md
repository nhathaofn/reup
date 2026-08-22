# Manifest-first + CapCut Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây V1 Content Block theo hướng manifest-first: phân tích một video/SRT thành block nội dung, chỉnh block thủ công, nhập voice theo locale, tạo biến thể deterministic, dựng timeline/SRT riêng cho từng locale và xuất draft CapCut mà không đưa nghiệp vụ block vào `capCutFactory.ts`.

**Architecture:** Core gồm các hàm thuần cho grouping, boundary, manifest, variant và timeline; mọi trạng thái bền vững đi qua bốn artifact versioned là `SourceBlockManifest`, `LocaleAssetManifest`, `VariantPlan` và `RenderTimeline`. Electron Main chỉ điều phối I/O/FFprobe, Renderer là quy trình năm bước, còn `capCutBlockAdapter.ts` là biên duy nhất chuyển timeline trung lập sang input của `nativeCapCutGenerator.ts`; workflow CapCut/SRT hiện tại tiếp tục chạy nguyên trạng.

**Tech Stack:** Electron 34, React 19, TypeScript 5.7 strict, Node built-in `node:test`/`crypto`/`fs`, FFprobe hiện có, CapCut native draft generator hiện có; không thêm runtime dependency.

**Spec:** `docs/superpowers/specs/2026-08-21-content-block-video-shuffle-design.md`

## Global Constraints

- Schema V1 luôn là integer `schemaVersion: 1`; mọi timestamp canonical dùng integer microseconds, số giây chỉ được tạo tại UI/CapCut adapter.
- V1 nhận đúng một source video, một source SRT và scene manifest do feature `scene-splitter` hiện có tạo ra.
- `Content Block` là semantic unit; scene chỉ là boundary candidate, không được tự trở thành block.
- Pair profile ghép hai cue liên tiếp; cue lẻ phải tồn tại thành block `needs-review`, không được bỏ.
- Boundary window mặc định là `±500 ms`; fallback là SRT end cộng padding cấu hình và luôn có reason `srt-fallback`.
- Pre-roll hợp lệ nằm trong `0–100 ms`; mặc định V1 là `0 ms`. Post-roll và Q/A gap mặc định đều là `100 ms`.
- Media speed soft limit là `0.92–1.08`; hard limit là `0.90–1.12`. Ngoài hard limit phải chặn export và đưa block vào review.
- Voice trong `block-render-timeline` không bị trim và luôn có `speed: 1`; media thích nghi theo voice, không làm ngược lại.
- Không materialize `blocks/*/media.mp4` khi analyze; source range là canonical và source video chỉ được copy/deduplicate khi CapCut adapter xuất draft.
- Video fingerprint là SHA-256 toàn bộ file đọc theo stream. Source manifest fingerprint là SHA-256 của canonical UTF-8 JSON có key sắp xếp đệ quy và không chứa thời gian sinh file.
- Block ID được tạo một lần bằng `block-${randomUUID()}`; merge giữ ID block đầu, split giữ ID ở nửa đầu và cấp ID mới cho nửa sau.
- Locale voice được map bằng cue ID qua `voice-map.json` hoặc tên file có stem đúng cue ID; tuyệt đối không dùng natural file ordering làm canonical mapping.
- Variant chỉ lưu block ID, seed và constraint; cùng manifest + seed + constraint phải cho đúng một `blockOrder` trên mọi lần chạy.
- `shuffleEligible: false` giữ slot; intro khóa đầu, outro/CTA khóa cuối; dependency chain di chuyển như một đơn vị và không được có cycle/branch trong V1.
- SRT locale cuối được sinh mới từ `RenderTimeline`; không giữ timestamp của source/localized SRT.
- `preserve-source-timeline` trong `voiceSync.ts`, `capCutFactory.ts` và `srt-localization.ts` phải giữ nguyên signature/hành vi.
- Core analyzer/planner/timeline không import Electron, React hoặc bất kỳ kiểu CapCut nào.
- Không thêm AI grouping, pattern profile, silence detection, TTS, freeze/loop/B-roll, multi-source pool hoặc FFmpeg MP4 renderer trong V1.
- Không dùng numeric confidence. Chỉ dùng reason code, issue code và review state hữu hạn.
- UI và tài liệu phải nói rõ shuffle không thay đổi quyền sử dụng nguồn và không bảo đảm vượt chính sách reused-content của nền tảng.
- Không sửa draft store thật trong unit/integration test; mọi test filesystem dùng thư mục tạm và template fixture.
- Làm việc trên working tree hiện tại; không stage `.codex-ui-test-data/`, `session_srt_ai_fusion_restore_summary.md` hoặc thay đổi ngoài phạm vi. Mỗi `git add` phải liệt kê đường dẫn cụ thể.

---

## Current Baseline

- `src/main/services/sceneSplitter.ts` ghi `scene-splitter.json` với `sourceVideo`, `startSeconds`, `endSeconds`; manifest hiện có thể chứa scene của nhiều source.
- `src/main/services/srt.ts` đã parse cue và timestamp nhưng chưa cấp cue ID hoặc microseconds.
- `src/main/services/voiceSync.ts` có FFprobe audio duration nhưng đang map file theo thứ tự tự nhiên và ép voice vừa source SRT.
- `src/main/services/nativeCapCutGenerator.ts` đã có `sourceStartSeconds`, nhưng video item chưa có `speed`, source range đang dùng target duration và asset copy chưa deduplicate cùng source.
- `src/main/services/capCutFactory.ts` dài hơn 1.200 dòng và phải tiếp tục là legacy `preserve-source-timeline`; plan này không thêm block logic vào file đó.
- Repo dùng vertical slice Shared/Main/Preload/Renderer, registry có architecture checker, và test TypeScript chạy bằng `node --experimental-strip-types --test`.
- Chưa có test cho content block, scene boundary, variant, locale timeline hoặc native CapCut source range.

## Locked File Structure

| File | Responsibility |
|---|---|
| `src/shared/features/content-blocks.ts` | Schema V1, DTO serializable, defaults, IPC channels và result/progress types |
| `src/main/services/contentBlockManifest.ts` | Runtime validation, canonical JSON, fingerprint, atomic read/write cho bốn artifact |
| `src/main/services/dialogueGrouper.ts` | Pair grouping thuần, standalone cue và issue cho cue lẻ |
| `src/main/services/boundaryResolver.ts` | Candidate filtering/ranking, fallback và source range liên tục |
| `src/main/services/contentBlockAnalyzer.ts` | Parse SRT/scene manifest, phối hợp grouper/resolver, tái sử dụng ID và ghi source manifest |
| `src/main/services/contentBlockEdits.ts` | Pure merge/split/boundary/semantic edit, revision và invariant validation |
| `src/main/services/mediaProbe.ts` | Resolve FFprobe; probe video metadata và audio duration bằng dependency-injectable runner |
| `src/main/services/localeAssetImporter.ts` | Localized SRT → cue text; voice-map/cue-ID filename → voice; duration và import report |
| `src/main/services/blockVariantPlanner.ts` | Dependency units, locked slots và deterministic seeded Fisher–Yates |
| `src/main/services/blockTimeline.ts` | Per-locale duration, speed policy, subtitle positions và timeline validation |
| `src/main/services/blockSrt.ts` | Microseconds → strict SRT serialization |
| `src/main/services/capCutBlockAdapter.ts` | Pure `RenderTimeline` → Native CapCut video/audio/text items |
| `src/main/services/contentBlockWorkflow.ts` | Artifact directory orchestration, fingerprint gates, CapCut export và cancellation |
| `src/main/services/nativeCapCutGenerator.ts` | Thêm video speed, đúng source duration và deduplicate copied source assets |
| `src/main/services/voiceSync.ts` | Dùng audio probe chung nhưng giữ contract/legacy behavior |
| `src/main/features/content-blocks.ts` | Thin Electron IPC/dialog adapter |
| `src/preload/features/content-blocks.ts` | Typed invoke/progress bridge |
| `src/renderer/src/features/content-blocks/model.ts` | Pure five-step UI state, gate và edit helpers |
| `src/renderer/src/features/content-blocks/components/*.tsx` | Source, review, locale, variant và export steps |
| `src/renderer/src/features/content-blocks/index.tsx` | Renderer orchestration only |
| `src/renderer/src/features/content-blocks/styles.css` | Block review/timeline responsive layout |
| `tests/helpers/content-block-fixtures.ts` | Stable manifests, cues, locale assets, variant và fake probe/template fixtures |
| `tests/content-block-*.test.ts` | Unit/integration tests; không cần Electron, CapCut hoặc FFmpeg thật |
| `tests/content-blocks.test.ts` | Test aggregator được nối vào `npm run test:unit` |
| `tests/content-block-capcut-smoke.test.ts` | Opt-in smoke với video/voice/template thật, không dùng draft store mặc định |
| `docs/CONTENT_BLOCKS.md` | Artifact contract, voice-map format, workflow và QA runbook |

## Dependency Flow

```text
Shared contracts
  → Manifest + Grouper + Boundary
  → Analyzer + Manual edits
  → Locale importer + Variant planner
  → Timeline + SRT
  → Native generator capability + CapCut adapter
  → Main workflow / IPC / Preload
  → Renderer five-step UI
  → Integration, smoke, docs and full verification
```

### Task 1: Shared V1 contracts and stable fixtures

**Files:**
- Create: `src/shared/features/content-blocks.ts`
- Create: `src/main/features/content-blocks.ts`
- Create: `src/preload/features/content-blocks.ts`
- Create: `src/renderer/src/features/content-blocks/index.tsx`
- Modify: `src/main/features/registry.ts`
- Modify: `src/preload/features/registry.ts`
- Modify: `src/renderer/src/features/registry.ts`
- Create: `tests/content-block-contract.test.ts`
- Create: `tests/helpers/content-block-fixtures.ts`
- Create: `tests/content-blocks.test.ts`
- Include in first implementation commit: `docs/superpowers/specs/2026-08-21-content-block-video-shuffle-design.md`
- Include in first implementation commit: `docs/superpowers/plans/2026-08-21-manifest-first-capcut-adapter.md`

**Interfaces:**
- Consumes: `FeatureMetadata` from `src/shared/features/contracts.ts`.
- Produces: all schema types, defaults, edit operations, IPC request/result types, `CONTENT_BLOCK_FEATURE_CHANNELS`, and a registered non-actionable feature shell that keeps architecture checks green while the domain is built.

- [ ] **Step 1: Write the failing contract test**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONTENT_BLOCK_DEFAULTS,
  CONTENT_BLOCK_FEATURE_CHANNELS,
  CONTENT_BLOCK_SCHEMA_VERSION,
  FEATURE_ID
} from '../src/shared/features/content-blocks.ts'

test('content-block V1 constants lock timing and speed policy', () => {
  assert.equal(FEATURE_ID, 'content-blocks')
  assert.equal(CONTENT_BLOCK_SCHEMA_VERSION, 1)
  assert.deepEqual(CONTENT_BLOCK_DEFAULTS, {
    boundaryWindowUs: 500_000,
    minimumBlockDurationUs: 500_000,
    srtFallbackPaddingUs: 100_000,
    preRollUs: 0,
    postRollUs: 100_000,
    cueGapUs: 100_000,
    softSpeedMin: 0.92,
    softSpeedMax: 1.08,
    hardSpeedMin: 0.9,
    hardSpeedMax: 1.12
  })
})

test('every content-block channel is feature namespaced', () => {
  assert.deepEqual(Object.keys(CONTENT_BLOCK_FEATURE_CHANNELS), [
    'pickPath', 'analyze', 'editManifest', 'importLocale', 'createVariant',
    'buildTimeline', 'exportCapCut', 'cancel', 'progress'
  ])
  for (const channel of Object.values(CONTENT_BLOCK_FEATURE_CHANNELS)) {
    assert.match(channel, /^content-blocks:/u)
  }
})
```

- [ ] **Step 2: Run the focused test and confirm red**

Run:

```text
node --experimental-strip-types --test tests/content-block-contract.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/shared/features/content-blocks.ts`.

- [ ] **Step 3: Scaffold and immediately replace the generated shell with an exact safe registration shell**

Run the repository generator before the shared file exists:

```text
npm run feature:create -- content-blocks "Khối nội dung"
```

Expected: four feature files and three registry entries are created; generator typecheck and architecture check PASS.

Immediately replace the generated Main/Preload/Renderer bodies so no generated demo contract or unfinished marker remains. Until Task 12, the only callable method is the real cancel contract and the tab is explicitly informational:

```ts
// src/main/features/content-blocks.ts
import {
  CONTENT_BLOCK_FEATURE_CHANNELS as CHANNELS,
  FEATURE_ID,
  type ContentBlockCancelResult
} from '../../shared/features/content-blocks'
import type { MainFeatureModule } from './contracts'

export const contentBlocksMainFeature = {
  id: FEATURE_ID,
  register({ handle }) {
    handle<[], ContentBlockCancelResult>(CHANNELS.cancel, () => ({ ok: true, wasRunning: false }))
  }
} satisfies MainFeatureModule
```

```ts
// src/preload/features/content-blocks.ts
import { ipcRenderer } from 'electron'
import {
  CONTENT_BLOCK_FEATURE_CHANNELS as CHANNELS,
  FEATURE_ID,
  type ContentBlockCancelResult
} from '../../shared/features/content-blocks'
import type { PreloadFeatureModule } from './contracts'

const api = {
  cancelContentBlocks: (): Promise<ContentBlockCancelResult> => ipcRenderer.invoke(CHANNELS.cancel)
}

export const contentBlocksPreloadFeature = {
  id: FEATURE_ID,
  api
} as const satisfies PreloadFeatureModule
```

```tsx
// src/renderer/src/features/content-blocks/index.tsx
import type { JSX } from 'react'
import { FEATURE_ID, FEATURE_META } from '../../../../shared/features/content-blocks'
import type { RendererFeature } from '../contracts'

function ContentBlocksStatusPanel(): JSX.Element {
  return (
    <section className="panel">
      <div className="card">
        <strong>Content Block V1 đang được xây theo manifest-first.</strong>
        <p className="muted">Chưa có thao tác nào được bật trong phiên bản phát triển này.</p>
      </div>
    </section>
  )
}

export const contentBlocksRendererFeature = {
  ...FEATURE_META,
  component: ContentBlocksStatusPanel
} as const satisfies RendererFeature<typeof FEATURE_ID>
```

Do not expose analyze/import/export until their production workflow exists in Task 11.

- [ ] **Step 4: Define metadata, defaults and canonical artifact types**

Create the shared contract with these exact public names and fields:

```ts
import type { FeatureMetadata } from './contracts'

export const FEATURE_ID = 'content-blocks' as const
export const CONTENT_BLOCK_SCHEMA_VERSION = 1 as const

export const FEATURE_META = {
  id: FEATURE_ID,
  label: 'Khối nội dung',
  icon: '🧱',
  title: 'Phân tích và xáo trộn khối nội dung',
  subtitle: 'Manifest-first → timeline riêng từng ngôn ngữ → draft CapCut',
  placement: 'main',
  keepAlive: true
} as const satisfies FeatureMetadata<typeof FEATURE_ID>

export const CONTENT_BLOCK_DEFAULTS = {
  boundaryWindowUs: 500_000,
  minimumBlockDurationUs: 500_000,
  srtFallbackPaddingUs: 100_000,
  preRollUs: 0,
  postRollUs: 100_000,
  cueGapUs: 100_000,
  softSpeedMin: 0.92,
  softSpeedMax: 1.08,
  hardSpeedMin: 0.9,
  hardSpeedMax: 1.12
} as const

export type Microseconds = number
export type ContentCueRole = 'question' | 'answer' | 'statement'
export type ContentBlockRole = 'normal' | 'intro' | 'outro' | 'cta'
export type BoundaryReason =
  | 'exact-scene-match' | 'scene-near-srt' | 'srt-fallback' | 'manual-adjusted'
export type ReviewState = 'accepted' | 'needs-review' | 'locked'
export type ContentBlockIssue = 'odd-unpaired-cue' | 'srt-fallback' | 'manual-adjusted'
export type MediaAdaptation =
  | 'stretch-within-soft-limit' | 'stretch-with-warning' | 'needs-review'

export interface SourceDialogueCue {
  cueId: string
  sourceIndex: number
  role: ContentCueRole
  text: string
  sourceStartUs: Microseconds
  sourceEndUs: Microseconds
}

export interface SourceContentBlock {
  id: string
  sourceRange: { startUs: Microseconds; endUs: Microseconds }
  cueIds: string[]
  dialogue: SourceDialogueCue[]
  boundary: {
    targetUs: Microseconds
    selectedUs: Microseconds
    reason: BoundaryReason
    reviewState: ReviewState
  }
  semantic: {
    role: ContentBlockRole
    shuffleEligible: boolean
    requiresPreviousBlockId: string | null
  }
  issues: ContentBlockIssue[]
}

export interface SourceBlockManifest {
  schemaVersion: typeof CONTENT_BLOCK_SCHEMA_VERSION
  source: {
    path: string
    fingerprint: `sha256:${string}`
    durationUs: Microseconds
    fps: number
  }
  revision: number
  blocks: SourceContentBlock[]
}

export interface LocaleCueAsset {
  cueId: string
  text: string
  voicePath: string
  voiceDurationUs: Microseconds
}

export interface LocaleAssetManifest {
  schemaVersion: typeof CONTENT_BLOCK_SCHEMA_VERSION
  sourceManifestFingerprint: `sha256:${string}`
  locale: string
  blocks: Record<string, { cues: LocaleCueAsset[] }>
}

export interface VariantConstraints {
  lockedStartBlockIds: string[]
  lockedEndBlockIds: string[]
  preserveDependencyChains: true
}

export interface VariantPlan {
  schemaVersion: typeof CONTENT_BLOCK_SCHEMA_VERSION
  variantId: string
  sourceManifestFingerprint: `sha256:${string}`
  seed: string
  blockOrder: string[]
  constraints: VariantConstraints
}

export interface RenderSubtitleCue {
  cueId: string
  startUs: Microseconds
  endUs: Microseconds
  text: string
}

export interface RenderTimelineItem {
  blockId: string
  timelineStartUs: Microseconds
  timelineEndUs: Microseconds
  sourceStartUs: Microseconds
  sourceEndUs: Microseconds
  mediaSpeed: number
  adaptation: MediaAdaptation
  subtitleCues: RenderSubtitleCue[]
  warnings: string[]
}

export interface RenderTimeline {
  schemaVersion: typeof CONTENT_BLOCK_SCHEMA_VERSION
  sourceManifestFingerprint: `sha256:${string}`
  variantId: string
  locale: string
  durationUs: Microseconds
  items: RenderTimelineItem[]
  reviewBlockIds: string[]
}
```

- [ ] **Step 5: Define edit operations and IPC transport types**

Continue in the same file with exact operations and requests. Renderer sends paths/operations only; Main re-reads and validates artifacts:

```ts
export type ContentBlockEditOperation =
  | { kind: 'merge'; leftBlockId: string; rightBlockId: string }
  | { kind: 'split'; blockId: string; afterCueId: string }
  | { kind: 'set-boundary'; blockId: string; selectedUs: Microseconds; locked: boolean }
  | {
      kind: 'set-semantic'
      blockId: string
      role: ContentBlockRole
      shuffleEligible: boolean
      requiresPreviousBlockId: string | null
    }

export type ContentBlockPickKind = 'video' | 'srt' | 'json' | 'directory'

export interface ContentBlockAnalyzeRequest {
  projectDir: string
  videoPath: string
  srtPath: string
  sceneManifestPath: string
  existingManifestPath?: string | null
  boundaryWindowUs?: Microseconds
  minimumBlockDurationUs?: Microseconds
  srtFallbackPaddingUs?: Microseconds
}

export interface ContentBlockAnalyzeResult {
  ok: boolean
  manifestPath?: string
  manifest?: SourceBlockManifest
  sourceManifestFingerprint?: `sha256:${string}`
  warnings: string[]
  error?: string
}

export interface ContentBlockEditRequest {
  manifestPath: string
  operations: ContentBlockEditOperation[]
}

export interface ContentBlockEditResult extends ContentBlockAnalyzeResult {}

export interface LocaleAssetImportRequest {
  projectDir: string
  sourceManifestPath: string
  locale: string
  localizedSrtPath: string
  voiceDir: string
  voiceMapPath?: string | null
}

export interface LocaleAssetImportResult {
  ok: boolean
  manifestPath?: string
  manifest?: LocaleAssetManifest
  missingCueIds: string[]
  invalidCueIds: string[]
  extraFiles: string[]
  error?: string
}

export interface VariantCreateRequest {
  projectDir: string
  sourceManifestPath: string
  variantId: string
  seed: string
  constraints: VariantConstraints
}

export interface VariantCreateResult {
  ok: boolean
  variantPath?: string
  variant?: VariantPlan
  error?: string
}

export interface TimelineBuildRequest {
  projectDir: string
  sourceManifestPath: string
  localeManifestPath: string
  variantPath: string
  preRollUs?: Microseconds
  postRollUs?: Microseconds
  cueGapUs?: Microseconds
}

export interface TimelineBuildResult {
  ok: boolean
  timelinePath?: string
  subtitlePath?: string
  timeline?: RenderTimeline
  error?: string
}

export interface ContentBlockCapCutExportRequest {
  sourceManifestPath: string
  localeManifestPath: string
  timelinePath: string
  draftsDir: string
  templateDir: string
  projectName: string
  muteOriginalVideo?: boolean
}

export interface ContentBlockCapCutExportResult {
  ok: boolean
  projectPath?: string
  portableManifestPath?: string
  provenanceManifestPath?: string
  videoSegmentCount?: number
  audioSegmentCount?: number
  textSegmentCount?: number
  warnings: string[]
  error?: string
}

export type ContentBlockPhase =
  | 'validating' | 'hashing' | 'analyzing' | 'probing-voice'
  | 'planning' | 'building-timeline' | 'creating-capcut'
  | 'done' | 'cancelled' | 'error'

export interface ContentBlockProgress {
  phase: ContentBlockPhase
  percent: number
  message: string
  currentId?: string
}

export interface ContentBlockCancelResult {
  ok: boolean
  wasRunning: boolean
}

export const CONTENT_BLOCK_FEATURE_CHANNELS = {
  pickPath: `${FEATURE_ID}:pick-path`,
  analyze: `${FEATURE_ID}:analyze`,
  editManifest: `${FEATURE_ID}:edit-manifest`,
  importLocale: `${FEATURE_ID}:import-locale`,
  createVariant: `${FEATURE_ID}:create-variant`,
  buildTimeline: `${FEATURE_ID}:build-timeline`,
  exportCapCut: `${FEATURE_ID}:export-capcut`,
  cancel: `${FEATURE_ID}:cancel`,
  progress: `${FEATURE_ID}:progress`
} as const
```

- [ ] **Step 6: Add reusable immutable fixtures and test aggregator**

In `tests/helpers/content-block-fixtures.ts`, export factory functions rather than shared mutable objects:

```ts
import type {
  LocaleAssetManifest,
  SourceBlockManifest,
  VariantPlan
} from '../../src/shared/features/content-blocks.ts'

export const SHA_A = `sha256:${'a'.repeat(64)}` as const

export function sourceManifestFixture(): SourceBlockManifest {
  return {
    schemaVersion: 1,
    source: { path: 'C:\\fixture\\source.mp4', fingerprint: SHA_A, durationUs: 8_000_000, fps: 30 },
    revision: 1,
    blocks: [
      {
        id: 'block-a',
        sourceRange: { startUs: 0, endUs: 4_000_000 },
        cueIds: ['cue-001', 'cue-002'],
        dialogue: [
          { cueId: 'cue-001', sourceIndex: 1, role: 'question', text: 'Q1', sourceStartUs: 100_000, sourceEndUs: 1_100_000 },
          { cueId: 'cue-002', sourceIndex: 2, role: 'answer', text: 'A1', sourceStartUs: 1_200_000, sourceEndUs: 3_800_000 }
        ],
        boundary: { targetUs: 3_800_000, selectedUs: 4_000_000, reason: 'scene-near-srt', reviewState: 'accepted' },
        semantic: { role: 'normal', shuffleEligible: true, requiresPreviousBlockId: null },
        issues: []
      },
      {
        id: 'block-b',
        sourceRange: { startUs: 4_000_000, endUs: 8_000_000 },
        cueIds: ['cue-003', 'cue-004'],
        dialogue: [
          { cueId: 'cue-003', sourceIndex: 3, role: 'question', text: 'Q2', sourceStartUs: 4_100_000, sourceEndUs: 5_100_000 },
          { cueId: 'cue-004', sourceIndex: 4, role: 'answer', text: 'A2', sourceStartUs: 5_200_000, sourceEndUs: 7_800_000 }
        ],
        boundary: { targetUs: 7_800_000, selectedUs: 8_000_000, reason: 'scene-near-srt', reviewState: 'accepted' },
        semantic: { role: 'normal', shuffleEligible: true, requiresPreviousBlockId: null },
        issues: []
      }
    ]
  }
}

export function localeManifestFixture(sourceManifestFingerprint: `sha256:${string}`): LocaleAssetManifest {
  return {
    schemaVersion: 1,
    sourceManifestFingerprint,
    locale: 'vi-VN',
    blocks: {
      'block-a': { cues: [
        { cueId: 'cue-001', text: 'Hỏi 1', voicePath: 'C:\\fixture\\cue-001.wav', voiceDurationUs: 1_000_000 },
        { cueId: 'cue-002', text: 'Đáp 1', voicePath: 'C:\\fixture\\cue-002.wav', voiceDurationUs: 2_700_000 }
      ] },
      'block-b': { cues: [
        { cueId: 'cue-003', text: 'Hỏi 2', voicePath: 'C:\\fixture\\cue-003.wav', voiceDurationUs: 1_000_000 },
        { cueId: 'cue-004', text: 'Đáp 2', voicePath: 'C:\\fixture\\cue-004.wav', voiceDurationUs: 2_700_000 }
      ] }
    }
  }
}

export function variantFixture(sourceManifestFingerprint: `sha256:${string}`): VariantPlan {
  return {
    schemaVersion: 1,
    variantId: 'variant-001',
    sourceManifestFingerprint,
    seed: '392831',
    blockOrder: ['block-b', 'block-a'],
    constraints: { lockedStartBlockIds: [], lockedEndBlockIds: [], preserveDependencyChains: true }
  }
}
```

Create `tests/content-blocks.test.ts` as an explicit aggregator; add each later test import in the task that creates it:

```ts
import './content-block-contract.test.ts'
```

- [ ] **Step 7: Run contract, typecheck and architecture gates**

Run:

```text
node --experimental-strip-types --test tests/content-block-contract.test.ts
npm run typecheck:node
npm run typecheck:web
npm run check:architecture
```

Expected: all PASS.

- [ ] **Step 8: Commit contracts, registered shell, fixtures and approved planning artifacts**

```text
git add docs/superpowers/specs/2026-08-21-content-block-video-shuffle-design.md docs/superpowers/plans/2026-08-21-manifest-first-capcut-adapter.md src/shared/features/content-blocks.ts src/main/features/content-blocks.ts src/preload/features/content-blocks.ts src/renderer/src/features/content-blocks/index.tsx src/main/features/registry.ts src/preload/features/registry.ts src/renderer/src/features/registry.ts tests/content-block-contract.test.ts tests/helpers/content-block-fixtures.ts tests/content-blocks.test.ts
git commit -m "docs: lock manifest-first content block V1"
```

### Task 2: Versioned manifest validation, fingerprinting and atomic storage

**Files:**
- Create: `src/main/services/contentBlockManifest.ts`
- Create: `tests/content-block-manifest.test.ts`
- Modify: `tests/content-blocks.test.ts`

**Interfaces:**
- Consumes: `SourceBlockManifest`, `LocaleAssetManifest`, `VariantPlan`, `RenderTimeline`.
- Produces: `canonicalJson`, `sha256File`, `fingerprintSourceManifest`, four validators, four readers and `writeArtifactAtomic`.

- [ ] **Step 1: Write failing manifest tests**

```ts
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  canonicalJson,
  fingerprintSourceManifest,
  readSourceBlockManifest,
  validateSourceBlockManifest,
  writeArtifactAtomic
} from '../src/main/services/contentBlockManifest.ts'
import { sourceManifestFixture } from './helpers/content-block-fixtures.ts'

test('canonical JSON sorts nested keys and yields stable manifest fingerprint', () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}')
  const left = sourceManifestFixture()
  const right = { ...left, source: { ...left.source } }
  assert.equal(fingerprintSourceManifest(left), fingerprintSourceManifest(right))
  right.revision = 2
  assert.notEqual(fingerprintSourceManifest(left), fingerprintSourceManifest(right))
})

test('validator rejects duplicate IDs, non-integer time and discontinuous ranges', () => {
  const duplicate = sourceManifestFixture()
  duplicate.blocks[1].id = duplicate.blocks[0].id
  assert.throws(() => validateSourceBlockManifest(duplicate), /block ID.*trùng/u)

  const fractional = sourceManifestFixture()
  fractional.blocks[0].sourceRange.endUs = 4_000_000.5
  assert.throws(() => validateSourceBlockManifest(fractional), /microseconds.*integer/u)

  const gap = sourceManifestFixture()
  gap.blocks[1].sourceRange.startUs = 4_100_000
  assert.throws(() => validateSourceBlockManifest(gap), /liên tục/u)
})

test('atomic writer round-trips a validated source manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tblao-content-block-manifest-'))
  try {
    const path = join(root, 'source-blocks.json')
    await writeArtifactAtomic(path, sourceManifestFixture(), validateSourceBlockManifest)
    const loaded = await readSourceBlockManifest(path)
    assert.deepEqual(loaded, sourceManifestFixture())
    assert.doesNotMatch(await readFile(path, 'utf8'), /generatedAt/u)
    await writeFile(path, '{broken', 'utf8')
    await assert.rejects(() => readSourceBlockManifest(path), /JSON/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run the focused test and confirm red**

Run:

```text
node --experimental-strip-types --test tests/content-block-manifest.test.ts
```

Expected: FAIL because `contentBlockManifest.ts` does not exist.

- [ ] **Step 3: Implement canonical JSON and streaming SHA-256**

Use recursive key sorting, reject unsupported JSON values, and stream files instead of reading video into memory:

```ts
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Artifact không được chứa số vô hạn hoặc NaN.')
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, child]) => [key, canonicalize(child)])
    )
  }
  throw new Error(`Artifact chứa kiểu không hỗ trợ: ${typeof value}.`)
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function sha256Text(text: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`
}

export function sha256File(path: string): Promise<`sha256:${string}`> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(`sha256:${hash.digest('hex')}`))
  })
}

export function fingerprintSourceManifest(manifest: SourceBlockManifest): `sha256:${string}` {
  validateSourceBlockManifest(manifest)
  return sha256Text(canonicalJson(manifest))
}
```

- [ ] **Step 4: Implement strict validators and cross-artifact invariants**

Each validator returns its narrowed type or throws a Vietnamese error. Lock these checks explicitly:

```ts
export function validateSourceBlockManifest(value: unknown): SourceBlockManifest
export function validateLocaleAssetManifest(value: unknown): LocaleAssetManifest
export function validateVariantPlan(value: unknown): VariantPlan
export function validateRenderTimeline(value: unknown): RenderTimeline
```

Implementation requirements:

- `schemaVersion === 1`, `revision` positive integer, SHA strings match `^sha256:[a-f0-9]{64}$`.
- Every `*Us` value is a safe, non-negative integer; every range has `endUs > startUs`.
- Source blocks are sorted and contiguous: first starts at `0`, each next start equals previous end, and final end equals `source.durationUs` so no source range is silently unassigned.
- Block IDs and cue IDs are globally unique; `cueIds` exactly equals `dialogue.map(cueId)`; dialogue is source-time ordered and lies inside its block range.
- Boundary `selectedUs` equals block `sourceRange.endUs`; dependency points to an existing different block.
- Locale block keys and cue IDs are unique with `voiceDurationUs >= 1_000`; the one-millisecond floor guarantees SRT millisecond quantization cannot produce a zero-length cue.
- Variant order contains every source block exactly once; cross-check with a source manifest is performed by `assertVariantMatchesSource(variant, source)`.
- Timeline items are contiguous from `0`, subtitle cues are monotonic/inside their item, `durationUs` equals final end and `reviewBlockIds` equals all `needs-review` item IDs.

Add exact cross-artifact helpers:

```ts
export function assertSourceFingerprint(
  actual: `sha256:${string}`,
  declared: `sha256:${string}`,
  artifactLabel: string
): void

export function assertVariantMatchesSource(variant: VariantPlan, source: SourceBlockManifest): void
export function assertLocaleMatchesSource(locale: LocaleAssetManifest, source: SourceBlockManifest): void
```

- [ ] **Step 5: Implement atomic readers/writer**

```ts
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function writeArtifactAtomic<T>(
  path: string,
  value: T,
  validate: (candidate: unknown) => T
): Promise<void> {
  validate(value)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

async function readArtifact<T>(path: string, validate: (value: unknown) => T): Promise<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`Không đọc được artifact JSON "${path}": ${error instanceof Error ? error.message : String(error)}`)
  }
  return validate(parsed)
}

export const readSourceBlockManifest = (path: string): Promise<SourceBlockManifest> =>
  readArtifact(path, validateSourceBlockManifest)
export const readLocaleAssetManifest = (path: string): Promise<LocaleAssetManifest> =>
  readArtifact(path, validateLocaleAssetManifest)
export const readVariantPlan = (path: string): Promise<VariantPlan> =>
  readArtifact(path, validateVariantPlan)
export const readRenderTimeline = (path: string): Promise<RenderTimeline> =>
  readArtifact(path, validateRenderTimeline)
```

- [ ] **Step 6: Import the test in the aggregator and run it green**

Append to `tests/content-blocks.test.ts`:

```ts
import './content-block-manifest.test.ts'
```

Run:

```text
node --experimental-strip-types --test tests/content-block-manifest.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit manifest foundation**

```text
git add src/main/services/contentBlockManifest.ts tests/content-block-manifest.test.ts tests/content-blocks.test.ts
git commit -m "feat: add versioned content block manifests"
```

### Task 3: Pure pair dialogue grouping

**Files:**
- Create: `src/main/services/dialogueGrouper.ts`
- Create: `tests/dialogue-grouper.test.ts`
- Modify: `tests/content-blocks.test.ts`

**Interfaces:**
- Consumes: ordered `SourceDialogueCue[]` with role initially `statement`.
- Produces: `DialogueGroup[]` with stable injected IDs, semantic defaults and issue codes for `boundaryResolver.ts`.

- [ ] **Step 1: Write failing grouping tests**

```ts
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { groupDialoguePairs } from '../src/main/services/dialogueGrouper.ts'
import type { SourceDialogueCue } from '../src/shared/features/content-blocks.ts'

const cue = (sourceIndex: number): SourceDialogueCue => ({
  cueId: `cue-${String(sourceIndex).padStart(3, '0')}`,
  sourceIndex,
  role: 'statement',
  text: `Cue ${sourceIndex}`,
  sourceStartUs: (sourceIndex - 1) * 1_000_000,
  sourceEndUs: sourceIndex * 1_000_000
})

test('pair profile groups two cues and assigns question/answer roles', () => {
  const ids = ['block-a', 'block-b']
  const groups = groupDialoguePairs([cue(1), cue(2), cue(3), cue(4)], {
    makeBlockId: () => ids.shift()!
  })
  assert.deepEqual(groups.map((group) => group.id), ['block-a', 'block-b'])
  assert.deepEqual(groups[0].dialogue.map((item) => item.role), ['question', 'answer'])
  assert.deepEqual(groups[1].cueIds, ['cue-003', 'cue-004'])
})

test('odd final cue becomes a reviewable standalone block', () => {
  const groups = groupDialoguePairs([cue(1), cue(2), cue(3)], { makeBlockId: () => randomUUID() })
  assert.equal(groups.length, 2)
  assert.equal(groups[1].dialogue[0].role, 'statement')
  assert.deepEqual(groups[1].issues, ['odd-unpaired-cue'])
})

test('declared intro and outro cues remain standalone', () => {
  const groups = groupDialoguePairs([cue(1), cue(2), cue(3), cue(4), cue(5), cue(6)], {
    makeBlockId: () => randomUUID(),
    standalone: { 'cue-001': 'intro', 'cue-006': 'outro' }
  })
  assert.deepEqual(groups.map((group) => group.dialogue.length), [1, 2, 2, 1])
  assert.equal(groups[0].semantic.role, 'intro')
  assert.equal(groups[0].semantic.shuffleEligible, false)
  assert.equal(groups[3].semantic.role, 'outro')
})
```

- [ ] **Step 2: Run the focused test and confirm red**

Run:

```text
node --experimental-strip-types --test tests/dialogue-grouper.test.ts
```

Expected: FAIL because `groupDialoguePairs` does not exist.

- [ ] **Step 3: Implement `DialogueGroup` and pair grouping**

```ts
import type {
  ContentBlockIssue,
  ContentBlockRole,
  SourceContentBlock,
  SourceDialogueCue
} from '../../shared/features/content-blocks'

export interface DialogueGroup {
  id: string
  cueIds: string[]
  dialogue: SourceDialogueCue[]
  semantic: SourceContentBlock['semantic']
  issues: ContentBlockIssue[]
}

export interface PairGroupingOptions {
  makeBlockId: () => string
  standalone?: Readonly<Record<string, Exclude<ContentBlockRole, 'normal'>>>
}

export function groupDialoguePairs(
  orderedCues: readonly SourceDialogueCue[],
  options: PairGroupingOptions
): DialogueGroup[] {
  const seen = new Set<string>()
  for (const cue of orderedCues) {
    if (seen.has(cue.cueId)) throw new Error(`Cue ID bị trùng: ${cue.cueId}.`)
    if (cue.sourceEndUs <= cue.sourceStartUs) throw new Error(`Cue ${cue.cueId} có thời lượng không hợp lệ.`)
    seen.add(cue.cueId)
  }

  const groups: DialogueGroup[] = []
  for (let index = 0; index < orderedCues.length;) {
    const first = orderedCues[index]
    const standaloneRole = options.standalone?.[first.cueId]
    if (standaloneRole) {
      const dialogue = [{ ...first, role: 'statement' as const }]
      groups.push({
        id: options.makeBlockId(),
        cueIds: [first.cueId],
        dialogue,
        semantic: { role: standaloneRole, shuffleEligible: false, requiresPreviousBlockId: null },
        issues: []
      })
      index += 1
      continue
    }

    const second = orderedCues[index + 1]
    if (!second || options.standalone?.[second.cueId]) {
      groups.push({
        id: options.makeBlockId(),
        cueIds: [first.cueId],
        dialogue: [{ ...first, role: 'statement' }],
        semantic: { role: 'normal', shuffleEligible: true, requiresPreviousBlockId: null },
        issues: ['odd-unpaired-cue']
      })
      index += 1
      continue
    }

    const dialogue = [
      { ...first, role: 'question' as const },
      { ...second, role: 'answer' as const }
    ]
    groups.push({
      id: options.makeBlockId(),
      cueIds: dialogue.map((cue) => cue.cueId),
      dialogue,
      semantic: { role: 'normal', shuffleEligible: true, requiresPreviousBlockId: null },
      issues: []
    })
    index += 2
  }
  return groups
}
```

Do not inspect dialogue text and do not infer intro/outro from keywords in V1.

- [ ] **Step 4: Import in aggregator and run green**

Append:

```ts
import './dialogue-grouper.test.ts'
```

Run:

```text
node --experimental-strip-types --test tests/dialogue-grouper.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit grouping engine**

```text
git add src/main/services/dialogueGrouper.ts tests/dialogue-grouper.test.ts tests/content-blocks.test.ts
git commit -m "feat: group source cues into content blocks"
```

### Task 4: Boundary resolver with hard constraints and reviewable fallback

**Files:**
- Create: `src/main/services/boundaryResolver.ts`
- Create: `tests/boundary-resolver.test.ts`
- Modify: `tests/content-blocks.test.ts`

**Interfaces:**
- Consumes: `DialogueGroup[]`, source duration, all source cues, scene boundary points and `BoundaryResolverConfig`.
- Produces: contiguous `SourceContentBlock[]`; no filesystem or CapCut dependency.

- [ ] **Step 1: Write failing boundary tests**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveBlockBoundaries } from '../src/main/services/boundaryResolver.ts'
import { groupDialoguePairs } from '../src/main/services/dialogueGrouper.ts'
import type { SourceDialogueCue } from '../src/shared/features/content-blocks.ts'

const cues: SourceDialogueCue[] = [
  { cueId: 'cue-001', sourceIndex: 1, role: 'statement', text: 'Q1', sourceStartUs: 0, sourceEndUs: 1_000_000 },
  { cueId: 'cue-002', sourceIndex: 2, role: 'statement', text: 'A1', sourceStartUs: 1_100_000, sourceEndUs: 3_600_000 },
  { cueId: 'cue-003', sourceIndex: 3, role: 'statement', text: 'Q2', sourceStartUs: 4_000_000, sourceEndUs: 5_000_000 },
  { cueId: 'cue-004', sourceIndex: 4, role: 'statement', text: 'A2', sourceStartUs: 5_100_000, sourceEndUs: 7_700_000 }
]
const groups = groupDialoguePairs(cues, { makeBlockId: (() => { const ids = ['block-a', 'block-b']; return () => ids.shift()! })() })

test('selects nearest legal scene boundary to answer end', () => {
  const blocks = resolveBlockBoundaries({ groups, allCues: cues, sceneBoundaryUs: [3_800_000, 8_000_000], sourceDurationUs: 8_000_000 })
  assert.equal(blocks[0].sourceRange.endUs, 3_800_000)
  assert.equal(blocks[0].boundary.reason, 'scene-near-srt')
  assert.equal(blocks[1].sourceRange.startUs, 3_800_000)
})

test('rejects a scene cut inside a spoken cue', () => {
  const blocks = resolveBlockBoundaries({ groups, allCues: cues, sceneBoundaryUs: [3_400_000, 3_900_000, 8_000_000], sourceDurationUs: 8_000_000 })
  assert.equal(blocks[0].sourceRange.endUs, 3_900_000)
})

test('falls back to padded SRT end and marks review', () => {
  const blocks = resolveBlockBoundaries({ groups, allCues: cues, sceneBoundaryUs: [8_000_000], sourceDurationUs: 8_000_000 })
  assert.equal(blocks[0].sourceRange.endUs, 3_700_000)
  assert.equal(blocks[0].boundary.reason, 'srt-fallback')
  assert.equal(blocks[0].boundary.reviewState, 'needs-review')
  assert.deepEqual(blocks[0].issues, ['srt-fallback'])
})

test('keeps a valid manually locked boundary exactly', () => {
  const blocks = resolveBlockBoundaries({
    groups,
    allCues: cues,
    sceneBoundaryUs: [3_800_000, 8_000_000],
    sourceDurationUs: 8_000_000,
    lockedBoundaryUs: { 'block-a': 3_750_000 }
  })
  assert.equal(blocks[0].sourceRange.endUs, 3_750_000)
  assert.equal(blocks[0].boundary.reviewState, 'locked')
  assert.equal(blocks[0].boundary.reason, 'manual-adjusted')
})
```

- [ ] **Step 2: Run the focused test and confirm red**

Run:

```text
node --experimental-strip-types --test tests/boundary-resolver.test.ts
```

Expected: FAIL because the resolver does not exist.

- [ ] **Step 3: Implement configuration and hard candidate filter**

```ts
import { CONTENT_BLOCK_DEFAULTS, type SourceContentBlock, type SourceDialogueCue } from '../../shared/features/content-blocks'
import type { DialogueGroup } from './dialogueGrouper'

export interface BoundaryResolverConfig {
  boundaryWindowUs: number
  minimumBlockDurationUs: number
  srtFallbackPaddingUs: number
}

export interface ResolveBlockBoundariesInput {
  groups: readonly DialogueGroup[]
  allCues: readonly SourceDialogueCue[]
  sceneBoundaryUs: readonly number[]
  sourceDurationUs: number
  lockedBoundaryUs?: Readonly<Record<string, number>>
  config?: Partial<BoundaryResolverConfig>
}

const isInsideCue = (pointUs: number, cue: SourceDialogueCue): boolean =>
  cue.sourceStartUs < pointUs && pointUs < cue.sourceEndUs

function legalBoundary(
  pointUs: number,
  startUs: number,
  nextCueStartUs: number,
  allCues: readonly SourceDialogueCue[],
  config: BoundaryResolverConfig
): boolean {
  return Number.isSafeInteger(pointUs) &&
    pointUs - startUs >= config.minimumBlockDurationUs &&
    pointUs <= nextCueStartUs &&
    !allCues.some((cue) => isInsideCue(pointUs, cue))
}
```

Merge defaults and reject invalid config (`boundaryWindowUs`/padding non-negative integers, minimum duration positive). For each group, set `targetUs` to its final cue end; set `nextCueStartUs` to the next group's first cue start or source duration.

- [ ] **Step 4: Implement deterministic ranking, fallback and contiguous ranges**

For each non-final boundary:

1. Validate and use a locked boundary first.
2. Filter scene points to `abs(point - target) <= boundaryWindowUs` and `legalBoundary(...)`.
3. Sort by distance, then lower timestamp; exact distance `0` gets `exact-scene-match`, otherwise `scene-near-srt`.
4. If none survive, choose `min(target + padding, nextCueStartUs, sourceDurationUs)`, validate it, then fall back to `targetUs` only if padding would be illegal.
5. Start of block N is exactly selected end of block N-1. Last block ends at `sourceDurationUs` when legal; otherwise throw because source/cue metadata is inconsistent.

Build each result exactly as:

```ts
const block: SourceContentBlock = {
  id: group.id,
  sourceRange: { startUs, endUs: selectedUs },
  cueIds: [...group.cueIds],
  dialogue: group.dialogue.map((cue) => ({ ...cue })),
  boundary: { targetUs, selectedUs, reason, reviewState },
  semantic: { ...group.semantic },
  issues: reason === 'srt-fallback'
    ? [...new Set([...group.issues, 'srt-fallback' as const])]
    : [...group.issues]
}
```

The resolver must throw on overlap, a locked boundary inside speech, or a source duration before the final cue; it must never silently clamp a cue.

- [ ] **Step 5: Import in aggregator and run green**

Append:

```ts
import './boundary-resolver.test.ts'
```

Run:

```text
node --experimental-strip-types --test tests/boundary-resolver.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit boundary engine**

```text
git add src/main/services/boundaryResolver.ts tests/boundary-resolver.test.ts tests/content-blocks.test.ts
git commit -m "feat: resolve content block boundaries"
```

### Task 5: FFprobe abstraction and source block analyzer

**Files:**
- Create: `src/main/services/mediaProbe.ts`
- Create: `src/main/services/contentBlockAnalyzer.ts`
- Create: `tests/content-block-analyzer.test.ts`
- Modify: `tests/content-blocks.test.ts`

**Interfaces:**
- Consumes: source video/SRT paths, existing `scene-splitter.json`, optional prior source manifest, grouper, resolver and manifest store.
- Produces: `VideoProbeInfo`, `probeVideoMetadata`, `probeAudioDurationUs`, `parseContentBlockSrt`, `parseSceneBoundaryCandidates`, `buildSourceBlockManifest`, `analyzeContentBlocks`.

- [ ] **Step 1: Write failing analyzer tests**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSourceBlockManifest,
  parseContentBlockSrt,
  parseSceneBoundaryCandidates
} from '../src/main/services/contentBlockAnalyzer.ts'

const sourceSrt = [
  '1\n00:00:00,100 --> 00:00:01,000\nQ1',
  '2\n00:00:01,100 --> 00:00:03,600\nA1',
  '3\n00:00:04,000 --> 00:00:05,000\nQ2',
  '4\n00:00:05,100 --> 00:00:07,700\nA2'
].join('\n\n')

test('parses source SRT into stable ordered cue IDs and integer microseconds', () => {
  assert.deepEqual(parseContentBlockSrt(sourceSrt), [
    { cueId: 'cue-001', sourceIndex: 1, role: 'statement', text: 'Q1', sourceStartUs: 100_000, sourceEndUs: 1_000_000 },
    { cueId: 'cue-002', sourceIndex: 2, role: 'statement', text: 'A1', sourceStartUs: 1_100_000, sourceEndUs: 3_600_000 },
    { cueId: 'cue-003', sourceIndex: 3, role: 'statement', text: 'Q2', sourceStartUs: 4_000_000, sourceEndUs: 5_000_000 },
    { cueId: 'cue-004', sourceIndex: 4, role: 'statement', text: 'A2', sourceStartUs: 5_100_000, sourceEndUs: 7_700_000 }
  ])
})

test('takes scene ends only from the selected source video', () => {
  const raw = JSON.stringify({
    version: 1,
    scenes: [
      { sourceVideo: 'C:\\input\\source.mp4', endSeconds: 3.8 },
      { sourceVideo: 'C:\\other\\source.mp4', endSeconds: 4.2 },
      { sourceVideo: 'C:\\input\\source.mp4', endSeconds: 8 }
    ]
  })
  assert.deepEqual(parseSceneBoundaryCandidates(raw, 'C:\\input\\source.mp4'), [3_800_000, 8_000_000])
})

test('builds a manifest and reuses IDs when cue membership is unchanged', () => {
  let id = 0
  const first = buildSourceBlockManifest({
    sourcePath: 'C:\\input\\source.mp4',
    sourceFingerprint: `sha256:${'1'.repeat(64)}`,
    durationUs: 8_000_000,
    fps: 30,
    cues: parseContentBlockSrt(sourceSrt),
    sceneBoundaryUs: [3_800_000, 8_000_000],
    makeBlockId: () => `block-new-${++id}`
  })
  const second = buildSourceBlockManifest({
    sourcePath: first.source.path,
    sourceFingerprint: first.source.fingerprint,
    durationUs: first.source.durationUs,
    fps: first.source.fps,
    cues: parseContentBlockSrt(sourceSrt),
    sceneBoundaryUs: [3_800_000, 8_000_000],
    previousManifest: first,
    makeBlockId: () => `block-new-${++id}`
  })
  assert.deepEqual(second.blocks.map((block) => block.id), first.blocks.map((block) => block.id))
  assert.equal(second.revision, 2)
})
```

- [ ] **Step 2: Run the focused test and confirm red**

Run:

```text
node --experimental-strip-types --test tests/content-block-analyzer.test.ts
```

Expected: FAIL because analyzer/probe modules do not exist.

- [ ] **Step 3: Implement a reusable, injectable media probe**

`mediaProbe.ts` must expose parsing separately from process execution so tests never need FFprobe:

```ts
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { resolveFfmpeg } from '../deps'

export interface ProbeProcessResult { code: number | null; stdout: string; stderr: string }
export type ProbeRunner = (command: string, args: string[], timeoutMs: number) => Promise<ProbeProcessResult>
export interface VideoProbeInfo {
  path: string
  durationUs: number
  width: number
  height: number
  fps: number
}

export function ffprobePathForFfmpeg(ffmpeg: string): string {
  if (ffmpeg === 'ffmpeg') return 'ffprobe'
  return join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
}

export function parseAudioDurationUs(stdout: string): number {
  const seconds = Number.parseFloat(stdout.trim())
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Không đọc được thời lượng voice.')
  return Math.round(seconds * 1_000_000)
}

export function parseVideoProbeJson(path: string, stdout: string): VideoProbeInfo {
  const parsed = JSON.parse(stdout) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> }
  const stream = parsed.streams?.[0] ?? {}
  const durationUs = Math.round(Number(parsed.format?.duration) * 1_000_000)
  const width = Number(stream.width)
  const height = Number(stream.height)
  const rate = String(stream.r_frame_rate ?? '30/1').split('/').map(Number)
  const fps = rate[1] ? rate[0] / rate[1] : rate[0]
  if (![durationUs, width, height, fps].every(Number.isFinite) || durationUs <= 0 || width <= 0 || height <= 0 || fps <= 0) {
    throw new Error('Video không có duration/kích thước/fps hợp lệ.')
  }
  return { path, durationUs, width, height, fps }
}
```

Implement `runProbe` with `spawn(..., { windowsHide: true })`, capped stdout/stderr, a 60-second timeout and process kill on timeout. Then expose:

```ts
export const runProbe: ProbeRunner = (command, args, timeoutMs) => new Promise((resolve) => {
  let stdout = ''
  let stderr = ''
  let settled = false
  const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const append = (current: string, chunk: Buffer): string => `${current}${chunk.toString('utf8')}`.slice(-65_536)
  const finish = (code: number | null, fallback = ''): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve({ code, stdout, stderr: stderr || fallback })
  }
  child.stdout?.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
  child.stderr?.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
  child.on('error', (error) => finish(null, error.message))
  child.on('close', (code) => finish(code))
  const timer = setTimeout(() => {
    try { child.kill() } catch { /* process already exited */ }
    finish(null, `FFprobe quá thời gian ${timeoutMs} ms.`)
  }, timeoutMs)
})

export async function requireFfprobePath(): Promise<string> {
  const ffmpeg = await resolveFfmpeg()
  if (!ffmpeg) throw new Error('Thiếu FFmpeg/FFprobe.')
  return ffprobePathForFfmpeg(ffmpeg)
}

export async function probeAudioDurationUs(
  filePath: string,
  ffprobe?: string,
  runner: ProbeRunner = runProbe
): Promise<number> {
  const command = ffprobe ?? await requireFfprobePath()
  const result = await runner(command, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath], 60_000)
  if (result.code !== 0) throw new Error(`Không đọc được voice: ${result.stderr.trim() || 'FFprobe thất bại.'}`)
  return parseAudioDurationUs(result.stdout)
}

export async function probeVideoMetadata(
  filePath: string,
  ffprobe?: string,
  runner: ProbeRunner = runProbe
): Promise<VideoProbeInfo> {
  const command = ffprobe ?? await requireFfprobePath()
  const result = await runner(command, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', filePath], 60_000)
  if (result.code !== 0) throw new Error(`Không đọc được video: ${result.stderr.trim() || 'FFprobe thất bại.'}`)
  return parseVideoProbeJson(filePath, result.stdout)
}
```

- [ ] **Step 4: Implement strict SRT and scene parsing**

Use existing `parseSrt`/`srtTimeToSeconds`, but reject rather than repair invalid cues:

```ts
export function parseContentBlockSrt(raw: string): SourceDialogueCue[] {
  const cues = parseSrt(raw)
  if (!cues.length) throw new Error('Source SRT không có cue hợp lệ.')
  return cues.map((cue, index) => {
    const sourceStartUs = Math.round(srtTimeToSeconds(cue.a) * 1_000_000)
    const sourceEndUs = Math.round(srtTimeToSeconds(cue.b) * 1_000_000)
    if (sourceEndUs <= sourceStartUs) throw new Error(`Cue ${index + 1} có timestamp không hợp lệ.`)
    return {
      cueId: `cue-${String(index + 1).padStart(3, '0')}`,
      sourceIndex: index + 1,
      role: 'statement' as const,
      text: cue.chu.replace(/\\N/g, '\n'),
      sourceStartUs,
      sourceEndUs
    }
  })
}
```

`parseSceneBoundaryCandidates(raw, sourcePath)` must parse unknown JSON, require a `scenes` array, compare normalized absolute Windows paths case-insensitively, convert finite positive `endSeconds` to microseconds, sort/deduplicate, and throw if no scene belongs to the selected source. It does not require scene clip files to exist because analyze uses only boundary evidence.

- [ ] **Step 5: Implement pure manifest construction and ID reuse**

```ts
export interface BuildSourceBlockManifestInput {
  sourcePath: string
  sourceFingerprint: `sha256:${string}`
  durationUs: number
  fps: number
  cues: SourceDialogueCue[]
  sceneBoundaryUs: number[]
  previousManifest?: SourceBlockManifest
  makeBlockId: () => string
  config?: Partial<BoundaryResolverConfig>
}

export function buildSourceBlockManifest(input: BuildSourceBlockManifestInput): SourceBlockManifest {
  const draftGroups = groupDialoguePairs(input.cues, { makeBlockId: input.makeBlockId })
  const priorIds = new Map(
    (input.previousManifest?.blocks ?? []).map((block) => [block.cueIds.join('\u0000'), block.id])
  )
  const groups = draftGroups.map((group) => ({
    ...group,
    id: priorIds.get(group.cueIds.join('\u0000')) ?? group.id
  }))
  const manifest: SourceBlockManifest = {
    schemaVersion: 1,
    source: { path: input.sourcePath, fingerprint: input.sourceFingerprint, durationUs: input.durationUs, fps: input.fps },
    revision: input.previousManifest ? input.previousManifest.revision + 1 : 1,
    blocks: resolveBlockBoundaries({
      groups,
      allCues: input.cues,
      sceneBoundaryUs: input.sceneBoundaryUs,
      sourceDurationUs: input.durationUs,
      config: input.config
    })
  }
  return validateSourceBlockManifest(manifest)
}
```

- [ ] **Step 6: Implement production analyzer I/O without cutting media**

```ts
export interface ContentBlockAnalyzerDependencies {
  probeVideo: typeof probeVideoMetadata
  fingerprintFile: typeof sha256File
  makeBlockId: () => string
}

export async function analyzeContentBlocks(
  request: ContentBlockAnalyzeRequest,
  dependencies: Partial<ContentBlockAnalyzerDependencies> = {}
): Promise<ContentBlockAnalyzeResult>
```

The function must:

1. Resolve and validate absolute video/SRT/scene/project paths and file existence.
2. Read SRT via existing `readSrtFile`; read scene JSON as UTF-8.
3. Run source SHA-256 and video probe; reject if final cue exceeds video duration.
4. Optionally read `existingManifestPath`; reuse IDs only when source video fingerprint matches.
5. Build and write exactly `<projectDir>/analysis/source-blocks.json` atomically.
6. Return warning entries for each `srt-fallback` or `odd-unpaired-cue` block.
7. Never create an MP4 file or invoke FFmpeg encoding.

Use `block-${randomUUID()}` as the default ID factory. Return `{ ok: false, warnings: [], error }` for expected input errors rather than leaking stack traces.

- [ ] **Step 7: Import in aggregator and run green**

Append:

```ts
import './content-block-analyzer.test.ts'
```

Run:

```text
node --experimental-strip-types --test tests/content-block-analyzer.test.ts
npm run typecheck:node
```

Expected: PASS.

- [ ] **Step 8: Commit analyzer slice**

```text
git add src/main/services/mediaProbe.ts src/main/services/contentBlockAnalyzer.ts tests/content-block-analyzer.test.ts tests/content-blocks.test.ts
git commit -m "feat: analyze source video into block manifest"
```

### Task 6: Manual merge, split, boundary and semantic correction

**Files:**
- Create: `src/main/services/contentBlockEdits.ts`
- Create: `tests/content-block-edits.test.ts`
- Modify: `tests/content-blocks.test.ts`

**Interfaces:**
- Consumes: a validated `SourceBlockManifest`, ordered `ContentBlockEditOperation[]`, injected ID factory.
- Produces: `applyContentBlockEdits` with revision incremented once per request and all source/cue invariants preserved.

- [ ] **Step 1: Write failing edit tests**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { applyContentBlockEdits } from '../src/main/services/contentBlockEdits.ts'
import { sourceManifestFixture } from './helpers/content-block-fixtures.ts'

test('merge adjacent blocks keeps left ID and complete cue membership', () => {
  const edited = applyContentBlockEdits(sourceManifestFixture(), [
    { kind: 'merge', leftBlockId: 'block-a', rightBlockId: 'block-b' }
  ], () => 'unused')
  assert.equal(edited.revision, 2)
  assert.deepEqual(edited.blocks.map((block) => block.id), ['block-a'])
  assert.deepEqual(edited.blocks[0].cueIds, ['cue-001', 'cue-002', 'cue-003', 'cue-004'])
  assert.equal(edited.blocks[0].sourceRange.endUs, 8_000_000)
})

test('split keeps original ID on left and assigns a new ID on right', () => {
  const merged = applyContentBlockEdits(sourceManifestFixture(), [
    { kind: 'merge', leftBlockId: 'block-a', rightBlockId: 'block-b' }
  ], () => 'unused')
  const split = applyContentBlockEdits(merged, [
    { kind: 'split', blockId: 'block-a', afterCueId: 'cue-002' }
  ], () => 'block-c')
  assert.deepEqual(split.blocks.map((block) => block.id), ['block-a', 'block-c'])
  assert.equal(split.blocks[0].boundary.reason, 'srt-fallback')
  assert.equal(split.blocks[0].boundary.reviewState, 'needs-review')
})

test('manual boundary updates adjacent ranges and can lock it', () => {
  const edited = applyContentBlockEdits(sourceManifestFixture(), [
    { kind: 'set-boundary', blockId: 'block-a', selectedUs: 3_900_000, locked: true }
  ], () => 'unused')
  assert.equal(edited.blocks[0].sourceRange.endUs, 3_900_000)
  assert.equal(edited.blocks[1].sourceRange.startUs, 3_900_000)
  assert.equal(edited.blocks[0].boundary.reason, 'manual-adjusted')
  assert.equal(edited.blocks[0].boundary.reviewState, 'locked')
})

test('rejects non-adjacent merge, cue-splitting boundary and dependency cycle', () => {
  assert.throws(() => applyContentBlockEdits(sourceManifestFixture(), [
    { kind: 'set-boundary', blockId: 'block-a', selectedUs: 2_000_000, locked: false }
  ], () => 'unused'), /cue/u)
  assert.throws(() => applyContentBlockEdits(sourceManifestFixture(), [
    { kind: 'set-semantic', blockId: 'block-a', role: 'normal', shuffleEligible: true, requiresPreviousBlockId: 'block-b' },
    { kind: 'set-semantic', blockId: 'block-b', role: 'normal', shuffleEligible: true, requiresPreviousBlockId: 'block-a' }
  ], () => 'unused'), /cycle/u)
})
```

- [ ] **Step 2: Run the focused test and confirm red**

Run:

```text
node --experimental-strip-types --test tests/content-block-edits.test.ts
```

Expected: FAIL because edit service does not exist.

- [ ] **Step 3: Implement one-operation helpers with explicit rules**

Implement private functions `mergeAdjacent`, `splitAfterCue`, `setBoundary` and `setSemantic`, each cloning only changed structures.

Rules to encode:

- Merge requires `rightIndex === leftIndex + 1`; keeps left ID/start, takes right end/boundary, concatenates dialogue, keeps unresolved semantic issues from both sides but drops a stale left-side `srt-fallback`, resets semantic to `normal`, `shuffleEligible` to conjunction of both values, and clears dependency.
- Split point must be internal. Left keeps ID; right gets `makeBlockId()`. Initial split boundary is the left final cue end, reason `srt-fallback`, state `needs-review`; both ranges stay contiguous. Each side gets roles `question/answer` only when it has exactly two cues, otherwise `statement` plus `odd-unpaired-cue`.
- Manual boundary may not target the final block, must stay after every cue in the left block and before every cue in the right block, may not split any source cue, and must keep both blocks at least `minimumBlockDurationUs`. A successful manual boundary sets reason `manual-adjusted`, sets state to `locked` or `accepted`, removes `srt-fallback` and adds `manual-adjusted` once.
- `intro` forces `shuffleEligible: false` and null dependency. `outro`/`cta` force null dependency. Dependency target must exist and precede the dependent block in source order. Any valid `set-semantic` operation is also the explicit human acceptance of a legitimate standalone cue, so it removes `odd-unpaired-cue`.

- [ ] **Step 4: Validate dependency graph and increment revision once**

```ts
export function applyContentBlockEdits(
  input: SourceBlockManifest,
  operations: readonly ContentBlockEditOperation[],
  makeBlockId: () => string = () => `block-${randomUUID()}`
): SourceBlockManifest {
  let next = structuredClone(validateSourceBlockManifest(input))
  for (const operation of operations) next = applyOne(next, operation, makeBlockId)
  assertLinearDependencyGraph(next.blocks)
  next.revision = input.revision + 1
  return validateSourceBlockManifest(next)
}
```

`assertLinearDependencyGraph` rejects missing targets, self-reference, cycles, a block with more than one dependent (branch), and a dependency on a later source block. Empty operation arrays are rejected so revision never changes without an edit.

- [ ] **Step 5: Import in aggregator and run green**

Append:

```ts
import './content-block-edits.test.ts'
```

Run:

```text
node --experimental-strip-types --test tests/content-block-edits.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit manual correction engine**

```text
git add src/main/services/contentBlockEdits.ts tests/content-block-edits.test.ts tests/content-blocks.test.ts
git commit -m "feat: edit content block manifests safely"
```

### Task 7: Cue-ID locale asset importer and shared audio probing

**Files:**
- Create: `src/main/services/localeAssetImporter.ts`
- Create: `tests/locale-asset-importer.test.ts`
- Modify: `src/main/services/voiceSync.ts`
- Modify: `tests/content-blocks.test.ts`

**Interfaces:**
- Consumes: validated source manifest, localized SRT, locale, voice directory, optional `Record<cueId, relativeFileName>`, audio listing and duration probe.
- Produces: `importLocaleAssetManifest`, `importLocaleAssetsFromFiles`; `voiceSync.ts` consumes `probeAudioDurationUs` without changing its public contract.

- [ ] **Step 1: Write failing locale importer tests**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { fingerprintSourceManifest } from '../src/main/services/contentBlockManifest.ts'
import { importLocaleAssetManifest } from '../src/main/services/localeAssetImporter.ts'
import { sourceManifestFixture } from './helpers/content-block-fixtures.ts'

const localizedSrt = [
  '1\n00:00:00,000 --> 00:00:01,000\nHỏi 1',
  '2\n00:00:01,000 --> 00:00:02,000\nĐáp 1',
  '3\n00:00:02,000 --> 00:00:03,000\nHỏi 2',
  '4\n00:00:03,000 --> 00:00:04,000\nĐáp 2'
].join('\n\n')

test('maps voice explicitly by cue ID even when filenames are out of order', async () => {
  const source = sourceManifestFixture()
  const durations: Record<string, number> = {
    'z-answer.wav': 2_000_000,
    'a-question.wav': 1_000_000,
    'z-answer-2.wav': 2_100_000,
    'a-question-2.wav': 1_100_000
  }
  const result = await importLocaleAssetManifest({
    source,
    locale: 'vi-VN',
    localizedSrtRaw: localizedSrt,
    voiceDir: 'C:\\voices',
    audioFileNames: Object.keys(durations),
    voiceMap: {
      'cue-001': 'a-question.wav',
      'cue-002': 'z-answer.wav',
      'cue-003': 'a-question-2.wav',
      'cue-004': 'z-answer-2.wav'
    },
    probeDurationUs: async (path) => durations[path.split('\\').at(-1)!] ?? 0,
    isFile: async () => true
  })
  assert.equal(result.ok, true)
  assert.equal(result.manifest?.sourceManifestFingerprint, fingerprintSourceManifest(source))
  assert.equal(result.manifest?.blocks['block-a'].cues[1].voicePath, 'C:\\voices\\z-answer.wav')
  assert.equal(result.manifest?.blocks['block-a'].cues[1].text, 'Đáp 1')
})

test('reports missing, invalid and extra files without emitting a manifest', async () => {
  const result = await importLocaleAssetManifest({
    source: sourceManifestFixture(),
    locale: 'th-TH',
    localizedSrtRaw: localizedSrt,
    voiceDir: 'C:\\voices',
    audioFileNames: ['cue-001.wav', 'cue-002.wav', 'extra.wav'],
    voiceMap: null,
    probeDurationUs: async (path) => path.endsWith('cue-002.wav') ? 0 : 1_000_000,
    isFile: async () => true
  })
  assert.equal(result.ok, false)
  assert.equal(result.manifest, undefined)
  assert.deepEqual(result.missingCueIds, ['cue-003', 'cue-004'])
  assert.deepEqual(result.invalidCueIds, ['cue-002'])
  assert.deepEqual(result.extraFiles, ['extra.wav'])
})

test('localized SRT must contain exactly the source cue count', async () => {
  await assert.rejects(() => importLocaleAssetManifest({
    source: sourceManifestFixture(), locale: 'ja-JP', localizedSrtRaw: localizedSrt.split('\n\n').slice(0, 3).join('\n\n'),
    voiceDir: 'C:\\voices', audioFileNames: [], voiceMap: null,
    probeDurationUs: async () => 1_000_000, isFile: async () => true
  }), /4 cue/u)
})
```

- [ ] **Step 2: Run the focused test and confirm red**

Run:

```text
node --experimental-strip-types --test tests/locale-asset-importer.test.ts
```

Expected: FAIL because locale importer does not exist.

- [ ] **Step 3: Implement locale/SRT validation and explicit mapping**

```ts
export interface ImportLocaleAssetManifestInput {
  source: SourceBlockManifest
  locale: string
  localizedSrtRaw: string
  voiceDir: string
  audioFileNames: string[]
  voiceMap: Record<string, string> | null
  probeDurationUs: (path: string) => Promise<number>
  isFile: (path: string) => Promise<boolean>
}

export async function importLocaleAssetManifest(
  input: ImportLocaleAssetManifestInput
): Promise<LocaleAssetImportResult>
```

Implementation rules:

- Canonicalize locale with `Intl.getCanonicalLocales`; require a region via `new Intl.Locale(locale).region`; reject extensions/private-use tags.
- Flatten source dialogue by `sourceIndex`; parse localized SRT with `parseSrt`; require exact cue count and non-empty text. Localized timestamps are ignored after parsing.
- Accept audio extensions `.mp3`, `.wav`, `.m4a`, `.aac`, `.ogg`, `.flac`, `.opus` only.
- If `voiceMap` exists, require every key to be a known cue ID, every value to be one filename with no `/`, `\`, `..` or duplicate target.
- Without a map, group audio files by `parse(fileName).name`; exactly one stem equal to each cue ID is valid. Do not sort and zip files.
- Resolve each voice under `voiceDir`, verify `relative(voiceDir, resolved)` does not escape, verify file, and require the probed integer duration to be at least `1_000 us`.
- Build `blocks` in source block/cue order only when missing/invalid lists are empty. Extra files are warnings and make `ok: false` in V1 so accidental mappings cannot pass silently.

- [ ] **Step 4: Add production file wrapper and write locale artifact**

```ts
export async function importLocaleAssetsFromFiles(
  request: LocaleAssetImportRequest
): Promise<LocaleAssetImportResult>
```

This wrapper reads/validates the source manifest, localized SRT and optional JSON map; reads only direct children of `voiceDir`; resolves FFprobe once; writes exactly `<projectDir>/locales/<canonical-locale>/assets.json` with `writeArtifactAtomic` when `ok`; and never modifies another locale directory on failure.

- [ ] **Step 5: Replace private audio probing in `voiceSync.ts` without behavior change**

Remove its local `probeDuration` implementation. Keep current FFmpeg resolution once per scan, then call:

```ts
import { ffprobePathForFfmpeg, probeAudioDurationUs } from './mediaProbe'

const ffprobe = ffprobePathForFfmpeg(ffmpeg)
const durationSeconds = (await probeAudioDurationUs(filePath, ffprobe)) / 1_000_000
```

Do not change `scanVoiceSync`, `buildVoiceTimeline`, `VoiceSyncScanResult`, natural ordering or speed behavior; that is legacy mode.

- [ ] **Step 6: Import in aggregator and run focused plus legacy checks**

Append:

```ts
import './locale-asset-importer.test.ts'
```

Run:

```text
node --experimental-strip-types --test tests/locale-asset-importer.test.ts
npm run typecheck:node
npm run build
```

Expected: PASS; build confirms legacy `voiceSync.ts` callers remain compatible.

- [ ] **Step 7: Commit locale asset import**

```text
git add src/main/services/localeAssetImporter.ts src/main/services/voiceSync.ts tests/locale-asset-importer.test.ts tests/content-blocks.test.ts
git commit -m "feat: import locale voices by cue ID"
```

### Task 8: Deterministic variant planner with locked slots and dependency chains

**Files:**
- Create: `src/main/services/blockVariantPlanner.ts`
- Create: `tests/block-variant-planner.test.ts`
- Modify: `tests/content-blocks.test.ts`

**Interfaces:**
- Consumes: validated source manifest, `variantId`, seed and `VariantConstraints`.
- Produces: `createVariantPlan`; each block appears exactly once and no timestamp is stored.

- [ ] **Step 1: Write failing planner tests**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { createVariantPlan } from '../src/main/services/blockVariantPlanner.ts'
import { sourceManifestFixture } from './helpers/content-block-fixtures.ts'

function sixBlockManifest() {
  const manifest = sourceManifestFixture()
  const template = manifest.blocks[0]
  manifest.source.durationUs = 6_000_000
  manifest.blocks = Array.from({ length: 6 }, (_, index) => {
    const startUs = index * 1_000_000
    const id = `block-${index + 1}`
    return {
      ...structuredClone(template), id,
      sourceRange: { startUs, endUs: startUs + 1_000_000 },
      cueIds: [`cue-${index + 1}`],
      dialogue: [{ cueId: `cue-${index + 1}`, sourceIndex: index + 1, role: 'statement' as const, text: id, sourceStartUs: startUs, sourceEndUs: startUs + 900_000 }],
      boundary: { targetUs: startUs + 900_000, selectedUs: startUs + 1_000_000, reason: 'scene-near-srt' as const, reviewState: 'accepted' as const },
      semantic: { role: 'normal' as const, shuffleEligible: true, requiresPreviousBlockId: null }, issues: []
    }
  })
  return manifest
}

test('same input and seed produce the same permutation with every block once', () => {
  const source = sixBlockManifest()
  const request = { variantId: 'variant-001', seed: '392831', constraints: { lockedStartBlockIds: [], lockedEndBlockIds: [], preserveDependencyChains: true as const } }
  const first = createVariantPlan(source, request)
  const second = createVariantPlan(source, request)
  assert.deepEqual(first, second)
  assert.deepEqual([...first.blockOrder].sort(), source.blocks.map((block) => block.id).sort())
  assert.equal(new Set(first.blockOrder).size, source.blocks.length)
})

test('locks intro first, outro last, fixed middle slot and dependency adjacency', () => {
  const source = sixBlockManifest()
  source.blocks[0].semantic = { role: 'intro', shuffleEligible: false, requiresPreviousBlockId: null }
  source.blocks[2].semantic.shuffleEligible = false
  source.blocks[4].semantic.requiresPreviousBlockId = 'block-4'
  source.blocks[5].semantic = { role: 'outro', shuffleEligible: false, requiresPreviousBlockId: null }
  const plan = createVariantPlan(source, {
    variantId: 'variant-locked', seed: 'abc',
    constraints: { lockedStartBlockIds: ['block-1'], lockedEndBlockIds: ['block-6'], preserveDependencyChains: true }
  })
  assert.equal(plan.blockOrder[0], 'block-1')
  assert.equal(plan.blockOrder.at(-1), 'block-6')
  assert.equal(plan.blockOrder.indexOf('block-5'), plan.blockOrder.indexOf('block-4') + 1)
  assert.equal(plan.blockOrder.indexOf('block-3'), 2)
})

test('semantic intro and CTA become effective edge locks even when caller omits them', () => {
  const source = sixBlockManifest()
  source.blocks[1].semantic = { role: 'intro', shuffleEligible: false, requiresPreviousBlockId: null }
  source.blocks[4].semantic = { role: 'cta', shuffleEligible: false, requiresPreviousBlockId: null }
  const plan = createVariantPlan(source, {
    variantId: 'variant-semantic-locks', seed: 'semantic',
    constraints: { lockedStartBlockIds: [], lockedEndBlockIds: [], preserveDependencyChains: true }
  })
  assert.equal(plan.blockOrder[0], 'block-2')
  assert.equal(plan.blockOrder.at(-1), 'block-5')
  assert.deepEqual(plan.constraints.lockedStartBlockIds, ['block-2'])
  assert.deepEqual(plan.constraints.lockedEndBlockIds, ['block-5'])
})

test('rejects missing locks, dependency cycle and dependency branch', () => {
  const source = sixBlockManifest()
  assert.throws(() => createVariantPlan(source, {
    variantId: 'x', seed: 'x', constraints: { lockedStartBlockIds: ['missing'], lockedEndBlockIds: [], preserveDependencyChains: true }
  }), /missing/u)
  source.blocks[1].semantic.requiresPreviousBlockId = 'block-1'
  source.blocks[2].semantic.requiresPreviousBlockId = 'block-1'
  assert.throws(() => createVariantPlan(source, {
    variantId: 'x', seed: 'x', constraints: { lockedStartBlockIds: [], lockedEndBlockIds: [], preserveDependencyChains: true }
  }), /branch/u)
})
```

- [ ] **Step 2: Run the focused test and confirm red**

Run:

```text
node --experimental-strip-types --test tests/block-variant-planner.test.ts
```

Expected: FAIL because planner does not exist.

- [ ] **Step 3: Implement stable seed PRNG and Fisher–Yates**

Use explicit 32-bit arithmetic so output is independent of platform:

```ts
function seedToUint32(seed: string): number {
  let hash = 0x811c9dc5
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1))
    ;[result[index], result[swap]] = [result[swap], result[index]]
  }
  return result
}
```

Reject empty/over-128-character seed and variant IDs not matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`.

- [ ] **Step 4: Build linear dependency units and apply slot policy**

Create one ordered unit per chain. Validate each block has at most one child, no cycle and dependency always points backward. A unit is fixed when any member has `shuffleEligible: false`. Locked-start/end units are removed before middle shuffling and restored in source order at the edges. Reject one unit appearing in both lock sets or a lock targeting the middle of a dependency unit whose root is not locked with it.

Fixed middle units partition the middle into independent shuffle regions. Shuffle eligible units only inside their original region; never move a variable-length dependency chain across a fixed unit. This preserves the exact flattened block index of every `shuffleEligible: false` block while still moving each dependency chain atomically. Flatten all units and assert exact set equality with source IDs.

Before ordering, normalize constraints by unioning every semantic `intro` into `lockedStartBlockIds` and every `outro`/`cta` into `lockedEndBlockIds`, preserving source order and removing duplicates. Store these effective constraints—not the unnormalized renderer input—in `VariantPlan`.

```ts
export function createVariantPlan(
  source: SourceBlockManifest,
  input: { variantId: string; seed: string; constraints: VariantConstraints }
): VariantPlan {
  validateSourceBlockManifest(source)
  const units = buildDependencyUnits(source.blocks)
  const constraints = normalizeVariantConstraints(source.blocks, input.constraints)
  const blockOrder = orderUnits(units, constraints, mulberry32(seedToUint32(input.seed))).flatMap((unit) => unit.blockIds)
  const plan: VariantPlan = {
    schemaVersion: 1,
    variantId: input.variantId,
    sourceManifestFingerprint: fingerprintSourceManifest(source),
    seed: input.seed,
    blockOrder,
    constraints
  }
  assertVariantMatchesSource(plan, source)
  return validateVariantPlan(plan)
}
```

- [ ] **Step 5: Import in aggregator and run green**

Append:

```ts
import './block-variant-planner.test.ts'
```

Run:

```text
node --experimental-strip-types --test tests/block-variant-planner.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit deterministic planner**

```text
git add src/main/services/blockVariantPlanner.ts tests/block-variant-planner.test.ts tests/content-blocks.test.ts
git commit -m "feat: plan deterministic content block variants"
```

### Task 9: Per-locale render timeline and regenerated SRT

**Files:**
- Create: `src/main/services/blockTimeline.ts`
- Create: `src/main/services/blockSrt.ts`
- Create: `tests/block-timeline.test.ts`
- Modify: `tests/content-blocks.test.ts`

**Interfaces:**
- Consumes: matching source/locale/variant artifacts and optional pre-roll/post-roll/gap policy.
- Produces: `buildRenderTimeline`, `validateTimelinePolicy`, `formatSrtTimestampUs`, `serializeRenderTimelineSrt`.

- [ ] **Step 1: Write failing timeline/SRT tests**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { fingerprintSourceManifest } from '../src/main/services/contentBlockManifest.ts'
import { serializeRenderTimelineSrt } from '../src/main/services/blockSrt.ts'
import { buildRenderTimeline } from '../src/main/services/blockTimeline.ts'
import {
  localeManifestFixture,
  sourceManifestFixture,
  variantFixture
} from './helpers/content-block-fixtures.ts'

test('builds a new cumulative locale timeline from original voice durations', () => {
  const source = sourceManifestFixture()
  const fingerprint = fingerprintSourceManifest(source)
  const timeline = buildRenderTimeline(
    source,
    localeManifestFixture(fingerprint),
    variantFixture(fingerprint)
  )
  assert.equal(timeline.items[0].blockId, 'block-b')
  assert.equal(timeline.items[0].timelineStartUs, 0)
  assert.equal(timeline.items[0].timelineEndUs, 3_900_000)
  assert.equal(timeline.items[1].timelineStartUs, 3_900_000)
  assert.equal(timeline.durationUs, 7_800_000)
  assert.deepEqual(timeline.items[0].subtitleCues.map((cue) => [cue.startUs, cue.endUs]), [
    [0, 1_000_000],
    [1_100_000, 3_800_000]
  ])
  assert.equal(timeline.items[0].adaptation, 'stretch-within-soft-limit')
  assert.ok(Math.abs(timeline.items[0].mediaSpeed - 4_000_000 / 3_900_000) < 0.000001)
})

test('different voice duration creates a separate locale timeline', () => {
  const source = sourceManifestFixture()
  const fingerprint = fingerprintSourceManifest(source)
  const locale = localeManifestFixture(fingerprint)
  locale.locale = 'th-TH'
  locale.blocks['block-a'].cues[1].voiceDurationUs = 3_000_000
  const timeline = buildRenderTimeline(source, locale, variantFixture(fingerprint))
  assert.equal(timeline.locale, 'th-TH')
  assert.notEqual(timeline.items[1].timelineEndUs - timeline.items[1].timelineStartUs, 3_900_000)
})

test('outside hard speed limit is reviewable and voice is never trimmed', () => {
  const source = sourceManifestFixture()
  const fingerprint = fingerprintSourceManifest(source)
  const locale = localeManifestFixture(fingerprint)
  for (const block of Object.values(locale.blocks)) {
    for (const cue of block.cues) cue.voiceDurationUs = 500_000
  }
  const timeline = buildRenderTimeline(source, locale, variantFixture(fingerprint))
  assert.deepEqual(timeline.reviewBlockIds, ['block-b', 'block-a'])
  assert.equal(timeline.items[0].adaptation, 'needs-review')
  assert.equal(timeline.items[0].subtitleCues[1].endUs - timeline.items[0].subtitleCues[1].startUs, 500_000)
})

test('regenerates monotonic SRT from render positions', () => {
  const source = sourceManifestFixture()
  const fingerprint = fingerprintSourceManifest(source)
  const timeline = buildRenderTimeline(source, localeManifestFixture(fingerprint), variantFixture(fingerprint))
  const srt = serializeRenderTimelineSrt(timeline)
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:01,000\nHỏi 2/u)
  assert.match(srt, /2\n00:00:01,100 --> 00:00:03,800\nĐáp 2/u)
  assert.match(srt, /3\n00:00:03,900 --> 00:00:04,900\nHỏi 1/u)
})

test('rejects locale or variant built from another source fingerprint', () => {
  const source = sourceManifestFixture()
  const fingerprint = fingerprintSourceManifest(source)
  const locale = localeManifestFixture(`sha256:${'f'.repeat(64)}`)
  assert.throws(() => buildRenderTimeline(source, locale, variantFixture(fingerprint)), /fingerprint/u)
})
```

- [ ] **Step 2: Run the focused test and confirm red**

Run:

```text
node --experimental-strip-types --test tests/block-timeline.test.ts
```

Expected: FAIL because timeline/SRT modules do not exist.

- [ ] **Step 3: Validate timing policy**

```ts
export interface TimelinePolicy {
  preRollUs: number
  postRollUs: number
  cueGapUs: number
  softSpeedMin: number
  softSpeedMax: number
  hardSpeedMin: number
  hardSpeedMax: number
}

export function validateTimelinePolicy(input: Partial<TimelinePolicy> = {}): TimelinePolicy {
  const policy = {
    preRollUs: input.preRollUs ?? CONTENT_BLOCK_DEFAULTS.preRollUs,
    postRollUs: input.postRollUs ?? CONTENT_BLOCK_DEFAULTS.postRollUs,
    cueGapUs: input.cueGapUs ?? CONTENT_BLOCK_DEFAULTS.cueGapUs,
    softSpeedMin: input.softSpeedMin ?? CONTENT_BLOCK_DEFAULTS.softSpeedMin,
    softSpeedMax: input.softSpeedMax ?? CONTENT_BLOCK_DEFAULTS.softSpeedMax,
    hardSpeedMin: input.hardSpeedMin ?? CONTENT_BLOCK_DEFAULTS.hardSpeedMin,
    hardSpeedMax: input.hardSpeedMax ?? CONTENT_BLOCK_DEFAULTS.hardSpeedMax
  }
  if (![policy.preRollUs, policy.postRollUs, policy.cueGapUs].every(Number.isSafeInteger)) {
    throw new Error('Pre-roll, post-roll và cue gap phải là integer microseconds.')
  }
  if (policy.preRollUs < 0 || policy.preRollUs > 100_000 || policy.postRollUs < 0 || policy.cueGapUs < 0) {
    throw new Error('Timing policy nằm ngoài giới hạn V1.')
  }
  if (!(policy.hardSpeedMin <= policy.softSpeedMin && policy.softSpeedMin <= 1 &&
        1 <= policy.softSpeedMax && policy.softSpeedMax <= policy.hardSpeedMax)) {
    throw new Error('Speed policy không hợp lệ.')
  }
  return policy
}
```

- [ ] **Step 4: Implement locale timeline construction**

```ts
export function buildRenderTimeline(
  source: SourceBlockManifest,
  locale: LocaleAssetManifest,
  variant: VariantPlan,
  policyInput: Partial<TimelinePolicy> = {}
): RenderTimeline
```

Implementation sequence for each `variant.blockOrder` entry:

1. Validate all artifacts and require both downstream fingerprints to equal `fingerprintSourceManifest(source)`.
2. Require locale block cue IDs to exactly equal source block cue IDs in the same order.
3. Compute `targetDurationUs = preRoll + sum(voiceDurationUs) + gap * (cueCount - 1) + postRoll`.
4. Compute exact `requiredSpeed = sourceRangeDurationUs / targetDurationUs`; persist `Number(requiredSpeed.toFixed(6))`.
5. Classify inclusive ranges: soft → `stretch-within-soft-limit`; hard-only → `stretch-with-warning`; outside hard → `needs-review`.
6. Start each subtitle at block timeline start + pre-roll + prior voice/gaps; its duration equals the unmodified voice duration.
7. Start next block exactly at prior timeline end. Do not insert source timestamp gaps.
8. Add one human-readable warning for hard-only speed and one blocking warning for outside-hard speed.

Return this exact envelope and validate it before returning:

```ts
const timeline: RenderTimeline = {
  schemaVersion: 1,
  sourceManifestFingerprint,
  variantId: variant.variantId,
  locale: locale.locale,
  durationUs: cursorUs,
  items,
  reviewBlockIds: items.filter((item) => item.adaptation === 'needs-review').map((item) => item.blockId)
}
return validateRenderTimeline(timeline)
```

- [ ] **Step 5: Implement strict SRT serialization**

```ts
export function formatSrtTimestampUs(valueUs: number): string {
  if (!Number.isSafeInteger(valueUs) || valueUs < 0) throw new Error('Timestamp SRT phải là integer microseconds không âm.')
  const milliseconds = Math.round(valueUs / 1_000)
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const seconds = Math.floor((milliseconds % 60_000) / 1_000)
  const millis = milliseconds % 1_000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

export function serializeRenderTimelineSrt(timeline: RenderTimeline): string {
  validateRenderTimeline(timeline)
  const cues = timeline.items.flatMap((item) => item.subtitleCues)
  let previousEndUs = 0
  const blocks = cues.map((cue, index) => {
    if (cue.startUs < previousEndUs || cue.endUs > timeline.durationUs) {
      throw new Error(`Subtitle ${cue.cueId} overlap hoặc vượt output duration.`)
    }
    previousEndUs = cue.endUs
    return `${index + 1}\n${formatSrtTimestampUs(cue.startUs)} --> ${formatSrtTimestampUs(cue.endUs)}\n${cue.text}`
  })
  return `${blocks.join('\n\n')}\n`
}
```

- [ ] **Step 6: Import in aggregator and run green**

Append:

```ts
import './block-timeline.test.ts'
```

Run:

```text
node --experimental-strip-types --test tests/block-timeline.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit timeline and SRT output**

```text
git add src/main/services/blockTimeline.ts src/main/services/blockSrt.ts tests/block-timeline.test.ts tests/content-blocks.test.ts
git commit -m "feat: build locale render timelines and SRT"
```

### Task 10: Native CapCut source-range capability and pure block adapter

**Files:**
- Modify: `src/main/services/nativeCapCutGenerator.ts`
- Create: `src/main/services/capCutBlockAdapter.ts`
- Create: `tests/helpers/native-capcut-template.ts`
- Create: `tests/capcut-block-adapter.test.ts`
- Create: `tests/native-capcut-block.test.ts`
- Modify: `tests/content-blocks.test.ts`

**Interfaces:**
- Consumes: validated source/locale/timeline plus probed width/height; existing native CapCut generator.
- Produces: `NativeCapCutVideoItem.speed`, `assetDurationSeconds`, deduplicated asset mapping and `adaptRenderTimelineToCapCut`.

- [ ] **Step 1: Write failing pure adapter tests**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { adaptRenderTimelineToCapCut } from '../src/main/services/capCutBlockAdapter.ts'
import { buildRenderTimeline } from '../src/main/services/blockTimeline.ts'
import { fingerprintSourceManifest } from '../src/main/services/contentBlockManifest.ts'
import { localeManifestFixture, sourceManifestFixture, variantFixture } from './helpers/content-block-fixtures.ts'

test('maps shuffled source ranges, original voices and captions to native items', () => {
  const source = sourceManifestFixture()
  const fingerprint = fingerprintSourceManifest(source)
  const locale = localeManifestFixture(fingerprint)
  const timeline = buildRenderTimeline(source, locale, variantFixture(fingerprint))
  const items = adaptRenderTimelineToCapCut({ source, locale, timeline, width: 1920, height: 1080, muteOriginalVideo: true })

  assert.equal(items.videoItems.length, 2)
  assert.deepEqual(items.videoItems.map((item) => item.sourceStartSeconds), [4, 0])
  assert.deepEqual(items.videoItems.map((item) => item.sourceDurationSeconds), [4, 4])
  assert.deepEqual(items.videoItems.map((item) => item.assetDurationSeconds), [8, 8])
  assert.equal(items.videoItems[0].assetName, items.videoItems[1].assetName)
  assert.equal(items.videoItems[0].volume, 0)
  assert.ok(Math.abs(items.videoItems[0].speed! - 4 / 3.9) < 0.000001)

  assert.equal(items.audioItems.length, 4)
  assert.ok(items.audioItems.every((item) => item.speed === 1 && item.durationSeconds === item.sourceDurationSeconds))
  assert.deepEqual(items.audioItems.map((item) => item.sourcePath), [
    'C:\\fixture\\cue-003.wav', 'C:\\fixture\\cue-004.wav',
    'C:\\fixture\\cue-001.wav', 'C:\\fixture\\cue-002.wav'
  ])
  assert.deepEqual(items.textItems.map((item) => item.text), ['Hỏi 2', 'Đáp 2', 'Hỏi 1', 'Đáp 1'])
})

test('adapter refuses a timeline that still has blocking review', () => {
  const source = sourceManifestFixture()
  const fingerprint = fingerprintSourceManifest(source)
  const locale = localeManifestFixture(fingerprint)
  for (const block of Object.values(locale.blocks)) for (const cue of block.cues) cue.voiceDurationUs = 500_000
  const timeline = buildRenderTimeline(source, locale, variantFixture(fingerprint))
  assert.throws(() => adaptRenderTimelineToCapCut({ source, locale, timeline, width: 1920, height: 1080, muteOriginalVideo: true }), /needs-review/u)
})
```

- [ ] **Step 2: Write a failing native-generator source-range/dedup test**

`tests/helpers/native-capcut-template.ts` creates a minimal valid template with one prototype segment on tracks named `Video nền`, `Voice`, `Phụ đề`, and matching `videos`, `audios`, `texts` materials. It writes this exact draft shape:

```ts
export const minimalDraft = {
  id: 'template-draft', name: 'Template', duration: 1_000_000, fps: 30,
  canvas_config: { width: 1920, height: 1080 },
  tracks: [
    { id: 'video-track', type: 'video', name: 'Video nền', segments: [{ id: 'video-segment', material_id: 'video-material', target_timerange: { start: 0, duration: 1_000_000 }, source_timerange: { start: 0, duration: 1_000_000 }, speed: 1, volume: 0, extra_material_refs: [] }] },
    { id: 'audio-track', type: 'audio', name: 'Voice', segments: [{ id: 'audio-segment', material_id: 'audio-material', target_timerange: { start: 0, duration: 1_000_000 }, source_timerange: { start: 0, duration: 1_000_000 }, speed: 1, volume: 1, extra_material_refs: [] }] },
    { id: 'text-track', type: 'text', name: 'Phụ đề', segments: [{ id: 'text-segment', material_id: 'text-material', target_timerange: { start: 0, duration: 1_000_000 }, source_timerange: { start: 0, duration: 1_000_000 }, speed: 1, volume: 1, extra_material_refs: [] }] }
  ],
  materials: {
    videos: [{ id: 'video-material', path: '', material_name: 'video', duration: 1_000_000 }],
    audios: [{ id: 'audio-material', path: '', material_name: 'audio', duration: 1_000_000 }],
    texts: [{ id: 'text-material', content: JSON.stringify({ text: 'x', styles: [] }) }]
  }
}
```

The helper exports `writeMinimalCapCutTemplate(root)` and writes only `draft_content.json`; generator already handles optional metadata files.

Create the test:

```ts
test('native generator writes video speed/full asset duration/source range and copies shared source once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tblao-native-block-'))
  try {
    const templateDir = await writeMinimalCapCutTemplate(root)
    const video = join(root, 'source.mp4')
    const voice = join(root, 'voice.wav')
    await writeFile(video, Buffer.from('video-fixture'))
    await writeFile(voice, Buffer.from('voice-fixture'))
    const projectPath = join(root, 'drafts', 'Block Test')
    const result = await generateNativeCapCutProject({
      projectPath, projectName: 'Block Test', templateDir, width: 1920, height: 1080, fps: 30,
      videoItems: [
        { sourcePath: video, assetName: 'tblao-source.mp4', startSeconds: 0, durationSeconds: 3.9, sourceStartSeconds: 4, sourceDurationSeconds: 4, assetDurationSeconds: 8, speed: 4 / 3.9, width: 1920, height: 1080, volume: 0 },
        { sourcePath: video, assetName: 'tblao-source.mp4', startSeconds: 3.9, durationSeconds: 3.9, sourceStartSeconds: 0, sourceDurationSeconds: 4, assetDurationSeconds: 8, speed: 4 / 3.9, width: 1920, height: 1080, volume: 0 }
      ],
      audioItems: [{ sourcePath: voice, assetName: 'voice.wav', startSeconds: 0, durationSeconds: 1, sourceDurationSeconds: 1, speed: 1, volume: 1 }],
      textItems: [{ startSeconds: 0, durationSeconds: 1, text: 'Caption' }]
    })
    const draft = JSON.parse(await readFile(join(projectPath, 'draft_content.json'), 'utf8'))
    const videoSegments = draft.tracks.find((track: { type: string }) => track.type === 'video').segments
    assert.equal(videoSegments[0].speed, Number((4 / 3.9).toFixed(6)))
    assert.deepEqual(videoSegments[0].source_timerange, { start: 4_000_000, duration: 4_000_000 })
    const videoMaterial = draft.materials.videos[0]
    assert.equal(videoMaterial.duration, 8_000_000)
    assert.equal(result.assetFiles.filter((path) => path.endsWith('tblao-source.mp4')).length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
```

- [ ] **Step 3: Run both tests and confirm red**

Run:

```text
node --experimental-strip-types --test tests/capcut-block-adapter.test.ts tests/native-capcut-block.test.ts
```

Expected: adapter module missing; native type rejects `assetDurationSeconds`/`speed` or assertions fail.

- [ ] **Step 4: Extend native video items compatibly**

Change only additive fields:

```ts
export interface NativeCapCutVideoItem {
  sourcePath: string
  assetName: string
  startSeconds: number
  durationSeconds: number
  sourceStartSeconds?: number
  sourceDurationSeconds?: number
  assetDurationSeconds?: number
  speed?: number
  width: number
  height: number
  volume: number
}
```

In video segment generation:

- Material duration is `assetDurationSeconds ?? sourceDurationSeconds ?? durationSeconds`.
- `createSegment` receives source-range duration `sourceDurationSeconds ?? durationSeconds` and `Number((speed ?? 1).toFixed(6))`.
- When `sourceStartSeconds !== undefined`, set source timerange start to that value and duration to `sourceDurationSeconds ?? durationSeconds`; do not use target duration.
- Existing `capCutFactory.ts` items omit new fields, therefore keep speed 1 and current ranges.

Refactor `copyAssets` to return `{ videoPaths, audioPaths, uniquePaths }`. Cache by normalized target path; if a repeated item resolves to the same target and same source, skip the second `copyFile`; if the same target name points to a different source, throw. Return `uniquePaths` as `NativeCapCutProjectResult.assetFiles`.

- [ ] **Step 5: Implement pure CapCut adapter**

```ts
export interface CapCutBlockAdapterInput {
  source: SourceBlockManifest
  locale: LocaleAssetManifest
  timeline: RenderTimeline
  width: number
  height: number
  muteOriginalVideo: boolean
}

export interface CapCutBlockItems {
  videoItems: NativeCapCutVideoItem[]
  audioItems: NativeCapCutAudioItem[]
  textItems: NativeCapCutTextItem[]
  warnings: string[]
}

export function adaptRenderTimelineToCapCut(input: CapCutBlockAdapterInput): CapCutBlockItems
```

Validate source/locale/timeline, require matching fingerprint and locale, require positive integer dimensions, and reject non-empty `reviewBlockIds`. Index source blocks and locale cues by ID. Map:

- One video item per timeline block using the same asset name `tblao-source-video<original extension>`, source full duration as `assetDurationSeconds`, item source range as `sourceDurationSeconds`, target range from timeline, and timeline `mediaSpeed`.
- One audio item per subtitle cue, with target/source duration equal `voiceDurationUs / 1e6`, `speed: 1`, and a unique cue-ID asset name.
- One text item per subtitle cue with the same target range and localized text.
- Add warnings only for `stretch-with-warning`; never downgrade `needs-review` to a warning.

- [ ] **Step 6: Import both tests in aggregator and run green**

Append:

```ts
import './capcut-block-adapter.test.ts'
import './native-capcut-block.test.ts'
```

Run:

```text
node --experimental-strip-types --test tests/capcut-block-adapter.test.ts tests/native-capcut-block.test.ts
npm run typecheck:node
```

Expected: PASS.

- [ ] **Step 7: Build legacy app as compatibility gate**

Run:

```text
npm run build
```

Expected: PASS; no edit to `capCutFactory.ts` or shared legacy contracts.

- [ ] **Step 8: Commit adapter boundary**

```text
git add src/main/services/nativeCapCutGenerator.ts src/main/services/capCutBlockAdapter.ts tests/helpers/native-capcut-template.ts tests/capcut-block-adapter.test.ts tests/native-capcut-block.test.ts tests/content-blocks.test.ts
git commit -m "feat: adapt block timelines to CapCut drafts"
```

### Task 11: Artifact workflow, fingerprint gates and CapCut export orchestration

**Files:**
- Create: `src/main/services/contentBlockWorkflow.ts`
- Create: `tests/content-block-workflow.test.ts`
- Modify: `tests/content-blocks.test.ts`

**Interfaces:**
- Consumes: request DTO from Shared and services completed in Tasks 2–10.
- Produces: `contentBlockWorkflow` facade with `analyze`, `editManifest`, `importLocale`, `createVariant`, `buildTimeline`, `exportCapCut`, `cancel`.

- [ ] **Step 1: Write failing workflow tests**

```ts
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createContentBlockWorkflow, detectOpenCapCutDraftLock } from '../src/main/services/contentBlockWorkflow.ts'
import { fingerprintSourceManifest, writeArtifactAtomic, validateLocaleAssetManifest, validateSourceBlockManifest } from '../src/main/services/contentBlockManifest.ts'
import { localeManifestFixture, sourceManifestFixture } from './helpers/content-block-fixtures.ts'

test('writes variant, locale timeline and regenerated SRT under canonical artifact folders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tblao-block-workflow-'))
  try {
    const source = sourceManifestFixture()
    const fingerprint = fingerprintSourceManifest(source)
    const sourcePath = join(root, 'analysis', 'source-blocks.json')
    const localePath = join(root, 'locales', 'vi-VN', 'assets.json')
    await writeArtifactAtomic(sourcePath, source, validateSourceBlockManifest)
    await writeArtifactAtomic(localePath, localeManifestFixture(fingerprint), validateLocaleAssetManifest)
    const workflow = createContentBlockWorkflow()
    const variant = await workflow.createVariant({
      projectDir: root, sourceManifestPath: sourcePath, variantId: 'variant-001', seed: '392831',
      constraints: { lockedStartBlockIds: [], lockedEndBlockIds: [], preserveDependencyChains: true }
    })
    assert.equal(variant.variantPath, join(root, 'variants', 'variant-001.json'))
    const timeline = await workflow.buildTimeline({
      projectDir: root, sourceManifestPath: sourcePath, localeManifestPath: localePath, variantPath: variant.variantPath!
    })
    assert.equal(timeline.ok, true)
    assert.equal(timeline.timelinePath, join(root, 'timelines', 'variant-001.vi-VN.json'))
    assert.equal(timeline.subtitlePath, join(root, 'exports', 'subtitles', 'variant-001.vi-VN.srt'))
    assert.match(await readFile(timeline.subtitlePath!, 'utf8'), /^1\n/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('source fingerprint mismatch blocks CapCut generation before writing a project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tblao-block-export-gate-'))
  try {
    const source = sourceManifestFixture()
    source.source.path = join(root, 'source.mp4')
    await writeFile(source.source.path, 'changed-source', 'utf8')
    const sourcePath = join(root, 'analysis', 'source-blocks.json')
    await writeArtifactAtomic(sourcePath, source, validateSourceBlockManifest)
    let generated = false
    const workflow = createContentBlockWorkflow({
      hashFile: async () => `sha256:${'9'.repeat(64)}`,
      generateProject: async () => { generated = true; throw new Error('must not run') }
    })
    const result = await workflow.exportCapCut({
      sourceManifestPath: sourcePath,
      localeManifestPath: join(root, 'missing-locale.json'),
      timelinePath: join(root, 'missing-timeline.json'),
      draftsDir: join(root, 'drafts'), templateDir: join(root, 'template'), projectName: 'Mismatch'
    })
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /fingerprint/u)
    assert.equal(generated, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('failed locale import never overwrites another locale artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tblao-locale-isolation-'))
  try {
    const viPath = join(root, 'locales', 'vi-VN', 'assets.json')
    await mkdir(join(root, 'locales', 'vi-VN'), { recursive: true })
    await writeFile(viPath, 'keep-vi', 'utf8')
    const workflow = createContentBlockWorkflow({ importLocaleFromFiles: async () => ({ ok: false, missingCueIds: ['cue-001'], invalidCueIds: [], extraFiles: [], error: 'missing' }) })
    const result = await workflow.importLocale({ projectDir: root, sourceManifestPath: 'source.json', locale: 'th-TH', localizedSrtPath: 'th.srt', voiceDir: 'voices' })
    assert.equal(result.ok, false)
    assert.equal(await readFile(viPath, 'utf8'), 'keep-vi')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('detects an open CapCut draft lock before export', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tblao-draft-lock-'))
  try {
    await mkdir(join(root, 'Open Project'), { recursive: true })
    await writeFile(join(root, 'Open Project', '.locked'), '', 'utf8')
    assert.equal(await detectOpenCapCutDraftLock(root), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run the focused test and confirm red**

Run:

```text
node --experimental-strip-types --test tests/content-block-workflow.test.ts
```

Expected: FAIL because workflow facade does not exist.

- [ ] **Step 3: Define injectable workflow dependencies and single-operation gate**

```ts
export interface ContentBlockWorkflowDependencies {
  hashFile: typeof sha256File
  probeVideo: typeof probeVideoMetadata
  analyzeSource: typeof analyzeContentBlocks
  importLocaleFromFiles: typeof importLocaleAssetsFromFiles
  generateProject: typeof generateNativeCapCutProject
  writePortableManifest: typeof writePortableCapCutManifest
}

export type ProgressSink = (progress: ContentBlockProgress) => void

export async function detectOpenCapCutDraftLock(draftsDir: string): Promise<boolean> {
  try {
    const children = (await readdir(draftsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .slice(0, 500)
    for (const child of children) {
      try {
        if ((await stat(join(draftsDir, child.name, '.locked'))).isFile()) return true
      } catch { /* this draft is not locked */ }
    }
  } catch { /* a missing draftsDir is created only after all other validation passes */ }
  return false
}

export interface ContentBlockWorkflow {
  analyze(request: ContentBlockAnalyzeRequest, onProgress?: ProgressSink): Promise<ContentBlockAnalyzeResult>
  editManifest(request: ContentBlockEditRequest): Promise<ContentBlockEditResult>
  importLocale(request: LocaleAssetImportRequest, onProgress?: ProgressSink): Promise<LocaleAssetImportResult>
  createVariant(request: VariantCreateRequest): Promise<VariantCreateResult>
  buildTimeline(request: TimelineBuildRequest): Promise<TimelineBuildResult>
  exportCapCut(request: ContentBlockCapCutExportRequest, onProgress?: ProgressSink): Promise<ContentBlockCapCutExportResult>
  cancel(): ContentBlockCancelResult
}

export function createContentBlockWorkflow(
  overrides: Partial<ContentBlockWorkflowDependencies> = {}
): ContentBlockWorkflow
```

Internally permit only one active long operation (`analyze`, `importLocale`, `exportCapCut`). Keep `{ cancelled: boolean }` in Main, clear it in `finally`, clamp progress to 0–100, and have native generator receive `isCancelled`. Pure edit/variant/timeline calls are short but still reject while a long operation is active to prevent artifact races.

- [ ] **Step 4: Implement edit, variant and timeline artifact writes**

- Edit: read source manifest, apply operations, atomically overwrite the same path, return new fingerprint and warnings.
- Variant: validate project dir and safe variant ID; read source; write `<projectDir>/variants/<variantId>.json`.
- Timeline: read three artifacts, build timeline, write `<projectDir>/timelines/<variantId>.<locale>.json` and `<projectDir>/exports/subtitles/<variantId>.<locale>.srt` atomically. Sanitize canonical locale to `[A-Za-z0-9-]` before filenames.
- Never accept a renderer-supplied artifact body; always re-read paths in Main.

- [ ] **Step 5: Implement guarded CapCut export**

Execute gates in this exact order:

1. Read source manifest.
2. Hash current source video and compare with `source.fingerprint`; stop here on mismatch.
3. Read locale and timeline; verify both source fingerprints before touching draft directories.
4. Reject timeline `reviewBlockIds` and missing source/voice files.
5. Validate absolute drafts/template paths, reject any `.locked` file found in the first 500 non-hidden draft directories with a “đóng CapCut” error, validate template via `validateNativeCapCutTemplate`, safe project name and non-existing project path.
6. Probe source video; require probed duration within `±50_000 us` and fps within `±0.01` of source manifest.
7. Adapt items and call native generator. Attempt the Windows portable manifest; if the platform/helper does not support it, keep the successful draft and return that message in `warnings` with `portableManifestPath` omitted.
8. Write `<projectPath>/tblao-content-blocks.json` with `schemaVersion: 1`, kind `tblao.content-blocks.capcut`, source/locale/timeline paths, source manifest fingerprint, variant ID, locale and block order. `generatedAt` is allowed only in this export provenance artifact.
9. Return segment counts and adapter warnings.

Do not call `inspectCapCutFactory` or `runCapCutFactory`; the adapter path talks directly to the native generator.

- [ ] **Step 6: Import in aggregator and run green**

Append:

```ts
import './content-block-workflow.test.ts'
```

Run:

```text
node --experimental-strip-types --test tests/content-block-workflow.test.ts
npm run typecheck:node
```

Expected: PASS.

- [ ] **Step 7: Commit workflow facade**

```text
git add src/main/services/contentBlockWorkflow.ts tests/content-block-workflow.test.ts tests/content-blocks.test.ts
git commit -m "feat: orchestrate content block artifacts and export"
```

### Task 12: Upgrade the registered shell to full Main IPC and Preload bridge

**Files:**
- Modify: `src/main/features/content-blocks.ts`
- Modify: `src/preload/features/content-blocks.ts`
- Create: `tests/content-block-ipc-contract.test.ts`
- Modify: `tests/content-blocks.test.ts`

**Interfaces:**
- Consumes: `CONTENT_BLOCK_FEATURE_CHANNELS`, request/result DTO and singleton production workflow.
- Produces: nine namespaced IPC handlers/events and typed `window.api` methods; the three registry entries created in Task 1 remain unchanged.

- [ ] **Step 1: Write the failing IPC/architecture contract test**

```ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

test('preload exposes the complete content-block workflow', () => {
  const preload = read('../src/preload/features/content-blocks.ts')
  for (const method of [
    'contentBlockPickPath', 'analyzeContentBlocks', 'editContentBlockManifest',
    'importContentBlockLocale', 'createContentBlockVariant', 'buildContentBlockTimeline',
    'exportContentBlockCapCut', 'cancelContentBlocks', 'onContentBlockProgress'
  ]) assert.match(preload, new RegExp(`\\b${method}\\b`, 'u'))
  assert.doesNotMatch(preload, /node:fs|child_process|generateNativeCapCutProject/u)
})

test('Main adapter delegates all business logic to one workflow facade', () => {
  const main = read('../src/main/features/content-blocks.ts')
  assert.match(main, /createContentBlockWorkflow/u)
  assert.doesNotMatch(main, /groupDialoguePairs|resolveBlockBoundaries|buildRenderTimeline|generateNativeCapCutProject/u)
})

test('all three registries contain content-blocks exactly once', () => {
  for (const path of [
    '../src/main/features/registry.ts',
    '../src/preload/features/registry.ts',
    '../src/renderer/src/features/registry.ts'
  ]) {
    const source = read(path)
    assert.equal(source.match(/from ['"]\.\/content-blocks['"]/gu)?.length, 1)
  }
})
```

- [ ] **Step 2: Run the focused test and confirm red**

Run:

```text
node --experimental-strip-types --test tests/content-block-ipc-contract.test.ts
```

Expected: FAIL because the registered shell exposes only cancel and does not yet delegate to the workflow.

- [ ] **Step 3: Replace the shell Main adapter with the thin production feature**

`src/main/features/content-blocks.ts` uses one module-level workflow:

```ts
import { app, dialog, type OpenDialogOptions } from 'electron'
import {
  CONTENT_BLOCK_FEATURE_CHANNELS as CHANNELS,
  FEATURE_ID,
  type ContentBlockAnalyzeRequest,
  type ContentBlockAnalyzeResult,
  type ContentBlockCancelResult,
  type ContentBlockCapCutExportRequest,
  type ContentBlockCapCutExportResult,
  type ContentBlockEditRequest,
  type ContentBlockEditResult,
  type ContentBlockPickKind,
  type ContentBlockProgress,
  type LocaleAssetImportRequest,
  type LocaleAssetImportResult,
  type TimelineBuildRequest,
  type TimelineBuildResult,
  type VariantCreateRequest,
  type VariantCreateResult
} from '../../shared/features/content-blocks'
import { createContentBlockWorkflow } from '../services/contentBlockWorkflow'
import type { MainFeatureModule } from './contracts'

const workflow = createContentBlockWorkflow()

function pickerOptions(kind: ContentBlockPickKind): OpenDialogOptions {
  if (kind === 'directory') return { properties: ['openDirectory', 'createDirectory'] }
  if (kind === 'video') return { properties: ['openFile'], filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mts', 'm2ts'] }] }
  if (kind === 'srt') return { properties: ['openFile'], filters: [{ name: 'SubRip subtitle', extensions: ['srt'] }] }
  return { properties: ['openFile'], filters: [{ name: 'JSON manifest', extensions: ['json'] }] }
}
```

Inside `register({ handle, emit, getMainWindow })`:

- register `app.once('before-quit', () => workflow.cancel())`;
- `pickPath` validates the union and calls `dialog.showOpenDialog`;
- each channel calls the identically named workflow method;
- analyze/import/export pass `(progress: ContentBlockProgress) => emit(CHANNELS.progress, progress)`;
- cancel returns `workflow.cancel()`.

Define the shared emitter once inside `register` before the handlers:

```ts
const progress = (event: ContentBlockProgress): void => emit(CHANNELS.progress, event)
```

Use these exact handler generics:

```ts
handle<[ContentBlockAnalyzeRequest], ContentBlockAnalyzeResult>(CHANNELS.analyze, (_event, request) => workflow.analyze(request, progress))
handle<[ContentBlockEditRequest], ContentBlockEditResult>(CHANNELS.editManifest, (_event, request) => workflow.editManifest(request))
handle<[LocaleAssetImportRequest], LocaleAssetImportResult>(CHANNELS.importLocale, (_event, request) => workflow.importLocale(request, progress))
handle<[VariantCreateRequest], VariantCreateResult>(CHANNELS.createVariant, (_event, request) => workflow.createVariant(request))
handle<[TimelineBuildRequest], TimelineBuildResult>(CHANNELS.buildTimeline, (_event, request) => workflow.buildTimeline(request))
handle<[ContentBlockCapCutExportRequest], ContentBlockCapCutExportResult>(CHANNELS.exportCapCut, (_event, request) => workflow.exportCapCut(request, progress))
handle<[], ContentBlockCancelResult>(CHANNELS.cancel, () => workflow.cancel())
```

- [ ] **Step 4: Replace the shell Preload API with the complete typed bridge**

`src/preload/features/content-blocks.ts` must contain only `ipcRenderer.invoke/on/removeListener` and shared types:

```ts
const api = {
  contentBlockPickPath: (kind: ContentBlockPickKind): Promise<string | null> =>
    ipcRenderer.invoke(CHANNELS.pickPath, kind),
  analyzeContentBlocks: (request: ContentBlockAnalyzeRequest): Promise<ContentBlockAnalyzeResult> =>
    ipcRenderer.invoke(CHANNELS.analyze, request),
  editContentBlockManifest: (request: ContentBlockEditRequest): Promise<ContentBlockEditResult> =>
    ipcRenderer.invoke(CHANNELS.editManifest, request),
  importContentBlockLocale: (request: LocaleAssetImportRequest): Promise<LocaleAssetImportResult> =>
    ipcRenderer.invoke(CHANNELS.importLocale, request),
  createContentBlockVariant: (request: VariantCreateRequest): Promise<VariantCreateResult> =>
    ipcRenderer.invoke(CHANNELS.createVariant, request),
  buildContentBlockTimeline: (request: TimelineBuildRequest): Promise<TimelineBuildResult> =>
    ipcRenderer.invoke(CHANNELS.buildTimeline, request),
  exportContentBlockCapCut: (request: ContentBlockCapCutExportRequest): Promise<ContentBlockCapCutExportResult> =>
    ipcRenderer.invoke(CHANNELS.exportCapCut, request),
  cancelContentBlocks: (): Promise<ContentBlockCancelResult> => ipcRenderer.invoke(CHANNELS.cancel),
  onContentBlockProgress: (listener: (progress: ContentBlockProgress) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: ContentBlockProgress): void => listener(progress)
    ipcRenderer.on(CHANNELS.progress, wrapped)
    return () => ipcRenderer.removeListener(CHANNELS.progress, wrapped)
  }
}

export const contentBlocksPreloadFeature = {
  id: FEATURE_ID,
  api
} as const satisfies PreloadFeatureModule
```

- [ ] **Step 5: Import in aggregator and run IPC/architecture/type gates**

Append:

```ts
import './content-block-ipc-contract.test.ts'
```

Run:

```text
node --experimental-strip-types --test tests/content-block-ipc-contract.test.ts
npm run check:architecture
npm run typecheck
```

Expected: PASS; architecture reports one additional extension feature and paired channels.

- [ ] **Step 6: Commit production IPC bridge**

```text
git add src/main/features/content-blocks.ts src/preload/features/content-blocks.ts tests/content-block-ipc-contract.test.ts tests/content-blocks.test.ts
git commit -m "feat: expose content block workflow through IPC"
```

### Task 13: Five-step Renderer review and export workflow

**Files:**
- Create: `src/renderer/src/features/content-blocks/model.ts`
- Create: `src/renderer/src/features/content-blocks/components/SourceStep.tsx`
- Create: `src/renderer/src/features/content-blocks/components/ReviewStep.tsx`
- Create: `src/renderer/src/features/content-blocks/components/LocaleStep.tsx`
- Create: `src/renderer/src/features/content-blocks/components/VariantStep.tsx`
- Create: `src/renderer/src/features/content-blocks/components/ExportStep.tsx`
- Replace: `src/renderer/src/features/content-blocks/index.tsx`
- Create: `src/renderer/src/features/content-blocks/styles.css`
- Create: `tests/content-block-ui-model.test.ts`
- Create: `tests/content-block-ui-structure.test.ts`
- Modify: `tests/content-blocks.test.ts`

**Interfaces:**
- Consumes: typed `window.api` from Task 12 and all serializable artifact DTO.
- Produces: pure UI gates/edit constructors and a keep-alive five-step feature; no filesystem/Electron import.

- [ ] **Step 1: Write failing pure model tests**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canAnalyzeContentBlocks,
  canBuildContentTimeline,
  canExportContentBlockCapCut,
  createInitialContentBlockState,
  defaultVariantConstraints,
  makeBoundaryEdit,
  reviewIsComplete,
  upsertImportedLocale,
  visibleContentBlockStep
} from '../src/renderer/src/features/content-blocks/model.ts'
import { sourceManifestFixture } from './helpers/content-block-fixtures.ts'

test('analyze gate requires four source paths and idle state', () => {
  const state = {
    ...createInitialContentBlockState(),
    projectDir: 'C:\\project', videoPath: 'C:\\source.mp4', srtPath: 'C:\\source.srt', sceneManifestPath: 'C:\\scene-splitter.json'
  }
  assert.equal(canAnalyzeContentBlocks(state), true)
  assert.equal(canAnalyzeContentBlocks({ ...state, sceneManifestPath: '' }), false)
  assert.equal(canAnalyzeContentBlocks({ ...state, running: true }), false)
})

test('fallback and odd cue issues keep review open until manual correction', () => {
  const manifest = sourceManifestFixture()
  assert.equal(reviewIsComplete(manifest), true)
  manifest.blocks[0].boundary.reviewState = 'needs-review'
  manifest.blocks[0].issues = ['srt-fallback']
  assert.equal(reviewIsComplete(manifest), false)
  manifest.blocks[0].boundary.reviewState = 'accepted'
  manifest.blocks[0].issues = []
  assert.equal(reviewIsComplete(manifest), true)
})

test('boundary editor converts UI seconds to integer microseconds', () => {
  assert.deepEqual(makeBoundaryEdit('block-a', 3.875, true), {
    kind: 'set-boundary', blockId: 'block-a', selectedUs: 3_875_000, locked: true
  })
  assert.throws(() => makeBoundaryEdit('block-a', -1, false), /không âm/u)
})

test('constraints derive intro start and outro/CTA end locks', () => {
  const manifest = sourceManifestFixture()
  manifest.blocks[0].semantic.role = 'intro'
  manifest.blocks[1].semantic.role = 'cta'
  assert.deepEqual(defaultVariantConstraints(manifest), {
    lockedStartBlockIds: ['block-a'], lockedEndBlockIds: ['block-b'], preserveDependencyChains: true
  })
})

test('timeline review and missing CapCut paths block export', () => {
  const state = createInitialContentBlockState()
  assert.equal(canBuildContentTimeline({ ...state, sourceManifestPath: 'source.json', localeManifestPath: 'locale.json', variantPath: 'variant.json' }), true)
  const ready = { ...state, timelinePath: 'timeline.json', localeManifestPath: 'locale.json', sourceManifestPath: 'source.json', draftsDir: 'drafts', templateDir: 'template', projectName: 'Project', timeline: { schemaVersion: 1, sourceManifestFingerprint: `sha256:${'a'.repeat(64)}` as const, variantId: 'v', locale: 'vi-VN', durationUs: 1, items: [], reviewBlockIds: [] } }
  assert.equal(canExportContentBlockCapCut(ready), true)
  assert.equal(canExportContentBlockCapCut({ ...ready, timeline: { ...ready.timeline, reviewBlockIds: ['block-a'] } }), false)
})

test('visible step follows source, review, locale, variant and export artifacts', () => {
  const state = createInitialContentBlockState()
  assert.equal(visibleContentBlockStep(state), 'source')
  const manifest = sourceManifestFixture()
  manifest.blocks[0].issues = ['srt-fallback']
  manifest.blocks[0].boundary.reviewState = 'needs-review'
  assert.equal(visibleContentBlockStep({ ...state, sourceManifest: manifest }), 'review')
  manifest.blocks[0].issues = []
  manifest.blocks[0].boundary.reviewState = 'accepted'
  assert.equal(visibleContentBlockStep({ ...state, sourceManifest: manifest }), 'locale')
})

test('locale import list replaces the same locale but preserves other locales', () => {
  const first = { locale: 'vi-VN', manifestPath: 'vi-old.json', manifest: null }
  const second = { locale: 'th-TH', manifestPath: 'th.json', manifest: null }
  const replacement = { locale: 'vi-VN', manifestPath: 'vi-new.json', manifest: null }
  assert.deepEqual(upsertImportedLocale(upsertImportedLocale([first], second), replacement), [replacement, second])
})
```

- [ ] **Step 2: Run the focused test and confirm red**

Run:

```text
node --experimental-strip-types --test tests/content-block-ui-model.test.ts
```

Expected: FAIL because `model.ts` does not exist.

- [ ] **Step 3: Implement pure state and gates**

```ts
export type ContentBlockUiStep = 'source' | 'review' | 'locale' | 'variant' | 'export'

export interface ImportedLocaleView {
  locale: string
  manifestPath: string
  manifest: LocaleAssetManifest | null
}

export interface ContentBlockViewState {
  projectDir: string
  videoPath: string
  srtPath: string
  sceneManifestPath: string
  sourceManifestPath: string
  sourceManifest: SourceBlockManifest | null
  importedLocales: ImportedLocaleView[]
  localeManifestPath: string
  localeManifest: LocaleAssetManifest | null
  variantPath: string
  variant: VariantPlan | null
  timelinePath: string
  subtitlePath: string
  timeline: RenderTimeline | null
  draftsDir: string
  templateDir: string
  projectName: string
  running: boolean
  progress: ContentBlockProgress | null
  error: string
  exportResult: ContentBlockCapCutExportResult | null
}

export function createInitialContentBlockState(): ContentBlockViewState
export function visibleContentBlockStep(state: ContentBlockViewState): ContentBlockUiStep
export function upsertImportedLocale(items: readonly ImportedLocaleView[], next: ImportedLocaleView): ImportedLocaleView[]
export function canAnalyzeContentBlocks(state: ContentBlockViewState): boolean
export function reviewIsComplete(manifest: SourceBlockManifest | null): boolean
export function canImportContentLocale(state: ContentBlockViewState, locale: string, localizedSrtPath: string, voiceDir: string): boolean
export function defaultVariantConstraints(manifest: SourceBlockManifest): VariantConstraints
export function canCreateContentVariant(state: ContentBlockViewState, variantId: string, seed: string): boolean
export function canBuildContentTimeline(state: ContentBlockViewState): boolean
export function canExportContentBlockCapCut(state: ContentBlockViewState): boolean
export function makeBoundaryEdit(blockId: string, seconds: number, locked: boolean): ContentBlockEditOperation
```

`visibleContentBlockStep` returns `source` without a source manifest, `review` while review is incomplete, `locale` without a locale manifest, `variant` without a variant and `export` afterward. `reviewIsComplete` requires every boundary state not `needs-review` and no `odd-unpaired-cue`/`srt-fallback` issues. `canExportContentBlockCapCut` requires source/locale/timeline/drafts/template/project paths, idle state and zero timeline review blocks.

- [ ] **Step 4: Create five focused presentational components**

Use controlled props; components do not call `window.api` directly.

```ts
export interface SourceStepProps {
  projectDir: string; videoPath: string; srtPath: string; sceneManifestPath: string
  running: boolean; canAnalyze: boolean
  onChange(field: 'projectDir' | 'videoPath' | 'srtPath' | 'sceneManifestPath', value: string): void
  onPick(field: 'projectDir' | 'videoPath' | 'srtPath' | 'sceneManifestPath'): void
  onAnalyze(): void
}

export interface ReviewStepProps {
  manifest: SourceBlockManifest
  running: boolean
  onEdit(operation: ContentBlockEditOperation): void
}

export interface LocaleStepProps {
  locale: string; localizedSrtPath: string; voiceDir: string; voiceMapPath: string
  importedLocales: ImportedLocaleView[]; selectedLocaleManifestPath: string
  result: LocaleAssetImportResult | null; running: boolean; canImport: boolean
  onChange(field: 'locale' | 'localizedSrtPath' | 'voiceDir' | 'voiceMapPath', value: string): void
  onPick(field: 'localizedSrtPath' | 'voiceDir' | 'voiceMapPath'): void
  onSelectLocale(manifestPath: string): void
  onImport(): void
}

export interface VariantStepProps {
  manifest: SourceBlockManifest; variantId: string; seed: string; variant: VariantPlan | null
  running: boolean; canCreate: boolean
  onVariantId(value: string): void; onSeed(value: string): void; onCreate(): void
}

export interface ExportStepProps {
  timeline: RenderTimeline | null; subtitlePath: string; draftsDir: string; templateDir: string; projectName: string
  result: ContentBlockCapCutExportResult | null; running: boolean; canBuild: boolean; canExport: boolean
  onBuildTimeline(): void; onPickDirectory(field: 'draftsDir' | 'templateDir'): void
  onChange(field: 'draftsDir' | 'templateDir' | 'projectName', value: string): void; onExport(): void
}
```

Required controls/content:

- Source: four path rows, analyze button, note that source media is not cut, and a visible notice that shuffle does not change source rights/reused-content obligations.
- Review: one card per block showing ID, role, cue text, source start/end seconds, boundary reason/state/issues; adjacent merge button, split selector after each internal cue, boundary numeric input, lock checkbox, semantic role/shuffle/dependency controls. Applying `set-semantic` is the explicit acceptance action for a legitimate odd standalone cue; applying `set-boundary` removes fallback review.
- Locale: BCP-47 locale, localized SRT, voice folder, optional voice-map; result lists missing/invalid/extra IDs/files. A selectable imported-locale list supports one or more locale artifacts; re-import replaces only the same locale.
- Variant: seed/ID, derived lock summary and read-only ordered block list.
- Export: per-block target/source duration, speed/adaptation, generated SRT path, CapCut template/drafts/project fields; export button disabled for review blocks.

- [ ] **Step 5: Replace Renderer entry with workflow orchestration**

`index.tsx` imports `./styles.css`, subscribes once to progress, owns state plus locale/variant form fields, and calls exactly these APIs:

```ts
useEffect(() => window.api.onContentBlockProgress((event) => {
  setState((current) => ({ ...current, progress: event }))
}), [])

const analyze = async (): Promise<void> => {
  await run(async () => {
    const result = await window.api.analyzeContentBlocks({
      projectDir: state.projectDir,
      videoPath: state.videoPath,
      srtPath: state.srtPath,
      sceneManifestPath: state.sceneManifestPath,
      existingManifestPath: state.sourceManifestPath || null
    })
    if (!result.ok || !result.manifest || !result.manifestPath) throw new Error(result.error ?? 'Analyze thất bại.')
    setState((current) => ({ ...current, sourceManifest: result.manifest!, sourceManifestPath: result.manifestPath!, importedLocales: [], localeManifest: null, localeManifestPath: '', variant: null, variantPath: '', timeline: null, timelinePath: '', subtitlePath: '' }))
  })
}
```

Implement matching handlers for edit/import/create variant/build timeline/export. Every upstream change clears downstream state:

- source edit clears every imported locale, variant and timeline;
- locale import upserts that locale, selects it and clears timeline only;
- selecting a different imported locale clears timeline and export result;
- variant recreation clears timeline only.

Catch unknown errors into a visible string; `finally` clears `running`; Cancel calls `cancelContentBlocks`. Export result exposes buttons through existing `window.api.openPath`, never through Node APIs.

Export exactly:

```ts
export const contentBlocksRendererFeature = {
  ...FEATURE_META,
  component: ContentBlocksPanel
} as const satisfies RendererFeature<typeof FEATURE_ID>
```

- [ ] **Step 6: Add structure test and responsive CSS**

The structure test reads `index.tsx` and all component files and asserts all five component names, all nine Preload method names (`pick`, six workflow stages, cancel and progress subscription), no `electron`/`node:fs`, and `...FEATURE_META`.

CSS requirements:

- `.content-blocks-grid` uses two columns above 980px and one below.
- Review cards show `accepted`, `locked`, `needs-review` with distinct existing theme-compatible borders; do not rely on color alone—include text badges.
- Cue text wraps; path text uses `overflow-wrap: anywhere`.
- Timeline rows align block, source/target duration, speed and adaptation in four columns on desktop, stacked on mobile.
- No fixed pixel height for lists; tab remains scrollable.

- [ ] **Step 7: Import UI tests and run them plus web typecheck**

Append:

```ts
import './content-block-ui-model.test.ts'
import './content-block-ui-structure.test.ts'
```

Run:

```text
node --experimental-strip-types --test tests/content-block-ui-model.test.ts tests/content-block-ui-structure.test.ts
npm run typecheck:web
npm run check:architecture
```

Expected: PASS.

- [ ] **Step 8: Manually exercise UI against fixture artifacts**

Run `npm run dev` and verify:

1. Switching tabs during analyze preserves progress because `keepAlive: true`.
2. A fallback block visibly blocks the locale/variant flow until corrected.
3. Merge/split/boundary/semantic operations update the manifest revision and clear stale downstream results.
4. A locale with missing voice reports cue IDs and does not remove an already imported locale.
5. A `needs-review` timeline disables CapCut export and shows the required speed.

Expected: all five observations hold; record defects before proceeding.

- [ ] **Step 9: Commit complete Renderer workflow**

```text
git add src/renderer/src/features/content-blocks/model.ts src/renderer/src/features/content-blocks/components/SourceStep.tsx src/renderer/src/features/content-blocks/components/ReviewStep.tsx src/renderer/src/features/content-blocks/components/LocaleStep.tsx src/renderer/src/features/content-blocks/components/VariantStep.tsx src/renderer/src/features/content-blocks/components/ExportStep.tsx src/renderer/src/features/content-blocks/index.tsx src/renderer/src/features/content-blocks/styles.css tests/content-block-ui-model.test.ts tests/content-block-ui-structure.test.ts tests/content-blocks.test.ts
git commit -m "feat: add content block review and export UI"
```

### Task 14: End-to-end fixtures, opt-in CapCut smoke, documentation and release gates

**Files:**
- Create: `tests/content-block-integration.test.ts`
- Create: `tests/content-block-capcut-smoke.test.ts`
- Modify: `tests/content-blocks.test.ts`
- Modify: `package.json`
- Create: `docs/CONTENT_BLOCKS.md`
- Modify: `docs/CAPCUT_FACTORY.md`

**Interfaces:**
- Consumes: the full V1 stack.
- Produces: one fake end-to-end gate, one explicit real-media smoke gate, runnable npm scripts and operator documentation.

- [ ] **Step 1: Write a fake end-to-end integration test**

Define the complete six-cue fixture locally in `tests/content-block-integration.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { adaptRenderTimelineToCapCut } from '../src/main/services/capCutBlockAdapter.ts'
import { assertVariantMatchesSource, fingerprintSourceManifest } from '../src/main/services/contentBlockManifest.ts'
import { buildRenderTimeline } from '../src/main/services/blockTimeline.ts'
import { createVariantPlan } from '../src/main/services/blockVariantPlanner.ts'
import type { LocaleAssetManifest, SourceBlockManifest } from '../src/shared/features/content-blocks.ts'

function threeBlockSourceFixture(): SourceBlockManifest {
  return {
    schemaVersion: 1,
    source: { path: 'C:\\fixture\\source.mp4', fingerprint: `sha256:${'a'.repeat(64)}`, durationUs: 12_000_000, fps: 30 },
    revision: 1,
    blocks: Array.from({ length: 3 }, (_, index) => {
      const blockNumber = index + 1
      const startUs = index * 4_000_000
      const questionId = `cue-${String(index * 2 + 1).padStart(3, '0')}`
      const answerId = `cue-${String(index * 2 + 2).padStart(3, '0')}`
      return {
        id: `block-${blockNumber}`,
        sourceRange: { startUs, endUs: startUs + 4_000_000 },
        cueIds: [questionId, answerId],
        dialogue: [
          { cueId: questionId, sourceIndex: index * 2 + 1, role: 'question' as const, text: `Q${blockNumber}`, sourceStartUs: startUs + 100_000, sourceEndUs: startUs + 1_000_000 },
          { cueId: answerId, sourceIndex: index * 2 + 2, role: 'answer' as const, text: `A${blockNumber}`, sourceStartUs: startUs + 1_100_000, sourceEndUs: startUs + 3_800_000 }
        ],
        boundary: { targetUs: startUs + 3_800_000, selectedUs: startUs + 4_000_000, reason: 'scene-near-srt' as const, reviewState: 'accepted' as const },
        semantic: { role: 'normal' as const, shuffleEligible: true, requiresPreviousBlockId: null },
        issues: []
      }
    })
  }
}

function threeBlockLocaleFixture(
  sourceManifestFingerprint: `sha256:${string}`,
  locale: string,
  questionDurationUs: number
): LocaleAssetManifest {
  const source = threeBlockSourceFixture()
  const answerDurationUs = 2_700_000 + (questionDurationUs - 1_000_000)
  return {
    schemaVersion: 1,
    sourceManifestFingerprint,
    locale,
    blocks: Object.fromEntries(source.blocks.map((block, blockIndex) => [
      block.id,
      { cues: block.cueIds.map((cueId, cueIndex) => ({
        cueId,
        text: `${locale}:${cueIndex === 0 ? 'Q' : 'A'}${blockIndex + 1}`,
        voicePath: `C:\\fixture\\${locale}\\${cueId}.wav`,
        voiceDurationUs: cueIndex === 0 ? questionDurationUs : answerDurationUs
      })) }
    ]))
  }
}

test('one source variant renders two locale timelines without content drift', () => {
  const source = threeBlockSourceFixture()
  const fingerprint = fingerprintSourceManifest(source)
  const variant = createVariantPlan(source, {
    variantId: 'variant-e2e', seed: 'e2e-seed',
    constraints: { lockedStartBlockIds: [], lockedEndBlockIds: [], preserveDependencyChains: true }
  })
  const vi = buildRenderTimeline(source, threeBlockLocaleFixture(fingerprint, 'vi-VN', 1_000_000), variant)
  const th = buildRenderTimeline(source, threeBlockLocaleFixture(fingerprint, 'th-TH', 1_080_000), variant)

  assert.deepEqual(vi.items.map((item) => item.blockId), variant.blockOrder)
  assert.deepEqual(th.items.map((item) => item.blockId), variant.blockOrder)
  assert.notEqual(vi.durationUs, th.durationUs)
  assert.equal(new Set(variant.blockOrder).size, 3)

  const viCapCut = adaptRenderTimelineToCapCut({ source, locale: threeBlockLocaleFixture(fingerprint, 'vi-VN', 1_000_000), timeline: vi, width: 1920, height: 1080, muteOriginalVideo: true })
  const thCapCut = adaptRenderTimelineToCapCut({ source, locale: threeBlockLocaleFixture(fingerprint, 'th-TH', 1_080_000), timeline: th, width: 1920, height: 1080, muteOriginalVideo: true })
  assert.equal(viCapCut.videoItems.length, 3)
  assert.equal(viCapCut.audioItems.length, 6)
  assert.equal(viCapCut.textItems.length, 6)
  assert.deepEqual(viCapCut.textItems.map((item) => item.text.replace(/^vi-VN:/u, '')), thCapCut.textItems.map((item) => item.text.replace(/^th-TH:/u, '')))
})

test('full stack rejects missing voice, stale fingerprint, duplicate block and hard speed', () => {
  const source = threeBlockSourceFixture()
  const fingerprint = fingerprintSourceManifest(source)
  const variant = createVariantPlan(source, {
    variantId: 'variant-negative', seed: 'negative-seed',
    constraints: { lockedStartBlockIds: [], lockedEndBlockIds: [], preserveDependencyChains: true }
  })

  const missing = threeBlockLocaleFixture(fingerprint, 'vi-VN', 1_000_000)
  missing.blocks['block-1'].cues.pop()
  assert.throws(() => buildRenderTimeline(source, missing, variant), /cue IDs/u)

  const stale = threeBlockLocaleFixture(`sha256:${'f'.repeat(64)}`, 'vi-VN', 1_000_000)
  assert.throws(() => buildRenderTimeline(source, stale, variant), /fingerprint/u)

  const duplicate = structuredClone(variant)
  duplicate.blockOrder[2] = duplicate.blockOrder[1]
  assert.throws(() => assertVariantMatchesSource(duplicate, source), /đúng một lần/u)

  const tooShort = threeBlockLocaleFixture(fingerprint, 'vi-VN', 200_000)
  for (const block of Object.values(tooShort.blocks)) for (const cue of block.cues) cue.voiceDurationUs = 200_000
  const reviewTimeline = buildRenderTimeline(source, tooShort, variant)
  assert.equal(reviewTimeline.reviewBlockIds.length, 3)
  assert.throws(() => adaptRenderTimelineToCapCut({ source, locale: tooShort, timeline: reviewTimeline, width: 1920, height: 1080, muteOriginalVideo: true }), /needs-review/u)
})
```

- [ ] **Step 2: Add an opt-in real-media smoke test with a safe config file**

`tests/content-block-capcut-smoke.test.ts` reads `CONTENT_BLOCK_SMOKE_CONFIG` only when `RUN_CONTENT_BLOCK_CAPCUT_SMOKE=1`; otherwise use `{ skip: 'Set RUN_CONTENT_BLOCK_CAPCUT_SMOKE=1 to run real CapCut smoke.' }`.

Config schema:

```ts
interface SmokeConfig {
  projectDir: string
  videoPath: string
  sourceSrtPath: string
  sceneManifestPath: string
  templateDir: string
  draftsDir: string
  locales: Array<{
    locale: string
    localizedSrtPath: string
    voiceDir: string
    voiceMapPath?: string
  }>
}
```

Safety gates before any write:

- every path is absolute;
- `locales.length >= 2`;
- `resolve(draftsDir)` is strictly inside `resolve(projectDir)` and its basename is `smoke-drafts`; reject the real CapCut default store;
- source/locale input files and template are read-only inputs;
- project contains at least three Q+A blocks.

The smoke executes analyze → import both locales → create one variant → build both timelines → export two projects named `Smoke <locale>`. Parse each generated `draft_content.json` and assert video segments equal block count, audio/text segments equal six, every material path exists, subtitle/audio target ranges for each cue match, and both locale drafts share the same block order in `tblao-content-blocks.json`. Re-run `createVariantPlan` in memory and assert the same order.

Use this executable test skeleton; helper `loadSmokeConfig` performs the safety checks above and throws before `createContentBlockWorkflow()` is called:

```ts
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import test from 'node:test'
import { createVariantPlan } from '../src/main/services/blockVariantPlanner.ts'
import { createContentBlockWorkflow } from '../src/main/services/contentBlockWorkflow.ts'
import type { RenderTimeline } from '../src/shared/features/content-blocks.ts'

async function loadSmokeConfig(configPath: string | undefined): Promise<SmokeConfig> {
  if (!configPath || !isAbsolute(configPath)) throw new Error('CONTENT_BLOCK_SMOKE_CONFIG phải là đường dẫn tuyệt đối.')
  const parsed = JSON.parse(await readFile(configPath, 'utf8')) as SmokeConfig
  if (!Array.isArray(parsed.locales) || parsed.locales.length < 2) throw new Error('Smoke cần ít nhất hai locale.')
  const requiredPaths = [
    parsed.projectDir, parsed.videoPath, parsed.sourceSrtPath, parsed.sceneManifestPath,
    parsed.templateDir, parsed.draftsDir,
    ...parsed.locales.flatMap((locale) => [locale.localizedSrtPath, locale.voiceDir, locale.voiceMapPath].filter((path): path is string => Boolean(path)))
  ]
  if (requiredPaths.some((path) => !isAbsolute(path))) throw new Error('Mọi path trong smoke config phải tuyệt đối.')
  const projectDir = resolve(parsed.projectDir)
  const draftsDir = resolve(parsed.draftsDir)
  const draftsRelative = relative(projectDir, draftsDir)
  if (!draftsRelative || draftsRelative.startsWith('..') || isAbsolute(draftsRelative) || basename(draftsDir) !== 'smoke-drafts') {
    throw new Error('draftsDir phải là thư mục con smoke-drafts bên trong projectDir.')
  }
  for (const inputPath of [
    parsed.videoPath, parsed.sourceSrtPath, parsed.sceneManifestPath, parsed.templateDir,
    ...parsed.locales.flatMap((locale) => [locale.localizedSrtPath, locale.voiceDir, locale.voiceMapPath].filter((path): path is string => Boolean(path)))
  ]) await stat(inputPath)
  return { ...parsed, projectDir, draftsDir }
}

async function assertDraftMatchesTimeline(draft: Record<string, unknown>, timeline: RenderTimeline): Promise<void> {
  const tracks = draft.tracks as Array<{ type: string; segments: Array<{ target_timerange: { start: number; duration: number } }> }>
  const video = tracks.find((track) => track.type === 'video')?.segments ?? []
  const audio = tracks.find((track) => track.type === 'audio')?.segments ?? []
  const text = tracks.find((track) => track.type === 'text')?.segments ?? []
  const expectedCues = timeline.items.flatMap((item) => item.subtitleCues)
  assert.equal(video.length, timeline.items.length)
  assert.equal(audio.length, expectedCues.length)
  assert.equal(text.length, expectedCues.length)
  for (const [index, cue] of expectedCues.entries()) {
    const expectedRange = { start: cue.startUs, duration: cue.endUs - cue.startUs }
    assert.deepEqual(audio[index].target_timerange, expectedRange)
    assert.deepEqual(text[index].target_timerange, expectedRange)
  }
  const materials = draft.materials as Record<string, Array<Record<string, unknown>>>
  for (const material of [...(materials.videos ?? []), ...(materials.audios ?? [])]) {
    const path = ['path', 'local_material_file_path', 'file_Path', 'file_path']
      .map((key) => material[key])
      .find((value): value is string => typeof value === 'string' && value.length > 0)
    assert.ok(path, 'Media material phải có local path.')
    assert.equal((await stat(path)).isFile(), true)
  }
}

const runSmoke = process.env.RUN_CONTENT_BLOCK_CAPCUT_SMOKE === '1'

test('real media creates two aligned and parseable CapCut drafts', {
  skip: runSmoke ? false : 'Set RUN_CONTENT_BLOCK_CAPCUT_SMOKE=1 to run real CapCut smoke.'
}, async () => {
  const config = await loadSmokeConfig(process.env.CONTENT_BLOCK_SMOKE_CONFIG)
  const workflow = createContentBlockWorkflow()
  const analyzed = await workflow.analyze({
    projectDir: config.projectDir,
    videoPath: config.videoPath,
    srtPath: config.sourceSrtPath,
    sceneManifestPath: config.sceneManifestPath
  })
  assert.equal(analyzed.ok, true, analyzed.error)
  assert.ok(analyzed.manifest && analyzed.manifest.blocks.length >= 3)

  const localeResults = []
  for (const locale of config.locales) {
    const imported = await workflow.importLocale({
      projectDir: config.projectDir,
      sourceManifestPath: analyzed.manifestPath!,
      locale: locale.locale,
      localizedSrtPath: locale.localizedSrtPath,
      voiceDir: locale.voiceDir,
      voiceMapPath: locale.voiceMapPath ?? null
    })
    assert.equal(imported.ok, true, imported.error)
    localeResults.push(imported)
  }

  const variant = await workflow.createVariant({
    projectDir: config.projectDir,
    sourceManifestPath: analyzed.manifestPath!,
    variantId: 'smoke-variant',
    seed: 'smoke-seed',
    constraints: { lockedStartBlockIds: [], lockedEndBlockIds: [], preserveDependencyChains: true }
  })
  assert.equal(variant.ok, true, variant.error)

  const provenOrders: string[][] = []
  for (const [index, locale] of config.locales.entries()) {
    const timeline = await workflow.buildTimeline({
      projectDir: config.projectDir,
      sourceManifestPath: analyzed.manifestPath!,
      localeManifestPath: localeResults[index].manifestPath!,
      variantPath: variant.variantPath!
    })
    assert.equal(timeline.ok, true, timeline.error)
    assert.deepEqual(timeline.timeline?.reviewBlockIds, [])
    const exported = await workflow.exportCapCut({
      sourceManifestPath: analyzed.manifestPath!,
      localeManifestPath: localeResults[index].manifestPath!,
      timelinePath: timeline.timelinePath!,
      draftsDir: config.draftsDir,
      templateDir: config.templateDir,
      projectName: `Smoke ${locale.locale}`,
      muteOriginalVideo: true
    })
    assert.equal(exported.ok, true, exported.error)
    const draft = JSON.parse(await readFile(join(exported.projectPath!, 'draft_content.json'), 'utf8'))
    await assertDraftMatchesTimeline(draft, timeline.timeline!)
    const provenance = JSON.parse(await readFile(exported.provenanceManifestPath!, 'utf8'))
    provenOrders.push(provenance.blockOrder)
  }
  assert.deepEqual(provenOrders[0], provenOrders[1])
  const replayed = createVariantPlan(analyzed.manifest!, {
    variantId: 'smoke-variant', seed: 'smoke-seed',
    constraints: { lockedStartBlockIds: [], lockedEndBlockIds: [], preserveDependencyChains: true }
  })
  assert.deepEqual(replayed.blockOrder, provenOrders[0])
})
```

`assertDraftMatchesTimeline` locates tracks by `type`, requires video segment count `timeline.items.length`, audio/text count equal flattened subtitle count, compares each audio/text `target_timerange.start/duration`, and verifies every material path with `stat(path).isFile()`. It performs no writes.

- [ ] **Step 3: Import integration test and add npm scripts**

Append:

```ts
import './content-block-integration.test.ts'
```

Add scripts without changing existing smoke behavior:

```json
{
  "test:content-blocks": "node --experimental-strip-types --test tests/content-blocks.test.ts",
  "test:smoke:content-blocks": "node --experimental-strip-types --test tests/content-block-capcut-smoke.test.ts"
}
```

Append `tests/content-blocks.test.ts` once to the existing explicit `test:unit` command. Do not add the real smoke test to `test:unit` or `verify`.

- [ ] **Step 4: Write operator/developer documentation**

`docs/CONTENT_BLOCKS.md` must include these concrete sections:

1. Legacy timing vs block-render timing and which tab owns each.
2. Artifact tree and all four schema relationships/fingerprint gates.
3. `voice-map.json` example:

   ```json
   {
     "cue-001": "question-01.wav",
     "cue-002": "answer-01.wav"
   }
   ```

4. Pair grouping/manual merge/split/boundary semantics.
5. Speed policy table with exact four bounds and export-blocking behavior.
6. Deterministic variant constraints and dependency limitations.
7. CapCut template requirements, source asset deduplication and provenance file.
8. Troubleshooting for stale fingerprint, missing voice, fallback boundary, hard speed and open/existing draft.
9. Real smoke config example using paths under a dedicated test project.
10. Human QA metrics: grouping correction rate, fallback rate, speed violations, content-order defects and audible/visible sync defects.
11. Rights/policy notice: block shuffle is an editing operation, not proof of originality or permission to reuse source media.

Update `docs/CAPCUT_FACTORY.md` with a short “Hai timing mode” section:

- Existing CapCut Factory remains `preserve-source-timeline` and maps natural-order voice to existing SRT windows.
- Content Blocks tab uses `block-render-timeline` and exports through `capCutBlockAdapter.ts`.
- Neither mode calls the other, and block grouping/shuffle is not implemented in `capCutFactory.ts`.

- [ ] **Step 5: Run all focused content-block tests**

Run:

```text
npm run test:content-blocks
```

Expected: all content-block unit/integration tests PASS; zero skipped tests in this script.

- [ ] **Step 6: Run full repository regression gates**

Run:

```text
npm run test:unit
npm run typecheck
npm run check:architecture
npm run build
```

Expected: all commands exit 0. Record exact command output in the implementation handoff; do not infer success from an earlier run.

- [ ] **Step 7: Run real CapCut smoke when fixture is available**

PowerShell example:

```text
$env:RUN_CONTENT_BLOCK_CAPCUT_SMOKE='1'
$env:CONTENT_BLOCK_SMOKE_CONFIG='F:\\content-block-smoke\\smoke-config.json'
npm run test:smoke:content-blocks
```

Expected: PASS with two parseable drafts under `<projectDir>/smoke-drafts`. If no approved fixture/template is available, report this gate as **not run**, not passed; unit/integration completion remains valid but V1 release readiness remains pending.

- [ ] **Step 8: Perform human QA on representative sources**

For each approved source, record:

- total blocks and blocks manually regrouped;
- total boundaries and `srt-fallback` count;
- hard/soft speed warning count by locale;
- any Q/A mismatch after shuffle;
- any visible media/voice/subtitle drift;
- CapCut version/template used.

Release gate: no missing/duplicated cue, no content mismatch, no out-of-bounds SRT, and every hard-speed case resolved or explicitly excluded from export.

- [ ] **Step 9: Commit tests and documentation**

```text
git add tests/content-block-integration.test.ts tests/content-block-capcut-smoke.test.ts tests/content-blocks.test.ts package.json docs/CONTENT_BLOCKS.md docs/CAPCUT_FACTORY.md
git commit -m "test: verify manifest-first CapCut workflow"
```

## Acceptance Traceability

| V1 acceptance criterion | Primary gate |
|---|---|
| No cue split across blocks | Tasks 2, 4, 6 tests |
| No missing/duplicate block in variant | Task 8 tests |
| Same seed gives same order | Task 8 + Task 14 integration |
| Separate timeline per locale | Task 9 + Task 14 integration |
| Voice never trimmed or sped | Task 9 + Task 10 adapter tests |
| Regenerated SRT monotonic/in bounds | Task 9 tests |
| Source edit requires no re-encode | Task 5 analyzer test + architecture |
| Fallback/hard speed visible in review | Tasks 4, 9, 13 tests |
| Legacy CapCut/SRT workflow unchanged | Tasks 7, 10 build gate + full regression |
| Core runs without CapCut | Tasks 2–9 unit tests |
| Draft contains aligned video/audio/text | Task 10 native test + Task 14 smoke |
| Source replacement is blocked | Tasks 2 and 11 fingerprint tests |

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-21-manifest-first-capcut-adapter.md`. Two execution options:

1. **Subagent-Driven (recommended)** — use `superpowers:subagent-driven-development`; dispatch one fresh implementer per task and run spec/code review between tasks.
2. **Inline Execution** — use `superpowers:executing-plans`; execute in this session in small batches with review checkpoints.

Before either option, create isolation with `superpowers:using-git-worktrees` only if the current uncommitted spec/plan and user-owned changes have first been preserved in a safe baseline. Do not create a worktree from bare `HEAD` that omits these planning artifacts.
