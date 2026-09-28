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
    initial="rest" animate="rest" whileHover={disabled||reduced?'rest':'hover'} whileTap={disabled||reduced?'rest':'press'}>
    <motion.span className="expressive-button-face" variants={{rest:{scale:1},hover:{scale:1.015},press:{scale:.965}}} transition={reduced?instant:expressive.control}>{(props['aria-busy']===true||props['aria-busy']==='true')&&<ProgressIndicator/>}{children}</motion.span></motion.button>
}
