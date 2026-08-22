import { useMemo, useState, type JSX, type KeyboardEvent } from 'react'
import {
  type LocalizedTarget,
  type SrtLocaleTargetInput
} from '../../../../../shared/features/srt-translator.ts'
import {
  SRT_COUNTRY_TARGETS,
  searchCountryTargets,
  toLocaleTargetInput,
  type CountryTargetOption
} from '../../../../../shared/locale-catalog.ts'

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
  const [countryQuery, setCountryQuery] = useState('')
  const [countryPickerOpen, setCountryPickerOpen] = useState(false)
  const [activeCountryIndex, setActiveCountryIndex] = useState(0)

  const selectedIds = useMemo(() => new Set(selected.map((target) => target.id)), [selected])
  const countryResults = useMemo(
    () => searchCountryTargets(countryQuery).filter((option) => !selectedIds.has(option.id)),
    [countryQuery, selectedIds]
  )

  function selectCountry(option: CountryTargetOption): void {
    if (disabled || selectedIds.has(option.id)) return
    onChange([...selected, toLocaleTargetInput(option)])
    setCountryQuery('')
    setCountryPickerOpen(false)
    setActiveCountryIndex(0)
  }

  function togglePreset(preset: LocalizedTarget): void {
    if (disabled) return
    const target = inputFromPreset(preset)
    const exists = selected.some((item) => item.id === target.id)
    onChange(exists ? selected.filter((item) => item.id !== target.id) : [...selected, target])
  }

  function handleCountryQueryKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCountryPickerOpen(true)
      setActiveCountryIndex((index) => Math.min(index + 1, Math.max(countryResults.length - 1, 0)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCountryPickerOpen(true)
      setActiveCountryIndex((index) => Math.max(index - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const active = countryResults[activeCountryIndex]
      if (active) selectCountry(active)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setCountryPickerOpen(false)
    }
  }

  return (
    <section className="srt-translator-step-content">
      <div className="card srt-translator-card">
        <div className="srt-translator-card-head">
          <div><strong>Chọn quốc gia đích</strong><span className="muted small">Ứng dụng sẽ tự thiết lập ngôn ngữ, tiền tệ và đơn vị đo theo quốc gia bạn chọn.</span></div>
          <span className="muted small">Đã chọn: {selected.length}</span>
        </div>
        <label className="srt-translator-country-search">
          <span className="muted small">Tìm quốc gia</span>
          <input
            value={countryQuery}
            onChange={(event) => {
              setCountryQuery(event.target.value)
              setCountryPickerOpen(true)
              setActiveCountryIndex(0)
            }}
            onFocus={() => setCountryPickerOpen(Boolean(countryQuery.trim()))}
            onBlur={() => setCountryPickerOpen(false)}
            onKeyDown={handleCountryQueryKeyDown}
            placeholder="Nhập tên nước, ví dụ Pháp hoặc France"
            role="combobox"
            aria-label="Tìm quốc gia đích"
            aria-autocomplete="list"
            aria-expanded={countryPickerOpen && Boolean(countryQuery.trim())}
            aria-controls="srt-translator-country-options"
            aria-activedescendant={countryPickerOpen && countryResults[activeCountryIndex] ? `srt-country-option-${countryResults[activeCountryIndex].id}` : undefined}
            disabled={disabled}
          />
        </label>
        {countryPickerOpen && countryQuery.trim() && (
          <div id="srt-translator-country-options" className="srt-translator-country-results" role="listbox" aria-label="Kết quả quốc gia">
            {countryResults.length > 0 ? countryResults.map((option, index) => (
              <button
                className={`srt-translator-country-option ${index === activeCountryIndex ? 'active' : ''}`}
                type="button"
                role="option"
                aria-selected={index === activeCountryIndex}
                id={`srt-country-option-${option.id}`}
                key={option.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectCountry(option)}
                disabled={disabled}
              >
                <strong>{option.countryLabel}</strong>
                <span>{option.languageLabel}</span>
              </button>
            )) : (
              <div className="srt-translator-country-empty" role="option" aria-disabled="true">Không tìm thấy quốc gia phù hợp.</div>
            )}
          </div>
        )}
        <div className="srt-translator-country-shortcuts">
          <span className="muted small">Gợi ý nhanh</span>
          <div className="srt-translator-country-shortcut-list">
          {presets.map((preset) => {
            const target = inputFromPreset(preset)
            const active = selected.some((item) => item.id === target.id)
            return (
              <button className={`srt-translator-country-shortcut ${active ? 'selected' : ''}`} type="button" key={preset.id} onClick={() => togglePreset(preset)} disabled={disabled}>
                {target.regionLabel}
              </button>
            )
          })}
          </div>
        </div>
        <div className="srt-translator-target-list">
          {selected.length > 0 ? selected.map((target) => {
            const country = SRT_COUNTRY_TARGETS.find((option) => option.id === target.id)
            return (
              <span className="srt-translator-target-chip" key={target.id}>
                {country?.countryLabel ?? target.regionLabel} · {target.languageLabel}
                <button type="button" aria-label={`Xóa ${country?.countryLabel ?? target.languageLabel}`} onClick={() => onChange(selected.filter((item) => item.id !== target.id))} disabled={disabled}>×</button>
              </span>
            )
          }) : <span className="muted small">Chưa chọn quốc gia nào</span>}
        </div>
      </div>
      {showAction && (
        <div className="srt-translator-actions">
          <button className="btn primary" type="button" onClick={onTranslate} disabled={disabled || selected.length === 0}>Bắt đầu bản địa hóa</button>
        </div>
      )}
    </section>
  )
}
