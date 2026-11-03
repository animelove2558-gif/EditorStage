// Builds a synthetic scene + packed footage (video, ProRes, TIFF, PSD, PDF/AI, audio) to exercise src/Services/mogrt/footage.js.
// Usage: node scripts/mogrt/footage_test_scene.mjs <outDir>   (needs ffmpeg-static)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { layer, prop } from './synthetic_scenes.mjs';

const require = createRequire(import.meta.url);
const ff = require('ffmpeg-static');
const out = process.argv[2] || '.'; const fdir = path.join(out, 'footage'); fs.mkdirSync(fdir, { recursive: true });
const run = (...a) => execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', ...a]);

run('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(fdir, 'clip.mp4'));
run('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-t', '2', '-c:v', 'prores_ks', '-profile:v', '1', path.join(fdir, 'clip_prores.mov'));
run('-f', 'lavfi', '-i', 'smptebars=size=320x240', '-frames:v', '1', path.join(fdir, 'bars.tif'));
run('-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000', '-t', '2', path.join(fdir, 'tone.wav'));

// PSD: 160x120 RGBA, PackBits-compressed planes (red/green gradient, alpha = circle)
{
  const w = 160, h = 120; const planes = [0, 1, 2, 3].map(() => new Uint8Array(w * h));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; planes[0][i] = (x / w) * 255; planes[1][i] = (y / h) * 255; planes[2][i] = 128; planes[3][i] = Math.hypot(x - 80, y - 60) < 55 ? 255 : 0; }
  const pack = (row) => { const o = []; for (let i = 0; i < row.length;) { let j = i; while (j < row.length && j - i < 127 && row[j] === row[i]) j++; if (j - i >= 2) { o.push(257 - (j - i), row[i]); i = j; } else { let k = i; while (k < row.length && k - i < 127 && !(k + 1 < row.length && row[k] === row[k + 1])) k++; if (k === i) k = i + 1; o.push(k - i - 1, ...row.subarray(i, k)); i = k; } } return o; };
  const rows = []; for (const p of planes) for (let y = 0; y < h; y++) rows.push(pack(p.subarray(y * w, (y + 1) * w)));
  const hdr = Buffer.alloc(26); hdr.write('8BPS', 0); hdr.writeUInt16BE(1, 4); hdr.writeUInt16BE(4, 12); hdr.writeUInt32BE(h, 14); hdr.writeUInt32BE(w, 18); hdr.writeUInt16BE(8, 22); hdr.writeUInt16BE(3, 24);
  const z4 = Buffer.alloc(4); const comp = Buffer.from([0, 1]); const counts = Buffer.alloc(rows.length * 2); rows.forEach((r, i) => counts.writeUInt16BE(r.length, i * 2));
  fs.writeFileSync(path.join(fdir, 'art.psd'), Buffer.concat([hdr, z4, z4, z4, comp, counts, Buffer.from(rows.flat())]));
}
// AI (PDF-compatible): 200x100 pt page, orange rectangle + blue triangle on transparent background
{
  const content = '1 0.5 0 rg 10 10 120 80 re f 0 0.4 1 rg 140 10 m 190 10 l 165 90 l f';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = pdf.length; pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  fs.writeFileSync(path.join(fdir, 'logo.ai'), pdf);
}

const fileF = (id, name, w, h, o = {}) => ({ id, name, kind: 'file', path: name, width: w, height: h, duration: o.dur || 0, frameRate: 30, hasVideo: !o.audioOnly, hasAudio: !!o.audio });
const footage = [fileF(1, 'clip.mp4', 320, 240, { dur: 3, audio: true }), fileF(2, 'clip_prores.mov', 320, 240, { dur: 2 }), fileF(3, 'bars.tif', 320, 240), fileF(4, 'art.psd', 160, 120), fileF(5, 'logo.ai', 200, 100), fileF(6, 'tone.wav', 0, 0, { dur: 2, audio: true, audioOnly: true })];
const fl = (fid, x, y, w, h, name) => layer({ name, sourceId: fid, sourceKind: 'footage', w, h, tf: { anchor: [w / 2, h / 2, 0], pos: [x, y, 0] } });
const layers = [fl(1, 300, 250, 320, 240, 'mp4'), fl(2, 700, 250, 320, 240, 'prores (transcoded)'), fl(3, 1100, 250, 320, 240, 'tiff (ffmpeg)'), fl(4, 1500, 250, 160, 120, 'psd'), fl(5, 400, 650, 200, 100, 'ai'), fl(6, 0, 0, 0, 0, 'audio')];
layers.forEach((l, i) => { l.index = i + 1; });
layers[4].properties[0].children.find((p) => p.matchName === 'ADBE Scale').value = [300, 300, 100]; // vector art scaled up: should stay sharp
const scene = { version: 1, comps: [{ id: 100, name: 'footage', width: 1920, height: 1080, pixelAspect: 1, frameRate: 30, duration: 3, displayStartTime: 0, bgColor: [0, 0, 0], workAreaStart: 0, workAreaDuration: 3, markers: [], essentialControllers: [], layers }], footage, usedFonts: [], expressionEngine: 'javascript-1.0' };
void prop;
fs.writeFileSync(path.join(out, 'footage.scene.json'), JSON.stringify(scene));
console.log('wrote footage scene + files:', fs.readdirSync(fdir).join(', '));
