import { motion, type HTMLMotionProps } from 'motion/react'
import type { ReactNode } from 'react'
import { useReducedMotion } from './useReducedMotion'
import { expressive, instant } from './motion'
import { ProgressIndicator } from './ProgressIndicator'

// Focal actions get tactile feedback without changing their hit area or
// delaying native click/keyboard semantics. Routine form controls stay quiet.
export function ExpressiveButton({ disabled, children, ...props }: Omit<HTMLMotionProps<'button'>, 'children'> & {children?: ReactNode}) {
  const reduced = useReducedMotion()
  return <motion.button {...props} disabled={disabled}
    animate={{ scale: 1 }}
    whileHover={disabled || reduced ? { scale: 1 } : { scale: 1.015 }}
    whileTap={disabled || reduced ? { scale: 1 } : { scale: .965 }}
    transition={reduced ? instant : expressive.control}>{(props['aria-busy']===true||props['aria-busy']==='true')&&<ProgressIndicator/>}{children}</motion.button>
}
