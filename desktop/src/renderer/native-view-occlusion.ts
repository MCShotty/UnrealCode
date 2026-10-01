/** Remote WebContentsViews must not cover app-owned dialogs or menus. */
export function nativeViewObscured(){return [...document.querySelectorAll<HTMLElement>('dialog[open],[role="dialog"],[role="menu"],.command-palette,.model-picker[open],.container-status-control[open]')].some(node=>!node.hidden&&node.getAttribute('aria-hidden')!=='true'&&node.getClientRects().length>0)}
