// Renders build/EditorStage_Logo.svg (the BYS logo, from "BYS Stage Icon/EditorStage Logo") into build/icon.png (512 px)
// and build/icon.ico (256 / 128 / 64 / 48 / 32 / 16, PNG-compressed entries) for the app, the installer and .esproj files.
// Run: node scripts/make_icons.mjs   (dev only; sharp comes with @huggingface/transformers)
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(root, 'build'); mkdirSync(build, { recursive: true });
const svg = readFileSync(path.join(build, 'EditorStage_Logo.svg'));
const square = (size) => sharp(svg, { density: 600 }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

/** ICO container: 6-byte header, 16-byte directory entry per image, then the PNG files (Windows Vista+ reads PNG entries). */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const o = 6 + i * 16;
    head[o] = size >= 256 ? 0 : size; head[o + 1] = size >= 256 ? 0 : size; // 0 = 256
    head[o + 2] = 0; head[o + 3] = 0; head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(png.length, o + 8); head.writeUInt32LE(offset, o + 12); offset += png.length;
  });
  return Buffer.concat([head, ...images.map((x) => x.png)]);
}

writeFileSync(path.join(build, 'icon.png'), await square(512));
const sizes = [256, 128, 64, 48, 32, 16];
writeFileSync(path.join(build, 'icon.ico'), ico(await Promise.all(sizes.map(async (size) => ({ size, png: await square(size) })))));
console.log('icons written: build/icon.png, build/icon.ico', sizes.join('/'));
