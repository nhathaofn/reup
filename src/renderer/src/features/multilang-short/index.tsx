import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { DICH_LANGS, type BlurRegion, type GpuInfo } from '../../../../shared/types'
import {
  FEATURE_ID,
  FEATURE_META,
  type MultiLangProgress,
  type MultiLangRegion,
  type MultiLangResult,
  type MultiLangStyle,
  type MultiLangSubtitleStyle,
  type MultiLangTarget,
  type MultiLangProvider,
  type MultiLangVoiceMode
} from '../../../../shared/features/multilang-short'
import { usePersistedState } from '../../lib/persist'
import { useTabOutputDir } from '../../lib/outputDir'
import type { RendererFeature } from '../contracts'
import RegionBox, { type Region } from '../../components/RegionBox'
import {
  SUBTITLE_PRESETS,
  type SubtitlePreset
} from '../../lib/subtitlePresets'
import './styles.css'

const VIDEO_PATTERN = /\.(mp4|mkv|webm|mov|avi|flv|ts|m4v)$/i
const STYLE_OPTIONS: Array<{ value: MultiLangStyle; label: string }> = [
  { value: 'natural', label: 'Tự nhiên, dễ nghe' },
  { value: 'social', label: 'Mạng xã hội / trend' },
  { value: 'news', label: 'Tin ngắn, rõ ràng' },
  { value: 'dramatic', label: 'Kể chuyện có điểm nhấn' }
]

const SUBTITLE_PRESET_OPTIONS: Array<{ value: SubtitlePreset; label: string }> = [
  { value: 'clean', label: 'Sạch — chữ trắng, viền rõ' },
  { value: 'cinema', label: 'Điện ảnh — chữ kem, bóng nhẹ' },
  { value: 'tiktok', label: 'Nền gọn — dễ đọc video dọc' },
  { value: 'highlight', label: 'Nổi bật — nền màu' },
  { value: 'custom', label: 'Tùy chỉnh hiện tại' }
]

const DEFAULT_SUBTITLE_REGION: MultiLangRegion = {
  x0: 0.08,
  x1: 0.92,
  y0: 0.8,
  y1: 0.95
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function sourceUrl(path: string): string {
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(path)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `tediapros://b64/${encoded}`
}

function initialTargets(): MultiLangTarget[] {
  return [
    { language: 'vi', locale: 'vi-VN', style: 'natural' },
    { language: 'en', locale: 'en-US', style: 'social' }
  ]
}

function defaultLocale(language: string): string {
  const locales: Record<string, string> = {
    vi: 'vi-VN', en: 'en-US', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR',
    es: 'es-ES', fr: 'fr-FR', de: 'de-DE', id: 'id-ID', th: 'th-TH',
    pt: 'pt-BR', ru: 'ru-RU', ar: 'ar-SA'
  }
  return locales[language] ?? `${language}-${language.toUpperCase()}`
}

function MultiLangPanel(): JSX.Element {
  const [videos, setVideos] = useState<string[]>([])
  const [outputDir, setOutputDir] = useTabOutputDir('tediapros.outputDir.multilang-short')
  const [targets, setTargets] = usePersistedState<MultiLangTarget[]>('tediapros.multilang.targets', initialTargets())
  const [provider, setProvider] = usePersistedState<MultiLangProvider>('tediapros.multilang.provider', 'gemini')
  const [voiceMode, setVoiceMode] = usePersistedState<MultiLangVoiceMode>('tediapros.multilang.voiceMode', 'auto')
  const [voiceId, setVoiceId] = usePersistedState('tediapros.multilang.voiceId', '')
  const [voiceModel, setVoiceModel] = usePersistedState('tediapros.multilang.voiceModel', 'eleven_multilingual_v2')
  const [sourceLanguage, setSourceLanguage] = usePersistedState('tediapros.multilang.sourceLanguage', 'auto')
  const [whisperModel, setWhisperModel] = usePersistedState('tediapros.multilang.whisperModel', 'large-v3-turbo')
  const [preferGpu, setPreferGpu] = usePersistedState('tediapros.multilang.preferGpu', true)
  const [sceneSplit, setSceneSplit] = usePersistedState('tediapros.multilang.sceneSplit', false)
  const [variantShuffle, setVariantShuffle] = usePersistedState('tediapros.multilang.variantShuffle', false)
  const [originalVolume, setOriginalVolume] = usePersistedState('tediapros.multilang.originalVolume', 0)
  const [blurEnabled, setBlurEnabled] = usePersistedState('tediapros.multilang.blurEnabled', true)
  const [blurRegion, setBlurRegion] = useState<MultiLangRegion | null>({ x0: 0.12, x1: 0.88, y0: 0.72, y1: 0.96 })
  const [subtitleRegion, setSubtitleRegion] = usePersistedState<MultiLangRegion>(
    'tediapros.multilang.subtitleRegion',
    DEFAULT_SUBTITLE_REGION
  )
  const [subtitlePreset, setSubtitlePreset] = usePersistedState<SubtitlePreset>(
    'tediapros.multilang.subtitlePreset',
    'clean'
  )
  const [subtitleStyle, setSubtitleStyle] = usePersistedState<MultiLangSubtitleStyle>(
    'tediapros.multilang.subtitleStyle',
    SUBTITLE_PRESETS.clean
  )
  const [editingRegion, setEditingRegion] = useState<'remove' | 'subtitle'>('remove')
  const [progress, setProgress] = useState<MultiLangProgress | null>(null)
  const [result, setResult] = useState<MultiLangResult | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [gpu, setGpu] = useState<GpuInfo | null>(null)
  const [cudaReady, setCudaReady] = useState<boolean | null>(null)
  const [elevenKey, setElevenKey] = useState('')
  const [elevenKeyStatus, setElevenKeyStatus] = useState('')
  const [translationKey, setTranslationKey] = useState('')
  const [geminiKeys, setGeminiKeys] = useState('')
  const [translationModel, setTranslationModel] = usePersistedState('tediapros.multilang.translationModel', 'qwen2.5:7b')
  const [translationBaseUrl, setTranslationBaseUrl] = usePersistedState('tediapros.multilang.translationBaseUrl', 'http://127.0.0.1:11434')
  const [translationStatus, setTranslationStatus] = useState('')
  const previewRef = useRef<HTMLDivElement | null>(null)
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const [previewVideoSize, setPreviewVideoSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    // Existing installations may have the old, expensive defaults persisted.
    // Migrate once so an upgrade immediately uses the fast source-timeline
    // path; users can still opt into either feature with its checkbox.
    const migrationKey = 'tediapros.multilang.performanceDefaults.v2'
    if (localStorage.getItem(migrationKey) === '1') return
    setSceneSplit(false)
    setVariantShuffle(false)
    localStorage.setItem(migrationKey, '1')
  }, [setSceneSplit, setVariantShuffle])
  const [previewBoxSize, setPreviewBoxSize] = useState({ width: 0, height: 0 })

  useEffect(() => window.api.onMultiLangShortProgress(setProgress), [])
  useEffect(() => {
    let alive = true
    void Promise.all([window.api.whisperDetectGpu(), window.api.whisperCudaStatus(), window.api.hasElevenLabsKey(), window.api.hasGeminiKeys()]).then(
      ([gpuInfo, cuda, eleven, gemini]) => {
        if (!alive) return
        setGpu(gpuInfo)
        setCudaReady(cuda.has)
        setElevenKeyStatus(eleven.hasKey ? `Đã lưu ${eleven.keyCount ?? 1} ElevenLabs key trên máy này.` : 'Chưa có ElevenLabs key.')
        if (provider === 'gemini') setTranslationStatus(gemini.hasKey ? `Đã lưu ${gemini.keyCount ?? 1} Gemini key trên máy này.` : 'Chưa có Gemini key.')
      }
    ).catch(() => undefined)
    return () => { alive = false }
  }, [])
  useEffect(() => {
    const status = provider === 'gemini'
      ? window.api.hasGeminiKeys().then((pool) => pool.hasKey ? `Đã lưu ${pool.keyCount ?? 1} Gemini key.` : 'Chưa có Gemini key.')
      : provider === 'ollama'
        ? window.api.checkOllama(translationModel, translationBaseUrl).then((checked) => checked.message)
      : window.api.translateHasKey(provider).then((has) => has ? 'Đã lưu khóa dịch.' : 'Chưa có khóa dịch.')
    void status.then(setTranslationStatus).catch(() => setTranslationStatus('Chưa kiểm tra được khóa dịch.'))
  }, [provider, translationModel, translationBaseUrl])

  const previewVideo = videos[0] ?? ''
  const selectedLanguages = useMemo(() => new Set(targets.map((target) => target.language)), [targets])
  const totalOutputs = videos.length * targets.length
  const canRun = videos.length > 0 && targets.length > 0 && Boolean(outputDir.trim()) && (voiceMode === 'auto' || Boolean(voiceId.trim())) && !running
  const regionToPixels = (value: MultiLangRegion | null): Region | undefined => {
    if (!value || previewVideoSize.width <= 0 || previewVideoSize.height <= 0) return undefined
    return {
      x0: Math.round(previewVideoSize.width * value.x0),
      x1: Math.round(previewVideoSize.width * value.x1),
      y0: Math.round(previewVideoSize.height * value.y0),
      y1: Math.round(previewVideoSize.height * value.y1)
    }
  }

  const subtitleRegionPixels = regionToPixels(subtitleRegion)
  const blurRegionPixels = regionToPixels(blurRegion)
  const previewStageSize = useMemo(() => {
    if (previewBoxSize.width <= 0 || previewBoxSize.height <= 0 || previewVideoSize.width <= 0 || previewVideoSize.height <= 0) {
      return { width: 0, height: 0 }
    }
    const ratio = previewVideoSize.width / previewVideoSize.height
    const width = Math.min(previewBoxSize.width, previewBoxSize.height * ratio)
    const height = width / ratio
    return { width: Math.round(width), height: Math.round(height) }
  }, [previewBoxSize, previewVideoSize])

  const chooseVideos = async (): Promise<void> => {
    const picked = (await window.api.chooseFiles()) as string[]
    const valid = picked.filter((path) => VIDEO_PATTERN.test(path))
    if (!valid.length) return
    setVideos((current) => [...new Set([...current, ...valid])])
    setResult(null)
    setError('')
  }

  const chooseOutput = async (): Promise<void> => {
    const picked = await window.api.chooseFolder()
    if (picked) setOutputDir(picked)
  }

  const applySubtitlePreset = (value: SubtitlePreset): void => {
    setSubtitlePreset(value)
    if (value !== 'custom') setSubtitleStyle({ ...SUBTITLE_PRESETS[value] })
  }

  const onPreviewMetadata = (): void => {
    const video = previewVideoRef.current
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return
    setPreviewVideoSize({ width: video.videoWidth, height: video.videoHeight })
  }

  const updateNormalizedRegion = (region: Region): MultiLangRegion | null => {
    if (previewVideoSize.width <= 0 || previewVideoSize.height <= 0) return null
    const next = {
      x0: Math.max(0, Math.min(1, region.x0 / previewVideoSize.width)),
      x1: Math.max(0, Math.min(1, region.x1 / previewVideoSize.width)),
      y0: Math.max(0, Math.min(1, region.y0 / previewVideoSize.height)),
      y1: Math.max(0, Math.min(1, region.y1 / previewVideoSize.height))
    }
    return next.x1 > next.x0 && next.y1 > next.y0 ? next : null
  }

  const updateBlurRegion = (region: BlurRegion): void => {
    const next = updateNormalizedRegion(region)
    if (next) setBlurRegion(next)
  }

  const updateSubtitleRegion = (region: Region): void => {
    const next = updateNormalizedRegion(region)
    if (next) setSubtitleRegion(next)
  }

  const resetBlurRegion = (): void => setBlurRegion({ x0: 0.12, x1: 0.88, y0: 0.72, y1: 0.96 })
  const resetSubtitleRegion = (): void => setSubtitleRegion(DEFAULT_SUBTITLE_REGION)

  useEffect(() => {
    setPreviewVideoSize({ width: 0, height: 0 })
    setPreviewBoxSize({ width: 0, height: 0 })
  }, [previewVideo])

  useEffect(() => {
    const element = previewRef.current
    if (!element) return
    const update = (): void => setPreviewBoxSize({ width: element.clientWidth, height: element.clientHeight })
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    return () => observer.disconnect()
  }, [previewVideo, previewVideoSize.width, previewVideoSize.height])

  const toggleLanguage = (language: string): void => {
    if (selectedLanguages.has(language)) {
      setTargets((current) => current.filter((target) => target.language !== language))
      return
    }
    const locale = defaultLocale(language)
    setTargets((current) => [...current, { language, locale, style: language === 'en' ? 'social' : 'natural' }])
  }

  const setTargetStyle = (language: string, style: MultiLangStyle): void => {
    setTargets((current) => current.map((target) => target.language === language ? { ...target, style } : target))
  }

  const setTargetVoice = (language: string, field: 'voiceId' | 'voiceModel', value: string): void => {
    setTargets((current) => current.map((target) => target.language === language ? { ...target, [field]: value.trim() || undefined } : target))
  }

  const saveElevenKey = async (): Promise<void> => {
    const saved = await window.api.saveElevenLabsKeys(elevenKey)
    setElevenKey('')
    setElevenKeyStatus(saved.message)
  }

  const checkElevenKey = async (): Promise<void> => {
    setElevenKeyStatus('Đang kiểm tra ElevenLabs…')
    const checked = await window.api.checkElevenLabsKey(elevenKey || undefined, voiceId || undefined)
    setElevenKeyStatus(checked.message)
  }

  const saveTranslationKey = async (): Promise<void> => {
    if (provider === 'gemini') {
      if (!geminiKeys.trim()) return
      const checked = await window.api.checkGeminiKeys(geminiKeys)
      setTranslationStatus(checked.message)
      if (checked.ok) {
        await window.api.saveGeminiKeys(geminiKeys)
        setGeminiKeys('')
        setTranslationStatus(checked.message)
      }
      return
    }
    if (provider === 'ollama') {
      setTranslationStatus('Đang kiểm tra Ollama local…')
      const checked = await window.api.checkOllama(translationModel, translationBaseUrl)
      setTranslationStatus(checked.message)
      return
    }
    if (!translationKey.trim()) return
    const checked = await window.api.translateCheckKey(provider, translationKey)
    setTranslationStatus(checked.message)
    if (checked.ok) {
      await window.api.translateSaveKey(provider, translationKey)
      setTranslationKey('')
      setTranslationStatus('Đã lưu khóa dịch an toàn trên máy này.')
    }
  }

  const run = async (): Promise<void> => {
    setRunning(true)
    setCancelling(false)
    setError('')
    setResult(null)
    setProgress({ phase: 'preparing', percent: 0, message: 'Đang chuẩn bị pipeline…', completedOutputs: 0, totalOutputs })
    try {
      const generated = await window.api.runMultiLangShort({
        videos,
        outputDir,
        targets,
        translationProvider: provider,
        translationModel,
        translationBaseUrl,
        voiceMode,
        voiceId,
        voiceModel,
        blurRegion: blurEnabled ? blurRegion : null,
        subtitleRegion,
        subtitleStyle,
        originalAudioVolume: Number(originalVolume),
        sceneSplit,
        variantShuffle,
        whisper: { model: whisperModel, sourceLanguage, preferGpu }
      })
      setResult(generated)
      if (!generated.ok && !generated.cancelled) setError(generated.error || 'Pipeline thất bại.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setRunning(false)
      setCancelling(false)
    }
  }

  const cancel = async (): Promise<void> => {
    setCancelling(true)
    try {
      await window.api.cancelMultiLangShort()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setCancelling(false)
    }
  }

  return (
    <div className="lam-viec multilang-workspace">
      <div className="cot-cauhinh">
        <section className="card multilang-card">
          <div className="multilang-card-head">
            <div>
              <strong>🎞️ N video nguồn</strong>
              <span className="muted small">Mỗi video sẽ tạo một bộ SRT, voice và video theo từng ngôn ngữ.</span>
            </div>
            <div className="multilang-actions">
              <button className="btn primary small-btn" type="button" onClick={chooseVideos} disabled={running}>Thêm video</button>
              {videos.length > 0 && <button className="btn small-btn" type="button" onClick={() => setVideos([])} disabled={running}>Xóa hết</button>}
            </div>
          </div>
          {videos.length > 0 ? (
            <div className="multilang-files">
              {videos.map((video, index) => (
                <div className={`multilang-file ${index === 0 ? 'selected' : ''}`} key={video} title={video}>
                  <span>{index + 1}. {fileName(video)}</span>
                  <button type="button" className="multilang-remove" onClick={() => setVideos((current) => current.filter((item) => item !== video))} disabled={running}>×</button>
                </div>
              ))}
            </div>
          ) : <p className="muted small">Chưa chọn video nào.</p>}
        </section>

        <section className="card multilang-card">
          <div className="multilang-section-title">🪄 Xóa chữ cũ / chọn vùng</div>
          <p className="muted small">Kéo trên khung xem trước để chọn vùng chung cho các video. Tọa độ được chuẩn hóa theo từng video.</p>
          <label className="gk-check"><input type="checkbox" checked={blurEnabled} onChange={(event) => setBlurEnabled(event.target.checked)} disabled={running} /><span>Chỉ che nét chữ cũ phát hiện trong vùng đã chọn</span></label>
          {blurEnabled && <>
            <p className="muted small">Dùng cùng bộ lọc BLUR của tab Đọc chữ video, chỉ phủ lên phần giống chữ trong vùng chọn; video nguồn được làm mờ một lần trước khi tách scene.</p>
          </>}
          {previewVideo ? (
            <div ref={previewRef} className="multilang-preview">
              <div
                className="multilang-video-stage"
                style={previewStageSize.width > 0 && previewStageSize.height > 0
                  ? { width: `${previewStageSize.width}px`, height: `${previewStageSize.height}px` }
                  : undefined}
              >
                <video
                  ref={previewVideoRef}
                  src={sourceUrl(previewVideo)}
                  controls
                  muted
                  preload="metadata"
                  onLoadedMetadata={onPreviewMetadata}
                />
                {blurEnabled && blurRegionPixels && previewStageSize.width > 0 && previewStageSize.height > 0 && (
                  <div className={`multilang-region-editor ${editingRegion === 'remove' ? 'active' : 'inactive'}`}>
                    <RegionBox
                      regions={[{ id: 'multilang-remove', ...blurRegionPixels, color: '#f4b860' }]}
                      regionLabel="BLUR"
                      activeId="multilang-remove"
                      updateRegion={updateBlurRegion}
                      videoH={previewVideoSize.height}
                      videoW={previewVideoSize.width}
                      boxH={previewStageSize.height}
                      boxW={previewStageSize.width}
                    />
                  </div>
                )}
                {subtitleRegionPixels && previewStageSize.width > 0 && previewStageSize.height > 0 && (
                  <div className={`multilang-region-editor ${editingRegion === 'subtitle' ? 'active' : 'inactive'}`}>
                    <RegionBox
                      regions={[]}
                      hienSubBox
                      subRegion={subtitleRegionPixels}
                      setSubRegion={updateSubtitleRegion}
                      videoH={previewVideoSize.height}
                      videoW={previewVideoSize.width}
                      boxH={previewStageSize.height}
                      boxW={previewStageSize.width}
                      previewText="Mẫu phụ đề hiển thị"
                      textColor={subtitleStyle.textColor}
                      outlineColor={subtitleStyle.outlineColor}
                      outlinePx={subtitleStyle.outlinePx}
                      fontScale={subtitleStyle.fontScale}
                      bold={subtitleStyle.bold}
                      italic={subtitleStyle.italic}
                      shadowPx={subtitleStyle.shadowPx}
                      bgEnabled={subtitleStyle.bgEnabled}
                      bgColor={subtitleStyle.bgColor}
                      bgOpacity={subtitleStyle.bgOpacity}
                      bgPaddingPx={subtitleStyle.bgPaddingPx}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : <div className="multilang-preview-empty">Chọn video để hiện khung xem trước.</div>}
          <div className="multilang-region-toolbar" aria-label="Chọn khung cần chỉnh sửa">
            <span className="muted small">Khung đang chỉnh:</span>
            <button className={`btn small-btn ${editingRegion === 'remove' ? 'active' : ''}`} type="button" onClick={() => setEditingRegion('remove')} disabled={running || !blurEnabled}>BLUR</button>
            <button className={`btn small-btn ${editingRegion === 'subtitle' ? 'active' : ''}`} type="button" onClick={() => setEditingRegion('subtitle')} disabled={running}>PHỤ ĐỀ</button>
            <button className="btn small-btn" type="button" onClick={editingRegion === 'remove' ? resetBlurRegion : resetSubtitleRegion} disabled={running}>Đặt lại khung</button>
          </div>
          <div className="muted small multilang-video-hint">Xem toàn bộ video, giữ nguyên tỉ lệ gốc; vùng đen hai bên chỉ là phần đệm xem trước.</div>
          <div className="muted small multilang-region-hint">{blurRegion && blurEnabled ? `Khung chỉ dùng để tìm chữ; nền ngoài mask chữ được giữ nguyên. Vùng: ${(blurRegion.x0 * 100).toFixed(0)}% → ${(blurRegion.x1 * 100).toFixed(0)}% ngang · ${(blurRegion.y0 * 100).toFixed(0)}% → ${(blurRegion.y1 * 100).toFixed(0)}% dọc` : 'Đang tắt che chữ cũ.'}</div>
        </section>

        <section className="card multilang-card">
          <div className="multilang-section-title">🎨 Mẫu và vùng hiển thị phụ đề</div>
          <p className="muted small">Kế thừa các mẫu của tab Đọc chữ video. Khung tím là vùng phụ đề: kéo cả khung để di chuyển, kéo mép/góc để đổi vùng và cỡ chữ.</p>
          <label className="multilang-preset-field">
            <span>Mẫu phụ đề hiển thị</span>
            <select value={subtitlePreset} onChange={(event) => applySubtitlePreset(event.target.value as SubtitlePreset)} disabled={running}>
              {SUBTITLE_PRESET_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <div className="muted small multilang-subtitle-region-hint">
            Vùng: {(subtitleRegion.x0 * 100).toFixed(0)}% → {(subtitleRegion.x1 * 100).toFixed(0)}% ngang · {(subtitleRegion.y0 * 100).toFixed(0)}% → {(subtitleRegion.y1 * 100).toFixed(0)}% dọc
          </div>
        </section>

        <section className="card multilang-card">
          <div className="multilang-section-title">🌍 Ngôn ngữ và văn phong</div>
          <div className="multilang-language-grid">
            {DICH_LANGS.map((language) => {
              const target = targets.find((item) => item.language === language.code)
              return (
                <label className="multilang-language" key={language.code}>
                  <span><input type="checkbox" checked={selectedLanguages.has(language.code)} onChange={() => toggleLanguage(language.code)} disabled={running} /> {language.label}</span>
                  {target && <>
                    <select value={target.style} onChange={(event) => setTargetStyle(language.code, event.target.value as MultiLangStyle)} disabled={running}>{STYLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                    <input className="multilang-override-input" value={target.voiceId ?? ''} onChange={(event) => setTargetVoice(language.code, 'voiceId', event.target.value)} placeholder="Voice ID tự động (ghi đè nếu cần)" disabled={running} />
                    <input className="multilang-override-input" value={target.voiceModel ?? ''} onChange={(event) => setTargetVoice(language.code, 'voiceModel', event.target.value)} placeholder="Model tự động (ghi đè nếu cần)" disabled={running} />
                  </>}
                </label>
              )
            })}
          </div>
          <div className="multilang-inline-fields">
            <label><span>Nhà cung cấp dịch / biên tập</span><select value={provider} onChange={(event) => setProvider(event.target.value as MultiLangProvider)} disabled={running}><option value="gemini">Gemini</option><option value="openai">OpenAI</option><option value="ollama">Ollama local</option></select></label>
            <label><span>Ngôn ngữ nguồn Whisper</span><select value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value)} disabled={running}><option value="auto">Tự nhận diện</option>{DICH_LANGS.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}</select></label>
          </div>
          <div className="multilang-key-row">{provider === 'gemini' ? <textarea className="multilang-key-input" value={geminiKeys} onChange={(event) => setGeminiKeys(event.target.value)} placeholder="Gemini API keys… (mỗi key một dòng)" disabled={running} /> : provider === 'ollama' ? <><input value={translationModel} onChange={(event) => setTranslationModel(event.target.value)} placeholder="Model Ollama, ví dụ qwen2.5:7b" disabled={running} /><input value={translationBaseUrl} onChange={(event) => setTranslationBaseUrl(event.target.value)} placeholder="http://127.0.0.1:11434" disabled={running} /></> : <input type="password" value={translationKey} onChange={(event) => setTranslationKey(event.target.value)} placeholder="OpenAI API key mới…" disabled={running} />}<button className="btn small-btn" type="button" onClick={saveTranslationKey} disabled={running || (provider === 'gemini' ? !geminiKeys.trim() : provider === 'openai' ? !translationKey.trim() : !translationModel.trim())}>{provider === 'ollama' ? 'Kiểm tra Ollama' : `Lưu ${provider === 'gemini' ? 'pool Gemini' : 'khóa dịch'}`}</button></div>
          <div className="muted small">{translationStatus} · {provider === 'ollama' ? 'Ollama chạy local hoặc qua IP LAN nội bộ, không dùng API quota. Có thể chọn model đã cài trong máy.' : 'Với Gemini, dán nhiều key mỗi dòng; khi gặp quota/429 hệ thống tự chuyển key.'} Timestamp SRT được giữ nguyên; nội dung được viết lại theo locale.</div>
        </section>

        <section className="card multilang-card">
          <div className="multilang-section-title">🔊 ElevenLabs TTS</div>
          <div className="multilang-inline-fields"><label><span>Chọn Voice/model</span><select value={voiceMode} onChange={(event) => setVoiceMode(event.target.value as MultiLangVoiceMode)} disabled={running}><option value="auto">Tự động theo ngôn ngữ + văn phong</option><option value="manual">Dùng cấu hình thủ công</option></select></label><label><span>Voice ID chung (tuỳ chọn)</span><input value={voiceId} onChange={(event) => setVoiceId(event.target.value)} placeholder={voiceMode === 'auto' ? 'Để trống để tự chọn' : 'Ví dụ: 21m00Tcm4TlvDq8ikWAM'} disabled={running} /></label></div>
          <div className="multilang-inline-fields"><label><span>Model chung (tuỳ chọn)</span><input value={voiceModel} onChange={(event) => setVoiceModel(event.target.value)} placeholder="eleven_multilingual_v2" disabled={running} /></label><label><span>API key pool</span><span className="muted small">Dùng nhiều key, mỗi dòng một key</span></label></div>
          <div className="multilang-key-row"><textarea className="multilang-key-input" value={elevenKey} onChange={(event) => setElevenKey(event.target.value)} placeholder="ElevenLabs API keys… (mỗi key một dòng)" disabled={running} /><button className="btn small-btn" type="button" onClick={saveElevenKey} disabled={running || !elevenKey.trim()}>Lưu pool</button><button className="btn small-btn" type="button" onClick={checkElevenKey} disabled={running}>Kiểm tra</button></div>
          <div className="muted small">{elevenKeyStatus || 'Key được giữ trong main process bằng lưu trữ an toàn. Để trống Voice ID/model để tự chọn theo locale và văn phong; có thể ghi đè ngay trong từng ô ngôn ngữ.'}</div>
        </section>

        <section className="card multilang-card">
          <div className="multilang-section-title">⚡ Tốc độ xử lý</div>
          <label className="gk-check"><input type="checkbox" checked={preferGpu} onChange={(event) => setPreferGpu(event.target.checked)} disabled={running} /><span>Ưu tiên GPU cho Whisper và mã hóa FFmpeg</span></label>
          <div className="multilang-hardware muted small">{gpu?.hasNvidia ? `${gpu.name ?? 'NVIDIA GPU'} · CUDA ${gpu.cudaVersion ?? '?'} · Whisper CUDA ${cudaReady ? 'sẵn sàng' : 'chưa có gói'}` : 'Không phát hiện NVIDIA; pipeline sẽ dùng CPU hoặc encoder phần cứng khác nếu FFmpeg hỗ trợ.'}</div>
          <div className="multilang-inline-fields"><label><span>Model Whisper</span><select value={whisperModel} onChange={(event) => setWhisperModel(event.target.value)} disabled={running}><option value="large-v3-turbo">large-v3-turbo · đầy đủ</option><option value="medium">medium</option><option value="small">small · nhanh</option><option value="base">base · nhanh nhất</option></select></label><label><span>Âm lượng tiếng gốc: {originalVolume}%</span><input type="range" min="0" max="100" value={originalVolume} onChange={(event) => setOriginalVolume(Number(event.target.value))} disabled={running} /></label></div>
          <label className="gk-check"><input type="checkbox" checked={sceneSplit} onChange={(event) => setSceneSplit(event.target.checked)} disabled={running} /><span>Dùng Content Scene Splitter hiện tại để lập scene map (chậm hơn)</span></label>
          <label className="gk-check"><input type="checkbox" checked={variantShuffle} onChange={(event) => setVariantShuffle(event.target.checked)} disabled={running} /><span>Tạo variant theo locale bằng cách xoay thứ tự scene (chậm hơn)</span></label>
          <p className="muted small">Mặc định tắt để tạo video nhanh và giữ nguyên timeline nguồn. Chỉ bật khi cần scene map hoặc variant shuffle.</p>
        </section>

        <section className="card multilang-card">
          <div className="multilang-section-title">📁 Đầu ra</div>
          <div className="auto-short-folder-row"><input className="folder-input" value={outputDir} readOnly placeholder="Chọn thư mục lưu…" /><button className="btn small-btn" type="button" onClick={chooseOutput} disabled={running}>Duyệt</button></div>
          <p className="muted small">Sẽ tạo {totalOutputs || 'N × N'} gói ngôn ngữ, mỗi gói gồm SRT, thư mục voice và MP4.</p>
          <div className="multilang-run-actions"><button className="btn primary" type="button" onClick={run} disabled={!canRun}>{running ? 'Đang chạy pipeline…' : '🚀 Chạy pipeline đa ngôn ngữ'}</button>{running && <button className="btn danger" type="button" onClick={cancel} disabled={cancelling}>{cancelling ? 'Đang dừng…' : '■ Dừng'}</button>}</div>
        </section>
      </div>

      <div className="cot-ketqua multilang-results">
        <div className="cot-tieude">Tiến trình &amp; language packages</div>
        {(running || progress) && <div className={`card multilang-progress ${progress?.phase ?? ''}`}><div className="multilang-progress-head"><strong>{progress?.phase === 'done' ? '✓ Hoàn tất' : progress?.phase === 'error' ? 'Lỗi' : progress?.phase === 'cancelled' ? 'Đã dừng' : 'Đang xử lý'}</strong><span>{progress?.percent ?? 0}%</span></div><div className="bar"><div className="bar-fill" style={{ width: `${progress?.percent ?? 0}%` }} /></div><p className="muted small">{progress?.message}</p><p className="muted small">{progress?.completedOutputs ?? 0}/{progress?.totalOutputs ?? totalOutputs} output · {progress?.gpuMode === 'cuda' ? 'Whisper CUDA' : progress?.gpuMode === 'encoder-gpu' ? 'FFmpeg hardware encoder ưu tiên' : 'CPU fallback'}</p></div>}
        {error && <div className="error-box"><b>Lỗi:</b> {error}</div>}
        {result?.outputs.length ? <div className="card multilang-result-card"><div className="multilang-result-head"><div><strong>📦 Đã tạo {result.outputs.filter((output) => output.videoPath).length}/{result.outputs.length} video</strong><span className="muted small">{result.runDir}</span></div><button className="btn small-btn" type="button" onClick={() => result.runDir && window.api.openPath(result.runDir)}>Mở thư mục run</button></div><div className="multilang-table-wrap"><table className="multilang-table"><thead><tr><th>Nguồn</th><th>Locale</th><th>SRT</th><th>Voice</th><th>MP4</th></tr></thead><tbody>{result.outputs.map((output) => <tr key={`${output.sourceVideo}-${output.locale}`}><td title={output.sourceVideo}>{fileName(output.sourceVideo)}</td><td>{output.locale}</td><td><button className="multilang-link" type="button" onClick={() => window.api.showItem(output.srtPath)}>Mở</button></td><td><button className="multilang-link" type="button" onClick={() => window.api.openPath(output.voiceDir)}>Mở</button></td><td>{output.videoPath ? <button className="multilang-link" type="button" onClick={() => window.api.showItem(output.videoPath!)}>Mở MP4</button> : <span className="muted">—</span>}</td></tr>)}</tbody></table></div>{result.scenesManifest && <div className="muted small multilang-manifest">Scene map: <button className="multilang-link" type="button" onClick={() => window.api.showItem(result.scenesManifest!)}>{fileName(result.scenesManifest)}</button></div>}</div> : !running && !error ? <div className="empty multilang-empty"><div className="empty-title">Chưa có kết quả</div><div className="muted small">Chọn nguồn, ngôn ngữ, key rồi chạy pipeline.</div></div> : null}
      </div>
    </div>
  )
}

export const multiLangShortRendererFeature = {
  ...FEATURE_META,
  component: MultiLangPanel
} as const satisfies RendererFeature<typeof FEATURE_ID>
