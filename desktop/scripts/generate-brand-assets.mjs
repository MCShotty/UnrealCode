// Render our vector source; no image-service key or network requests are used.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname, join } from 'node:path'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assets = join(desktop, 'assets'), brand = join(assets, 'brand')
const dark = readFileSync(join(brand, 'unrealcode-mark-dark.svg'), 'utf8')
const light = dark.replaceAll('#F5F7FA', '#122039').replaceAll('#00B9DA', '#007C94')
const icon = dark.replace('<title>UnrealCode</title>', '<title>UnrealCode</title>\n  <rect width="320" height="320" rx="60" fill="#101726"/>')
writeFileSync(join(brand, 'unrealcode-mark-light.svg'), light)
writeFileSync(join(brand, 'unrealcode-icon.svg'), icon)

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  async function render(svg, size) {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`)
    return page.screenshot({ omitBackground: true })
  }
  for (const [name, svg] of [['mark-dark', dark], ['mark-light', light]]) writeFileSync(join(brand, `unrealcode-${name}.png`), await render(svg, 1024))
  writeFileSync(join(assets, 'unrealcode-icon.png'), await render(icon, 1024))
  const sizes = [16, 24, 32, 48, 64, 128, 256], frames = []
  for (const size of sizes) frames.push(await render(icon, size))
  const header = Buffer.alloc(6 + sizes.length * 16)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((size, i) => {
    const entry = 6 + i * 16
    header[entry] = header[entry + 1] = size === 256 ? 0 : size
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(frames[i].length, entry + 8); header.writeUInt32LE(offset, entry + 12)
    offset += frames[i].length
  })
  writeFileSync(join(assets, 'unrealcode-icon.ico'), Buffer.concat([header, ...frames]))
  console.log('Generated flat light/dark marks and seven-size Windows icon from the SVG source.')
} finally { await browser.close() }
