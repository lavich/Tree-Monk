import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { PersonAvatar } from '@/components/common/PersonAvatar'
import { RelativeDialog, type RelativeDraft } from './RelativeDialog'
import { fullName } from '@/lib/utils'

/**
 * The people who took part in ONE vital fact, each with a role — the midwife at
 * a birth, the priest who performed the christening or the burial, the doctor
 * who certified a death.
 *
 * They belong to the fact itself. Until now they could only be hung off a
 * separate custom EVENT, so people typed them into the fact's free-text reason
 * field instead, where nothing can search, count or export them.
 *
 * The role stays free text — parish records word it every possible way — but
 * each fact offers the roles it actually sees, so the common case is one click.
 * Adding goes through the usual relative dialog, which can also CREATE the
 * person: a midwife or a priest is rarely already in the tree.
 */
export function FactParticipants({
  personId,
  factTag,
  roleKeys
}: {
  personId: string
  /** GEDCOM tag of the owning fact: BIRT | CHR | DEAT | BURI. */
  factTag: string
  /** Keys under `person.roles.*` offered as quick picks for this fact. */
  roleKeys: string[]
}): JSX.Element {
  const { t } = useTranslation()
  const peopleById = useAppStore((s) => s.peopleById)
  const selectPerson = useAppStore((s) => s.selectPerson)
  const [rows, setRows] = useState<{ personId: string; role: string | null }[]>([])
  const [adding, setAdding] = useState(false)

  const reload = useCallback(() => {
    void window.api.factParticipants.forFact(personId, factTag).then(setRows)
  }, [personId, factTag])
  useEffect(reload, [reload])

  const roles = useMemo(() => roleKeys.map((k) => t(`person.roles.${k}`)), [roleKeys, t])

  const addExisting = async (pid: string): Promise<void> => {
    // Pre-fill the role this fact sees most often; the field sits right there.
    await window.api.factParticipants.add(personId, factTag, pid, roles[0] ?? null)
    reload()
  }
  const createAndAdd = async (draft: RelativeDraft): Promise<void> => {
    const p = await window.api.people.create(draft)
    await window.api.factParticipants.add(personId, factTag, p.id, roles[0] ?? null)
    await useAppStore.getState().refreshAll()
    reload()
  }
  const saveRole = async (pid: string, role: string): Promise<void> => {
    await window.api.factParticipants.add(personId, factTag, pid, role.trim() || null)
  }
  const remove = async (pid: string): Promise<void> => {
    await window.api.factParticipants.remove(personId, factTag, pid)
    reload()
  }

  const listId = `roles-${factTag}`

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('person.factParticipants')}
        </h4>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 rounded-lg border border-border/40 px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <Plus className="h-3 w-3" /> {t('person.addParticipant')}
        </button>
      </div>

      {rows.length > 0 && (
        <ul className="space-y-1">
          {rows.map((r) => {
            const p = peopleById.get(r.personId)
            return (
              <li key={r.personId} className="flex items-center gap-1.5">
                <button
                  onClick={() => selectPerson(r.personId)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-border/50 bg-background px-2 py-1 text-left text-xs transition-colors hover:border-primary/40"
                >
                  <PersonAvatar personId={r.personId} name={p ? fullName(p) : ''} sex={p?.sex} className="h-5 w-5 text-[9px]" />
                  <span className="truncate">{p ? fullName(p) : r.personId}</span>
                </button>
                <input
                  defaultValue={r.role ?? ''}
                  onBlur={(e) => void saveRole(r.personId, e.target.value)}
                  list={listId}
                  placeholder={t('person.role')}
                  className="w-28 shrink-0 rounded-lg border border-border/50 bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <button
                  onClick={() => void remove(r.personId)}
                  title={t('common.delete')}
                  className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* Free-text field with per-fact suggestions — a datalist proposes without
          restricting, which is what historical role wording needs. */}
      <datalist id={listId}>
        {roles.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>

      <RelativeDialog
        open={adding}
        onOpenChange={setAdding}
        title={t('person.addParticipant')}
        defaultMode="existing"
        excludeIds={new Set([personId, ...rows.map((r) => r.personId)])}
        onPickExisting={(id) => void addExisting(id)}
        onSubmit={(draft) => void createAndAdd(draft)}
      />
    </div>
  )
}
