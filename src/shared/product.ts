/**
 * The product's user-facing identity.
 *
 * ONE place, because the two editions differ only here: the free build is
 * "TreeMonk 2026 Essentials", the paid one "TreeMonk 2026 Pro". Anything shown
 * to the user — splash, window title, About, exports — reads it from here, so
 * an edition never leaks the other one's name.
 *
 * `PRODUCT_BRAND` stays the bare wordmark. It is the logo, and a compact print
 * footer or a graphic mark wants the brand, not the full edition string.
 *
 * NOTE: none of this may reach `app.getName()`. The user data directory is
 * derived from the app name, so renaming the product must never move it — see
 * the explicit `app.setName()` in the main process.
 */
export const PRODUCT_BRAND = 'TreeMonk'
export const PRODUCT_EDITION = '2026 Essentials'
export const PRODUCT_NAME = `${PRODUCT_BRAND} ${PRODUCT_EDITION}`
