// Material 3 Expressive spatial parameters, adapted to Motion's unit-mass
// spring: damping = 2 * dampingRatio * sqrt(stiffness * mass).
// Source (v0_14_0): https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/ExpressiveMotionTokens.kt
// Spatial motion is reserved for deliberate UI actions, never incoming text.
const spring = (stiffness: number, dampingRatio: number) => ({
  type: 'spring' as const, mass: 1, stiffness, damping: 2 * dampingRatio * Math.sqrt(stiffness)
})
export const spatial = {
  fast: spring(800, .6),
  default: spring(380, .8),
  slow: spring(200, .8)
}
// Opacity/color never overshoot. Exits are short and cannot gate user actions.
export const effects = {
  fast: { type: 'tween' as const, duration: .12, ease: 'easeOut' as const },
  default: { type: 'tween' as const, duration: .18, ease: 'easeOut' as const },
  slow: { type: 'tween' as const, duration: .24, ease: 'easeOut' as const }
}
export const instant = { duration: 0 }
export const expressive = {
  control: { default: spatial.fast, opacity: effects.fast },
  panel: { default: spatial.default, opacity: effects.default },
  dialog: { default: spatial.slow, opacity: effects.default }
}
