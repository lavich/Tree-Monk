import type { Database as SqlJsDatabase, BindParams, SqlValue } from 'sql.js'

/** better-sqlite3's `.run()` return shape (only `changes` is used by the app). */
export interface RunResult {
  changes: number
  lastInsertRowid: number
}

type Row = Record<string, SqlValue>

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array)
}

/**
 * Maps better-sqlite3-style call arguments to sql.js bind params.
 *  - a single plain object  → named binding (the app writes `@name` in SQL)
 *  - anything else          → positional `?` binding
 */
function toBind(args: unknown[]): BindParams | undefined {
  if (args.length === 0) return undefined
  if (args.length === 1 && isPlainObject(args[0])) {
    const out: Record<string, SqlValue> = {}
    for (const [k, v] of Object.entries(args[0])) out['@' + k] = v as SqlValue
    return out
  }
  return args as SqlValue[]
}

/** A prepared statement exposing the subset of better-sqlite3 the app uses. */
class WasmStatement {
  constructor(
    private readonly db: SqlJsDatabase,
    private readonly sql: string
  ) {}

  all(...args: unknown[]): Row[] {
    const s = this.db.prepare(this.sql)
    try {
      const bind = toBind(args)
      if (bind) s.bind(bind)
      const rows: Row[] = []
      while (s.step()) rows.push(s.getAsObject())
      return rows
    } finally {
      s.free()
    }
  }

  get(...args: unknown[]): Row | undefined {
    const s = this.db.prepare(this.sql)
    try {
      const bind = toBind(args)
      if (bind) s.bind(bind)
      return s.step() ? s.getAsObject() : undefined
    } finally {
      s.free()
    }
  }

  run(...args: unknown[]): RunResult {
    const s = this.db.prepare(this.sql)
    try {
      const bind = toBind(args)
      if (bind) s.bind(bind)
      s.step()
      return { changes: this.db.getRowsModified(), lastInsertRowid: 0 }
    } finally {
      s.free()
    }
  }
}

/**
 * Wraps a sql.js (WASM SQLite) database so the app's repository layer — written
 * against better-sqlite3's synchronous API — runs unchanged in the browser.
 * The local web build passes an `onMutate` hook that schedules persisting the
 * database bytes (OPFS/IndexedDB); the read-only demo passes none.
 */
export class WasmDatabase {
  constructor(
    private readonly db: SqlJsDatabase,
    private readonly onMutate?: () => void
  ) {}

  prepare(sql: string): WasmStatement {
    const stmt = new WasmStatement(this.db, sql)
    if (this.onMutate && /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) {
      const notify = this.onMutate
      const run = stmt.run.bind(stmt)
      stmt.run = (...args: unknown[]): RunResult => {
        const r = run(...args)
        notify()
        return r
      }
    }
    return stmt
  }

  /** Run one or more statements, ignoring any rows (schema / pragmas). */
  exec(sql: string): this {
    this.db.run(sql)
    if (this.onMutate && !/^\s*(SELECT|BEGIN|COMMIT|ROLLBACK|PRAGMA)\b/i.test(sql)) this.onMutate()
    return this
  }

  /** Raw SQLite bytes of the current database — the persistence payload. */
  export(): Uint8Array {
    return this.db.export()
  }

  /** No-op: WAL / foreign-key pragmas are irrelevant for an in-memory copy. */
  pragma(): unknown[] {
    return []
  }

  transaction<T extends (...a: never[]) => unknown>(fn: T): T {
    const wrapped = (...args: Parameters<T>): ReturnType<T> => {
      this.db.run('BEGIN')
      try {
        const r = fn(...args) as ReturnType<T>
        this.db.run('COMMIT')
        return r
      } catch (e) {
        this.db.run('ROLLBACK')
        throw e
      }
    }
    return wrapped as unknown as T
  }

  close(): void {
    this.db.close()
  }
}
