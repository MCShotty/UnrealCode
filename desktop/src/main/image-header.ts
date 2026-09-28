export type ImageDimensions = { width: number; height: number; format: 'png' | 'jpeg' | 'webp' }

const maxSide = 8192
const maxPixels = 16 * 1024 * 1024
const invalid = (): never => { throw new Error('Unsupported or damaged image header') }

function checked(width: number, height: number, format: ImageDimensions['format']): ImageDimensions {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return invalid()
  if (width > maxSide || height > maxSide || width * height > maxPixels) throw new Error('Image dimensions exceed the 16 megapixel attachment limit')
  return { width, height, format }
}

function png(bytes: Buffer): ImageDimensions {
  if (bytes.length < 33 || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return invalid()
  const dimensions = checked(bytes.readUInt32BE(16), bytes.readUInt32BE(20), 'png')
  let at = 8
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at), end = at + 12 + length
    if (end > bytes.length) return invalid()
    if (bytes.toString('ascii', at + 4, at + 8) === 'acTL') throw new Error('Unsupported or damaged image: animation is not supported')
    at = end
  }
  if (at !== bytes.length) return invalid()
  return dimensions
}

function jpeg(bytes: Buffer): ImageDimensions {
  let at = 2
  while (at < bytes.length) {
    if (bytes[at++] !== 0xff) return invalid()
    while (at < bytes.length && bytes[at] === 0xff) at++
    if (at >= bytes.length) return invalid()
    const marker = bytes[at++]
    if (marker === 0xd9 || marker === 0xda) return invalid()
    if (marker === 0x01 || marker === 0xd8 || marker >= 0xd0 && marker <= 0xd7) continue
    if (at + 2 > bytes.length) return invalid()
    const length = bytes.readUInt16BE(at)
    if (length < 2 || at + length > bytes.length) return invalid()
    const start = at + 2
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      if (length < 7) return invalid()
      return checked(bytes.readUInt16BE(start + 3), bytes.readUInt16BE(start + 1), 'jpeg')
    }
    at += length
  }
  return invalid()
}

function webp(bytes: Buffer): ImageDimensions {
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) return invalid()
  let at = 12
  let canvas: ImageDimensions | undefined, frame: ImageDimensions | undefined
  while (at + 8 <= bytes.length) {
    const kind = bytes.toString('ascii', at, at + 4), length = bytes.readUInt32LE(at + 4), start = at + 8
    if (start + length > bytes.length) return invalid()
    if (kind === 'VP8X') {
      if (length < 10 || canvas) return invalid()
      if (bytes[start] & 0x02) throw new Error('Unsupported or damaged image: animation is not supported')
      canvas = checked(1 + bytes.readUIntLE(start + 4, 3), 1 + bytes.readUIntLE(start + 7, 3), 'webp')
    }
    if (kind === 'VP8L') {
      if (length < 5 || bytes[start] !== 0x2f || frame) return invalid()
      frame = checked(1 + bytes[start + 1] + ((bytes[start + 2] & 0x3f) << 8), 1 + (bytes[start + 2] >> 6) + (bytes[start + 3] << 2) + ((bytes[start + 4] & 0x0f) << 10), 'webp')
    }
    if (kind === 'VP8 ') {
      if (length < 10 || frame || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) return invalid()
      frame = checked(bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff, 'webp')
    }
    if (kind === 'ANIM' || kind === 'ANMF') throw new Error('Unsupported or damaged image: animation is not supported')
    at = start + length + (length & 1)
  }
  if (at !== bytes.length || !frame) return invalid()
  return canvas || frame
}

export function checkedImageDimensions(bytes: Buffer): ImageDimensions {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return png(bytes)
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes)
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return webp(bytes)
  return invalid()
}
