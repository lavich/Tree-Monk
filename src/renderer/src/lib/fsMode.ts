/** FamilySearch mode: chosen at first launch (or by signing in later). Gates
 *  the FS sync buttons and the background change-watcher. */
export function isFsMode(): boolean {
  return localStorage.getItem('tm_fs_mode') === '1'
}
export function setFsMode(on: boolean): void {
  localStorage.setItem('tm_fs_mode', on ? '1' : '0')
  window.dispatchEvent(new Event('fs-mode-changed'))
}
export function startChoiceSeen(): boolean {
  return localStorage.getItem('tm_start_choice') === '1'
}
export function markStartChoiceSeen(): void {
  localStorage.setItem('tm_start_choice', '1')
}

/** Clear the start choice so the FS/Manual picker shows again (used by wipe
 *  and new-family-tree, which both start an empty database). */
export function clearStartChoice(): void {
  localStorage.removeItem('tm_start_choice')
}
export function reimportNoticeSeen(): boolean {
  return localStorage.getItem('tm_fs_reimport_notice') === '1'
}
export function markReimportNoticeSeen(): void {
  localStorage.setItem('tm_fs_reimport_notice', '1')
}

/**
 * The 1.8.17 "FamilySearch has arrived — create a NEW family tree to use it"
 * notice. Deliberately a SEPARATE flag from the old reimport notice: that one
 * was already marked seen for many users (and for everyone the app defaulted to
 * Manual), which would have silently swallowed this message for exactly the
 * people it is meant for.
 */
export function fsArrivedNoticeSeen(): boolean {
  return localStorage.getItem('tm_fs_arrived_notice') === '1'
}
export function markFsArrivedNoticeSeen(): void {
  localStorage.setItem('tm_fs_arrived_notice', '1')
}
