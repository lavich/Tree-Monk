import type Database from 'better-sqlite3'
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { SCHEMA_SQL } from '../main/db/schema'
import { applyMigrations } from '../main/db/migrations'
import { WasmDatabase } from './sqlite-adapter'
import { loadDbBytes, saveDbBytes, requestPersistentStorage } from './storage'

// Browser replacement for src/main/db/connection.ts (aliased in the web Vite
// config): the whole repository/domain layer runs unchanged on a WASM SQLite.
// Two modes share this module:
//  - read-only demo: `initDemoDb(bytes)` — in-memory sample, nothing persists.
//  - LOCAL web app:  `initLocalDb()` — the database lives in the browser's own
//    storage (OPFS/IndexedDB) and every mutation schedules a debounced save.
//    Data never leaves the user's machine.

let db: WasmDatabase | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null
let persistChain: Promise<void> = Promise.resolve()
let localMode = false

function schedulePersist(): void {
  if (!localMode) return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => void persistNow(), 800)
}

/** Flush the current database bytes to browser storage immediately. */
export function persistNow(): Promise<void> {
  if (!localMode || !db) return Promise.resolve()
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  const bytes = db.export()
  persistChain = persistChain.then(() => saveDbBytes(bytes)).catch(() => undefined)
  return persistChain
}

type SqlJsStatic = Awaited<ReturnType<typeof initSqlJs>>
let sqlJs: SqlJsStatic | null = null
async function engine(): Promise<SqlJsStatic> {
  if (!sqlJs) sqlJs = await initSqlJs({ locateFile: () => wasmUrl })
  return sqlJs
}

/** Read-only demo boot: load the bundled sample bytes, never persist. */
export async function initDemoDb(bytes: Uint8Array): Promise<void> {
  const SQL = await engine()
  localMode = false
  db = new WasmDatabase(new SQL.Database(bytes))
}

/**
 * Local web-app boot: restore the user's database from browser storage (or
 * start an empty one), run schema + migrations, and persist on every change.
 * Returns whether an existing database was found.
 */
export async function initLocalDb(bytes?: Uint8Array | null): Promise<boolean> {
  const SQL = await engine()
  requestPersistentStorage()
  const stored = bytes ?? (await loadDbBytes())
  localMode = true
  db = new WasmDatabase(stored ? new SQL.Database(stored) : new SQL.Database(), schedulePersist)
  const d = db as unknown as Database.Database
  d.exec(SCHEMA_SQL)
  applyMigrations(d)
  await persistNow()
  return !!stored
}

/** Swap in a whole replacement database (backup restore / sample load). */
export async function replaceLocalDb(bytes: Uint8Array): Promise<void> {
  const SQL = await engine()
  db?.close()
  localMode = true
  db = new WasmDatabase(new SQL.Database(bytes), schedulePersist)
  const d = db as unknown as Database.Database
  d.exec(SCHEMA_SQL)
  applyMigrations(d)
  await persistNow()
}

/** Raw bytes of the live database — downloads (backup / DB export). */
export function exportDbBytes(): Uint8Array {
  if (!db) throw new Error('Database not initialised')
  return db.export()
}

/**
 * Drop-in for the Electron main process's getDb(). Typed as better-sqlite3's
 * Database so the repository layer (written against it) type-checks unchanged;
 * the WASM adapter implements the synchronous subset the app actually calls.
 */
export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialised — call initLocalDb()/initDemoDb() first')
  return db as unknown as Database.Database
}

// Filesystem helpers the Node connection exposes. The browser build stores
// media in OPFS/IndexedDB (see storage.ts + media-web.ts); these path shapes
// only need to be stable identifiers.
export function dataDir(): string {
  return '/local'
}
export function mediaDir(): string {
  return 'opfs:media'
}
export function resolveMediaPath(filePath: string): string {
  return filePath
}
export function closeDb(): void {
  db?.close()
  db = null
}
