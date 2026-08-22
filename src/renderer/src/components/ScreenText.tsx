import type { CSSProperties, JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import type {
  BlurRegion,
  BurnFontEntry,
  SubtitlePreviewCue,
  SubtitlePreviewResult,
  VoiceSyncScanResult
} from '../../../shared/types'
import { useTabOutputDir } from '../lib/outputDir'
import { usePersistedState } from '../lib/persist'
import { readDichProvider } from '../lib/dichProvider'
import { hasFeature } from '../lib/license'
import {
  SUBTITLE_PRESETS,
  type SubtitlePreset,
  type SubtitlePresetValues
} from '../lib/subtitlePresets'
import RegionBox, { type Region } from './RegionBox'
import GeminiKey from './GeminiKey'

const baseName = (p: string): string => p.split(/[\\/]/).pop() || p

const srcVideo = (p: string): string => {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(p)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `tblao://b64/${b64}`
}

const PALETTE = [
  '#e8a13c',
  '#3b82f6',
  '#10b981',
  '#ec4899',
  '#8b5cf6',
  '#f59e0b',
  '#06b6d4',
  '#a855f7'
]

type Buoc = 'idle' | 'doc' | 'dich' | 'xong' | 'loi'
type SubtitleMode = 'burn' | 'soft'

export default function ScreenText(): JSX.Element {
  const [outputDir, setOutputDir] = useTabOutputDir('tblao.outputDir.screen')
  const [video, setVideo] = useState<string | null>(null)
  const [videoH, setVideoH] = useState(0)
  const [videoW, setVideoW] = useState(0)
  const [boxH, setBoxH] = useState(0)
  const [boxW, setBoxW] = useState(0)

  const [dich, setDich] = usePersistedState('tblao.ocr.dich', 'none')
  const [buoc, setBuoc] = useState<Buoc>('idle')
  const [pct, setPct] = useState(0)
  const [dongChu, setDongChu] = useState('')
  const [dangDung, setDangDung] = useState(false)
  const [ketQua, setKetQua] = useState<string[]>([])
  const [loi, setLoi] = useState<string | null>(null)

  const [batLamMo, setBatLamMo] = useState(true)
  const [moTheoSrt, setMoTheoSrt] = usePersistedState('tblao.burn.moTheoSrt', true)
  const [batPhuDe, setBatPhuDe] = useState(false)
  const [subtitleMode, setSubtitleMode] = usePersistedState<SubtitleMode>(
    'tblao.burn.subtitleMode',
    'burn'
  )
  const [blurRegions, setBlurRegions] = useState<BlurRegion[]>([])
  const [activeBlurId, setActiveBlurId] = useState<string | null>(null)

  const [videoGiay, setVideoGiay] = useState(0)
  const [srtGiay, setSrtGiay] = useState(0)
  const [ghepSrt, setGhepSrt] = useState('')
  const [subPreview, setSubPreview] = useState<SubtitlePreviewResult | null>(null)
  const [previewCueIndex, setPreviewCueIndex] = useState(0)
  const [previewTime, setPreviewTime] = useState(0)
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const [subRegion, setSubRegion] = useState<Region | undefined>(undefined)
  const [fontId, setFontId] = usePersistedState('tblao.burn.fontId', 'auto')
  const [burnFonts, setBurnFonts] = useState<BurnFontEntry[]>([])
  const [previewFontFamily, setPreviewFontFamily] = useState('')
  const [subtitlePreset, setSubtitlePreset] = usePersistedState<SubtitlePreset>(
    'tblao.burn.subtitlePreset',
    'custom'
  )
  const [textColor, setTextColor] = usePersistedState('tblao.burn.textColor', '#ffffff')
  const [outlineColor, setOutlineColor] = usePersistedState('tblao.burn.outlineColor', '#111827')
  const [outlinePx, setOutlinePx] = usePersistedState('tblao.burn.outlinePx', 2)
  const [bgEnabled, setBgEnabled] = usePersistedState('tblao.burn.bgEnabled', false)
  const [bgColor, setBgColor] = usePersistedState('tblao.burn.bgColor', '#111827')
  const [bgOpacity, setBgOpacity] = usePersistedState('tblao.burn.bgOpacity', 84)
  const [fontScale, setFontScale] = usePersistedState('tblao.burn.fontScale', 100)
  const [bold, setBold] = usePersistedState('tblao.burn.bold', true)
  const [italic, setItalic] = usePersistedState('tblao.burn.italic', false)
  const [shadowPx, setShadowPx] = usePersistedState('tblao.burn.shadowPx', 1)
  const [bgPaddingPx, setBgPaddingPx] = usePersistedState('tblao.burn.bgPaddingPx', 10)
  const [ghep, setGhep] = useState<'idle' | 'chay' | 'xong' | 'loi'>('idle')
  const [ghepPct, setGhepPct] = useState(0)
  const [ghepOut, setGhepOut] = useState('')
  const [ghepLoi, setGhepLoi] = useState<string | null>(null)

  const [batOcrBox, setBatOcrBox] = useState(false)
  const [ocrRegion, setOcrRegion] = useState<Region | undefined>(undefined)
  const [fmtSrt, setFmtSrt] = usePersistedState('tblao.ocr.fmt.srt', true)
  const [fmtTxt, setFmtTxt] = usePersistedState('tblao.ocr.fmt.txt', false)
  const [fmtVtt, setFmtVtt] = usePersistedState('tblao.ocr.fmt.vtt', false)
  const [fmtJson, setFmtJson] = usePersistedState('tblao.ocr.fmt.json', false)

  const [batAmThanh, setBatAmThanh] = useState(false)
  const [amThanhMode, setAmThanhMode] = usePersistedState<'single' | 'voice-per-cue'>(
    'tblao.burn.audioMode',
    'single'
  )
  const [amThanhFile, setAmThanhFile] = useState('')
  const [voiceDir, setVoiceDir] = useState('')
  const [voiceScan, setVoiceScan] = useState<VoiceSyncScanResult | null>(null)
  const [voiceScanBusy, setVoiceScanBusy] = useState(false)
  const [amLuongGoc, setAmLuongGoc] = useState(100)
  const [amLuongVoice, setAmLuongVoice] = usePersistedState('tblao.burn.voiceVolume', 100)

  const [hasEngine, setHasEngine] = useState<boolean | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installPct, setInstallPct] = useState(0)
  const [installErr, setInstallErr] = useState<string | null>(null)

  const vidRef = useRef<HTMLVideoElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const doBox = (): void => {
    const el = wrapRef.current
    if (!el) return
    setBoxW(el.clientWidth)
    setBoxH(el.clientHeight)
  }
  const unlocked = hasFeature('ocr')

  const apDungPreset = (value: SubtitlePreset): void => {
    setSubtitlePreset(value)
    if (value === 'custom') return
    const preset = SUBTITLE_PRESETS[value]
    setTextColor(preset.textColor)
    setOutlineColor(preset.outlineColor)
    setOutlinePx(preset.outlinePx)
    setBgEnabled(preset.bgEnabled)
    setBgColor(preset.bgColor)
    setBgOpacity(preset.bgOpacity)
    setFontScale(preset.fontScale)
    setBold(preset.bold)
    setItalic(preset.italic)
    setShadowPx(preset.shadowPx)
    setBgPaddingPx(preset.bgPaddingPx)
  }

  useEffect(() => {
    let huy = false
    void (async () => {
      const s = await window.api.ocrEngineStatus()
      if (huy) return
      setHasEngine(s.has)
      if (!s.needsUpdate) return
      setInstalling(true)
      setInstallErr(null)
      setInstallPct(0)
      const off = window.api.onOcrInstallProgress(setInstallPct)
      const res = await window.api.ocrInstallEngine()
      off()
      if (huy) return
      setInstalling(false)
      if (res.ok) setHasEngine(true)
      else setInstallErr(res.error ?? 'Cập nhật công cụ thất bại.')
    })()
    return () => {
      huy = true
    }
  }, [])

  useEffect(() => {
    let huy = false
    void window.api.listBurnFonts().then((list) => {
      if (!huy) setBurnFonts(list)
    })
    return () => {
      huy = true
    }
  }, [])

  // Nap @font-face khi doi font — chu mau tren khung video doi theo
  useEffect(() => {
    const styleId = 'tblao-burn-font-preview'
    let el = document.getElementById(styleId) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = styleId
      document.head.appendChild(el)
    }

    const entry = fontId !== 'auto' ? burnFonts.find((f) => f.id === fontId) : undefined
    if (!entry?.previewUrl) {
      el.textContent = ''
      setPreviewFontFamily('')
      return
    }

    const fam = `TblaoBurn_${entry.id}`
    const fmt = /\.otf$/i.test(entry.file) ? 'opentype' : 'truetype'
    el.textContent =
      `@font-face{font-family:'${fam}';src:url('${entry.previewUrl}') format('${fmt}');` +
      `font-display:block;}`
    setPreviewFontFamily(fam)
    let huy = false
    void document.fonts
      .load(`24px "${fam}"`)
      .then(() => {
        if (huy) return
        // Force re-paint: doi key nhe de RegionBox ve lai sau khi font san sang
        setPreviewFontFamily('')
        requestAnimationFrame(() => {
          if (!huy) setPreviewFontFamily(fam)
        })
      })
      .catch(() => {
        /* bo qua */
      })
    return () => {
      huy = true
    }
  }, [fontId, burnFonts])

  useEffect(() => {
    if (!ghepSrt) {
      setSrtGiay(0)
      return
    }
    let huy = false
    void Promise.resolve()
      .then(() => window.api.srtGiay(ghepSrt))
      .then((s) => {
        if (!huy) setSrtGiay(s || 0)
      })
      .catch(() => {
        if (!huy) setSrtGiay(0)
      })
    return () => {
      huy = true
    }
  }, [ghepSrt])

  useEffect(() => {
    if (!ghepSrt) {
      setSubPreview(null)
      setPreviewCueIndex(0)
      return
    }
    let huy = false
    void window.api
      .srtPreview(ghepSrt)
      .then((result) => {
        if (huy) return
        setSubPreview(result)
        setPreviewCueIndex(0)
        setPreviewTime(vidRef.current?.currentTime ?? 0)
      })
      .catch((error: unknown) => {
        if (huy) return
        setSubPreview({
          ok: false,
          cues: [],
          error: error instanceof Error ? error.message : 'Không đọc được file SRT.'
        })
      })
    return () => {
      huy = true
    }
  }, [ghepSrt])

  useEffect(() => {
    setGhepLoi(null)
    setGhep((current) => (current === 'loi' ? 'idle' : current))
    if (!batAmThanh || amThanhMode !== 'voice-per-cue' || !ghepSrt || !voiceDir) {
      setVoiceScan(null)
      setVoiceScanBusy(false)
      return
    }

    let huy = false
    setVoiceScanBusy(true)
    void window.api
      .scanVoiceSync(ghepSrt, voiceDir)
      .then((result) => {
        if (huy) return
        setVoiceScan(result)
        setVoiceScanBusy(false)
      })
      .catch((error: unknown) => {
        if (huy) return
        setVoiceScan({
          ok: false,
          srtPath: ghepSrt,
          voiceDir,
          cueCount: 0,
          audioCount: 0,
          matchedCount: 0,
          missingIndices: [],
          invalidIndices: [],
          extraFiles: [],
          entries: [],
          error: error instanceof Error ? error.message : 'Không kiểm tra được thư mục voice.'
        })
        setVoiceScanBusy(false)
      })
    return () => {
      huy = true
    }
  }, [amThanhMode, batAmThanh, ghepSrt, voiceDir])

  const caiCongCu = async (): Promise<void> => {
    setInstalling(true)
    setInstallErr(null)
    setInstallPct(0)
    const off = window.api.onOcrInstallProgress(setInstallPct)
    const res = await window.api.ocrInstallEngine()
    off()
    setInstalling(false)
    if (res.ok) setHasEngine(true)
    else setInstallErr(res.error ?? 'Tải công cụ Dịch màn hình thất bại.')
  }

  const addBlurRegion = (): void => {
    if (videoH <= 0 || videoW <= 0) return
    const id = String(Date.now())
    const idx = blurRegions.length
    const color = PALETTE[idx % PALETTE.length]
    const newRegion: BlurRegion = {
      id,
      x0: Math.round(videoW * 0.15),
      x1: Math.round(videoW * 0.85),
      y0: Math.round(videoH * 0.75),
      y1: videoH,
      color
    }
    setBlurRegions((prev) => [...prev, newRegion])
    setActiveBlurId(id)
  }

  const updateBlurRegion = (r: BlurRegion): void => {
    setBlurRegions((prev) => prev.map((item) => (item.id === r.id ? r : item)))
  }

  const removeBlurRegion = (id: string): void => {
    setBlurRegions((prev) => {
      const next = prev.filter((item) => item.id !== id)
      if (activeBlurId === id && next.length > 0) {
        setActiveBlurId(next[0].id)
      }
      return next
    })
  }

  const onMeta = (): void => {
    const v = vidRef.current
    if (!v) return
    setVideoH(v.videoHeight)
    setVideoW(v.videoWidth)
    // Do wrapper sau khi aspect-ratio cap nhat (frame tiep)
    requestAnimationFrame(doBox)
    setVideoGiay(Number.isFinite(v.duration) ? v.duration : 0)
    if (blurRegions.length === 0) {
      const defId = 'def-1'
      setBlurRegions([
        {
          id: defId,
          x0: Math.round(v.videoWidth * 0.15),
          x1: Math.round(v.videoWidth * 0.85),
          y0: Math.round(v.videoHeight * 0.75),
          y1: v.videoHeight,
          color: PALETTE[0]
        }
      ])
      setActiveBlurId(defId)
    }
    if (!subRegion && v.videoWidth > 0 && v.videoHeight > 0) {
      setSubRegion({
        x0: Math.round(v.videoWidth * 0.1),
        x1: Math.round(v.videoWidth * 0.9),
        y0: Math.round(v.videoHeight * 0.82),
        y1: Math.round(v.videoHeight * 0.94)
      })
    }
    if (!ocrRegion && v.videoWidth > 0 && v.videoHeight > 0) {
      setOcrRegion({
        x0: Math.round(v.videoWidth * 0.15),
        x1: Math.round(v.videoWidth * 0.85),
        y0: Math.round(v.videoHeight * 0.75),
        y1: v.videoHeight
      })
    }
  }

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => doBox())
    ro.observe(el)
    doBox()
    return () => ro.disconnect()
  }, [video, videoW, videoH])

  const chonVideo = async (): Promise<void> => {
    const files = await window.api.chooseFiles()
    if (!files.length) return
    setVideo(files[0])
    setBuoc('idle')
    setKetQua([])
    setLoi(null)
    setGhep('idle')
    setGhepOut('')
    setGhepLoi(null)
  }

  const chonSrt = async (): Promise<void> => {
    const file = await window.api.chooseSrt(outputDir || null)
    if (file) {
      setGhepSrt(file)
    }
  }

  const chonAmThanh = async (): Promise<void> => {
    const file = await window.api.chooseAudio()
    if (file) {
      setAmThanhFile(file)
    }
  }

  const chonVoiceDir = async (): Promise<void> => {
    const folder = await window.api.chooseFolder()
    if (folder) setVoiceDir(folder)
  }

  const chay = async (): Promise<void> => {
    if (!video || !outputDir) return

    const formats: string[] = []
    if (fmtSrt) formats.push('.srt')
    if (fmtTxt) formats.push('.txt')
    if (fmtVtt) formats.push('.vtt')
    if (fmtJson) formats.push('.json')

    if (formats.length === 0) {
      setLoi('Vui lòng chọn ít nhất một định dạng xuất file.')
      setBuoc('loi')
      return
    }

    setBuoc('doc')
    setPct(0)
    setLoi(null)
    setKetQua([])
    setDongChu('')
    setDangDung(false)

    const y0 = batOcrBox && ocrRegion ? ocrRegion.y0 : -1
    const y1 = batOcrBox && ocrRegion ? ocrRegion.y1 : -1
    const x0 = batOcrBox && ocrRegion ? ocrRegion.x0 : -1
    const x1 = batOcrBox && ocrRegion ? ocrRegion.x1 : -1

    const off = window.api.onOcrProgress((p) => {
      setPct(p.percent)
      if (p.text) setDongChu(p.text)
    })
    const r = await window.api.ocrVideo(video, outputDir, y0, y1, x0, x1, formats)
    off()
    setDangDung(false)

    if (!r.ok) {
      if (r.error === 'Đã huỷ.') {
        setBuoc('idle')
        setDongChu('')
        return
      }
      setLoi(r.error ?? 'Đọc chữ thất bại.')
      setBuoc('loi')
      return
    }
    const ra = r.outputs || (r.output ? [r.output] : [])
    let srtUuTien: string | null = null

    if (dich !== 'none' && r.output) {
      setBuoc('dich')
      const out = r.output.replace(/\.srt$/i, `.${dich}.srt`)
      const t = await window.api.translateSrt(r.output, out, dich, readDichProvider())
      if (t.ok) {
        // Ban dich dung dau danh sach + uu tien cho buoc ghep phu de
        ra.unshift(out)
        srtUuTien = out
      } else setLoi(`Dịch: ${t.error}`)
    }
    setKetQua(ra)
    const srtOutput =
      srtUuTien || r.outputs?.find((o) => o.toLowerCase().endsWith('.srt')) || r.output
    if (srtOutput) {
      setGhepSrt(srtOutput)
    }
    setBuoc('xong')
  }

  const dung = async (): Promise<void> => {
    setDangDung(true)
    await window.api.ocrCancel()
  }

  const xuLyVideo = async (): Promise<void> => {
    if (!video || !outputDir) return

    if (!batLamMo && !batPhuDe && !batAmThanh) {
      setGhepLoi('Vui lòng bật ít nhất 1 tính năng (Làm mờ, Thêm phụ đề hoặc Cấu hình âm thanh).')
      setGhep('loi')
      return
    }

    if (batPhuDe && !ghepSrt) {
      setGhepLoi('Vui lòng chọn tệp phụ đề (.srt).')
      setGhep('loi')
      return
    }

    if (batLamMo && blurRegions.length === 0) {
      setGhepLoi('Vui lòng thêm ít nhất 1 vùng làm mờ.')
      setGhep('loi')
      return
    }



    if (batAmThanh && amThanhMode === 'voice-per-cue') {
      if (!ghepSrt) {
        setGhepLoi('Voice theo từng câu cần chọn file SRT làm mốc thời gian.')
        setGhep('loi')
        return
      }
      if (!voiceDir) {
        setGhepLoi('Vui lòng chọn thư mục chứa các file voice.')
        setGhep('loi')
        return
      }
      if (voiceScanBusy) {
        setGhepLoi('Đang kiểm tra thư mục voice, vui lòng chờ một chút.')
        setGhep('loi')
        return
      }
      if (!voiceScan?.ok) {
        setGhepLoi(voiceScan?.error ?? 'Số file voice chưa khớp với số câu trong SRT.')
        setGhep('loi')
        return
      }
    }

    setGhep('chay')
    setGhepPct(0)
    setGhepLoi(null)

    const off = window.api.onBurnProgress((p) => setGhepPct(p.percent < 0 ? 0 : p.percent))
    const r = await window.api.burnStart({
      video,
      srt: batPhuDe ? ghepSrt : null,
      outputDir,
      mode: batPhuDe ? subtitleMode : 'burn',
      blurRegions: batLamMo ? blurRegions : [],
      lamMo: batLamMo,
      moTheoSrt: batLamMo ? moTheoSrt : false,
      subRegion: batPhuDe ? subRegion : undefined,
      catSrt: batPhuDe && subtitleMode === 'soft',
      batAmThanh,
      amThanhMode,
      amThanhFile: batAmThanh && amThanhMode === 'single' ? amThanhFile : null,
      voiceSyncSrt: batAmThanh && amThanhMode === 'voice-per-cue' ? ghepSrt : null,
      voiceDir: batAmThanh && amThanhMode === 'voice-per-cue' ? voiceDir : null,
      amLuongGoc,
      amLuongVoice,
      fontId: fontId !== 'auto' ? fontId : 'auto',
      textColor,
      outlineColor,
      outlinePx,
      bgEnabled,
      bgColor,
      bgOpacity,
      fontScale,
      bold,
      italic,
      shadowPx,
      bgPaddingPx
    })
    off()

    if (!r.ok) {
      if (r.error === 'Đã huỷ.') {
        setGhep('idle')
        return
      }
      setGhepLoi(r.error ?? 'Xử lý video thất bại.')
      setGhep('loi')
      return
    }
    setGhepOut(r.output!)
    setGhep('xong')
  }

  const previewCues = subPreview?.cues ?? []
  const cueAtTimeIndex = previewCues.findIndex(
    (cue) => previewTime >= cue.startSeconds && previewTime < cue.endSeconds
  )
  const previewCue: SubtitlePreviewCue | null =
    previewCues.length === 0
      ? null
      : previewPlaying && cueAtTimeIndex >= 0
        ? previewCues[cueAtTimeIndex]
        : previewCues[previewCueIndex] ?? previewCues[0]
  const videoPreviewText =
    subPreview?.ok !== true
      ? undefined
      : previewPlaying
        ? cueAtTimeIndex >= 0
          ? previewCues[cueAtTimeIndex]?.text ?? ''
          : ''
        : previewCue?.text ?? ''

  const formatPreviewTime = (seconds: number): string => {
    const safe = Math.max(0, Math.round(seconds))
    const h = Math.floor(safe / 3600)
    const m = Math.floor((safe % 3600) / 60)
    const s = safe % 60
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const capNhatPreviewTime = (): void => {
    const current = vidRef.current
    if (!current) return
    const nextTime = Number.isFinite(current.currentTime) ? current.currentTime : 0
    setPreviewTime(nextTime)
    const index = previewCues.findIndex(
      (cue) => nextTime >= cue.startSeconds && nextTime < cue.endSeconds
    )
    if (index >= 0) setPreviewCueIndex(index)
  }

  const chonPreviewCue = (index: number): void => {
    const cue = previewCues[index]
    if (!cue) return
    setPreviewCueIndex(index)
    setPreviewTime(cue.startSeconds)
    setPreviewPlaying(false)
    const current = vidRef.current
    if (current) {
      current.currentTime = cue.startSeconds
      current.pause()
    }
  }

  if (!unlocked) return <div className="card muted">Tính năng đang khoá.</div>

  if (hasEngine === false || installing) {
    const dangCapNhat = hasEngine === true
    return (
      <div className="dy-setup">
        <div className="card dy-install-card">
          <div className="dy-install-title">
            {dangCapNhat ? '🔄 Đang cập nhật tính năng đọc chữ' : '🔍 Cài tính năng đọc chữ trong video'}
          </div>
          <p className="muted">
            {dangCapNhat ? (
              <>Đã có bản công cụ mới — đang tải và cài đè bản cũ (~230MB).</>
            ) : (
              <>
                Việc nhận diện chữ chạy <b>ngay trên máy bạn</b>. T-blao cần tải thêm khoảng 230 MB
                trong lần cài đầu tiên.
              </>
            )}
          </p>
          {installing ? (
            <>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${installPct}%` }} />
              </div>
              <div className="muted small">
                {dangCapNhat ? 'Đang cập nhật' : 'Đang tải'} công cụ… {installPct}%
              </div>
            </>
          ) : (
            <button className="btn primary" onClick={caiCongCu}>
              Cài tính năng đọc chữ
            </button>
          )}
          {installErr && <div className="dy-err small">{installErr}</div>}
        </div>
      </div>
    )
  }

  const dangChay = buoc === 'doc' || buoc === 'dich'
  const phut = (s: number): string => {
    const t = Math.round(s)
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
  }
  const lechSrt: 'dai' | 'ngan' | null =
    videoGiay > 0 && srtGiay > 0
      ? srtGiay > videoGiay + 30
        ? 'dai'
        : srtGiay < videoGiay * 0.5
          ? 'ngan'
          : null
      : null

  return (
    <div className="lam-viec">
      <div className="cot-cauhinh">
        <div className="cot-tieude">Cấu hình</div>

        <div className="card options-card">
          <button className="btn primary" onClick={chonVideo} disabled={dangChay}>
            🎞 Chọn video
          </button>
          {video && <div className="muted small ocr-ten">{baseName(video)}</div>}
        </div>

        <div className="card options-card">
          <label className="field">
            <span className="muted small">Thư mục lưu kết quả</span>
            <div className="gk-row">
              <input value={outputDir} readOnly />
              <button
                className="btn"
                onClick={async () => {
                  const d = await window.api.chooseFolder()
                  if (d) setOutputDir(d)
                }}
              >
                Chọn thư mục
              </button>
            </div>
          </label>
        </div>

        <GeminiKey dich={dich} setDich={setDich} />

        {video && (
          <div className="card">
            <div className="cot-tieude" style={{ fontSize: 13, marginBottom: 6 }}>
              🔍 Đọc chữ trong video
            </div>

            {/* Checkbox Cấu hình vùng quét OCR */}
            <div style={{ marginBottom: 12 }}>
              <label className="gk-check">
                <input
                  type="checkbox"
                  checked={batOcrBox}
                  onChange={(e) => setBatOcrBox(e.target.checked)}
                />
                <span>Chỉ đọc chữ trong vùng đã chọn</span>
              </label>
              {batOcrBox && (
                <div className="muted small" style={{ marginTop: 4, marginLeft: 22, color: '#eab308' }}>
                  Kéo và thay đổi kích thước <b>khung màu vàng</b> trên video để chọn vùng có chữ.
                </div>
              )}
            </div>

            {/* Tùy chọn định dạng xuất file */}
            <div style={{ marginBottom: 12 }}>
              <div className="muted small" style={{ marginBottom: 4 }}>Kết quả muốn lưu:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', paddingLeft: 2 }}>
                <label className="gk-check">
                  <input type="checkbox" checked={fmtSrt} onChange={(e) => setFmtSrt(e.target.checked)} />
                  <span>Phụ đề (.srt)</span>
                </label>
                <label className="gk-check">
                  <input type="checkbox" checked={fmtTxt} onChange={(e) => setFmtTxt(e.target.checked)} />
                  <span>Văn bản (.txt)</span>
                </label>
                <label className="gk-check">
                  <input type="checkbox" checked={fmtVtt} onChange={(e) => setFmtVtt(e.target.checked)} />
                  <span>Phụ đề web (.vtt)</span>
                </label>
              </div>
              <details className="tech-details compact">
                <summary>Kết quả dành cho ứng dụng khác</summary>
                <label className="gk-check">
                  <input type="checkbox" checked={fmtJson} onChange={(e) => setFmtJson(e.target.checked)} />
                  <span>Dữ liệu chi tiết (.json)</span>
                </label>
              </details>
            </div>

            <div className="cookie-actions" style={{ flexDirection: 'column', gap: 8 }}>
              {!dangChay && (
                <button
                  className="btn primary"
                  disabled={!outputDir || !batOcrBox}
                  onClick={chay}
                  style={{ width: '100%', justifyContent: 'center', fontSize: 14, padding: '10px 16px' }}
                >
                  ▶ Bắt đầu đọc chữ
                </button>
              )}
              {buoc === 'doc' && (
                <button
                  className="btn danger"
                  onClick={dung}
                  disabled={dangDung}
                  style={{ width: '100%', justifyContent: 'center', fontSize: 14, padding: '10px 16px' }}
                >
                  {dangDung ? 'Đang dừng…' : '■ Dừng'}
                </button>
              )}
              {buoc === 'doc' && <span className="cookie-status ok" style={{ width: '100%', textAlign: 'center' }}>Đang đọc… {pct}%</span>}
              {buoc === 'dich' && <span className="cookie-status ok" style={{ width: '100%', textAlign: 'center' }}>✨ Đang dịch…</span>}
            </div>
            {dangChay && (
              <>
                <div className="bar" style={{ marginTop: 10, height: 8 }}>
                  <div className="bar-fill" style={{ width: `${buoc === 'dich' ? 100 : pct}%` }} />
                </div>
                {dongChu && <div className="muted small ocr-dong">{dongChu}</div>}
              </>
            )}
            {loi && <div className="dy-err small">{loi}</div>}
            {buoc === 'xong' && (
              <div className="muted small" style={{ marginTop: 8 }}>
                ✅ Xong ·{' '}
                {ketQua.map((o) => (
                  <button key={o} className="link-btn" onClick={() => window.api.showItem(o)}>
                    {baseName(o)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {video && (
          <div className="card options-card">
            <div className="cot-tieude">Xử lý video (Làm mờ &amp; Phụ đề)</div>

            <div style={{ marginTop: 6 }}>
              <label className="gk-check" style={{ fontWeight: 'bold' }}>
                <input
                  type="checkbox"
                  checked={batLamMo}
                  onChange={(e) => setBatLamMo(e.target.checked)}
                />
                <span>1. Cấu hình vùng làm mờ video</span>
              </label>

              {batLamMo && (
                <div style={{ paddingLeft: 22, marginTop: 8 }}>
                  <div style={{ marginBottom: 10 }}>
                    <label className="gk-check">
                      <input
                        type="checkbox"
                        checked={moTheoSrt}
                        onChange={(e) => setMoTheoSrt(e.target.checked)}
                      />
                      <span>Chỉ làm mờ khi xuất hiện phụ đề (theo file SRT)</span>
                    </label>
                    {moTheoSrt && (
                      <div className="muted small" style={{ marginTop: 3, marginLeft: 22, color: '#38bdf8' }}>
                        Vùng mờ sẽ tự động xuất hiện theo từng câu trong file SRT và biến mất khi không có lời thoại.
                      </div>
                    )}
                  </div>

                  <button className="btn" onClick={addBlurRegion}>
                    ➕ Thêm vùng làm mờ
                  </button>

                  <div className="blur-list">
                    {blurRegions.map((r, idx) => {
                      const isActive = r.id === activeBlurId
                      return (
                        <div
                          key={r.id}
                          className={`blur-item ${isActive ? 'active' : ''}`}
                          onClick={() => setActiveBlurId(r.id)}
                        >
                          <div className="blur-color-badge" style={{ background: r.color }} />
                          <div className="blur-toado">
                            <b>Vùng {idx + 1}</b>
                            <span className="blur-coords">{r.y0} → {r.y1} px · ngang {r.x0} → {r.x1} px</span>
                          </div>
                          {blurRegions.length > 1 && (
                            <button
                              className="blur-del-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                removeBlurRegion(r.id)
                              }}
                              title="Xoá vùng làm mờ này"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '14px 0' }} />

            <div>
              <label className="gk-check" style={{ fontWeight: 'bold' }}>
                <input
                  type="checkbox"
                  checked={batPhuDe}
                  onChange={(e) => setBatPhuDe(e.target.checked)}
                />
                <span>2. Cấu hình thêm phụ đề</span>
              </label>

              {batPhuDe && (
                <div style={{ paddingLeft: 22, marginTop: 8 }}>
                  <div style={{ marginBottom: 8 }}>
                    <button className="btn" onClick={chonSrt}>
                      📄 Chọn tệp phụ đề (.srt)
                    </button>
                    {ghepSrt ? (
                      <div className="muted small" style={{ marginTop: 4 }}>
                        Đã chọn: <b>{baseName(ghepSrt)}</b>
                      </div>
                    ) : (
                      <div className="muted small" style={{ marginTop: 4, color: '#ff6b6b' }}>
                        * Chưa chọn tệp phụ đề .srt
                      </div>
                    )}
                  </div>

                  <div className="sub-mode-choice" style={{ marginBottom: 10 }}>
                    <div className="muted small" style={{ marginBottom: 5 }}>Cách đưa phụ đề vào video:</div>
                    <label className="gk-check">
                      <input
                        type="radio"
                        name="tblao-subtitle-mode"
                        checked={subtitleMode === 'burn'}
                        onChange={() => setSubtitleMode('burn')}
                      />
                      <span>Hiển thị phụ đề trực tiếp trên video</span>
                    </label>
                    <label className="gk-check">
                      <input
                        type="radio"
                        name="tblao-subtitle-mode"
                        checked={subtitleMode === 'soft'}
                        onChange={() => setSubtitleMode('soft')}
                      />
                      <span>Chỉ nhúng SRT, không đốt chữ lên hình</span>
                    </label>
                    {subtitleMode === 'soft' && (
                      <div className="muted small" style={{ marginTop: 4 }}>
                        Video giữ nguyên hình ảnh; SRT được thêm thành track phụ đề mềm để trình phát có thể bật khi cần.
                      </div>
                    )}
                  </div>

                  {lechSrt && ghepSrt && (
                    <div className="qwarn small" style={{ marginBottom: 8 }}>
                      ⚠ File phụ đề dài <b>{phut(srtGiay)}</b>, video dài <b>{phut(videoGiay)}</b>
                      {lechSrt === 'dai'
                        ? ' — phần phụ đề vượt quá thời lượng video sẽ không hiện.'
                        : ' — phụ đề chỉ phủ được phần đầu video.'}
                    </div>
                  )}

                  {subPreview && (
                    <div className="sub-preview-panel">
                      <div className="sub-preview-head">
                        <b>Xem trước phụ đề thật</b>
                        {subPreview.ok && previewCue && (
                          <span className="muted small">
                            Câu {previewCue.index}/{previewCues.length} · {formatPreviewTime(previewCue.startSeconds)}
                          </span>
                        )}
                      </div>
                      {subPreview.ok && previewCue ? (
                        <>
                          <div className="sub-preview-text">{previewCue.text}</div>
                          <div className="sub-preview-actions">
                            <button
                              className="btn"
                              disabled={previewCueIndex <= 0}
                              onClick={() => chonPreviewCue(previewCueIndex - 1)}
                            >
                              ← Câu trước
                            </button>
                            <button
                              className="btn"
                              disabled={previewCueIndex >= previewCues.length - 1}
                              onClick={() => chonPreviewCue(previewCueIndex + 1)}
                            >
                              Câu sau →
                            </button>
                          </div>
                          <input
                            className="sub-preview-scrub"
                            type="range"
                            min={0}
                            max={Math.max(1, videoGiay, srtGiay)}
                            step={0.1}
                            value={Math.min(previewTime, Math.max(1, videoGiay, srtGiay))}
                            onChange={(e) => {
                              const next = Number(e.target.value)
                              setPreviewTime(next)
                              const index = previewCues.findIndex(
                                (cue) => next >= cue.startSeconds && next < cue.endSeconds
                              )
                              if (index >= 0) setPreviewCueIndex(index)
                              if (vidRef.current) {
                                vidRef.current.currentTime = next
                                vidRef.current.pause()
                              }
                              setPreviewPlaying(false)
                            }}
                          />
                          <div className="muted small sub-preview-help">
                            Bấm Play trên video bên phải để xem phụ đề chạy đúng mốc thời gian; kéo thanh này để kiểm tra từng vị trí.
                          </div>
                        </>
                      ) : (
                        <div className="muted small">{subPreview.error ?? 'Không có cue hợp lệ để xem trước.'}</div>
                      )}
                    </div>
                  )}

                  {subtitleMode === 'burn' && (
                    <>
                      <label className="field">
                        <span className="muted small">Preset kiểu phụ đề</span>
                        <select
                          value={subtitlePreset}
                          onChange={(e) => apDungPreset(e.target.value as SubtitlePreset)}
                        >
                          <option value="blurBox">✨ Nền mờ che phụ đề (+20px) — ôm sát từng câu</option>
                          <option value="clean">Sạch — chữ trắng, viền rõ</option>
                          <option value="cinema">Điện ảnh — chữ ấm, bóng nhẹ</option>
                          <option value="tiktok">Nền gọn — dễ đọc trên video dọc</option>
                          <option value="highlight">Nổi bật — nền màu</option>
                          <option value="custom">Tùy chỉnh</option>
                        </select>
                        <span className="muted small">Chọn preset trước, sau đó tinh chỉnh từng thông số bên dưới.</span>
                      </label>

                  <label className="field">
                    <span className="muted small">Font chữ phụ đề</span>
                    <select
                      value={fontId}
                      onChange={(e) => {
                        setFontId(e.target.value)
                        setSubtitlePreset('custom')
                      }}
                    >
                      <option value="auto">Tự động (theo ngôn ngữ)</option>
                      {(['Latin', 'UTM', 'SVN', 'UVF', 'UVN', 'VNF', 'iCiel'] as const).map(
                        (group) => {
                          const items = burnFonts.filter((f) => f.group === group)
                          if (items.length === 0) return null
                          return (
                            <optgroup key={group} label={group}>
                              {items.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.label}
                                </option>
                              ))}
                            </optgroup>
                          )
                        }
                      )}
                    </select>
                  </label>

                  <div className="sub-style-grid">
                    <label className="field">
                      <span className="muted small">Cỡ chữ theo khung: {fontScale}%</span>
                      <input
                        type="range"
                        min={70}
                        max={140}
                        step={5}
                        value={fontScale}
                        onChange={(e) => {
                          setFontScale(Number(e.target.value))
                          setSubtitlePreset('custom')
                        }}
                      />
                    </label>
                    <label className="gk-check">
                      <input
                        type="checkbox"
                        checked={bold}
                        onChange={(e) => {
                          setBold(e.target.checked)
                          setSubtitlePreset('custom')
                        }}
                      />
                      <span>Chữ đậm</span>
                    </label>
                    <label className="gk-check">
                      <input
                        type="checkbox"
                        checked={italic}
                        onChange={(e) => {
                          setItalic(e.target.checked)
                          setSubtitlePreset('custom')
                        }}
                      />
                      <span>Chữ nghiêng</span>
                    </label>
                    <label className="field">
                      <span className="muted small">Màu chữ</span>
                      <input
                        type="color"
                        value={textColor}
                        onChange={(e) => {
                          setTextColor(e.target.value)
                          setSubtitlePreset('custom')
                        }}
                      />
                    </label>
                    <label className="field">
                      <span className="muted small">Màu viền</span>
                      <input
                        type="color"
                        value={outlineColor}
                        onChange={(e) => {
                          setOutlineColor(e.target.value)
                          setSubtitlePreset('custom')
                        }}
                      />
                    </label>
                    <label className="field" style={{ gridColumn: '1 / -1' }}>
                      <span className="muted small">Độ dày viền: {outlinePx} px</span>
                      <input
                        type="range"
                        min={0}
                        max={8}
                        step={0.5}
                        value={outlinePx}
                        onChange={(e) => {
                          setOutlinePx(Number(e.target.value))
                          setSubtitlePreset('custom')
                        }}
                      />
                    </label>
                    <label className="field" style={{ gridColumn: '1 / -1' }}>
                      <span className="muted small">Bóng chữ: {shadowPx} px</span>
                      <input
                        type="range"
                        min={0}
                        max={6}
                        step={0.5}
                        value={shadowPx}
                        onChange={(e) => {
                          setShadowPx(Number(e.target.value))
                          setSubtitlePreset('custom')
                        }}
                      />
                    </label>
                    <label className="gk-check" style={{ gridColumn: '1 / -1' }}>
                      <input
                        type="checkbox"
                        checked={bgEnabled}
                        onChange={(e) => {
                          setBgEnabled(e.target.checked)
                          setSubtitlePreset('custom')
                        }}
                      />
                      <span>Bật nền hộp sau chữ (ôm sát kích thước chữ +20px)</span>
                    </label>
                    {bgEnabled && (
                      <>
                        <div className="muted small" style={{ gridColumn: '1 / -1', color: '#38bdf8', marginTop: -4, marginBottom: 4 }}>
                          💡 Nền hộp mờ tự động co giãn theo độ dài từng câu thoại (+20px lề) và chỉ xuất hiện khi có phụ đề SRT (tự tắt khi không có lời thoại).
                        </div>
                        <label className="field">
                          <span className="muted small">Màu nền</span>
                          <input
                            type="color"
                            value={bgColor}
                            onChange={(e) => {
                              setBgColor(e.target.value)
                              setSubtitlePreset('custom')
                            }}
                          />
                        </label>
                        <label className="field">
                          <span className="muted small">Độ đậm nền: {bgOpacity}%</span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={bgOpacity}
                            onChange={(e) => {
                              setBgOpacity(Number(e.target.value))
                              setSubtitlePreset('custom')
                            }}
                          />
                        </label>
                        <label className="field" style={{ gridColumn: '1 / -1' }}>
                          <span className="muted small">Đệm nền: {bgPaddingPx} px (Kích thước chữ + {bgPaddingPx * 2} px)</span>
                          <input
                            type="range"
                            min={4}
                            max={24}
                            step={1}
                            value={bgPaddingPx}
                            onChange={(e) => {
                              setBgPaddingPx(Number(e.target.value))
                              setSubtitlePreset('custom')
                            }}
                          />
                        </label>
                      </>
                    )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '14px 0' }} />

            <div>
              <label className="gk-check" style={{ fontWeight: 'bold' }}>
                <input
                  type="checkbox"
                  checked={batAmThanh}
                  onChange={(e) => setBatAmThanh(e.target.checked)}
                />
                <span>3. Cấu hình âm thanh</span>
              </label>

              {batAmThanh && (
                <div style={{ paddingLeft: 22, marginTop: 8 }}>
                  <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
                    <label className="gk-check">
                      <input
                        type="radio"
                        name="tblao-audio-mode"
                        checked={amThanhMode === 'single'}
                        onChange={() => setAmThanhMode('single')}
                      />
                      <span>Âm thanh một file / nhạc nền</span>
                    </label>
                    <label className="gk-check">
                      <input
                        type="radio"
                        name="tblao-audio-mode"
                        checked={amThanhMode === 'voice-per-cue'}
                        onChange={() => setAmThanhMode('voice-per-cue')}
                      />
                      <span>Voice theo từng câu SRT</span>
                    </label>
                  </div>

                  {amThanhMode === 'voice-per-cue' && (
                    <div style={{ marginBottom: 10 }}>
                      <div className="muted small" style={{ marginBottom: 6 }}>
                        Chọn thư mục chứa voice theo thứ tự tự nhiên: <b>001.mp3, 002.mp3, 003.mp3…</b>.
                        MP3 được hỗ trợ trực tiếp.
                      </div>
                      <button className="btn" onClick={chonVoiceDir}>
                        Chọn thư mục voice
                      </button>
                      {voiceDir ? (
                        <div className="muted small" style={{ marginTop: 4 }}>
                          Thư mục: <b>{baseName(voiceDir)}</b>
                        </div>
                      ) : (
                        <div className="muted small" style={{ marginTop: 4, color: '#ff6b6b' }}>
                          * Chưa chọn thư mục voice
                        </div>
                      )}
                      {!ghepSrt && (
                        <div className="muted small" style={{ marginTop: 4, color: '#f4b860' }}>
                          Chọn file SRT ở phần “Thêm phụ đề” để lấy mốc thời gian cho voice.
                        </div>
                      )}
                      {voiceScanBusy && (
                        <div className="muted small" style={{ marginTop: 6 }}>
                          Đang quét MP3 và đo thời lượng voice…
                        </div>
                      )}
                      {voiceScan && !voiceScanBusy && (
                        <div
                          style={{
                            marginTop: 8,
                            padding: 8,
                            border: `1px solid ${voiceScan.ok ? 'rgba(62,214,160,.45)' : 'rgba(244,184,96,.5)'}`,
                            borderRadius: 8,
                            background: 'rgba(0,0,0,.12)'
                          }}
                        >
                          <div className="small" style={{ color: voiceScan.ok ? 'var(--ok)' : 'var(--warn)' }}>
                            {voiceScan.ok
                              ? `Đã khớp ${voiceScan.matchedCount}/${voiceScan.cueCount} câu SRT với file voice.`
                              : voiceScan.error ?? 'Số file voice chưa khớp với SRT.'}
                          </div>
                          {(voiceScan.missingIndices.length > 0 ||
                            voiceScan.invalidIndices.length > 0 ||
                            voiceScan.extraFiles.length > 0) && (
                            <div className="muted small" style={{ marginTop: 4 }}>
                              {voiceScan.missingIndices.length > 0 &&
                                `Thiếu câu: ${voiceScan.missingIndices.slice(0, 8).join(', ')}. `}
                              {voiceScan.invalidIndices.length > 0 &&
                                `File lỗi ở câu: ${voiceScan.invalidIndices.slice(0, 8).join(', ')}. `}
                              {voiceScan.extraFiles.length > 0 &&
                                `File dư: ${voiceScan.extraFiles.length}.`}
                            </div>
                          )}
                          {voiceScan.entries.length > 0 && (
                            <div style={{ maxHeight: 170, overflowY: 'auto', marginTop: 6 }}>
                              {voiceScan.entries.slice(0, 8).map((entry) => (
                                <div
                                  key={entry.index}
                                  className="small"
                                  style={{
                                    display: 'flex',
                                    gap: 6,
                                    alignItems: 'baseline',
                                    padding: '3px 0',
                                    borderTop: '1px solid rgba(255,255,255,.06)'
                                  }}
                                >
                                  <b style={{ width: 24, color: 'var(--muted)' }}>{entry.index}</b>
                                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {entry.fileName ?? 'Thiếu file'}
                                  </span>
                                  <span style={{ color: entry.status === 'ok' ? 'var(--ok)' : 'var(--warn)' }}>
                                    {entry.durationSeconds ? phut(entry.durationSeconds) : entry.status}
                                  </span>
                                </div>
                              ))}
                              {voiceScan.entries.length > 8 && (
                                <div className="muted small" style={{ marginTop: 4 }}>
                                  … và {voiceScan.entries.length - 8} câu khác
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="field" style={{ marginTop: 10 }}>
                        <span className="muted small" style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Âm lượng voice:</span>
                          <b style={{ color: 'var(--text)' }}>{amLuongVoice}%</b>
                        </span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={amLuongVoice}
                          onChange={(e) => setAmLuongVoice(Number(e.target.value))}
                          style={{ width: '100%', height: 6, borderRadius: 3, outline: 'none', background: 'var(--border)', cursor: 'pointer' }}
                        />
                      </div>
                    </div>
                  )}

                  {amThanhMode === 'single' && (
                  <div style={{ marginBottom: 8 }}>
                    <button className="btn" onClick={chonAmThanh}>
                      🎵 Chọn tệp âm thanh
                    </button>
                    {amThanhFile ? (
                      <div className="muted small" style={{ marginTop: 4 }}>
                        Đã chọn: <b>{baseName(amThanhFile)}</b>
                      </div>
                    ) : (
                      <div className="muted small" style={{ marginTop: 4 }}>
                        (Không lồng nhạc mới)
                      </div>
                    )}
                  </div>

                  )}

                  <div className="field" style={{ marginTop: 12 }}>
                    <span className="muted small" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Âm lượng video gốc:</span>
                      <b style={{ color: 'var(--text)' }}>{amLuongGoc}%</b>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={amLuongGoc}
                      onChange={(e) => setAmLuongGoc(Number(e.target.value))}
                      style={{ width: '100%', height: 6, borderRadius: 3, outline: 'none', background: 'var(--border)', cursor: 'pointer' }}
                    />
                  </div>
                </div>
              )}
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '14px 0' }} />

            <div className="cookie-actions">
              {ghep !== 'chay' && (
                <button
                  className="btn primary"
                  onClick={xuLyVideo}
                  style={{ width: '100%', justifyContent: 'center', fontSize: 14, padding: '10px 16px' }}
                >
                  ▶ Bắt đầu xử lý
                </button>
              )}
              {ghep === 'chay' && (
                <>
                  <button className="btn danger" onClick={() => window.api.burnCancel()}>
                    ■ Dừng
                  </button>
                  <span className="cookie-status ok">Đang xử lý… {ghepPct}%</span>
                </>
              )}
            </div>

            {ghep === 'chay' && (
              <div className="bar" style={{ marginTop: 10, height: 8 }}>
                <div className="bar-fill" style={{ width: `${ghepPct}%` }} />
              </div>
            )}
            {ghepLoi && <div className="dy-err small" style={{ marginTop: 8 }}>{ghepLoi}</div>}
            {ghep === 'xong' && (
              <div className="muted small" style={{ marginTop: 8 }}>
                ✅ Đã xử lý xong ·{' '}
                <button className="link-btn" onClick={() => window.api.showItem(ghepOut)}>
                  {baseName(ghepOut)}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="cot-ketqua cot-video">
        <div className="cot-tieude">Video &amp; Các vùng làm mờ</div>
        {video ? (
          <>
            <div className="muted small">
              Xem trước video, phụ đề theo đúng timeline và điều chỉnh vị trí các <b>vùng làm mờ</b>.
            </div>
            <div className="ocr-sanh">
              <div
                ref={wrapRef}
                className="ocr-video"
                style={
                  videoW > 0 && videoH > 0
                    ? ({
                        aspectRatio: `${videoW} / ${videoH}`,
                        ['--ocr-ar']: String(videoW / videoH)
                      } as CSSProperties)
                    : undefined
                }
              >
                <video
                  ref={vidRef}
                  src={srcVideo(video)}
                  onLoadedMetadata={onMeta}
                  onError={() => setLoi('T-blao không mở được video này. Hãy thử một video MP4 khác.')}
                  onPlay={() => setPreviewPlaying(true)}
                  onPause={() => setPreviewPlaying(false)}
                  onTimeUpdate={capNhatPreviewTime}
                  onSeeked={capNhatPreviewTime}
                  controls
                  muted
                />
                {videoH > 0 && (
                  <RegionBox
                    regions={batLamMo ? blurRegions : []}
                    activeId={activeBlurId}
                    setActiveId={setActiveBlurId}
                    updateRegion={updateBlurRegion}
                    removeRegion={removeBlurRegion}
                    hienSubBox={batPhuDe && subtitleMode === 'burn'}
                    subRegion={subRegion}
                    setSubRegion={setSubRegion}
                    hienOcrBox={batOcrBox}
                    ocrRegion={ocrRegion}
                    setOcrRegion={setOcrRegion}
                    videoH={videoH}
                    videoW={videoW}
                    boxH={boxH}
                    boxW={boxW}
                    xemMo={batLamMo}
                    moTheoSrt={batLamMo ? moTheoSrt : false}
                    isCueActive={previewPlaying ? cueAtTimeIndex >= 0 : previewCues.length > 0 && previewTime >= (previewCue?.startSeconds ?? -1) && previewTime <= (previewCue?.endSeconds ?? -1)}
                    previewFontFamily={previewFontFamily || undefined}
                    previewText={videoPreviewText}
                    textColor={textColor}
                    outlineColor={outlineColor}
                    outlinePx={outlinePx}
                    fontScale={fontScale}
                    bold={bold}
                    italic={italic}
                    shadowPx={shadowPx}
                    bgEnabled={bgEnabled}
                    bgColor={bgColor}
                    bgOpacity={bgOpacity}
                    bgPaddingPx={bgPaddingPx}
                  />
                )}
              </div>
            </div>
            {videoH > 0 && (
              <div className="muted small ocr-toado">
                Video {videoW}×{videoH} · Đang có {blurRegions.length} vùng làm mờ
              </div>
            )}
          </>
        ) : (
          <div className="ocr-sanh">
            <div className="muted small">Chưa chọn video — bấm “Chọn video” bên trái.</div>
          </div>
        )}
      </div>
    </div>
  )
}
