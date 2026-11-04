// Timeline clip display (Phase 5B): thumbnail tiles (src/Services/thumbs.js thumbSlots) follow the real source frames,
// keyframe rubber bands (src/Core/clipBands.js) edit the same keyframes evalParam reads. Run: node scripts/test_clipview.mjs
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-clipview-'));
const entry = path.join(tmp, 'entry.js'); const out = path.join(tmp, 'bundle.mjs');
fs.writeFileSync(entry, `export { thumbSlots, frameIndex, renderedSlots } from ${JSON.stringify(path.join(root, 'src/Services/thumbs.js'))};
export * from ${JSON.stringify(path.join(root, 'src/Core/clipBands.js'))};
export { evalParam } from ${JSON.stringify(path.join(root, 'src/Core/params.js'))};
export { VIDEO_FX } from ${JSON.stringify(path.join(root, 'src/Renderers/fx/videoEffects.js'))};`);
const shim = `globalThis.window = globalThis; globalThis.document = { createElement: () => ({ getContext: () => null, style: {} }) }; globalThis.localStorage = { getItem: () => null, setItem: () => {} };`;
await esbuild.build({ absWorkingDir: root, entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error', loader: { '.js': 'jsx', '.wk': 'text' }, banner: { js: shim } });
const m = await import(pathToFileURL(out).href);
fs.rmSync(tmp, { recursive: true, force: true });

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;
const J = JSON.stringify;
const C = (o = {}) => ({ id: 'c', start: 10, dur: 4, inPoint: 2, speed: 1, effects: [], ...o });
const opt = (o = {}) => ({ W: 400, tw: 40, pps: 100, mode: 'continuous', fps: 30, mediaDur: 20, ...o });

// ---- thumbnails ----
ok('None: no tiles', !m.thumbSlots(C(), opt({ mode: 'none' })).length);
let s = m.thumbSlots(C(), opt({ mode: 'head' }));
ok('Head: one tile at the in point', s.length === 1 && near(s[0].src, 2) && s[0].x === 0, J(s));
s = m.thumbSlots(C(), opt({ mode: 'headTail' }));
ok('Head and Tail: first and last frame', s.length === 2 && near(s[0].src, 2) && near(s[1].src, 6 - 1 / 30) && s[1].x === 360, J(s));
ok('Head and Tail on a short clip: head only', m.thumbSlots(C(), opt({ mode: 'headTail', W: 60 })).length === 1);
s = m.thumbSlots(C(), opt());
ok('Continuous: one tile per tile width, frame at the left edge', s.length === 10 && near(s[3].src, 2 + 1.2) && s[3].x === 120, J(s.map((x) => x.src)));
s = m.thumbSlots(C({ speed: 2 }), opt());
ok('speed 200%: tiles walk the source twice as fast', near(s[5].src, 2 + 2 * 2), J(s.map((x) => x.src)));
s = m.thumbSlots(C({ reverse: true, inPoint: 6 }), opt({ mode: 'headTail' }));
ok('reverse: the head shows the last source frame, the tail the first', s[0].src > s[1].src && near(s[0].src, 6, 0.05) && near(s[1].src, 2, 0.05), J(s));
s = m.thumbSlots(C({ frameHold: { on: true, mode: 'source', time: 3.3 } }), opt());
ok('frame hold: every tile shows the held frame', s.every((x) => near(x.src, 3.3)), J(s.map((x) => x.src)));
s = m.thumbSlots(C({ timeRemap: { speed: { v: 100, keys: [{ t: 0, v: 100 }, { t: 2, v: 300 }] } } }), opt());
ok('time remapping: tiles follow the ramp (sourceAt)', s[4].src - s[3].src > s[1].src - s[0].src, J(s.map((x) => x.src)));
s = m.thumbSlots(C({ dur: 400 }), opt({ W: 40000 }));
ok('Continuous is capped (120 tiles), tiles widen', s.length === 120 && s[1].x > 40, J([s.length, s[1].x]));
ok('frame index of a source time (the cache key)', m.frameIndex(1, 30) === 30 && m.frameIndex(1.0333, 30) === 30 && m.frameIndex(0.99999, 30) === 29);

// ---- rubber bands ----
const fx = { video: m.VIDEO_FX, audio: {} };
const vclip = { id: 'v', start: 0, dur: 4, effects: [{ name: 'Gaussian Blur', enabled: true, params: {} }] };
const vdefs = m.bandParams(vclip, 'video', fx); const adefs = m.bandParams({ id: 'a', effects: [] }, 'audio', fx);
ok('video clip: Opacity, Motion (Position X/Y, Scale, Rotation) and effect sliders', ['opacity.opacity', 'motion.position.0', 'motion.position.1', 'motion.scale', 'motion.rotation'].every((k) => vdefs.some((d) => d.key === k)) && vdefs.some((d) => d.key.startsWith('fx.0.')), J(vdefs.map((d) => d.key)));
ok('audio clip: Volume > Level', adefs[0].key === 'volume.level' && adefs.length === 1);
const op = vdefs.find((d) => d.key === 'opacity.opacity'), vol = adefs[0], px = vdefs.find((d) => d.key === 'motion.position.0');
ok('opacity band: 0 at the bottom, 100 at the top', m.fracOf(op, 0) === 0 && m.fracOf(op, 100) === 1 && near(m.valueOf(op, 0.25), 25));
ok('volume band: 0 dB at half height, +6 dB at the top, −∞ at the bottom', near(m.fracOf(vol, 0), 0.5) && near(m.valueOf(vol, 1), 6.02, 0.01) && m.valueOf(vol, 0) === -96 && near(m.valueOf(vol, m.fracOf(vol, -12)), -12, 1e-6));
let p = op.get(vclip);
p = m.dragBandLine(op, p, 1, -0.4);
ok('drag the line without keyframes: the whole clip changes (100 → 60)', near(p.v, 60) && !p.keys, J(p));
p = m.addBandKey(op, p, 1); p = m.addBandKey(op, { ...p }, 3);
ok('Ctrl+click adds keyframes with the current value', p.keys.length === 2 && near(p.keys[0].v, 60) && near(m.evalParam(p, 2), 60), J(p));
p = m.dragBandLine(op, p, 2, 0.2);
ok('drag a segment: its two keys move by the same distance', near(p.keys[0].v, 80) && near(p.keys[1].v, 80), J(p));
p = m.dragBandKey(op, p, 3, 3.5, 0.1, 4);
ok('drag a key: time and value', near(p.keys[1].t, 3.5) && near(p.keys[1].v, 10) && near(m.evalParam(p, 3.5), 10), J(p));
p = m.dragBandKey(op, p, 3.5, 9, 0.1, 4);
ok('a key cannot leave the clip', p.keys[1].t <= 4, J(p));
p = m.removeBandKey(p, 1);
ok('Alt+click removes a key', p.keys.length === 1);
const c2 = structuredClone(vclip); m.setBandParam(c2, 'opacity.opacity', p);
ok('the band writes the same param Effect Controls / the compositor read', c2.opacity.opacity === p && c2.opacity.blend?.v === 'Normal');
let pp = px.get(vclip); pp = m.dragBandLine(px, pp, 0, 0.1);
ok('Position X band changes only x', near(pp.v[0], 0.8) && near(pp.v[1], 0.5), J(pp));
pp = m.addBandKey(px, pp, 2); pp = m.dragBandKey(px, pp, 2, 2, 0.5, 4);
ok('Position X key keeps its y', near(pp.keys[0].v[0], 0.5) && near(pp.keys[0].v[1], 0.5), J(pp));
const c3 = structuredClone(vclip); const blur = vdefs.find((d) => d.key.startsWith('fx.0.'));
m.setBandParam(c3, blur.key, m.dragBandLine(blur, blur.get(c3), 0, 0.5));
ok('an effect parameter band writes into the effect', c3.effects[0].params[blur.key.split('.')[2]].v > blur.min, J(c3.effects[0]));
let vp = vol.get({}); vp = m.dragBandLine(vol, vp, 0, -0.25);
ok('volume drag: half height → quarter = −6 dB', near(vp.v, -6.02, 0.02), J(vp));

// ---- nested sequence / MOGRT tiles (Phase 9 D14): rendered at sequence times, not decoded at source times
const N = (o = {}) => ({ id: 'n', start: 10, dur: 4, nestId: 'sq2', ...o });
let rs = m.renderedSlots(N(), { W: 400, tw: 40, pps: 100, mode: 'head', fps: 30 });
ok('nest Head: one tile at the clip start (sequence time)', rs.length === 1 && rs[0].t === 10 && rs[0].x === 0 && rs[0].w === 40, J(rs));
rs = m.renderedSlots(N(), { W: 400, tw: 40, pps: 100, mode: 'headTail', fps: 30 });
ok('nest Head and Tail: first and last frame of the clip', rs.length === 2 && rs[0].t === 10 && near(rs[1].t, 14 - 1 / 30) && rs[1].x === 360, J(rs));
rs = m.renderedSlots(N(), { W: 400, tw: 40, pps: 100, mode: 'continuous', fps: 30 });
ok('nest Continuous: at most 12 composited tiles, wider when capped, inside the clip', rs.length === 10 && rs.every((x, i) => near(x.t, 10 + (i * 40) / 100)) && m.renderedSlots(N({ dur: 40 }), { W: 4000, tw: 40, pps: 100, mode: 'continuous' }).length === 12, J(rs));
const wide = m.renderedSlots(N({ dur: 40 }), { W: 4000, tw: 40, pps: 100, mode: 'continuous' });
ok('capped tiles cover the whole clip', near(wide[1].x, 4000 / 12) && wide.at(-1).t < 50, J(wide.map((x) => x.t)));
rs = m.renderedSlots({ id: 'g', start: 5, dur: 6, mogrt: { id: 'x' } }, { W: 600, tw: 40, pps: 100, mode: 'head', fps: 30 });
ok('MOGRT Head: the frame 1 s in (its text has animated in)', rs.length === 1 && rs[0].t === 6, J(rs));
rs = m.renderedSlots({ id: 'g', start: 5, dur: 1, mogrt: { id: 'x' } }, { W: 100, tw: 40, pps: 100, mode: 'head', fps: 30 });
ok('MOGRT shorter than 2 s: the middle frame', rs[0].t === 5.5, J(rs));
ok('rendered tiles: None / zero width -> none', !m.renderedSlots(N(), { W: 400, tw: 40, pps: 100, mode: 'none' }).length && !m.renderedSlots(N(), { W: 0, tw: 40, pps: 100, mode: 'head' }).length);

console.log(`clip view: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
