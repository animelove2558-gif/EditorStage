// DNxHR / MXF export presets (audit G-03): each preset's FFmpeg arguments are run against the bundled FFmpeg on a
// generated clip, and the output is read back. Run: node scripts/test_presets.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ffmpeg = createRequire(import.meta.url)('ffmpeg-static');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };

const src = fs.readFileSync(path.join(root, 'src/Services/exporter.js'), 'utf8');
const presets = {};
for (const m of src.matchAll(/^  '((?:Avid DNxHR|MXF)[^']*)': (\{.*\}),$/gm)) presets[m[1]] = new Function(`return ${m[2]}`)();
ok('six DNxHR / MXF presets are defined', Object.keys(presets).length === 6, Object.keys(presets).join('; '));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'es-presets-'));
const EXPECT = { 'dnxhr_lb': 'DNXHR LB', 'dnxhr_sq': 'DNXHR SQ', 'dnxhr_hq': 'DNXHR HQ', 'dnxhr_hqx': 'DNXHR HQX', 'dnxhr_444': 'DNXHR 444' };
for (const [name, P] of Object.entries(presets)) {
  const out = path.join(dir, `t_${Object.keys(presets).indexOf(name)}.${P.ext}`);
  const r = spawnSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=640x360:d=1:r=25', '-f', 'lavfi', '-i', 'sine=d=1:sample_rate=48000', ...P.video, ...P.audio, '-shortest', out], { encoding: 'utf8' });
  ok(`${name}: FFmpeg encodes it`, r.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 1000, r.stderr);
  const info = spawnSync(ffmpeg, ['-hide_banner', '-i', out], { encoding: 'utf8' }).stderr;
  const profile = P.video[P.video.indexOf('-profile:v') + 1];
  ok(`${name}: the file holds DNxHR video and PCM audio`, info.includes('dnxhd (' + EXPECT[profile]) && /Audio: pcm_s(16|24)le.*48000 Hz/.test(info), info.split('\n').filter((l) => /Stream/.test(l)).join(' | '));
  if (P.ext === 'mxf') ok(`${name}: the container is MXF`, /Input #0, mxf/.test(info));
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`presets: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
