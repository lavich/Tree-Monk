/** Fired when a user-initiated FamilySearch action finds the session expired —
 *  App.tsx listens and pops the sign-in dialog. */
export const FS_SESSION_REQUIRED_EVENT = 'fs-session-required'

/**
 * Gate for user-initiated FamilySearch actions (sync, expand, change scan…):
 * resolves true when the action may proceed. When the session expired, it
 * raises the sign-in dialog via {@link FS_SESSION_REQUIRED_EVENT} and resolves
 * false so the caller aborts quietly. Keyless (dormant) builds and transient
 * IPC failures resolve true — the caller's own error path stays in charge.
 */
export async function ensureFsSession(): Promise<boolean> {
  try {
    if (!(await window.api.familysearch.configured())) return true
    if (await window.api.familysearch.signedIn()) return true
  } catch {
    return true
  }
  window.dispatchEvent(new Event(FS_SESSION_REQUIRED_EVENT))
  return false
}
