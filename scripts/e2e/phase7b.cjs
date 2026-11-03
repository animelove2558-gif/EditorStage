// Phase 7 end-to-end test, part B: Program Monitor > Comparison View (docs/PROMPT_PREMIERE_FINAL.md Phase B).
// Frame comparison shows the frame before / after its grade, Shot comparison another moment from its own elements
// (the Current image's elements are never moved), the monitor layouts, Color Match uses the view's reference.
const { suite } = require('./harness.cjs');

suite('phase7b e2e (Comparison View)', async ({ js, ok, A }) => {
  const J = (x) => JSON.stringify(x);
  // render a state with a fresh compositor and return the average RGB of the frame
  await js(`window.avg = (state, deps) => { const cv = document.createElement('canvas'); const C = new E.compositor.Compositor(cv); const w = 64, h = 48; const px = new Uint8Array(w * h * 4);
    C.render(state, deps || E.media.renderDeps, { w, h, read: px }); let r = 0, g = 0, b = 0; for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; } const n = w * h;
    C.gl.getExtension('WEBGL_lose_context')?.loseContext(); return [r / n, g / n, b / n].map(Math.round); }; return true;`);

  console.log('B2 Frame comparison: before / after the grade');
  let r = await js(`T.fresh(320, 240); const m = await T.imp('${A('neutral.png')}'); const [id] = T.place(m, 0, 'V1');
    T.patch(id, (c) => { c.lumetri = { exposure: 1.5, saturation: 0 }; c.filter = null; }); E.store.set({ playhead: 0.5 });
    const st = E.store.getState(); const cmp = { ...st.compare, on: true, kind: 'frame' };
    const ref = avg(E.compare.referenceState(st, cmp)); const cur = avg(st);
    const raw = avg({ ...st, sequence: { ...st.sequence, clips: st.sequence.clips.map((c) => ({ ...c, lumetri: null })) } });
    return { ref, cur, raw, kept: !!T.clip(id).lumetri };`);
  ok('Frame reference = the ungraded frame', r.ref.every((v, i) => Math.abs(v - r.raw[i]) <= 1), J(r));
  ok('Current keeps the grade (brighter, grey) and the project is untouched', r.cur[1] > r.ref[1] + 20 && Math.abs(r.cur[0] - r.cur[2]) <= 3 && r.kept, J(r));

  console.log('B2 Shot comparison: another moment, own elements');
  r = await js(`T.fresh(320, 240); const m = await T.imp('${A('rgb_seconds.mp4')}'); const [id] = T.place(m, 0, 'V1');
    E.store.set({ playhead: 2.5 }); for (let i = 0; i < 40; i++) { E.media.syncPlayback(E.store.getState()); await T.tick(50); }
    const st = E.store.getState(); const cmp = { ...st.compare, on: true, kind: 'shot', refTime: 0.5 }; const rs = E.compare.referenceState(st, cmp);
    let ready = false; for (let i = 0; i < 80 && !ready; i++) { ready = E.media.syncReference(rs); await T.tick(50); }
    const main = E.media.elementForClip(T.clip(id)); const refEl = E.media.elementForClip({ ...T.clip(id), elKey: 'cmp:' + id });
    return { ready, ref: avg(rs, E.media.referenceDeps), cur: avg(st), mainT: main.currentTime, refT: refEl.currentTime, distinct: main !== refEl };`);
  ok('reference elements seek to the reference time', r.ready && Math.abs(r.refT - 0.5) < 0.05 && r.distinct, J(r));
  ok('Shot reference shows red (0.5 s), Current still blue (2.5 s)', r.ref[0] > 180 && r.ref[2] < 60 && r.cur[2] > 180 && r.cur[0] < 60, J(r));
  ok('the Current element was not moved by the reference', Math.abs(r.mainT - 2.5) < 0.1, J(r));
  r = await js(`const s = { sequence: { tracks: [{ id: 'V2', kind: 'video' }, { id: 'V1', kind: 'video' }], clips: [{ id: 'a', track: 'V1', start: 0, dur: 2, mediaId: 'm' }, { id: 'b', track: 'V1', start: 2, dur: 3, mediaId: 'm' }, { id: 'c', track: 'V2', start: 3, dur: 1, mediaId: 'm' }] } };
    const C = E.compare; return { edits: C.videoEdits(s.sequence), prev: C.prevEdit(s.sequence, 3.5), next: C.nextEdit(s.sequence, 2.2), top: C.shotClipAt(s.sequence, 3.5)?.id, low: C.shotClipAt(s.sequence, 1)?.id, def: C.defaultRefTime(s.sequence, 2.5) };`);
  ok('edit points, Previous / Next Edit, topmost shot, default reference (middle of the previous shot)', J(r.edits) === J([0, 2, 3, 4, 5]) && r.prev === 3 && r.next === 3 && r.top === 'c' && r.low === 'a' && r.def === 1, J(r));

  console.log('B1 monitor layouts');
  r = await js(`E.cmds.run('view.comparisonView'); await T.tick(300); const q = (s) => document.querySelectorAll('.monitor ' + s).length;
    const side = { bar: q('.cmp-bar'), wraps: document.querySelector('.cmp-bar')?.closest('.monitor').querySelectorAll('.cmp-host > .cvwrap').length, tags: q('.cmp-tag') };
    E.cmds.run('view.comparisonView', { mode: 'vsplit' }); await T.tick(300); const v = { div: q('.cmp-divider.v'), ref: q('canvas.cmp-ref') };
    E.cmds.run('view.compareSwap'); await T.tick(100); const swapped = E.store.getState().compare.swap;
    E.cmds.run('view.comparisonView', { mode: 'hsplit' }); await T.tick(300); const h = { div: q('.cmp-divider.h') };
    const remembered = JSON.parse(localStorage.getItem('es-compare') || '{}').mode;
    E.cmds.run('view.comparisonView', { on: false }); await T.tick(300); const off = { bar: q('.cmp-bar'), ref: q('canvas.cmp-ref'), cmpEls: 0 };
    const menu = E.menus.MENUS.find((x) => x.label === 'View').items.some((i) => i.cmd === 'view.comparisonView');
    E.cmds.run('view.compareSwap');
    return { side, v, h, off, swapped, remembered, menu };`);
  ok('Side by Side: two frames + control bar', r.side.bar === 1 && r.side.wraps === 2 && r.side.tags === 2, J(r));
  ok('Vertical / Horizontal Split: reference canvas + divider; Swap Sides; mode remembered', r.v.div === 1 && r.v.ref === 1 && r.h.div === 1 && r.swapped && r.remembered === 'hsplit', J(r));
  ok('closing removes the view; View menu has Comparison View', r.off.bar === 0 && r.off.ref === 0 && r.menu, J(r));
  r = await js(`return JSON.stringify(E.store.getState().sequence).includes('compare') || JSON.stringify({ s: E.store.getState().sequence, m: E.store.getState().media }).includes('cmp:');`);
  ok('nothing of the view is written into the project', r === false);

  console.log('B3 Color Match uses the Comparison View reference');
  r = await js(`T.fresh(320, 240); const w = await T.imp('${A('warm.png')}'); const n = await T.imp('${A('neutral.png')}'); const [a] = T.place(w, 0, 'V1'); T.patch(a, (c) => { c.dur = 2; }); const [b] = T.place(n, 2, 'V1'); T.patch(b, (c) => { c.dur = 2; });
    const st = E.store.getState(); const shot = E.compare.shotClipAt(st.sequence, 1); return { shot: shot?.id === a, other: E.compare.shotClipAt(st.sequence, 3)?.id === b };`);
  ok('Shot reference resolves to the clip under the reference time', r.shot && r.other, J(r));
});
