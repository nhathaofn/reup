import { DICH_LANGS, type SrtBlock } from '../shared/types'

/** Gioi han ky tu moi chunk gui AI. */
export const MAX_CHARS = 20000

const TARGET_LANGUAGE_NAMES: Record<string, string> = {
  vi: 'Vietnamese',
  en: 'English',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  id: 'Indonesian',
  th: 'Thai',
  pt: 'Portuguese',
  ru: 'Russian',
  ar: 'Arabic'
}

/** Prompt he thong dung chung cho moi nha cung cap. */
export function huongDan(ma: string): string {
  const ten = DICH_LANGS.find((l) => l.code === ma)?.label ?? ma
  return [
    `Bạn là một dịch giả chuyên nghiệp. Hãy dịch phụ đề được cung cấp sang ${ten}.`,
    '',
    'Yêu cầu bắt buộc:',
    '1. Mỗi phần tử trả về: n = đúng số thứ tự dòng gốc, t = bản dịch của dòng đó.',
    '2. Trả về ĐÚNG số dòng đã nhận. KHÔNG gộp hai dòng, KHÔNG tách một dòng thành hai.',
    '3. Một dòng gốc có thể là câu chưa trọn nghĩa (phụ đề cắt theo khoảng lặng). Giữ nguyên',
    '   ranh giới dòng, dùng các dòng xung quanh làm ngữ cảnh để dịch cho đúng.',
    '4. Giữ nguyên các nhãn dạng [SPEAKER_00] ở đúng vị trí cũ, không dịch, không xoá.',
    '5. Dịch sát nghĩa, tự nhiên, đúng văn phong gốc. Không thêm bớt, không giải thích.'
  ].join('\n')
}

/**
 * Prompt dùng cho tab đa ngôn ngữ: dịch và biên tập lại thành lời thoại ngắn,
 * tự nhiên cho thị trường đích nhưng vẫn giữ nguyên ý, số liệu và ranh giới cue.
 */
export function huongDanDiaPhuong(ma: string, phongCach: string): string {
  const ten = DICH_LANGS.find((l) => l.code === ma)?.label ?? ma
  const englishName = TARGET_LANGUAGE_NAMES[ma] ?? ma
  const style = phongCach.trim() || 'tự nhiên, dễ nghe'
  const targetQualityRules = ma === 'vi'
    ? [
        'Vietnamese quality rule: first understand the complete source meaning internally, then express that meaning in fluent Vietnamese; do not translate word by word.',
        'Use established Vietnamese vocabulary and names. Never combine a Sino-Vietnamese reading with an English word. Example: 海狮 = sư tử biển (never "hải lion"); 睡着 = đang ngủ (not "ngủ dậy").',
        'Before returning JSON, silently review every t field and replace foreign, hybrid, or unnatural terms with standard Vietnamese.'
      ]
    : []
  return [
    'You are a translation engine, not a same-language rewriting engine.',
    `TARGET OUTPUT LANGUAGE: ${englishName} (${ma}).`,
    `Translate EVERY input line from its source language into ${englishName}.`,
    `Every value of "t" must use only natural ${englishName}; never copy, paraphrase, or retain source-language text, and do not mix another language into it.`,
    ...targetQualityRules,
    '',
    `Bạn là biên tập viên phụ đề video ngắn bằng ${ten}.`,
    `NGÔN NGỮ ĐẦU RA DUY NHẤT: ${ten} (mã ${ma}).`,
    `Hãy chuyển ngữ và biên tập lời thoại theo phong cách: ${style}.`,
    '',
    'Yêu cầu bắt buộc:',
    `1. Mọi trường t PHẢI được viết bằng ${ten}; dù nguồn là tiếng nào cũng phải dịch, tuyệt đối không chép lại ngôn ngữ nguồn.`,
    '2. Mỗi phần tử trả về: n = đúng số thứ tự dòng gốc, t = nội dung sau khi chuyển ngữ.',
    '3. Trả về đúng số dòng đã nhận; không gộp, không tách, không thêm lời giải thích.',
    '4. Không thay đổi ý nghĩa, tên riêng, con số, đơn vị, URL hoặc nhãn [SPEAKER_xx].',
    '5. Viết như lời nói tự nhiên của người bản địa, ngắn gọn để đọc bằng voice TTS.',
    '6. Giữ ngữ cảnh giữa các dòng; không tự thêm thông tin, giật tít quá mức hoặc khẳng định điều không có trong bản gốc.'
  ].join('\n')
}

const LATIN_TARGETS = new Set(['vi', 'en', 'es', 'fr', 'de', 'id', 'pt'])
const FOREIGN_SCRIPT_FOR_LATIN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Cyrillic}\p{Script=Arabic}]/gu

/**
 * Phat hien truong hop AI tra ve sai he chu mot cach ro rang. Day khong phai
 * bo nhan dien ngon ngu tong quat: muc tieu la chan cac loi nguy hiem nhu file
 * vi-VN van con nguyen ca doan chu Trung, thay vi am tham dua vao video cuoi.
 */
export function loiHeChuDich(ma: string, lines: string[]): string | null {
  const text = lines.join(' ')
  const letters = text.match(/\p{L}/gu) ?? []
  if (letters.length < 12) return null

  const count = (pattern: RegExp): number => text.match(pattern)?.length ?? 0
  const share = (pattern: RegExp): number => count(pattern) / letters.length

  const foreignScriptCount = count(FOREIGN_SCRIPT_FOR_LATIN)
  if (LATIN_TARGETS.has(ma) && (foreignScriptCount >= 2 || foreignScriptCount / letters.length > 0.08)) {
    return `Kết quả cho ${ma} vẫn chứa quá nhiều ký tự của ngôn ngữ nguồn.`
  }
  if (ma === 'vi' && letters.length >= 30 && count(/[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/giu) < 2) {
    return 'Kết quả Tiếng Việt không có đủ dấu tiếng Việt và có thể vẫn là ngôn ngữ khác.'
  }
  if (ma === 'zh' && share(/\p{Script=Han}/gu) < 0.12) {
    return 'Kết quả Tiếng Trung không có đủ chữ Hán.'
  }
  if (ma === 'ja' && share(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) < 0.12) {
    return 'Kết quả Tiếng Nhật không có đủ ký tự tiếng Nhật.'
  }
  if (ma === 'ko' && share(/\p{Script=Hangul}/gu) < 0.12) {
    return 'Kết quả Tiếng Hàn không có đủ ký tự Hangul.'
  }
  if (ma === 'th' && share(/\p{Script=Thai}/gu) < 0.12) {
    return 'Kết quả Tiếng Thái không có đủ ký tự tiếng Thái.'
  }
  if (ma === 'ru' && share(/\p{Script=Cyrillic}/gu) < 0.12) {
    return 'Kết quả Tiếng Nga không có đủ ký tự Cyrillic.'
  }
  if (ma === 'ar' && share(/\p{Script=Arabic}/gu) < 0.12) {
    return 'Kết quả Tiếng Ả Rập không có đủ ký tự Ả Rập.'
  }
  return null
}

/** Gom khoi toi sat nguong. Ranh gioi LUON giua 2 khoi -> moc thoi gian an toan. */
export function chia(blocks: SrtBlock[]): SrtBlock[][] {
  const out: SrtBlock[][] = []
  let cur: SrtBlock[] = []
  let len = 0
  for (const b of blocks) {
    const cost = b.text.length + 5
    if (cur.length && len + cost > MAX_CHARS) {
      out.push(cur)
      cur = []
      len = 0
    }
    cur.push(b)
    len += cost
  }
  if (cur.length) out.push(cur)
  return out
}

/** Đọc TXT phụ đề: mỗi dòng là đúng một cue, bỏ chỉ các dòng trống cuối file. */
export function parseCueText(raw: string): string[] {
  const lines = raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  return lines.map((line) => line.trim())
}

/** Gom các dòng TXT theo giới hạn request, không tách giữa nội dung một cue. */
export function chiaText(lines: string[]): string[][] {
  const out: string[][] = []
  let cur: string[] = []
  let len = 0
  for (const line of lines) {
    const cost = line.length + 5
    if (cur.length && len + cost > MAX_CHARS) {
      out.push(cur)
      cur = []
      len = 0
    }
    cur.push(line)
    len += cost
  }
  if (cur.length) out.push(cur)
  return out
}

export function buildCueText(lines: string[]): string {
  return `${lines.join('\n')}\n`
}

export function parseSrt(raw: string): SrtBlock[] {
  return raw
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((b) => {
      const lines = b.split('\n')
      const i = lines.findIndex((l) => l.includes('-->'))
      if (i < 0) return null
      return { time: lines[i].trim(), text: lines.slice(i + 1).join(' ').trim() }
    })
    .filter((b): b is SrtBlock => !!b && !!b.text)
}

export function buildSrt(blocks: SrtBlock[]): string {
  return blocks.map((b, i) => `${i + 1}\n${b.time}\n${b.text}`).join('\n\n') + '\n'
}

export { mergeTranslatedBlocks } from '../shared/features/srt-translator'
