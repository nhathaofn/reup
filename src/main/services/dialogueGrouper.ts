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
