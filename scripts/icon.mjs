// Small code-drawn icon: no image libraries or external asset downloads.
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, checksum]);
}
function iconPng(size) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  const inside = (x, y, left, top, right, bottom) => x >= left && x < right && y >= top && y < bottom;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const dx = Math.max(0.25 - u, 0, u - 0.75);
      const dy = Math.max(0.25 - v, 0, v - 0.75);
      const rounded = u >= 0.07 && u <= 0.93 && v >= 0.07 && v <= 0.93 && dx * dx + dy * dy <= 0.18 ** 2;
      const shape = inside(u, v, .26, .40, .45, .59) || inside(u, v, .54, .56, .73, .75)
        || inside(u, v, .46, .27, .64, .33) || inside(u, v, .58, .27, .64, .46)
        || (u >= .39 && u <= .64 && v >= .27 && v <= .52 && Math.abs(u + v - .91) < .045)
        || inside(u, v, .24, .70, .40, .76) || inside(u, v, .24, .57, .30, .76)
        || (u >= .24 && u <= .46 && v >= .54 && v <= .76 && Math.abs(u + v - 1.00) < .04);
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      pixels[offset] = shape ? 31 : 198;
      pixels[offset + 1] = shape ? 46 : 237;
      pixels[offset + 2] = shape ? 25 : 141;
      pixels[offset + 3] = rounded ? 255 : 0;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

export async function buildIcon(directory) {
  const iconset = path.join(directory, 'Stride.iconset');
  await mkdir(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    await writeFile(path.join(iconset, `icon_${size}x${size}.png`), iconPng(size));
    await writeFile(path.join(iconset, `icon_${size}x${size}@2x.png`), iconPng(size * 2));
  }
  const icon = path.join(directory, 'Stride.icns');
  const result = spawnSync('/usr/bin/iconutil', ['-c', 'icns', '-o', icon, iconset], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Could not build the Mac app icon.');
  return icon;
}
