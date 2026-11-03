// Phase 6 end-to-end test, part D (final pass, docs/PROMPT_FIX_ROUND2.md Phase D):
//   D1 every menu / right-click item whose label ends in "..." opens a dialog (ours, a native file dialog or its panel)
//   D2 the commands that change clips leave locked tracks alone, follow Linked Selection, and are one undo step each
//   D3 shortcuts work with the Thai keyboard layout (keydown with a Thai `key` and the physical `code`)
// Run: npm run test:e2e
const { suite } = require('./harness.cjs');

suite('phase6d e2e', async ({ js, ok, A, dialogCalls }) => {
  const J = (x) => JSON.stringify(x);
  const setup = `T.fresh(320, 240); E.store.set({ pps: 100, toggles: { snap: false, linked: true }, selection: [], activeMonitor: 'program' });
    window.M = await T.imp('${A('rgb_seconds.mp4')}'); window.R = await T.imp('${A('ramp_gray.mp4')}'); await T.tick(100);`;

  console.log('D1 menus with "..." open a dialog');
  const items = await js(`${setup}
    const out = []; const walk = (list, where) => { for (const it of list || []) { if (!it || it === '-') continue; if (it.children) walk(it.children, where + ' > ' + it.label); else if (/(\\.\\.\\.|…)$/.test(it.label || '') && it.cmd) out.push({ where: where + ' > ' + it.label, cmd: it.cmd, arg: it.arg }); } };
    for (const menu of E.menus.MENUS) walk(menu.items || menu.children, menu.label);
    walk(E.menus.clipContextMenu('video').top || E.menus.clipContextMenu('video'), 'Clip (right-click)');
    const seen = new Set(); return out.filter((x) => !seen.has(x.cmd) && seen.add(x.cmd));`);
  ok('found the "..." menu items', items.length >= 60, String(items.length));
  const silent = [];
  for (const it of items) {
    // a clip on V1 (with its linked audio) selected, a copied clip, a marker under the playhead and a media item selected
    await js(`${setup} E.store.set({ playhead: 1, selection: [] }); E.cmds.run('marker.add'); const ids = [...T.place(M, 0, 'V1'), ...T.place(R, 0, 'V2')]; E.store.set({ selection: ids, selectedMedia: M.id }); E.cmds.run('edit.copy'); await T.tick(20);
      const tabs = () => [...document.querySelectorAll('.flexlayout__tab_button--selected, .flexlayout__border_button--selected')].map((x) => x.textContent).sort().join('|'); window.__tabs = tabs; window.__d = { panels: tabs(), n: 0 }; window.confirm = () => { __d.n++; return false; }; window.alert = () => { __d.n++; }; window.prompt = () => { __d.n++; return null; };
      E.store.set({ dialog: null, smartTab: null, createTab: null }); return true;`);
    const before = dialogCalls();
    const r = await js(`try { await E.cmds.run(${J(it.cmd)}${it.arg !== undefined ? ', ' + J(it.arg) : ''}); } catch (e) { return { err: e.message }; } await T.tick(200);
      const s = E.store.getState(); const r = { dialog: s.dialog?.type || null, js: __d.n, panel: __tabs() !== __d.panels || !!s.smartTab || !!s.createTab }; E.store.set({ dialog: null }); return r;`);
    const native = dialogCalls() - before;
    if (!(r.dialog || r.js || native || r.panel)) silent.push(`${it.where} (${it.cmd})${r.err ? ': ' + r.err : ''}`);
  }
  ok(`every "..." item opens a dialog, a file dialog or its panel (${items.length} items)`, silent.length === 0, '\n    ' + silent.join('\n    '));

  console.log('D2 locked tracks, Linked Selection, one undo step');
  const CMDS = ['edit.clear', 'edit.rippleDelete', 'edit.cut', 'edit.duplicate', 'clip.enable', 'clip.unlink', 'clip.link', 'clip.group', 'clip.ungroup', 'clip.nudgeLeft', 'clip.nudgeRight', 'clip.nudgeUp', 'clip.nudgeDown',
    'clip.scaleToFrame', 'clip.addFrameHold', 'clip.removeEffects', 'seq.addEdit', 'seq.addEditAll', 'seq.rippleTrimPrev', 'seq.rippleTrimNext', 'seq.trimPrev', 'seq.trimNext', 'seq.extendEdit', 'seq.lift', 'seq.extract', 'seq.videoTransition', 'seq.audioTransition', 'seq.defaultTransitions'];
  const lockBad = [], undoBad = [];
  for (const cmd of CMDS) {
    const r = await js(`${setup} const a = T.place(R, 0, 'V1'), b = T.place(R, 0, 'V2'), c = T.place(M, 4, 'V1');
      E.store.edit('lock', ({ seq }) => { seq.tracks.find((t) => t.id === 'V2').locked = true; }); E.store.set({ playhead: 1.5, inPoint: 0.5, outPoint: 2.5 }); E.cmds.run('edit.selectAll'); await T.tick(20);
      E.store.set({ selection: E.store.getState().sequence.clips.map((x) => x.id) }); const lockedNow = () => JSON.stringify(E.store.getState().sequence.clips.filter((x) => x.track === 'V2'));
      const before = lockedNow(), h0 = E.store.getState().historyIndex; await E.cmds.run(${J(cmd)}); await T.tick(60); E.store.set({ dialog: null });
      return { locked: lockedNow() === before, steps: E.store.getState().historyIndex - h0 };`);
    if (!r.locked) lockBad.push(cmd);
    if (r.steps > 1) undoBad.push(`${cmd} (${r.steps})`);
  }
  ok('clip commands leave clips on a locked track alone, even when they are selected', lockBad.length === 0, J(lockBad));
  ok('each command is at most one undo step', undoBad.length === 0, J(undoBad));

  let r = await js(`${setup} const ids = T.place(M, 0, 'V1'); const v = ids.find((id) => T.clip(id).track.startsWith('V')), a = ids.find((id) => T.clip(id).track.startsWith('A'));
    const res = {}; for (const linked of [true, false]) { E.store.set({ toggles: { ...E.store.getState().toggles, linked }, selection: [v] }); await T.tick(10);
      const h0 = E.store.getState().historyIndex; E.cmds.run('clip.nudgeRight'); await T.tick(20); const s = E.store.getState().sequence.clips; res[linked] = { vMoved: s.find((c) => c.id === v).start > 0, aMoved: s.find((c) => c.id === a).start > 0, steps: E.store.getState().historyIndex - h0 }; E.cmds.run('edit.undo'); await T.tick(20); }
    E.store.set({ toggles: { ...E.store.getState().toggles, linked: true }, selection: [v] }); E.cmds.run('edit.clear'); await T.tick(20); const afterLinkedClear = E.store.getState().sequence.clips.length; E.cmds.run('edit.undo'); await T.tick(20);
    E.store.set({ toggles: { ...E.store.getState().toggles, linked: false }, selection: [v] }); E.cmds.run('edit.clear'); await T.tick(20); const afterUnlinkedClear = E.store.getState().sequence.clips.length;
    return { res, afterLinkedClear, afterUnlinkedClear };`);
  ok('Linked Selection on: nudging the video moves its audio too (one step); off: only the video', r.res.true.vMoved && r.res.true.aMoved && r.res.true.steps === 1 && r.res.false.vMoved && !r.res.false.aMoved, J(r.res));
  ok('Linked Selection on: Clear removes video + audio; off: only the video', r.afterLinkedClear === 0 && r.afterUnlinkedClear === 1, J(r));

  console.log('D3 shortcuts on the Thai keyboard layout');
  // Thai Kedmanee characters on the keys the default shortcuts use (key = what Windows reports with the Thai layout active)
  r = await js(`${setup} const ids = T.place(R, 0, 'V1'); await T.tick(30); const s0 = () => E.store.getState();
    const press = (key, code, mods = {}) => { const ev = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...mods }); document.body.dispatchEvent(ev); window.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true, ...mods })); };
    const res = {};
    E.store.set({ playhead: 1, selection: [] }); press('ื', 'KeyI'); await T.tick(20); res.markIn = s0().inPoint;
    press('ท', 'KeyO'); await T.tick(20); res.markOut = s0().outPoint;
    E.store.set({ playhead: 2 }); press('ะ', 'KeyM'); await T.tick(20); res.markers = s0().sequence.markers.length;
    const n0 = s0().sequence.clips.length; press('ฟ', 'KeyA', { ctrlKey: true }); await T.tick(20); res.selAll = s0().selection.length;
    E.store.set({ selection: [], playhead: 1.5 }); press('ษ', 'KeyK', { ctrlKey: true }); await T.tick(30); res.razor = s0().sequence.clips.length - n0;
    press('ผ', 'KeyZ', { ctrlKey: true }); await T.tick(30); res.undo = s0().sequence.clips.length - n0;
    return res;`);
  ok('Thai keys: I / O mark in / out, M adds a marker', Math.abs(r.markIn - 1) < 1e-6 && Math.abs(r.markOut - 1) < 0.05 && r.markers === 1, J(r));
  ok('Thai keys with Ctrl: Ctrl+A selects all, Ctrl+K razors, Ctrl+Z undoes', r.selAll >= 1 && r.razor === 1 && r.undo === 0, J(r));
});
