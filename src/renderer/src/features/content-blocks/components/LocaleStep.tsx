import type { JSX } from 'react'
import type { LocaleAssetImportResult } from '../../../../../shared/features/content-blocks.ts'
import type { ImportedLocaleView } from '../model.ts'

type LocaleField = 'locale' | 'localizedSrtPath' | 'voiceDir' | 'voiceMapPath'
type LocalePathField = Exclude<LocaleField, 'locale'>

export interface LocaleStepProps {
  locale: string
  localizedSrtPath: string
  voiceDir: string
  voiceMapPath: string
  importedLocales: ImportedLocaleView[]
  selectedLocaleManifestPath: string
  result: LocaleAssetImportResult | null
  running: boolean
  canImport: boolean
  onChange(field: LocaleField, value: string): void
  onPick(field: LocalePathField): void
  onSelectLocale(manifestPath: string): void
  onImport(): void
}

function pathRow(
  label: string,
  value: string,
  field: LocalePathField,
  onChange: LocaleStepProps['onChange'],
  onPick: LocaleStepProps['onPick'],
  running: boolean
): JSX.Element {
  return (
    <label className="content-blocks-field">
      <span>{label}</span>
      <div className="content-blocks-path-row">
        <input value={value} disabled={running} onChange={(event) => onChange(field, event.target.value)} />
        <button className="btn" type="button" disabled={running} onClick={() => onPick(field)}>Chọn</button>
      </div>
    </label>
  )
}

function issueList(result: LocaleAssetImportResult | null): JSX.Element | null {
  if (!result) return null
  if (result.ok) return <div className="content-blocks-result ok-text">Đã nhập đủ voice theo cue ID.</div>
  return (
    <div className="content-blocks-result error-text">
      <strong>Locale chưa hợp lệ</strong>
      {result.missingCueIds.length > 0 && <span>Thiếu cue: {result.missingCueIds.join(', ')}</span>}
      {result.invalidCueIds.length > 0 && <span>Voice lỗi: {result.invalidCueIds.join(', ')}</span>}
      {result.extraFiles.length > 0 && <span>File dư: {result.extraFiles.join(', ')}</span>}
      {result.error && <span>{result.error}</span>}
    </div>
  )
}

export default function LocaleStep(props: LocaleStepProps): JSX.Element {
  return (
    <section className="card content-blocks-card">
      <div className="content-blocks-section-head">
        <div>
          <strong>3. Nhập voice theo locale</strong>
          <span className="muted small">Cue ID là khóa ổn định; thứ tự file trong thư mục không có ý nghĩa.</span>
        </div>
        <button className="btn primary" type="button" disabled={!props.canImport} onClick={props.onImport}>Nhập locale</button>
      </div>
      <div className="content-blocks-locale-grid">
        <label className="content-blocks-field">
          <span>Locale BCP-47</span>
          <input value={props.locale} disabled={props.running} placeholder="vi-VN" onChange={(event) => props.onChange('locale', event.target.value)} />
        </label>
        {pathRow('SRT đã dịch', props.localizedSrtPath, 'localizedSrtPath', props.onChange, props.onPick, props.running)}
        {pathRow('Thư mục voice', props.voiceDir, 'voiceDir', props.onChange, props.onPick, props.running)}
        {pathRow('Voice map (tùy chọn)', props.voiceMapPath, 'voiceMapPath', props.onChange, props.onPick, props.running)}
      </div>
      {issueList(props.result)}
      <div className="content-blocks-imported-locales">
        <div className="content-blocks-subhead">Locale đã nhập</div>
        {props.importedLocales.length === 0 ? (
          <p className="muted">Chưa có locale nào. Có thể nhập nhiều locale và chọn lại ở đây.</p>
        ) : (
          <div className="content-blocks-locale-list">
            {props.importedLocales.map((item) => (
              <button
                className={`content-blocks-locale-item ${item.manifestPath === props.selectedLocaleManifestPath ? 'selected' : ''}`}
                type="button"
                key={item.locale}
                disabled={props.running}
                onClick={() => props.onSelectLocale(item.manifestPath)}
              >
                <strong>{item.locale}</strong>
                <span>{item.manifestPath}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
