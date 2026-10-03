import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** Immagine decodificata: `w`×`h`, canale alfa riga per riga. */
export interface PngAlpha {
  w: number;
  h: number;
  alpha(x: number, y: number): number;
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

/**
 * Decodifica minima di un PNG RGBA 8 bit non interlacciato (quelli che
 * scrive `tools/process-sprites.py`), quanto basta per leggere l'alfa nei
 * test. Lancia su qualunque altro formato.
 */
export function readPngAlpha(path: string): PngAlpha {
  const buf = readFileSync(path);
  let offset = 8;
  let w = 0;
  let h = 0;
  const idat: Buffer[] = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      const depth = data[8];
      const colorType = data[9];
      const interlace = data[12];
      if (depth !== 8 || colorType !== 6 || interlace !== 0) {
        throw new Error(`${path}: serve RGBA 8 bit non interlacciato (depth ${depth}, tipo ${colorType})`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = w * bpp;
  const out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = y > 0 ? out[dst - stride + i] : 0;
      const c = i >= bpp && y > 0 ? out[dst - stride + i - bpp] : 0;
      let v: number;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) v = x + paeth(a, b, c);
      else throw new Error(`${path}: filtro PNG ${filter} sconosciuto`);
      out[dst + i] = v & 0xff;
    }
  }
  return { w, h, alpha: (x, y) => out[y * stride + x * bpp + 3] };
}

/** Ultima riga con almeno un pixel di alfa oltre `threshold`, o -1. */
export function lastOpaqueRow(img: PngAlpha, threshold = 16): number {
  for (let y = img.h - 1; y >= 0; y--) {
    for (let x = 0; x < img.w; x++) if (img.alpha(x, y) > threshold) return y;
  }
  return -1;
}
