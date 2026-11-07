// Long-sequence drift, decoder side (audit G-09): a real 2-hour 30000/1001 file whose every frame carries its own number in
// pixels, cut at every frame in three ranges with the real editing code, exported with the real exporter; the numbers in the
// output must run without a repeat or a skip. Exporting all 215,784 frames is not practical, so the ranges are the head, the
// middle and the very end, where accumulated error would be largest. scripts/test_drift.mjs covers the whole length by model.
// Run: electron scripts/e2e/drift.cjs
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { suite } = require('./harness.cjs');

const W = 36, H = 16, BITS = 18, FRAMES = 215784, RANGE = 240;
const file = path.join(os.tmpdir(), 'es-drift-2h-30000-1001.mp4'); // kept between runs: it takes a few minutes to make
function makeSource() {
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return;
  const lum = `if(bitand(trunc(N/pow(2,floor(X/2))),1),235,16)`;
  const r = spawnSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=30000/1001`, '-frames:v', String(FRAMES),
    '-vf', `format=gray,geq=lum='${lum}',format=yuv420p`, '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '4', '-g', '15', file], { maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(String(r.stderr));
}
const numberOf = (f) => { let n = 0; for (let b = 0; b < BITS; b++) if (f[(H >> 1) * W * 3 + (b * 2 + 1) * 3] > 128) n += 2 ** b; return n; };

suite('drift (real 2-hour file)', async ({ js, ok, out, frames }) => {
  makeSource();
  for (const [label, fps] of [['29.97 sequence', 29.97], ['exact 30000/1001 sequence', 30000 / 1001]]) {
    for (const f0 of [0, 107000, FRAMES - RANGE - 1]) {
      const name = out(`d${Math.round(fps)}_${f0}_${label.length}.mov`);
      const info = await js(`const m = await T.imp(${JSON.stringify(file)}); T.fresh(${W}, ${H}, ${fps});
        const [id] = T.place(m, 0);
        E.store.edit('cut', ({ seq }) => { const ts = []; for (let i = 0; i <= ${RANGE}; i++) ts.push((${f0} + i) / ${fps}); E.editing.splitClipsAt(seq, [id], ts.filter((t) => t > 0)); });
        await T.exp(${JSON.stringify(name)}, 'Apple ProRes 422 (MOV)', ${W}, ${H}, ${f0} / ${fps}, (${f0} + ${RANGE}) / ${fps});
        return { pool: E.media.poolStats ? E.media.poolStats() : null, fpsProbed: m.fps, dur: m.duration };`);
      const list = frames(name, W, H).map(numberOf);
      let wrong = 0, first = -1; list.forEach((n, i) => { if (n !== f0 + i) { wrong++; if (first < 0) first = i; } });
      console.log('   ', JSON.stringify({ label, f0, frames: list.length, wrong, first, sample: first >= 0 ? list.slice(Math.max(0, first - 2), first + 3) : [], want: first >= 0 ? f0 + first : null, ...info }));
      ok(`${label}, frame ${f0}: ${RANGE} frames out`, list.length === RANGE, String(list.length));
      ok(`${label}, frame ${f0}: every frame is its own source frame`, !wrong, `${wrong} wrong, first at ${first}`);
      if (info.pool) ok(`${label}, frame ${f0}: pool stayed capped while cutting through ${RANGE} clips`, info.pool.video <= 40, JSON.stringify(info.pool));
    }
  }
});
