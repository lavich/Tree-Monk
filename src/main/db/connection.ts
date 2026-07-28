import { app } from 'electron'
import { basename, join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from './schema'
import { applyMigrations } from './migrations'
import { applyAuditSchema, Audit } from './audit'
import { activeDbFile } from '../workspaces'

let db: Database.Database | null = null

/** Absolute path to the per-user data directory where DB + media live. */
export function dataDir(): string {
  const dir = join(app.getPath('userData'), 'data')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function mediaDir(): string {
  const dir = join(dataDir(), 'media')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Resolves a stored local media path that may come from ANOTHER machine.
 * Documents record absolute paths, so a backup restored under a different
 * Windows username (or drive) points at the old machine's folders even though
 * the files themselves were restored fine. If the recorded path is gone but a
 * file with the same name sits in the current media folder, use that one.
 * Existing paths (and remote URLs) pass through untouched.
 */
export function resolveMediaPath(filePath: string): string {
  if (!filePath || /^https?:\/\//i.test(filePath) || existsSync(filePath)) return filePath
  const local = join(mediaDir(), basename(filePath))
  return existsSync(local) ? local : filePath
}


export function getDb(): Database.Database {
  if (db) return db
  // The active workspace decides which database file we open (each family tree
  // is a separate file). dataDir() is still ensured for media/backups.
  dataDir()
  const file = activeDbFile()
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // Never block forever on a locked database (a second instance, antivirus, or a
  // cloud-sync handle holding the file): fail the query after 5s instead, so the
  // renderer surfaces an error rather than hanging on the splash indefinitely.
  db.pragma('busy_timeout = 5000')
  db.exec(SCHEMA_SQL)
  applyMigrations(db)
  // Change-history triggers go on AFTER the one-time migrations above, and we
  // only switch logging on once init is done — so schema setup, column ALTERs and
  // data back-fills never appear in the user-facing audit log.
  applyAuditSchema(db)
  Audit.enable()
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}
