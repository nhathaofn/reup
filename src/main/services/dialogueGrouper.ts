import type {
  ContentBlockIssue,
  ContentBlockRole,
  SourceContentBlock,
  SourceDialogueCue
} from '../../shared/features/content-blocks.ts'

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

export interface QuestionBoundaryGroupingOptions extends PairGroupingOptions {
  isQuestion?: (cue: SourceDialogueCue) => boolean
}

function validateOrderedCues(orderedCues: readonly SourceDialogueCue[]): void {
  const seen = new Set<string>()
  for (const cue of orderedCues) {
    if (seen.has(cue.cueId)) throw new Error(`Cue ID bị trùng: ${cue.cueId}.`)
    if (cue.sourceEndUs <= cue.sourceStartUs) throw new Error(`Cue ${cue.cueId} có thời lượng không hợp lệ.`)
    seen.add(cue.cueId)
  }
}

export function isQuestionLikeCue(cue: Pick<SourceDialogueCue, 'text'>): boolean {
  const text = cue.text.replace(/\s+/gu, ' ').trim()
  if (!text) return false
  return /[?？]\s*$/u.test(text) ||
    /(?:哪国|哪个|哪一个|什么|多少|谁|哪里|为何|为什么|怎么|如何|是否)/u.test(text) ||
    /(?:吗|呢)$/u.test(text) ||
    /^(?:what|which|who|where|when|why|how|is|are|do|does|can|could|would)\b/iu.test(text) ||
    /(?:だれ|どこ|なに|何|どの|なぜ|どう|ですか|ますか|か)$/u.test(text) ||
    /(?:뭐|무엇|어떤|누구|어디|왜|어떻게|인가요|습니까)$/u.test(text) ||
    /^(?:ai|gì|nào|ở đâu|khi nào|tại sao|vì sao|bao nhiêu)\b/iu.test(text)
}

function makeStandaloneGroup(
  cue: SourceDialogueCue,
  role: Exclude<ContentBlockRole, 'normal'>,
  makeBlockId: () => string
): DialogueGroup {
  return {
    id: makeBlockId(),
    cueIds: [cue.cueId],
    dialogue: [{ ...cue, role: 'statement' }],
    semantic: { role, shuffleEligible: false, requiresPreviousBlockId: null },
    issues: []
  }
}

function makeQuestionBoundaryGroup(
  cues: readonly SourceDialogueCue[],
  makeBlockId: () => string,
  reviewIssue: ContentBlockIssue | null = null
): DialogueGroup {
  const dialogue = cues.map((cue, index) => ({
    ...cue,
    role: reviewIssue === 'grouping-review'
      ? 'statement' as const
      : index === 0 ? 'question' as const : index === 1 ? 'answer' as const : 'statement' as const
  }))
  return {
    id: makeBlockId(),
    cueIds: dialogue.map((cue) => cue.cueId),
    dialogue,
    semantic: { role: 'normal', shuffleEligible: reviewIssue === null, requiresPreviousBlockId: null },
    issues: reviewIssue ? [reviewIssue] : []
  }
}

/**
 * Groups a question with every following cue until the next question.
 * This keeps answer continuations (for example salary lines) in the same block.
 */
export function groupDialogueByQuestionBoundaries(
  orderedCues: readonly SourceDialogueCue[],
  options: QuestionBoundaryGroupingOptions
): DialogueGroup[] {
  validateOrderedCues(orderedCues)
  const groups: DialogueGroup[] = []
  const isQuestion = options.isQuestion ?? isQuestionLikeCue

  for (let index = 0; index < orderedCues.length;) {
    const cue = orderedCues[index]
    const standaloneRole = options.standalone?.[cue.cueId]
    if (standaloneRole) {
      groups.push(makeStandaloneGroup(cue, standaloneRole, options.makeBlockId))
      index += 1
      continue
    }

    if (!isQuestion(cue)) {
      const start = index
      while (
        index < orderedCues.length &&
        !options.standalone?.[orderedCues[index].cueId] &&
        !isQuestion(orderedCues[index])
      ) {
        index += 1
      }
      groups.push(makeQuestionBoundaryGroup(
        orderedCues.slice(start, index).map((item) => ({ ...item, role: 'statement' as const })),
        options.makeBlockId,
        'grouping-review'
      ))
      continue
    }

    const start = index
    index += 1
    while (
      index < orderedCues.length &&
      !options.standalone?.[orderedCues[index].cueId] &&
      !isQuestion(orderedCues[index])
    ) {
      index += 1
    }
    const cues = orderedCues.slice(start, index)
    groups.push(makeQuestionBoundaryGroup(
      cues,
      options.makeBlockId,
      cues.length < 2 ? 'odd-unpaired-cue' : null
    ))
  }
  return groups
}

export function groupDialoguePairs(
  orderedCues: readonly SourceDialogueCue[],
  options: PairGroupingOptions
): DialogueGroup[] {
  validateOrderedCues(orderedCues)

  const groups: DialogueGroup[] = []
  for (let index = 0; index < orderedCues.length;) {
    const first = orderedCues[index]
    const standaloneRole = options.standalone?.[first.cueId]
    if (standaloneRole) {
      const dialogue: SourceDialogueCue[] = [{ ...first, role: 'statement' }]
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

    const dialogue: SourceDialogueCue[] = [
      { ...first, role: 'question' },
      { ...second, role: 'answer' }
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
