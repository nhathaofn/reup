import { useState, type JSX } from 'react'
import {
  validateLocaleTargetInput,
  type LocalizedTarget,
  type SrtLocaleTargetInput
} from '../../../../../shared/features/srt-translator.ts'

export interface TargetStepProps {
  presets: readonly LocalizedTarget[]
  selected: SrtLocaleTargetInput[]
  disabled: boolean
  onChange(targets: SrtLocaleTargetInput[]): void
  onTranslate(): void
  /** Smart subtitle embeds only the target picker; its outer pipeline owns the action. */
  showAction?: boolean
}

function inputFromPreset(preset: LocalizedTarget): SrtLocaleTargetInput {
  const { id, languageLabel, locale, regionLabel, currencyCode } = preset.profile
  return { id, languageLabel, locale, regionLabel, currencyCode }
}

export default function TargetStep({ presets, selected, disabled, onChange, onTranslate, showAction = true }: TargetStepProps): JSX.Element {
  const [customLanguageLabel, setCustomLanguageLabel] = useState('')
  const [customLocale, setCustomLocale] = useState('')
  const [customRegionLabel, setCustomRegionLabel] = useState('')
  const [customCurrency, setCustomCurrency] = useState('')
  const [customError, setCustomError] = useState('')

  function togglePreset(preset: LocalizedTarget): void {
    if (disabled) return
    const target = inputFromPreset(preset)
    const exists = selected.some((item) => item.id === target.id)
    onChange(exists ? selected.filter((item) => item.id !== target.id) : [...selected, target])
    setCustomError('')
  }

  function addCustomTarget(): void {
    const id = `${customLocale.trim().toLowerCase()}-${customCurrency.trim().toLowerCase()}`
    const checked = validateLocaleTargetInput({ id, languageLabel: customLanguageLabel, locale: customLocale, regionLabel: customRegionLabel, currencyCode: customCurrency })
    if (!checked.ok) {
      setCustomError(checked.error)
      return
    }
    onChange([...selected.filter((item) => item.id !== checked.value.id), checked.value])
    setCustomError('')
  }

  return (
    <section className="srt-translator-step-content">
      <div className="card srt-translator-card">
        <div className="srt-translator-card-head">
          <div><strong>Chọn ngôn ngữ đích</strong><span className="muted small">Văn phong, tiền tệ, tên loài và đơn vị sẽ theo locale/khu vực.</span></div>
          <span className="muted small">Đã chọn: {selected.length}</span>
        </div>
        <div className="srt-translator-locale-grid">
          {presets.map((preset) => {
            const target = inputFromPreset(preset)
            const active = selected.some((item) => item.id === target.id)
            return (
              <button className={`srt-translator-locale-card ${active ? 'selected' : ''}`} type="button" key={preset.id} onClick={() => togglePreset(preset)} disabled={disabled}>
                <strong>{target.languageLabel}</strong>
                <span>{target.regionLabel} · {target.locale}</span>
                <small>{target.currencyCode} · {preset.profile.unitSystem === 'metric' ? 'Hệ mét' : 'US customary'}</small>
              </button>
            )
          })}
        </div>
        <div className="srt-translator-target-list">
          {selected.map((target) => (
            <span className="srt-translator-target-chip" key={target.id}>
              {target.languageLabel} · {target.currencyCode}
              <button type="button" aria-label={`Xóa ${target.languageLabel}`} onClick={() => onChange(selected.filter((item) => item.id !== target.id))} disabled={disabled}>×</button>
            </span>
          ))}
        </div>
      </div>
      <div className="card srt-translator-card">
        <strong>Thêm locale tùy chỉnh</strong>
        <div className="srt-translator-custom-locale-grid">
          <input value={customLanguageLabel} onChange={(event) => setCustomLanguageLabel(event.target.value)} placeholder="Tên ngôn ngữ" disabled={disabled} />
          <input value={customLocale} onChange={(event) => setCustomLocale(event.target.value)} placeholder="BCP-47, ví dụ fr-FR" disabled={disabled} />
          <input value={customRegionLabel} onChange={(event) => setCustomRegionLabel(event.target.value)} placeholder="Khu vực" disabled={disabled} />
          <input value={customCurrency} onChange={(event) => setCustomCurrency(event.target.value)} placeholder="ISO 4217, ví dụ EUR" maxLength={3} disabled={disabled} />
          <button className="btn" type="button" onClick={addCustomTarget} disabled={disabled}>Thêm locale</button>
        </div>
        {customError && <div className="srt-translator-message error">{customError}</div>}
      </div>
      {showAction && (
        <div className="srt-translator-actions">
          <button className="btn primary" type="button" onClick={onTranslate} disabled={disabled || selected.length === 0}>Bắt đầu bản địa hóa</button>
        </div>
      )}
    </section>
  )
}
