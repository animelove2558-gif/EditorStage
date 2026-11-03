// Phase 6 end-to-end test, part B: Link / Unlink, the timeline right-click menus, double-click, and dragging linked clips
// (only the grabbed kind changes track, time stays in sync; Alt+click picks one part). docs/PROMPT_FIX_ROUND2.md Phase B.
// Run: npm run test:e2e
const { suite } = require('./harness.cjs');

suite('phase6b e2e', async ({ js, ok, A }) => {
  const J = (x) => JSON.stringify(x);
  const near = (a, b, e = 0.004) => Math.abs(a - b) <= e;
  const clips = `E.store.getState().sequence.clips`;
  const setup = `T.fresh(320, 240); E.store.set({ pps: 100, toggles: { snap: false, linked: true } }); window.M = await T.imp('${A('rgb_seconds.mp4')}'); window.R = await T.imp('${A('ramp_gray.mp4')}');
    window.IDS = T.place(M, 0, 'V1'); await T.tick(150);`;
  // a real mouse drag of a clip to a track (dx px; mods for Alt / Ctrl); returns where every clip ended up and the undo steps
  const drag = (id, dx, toTrack, mods = {}) => js(`
    const el = document.querySelector('.clip[data-clip="' + ${id} + '"]'); const r = el.getBoundingClientRect(); const tr = document.querySelector('.tl-track[data-track="${toTrack}"]').getBoundingClientRect();
    const x0 = r.left + Math.min(40, r.width / 2), y0 = r.top + r.height / 2, o = ${J(mods)}; const h0 = E.store.getState().history.length;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x0, clientY: y0, ...o }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: x0 + ${dx} / 2, clientY: (y0 + tr.top + tr.height / 2) / 2, ...o }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: x0 + ${dx}, clientY: tr.top + tr.height / 2, ...o })); await T.tick(30);
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: x0 + ${dx}, clientY: tr.top + tr.height / 2, ...o })); await T.tick(80);
    const s = E.store.getState(); return { steps: s.history.length - h0, sel: s.selection, clips: s.sequence.clips.map((c) => ({ id: c.id, track: c.track, start: +c.start.toFixed(3) })) };`);
  const at = (d, id) => d.clips.find((c) => c.id === id);
  const click = (id, mods = {}) => js(`const el = document.querySelector('.clip[data-clip="' + ${id} + '"]'); const r = el.getBoundingClientRect(); const o = ${J(mods)};
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: r.left + 20, clientY: r.top + 5, ...o }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + 21, clientY: r.top + 5, ...o })); window.dispatchEvent(new MouseEvent('mouseup', { clientX: r.left + 21, clientY: r.top + 5, ...o })); await T.tick(40);
    return E.store.getState().selection;`);

  console.log('B6 drag linked clips: only the grabbed kind changes track');
  await js(`${setup} return 1;`);
  const [V, Au] = await js(`return IDS;`);
  let d = await drag('IDS[0]', 100, 'V2');
  ok('(a) picture dragged V1 → V2 +1 s: picture V2 @ 1 s, its sound A1 @ 1 s (in sync, same track)', at(d, V).track === 'V2' && at(d, V).start === 1 && at(d, Au).track === 'A1' && at(d, Au).start === 1, J(d));
  ok('(e) one undo step brings both back', d.steps === 1 && await js(`E.cmds.run('edit.undo'); await T.tick(50); return ${clips}.map((c) => c.track + '@' + c.start).join();`) === 'V1@0,A1@0');
  await js(`E.store.edit('add A2', ({ seq }) => { E.cmds.addTrackTo(seq, 'audio'); }); await T.tick(50); return 1;`);
  d = await drag('IDS[1]', 0, 'A2');
  ok('(b) sound dragged A1 → A2: picture stays on V1', at(d, Au).track === 'A2' && at(d, V).track === 'V1', J(d));
  await js(`E.cmds.run('edit.undo'); await T.tick(50); E.store.set({ selection: [] }); return 1;`);
  let sel = await click('IDS[0]', { altKey: true });
  ok('Alt+click selects only the picture (not its linked sound)', J(sel) === J([V]), J(sel));
  d = await drag('IDS[0]', 100, 'V1');
  ok('(c) dragging that picture: the sound does not move at all', at(d, V).start === 1 && at(d, Au).start === 0 && at(d, Au).track === 'A1', J(d));
  let badge = await js(`await T.tick(50); return [...document.querySelectorAll('.clip .syncbadge')].map((b) => b.textContent);`);
  ok('out of sync: both parts show the red frame offset (+30 / -30)', J(badge.sort()) === J(['+30', '-30'].sort()), J(badge));
  sel = await click('IDS[1]', { altKey: true, shiftKey: true });
  ok('Shift+Alt+click adds the other part', sel.length === 2, J(sel));
  await js(`E.cmds.run('edit.undo'); await T.tick(50); E.store.set({ selection: [] }); return 1;`);
  d = await drag('IDS[0]', 300, 'V1', { altKey: true });
  const copies = d.clips.filter((c) => c.id !== V && c.id !== Au);
  ok('(d) Alt+drag still duplicates (picture and sound copied 3 s later, originals stay)', copies.length === 2 && copies.every((c) => c.start === 3) && at(d, V).start === 0, J(d));
  await js(`E.cmds.run('edit.undo'); await T.tick(50); E.store.set({ selection: IDS }); return 1;`);
  let k = await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', altKey: true, bubbles: true })); await T.tick(40); return ${clips}.map((c) => c.track);`);
  ok('Alt+↑ with picture + sound selected: only the picture changes track', J(k) === J(['V2', 'A1']), J(k));
  await js(`E.cmds.run('edit.undo'); await T.tick(30); return 1;`);

  console.log('B1 Link / Unlink (Ctrl+L toggles)');
  let r = await js(`E.store.set({ selection: IDS }); const m0 = await T.mix(0, 2.5); const lab0 = E.menus.MENUS.find((m) => m.label === 'Clip').items.find((i) => i.cmd === 'clip.linkToggle').label();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', ctrlKey: true, bubbles: true })); await T.tick(30);
    const un = ${clips}.map((c) => c.linkId || null); const lab1 = E.menus.MENUS.find((m) => m.label === 'Clip').items.find((i) => i.cmd === 'clip.linkToggle').label();
    E.store.edit('move', ({ seq }) => { seq.clips.find((c) => c.track === 'A1').start = 0.5; }); E.store.set({ selection: IDS });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', ctrlKey: true, bubbles: true })); await T.tick(30);
    const cs = ${clips}; return { lab0, lab1, un, linked: !!cs[0].linkId && cs[0].linkId === cs[1].linkId, starts: cs.map((c) => c.start), noAudio: cs.find((c) => c.track === 'V1').noAudio, m0, m1: await T.mix(1, 2.5),
      badge: [...document.querySelectorAll('.clip .syncbadge')].map((b) => b.textContent) };`);
  ok('Clip menu reads Unlink for a linked selection, Link after Ctrl+L unlinked it', r.lab0 === 'Unlink' && r.lab1 === 'Link' && r.un.every((x) => x === null), J(r));
  ok('Ctrl+L on unlinked V+A links them where they are (nothing moves)', r.linked && J(r.starts) === J([0, 0.5]), J(r));
  ok('the picture clip stays silent (its sound plays once)', r.noAudio === true && near(r.m1[0], r.m0[0], 0.01), J(r));
  ok('linked but 15 frames apart: the red badge shows it', r.badge.includes('+15') || r.badge.includes('-15'), J(r.badge));
  r = await js(`return { merge: JSON.stringify(E.menus.MENUS).includes('Merge Clips'), cmd: !!E.cmds.commands['clip.mergeClips'] };`);
  ok('Merge Clips (which only linked) is gone from the menu and the commands', !r.merge && !r.cmd, J(r));

  console.log('B3 clip right-click menu');
  r = await js(`${setup} const el = document.querySelector('.clip[data-clip="' + IDS[0] + '"]'); const b = el.getBoundingClientRect();
    E.store.set({ selection: [] }); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: b.left + 10, clientY: b.top + 5 })); await T.tick(40);
    const items = [...document.querySelectorAll('.menu-dropdown.ctx > .menu-item > span:first-child')].map((s) => s.textContent.replace(/^[✓\\s]+/, '').trim());
    return { items, sel: E.store.getState().selection.length };`);
  const want = ['Cut', 'Copy', 'Paste Attributes...', 'Remove Attributes...', 'Clear', 'Ripple Delete', 'Edit in AudioStage', 'Edit Original', 'Replace With Clip', 'Enable', 'Unlink', 'Group', 'Ungroup', 'Synchronize...',
    'Nest...', 'Make Subsequence', 'Multi-Camera', 'Label', 'Speed/Duration...', 'Scene Edit Detection...', 'Audio Gain...', 'Audio Channels...', 'Frame Hold Options...', 'Add Frame Hold', 'Insert Frame Hold Segment',
    'Field Options...', 'Time Interpolation', 'Scale to Frame Size', 'Set to Frame Size', 'Rename...', 'Make Subclip...', 'Reveal in Project', 'Reveal in Explorer', 'Properties...'];
  const missing = want.filter((w) => !r.items.includes(w));
  ok('the clip menu has the Premiere items in order (Cut … Properties)', !missing.length && want.every((w, i) => i === 0 || r.items.indexOf(w) > r.items.indexOf(want[i - 1])), J({ missing, items: r.items }));
  ok('right-clicking an unselected clip selects it with its linked part', r.sel === 2, J(r));
  r = await js(`const it = [...document.querySelectorAll('.menu-dropdown.ctx .menu-dropdown.sub .menu-item')].find((x) => x.textContent.trim() === 'Cerulean'); it.click(); await T.tick(30);
    return ${clips}.map((c) => c.color);`);
  ok('Label > Cerulean colours both selected clips', r.every((c) => c === '#1ba6d6'), J(r));
  r = await js(`E.store.set({ selection: [IDS[0]] }); E.cmds.run('clip.scaleToFrame'); await T.tick(30); const off = ${clips}[0].scaleToFrame;
    E.cmds.run('clip.setToFrame'); await T.tick(30); const sc = ${clips}[0].motion.scale.v; E.cmds.run('clip.scaleToFrame'); await T.tick(30);
    return { off, sc, back: ${clips}[0].scaleToFrame, w: M.width, h: M.height };`);
  ok('Scale to Frame Size toggles off / on; Set to Frame Size fits a native-size clip with Motion Scale', r.off === false && r.back === undefined && near(r.sc, +(100 * Math.min(320 / r.w, 240 / r.h)).toFixed(2), 0.02), J(r));
  r = await js(`E.cmds.run('clip.timeInterpolation', 'blend'); await T.tick(20); const a = ${clips}[0].frameSampling; E.cmds.run('clip.timeInterpolation', 'sample'); return [a, ${clips}[0].frameSampling ?? null];`);
  ok('Time Interpolation sets Frame Blending / Frame Sampling', J(r) === J(['blend', null]), J(r));
  r = await js(`E.cmds.run('clip.properties'); const m = await T.modal(); await T.tick(400); const t = m.textContent; T.button('Close').click(); await T.tick(20);
    return { path: t.includes('rgb_seconds.mp4'), size: /\\d+ x \\d+/.test(t), audio: /Audio/.test(t) };`);
  ok('Properties shows the file path, frame size and audio', r.path && r.size && r.audio, J(r));
  r = await js(`E.store.set({ selection: [IDS[0]], selectedMedia: R.id, sourceIn: 1 }); E.cmds.run('clip.replaceFromSource'); await T.tick(40); const c = ${clips}.find((x) => x.id === IDS[0]);
    return { media: c.mediaId === R.id, inPoint: c.inPoint, dur: c.dur };`);
  ok('Replace With Clip > From Source Monitor swaps the media from its In point, keeping the length', r.media && r.inPoint === 1 && near(r.dur, 3), J(r));
  r = await js(`E.store.set({ selection: [IDS[0]], selectedMedia: null }); E.cmds.run('clip.revealInProject'); await T.tick(30); return E.store.getState().selectedMedia === R.id;`);
  ok('Reveal in Project selects the clip\'s project item', r === true);

  console.log('B4 gap / transition / empty-area menus');
  r = await js(`${setup} T.place(R, 5, 'V1'); await T.tick(80);
    const tr = document.querySelector('.tl-track[data-track="V1"]').getBoundingClientRect(); const x = tr.left + 4 * E.store.getState().pps - (document.querySelector('.tl-scroll, .tl-body')?.scrollLeft || 0);
    document.querySelector('.tl-track[data-track="V1"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: x, clientY: tr.top + 5 })); await T.tick(40);
    const gap = E.store.getState().selectedGap; const shown = !!document.querySelector('.tl-gap'); const items = [...document.querySelectorAll('.menu-dropdown.ctx .menu-item')].map((i) => i.textContent);
    [...document.querySelectorAll('.menu-dropdown.ctx .menu-item')].find((i) => /Ripple Delete/.test(i.textContent))?.click(); await T.tick(40);
    return { gap, shown, items, v1: ${clips}.filter((c) => c.track === 'V1').map((c) => c.start) };`);
  ok('right-click in the gap between clips selects it (highlighted) and offers Ripple Delete', r.gap && near(r.gap.a, 3) && near(r.gap.b, 5) && r.shown && r.items.some((t) => /Ripple Delete/.test(t)), J(r));
  ok('Ripple Delete closes the gap', J(r.v1) === J([0, 3]), J(r));
  r = await js(`E.cmds.run('edit.undo'); await T.tick(30); E.store.set({ selection: [], selectedGap: E.editing.gapAt(E.store.getState().sequence, 'V1', 4) });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true })); await T.tick(30); return ${clips}.filter((c) => c.track === 'V1').map((c) => c.start);`);
  ok('a selected gap closes with the Delete key', J(r) === J([0, 3]), J(r));
  r = await js(`${setup} T.place(R, 3, 'V1'); await T.tick(50); const s = E.store.getState().sequence; const a = s.clips.find((c) => c.track === 'V1' && c.start === 0), b = s.clips.find((c) => c.track === 'V1' && c.start === 3);
    E.store.edit('tr', ({ seq }) => { seq.transitions.push({ id: 'tx', name: 'Cross Dissolve', aId: a.id, bId: b.id, track: 'V1', at: 3, dur: 1 }); }); await T.tick(60);
    const el = document.querySelector('.tl-trans'); const bx = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: bx.left + 2, clientY: bx.top + 2 })); await T.tick(30);
    const items = [...document.querySelectorAll('.menu-dropdown.ctx .menu-item')].map((i) => i.textContent);
    [...document.querySelectorAll('.menu-dropdown.ctx .menu-item')].find((i) => /Set Transition Duration/.test(i.textContent)).click(); const m = await T.modal();
    const inp = m.querySelector('input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(inp, '15'); inp.dispatchEvent(new Event('input', { bubbles: true })); await T.tick(20);
    T.button('OK').click(); await T.tick(30); const dur = E.store.getState().sequence.transitions[0].dur;
    E.cmds.run('transition.clear', 'tx'); await T.tick(20); return { items, dur, left: E.store.getState().sequence.transitions.length };`);
  ok('transition right-click: Set Transition Duration… (15 frames = 0.5 s) and Clear', r.items.some((t) => /Set Transition Duration/.test(t)) && r.items.some((t) => /^Clear/.test(t)) && near(r.dur, 0.5) && r.left === 0, J(r));
  r = await js(`E.store.set({ selection: [], selectedGap: null }); document.querySelector('.tl-scroll').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 })); await T.tick(30);
    return [...document.querySelectorAll('.menu-dropdown.ctx .menu-item')].map((i) => i.textContent).slice(0, 2);`);
  ok('empty-area menu starts with Paste and Paste Insert', /^Paste/.test(r[0] || '') && /^Paste Insert/.test(r[1] || ''), J(r));

  console.log('B5 double-click');
  r = await js(`${setup} E.store.set({ playhead: 1.5, selectedMedia: null, activeMonitor: 'program' }); const el = document.querySelector('.clip[data-clip="' + IDS[0] + '"]');
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await T.tick(40); const s = E.store.getState();
    return { media: s.selectedMedia === M.id, t: s.sourceTime, mon: s.activeMonitor };`);
  ok('double-clicking a clip opens it in the Source Monitor at the same frame', r.media && near(r.t, 1.5, 0.04) && r.mon === 'source', J(r));
});
