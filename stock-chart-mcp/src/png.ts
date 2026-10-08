// Minimal indexed-colour raster + PNG encoder. No dependencies, so it runs in
// a Worker; one byte per pixel keeps CPU and memory low.

export class Raster {
  readonly px: Uint8Array;
  readonly width: number; readonly height: number; readonly palette: string[];
  constructor(width: number, height: number, palette: string[], bg = 0) {
    this.width = width; this.height = height; this.palette = palette;
    this.px = new Uint8Array(width * height).fill(bg);
  }
  set(x: number, y: number, c: number) {
    x |= 0; y |= 0;
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.px[y * this.width + x] = c;
  }
  rect(x: number, y: number, w: number, h: number, c: number) {
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w)), y1 = Math.min(this.height, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) this.px.fill(c, yy * this.width + x0, yy * this.width + x1);
  }
  hline(x0: number, x1: number, y: number, c: number, dash = 0) {
    for (let x = Math.round(x0); x <= x1; x++) if (!dash || Math.floor(x / dash) % 2 === 0) this.set(x, y, c);
  }
  vline(x: number, y0: number, y1: number, c: number) {
    const [a, b] = y0 < y1 ? [y0, y1] : [y1, y0];
    for (let y = Math.round(a); y <= Math.round(b); y++) this.set(x, y, c);
  }
  // Bresenham with a square pen of `thick` pixels.
  line(x0: number, y0: number, x1: number, y1: number, c: number, thick = 1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    const off = Math.floor((thick - 1) / 2);
    for (;;) {
      for (let a = 0; a < thick; a++) for (let b = 0; b < thick; b++) this.set(x0 - off + a, y0 - off + b, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  async png(): Promise<Uint8Array<ArrayBuffer>> {
    const { width: w, height: h } = this;
    const raw = new Uint8Array((w + 1) * h);
    for (let y = 0; y < h; y++) raw.set(this.px.subarray(y * w, (y + 1) * w), y * (w + 1) + 1); // filter 0
    const plte = new Uint8Array(this.palette.length * 3);
    this.palette.forEach((hex, i) => plte.set([1, 3, 5].map(o => parseInt(hex.slice(o, o + 2), 16)), i * 3));
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w); dv.setUint32(4, h); ihdr.set([8, 3, 0, 0, 0], 8); // 8-bit, indexed
    return concat([
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('IDAT', await zlib(raw)), chunk('IEND', new Uint8Array(0)),
    ]);
  }
}

async function zlib(data: Uint8Array<ArrayBuffer>) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function base64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// 5x7 bitmap font (upper case, digits, common punctuation), rows top to bottom.
const GLYPHS: Record<string, string> = {
  '0': '.###.#...##..###.#.###..##...#.###.',
  '1': '..#...##....#....#....#....#...###.',
  '2': '.###.#...#....#...#...#...#...#####',
  '3': '#####...#...#.....#.....##...#.###.',
  '4': '...#...##..#.#.#..#.#####...#....#.',
  '5': '######....####.....#....##...#.###.',
  '6': '..##..#...#....####.#...##...#.###.',
  '7': '#####....#...#...#...#....#....#...',
  '8': '.###.#...##...#.###.#...##...#.###.',
  '9': '.###.#...##...#.####....#...#..##..',
  A: '.###.#...##...#######...##...##...#',
  B: '####.#...##...#####.#...##...#####.',
  C: '.###.#...##....#....#....#...#.###.',
  D: '###..#..#.#...##...##...##..#.###..',
  E: '######....#....####.#....#....#####',
  F: '######....#....####.#....#....#....',
  G: '.###.#...##....#.####...##...#.####',
  H: '#...##...##...#######...##...##...#',
  I: '.###...#....#....#....#....#...###.',
  J: '..###...#....#....#....#.#..#..##..',
  K: '#...##..#.#.#..##...#.#..#..#.#...#',
  L: '#....#....#....#....#....#....#####',
  M: '#...###.###.#.##.#.##...##...##...#',
  N: '#...##...###..##.#.##..###...##...#',
  O: '.###.#...##...##...##...##...#.###.',
  P: '####.#...##...#####.#....#....#....',
  Q: '.###.#...##...##...##.#.##..#..##.#',
  R: '####.#...##...#####.#.#..#..#.#...#',
  S: '.#####....#.....###.....#....#####.',
  T: '#####..#....#....#....#....#....#..',
  U: '#...##...##...##...##...##...#.###.',
  V: '#...##...##...##...##...#.#.#...#..',
  W: '#...##...##...##.#.##.#.##.#.#.#.#.',
  X: '#...##...#.#.#...#...#.#.#...##...#',
  Y: '#...##...#.#.#...#....#....#....#..',
  Z: '#####....#...#...#...#...#....#####',
  '.': '..........................##...##..',
  ',': '.....................##....#...#...',
  ':': '......##...##........##...##.......',
  '%': '##...##..#...#...#...#...#..##...##',
  '+': '.......#....#..#####..#....#.......',
  '-': '...............#####...............',
  '/': '.........#...#...#...#...#.........',
  '(': '...#...#...#....#....#.....#.....#.',
  ')': '.#.....#.....#....#....#...#...#...',
  '$': '..#...#####.#...###...#.#####...#..',
  '=': '..........#####.....#####..........',

};

export function textWidth(s: string, scale = 1) { return s.length * 6 * scale - scale; }
export function text(r: Raster, x: number, y: number, s: string, c: number, scale = 1) {
  for (const ch of s.toUpperCase()) {
    const g = GLYPHS[ch];
    if (g) for (let i = 0; i < 35; i++) if (g[i] === '#') r.rect(x + (i % 5) * scale, y + Math.floor(i / 5) * scale, scale, scale, c);
    x += 6 * scale;
  }
}
