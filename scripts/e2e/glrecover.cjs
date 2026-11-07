// WebGL context loss and restore (audit C-06) in the real app: the monitor's compositor comes back with its picture, an export
// that loses its context redraws the frame instead of writing a black one, and one whose context never returns fails cleanly.
// Run: electron scripts/e2e/glrecover.cjs
const fs = require('fs');
const { suite } = require('./harness.cjs');

const W = 320, H = 180;
suite('glrecover', async ({ js, ok, A, out, frames, px, near }) => {
  await js(`const m = await T.imp('${A('rgb_seconds.mp4')}'); T.fresh(${W}, ${H}, 30); T.place(m, 0);
    E.store.set({ playhead: 0.5 });
    // requestAnimationFrame does not fire while the test window is covered, so the monitor's work is driven directly
    window.D = {
      async draw(n = 6) { let r; for (let i = 0; i < n; i++) { const st = E.store.getState(); E.media.syncPlayback(st); r = window.__comp.render(st, E.media.renderDeps, { w: ${W}, h: ${H} }); await T.tick(40); } return r; },
      pixel() { const g = window.__comp.gl; const p = new Uint8Array(4); g.bindFramebuffer(g.FRAMEBUFFER, null); g.readPixels(${W >> 1}, ${H >> 1}, 1, 1, g.RGBA, g.UNSIGNED_BYTE, p); return [...p]; },
    };
    return true;`);

  // ---- the monitor ----
  const before = await js(`await D.draw(); return D.pixel();`);
  ok('the monitor shows the red second first', before[0] > 200 && before[1] < 60, String(before));
  const lost = await js(`const c = window.__comp; window.__ext = c.gl.getExtension('WEBGL_lose_context'); __ext.loseContext();
    for (let i = 0; i < 40 && !c.lost; i++) await T.tick(25);
    return { lost: c.lost, render: c.render(E.store.getState(), E.media.renderDeps, { w: ${W}, h: ${H} }), notice: !c.canvas.isConnected || !!c.canvas.parentElement.querySelector('.gl-lost-notice'), connected: c.canvas.isConnected };`);
  ok('the loss is noticed', lost.lost);
  ok('drawing while lost does nothing and does not throw', lost.render === false);
  ok('the monitor tells the user', lost.notice && lost.connected, JSON.stringify(lost));
  const back = await js(`const c = window.__comp; __ext.restoreContext(); const r = await c.whenRestored(10000); const ok2 = await D.draw(); return { r, ok2, restores: c.restores, lost: c.lost, pixel: D.pixel(), notice: !!c.canvas.parentElement?.querySelector('.gl-lost-notice'), errors: Object.keys(c.errors) };`);
  ok('the context comes back', back.r === true && back.restores === 1 && back.lost === false, JSON.stringify(back));
  ok('the picture comes back', back.pixel[0] > 200 && back.pixel[1] < 60, String(back.pixel));
  ok('the notice goes away', back.notice === false);
  ok('no shader failed after the restore', back.errors.length === 0, back.errors.join());
  const effect = await js(`E.store.edit('fx', ({ seq }) => { const c = seq.clips.find((x) => x.mediaId); c.lumetri = { exposure: 1 }; c.effects = [...(c.effects || [])]; }); await D.draw(); return { errors: Object.keys(window.__comp.errors), pixel: D.pixel() };`);
  ok('programs and data textures are rebuilt on demand', effect.errors.length === 0, effect.errors.join());
  await js(`E.store.edit('fx off', ({ seq }) => { const c = seq.clips.find((x) => x.mediaId); delete c.lumetri; }); return true;`);

  // ---- an export that loses its context on frame 5 and gets it back ----
  const file = out('lost.mp4');
  const res = await js(`const P = E.compositor.Compositor.prototype; const orig = P.render; let n = 0, redraws = 0;
    P.render = function (...a) { if (this === window.__comp) return orig.apply(this, a); n++; if (n === 5) { const x = this.gl.getExtension('WEBGL_lose_context'); x.loseContext(); setTimeout(() => x.restoreContext(), 300); } const r = orig.apply(this, a); if (!r) redraws++; return r; };
    try { await T.exp(${JSON.stringify(file)}, 'H.264 (MP4)', ${W}, ${H}, 0, 1); return { n, redraws }; } finally { P.render = orig; }`);
  const list = frames(file, W, H);
  ok('the export finishes with every frame', list.length === 30, String(list.length));
  ok('the lost frame was drawn again', res.n > 30, JSON.stringify(res));
  const dark = list.filter((f) => !near(px(f, W, W >> 1, H >> 1), [255, 0, 0], 60)).length;
  ok('no black frame in the file', dark === 0, `${dark} of ${list.length}`);

  // ---- an export whose context never comes back ----
  const dead = out('dead.mp4');
  const res2 = await js(`const P = E.compositor.Compositor.prototype; const orig = P.render, wr = P.whenRestored; let n = 0;
    P.whenRestored = function () { return this === window.__comp ? wr.call(this) : Promise.resolve(false); };
    P.render = function (...a) { if (this !== window.__comp && ++n === 3) this.gl.getExtension('WEBGL_lose_context').loseContext(); return orig.apply(this, a); };
    try { const s = E.store.getState().sequence; return await E.exporter.exportSequence({ path: ${JSON.stringify(dead)}, preset: 'H.264 (MP4)', width: ${W}, height: ${H}, fps: s.fps, start: 0, end: 1, audio: false }, () => {}, () => false); } finally { P.render = orig; P.whenRestored = wr; }`);
  ok('an export that cannot recover fails with a message', res2.ok === false && /graphics context/i.test(res2.error), JSON.stringify(res2));
  ok('...and leaves no file', !fs.existsSync(dead) && !fs.existsSync(dead.replace('.mp4', '.es-part.mp4')));
});
