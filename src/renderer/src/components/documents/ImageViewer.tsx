import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Maximize2, ScanFace, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ExistingPersonPicker } from '@/components/common/ExistingPersonPicker'
import { useAppStore } from '@/store/useAppStore'
import { fullName } from '@/lib/utils'
import type { PhotoRegion } from '@shared/types'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** A deep-zoom / pannable image viewer with optional face/zone tagging. */
export function ImageViewer({
  src,
  alt,
  onError,
  documentId
}: {
  src: string
  alt?: string
  /** Fired when the image can't be displayed (e.g. a remote link that isn't an image). */
  onError?: () => void
  /** When set, people can be tagged with zones on this document's image. */
  documentId?: string
}): JSX.Element {
  const { t } = useTranslation()
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [loading, setLoading] = useState(true)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // --- tagging state ---
  const people = useAppStore((s) => s.people)
  const openProfile = useAppStore((s) => s.openProfile)
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const [regions, setRegions] = useState<PhotoRegion[]>([])
  const [tagMode, setTagMode] = useState(false)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [pane, setPane] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [draft, setDraft] = useState<Rect | null>(null)
  const drawing = useRef<{ x0: number; y0: number } | null>(null)
  const [picker, setPicker] = useState<{ rect: Rect; px: number; py: number } | null>(null)
  const [labelText, setLabelText] = useState('')
  const [hoverId, setHoverId] = useState<string | null>(null)

  const canTag = !!documentId
  const drawMode = canTag && tagMode

  const reset = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const refreshRegions = useCallback(() => {
    if (!documentId) return
    void window.api.regions.forDocument(documentId).then(setRegions)
  }, [documentId])

  // Reset zoom/pan AND show the preloader whenever the source changes; (re)load
  // this document's tags.
  useEffect(() => {
    reset()
    setLoading(true)
    setDraft(null)
    setPicker(null)
    setRegions([])
    refreshRegions()
  }, [src, reset, refreshRegions])

  // Track the pane size so normalized region coords map to the letterboxed image.
  useEffect(() => {
    const el = paneRef.current
    if (!el) return
    const sync = (): void => setPane({ w: el.clientWidth, h: el.clientHeight })
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Wheel-to-zoom via a NATIVE non-passive listener (React's onWheel is passive).
  useEffect(() => {
    const el = paneRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      setScale((s) => Math.min(8, Math.max(0.2, s - e.deltaY * 0.0015 * s)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // The letterboxed image rect within the pane (object-contain), as % of the pane.
  const contain = useMemo(() => {
    if (!natural || !pane.w || !pane.h) return null
    const fit = Math.min(pane.w / natural.w, pane.h / natural.h)
    const dw = natural.w * fit
    const dh = natural.h * fit
    return {
      left: ((pane.w - dw) / 2 / pane.w) * 100,
      top: ((pane.h - dh) / 2 / pane.h) * 100,
      width: (dw / pane.w) * 100,
      height: (dh / pane.h) * 100
    }
  }, [natural, pane])

  // Map a client point to normalized (0..1) image coords via the overlay's
  // on-screen rect (which already reflects the current zoom/pan transform).
  const toNorm = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const r = overlayRef.current?.getBoundingClientRect()
    if (!r || !r.width || !r.height) return null
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (clientY - r.top) / r.height))
    }
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (drawMode) {
      const n = toNorm(e.clientX, e.clientY)
      if (!n) return
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      drawing.current = { x0: n.x, y0: n.y }
      setDraft({ x: n.x, y: n.y, w: 0, h: 0 })
      setPicker(null)
      return
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (drawMode && drawing.current) {
      const n = toNorm(e.clientX, e.clientY)
      if (!n) return
      const { x0, y0 } = drawing.current
      setDraft({ x: Math.min(x0, n.x), y: Math.min(y0, n.y), w: Math.abs(n.x - x0), h: Math.abs(n.y - y0) })
      return
    }
    if (!drag.current) return
    setOffset({
      x: drag.current.ox + (e.clientX - drag.current.x),
      y: drag.current.oy + (e.clientY - drag.current.y)
    })
  }
  const onPointerUp = (e: React.PointerEvent): void => {
    if (drawMode && drawing.current) {
      drawing.current = null
      // Position the picker inside THIS component (so the Dialog's modal layer
      // still lets us interact with it) — coords are relative to the viewer.
      const root = rootRef.current?.getBoundingClientRect()
      const cardW = 288
      const cardH = 360
      const px = root ? Math.max(8, Math.min(e.clientX - root.left, root.width - cardW - 8)) : 8
      const py = root ? Math.max(8, Math.min(e.clientY - root.top + 8, root.height - cardH - 8)) : 8
      setDraft((d) => {
        if (d && d.w > 0.02 && d.h > 0.02) {
          setLabelText('')
          setPicker({ rect: d, px, py })
          return d
        }
        return null
      })
      return
    }
    drag.current = null
  }

  const commitRegion = async (personId: string | null, label: string | null): Promise<void> => {
    if (!documentId || !picker) return
    await window.api.regions.create({ documentId, personId, label, ...picker.rect })
    setPicker(null)
    setDraft(null)
    refreshRegions()
  }
  const removeRegion = async (id: string): Promise<void> => {
    await window.api.regions.remove(id)
    refreshRegions()
  }

  const regionName = (r: PhotoRegion): string => {
    if (r.personId) {
      const p = peopleById.get(r.personId)
      return p ? fullName(p) : r.personName || '…'
    }
    return r.label || ''
  }

  const boxStyle = (rect: Rect): React.CSSProperties => ({
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`
  })

  return (
    <div ref={rootRef} className="relative h-full w-full overflow-hidden rounded-lg bg-black/40">
      <div
        ref={paneRef}
        className={`h-full w-full ${drawMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div
          className="relative h-full w-full"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: drag.current || drawing.current ? 'none' : 'transform 0.08s ease-out'
          }}
        >
          <img
            src={src}
            alt={alt}
            draggable={false}
            onLoad={(e) => {
              setLoading(false)
              const im = e.currentTarget
              if (im.naturalWidth && im.naturalHeight) setNatural({ w: im.naturalWidth, h: im.naturalHeight })
            }}
            onError={() => {
              setLoading(false)
              onError?.()
            }}
            className="pointer-events-none mx-auto h-full w-full select-none object-contain"
            style={{ opacity: loading ? 0 : 1 }}
          />
          {/* Region overlay — sits exactly on the letterboxed image rect. */}
          {canTag && contain && (
            <div
              ref={overlayRef}
              className="pointer-events-none absolute"
              style={{
                left: `${contain.left}%`,
                top: `${contain.top}%`,
                width: `${contain.width}%`,
                height: `${contain.height}%`
              }}
            >
              {regions.map((r) => (
                <div
                  key={r.id}
                  onMouseEnter={() => setHoverId(r.id)}
                  onMouseLeave={() => setHoverId((h) => (h === r.id ? null : h))}
                  onClick={() => !drawMode && r.personId && openProfile(r.personId)}
                  className={`group absolute rounded-md border-2 transition-colors ${
                    hoverId === r.id ? 'border-primary bg-primary/10' : 'border-white/80 bg-white/5'
                  } ${drawMode ? 'pointer-events-none' : r.personId ? 'pointer-events-auto cursor-pointer' : 'pointer-events-auto'}`}
                  style={boxStyle(r)}
                >
                  <span className="pointer-events-none absolute -bottom-[1.35rem] left-0 max-w-[180px] truncate rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
                    {regionName(r)}
                  </span>
                  {drawMode && (
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        void removeRegion(r.id)
                      }}
                      title={t('documents.tagRemove')}
                      className="pointer-events-auto absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/80 text-white hover:bg-red-500"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
              {draft && (draft.w > 0 || draft.h > 0) && (
                <div
                  className="pointer-events-none absolute rounded-md border-2 border-dashed border-primary bg-primary/15"
                  style={boxStyle(draft)}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-9 w-9 animate-spin text-white/70" />
        </div>
      )}

      {/* Tag-mode hint */}
      {drawMode && !picker && (
        <div className="glass-strong pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs text-foreground">
          {t('documents.tagHint')}
        </div>
      )}

      {/* Toolbar */}
      <div className="glass-strong absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-2xl p-1">
        <Button variant="ghost" size="icon" title={t('documents.zoomOut')} onClick={() => setScale((s) => Math.max(0.2, s - 0.25))}>
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{Math.round(scale * 100)}%</span>
        <Button variant="ghost" size="icon" title={t('documents.zoomIn')} onClick={() => setScale((s) => Math.min(8, s + 0.25))}>
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" title={t('documents.reset')} onClick={reset}>
          <Maximize2 className="h-4 w-4" />
        </Button>
        {canTag && (
          <>
            <span className="mx-0.5 h-5 w-px bg-border/60" />
            <Button
              variant={tagMode ? 'default' : 'ghost'}
              size="icon"
              title={t('documents.tagPeople')}
              onClick={() => {
                setTagMode((v) => !v)
                setDraft(null)
                setPicker(null)
              }}
            >
              <ScanFace className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {/* Person picker popover (after drawing a box). Rendered INSIDE this
          component so the surrounding modal Dialog still lets us interact. */}
      {picker && (
        <>
          <div
            className="absolute inset-0 z-40 cursor-default"
            onPointerDown={(e) => {
              e.stopPropagation()
              setPicker(null)
              setDraft(null)
            }}
          />
          <div
            className="glass-strong absolute z-50 w-72 rounded-2xl p-3 shadow-xl"
            style={{ left: picker.px, top: picker.py }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <p className="mb-2 text-xs font-semibold text-foreground">{t('documents.tagAssign')}</p>
            <ExistingPersonPicker
              onPick={(p) => void commitRegion(p.id, null)}
              placeholder={t('picker.searchPlaceholder')}
            />
            <div className="mt-2 flex items-center gap-1.5 border-t border-border/50 pt-2">
              <Input
                value={labelText}
                onChange={(e) => setLabelText(e.target.value)}
                placeholder={t('documents.tagLabelOnly')}
                className="h-8 flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && labelText.trim()) void commitRegion(null, labelText.trim())
                }}
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                disabled={!labelText.trim()}
                onClick={() => labelText.trim() && void commitRegion(null, labelText.trim())}
              >
                <Check className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
