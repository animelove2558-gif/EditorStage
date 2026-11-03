// Remix (src/Services/remix.js): beat analysis, refusing non-music, planning (length within a beat, intro / ending kept,
// cuts on beats), rendering without clicks, interchange expansion, cache serialisation. Run: node scripts/test_remix.mjs
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-remix-'));
const out = path.join(tmp, 'remix.mjs');
await esbuild.build({ absWorkingDir: root, entryPoints: [path.join(root, 'src/Services/remix.js')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
const R = await import(pathToFileURL(out).href);
fs.rmSync(tmp, { recursive: true, force: true });

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const J = JSON.stringify;
const SR = 22050;

// 60 s at 120 BPM: kick on every beat, off-beat hats, a chord per 2 s bar, a 4-bar progression (like the e2e asset)
let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
function music(sec = 60, bpm = 120) {
  const n = Math.round(sec * SR), x = new Float32Array(n), bp = 60 / bpm; const prog = [1, 0.8909, 0.7492, 0.8409];
  for (let i = 0; i < n; i++) {
    const t = i / SR; const F = 220 * prog[Math.floor((t % (8 * bp * 2)) / (4 * bp)) % 4];
    x[i] = 0.7 * Math.sin(2 * Math.PI * 60 * t) * Math.exp(-15 * (t % bp)) + 0.12 * (Math.sin(2 * Math.PI * F * t) + Math.sin(2 * Math.PI * F * 1.25 * t) + Math.sin(2 * Math.PI * F * 1.5 * t)) + 0.08 * rnd() * Math.exp(-60 * ((t + bp / 2) % bp));
  }
  return x;
}
const pcm = music();
const an = R.analyzeMusic(pcm, SR);
ok('tempo of a 120 BPM track', Math.abs(an.bpm - 120) < 2, String(an.bpm));
const gaps = Array.from(an.beats).slice(1).map((b, i) => b - an.beats[i]); const med = gaps.slice().sort((a, b) => a - b)[gaps.length >> 1];
ok('beats every 0.5 s, about 120 of them', Math.abs(med - 0.5) < 0.02 && an.beats.length >= 110 && an.beats.length <= 122, J({ med, n: an.beats.length }));
// beats sit on the kicks, slightly early (frame centre; a cut just before the attack keeps the attack whole)
const offs = Array.from(an.beats).map((b) => ((b + 0.25) % 0.5) - 0.25);
ok('beats sit on the kicks (0..60 ms before them), not on the off-beat hats', offs.filter((o) => o <= 0.01 && o >= -0.06).length / offs.length > 0.9, offs.slice(5, 15).map((o) => Math.round(o * 1000)).join(' '));
ok('features per beat', an.feats.length === an.beats.length * an.D && an.D === 25);

// refusing what is not music
const noise = new Float32Array(SR * 12); for (let i = 0; i < noise.length; i++) noise[i] = rnd() * Math.sin((Math.PI * i) / noise.length) * 0.3;
let err = null; try { R.analyzeMusic(noise, SR); } catch (e) { err = e; }
ok('a beat-less sweep is refused with a clear message', err && err.code === 'nobeat' && /beat/i.test(err.message), String(err?.message));
err = null; try { R.analyzeMusic(new Float32Array(SR * 5), SR); } catch (e) { err = e; }
ok('a 5 s clip is refused as too short', err && err.code === 'nobeat' && /short/i.test(err.message), String(err?.message));

// planning
const S = pcm.length / SR; const beatSet = Array.from(an.beats); const period = 60 / an.bpm;
const onBeat = (t) => beatSet.some((b) => Math.abs(b - t) < 1e-9);
for (const [target, params] of [[30, {}], [20, {}], [90, {}], [150, {}], [150, { variations: 1 }], [40, { segments: 0 }], [S, {}]]) {
  const p = R.planRemix(an, [0, S], target, params); const segs = p.segments; const first = segs[0], last = segs[segs.length - 1];
  const name = `${target.toFixed(0)} s ${J(params)}`;
  ok(`plan ${name}: length within one beat`, Math.abs(p.dur - target) <= period + 1e-6, J({ dur: p.dur, target }));
  ok(`plan ${name}: intro and ending kept`, first.srcIn === 0 && last.srcOut === S && first.srcOut >= beatSet[8] - 1e-9 && last.srcIn <= beatSet[beatSet.length - 9] + 1e-9, J(segs));
  ok(`plan ${name}: every cut on a beat`, segs.slice(1).every((s) => onBeat(s.srcIn)) && segs.slice(0, -1).every((s) => onBeat(s.srcOut)), J(segs));
  ok(`plan ${name}: cuts listed at clip-local times`, p.cuts.length === segs.length - 1 && (p.cuts.length === 0 || Math.abs(p.cuts[0] - (first.srcOut - first.srcIn)) < 1e-9));
}
const p20 = R.planRemix(an, [0, S], 20); // the skip is a whole number of 4-bar loops: the harmony matches
ok('a skip of whole 8 s loops is found (low cost)', p20.cost < 0.4 && (() => { const k = (p20.segments[1].srcIn - p20.segments[0].srcOut) / 8; return Math.abs(k - Math.round(k)) * 8 < 0.1; })(), J(p20));
const v0 = R.planRemix(an, [0, S], 150, { variations: 0 }), v1 = R.planRemix(an, [0, S], 150, { variations: 1 });
const loops = (p) => new Set(p.segments.slice(1).map((s) => s.srcIn.toFixed(3))).size;
ok('Variations: low repeats one loop, high uses different loops', loops(v0) === 1 && loops(v1) > 1, J({ v0: v0.segments, v1: v1.segments }));
const sub = R.planRemix(an, [10, 50], 25);
ok('a sub-range of the file: stays inside it', sub.segments[0].srcIn === 10 && sub.segments.at(-1).srcOut === 50 && Math.abs(sub.dur - 25) <= period, J(sub));
err = null; try { R.planRemix(an, [0, S], 3); } catch (e) { err = e; } ok('a target shorter than intro + ending is refused', err && err.code === 'nobeat');

// rendering: equal-power crossfade, no click at the cuts
{
  const sr = 8000; const src = new Float32Array(sr * 10); for (let i = 0; i < src.length; i++) src[i] = 0.5 * Math.sin((2 * Math.PI * 330 * i) / sr);
  const segs = [{ srcIn: 0, srcOut: 3.0001 }, { srcIn: 5.37, srcOut: 7 }, { srcIn: 2, srcOut: 4 }];
  const n = Math.round(sr * (3.0001 + 1.63 + 2 + 0.5)); const [o] = R.renderRemix([src], sr, segs, 0.03, 0.25, n);
  let maxD = 0, atCut = 0; const cuts = [3.0001 + 0.25, 3.0001 + 1.63 + 0.25].map((t) => Math.round(t * sr));
  for (let k = 1; k < n; k++) { const d = Math.abs(o[k] - o[k - 1]); if (cuts.some((c) => Math.abs(k - c) < sr * 0.03)) atCut = Math.max(atCut, d); else maxD = Math.max(maxD, d); }
  ok('no click at the cuts (sample-to-sample change at most the equal-power sum, √2 × the music)', atCut <= maxD * 1.5, J({ atCut, maxD }));
  const [hard] = R.renderRemix([src], sr, segs, 1 / sr, 0.25, n); let hardD = 0; for (const c of cuts) for (let k = c - 3; k < c + 3; k++) hardD = Math.max(hardD, Math.abs(hard[k] - hard[k - 1]));
  ok('(without a crossfade the same cuts click)', hardD > maxD * 2, J({ hardD, maxD }));
  ok('pre-roll before the first segment plays the source before it', Math.abs(o[Math.round(0.1 * sr)] - 0) < 1e-6 && o.length === n);
  const tail = R.renderRemix([src], sr, [{ srcIn: 1, srcOut: 2 }], 0.03, 0.5, sr * 2)[0];
  ok('pre / post handles continue the source', Math.abs(tail[0] - src[Math.round(0.5 * sr)]) < 1e-6 && Math.abs(tail[sr * 2 - 1] - src[Math.round(2.5 * sr) - 1]) < 1e-6);
}
ok('remixSourceAt maps clip time through the segments', R.remixSourceAt([{ srcIn: 0, srcOut: 3 }, { srcIn: 10, srcOut: 12 }], 4) === 11 && R.remixSourceAt([{ srcIn: 0, srcOut: 3 }, { srcIn: 10, srcOut: 12 }], 1) === 1);

// interchange expansion
{
  const seq = { fps: 30, tracks: [{ id: 'A1', kind: 'audio' }], transitions: [], clips: [{ id: 'm', track: 'A1', start: 2, dur: 5, inPoint: 0, mediaId: 'x', remix: { segments: [{ srcIn: 0, srcOut: 3 }, { srcIn: 10, srcOut: 12 }], params: { xfade: 30 } } }, { id: 'o', track: 'A1', start: 9, dur: 1, inPoint: 0, mediaId: 'y' }] };
  const e = R.expandRemix(seq);
  ok('expandRemix: one clip per segment, back to back, with a crossfade', J(e.clips.map((c) => [c.id, c.start, c.dur, c.inPoint, !!c.remix])) === J([['m_r0', 2, 3, 0, false], ['m_r1', 5, 2, 10, false], ['o', 9, 1, 0, false]]) && e.transitions.length === 1 && e.transitions[0].aId === 'm_r0' && e.transitions[0].bId === 'm_r1' && e.transitions[0].at === 5, J(e));
  ok('expandRemix: a sequence without remixes is returned as it is', R.expandRemix({ clips: [{ id: 'a' }] }).clips[0].id === 'a');
}
// cache file round trip
const back = R.analysisFromJson(JSON.parse(JSON.stringify(R.analysisToJson(an))));
const pb = R.planRemix(back, [0, S], 30), pa = R.planRemix(an, [0, S], 30);
ok('analysis survives the cache file (same plan)', J(pa.segments) === J(pb.segments), J({ pa: pa.segments, pb: pb.segments }));

console.log(`remix: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
