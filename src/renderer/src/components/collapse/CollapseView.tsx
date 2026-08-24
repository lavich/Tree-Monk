/**
 * Pedigree collapse ("ősvesztés") finder — visual edition.
 *
 * Left: every ancestor of the chosen person who occupies 2+ positions in their
 * ancestor tree. Right: a pan/zoom GRAPH of the selected ancestor's lines — the
 * root on the left, the collapsed ancestor on the right, and every distinct
 * root→ancestor path drawn as person cards with father/mother-coloured
 * connectors, merging where the lines share people. The converging "lens"
 * shape IS the pedigree collapse — visible at a glance.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileDown, GitMerge, Route } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PersonAvatar } from '@/components/common/PersonAvatar'
import { PersonSelect } from '@/components/kinship/RelationshipView'
import { PanZoom } from '@/components/tree/PanZoom'
import { useAppStore } from '@/store/useAppStore'
import { cn, fullName } from '@/lib/utils'
import {
  buildBirthParents,
  computePedigreeCollapse,
  sosaPath
} from '@/lib/pedigreeCollapse'
import type { Person } from '@shared/types'

const CARD_W = 190
const CARD_H = 56
const COL_W = CARD_W + 92
const LANE_H = 100
const PAD = 70

// Connector colour by which parent the hop climbs to (matches the tree's sex bars).
const FATHER_LINE = '#14b8a6'
const MOTHER_LINE = '#f43f5e'

const yr = (d: string | null): string => d?.match(/\b(\d{4})\b/)?.[1] ?? ''
const years = (p: Person): string => {
  const b = yr(p.birthDate)
  const d = yr(p.deathDate)
  return b || d ? `${b || '?'}–${d || (p.deceased ? '†' : '')}` : ''
}

/** Rounded elbow between two card edge midpoints. */
function elbow(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(y1 - y2) < 1) return `M ${x1} ${y1} H ${x2}`
  const midX = (x1 + x2) / 2
  const r = Math.min(14, Math.abs(y2 - y1) / 2, Math.abs(x2 - x1) / 2)
  const dir = y2 > y1 ? 1 : -1
  return `M ${x1} ${y1} H ${midX - r} Q ${midX} ${y1} ${midX} ${y1 + r * dir} V ${y2 - r * dir} Q ${midX} ${y2} ${midX + r} ${y2} H ${x2}`
}

interface GraphNode {
  id: string
  x: number
  y: number
}
interface GraphEdge {
  id: string
  d: string
  color: string
}

export function CollapseView(): JSX.Element {
  const { t } = useTranslation()
  const people = useAppStore((s) => s.people)
  const families = useAppStore((s) => s.families)
  const defaultRootId = useAppStore((s) => s.defaultRootId)
  const selectPerson = useAppStore((s) => s.selectPerson)

  const [rootId, setRootId] = useState<string>(defaultRootId ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const { parents, validIds } = useMemo(() => {
    const ids = new Set(people.map((p) => p.id))
    return { parents: buildBirthParents(families, ids), validIds: ids }
  }, [people, families])

  const result = useMemo(
    () => (rootId && byId.has(rootId) ? computePedigreeCollapse(rootId, validIds, parents) : null),
    [rootId, byId, validIds, parents]
  )

  // Auto-select the most-collapsed ancestor whenever the root/result changes.
  useEffect(() => {
    setSelectedId(result?.collapsed[0]?.personId ?? null)
  }, [result])

  const selected = result?.collapsed.find((c) => c.personId === selectedId) ?? null

  /** Printable report: the stats, the FULL collapsed-ancestor list, and every
   *  root→ancestor path of the selected one — the graph, in prose. */
  const exportPdf = async (): Promise<void> => {
    if (!result || !rootId) return
    const esc = (x: string): string =>
      x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const nameOf = (id: string): string => {
      const p = byId.get(id)
      if (!p) return '—'
      const b = p.birthDate?.match(/(\d{4})/)?.[1] ?? ''
      const d = p.deathDate?.match(/(\d{4})/)?.[1] ?? ''
      return esc(fullName(p)) + (b || d ? ` (${b || '?'}–${d || ''})` : '')
    }
    const rows = result.collapsed
      .map(
        (c) =>
          `<tr><td>${nameOf(c.personId)}</td><td class="n">×${c.count}</td>` +
          `<td class="n">${c.occurrences[0].gen}</td>` +
          `<td class="sosa">${c.occurrences.map((o) => o.sosa).join(', ')}</td></tr>`
      )
      .join('')
    const sel = selected
      ? `<h2>${nameOf(selected.personId)} — ${esc(t('collapse.pdfPaths'))}</h2>` +
        selected.occurrences
          .map((o) => `<p class="side">Sosa ${o.sosa}: ${sosaPath(rootId, o.sosa, parents).map(nameOf).join(' → ')}</p>`)
          .join('')
      : ''
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page { size: A4; margin: 16mm 14mm; }
      body { font-family: 'Segoe UI', system-ui, sans-serif; color: #1c2b27; font-size: 12px; }
      h1 { font-size: 18px; margin: 0 0 2px; } h2 { font-size: 14px; margin: 16px 0 6px; }
      .sub { color: #667; margin: 0 0 10px; }
      table { border-collapse: collapse; width: 100%; } td, th { border-bottom: 1px solid #dde; padding: 3px 6px; text-align: left; vertical-align: top; }
      th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #667; }
      .n { text-align: right; white-space: nowrap; } .sosa { color: #667; }
      .side { margin: 3px 0; page-break-inside: avoid; }
    </style></head><body>
      <h1>${esc(t('collapse.title'))} — ${nameOf(rootId)}</h1>
      <p class="sub">${esc(t('collapse.generations'))}: ${result.generations} · ${esc(t('collapse.positions'))}: ${result.positions} · ${esc(t('collapse.distinct'))}: ${result.distinct} · Implex: ${result.implexPct.toFixed(1)}%</p>
      <table><thead><tr><th>${esc(t('collapse.person'))}</th><th class="n">×</th><th class="n">Gen</th><th>Sosa</th></tr></thead><tbody>${rows}</tbody></table>
      ${sel}
    </body></html>`
    const res = await window.api.dashboard.exportPdf(html, `ahnenschwund-${fullName(byId.get(rootId)!)}`)
    if (res) toast.success(t('collapse.pdfDone', { path: res.path }))
  }

  /**
   * Merged-path graph for the selected ancestor. Nodes shared by several paths
   * (the root, the ancestor, common line segments) are drawn ONCE:
   *  - column = the deepest position the person holds across the paths,
   *  - lane   = the average of the lanes (paths) that pass through them —
   *    so shared people sit centred between the branches they join.
   */
  const graph = useMemo((): {
    nodes: GraphNode[]
    edges: GraphEdge[]
    width: number
    height: number
  } | null => {
    if (!rootId || !selected) return null
    const paths = selected.occurrences.map((o) => sosaPath(rootId, o.sosa, parents))

    const col = new Map<string, number>()
    const laneSum = new Map<string, number>()
    const laneCnt = new Map<string, number>()
    for (let lane = 0; lane < paths.length; lane++) {
      const path = paths[lane]
      for (let i = 0; i < path.length; i++) {
        const id = path[i]
        col.set(id, Math.max(col.get(id) ?? 0, i))
        laneSum.set(id, (laneSum.get(id) ?? 0) + lane)
        laneCnt.set(id, (laneCnt.get(id) ?? 0) + 1)
      }
    }

    // Desired y per node, then per-column collision resolution (keep order,
    // push apart to a minimum gap, re-centre around the column's mean).
    const desired = new Map<string, number>()
    for (const id of col.keys()) desired.set(id, ((laneSum.get(id) ?? 0) / (laneCnt.get(id) ?? 1)) * LANE_H)
    const byCol = new Map<number, string[]>()
    for (const [id, c] of col) {
      const arr = byCol.get(c) ?? []
      arr.push(id)
      byCol.set(c, arr)
    }
    const yPos = new Map<string, number>()
    const MIN_GAP = CARD_H + 22
    for (const [, ids] of byCol) {
      ids.sort((a, b) => (desired.get(a) ?? 0) - (desired.get(b) ?? 0))
      const want = ids.map((id) => desired.get(id) ?? 0)
      const placed: number[] = []
      for (let i = 0; i < want.length; i++)
        placed.push(i === 0 ? want[i] : Math.max(want[i], placed[i - 1] + MIN_GAP))
      // re-centre the packed run on the desired mean so branches stay balanced
      const shift =
        want.reduce((a, b) => a + b, 0) / want.length - placed.reduce((a, b) => a + b, 0) / placed.length
      ids.forEach((id, i) => yPos.set(id, placed[i] + shift))
    }

    const ys = [...yPos.values()]
    const minY = Math.min(...ys)
    const maxCol = Math.max(...col.values())
    const nodes: GraphNode[] = [...col.entries()].map(([id, c]) => ({
      id,
      x: PAD + c * COL_W,
      y: PAD + (yPos.get(id) ?? 0) - minY
    }))
    const nodeAt = new Map(nodes.map((n) => [n.id, n]))

    // Edges: every child→parent hop used by any path, drawn once, coloured by
    // whether the hop climbs to the father or the mother.
    const seen = new Set<string>()
    const edges: GraphEdge[] = []
    for (const path of paths) {
      for (let i = 0; i + 1 < path.length; i++) {
        const a = path[i]
        const b = path[i + 1]
        const key = `${a}->${b}`
        if (seen.has(key)) continue
        seen.add(key)
        const na = nodeAt.get(a)!
        const nb = nodeAt.get(b)!
        edges.push({
          id: key,
          d: elbow(na.x + CARD_W, na.y + CARD_H / 2, nb.x, nb.y + CARD_H / 2),
          color: parents.get(a)?.father === b ? FATHER_LINE : MOTHER_LINE
        })
      }
    }

    return {
      nodes,
      edges,
      width: PAD * 2 + maxCol * COL_W + CARD_W,
      height: PAD * 2 + (Math.max(...ys) - minY) + CARD_H
    }
  }, [rootId, selected, parents])

  const sexBar: Record<string, string> = {
    M: 'bg-teal-400/80',
    F: 'bg-pink-400/80',
    U: 'bg-slate-400/60'
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-border/40 px-6 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <GitMerge className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold leading-tight">{t('collapse.title')}</h1>
          <p className="truncate text-xs text-muted-foreground">{t('collapse.subtitle')}</p>
        </div>
        {result && result.collapsed.length > 0 && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void exportPdf()}>
            <FileDown className="h-4 w-4" />
            PDF
          </Button>
        )}
      </header>

      {/* Toolbar: person picker + compact stats */}
      <div className="glass-subtle relative z-20 flex flex-wrap items-center gap-2.5 border-b border-border/40 p-3">
        <div className="flex min-w-[260px] max-w-md flex-1 items-center gap-2">
          <Route className="h-4 w-4 shrink-0 text-muted-foreground" />
          <PersonSelect value={rootId} onChange={setRootId} placeholder={t('collapse.pickPerson')} />
        </div>
        {result && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded-full bg-secondary/60 px-2 py-1 text-muted-foreground">
              {t('collapse.generations')}: <b className="text-foreground">{result.generations}</b>
            </span>
            <span className="rounded-full bg-secondary/60 px-2 py-1 text-muted-foreground">
              {t('collapse.positions')}: <b className="text-foreground">{result.positions}</b>
            </span>
            <span className="rounded-full bg-secondary/60 px-2 py-1 text-muted-foreground">
              {t('collapse.distinct')}: <b className="text-foreground">{result.distinct}</b>
            </span>
            <span className="rounded-full bg-primary/15 px-2 py-1 font-semibold text-primary">
              {t('collapse.implex')}: {result.implexPct.toFixed(1)}%
            </span>
          </div>
        )}
      </div>

      {!result && (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          {t('collapse.hint')}
        </div>
      )}

      {result && result.collapsed.length === 0 && (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          {result.positions === 0 ? t('collapse.noAncestors') : t('collapse.none')}
        </div>
      )}

      {result && result.collapsed.length > 0 && (
        <div className="flex min-h-0 flex-1">
          {/* Collapsed-ancestor list */}
          <aside className="w-72 shrink-0 overflow-y-auto border-r border-border/40 p-2">
            <p className="px-1.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('collapse.found', { count: result.collapsed.length })}
            </p>
            {result.truncated && (
              <p className="mx-1 mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                {t('collapse.truncated')}
              </p>
            )}
            <div className="space-y-1">
              {result.collapsed.map((c) => {
                const p = byId.get(c.personId)
                if (!p) return null
                const active = c.personId === selectedId
                return (
                  <button
                    key={c.personId}
                    onClick={() => setSelectedId(c.personId)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-xl border px-2 py-1.5 text-left transition-colors',
                      active
                        ? 'border-primary/50 bg-primary/10'
                        : 'border-transparent hover:bg-accent'
                    )}
                  >
                    <PersonAvatar personId={p.id} name={fullName(p)} sex={p.sex} className="h-8 w-8 text-[10px]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium leading-tight">{fullName(p)}</span>
                      <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                        {years(p) || ' '}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-xs font-bold',
                        active ? 'bg-primary text-primary-foreground' : 'bg-primary/15 text-primary'
                      )}
                    >
                      ×{c.count}
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>

          {/* Converging-lines graph */}
          <main className="relative min-w-0 flex-1 overflow-hidden bg-background">
            {graph && (
              <PanZoom fitKey={`${rootId}:${selectedId}`} contentWidth={graph.width} contentHeight={graph.height}>
                <div className="relative" style={{ width: graph.width, height: graph.height }}>
                  <svg width={graph.width} height={graph.height} className="pointer-events-none absolute inset-0">
                    {graph.edges.map((e) => (
                      <path
                        key={e.id}
                        d={e.d}
                        fill="none"
                        stroke={e.color}
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        opacity={0.85}
                      />
                    ))}
                  </svg>
                  {graph.nodes.map((n) => {
                    const p = byId.get(n.id)
                    if (!p) return null
                    const isRoot = n.id === rootId
                    const isTarget = n.id === selectedId
                    return (
                      <button
                        key={n.id}
                        onClick={() => selectPerson(n.id)}
                        style={{ left: n.x, top: n.y, width: CARD_W, height: CARD_H }}
                        className={cn(
                          'group absolute flex items-center gap-2 overflow-hidden rounded-xl border bg-card pl-2.5 pr-2 text-left shadow-sm transition-all hover:z-10 hover:shadow-md hover:ring-2 hover:ring-primary/50',
                          isTarget
                            ? 'border-primary bg-primary/10 ring-2 ring-primary/40'
                            : isRoot
                              ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/25'
                              : 'border-border/60'
                        )}
                      >
                        <span className={cn('absolute inset-y-0 left-0 w-1', sexBar[p.sex ?? 'U'])} />
                        <PersonAvatar personId={p.id} name={fullName(p)} sex={p.sex} className="h-8 w-8 shrink-0 text-[10px]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-semibold leading-tight group-hover:text-primary">
                            {fullName(p)}
                          </span>
                          <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                            {years(p) || ' '}
                          </span>
                        </span>
                        {isTarget && (
                          <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                            ×{selected?.count}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </PanZoom>
            )}
            {/* Legend */}
            <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded-full border border-border/40 bg-card/85 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-5 rounded-full" style={{ background: FATHER_LINE }} />
                {t('collapse.legendFather')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-5 rounded-full" style={{ background: MOTHER_LINE }} />
                {t('collapse.legendMother')}
              </span>
            </div>
          </main>
        </div>
      )}
    </div>
  )
}
