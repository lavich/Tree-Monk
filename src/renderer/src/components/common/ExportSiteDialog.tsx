import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Globe, ListOrdered, Loader2, Users } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScopePicker, useScopedPeople } from '@/components/common/ScopePicker'
import type { DashboardScope } from '@/lib/dashboardScope'

/**
 * Website / index export, with the circle of people to include.
 *
 * Both exports used to take the ENTIRE tree, which is rarely what someone wants
 * to hand out — a published page usually covers one bloodline, not every
 * married-in relative ever entered. The scope is chosen HERE rather than
 * inherited from the dashboard: an export is a one-off act with a lasting
 * result, and it must be obvious at the moment of export who ends up in it.
 */
export function ExportSiteDialog({
  open,
  onOpenChange,
  mode
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** `site` = the full browsable website, `index` = name + place indexes. */
  mode: 'site' | 'index'
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const [scope, setScope] = useState<DashboardScope>('all')
  const [busy, setBusy] = useState(false)
  const scoped = useScopedPeople(scope)

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      // 'all' passes nothing, so the export keeps its whole-tree behaviour and
      // never depends on a root person being set.
      const ids = scope === 'all' ? undefined : scoped.people.map((p) => p.id)
      const res =
        mode === 'site'
          ? await window.api.site.export(i18n.language, ids)
          : await window.api.site.exportIndexes(i18n.language, ids)
      if (res) {
        toast.success(t('settings.siteExportDone', { path: res.path }))
        onOpenChange(false)
      }
    } finally {
      setBusy(false)
    }
  }

  const Icon = mode === 'site' ? Globe : ListOrdered
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <Icon className="h-5 w-5 shrink-0 text-primary" />
            {t(mode === 'site' ? 'settings.siteExport' : 'settings.indexExport')}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm leading-relaxed text-muted-foreground">
          {t(mode === 'site' ? 'settings.siteExportDesc' : 'settings.indexExportDesc')}
        </p>

        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('gedcom.exportScope')}
          </p>
          <ScopePicker value={scope} onChange={setScope} disabled={busy} className="flex-wrap" />
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {t('people.results', { count: scope === 'all' ? scoped.total : scoped.people.length })}
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => void run()} disabled={busy} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
            {t(mode === 'site' ? 'settings.siteExportBtn' : 'settings.indexExportBtn')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
