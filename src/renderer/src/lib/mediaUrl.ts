/**
 * URL for a stored document. In the Electron app documents are served by the
 * main-process `tmedia://` protocol (native `<img src>`, on-the-fly thumbnails).
 * In the browser build there is no custom protocol: the web entry maintains a
 * docId → URL registry (`window.__tmMediaUrls`) of blob URLs (OPFS-stored
 * files) and direct http(s) URLs (remote GEDCOM/FS media) instead.
 */

function webMediaUrl(documentId: string): string | null {
  const reg = (window as unknown as { __tmMediaUrls?: Map<string, string> }).__tmMediaUrls
  return reg?.get(documentId) ?? null
}

export const mediaUrl = (documentId: string): string =>
  webMediaUrl(documentId) ?? `tmedia://media/${documentId}`

/**
 * A downscaled JPEG thumbnail of a stored image (the main process resizes it on
 * the fly and caches it). Far lighter than the full-resolution original — use it
 * for grids and avatars. Use `mediaUrl()` for the full-size viewer. The browser
 * build serves the full image (no resizer) — fine at web-app scale.
 */
export const mediaThumb = (documentId: string, width: number): string =>
  webMediaUrl(documentId) ?? `tmedia://media/${documentId}?w=${Math.round(width)}`
