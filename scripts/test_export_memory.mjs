// Audit C-16: raw frames sent as rgb24 give the same encoded picture as rgba, for fewer bytes per frame.
// Audit C-13b: the undo history of a large sequence stays inside its budget (heap measured with a 2,000-clip sequence).
// Run: node --expose-gc scripts/test_export_memory.mjs
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { rgbaToRgb } from '../src/Core/pixels.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ffmpeg = createRequire(import.meta.url)('ffmpeg-static');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-expmem-'));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };

// ---- pixel format ----
const W = 320, H = 180, N = 12; const rgba = new Uint8Array(W * H * 4 * N);
for (let f = 0; f < N; f++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (f * W * H + y * W + x) * 4; rgba[i] = (x * 255 / W + f * 9) & 255; rgba[i + 1] = (y * 255 / H) & 255; rgba[i + 2] = ((x ^ y) + f * 17) & 255; rgba[i + 3] = 255;
}
const one = rgbaToRgb(rgba.subarray(0, 8), new Uint8Array(6));
ok('alpha is dropped, colour order kept', one[3] === rgba[4] && one[4] === rgba[5] && one[5] === rgba[6] && one.length === 6);
const rgb = new Uint8Array(W * H * 3 * N); for (let f = 0; f < N; f++) rgb.set(rgbaToRgb(rgba.subarray(f * W * H * 4, (f + 1) * W * H * 4), new Uint8Array(W * H * 3)), f * W * H * 3);
ok('a quarter fewer bytes', rgb.length === rgba.length * 0.75);
const encode = (pix, data, args, ext) => {
  const o = path.join(tmp, `${pix}-${args[1]}-${args.includes('yuv422p10le') ? 10 : 8}.${ext}`);
  const r = spawnSync(ffmpeg, ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', pix, '-s', `${W}x${H}`, '-r', '30', '-i', '-', '-vf', 'vflip', ...args, o], { input: Buffer.from(data), maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  return spawnSync(ffmpeg, ['-v', 'error', '-i', o, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 }).stdout;
};
for (const [label, args, ext] of [['H.264', ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p'], 'mp4'], ['ProRes 422', ['-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le'], 'mov']]) {
  const a = encode('rgba', rgba, args, ext), b = encode('rgb24', rgb, args, ext);
  let worst = 0; for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  console.log(`  ${label}: ${a.length} decoded bytes, largest difference rgba vs rgb24 = ${worst}`);
  ok(`${label}: rgb24 input gives the same picture as rgba`, a.length === b.length && a.length > 0 && worst <= 1, String(worst));
}

// ---- undo history budget ----
const out = path.join(tmp, 'store.mjs');
await esbuild.build({ absWorkingDir: root, entryPoints: [path.join(root, 'src/Core/store.js')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
const S = await import(pathToFileURL(out).href);
const heap = () => { globalThis.gc?.(); return process.memoryUsage().heapUsed / 1048576; };
const clip = (i) => ({ id: `c${i}`, track: 'V1', start: i, dur: 1, inPoint: i, mediaId: 'm', enabled: true, effects: [{ id: `f${i}`, name: 'Gaussian Blur', enabled: true, params: { blurriness: { v: 10, keys: [] }, dim: { v: 0, keys: [] } } }], motion: { scale: { v: 100, keys: [] }, position: { v: [0.5, 0.5], keys: [] } }, opacity: { opacity: { v: 100, keys: [] } } });
const big = () => S.loadProject({ sequence: { ...S.getState().sequence, id: 'big', clips: Array.from({ length: 2000 }, (_, i) => clip(i)) } }, 'C:/big.esproj');
const run = (steps) => { const h0 = heap(); for (let i = 0; i < steps; i++) S.edit(`step ${i}`, ({ seq }) => { seq.clips[i % 2000].start += 1e-3; }); return { mb: Math.round(heap() - h0), steps: S.getState().history.length - 1 }; };
const chars = JSON.stringify(Array.from({ length: 2000 }, (_, i) => clip(i))).length;
big(); S.setHistoryBudget(Infinity); const free = run(100);
console.log(`  2,000 clips (${(chars / 1048576).toFixed(2)} M chars per snapshot): no budget, ${free.steps} steps hold ${free.mb} MB of heap`);
big(); S.setHistoryBudget(chars * 20.5); const capped = run(100);
console.log(`  budget of 20 snapshots: ${capped.steps} steps hold ${capped.mb} MB of heap`);
ok('the budget limits the steps', capped.steps <= 21 && capped.steps >= 5, String(capped.steps));
ok('the budget limits the memory', capped.mb < free.mb / 2, `${capped.mb} vs ${free.mb}`);
S.undo?.(); ok('undo still works after trimming', S.getState().historyIndex === capped.steps - 1, String(S.getState().historyIndex));
big(); S.setHistoryBudget(1); const min = run(20);
ok('a tiny budget still keeps the last few steps', min.steps === 5, String(min.steps));
S.setHistoryBudget(100 * 1048576);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`export memory: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
