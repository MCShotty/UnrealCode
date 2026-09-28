import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkedImageDimensions } from './image-header'

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33)
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}
function webp(kind: 'VP8X' | 'VP8L' | 'VP8 '): Buffer {
  const length = kind === 'VP8L' ? 5 : 10
  const bytes = Buffer.alloc(20 + length + (length & 1) + (kind === 'VP8X' ? 18 : 0))
  bytes.write('RIFF', 0, 'ascii'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WEBP', 8, 'ascii')
  bytes.write(kind, 12, 'ascii'); bytes.writeUInt32LE(length, 16)
  if (kind === 'VP8X') {
    bytes.writeUIntLE(2, 24, 3); bytes.writeUIntLE(1, 27, 3)
    bytes.write('VP8 ', 30, 'ascii'); bytes.writeUInt32LE(10, 34)
    bytes[41] = 0x9d; bytes[42] = 0x01; bytes[43] = 0x2a; bytes.writeUInt16LE(3, 44); bytes.writeUInt16LE(2, 46)
  }
  else if (kind === 'VP8L') { bytes[20] = 0x2f; bytes[21] = 2; bytes[22] = 0x40 }
  else { bytes[23] = 0x9d; bytes[24] = 0x01; bytes[25] = 0x2a; bytes.writeUInt16LE(3, 26); bytes.writeUInt16LE(2, 28) }
  return bytes
}

it('reads bounded dimensions from real and synthetic supported image headers', () => {
  const icon = checkedImageDimensions(readFileSync(join(process.cwd(), 'assets', 'unrealcode-icon.png')))
  expect(icon.format).toBe('png'); expect(icon.width).toBeGreaterThan(0); expect(icon.height).toBeGreaterThan(0)
  expect(checkedImageDimensions(png(3, 2))).toEqual({ width: 3, height: 2, format: 'png' })
  const jpeg = Buffer.from([0xff,0xd8,0xff,0xc0,0,11,8,0,2,0,3,1,1,0x11,0,0xff,0xd9])
  expect(checkedImageDimensions(jpeg)).toEqual({ width: 3, height: 2, format: 'jpeg' })
  for (const kind of ['VP8X', 'VP8L', 'VP8 '] as const) expect(checkedImageDimensions(webp(kind))).toEqual({ width: 3, height: 2, format: 'webp' })
})

it('rejects oversized and malformed headers before an image decoder sees them', () => {
  for (const bytes of [png(8193, 1), png(5000, 4000)]) expect(() => checkedImageDimensions(bytes)).toThrow('16 megapixel')
  for (const bytes of [Buffer.from('not an image'), png(0, 2), Buffer.from([0xff,0xd8,0xff,0xc0,0,11,8]), webp('VP8X').subarray(0, 25)]) expect(() => checkedImageDimensions(bytes)).toThrow()
  const animatedPng = Buffer.concat([png(3, 2), Buffer.alloc(12)])
  animatedPng.write('acTL', 37, 'ascii')
  expect(() => checkedImageDimensions(animatedPng)).toThrow('animation')
  const animatedWebp = webp('VP8X'); animatedWebp[20] = 0x02
  expect(() => checkedImageDimensions(animatedWebp)).toThrow('animation')
  const largerFrame = webp('VP8X'); largerFrame.writeUInt16LE(8193, 44)
  expect(() => checkedImageDimensions(largerFrame)).toThrow('16 megapixel')
})
