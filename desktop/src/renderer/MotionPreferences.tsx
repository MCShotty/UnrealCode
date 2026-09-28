import type { ReactNode } from 'react'
import { MotionConfig } from 'motion/react'
import { useReducedMotion } from './useReducedMotion'
import { instant } from './motion'

export function MotionPreferences({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion()
  // The installed library caches its own policy per visual element. Our
  // reactive hook + reduced-motion CSS own that policy instead, in both
  // directions, without keying/remounting the application and losing drafts.
  return <MotionConfig reducedMotion="never" transition={reduced ? instant : undefined}>{children}</MotionConfig>
}
