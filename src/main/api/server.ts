import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import {
  Aliases,
  AppSettings,
  Citations,
  Collaborations,
  Documents,
  Events,
  Families,
  Godparents,
  Notes,
  Occupations,
  People,
  Places,
  Repositories,
  ResearchLogs,
  Sources
} from '../db/repo'
import { getDb, resolveMediaPath } from '../db/connection'
import { buildPedigree } from '../db/pedigree'
import { buildAtlasPoints } from '../db/atlasData'
import { exportGedcom } from '../gedcom/export'
import type { ApiServerConfig, ApiServerStatus, Citation, EventRecord, FamilyInput, PersonInput } from '@shared/types'
import { DOCS_HTML } from './docs'
import { anyPluginEnabled, pluginScopesForToken } from '../plugins'

/**
 * TreeMonk Local API — an opt-in HTTP server bound STRICTLY to 127.0.0.1.
 *
 * Security model: OFF by default; every data route requires the Bearer token
 * generated in Settings; writes sit behind a second explicit toggle; the
 * socket never binds to a routable interface, so nothing is reachable from
 * the network. External writes go through the exact same repository layer as
 * the UI (audit history included) and broadcast a change event so open
 * windows refresh live.
 *
 * Env overrides (scripts / e2e): TREEMONK_API=1, TREEMONK_API_PORT,
 * TREEMONK_API_TOKEN, TREEMONK_API_WRITES=1.
 */

export type ApiConfig = ApiServerConfig
export type ApiStatus = ApiServerStatus

const DEFAULT_PORT = 27007

let server: Server | null = null
let status: ApiStatus = { running: false, port: DEFAULT_PORT, error: null }
let broadcast: () => void = () => undefined

/** The main process registers how to tell open windows about external writes. */
export function setApiChangeBroadcaster(fn: () => void): void {
  broadcast = fn
}

/** Tell every open window to refresh — for main-side background jobs (e.g. the
 *  post-import place standardization) that change data outside the UI's flow. */
export function notifyDataChanged(): void {
  broadcast()
}

function envBool(name: string): boolean | null {
  const v = process.env[name]
  if (v === undefined) return null
  return v === '1' || v.toLowerCase() === 'true'
}

export function getApiConfig(): ApiConfig {
  let token = AppSettings.get('api.token')
  if (!token) {
    token = randomBytes(24).toString('base64url')
    AppSettings.set('api.token', token)
  }
  const cfg: ApiConfig = {
    enabled: AppSettings.get('api.enabled') === '1',
    port: Number(AppSettings.get('api.port')) || DEFAULT_PORT,
    token,
    allowWrites: AppSettings.get('api.writes') === '1'
  }
  // Env overrides — used by scripts and the e2e suite.
  const e = envBool('TREEMONK_API')
  if (e !== null) cfg.enabled = e
  if (process.env.TREEMONK_API_PORT) cfg.port = Number(process.env.TREEMONK_API_PORT) || cfg.port
  if (process.env.TREEMONK_API_TOKEN) cfg.token = process.env.TREEMONK_API_TOKEN
  const w = envBool('TREEMONK_API_WRITES')
  if (w !== null) cfg.allowWrites = w
  return cfg
}

export function setApiConfig(patch: Partial<Omit<ApiConfig, 'token'>>): ApiConfig {
  if (patch.enabled !== undefined) AppSettings.set('api.enabled', patch.enabled ? '1' : '0')
  if (patch.port !== undefined) AppSettings.set('api.port', String(patch.port))
  if (patch.allowWrites !== undefined) AppSettings.set('api.writes', patch.allowWrites ? '1' : '0')
  restartApiServer()
  return getApiConfig()
}

export function regenerateApiToken(): string {
  const token = randomBytes(24).toString('base64url')
  AppSettings.set('api.token', token)
  return token
}

export function getApiStatus(): ApiStatus {
  return status
}

// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(
    public code: number,
    message: string
  ) {
    super(message)
  }
}

function json(res: ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(text)
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 1024 * 1024) throw new ApiError(413, 'Body too large (1 MB limit)')
    chunks.push(chunk as Buffer)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'))
  } catch {
    throw new ApiError(400, 'Invalid JSON body')
  }
}

function requireFamily(id: string): void {
  if (!Families.get(id)) throw new ApiError(404, 'Family not found')
}

function requirePerson(id: string): void {
  if (!People.get(id)) throw new ApiError(404, 'Person not found')
}

/** Person detail: the person plus their relations, events and occupations. */
function personDetail(id: string): unknown {
  const person = People.get(id)
  if (!person) throw new ApiError(404, 'Person not found')
  const families = Families.list()
  const asChild = families.find((f) => f.childIds.includes(id)) ?? null
  const unions = families.filter((f) => f.husbandId === id || f.wifeId === id)
  const events = Events.forOwner('person', id)
  return { person, parentsFamily: asChild, unions, events }
}

const PERSON_FIELDS: (keyof PersonInput)[] = [
  'givenName',
  'surname',
  'sex',
  'birthDate',
  'birthPlace',
  'deathDate',
  'deathPlace',
  'deceased',
  'illegitimate',
  'christeningDate',
  'christeningPlace',
  'burialDate',
  'burialPlace',
  'religion',
  'notes'
]
const FAMILY_FIELDS: (keyof FamilyInput)[] = [
  'husbandId',
  'wifeId',
  'marriageDate',
  'marriagePlace',
  'marriageOrder',
  'notes',
  'childIds'
]

function pick<T extends object>(body: unknown, fields: (keyof T)[]): Partial<T> {
  const src = (body ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const f of fields) if (f in src) out[f as string] = src[f as string]
  return out as Partial<T>
}

/** externalId (the caller's stable id) rides in the gedcomId column — the same
 *  slot GEDCOM imports use — so external captures and file imports share one
 *  dedup namespace. */
function externalIdOf(b: Record<string, unknown>): string | null {
  const v = b.externalId ?? b.gedcomId
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function upsertRepository(b: Record<string, unknown>): unknown {
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) throw new ApiError(400, 'Repository "name" is required')
  return Repositories.upsert({
    gedcomId: externalIdOf(b),
    name,
    address: typeof b.address === 'string' ? b.address : null
  })
}

function upsertSource(b: Record<string, unknown>): unknown {
  const title = typeof b.title === 'string' ? b.title.trim() : ''
  if (!title) throw new ApiError(400, 'Source "title" is required')
  const repositoryId = typeof b.repositoryId === 'string' ? b.repositoryId : null
  if (repositoryId && !Repositories.list().some((r) => r.id === repositoryId))
    throw new ApiError(404, 'repositoryId does not exist')
  return Sources.upsert({
    gedcomId: externalIdOf(b),
    title,
    author: typeof b.author === 'string' ? b.author : null,
    publication: typeof b.publication === 'string' ? b.publication : null,
    repositoryId,
    text: typeof b.text === 'string' ? b.text : null,
    recordDate: typeof b.recordDate === 'string' ? b.recordDate : null
  })
}

/** Citation on a person or family; `eventTag` binds it to a fact (BIRT, CHR,
 *  MARR, …) exactly like GEDCOM-imported citations. The scan permalink usually
 *  travels in `note` (or `page`). */
function createCitation(
  ownerType: 'person' | 'family',
  ownerId: string,
  b: Record<string, unknown>
): Citation {
  const sourceId = typeof b.sourceId === 'string' ? b.sourceId : ''
  if (!sourceId) throw new ApiError(400, 'Citation "sourceId" is required')
  if (!Sources.list().some((src) => src.id === sourceId))
    throw new ApiError(404, 'sourceId does not exist')
  return Citations.create({
    sourceId,
    ownerType,
    ownerId,
    eventTag: typeof b.eventTag === 'string' && b.eventTag.trim() ? b.eventTag.trim().toUpperCase() : null,
    page: typeof b.page === 'string' ? b.page : null,
    quality: typeof b.quality === 'string' ? b.quality : null,
    note: typeof b.note === 'string' ? b.note : null
  })
}

/**
 * One capture = one atomic transaction. Operations run in order inside a
 * single SQLite transaction (any failure rolls the whole batch back), and a
 * later operation references an earlier result's id as "$ref":
 *
 *   { "operations": [
 *     { "op": "repository.upsert", "ref": "archive", "data": { "externalId": "…", "name": "…" } },
 *     { "op": "source.upsert",     "ref": "book",    "data": { "externalId": "…", "title": "…", "repositoryId": "$archive" } },
 *     { "op": "person.create",     "ref": "p",       "data": { "givenName": "…", "surname": "…" } },
 *     { "op": "event.create",                        "data": { "ownerType": "person", "ownerId": "$p", "type": "baptism", "date": "1850" } },
 *     { "op": "citation.create",                     "data": { "ownerType": "person", "ownerId": "$p", "sourceId": "$book", "eventTag": "CHR", "page": "fol. 23" } }
 *   ] }
 */
const BATCH_MAX_OPS = 100
function runBatch(body: Record<string, unknown>): unknown {
  const ops = body.operations
  if (!Array.isArray(ops) || ops.length === 0) throw new ApiError(400, '"operations" must be a non-empty array')
  if (ops.length > BATCH_MAX_OPS) throw new ApiError(400, `At most ${BATCH_MAX_OPS} operations per batch`)

  const refs = new Map<string, string>()
  const resolve = (v: unknown): unknown => {
    if (typeof v === 'string' && v.startsWith('$')) {
      const id = refs.get(v.slice(1))
      if (!id) throw new ApiError(400, `Unknown reference "${v}" — refs must be defined by an earlier operation`)
      return id
    }
    if (Array.isArray(v)) return v.map(resolve)
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, resolve(x)]))
    return v
  }

  const results: { op: string; ref: string | null; id: string }[] = []
  const run = getDb().transaction(() => {
    ops.forEach((raw, i) => {
      const opName = typeof (raw as Record<string, unknown>)?.op === 'string' ? String((raw as Record<string, unknown>).op) : ''
      try {
        const data = resolve((raw as Record<string, unknown>).data ?? {}) as Record<string, unknown>
        let id: string
        switch (opName) {
          case 'repository.upsert':
            id = (upsertRepository(data) as { id: string }).id
            break
          case 'source.upsert':
            id = (upsertSource(data) as { id: string }).id
            break
          case 'person.create':
            id = People.create(pick<PersonInput>(data, PERSON_FIELDS)).id
            break
          case 'person.update': {
            const pid = String(data.id ?? '')
            if (!People.get(pid)) throw new ApiError(404, 'Person not found')
            id = People.update(pid, pick<PersonInput>(data, PERSON_FIELDS)).id
            break
          }
          case 'family.create':
            id = Families.create(pick<FamilyInput>(data, FAMILY_FIELDS)).id
            break
          case 'family.update': {
            const fid = String(data.id ?? '')
            if (!Families.get(fid)) throw new ApiError(404, 'Family not found')
            id = Families.update(fid, pick<FamilyInput>(data, FAMILY_FIELDS)).id
            break
          }
          case 'event.create': {
            const ownerType = data.ownerType === 'family' ? 'family' : 'person'
            const ownerId = String(data.ownerId ?? '')
            if (ownerType === 'person') requirePerson(ownerId)
            else requireFamily(ownerId)
            id = Events.create(ownerType, ownerId, {
              type: String(data.type ?? 'other'),
              date: (data.date as string | undefined) ?? null,
              endDate: (data.endDate as string | undefined) ?? null,
              place: (data.place as string | undefined) ?? null,
              value: (data.value as string | undefined) ?? null,
              note: (data.note as string | undefined) ?? null
            }).id
            break
          }
          case 'citation.create': {
            const ownerType = data.ownerType === 'family' ? 'family' : 'person'
            const ownerId = String(data.ownerId ?? '')
            if (ownerType === 'person') requirePerson(ownerId)
            else requireFamily(ownerId)
            id = createCitation(ownerType, ownerId, data).id
            break
          }
          default:
            throw new ApiError(400, `Unknown op "${opName}"`)
        }
        const ref = typeof (raw as Record<string, unknown>).ref === 'string' ? String((raw as Record<string, unknown>).ref) : null
        if (ref) refs.set(ref, id)
        results.push({ op: opName, ref, id })
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'failed'
        throw new ApiError(e instanceof ApiError ? e.code : 400, `operations[${i}] (${opName || '?'}): ${msg}`)
      }
    })
  })
  run()
  return { results }
}

interface Route {
  method: string
  pattern: RegExp
  write?: boolean
  /** Extra scope a PLUGIN token needs beyond read/write (e.g. document files). */
  scope?: 'documents'
  handler: (req: IncomingMessage, params: string[], query: URLSearchParams) => Promise<unknown> | unknown
}

const routes: Route[] = [
  {
    method: 'GET',
    pattern: /^\/api\/v1\/stats$/,
    handler: () => {
      const people = People.list()
      const families = Families.list()
      const places = Places.list()
      let earliest: number | null = null
      let latest: number | null = null
      for (const p of people) {
        const y = Number((p.birthDate ?? '').match(/\d{4}/)?.[0])
        if (y) {
          if (earliest === null || y < earliest) earliest = y
          if (latest === null || y > latest) latest = y
        }
      }
      return {
        people: people.length,
        families: families.length,
        geocodedPlaces: places.length,
        earliestBirthYear: earliest,
        latestBirthYear: latest
      }
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/people$/,
    handler: (_req, _p, query) => {
      const q = (query.get('q') ?? '').trim().toLowerCase()
      const limit = Math.min(Number(query.get('limit')) || 100, 500)
      const offset = Number(query.get('offset')) || 0
      let list = People.list()
      if (q)
        list = list.filter((p) =>
          `${p.givenName} ${p.surname} ${p.surname} ${p.givenName}`.toLowerCase().includes(q)
        )
      return { total: list.length, offset, items: list.slice(offset, offset + limit) }
    }
  },
  { method: 'GET', pattern: /^\/api\/v1\/people\/([^/]+)$/, handler: (_r, [id]) => personDetail(id) },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/people$/,
    write: true,
    handler: async (req) => People.create(pick<PersonInput>(await readBody(req), PERSON_FIELDS))
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/v1\/people\/([^/]+)$/,
    write: true,
    handler: async (req, [id]) => {
      if (!People.get(id)) throw new ApiError(404, 'Person not found')
      return People.update(id, pick<PersonInput>(await readBody(req), PERSON_FIELDS))
    }
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/v1\/people\/([^/]+)$/,
    write: true,
    handler: (_r, [id]) => {
      if (!People.get(id)) throw new ApiError(404, 'Person not found')
      People.remove(id)
      return { deleted: id }
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/families$/,
    handler: (_r, _p, query) => {
      const limit = Math.min(Number(query.get('limit')) || 200, 1000)
      const offset = Number(query.get('offset')) || 0
      const list = Families.list()
      return { total: list.length, offset, items: list.slice(offset, offset + limit) }
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/families\/([^/]+)$/,
    handler: (_r, [id]) => {
      const f = Families.get(id)
      if (!f) throw new ApiError(404, 'Family not found')
      return f
    }
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/families$/,
    write: true,
    handler: async (req) => Families.create(pick<FamilyInput>(await readBody(req), FAMILY_FIELDS))
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/v1\/families\/([^/]+)$/,
    write: true,
    handler: async (req, [id]) => {
      if (!Families.get(id)) throw new ApiError(404, 'Family not found')
      return Families.update(id, pick<FamilyInput>(await readBody(req), FAMILY_FIELDS))
    }
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/v1\/families\/([^/]+)$/,
    write: true,
    handler: (_r, [id]) => {
      if (!Families.get(id)) throw new ApiError(404, 'Family not found')
      Families.remove(id)
      return { deleted: id }
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/people\/([^/]+)\/events$/,
    handler: (_r, [id]) => Events.forOwner('person', id)
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/people\/([^/]+)\/events$/,
    write: true,
    handler: async (req, [id]) => {
      if (!People.get(id)) throw new ApiError(404, 'Person not found')
      const b = (await readBody(req)) as Partial<EventRecord>
      return Events.create('person', id, {
        type: String(b.type ?? 'other'),
        date: b.date ?? null,
        endDate: b.endDate ?? null,
        place: b.place ?? null,
        value: b.value ?? null,
        note: b.note ?? null
      })
    }
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/v1\/events\/([^/]+)$/,
    write: true,
    handler: (_r, [id]) => {
      Events.remove(id)
      return { deleted: id }
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/people\/([^/]+)\/documents$/,
    handler: (_r, [id]) => {
      if (!People.get(id)) throw new ApiError(404, 'Person not found')
      return Documents.listForPerson(id)
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/documents\/([^/]+)\/file$/,
    scope: 'documents',
    handler: (_r, [id]) => {
      const doc = Documents.get(id)
      if (!doc) throw new ApiError(404, 'Document not found')
      if (/^https?:\/\//i.test(doc.filePath))
        throw new ApiError(409, 'File not downloaded locally yet — open it in the app first')
      const filePath = resolveMediaPath(doc.filePath)
      if (!existsSync(filePath)) throw new ApiError(410, 'File missing on disk')
      const mime =
        doc.mimeType ||
        { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf' }[
          extname(filePath).toLowerCase()
        ] ||
        'application/octet-stream'
      return { __raw: { mime, body: readFileSync(filePath) } }
    }
  },
  // ---- Research & profile extras (sources, occupations, aliases, …) ----
  {
    method: 'GET',
    pattern: /^\/api\/v1\/people\/([^/]+)\/citations$/,
    handler: (_r, [id]) => {
      requirePerson(id)
      return Citations.forOwner('person', id)
    }
  },
  // ---- Source / repository / citation writes (external capture tools) ------
  // External research tools (e.g. church-book citation helpers) create the
  // register, the archive and the page-level citation in one flow. Dedup runs
  // on `externalId`: the caller's own stable id is stored as the record's
  // gedcomId, so re-sending the same capture is idempotent.
  {
    method: 'GET',
    pattern: /^\/api\/v1\/repositories$/,
    handler: () => Repositories.list()
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/repositories$/,
    write: true,
    handler: async (req) => upsertRepository((await readBody(req)) as Record<string, unknown>)
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/sources$/,
    handler: (_r, _p, query) => {
      const q = (query.get('q') ?? '').trim().toLowerCase()
      let list = Sources.list()
      if (q)
        list = list.filter((src) =>
          `${src.title} ${src.author ?? ''} ${src.gedcomId ?? ''}`.toLowerCase().includes(q)
        )
      return list
    }
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/sources$/,
    write: true,
    handler: async (req) => upsertSource((await readBody(req)) as Record<string, unknown>)
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/people\/([^/]+)\/citations$/,
    write: true,
    handler: async (req, [id]) => {
      requirePerson(id)
      return createCitation('person', id, (await readBody(req)) as Record<string, unknown>)
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/families\/([^/]+)\/citations$/,
    handler: (_r, [id]) => {
      requireFamily(id)
      return Citations.forOwner('family', id)
    }
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/families\/([^/]+)\/citations$/,
    write: true,
    handler: async (req, [id]) => {
      requireFamily(id)
      return createCitation('family', id, (await readBody(req)) as Record<string, unknown>)
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/families\/([^/]+)\/events$/,
    handler: (_r, [id]) => {
      requireFamily(id)
      return Events.forOwner('family', id)
    }
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/families\/([^/]+)\/events$/,
    write: true,
    handler: async (req, [id]) => {
      requireFamily(id)
      const b = (await readBody(req)) as Partial<EventRecord>
      return Events.create('family', id, {
        type: String(b.type ?? 'other'),
        date: b.date ?? null,
        endDate: b.endDate ?? null,
        place: b.place ?? null,
        value: b.value ?? null,
        note: b.note ?? null
      })
    }
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/batch$/,
    write: true,
    handler: async (req) => runBatch((await readBody(req)) as Record<string, unknown>)
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/people\/([^/]+)\/occupations$/,
    handler: (_r, [id]) => {
      requirePerson(id)
      return Occupations.forPerson(id)
    }
  },
  { method: 'GET', pattern: /^\/api\/v1\/occupations$/, handler: () => Occupations.all() },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/people\/([^/]+)\/aliases$/,
    handler: (_r, [id]) => {
      requirePerson(id)
      return Aliases.forPerson(id)
    }
  },
  { method: 'GET', pattern: /^\/api\/v1\/aliases$/, handler: () => Aliases.all() },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/people\/([^/]+)\/godparents$/,
    handler: (_r, [id]) => {
      requirePerson(id)
      // Both directions at once: this person's godparents AND godchildren.
      return { godparentIds: Godparents.forPerson(id), godchildIds: Godparents.godchildrenOf(id) }
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/people\/([^/]+)\/notes$/,
    handler: (_r, [id]) => {
      requirePerson(id)
      return Notes.forOwner('person', id)
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/people\/([^/]+)\/research-logs$/,
    handler: (_r, [id]) => {
      requirePerson(id)
      return ResearchLogs.forPerson(id)
    }
  },
  { method: 'GET', pattern: /^\/api\/v1\/research-logs$/, handler: () => ResearchLogs.all() },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/people\/([^/]+)\/collaborations$/,
    handler: (_r, [id]) => {
      requirePerson(id)
      return Collaborations.forPerson(id)
    }
  },
  { method: 'GET', pattern: /^\/api\/v1\/places$/, handler: () => Places.list() },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/pedigree$/,
    handler: (_r, _p, query) => buildPedigree(query.get('rootId') ?? undefined) ?? {}
  },
  { method: 'GET', pattern: /^\/api\/v1\/atlas\/points$/, handler: () => buildAtlasPoints() },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/export\/gedcom$/,
    handler: () => {
      const file = join(tmpdir(), `treemonk-api-${Date.now()}.ged`)
      return { gedcom: exportGedcom(file) }
    }
  }
]

async function handle(req: IncomingMessage, res: ServerResponse, cfg: ApiConfig): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname

  // CORS: plugin panels run in sandboxed frames (opaque origin), so their
  // fetches are cross-origin. Auth stays entirely with the Bearer token —
  // without one, every data route still returns 401.
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600'
    })
    res.end()
    return
  }

  // Unauthenticated, data-free routes.
  if (path === '/api/v1/ping') return json(res, 200, { name: 'TreeMonk', version: app.getVersion() })
  if (path === '/docs' || path === '/docs/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(DOCS_HTML)
    return
  }
  if (path === '/api/v1/openapi.json') return json(res, 200, buildOpenApi(cfg))

  // Everything else requires a Bearer token: the user's MAIN token (full
  // access, gated by the Settings toggles) or an enabled PLUGIN's own token
  // (gated by the scopes the user approved for that plugin).
  const auth = req.headers.authorization ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const isMain = bearer !== '' && bearer === cfg.token
  const pluginScopes = isMain ? null : pluginScopesForToken(bearer)
  if (!isMain && !pluginScopes) return json(res, 401, { error: 'Missing or invalid Bearer token' })

  // The API itself may be off in Settings while the server only runs for
  // plugin panels — then the main token has no data surface here.
  if (isMain && !cfg.enabled) return json(res, 403, { error: 'The local API is disabled in Settings' })

  for (const r of routes) {
    if (req.method !== r.method) continue
    const m = path.match(r.pattern)
    if (!m) continue
    if (pluginScopes) {
      const needed = r.write ? 'write' : (r.scope ?? 'read')
      if (!pluginScopes.includes(needed))
        return json(res, 403, { error: `This plugin was not granted the "${needed}" permission` })
    } else if (r.write && !cfg.allowWrites) {
      return json(res, 403, { error: 'Writes are disabled in Settings' })
    }
    try {
      const result = await r.handler(req, m.slice(1).map(decodeURIComponent), url.searchParams)
      if (result && typeof result === 'object' && '__raw' in (result as Record<string, unknown>)) {
        const raw = (result as { __raw: { mime: string; body: Buffer } }).__raw
        res.writeHead(200, { 'Content-Type': raw.mime, 'Content-Length': raw.body.length })
        res.end(raw.body)
      } else {
        json(res, req.method === 'POST' ? 201 : 200, result)
      }
      if (r.write) broadcast()
    } catch (e) {
      if (e instanceof ApiError) return json(res, e.code, { error: e.message })
      json(res, 500, { error: e instanceof Error ? e.message : 'Internal error' })
    }
    return
  }
  json(res, 404, { error: 'Unknown endpoint — see /docs' })
}

export function startApiIfEnabled(): void {
  const cfg = getApiConfig()
  // The server also runs while any plugin is enabled — plugin panels talk to
  // the data through it (still 127.0.0.1-only, still token-gated per plugin).
  if (!cfg.enabled && !anyPluginEnabled()) return
  stopApiServer()
  try {
    server = createServer((req, res) => {
      void handle(req, res, getApiConfig()).catch(() => {
        if (!res.headersSent) json(res, 500, { error: 'Internal error' })
      })
    })
    server.on('error', (e) => {
      status = { running: false, port: cfg.port, error: (e as NodeJS.ErrnoException).code ?? e.message }
      server = null
    })
    // 127.0.0.1 ONLY — never reachable from the network.
    server.listen(cfg.port, '127.0.0.1', () => {
      status = { running: true, port: cfg.port, error: null }
    })
  } catch (e) {
    status = { running: false, port: cfg.port, error: e instanceof Error ? e.message : String(e) }
  }
}

export function stopApiServer(): void {
  if (server) {
    server.close()
    server = null
  }
  status = { running: false, port: getApiConfig().port, error: null }
}

export function restartApiServer(): void {
  stopApiServer()
  startApiIfEnabled()
}

// ---------------------------------------------------------------------------

/** Hand-maintained OpenAPI 3.1 description of the surface above. */
function buildOpenApi(cfg: ApiConfig): unknown {
  const p = (
    summary: string,
    opts: { write?: boolean; params?: unknown[]; body?: boolean } = {}
  ): unknown => ({
    summary: opts.write ? `${summary} (requires writes toggle)` : summary,
    security: [{ bearer: [] }],
    ...(opts.params ? { parameters: opts.params } : {}),
    ...(opts.body ? { requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } } : {}),
    responses: { '200': { description: 'OK' } }
  })
  const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
  return {
    openapi: '3.1.0',
    info: {
      title: 'TreeMonk Local API',
      version: app.getVersion(),
      description:
        'Local-first genealogy data over HTTP. Bound to 127.0.0.1; every data route requires the Bearer token from Settings.'
    },
    servers: [{ url: `http://127.0.0.1:${cfg.port}` }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } }
    },
    paths: {
      '/api/v1/ping': { get: { summary: 'Health check (no auth)', responses: { '200': { description: 'OK' } } } },
      '/api/v1/stats': { get: p('Tree statistics') },
      '/api/v1/people': {
        get: p('List / search people', {
          params: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 500 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }
          ]
        }),
        post: p('Create a person', { write: true, body: true })
      },
      '/api/v1/people/{id}': {
        get: p('Person detail (relations + events)', { params: [idParam] }),
        patch: p('Update person fields', { write: true, params: [idParam], body: true }),
        delete: p('Delete a person', { write: true, params: [idParam] })
      },
      '/api/v1/people/{id}/events': {
        get: p('Life events of a person', { params: [idParam] }),
        post: p('Add a life event', { write: true, params: [idParam], body: true })
      },
      '/api/v1/events/{id}': { delete: p('Delete a life event', { write: true, params: [idParam] }) },
      '/api/v1/families': {
        get: p('List families'),
        post: p('Create a family', { write: true, body: true })
      },
      '/api/v1/families/{id}': {
        get: p('Family detail', { params: [idParam] }),
        patch: p('Update family fields', { write: true, params: [idParam], body: true }),
        delete: p('Delete a family', { write: true, params: [idParam] })
      },
      '/api/v1/people/{id}/documents': {
        get: p('Documents attached to a person', { params: [idParam] })
      },
      '/api/v1/people/{id}/citations': {
        get: p('Source citations of a person (source title/author/text, event tag, quality)', { params: [idParam] }),
        post: p('Add a citation to a person — sourceId, eventTag (BIRT/CHR/MARR/…), page, quality, note', {
          write: true,
          params: [idParam],
          body: true
        })
      },
      '/api/v1/families/{id}/citations': {
        get: p('Source citations of a family (marriage records etc.)', { params: [idParam] }),
        post: p('Add a citation to a family — sourceId, eventTag (usually MARR), page, quality, note', {
          write: true,
          params: [idParam],
          body: true
        })
      },
      '/api/v1/families/{id}/events': {
        get: p('Family (union) events — marriage-related events belong to the couple', { params: [idParam] }),
        post: p('Add a family event — type, date, place, note', { write: true, params: [idParam], body: true })
      },
      '/api/v1/repositories': {
        get: p('List repositories (archives)'),
        post: p('Create/update a repository — name, address; "externalId" makes the call idempotent', {
          write: true,
          body: true
        })
      },
      '/api/v1/sources': {
        get: p('List sources', { params: [{ name: 'q', in: 'query', schema: { type: 'string' } }] }),
        post: p('Create/update a source — title, author, publication (link), repositoryId, text, recordDate; "externalId" makes the call idempotent', {
          write: true,
          body: true
        })
      },
      '/api/v1/batch': {
        post: p('Run up to 100 operations in ONE atomic transaction; later ops reference earlier results via "$ref". Ops: repository.upsert, source.upsert, person.create/update, family.create/update, event.create, citation.create', {
          write: true,
          body: true
        })
      },
      '/api/v1/people/{id}/occupations': {
        get: p('Occupations of a person (time-scoped)', { params: [idParam] })
      },
      '/api/v1/occupations': { get: p('Every occupation of every person') },
      '/api/v1/people/{id}/aliases': {
        get: p('Name variants / AKA aliases of a person', { params: [idParam] })
      },
      '/api/v1/aliases': { get: p('Every alias of every person') },
      '/api/v1/people/{id}/godparents': {
        get: p('Godparent ids of a person + the people they are godparent of', { params: [idParam] })
      },
      '/api/v1/people/{id}/notes': {
        get: p('Free-text notes attached to a person', { params: [idParam] })
      },
      '/api/v1/people/{id}/research-logs': {
        get: p('Research log entries for a person', { params: [idParam] })
      },
      '/api/v1/research-logs': { get: p('Every research log entry (incl. general ones)') },
      '/api/v1/people/{id}/collaborations': {
        get: p('FamilySearch collaboration discussions (read-only)', { params: [idParam] })
      },
      '/api/v1/documents/{id}/file': {
        get: p('Raw document file (image/PDF binary)', { params: [idParam] })
      },
      '/api/v1/places': { get: p('Geocoded places') },
      '/api/v1/pedigree': {
        get: p('Pedigree tree of couples', {
          params: [{ name: 'rootId', in: 'query', schema: { type: 'string' } }]
        })
      },
      '/api/v1/atlas/points': { get: p('Every geocoded life event') },
      '/api/v1/export/gedcom': { get: p('Full GEDCOM export (text)') }
    }
  }
}
