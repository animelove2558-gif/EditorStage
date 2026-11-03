// Phase 7 end-to-end test, part A: Trim Mode / Trim Monitor (docs/PROMPT_PREMIERE_FINAL.md Phase A).
// Shift+T on the edit nearest the playhead, the Trim Monitor frames, Trim -N/-1/+1/+N, rolling / ripple / regular,
// Ctrl+T, Ctrl+Left / Right, undo, dynamic J/K/L trimming, Ctrl+click to add an edit, leaving Trim Mode.
const { suite } = require('./harness.cjs');

suite('phase7a e2e (Trim Mode)', async ({ js, ok, A }) => {
  const J = (x) => JSON.stringify(x);
  await js(`window.key = (key, o = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...o }));
    window.TS = () => { const s = E.store.getState(); const c = s.sequence.clips.slice().sort((a, b) => a.track.localeCompare(b.track) || a.start - b.start).map((x) => [x.track, +x.start.toFixed(3), +x.dur.toFixed(3), +(x.inPoint || 0).toFixed(3)]); return { tm: s.trimMode, ph: +s.playhead.toFixed(4), c }; };
    return true;`);

  console.log('A1 Shift+T opens the Trim Monitor on the nearest edit');
  let r = await js(`T.fresh(320, 240); const m = await T.imp('${A('rgb_seconds.mp4')}'); T.place(m, 0, 'V1');
    E.store.set({ playhead: 1 }); E.cmds.run('seq.addEdit'); E.store.set({ playhead: 0.9, selection: [] });
    key('T', { shiftKey: true }); await T.tick(100); const s = TS();
    return { s, view: !!document.querySelector('.trim-view'), bar: !!document.querySelector('.trim-bar'), brackets: document.querySelectorAll('.tl-trim.both').length, menu: E.menus.MENUS.find((x) => x.label === 'Sequence').items.some((i) => i.cmd === 'seq.trimMode') };`);
  ok('Shift+T: Rolling trim on V1 + A1 at the cut, playhead on the edit', r.s.tm && r.s.tm.type === 'roll' && r.s.tm.edits.length === 2 && Math.abs(r.s.ph - 1) < 1e-3, J(r.s));
  ok('Trim Monitor + Trim bar shown, red rolling brackets on both tracks, Sequence > Trim Edit', r.view && r.bar && r.brackets === 2 && r.menu, J(r));
  r = await js(`let px = null; for (let i = 0; i < 60; i++) { await T.tick(100); const [a, b] = [...document.querySelectorAll('.trim-pane canvas')]; if (!a || !b || !a.width) continue;
      const p = (c) => [...c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data].slice(0, 3); px = { a: p(a), b: p(b) }; if (px.a[0] > 180 && px.b[1] > 180) break; } return px;`);
  ok('outgoing frame = last frame of the red second, incoming = first lime frame', r && r.a[0] > 180 && r.a[1] < 80 && r.b[1] > 180 && r.b[0] < 80, J(r));

  console.log('A2 trimming');
  r = await js(`const tm = E.store.getState().trimMode; [...document.querySelectorAll('.trim-bar button')].find((b) => b.textContent === '+5').click(); await T.tick(50); return TS();`);
  ok('Trim +5 (rolling): the cut moves 5 frames on V1 and A1, clip lengths sum stays 3 s, counters +5/+5', r.c.filter((c) => c[0] === 'V1')[0][2] === +(1 + 5 / 30).toFixed(3) && r.c.filter((c) => c[0] === 'A1')[0][2] === +(1 + 5 / 30).toFixed(3) && r.tm.offA === 5 && r.tm.offB === 5 && Math.abs(r.ph - (1 + 5 / 30)) < 1e-3, J(r));
  r = await js(`E.cmds.run('edit.undo'); await T.tick(50); return TS();`);
  ok('undo: one step back, Trim Mode stays and the playhead follows the edit', r.tm && r.c.filter((c) => c[0] === 'V1')[0][2] === 1 && Math.abs(r.ph - 1) < 1e-3, J(r));
  r = await js(`E.trim.setTrimSide('a'); await T.tick(20); const t1 = E.store.getState().trimMode.type; key('ArrowLeft', { ctrlKey: true }); await T.tick(50); return { t1, s: TS() };`);
  const v1 = r.s.c.filter((c) => c[0] === 'V1');
  ok('click the outgoing side → Ripple; Ctrl+Left trims its tail 1 frame and pulls the incoming clip back', r.t1 === 'ripple' && v1[0][2] === +(1 - 1 / 30).toFixed(3) && v1[1][1] === +(1 - 1 / 30).toFixed(3) && v1[1][3] === 1, J(r));
  r = await js(`E.trim.setTrimSide('b'); key('ArrowRight', { ctrlKey: true, shiftKey: true }); await T.tick(50); return TS();`);
  const v2 = r.c.filter((c) => c[0] === 'V1');
  ok('incoming side, Ctrl+Shift+Right: head trimmed by the Large Trim Offset (5), start kept', v2[1][1] === +(1 - 1 / 30).toFixed(3) && v2[1][3] === +(1 + 5 / 30).toFixed(3) && r.tm.offB === 10, J(r)); // counters add up since Trim Mode opened (+5 rolling before)
  r = await js(`const a = E.store.getState().trimMode.type; key('t', { ctrlKey: true }); const b = E.store.getState().trimMode.type; key('t', { ctrlKey: true }); const c = E.store.getState().trimMode.type; key('t', { ctrlKey: true }); return [a, b, c, E.store.getState().trimMode.type];`);
  ok('Ctrl+T cycles Ripple → Rolling → Regular → Ripple (no new text layer)', J(r) === J(['ripple', 'roll', 'regular', 'ripple']), J(r));
  r = await js(`return E.store.getState().sequence.clips.some((c) => c.graphic);`);
  ok('Ctrl+T in Trim Mode does not create a text layer', r === false);
  r = await js(`E.trim.setTrimSide('a'); const n = E.trim.trimBy(1000); return { n, s: TS() };`);
  ok('trim is limited by the media (tail cannot pass the end of the 3 s file)', r.n > 0 && r.s.c.filter((c) => c[0] === 'V1')[0][2] <= 3.001 && r.s.c.filter((c) => c[0] === 'V1')[0][2] >= 2.9, J(r));
  r = await js(`E.cmds.run('edit.undo'); await T.tick(50); E.store.set({ trimMode: { ...E.store.getState().trimMode, type: 'regular', side: 'a' } }); const n = E.trim.trimBy(3); return { n, s: TS() };`);
  ok('regular trim cannot overwrite the next clip', r.n === 0 && r.s.tm, J(r));

  console.log('A2 dynamic trimming (J / K / L) and Space');
  r = await js(`E.store.set({ trimMode: { ...E.store.getState().trimMode, type: 'roll' } }); await T.tick(20); const v0 = TS().c.filter((c) => c[0] === 'V1')[0][2];
    key('l'); const playing = E.store.getState().playing; await T.tick(400); key('k'); await T.tick(50); const s = TS(); return { v0, playing, s, d: +(s.c.filter((c) => c[0] === 'V1')[0][2] - v0).toFixed(3) };`);
  ok('L plays from the edit, K stops and rolls the cut by the distance played (one undo step)', r.playing && r.d > 0.2 && r.d < 0.8 && !r.s.tm.dyn && Math.abs(r.s.ph - (r.v0 + r.d)) < 0.02, J(r));
  r = await js(`key(' '); const a = { playing: E.store.getState().playing, ps: E.store.getState().playStop }; await T.tick(150); key(' '); await T.tick(50); const s = TS(); return { a, s, playing: E.store.getState().playing };`);
  ok('Space loops around the edit (pre-roll / post-roll) and Space again returns to the edit', r.a.playing && r.a.ps && r.a.ps.from != null && r.s.tm && !r.playing && Math.abs(r.s.ph - r.s.c.filter((c) => c[0] === 'V1')[0][2]) < 1e-3, J(r));

  console.log('A2 several edits / leaving Trim Mode');
  r = await js(`const s0 = E.store.getState(); const cs = s0.sequence.clips.filter((c) => c.track === 'V1').sort((a, b) => a.start - b.start); key('Escape'); const off = E.store.getState().trimMode;
    const [el] = [...document.querySelectorAll('.clip')].filter((d) => d.dataset.clip === cs[1].id); const rc = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: rc.right - 2, clientY: rc.top + 5 })); await T.tick(50); const tm1 = E.store.getState().trimMode;
    return { off, tm1 };`);
  ok('Esc leaves; double-click a clip edge (Selection tool) opens a Regular trim on that edit (+ its linked sound)', r.off === null && r.tm1 && r.tm1.type === 'regular' && r.tm1.side === 'a' && r.tm1.edits.length === 2, J(r));
  r = await js(`const s0 = E.store.getState(); const cs = s0.sequence.clips.filter((c) => c.track === 'V1').sort((a, b) => a.start - b.start);
    const [el] = [...document.querySelectorAll('.clip')].filter((d) => d.dataset.clip === cs[0].id); const rc = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ctrlKey: true, clientX: rc.right - 2, clientY: rc.top + 5 })); window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await T.tick(50);
    return E.store.getState().trimMode?.edits.length;`);
  ok('Ctrl+click another edit point adds it', r === 3, J(r));
  r = await js(`E.store.set({ playhead: 0.2 }); await T.tick(50); const a = E.store.getState().trimMode; key('T', { shiftKey: true }); const b = !!E.store.getState().trimMode; key('T', { shiftKey: true }); return { a, b, c: E.store.getState().trimMode };`);
  ok('moving the playhead elsewhere leaves Trim Mode; Shift+T toggles it', r.a === null && r.b && r.c === null, J(r));
  r = await js(`return !!document.querySelector('.trim-view') || !!document.querySelector('.tl-trim');`);
  ok('Trim Monitor and brackets are gone after leaving', r === false);
});
