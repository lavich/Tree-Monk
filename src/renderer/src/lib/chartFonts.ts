/// <reference types="vite/client" />
/**
 * Local, self-hosted font catalogue for the fan / circle pedigree chart.
 *
 * The .woff2 files live in `assets/chart-fonts` and are bundled by Vite — there
 * is NO CDN / network fetch at runtime. Fonts are registered lazily via the
 * FontFace API (canvas text only picks up a font once it is actually loaded),
 * and every file carries the Latin + Latin-Extended range so Hungarian accents
 * (ő, ű, …) render correctly.
 */

export type FontCategory = 'sans' | 'serif' | 'script' | 'display'

export interface ChartFont {
  /** Stable id persisted in settings. */
  key: string
  /** Human label shown in the picker. */
  label: string
  /** CSS font-family the renderer/canvas asks for. */
  family: string
  category: FontCategory
}

/** The bundled system stack — the default, needs no download. */
const SYSTEM_STACK = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"

/**
 * Catalogue. `key` doubles as the file-name base (e.g. `playfair-display` →
 * `playfair-display-v40-…-regular.woff2`), except `system` which has no file.
 */
export const CHART_FONTS: ChartFont[] = [
  { key: 'system', label: 'System (Inter)', family: SYSTEM_STACK, category: 'sans' },
  // Sans-serif
  { key: 'inter', label: 'Inter', family: 'Inter', category: 'sans' },
  { key: 'roboto', label: 'Roboto', family: 'Roboto', category: 'sans' },
  { key: 'open-sans', label: 'Open Sans', family: 'Open Sans', category: 'sans' },
  { key: 'lato', label: 'Lato', family: 'Lato', category: 'sans' },
  { key: 'montserrat', label: 'Montserrat', family: 'Montserrat', category: 'sans' },
  { key: 'nunito', label: 'Nunito', family: 'Nunito', category: 'sans' },
  { key: 'work-sans', label: 'Work Sans', family: 'Work Sans', category: 'sans' },
  // Serif / slab
  { key: 'merriweather', label: 'Merriweather', family: 'Merriweather', category: 'serif' },
  { key: 'playfair-display', label: 'Playfair Display', family: 'Playfair Display', category: 'serif' },
  { key: 'lora', label: 'Lora', family: 'Lora', category: 'serif' },
  { key: 'eb-garamond', label: 'EB Garamond', family: 'EB Garamond', category: 'serif' },
  { key: 'pt-serif', label: 'PT Serif', family: 'PT Serif', category: 'serif' },
  { key: 'cormorant-garamond', label: 'Cormorant Garamond', family: 'Cormorant Garamond', category: 'serif' },
  { key: 'crimson-text', label: 'Crimson Text', family: 'Crimson Text', category: 'serif' },
  { key: 'old-standard-tt', label: 'Old Standard TT', family: 'Old Standard TT', category: 'serif' },
  { key: 'libre-baskerville', label: 'Libre Baskerville', family: 'Libre Baskerville', category: 'serif' },
  { key: 'roboto-slab', label: 'Roboto Slab', family: 'Roboto Slab', category: 'serif' },
  // Script / handwriting
  { key: 'dancing-script', label: 'Dancing Script', family: 'Dancing Script', category: 'script' },
  { key: 'great-vibes', label: 'Great Vibes', family: 'Great Vibes', category: 'script' },
  { key: 'pacifico', label: 'Pacifico', family: 'Pacifico', category: 'script' },
  // Display / decorative
  { key: 'cinzel', label: 'Cinzel', family: 'Cinzel', category: 'display' },
  { key: 'unifrakturmaguntia', label: 'Fraktur (UnifrakturMaguntia)', family: 'UnifrakturMaguntia', category: 'display' }
]

export const DEFAULT_CHART_FONT = 'system'

const GENERIC: Record<FontCategory, string> = {
  sans: 'sans-serif',
  serif: 'serif',
  script: 'cursive',
  display: 'serif'
}

// --- bundled file URLs (Vite turns each .woff2 into a hashed asset URL) ------

// Two views of the same files:
//  • `?url`  (eager) — a resource URL, used by the FontFace API for on-screen
//    rendering (a native resource load that works under any origin).
//  • `?inline` (lazy) — a build-time base64 `data:` URI, used to embed the font
//    in a standalone export. No runtime fetch, so it works even from a
//    restricted file:// origin, and the lazy chunk keeps it out of first load.
const FILE_URLS = import.meta.glob('../assets/chart-fonts/*.woff2', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

const FILE_DATA = import.meta.glob('../assets/chart-fonts/*.woff2', {
  query: '?inline',
  import: 'default'
}) as Record<string, () => Promise<string>>

/** filename → {base, weight}. e.g. `playfair-display-v40-latin_latin-ext-700.woff2` */
const FILE_RE = /^(?<base>.+?)-v\d+-[a-z_-]+-(?<variant>regular|700)\.woff2$/

interface FontFile {
  weight: number
  url: string
  path: string
}
const filesByBase = new Map<string, FontFile[]>()
for (const [path, url] of Object.entries(FILE_URLS)) {
  const name = path.split('/').pop() ?? ''
  const m = FILE_RE.exec(name)
  if (!m?.groups) continue
  const base = m.groups.base
  const weight = m.groups.variant === '700' ? 700 : 400
  const arr = filesByBase.get(base) ?? []
  arr.push({ weight, url, path })
  filesByBase.set(base, arr)
}

const byKey = new Map(CHART_FONTS.map((f) => [f.key, f]))

/** The CSS font-family string (with a category-appropriate fallback) for a key. */
export function chartFontFamily(key: string): string {
  const f = byKey.get(key) ?? byKey.get('system')!
  if (f.key === 'system') return f.family
  return `"${f.family}", ${GENERIC[f.category]}`
}

const loading = new Map<string, Promise<void>>()

/**
 * Ensure a chart font's files are registered with the document. Resolves once
 * loaded (or immediately for the system stack / unknown keys). Safe to call
 * repeatedly — the work is memoised per key.
 */
export function ensureChartFont(key: string): Promise<void> {
  const f = byKey.get(key)
  if (!f || f.key === 'system') return Promise.resolve()
  const cached = loading.get(key)
  if (cached) return cached
  const files = filesByBase.get(key) ?? []
  if (!files.length) return Promise.resolve()
  const p = Promise.all(
    files.map(async ({ weight, url }) => {
      // Guard against double-registering the same family/weight.
      const face = new FontFace(f.family, `url(${url}) format('woff2')`, {
        weight: String(weight),
        style: 'normal',
        display: 'swap'
      })
      const loaded = await face.load()
      document.fonts.add(loaded)
    })
  ).then(() => undefined)
  loading.set(key, p)
  return p
}

/**
 * Build an `@font-face` CSS block (base64-embedded woff2) for a chart font, so a
 * standalone SVG/PDF export renders the chosen face with NO network/CDN. Uses
 * Vite's build-time `?inline` data URIs (no runtime fetch → works from file://).
 * Returns '' for the system stack (nothing to embed). Results are memoised.
 */
const faceCssCache = new Map<string, Promise<string>>()
export function chartFontFaceCss(key: string): Promise<string> {
  const f = byKey.get(key)
  if (!f || f.key === 'system') return Promise.resolve('')
  const cached = faceCssCache.get(key)
  if (cached) return cached
  const files = filesByBase.get(key) ?? []
  if (!files.length) return Promise.resolve('')
  const p = Promise.all(
    files.map(async ({ weight, path }) => {
      const load = FILE_DATA[path]
      if (!load) return ''
      const dataUri = await load()
      return `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${weight};src:url(${dataUri}) format('woff2');}`
    })
  )
    .then((rules) => rules.join(''))
    // Best-effort: never let a font hiccup break the export itself.
    .catch(() => '')
  faceCssCache.set(key, p)
  return p
}
