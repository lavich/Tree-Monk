/**
 * Pedigree collapse ("ősvesztés" / Ahnenschwund) detection.
 *
 * Walks the WHOLE ancestor tree of a root person along EVERY path — Ahnentafel
 * (Sosa) numbering: root=1, father(n)=2n, mother(n)=2n+1 — deliberately WITHOUT
 * deduplication, so an ancestor reached through two different branches occupies
 * two positions. Everyone holding 2+ positions is a collapsed ancestor.
 *
 * Only BIRTH parent links are followed (adopted/foster/step lines carry no
 * blood collapse). Dirty-data "own ancestor" loops are guarded per-path, and a
 * generation cap + position fuse keep pathological trees from exploding.
 */
import type { Family } from '@shared/types'

export interface ParentLink {
  father: string | null
  mother: string | null
}

export interface CollapseOccurrence {
  /** Ahnentafel position (root = 1, father = 2n, mother = 2n+1). */
  sosa: number
  /** Generation distance from the root (parents = 1). */
  gen: number
}

export interface CollapsedAncestor {
  personId: string
  count: number
  occurrences: CollapseOccurrence[]
}

export interface CollapseResult {
  rootId: string
  /** Deepest generation actually reached. */
  generations: number
  /** Ancestor POSITIONS filled (root excluded) — with collapse ≥ distinct. */
  positions: number
  /** Distinct persons among those positions. */
  distinct: number
  /** Implex (Ahnenschwund) %: share of positions occupied by repeats. */
  implexPct: number
  /** Ancestors occupying 2+ positions — most-collapsed first. */
  collapsed: CollapsedAncestor[]
  /** True when a safety cap cut the walk short (result still usable). */
  truncated: boolean
}

const MAX_GEN = 25
const MAX_POSITIONS = 200_000

/** '' / null / 'birth' all mean a biological link (the UI stores '' as birth). */
const isBirth = (rel: string | null | undefined): boolean => !rel || rel === 'birth'

/**
 * child → biological {father, mother}. A child linked into several families
 * (birth + adoptive) resolves to the birth-side parents; duplicate/messy birth
 * rows fill each slot only once so no branch is walked twice.
 */
export function buildBirthParents(families: Family[], validIds: Set<string>): Map<string, ParentLink> {
  const parents = new Map<string, ParentLink>()
  for (const f of families) {
    for (const cid of f.childIds) {
      if (!validIds.has(cid)) continue
      const rel = f.childRelations?.[cid]
      const cur = parents.get(cid) ?? { father: null, mother: null }
      if (!cur.father && f.husbandId && validIds.has(f.husbandId) && isBirth(rel?.father)) cur.father = f.husbandId
      if (!cur.mother && f.wifeId && validIds.has(f.wifeId) && isBirth(rel?.mother)) cur.mother = f.wifeId
      parents.set(cid, cur)
    }
  }
  return parents
}

export function computePedigreeCollapse(
  rootId: string,
  validIds: Set<string>,
  parents: Map<string, ParentLink>
): CollapseResult {
  const occ = new Map<string, CollapseOccurrence[]>()
  let positions = 0
  let generations = 0
  let truncated = false

  interface Slot {
    id: string
    sosa: number
    gen: number
    /** Persons already on THIS root→here path — cycle guard for loop-y data. */
    path: Set<string>
  }
  const queue: Slot[] = [{ id: rootId, sosa: 1, gen: 0, path: new Set([rootId]) }]
  let qi = 0
  while (qi < queue.length) {
    const cur = queue[qi++]
    if (cur.gen > 0) {
      positions++
      if (cur.gen > generations) generations = cur.gen
      const list = occ.get(cur.id)
      if (list) list.push({ sosa: cur.sosa, gen: cur.gen })
      else occ.set(cur.id, [{ sosa: cur.sosa, gen: cur.gen }])
    }
    if (cur.gen >= MAX_GEN) {
      truncated = true
      continue
    }
    if (positions + (queue.length - qi) > MAX_POSITIONS) {
      truncated = true
      continue
    }
    const p = parents.get(cur.id)
    for (const [next, sosa] of [
      [p?.father, cur.sosa * 2],
      [p?.mother, cur.sosa * 2 + 1]
    ] as [string | null | undefined, number][]) {
      if (!next || !validIds.has(next)) continue
      if (cur.path.has(next)) continue // own-ancestor loop in the data — stop this line
      queue.push({ id: next, sosa, gen: cur.gen + 1, path: new Set(cur.path).add(next) })
    }
  }

  const collapsed: CollapsedAncestor[] = []
  for (const [personId, occurrences] of occ) {
    if (occurrences.length < 2) continue
    occurrences.sort((a, b) => a.sosa - b.sosa)
    collapsed.push({ personId, count: occurrences.length, occurrences })
  }
  collapsed.sort((a, b) => b.count - a.count || a.occurrences[0].gen - b.occurrences[0].gen)

  const distinct = occ.size
  return {
    rootId,
    generations,
    positions,
    distinct,
    implexPct: positions > 0 ? ((positions - distinct) / positions) * 100 : 0,
    collapsed,
    truncated
  }
}

/**
 * The persons along the root→ancestor path a Sosa number encodes (root first):
 * the bits after the leading 1, MSB→LSB, read 0=father / 1=mother.
 */
export function sosaPath(rootId: string, sosa: number, parents: Map<string, ParentLink>): string[] {
  const bits: number[] = []
  for (let s = sosa; s > 1; s = Math.floor(s / 2)) bits.push(s % 2)
  bits.reverse()
  const path = [rootId]
  let cur = rootId
  for (const b of bits) {
    const next = b === 0 ? parents.get(cur)?.father : parents.get(cur)?.mother
    if (!next) return path // broken link — return what resolved
    path.push(next)
    cur = next
  }
  return path
}
