// Phase 6 end-to-end test, part C: markers, trim-to-playhead keys, keyboard shortcut editor, Paste / Remove Attributes,
// the audio mixer (pan / master), Sequence Settings + New Sequence, Preferences, the Project panel and the History panel.
// docs/PROMPT_FIX_ROUND2.md Phase C. Run: npm run test:e2e
const { suite } = require('./harness.cjs');

suite('phase6c e2e', async ({ js, ok, A }) => {
  const J = (x) => JSON.stringify(x);
  const near = (a, b, e = 0.004) => Math.abs(a - b) <= e;
  const setup = `T.fresh(320, 240); E.store.set({ pps: 100, toggles: { snap: false, linked: true }, selection: [], activeMonitor: 'program' });
    window.M = await T.imp('${A('rgb_seconds.mp4')}'); window.R = await T.imp('${A('ramp_gray.mp4')}'); await T.tick(100);`;

  console.log('C1 markers');
  let r = await js(`${setup} E.store.set({ playhead: 1 }); E.cmds.run('marker.add'); await T.tick(30); const s = E.store.getState();
    const m = s.sequence.markers[0]; E.cmds.run('marker.add'); await T.tick(30); const dlg = E.store.getState().dialog?.type; E.store.set({ dialog: null });
    return { n: s.sequence.markers.length, t: m?.time, sel: s.selectedMarker === m?.id, dlg };`);
  ok('M adds a sequence marker at the playhead (selected)', r.n === 1 && near(r.t, 1) && r.sel, J(r));
  ok('M on an existing marker opens the Marker dialog', r.dlg === 'marker', J(r));
  r = await js(`const s = E.store.getState(); const id = s.sequence.markers[0].id; E.cmds.updateMarker('seq', null, id, { name: 'Intro', color: E.markers.MARKER_COLORS[2][1], type: 'chapter', dur: 0.5 });
    await T.tick(20); const m = E.store.getState().sequence.markers[0]; return { name: m.name, type: m.type, dur: m.dur, ruler: document.querySelectorAll('.ruler-marker, .marker').length };`);
  ok('marker edits keep name / type / duration', r.name === 'Intro' && r.type === 'chapter' && r.dur === 0.5, J(r));
  r = await js(`const ids = T.place(R, 0, 'V1'); E.store.set({ selection: [ids[0]], playhead: 2 }); E.cmds.run('marker.add'); await T.tick(30);
    const c = E.store.getState().sequence.clips.find((x) => x.id === ids[0]); await T.tick(60); return { cm: (c.markers || []).length, t: c.markers?.[0]?.time, drawn: document.querySelectorAll('.clip-marker').length, seqN: E.store.getState().sequence.markers.length };`);
  ok('M with a clip selected under the playhead adds a clip marker (source time), drawn on the clip', r.cm === 1 && near(r.t, 2, 0.04) && r.drawn >= 1 && r.seqN === 1, J(r));
  r = await js(`E.store.set({ selection: [], playhead: 1 }); E.cmds.run('marker.clearSelected'); await T.tick(20); return E.store.getState().sequence.markers.length;`);
  ok('Clear Selected Marker (Ctrl+Alt+M) removes it', r === 0, J(r));

  console.log('C2 trim / extend to the playhead');
  r = await js(`${setup} const ids = T.place(R, 0, 'V1'); const id = ids[0]; const get = () => E.store.getState().sequence.clips.find((c) => c.id === id);
    E.store.set({ playhead: 1, selection: [] }); E.cmds.run('seq.rippleTrimPrev'); await T.tick(20); const a = { start: get().start, dur: get().dur, inP: get().inPoint };
    E.store.set({ playhead: 2 }); E.cmds.run('seq.trimNext'); await T.tick(20); const b = { start: get().start, dur: get().dur };
    E.store.set({ playhead: 2.5, selection: [id] }); E.cmds.run('seq.extendEdit'); await T.tick(20); const c = { dur: get().dur };
    E.store.set({ selection: [], playhead: 1 }); E.cmds.run('seq.selectAtPlayhead'); await T.tick(20); return { a, b, c, sel: E.store.getState().selection };`);
  ok('Q ripple-trims the head to the playhead (the clip slides to 0)', near(r.a.start, 0) && near(r.a.dur, 3) && near(r.a.inP, 1), J(r));
  ok('Alt+W trims the tail to the playhead without rippling', near(r.b.start, 0) && near(r.b.dur, 2), J(r));
  ok('E extends the selected edit to the playhead', near(r.c.dur, 2.5), J(r));
  ok('D selects the clip at the playhead', r.sel.length >= 1, J(r));
  r = await js(`return { q: E.shortcuts.combos['q'], w: E.shortcuts.combos['w'], e: E.shortcuts.combos['e'], d: E.shortcuts.combos['d'], aq: E.shortcuts.combos['alt+q'], k1: E.shortcuts.combos['1'], sk: E.shortcuts.combos['shift+k'] };`);
  ok('keys Q / W / Alt+Q / E / D / 1 / Shift+K are bound', r.q === 'seq.rippleTrimPrev' && r.w === 'seq.rippleTrimNext' && r.aq === 'seq.trimPrev' && r.e === 'seq.extendEdit' && r.d === 'seq.selectAtPlayhead' && r.k1 === 'clip.multicam1' && r.sk === 'play.around', J(r));

  console.log('C3 keyboard shortcuts');
  r = await js(`await E.shortcuts.bindKey('ctrl+alt+shift+f9', 'marker.add'); const a = E.shortcuts.combosFor('marker.add');
    E.store.set({ playhead: 0.5, selection: [] }); const n0 = E.store.getState().sequence.markers.length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', code: 'F9', ctrlKey: true, altKey: true, shiftKey: true, bubbles: true })); await T.tick(30);
    const n1 = E.store.getState().sequence.markers.length; await E.shortcuts.resetKeymap(); return { a, fired: n1 - n0, after: E.shortcuts.combosFor('marker.add'), label: E.shortcuts.comboLabel('ctrl+alt+shift+f9') };`);
  ok('a new shortcut can be bound and fires its command', r.a.includes('ctrl+shift+alt+f9') && r.fired === 1, J(r));
  ok('Reset restores the defaults', !r.after.includes('ctrl+shift+alt+f9') && r.after.includes('m'), J(r));
  r = await js(`E.cmds.run('edit.shortcuts'); const m = await T.modal(); const t = m.textContent; E.store.set({ dialog: null }); return { search: !!m.querySelector('input'), reset: /Reset/.test(t), exp: /Export/.test(t) };`);
  ok('Keyboard Shortcuts dialog has search, Reset, Export', r.search && r.reset && r.exp, J(r));

  console.log('C4 Paste / Remove Attributes');
  r = await js(`${setup} const a = T.place(R, 0, 'V1')[0], b = T.place(R, 5, 'V1')[0];
    E.store.edit('look', ({ seq }) => { const c = seq.clips.find((x) => x.id === a); c.opacity = { level: { v: 40 } }; c.motion = { scale: { v: 150, keys: [{ t: 0, v: 100 }, { t: 4, v: 150 }] } }; });
    E.store.set({ selection: [a] }); E.cmds.run('edit.copy'); E.store.set({ selection: [b] });
    E.cmds.pasteAttributes(['opacity'], [], false); await T.tick(20); let c = E.store.getState().sequence.clips.find((x) => x.id === b);
    const one = { op: c.opacity?.level?.v, motion: !!c.motion };
    E.cmds.run('edit.undo'); E.cmds.pasteAttributes(['opacity', 'motion'], [], false); c = E.store.getState().sequence.clips.find((x) => x.id === b);
    const two = { op: c.opacity?.level?.v, scale: c.motion?.scale?.v, attrs: E.attributes.attrsOf(c).map((x) => x.key) };
    E.cmds.removeAttributes(['motion']); c = E.store.getState().sequence.clips.find((x) => x.id === b); return { one, two, removed: !c.motion, kept: c.opacity?.level?.v };`);
  ok('Paste Attributes pastes only the chosen attributes', r.one.op === 40 && !r.one.motion, J(r));
  ok('both attributes when both are ticked', r.two.op === 40 && r.two.scale === 150 && r.two.attrs.includes('motion') && r.two.attrs.includes('opacity'), J(r));
  ok('Remove Attributes removes only the chosen one', r.removed && r.kept === 40, J(r));
  r = await js(`return E.attributes.scaleKeyTimes({ keys: [{ t: 2, v: 1 }] }, 0.5).keys[0].t;`);
  ok('Scale Attribute Times scales keyframe times', r === 1, J(r));

  console.log('C5 audio mixer');
  r = await js(`${setup} const ids = T.place(M, 0, 'V1'); const s = E.store.getState(); const au = s.sequence.clips.find((c) => c.id === ids[1]);
    E.store.edit('pan', ({ seq }) => { seq.tracks.find((t) => t.id === au.track).pan = 100; });
    const q = E.store.getState().sequence; const p1 = E.audio.computePan(q, q.clips.find((c) => c.id === ids[1]), 0.5);
    E.store.edit('mv', ({ seq }) => { seq.masterVolume = -6; }); const g = E.audio.masterGain(E.store.getState().sequence); return { p1, g };`);
  ok('track pan +100 → pan 1 (right)', near(r.p1, 1), J(r));
  ok('master -6 dB → gain 0.501', near(r.g, 0.501, 0.002), J(r));
  r = await js(`const st = () => structuredClone({ ...E.store.getState(), log: [] }); const peak = (p) => { let m = 0; for (let i = 0; i < p.length; i++) m = Math.max(m, Math.abs(p[i])); return m; };
    const a = peak(await E.exporter.renderAudioMix(st(), 0, 1)); E.store.edit('mv', ({ seq }) => { seq.masterVolume = 0; }); const b = peak(await E.exporter.renderAudioMix(st(), 0, 1));
    const pcm = await E.exporter.renderAudioMix(st(), 0, 1); let L = 0, Rr = 0; for (let i = 0; i < pcm.length; i += 2) { L += Math.abs(pcm[i]); Rr += Math.abs(pcm[i + 1]); } return { a, b, ratio: a / b, L, R: Rr };`);
  ok('the export mix applies the master volume (-6 dB ≈ half)', r.b > 0 && near(r.ratio, 0.5, 0.06), J(r));
  ok('the export mix applies the track pan (hard right: left silent)', r.R > 0 && r.L < r.R * 0.01, J(r));
  r = await js(`E.layout?.requestPanel?.('audioTrackMixer'); await T.tick(150); return { strips: document.querySelectorAll('.strip').length, master: /Master/.test(document.body.textContent) };`);
  ok('Audio Track Mixer shows track strips and Master', r.strips >= 2 && r.master, J(r));

  console.log('C6 Sequence Settings / New Sequence');
  r = await js(`${setup} const id = T.place(R, 0.51, 'V1')[0]; E.store.edit('m', ({ seq }) => { seq.markers.push({ id: 'mk', time: 1.01, dur: 0 }); });
    const q = structuredClone(E.store.getState().sequence); E.editing.conformToFps(q, 25); const c = q.clips.find((x) => x.id === id); return { fps: q.fps, start: c.start, mk: q.markers[0].time };`);
  ok('a frame-rate change moves clips and markers to frames of the new rate', r.fps === 25 && near(r.start, 0.52, 1e-6) && near(r.mk, 1, 1e-6), J(r));
  r = await js(`E.store.edit('sr', ({ seq }) => { seq.sampleRate = 44100; }); T.place(M, 0, 'V2'); const pcm = await E.exporter.renderAudioMix(structuredClone({ ...E.store.getState(), log: [] }), 0, 1);
    return { sr: pcm.sampleRate, n: pcm.length };`);
  ok('Audio Sample Rate 44.1 kHz: the mix renders at 44100 Hz', r.sr === 44100 && r.n === 88200, J(r));
  r = await js(`E.cmds.run('seq.settings'); const m = await T.modal(); const t = m.textContent; E.store.set({ dialog: null }); return { par: /Pixel Aspect Ratio/.test(t), sr: /Audio Sample Rate/.test(t), swap: !!m.querySelector('.seq-preview') };`);
  ok('Sequence Settings has Pixel Aspect Ratio, Audio Sample Rate and a frame preview', r.par && r.sr && r.swap, J(r));
  r = await js(`await E.prefs.setPrefs({ videoTracks: 2, audioTracks: 4 }); const n0 = Object.keys(E.store.allSeqs()).length; E.cmds.run('file.newSequence'); const m = await T.modal();
    const sel = m.querySelectorAll('select')[1]; sel.value = '30'; sel.dispatchEvent(new Event('change', { bubbles: true })); await T.tick(10);
    T.button('OK').click(); await T.tick(60); const s = E.store.getState().sequence; await E.prefs.resetPrefs();
    return { n: Object.keys(E.store.allSeqs()).length - n0, v: s.tracks.filter((t) => t.kind === 'video').length, a: s.tracks.filter((t) => t.kind === 'audio').length, fps: s.fps };`);
  ok('New Sequence opens a dialog and makes the sequence with the Preferences track counts', r.n === 1 && r.v === 2 && r.a === 4 && r.fps === 30, J(r));

  console.log('C7 Preferences');
  r = await js(`${setup} await E.prefs.setPrefs({ stillDuration: 3, videoTransitionDur: 0.5, brightness: 'darker', autoSaveKeep: 2 }); const p = await E.prefs.loadPrefs();
    const cls = document.body.classList.contains('ui-darker'); const bad = (await E.prefs.setPrefs({ videoTracks: 999, autoScroll: 7 })); const out = { still: p.stillDuration, tr: p.videoTransitionDur, cls, vt: bad.videoTracks, as: bad.autoScroll };
    await E.prefs.resetPrefs(); return { ...out, reset: E.prefs.getPrefs().stillDuration, cls2: document.body.classList.contains('ui-darker') };`);
  ok('Preferences are saved and read back (userData/prefs.json)', r.still === 3 && r.tr === 0.5, J(r));
  ok('bad values are clamped / ignored', r.vt === 20 && r.as === 'page', J(r));
  ok('Brightness changes the UI; Reset Preferences restores defaults', r.cls && r.reset === 5 && !r.cls2, J(r));
  r = await js(`const refs = { branches: { main: 'r5' }, current: 'main', revisions: {} }; const mk = (id, t, auto, parent) => { refs.revisions[id] = { id, time: t, auto, parent }; };
    mk('r1', 1, true, null); mk('r2', 2, false, 'r1'); mk('r3', 3, true, 'r2'); mk('r4', 4, true, 'r3'); mk('r5', 5, true, 'r4');
    E.versions.pruneAuto(refs, 2); return { left: Object.keys(refs.revisions).sort(), p: refs.revisions.r2.parent, p4: refs.revisions.r4.parent };`);
  ok('Auto Save keeps only the newest N auto-saves (manual + head kept)', J(r.left) === J(['r2', 'r4', 'r5']) && r.p === null && r.p4 === 'r2', J(r));
  r = await js(`T.place(R, 0, 'V1'); await E.prefs.setPrefs({ preRoll: 0.5, postRoll: 0.3 }); E.store.set({ playhead: 2 }); E.cmds.run('play.around'); await T.tick(30);
    const s = E.store.getState(); const start = { ph: s.playhead, playing: s.playing }; await T.tick(1200); const e = E.store.getState(); await E.prefs.resetPrefs();
    return { start, end: { ph: e.playhead, playing: e.playing } };`);
  ok('Play Around (Shift+K) plays from pre-roll and returns to the playhead after post-roll', r.start.playing && r.start.ph < 1.7 && !r.end.playing && near(r.end.ph, 2, 1e-6), J(r));
  r = await js(`E.cmds.run('edit.preferences'); const m = await T.modal(); const tabs = [...m.querySelectorAll('.pref-tabs button')].map((b) => b.textContent); const reset = !!T.button('Reset Preferences'); E.store.set({ dialog: null }); return { tabs, reset };`);
  ok('Preferences dialog has tabs and Reset Preferences', r.tabs.includes('Auto Save') && r.tabs.includes('Appearance') && r.reset, J(r));

  console.log('C8 Project panel');
  r = await js(`${setup} E.cmds.run('media.duplicate', M.id); await T.tick(20); let ms = E.store.getState().media; const dup = ms[ms.findIndex((m) => m.id === M.id) + 1];
    E.cmds.run('media.label', M.id, '#e24b4b'); E.cmds.run('media.rename', M.id); const m = await T.modal(); const inp = m.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, 'Renamed.mp4'); inp.dispatchEvent(new Event('input', { bubbles: true })); await T.tick(10); T.button('OK').click(); await T.tick(30);
    const x = E.store.getState().media.find((q) => q.id === M.id); return { dup: dup && dup.name, dupId: dup && dup.id !== M.id, label: x.color, name: x.name };`);
  ok('Duplicate makes a copy item', /copy/.test(r.dup) && r.dupId, J(r));
  ok('Label and Rename change the item', r.label === '#e24b4b' && r.name === 'Renamed.mp4', J(r));
  r = await js(`E.layout?.requestPanel?.('project'); await T.tick(150); const head = document.querySelector('.phead'); if (!head) return { head: false };
    const names = () => [...document.querySelectorAll('.list li.list .pname')].map((e) => e.textContent.trim());
    [...head.children].find((e) => /^Name/.test(e.textContent)).click(); await T.tick(30); const asc = names(); [...head.children].find((e) => /^Name/.test(e.textContent)).click(); await T.tick(30); const desc = names();
    return { head: true, cols: [...head.children].map((e) => e.textContent), asc, desc };`);
  ok('list view has sortable columns (Name ▲ / ▼)', r.head && r.cols.some((c) => /Media Duration/.test(c)) && r.asc.length >= 2 && J(r.asc) === J([...r.desc].reverse()), J(r));
  r = await js(`const b = [...document.querySelectorAll('button')].find((x) => x.textContent === '▦'); b?.click(); await T.tick(300); const t = document.querySelectorAll('.pthumb').length;
    const range = !!document.querySelector('input[title="Thumbnail size"]'); [...document.querySelectorAll('button')].find((x) => x.textContent === '☰')?.click(); await T.tick(30); return { t, range };`);
  ok('icon view shows thumbnails and a size slider', r.t >= 2 && r.range, J(r));
  r = await js(`E.store.set({ selectedMedia: M.id }); E.layout?.requestPanel?.('metadata'); await T.tick(120); const p = document.querySelector('.meta-panel'); return { p: !!p, txt: p ? /Comment/.test(p.textContent) && /Renamed/.test(p.querySelector('input').value) : false };`);
  ok('Metadata panel shows the selected item (editable name, comment, label)', r.p && r.txt, J(r));

  console.log('C9 History panel');
  r = await js(`${setup} E.store.setHistoryLimit(5); for (let i = 0; i < 8; i++) E.store.edit('Marker ' + i, ({ seq }) => { seq.markers.push({ id: 'h' + i, time: i, dur: 0 }); });
    const s = E.store.getState(); const n = s.history.length, idx = s.historyIndex; let u = 0; while (E.store.getState().historyIndex > 0) { E.cmds.run('edit.undo'); u++; }
    const left = E.store.getState().sequence.markers.length; E.store.setHistoryLimit(100); return { n, idx, u, left };`);
  ok('History keeps only the set number of steps', r.n === 6 && r.idx === 5 && r.u === 5 && r.left === 3, J(r));
  r = await js(`${setup} for (let i = 0; i < 4; i++) E.store.edit('Add Marker', ({ seq }) => { seq.markers.push({ id: 'd' + i, time: i, dur: 0 }); });
    const n0 = E.store.getState().history.length; E.store.deleteHistoryFrom(n0 - 2); const s = E.store.getState(); E.cmds.run('edit.redo');
    return { n: s.history.length, n0, m: s.sequence.markers.length, after: E.store.getState().sequence.markers.length };`);
  ok('Delete removes the step and the ones after it (no redo)', r.n === r.n0 - 2 && r.m === 2 && r.after === 2, J(r));
  r = await js(`E.layout?.requestPanel?.('history'); await T.tick(150); return { icons: document.querySelectorAll('.hist-item .hi').length, del: [...document.querySelectorAll('button')].some((b) => /Delete/.test(b.textContent)) };`);
  ok('History panel shows icons and a Delete button', r.icons >= 2 && r.del, J(r));
});
