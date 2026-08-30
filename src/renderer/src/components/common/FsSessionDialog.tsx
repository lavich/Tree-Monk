import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CloudOff, Loader2, LogIn } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/**
 * Pops up at startup (and from the topbar badge) when the FamilySearch session
 * has expired in an FS-mode tree: the 24h token lapsed, so sync/import would
 * fail with "not signed in". One click re-runs the browser sign-in; "Not now"
 * leaves the amber topbar badge as the reminder.
 */
export function FsSessionDialog({
  open,
  onOpenChange,
  onSignedIn
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSignedIn: () => void
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const [busy, setBusy] = useState(false)

  const signIn = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.api.familysearch.login(i18n.language)
      if (r.ok) {
        toast.success(t('fs.loginOk'))
        onSignedIn()
        onOpenChange(false)
      } else if (r.error !== 'CANCELLED') {
        toast.error(t('fs.loginFailed'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudOff className="h-5 w-5 text-amber-500" />
            {t('fs.sessionModalTitle')}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('fs.sessionModalBody')}</p>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('welcome.later')}
          </Button>
          <Button onClick={() => void signIn()} disabled={busy} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            {t('fs.signInNow')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
