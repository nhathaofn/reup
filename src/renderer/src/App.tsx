import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import SetupScreen from './components/SetupScreen'
import Downloader from './components/Downloader'
import Douyin from './components/Douyin'
import AudioText from './components/AudioText'
import ScreenText from './components/ScreenText'
import VideoEnhance from './components/VideoEnhance'
import License from './components/License'
import Logs from './components/Logs'
import type { UpdateStatus } from '../../shared/types'
import {
  rendererFeatures,
  type RendererFeatureId
} from './features/registry'
import type { RendererFeature } from './features/contracts'

type Stage = 'checking' | 'setup' | 'ready'
type CoreTabKey = 'download' | 'douyin' | 'audiotext' | 'screen' | 'enhance' | 'logs' | 'license'
type TabKey = CoreTabKey | RendererFeatureId

interface Tab {
  key: TabKey
  label: string
  icon: string
  title: string
  subtitle: string
}

// Tab tinh nang chinh (o tren). Them tinh nang moi = them 1 entry vao day.
const TABS: Tab[] = [
  {
    key: 'download',
    label: 'Tải xuống',
    icon: '⬇',
    title: 'Tải xuống',
    subtitle: 'Video & âm thanh đa nền tảng'
  },
  {
    key: 'douyin',
    label: 'Douyin',
    icon: '🎬',
    title: 'Tải Douyin',
    subtitle: 'Video & kênh Douyin (không watermark)'
  },
  {
    key: 'audiotext',
    label: 'Phụ đề',
    icon: '📝',
    title: 'Tạo phụ đề',
    subtitle: 'Chuyển lời nói trong video thành phụ đề'
  },
  {
    key: 'screen',
    label: 'Đọc chữ video',
    icon: '🔍',
    title: 'Đọc chữ trong video',
    // Anh em voi tab Phu de: mot ben tu TIENG, mot ben tu HINH.
    // Danh cho video chi co chu chay, khong co tieng -> tab Phu de bo tay.
    subtitle: 'Nhận diện chữ xuất hiện trong video và tạo phụ đề'
  },
  {
    key: 'enhance',
    label: 'Nâng cấp video',
    icon: '✨',
    title: 'Nâng cấp video',
    subtitle: 'Làm video rõ nét hoặc mượt hơn'
  }
]

// Muc phu o day sidebar
const BOTTOM_TABS: Tab[] = [
  {
    key: 'logs',
    label: 'Hỗ trợ',
    icon: '🛟',
    title: 'Hỗ trợ & chẩn đoán',
    subtitle: 'Thông tin giúp kiểm tra khi ứng dụng gặp lỗi'
  },
  {
    key: 'license',
    label: 'Giấy phép',
    icon: '📜',
    title: 'Giấy phép & Điều khoản',
    subtitle: 'Bản quyền và trách nhiệm sử dụng'
  }
]

const FEATURE_TABS: Tab[] = rendererFeatures.map((feature) => ({
  key: feature.id as RendererFeatureId,
  label: feature.label,
  icon: feature.icon,
  title: feature.title,
  subtitle: feature.subtitle
}))
const TOP_TABS = [...TABS, ...FEATURE_TABS.filter((tab) => {
  const feature = rendererFeatures.find((item) => item.id === tab.key)
  return feature?.placement !== 'bottom'
})]
const ALL_BOTTOM_TABS = [...BOTTOM_TABS, ...FEATURE_TABS.filter((tab) => {
  const feature = rendererFeatures.find((item) => item.id === tab.key)
  return feature?.placement === 'bottom'
})]

export default function App(): JSX.Element {
  const [stage, setStage] = useState<Stage>('checking')
  // KHONG nho tab cuoi — moi lan mo app deu ve tab mac dinh (Tai xuong).
  // Chi nho cau hinh user setup cho tung tab (qua usePersistedState trong moi component).
  const [tab, setTab] = useState<TabKey>('download')
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  // "Hop thu" gui file tu tab Tai xuong sang tab Audio->Text (nut "Lay sub")
  const [subInbox, setSubInbox] = useState<{ path: string; id: string } | null>(null)
  const sendToSub = (filePath: string): void => {
    setSubInbox({ path: filePath, id: crypto.randomUUID() })
    setTab('audiotext')
  }

  const check = async (): Promise<void> => {
    setStage('checking')
    const status = await window.api.checkDeps()
    setStage(status.ytdlp && status.ffmpeg ? 'ready' : 'setup')
  }

  useEffect(() => {
    void check()
    void window.api.appVersion().then(setVersion)
    const offUpd = window.api.onUpdateStatus(setUpdate)
    return offUpd
  }, [])

  if (stage === 'checking') {
    return (
      <div className="boot">
        <div className="center">
          <div className="spinner" />
          <p>Đang chuẩn bị T-blao…</p>
        </div>
      </div>
    )
  }

  if (stage === 'setup') {
    return (
      <div className="boot">
        <SetupScreen onDone={() => setStage('ready')} />
      </div>
    )
  }

  const active = [...TOP_TABS, ...ALL_BOTTOM_TABS].find((t) => t.key === tab) ?? TABS[0]
  const journeyTone =
    tab === 'download' || tab === 'douyin'
      ? 'ingest'
      : tab === 'audiotext' || tab === 'screen' || tab === 'enhance'
        ? 'render'
        : 'neutral'

  const renderTab = (t: Tab): JSX.Element => (
    <button
      key={t.key}
      className={`side-item ${t.key === tab ? 'active' : ''}`}
      onClick={() => setTab(t.key)}
    >
      <span className="side-ico">{t.icon}</span>
      <span>{t.label}</span>
    </button>
  )

  const renderFeaturePane = (feature: RendererFeature): JSX.Element | null => {
    const FeatureComponent = feature.component
    if (feature.keepAlive) {
      return (
        <div key={feature.id} className={`tab-pane ${tab === feature.id ? '' : 'hidden'}`}>
          <FeatureComponent />
        </div>
      )
    }
    return tab === feature.id ? <FeatureComponent key={feature.id} /> : null
  }

  return (
    <div className={`shell journey-${journeyTone}`}>
      <aside className="sidebar">
        <div className="side-brand">
          <span className="side-logo">T-blao</span>
        </div>
        <nav className="side-nav">{TOP_TABS.map(renderTab)}</nav>
        <div className="side-hint muted small">Công cụ video gọn trong một nơi</div>

        <div className="side-bottom">
          {ALL_BOTTOM_TABS.map(renderTab)}

          <details className="side-about">
            <summary>Thông tin ứng dụng</summary>
            <div className="side-version">Phiên bản {version || '…'}</div>
          </details>

          {update?.state === 'downloaded' && (
            <button
              className="side-update ready"
              onClick={() => window.api.installAppUpdate()}
              title="Khởi động lại để cài bản mới"
            >
              🎉 Có bản mới {update.version} — Cập nhật ngay
            </button>
          )}
          {update?.state === 'downloading' && (
            <div className="side-update">Đang tải bản mới… {update.percent ?? 0}%</div>
          )}
          {update?.state === 'available' && (
            <div className="side-update">Đã có bản {update.version}, đang tải…</div>
          )}
        </div>
      </aside>

      <main className="content">
        <header className="content-head">
          <div>
            <h1 className="content-title">{active.title}</h1>
            <p className="content-sub muted">{active.subtitle}</p>
          </div>
        </header>
        <div className="content-body">
          {/* Giu 2 tab tai luon SONG (khong unmount) de chay song song, khong mat hang doi/tien do */}
          <div className={`tab-pane ${tab === 'download' ? '' : 'hidden'}`}>
            <Downloader onGetSub={sendToSub} />
          </div>
          <div className={`tab-pane ${tab === 'douyin' ? '' : 'hidden'}`}>
            <Douyin />
          </div>
          <div className={`tab-pane ${tab === 'audiotext' ? '' : 'hidden'}`}>
            <AudioText subInbox={subInbox} />
          </div>
          {/* GIU SONG (khong unmount): user chon video + keo khung xong ma qua
              tab khac mot cai la mat sach, phai lam lai tu dau. Nho toi khi tat
              app — dung y user chot. */}
          <div className={`tab-pane ${tab === 'screen' ? '' : 'hidden'}`}>
            <ScreenText />
          </div>
          <div className={`tab-pane ${tab === 'enhance' ? '' : 'hidden'}`}>
            <VideoEnhance />
          </div>
          {tab === 'logs' && <Logs />}
          {tab === 'license' && <License />}
          {rendererFeatures.map(renderFeaturePane)}
        </div>
      </main>

    </div>
  )
}
