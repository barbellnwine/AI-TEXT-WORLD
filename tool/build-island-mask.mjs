// Offline, run-once: turns the painted island map into the spatial data the simulation uses.
//
//   node tool/build-island-mask.mjs <map.png> [repoRoot]
//
// The running world NEVER looks at pixels. This writes server/world/geo/islandMask.ts — a 40x40
// grid of 50 m terrain cells — and a web copy of the picture that the minimap draws underneath the
// agent markers. Re-run it only when the artwork changes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { inflateSync, deflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'

const WORLD_METERS = 2000, CELL_METERS = 50
const CELLS = WORLD_METERS / CELL_METERS

// --- minimal PNG reader (8-bit, non-interlaced) --------------------------------------------------
function readPng(file) {
  const buf = readFileSync(file)
  let pos = 8, width = 0, height = 0, channels = 3
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[data[9]]
      if (data[8] !== 8 || !channels) throw new Error('unsupported PNG: 8-bit colour only')
      if (data[12] !== 0) throw new Error('interlaced PNG is not supported')
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += len + 12
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = width * channels
  const out = Buffer.alloc(height * stride)
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? out[y * stride + i - channels] : 0
      const up = y > 0 ? out[(y - 1) * stride + i] : 0
      const upLeft = y > 0 && i >= channels ? out[(y - 1) * stride + i - channels] : 0
      const v = line[i]
      out[y * stride + i] = (filter === 0 ? v : filter === 1 ? v + left : filter === 2 ? v + up
        : filter === 3 ? v + ((left + up) >> 1) : v + paeth(left, up, upLeft)) & 255
    }
  }
  return { width, height, channels, data: out }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(bytes) {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function writePng({ width, height, data }) {
  const stride = width * 3, raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) data.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  const chunk = (type, body) => {
    const out = Buffer.alloc(body.length + 12)
    out.writeUInt32BE(body.length, 0)
    out.write(type, 4, 'ascii')
    body.copy(out, 8)
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])), body.length + 8)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

// Rubs the painted place names off the map, so the app can draw its own — and hide them when a
// reader zooms in to follow a person. Only the lettering is touched: the pale glyphs and the dark
// halo hugging them are marked, then filled in from the terrain around them until the hole closes.
// Nothing is blurred wholesale, so there is no visible patch where a word used to be.
function eraseLettering(img, box) {
  const { width, height, data } = img
  const x0 = Math.max(1, Math.floor(box.x)), x1 = Math.min(width - 1, Math.ceil(box.x + box.w))
  const y0 = Math.max(1, Math.floor(box.y)), y1 = Math.min(height - 1, Math.ceil(box.y + box.h))
  const hole = new Uint8Array(width * height)
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * width + x) * 3
    if (Math.min(data[i], data[i + 1], data[i + 2]) > 160) hole[y * width + x] = 1
  }
  // Grow the mark to swallow the anti-aliased fringe and the dark outline around each glyph.
  for (let grow = 0; grow < 9; grow++) {
    const previous = Uint8Array.from(hole)
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (previous[y * width + x]) continue
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        if (previous[(y + dy) * width + x + dx]) { hole[y * width + x] = 1; break }
    }
  }
  // Close the hole from its rim inwards, one ring of pixels per pass.
  for (let pass = 0; pass < 60; pass++) {
    const source = Buffer.from(data), filling = Uint8Array.from(hole)
    let filled = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (!filling[y * width + x]) continue
      let r = 0, g = 0, b = 0, n = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (filling[(y + dy) * width + x + dx]) continue
        const i = ((y + dy) * width + x + dx) * 3
        r += source[i]; g += source[i + 1]; b += source[i + 2]; n++
      }
      if (!n) continue
      const o = (y * width + x) * 3
      data[o] = Math.round(r / n); data[o + 1] = Math.round(g / n); data[o + 2] = Math.round(b / n)
      hole[y * width + x] = 0
      filled++
    }
    if (!filled) break
  }
}

function resize(img, size) {
  const out = Buffer.alloc(size * size * 3)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const x0 = Math.floor(x * img.width / size), x1 = Math.max(x0 + 1, Math.floor((x + 1) * img.width / size))
    const y0 = Math.floor(y * img.height / size), y1 = Math.max(y0 + 1, Math.floor((y + 1) * img.height / size))
    let r = 0, g = 0, b = 0, n = 0
    for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
      const i = (sy * img.width + sx) * img.channels
      r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++
    }
    const o = (y * size + x) * 3
    out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n)
  }
  return { width: size, height: size, data: out }
}

// --- what the paint means ------------------------------------------------------------------------
// Calibrated against this artwork's palette: the sea is blue-to-teal, vegetation is olive (red and
// green close, blue far below), sand is bright and warm, the gorge is strongly red, stone is grey.
function classify(r, g, b) {
  const max = Math.max(r, g, b)
  if (max < 58) return b > r + 8 ? 'WATER' : 'FOREST'          // night-dark shadow and deep water
  if (b > r + 25 && b >= g - 12) return 'WATER'
  if (r > 150 && r - g > 55 && g - b > 18) return 'CANYON'     // red gorge rock
  if (r > 172 && g > 150 && g - b > 28 && r - g < 62) return 'BEACH'
  if (Math.abs(r - g) < 26 && Math.abs(g - b) < 36 && max > 92) return 'ROCK'
  if (g >= r - 18 && g > b) return max < 122 ? 'FOREST' : 'GRASS'
  return 'GRASS'
}

const [, , source, outDir = '.'] = process.argv
if (!source) {
  console.error('usage: node tool/build-island-mask.mjs <map.png> [repoRoot]')
  process.exit(1)
}
const img = readPng(source)
const votes = []
for (let row = 0; row < CELLS; row++) for (let col = 0; col < CELLS; col++) {
  const x0 = Math.floor(col * img.width / CELLS), x1 = Math.floor((col + 1) * img.width / CELLS)
  const y0 = Math.floor(row * img.height / CELLS), y1 = Math.floor((row + 1) * img.height / CELLS)
  const tally = {}
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const i = (y * img.width + x) * img.channels
    const kind = classify(img.data[i], img.data[i + 1], img.data[i + 2])
    tally[kind] = (tally[kind] ?? 0) + 1
  }
  votes.push(Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0])
}
// A grey cell all but surrounded by sea is a crag, not ground you can walk onto.
const at = (col, row) => col < 0 || row < 0 || col >= CELLS || row >= CELLS ? 'WATER' : votes[row * CELLS + col]
const terrain = votes.map((kind, i) => {
  if (kind !== 'ROCK') return kind
  const col = i % CELLS, row = Math.floor(i / CELLS)
  const sea = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => at(col + dx, row + dy) === 'WATER').length
  return sea >= 3 ? 'CLIFF' : kind
})
const CODES = { GRASS: 'g', FOREST: 'f', BEACH: 'b', ROCK: 'r', CLIFF: 'c', WATER: 'w', RIVER: 'v', RUINS: 'u', URBAN: 'n', CANYON: 'y' }
const cells = terrain.map(t => CODES[t]).join('')
const counts = terrain.reduce((acc, t) => ({ ...acc, [t]: (acc[t] ?? 0) + 1 }), {})
console.log('cells:', Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', '))

const header = [
  '// GENERATED by tool/build-island-mask.mjs from the painted island map — do not edit by hand.',
  `// ${CELLS}x${CELLS} cells of ${CELL_METERS} m covering ${WORLD_METERS}x${WORLD_METERS} m.`,
  '// Map image (0,0) is the north-west corner of the world, (2000,2000) the south-east corner.',
  'export const ISLAND_MASK = {',
  `  widthMeters: ${WORLD_METERS},`,
  `  heightMeters: ${HEIGHT_OR(WORLD_METERS)},`,
  `  cellMeters: ${CELL_METERS},`,
  `  cols: ${CELLS},`,
  `  rows: ${CELLS},`,
  "  image: '/world/island-map.png',",
  `  cells: '${cells}',`,
  '} as const',
  '',
].join('\n')
function HEIGHT_OR(v) { return v }
const file = join(outDir, 'server/world/geo/islandMask.ts')
mkdirSync(dirname(file), { recursive: true })
writeFileSync(file, header)
console.log('wrote', file)

// Where the artwork wrote each place name, in metres, so those words can be rubbed out. Keep this
// in step with ISLAND_PLACES in server/world/geo/islandMap.ts.
const LABELS = [
  { name: '바위 고지대', x: 987, y: 300 }, { name: '서쪽 바위굴', x: 268, y: 560 },
  { name: '좁은 협곡', x: 625, y: 993 }, { name: '버려진 야영지', x: 552, y: 1334 },
  { name: '샘터', x: 1047, y: 928 }, { name: '깊은 숲', x: 1435, y: 871 },
  { name: '동쪽 해변', x: 1831, y: 904 },
]

const WEB_SIZE = 1024
const web = join(outDir, 'public/world/island-map.png')
mkdirSync(dirname(web), { recursive: true })
// Lettering is erased at full resolution, where the glyphs are crisp enough to mark precisely.
const perMetre = img.width / WORLD_METERS
for (const label of LABELS) {
  const w = (label.name.length * 30 + 44) * (img.width / 1232)
  const h = 62 * (img.width / 1232)
  eraseLettering(img, { x: label.x * perMetre - w / 2, y: label.y * perMetre - h / 2, w, h })
}
const picture = resize(img, WEB_SIZE)
writeFileSync(web, writePng(picture))
console.log('wrote', web, (readFileSync(web).length / 1048576).toFixed(2), 'MB', `(${LABELS.length} place names rubbed out)`)
