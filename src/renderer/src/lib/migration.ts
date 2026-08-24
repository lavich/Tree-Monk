/**
 * Migration view data: ancestor branches of a root person, their movements
 * between plotted life events, presence intervals ("stays") at each location,
 * and the space-time overlaps where the paternal and maternal sides could
 * actually have met.
 *
 * Pure functions over the atlas points + families — the map view animates the
 * result, nothing here touches the DB or the network.
 */
import type { AtlasPoint, Family } from '@shared/types'
import { buildBirthParents, type ParentLink } from './pedigreeCollapse'

/** root + parents + the four grandparent ancestor lines. */
export type BranchKey = 'root' | 'father' | 'mother' | 'ff' | 'fm' | 'mf' | 'mm'
export type BranchSide = 'root' | 'paternal' | 'maternal'

export const BRANCH_COLOR: Record<BranchKey, string> = {
  root: '#f59e0b',
  father: '#3b82f6',
  ff: '#2563eb',
  fm: '#06b6d4',
  mother: '#ef4444',
  mf: '#e11d48',
  mm: '#f97316'
}

export function branchSide(b: BranchKey): BranchSide {
  if (b === 'root') return 'root'
  return b === 'father' || b === 'ff' || b === 'fm' ? 'paternal' : 'maternal'
}

/** One relocation: a person's two consecutive located events at different spots. */
export interface MigMove {
  personId: string
  personName: string
  branch: BranchKey
  fromLat: number
  fromLon: number
  toLat: number
  toLon: number
  /** Arrival year (the destination event's year, else the origin's). */
  year: number
  fromPlace: string
  toPlace: string
}

/** A presence interval: person X was around `place` from `from` to `to`. */
export interface MigStay {
  personId: string
  personName: string
  branch: BranchKey
  lat: number
  lon: number
  place: string
  from: number
  to: number
}

/** Paternal & maternal presence overlapping at one location. */
export interface MigMeeting {
  lat: number
  lon: number
  place: string
  /** Overlap window (padded by MEET_PAD on both sides of each stay). */
  from: number
  to: number
  people: { personId: string; personName: string; branch: BranchKey; from: number; to: number }[]
}

export interface MigrationData {
  branches: Map<string, BranchKey>
  moves: MigMove[]
  stays: MigStay[]
  meetings: MigMeeting[]
  /** Year span of the animation (dated material only). */
  span: { min: number; max: number } | null
}

const MAX_ANCESTOR_WALK = 100_000
/** Two stays "could have met" when their intervals get within this many years. */
const MEET_PAD = 5
/** Coordinate cell for meeting detection (~2 km at European latitudes). */
const CELL = 0.02

/**
 * Assigns every ancestor of `rootId` to a branch: the root, the two parents,
 * and the four grandparent lines (each grandparent + ALL their ancestors).
 * With pedigree collapse an ancestor can sit in several branches — the first
 * assignment (ff → fm → mf → mm order) wins, so each person animates once.
 */
export function assignBranches(
  rootId: string,
  validIds: Set<string>,
  families: Family[]
): Map<string, BranchKey> {
  const parents = buildBirthParents(families, validIds)
  const out = new Map<string, BranchKey>()
  out.set(rootId, 'root')
  const link: ParentLink | undefined = parents.get(rootId)
  const father = link?.father ?? null
  const mother = link?.mother ?? null
  if (father) out.set(father, 'father')
  if (mother) out.set(mother, 'mother')
  const seeds: [string | null, BranchKey][] = [
    [father ? (parents.get(father)?.father ?? null) : null, 'ff'],
    [father ? (parents.get(father)?.mother ?? null) : null, 'fm'],
    [mother ? (parents.get(mother)?.father ?? null) : null, 'mf'],
    [mother ? (parents.get(mother)?.mother ?? null) : null, 'mm']
  ]
  let walked = 0
  for (const [seed, branch] of seeds) {
    if (!seed) continue
    const queue = [seed]
    while (queue.length && walked < MAX_ANCESTOR_WALK) {
      const id = queue.shift()!
      if (out.has(id)) continue
      out.set(id, branch)
      walked++
      const p = parents.get(id)
      if (p?.father) queue.push(p.father)
      if (p?.mother) queue.push(p.mother)
    }
  }
  return out
}

/** Same ordering the atlas timeline uses (birth first, burial last). */
const KIND_WEIGHT: Record<string, number> = {
  birth: 0,
  christening: 1,
  marriage: 2,
  residence: 2,
  other: 2,
  death: 8,
  burial: 9
}
function sortLife(points: AtlasPoint[]): AtlasPoint[] {
  return [...points].sort((a, b) => {
    const ya = a.year ?? (KIND_WEIGHT[a.kind] <= 1 ? -1 : 9999)
    const yb = b.year ?? (KIND_WEIGHT[b.kind] <= 1 ? -1 : 9999)
    if (ya !== yb) return ya - yb
    const d = (a.date ?? '').localeCompare(b.date ?? '')
    if (d !== 0) return d
    return KIND_WEIGHT[a.kind] - KIND_WEIGHT[b.kind]
  })
}

const samePlace = (a: AtlasPoint, b: AtlasPoint): boolean =>
  Math.abs(a.lat - b.lat) < 0.005 && Math.abs(a.lon - b.lon) < 0.005

export function buildMigration(points: AtlasPoint[], branches: Map<string, BranchKey>): MigrationData {
  const perPerson = new Map<string, AtlasPoint[]>()
  for (const p of points) {
    if (!branches.has(p.personId)) continue
    const arr = perPerson.get(p.personId) ?? []
    arr.push(p)
    perPerson.set(p.personId, arr)
  }

  const moves: MigMove[] = []
  const stays: MigStay[] = []
  let min = Infinity
  let max = -Infinity

  for (const [pid, pts] of perPerson) {
    const branch = branches.get(pid)!
    const life = sortLife(pts)
    const dated = life.filter((p) => p.year !== null)
    for (const p of dated) {
      if (p.year! < min) min = p.year!
      const end = p.endYear ?? p.year!
      if (end > max) max = end
    }
    // Moves: consecutive DATED events at different spots.
    for (let i = 1; i < dated.length; i++) {
      const a = dated[i - 1]
      const b = dated[i]
      if (samePlace(a, b)) continue
      moves.push({
        personId: pid,
        personName: b.personName,
        branch,
        fromLat: a.lat,
        fromLon: a.lon,
        toLat: b.lat,
        toLon: b.lon,
        year: b.year!,
        fromPlace: a.place,
        toPlace: b.place
      })
    }
    // Stays: from each dated event until the next dated event (or its own
    // range end) — the interval the person can be placed at that location.
    for (let i = 0; i < dated.length; i++) {
      const p = dated[i]
      const next = dated[i + 1]
      const to = Math.max(p.endYear ?? p.year!, next ? next.year! : p.year!)
      stays.push({
        personId: pid,
        personName: p.personName,
        branch,
        lat: p.lat,
        lon: p.lon,
        place: p.place,
        from: p.year!,
        to
      })
    }
  }

  // Meetings: group stays into ~2 km cells, then look for paternal × maternal
  // interval overlaps (±MEET_PAD years) inside each cell.
  const cells = new Map<string, MigStay[]>()
  for (const s of stays) {
    if (s.branch === 'root') continue
    const key = `${Math.round(s.lat / CELL)}|${Math.round(s.lon / CELL)}`
    const arr = cells.get(key) ?? []
    arr.push(s)
    cells.set(key, arr)
  }
  const meetings: MigMeeting[] = []
  for (const cell of cells.values()) {
    const pat = cell.filter((s) => branchSide(s.branch) === 'paternal')
    const mat = cell.filter((s) => branchSide(s.branch) === 'maternal')
    if (!pat.length || !mat.length) continue
    let from = Infinity
    let to = -Infinity
    const who = new Map<string, { personId: string; personName: string; branch: BranchKey; from: number; to: number }>()
    for (const a of pat)
      for (const b of mat) {
        const s = Math.max(a.from, b.from) - MEET_PAD
        const e = Math.min(a.to, b.to) + MEET_PAD
        if (s > e) continue
        if (s < from) from = s
        if (e > to) to = e
        for (const x of [a, b]) {
          const prev = who.get(x.personId)
          if (prev) {
            prev.from = Math.min(prev.from, x.from)
            prev.to = Math.max(prev.to, x.to)
          } else {
            who.set(x.personId, { personId: x.personId, personName: x.personName, branch: x.branch, from: x.from, to: x.to })
          }
        }
      }
    if (!who.size) continue
    // Anchor the marker on the most common spelling in the cell.
    const nameCount = new Map<string, number>()
    for (const s of cell) nameCount.set(s.place, (nameCount.get(s.place) ?? 0) + 1)
    const place = [...nameCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
    const lat = cell.reduce((s, x) => s + x.lat, 0) / cell.length
    const lon = cell.reduce((s, x) => s + x.lon, 0) / cell.length
    meetings.push({ lat, lon, place, from: Math.round(from), to: Math.round(to), people: [...who.values()] })
  }
  meetings.sort((a, b) => a.from - b.from)

  return {
    branches,
    moves,
    stays,
    meetings,
    span: min <= max ? { min, max } : null
  }
}

/** A gently curved polyline between two points (nicer than a straight line). */
export function arcLine(
  fromLon: number,
  fromLat: number,
  toLon: number,
  toLat: number,
  segments = 16
): [number, number][] {
  const mx = (fromLon + toLon) / 2
  const my = (fromLat + toLat) / 2
  const dx = toLon - fromLon
  const dy = toLat - fromLat
  const h = Math.hypot(dx, dy) || 1
  // Control point: midpoint pushed out perpendicular by ~20% of the distance,
  // capped so long hauls don't balloon off-screen.
  const off = Math.min(h * 0.2, 1.5)
  const cx = mx + (-dy / h) * off
  const cy = my + (dx / h) * off
  const pts: [number, number][] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const a = 1 - t
    pts.push([a * a * fromLon + 2 * a * t * cx + t * t * toLon, a * a * fromLat + 2 * a * t * cy + t * t * toLat])
  }
  return pts
}
