// Long-sequence drift test (audit G-09): a 2-hour sequence at NTSC rates, cut at every frame with the real editing code, then
// walked with the exporter's own arithmetic (frame count, t = i / fps, visible clip, source time) and sent through the
// interchange writers and readers. It decides whether the seconds-as-doubles time model needs replacing. The decoder's side
// is checked with real files by scripts/e2e/drift.cjs.
// Run: node scripts/test_drift.mjs
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-drift-'));
const entry = path.join(tmp, 'entry.js');
const src = (p) => JSON.stringify(path.join(root, 'src', p));
fs.writeFileSync(entry, `export * as ed from ${src('Core/editing.js')};\nexport * as ct from ${src('Core/clipTime.js')};\nexport * as ix from ${src('Services/interchange/index.js')};`);
const out = path.join(tmp, 'bundle.mjs');
await esbuild.build({ absWorkingDir: root, entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error', loader: { '.wk': 'text' }, external: ['electron'] });
globalThis.window = globalThis.window || { editorstage: {} };
const { ed, ct, ix } = await import(pathToFileURL(out));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra); } };
const HOURS = 2, DUR = HOURS * 3600;

const baseSeq = (fps) => ({ id: 's', name: 'drift', fps, width: 1920, height: 1080, tracks: [{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }], transitions: [], markers: [], clips: [{ id: 'c0', mediaId: 'm', name: 'long.mov', track: 'V1', start: 0, dur: DUR, inPoint: 0, speed: 1, enabled: true, effects: [] }] });
const media = [{ id: 'm', name: 'long.mov', path: 'C:\\long.mov', kind: 'video', duration: DUR, hasAudio: false, width: 1920, height: 1080 }];

/** Cut at every frame and walk it like the exporter. seqFps: what the sequence stores; fileFps: the true rate of the source. */
function walk(label, seqFps, fileFps) {
  const seq = baseSeq(seqFps); const n = Math.floor(DUR * seqFps + 1e-6);
  const times = []; for (let i = 1; i < n; i++) times.push(i / seqFps);
  const t0 = Date.now();
  ed.splitClipsAt(seq, ['c0'], times);
  const clips = seq.clips.sort((a, b) => a.start - b.start);
  const end = ed.sequenceEnd(seq);
  const frames = Math.round((end - 0) * seqFps); // renderExport: frames = Math.round(dur * fps)
  let gaps = 0, doubles = 0, wrongClip = 0, maxErr = 0, strict = 0, micro = 0, firstWrong = -1;
  for (let i = 0; i < frames; i++) {
    const t = i / seqFps; // renderExport: t = opts.start + i / fps
    let visible = 0, hit = -1;
    for (let k = Math.max(0, i - 2); k <= Math.min(clips.length - 1, i + 2); k++) { const c = clips[k]; if (t >= c.start && t < c.start + c.dur) { visible++; hit = k; } }
    if (!visible) gaps++; else if (visible > 1) doubles++;
    if (hit !== i) { wrongClip++; if (firstWrong < 0) firstWrong = i; }
    if (hit < 0) continue;
    const target = ct.sourceAt(clips[hit], t, seqFps, Infinity);
    maxErr = Math.max(maxErr, Math.abs(target - t));
    // the source frame a decoder shows for `target`: the last frame whose time is <= target. Media time is held in whole
    // microseconds, so both sides are compared that way (rounded: the unit result; truncated seek: printed, real files decide)
    const shown = (targetUs) => { let j = Math.floor(target * fileFps) + 1; while (j > 0 && Math.round((j / fileFps) * 1e6) > targetUs) j--; return j; };
    if (shown(Math.round(target * 1e6)) !== i) micro++;
    if (shown(Math.floor(target * 1e6)) !== i) strict++;
  }
  const r = { label, seqFps, fileFps: +fileFps.toFixed(6), clips: clips.length, frames, gaps, doubles, wrongClip, firstWrong, maxErrSeconds: +maxErr.toExponential(2), maxErrFrames: +(maxErr * seqFps).toExponential(2), truncatedSeekOffByOne: strict, roundedSeekOffByOne: micro, ms: Date.now() - t0 };
  console.log('   ', JSON.stringify(r));
  ok(`${label}: export frame count = ${n}`, frames === n, `${frames}`);
  ok(`${label}: every output frame has exactly one clip (no gap, no double)`, !gaps && !doubles, JSON.stringify(r));
  ok(`${label}: every output frame shows its own clip`, !wrongClip, `first at frame ${firstWrong} of ${frames}`);
  ok(`${label}: source time error stays far below a frame`, maxErr * seqFps < 0.01, `${maxErr * seqFps} frames`);
  ok(`${label}: the frame shown is the frame cut (microsecond media time)`, !micro, `${micro} of ${frames}`);
  return r;
}

console.log('Cut at every frame, walked with the exporter arithmetic');
const results = [
  walk('29.97 sequence, 30000/1001 file', 29.97, 30000 / 1001),
  walk('29.97 exact sequence, 30000/1001 file', 30000 / 1001, 30000 / 1001),
  walk('23.976 sequence, 24000/1001 file', 23.976, 24000 / 1001),
  walk('59.94 sequence, 60000/1001 file', 59.94, 60000 / 1001),
];

// How long until a sequence stored as the rounded decimal rate slips one source frame against the true NTSC file rate.
for (const [dec, real] of [[29.97, 30000 / 1001], [23.976, 24000 / 1001], [59.94, 60000 / 1001]]) {
  const frames = 1 / (real / dec - 1); console.log(`    decimal rate ${dec}: one source frame of slip after ${(frames / dec / 3600).toFixed(2)} h`);
}

console.log('Interchange round trip at the end of a 2-hour timeline');
for (const fps of [29.97, 23.976, 59.94]) {
  const seq = baseSeq(fps); const n = Math.floor(DUR * fps + 1e-6); const times = [];
  for (let i = 89; i < n - 1000; i += 89) times.push(i / fps);
  for (let i = n - 1000; i < n; i++) times.push(i / fps);
  ed.splitClipsAt(seq, ['c0'], times);
  const desc = ix.quantize(ix.describeSequence(seq, media));
  const want = desc.clips.filter((c) => c.track === 'V1').sort((a, b) => a.start - b.start);
  const check = (name, back) => {
    const got = back.clips.filter((c) => c.track === 'V1').sort((a, b) => a.start - b.start);
    let worstStart = 0, worstIn = 0, worstDur = 0;
    for (let i = 0; i < Math.min(want.length, got.length); i++) {
      worstStart = Math.max(worstStart, Math.abs(got[i].start - want[i].start) * fps);
      worstDur = Math.max(worstDur, Math.abs(got[i].dur - want[i].dur) * fps);
      worstIn = Math.max(worstIn, Math.abs((got[i].inPoint || 0) - (want[i].inPoint || 0)) * fps);
    }
    const tail = got[got.length - 1]; const framesBack = tail ? Math.round((tail.start + tail.dur) * fps) : -1;
    console.log('   ', JSON.stringify({ fps, name, clips: got.length, worstStart: +worstStart.toFixed(4), worstDur: +worstDur.toFixed(4), worstIn: +worstIn.toFixed(4), framesBack, framesWant: n }));
    ok(`${fps} ${name}: all ${want.length} clips come back`, got.length === want.length, `${got.length}`);
    ok(`${fps} ${name}: starts, durations and sources land on the same frame`, worstStart < 0.5 && worstDur < 0.5 && worstIn < 0.5, `${worstStart} ${worstDur} ${worstIn}`);
    ok(`${fps} ${name}: total length in frames unchanged`, framesBack === n, `${framesBack} vs ${n}`);
  };
  if (fps !== 23.976) check('EDL drop-frame', ix.parseEDL(ix.writeEDL(desc, { withAudio: false }), fps));
  else check('EDL', ix.parseEDL(ix.writeEDL(desc, { withAudio: false }), fps));
  check('FCPXML', ix.parseFCPXML(ix.writeFCPXML(desc)));
  check('Premiere XML', ix.parseXMEML(ix.writeXMEML(desc)));
}

console.log(`\ndrift: ${pass} passed, ${fail} failed`);
console.log(`G-09 MODEL VERDICT: ${fail ? 'DRIFT FOUND' : 'NO DRIFT over ' + HOURS + ' hours'} (${results.reduce((a, r) => a + r.clips, 0)} clips walked; real decoder check: scripts/e2e/drift.cjs)`);
process.exit(fail ? 1 : 0);
