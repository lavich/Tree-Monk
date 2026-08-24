/**
 * Blood connections between TWO people: every nearest common ancestor (couple),
 * with the ancestor chain on both sides.
 *
 * The relationship finder's BFS returns the single SHORTEST path — for married
 * distant cousins that is always the marriage itself, which hides exactly what
 * a researcher wants to see (the reported case: both parents descend from the
 * same 17th-century ancestor, and the view only said "durch Heirat"). This
 * complements it: ancestor sets of both people are intersected, reduced to the
 * NEAREST common ancestors, and grouped into couples.
 *
 * Reuses the pedigree-collapse walk conventions: birth parents only, Ahnentafel
 * numbering, cycle guards, the same caps.
 */
import type { Family } from '@shared/types'
import { buildBirthParents, sosaPath, type ParentLink } from './pedigreeCollapse'

export interface BloodConnection {
  /** The common ancestor(s) — one person, or a couple [father, mother]. */
  ids: string[]
  /** Generations up from person A / person B to this ancestor (couple). */
  genA: number
  genB: number
  /** Root→ancestor chains (person ids, root first) for the FIRST id. */
  pathA: string[]
  pathB: string[]
}

export interface BloodResult {
  connections: BloodConnection[]
  /** True when a safety cap cut a walk short (list may be incomplete). */
  truncated: boolean
}

const MAX_GEN = 25
const MAX_POSITIONS = 200_000

interface Hit {
  sosa: number
  gen: number
}

/** Every ancestor of `rootId` with its NEAREST occurrence (min gen, then min
 *  Sosa) — the walk itself follows every path, like the collapse detector. */
function ancestorHits(
  rootId: string,
  validIds: Set<string>,
  parents: Map<string, ParentLink>
): { hits: Map<string, Hit>; truncated: boolean } {
  const hits = new Map<string, Hit>()
  let positions = 0
  let truncated = false
  interface Slot {
    id: string
    sosa: number
    gen: number
    path: Set<string>
  }
  const queue: Slot[] = [{ id: rootId, sosa: 1, gen: 0, path: new Set([rootId]) }]
  let qi = 0
  while (qi < queue.length) {
    const cur = queue[qi++]
    if (cur.gen > 0) {
      positions++
      const prev = hits.get(cur.id)
      if (!prev || cur.gen < prev.gen || (cur.gen === prev.gen && cur.sosa < prev.sosa)) {
        hits.set(cur.id, { sosa: cur.sosa, gen: cur.gen })
      }
    }
    if (cur.gen >= MAX_GEN || positions + (queue.length - qi) > MAX_POSITIONS) {
      truncated = true
      continue
    }
    const p = parents.get(cur.id)
    for (const [next, sosa] of [
      [p?.father, cur.sosa * 2],
      [p?.mother, cur.sosa * 2 + 1]
    ] as [string | null | undefined, number][]) {
      if (!next || !validIds.has(next)) continue
      if (cur.path.has(next)) continue
      queue.push({ id: next, sosa, gen: cur.gen + 1, path: new Set(cur.path).add(next) })
    }
  }
  return { hits, truncated }
}

export function computeBloodConnections(
  aId: string,
  bId: string,
  families: Family[],
  validIds: Set<string>
): BloodResult {
  const parents = buildBirthParents(families, validIds)
  const A = ancestorHits(aId, validIds, parents)
  const B = ancestorHits(bId, validIds, parents)

  // Direct line (one IS the other's ancestor) — the finder's shortest path
  // already shows that chain, so it is not repeated here.
  const common: string[] = []
  for (const id of A.hits.keys()) {
    if (B.hits.has(id)) common.push(id)
  }
  const commonSet = new Set(common)

  // NEAREST only: an ancestor whose on-path child is common on BOTH sides is
  // subsumed by that closer connection (the parents of a common couple are
  // trivially common too — showing them would bury the list in noise).
  const childOn = (rootId: string, hit: Hit): string | null => {
    const path = sosaPath(rootId, hit.sosa, parents)
    return path.length >= 2 ? path[path.length - 2] : null
  }
  const nearest = common.filter((id) => {
    const ca = childOn(aId, A.hits.get(id)!)
    const cb = childOn(bId, B.hits.get(id)!)
    return !(ca && commonSet.has(ca) && cb && commonSet.has(cb))
  })

  // Couple grouping: father (even Sosa) and mother (odd) of the SAME child
  // position on both sides belong to one connection.
  const groups = new Map<string, string[]>()
  for (const id of nearest) {
    const a = A.hits.get(id)!
    const b = B.hits.get(id)!
    const key = `${Math.floor(a.sosa / 2)}|${Math.floor(b.sosa / 2)}`
    const arr = groups.get(key) ?? []
    arr.push(id)
    groups.set(key, arr)
  }

  const connections: BloodConnection[] = []
  for (const ids of groups.values()) {
    // Father (even Sosa on A's side) first, for a stable "X & Y" display.
    ids.sort((x, y) => (A.hits.get(x)!.sosa % 2) - (A.hits.get(y)!.sosa % 2))
    const first = ids[0]
    const a = A.hits.get(first)!
    const b = B.hits.get(first)!
    connections.push({
      ids,
      genA: a.gen,
      genB: b.gen,
      pathA: sosaPath(aId, a.sosa, parents),
      pathB: sosaPath(bId, b.sosa, parents)
    })
  }
  connections.sort((x, y) => x.genA + x.genB - (y.genA + y.genB) || x.genA - y.genA)

  return { connections: connections.slice(0, 100), truncated: A.truncated || B.truncated }
}
