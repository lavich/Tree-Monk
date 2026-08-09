import type { CitationDetail } from '@shared/types'

const NOW = new Date().getFullYear()
const strip = (s: string): string => s.replace(/<[^>]*>/g, ' ')

/**
 * The record year of a FamilySearch citation. FamilySearch does NOT expose a
 * structured source date (it is absent from both the abbreviated and the full
 * source description), so the year lives only in the citation text — but at a
 * reliable position. A FamilySearch citation reads:
 *
 *   "Collection, 1636-1895", FamilySearch (https://… : <accessed date>),
 *    Entry for … , 1889.
 *
 * The record year (1889) is the LAST year, once we strip:
 *   • the parenthetical "(url : accessed date)" — kills the access/database year
 *     (2014, 2024, 2025) that previously polluted the result, and
 *   • collection date ranges like "1636-1895" / "1929-1942".
 *
 * Records whose citation carries no such year (e.g. some civil-registration
 * entries) return null and sort to the bottom.
 */
export function citationYear(
  c: Pick<CitationDetail, 'sourceTitle' | 'sourceAuthor' | 'sourcePublication' | 'page'>
): number | null {
  const text = strip([c.sourceTitle, c.sourceAuthor, c.sourcePublication, c.page].filter(Boolean).join(' '))
    .replace(/\([^)]*\)/g, ' ') // drop "(url : accessed date)" → removes access/db years
    .replace(/\b\d{4}\s*[-–]\s*\d{4}\b/g, ' ') // drop collection date ranges
  const years = (text.match(/\b(1[5-9]\d{2}|20\d{2})\b/g) ?? [])
    .map(Number)
    .filter((y) => y >= 1500 && y <= NOW)
  return years.length ? years[years.length - 1] : null
}

/**
 * Best year for a citation: a structured record date when one exists (GEDCOM
 * `DATA/DATE`, or a future FamilySearch field) and is plausible, otherwise the
 * text heuristic above. Sources with no derivable year return null.
 */
export function sourceYear(
  c: Pick<CitationDetail, 'recordDate' | 'sourceTitle' | 'sourceAuthor' | 'sourcePublication' | 'page'>
): number | null {
  const m = c.recordDate?.match(/\b(1[5-9]\d{2}|20\d{2})\b/)
  if (m) {
    const y = Number(m[1])
    if (y >= 1500 && y <= NOW) return y
  }
  return citationYear(c)
}

/**
 * The date of the EVENT a citation documents, taken from the tree itself.
 *
 * This is the only way to date a BROWSED (unindexed) FamilySearch record. Such
 * a source has no date anywhere in the API — verified against every source
 * endpoint and media type — yet FamilySearch's own interface shows one, because
 * it displays the date of the event the source is tagged to. This reproduces
 * that, using the record type parsed out of FamilySearch's citation text and
 * the date already in the tree.
 *
 * It is DERIVED, never stored: the source itself stays undated, so an export or
 * a contribution back to FamilySearch can never present it as the record's own
 * date. Callers should mark it as inferred in the UI.
 */
export function eventDateForCitation(
  eventTag: string | null | undefined,
  person: {
    birthDate?: string | null
    christeningDate?: string | null
    deathDate?: string | null
    burialDate?: string | null
  } | null,
  marriageDates: (string | null | undefined)[] = []
): string | null {
  if (!eventTag || !person) return null
  switch (eventTag) {
    case 'BIRT':
      return person.birthDate ?? null
    case 'CHR':
      return person.christeningDate ?? person.birthDate ?? null
    case 'DEAT':
      return person.deathDate ?? null
    case 'BURI':
      return person.burialDate ?? person.deathDate ?? null
    case 'MARR': {
      // Only unambiguous when the person has exactly ONE dated marriage —
      // guessing between two would be worse than showing nothing.
      const dated = marriageDates.filter((d): d is string => !!d)
      return dated.length === 1 ? dated[0] : null
    }
    default:
      return null
  }
}

/**
 * Year of {@link eventDateForCitation}, VALIDATED against the register the
 * citation names, or null when it cannot be derived safely.
 *
 * The check matters because FamilySearch users routinely attach one birth
 * record to the parents as well. Without it, a child's 1909 birth register
 * would show the FATHER's birth year on his profile. But the citation states
 * which volumes the image belongs to —
 *
 *   "Hungary, Civil Registration, 1895-1980" ... Births (Szulettek) 1909-1913
 *
 * - and a record cannot lie outside those years. A derived year falling outside
 * ANY stated range is therefore dropped rather than shown.
 */
export function inferredSourceYear(
  c: Pick<CitationDetail, 'eventTag' | 'sourceTitle' | 'sourceAuthor' | 'sourcePublication' | 'page'>,
  person: Parameters<typeof eventDateForCitation>[1],
  marriageDates?: (string | null | undefined)[]
): number | null {
  const d = eventDateForCitation(c.eventTag, person, marriageDates)
  const m = d?.match(/(1[5-9]\d{2}|20\d{2})/)
  if (!m) return null
  const y = Number(m[1])
  if (y < 1500 || y > NOW) return null
  const text = strip([c.sourceTitle, c.sourceAuthor, c.sourcePublication, c.page].filter(Boolean).join(' '))
  const ranges = text.matchAll(/(1[5-9]\d{2}|20\d{2})\s*[-–]\s*(1[5-9]\d{2}|20\d{2})/g)
  for (const r of ranges) {
    const lo = Number(r[1])
    const hi = Number(r[2])
    if (lo <= hi && (y < lo || y > hi)) return null
  }
  return y
}
