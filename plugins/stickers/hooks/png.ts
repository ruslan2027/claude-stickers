/**
 * A small PNG decoder for the hooks environment, which has no zlib: enough to
 * turn a sticker into pixels for a Raster on terminals that cannot draw Image.
 *
 * Handles non-interlaced PNGs of every color type and bit depth (16-bit kept
 * to its high byte), with tRNS transparency. Returns RGBA, 4 bytes a pixel.
 */

export type Pixels = { width: number; height: number; rgba: Uint8Array }

// --- inflate (RFC 1951) ---------------------------------------------------

type Tree = { counts: Uint16Array; symbols: Uint16Array }

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

function buildTree(lengths: ArrayLike<number>, offset: number, count: number): Tree {
  const counts = new Uint16Array(16)
  const symbols = new Uint16Array(count)
  for (let i = 0; i < count; i++) counts[lengths[offset + i]!]!++
  counts[0] = 0
  const offs = new Uint16Array(16)
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1]! + counts[i - 1]!
  for (let i = 0; i < count; i++) {
    const len = lengths[offset + i]!
    if (len !== 0) symbols[offs[len]!++] = i
  }
  return { counts, symbols }
}

const FIXED_LIT = (() => {
  const l = new Uint8Array(288)
  l.fill(8, 0, 144)
  l.fill(9, 144, 256)
  l.fill(7, 256, 280)
  l.fill(8, 280, 288)
  return buildTree(l, 0, 288)
})()
const FIXED_DIST = buildTree(new Uint8Array(30).fill(5), 0, 30)

export function inflate(data: Uint8Array): Uint8Array {
  let pos = 0
  let bitBuf = 0
  let bitCount = 0
  let out = new Uint8Array(Math.max(1024, data.length * 4))
  let outLen = 0

  const ensure = (n: number) => {
    if (outLen + n <= out.length) return
    let size = out.length * 2
    while (size < outLen + n) size *= 2
    const next = new Uint8Array(size)
    next.set(out.subarray(0, outLen))
    out = next
  }
  const bits = (n: number): number => {
    while (bitCount < n) {
      if (pos >= data.length) throw new Error('inflate: unexpected end of data')
      bitBuf |= data[pos++]! << bitCount
      bitCount += 8
    }
    const v = bitBuf & ((1 << n) - 1)
    bitBuf >>>= n
    bitCount -= n
    return v
  }
  const decode = (t: Tree): number => {
    let code = 0
    let first = 0
    let index = 0
    for (let len = 1; len < 16; len++) {
      code |= bits(1)
      const count = t.counts[len]!
      if (code - first < count) return t.symbols[index + code - first]!
      index += count
      first = (first + count) << 1
      code <<= 1
    }
    throw new Error('inflate: bad code')
  }

  for (let last = 0; !last; ) {
    last = bits(1)
    const type = bits(2)
    if (type === 0) {
      bitBuf = 0
      bitCount = 0
      const len = data[pos]! | (data[pos + 1]! << 8)
      pos += 4
      ensure(len)
      out.set(data.subarray(pos, pos + len), outLen)
      outLen += len
      pos += len
      continue
    }
    let lit = FIXED_LIT
    let dist = FIXED_DIST
    if (type === 2) {
      const hlit = bits(5) + 257
      const hdist = bits(5) + 1
      const hclen = bits(4) + 4
      const codeLengths = new Uint8Array(19)
      for (let i = 0; i < hclen; i++) codeLengths[CODE_ORDER[i]!] = bits(3)
      const codeTree = buildTree(codeLengths, 0, 19)
      const lengths = new Uint8Array(hlit + hdist)
      for (let i = 0; i < hlit + hdist; ) {
        const sym = decode(codeTree)
        if (sym < 16) lengths[i++] = sym
        else {
          const [prev, repeat] =
            sym === 16 ? [lengths[i - 1]!, 3 + bits(2)] : sym === 17 ? [0, 3 + bits(3)] : [0, 11 + bits(7)]
          lengths.fill(prev, i, i + repeat)
          i += repeat
        }
      }
      lit = buildTree(lengths, 0, hlit)
      dist = buildTree(lengths, hlit, hdist)
    } else if (type !== 1) {
      throw new Error('inflate: bad block type')
    }
    for (;;) {
      const sym = decode(lit)
      if (sym < 256) {
        ensure(1)
        out[outLen++] = sym
      } else if (sym === 256) {
        break
      } else {
        const l = LENGTH_BASE[sym - 257]! + bits(LENGTH_EXTRA[sym - 257]!)
        const d = decode(dist)
        const back = DIST_BASE[d]! + bits(DIST_EXTRA[d]!)
        ensure(l)
        for (let i = 0; i < l; i++, outLen++) out[outLen] = out[outLen - back]!
      }
    }
  }
  return out.subarray(0, outLen)
}

// --- PNG -----------------------------------------------------------------

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

export function decodePng(bytes: Uint8Array): Pixels {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!sig.every((b, i) => bytes[i] === b)) throw new Error('not a PNG')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  let palette = new Uint8Array(0)
  let trns: Uint8Array | undefined
  const idat: Uint8Array[] = []
  for (let p = 8; p + 8 <= bytes.length; ) {
    const len = view.getUint32(p)
    const type = String.fromCharCode(bytes[p + 4]!, bytes[p + 5]!, bytes[p + 6]!, bytes[p + 7]!)
    const body = bytes.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      width = view.getUint32(p + 8)
      height = view.getUint32(p + 12)
      depth = body[8]!
      colorType = body[9]!
      if (body[12] !== 0) throw new Error('interlaced PNGs are not supported')
    } else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') trns = body
    else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    p += 12 + len
  }
  const channels = CHANNELS[colorType]
  if (channels === undefined || width === 0 || height === 0) throw new Error('unsupported PNG')
  if (depth < 8 && colorType !== 0 && colorType !== 3) throw new Error(`unsupported bit depth ${depth}`)

  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0))
  idat.reduce((at, c) => (joined.set(c, at), at + c.length), 0)
  const raw = inflate(joined.subarray(2)) // skip the zlib header

  const bpp = Math.max(1, (channels * depth) >> 3)
  const stride = Math.ceil((width * channels * depth) / 8)
  const lines = new Uint8Array(stride * height)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const line = lines.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp]! : 0
      const b = prev[x]!
      const c = x >= bpp ? prev[x - bpp]! : 0
      let v = src[x]!
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[x] = v & 255
    }
    prev = line
  }

  const rgba = new Uint8Array(width * height * 4)
  // A channel's value, 0-255 save for palette indexes and low-depth gray.
  const sample = (line: Uint8Array, i: number): number => {
    if (depth === 8) return line[i]!
    if (depth === 16) return line[i * 2]!
    const bitPos = i * depth
    return (line[bitPos >> 3]! >> (8 - depth - (bitPos & 7))) & ((1 << depth) - 1)
  }
  // tRNS keys a gray or RGB color with two bytes a channel at any depth.
  const key = (c: number): number | undefined =>
    trns === undefined || depth < 8 ? undefined : trns[depth === 16 ? c * 2 : c * 2 + 1]
  const scale = depth < 8 && colorType === 0 ? 255 / ((1 << depth) - 1) : 1
  for (let y = 0; y < height; y++) {
    const line = lines.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      if (colorType === 3) {
        const idx = sample(line, x)
        rgba[o] = palette[idx * 3] ?? 0
        rgba[o + 1] = palette[idx * 3 + 1] ?? 0
        rgba[o + 2] = palette[idx * 3 + 2] ?? 0
        rgba[o + 3] = trns?.[idx] ?? 255
      } else if (colorType === 0 || colorType === 4) {
        const g = Math.round(sample(line, x * channels) * scale)
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g
        const isKeyed = key(0) === sample(line, x * channels)
        rgba[o + 3] = colorType === 4 ? sample(line, x * 2 + 1) : isKeyed ? 0 : 255
      } else {
        const i = x * channels
        rgba[o] = sample(line, i)
        rgba[o + 1] = sample(line, i + 1)
        rgba[o + 2] = sample(line, i + 2)
        const isKeyed = [0, 1, 2].every(c => key(c) === sample(line, i + c))
        rgba[o + 3] = colorType === 6 ? sample(line, i + 3) : isKeyed ? 0 : 255
      }
    }
  }
  return { width, height, rgba }
}

// --- cells ---------------------------------------------------------------

const UPPER = 0x2580 // ▀: foreground paints the top half
const LOWER = 0x2584 // ▄
const DEFAULT = 0x01000000

/** Share of a block's opaque pixels that, being clearly darker, wins it. */
const STROKE_SHARE = 0.2

/**
 * Downsamples a picture to `columns` x `rows` cells of half blocks, two
 * pixels a cell (top and bottom), as the cells a Raster takes, base64.
 * Pixels mostly transparent show the terminal's own background.
 *
 * A plain average washes thin dark strokes (eyes, mouths, outlines) into the
 * fill around them at this size, so a block where a fifth or more of the
 * pixels are clearly darker than its average takes those pixels' color.
 */
export function toCells(pic: Pixels, columns: number, rows: number): string {
  const gw = columns
  const gh = rows * 2
  const lum = (o: number) => 0.299 * pic.rgba[o]! + 0.587 * pic.rgba[o + 1]! + 0.114 * pic.rgba[o + 2]!
  const grid: Array<number | null> = new Array(gw * gh)
  for (let gy = 0; gy < gh; gy++) {
    const y0 = Math.floor((gy * pic.height) / gh)
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * pic.height) / gh))
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor((gx * pic.width) / gw)
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * pic.width) / gw))
      // Pass 1: alpha-weighted average color and luminance of the block.
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let l = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * pic.width + x) * 4
          const al = pic.rgba[o + 3]!
          r += pic.rgba[o]! * al
          g += pic.rgba[o + 1]! * al
          b += pic.rgba[o + 2]! * al
          l += lum(o) * al
          a += al
        }
      }
      const n = (x1 - x0) * (y1 - y0)
      if (a / n < 128) {
        grid[gy * gw + gx] = null
        continue
      }
      // Pass 2: the clearly darker opaque pixels, if there are enough of them.
      const cut = l / a - 40
      let dr = 0
      let dg = 0
      let db = 0
      let dn = 0
      let opaque = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * pic.width + x) * 4
          if (pic.rgba[o + 3]! < 128) continue
          opaque++
          if (lum(o) >= cut) continue
          dr += pic.rgba[o]!
          dg += pic.rgba[o + 1]!
          db += pic.rgba[o + 2]!
          dn++
        }
      }
      grid[gy * gw + gx] =
        dn > 0 && dn >= opaque * STROKE_SHARE
          ? (Math.round(dr / dn) << 16) | (Math.round(dg / dn) << 8) | Math.round(db / dn)
          : (Math.round(r / a) << 16) | (Math.round(g / a) << 8) | Math.round(b / a)
    }
  }

  const words = new Uint32Array(columns * rows * 3)
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < columns; cx++) {
      const top = grid[cy * 2 * gw + cx] ?? null
      const bottom = grid[(cy * 2 + 1) * gw + cx] ?? null
      const w = (cy * columns + cx) * 3
      if (top === null && bottom === null) words.set([0x20, DEFAULT, DEFAULT], w)
      else if (top === null) words.set([LOWER, bottom!, DEFAULT], w)
      else words.set([UPPER, top, bottom ?? DEFAULT], w)
    }
  }
  return toBase64(new Uint8Array(words.buffer))
}

// --- base64 ----------------------------------------------------------------

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const LOOKUP = new Uint8Array(128)
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array((clean.length * 3) >> 2)
  let o = 0
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (LOOKUP[clean.charCodeAt(i)]! << 18) |
      (LOOKUP[clean.charCodeAt(i + 1)]! << 12) |
      ((LOOKUP[clean.charCodeAt(i + 2)] ?? 0) << 6) |
      (LOOKUP[clean.charCodeAt(i + 3)] ?? 0)
    out[o++] = n >> 16
    if (o < out.length) out[o++] = (n >> 8) & 255
    if (o < out.length) out[o++] = n & 255
  }
  return out
}

export function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += ALPHABET[n >> 18]! + ALPHABET[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? ALPHABET[n & 63]! : '='
  }
  return out
}
