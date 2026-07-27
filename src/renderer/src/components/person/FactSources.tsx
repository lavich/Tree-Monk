import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookText, Calendar, ExternalLink, FileText, Pencil, Plus, Quote, Upload } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CitationForm } from '@/components/person/PersonSources'
import { DocumentViewerDialog } from '@/components/documents/DocumentViewerDialog'
import { useAppStore } from '@/store/useAppStore'
import { canView } from '@/lib/docCategory'
import { cn } from '@/lib/utils'
import type { CitationDetail, DocumentRecord, Source } from '@shared/types'

/**
 * The research "reason" note for a vital fact (e.g. a cause of death) — imported
 * from FamilySearch but fully editable. Full-width, so it sits below the date/place
 * pair without disturbing the grid. Empty → a subtle "add reason" affordance.
 */
export function VitalNote({
  value,
  label,
  onSave
}: {
  value: string
  label: string
  onSave: (v: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const has = value.trim().length > 0

  const openModal = (): void => {
    setDraft(value)
    setOpen(true)
  }
  const commit = (): void => {
    onSave(draft.trim())
    setOpen(false)
  }

  return (
    <>
      {has ? (
        <button
          type="button"
          onClick={openModal}
          title={t('common.edit')}
          className="group flex w-full items-start gap-1.5 rounded-xl border border-border/40 bg-muted/50 px-2 py-1.5 text-left text-xs leading-snug text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/70"
        >
          <span className="line-clamp-2 flex-1 whitespace-pre-line">{value}</span>
          <Pencil className="mt-0.5 h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
        </button>
      ) : (
        <button
          type="button"
          onClick={openModal}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground/70 transition-colors hover:text-primary"
        >
          <Plus className="h-3 w-3" />
          {t('person.addReason')}
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {label} · {t('person.reason')}
            </DialogTitle>
          </DialogHeader>
          <textarea
            value={draft}
            autoFocus
            rows={8}
            placeholder={t('person.reasonHint')}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full resize-y rounded-xl border border-border/40 bg-background/60 px-3 py-2 text-sm leading-relaxed text-foreground outline-none transition-colors focus:border-primary"
          />
          <DialogFooter>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-xl border border-border/40 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={commit}
              className="rounded-xl bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t('common.save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Per-fact "add a source" affordance: a small "+" next to the fact's source
 * chip that opens a modal to either record a NEW source or cite an EXISTING
 * one — with the fact's event tag preset, so the citation lands back on the
 * fact it was added from.
 */
function AddFactSource({
  personId,
  eventTag,
  label,
  onAdded
}: {
  personId: string
  eventTag: string
  label?: string
  onAdded?: () => void | Promise<void>
}): JSX.Element {
  const { t } = useTranslation()
  const bumpSources = useAppStore((s) => s.bumpSources)
  const refreshDocuments = useAppStore((s) => s.refreshDocuments)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'new' | 'existing' | 'document'>('new')
  const [sources, setSources] = useState<Source[] | null>(null)
  const [docs, setDocs] = useState<DocumentRecord[] | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  // (Re)fetch on every switch to a picker — items added meanwhile show up.
  useEffect(() => {
    if (open && mode === 'existing') void window.api.research.listSources().then(setSources)
    if (open && mode === 'document') void window.api.documents.list().then(setDocs)
  }, [open, mode])

  const filtered = useMemo(() => {
    const list = sources ?? []
    const needle = q.trim().toLowerCase()
    if (!needle) return list
    return list.filter((s) =>
      [s.title, s.author, s.publication].some((f) => (f ?? '').toLowerCase().includes(needle))
    )
  }, [sources, q])

  const filteredDocs = useMemo(() => {
    const list = docs ?? []
    const needle = q.trim().toLowerCase()
    if (!needle) return list
    return list.filter((d) => (d.title ?? '').toLowerCase().includes(needle))
  }, [docs, q])

  const close = (): void => {
    setOpen(false)
    setMode('new')
    setQ('')
  }
  const finish = async (): Promise<void> => {
    bumpSources() // tree-card source badges count citations too
    await onAdded?.()
    close()
  }

  const attachDoc = async (docId: string): Promise<void> => {
    setBusy(true)
    try {
      await window.api.documents.attach(docId, personId, eventTag)
      await refreshDocuments()
      await finish()
    } finally {
      setBusy(false)
    }
  }
  const importFiles = async (): Promise<void> => {
    setBusy(true)
    try {
      const created = await window.api.documents.import(personId)
      if (!created.length) return // picker cancelled — stay in the dialog
      for (const d of created) await window.api.documents.attach(d.id, personId, eventTag)
      await refreshDocuments()
      await finish()
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (m: 'new' | 'existing' | 'document'): void => {
    setMode(m)
    setQ('')
  }
  const modeBtn = (m: 'new' | 'existing' | 'document', text: string): JSX.Element => (
    <button
      type="button"
      onClick={() => switchMode(m)}
      className={cn(
        'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
        mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
      )}
    >
      {text}
    </button>
  )

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        title={t('person.addSource')}
        aria-label={t('person.addSource')}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary transition-colors hover:bg-primary/25"
      >
        <Plus className="h-3 w-3" />
      </button>

      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              {label ? `${label} · ` : ''}
              {t('person.addSource')}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-1 rounded-xl border border-border/40 bg-muted/40 p-1 self-start">
            {modeBtn('new', t('person.srcAddNew'))}
            {modeBtn('existing', t('person.srcUseExisting'))}
            {modeBtn('document', t('person.srcDoc'))}
          </div>
          {mode === 'document' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t('person.srcDocSearchPlaceholder')}
                  autoFocus
                  className="h-9 min-w-0 flex-1 rounded-lg border border-border/40 bg-background/60 px-2.5 text-sm outline-none focus:border-primary/60"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void importFiles()}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border/40 px-2.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {t('person.srcImportFile')}
                </button>
              </div>
              <div className="max-h-[50vh] space-y-1.5 overflow-auto pr-1">
                {docs !== null && filteredDocs.length === 0 && (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    {docs.length === 0 ? t('person.srcNoDocs') : t('person.srcNoMatch')}
                  </p>
                )}
                {filteredDocs.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void attachDoc(d.id)}
                    className="w-full rounded-xl border border-border/40 bg-card/50 p-2.5 text-left transition-colors hover:border-primary/50 hover:bg-accent disabled:opacity-50"
                  >
                    <span className="flex items-start gap-2">
                      <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{d.title || '—'}</span>
                        <span className="mt-0.5 block truncate text-[11px] capitalize text-muted-foreground">
                          {t(`documents.kinds.${d.kind}`)}
                          {d.date ? ` · ${d.date}` : ''}
                        </span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : mode === 'new' ? (
            <CitationForm
              initial={{ eventTag }}
              onSave={async (edit) => {
                await window.api.research.addCitation(personId, edit)
                await finish()
              }}
              onCancel={close}
            />
          ) : (
            <div className="space-y-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('person.srcSearchPlaceholder')}
                autoFocus
                className="h-9 w-full rounded-lg border border-border/40 bg-background/60 px-2.5 text-sm outline-none focus:border-primary/60"
              />
              <div className="max-h-[50vh] space-y-1.5 overflow-auto pr-1">
                {sources !== null && filtered.length === 0 && (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    {sources.length === 0 ? t('person.srcNoneYet') : t('person.srcNoMatch')}
                  </p>
                )}
                {filtered.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        await window.api.research.attachSourceToPerson(s.id, personId, eventTag)
                        await finish()
                      } finally {
                        setBusy(false)
                      }
                    }}
                    className="w-full rounded-xl border border-border/40 bg-card/50 p-2.5 text-left transition-colors hover:border-primary/50 hover:bg-accent disabled:opacity-50"
                  >
                    <span className="flex items-start gap-2">
                      <BookText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{s.title || '—'}</span>
                        {(s.author || s.recordDate) && (
                          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                            {[s.recordDate, s.author].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * A tiny "sources" chip shown next to a fact (Birth / Death / Christening / …).
 * It appears only when the person has citations tagged for that fact's event
 * (citation.eventTag, set at FamilySearch import) and opens them in a modal — so
 * the evidence for a fact is reachable right from the fact itself. When
 * `personId` + `addTag` are given, a small "+" also lets the user cite a source
 * for the fact right here (new source or an existing one).
 */
export function FactSources({
  citations,
  tags,
  label,
  className,
  personId,
  addTag,
  onAdded
}: {
  citations: CitationDetail[]
  tags: string[]
  label?: string
  className?: string
  /** With `addTag`: enables the per-fact "add source" button. */
  personId?: string
  /** The GEDCOM event tag a citation added from this fact gets (e.g. 'BIRT'). */
  addTag?: string
  /** Called after a citation was added, so the parent can refresh its list. */
  onAdded?: () => void | Promise<void>
}): JSX.Element | null {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // Documents whose attachment carries one of this fact's event tags. Loaded
  // here (not passed in) so existing call sites stay unchanged; re-fetched when
  // the parent refreshes its citations or after an add from this chip.
  const [factDocs, setFactDocs] = useState<DocumentRecord[]>([])
  const [docNonce, setDocNonce] = useState(0)
  const [viewDoc, setViewDoc] = useState<DocumentRecord | null>(null)
  const tagKey = tags.join('|')
  useEffect(() => {
    if (!personId) return
    let alive = true
    void Promise.all([
      window.api.documents.listForPerson(personId),
      window.api.documents.tagsForPerson(personId)
    ]).then(([docs, tagRows]) => {
      if (!alive) return
      const tagged = new Map(tagRows.map((r) => [r.documentId, r.eventTag]))
      setFactDocs(
        docs.filter((d) => {
          const tg = tagged.get(d.id)
          return !!tg && tags.includes(tg)
        })
      )
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tagKey covers tags
  }, [personId, tagKey, citations, docNonce])

  const matching = citations.filter((c) => c.eventTag && tags.includes(c.eventTag))
  const total = matching.length + factDocs.length
  const handleAdded = async (): Promise<void> => {
    setDocNonce((n) => n + 1)
    await onAdded?.()
  }
  const adder =
    personId && addTag ? (
      <AddFactSource personId={personId} eventTag={addTag} label={label} onAdded={handleAdded} />
    ) : null
  if (!total) return adder

  return (
    <>
      {adder}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        title={t('person.viewSources', { count: total })}
        className={cn(
          'inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/25',
          className
        )}
      >
        <FileText className="h-3 w-3" />
        {total}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              {label ? `${label} · ` : ''}
              {t('person.sourcesCount', { count: total })}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-auto pr-1">
            {factDocs.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('documents.title')}
                </p>
                {factDocs.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => (canView(d) ? setViewDoc(d) : void window.api.documents.open(d.id))}
                    className="w-full rounded-xl border border-border/40 bg-card/50 p-2.5 text-left transition-colors hover:border-primary/50 hover:bg-accent"
                  >
                    <span className="flex items-start gap-2">
                      <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{d.title || '—'}</span>
                        <span className="mt-0.5 block truncate text-[11px] capitalize text-muted-foreground">
                          {t(`documents.kinds.${d.kind}`)}
                          {d.date ? ` · ${d.date}` : ''}
                        </span>
                      </span>
                    </span>
                  </button>
                ))}
                {matching.length > 0 && (
                  <p className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('person.citations')}
                  </p>
                )}
              </div>
            )}
            {matching.map((c) => {
              const url = (c.sourcePublication || '').match(/https?:\/\/\S+/)?.[0]
              return (
                <div key={c.id} className="rounded-xl border border-border/40 bg-card/50 p-3">
                  <p className="text-sm font-medium leading-snug">{c.sourceTitle || t('person.sources')}</p>
                  {(c.recordDate || c.page) && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {c.recordDate && (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {c.recordDate}
                        </span>
                      )}
                      {c.page && (
                        <span className="inline-flex items-center gap-1">
                          <Quote className="h-3 w-3" />
                          {c.page}
                        </span>
                      )}
                    </div>
                  )}
                  {c.sourceAuthor && (
                    <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{c.sourceAuthor}</p>
                  )}
                  {c.note && (
                    <p className="mt-1.5 rounded bg-amber-500/10 px-2 py-1 text-xs leading-snug text-amber-700 dark:text-amber-300">
                      {c.note}
                    </p>
                  )}
                  {url && (
                    <button
                      type="button"
                      onClick={() => void window.api.app.openExternal(url)}
                      className="mt-2 inline-flex items-center gap-1 rounded-lg border border-border/40 px-2 py-1 text-xs font-medium transition-colors hover:bg-accent"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {t('person.openOnFs')}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>

      <DocumentViewerDialog
        list={factDocs.filter(canView)}
        active={viewDoc}
        onActiveChange={setViewDoc}
      />
    </>
  )
}
