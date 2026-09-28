// Canvas-based editors cannot consume CSS variables directly. Resolve the same
// semantic scheme used by native controls when their theme observer runs.
export function themeColors() {
  const style = getComputedStyle(document.documentElement)
  const read = (role: string) => style.getPropertyValue(role).trim()
  return {
    background: read('--panel'), foreground: read('--text'), accent: read('--accent'),
    selection: read('--accent-soft'), line: read('--line'), hover: read('--panel-2'),
    scrollbar: read('--md-sys-color-outline'),
    added: read('--md-comp-code-added'), removed: read('--md-comp-code-removed'),
    terminal: {
      black: read('--md-comp-terminal-black'), white: read('--md-comp-terminal-white'),
      red: read('--danger'), green: read('--green'), blue: read('--accent'),
      yellow: read('--md-sys-color-warning'), cyan: read('--md-comp-terminal-cyan'),
      magenta: read('--md-comp-terminal-magenta')
    }
  }
}
