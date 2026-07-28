import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import i18n from 'i18next'
import { toast } from 'sonner'
import App from '@/App'
import '@/i18n'
import '@/index.css'
import '@xyflow/react/dist/style.css'
import { useTheme, type Theme } from '@/store/useTheme'
import { initSettings } from '@/store/useSettings'
import { initLocalDb } from './connection'
import { createLocalApi, setReadOnlyHandler } from './api-browser'
import { rebuildMediaRegistry } from './media-web'
import { LocalBanner } from './LocalBanner'
import { LocalIntroModal } from './LocalIntroModal'

// The LOCAL web build: the full TreeMonk app running entirely in the browser.
// The database and every media file live in the browser's own storage
// (OPFS/IndexedDB) — nothing is uploaded, there is no account and no server.

function initWebTheme(): void {
  const stored = localStorage.getItem('treemonk.theme') as Theme | null
  useTheme.getState().setTheme(stored === 'dark' || stored === 'light' ? stored : 'light')
}

// Flags the build as the browser app (mediaUrl registry, no Electron shell).
// NOT the read-only demo flag — editing stays fully enabled.
;(window as unknown as { __TREEMONK_WEB__?: boolean }).__TREEMONK_WEB__ = true

function Root({ firstRun }: { firstRun: boolean }): JSX.Element {
  const [intro, setIntro] = useState(firstRun)
  return (
    <>
      <App />
      <LocalBanner />
      {intro && <LocalIntroModal onDone={() => setIntro(false)} />}
    </>
  )
}

async function boot(): Promise<void> {
  // Restore (or create) the browser-stored database, then expose the writable
  // browser API as window.api exactly like the Electron preload does.
  const hadExisting = await initLocalDb()
  window.api = createLocalApi()
  // Desktop-only features (FamilySearch, plugins, image/PDF export) surface a
  // friendly toast instead of failing silently.
  setReadOnlyHandler(() => toast(i18n.t('webLocal.desktopOnlyToast'), { id: 'web-desktop-only' }))
  await rebuildMediaRegistry()

  initWebTheme()
  initSettings()

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <Root firstRun={!hadExisting} />
    </React.StrictMode>
  )
}

void boot()
