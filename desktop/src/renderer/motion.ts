// Shared Material 3-inspired spatial springs. Incoming text never animates.
export const spatial = {
  fast: { type:'spring' as const, stiffness:600, damping:42 },
  default: { type:'spring' as const, stiffness:390, damping:36 },
  slow: { type:'spring' as const, stiffness:250, damping:32 }
}
