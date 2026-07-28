import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, HardDrive, Loader2, ShieldCheck, TreePine } from 'lucide-react'
import { replaceLocalDb } from './connection'
import sampleDbUrl from '../../resources/demo.sqlite?url'

/**
 * First-run welcome for the LOCAL web build. Explains the privacy model —
 * everything stays in THIS browser, nothing is uploaded, no account — and the
 * backup responsibility that comes with it, then lets the user start with an
 * empty tree or load the fictional sample family.
 */
export function LocalIntroModal({ onDone }: { onDone: () => void }): JSX.Element {
  const { t } = useTranslation()
  const [loadingSample, setLoadingSample] = useState(false)

  const points = [
    { icon: ShieldCheck, text: t('webLocal.introPrivacy') },
    { icon: Download, text: t('webLocal.introBackup') },
    { icon: HardDrive, text: t('webLocal.introDesktop') }
  ]

  const loadSample = async (): Promise<void> => {
    setLoadingSample(true)
    try {
      const bytes = new Uint8Array(await (await fetch(sampleDbUrl)).arrayBuffer())
      await replaceLocalDb(bytes)
      location.reload()
    } catch {
      setLoadingSample(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <TreePine className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t('webLocal.introTitle')}</h2>
            <p className="text-xs text-muted-foreground">{t('webLocal.introSubtitle')}</p>
          </div>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">{t('webLocal.introBody')}</p>

        <ul className="mb-5 space-y-2.5">
          {points.map((p, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <p.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="text-foreground">{p.text}</span>
            </li>
          ))}
        </ul>

        <div className="space-y-2">
          <button
            onClick={onDone}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t('webLocal.startEmpty')}
          </button>
          <button
            onClick={() => void loadSample()}
            disabled={loadingSample}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
          >
            {loadingSample && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('webLocal.loadSample')}
          </button>
        </div>
      </div>
    </div>
  )
}
