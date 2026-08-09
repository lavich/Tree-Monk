import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronsDown, ChevronsUp, Globe, Network, type LucideIcon } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { scopePeople, type DashboardScope } from '@/lib/dashboardScope'
import { cn } from '@/lib/utils'

const SCOPES: { id: DashboardScope; icon: LucideIcon }[] = [
  { id: 'all', icon: Globe },
  { id: 'blood', icon: Network },
  { id: 'ancestors', icon: ChevronsUp },
  { id: 'descendants', icon: ChevronsDown }
]

/**
 * Resolve a scope to the people it covers, around the tree's starting person.
 *
 * The same four circles the dashboard offers — kept in one place so a filter
 * means exactly the same thing wherever it appears, and an export can never
 * quietly disagree with what the overview showed.
 */
export function useScopedPeople(scope: DashboardScope, includeSpouses = true): ReturnType<typeof scopePeople> {
  const people = useAppStore((s) => s.people)
  const families = useAppStore((s) => s.families)
  const defaultRootId = useAppStore((s) => s.defaultRootId)
  const treeRootId = useAppStore((s) => s.treeRootId)
  const rootId = treeRootId ?? defaultRootId ?? undefined
  return useMemo(
    () => scopePeople(people, families, { scope, rootId, includeSpouses }),
    [people, families, scope, rootId, includeSpouses]
  )
}

/**
 * Compact segmented control for the four scopes.
 *
 * Every scope but "all" needs a starting person to measure from, so without one
 * the control disables itself rather than silently returning the whole tree
 * under a filtered-looking label.
 */
export function ScopePicker({
  value,
  onChange,
  disabled,
  className
}: {
  value: DashboardScope
  onChange: (s: DashboardScope) => void
  disabled?: boolean
  className?: string
}): JSX.Element {
  const { t } = useTranslation()
  const defaultRootId = useAppStore((s) => s.defaultRootId)
  const treeRootId = useAppStore((s) => s.treeRootId)
  const hasRoot = !!(treeRootId ?? defaultRootId)

  return (
    <div className={cn('inline-flex gap-1 rounded-xl bg-secondary/40 p-1', className)}>
      {SCOPES.map(({ id, icon: Icon }) => {
        const off = disabled || (id !== 'all' && !hasRoot)
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            disabled={off}
            title={id !== 'all' && !hasRoot ? t('dashboard.scopeNeedsRoot') : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              value === id
                ? 'bg-background/80 text-primary shadow-[inset_0_1px_0_hsl(var(--glass-highlight)/0.4)] ring-1 ring-primary/20'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t(`dashboard.scope.${id}`)}
          </button>
        )
      })}
    </div>
  )
}
