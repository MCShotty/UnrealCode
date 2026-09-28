import { useSyncExternalStore } from 'react'

// Motion 13's bundled hook snapshots this preference at mount. Keep a reactive
// subscription so Windows accessibility changes apply without remounting drafts.
let media: MediaQueryList | undefined
const preference = () => media ??= window.matchMedia('(prefers-reduced-motion: reduce)')
const subscribe = (notify: () => void) => {
  const query = preference()
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}
const snapshot = () => preference().matches
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true)
}
