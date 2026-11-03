// Phase 6 end-to-end test, part A: the confirmed bugs of docs/PROMPT_FIX_ROUND2.md Phase A (Unlink doubling the sound,
// no Save prompt, editing clips on locked tracks, Duplicate, Ctrl+Shift+/, Nest placement, Enable on a mixed selection,
// I / O on the Source Monitor). Run: npm run test:e2e
const { BrowserWindow } = require('electron');
const { suite } = require('./harness.cjs');

suite('phase6a e2e', async ({ js, ok, A }) => {
  const J = (x) => JSON.stringify(x);
  const near = (a, b, e = 0.004) => Math.abs(a - b) <= e;
  const setup = `T.fresh(320, 240); window.M = await T.imp('${A('rgb_seconds.mp4')}'); window.R = await T.imp('${A('ramp_gray.mp4')}');`;
  const clips = `E.store.getState().sequence.clips`;
  const linked = (on) => `E.store.set({ toggles: { ...E.store.getState().toggles, linked: ${on} } });`;

  console.log('A1 Unlink keeps the sound as it was');
  let r = await js(`${setup} T.place(M, 0, 'V1'); await T.tick(50); const before = await T.mix(0, 2.5);
    E.store.set({ selection: ${clips}.map((c) => c.id) }); E.cmds.run('clip.unlink'); await T.tick(50);
    const after = await T.mix(0, 2.5); const v = ${clips}.find((c) => c.track === 'V1');
    return { before, after, noAudio: v.noAudio, links: ${clips}.filter((c) => c.linkId).length };`);
  ok('after Unlink the mix is unchanged (not twice as loud)', near(r.before[0], r.after[0]) && r.before[0] > 0.01, J(r));
  ok('the video clip stays picture-only and nothing is linked', r.noAudio === true && r.links === 0, J(r));
  r = await js(`E.store.edit('old bug', ({ seq }) => { seq.clips.find((c) => c.track === 'V1').noAudio = false; }); await T.tick(30);
    const loud = await T.mix(0, 2.5); const issues = await E.health.runHealthCheck({ loudness: null, audio: false });
    const it = issues.find((i) => i.id === 'doubledAudio'); if (it) it.fix.run(); await T.tick(30);
    return { loud, found: !!it, fixed: await T.mix(0, 2.5), again: (await E.health.runHealthCheck({ loudness: null, audio: false })).some((i) => i.id === 'doubledAudio') };`);
  ok('Health Check finds a project saved with the doubled sound', r.found && r.loud[0] > 0.15, J(r));
  ok('its fix mutes the video clip: the mix is back to normal', near(r.fixed[0], 0.0883, 0.006) && !r.again, J(r));

  console.log('A2 unsaved changes');
  r = await js(`${setup} T.place(M, 0, 'V1'); await T.tick(30); E.cmds.run('file.closeProject'); await T.tick(30);
    const d = E.store.getState().dialog?.type; T.button('Cancel').click(); await T.tick(30);
    const kept = ${clips}.length; E.cmds.run('file.newProject'); await T.tick(30); const d2 = E.store.getState().dialog?.type;
    T.button("Don't Save").click(); await T.tick(50);
    return { d, kept, d2, after: ${clips}.length, dirty: E.store.getState().dirty };`);
  ok('Close Project with unsaved changes asks Save / Don\'t Save / Cancel', r.d === 'unsaved' && r.d2 === 'unsaved', J(r));
  ok('Cancel keeps the project; Don\'t Save then closes it', r.kept === 2 && r.after === 0, J(r));
  r = await js(`E.cmds.run('file.closeProject'); await T.tick(30); return { dialog: E.store.getState().dialog?.type || null };`);
  ok('no unsaved changes: no question', r.dialog === null, J(r));
  // the window's close button (X / Alt+F4 / File > Exit) goes through the same question
  await js(`${setup} T.place(M, 0, 'V1'); await T.tick(30); return 1;`);
  const win = BrowserWindow.getAllWindows()[0]; win.close(); await new Promise((res) => setTimeout(res, 400));
  r = await js(`return { dialog: E.store.getState().dialog?.type || null };`);
  ok('closing the window with unsaved changes asks first and keeps the window', r.dialog === 'unsaved' && !win.isDestroyed(), J(r));
  await js(`T.button('Cancel').click(); await T.tick(30); return 1;`);
  await new Promise((res) => setTimeout(res, 2300)); // the close stays cancelled after the acknowledgement timeout
  ok('Cancel keeps the window open', !win.isDestroyed());

  console.log('A3 locked tracks');
  r = await js(`${setup} T.place(M, 0, 'V1'); await T.tick(30); E.store.edit('lock', ({ seq }) => { seq.tracks.find((t) => t.id === 'V1').locked = true; }); await T.tick(20);
    E.cmds.run('edit.selectAll'); const sel = E.store.getState().selection.map((id) => ${clips}.find((c) => c.id === id).track);
    E.cmds.run('edit.clear'); await T.tick(30); return { sel, left: ${clips}.map((c) => c.track) };`);
  ok('Select All leaves out clips on a locked track', J(r.sel) === J(['A1']), J(r));
  ok('Delete after Select All keeps the clip on the locked track', J(r.left) === J(['V1']), J(r));
  r = await js(`${setup} T.place(M, 0, 'V1'); await T.tick(30); E.store.edit('lock', ({ seq }) => { seq.tracks.find((t) => t.id === 'A1').locked = true; }); await T.tick(20);
    const v = ${clips}.find((c) => c.track === 'V1'); const el = document.querySelector('.clip[data-clip="' + v.id + '"]'); const b = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: b.left + b.width / 2, clientY: b.top + 5 })); window.dispatchEvent(new MouseEvent('mouseup', {})); await T.tick(30);
    const sel = E.store.getState().selection.map((id) => ${clips}.find((c) => c.id === id).track);
    E.cmds.run('edit.clear'); await T.tick(30); return { sel, left: ${clips}.map((c) => c.track) };`);
  ok('clicking a clip whose linked partner is on a locked track selects only the clip', J(r.sel) === J(['V1']), J(r));
  ok('deleting it leaves the locked partner', J(r.left) === J(['A1']), J(r));
  r = await js(`${setup} T.place(M, 0, 'V1'); await T.tick(30); E.store.set({ selection: ${clips}.map((c) => c.id) }); E.cmds.run('track.lock', 'V1'); await T.tick(20);
    return E.store.getState().selection.map((id) => ${clips}.find((c) => c.id === id).track);`);
  ok('locking a track deselects its clips', J(r) === J(['A1']), J(r));

  console.log('A4 / A5 Duplicate');
  r = await js(`${setup} T.place(M, 0, 'V1'); T.place(R, 3, 'V1'); await T.tick(30); ${linked(false)}
    const v = ${clips}.find((c) => c.track === 'V1' && c.start === 0); E.store.set({ selection: [v.id] }); E.cmds.run('edit.duplicate'); await T.tick(30);
    const v1 = ${clips}.filter((c) => c.track === 'V1').sort((a, b) => a.start - b.start).map((c) => [+c.start.toFixed(2), +(c.start + c.dur).toFixed(2)]);
    const copy = ${clips}.find((c) => E.store.getState().selection.includes(c.id));
    return { v1, copyLink: copy.linkId || null, origLink: v.linkId };`);
  ok('Duplicate places the copy right after the clip and overwrites (no overlap)', J(r.v1) === J([[0, 3], [3, 6], [6, 7]]), J(r));
  ok('the copy is not linked to the original\'s partner', r.copyLink !== r.origLink, J(r));
  r = await js(`${setup} T.place(M, 0, 'V1'); await T.tick(30); ${linked(true)}
    E.store.set({ selection: [${clips}.find((c) => c.track === 'V1').id] }); E.cmds.run('edit.duplicate'); await T.tick(30);
    const sel = ${clips}.filter((c) => E.store.getState().selection.includes(c.id));
    return { n: sel.length, tracks: sel.map((c) => c.track).sort(), sameLink: sel[0].linkId && sel[0].linkId === sel[1]?.linkId, start: sel.map((c) => c.start) };`);
  ok('with Linked Selection the V+A pair is duplicated and the copies are linked to each other', r.n === 2 && J(r.tracks) === J(['A1', 'V1']) && r.sameLink && r.start.every((s) => near(s, 3)), J(r));
  r = await js(`${setup} T.place(M, 0, 'V1'); await T.tick(30); E.store.set({ selection: ${clips}.map((c) => c.id) }); const n0 = ${clips}.length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', code: 'Slash', ctrlKey: true, shiftKey: true, bubbles: true })); await T.tick(30);
    return { n0, n1: ${clips}.length };`);
  ok('Ctrl+Shift+/ runs Duplicate', r.n1 === r.n0 * 2, J(r));

  console.log('A6 Nest');
  r = await js(`${setup} T.place(M, 0, 'V1'); await T.tick(30); ${linked(false)}
    E.store.set({ selection: [${clips}.find((c) => c.track === 'A1').id] }); E.cmds.run('clip.nest'); await T.tick(30);
    const d = E.store.getState().dialog; document.querySelector('.modal input').value; T.button('OK').click(); await T.tick(50);
    return { dialog: d?.type, name: d?.props?.name, clips: ${clips}.map((c) => ({ t: c.track, nest: !!c.nestId, s: c.start })) };`);
  ok('Nest asks for the nested sequence name', r.dialog === 'nestName' && /Nested Sequence/.test(r.name), J(r));
  ok('a sound-only nest goes on the audio track; the video clip on V1 is untouched', J(r.clips.filter((c) => c.t === 'V1')) === J([{ t: 'V1', nest: false, s: 0 }]) && r.clips.some((c) => c.t === 'A1' && c.nest), J(r));
  r = await js(`${setup} T.place(M, 0, 'V1'); await T.tick(30); ${linked(true)} const before = await T.mix(0, 2.5);
    E.store.set({ selection: ${clips}.map((c) => c.id) }); E.cmds.seqFromSelection(true, 'My Nest'); await T.tick(50);
    const cs = ${clips}; const v = cs.find((c) => c.track === 'V1'), a = cs.find((c) => c.track === 'A1');
    return { before, after: await T.mix(0, 2.5), v: { nest: !!v?.nestId, noAudio: v?.noAudio }, a: { nest: !!a?.nestId, asAudio: a?.asAudio }, linked: !!v?.linkId && v.linkId === a?.linkId, n: cs.length, name: v?.name,
      sel: E.store.getState().selection.length };`);
  ok('Nest of picture + sound: a nested clip on V1 and a linked nested clip on A1', r.v.nest && r.a.nest && r.linked && r.n === 2 && r.name === 'My Nest' && r.sel === 2, J(r));
  ok('the nested sound plays once (mix unchanged)', near(r.before[0], r.after[0]), J(r));
  r = await js(`E.store.edit('mute', ({ seq }) => { seq.tracks.find((t) => t.id === 'A1').muted = true; }); await T.tick(20); const m = await T.mix(0, 2.5);
    E.store.edit('unmute', ({ seq }) => { seq.tracks.find((t) => t.id === 'A1').muted = false; }); return m;`);
  ok('muting the audio track of the nest mutes the nested sound', r[0] < 1e-4, J(r));
  r = await js(`const a = ${clips}.find((c) => c.track === 'A1'); E.store.edit('vol', ({ seq }) => { seq.clips.find((c) => c.id === a.id).volume = { bypass: { v: false, keys: null }, level: { v: -6.0206, keys: null } }; }); await T.tick(20);
    return await T.mix(0, 2.5);`);
  ok('the Volume of the nested audio clip applies to the sound inside (-6 dB = half)', near(r[0], 0.0883 / 2, 0.004), J(r));
  r = await js(`E.store.set({ selection: ${clips}.map((c) => c.id) }); E.store.edit('speed', ({ seq, sel }) => E.editing.setSpeed(seq, sel, { speed: 200 })); await T.tick(30);
    const fl = E.flatten.flatten(E.store.getState()).sequence; const inner = fl.clips.filter((c) => c.id.includes('/'));
    return { outer: ${clips}.map((c) => +c.dur.toFixed(3)), inner: inner.map((c) => ({ t: c.track.split('/').pop(), dur: +c.dur.toFixed(3), sp: c.speed })) };`);
  ok('a nested clip at 200 % plays its inside twice as fast (Preview / Export audio follow the picture)', r.outer.every((d) => near(d, 1.5)) && r.inner.length === 2 && r.inner.every((c) => near(c.dur, 1.5) && c.sp === 2), J(r));

  console.log('A7 Enable');
  r = await js(`${setup} T.place(M, 0, 'V1'); T.place(R, 4, 'V2'); await T.tick(30); E.store.edit('x', ({ seq }) => { seq.clips[0].enabled = false; });
    E.store.set({ selection: ${clips}.map((c) => c.id) }); E.cmds.run('clip.enable'); await T.tick(20); const a = ${clips}.map((c) => c.enabled);
    E.cmds.run('clip.enable'); await T.tick(20); return { a, b: ${clips}.map((c) => c.enabled) };`);
  ok('Enable on a mixed selection disables them all, then enables them all', r.a.every((x) => x === false) && r.b.every((x) => x === true), J(r));

  console.log('A8 I / O on the active monitor');
  r = await js(`${setup} T.place(M, 0, 'V1'); await T.tick(30); E.store.set({ selectedMedia: M.id, sourceTime: 1, playhead: 2, inPoint: null, outPoint: null, sourceIn: null, sourceOut: null });
    const mon = [...document.querySelectorAll('.monitor')].find((m) => m.querySelector('.transport') && /Insert/.test(m.textContent));
    if (mon) mon.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); else E.store.set({ activeMonitor: 'source' }); await T.tick(20);
    const am = E.store.getState().activeMonitor;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', code: 'KeyI', bubbles: true })); E.store.set({ sourceTime: 2.5 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', bubbles: true })); await T.tick(20);
    const s1 = E.store.getState(); const src = { am, sourceIn: s1.sourceIn, sourceOut: s1.sourceOut, inPoint: s1.inPoint };
    document.querySelector('.timeline').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await T.tick(20);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', code: 'KeyI', bubbles: true })); await T.tick(20);
    const s2 = E.store.getState(); return { src, prog: { am: s2.activeMonitor, inPoint: s2.inPoint, sourceIn: s2.sourceIn } };`);
  ok('with the Source Monitor active, I / O set the source In / Out (not the sequence)', r.src.am === 'source' && r.src.sourceIn === 1 && r.src.sourceOut === 2.5 && r.src.inPoint == null, J(r));
  ok('after clicking the timeline, I sets the sequence In', r.prog.am === 'program' && r.prog.inPoint === 2 && r.prog.sourceIn === 1, J(r));
});
