import { Documents, People } from '../main/db/repo'
import { readMediaFile, writeMediaFile } from './storage'
import type { DocumentKind, DocumentRecord } from '@shared/types'

/**
 * Browser media layer for the LOCAL web build. Files live in the browser's own
 * storage (never uploaded anywhere); documents reference them with an
 * `opfs:media/<name>` pseudo-path. A docId → URL registry backs the renderer's
 * mediaUrl()/mediaThumb(): blob URLs for stored files, the http(s) URL itself
 * for remote (GEDCOM/FamilySearch) media.
 */

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4'
}
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.svg']

const registry = new Map<string, string>()
;(window as unknown as { __tmMediaUrls?: Map<string, string> }).__tmMediaUrls = registry

const extOf = (name: string): string => {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}
const opfsName = (filePath: string): string | null =>
  filePath.startsWith('opfs:media/') ? filePath.slice('opfs:media/'.length) : null

async function urlForDoc(doc: DocumentRecord): Promise<string | null> {
  if (/^https?:\/\//i.test(doc.filePath)) return doc.filePath
  const name = opfsName(doc.filePath)
  if (!name) return null
  const bytes = await readMediaFile(name)
  if (!bytes) return null
  const type = doc.mimeType ?? MIME[extOf(name)] ?? 'application/octet-stream'
  return URL.createObjectURL(new Blob([bytes.slice()], { type }))
}

/** (Re)build the registry for every document. Call at boot and after imports. */
export async function rebuildMediaRegistry(): Promise<void> {
  for (const doc of Documents.list()) {
    if (registry.has(doc.id)) continue
    const url = await urlForDoc(doc)
    if (url) registry.set(doc.id, url)
  }
}

async function registerDoc(doc: DocumentRecord): Promise<void> {
  const url = await urlForDoc(doc)
  if (url) registry.set(doc.id, url)
}

function kindFromExt(ext: string): DocumentKind {
  return IMAGE_EXTS.includes(ext) ? 'photo' : 'other'
}

/** Store picked/dropped files and create documents attached to `personId`. */
export async function importFilesWeb(files: File[], personId?: string): Promise<DocumentRecord[]> {
  const out: DocumentRecord[] = []
  for (const file of files) {
    const ext = extOf(file.name) || '.bin'
    const id = crypto.randomUUID()
    const name = `${id}${ext}`
    await writeMediaFile(name, new Uint8Array(await file.arrayBuffer()))
    const doc = Documents.create(
      {
        title: file.name.replace(/\.[^.]+$/, ''),
        kind: kindFromExt(ext),
        filePath: `opfs:media/${name}`,
        mimeType: file.type || MIME[ext] || 'application/octet-stream',
        personIds: personId ? [personId] : []
      },
      id
    )
    await registerDoc(doc)
    out.push(doc)
  }
  return out
}

/** Native file picker → importFilesWeb. Resolves [] when cancelled. */
export function pickAndImportFiles(personId?: string, accept?: string): Promise<DocumentRecord[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    if (accept) input.accept = accept
    input.onchange = async () => {
      resolve(await importFilesWeb(Array.from(input.files ?? []), personId).catch(() => []))
    }
    input.oncancel = () => resolve([])
    input.click()
  })
}

/** Single-file picker returning the file's text (GEDCOM/CSV import). */
export function pickTextFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = async () => {
      const f = input.files?.[0]
      resolve(f ? await f.text() : null)
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/** Single-file picker returning raw bytes (backup restore). */
export function pickBinaryFile(accept: string): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = async () => {
      const f = input.files?.[0]
      resolve(f ? new Uint8Array(await f.arrayBuffer()) : null)
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/** Save a clipboard/board data-URL image as a stored document. */
export async function importDataUrlWeb(dataUrl: string, personId?: string): Promise<DocumentRecord | null> {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl)
  if (!m) return null
  const mime = m[1].toLowerCase()
  const ext = mime === 'image/png' ? '.png' : mime === 'image/gif' ? '.gif' : mime === 'image/webp' ? '.webp' : '.jpg'
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const id = crypto.randomUUID()
  const name = `${id}${ext}`
  await writeMediaFile(name, bytes)
  const doc = Documents.create(
    { title: 'Evidence', kind: 'photo', filePath: `opfs:media/${name}`, mimeType: mime, personIds: personId ? [personId] : [] },
    id
  )
  await registerDoc(doc)
  return doc
}

/** Records a web link as a document (mirrors main/media.ts createLinkDocument). */
export function createLinkDocumentWeb(url: string, title: string, personId?: string): DocumentRecord | null {
  const u = url.trim()
  if (!/^https?:\/\//i.test(u)) return null
  const doc = Documents.create({
    title: title.trim() || u,
    kind: 'other',
    filePath: u,
    mimeType: 'text/uri-list',
    personIds: personId ? [personId] : []
  })
  registry.set(doc.id, u)
  return doc
}

/** Open a stored document: links in a new tab, stored files via blob URL. */
export async function openDocumentWeb(documentId: string): Promise<void> {
  const doc = Documents.get(documentId)
  if (!doc) return
  const url = registry.get(doc.id) ?? (await urlForDoc(doc))
  if (url) window.open(url, '_blank', 'noopener')
}

/** Base64 data URL of a stored document (tree-export embeds avatars with it). */
export async function documentDataUrlWeb(documentId: string): Promise<string | null> {
  const doc = Documents.get(documentId)
  if (!doc) return null
  const name = opfsName(doc.filePath)
  if (!name) return null
  const bytes = await readMediaFile(name)
  if (!bytes) return null
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `data:${doc.mimeType ?? 'application/octet-stream'};base64,${btoa(bin)}`
}

/** Avatar picker: import one image and set it as the person's profile photo. */
export async function setPersonAvatarWeb(personId: string): Promise<ReturnType<typeof People.update> | null> {
  const docs = await pickAndImportFiles(personId, 'image/*')
  if (!docs.length) return null
  return People.update(personId, { profilePhotoId: docs[0].id, profilePhotoCrop: null })
}

/** Trigger a browser download of raw bytes/text. */
export function downloadFile(name: string, data: Uint8Array | string, type = 'application/octet-stream'): void {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : new Blob([data.slice()], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}
