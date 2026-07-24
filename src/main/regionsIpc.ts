/**
 * IPC handlers for photo regions (face/zone tags on documents). Registered from
 * the main ipc.ts with a single call.
 */
import { ipcMain } from 'electron'
import { RegionChannels } from '@shared/regions'
import type { PhotoRegionInput } from '@shared/types'
import { PhotoRegions } from './db/repo'

export function registerRegionsIpc(): void {
  ipcMain.handle(RegionChannels.forDocument, (_e, documentId: string) => PhotoRegions.forDocument(documentId))
  ipcMain.handle(RegionChannels.forPerson, (_e, personId: string) => PhotoRegions.forPerson(personId))
  ipcMain.handle(RegionChannels.create, (_e, input: PhotoRegionInput) => PhotoRegions.create(input))
  ipcMain.handle(RegionChannels.update, (_e, id: string, patch: Partial<PhotoRegionInput>) =>
    PhotoRegions.update(id, patch)
  )
  ipcMain.handle(RegionChannels.remove, (_e, id: string) => PhotoRegions.remove(id))
}
