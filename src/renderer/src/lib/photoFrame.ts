import type { CSSProperties } from 'react'

/**
 * Profile-photo framing. `x`/`y` are pan fractions in 0..1 (0.5 = centred,
 * 0 = top/left edge, 1 = bottom/right edge), `scale` is zoom (≥1), and `a` is
 * the image's aspect ratio (width/height) — needed so the pan range can be
 * computed at any avatar size without measuring the bitmap.
 */
export interface PhotoFrame {
  x: number
  y: number
  scale: number
  a: number
}

export const DEFAULT_FRAME: PhotoFrame = { x: 0.5, y: 0.5, scale: 1, a: 1 }

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)
const clampScale = (n: number): number => (n < 1 ? 1 : n > 5 ? 5 : n)
const okAspect = (n: unknown): number => (typeof n === 'number' && n > 0 && Number.isFinite(n) ? n : 1)

/** Safely parse the stored JSON crop into a usable frame (centred on failure). */
export function parseFrame(json: string | null | undefined): PhotoFrame {
  if (!json) return DEFAULT_FRAME
  try {
    const o = JSON.parse(json) as Partial<PhotoFrame>
    return {
      x: clamp01(typeof o.x === 'number' ? o.x : 0.5),
      y: clamp01(typeof o.y === 'number' ? o.y : 0.5),
      scale: clampScale(typeof o.scale === 'number' ? o.scale : 1),
      a: okAspect(o.a)
    }
  } catch {
    return DEFAULT_FRAME
  }
}

/** A centred, un-zoomed frame stores as null (no need to persist the default). */
export function frameToJson(f: PhotoFrame): string | null {
  if (Math.abs(f.x - 0.5) < 0.001 && Math.abs(f.y - 0.5) < 0.001 && Math.abs(f.scale - 1) < 0.001) {
    return null
  }
  const r = (n: number): number => Math.round(n * 1000) / 1000
  return JSON.stringify({ x: r(clamp01(f.x)), y: r(clamp01(f.y)), scale: r(clampScale(f.scale)), a: r(okAspect(f.a)) })
}

/** The cover-fit size of the image relative to its (square) box, per axis (≥1). */
function coverRatio(f: PhotoFrame): { w: number; h: number } {
  return { w: f.a >= 1 ? f.a : 1, h: f.a >= 1 ? 1 : 1 / f.a }
}

/** How far the cover-fitted, zoomed image overflows the (square) box, per axis,
 *  as a multiple of the box size — 0 means that axis exactly fills (no pan room). */
export function frameOverflow(f: PhotoFrame): { x: number; y: number } {
  const c = coverRatio(f)
  return { x: c.w * f.scale - 1, y: c.h * f.scale - 1 }
}

/**
 * The visible avatar window expressed as a normalised (0..1) rectangle of the
 * SOURCE image — i.e. exactly the crop the framing shows. Used to auto-create a
 * photo-region tag at the crop location. Pure arithmetic (no bitmap needed): the
 * frame already carries the aspect `a`.
 */
export function frameToRegion(f: PhotoFrame): { x: number; y: number; w: number; h: number } {
  const c = coverRatio(f)
  const iw = c.w * f.scale // image width  as a multiple of the square box
  const ih = c.h * f.scale // image height as a multiple of the square box
  const x = clamp01(iw > 0 ? ((iw - 1) * f.x) / iw : 0)
  const y = clamp01(ih > 0 ? ((ih - 1) * f.y) / ih : 0)
  const w = clamp01(iw > 0 ? 1 / iw : 1)
  const h = clamp01(ih > 0 ? 1 / ih : 1)
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) }
}

/**
 * CSS for the framed `<img>`. The image is sized to cover the square box (times
 * the zoom) and absolutely positioned — only the container's `overflow-hidden`
 * clips it. This is the key fix over an `object-cover` + transform approach:
 * `object-cover` pre-crops the overflow to the box, so a later transform can
 * never reveal a portrait's cut-off top/bottom. Here nothing is pre-cropped, so
 * the whole image is reachable by panning at any zoom.
 *
 * The container MUST be `position: relative; overflow: hidden`.
 */
export function frameStyle(f: PhotoFrame): CSSProperties {
  const c = coverRatio(f)
  const ov = frameOverflow(f)
  return {
    position: 'absolute',
    width: `${c.w * f.scale * 100}%`,
    height: `${c.h * f.scale * 100}%`,
    // x/y = 0 shows the top/left edge, 1 the bottom/right; 0.5 centres.
    left: `${-ov.x * f.x * 100}%`,
    top: `${-ov.y * f.y * 100}%`,
    maxWidth: 'none',
    maxHeight: 'none'
  }
}
