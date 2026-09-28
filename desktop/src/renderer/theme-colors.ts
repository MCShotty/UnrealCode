// Canvas-based editors cannot consume CSS variables directly. Resolve the same
// semantic scheme used by native controls when their theme observer runs.
export function themeColors() {
  const style = getComputedStyle(document.documentElement)
  const read = (role: string) => style.getPropertyValue(role).trim()
  return {
    background: read('--panel'), foreground: read('--text'), accent: read('--accent'),
    selection: read('--accent-soft'), line: read('--line'), hover: read('--panel-2'),
    scrollbar: read('--md-sys-color-outline')
  }
}
