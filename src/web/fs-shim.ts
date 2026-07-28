/**
 * Browser stand-in for Node's `fs`, aliased in vite.web.config.ts. The domain
 * layer only touches the filesystem around import/export edges; in the browser
 * those edges become no-ops (missing local files are simply skipped) — except
 * writes, which are CAPTURED so the web API layer can turn the "written file"
 * into a download (GEDCOM / website export).
 */

let lastWritten: { path: string; data: string | Uint8Array } | null = null

/** The most recent writeFileSync payload — consumed by the web export flows. */
export function takeLastWrittenFile(): { path: string; data: string | Uint8Array } | null {
  const w = lastWritten
  lastWritten = null
  return w
}

export function existsSync(): boolean {
  return false
}
export function readFileSync(): never {
  throw new Error('fs.readFileSync is not available in the browser build')
}
export function writeFileSync(path: string, data: string | Uint8Array): void {
  lastWritten = { path, data }
}
export function copyFileSync(): never {
  throw new Error('fs.copyFileSync is not available in the browser build')
}
export function mkdirSync(): void {}
export function readdirSync(): string[] {
  return []
}
export function unlinkSync(): void {}
