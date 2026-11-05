#!/usr/bin/env node
/**
 * Generates the PWA icons as PNG files using only Node's standard library, so
 * the project needs no image tooling and no network access.
 *
 * Usage: npm run icons
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function hex(value) {
  return [
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5, 7), 16)
  ];
}

/**
 * Draws the DocTrack mark: rounded blue tile, white medical cross, teal corner.
 * `inset` leaves the safe margin required by maskable icons.
 */
function drawIcon(size, inset) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const bg = hex('#2563eb');
  const dark = hex('#0b1220');
  const white = [255, 255, 255];
  const teal = hex('#087f8c');
  const radius = size * 0.22;
  const pad = inset * size;
  const inner = size - pad * 2;

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = rowStart + 1 + x * 4;
      let color = dark;
      if (x >= pad && x < size - pad && y >= pad && y < size - pad) {
        const lx = x - pad;
        const ly = y - pad;
        const dx = Math.max(radius - lx, 0, lx - (inner - radius));
        const dy = Math.max(radius - ly, 0, ly - (inner - radius));
        const inside = dx * dx + dy * dy <= radius * radius;
        if (inside) {
          color = bg;
          const crossW = inner * 0.2;
          const crossH = inner * 0.62;
          const cx = inner / 2;
          const cy = inner / 2;
          const inVertical = Math.abs(lx - cx) < crossW / 2 && Math.abs(ly - cy) < crossH / 2;
          const inHorizontal = Math.abs(ly - cy) < crossW / 2 && Math.abs(lx - cx) < crossH / 2;
          if (inVertical || inHorizontal) color = white;
          if (ly > inner * 0.74 && Math.abs(lx - cx) < crossW * 1.4) color = teal;
        }
      }
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const icons = [
  { file: 'icon-192.png', size: 192, inset: 0.06 },
  { file: 'icon-512.png', size: 512, inset: 0.06 },
  { file: 'maskable-512.png', size: 512, inset: 0.16 }
];

for (const icon of icons) {
  writeFileSync(join(outDir, icon.file), drawIcon(icon.size, icon.inset));
  console.log(`[icons] wrote ${icon.file}`);
}
