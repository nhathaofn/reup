import { spawn, type ChildProcess } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { mkdir, copyFile, writeFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolveFfmpeg } from './deps'
import { escapeFfmpegFilterPath, findBurnFont, resolveFontsDir } from './fonts'
import { createTextMeasurer } from './fontMeasure'
import { debugRaw, logInfo } from './logger'
import type {
  BlurRegion,
  BurnFontEntry,
  BurnReq,
  BurnProgress,
  BurnResult,
  SubtitlePreviewResult
} from '../shared/types'
import {
  buildSrtTimelineExpression,
  parseSrt,
  readSrtFile,
  srtTimeToSeconds,
  type ParsedSrtCue
} from './services/srt'
import { buildVoiceTimeline, cancelVoiceTimeline } from './services/voiceSync'
import {
  cueUsesCjkWrap,
  ngatDongTheoPx,
  wrapWidthFromBox
} from '../shared/subWrap'

/** Parse #RGB / #RRGGBB -> { r,g,b } hoac null. */
function parseHexColor(hex: string | undefined | null): { r: number; g: number; b: number } | null {
  if (!hex) return null
  const s = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(s)) return null
  const full =
    s.length === 3
      ? s
          .split('')
          .map((c) => c + c)
          .join('')
      : s
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16)
  }
}

/**
 * ASS mau &HAABBGGRR — alpha: 00 = dam, FF = trong suot.
 * opacityPct 0–100 (100 = dam nhat).
 */
export function hexToAssColour(hex: string | undefined | null, opacityPct = 100): string {
  const c = parseHexColor(hex) ?? { r: 255, g: 255, b: 255 }
  const op = Math.max(0, Math.min(100, opacityPct))
  const aa = Math.round(255 * (1 - op / 100))
  const hex2 = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase()
  return `&H${hex2(aa)}${hex2(c.b)}${hex2(c.g)}${hex2(c.r)}&`
}


interface SubStyle {
  textColor: string
  outlineColor: string
  outlinePx: number
  bgEnabled: boolean
  bgColor: string
  bgOpacity: number
  fontScale: number
  bold: boolean
  italic: boolean
  shadowPx: number
  bgPaddingPx: number
}

function styleFromReq(req: BurnReq, fallbackVien: number): SubStyle {
  const outlinePx = Math.max(
    0,
    Math.min(
      8,
      req.outlinePx != null
        ? Math.round(req.outlinePx * 2) / 2
        : Math.min(8, fallbackVien)
    )
  )
  return {
    textColor: parseHexColor(req.textColor) ? req.textColor! : '#ffffff',
    outlineColor: parseHexColor(req.outlineColor) ? req.outlineColor! : '#000000',
    outlinePx,
    bgEnabled: Boolean(req.bgEnabled),
    bgColor: parseHexColor(req.bgColor) ? req.bgColor! : '#000000',
    bgOpacity: Math.max(0, Math.min(100, req.bgOpacity ?? 60)),
    fontScale: Math.max(60, Math.min(160, req.fontScale ?? 100)),
    bold: req.bold ?? true,
    italic: Boolean(req.italic),
    shadowPx: Math.max(0, Math.min(8, req.shadowPx ?? 0)),
    bgPaddingPx: Math.max(
      4,
      Math.min(32, req.bgPaddingPx ?? Math.max(6, Math.round((fallbackVien / 0.12) * 0.16)))
    )
  }
}

let child: ChildProcess | null = null
let daHuy = false

function killProcessTree(processToKill: ChildProcess): void {
  if (!processToKill.pid) return
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(processToKill.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      killer.unref()
    } else {
      process.kill(-processToKill.pid, 'SIGTERM')
    }
  } catch {
    try {
      processToKill.kill('SIGTERM')
    } catch {
      // Process may already have exited.
    }
  }
}

/** Huy giua chung: giet ca ffprobe/ffmpeg va process con cua no. */
export function cancelBurn(): void {
  daHuy = true
  cancelVoiceTimeline()
  const running = child
  child = null
  if (running) killProcessTree(running)
}

function duongFfprobe(ffmpeg: string): string {
  if (ffmpeg === 'ffmpeg') return 'ffprobe'
  return join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
}

interface Meta {
  w: number
  h: number
  giay: number
  hasAudio: boolean
}

/** Lay kich thuoc + thoi luong video (de tinh co chu, le, phan tram tien do). */
async function doVideo(ffprobe: string, video: string): Promise<Meta> {
  return new Promise((resolve) => {
    const p = spawn(
      ffprobe,
      [
        '-v', 'error',
        '-show_entries', 'stream=codec_type,width,height',
        '-show_entries', 'format=duration',
        '-of', 'default=nw=1',
        video
      ],
      { windowsHide: true }
    )
    child = p
    let out = ''
    p.stdout.on('data', (d: Buffer) => (out += d.toString()))
    p.on('close', () => {
      if (child === p) child = null
      resolve({
        w: Number(/width=(\d+)/.exec(out)?.[1]) || 0,
        h: Number(/height=(\d+)/.exec(out)?.[1]) || 0,
        giay: Number(/duration=([\d.]+)/.exec(out)?.[1]) || 0,
        hasAudio: out.includes('codec_type=audio')
      })
    })
    p.on('error', () => {
      if (child === p) child = null
      resolve({ w: 0, h: 0, giay: 0, hasAudio: false })
    })
  })
}

interface BoCuc {
  che: boolean // co che phu de goc khong
  y: number // mep tren dai che (pixel)
  bh: number // chieu cao dai che
  x: number // mep trai dai che (pixel)
  bw: number // chieu rong dai che
  sigma: number // do manh blur (gaussian)
  fontSize: number // co chu (PIXEL VIDEO — nho .ass co PlayResY = chieu cao video)
  vien: number // do day vien
  marginV: number // le duoi (pixel video)
  tamY: number | null // null = khong co khung sub (user khong keo) => dung marginV mac dinh
}

/**
 * Bo tham so bo cuc — video NGANG va DOC dung 2 bo KHAC NHAU.
 * Vi sao phai tach: video doc (9:16) co chieu cao rat lon nhung khung hep, ma
 * thang co chu lai tinh theo chieu cao -> 3.5%/4.5%/5.5% cua 1920 deu vuot xa
 * muc be rong cho phep, bi chan het ve cung MOT so (user doi Vua/Lon/Rat lon ma
 * chu khong nhuc nhich). Voi video doc phai lay moc theo BE RONG.
 */
interface ThamSo {
  theoCao: boolean // moc tinh co chu: chieu cao (ngang) hay be rong (doc)
  tuDong: number // co chu tu dong khi KHONG co khung mo
  thang: Record<'nho' | 'vua' | 'lon' | 'ratlon', number>
  min: number
  max: number
  le: number // le trai/phai (ti le be rong)
}
// Ngang: GIU NGUYEN so cu (dang chay tot, khong dung vao).
const NGANG: ThamSo = {
  theoCao: true,
  tuDong: 0.042,
  thang: { nho: 0.025, vua: 0.035, lon: 0.045, ratlon: 0.055 },
  min: 0.02,
  max: 0.055,
  le: 0.04
}
// Doc: moc theo be rong, chu to hon va cho phep 2-3 dong (kieu TikTok/Reels).
// Thang trai deu tu min den max nen khong con canh 3 muc ra cung mot co.
const DOC: ThamSo = {
  theoCao: false,
  tuDong: 0.045,
  thang: { nho: 0.035, vua: 0.045, lon: 0.055, ratlon: 0.065 },
  min: 0.035,
  max: 0.065,
  le: 0.05
}

/**
 * Tinh bo cuc dot chu tu kich thuoc video + dai chu goc.
 * Che phu de goc kieu BLUR (kinh mo, giong CapCut) — do that dep hon thanh den
 * cung. Huong video (ngang/doc) lay tu ffprobe -> chon bo tham so tuong ung.
 * Dai mo giu DUNG khung user keo; chu can giua quanh tam dai do va duoc phep
 * tran ra ngoai.
 */
export function boCuc(
  meta: Meta,
  subRegion?: { x0: number; y0: number; x1: number; y1: number } | null,
  lamMo?: boolean
): BoCuc {
  const co = meta.h > 0 ? meta.h : 720
  const rong = meta.w > 0 ? meta.w : 1280
  const ts = rong < co ? DOC : NGANG
  const marginV = Math.round(co * 0.04)

  let fontSize = Math.round(co * ts.tuDong)
  let y = 0
  let bh = 0
  let x = 0
  let bw = rong
  let tamY: number | null = null

  if (subRegion && subRegion.y1 > subRegion.y0 && subRegion.x1 > subRegion.x0) {
    y = Math.max(0, subRegion.y0)
    bh = Math.min(co - y, subRegion.y1 - subRegion.y0)
    x = Math.max(0, subRegion.x0)
    bw = Math.min(rong - x, subRegion.x1 - subRegion.x0)

    // Vung phu de co the cao 10-20% video doc. Danh 70% chieu cao cho
    // mot dong se lam chu phong qua lon va cac cue dai thanh 3-4 dong.
    // Danh khoang 34% de toi da 2 dong co khoang tho, sau do taoAss se
    // tu co nho rieng cho cue dai.
    fontSize = Math.max(14, Math.round(bh * 0.34))
    tamY = Math.round(y + bh / 2)
  }

  y -= y % 2
  bh -= bh % 2
  if (bh < 2) bh = 2
  if (y + bh > co) bh = Math.max(2, co - y - ((co - y) % 2))

  x -= x % 2
  bw -= bw % 2
  if (bw < 2) bw = 2
  if (x + bw > rong) bw = Math.max(2, rong - x - ((rong - x) % 2))

  const vien = Math.max(1, Math.round(fontSize * 0.12))
  return {
    che: !!lamMo,
    y,
    bh,
    x,
    bw,
    sigma: Math.max(8, Math.round(co * 0.03)),
    fontSize,
    vien,
    marginV,
    tamY
  }
}

type Cue = ParsedSrtCue

// Giu export cu de cac luong burn/kiem thu hien tai khong doi API.
export const docSrt = parseSrt
export const docFileSrt = readSrtFile

/** Doc cue phu de an toan cho renderer xem truoc theo timeline video. */
export function previewSrtFile(duong: string): SubtitlePreviewResult {
  try {
    const cues = docSrt(docFileSrt(duong))
    return {
      ok: cues.length > 0,
      cues: cues.map((cue, index) => ({
        index: index + 1,
        startSeconds: srtTimeToSeconds(cue.a),
        endSeconds: srtTimeToSeconds(cue.b),
        text: cue.chu.replace(/\\N/g, '\n')
      })),
      ...(cues.length > 0 ? {} : { error: 'File SRT không có câu phụ đề hợp lệ.' })
    }
  } catch {
    return { ok: false, cues: [], error: 'Không đọc được file SRT.' }
  }
}

/**
 * Thoi diem KET THUC cua cau cuoi trong file .srt (giay). Dung de canh bao user
 * khi ho chon nham file phu de lech han so voi video.
 */
export async function srtGiay(duong: string): Promise<number> {
  try {
    const cues = docSrt(docFileSrt(duong))
    let max = 0
    for (const c of cues) max = Math.max(max, srtTimeToSeconds(c.b))
    return max
  } catch {
    return 0
  }
}

/** So giay -> moc .srt "HH:MM:SS,mmm". */
function mocSrt(s: number): string {
  const ms = Math.max(0, Math.round(s * 1000))
  const p = (n: number, d = 2): string => String(n).padStart(d, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(
    Math.floor((ms % 60000) / 1000)
  )},${p(ms % 1000, 3)}`
}

/**
 * Cat .srt cho vua thoi luong video: bo han cau bat dau sau khi video da het,
 * va keo mep cuoi cua cau VAT NGANG ve dung luc video ket thuc.
 *
 * !! TU CAT chu KHONG dung co san cua ffmpeg — da do that ca hai deu sai:
 *    - `-shortest`: LAM MAT HAN cau vat ngang (cau 2s->10s tren video 3s cho ra
 *      luong phu de rong tuot, mat ca doan dang le phai hien tu giay 2 den 3).
 *    - `-t` / `-to`: khong dung gi toi luong phu de (van de nguyen 10s).
 */
export function catSrtTheoVideo(cues: Cue[], giayVideo: number): string {
  const ra: string[] = []
  for (const c of cues) {
    const batDau = srtTimeToSeconds(c.a)
    if (batDau >= giayVideo) continue // cau khong bao gio hien -> bo
    const ketThuc = Math.min(srtTimeToSeconds(c.b), giayVideo) // cau vat ngang -> keo ve cuoi video
    if (ketThuc <= batDau) continue
    ra.push(
      `${ra.length + 1}\n${mocSrt(batDau)} --> ${mocSrt(ketThuc)}\n` +
        `${c.chu.split('\\N').join('\n')}\n`
    )
  }
  return ra.join('\n')
}

/** Doi mot moc thoi gian .srt "HH:MM:SS,mmm" -> .ass "H:MM:SS.cc". */
function gioAss(t: string): string {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t.trim())
  if (!m) return '0:00:00.00'
  const cs = Math.round(Number((m[4] + '00').slice(0, 3)) / 10)
  return `${Number(m[1])}:${m[2]}:${m[3]}.${String(cs).padStart(2, '0')}`
}

/**
 * Chuan hoa timeline truoc khi tao ASS.
 *
 * SRT tu mo hinh dich hoac SRT nguon co the co cue trung nhau. Neu de nguyen,
 * ASS ve dung hai lop chu cung luc, tao cam giac 2-3 dong chong len nhau.
 * Giu nguyen noi dung va thu tu, chi rut cue truoc ve mep cue sau; cue trung
 * noi dung duoc gop lai. Day chi la lop render, khong ghi de file SRT goc.
 */
function normalizeCuesForRender(cues: Cue[]): Cue[] {
  const sorted = cues
    .map((cue, index) => ({
      cue,
      index,
      start: srtTimeToSeconds(cue.a),
      end: srtTimeToSeconds(cue.b)
    }))
    .filter((item) => item.end > item.start + 0.04)
    .sort((left, right) => left.start - right.start || left.index - right.index)

  const output: Cue[] = []
  const minDuration = 0.08
  for (const item of sorted) {
    const current = { ...item.cue }
    const start = item.start
    const end = item.end
    const previous = output[output.length - 1]

    if (previous) {
      const previousStart = srtTimeToSeconds(previous.a)
      const previousEnd = srtTimeToSeconds(previous.b)
      if (current.chu.trim() === previous.chu.trim() && start <= previousEnd + 0.04) {
        if (end > previousEnd) previous.b = mocSrt(end)
        continue
      }
      if (start < previousEnd) {
        previous.b = mocSrt(start)
        if (start - previousStart < minDuration) output.pop()
      }
    }

    if (end - start < minDuration) continue
    current.a = mocSrt(start)
    current.b = mocSrt(end)
    output.push(current)
  }
  return output
}

export function taoAss(
  cues: Cue[],
  meta: Meta,
  bc: BoCuc,
  fontOverride?: string | null,
  style?: SubStyle | null,
  pickedFont: BurnFontEntry | null = null
): string {
  const w = meta.w > 0 ? meta.w : 1280
  const h = meta.h > 0 ? meta.h : 720
  const fontScale = style?.fontScale ?? 100
  const fontSize = Math.max(14, Math.round(bc.fontSize * fontScale / 100))

  const marginL = bc.x > 0 ? bc.x : Math.round(w * 0.08)
  const marginR = bc.x > 0 && bc.bw > 0 ? Math.max(0, w - (bc.x + bc.bw)) : Math.round(w * 0.08)
  const boxWidth = w - marginL - marginR

  // MarginV chi con dung cho truong hop khong co khung phu de cu the.
  // Neu co khung, positionTag ben duoi se neo tam chu bang toa do that.
  const marginV = bc.tamY != null ? Math.max(0, h - (bc.y + bc.bh)) : bc.marginV
  // Khi co khung phu de, chu luon nam tai tam khung (ASS: \\an5 + \\pos).
  // Khong dung MarginV/\\an2 vi cach do se neo chu vao day khung va lech khi
  // doi co chu hoac so dong.
  const centeredInRegion = bc.tamY != null
  const alignment = centeredInRegion ? 5 : 2
  const positionTag = centeredInRegion
    ? `{\\an5\\pos(${Math.round(bc.x + bc.bw / 2)},${Math.round(bc.y + bc.bh / 2)})}`
    : ''

  // Tu dong phat hien font theo ngon ngu (mau ca file). Wrap xuong dong: theo TUNG cue.
  const textSample = cues.map((c) => c.chu).join('')
  let fontName = 'Arial'
  const isJapanese = /[\u3040-\u309f\u30a0-\u30ff]/.test(textSample)
  const isChinese = /[\u4e00-\u9fa5]/.test(textSample)

  if (fontOverride && fontOverride.trim()) {
    fontName = fontOverride.trim()
  } else if (isJapanese) {
    // Tieng Nhat (uu tien nhan dien truoc do tieng Nhat co chua chu Kanji trung voi tieng Trung)
    fontName = 'MS Gothic'
  } else if (/[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/.test(textSample)) {
    // Tieng Han
    fontName = 'Malgun Gothic'
  } else if (isChinese) {
    // Tieng Trung (Gian/Phon the)
    fontName = 'Microsoft YaHei'
  } else if (/[\u0e00-\u0e7f]/.test(textSample)) {
    // Tieng Thai
    fontName = 'Leelawadee UI'
  } else if (/[\u0900-\u097f]/.test(textSample)) {
    // Tieng An (Devanagari/Hindi...)
    fontName = 'Nirmala UI'
  } else if (/[\u0600-\u06ff]/.test(textSample)) {
    // Tieng A Rap
    fontName = 'Segoe UI'
  }

  // Wrap theo px chieu ngang khung (tru pad neu co nen)
  const bgOn = Boolean(style?.bgEnabled)
  const boxPad = style?.bgPaddingPx ?? Math.max(8, Math.round(fontSize * 0.16))
  const maxWidthPx = wrapWidthFromBox(boxWidth, bgOn ? boxPad : 0)
  const measure = createTextMeasurer(fontSize, fontName, pickedFont)

  const formatCue = (text: string): string => {
    let size = fontSize
    let formatted = ngatDongTheoPx(text, maxWidthPx, measure, cueUsesCjkWrap(text))
    // ASS cho phep override \fs theo tung dialogue. Giam dan de cau dai
    // khong vuot qua 2 dong trong cung mot vung phu de.
    while (formatted.split('\\N').length > 2 && size > Math.max(18, Math.round(fontSize * 0.58))) {
      size -= 2
      const cueMeasure = createTextMeasurer(size, fontName, pickedFont)
      formatted = ngatDongTheoPx(text, maxWidthPx, cueMeasure, cueUsesCjkWrap(text))
    }
    return size === fontSize ? formatted : `{\\fs${size}}${formatted}`
  }

  const primary = hexToAssColour(style?.textColor ?? '#ffffff', 100)
  const outline = hexToAssColour(style?.outlineColor ?? '#000000', 100)
  const outlineW = style != null ? style.outlinePx : bc.vien
  const back = bgOn
    ? hexToAssColour(style!.bgColor, style!.bgOpacity)
    : '&H00000000&'
  const bold = style?.bold ?? true
  const italic = style?.italic ?? false
  const shadowW = style?.shadowPx ?? 0
  // blur nhe de mem goc hop (ASS khong co border-radius that)
  const boxBlur = Math.max(2, Math.min(5, fontSize * 0.055))

  // D = chu + vien; Box = chi hop nen (chu trong suot), ôm sát khi xuống dòng
  const styleText =
    `Style: D,${fontName},${fontSize},${primary},&H00000000&,${outline},&H00000000&,` +
    `${bold ? -1 : 0},${italic ? -1 : 0},0,0,100,100,0,0,1,${outlineW},${shadowW},${alignment},${marginL},${marginR},${marginV},1`
  // BorderStyle=3: mau hop = OutlineColour (khong phai BackColour)
  const styleBox =
    `Style: Box,${fontName},${fontSize},&HFF000000&,&H00000000&,${back},&H00000000&,` +
    `0,0,0,0,100,100,0,0,3,${boxPad},0,${alignment},${marginL},${marginR},${marginV},1`

  const events = cues.flatMap((c) => {
    const textFormatted = formatCue(c.chu)
    const a = gioAss(c.a)
    const b = gioAss(c.b)
    if (bgOn) {
      return [
        `Dialogue: 0,${a},${b},Box,,0,0,0,,{\\blur${boxBlur.toFixed(1)}}${positionTag}${textFormatted}`,
        `Dialogue: 1,${a},${b},D,,0,0,0,,${positionTag}${textFormatted}`
      ]
    }
    return [`Dialogue: 0,${a},${b},D,,0,0,0,,${positionTag}${textFormatted}`]
  })

  const styleLines = bgOn ? [styleBox, styleText] : [styleText]

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styleLines,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    ''
  ].join('\n')
}

export { buildSrtTimelineExpression }

/**
 * Cac tham so filter cho ffmpeg. Supports N blur regions using split=N+1 stream architecture.
 *
 * Moi crop tao mot mask chu-like tu canh + pixel sang/toi co tuong phan cao.
 * Chi phan co mask moi nhan mot lop boxblur rat manh qua alphamerge; phan
 * khong co chu trong khung van giu nguyen. Mask duoc phong dai de phu kin ca
 * than va vien chu, tranh truong hop chu van doc duoc sau khi lam mo.
 */
function taoFilterComplex(
  meta: Meta,
  regions: BlurRegion[],
  lamMo: boolean,
  coAss: boolean,
  assName: string,
  batAmThanh = false,
  hasAudioFile = false,
  audioVolume = 100,
  externalAudioVolume = 100,
  fontsDir: string | null = null,
  externalAudioInputIndex = 1,
  timelineEnable: string | null = null
): string[] {
  const validRegions = lamMo ? regions.filter((r) => r.x1 > r.x0 && r.y1 > r.y0) : []

  const hasVideoFilters = validRegions.length > 0 || coAss
  const lines: string[] = []
  const assFilter =
    fontsDir && coAss
      ? `ass=${assName}:fontsdir=${escapeFfmpegFilterPath(fontsDir)}`
      : `ass=${assName}`

  if (hasVideoFilters) {
    const N = validRegions.length
    const w = meta.w > 0 ? meta.w : 1280
    const h = meta.h > 0 ? meta.h : 720

    if (N > 0) {
      // 1. Split luong goc [0:v] thành (N + 1) luong doc lap
      const splitLabels = Array.from({ length: N }, (_, i) => `[c${i}]`).join('')
      lines.push(`[0:v]split=${N + 1}[main]${splitLabels}`)

      // 2. Crop, blur va tao mask net chu doc lap cho tung vung tu [c${i}].
      for (let i = 0; i < N; i++) {
        const r = validRegions[i]
        let x = Math.max(0, r.x0)
        let bw = Math.min(w - x, r.x1 - r.x0)
        let y = Math.max(0, r.y0)
        let bh = Math.min(h - y, r.y1 - r.y0)

        x -= x % 2
        bw -= bw % 2
        if (bw < 2) bw = 2
        if (x + bw > w) bw = Math.max(2, w - x - ((w - x) % 2))

        y -= y % 2
        bh -= bh % 2
        if (bh < 2) bh = 2
        if (y + bh > h) bh = Math.max(2, h - y - ((h - y) % 2))

        // Boxblur duoc dat gan kich thuoc nua chieu cao crop. Gblur voi sigma
        // lon tren mot so build FFmpeg tao mau hong/tim, con boxblur giu mau
        // on dinh va lam mat chu manh hon.
        const blurRadius = Math.max(24, Math.min(260, Math.round(Math.min(bw, bh) * 0.48)))

        // Edge mask duoc giao voi hai mask mau sang/toi truoc khi phong dai
        // nhieu lan de phu kin toan bo than chu, khong chi vien chu.
        lines.push(
          `[c${i}]crop=${bw}:${bh}:${x}:${y},format=yuv444p,split=2[blurSrc${i}][maskSrc${i}]`,
          `[blurSrc${i}]boxblur=lr=${blurRadius}:lp=2:cr=${blurRadius}:cp=2,format=rgba[blur${i}]`,
          `[maskSrc${i}]format=gray,split=3[edgeGray${i}][lightGray${i}][darkGray${i}]`,
          `[edgeGray${i}]edgedetect=mode=wires:low=0.08:high=0.2:planes=y,boxblur=2:1,lut=y='if(gt(val,8),255,0)',split=2[edgeLight${i}][edgeDark${i}]`,
          `[lightGray${i}]lut=y='if(gt(val,180),255,0)'[lightMask${i}]`,
          `[darkGray${i}]lut=y='if(lt(val,70),255,0)'[darkMask${i}]`,
          `[edgeLight${i}][lightMask${i}]blend=all_mode=and,boxblur=4:1,lut=y='if(gt(val,4),255,0)'[lightTextMask${i}]`,
          `[edgeDark${i}][darkMask${i}]blend=all_mode=and,boxblur=4:1,lut=y='if(gt(val,4),255,0)'[darkTextMask${i}]`,
          `[lightTextMask${i}][darkTextMask${i}]blend=all_mode=lighten,dilation=coordinates=255,dilation=coordinates=255,lut=y='if(gt(val,12),255,0)',format=gray[mask${i}]`,
          `[blur${i}][mask${i}]alphamerge[masked${i}]`
        )
      }

      // 3. Overlay tung crop da alphamerge len luong [main].
      let prev = 'main'
      for (let i = 0; i < N; i++) {
        const r = validRegions[i]
        let x = Math.max(0, r.x0)
        let y = Math.max(0, r.y0)
        x -= x % 2
        y -= y % 2

        const outLbl = `[v${i + 1}]`
        const enableStr = timelineEnable ? `:enable='${timelineEnable}'` : ''
        lines.push(`[${prev}][masked${i}]overlay=${x}:${y}${enableStr}${outLbl}`)
        prev = `v${i + 1}`
      }

      // 4. Ghep phu de neu co
      if (coAss) {
        lines.push(`[${prev}]${assFilter},format=yuv420p[out]`)
      } else {
        // NVENC/QSV/AMF deu nhan format nay on dinh hon sau alphamerge
        // (neu de FFmpeg tu chon, mot so build se day rgba vao encoder).
        lines.push(`[${prev}]format=yuv420p[out]`)
      }
    } else {
      // Chi co ass, khong co blur
      lines.push(`[0:v]${assFilter},format=yuv420p[out]`)
    }
  }

  // Phối trộn âm thanh
  if (batAmThanh) {
    if (meta.hasAudio) {
      const volRatio = Math.pow(audioVolume / 100, 2)
      const externalVolRatio = Math.pow(externalAudioVolume / 100, 2)
      let audioFilter = ''
      if (hasAudioFile) {
        // Có nhạc nền + có âm thanh gốc -> Trộn
        audioFilter = `[0:a]volume=${volRatio}[a0];[${externalAudioInputIndex}:a]volume=${externalVolRatio}[a1];[a0][a1]amix=inputs=2:duration=first[a_mix]`
      } else {
        // Không nhạc nền + có âm thanh gốc -> Chỉ chỉnh âm lượng gốc
        audioFilter = `[0:a]volume=${volRatio}[a_mix]`
      }
      
      if (hasVideoFilters) {
        lines.push(audioFilter)
        return ['-filter_complex', lines.join(';'), '-map', '[out]', '-map', '[a_mix]']
      } else {
        return ['-filter_complex', audioFilter, '-map', '0:v', '-map', '[a_mix]']
      }
    } else {
      // Video gốc câm (không âm thanh)
      if (hasAudioFile) {
        // Có nhạc nền -> Map trực tiếp nhạc nền vào đầu ra
        if (hasVideoFilters) {
          const externalVolRatio = Math.pow(externalAudioVolume / 100, 2)
          lines.push(`[${externalAudioInputIndex}:a]volume=${externalVolRatio}[a_mix]`)
          return ['-filter_complex', lines.join(';'), '-map', '[out]', '-map', '[a_mix]']
        } else {
          const externalVolRatio = Math.pow(externalAudioVolume / 100, 2)
          return [
            '-filter_complex',
            `[${externalAudioInputIndex}:a]volume=${externalVolRatio}[a_mix]`,
            '-map',
            '0:v',
            '-map',
            '[a_mix]'
          ]
        }
      } else {
        // Không nhạc nền -> Không cần âm thanh
        if (hasVideoFilters) {
          return ['-filter_complex', lines.join(';'), '-map', '[out]']
        } else {
          return []
        }
      }
    }
  } else {
    // Không bật cấu hình âm thanh
    if (hasVideoFilters) {
      return ['-filter_complex', lines.join(';'), '-map', '[out]', '-map', '0:a?']
    } else {
      return []
    }
  }
}

/** Chay 1 lan ffmpeg, bao tien do theo `time=` tren stderr. */
async function chay(
  ff: string,
  args: string[],
  cwd: string,
  meta: Meta,
  onProgress: (p: BurnProgress) => void
): Promise<number | null> {
  return new Promise((resolve) => {
    if (daHuy) {
      resolve(-1)
      return
    }
    const p = spawn(ff, args, { cwd, windowsHide: true })
    child = p
    let errTail = ''
    p.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      const lines = s.split(/\r?\n/)
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        
        // Neu chua thong tin thoi gian thi cap nhat tien do
        const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(trimmed)
        if (m && meta.giay > 0) {
          const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
          onProgress({ percent: Math.min(99, Math.round((sec / meta.giay) * 100)) })
        }
        
        // Log chan doan loi font/ass tu FFmpeg
        const lower = trimmed.toLowerCase()
        if (
          lower.includes('ass') ||
          lower.includes('font') ||
          lower.includes('error') ||
          lower.includes('warning') ||
          lower.includes('failed')
        ) {
          logInfo(`[ffmpeg] ${trimmed}`)
        }
      }
      const last = s.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]
      if (last) errTail = last
    })
    p.on('error', (err) => {
      debugRaw('burn spawn', err)
      child = null
      resolve(-1)
    })
    p.on('close', (code) => {
      child = null
      if (code !== 0 && errTail) debugRaw('burn close', errTail)
      resolve(code)
    })
  })
}

async function duLon(f: string): Promise<boolean> {
  try {
    return (await stat(f)).size > 4096 // nvenc hong -> file 0 byte / vai byte
  } catch {
    return false
  }
}

/**
 * Ghep phu de / Lam mo video.
 */
export async function burnSubtitle(
  req: BurnReq,
  onProgress: (p: BurnProgress) => void
): Promise<BurnResult> {
  daHuy = false
  const ff = await resolveFfmpeg()
  if (!ff) return { ok: false, error: 'Thiếu ffmpeg. Hãy chạy lại bước cài đặt.' }
  if (daHuy) return { ok: false, error: 'Đã huỷ.' }

  const hasSrt = Boolean(req.srt && req.srt.trim())
  const regions = req.blurRegions || []
  const hasBlur = Boolean(req.lamMo && regions.some((region) => region.x1 > region.x0 && region.y1 > region.y0))
  const voiceSyncRequested = Boolean(req.batAmThanh && req.amThanhMode === 'voice-per-cue')
  if (voiceSyncRequested && !req.voiceSyncSrt?.trim()) {
    return { ok: false, error: 'Voice theo từng câu cần file SRT để lấy mốc thời gian.' }
  }
  if (voiceSyncRequested && !req.voiceDir?.trim()) {
    return { ok: false, error: 'Voice theo từng câu cần thư mục chứa các file voice.' }
  }
  let hasAudioFile = Boolean(req.batAmThanh && !voiceSyncRequested && req.amThanhFile)
  let externalAudioPath: string | null = hasAudioFile ? req.amThanhFile! : null

  if (!hasSrt && !hasBlur && !req.batAmThanh) {
    return { ok: false, error: 'Vui lòng chọn ít nhất 1 vùng làm mờ, tải lên tệp phụ đề hoặc bật cấu hình âm thanh.' }
  }

  const goc = basename(req.video).replace(/\.[^.]+$/, '')
  const output = join(req.outputDir, `${goc}${req.mode === 'burn' ? '-phude' : '-phude-mem'}.mp4`)

  const tam = join(tmpdir(), 'tblao-burn')
  await mkdir(tam, { recursive: true })
  const srtTam = join(tam, 'sub.srt')

  if (hasSrt && req.srt) {
    await copyFile(req.srt, srtTam)
  }

  const meta = await doVideo(duongFfprobe(ff), req.video)
  if (daHuy) {
    if (hasSrt) await rm(srtTam, { force: true })
    return { ok: false, error: 'Đã huỷ.' }
  }
  let voiceTimelinePath: string | null = null
  if (voiceSyncRequested) {
    if (daHuy) {
      if (hasSrt) await rm(srtTam, { force: true })
      return { ok: false, error: 'Đã huỷ.' }
    }
    const timeline = await buildVoiceTimeline({
      srtPath: req.voiceSyncSrt!,
      voiceDir: req.voiceDir!,
      workDir: tam,
      maxDuration: meta.giay
    })
    if (!timeline.ok || !timeline.outputPath) {
      if (hasSrt) await rm(srtTam, { force: true })
      return { ok: false, error: timeline.error ?? 'Không tạo được timeline voice.' }
    }
    voiceTimelinePath = timeline.outputPath
    externalAudioPath = voiceTimelinePath
    hasAudioFile = true
    logInfo(`Dịch màn hình: đã tạo timeline voice từ ${timeline.scan?.matchedCount ?? 0} câu.`)
  }
  const cleanupVoiceTimeline = async (): Promise<void> => {
    if (voiceTimelinePath) await rm(voiceTimelinePath, { force: true })
  }

  if (hasSrt && req.mode === 'soft') {
    logInfo(`Dịch màn hình: gắn phụ đề rời vào ${basename(req.video)}…`)

    if (req.catSrt && meta.giay > 0) {
      const cues = docSrt(docFileSrt(srtTam))
      await writeFile(srtTam, catSrtTheoVideo(cues, meta.giay), 'utf8')
      logInfo('Dịch màn hình: đã cắt phụ đề cho vừa độ dài video.')
    }

    // SRT là input số 1; nếu có voice ngoài thì voice là input số 2.
    // Khi có vùng làm mờ, phải chạy filter video và encode lại thay vì -c:v copy.
    let softTimelineEnable: string | null = null
    if (req.moTheoSrt && hasSrt) {
      const cues = docSrt(docFileSrt(srtTam))
      const expr = buildSrtTimelineExpression(cues)
      if (expr) softTimelineEnable = expr
    }

    const softFilterArgs = taoFilterComplex(
      meta,
      regions,
      req.lamMo ?? false,
      false,
      'sub.ass',
      req.batAmThanh ?? false,
      hasAudioFile,
      req.amLuongGoc ?? 100,
      req.amLuongVoice ?? 100,
      null,
      2,
      softTimelineEnable
    )
    if (softFilterArgs.length > 0) {
      debugRaw('soft subtitle filter_complex', softFilterArgs.join(' '))
    }

    const softMapArgs = softFilterArgs.length > 0
      ? [...softFilterArgs, '-map', '1:0']
      : ['-map', '0:v:0', '-map', '1:0', ...(meta.hasAudio ? ['-map', '0:a:0'] : [])]
    const softEncoders: Array<{ ten: string; gpu: boolean; args: string[] }> = hasBlur
      ? [
          { ten: 'h264_nvenc', gpu: true, args: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23'] },
          { ten: 'h264_amf', gpu: true, args: ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23'] },
          { ten: 'h264_qsv', gpu: true, args: ['-c:v', 'h264_qsv', '-global_quality', '23'] },
          { ten: 'libx264', gpu: false, args: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20'] }
        ]
      : [{ ten: 'copy', gpu: false, args: ['-c:v', 'copy'] }]
    const softAudioCodecArgs = req.batAmThanh && (meta.hasAudio || hasAudioFile)
      ? ['-c:a', 'aac']
      : !req.batAmThanh && meta.hasAudio
        ? ['-c:a', 'copy']
        : []

    for (const enc of softEncoders) {
      if (daHuy) break
      const inputArgs = hasAudioFile && externalAudioPath
        ? ['-y', '-i', req.video, '-i', 'sub.srt', '-i', externalAudioPath]
        : ['-y', '-i', req.video, '-i', 'sub.srt']
      const args = [
        ...inputArgs,
        ...softMapArgs,
        ...enc.args,
        '-c:s', 'mov_text',
        '-metadata:s:s:0', 'language=vie',
        ...softAudioCodecArgs,
        '-shortest',
        output
      ]
      const code = await chay(ff, args, tam, meta, onProgress)
      if (daHuy) {
        if (hasSrt) await rm(srtTam, { force: true })
        await cleanupVoiceTimeline()
        return { ok: false, error: 'Đã huỷ.' }
      }
      if (code === 0 && (await duLon(output))) {
        if (hasSrt) await rm(srtTam, { force: true })
        await cleanupVoiceTimeline()
        logInfo(`Dịch màn hình: gắn SRT mềm${hasBlur ? ' và làm mờ' : ''} xong${enc.gpu ? ' (tăng tốc GPU)' : ''}.`)
        return { ok: true, output }
      }
    }
    if (hasSrt) await rm(srtTam, { force: true })
    await cleanupVoiceTimeline()
    return { ok: false, error: 'Ghép phụ đề thất bại.' }
  }

  // ---- Dot chet (Render lai video) ----
  let bc: BoCuc | null = null
  const duongAss = join(tam, 'sub.ass')
  const picked = findBurnFont(req.fontId)
  const fontsDir = picked ? resolveFontsDir() : null
  let subStyle: SubStyle | null = null
  let burnTimelineEnable: string | null = null

  if (hasSrt) {
    const srtRaw = docFileSrt(srtTam)
    const rawCues = docSrt(srtRaw)
    const cues = normalizeCuesForRender(rawCues)
    logInfo(`Dịch màn hình: đọc ${rawCues.length} cue, render ${cues.length} cue không chồng lớp.`)
    bc = boCuc(meta, req.subRegion, req.lamMo)
    subStyle = styleFromReq(req, bc.vien)
    await writeFile(duongAss, taoAss(cues, meta, bc, picked?.family ?? null, subStyle, picked), 'utf8')
    if (picked) {
      logInfo(`Dịch màn hình: font phụ đề «${picked.label}» (${picked.family}).`)
    }
    if (req.moTheoSrt) {
      const expr = buildSrtTimelineExpression(cues)
      if (expr) burnTimelineEnable = expr
    }
  }

  // FFmpeg chay voi cwd = tam nen chi can ten tuong doi 'sub.ass'
  const filterArgs = taoFilterComplex(
    meta,
    regions,
    req.lamMo ?? false,
    hasSrt,
    'sub.ass',
    req.batAmThanh ?? false,
    hasAudioFile,
    req.amLuongGoc ?? 100,
    req.amLuongVoice ?? 100,
    fontsDir,
    1,
    burnTimelineEnable
  )
  logInfo(`Dịch màn hình: đang xử lý video ${basename(req.video)}…`)
  if (filterArgs.length > 0) {
    debugRaw('burn filter_complex', filterArgs.join(' '))
  }

  const encoders: Array<{ ten: string; gpu: boolean; args: string[] }> = [
    { ten: 'h264_nvenc', gpu: true, args: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23'] },
    { ten: 'h264_amf', gpu: true, args: ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23'] },
    { ten: 'h264_qsv', gpu: true, args: ['-c:v', 'h264_qsv', '-global_quality', '23'] },
    { ten: 'libx264', gpu: false, args: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20'] }
  ]

  for (const enc of encoders) {
    if (daHuy) break

    const inputArgs = hasAudioFile && externalAudioPath
      ? ['-y', '-i', req.video, '-i', externalAudioPath]
      : ['-y', '-i', req.video]

    const dungFilterAudio = req.batAmThanh && (meta.hasAudio || hasAudioFile)
    const audioCodecArgs = dungFilterAudio ? ['-c:a', 'aac'] : ['-c:a', 'copy']

    const args = filterArgs.length > 0
      ? [...inputArgs, ...filterArgs, ...enc.args, ...audioCodecArgs, output]
      : [...inputArgs, ...enc.args, ...audioCodecArgs, output]

    const code = await chay(ff, args, tam, meta, onProgress)
    if (daHuy) {
      if (hasSrt) await rm(srtTam, { force: true })
      await cleanupVoiceTimeline()
      return { ok: false, error: 'Đã huỷ.' }
    }
    if (code === 0 && (await duLon(output))) {
      if (hasSrt) await rm(srtTam, { force: true })
      await cleanupVoiceTimeline()
      logInfo(`Dịch màn hình: xử lý video xong${enc.gpu ? ' (tăng tốc GPU)' : ''}.`)
      return { ok: true, output }
    }
  }

  if (hasSrt) await rm(srtTam, { force: true })
  await cleanupVoiceTimeline()
  return { ok: false, error: 'Xử lý video thất bại.' }
}
