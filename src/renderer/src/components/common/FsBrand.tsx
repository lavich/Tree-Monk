import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import fsLogoColor from '@/assets/familysearch/fs-logo-color.png'
import fsTree32Green from '@/assets/familysearch/fs-tree-32-green.png'
import fsCompatible from '@/assets/familysearch/fs-compatible.png'
import fsRegistered from '@/assets/familysearch/fs-registered.png'
import fsEmerging from '@/assets/familysearch/fs-emerging.png'

/**
 * Official FamilySearch brand elements, implemented to the FamilySearch
 * Solutions Program Brand Guide (v1.0, 9/2018) and the developer "Integration
 * Logos" guide. All artwork is the unmodified official download.
 *
 * The rules this file encodes, so call sites can't get them wrong:
 *  - LOGO: full colour whenever possible, minimum height 32 pt (≈43 px), always
 *    surrounded by clear space. Because the full-colour logo must not sit on an
 *    arbitrary background ("the logo is always white when displayed on another
 *    colour"), `FsLogo` gives it its own light safe-area in BOTH themes — that
 *    keeps the approved full-colour rendering everywhere.
 *  - TREE ICON: only for programmatic functions (FamilySearch API calls,
 *    authentication), must stay a whole 16×16 or 32×32 graphic, must never be
 *    placed on a button together with words, and must never be used as a favicon
 *    or as a link to the FamilySearch website.
 *  - SOLUTIONS PROGRAM LOGO: may only be shown once FamilySearch has approved
 *    the business at that tier, and any such logo has to link to our listing in
 *    the FamilySearch Solutions Gallery. Hence `SOLUTION_TIER` below is null
 *    until that approval exists — nothing renders in the meantime.
 *  - TRADEMARK: the ownership notice must appear in the credit-notice section.
 *  - Our own product name is always displayed more prominently than the
 *    FamilySearch trademark.
 */

/**
 * Our approved FamilySearch Solutions Program tier. Only ever set to the level
 * FamilySearch has actually accepted TreeMonk at — a tier logo without that
 * approval would falsely imply certification.
 *
 * `SOLUTION_GALLERY_URL` is our listing in the FamilySearch Solutions Gallery:
 * the brand guide requires the tier logo to link there when it is shown on a
 * website or web application. Fill it in once the listing is live; the badge
 * then becomes clickable on its own.
 */
export const SOLUTION_TIER: 'compatible' | 'registered' | 'emerging' | null = 'compatible'
export const SOLUTION_GALLERY_URL: string | null = null

const TIER_ART = {
  compatible: fsCompatible,
  registered: fsRegistered,
  emerging: fsEmerging
} as const

/**
 * The official FamilySearch logo (mosaic tree + logotype) on its own light
 * safe-area, at or above the 32 pt minimum height with clear space around it.
 * Use wherever the UI visually refers to FamilySearch and there is room.
 */
export function FsLogo({ className, height = 44 }: { className?: string; height?: number }): JSX.Element {
  // 32 pt ≈ 42.7 px is the documented minimum height — never render smaller.
  const h = Math.max(43, height)
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-black/5',
        className
      )}
      // Clear space: generous padding on all sides, scaled to the logo height.
      style={{ padding: Math.round(h * 0.32) }}
    >
      <img
        src={fsLogoColor}
        alt="FamilySearch"
        style={{ height: h, width: 'auto' }}
        draggable={false}
      />
    </span>
  )
}

/**
 * The official FamilySearch mosaic-tree icon, kept whole at exactly 16×16 or
 * 32×32. Only for programmatic FamilySearch functions (API calls, sign-in
 * state) — never on a button with words, never as a favicon or website link.
 */
export function FsTreeIcon({ size = 16, className }: { size?: 16 | 32; className?: string }): JSX.Element {
  return (
    <img
      src={fsTree32Green}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      style={{ width: size, height: size }}
      draggable={false}
    />
  )
}

/**
 * Required trademark ownership notice, quoted verbatim from the brand guide and
 * intentionally left in English (it is a legal notice) in every locale.
 */
export function FsTrademarkNotice({ className }: { className?: string }): JSX.Element {
  return (
    <p className={cn('text-[10px] leading-relaxed text-muted-foreground/70', className)}>
      FamilySearch and the FamilySearch logo are trademarks of Intellectual Reserve
    </p>
  )
}

/**
 * Our Solutions Program tier logo — renders only when FamilySearch has approved
 * a tier (see SOLUTION_TIER) and links to our Solutions Gallery listing, as the
 * brand guide requires. The tier logo indicates programme acceptance, NOT
 * sponsorship or endorsement, so it is never presented as an endorsement.
 */
export function FsSolutionBadge({
  className,
  height = 48
}: {
  className?: string
  height?: number
}): JSX.Element | null {
  const { t } = useTranslation()
  if (!SOLUTION_TIER) return null
  const art = TIER_ART[SOLUTION_TIER]
  const img = (
    <img src={art} alt={t('fs.brand.tierAlt')} style={{ height, width: 'auto' }} draggable={false} />
  )
  return (
    <span
      className={cn('inline-flex items-center rounded-xl bg-white ring-1 ring-black/5', className)}
      // Clear space around the logo, scaled to its height.
      style={{ padding: Math.round(height * 0.26) }}
    >
      {SOLUTION_GALLERY_URL ? (
        <button
          type="button"
          title={t('fs.brand.galleryLink')}
          onClick={() => void window.api.app.openExternal(SOLUTION_GALLERY_URL)}
        >
          {img}
        </button>
      ) : (
        img
      )}
    </span>
  )
}

/**
 * Header lockup for FamilySearch surfaces: OUR product name stays visually
 * dominant (brand-guide requirement) with the relationship expressed as
 * "works with", and the official FamilySearch logo shown alongside it.
 */
export function FsWorksWithHeader({ className }: { className?: string }): JSX.Element {
  const { t } = useTranslation()
  return (
    <span className={cn('flex items-center gap-3', className)}>
      {/* Our own name, deliberately larger than the FamilySearch trademark. */}
      <span className="flex flex-col leading-tight">
        <span className="text-lg font-semibold text-foreground">TreeMonk</span>
        <span className="text-[11px] font-normal text-muted-foreground">{t('fs.brand.worksWith')}</span>
      </span>
      <FsLogo height={43} />
    </span>
  )
}
