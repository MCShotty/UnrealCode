import { BrowserWindow } from 'electron'
import type { ImageDimensions } from './image-header'

type Converted = { data: string; width: number; height: number }
let active = 0

// Chromium supports WebP decoding; Electron's nativeImage API only promises
// PNG/JPEG. Keep untrusted image bytes out of the privileged app renderer.
export async function convertWebp(bytes: Buffer, declared: ImageDimensions): Promise<Converted> {
  if (active >= 2) throw new Error('Finish another WebP attachment before adding more')
  active++
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const source = `data:image/webp;base64,${bytes.toString('base64')}`
    const script = `(async()=>{
      const image = new Image(); image.src = ${JSON.stringify(source)}; await image.decode();
      if(image.naturalWidth !== ${declared.width} || image.naturalHeight !== ${declared.height}) throw Error('WebP dimensions changed during decode');
      const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d'); if(!context) throw Error('Image canvas is unavailable');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/png');
      if(data.length > 2 * 1024 * 1024) throw Error('Image remains too large; reduce its dimensions');
      return { data, width: canvas.width, height: canvas.height };
    })()`
    const work = (async () => { await window.loadURL('about:blank'); return window.webContents.executeJavaScript(script, true) as Promise<Converted> })()
    const timed = new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('WebP conversion timed out')), 10000) })
    const result = await Promise.race([work, timed])
    if (!result || !result.data?.startsWith('data:image/png;base64,') || result.data.length > 2 * 1024 * 1024 || !Number.isSafeInteger(result.width) || !Number.isSafeInteger(result.height) || result.width < 1 || result.height < 1 || result.width > 2048 || result.height > 2048) throw new Error('Unsupported or damaged image')
    return result
  } finally { if (timeout) clearTimeout(timeout); if (!window.isDestroyed()) window.destroy(); active-- }
}
