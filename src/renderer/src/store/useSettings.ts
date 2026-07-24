import { create } from 'zustand'

export type FontSize = 'small' | 'medium' | 'large'
export type DateFormat = 'iso' | 'eu' | 'us'
export type Contrast = 'normal' | 'high'

const KEY = 'treemonk.settings'
const FONT_PX: Record<FontSize, string> = { small: '14px', medium: '16px', large: '18px' }

interface SettingsState {
  fontSize: FontSize
  animations: boolean
  /** Drop the frosted-glass blur (backdrop-filter) for a solid, much lighter UI.
   *  A big CPU win on machines without GPU acceleration, where the blur is
   *  software-rendered on every panel. Default: OFF (keep the glass look). */
  reduceEffects: boolean
  dateFormat: DateFormat
  /** Whether the left navigation rail is collapsed to icons only (default: open). */
  sidebarCollapsed: boolean
  /** Show a green/orange "verified" mark on every person (default: OFF). */
  verificationMarks: boolean
  /** Accessibility: high-contrast surfaces (default: 'normal'). */
  contrast: Contrast
  setFontSize: (f: FontSize) => void
  setAnimations: (v: boolean) => void
  setReduceEffects: (v: boolean) => void
  setDateFormat: (d: DateFormat) => void
  setSidebarCollapsed: (v: boolean) => void
  setVerificationMarks: (v: boolean) => void
  setContrast: (c: Contrast) => void
}

type Persisted = Pick<
  SettingsState,
  'fontSize' | 'animations' | 'reduceEffects' | 'dateFormat' | 'sidebarCollapsed' | 'verificationMarks' | 'contrast'
>

function persist(s: Persisted): void {
  localStorage.setItem(KEY, JSON.stringify(s))
}

function apply(s: Pick<SettingsState, 'fontSize' | 'animations' | 'reduceEffects' | 'contrast'>): void {
  document.documentElement.style.fontSize = FONT_PX[s.fontSize]
  document.documentElement.classList.toggle('no-anim', !s.animations)
  document.documentElement.classList.toggle('no-glass', s.reduceEffects)
  document.documentElement.classList.toggle('hc', s.contrast === 'high')
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw)
      return {
        fontSize: p.fontSize ?? 'medium',
        animations: p.animations ?? true,
        reduceEffects: p.reduceEffects ?? false,
        dateFormat: p.dateFormat ?? 'iso',
        sidebarCollapsed: p.sidebarCollapsed ?? false,
        verificationMarks: p.verificationMarks ?? false,
        contrast: p.contrast ?? 'normal'
      }
    }
  } catch {
    /* ignore */
  }
  return {
    fontSize: 'medium',
    animations: true,
    reduceEffects: false,
    dateFormat: 'iso',
    sidebarCollapsed: false,
    verificationMarks: false,
    contrast: 'normal'
  }
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),
  setFontSize: (fontSize) => {
    set({ fontSize })
    apply({ fontSize, animations: get().animations, reduceEffects: get().reduceEffects, contrast: get().contrast })
    persist({ ...current(get), fontSize })
  },
  setAnimations: (animations) => {
    set({ animations })
    apply({ fontSize: get().fontSize, animations, reduceEffects: get().reduceEffects, contrast: get().contrast })
    persist({ ...current(get), animations })
  },
  setReduceEffects: (reduceEffects) => {
    set({ reduceEffects })
    apply({ fontSize: get().fontSize, animations: get().animations, reduceEffects, contrast: get().contrast })
    persist({ ...current(get), reduceEffects })
  },
  setDateFormat: (dateFormat) => {
    set({ dateFormat })
    persist({ ...current(get), dateFormat })
  },
  setSidebarCollapsed: (sidebarCollapsed) => {
    set({ sidebarCollapsed })
    persist({ ...current(get), sidebarCollapsed })
  },
  setVerificationMarks: (verificationMarks) => {
    set({ verificationMarks })
    persist({ ...current(get), verificationMarks })
  },
  setContrast: (contrast) => {
    set({ contrast })
    apply({ fontSize: get().fontSize, animations: get().animations, reduceEffects: get().reduceEffects, contrast })
    persist({ ...current(get), contrast })
  }
}))

/** Snapshot of just the persistable fields from the current store. */
function current(get: () => SettingsState): Persisted {
  const s = get()
  return {
    fontSize: s.fontSize,
    animations: s.animations,
    reduceEffects: s.reduceEffects,
    dateFormat: s.dateFormat,
    sidebarCollapsed: s.sidebarCollapsed,
    verificationMarks: s.verificationMarks,
    contrast: s.contrast
  }
}

/** Applies persisted settings before first paint. */
export function initSettings(): void {
  const s = load()
  apply(s)
  useSettings.setState(s)
}
