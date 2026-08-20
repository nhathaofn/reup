/**
 * Context-aware TTS normalization for Chinese speech synthesis.
 *
 * Provides safe, context-bound text transformations so TTS engines pronounce
 * natural spoken dialogue accurately (e.g. converting numeric "0" to "零"
 * in phrases like "从0加速" while strictly leaving alphanumeric product codes,
 * years, temperatures, and measurements like "CR450", "2030年", "GOA4",
 * "600公里" untouched).
 */

const SAFE_ZERO_CONTEXT_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Patterns like "从0开始", "从0加速", "从0起步", "从0到"
  { pattern: /从0(?=[加开起到至])/gu, replacement: '从零' },
  // Patterns like "0到600", "0至100"
  { pattern: /(^|[^\p{N}])0(?=[到至]\d)/gu, replacement: '$1零' },
  // Patterns like "降到0", "接近0", "达到0", "回到0", "归0", "变为0", "跌到0"
  { pattern: /(降到|接近|达到|回到|降至|归|变为|跌至|跌到|等于)0(?=[^\p{N}]|$)/gu, replacement: '$1零' },
  // Patterns like "0距离", "0门槛", "0污染", "0排放", "0失误"
  { pattern: /(^|[^\p{N}])0(?=(距离|门槛|污染|排放|失误|误差|故障|延迟|容忍))/gu, replacement: '$1零' }
]

/**
 * Apply context-aware TTS normalization to a Chinese text string.
 */
export function ttsNormalizeChinese(text: string): string {
  if (!text || typeof text !== 'string') return ''
  let result = text
  for (const { pattern, replacement } of SAFE_ZERO_CONTEXT_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

/**
 * Apply TTS normalization to all cues in an SRT subtitle string.
 * Keeps timestamps, indices, and SRT formatting intact.
 */
export function ttsNormalizeSrt(srtText: string): string {
  if (!srtText || typeof srtText !== 'string') return ''
  const blocks = srtText.replace(/\r\n?/gu, '\n').trim().split(/\n[ \t]*\n/u)
  const normalizedBlocks = blocks.map((block) => {
    const lines = block.split('\n')
    if (lines.length < 3) return block
    const indexLine = lines[0]
    const timeLine = lines[1]
    const textLines = lines.slice(2).join('\n')
    const normalizedText = ttsNormalizeChinese(textLines)
    return `${indexLine}\n${timeLine}\n${normalizedText}`
  })
  return normalizedBlocks.join('\n\n') + '\n'
}
