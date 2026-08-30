import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import maplibregl, { type Map as MLMap, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import historicalStyleRaw from '@openhistoricalmap/map-styles/dist/historical/historical.json'
import { filterByDate } from '@openhistoricalmap/maplibre-gl-dates'
import {
  Baby,
  Cross,
  Church,
  Compass,
  Flame,
  Footprints,
  Heart,
  Home,
  Landmark,
  Layers as LayersIcon,
  Locate,
  MapPin,
  Minus,
  Mountain,
  Pause,
  Play,
  Plus,
  Route,
  Search,
  Shovel,
  SlidersHorizontal,
  ChevronUp,
  Sparkles,
  Users,
  X
} from 'lucide-react'
import { cn, fullName, yearOf } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { useTheme } from '@/store/useTheme'
import { useAtlasSettings } from '@/store/useAtlasSettings'
import { PersonAvatar } from '@/components/common/PersonAvatar'
import type { AtlasKind, AtlasPoint, Family } from '@shared/types'
import { PlacesManagerDialog } from './PlacesManagerDialog'
import { ScopePicker, useScopedPeople } from '@/components/common/ScopePicker'
import {
  BRANCH_COLOR,
  assignBranches,
  arcLine,
  buildMigration,
  type BranchKey,
  type MigrationData
} from '@/lib/migration'

/**
 * Atlas — the map view, rebuilt from scratch.
 *
 * A full-bleed MapLibre canvas plotting every geocoded life event as
 * configurable layers (clustered markers / heatmap / migration paths) over
 * swappable basemaps: modern vector light + dark (OpenFreeMap, key-free), and the
 * OpenHistoricalMap period map whose borders follow the year filter. 3D mode
 * adds terrain, sky and real building extrusions. Focusing one person turns
 * the map into their life journey — everyone else disappears and their stops
 * (birth, residences, marriages, death…) run in chronological order, numbered
 * on the map, animated along the route, and listed in a timeline panel.
 */

// ---- Event-kind palette (concrete colors — the GL canvas can't read CSS vars) ----
const KIND_COLOR: Record<AtlasKind, string> = {
  birth: '#10b981',
  christening: '#0ea5e9',
  marriage: '#f43f5e',
  residence: '#f59e0b',
  death: '#64748b',
  burial: '#8b5cf6',
  other: '#14b8a6'
}
const KIND_ICON: Record<AtlasKind, typeof Baby> = {
  birth: Baby,
  christening: Church,
  marriage: Heart,
  residence: Home,
  death: Cross,
  burial: Shovel,
  other: Sparkles
}
const KINDS: AtlasKind[] = ['birth', 'christening', 'marriage', 'residence', 'death', 'burial', 'other']

// ---- Basemaps ----
// Modern vector styles come from OpenFreeMap (no key; own working glyphs;
// "liberty" carries building heights → real 3D extrusions). The period map is
// the OpenHistoricalMap style whose features are filtered by year.
const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron'
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark'
const STYLE_LIBERTY = 'https://tiles.openfreemap.org/styles/liberty'
const STYLE_HISTORICAL = historicalStyleRaw as unknown as StyleSpecification
const OFM_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'
const DEM_TILES = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png']

interface ResolvedStyle {
  key: string
  style: string | StyleSpecification
  /** Font stack that provably exists on this style's glyph server. */
  font: string
}

const EMPTY_FC = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection

/** Chronological sort: year → raw date → life-stage weight (birth first, burial last). */
const STAGE_WEIGHT: Record<AtlasKind, number> = {
  birth: 0,
  christening: 1,
  marriage: 2,
  residence: 2,
  other: 2,
  death: 8,
  burial: 9
}
function chronoSort(points: AtlasPoint[]): AtlasPoint[] {
  return [...points].sort((a, b) => {
    const ya = a.year ?? (STAGE_WEIGHT[a.kind] <= 1 ? -1 : 9999)
    const yb = b.year ?? (STAGE_WEIGHT[b.kind] <= 1 ? -1 : 9999)
    if (ya !== yb) return ya - yb
    const da = (a.date ?? '').localeCompare(b.date ?? '')
    if (da !== 0) return da
    return STAGE_WEIGHT[a.kind] - STAGE_WEIGHT[b.kind]
  })
}

/** filterByDate throws while a style is still loading — guard every call. */
function safeFilterByDate(map: MLMap, year: number): void {
  try {
    if (map.getStyle()?.layers?.length) filterByDate(map, String(year))
  } catch {
    /* style mid-swap — the next rebuild re-applies */
  }
}

/**
 * Show basemap place labels in the app language. OpenFreeMap (OpenMapTiles)
 * vector tiles carry `name:hu` / `name:de` / `name:en` fields, so we rewrite
 * every basemap symbol layer's `text-field` to prefer the chosen language, then
 * fall back to the transliterated latin name and finally the local name. Our own
 * `atlas-*` data layers (cluster counts, journey stops) are left untouched.
 */
function localizeLabels(map: MLMap, lang: string): void {
  const l = (lang || 'en').slice(0, 2)
  const expr = ['coalesce', ['get', `name:${l}`], ['get', 'name:latin'], ['get', 'name']]
  const layers = map.getStyle()?.layers
  if (!layers) return
  for (const layer of layers) {
    if (layer.type !== 'symbol' || layer.id.startsWith('atlas-')) continue
    const tf = (layer as { layout?: { 'text-field'?: unknown } }).layout?.['text-field']
    if (!tf || !JSON.stringify(tf).includes('name')) continue // only name labels
    try {
      map.setLayoutProperty(layer.id, 'text-field', expr)
    } catch {
      /* layer went away mid-swap — the next apply re-localizes */
    }
  }
}

export function AtlasView(): JSX.Element {
  const { t, i18n } = useTranslation()
  const theme = useTheme((s) => s.theme)
  const people = useAppStore((s) => s.people)
  const selectPerson = useAppStore((s) => s.selectPerson)
  const mapFocusPersonId = useAppStore((s) => s.mapFocusPersonId)
  const mapFocusNonce = useAppStore((s) => s.mapFocusNonce)
  const settings = useAtlasSettings()

  const wrapRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const [ready, setReady] = useState(false)
  const [points, setPoints] = useState<AtlasPoint[]>([])
  const [focusId, setFocusId] = useState<string | null>(null)
  const [personQ, setPersonQ] = useState('')
  const [personMenu, setPersonMenu] = useState(false)
  const [geoProg, setGeoProg] = useState<{ done: number; total: number } | null>(null)
  const [placesOpen, setPlacesOpen] = useState(false)
  // The control rail is collapsible but OPEN by default.
  const [railOpen, setRailOpen] = useState(true)
  const dashRaf = useRef<number | undefined>(undefined)
  const fittedOnce = useRef(false)

  // ---- Migration animation (ancestor branches moving over the years) ----
  const [migOn, setMigOn] = useState(false)
  const [migRootId, setMigRootIdRaw] = useState<string | null>(() => localStorage.getItem('tm_mig_root'))
  const setMigRootId = useCallback((id: string | null): void => {
    setMigRootIdRaw(id)
    if (id) localStorage.setItem('tm_mig_root', id)
    else localStorage.removeItem('tm_mig_root')
  }, [])
  const [migQ, setMigQ] = useState('')
  const [migFamilies, setMigFamilies] = useState<Family[] | null>(null)
  const [migPlaying, setMigPlaying] = useState(false)
  const [migSpeed, setMigSpeed] = useState(4)
  const [migYearUI, setMigYearUI] = useState<number | null>(null)
  const [migMeetOpen, setMigMeetOpen] = useState(false)
  const migYearRef = useRef(0)
  const migRaf = useRef<number | undefined>(undefined)
  const migOhmYear = useRef(-9999)
  const migOnRef = useRef(false)
  migOnRef.current = migOn

  // ---- Data ----
  const loadPoints = useCallback(() => {
    void window.api.atlas
      .points()
      .then(setPoints)
      .catch(() => setPoints([]))
  }, [])
  useEffect(loadPoints, [loadPoints, people])

  // Follow "show on map" requests from the person panel: focus the person,
  // switch to the period (historical) basemap and set the time window to
  // their lifespan — so the map truly shows THEIR era. Nonce-guarded: only
  // the button press forces this, afterwards the user can switch freely.
  const lastFocusNonce = useRef(0)
  useEffect(() => {
    if (!mapFocusPersonId || mapFocusNonce === lastFocusNonce.current) return
    lastFocusNonce.current = mapFocusNonce
    setFocusId(mapFocusPersonId)
    const p = people.find((x) => x.id === mapFocusPersonId)
    const b = Number(yearOf(p?.birthDate ?? null)) || null
    const d = Number(yearOf(p?.deathDate ?? null)) || null
    // The period map follows the TOP of the window — anchor it to the BIRTH
    // year, so the map shows the world they were born into.
    //
    // The BASEMAP is deliberately NOT touched. Which map to land on is the
    // caller's decision — the profile offers "historical" and "present-day" —
    // and forcing 'historical' here silently overrode that choice, so the
    // present-day option could never actually show a present-day map. The era
    // anchor only means anything on the period map, so it is applied there.
    const era = b ?? (d ? d - 60 : null)
    const atlas = useAtlasSettings.getState()
    if (era && atlas.basemap === 'historical') atlas.set({ yearFrom: null, yearTo: era })
  }, [mapFocusPersonId, mapFocusNonce, people])

  // Root-based scope (bloodline / ancestors / descendants ± spouses): the
  // same circles as the dashboard, applied to whose events get plotted.
  // "Everyone" with the spouse toggle OFF means the whole tree minus the
  // married-in world — i.e. the root's blood circle.
  const effectiveScope = settings.scope === 'all' && !settings.scopeSpouses ? 'blood' : settings.scope
  const scoped = useScopedPeople(effectiveScope, settings.scopeSpouses)
  const scopeSet = useMemo(
    () => (effectiveScope === 'all' ? null : new Set(scoped.people.map((p) => p.id))),
    [effectiveScope, scoped]
  )
  const hasScopeRoot = !!scoped.root

  const yearBounds = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    for (const p of points) {
      if (p.year) {
        if (p.year < min) min = p.year
        if (p.year > max) max = p.year
      }
    }
    return min <= max ? { min, max } : { min: 1700, max: new Date().getFullYear() }
  }, [points])
  const yFrom = settings.yearFrom ?? yearBounds.min
  const yTo = settings.yearTo ?? yearBounds.max

  // Focus mode shows ONLY the focused person — everyone else disappears from
  // every layer (markers, heat, paths). Kind toggles still apply, but the year
  // window does NOT clip the focused person: in focus mode it drives the
  // period basemap (anchored to their birth year), not their life events.
  const filtered = useMemo(
    () =>
      // Migration mode replaces the base layers with its own animated ones.
      migOn
        ? []
        : points.filter((p) => {
            if (scopeSet && !scopeSet.has(p.personId)) return false
            if (focusId && p.personId !== focusId) return false
            if (!settings.kinds[p.kind]) return false
            if (!focusId && p.year && (p.year < yFrom || p.year > yTo)) return false
            return true
          }),
    [points, settings.kinds, yFrom, yTo, focusId, migOn, scopeSet]
  )

  const journey = useMemo(() => {
    if (!focusId) return []
    return chronoSort(points.filter((p) => p.personId === focusId))
  }, [points, focusId])

  const focusPerson = focusId ? people.find((p) => p.id === focusId) : undefined

  // ---- Migration data ----
  // Families load lazily the first time the mode opens (branch assignment
  // needs the parent links).
  useEffect(() => {
    if (!migOn || migFamilies) return
    void window.api.families
      .list()
      .then(setMigFamilies)
      .catch(() => setMigFamilies([]))
  }, [migOn, migFamilies])

  const migData = useMemo<MigrationData | null>(() => {
    if (!migOn || !migRootId || !migFamilies) return null
    const valid = new Set(people.map((p) => p.id))
    if (!valid.has(migRootId)) return null
    return buildMigration(points, assignBranches(migRootId, valid, migFamilies))
  }, [migOn, migRootId, migFamilies, people, points])

  // Curved arc geometry per move, computed once — the per-frame work is just
  // filtering by year and stamping the age property.
  const migArcs = useMemo(
    () =>
      (migData?.moves ?? []).map((m) => ({
        move: m,
        coords: arcLine(m.fromLon, m.fromLat, m.toLon, m.toLat)
      })),
    [migData]
  )
  const migDataRef = useRef<MigrationData | null>(null)
  migDataRef.current = migData
  const migArcsRef = useRef(migArcs)
  migArcsRef.current = migArcs

  /** GeoJSON for one animation frame: everything that happened up to `year`. */
  const buildMigFrame = useCallback(
    (
      year: number
    ): { lines: GeoJSON.FeatureCollection; dots: GeoJSON.FeatureCollection; meets: GeoJSON.FeatureCollection } => {
      const d = migDataRef.current
      if (!d) return { lines: EMPTY_FC, dots: EMPTY_FC, meets: EMPTY_FC }
      const lines: GeoJSON.Feature[] = []
      for (const a of migArcsRef.current) {
        if (a.move.year > year) continue
        lines.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: a.coords },
          properties: {
            color: BRANCH_COLOR[a.move.branch],
            age: Math.min(year - a.move.year, 60),
            personName: a.move.personName
          }
        })
      }
      // One dot per person at their latest known location (stays fade a few
      // years after they end, so short records don't blink out instantly).
      const latest = new Map<string, { lat: number; lon: number; branch: BranchKey; name: string; to: number }>()
      for (const s of d.stays) {
        if (s.from > year) continue
        const cur = latest.get(s.personId)
        if (!cur || s.from >= cur.to - 0.01 || (s.from <= year && s.to >= year))
          latest.set(s.personId, { lat: s.lat, lon: s.lon, branch: s.branch, name: s.personName, to: s.to })
      }
      const dots: GeoJSON.Feature[] = []
      for (const l of latest.values()) {
        if (year > l.to + 8) continue
        dots.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [l.lon, l.lat] },
          properties: { color: BRANCH_COLOR[l.branch], personName: l.name }
        })
      }
      const meets: GeoJSON.Feature[] = []
      for (const m of d.meetings) {
        if (m.from > year) continue
        meets.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
          properties: { place: m.place, from: m.from, to: m.to, count: m.people.length }
        })
      }
      return {
        lines: { type: 'FeatureCollection', features: lines },
        dots: { type: 'FeatureCollection', features: dots },
        meets: { type: 'FeatureCollection', features: meets }
      }
    },
    []
  )
  const buildMigFrameRef = useRef(buildMigFrame)
  buildMigFrameRef.current = buildMigFrame

  /** Pushes one frame into the live sources (cheap; no layer rebuild). */
  const applyMigFrame = useCallback(
    (year: number): void => {
      const map = mapRef.current
      if (!map) return
      const frame = buildMigFrame(year)
      ;(map.getSource('mig-lines') as maplibregl.GeoJSONSource | undefined)?.setData(frame.lines)
      ;(map.getSource('mig-dots') as maplibregl.GeoJSONSource | undefined)?.setData(frame.dots)
      ;(map.getSource('mig-meets') as maplibregl.GeoJSONSource | undefined)?.setData(frame.meets)
      // The period basemap follows the animation year (throttled — restyling
      // OHM every frame would stutter).
      if (resolvedRef.current.key === 'historical' && Math.abs(year - migOhmYear.current) >= 2) {
        migOhmYear.current = year
        safeFilterByDate(map, Math.round(year))
      }
    },
    [buildMigFrame]
  )

  /** Jump the animation clock (slider, meeting click, reset). */
  const setMigYear = useCallback(
    (year: number): void => {
      migYearRef.current = year
      setMigYearUI(Math.round(year))
      applyMigFrame(year)
    },
    [applyMigFrame]
  )

  // New data (or a new root) rewinds to the start of its span.
  useEffect(() => {
    if (!migData?.span) return
    setMigYear(migData.span.min)
    setMigPlaying(false)
  }, [migData, setMigYear])

  // The animation clock: rAF-driven, writes the sources directly and mirrors
  // the year into React state only a few times a second.
  useEffect(() => {
    if (!migPlaying || !migData?.span) return
    let last = performance.now()
    let tick = 0
    const step = (): void => {
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      let y = migYearRef.current + dt * migSpeed
      if (y >= migData.span!.max) {
        y = migData.span!.max
        setMigPlaying(false)
      }
      migYearRef.current = y
      applyMigFrame(y)
      if (++tick % 8 === 0) setMigYearUI(Math.round(y))
      if (migPlaying) migRaf.current = requestAnimationFrame(step)
    }
    migRaf.current = requestAnimationFrame(step)
    return () => {
      if (migRaf.current) cancelAnimationFrame(migRaf.current)
      setMigYearUI(Math.round(migYearRef.current))
    }
  }, [migPlaying, migSpeed, migData, applyMigFrame])

  const migMatches = useMemo(() => {
    const q = migQ.trim().toLowerCase()
    if (!q) return []
    return people.filter((p) => fullName(p).toLowerCase().includes(q)).slice(0, 40)
  }, [people, migQ])
  const migRoot = migRootId ? people.find((p) => p.id === migRootId) : undefined

  // ---- GeoJSON builders ----
  const pointsFC = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: filtered.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: {
          kind: p.kind,
          color: KIND_COLOR[p.kind],
          personId: p.personId,
          personName: p.personName,
          year: p.year ?? '',
          place: p.place,
          detail: p.detail ?? ''
        }
      }))
    }),
    [filtered]
  )

  const linesFC = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!settings.showPaths || focusId) return EMPTY_FC // focus mode draws the journey instead
    const byPerson = new Map<string, AtlasPoint[]>()
    for (const p of filtered) {
      const arr = byPerson.get(p.personId) ?? []
      arr.push(p)
      byPerson.set(p.personId, arr)
    }
    const features: GeoJSON.Feature[] = []
    for (const arr of byPerson.values()) {
      const path = chronoSort(arr).filter(
        (p, i, a) => i === 0 || p.lat !== a[i - 1].lat || p.lon !== a[i - 1].lon
      )
      if (path.length < 2) continue
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: path.map((p) => [p.lon, p.lat]) },
        properties: {}
      })
    }
    return { type: 'FeatureCollection', features }
  }, [filtered, settings.showPaths, focusId])

  const journeyFC = useMemo<{ line: GeoJSON.FeatureCollection; stops: GeoJSON.FeatureCollection }>(() => {
    const stops = journey.filter(
      (p, i, a) => i === 0 || p.lat !== a[i - 1].lat || p.lon !== a[i - 1].lon || p.kind !== a[i - 1].kind
    )
    return {
      line:
        stops.length >= 2
          ? {
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  geometry: { type: 'LineString', coordinates: stops.map((p) => [p.lon, p.lat]) },
                  properties: {}
                }
              ]
            }
          : EMPTY_FC,
      stops: {
        type: 'FeatureCollection',
        features: stops.map((p, i) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          properties: { n: i + 1, color: KIND_COLOR[p.kind] }
        }))
      }
    }
  }, [journey])

  // ---- Basemap resolution ----
  // 3D over the modern basemaps switches to "liberty" (building heights).
  const resolved = useMemo<ResolvedStyle>(() => {
    const b = settings.basemap
    if (b === 'historical')
      return { key: 'historical', style: STYLE_HISTORICAL, font: 'OpenHistorical Bold' }
    const dark = b === 'dark' || (b === 'auto' && theme === 'dark')
    if (settings.mode === '3d') return { key: 'liberty', style: STYLE_LIBERTY, font: 'Noto Sans Bold' }
    if (dark) return { key: 'dark', style: STYLE_DARK, font: 'Noto Sans Bold' }
    return { key: 'light', style: STYLE_LIGHT, font: 'Noto Sans Bold' }
  }, [settings.basemap, settings.mode, theme])
  const resolvedRef = useRef(resolved)
  resolvedRef.current = resolved

  /**
   * Builds every atlas source + layer from scratch, with the data inline.
   * Sources created empty inside MapLibre's load events proved unreliable
   * (worker-poisoned, rendered nothing) — creating them lazily WITH their
   * data, and rebuilding on any change, is rock solid.
   */
  // Data version: bumped on every input change; ensure() rebuilds only when
  // the applied version is stale, so the styledata storm terminates (the old
  // map's proven idempotent-on-styledata architecture).
  const dataVer = useRef(0)
  const appliedVer = useRef(-1)
  const ensureRef = useRef<() => void>(() => undefined)
  ensureRef.current = (): void => {
    const map = mapRef.current
    // Style object present is enough — addSource/addLayer work while tiles load.
    if (!map || !map.getStyle()?.layers?.length) return
    const font = resolvedRef.current.font
    const fresh = appliedVer.current !== dataVer.current || !map.getSource('points')
    if (!fresh) return
    appliedVer.current = dataVer.current

    for (const id of [
      'atlas-heat',
      'atlas-lines',
      'atlas-clusters',
      'atlas-cluster-count',
      'atlas-pts',
      'atlas-pts-hit',
      'atlas-journey',
      'atlas-journey-dash',
      'atlas-jstops',
      'atlas-jstop-nums',
      'atlas-mig-lines',
      'atlas-mig-meets',
      'atlas-mig-meets-ring',
      'atlas-mig-dots',
      'atlas-buildings'
    ])
      if (map.getLayer(id)) map.removeLayer(id)
    for (const id of ['points', 'heat', 'lines', 'journey', 'jstops', 'mig-lines', 'mig-dots', 'mig-meets'])
      if (map.getSource(id)) map.removeSource(id)

    // Terrain sources (hosted styles don't carry them).
    if (!map.getSource('dem'))
      map.addSource('dem', {
        type: 'raster-dem',
        tiles: DEM_TILES,
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 13,
        // The AWS Terrain Tiles dataset requires crediting its DEM sources.
        attribution: 'Terrain: Mapzen/AWS Terrain Tiles (SRTM/NASA, GMTED, ETOPO1)'
      })

    // Period map follows the TO end of the year window.
    if (resolvedRef.current.key === 'historical') safeFilterByDate(map, yTo)

    // 3D buildings — derive the vector source from the style itself (liberty
    // carries render_height; other styles simply have no 'building' layer).
    if (settings.mode === '3d') {
      const styleRoot = map.getStyle()
      const buildingLayer = styleRoot?.layers?.find(
        (l) => (l as { 'source-layer'?: string })['source-layer'] === 'building' && 'source' in l
      ) as { source?: string } | undefined
      const firstSymbol = styleRoot?.layers?.find((l) => l.type === 'symbol')?.id
      if (buildingLayer?.source && map.getSource(buildingLayer.source)) {
        map.addLayer(
          {
            id: 'atlas-buildings',
            type: 'fill-extrusion',
            source: buildingLayer.source,
            'source-layer': 'building',
            minzoom: 13,
            paint: {
              'fill-extrusion-color': [
                'interpolate',
                ['linear'],
                ['get', 'render_height'],
                0, theme === 'dark' ? '#2a3550' : '#d9dfec',
                60, theme === 'dark' ? '#3c4a72' : '#aeb8d6',
                200, theme === 'dark' ? '#5566a0' : '#8a97c4'
              ],
              'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 15.5, ['get', 'render_height']],
              'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 13, 0, 15.5, ['get', 'render_min_height']],
              'fill-extrusion-opacity': 0.9
            }
          },
          firstSymbol
        )
      }
    }

    map.addSource('heat', { type: 'geojson', data: settings.showHeat ? pointsFC : EMPTY_FC })
    map.addSource('lines', { type: 'geojson', data: linesFC })
    map.addSource('points', {
      type: 'geojson',
      data: settings.showMarkers ? pointsFC : EMPTY_FC,
      cluster: settings.cluster && !focusId,
      clusterRadius: 44,
      clusterMaxZoom: 11
    })
    map.addSource('journey', { type: 'geojson', data: journeyFC.line, lineMetrics: true })
    map.addSource('jstops', { type: 'geojson', data: journeyFC.stops })

    map.addLayer({
      id: 'atlas-heat',
      type: 'heatmap',
      source: 'heat',
      paint: {
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 18, 10, 34],
        'heatmap-intensity': 0.8,
        'heatmap-opacity': 0.75,
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0, 'rgba(20,184,166,0)',
          0.25, 'rgba(20,184,166,0.35)',
          0.5, 'rgba(16,185,129,0.55)',
          0.75, 'rgba(245,158,11,0.75)',
          1, 'rgba(244,63,94,0.9)'
        ]
      }
    })
    map.addLayer({
      id: 'atlas-lines',
      type: 'line',
      source: 'lines',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#14b8a6', 'line-width': 1.4, 'line-opacity': 0.35 }
    })
    map.addLayer({
      id: 'atlas-clusters',
      type: 'circle',
      source: 'points',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#0d9488',
        'circle-opacity': 0.85,
        'circle-radius': ['step', ['get', 'point_count'], 14, 25, 19, 100, 25],
        'circle-stroke-width': 2,
        'circle-stroke-color': 'rgba(255,255,255,0.85)'
      }
    })
    map.addLayer({
      id: 'atlas-cluster-count',
      type: 'symbol',
      source: 'points',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': [font],
        'text-size': 12
      },
      paint: { 'text-color': '#ffffff' }
    })
    map.addLayer({
      id: 'atlas-pts',
      type: 'circle',
      source: 'points',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 5, 10, 7.5],
        'circle-stroke-width': 1.6,
        'circle-stroke-color': 'rgba(255,255,255,0.9)'
      }
    })
    // Invisible, generous hit-halo so the small dots are easy to hover and click
    // (the visible circles stay small). All point interactions target this layer.
    map.addLayer({
      id: 'atlas-pts-hit',
      type: 'circle',
      source: 'points',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': 'rgba(0,0,0,0)',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 12, 10, 16]
      }
    })
    map.addLayer({
      id: 'atlas-journey',
      type: 'line',
      source: 'journey',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-width': 3.5,
        'line-gradient': [
          'interpolate',
          ['linear'],
          ['line-progress'],
          0, '#10b981',
          0.55, '#f59e0b',
          1, '#64748b'
        ]
      }
    })
    map.addLayer({
      id: 'atlas-journey-dash',
      type: 'line',
      source: 'journey',
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': 'rgba(255,255,255,0.9)',
        'line-width': 1.6,
        'line-dasharray': [0, 3, 2]
      }
    })
    map.addLayer({
      id: 'atlas-jstops',
      type: 'circle',
      source: 'jstops',
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': 11,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#ffffff'
      }
    })
    map.addLayer({
      id: 'atlas-jstop-nums',
      type: 'symbol',
      source: 'jstops',
      layout: {
        'text-field': ['to-string', ['get', 'n']],
        'text-font': [font],
        'text-size': 11,
        'text-allow-overlap': true
      },
      paint: { 'text-color': '#ffffff' }
    })

    // Migration animation layers — sources are born WITH the current frame,
    // and the rAF clock only setData()s into them afterwards.
    if (migOnRef.current) {
      const frame = buildMigFrameRef.current(migYearRef.current)
      map.addSource('mig-lines', { type: 'geojson', data: frame.lines })
      map.addSource('mig-dots', { type: 'geojson', data: frame.dots })
      map.addSource('mig-meets', { type: 'geojson', data: frame.meets })
      map.addLayer({
        id: 'atlas-mig-lines',
        type: 'line',
        source: 'mig-lines',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          // Fresh moves draw bold, then settle into a faint permanent trace.
          'line-width': ['interpolate', ['linear'], ['get', 'age'], 0, 3.4, 10, 2.2, 40, 1.1],
          'line-opacity': ['interpolate', ['linear'], ['get', 'age'], 0, 0.95, 10, 0.6, 40, 0.22]
        }
      })
      map.addLayer({
        id: 'atlas-mig-meets-ring',
        type: 'circle',
        source: 'mig-meets',
        paint: {
          'circle-color': 'rgba(168,85,247,0.18)',
          'circle-radius': 15,
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(168,85,247,0.85)'
        }
      })
      map.addLayer({
        id: 'atlas-mig-meets',
        type: 'symbol',
        source: 'mig-meets',
        layout: {
          'text-field': ['to-string', ['get', 'count']],
          'text-font': [font],
          'text-size': 11,
          'text-allow-overlap': true
        },
        paint: { 'text-color': theme === 'dark' ? '#e9d5ff' : '#7e22ce' }
      })
      map.addLayer({
        id: 'atlas-mig-dots',
        type: 'circle',
        source: 'mig-dots',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4.5, 10, 6.5],
          'circle-stroke-width': 1.4,
          'circle-stroke-color': 'rgba(255,255,255,0.9)'
        }
      })
    }

    // Terrain + sky belong to the freshly-built style too (the mode effect only
    // animates the pitch — applying here keeps the order race-free).
    try {
      if (settings.mode === '3d' && map.getSource('dem')) {
        map.setTerrain({ source: 'dem', exaggeration: 1.3 })
        try {
          map.setSky({
            'sky-color': theme === 'dark' ? '#0b1220' : '#87b2d9',
            'sky-horizon-blend': 0.6,
            'horizon-color': theme === 'dark' ? '#5b6b8c' : '#e8eef7',
            'horizon-fog-blend': 0.6,
            'fog-color': theme === 'dark' ? '#0b1220' : '#cdd6e6',
            'fog-ground-blend': 0.7,
            'atmosphere-blend': 0.8
          })
        } catch {
          /* older maplibre without sky */
        }
      } else {
        map.setTerrain(null)
      }
    } catch {
      /* terrain unavailable — stay flat */
    }
  }

  /** Marks the atlas data stale and re-applies it right away if possible. */
  const invalidate = useCallback((): void => {
    dataVer.current++
    ensureRef.current()
  }, [])

  // Localize basemap labels to the app language, re-applied once per (style,lang)
  // — the guard key prevents a styledata feedback loop (setLayoutProperty itself
  // fires styledata).
  const langRef = useRef(i18n.language)
  langRef.current = i18n.language
  const localeKeyRef = useRef('')
  const applyLocaleRef = useRef<() => void>(() => undefined)
  applyLocaleRef.current = (): void => {
    const map = mapRef.current
    if (!map || !map.getStyle()?.layers?.length) return
    const key = `${resolvedRef.current.key}:${langRef.current}`
    if (localeKeyRef.current === key) return
    localeKeyRef.current = key
    localizeLabels(map, langRef.current)
  }

  // Re-localize when the UI language changes (style already loaded). The guard
  // key includes the language, so a change makes it differ → applyLocale re-runs.
  useEffect(() => {
    applyLocaleRef.current()
  }, [i18n.language, ready])

  // Create the map once.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || mapRef.current) return
    const map = new maplibregl.Map({
      container: el,
      style: resolvedRef.current.style as StyleSpecification,
      center: [12, 50],
      zoom: 4,
      // Always-visible attribution: the OSM/ODbL (and Carto/OHM) licences
      // require the credit to be VISIBLE, not hidden behind a compact ⓘ toggle.
      attributionControl: { compact: false },
      maxPitch: 72
    })
    mapRef.current = map
    // Exposed for e2e/debug probes (queryRenderedFeatures etc.).
    ;(window as unknown as { __atlasMap?: MLMap }).__atlasMap = map
    map.on('load', () => {
      setReady(true)
      ensureRef.current()
      applyLocaleRef.current()
    })
    // styledata fires on every style mutation (incl. basemap swaps). ensure()
    // and applyLocale are versioned/guarded (applyLocale's key = style:lang), so
    // re-running here is cheap and TERMINATES: after localizing, the key matches
    // and the setLayoutProperty-triggered styledata is a no-op. A basemap swap
    // changes the style part of the key → labels re-localize exactly once.
    map.on('styledata', () => {
      ensureRef.current()
      applyLocaleRef.current()
    })

    map.on('click', 'atlas-clusters', (e) => {
      const f = e.features?.[0]
      if (!f) return
      const src = map.getSource('points') as maplibregl.GeoJSONSource
      void src.getClusterExpansionZoom(f.properties?.cluster_id).then((z) => {
        map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: z + 0.5 })
      })
    })
    map.on('click', 'atlas-pts-hit', (e) => {
      const feats = map.queryRenderedFeatures(e.point, { layers: ['atlas-pts-hit'] })
      if (!feats.length) return
      const box = document.createElement('div')
      box.className = 'space-y-1'
      const title = document.createElement('p')
      title.className = 'text-xs font-semibold'
      title.textContent = String(feats[0].properties?.place ?? '')
      box.appendChild(title)
      for (const f of feats.slice(0, 8)) {
        const row = document.createElement('button')
        row.className =
          'flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] hover:bg-black/10'
        const dot = document.createElement('span')
        dot.style.cssText = `width:8px;height:8px;border-radius:99px;flex:none;background:${f.properties?.color}`
        const label = document.createElement('span')
        label.className = 'truncate'
        label.textContent = `${f.properties?.personName}${f.properties?.year ? ` · ${f.properties?.year}` : ''}`
        row.append(dot, label)
        const pid = String(f.properties?.personId ?? '')
        row.onclick = () => pid && selectPerson(pid)
        box.appendChild(row)
      }
      if (feats.length > 8) {
        const more = document.createElement('p')
        more.className = 'px-1 text-[10px] opacity-60'
        more.textContent = `+${feats.length - 8}`
        box.appendChild(more)
      }
      new maplibregl.Popup({ closeButton: false, maxWidth: '260px', className: 'tm-map-popup' })
        .setLngLat(e.lngLat)
        .setDOMContent(box)
        .addTo(map)
    })
    // Meeting-point popup: who from which side was around, and when.
    map.on('click', 'atlas-mig-meets-ring', (e) => {
      const f = e.features?.[0]
      if (!f) return
      const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates
      const meet = migDataRef.current?.meetings.find(
        (m) => Math.abs(m.lat - lat) < 0.001 && Math.abs(m.lon - lon) < 0.001
      )
      const box = document.createElement('div')
      box.className = 'space-y-1'
      const title = document.createElement('p')
      title.className = 'text-xs font-semibold'
      title.textContent = `${String(f.properties?.place ?? '')} · ${f.properties?.from}–${f.properties?.to}`
      box.appendChild(title)
      for (const person of meet?.people.slice(0, 10) ?? []) {
        const row = document.createElement('div')
        row.className = 'flex items-center gap-1.5 px-1 py-0.5 text-[11px]'
        const dot = document.createElement('span')
        dot.style.cssText = `width:8px;height:8px;border-radius:99px;flex:none;background:${BRANCH_COLOR[person.branch]}`
        const label = document.createElement('span')
        label.className = 'truncate'
        label.textContent = `${person.personName} · ${person.from}–${person.to}`
        row.append(dot, label)
        box.appendChild(row)
      }
      if ((meet?.people.length ?? 0) > 10) {
        const more = document.createElement('p')
        more.className = 'px-1 text-[10px] opacity-60'
        more.textContent = `+${meet!.people.length - 10}`
        box.appendChild(more)
      }
      new maplibregl.Popup({ closeButton: false, maxWidth: '280px', className: 'tm-map-popup' })
        .setLngLat(e.lngLat)
        .setDOMContent(box)
        .addTo(map)
    })

    for (const layer of ['atlas-pts-hit', 'atlas-clusters', 'atlas-mig-meets-ring']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
    }

    return () => {
      if (dashRaf.current) cancelAnimationFrame(dashRaf.current)
      // Null the ref FIRST so any concurrent effect (basemap swap, rebuild) bails
      // instead of touching a map mid-teardown.
      mapRef.current = null
      ;(window as unknown as { __atlasMap?: MLMap }).__atlasMap = undefined
      try {
        map.remove()
      } catch {
        /* MapLibre can throw an abort DOMException when the map is removed while
           its style/sprite is still loading (React StrictMode's mount→unmount in
           dev, or a very fast route switch) — harmless, it's going away anyway. */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Basemap swap (style replacement; our layers restored via style.load).
  const styleKey = useRef(resolved.key)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || styleKey.current === resolved.key) return
    styleKey.current = resolved.key
    try {
      map.setStyle(resolved.style as StyleSpecification)
    } catch {
      /* MapLibre throws "signal is aborted" if a basemap/theme swap lands while
         the previous style is still loading — the swap still applies, harmless. */
    }
  }, [resolved, ready])

  // Any data / visibility / cluster / focus change → rebuild the atlas layers.
  // A full rebuild is cheap at this data size and dodges MapLibre's flaky
  // setData-into-empty-source path entirely. Retries until the style is ready.
  useEffect(() => {
    invalidate()
  }, [pointsFC, linesFC, journeyFC, settings.showMarkers, settings.showHeat, settings.cluster, settings.mode, theme, invalidate])

  // Migration data landing (async families fetch / root change) needs its own
  // rebuild — the base FCs don't change then.
  useEffect(() => {
    invalidate()
  }, [migData, migOn, invalidate])

  // The period map's year filter follows the TO end of the time window.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || resolved.key !== 'historical') return
    safeFilterByDate(map, yTo)
  }, [yTo, resolved.key, ready])

  // First fit: frame all plotted events once data arrives.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || fittedOnce.current || filtered.length === 0) return
    fittedOnce.current = true
    const b = new maplibregl.LngLatBounds()
    for (const p of filtered) b.extend([p.lon, p.lat])
    map.fitBounds(b, { padding: 80, maxZoom: 8, duration: 900 })
  }, [filtered, ready])

  // Focused journey: frame the route.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (journey.length > 0) {
      const b = new maplibregl.LngLatBounds()
      for (const p of journey) b.extend([p.lon, p.lat])
      map.fitBounds(b, { padding: { top: 90, right: 340, bottom: 90, left: 360 }, maxZoom: 10, duration: 1000 })
    }
  }, [journey, ready])

  // Marching dash along the journey line — the animated migration route.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (journeyFC.line.features.length === 0) return
    const seq = [
      [0, 4, 3],
      [0.5, 4, 2.5],
      [1, 4, 2],
      [1.5, 4, 1.5],
      [2, 4, 1],
      [2.5, 4, 0.5],
      [3, 4, 0],
      [0, 0.5, 3, 3.5]
    ]
    let step = 0
    let last = 0
    const tick = (now: number): void => {
      dashRaf.current = requestAnimationFrame(tick)
      if (now - last < 90) return
      last = now
      step = (step + 1) % seq.length
      if (map.getLayer('atlas-journey-dash'))
        map.setPaintProperty('atlas-journey-dash', 'line-dasharray', seq[step])
    }
    dashRaf.current = requestAnimationFrame(tick)
    return () => {
      if (dashRaf.current) cancelAnimationFrame(dashRaf.current)
    }
  }, [journeyFC, ready])

  // Flat ↔ 3D: terrain + sky + pitch (buildings are added in rebuild).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (settings.mode === '3d') map.easeTo({ pitch: 60, duration: 1200 })
    else map.easeTo({ pitch: 0, bearing: 0, duration: 900 })
  }, [settings.mode, ready, resolved.key, theme])

  // ---- Geocoding CTA (places table empty but people exist) ----
  const geocode = async (): Promise<void> => {
    if (!window.api.geo?.geocodeAll) return
    setGeoProg({ done: 0, total: 1 })
    const unsub = window.api.geo.onGeocodeProgress?.((p) => setGeoProg({ done: p.done, total: p.total }))
    try {
      await window.api.geo.geocodeAll()
    } finally {
      unsub?.()
      setGeoProg(null)
      loadPoints()
    }
  }

  const personMatches = useMemo(() => {
    const q = personQ.trim().toLowerCase()
    if (!q) return []
    return people.filter((p) => fullName(p).toLowerCase().includes(q)).slice(0, 40)
  }, [people, personQ])

  const kindCount = useMemo(() => {
    const m = new Map<AtlasKind, number>()
    for (const p of points) m.set(p.kind, (m.get(p.kind) ?? 0) + 1)
    return m
  }, [points])

  const S = settings
  const lifespan = (p: { birthDate: string | null; deathDate: string | null }): string => {
    const b = yearOf(p.birthDate)
    const d = yearOf(p.deathDate)
    return b || d ? `${b || '?'}–${d || ''}` : ''
  }

  return (
    <div
      className={cn('relative h-full w-full overflow-hidden', resolved.key === 'historical' && 'map-vintage')}
      data-testid="atlas"
    >
      <div ref={wrapRef} className="absolute inset-0" />

      {/* ---- Zoom / compass (bottom-right, glass) ---- */}
      <div className="glass-strong absolute bottom-6 right-3 z-10 flex flex-col overflow-hidden rounded-2xl">
        {[
          { icon: Plus, run: () => mapRef.current?.zoomIn() },
          { icon: Minus, run: () => mapRef.current?.zoomOut() },
          { icon: Compass, run: () => mapRef.current?.easeTo({ bearing: 0, pitch: S.mode === '3d' ? 60 : 0 }) },
          {
            icon: Locate,
            run: () => {
              fittedOnce.current = false
              setFocusId(null)
            }
          }
        ].map(({ icon: Icon, run }, i) => (
          <button
            key={i}
            onClick={run}
            className="flex h-9 w-9 items-center justify-center text-foreground/80 transition-colors hover:bg-accent/60 hover:text-primary"
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>

      {/* ---- Control rail (right, glass) — collapsible, open by default ---- */}
      {!railOpen && (
        <button
          onClick={() => setRailOpen(true)}
          className="glass-strong absolute right-3 top-3 z-10 flex h-9 items-center gap-1.5 rounded-2xl px-3 text-xs font-medium text-foreground/80 transition-colors hover:text-primary"
          title={t('atlas.controls')}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {t('atlas.controls')}
        </button>
      )}
      <div
        className={cn(
          'glass-strong absolute right-3 top-3 z-10 flex max-h-[calc(100%-6.5rem)] w-72 flex-col overflow-hidden rounded-2xl text-foreground',
          !railOpen && 'hidden'
        )}
      >
        <div className="flex items-center justify-between border-b border-border/40 py-2 pl-3.5 pr-2">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <SlidersHorizontal className="h-3.5 w-3.5" /> {t('atlas.controls')}
          </span>
          <button
            onClick={() => setRailOpen(false)}
            title={t('common.close')}
            className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto p-3.5">
          {/* Person focus — FIRST so the dropdown never needs scrolling. */}
          <section className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t('atlas.journey')}
            </p>
            {focusPerson ? (
              <div className="flex items-center gap-2 rounded-xl bg-primary/10 p-1.5 ring-1 ring-primary/25">
                <PersonAvatar
                  personId={focusPerson.id}
                  name={fullName(focusPerson)}
                  sex={focusPerson.sex}
                  className="h-6 w-6 text-[9px]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">{fullName(focusPerson)}</span>
                  <span className="block text-[10px] tabular-nums text-muted-foreground">
                    {lifespan(focusPerson)}
                  </span>
                </span>
                <button
                  onClick={() => setFocusId(null)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  title={t('common.close')}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={personQ}
                  onChange={(e) => {
                    setPersonQ(e.target.value)
                    setPersonMenu(true)
                  }}
                  onFocus={() => setPersonMenu(true)}
                  placeholder={t('atlas.searchPerson')}
                  className="h-8 w-full rounded-xl border border-border/40 bg-background/50 pl-8 pr-2 text-xs outline-none transition-colors focus:border-primary/60"
                />
                {personMenu && personMatches.length > 0 && (
                  <div className="glass-strong absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl p-1">
                    {personMatches.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setFocusId(p.id)
                          setPersonQ('')
                          setPersonMenu(false)
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-accent/60"
                      >
                        <PersonAvatar
                          personId={p.id}
                          name={fullName(p)}
                          sex={p.sex}
                          className="h-6 w-6 shrink-0 text-[8px]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{fullName(p)}</span>
                          <span className="block text-[10px] tabular-nums text-muted-foreground">
                            {lifespan(p)}
                            {p.birthPlace ? ` · ${p.birthPlace}` : ''}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Mode + basemap */}
          <section className="space-y-2">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary/40 p-1">
              {(['flat', '3d'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => S.set({ mode: m })}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-all',
                    S.mode === m
                      ? 'bg-background/80 text-primary shadow-[inset_0_1px_0_hsl(var(--glass-highlight)/0.4)] ring-1 ring-primary/20'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {m === 'flat' ? <MapPin className="h-3.5 w-3.5" /> : <Mountain className="h-3.5 w-3.5" />}
                  {t(m === 'flat' ? 'atlas.flat' : 'atlas.threeD')}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {(['auto', 'light', 'dark', 'historical'] as const).map((b) => (
                <button
                  key={b}
                  onClick={() => S.set({ basemap: b })}
                  className={cn(
                    'rounded-lg px-2 py-1 text-[10px] font-medium transition-colors',
                    S.basemap === b
                      ? 'bg-primary/15 text-primary ring-1 ring-primary/25'
                      : 'bg-secondary/40 text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t(`atlas.base.${b}`)}
                </button>
              ))}
            </div>
          </section>

          {/* Layers */}
          <section className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <LayersIcon className="h-3 w-3" /> {t('atlas.layers')}
            </p>
            {(
              [
                { key: 'showMarkers', icon: MapPin, label: 'atlas.markers' },
                { key: 'showHeat', icon: Flame, label: 'atlas.heatmap' },
                { key: 'showPaths', icon: Route, label: 'atlas.paths' },
                { key: 'cluster', icon: Sparkles, label: 'atlas.clustering' }
              ] as const
            ).map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => {
                  const next = !S[key]
                  // The heatmap replaces the markers: turning it on switches
                  // markers + clustering off (and off brings the markers back).
                  if (key === 'showHeat')
                    S.set(
                      next
                        ? { showHeat: true, showMarkers: false, cluster: false }
                        : { showHeat: false, showMarkers: true }
                    )
                  else if (key === 'showMarkers' && next && S.showHeat)
                    S.set({ showMarkers: true, showHeat: false })
                  else S.set({ [key]: next } as never)
                }}
                className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-xs transition-colors hover:bg-accent/50"
              >
                <Icon className={cn('h-3.5 w-3.5', S[key] ? 'text-primary' : 'text-muted-foreground/60')} />
                <span className={cn('flex-1 text-left', !S[key] && 'text-muted-foreground')}>{t(label)}</span>
                <span
                  className={cn(
                    'relative h-4 w-7 rounded-full transition-colors',
                    S[key] ? 'bg-primary/80' : 'bg-secondary'
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all',
                      S[key] ? 'left-3.5' : 'left-0.5'
                    )}
                  />
                </span>
              </button>
            ))}
          </section>

          {/* Scope: whose events (everyone / circles around the root person) */}
          <section className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t('gedcom.exportScope')}
            </p>
            <ScopePicker
              value={S.scope}
              onChange={(s) => S.set({ scope: s })}
              className="flex w-full flex-wrap"
            />
            {(
              <button
                onClick={() => S.set({ scopeSpouses: !S.scopeSpouses })}
                disabled={!hasScopeRoot}
                title={hasScopeRoot ? t('dashboard.includeSpousesHint') : t('dashboard.scopeNeedsRoot')}
                className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-xs transition-colors hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Heart className={cn('h-3.5 w-3.5', S.scopeSpouses ? 'text-primary' : 'text-muted-foreground/60')} />
                <span className={cn('flex-1 text-left', !S.scopeSpouses && 'text-muted-foreground')}>
                  {t('dashboard.includeSpouses')}
                </span>
                <span
                  className={cn(
                    'relative h-4 w-7 rounded-full transition-colors',
                    S.scopeSpouses ? 'bg-primary/80' : 'bg-secondary'
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all',
                      S.scopeSpouses ? 'left-3.5' : 'left-0.5'
                    )}
                  />
                </span>
              </button>
            )}
          </section>

          {/* Event kinds */}
          <section className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t('atlas.events')}
            </p>
            <div className="flex flex-wrap gap-1">
              {KINDS.map((k) => {
                const Icon = KIND_ICON[k]
                const on = S.kinds[k]
                const n = kindCount.get(k) ?? 0
                return (
                  <button
                    key={k}
                    onClick={() => S.setKind(k, !on)}
                    title={`${t(`atlas.kind.${k}`)}${n ? ` (${n})` : ''}`}
                    className={cn(
                      'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all',
                      on
                        ? 'border-transparent text-white shadow-sm'
                        : 'border-border/50 bg-secondary/30 text-muted-foreground opacity-60 hover:opacity-100'
                    )}
                    style={on ? { background: KIND_COLOR[k] } : undefined}
                  >
                    <Icon className="h-3 w-3" />
                    {t(`atlas.kind.${k}`)}
                  </button>
                )
              })}
            </div>
          </section>

          {/* Time window (drives the period map's year too) */}
          <section className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t('atlas.time')}
              </p>
              <span className="text-[11px] font-semibold tabular-nums text-primary">
                {yFrom}–{yTo}
              </span>
            </div>
            <div className="relative h-5">
              <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-secondary" />
              <div
                className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary/60"
                style={{
                  left: `${((yFrom - yearBounds.min) / Math.max(1, yearBounds.max - yearBounds.min)) * 100}%`,
                  right: `${100 - ((yTo - yearBounds.min) / Math.max(1, yearBounds.max - yearBounds.min)) * 100}%`
                }}
              />
              <input
                type="range"
                min={yearBounds.min}
                max={yearBounds.max}
                value={yFrom}
                onChange={(e) => S.set({ yearFrom: Math.min(Number(e.target.value), yTo) })}
                className="tm-range pointer-events-none absolute inset-0 w-full appearance-none bg-transparent"
              />
              <input
                type="range"
                min={yearBounds.min}
                max={yearBounds.max}
                value={yTo}
                onChange={(e) => S.set({ yearTo: Math.max(Number(e.target.value), yFrom) })}
                className="tm-range pointer-events-none absolute inset-0 w-full appearance-none bg-transparent"
              />
            </div>
            {(S.yearFrom !== null || S.yearTo !== null) && (
              <button
                onClick={() => S.set({ yearFrom: null, yearTo: null })}
                className="text-[10px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
              >
                {t('atlas.allTime')}
              </button>
            )}
          </section>

          {/* ---- Migration animation (ancestor branches over the years) ---- */}
          <section className="border-t border-border/40 pt-2">
            <button
              onClick={() => {
                const next = !migOn
                setMigOn(next)
                setMigPlaying(false)
                setMigMeetOpen(false)
                if (next) setFocusId(null)
              }}
              className={cn(
                'flex w-full items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors',
                migOn
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/40 text-muted-foreground hover:text-primary'
              )}
            >
              <Footprints className="h-3.5 w-3.5" /> {t('atlas.mig.title')}
            </button>
          </section>

          {/* ---- Place manager (hierarchy + GOV) ---- */}
          <section className="border-t border-border/40 pt-2">
            <button
              onClick={() => setPlacesOpen(true)}
              className="flex w-full items-center gap-1.5 rounded-lg border border-border/40 px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              <Landmark className="h-3.5 w-3.5" /> {t('places.manage')}
            </button>
          </section>
        </div>
      </div>

      <PlacesManagerDialog open={placesOpen} onOpenChange={setPlacesOpen} />

      {/* ---- Journey timeline (left, glass) ---- */}
      {focusPerson && (
        <div className="glass-strong absolute left-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] w-80 flex-col overflow-hidden rounded-2xl text-foreground">
          <div className="flex items-center gap-2 border-b border-border/40 p-3">
            <PersonAvatar
              personId={focusPerson.id}
              name={fullName(focusPerson)}
              sex={focusPerson.sex}
              className="h-8 w-8 text-[10px]"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{fullName(focusPerson)}</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t('atlas.journeyOf', { count: journey.length })}
              </p>
            </div>
            <button
              onClick={() => setFocusId(null)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {journey.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t('atlas.noPlaces')}</p>
            )}
            <ol className="relative ml-3 space-y-0.5 border-l border-border/50">
              {journey.map((p, i) => {
                const Icon = KIND_ICON[p.kind]
                return (
                  <li key={i}>
                    <button
                      onClick={() =>
                        mapRef.current?.flyTo({ center: [p.lon, p.lat], zoom: 10, duration: 900 })
                      }
                      className="group flex w-full items-start gap-2.5 rounded-lg py-1.5 pl-4 pr-2 text-left transition-colors hover:bg-accent/50"
                    >
                      <span
                        className="absolute -left-[9px] mt-1 flex h-[18px] w-[18px] items-center justify-center rounded-full text-white ring-2 ring-background"
                        style={{ background: KIND_COLOR[p.kind] }}
                      >
                        <Icon className="h-2.5 w-2.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5">
                          <span className="text-xs font-semibold tabular-nums">
                            {p.year ?? '—'}
                            {p.endYear ? `–${p.endYear}` : ''}
                          </span>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {t(`atlas.kind.${p.kind}`)}
                          </span>
                        </span>
                        <span className="block truncate text-xs text-foreground/90">{p.place}</span>
                        {p.detail && (
                          <span className="block truncate text-[10px] italic text-muted-foreground">{p.detail}</span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      )}

      {/* ---- Migration HUD (bottom center) ---- */}
      {migOn && (
        <div className="glass-strong absolute bottom-6 left-1/2 z-10 w-[min(620px,calc(100%-7rem))] -translate-x-1/2 rounded-2xl p-3 text-foreground">
          {!migRoot ? (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold">{t('atlas.mig.pickRoot')}</p>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={migQ}
                  onChange={(e) => setMigQ(e.target.value)}
                  placeholder={t('atlas.searchPerson')}
                  autoFocus
                  className="h-8 w-full rounded-xl border border-border/40 bg-background/50 pl-8 pr-2 text-xs outline-none transition-colors focus:border-primary/60"
                />
                {migMatches.length > 0 && (
                  <div className="glass-strong absolute bottom-full z-20 mb-1 max-h-56 w-full overflow-y-auto rounded-xl p-1">
                    {migMatches.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setMigRootId(p.id)
                          setMigQ('')
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-accent/60"
                      >
                        <PersonAvatar personId={p.id} name={fullName(p)} sex={p.sex} className="h-6 w-6 shrink-0 text-[8px]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{fullName(p)}</span>
                          <span className="block text-[10px] tabular-nums text-muted-foreground">{lifespan(p)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <PersonAvatar personId={migRoot.id} name={fullName(migRoot)} sex={migRoot.sex} className="h-7 w-7 text-[9px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">{fullName(migRoot)}</span>
                  <span className="block text-[10px] text-muted-foreground">{t('atlas.mig.subtitle')}</span>
                </span>
                <span className="text-2xl font-bold tabular-nums text-primary">{migYearUI ?? '—'}</span>
                <button
                  onClick={() => setMigRootId(null)}
                  title={t('atlas.mig.changeRoot')}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                >
                  <Users className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    setMigOn(false)
                    setMigPlaying(false)
                    setMigMeetOpen(false)
                  }}
                  title={t('common.close')}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {migData?.span ? (
                <>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (!migPlaying && migYearRef.current >= migData.span!.max) setMigYear(migData.span!.min)
                        setMigPlaying(!migPlaying)
                      }}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      {migPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
                    </button>
                    <input
                      type="range"
                      min={migData.span.min}
                      max={migData.span.max}
                      value={migYearUI ?? migData.span.min}
                      onChange={(e) => setMigYear(Number(e.target.value))}
                      className="tm-range h-5 flex-1 appearance-none bg-transparent"
                    />
                    <button
                      onClick={() => setMigSpeed(migSpeed >= 16 ? 2 : migSpeed * 2)}
                      className="shrink-0 rounded-lg bg-secondary/50 px-2 py-1 text-[10px] font-semibold tabular-nums text-muted-foreground transition-colors hover:text-foreground"
                      title={t('atlas.mig.speed')}
                    >
                      {migSpeed} {t('atlas.mig.yps')}
                    </button>
                    <button
                      onClick={() => setMigMeetOpen(!migMeetOpen)}
                      className={cn(
                        'flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors',
                        migMeetOpen
                          ? 'bg-[#a855f7]/15 text-[#a855f7] ring-1 ring-[#a855f7]/30'
                          : 'bg-secondary/50 text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <Users className="h-3 w-3" /> {migData.meetings.length}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                    {(['root', 'father', 'mother', 'ff', 'fm', 'mf', 'mm'] as const).map((b) => (
                      <span key={b} className="flex items-center gap-1 text-[9px] text-muted-foreground">
                        <span className="h-2 w-2 rounded-full" style={{ background: BRANCH_COLOR[b] }} />
                        {t(`atlas.mig.branch.${b}`)}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">{migData ? t('atlas.mig.empty') : '…'}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---- Meeting list (left) ---- */}
      {migOn && migMeetOpen && migData && (
        <div className="glass-strong absolute left-3 top-3 z-10 flex max-h-[calc(100%-9rem)] w-80 flex-col overflow-hidden rounded-2xl text-foreground">
          <div className="flex items-center justify-between border-b border-border/40 py-2 pl-3.5 pr-2">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <Users className="h-3.5 w-3.5 text-[#a855f7]" /> {t('atlas.mig.meetings')}
            </span>
            <button
              onClick={() => setMigMeetOpen(false)}
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {migData.meetings.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t('atlas.mig.noMeetings')}</p>
            )}
            {migData.meetings.map((m, i) => (
              <button
                key={i}
                onClick={() => {
                  setMigYear(Math.min(m.to, Math.max(m.from, migYearRef.current)))
                  mapRef.current?.flyTo({ center: [m.lon, m.lat], zoom: 9, duration: 900 })
                }}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/50"
              >
                <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#a855f7]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{m.place}</span>
                  <span className="block text-[10px] tabular-nums text-muted-foreground">
                    {m.from}–{m.to} · {t('atlas.mig.people', { count: m.people.length })}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---- Empty state: nothing geocoded yet ---- */}
      {ready && points.length === 0 && people.length > 0 && (
        <div className="glass-strong absolute left-1/2 top-1/2 z-10 w-80 -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5 text-center">
          <MapPin className="mx-auto mb-2 h-8 w-8 text-primary" />
          <p className="text-sm font-semibold">{t('atlas.emptyTitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('atlas.emptyHint')}</p>
          {typeof window.api.geo?.geocodeAll === 'function' && (
            <button
              onClick={() => void geocode()}
              disabled={!!geoProg}
              className="mt-3 w-full rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {geoProg ? `${geoProg.done} / ${geoProg.total}` : t('atlas.geocode')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
