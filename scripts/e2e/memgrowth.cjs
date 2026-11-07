// Memory growth measurement (audit C-04, C-05): walks the playhead through N one-second clips of a 1080p file in the real
// app and records the renderer and GPU process working sets, the element pool and the compositor's texture caches.
// Run: electron scripts/e2e/memgrowth.cjs [clips]. Prints one JSON line per sample, then checks the caps when the build has them.
const { app } = require('electron');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { suite } = require('./harness.cjs');

const N = +process.env.ES_MEM_CLIPS || 300;
const mb = (kb) => Math.round(kb / 1024);
function metrics() {
  const out = { renderer: 0, gpu: 0 };
  for (const m of app.getAppMetrics()) { if (m.type === 'Tab') out.renderer += m.memory.workingSetSize; if (m.type === 'GPU') out.gpu += m.memory.workingSetSize; }
  return { rendererMB: mb(out.renderer), gpuMB: mb(out.gpu) };
}

suite(`memgrowth (${N} clips)`, async ({ js, ok, out }) => {
  const file = out('src1080.mp4');
  const r = spawnSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=30', '-f', 'lavfi', '-i', 'sine=f=440:d=30', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
  if (r.status !== 0) throw new Error(String(r.stderr));
  const m = await js(`const m = await T.imp(${JSON.stringify(file)}); T.fresh(1920, 1080, 30);
    E.store.edit('many', ({ seq }) => { for (let i = 0; i < ${N}; i++) { const ids = E.cmds.placeMedia(seq, m, i); for (const c of seq.clips) if (ids.includes(c.id)) { c.dur = 1; c.inPoint = i % 25; } } });
    E.store.set({ pausedRes: 'Full', playbackRes: 'Full' });
    // drive the monitor's work directly: requestAnimationFrame does not fire while the test window is covered
    window.__memDraw = async (n = 3) => { for (let k = 0; k < n; k++) { const st = E.store.getState(); E.media.syncPlayback(st); window.__comp.render(st, E.media.renderDeps, { w: 1280, h: 720 }); await T.tick(30); } };
    window.__memStats = () => { const c = window.__comp; const px = (x) => (x.w || 0) * (x.h || 0) * 4; let bytes = 0; if (c) for (const s of c.srcTex.values()) bytes += px(s);
      return { pool: E.media.poolStats ? E.media.poolStats().total : null, video: E.media.poolStats ? E.media.poolStats().video : null, audio: E.media.poolStats ? E.media.poolStats().audio : null, chains: E.audio.debugChains().length, srcTex: c ? c.srcTex.size : -1, texMB: Math.round(bytes / 1048576), passes: c?.cacheStats ? c.cacheStats().passes : null }; };
    return { id: m.id, clips: E.store.getState().sequence.clips.length };`);
  ok('project built', m.clips === N * 2, String(m.clips));
  const samples = [];
  const sample = async (i) => { const s = { clip: i, ...metrics(), ...(await js('return window.__memStats()')) }; samples.push(s); console.log(JSON.stringify(s)); };
  await sample(0);
  for (let i = 0; i < N; i++) {
    await js(`E.store.set({ playhead: ${i + 0.5} }); await window.__memDraw();`);
    if ((i + 1) % 50 === 0) await sample(i + 1);
  }
  // a clip that was evicted long ago must come back with its picture
  const back = await js(`E.store.set({ playhead: 3.5 }); for (let i = 0; i < 80; i++) { await window.__memDraw(1); const c = E.store.getState().sequence.clips.find((x) => x.start === 3 && E.store.getState().sequence.tracks.find((t) => t.id === x.track)?.kind === 'video'); const s = window.__comp.srcTex.get(c.id); if (s?.ok && Math.abs(E.media.elementForClip(c).currentTime - 3.5) < 0.05) return true; } return false;`);
  ok('an old clip shows its picture again', back);
  if (samples[0].pool != null) {
    const last = samples[samples.length - 1];
    ok('element pool stays within its caps', last.video <= 14 && last.audio <= 26, JSON.stringify(last));
    ok('source textures stay within the cap', last.srcTex <= 16, JSON.stringify(last));
  }
  console.log('SUMMARY ' + JSON.stringify({ first: samples[0], last: samples[samples.length - 1] }));
});
