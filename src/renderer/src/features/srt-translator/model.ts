import {
  validateLocaleTargetInput,
  type SrtAnalyzeErrorCode,
  type SrtAnalyzeResult,
  type SrtCancelResult,
  type SrtLocaleTargetInput,
  type SrtLocalizationProgress,
  type SrtLocalizationTranslateResult,
  type SrtLoadResult,
  type SrtRateStatus,
  type SrtReviewCue
} from '../../../../shared/features/srt-translator.ts'

export type SrtWorkflowStep = 'source' | 'restoration' | 'review' | 'translation' | 'export'
export type SrtTargetStatus = 'queued' | 'running' | 'done' | 'error'

export interface SrtTargetView extends SrtLocaleTargetInput {
  status: SrtTargetStatus
  srt?: string
  count?: number
  error?: string
  exportedPath?: string
  unverified: boolean
  rateStatus?: SrtRateStatus
}

export interface SrtTranslatorViewState {
  sourcePath: string
  sourceText: string
  sourceCount: number
  lastCueEndSeconds: number
  videoPath: string
  videoDurationSeconds: number
  jobId: string
  retiredJobIds: string[]
  topicVi: string
  reviewCues: SrtReviewCue[]
  unresolvedCueNumbers: number[]
  selections: Record<number, string>
  targets: SrtLocaleTargetInput[]
  targetViews: SrtTargetView[]
  selectedTargetId: string
  progress: SrtLocalizationProgress | null
  running: boolean
  geminiReady: boolean | null
  unverified: boolean
  error: string
  analyzeErrorCode: SrtAnalyzeErrorCode | ''
  cleanupWarning: string
  rateSourceUpdatedAt: string
  rateAttributionUrl: string
  exportMessage: string
}

export type SrtTranslatorAction =
  | { type: 'gemini-status'; ready: boolean }
  | { type: 'source-loaded'; result: SrtLoadResult }
  | { type: 'video-selected'; path: string }
  | { type: 'reset' }
  | { type: 'analyze-started' }
  | { type: 'analyze-succeeded'; result: SrtAnalyzeResult }
  | { type: 'analyze-failed'; error: string; errorCode?: SrtAnalyzeErrorCode; cleanupWarning?: string }
  | { type: 'review-selected'; cueNumber: number; candidateId: string }
  | { type: 'resolve-started' }
  | { type: 'resolve-succeeded' }
  | { type: 'resolve-failed'; error: string }
  | { type: 'targets-changed'; targets: SrtLocaleTargetInput[] }
  | { type: 'target-selected'; targetId: string }
  | { type: 'translation-started' }
  | { type: 'translation-finished'; result: SrtLocalizationTranslateResult }
  | { type: 'translation-failed'; error: string }
  | { type: 'progress'; event: SrtLocalizationProgress }
  | { type: 'cancelled'; result: SrtCancelResult }
  | { type: 'cleanup-warning'; warning: string }
  | { type: 'export-finished'; targetId?: string; paths: string[]; message: string }

function clearDerivedState(state: SrtTranslatorViewState): SrtTranslatorViewState {
  const retiredJobIds = state.jobId && !state.retiredJobIds.includes(state.jobId)
    ? [...state.retiredJobIds, state.jobId].slice(-8)
    : state.retiredJobIds
  return {
    ...state,
    videoPath: '',
    videoDurationSeconds: 0,
    jobId: '',
    retiredJobIds,
    topicVi: '',
    reviewCues: [],
    unresolvedCueNumbers: [],
    selections: {},
    targets: [],
    targetViews: [],
    selectedTargetId: '',
    progress: null,
    running: false,
    unverified: false,
    error: '',
    analyzeErrorCode: '',
    cleanupWarning: '',
    rateSourceUpdatedAt: '',
    rateAttributionUrl: '',
    exportMessage: ''
  }
}

function clearJobState(state: SrtTranslatorViewState): SrtTranslatorViewState {
  const retiredJobIds = state.jobId && !state.retiredJobIds.includes(state.jobId)
    ? [...state.retiredJobIds, state.jobId].slice(-8)
    : state.retiredJobIds
  return { ...state, jobId: '', retiredJobIds, progress: null, running: false }
}

function createTargetViews(targets: readonly SrtLocaleTargetInput[], status: SrtTargetStatus = 'queued'): SrtTargetView[] {
  return targets.map((target) => ({ ...target, status, unverified: false }))
}

function validTargets(targets: readonly SrtLocaleTargetInput[]): SrtLocaleTargetInput[] {
  const seen = new Set<string>()
  const result: SrtLocaleTargetInput[] = []
  for (const target of targets) {
    const checked = validateLocaleTargetInput(target)
    if (!checked.ok || seen.has(checked.value.id)) continue
    seen.add(checked.value.id)
    result.push(checked.value)
  }
  return result
}

function applyTranslationResults(
  targets: readonly SrtLocaleTargetInput[],
  result: SrtLocalizationTranslateResult
): SrtTargetView[] {
  const byId = new Map(result.translations.map((item) => [item.target.id, item]))
  return targets.map((target) => {
    const translation = byId.get(target.id)
    if (!translation) return { ...target, status: 'queued', unverified: false }
    return {
      ...target,
      status: translation.ok && Boolean(translation.srt) ? 'done' : 'error',
      srt: translation.srt,
      count: translation.count,
      error: translation.error,
      exportedPath: undefined,
      unverified: translation.unverified,
      rateStatus: translation.rateStatus
    }
  })
}

export function createInitialSrtTranslatorState(): SrtTranslatorViewState {
  return {
    sourcePath: '', sourceText: '', sourceCount: 0, lastCueEndSeconds: 0,
    videoPath: '', videoDurationSeconds: 0, jobId: '', retiredJobIds: [], topicVi: '',
    reviewCues: [], unresolvedCueNumbers: [], selections: {}, targets: [],
    targetViews: [], selectedTargetId: '', progress: null, running: false,
    geminiReady: null, unverified: false, error: '', analyzeErrorCode: '',
    cleanupWarning: '', rateSourceUpdatedAt: '', rateAttributionUrl: '', exportMessage: ''
  }
}

export function jobIdToReleaseBeforeReplacement(state: SrtTranslatorViewState): string | null {
  return state.jobId || null
}

export function srtTranslatorReducer(
  state: SrtTranslatorViewState,
  action: SrtTranslatorAction
): SrtTranslatorViewState {
  switch (action.type) {
    case 'gemini-status':
      return { ...state, geminiReady: action.ready }
    case 'source-loaded':
      if (!action.result.ok) {
        return { ...clearDerivedState(state), sourcePath: action.result.sourcePath, error: action.result.error ?? 'Không thể đọc SRT.' }
      }
      return {
        ...clearDerivedState(state),
        sourcePath: action.result.sourcePath,
        sourceText: action.result.sourceText ?? '',
        sourceCount: action.result.count ?? 0,
        lastCueEndSeconds: action.result.lastCueEndSeconds ?? 0
      }
    case 'video-selected':
      return {
        ...clearDerivedState(state), sourcePath: state.sourcePath, sourceText: state.sourceText,
        sourceCount: state.sourceCount, lastCueEndSeconds: state.lastCueEndSeconds, videoPath: action.path
      }
    case 'reset':
      return { ...clearDerivedState(state), sourcePath: '', sourceText: '', sourceCount: 0, lastCueEndSeconds: 0 }
    case 'analyze-started':
      return {
        ...clearJobState(state), topicVi: '', reviewCues: [], unresolvedCueNumbers: [], selections: {},
        targetViews: [], selectedTargetId: '', progress: null, running: true, unverified: false,
        error: '', analyzeErrorCode: '', cleanupWarning: '', rateSourceUpdatedAt: '', rateAttributionUrl: '', exportMessage: ''
      }
    case 'analyze-succeeded':
      return {
        ...state,
        sourcePath: action.result.sourcePath,
        sourceText: action.result.sourceText ?? state.sourceText,
        sourceCount: action.result.cueCount ?? state.sourceCount,
        videoPath: action.result.videoPath ?? '',
        videoDurationSeconds: action.result.videoDurationSeconds ?? 0,
        jobId: action.result.jobId ?? '', topicVi: action.result.topicVi ?? '',
        reviewCues: action.result.reviewCues ?? [], unresolvedCueNumbers: action.result.unresolvedCueNumbers ?? [], selections: {},
        targetViews: [], selectedTargetId: '', progress: null, running: false,
        // The current workflow is text-only by design. A legacy verified
        // request may still explicitly return false for compatibility.
        unverified: action.result.unverified !== false, error: '', analyzeErrorCode: '',
        cleanupWarning: action.result.cleanupWarning ?? '', exportMessage: ''
      }
    case 'analyze-failed':
      return { ...clearJobState(state), error: action.error, analyzeErrorCode: action.errorCode ?? 'unknown', cleanupWarning: action.cleanupWarning ?? '' }
    case 'review-selected': {
      const cue = state.reviewCues.find((item) => item.n === action.cueNumber)
      if (!cue || !state.unresolvedCueNumbers.includes(action.cueNumber) || !cue.candidates.some((candidate) => candidate.id === action.candidateId)) return state
      return { ...state, selections: { ...state.selections, [action.cueNumber]: action.candidateId }, error: '' }
    }
    case 'resolve-started':
      return { ...state, running: true, progress: null, error: '' }
    case 'resolve-succeeded':
      return { ...state, unresolvedCueNumbers: [], running: false, progress: null, error: '' }
    case 'resolve-failed':
      return { ...state, running: false, progress: null, error: action.error }
    case 'targets-changed': {
      if (!Array.isArray(action.targets)) return { ...state, error: 'Danh sách target locale không hợp lệ.' }
      const targets = validTargets(action.targets)
      if (targets.length !== action.targets.length) return { ...state, error: 'Một target locale không hợp lệ hoặc bị trùng.' }
      const selectedTargetId = targets.some((target) => target.id === state.selectedTargetId) ? state.selectedTargetId : targets[0]?.id ?? ''
      return { ...state, targets, targetViews: createTargetViews(targets), selectedTargetId, exportMessage: '', error: '' }
    }
    case 'target-selected':
      return state.targetViews.some((target) => target.id === action.targetId) ? { ...state, selectedTargetId: action.targetId } : state
    case 'translation-started':
      return { ...state, running: true, progress: null, error: '', targetViews: createTargetViews(state.targets, 'running') }
    case 'translation-finished': {
      const targetViews = applyTranslationResults(state.targets, action.result)
      return {
        ...clearJobState(state), targetViews,
        selectedTargetId: targetViews.find((view) => view.status === 'done')?.id ?? targetViews[0]?.id ?? '',
        unverified: targetViews.some((view) => view.unverified),
        error: action.result.ok ? '' : action.result.error ?? 'Không có target nào dịch thành công.',
        cleanupWarning: action.result.cleanupWarning ?? '',
        rateSourceUpdatedAt: action.result.rateSnapshot?.sourceUpdatedAt ?? '',
        rateAttributionUrl: action.result.rateSnapshot?.attributionUrl ?? '', exportMessage: ''
      }
    }
    case 'translation-failed':
      return { ...clearJobState(state), error: action.error }
    case 'progress': {
      const event = action.event
      if (!event.jobId || !state.running || state.retiredJobIds.includes(event.jobId) || (state.jobId && state.jobId !== event.jobId)) return state
      const current = state.progress
      if (current && current.jobId === event.jobId && current.phase === event.phase && current.percent !== undefined && event.percent !== undefined && event.percent < current.percent) return state
      return { ...state, jobId: state.jobId || event.jobId, progress: { ...event, percent: progressPercent(event) } }
    }
    case 'cancelled':
      return { ...clearJobState(state), error: action.result.ok ? '' : action.result.error ?? 'Không thể hủy tác vụ.', cleanupWarning: action.result.cleanupWarning ?? state.cleanupWarning, exportMessage: '' }
    case 'cleanup-warning':
      return { ...state, cleanupWarning: action.warning }
    case 'export-finished':
      return {
        ...state, exportMessage: action.message,
        targetViews: action.targetId ? state.targetViews.map((view) => view.id === action.targetId ? { ...view, exportedPath: action.paths[0] } : view) : state.targetViews
      }
    default:
      return state
  }
}

export function canAnalyze(state: SrtTranslatorViewState): boolean {
  return Boolean(state.sourcePath.trim()) && state.geminiReady === true && !state.running
}

export function canResolve(state: SrtTranslatorViewState): boolean {
  if (!state.jobId || state.running || !state.unresolvedCueNumbers.length) return false
  return state.unresolvedCueNumbers.every((cueNumber) => {
    const selected = state.selections[cueNumber]
    return Boolean(selected && state.reviewCues.find((cue) => cue.n === cueNumber)?.candidates.some((candidate) => candidate.id === selected))
  })
}

export function canTranslate(state: SrtTranslatorViewState): boolean {
  return Boolean(state.jobId) && state.unresolvedCueNumbers.length === 0 && state.targets.length > 0 && validTargets(state.targets).length === state.targets.length && state.geminiReady === true && !state.running
}

export function visibleStep(state: SrtTranslatorViewState): SrtWorkflowStep {
  if (state.running) {
    const phase = state.progress?.phase
    if (!phase || ['validating', 'uploading-video', 'processing-video', 'restoring-source', 'auditing-source'].includes(phase)) return 'restoration'
    if (phase === 'review-required' || state.unresolvedCueNumbers.length) return 'review'
    if (['fetching-rates', 'translating', 'cleaning-up'].includes(phase)) return 'translation'
  }
  if (state.unresolvedCueNumbers.length || state.progress?.phase === 'review-required') return 'review'
  if (state.targetViews.some((view) => view.status === 'done' || view.status === 'error')) return 'export'
  if (state.jobId) return 'translation'
  return 'source'
}

export function progressPercent(progress: SrtLocalizationProgress | null): number {
  if (!progress || progress.percent === undefined || !Number.isFinite(progress.percent)) return 0
  return Math.min(100, Math.max(0, progress.percent))
}
