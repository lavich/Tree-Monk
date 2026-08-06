import { useTranslation } from 'react-i18next'
import { Info, Plus, TreeDeciduous } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { markFsArrivedNoticeSeen } from '@/lib/fsMode'

/**
 * One-time notice for users upgrading with an EXISTING, non-FamilySearch tree:
 * the FamilySearch integration has arrived, but the two modes are strictly
 * separated, so an existing manual/GEDCOM tree cannot be switched over — they
 * need to create a NEW family tree from the switcher in the top-left corner.
 *
 * Purely informational: it changes no mode and never touches the current tree.
 */
export function ReimportNoticeDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}): JSX.Element {
  const { t } = useTranslation()
  const close = (): void => {
    markFsArrivedNoticeSeen()
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <TreeDeciduous className="h-5 w-5 shrink-0 text-emerald-600" />
            {t('reimport.title')}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm leading-relaxed text-muted-foreground">{t('reimport.intro')}</p>

        {/* The concrete instruction, pointing at the real control (top-left). */}
        <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm leading-relaxed text-emerald-800 dark:text-emerald-300">
          <Plus className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('reimport.howTo')}</span>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t('reimport.keepSafe')}</span>
        </div>

        <div className="flex justify-end">
          <Button onClick={close}>{t('reimport.ok')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
