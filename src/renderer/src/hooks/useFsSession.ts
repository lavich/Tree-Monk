import { useCallback, useEffect, useState } from 'react'
import { useFsMode } from './useFsMode'
import { isDemo } from '@/lib/demo'

export type FsSessionStatus = 'ok' | 'expired' | null

/**
 * FamilySearch session state for FS-mode trees: 'ok' while the (24h) token is
 * alive, 'expired' when a new sign-in is needed, null when it does not apply
 * (manual/GEDCOM tree, keyless build, demo). Checked at startup and whenever
 * the window regains focus (throttled to once a minute) — so coming back to
 * the app after the token lapsed surfaces the state immediately.
 */
export function useFsSession(): { status: FsSessionStatus; recheck: () => Promise<void> } {
  const fsMode = useFsMode()
  const [status, setStatus] = useState<FsSessionStatus>(null)

  const recheck = useCallback(async (): Promise<void> => {
    if (!fsMode || isDemo()) {
      setStatus(null)
      return
    }
    try {
      if (!(await window.api.familysearch.configured())) {
        setStatus(null)
        return
      }
      setStatus((await window.api.familysearch.signedIn()) ? 'ok' : 'expired')
    } catch {
      /* transient IPC failure — keep the previous state */
    }
  }, [fsMode])

  useEffect(() => {
    void recheck()
    let last = 0
    const onFocus = (): void => {
      const now = Date.now()
      if (now - last < 60_000) return
      last = now
      void recheck()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [recheck])

  return { status, recheck }
}
