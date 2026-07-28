/**
 * Browser-local persistence for the web build. Everything stays on the user's
 * machine, inside the browser's origin-scoped storage — nothing ever leaves it:
 *  - the SQLite database bytes and every media file live in OPFS
 *    (Origin Private File System) when the browser supports writing it from the
 *    window (Chrome/Edge/Firefox), and fall back to IndexedDB otherwise
 *    (Safari's OPFS is worker-only).
 */

const DB_FILE = 'treemonk.sqlite'
const MEDIA_DIR = 'media'
const IDB_NAME = 'treemonk-local'
const IDB_STORE = 'files'

// ---- capability probe ----------------------------------------------------

let opfsRoot: FileSystemDirectoryHandle | null | undefined

async function getOpfs(): Promise<FileSystemDirectoryHandle | null> {
  if (opfsRoot !== undefined) return opfsRoot
  try {
    const root = await navigator.storage?.getDirectory?.()
    if (!root) throw new Error('no OPFS')
    // Safari exposes OPFS but not createWritable in the window — probe it.
    const probe = await root.getFileHandle('.probe', { create: true })
    const w = await probe.createWritable()
    await w.close()
    await root.removeEntry('.probe')
    opfsRoot = root
  } catch {
    opfsRoot = null
  }
  return opfsRoot
}

/** Ask the browser to protect this origin's storage from eviction. */
export function requestPersistentStorage(): void {
  void navigator.storage?.persist?.().catch(() => undefined)
}

// ---- IndexedDB fallback --------------------------------------------------

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(key: string): Promise<Uint8Array | null> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key)
    req.onsuccess = () => resolve(req.result ? new Uint8Array(req.result as ArrayBuffer) : null)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(key: string, value: Uint8Array | null): Promise<void> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const store = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE)
    // Copy into a plain ArrayBuffer so a WASM-heap view is never structured-cloned.
    const req = value ? store.put(value.slice().buffer, key) : store.delete(key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function idbKeys(prefix: string): Promise<string[]> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).getAllKeys()
    req.onsuccess = () =>
      resolve((req.result as string[]).filter((k) => typeof k === 'string' && k.startsWith(prefix)))
    req.onerror = () => reject(req.error)
  })
}

// ---- unified file API ----------------------------------------------------

async function opfsDir(root: FileSystemDirectoryHandle, dir: string | null, create: boolean):
  Promise<FileSystemDirectoryHandle | null> {
  if (!dir) return root
  try {
    return await root.getDirectoryHandle(dir, { create })
  } catch {
    return null
  }
}

async function readFile(dir: string | null, name: string): Promise<Uint8Array | null> {
  const root = await getOpfs()
  if (root) {
    try {
      const d = await opfsDir(root, dir, false)
      if (!d) return null
      const fh = await d.getFileHandle(name)
      return new Uint8Array(await (await fh.getFile()).arrayBuffer())
    } catch {
      return null
    }
  }
  return idbGet(dir ? `${dir}/${name}` : name)
}

async function writeFile(dir: string | null, name: string, bytes: Uint8Array): Promise<void> {
  const root = await getOpfs()
  if (root) {
    const d = await opfsDir(root, dir, true)
    if (!d) throw new Error('OPFS dir unavailable')
    const fh = await d.getFileHandle(name, { create: true })
    const w = await fh.createWritable()
    // Copy out of the WASM heap: a SharedArrayBuffer-backed view can't be written.
    await w.write(bytes.slice())
    await w.close()
    return
  }
  await idbSet(dir ? `${dir}/${name}` : name, bytes)
}

async function deleteFile(dir: string | null, name: string): Promise<void> {
  const root = await getOpfs()
  if (root) {
    try {
      const d = await opfsDir(root, dir, false)
      await d?.removeEntry(name)
    } catch {
      /* already gone */
    }
    return
  }
  await idbSet(dir ? `${dir}/${name}` : name, null)
}

async function listFiles(dir: string): Promise<string[]> {
  const root = await getOpfs()
  if (root) {
    try {
      const d = await opfsDir(root, dir, false)
      if (!d) return []
      const names: string[] = []
      // TS's lib.dom may lack async iteration on directory handles — cast.
      const iter = (d as unknown as { values(): AsyncIterable<{ kind: string; name: string }> }).values()
      for await (const entry of iter) if (entry.kind === 'file') names.push(entry.name)
      return names
    } catch {
      return []
    }
  }
  return (await idbKeys(`${dir}/`)).map((k) => k.slice(dir.length + 1))
}

// ---- public surface ------------------------------------------------------

export const loadDbBytes = (): Promise<Uint8Array | null> => readFile(null, DB_FILE)
export const saveDbBytes = (bytes: Uint8Array): Promise<void> => writeFile(null, DB_FILE, bytes)
export const deleteDbFile = (): Promise<void> => deleteFile(null, DB_FILE)

export const readMediaFile = (name: string): Promise<Uint8Array | null> => readFile(MEDIA_DIR, name)
export const writeMediaFile = (name: string, bytes: Uint8Array): Promise<void> =>
  writeFile(MEDIA_DIR, name, bytes)
export const deleteMediaFile = (name: string): Promise<void> => deleteFile(MEDIA_DIR, name)
export const listMediaFiles = (): Promise<string[]> => listFiles(MEDIA_DIR)

export async function wipeAllStorage(): Promise<void> {
  await deleteDbFile()
  for (const name of await listMediaFiles()) await deleteMediaFile(name)
}
