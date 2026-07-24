import { DismissedIssues, Families, People } from './repo'
import { getDb } from './connection'
import type { Person, SanityFix, SanityIssue } from '@shared/types'

/**
 * Month name → 1–12. Covers full names AND abbreviations in English, Hungarian
 * and German, because FamilySearch / GEDCOM dates arrive in many shapes:
 * "11 JAN 1906", "1. Januar 1907", "1850. április", "March 1900", "1900-03-01".
 * Each registered name also auto-adds its 3-letter prefix (the GEDCOM abbrev),
 * so "Jan", "Jän", "Már", "Szep" etc. all resolve too.
 */
const MONTH_TOKENS: Record<string, number> = {}
const addMonth = (n: number, ...names: string[]): void => {
  for (const name of names) {
    MONTH_TOKENS[name] = n
    const p = name.slice(0, 3)
    if (MONTH_TOKENS[p] === undefined) MONTH_TOKENS[p] = n
  }
}
addMonth(1, 'january', 'januar', 'január', 'jänner')
addMonth(2, 'february', 'februar', 'február')
addMonth(3, 'march', 'märz', 'marz', 'március', 'marcius')
addMonth(4, 'april', 'április', 'aprilis')
addMonth(5, 'may', 'mai', 'május', 'majus')
addMonth(6, 'june', 'juni', 'június', 'junius')
addMonth(7, 'july', 'juli', 'július', 'julius')
addMonth(8, 'august', 'augusztus')
addMonth(9, 'september', 'szeptember', 'sept')
addMonth(10, 'october', 'oktober', 'október')
addMonth(11, 'november')
addMonth(12, 'december', 'dezember')

/** The month (1–12) named anywhere in a free-form date, or null. Splits on
 *  non-letters so "11 JAN 1906", "1. Januar 1907" and "1850. április" all work. */
function monthIndex(date: string): number | null {
  for (const tok of date.toLowerCase().split(/[^\p{L}]+/u)) {
    if (tok && MONTH_TOKENS[tok] !== undefined) return MONTH_TOKENS[tok]
  }
  return null
}

/** Parses a free-form GEDCOM date into a decimal year (mid-year if no month). */
function decimalYear(date: string | null): number | null {
  if (!date) return null
  const iso = date.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return Number(iso[1]) + (Number(iso[2]) - 0.5) / 12
  const ym = date.match(/\b(\d{4})\b/)
  if (!ym) return null
  const y = Number(ym[0])
  const m = monthIndex(date)
  return m !== null ? y + (m - 0.5) / 12 : y + 0.5
}

const yearOf = (d: string | null): number | null => {
  const dy = decimalYear(d)
  return dy === null ? null : Math.floor(dy)
}

/**
 * Earliest/latest possible decimal year for a free-form date, respecting its
 * PRECISION: a year-only date spans the whole year [y, y+1), a year+month spans
 * that month, a full ISO date is a single day. Lets date comparisons avoid false
 * positives from partial dates (e.g. "1922" vs "April 1922").
 */
function dateBounds(date: string | null): { lo: number; hi: number } | null {
  if (!date) return null
  const iso = date.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const v = Number(iso[1]) + (Number(iso[2]) - 1) / 12 + (Number(iso[3]) - 1) / 365
    return { lo: v, hi: v + 1 / 365 }
  }
  const ym = date.match(/\b(\d{4})\b/)
  if (!ym) return null
  const y = Number(ym[0])
  const m = monthIndex(date)
  if (m !== null) return { lo: y + (m - 1) / 12, hi: y + m / 12 }
  return { lo: y, hi: y + 1 }
}

/** A date string is "unparsable" when it carries digits (so it's meant to be a
 *  date) yet yields no 4-digit year — e.g. a "22"/"185" year typo or "1/2/85".
 *  Pure-text notes like "unknown" (no digits) are intentional and NOT flagged. */
function isUnparsableDate(date: string | null): boolean {
  if (!date) return false
  if (!/\d/.test(date)) return false
  return !/\b\d{4}\b/.test(date)
}

function name(p: Person): string {
  return `${p.givenName} ${p.surname}`.trim() || '—'
}

let counter = 0
const nid = (): string => `issue-${counter++}`

/** Current year — used to flag people who would be implausibly old if still alive. */
const NOW_YEAR = new Date().getFullYear()
// "Now" as a decimal year using the SAME convention as dateBounds (month-1)/12 +
// (day-1)/365, so a date earlier this year (e.g. April when it's June) is NOT
// mistaken for the future — the old year-only NOW_YEAR flagged any date after
// Jan 1 of the current year as future.
const _now = new Date()
const NOW_DECIMAL = _now.getFullYear() + _now.getMonth() / 12 + (_now.getDate() - 1) / 365
/** Past this age with no death recorded, a person is almost certainly deceased. */
const MAX_LIVING_AGE = 110

// Plausibility thresholds (deliberately generous — we only flag the certain).
const MAX_MOTHER_AGE = 52 // a mother older than this at a birth is implausible
const MAX_FATHER_AGE = 75
const MIN_MARRY_AGE = 14
const SPOUSE_AGE_GAP = 30 // years — a notice, not an error
const MANY_CHILDREN = 18
const CHRISTENING_LATE = 5 // years after birth before it looks odd (adult baptism exists)

/** Event types that legitimately happen at/after death — never flagged as
 *  "event after death". Matched against the event `type` code. */
const POSTMORTEM_TYPES = [
  'burial',
  'funeral',
  'cremation',
  'probate',
  'will',
  'estate',
  'obituary',
  'interment',
  'memorial',
  'headstone',
  'tombstone',
  'gravestone'
]

/** Name tokens that belong in the prefix/suffix fields, not the name itself. */
const NAME_AFFIXES = new Set([
  'dr',
  'dr.',
  'prof',
  'prof.',
  'ifj',
  'ifj.',
  'id.',
  'özv',
  'özv.',
  'rev',
  'rev.',
  'jr',
  'jr.',
  'sr',
  'sr.',
  'ii',
  'iii',
  'iv',
  'junior',
  'senior'
])

function hasAffix(s: string | null): boolean {
  if (!s) return false
  return s
    .trim()
    .split(/\s+/)
    .some((tok) => NAME_AFFIXES.has(tok.toLowerCase()))
}

function hasBadWhitespace(s: string | null): boolean {
  if (!s) return false
  return s !== s.trim() || /\s{2,}/.test(s)
}

/**
 * Scans the whole database for biological / logical impossibilities and common
 * data-entry mistakes. Every check is PRECISION-AWARE (year-only dates never
 * false-flag against precise ones) and BOUNDED (fires only on genuine anomalies,
 * so the list stays short even on very large trees).
 *
 * `fileExists` is injected by the caller (the main process passes `fs.existsSync`)
 * so THIS module never imports `fs` — that keeps it bundleable for the browser
 * demo, which simply omits the missing-media-file check (it has no local files).
 */
export function runSanityCheck(fileExists?: (path: string) => boolean): SanityIssue[] {
  counter = 0
  const people = People.list()
  const families = Families.list()
  const byId = new Map(people.map((p) => [p.id, p]))
  const issues: SanityIssue[] = []
  const ref = (...ps: Person[]): { id: string; name: string }[] =>
    ps.map((p) => ({ id: p.id, name: name(p) }))

  // ---- extra data (loaded once, in bulk) ----
  const db = getDb()
  // Dated person life-events.
  const eventsByPerson = new Map<string, { type: string; date: string; value: string | null }[]>()
  for (const e of db
    .prepare(
      `SELECT owner_id, type, date, value FROM events
       WHERE owner_type = 'person' AND date IS NOT NULL AND date != ''`
    )
    .all() as { owner_id: string; type: string; date: string; value: string | null }[]) {
    const arr = eventsByPerson.get(e.owner_id) ?? []
    arr.push({ type: e.type, date: e.date, value: e.value })
    eventsByPerson.set(e.owner_id, arr)
  }

  // Relationship structure: a child's parents + parent-family, for ancestry checks.
  const parentsOf = new Map<string, string[]>() // childId → [known parent ids]
  const parentFamOf = new Map<string, string>() // childId → family id
  const birthFatherOf = new Map<string, string>() // childId → father id in the birth family
  const inAnyFamily = new Set<string>() // appears anywhere (parent or child)
  for (const f of families) {
    const parents = [f.husbandId, f.wifeId].filter((x): x is string => !!x && byId.has(x))
    if (f.husbandId) inAnyFamily.add(f.husbandId)
    if (f.wifeId) inAnyFamily.add(f.wifeId)
    for (const cid of f.childIds) {
      if (!byId.has(cid)) continue
      inAnyFamily.add(cid)
      if (!parentsOf.has(cid)) {
        parentsOf.set(cid, parents)
        parentFamOf.set(cid, f.id)
        if (f.husbandId && byId.has(f.husbandId)) birthFatherOf.set(cid, f.husbandId)
      }
    }
  }

  /** Is `anc` a (transitive) ancestor of `desc`? Cycle-safe, depth-bounded. */
  const isAncestor = (anc: string, desc: string): boolean => {
    const seen = new Set<string>()
    const walk = (id: string, depth: number): boolean => {
      if (depth > 300) return false
      for (const par of parentsOf.get(id) ?? []) {
        if (par === anc) return true
        if (!seen.has(par)) {
          seen.add(par)
          if (walk(par, depth + 1)) return true
        }
      }
      return false
    }
    return walk(desc, 0)
  }

  // ---- per-person rules ----
  for (const p of people) {
    const b = decimalYear(p.birthDate)
    const d = decimalYear(p.deathDate)
    const bb = dateBounds(p.birthDate)
    const dd = dateBounds(p.deathDate)

    // Lived older than 120 years.
    if (b !== null && d !== null && d - b > 120) {
      issues.push({ id: nid(), rule: 'age120', severity: 'high', detail: `${name(p)} — ${Math.round(d - b)}`, people: ref(p) })
    }

    // Death recorded before birth (year-level, imports store intra-year unreliably).
    if (bb && dd && Math.floor(dd.hi - 1e-6) < Math.floor(bb.lo)) {
      issues.push({
        id: nid(),
        rule: 'deathBeforeBirth',
        severity: 'high',
        detail: `${name(p)} — * ${yearOf(p.birthDate)} / † ${yearOf(p.deathDate)}`,
        people: ref(p)
      })
    }

    // Burial vs death.
    const bur = dateBounds(p.burialDate)
    if (bur && dd) {
      if (bur.hi < dd.lo - 1e-9) {
        issues.push({
          id: nid(),
          rule: 'burialBeforeDeath',
          severity: 'high',
          detail: `${name(p)} — † ${yearOf(p.deathDate)} / ⚰ ${yearOf(p.burialDate)}`,
          people: ref(p)
        })
      } else if (bur.lo - dd.hi > 0.4) {
        issues.push({
          id: nid(),
          rule: 'burialLongAfterDeath',
          severity: 'medium',
          detail: `${name(p)} — † ${yearOf(p.deathDate)} → ⚰ ${yearOf(p.burialDate)}`,
          people: ref(p)
        })
      }
    }

    // Christening / baptism vs birth.
    const chr = dateBounds(p.christeningDate)
    if (chr && bb) {
      if (bb.lo - chr.hi > -1e-6) {
        issues.push({
          id: nid(),
          rule: 'christeningBeforeBirth',
          severity: 'high',
          detail: `${name(p)} — * ${yearOf(p.birthDate)} / ~ ${yearOf(p.christeningDate)}`,
          people: ref(p)
        })
      } else if (chr.lo - bb.hi > CHRISTENING_LATE) {
        issues.push({
          id: nid(),
          rule: 'christeningLongAfterBirth',
          severity: 'low',
          detail: `${name(p)} — * ${yearOf(p.birthDate)} → ~ ${yearOf(p.christeningDate)}`,
          people: ref(p)
        })
      }
    }

    // Birth date in the future.
    if (bb && bb.lo - NOW_DECIMAL > 2 / 365) {
      issues.push({ id: nid(), rule: 'birthInFuture', severity: 'high', detail: `${name(p)} — * ${yearOf(p.birthDate)}`, people: ref(p) })
    }
    // Death / burial date in the future.
    const futureDeath = (dd && dd.lo - NOW_DECIMAL > 2 / 365) || (bur && bur.lo - NOW_DECIMAL > 2 / 365)
    if (futureDeath) {
      issues.push({
        id: nid(),
        rule: 'deathInFuture',
        severity: 'high',
        detail: `${name(p)} — † ${yearOf(p.deathDate) ?? yearOf(p.burialDate)}`,
        people: ref(p)
      })
    }

    // Born long ago but still recorded as living → almost certainly deceased.
    if (b !== null && d === null && !p.deceased && NOW_YEAR - b > MAX_LIVING_AGE) {
      issues.push({
        id: nid(),
        rule: 'probablyDeceased',
        severity: 'medium',
        detail: `${name(p)} (* ${yearOf(p.birthDate)}) · ~${Math.round(NOW_YEAR - b)}`,
        people: ref(p),
        fixes: [{ kind: 'markDeceased', personId: p.id, personName: name(p) }]
      })
    }

    // Unknown / unrecorded sex.
    if (p.sex !== 'M' && p.sex !== 'F') {
      issues.push({ id: nid(), rule: 'missingSex', severity: 'low', detail: name(p), people: ref(p) })
    }

    // Prefix/suffix stored inside the name, or stray whitespace.
    if (hasAffix(p.givenName) || hasAffix(p.surname)) {
      issues.push({ id: nid(), rule: 'nameHasAffix', severity: 'low', detail: name(p), people: ref(p) })
    }
    if (hasBadWhitespace(p.givenName) || hasBadWhitespace(p.surname)) {
      issues.push({ id: nid(), rule: 'nameWhitespace', severity: 'low', detail: `"${p.givenName} ${p.surname}"`, people: ref(p) })
    }

    // Unparsable / typo dates on the vital fields.
    for (const [dstr] of [
      [p.birthDate],
      [p.deathDate],
      [p.christeningDate],
      [p.burialDate]
    ] as const) {
      if (isUnparsableDate(dstr)) {
        issues.push({ id: nid(), rule: 'unparsableDate', severity: 'medium', detail: `${name(p)} — "${dstr}"`, people: ref(p) })
        break // one per person is enough
      }
    }

    // Life-events vs birth/death.
    for (const ev of eventsByPerson.get(p.id) ?? []) {
      const eb = dateBounds(ev.date)
      if (!eb) continue
      const label = (ev.value || ev.type || '').toString().slice(0, 40)
      if (dd && !POSTMORTEM_TYPES.some((k) => ev.type.toLowerCase().includes(k)) && eb.lo - dd.hi > -1e-6) {
        issues.push({
          id: nid(),
          rule: 'eventAfterDeath',
          severity: 'medium',
          detail: `${name(p)} — ${label} ${yearOf(ev.date)} († ${yearOf(p.deathDate)})`,
          people: ref(p)
        })
      }
      if (bb && bb.lo - eb.hi > -1e-6) {
        issues.push({
          id: nid(),
          rule: 'eventBeforeBirth',
          severity: 'medium',
          detail: `${name(p)} — ${label} ${yearOf(ev.date)} (* ${yearOf(p.birthDate)})`,
          people: ref(p)
        })
      }
    }
  }

  // ---- pedigree cycles: a person is their own ancestor ----
  for (const p of people) {
    if (isAncestor(p.id, p.id)) {
      issues.push({ id: nid(), rule: 'ownAncestor', severity: 'high', detail: name(p), people: ref(p) })
    }
  }

  // ---- disconnected (isolated) people ----
  for (const p of people) {
    if (!inAnyFamily.has(p.id)) {
      issues.push({ id: nid(), rule: 'disconnected', severity: 'low', detail: name(p), people: ref(p) })
    }
  }

  // ---- duplicate couples (same husband + wife across ≥2 families) ----
  const coupleSeen = new Map<string, number>()
  for (const f of families) {
    if (!f.husbandId || !f.wifeId) continue
    const k = `${f.husbandId}|${f.wifeId}`
    coupleSeen.set(k, (coupleSeen.get(k) ?? 0) + 1)
  }
  for (const [k, n] of coupleSeen) {
    if (n < 2) continue
    const [hId, wId] = k.split('|')
    const h = byId.get(hId)
    const w = byId.get(wId)
    if (h && w) {
      issues.push({
        id: nid(),
        rule: 'duplicateCouple',
        severity: 'medium',
        detail: `${name(h)} ⚭ ${name(w)} — ×${n}`,
        people: ref(h, w),
        key: `duplicateCouple|${[hId, wId].sort().join(',')}`
      })
    }
  }

  // ---- family-scoped rules ----
  for (const f of families) {
    const husband = f.husbandId ? byId.get(f.husbandId) : undefined
    const wife = f.wifeId ? byId.get(f.wifeId) : undefined
    const marrB = dateBounds(f.marriageDate)
    const children = f.childIds.map((id) => byId.get(id)).filter((c): c is Person => !!c)

    // Unparsable marriage date.
    if (isUnparsableDate(f.marriageDate) && (husband || wife)) {
      issues.push({
        id: nid(),
        rule: 'unparsableDate',
        severity: 'medium',
        detail: `⚭ "${f.marriageDate}" — ${name(husband ?? wife!)}`,
        people: ref(...[husband, wife].filter((x): x is Person => !!x))
      })
    }

    // Recorded sex vs parent role.
    const husbandIsF = !!husband && husband.sex === 'F'
    const wifeIsM = !!wife && wife.sex === 'M'
    if (husbandIsF && wifeIsM && husband && wife) {
      // Both slots hold the wrong-sex person → the parents are swapped. ONE issue
      // with a one-click "swap parents" fix.
      issues.push({
        id: nid(),
        rule: 'parentsSwapped',
        severity: 'medium',
        detail: `${name(husband)} ⚭ ${name(wife)}`,
        people: ref(husband, wife),
        fixes: [
          { kind: 'swapParents', familyId: f.id, husbandId: husband.id, wifeId: wife.id, label: `${name(husband)} ⚭ ${name(wife)}` }
        ],
        key: `parentsSwapped|${[husband.id, wife.id].sort().join(',')}`
      })
    } else {
      if (husbandIsF && husband) {
        // A female in the husband/father slot. If the wife slot is free, offer to
        // move her there; otherwise (ambiguous) just flag.
        const fixes: SanityFix[] | undefined = !wife
          ? [{ kind: 'moveParentSlot', familyId: f.id, personId: husband.id, to: 'wife', personName: name(husband) }]
          : undefined
        issues.push({ id: nid(), rule: 'sexRoleMismatch', severity: 'medium', detail: `${name(husband)} — ♀`, people: ref(husband), fixes })
      }
      if (wifeIsM && wife) {
        const fixes: SanityFix[] | undefined = !husband
          ? [{ kind: 'moveParentSlot', familyId: f.id, personId: wife.id, to: 'husband', personName: name(wife) }]
          : undefined
        issues.push({ id: nid(), rule: 'sexRoleMismatch', severity: 'medium', detail: `${name(wife)} — ♂`, people: ref(wife), fixes })
      }
    }

    // Spouses are close blood relatives.
    if (husband && wife) {
      const sameParentFam =
        parentFamOf.has(husband.id) && parentFamOf.get(husband.id) === parentFamOf.get(wife.id)
      const related = sameParentFam || isAncestor(husband.id, wife.id) || isAncestor(wife.id, husband.id)
      if (related) {
        issues.push({
          id: nid(),
          rule: 'marriedRelative',
          severity: 'high',
          detail: `${name(husband)} ⚭ ${name(wife)}`,
          people: ref(husband, wife)
        })
      }

      // Large age difference between spouses (a notice).
      const hb = decimalYear(husband.birthDate)
      const wb = decimalYear(wife.birthDate)
      if (hb !== null && wb !== null && Math.abs(hb - wb) > SPOUSE_AGE_GAP) {
        issues.push({
          id: nid(),
          rule: 'spouseAgeGap',
          severity: 'low',
          detail: `${name(husband)} (* ${yearOf(husband.birthDate)}) — ${name(wife)} (* ${yearOf(wife.birthDate)}), ${Math.round(Math.abs(hb - wb))}`,
          people: ref(husband, wife)
        })
      }

      // Married name apparently entered as the maiden name — but ONLY when we can
      // actually confirm it: the wife carries the husband's surname AND her own
      // recorded father has a DIFFERENT surname (so her field can't be her real
      // maiden name). If her father shares the surname she was genuinely born with
      // it (no flag); with no recorded father we can't tell, so we stay silent —
      // this avoids noise on common shared surnames (e.g. two unrelated "Nagy"s).
      if (
        wife.surname &&
        husband.surname &&
        wife.surname.trim().toLowerCase() === husband.surname.trim().toLowerCase()
      ) {
        const fatherId = birthFatherOf.get(wife.id)
        const father = fatherId ? byId.get(fatherId) : undefined
        if (
          father &&
          father.surname &&
          father.surname.trim().toLowerCase() !== wife.surname.trim().toLowerCase()
        ) {
          issues.push({
            id: nid(),
            rule: 'marriedNameAsMaiden',
            severity: 'medium',
            detail: `${name(wife)} — ${wife.surname} (${name(father)}: ${father.surname})`,
            people: ref(wife, husband)
          })
        }
      }
    }

    // Marriage vs each spouse's own life.
    for (const sp of [husband, wife]) {
      if (!sp || !marrB) continue
      const dB = dateBounds(sp.deathDate)
      if (dB && marrB.lo - dB.hi > 1e-6) {
        issues.push({
          id: nid(),
          rule: 'marriageAfterDeath',
          severity: 'high',
          detail: `${name(sp)} († ${yearOf(sp.deathDate)}) — ⚭ ${yearOf(f.marriageDate)}`,
          people: ref(sp)
        })
      }
      const spBB = dateBounds(sp.birthDate)
      if (spBB) {
        if (spBB.lo - marrB.hi > -1e-6) {
          issues.push({
            id: nid(),
            rule: 'marriedBeforeBirth',
            severity: 'high',
            detail: `${name(sp)} (* ${yearOf(sp.birthDate)}) — ⚭ ${yearOf(f.marriageDate)}`,
            people: ref(sp)
          })
        } else if (marrB.hi - spBB.lo < MIN_MARRY_AGE) {
          issues.push({
            id: nid(),
            rule: 'marriedTooYoung',
            severity: 'medium',
            detail: `${name(sp)} (* ${yearOf(sp.birthDate)}) — ⚭ ${yearOf(f.marriageDate)}`,
            people: ref(sp)
          })
        }
      }
    }

    // Too many children in one family.
    if (children.length > MANY_CHILDREN) {
      issues.push({
        id: nid(),
        rule: 'tooManyChildren',
        severity: 'low',
        detail: `${name(husband ?? wife ?? children[0])} — ${children.length}`,
        people: ref(...[husband, wife].filter((x): x is Person => !!x))
      })
    }

    // Family with children but no recorded parents.
    if (children.length > 0 && !husband && !wife) {
      issues.push({
        id: nid(),
        rule: 'parentlessFamily',
        severity: 'medium',
        detail: `${children.length} — ${children.map((c) => name(c)).slice(0, 3).join(', ')}`,
        people: ref(...children.slice(0, 4))
      })
    }

    // Per-child parent rules.
    for (const c of children) {
      const cbb = dateBounds(c.birthDate)
      if (!cbb) continue
      const cb = decimalYear(c.birthDate) as number

      // Child born before the parents married (a notice — pre-marital birth or
      // a wrong marriage date). Only when CERTAINLY before.
      if (marrB && marrB.lo - cbb.hi > -1e-6) {
        issues.push({
          id: nid(),
          rule: 'childBeforeMarriage',
          severity: 'low',
          detail: `${name(c)} (* ${yearOf(c.birthDate)}) — ⚭ ${yearOf(f.marriageDate)}`,
          people: ref(c)
        })
      }

      // Child born after mother's death.
      if (wife) {
        const mdd = dateBounds(wife.deathDate)
        if (mdd && cbb.lo - mdd.hi > 1e-6) {
          issues.push({
            id: nid(),
            rule: 'bornAfterMotherDeath',
            severity: 'high',
            detail: `${name(c)} (* ${yearOf(c.birthDate)}) — ${name(wife)} († ${yearOf(wife.deathDate)})`,
            people: ref(c, wife)
          })
        }
      }

      // Father died before the child could be conceived (~9 months before birth).
      if (husband) {
        const fdd = dateBounds(husband.deathDate)
        if (fdd && cbb.lo - 0.75 - fdd.hi > 1e-6) {
          issues.push({
            id: nid(),
            rule: 'fatherDiedBeforeConception',
            severity: 'high',
            detail: `${name(c)} (* ${yearOf(c.birthDate)}) — ${name(husband)} († ${yearOf(husband.deathDate)})`,
            people: ref(c, husband)
          })
        }
      }

      // Parent age at the child's birth: born-after-child / too-young / too-old.
      for (const parent of [husband, wife]) {
        if (!parent) continue
        const pbb = dateBounds(parent.birthDate)
        if (!pbb) continue
        const pb = decimalYear(parent.birthDate) as number
        if (pbb.lo - cbb.hi > 1e-6) {
          issues.push({
            id: nid(),
            rule: 'parentBornAfterChild',
            severity: 'high',
            detail: `${name(parent)} (* ${yearOf(parent.birthDate)}) — ${name(c)} (* ${yearOf(c.birthDate)})`,
            people: ref(parent, c)
          })
        } else if (cbb.hi - pbb.lo < 13) {
          issues.push({
            id: nid(),
            rule: 'parentTooYoung',
            severity: 'medium',
            detail: `${name(parent)} (* ${yearOf(parent.birthDate)}) — ${name(c)} (* ${yearOf(c.birthDate)}), ${Math.round(cb - pb)}`,
            people: ref(parent, c)
          })
        } else {
          // Too old at birth — mothers/fathers have different ceilings. Flag only
          // when even the YOUNGEST plausible age exceeds the ceiling.
          const minAge = cbb.lo - pbb.hi
          const ceiling = parent === wife ? MAX_MOTHER_AGE : MAX_FATHER_AGE
          if (minAge > ceiling) {
            issues.push({
              id: nid(),
              rule: 'parentTooOld',
              severity: 'medium',
              detail: `${name(parent)} (* ${yearOf(parent.birthDate)}) — ${name(c)} (* ${yearOf(c.birthDate)}), ${Math.round(cb - pb)}`,
              people: ref(parent, c)
            })
          }
        }
      }
    }

    // Siblings sharing the same given name (necronym / possible duplicate).
    const givenSeen = new Map<string, Person>()
    for (const c of children) {
      const g = (c.givenName || '').trim().toLowerCase()
      if (!g) continue
      const prev = givenSeen.get(g)
      if (prev) {
        issues.push({
          id: nid(),
          rule: 'siblingSameName',
          severity: 'low',
          detail: `${name(prev)} — ${name(c)}`,
          people: ref(prev, c)
        })
      } else {
        givenSeen.set(g, c)
      }
    }

    // Single births CERTAINLY less than 8 months apart (precision-aware).
    const dated = children
      .map((c) => ({ c, pt: decimalYear(c.birthDate), bounds: dateBounds(c.birthDate) }))
      .filter(
        (x): x is { c: Person; pt: number; bounds: { lo: number; hi: number } } =>
          x.pt !== null && x.bounds !== null
      )
      .sort((a, b) => a.pt - b.pt)
    for (let i = 1; i < dated.length; i++) {
      const ptGap = dated[i].pt - dated[i - 1].pt
      const maxGap = dated[i].bounds.hi - dated[i - 1].bounds.lo
      if (ptGap > 0.02 && maxGap < 8 / 12) {
        issues.push({
          id: nid(),
          rule: 'siblingsTooClose',
          severity: 'medium',
          detail: `${name(dated[i - 1].c)} (* ${yearOf(dated[i - 1].c.birthDate)}) — ${name(dated[i].c)} (* ${yearOf(dated[i].c.birthDate)})`,
          people: ref(dated[i - 1].c, dated[i].c)
        })
      }
    }
  }

  // ---- missing / broken media files (only when the caller can touch the FS) ----
  if (fileExists)
    for (const doc of db
      .prepare('SELECT id, title, file_path FROM documents')
      .all() as { id: string; title: string; file_path: string }[]) {
      const fp = doc.file_path || ''
      if (!fp || /^(https?|data):/i.test(fp)) continue // remote links / data URLs aren't files
      if (fileExists(fp)) continue
    const linked = (
      db.prepare('SELECT person_id FROM person_documents WHERE document_id = ?').all(doc.id) as {
        person_id: string
      }[]
    )
      .map((r) => byId.get(r.person_id))
      .filter((x): x is Person => !!x)
    issues.push({
      id: nid(),
      rule: 'missingMediaFile',
      severity: 'medium',
      detail: `${doc.title || fp.split(/[\\/]/).pop() || fp}`,
      people: ref(...linked.slice(0, 4)),
      key: `missingMediaFile|${doc.id}`
    })
  }

  // Attach a stable key and drop anomalies the user marked as false positives.
  const dismissed = DismissedIssues.all()
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 }
  const keyed = issues
    .map((i) => ({ ...i, key: i.key ?? `${i.rule}|${i.people.map((p) => p.id).sort().join(',')}` }))
    .filter((i) => !dismissed.has(i.key))
  // Highest severity first (stable within a severity).
  return keyed.sort((a, b) => rank[a.severity] - rank[b.severity])
}
