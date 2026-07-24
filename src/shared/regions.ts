/**
 * IPC surface for photo regions (face/zone tags on documents). Kept in its own
 * shared module so the channel names + API type live next to nothing else.
 */
import type { PhotoRegion, PhotoRegionInput, PersonPhotoTag } from './types'

export const RegionChannels = {
  forDocument: 'regions:forDocument',
  forPerson: 'regions:forPerson',
  create: 'regions:create',
  update: 'regions:update',
  remove: 'regions:remove'
} as const

/** The `window.api.regions` surface exposed by the preload. */
export interface RegionsApi {
  forDocument: (documentId: string) => Promise<PhotoRegion[]>
  forPerson: (personId: string) => Promise<PersonPhotoTag[]>
  create: (input: PhotoRegionInput) => Promise<PhotoRegion>
  update: (id: string, patch: Partial<PhotoRegionInput>) => Promise<PhotoRegion | null>
  remove: (id: string) => Promise<void>
}
