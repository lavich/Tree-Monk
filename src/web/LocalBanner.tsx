import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, HardDrive, X } from 'lucide-react'

/**
 * Small dismissible pill for the LOCAL web build: reminds the user that all
 * data lives only in this browser (no cloud, no account) and offers a one-click
 * backup download.
 */
export function LocalBanner(): JSX.Element | null {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  if (!open) return null
  return (
    <div className="pointer-events-none fixed bottom-3 left-1/2 z-[200] -translate-x-1/2 max-w-[95vw]">
      <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-border bg-popover/95 px-3.5 py-1.5 text-xs shadow-2xl backdrop-blur">
        <HardDrive className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="font-medium text-foreground">{t('webLocal.bannerLabel')}</span>
        <span className="hidden text-muted-foreground sm:inline">{t('webLocal.bannerNote')}</span>
        <button
          onClick={() => void window.api.backup.create()}
          className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
        >
          <Download className="h-3 w-3" />
          {t('webLocal.backup')}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          title={t('webLocal.hide')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
