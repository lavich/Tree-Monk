import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check, FileText, TreeDeciduous } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Two-step mode chooser shared by the first-launch dialog and the upgrade
 * notice: pick FamilySearch or Manual/GEDCOM, then CONFIRM after reading a
 * detailed, localized description of exactly what the mode means (including
 * the restrictions — the modes are strictly separated).
 *
 * The FamilySearch card is live only in builds that carry an AppKey
 * (familysearch.configured) — keyless builds keep the "coming soon" state so
 * the choice never leads to a dead end.
 */
export function ModeChooser({ onDone }: { onDone: (fs: boolean) => void }): JSX.Element {
  const { t } = useTranslation()
  const [picked, setPicked] = useState<'fs' | 'manual' | null>(null)
  const [fsAvailable, setFsAvailable] = useState(false)
  useEffect(() => {
    let alive = true
    window.api.familysearch
      .configured()
      .then((v) => {
        if (alive) setFsAvailable(!!v)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  if (picked === null) {
    // The FamilySearch integration has shipped, so there is no "coming soon"
    // state any more: with an AppKey the card is a normal choice, and a build
    // WITHOUT a key simply omits it rather than advertising something that
    // cannot be used.
    const cards = [
      ...(fsAvailable
        ? [{ key: 'fs' as const, Icon: TreeDeciduous, title: t('start.fsTitle'), desc: t('start.fsDesc'), accent: true }]
        : []),
      { key: 'manual' as const, Icon: FileText, title: t('start.manualTitle'), desc: t('start.manualDesc'), accent: false }
    ]
    return (
      <div className={cn('grid gap-3', cards.length > 1 && 'sm:grid-cols-2')}>
        {cards.map(({ key, Icon, title, desc, accent }) => (
          <button
            key={key}
            onClick={() => setPicked(key)}
            className={cn(
              'relative flex h-full min-h-[170px] flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all',
              accent
                ? 'border-emerald-500/40 bg-emerald-500/5 hover:-translate-y-0.5 hover:bg-emerald-500/10 hover:shadow-lg'
                : 'border-border bg-muted/30 hover:-translate-y-0.5 hover:bg-muted/60 hover:shadow-lg'
            )}
          >
            <span
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-lg',
                accent ? 'bg-emerald-500/15 text-emerald-600' : 'bg-primary/10 text-primary'
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold leading-tight">{title}</span>
            <span className="text-xs leading-relaxed text-muted-foreground">{desc}</span>
          </button>
        ))}
      </div>
    )
  }

  const fs = picked === 'fs'
  const points = fs
    ? [t('start.fsP1'), t('start.fsP2'), t('start.fsP3'), t('start.fsP4')]
    : [t('start.mP1'), t('start.mP2'), t('start.mP3'), t('start.mP4')]
  return (
    <div className="space-y-4">
      <div
        className={cn(
          'flex items-center gap-3 rounded-xl border p-3',
          fs ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border bg-muted/30'
        )}
      >
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
            fs ? 'bg-emerald-500/15 text-emerald-600' : 'bg-primary/10 text-primary'
          )}
        >
          {fs ? <TreeDeciduous className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
        </span>
        <div>
          <div className="text-sm font-semibold">{fs ? t('start.fsTitle') : t('start.manualTitle')}</div>
          <div className="text-xs text-muted-foreground">{t('start.confirmIntro')}</div>
        </div>
      </div>
      <ul className="space-y-2">
        {points.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
            <Check className={cn('mt-0.5 h-4 w-4 shrink-0', fs ? 'text-emerald-600' : 'text-primary')} />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
        {fs ? t('start.fsRestriction') : t('start.mRestriction')}
      </p>
      <div className="flex justify-between gap-2">
        <Button variant="outline" onClick={() => setPicked(null)} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          {t('start.back')}
        </Button>
        <Button onClick={() => onDone(fs)} className={cn('gap-1.5', fs && 'bg-emerald-600 hover:bg-emerald-700')}>
          <Check className="h-4 w-4" />
          {t('start.confirmBtn')}
        </Button>
      </div>
    </div>
  )
}
