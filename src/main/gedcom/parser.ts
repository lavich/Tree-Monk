/**
 * Minimal, dependency-free GEDCOM 5.5.1 line parser.
 * GEDCOM is a line-based hierarchical format:
 *   LEVEL [@XREF@] TAG [VALUE]
 */

export interface GedNode {
  level: number
  xref: string | null
  tag: string
  value: string
  children: GedNode[]
}

const LINE_RE = /^\s*(\d+)\s+(?:(@[^@]+@)\s+)?([A-Za-z0-9_]+)(?:\s(.*))?$/

export function parseGedcom(text: string): GedNode[] {
  const lines = text.split(/\r\n|\r|\n/)
  const roots: GedNode[] = []
  // stack[level] holds the most recent node at that level.
  const stack: GedNode[] = []

  for (const raw of lines) {
    if (!raw.trim()) continue
    const m = LINE_RE.exec(raw)
    if (!m) continue
    const level = parseInt(m[1], 10)
    const node: GedNode = {
      level,
      xref: m[2] ?? null,
      tag: m[3],
      value: (m[4] ?? '').trim(),
      children: []
    }
    if (level === 0) {
      roots.push(node)
      stack.length = 0
      stack[0] = node
    } else {
      const parent = stack[level - 1]
      if (parent) {
        // CONT/CONC continue the parent's value across lines.
        if (node.tag === 'CONT') {
          parent.value += '\n' + node.value
          continue
        }
        if (node.tag === 'CONC') {
          parent.value += node.value
          continue
        }
        parent.children.push(node)
      }
      stack[level] = node
      stack.length = level + 1
    }
  }
  return roots
}

export function child(node: GedNode, tag: string): GedNode | undefined {
  return node.children.find((c) => c.tag === tag)
}

export function childValue(node: GedNode, tag: string): string | null {
  return child(node, tag)?.value || null
}

/** Reads an event's DATE / PLAC sub-records (e.g. BIRT, DEAT, MARR). */
export function eventDetails(
  node: GedNode,
  tag: string
): { date: string | null; place: string | null } {
  const ev = child(node, tag)
  if (!ev) return { date: null, place: null }
  return {
    date: childValue(ev, 'DATE'),
    place: childValue(ev, 'PLAC')
  }
}

/** Parses a GEDCOM coordinate like "N47.6628" / "47.6628" / "W19.8" into a signed float. */
export function parseCoord(raw: string | null): number | null {
  if (!raw) return null
  const m = raw.trim().match(/^([NSEW])?\s*(-?\d+(?:\.\d+)?)/i)
  if (!m) return null
  let v = parseFloat(m[2])
  const hemi = m[1]?.toUpperCase()
  if (hemi === 'S' || hemi === 'W') v = -Math.abs(v)
  return Number.isFinite(v) ? v : null
}

export interface GedPlace {
  name: string
  lat: number | null
  lon: number | null
  /** GOV id (gov.genealogy.net) from a shared `_LOC` place record. */
  govId: string | null
  /** The `_LOC` record's primary NAME when a PLAC spelling references one —
   *  the source file's own "this spelling means THAT place" mapping. */
  canonical: string | null
}

/**
 * Walks the whole record tree, yielding every place the file knows something
 * about: PLAC nodes with inline MAP coordinates, plus the shared place records
 * of the German GEDCOM-L extension (`0 @L1@ _LOC` — written by
 * the German genealogy programs) with their coordinates and GOV id. A PLAC carrying a
 * `_LOC @L1@` pointer inherits that record's data.
 */
export function collectPlaces(roots: GedNode[]): GedPlace[] {
  const locByXref = new Map<string, { name: string; lat: number | null; lon: number | null; govId: string | null }>()
  for (const r of roots) {
    if (r.tag !== '_LOC' || !r.xref) continue
    const name = childValue(r, 'NAME')?.trim()
    if (!name) continue
    const map = child(r, 'MAP')
    locByXref.set(r.xref, {
      name,
      lat: map ? parseCoord(childValue(map, 'LATI')) : null,
      lon: map ? parseCoord(childValue(map, 'LONG')) : null,
      govId: childValue(r, '_GOV')?.trim() || null
    })
  }
  const out: GedPlace[] = []
  for (const loc of locByXref.values()) out.push({ ...loc, canonical: null })
  const walk = (node: GedNode): void => {
    if (node.tag === 'PLAC' && node.value) {
      const name = node.value.trim()
      const map = child(node, 'MAP')
      let lat = map ? parseCoord(childValue(map, 'LATI')) : null
      let lon = map ? parseCoord(childValue(map, 'LONG')) : null
      const locPtr = childValue(node, '_LOC')
      const loc = locPtr ? locByXref.get(locPtr) : undefined
      if (loc) {
        if (lat === null || lon === null) {
          lat = loc.lat
          lon = loc.lon
        }
        out.push({ name, lat, lon, govId: loc.govId, canonical: loc.name !== name ? loc.name : null })
      } else if (lat !== null && lon !== null) {
        out.push({ name, lat, lon, govId: null, canonical: null })
      }
    }
    node.children.forEach(walk)
  }
  roots.forEach(walk)
  return out
}
