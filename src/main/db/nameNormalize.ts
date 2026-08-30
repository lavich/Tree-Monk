import { DismissedIssues, People } from './repo'
import { norm } from '@shared/nameMatch'
import type { NameGroup, Person } from '@shared/types'

/**
 * Folds a name to a comparable key: lowercase, diacritics stripped, and the
 * Hungarian letter equivalences y→i / w→v applied — so "Kovács", "Kovacs",
 * "KOVÁCS", "József" / "Jozsef", "Wesselényi" / "Veselényi" collapse to one key.
 */
const nameFold = (s: string): string => norm(s).replace(/y/g, 'i').replace(/w/g, 'v')

/** 1 if the name carries an accent (diacritic), else 0 — used to prefer the
 *  accented spelling as canonical when counts tie. */
const accentRank = (s: string): number =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '') !== s ? 1 : 0

/**
 * Groups the tree's values of a chosen name field (surname or given name) by
 * their folded key and returns every group written in MORE THAN ONE way — i.e.
 * spelling/accent variants of the same name. The `suggested` canonical is the
 * most common spelling (ties prefer the accented, then alphabetical form). These
 * are normalization candidates, not hard errors.
 */
/** Group-dismissal key: the user said "this spelling set is fine as it is". */
const groupDismissKey = (kind: 'surname' | 'given', key: string): string => `namevar|${kind}|${key}`

/** Hide a variant group from the suggestions (persisted; restorable from the
 *  hidden-issues view). */
export function dismissNameGroup(kind: 'surname' | 'given', key: string): void {
  DismissedIssues.add(groupDismissKey(kind, key))
}

function nameVariants(field: (p: Person) => string): NameGroup[] {
  const groups = new Map<string, Map<string, number>>()
  for (const p of People.list()) {
    const s = field(p).trim()
    if (s.length < 2) continue
    const key = nameFold(s)
    if (!key) continue
    const g = groups.get(key) ?? new Map<string, number>()
    g.set(s, (g.get(s) ?? 0) + 1)
    groups.set(key, g)
  }

  const out: NameGroup[] = []
  for (const [key, g] of groups) {
    if (g.size < 2) continue
    const variants = [...g.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort(
        (a, b) =>
          b.count - a.count ||
          accentRank(b.name) - accentRank(a.name) ||
          a.name.localeCompare(b.name)
      )
    out.push({
      key,
      suggested: variants[0].name,
      total: variants.reduce((s, v) => s + v.count, 0),
      variants
    })
  }
  out.sort((a, b) => b.total - a.total)
  return out
}

/** Spelling/accent variants of surnames (dismissed groups filtered out). */
export function surnameVariants(): NameGroup[] {
  const dismissed = DismissedIssues.all()
  return nameVariants((p) => p.surname).filter((g) => !dismissed.has(groupDismissKey('surname', g.key)))
}

/** Spelling/accent variants of given (first) names (dismissed filtered out). */
export function givenNameVariants(): NameGroup[] {
  const dismissed = DismissedIssues.all()
  return nameVariants((p) => p.givenName).filter((g) => !dismissed.has(groupDismissKey('given', g.key)))
}

/** The DISMISSED variant groups, with their current spellings — the
 *  hidden-issues view renders and restores these. */
export function dismissedNameGroups(): { key: string; kind: 'surname' | 'given'; variants: string[] }[] {
  const out: { key: string; kind: 'surname' | 'given'; variants: string[] }[] = []
  const byKind: Record<'surname' | 'given', Map<string, NameGroup>> = {
    surname: new Map(nameVariants((p) => p.surname).map((g) => [g.key, g])),
    given: new Map(nameVariants((p) => p.givenName).map((g) => [g.key, g]))
  }
  for (const key of DismissedIssues.list()) {
    const m = /^namevar\|(surname|given)\|(.+)$/.exec(key)
    if (!m) continue
    const kind = m[1] as 'surname' | 'given'
    const group = byKind[kind].get(m[2])
    out.push({ key, kind, variants: group ? group.variants.map((v) => v.name) : [m[2]] })
  }
  return out
}

/**
 * Rewrites every person whose chosen field is one of `variants` to `canonical`.
 * Returns how many people changed. Each change goes through the normal update
 * path, so it lands in the audit log and is undoable.
 */
function rewriteName(
  variants: string[],
  canonical: string,
  field: (p: Person) => string,
  apply: (id: string, value: string) => void
): number {
  const canon = canonical.trim()
  if (!canon) return 0
  const set = new Set(variants.map((v) => v.trim()).filter((v) => v && v !== canon))
  if (!set.size) return 0
  let n = 0
  for (const p of People.list()) {
    if (set.has(field(p).trim())) {
      apply(p.id, canon)
      n++
    }
  }
  return n
}

export function normalizeSurname(variants: string[], canonical: string): number {
  return rewriteName(variants, canonical, (p) => p.surname, (id, surname) => {
    People.update(id, { surname })
  })
}

export function normalizeGivenName(variants: string[], canonical: string): number {
  return rewriteName(variants, canonical, (p) => p.givenName, (id, givenName) => {
    People.update(id, { givenName })
  })
}
