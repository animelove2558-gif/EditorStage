// Phase 8 end-to-end test (fixes from the 2-3 Nov 2026 audit): Toggle Track Output (A1), navigation lock (A4), saved
// state with undo (E1), Save errors (E5), damaged project files (E6), export end after an encoder failure (E10),
// half-written exports (E10), number fields (E12), shortcut focus (E13), main-process guard (E15), In / Out in the file (F3).
const fs = require('fs');
const path = require('path');
const { suite } = require('./harness.cjs');

suite('phase8 e2e', async ({ js, ok, out, frames, px, near, nextSave, nextOpen }) => {
  const J = JSON.stringify;

  console.log('A1 Toggle Track Output');
  await js(`T.fresh(160, 90); const a = E.gfx.addGraphic('rect', 0, { x: 0.5, y: 0.5, w: 1.2, h: 1.2, color: '#ff0000', stroke: false });
    const b = E.gfx.addGraphic('rect', 0, { x: 0.5, y: 0.5, w: 1.2, h: 1.2, color: '#0000ff', stroke: false });
    T.patch(a, (c) => { c.track = 'V1'; c.dur = 2; }); T.patch(b, (c) => { c.track = 'V2'; c.dur = 2; }); return true;`);
  await js(`return T.exp(${J(out('a1_shown.mov'))}, 'Apple ProRes 422 (MOV)', 160, 90, 0, 2 / 30);`);
  ok('control: V2 (blue) covers V1 (red)', near(px(frames(out('a1_shown.mov'), 160, 90)[0], 160, 80, 45), [0, 0, 255], 40));
  let r = await js(`E.cmds.run('track.toggleOutput', 'V2'); await T.tick(100);
    const btn = [...document.querySelectorAll('button.eye')]; const t = E.store.getState().sequence.tracks.find((x) => x.id === 'V2');
    return { hidden: t.hidden, label: E.store.getState().history.at(-1).label, eyes: btn.length, on: btn.filter((x) => x.classList.contains('on')).length };`);
  ok('the eye hides V2 as one undoable step; video tracks have an eye button', r.hidden === true && r.label === 'Toggle Track Output' && r.eyes >= 3 && r.on === 1, J(r));
  await js(`return T.exp(${J(out('a1_hidden.mov'))}, 'Apple ProRes 422 (MOV)', 160, 90, 0, 2 / 30);`);
  ok('export with V2 hidden shows V1 (red): preview = export', near(px(frames(out('a1_hidden.mov'), 160, 90)[0], 160, 80, 45), [255, 0, 0], 40));
  r = await js(`const img = await E.exporter.renderFrame(0.02, 160, 90); const i = (45 * 160 + 80) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]];`);
  ok('a rendered frame (Program Monitor path) shows V1 too', near(r, [255, 0, 0], 40), J(r));
  r = await js(`E.cmds.run('edit.undo'); return !!E.store.getState().sequence.tracks.find((x) => x.id === 'V2').hidden;`);
  ok('undo shows V2 again', r === false);
  r = await js(`E.cmds.run('edit.redo'); return JSON.parse(E.projectFile.projectJson(E.store.getState())).sequence.tracks.find((x) => x.id === 'V2').hidden;`);
  ok('hidden is saved in the .esproj', r === true);

  console.log('E1 saved state, F3 In / Out');
  const proj = out('p8.esproj');
  nextSave.push(proj);
  r = await js(`E.store.set({ inPoint: 0.5, outPoint: 1.5 }); await E.cmds.commands['file.save'](); await T.tick(50); const a = E.store.getState().dirty;
    E.cmds.run('edit.undo'); await T.tick(50); const b = E.store.getState().dirty; const title = document.querySelector('.menubar, .titlebar, body').textContent.includes('p8 *') || document.title;
    E.cmds.run('edit.redo'); const c = E.store.getState().dirty; return { a, b, c };`);
  ok('Save: clean; Undo: unsaved; Redo back to the saved step: clean', r.a === false && r.b === true && r.c === false, J(r));
  const saved = JSON.parse(fs.readFileSync(proj, 'utf8'));
  ok('the project file holds its id and the sequence In / Out', typeof saved.projectId === 'string' && saved.inPoint === 0.5 && saved.outPoint === 1.5, J({ id: saved.projectId, i: saved.inPoint, o: saved.outPoint }));
  ok('no temp file is left next to the project', !fs.existsSync(proj + '.es-tmp'));

  console.log('E5 Save that fails');
  const blocked = out('blocked.esproj'); fs.mkdirSync(blocked); // a folder of that name: the file cannot be written
  nextSave.push(blocked);
  r = await js(`E.store.edit('x', ({ seq }) => { seq.note = 1; }); await E.cmds.commands['file.saveAs'](); await T.tick(100);
    const m = document.querySelector('.modal'); return { dirty: E.store.getState().dirty, path: E.store.getState().projectPath, modal: m && m.textContent };`);
  ok('a failed Save reports the error, offers Save As and keeps the project unsaved', r.dirty === true && /Save Failed/.test(r.modal || '') && /Save As/.test(r.modal || '') && r.path === proj, J(r));
  await js(`E.store.set({ dialog: null }); return true;`);

  console.log('E6 damaged project file');
  const bad = out('bad.esproj'); fs.writeFileSync(bad, '{"sequence": {"tracks": [{"id": "V1"}], "clips": [');
  nextOpen.push(bad);
  r = await js(`E.store.markSaved(); await E.cmds.commands['file.open'](); await T.tick(200); const m = document.querySelector('.modal');
    return { modal: m && m.textContent, path: E.store.getState().projectPath };`);
  ok('opening a cut-short project says why and keeps the open project', /cannot be opened/.test(r.modal || '') && /not valid project data/.test(r.modal || '') && r.path === proj, J(r));
  await js(`E.store.set({ dialog: null }); return true;`);
  // a damaged file that has a project history: its newest revision is offered
  fs.copyFileSync(proj, out('hist.esproj'));
  r = await js(`E.store.set({ projectPath: ${J(out('hist.esproj'))} }); await E.versions.commitRevision('Manual revision'); return true;`);
  fs.writeFileSync(out('hist.esproj'), 'garbage');
  nextOpen.push(out('hist.esproj'));
  r = await js(`E.store.markSaved(); await E.cmds.commands['file.open'](); await T.tick(200); const m = document.querySelector('.modal'); const t = m && m.textContent;
    T.button('Open Revision')?.click(); for (let i = 0; i < 40 && E.store.getState().dialog; i++) await T.tick(50); await T.tick(200);
    const s = E.store.getState(); return { t, clips: s.sequence.clips.length, dirty: s.dirty, path: s.projectPath };`);
  ok('a damaged file with a history offers its newest revision and opens it (unsaved)', /Open Revision/.test(r.t || '') && r.clips === 2 && r.dirty === true && /hist\.esproj$/.test(r.path || ''), J(r));

  console.log('E10 encoder failure / half-written exports');
  r = await js(`const t0 = performance.now(); const id = 'p8-dead';
    const st = await window.editorstage.job.start(id, ['-hide_banner', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '16x16', '-i', '-', '-c:v', 'no_such_encoder', ${J(out('dead.mp4'))}]);
    await T.tick(1500); const w = await window.editorstage.job.write(id, new Uint8Array(1024)); const e = await window.editorstage.job.end(id);
    return { st, w, e, ms: performance.now() - t0 };`);
  ok('write after the encoder died returns false and end resolves with its error (no hang)', r.st.ok && r.w === false && r.e.ok === false && r.e.error && r.ms < 8000, J(r));
  r = await js(`T.fresh(160, 90); E.gfx.addGraphic('rect', 0, { x: 0.5, y: 0.5, w: 1, h: 1, color: '#00ff00', stroke: false });
    let n = 0; const res = await E.exporter.exportSequence({ path: ${J(out('cancelled.mov'))}, preset: 'Apple ProRes 422 (MOV)', width: 160, height: 90, fps: 30, start: 0, end: 2 }, () => {}, () => ++n > 20);
    return res;`);
  ok('a cancelled export leaves no file (neither the target nor the part file)', r.ok === false && !fs.existsSync(out('cancelled.mov')) && !fs.existsSync(out('cancelled.es-part.mov')), J(r));
  fs.writeFileSync(out('keep.mov'), 'old');
  await js(`await E.exporter.exportSequence({ path: ${J(out('keep.mov'))}, preset: 'Apple ProRes 422 (MOV)', width: 160, height: 90, fps: 30, start: 0, end: 2 }, () => {}, (() => { let n = 0; return () => ++n > 10; })()); return true;`);
  ok('an existing file stays intact when the export replacing it is cancelled', fs.readFileSync(out('keep.mov'), 'utf8') === 'old');
  await js(`return T.exp(${J(out('keep.mov'))}, 'Apple ProRes 422 (MOV)', 160, 90, 0, 2 / 30);`);
  ok('a finished export replaces it', fs.statSync(out('keep.mov')).size > 100 && !fs.existsSync(out('keep.es-part.mov')));

  console.log('E15 main-process guard, A4 navigation');
  r = await js(`const es = window.editorstage; const res = {};
    try { await es.writeFile(${J(out('evil.bat'))}, 'echo x'); res.bat = 'written'; } catch (e) { res.bat = String(e.message); }
    res.rm = await es.removeFile(${J(path.join(__dirname, 'harness.cjs'))});
    res.open = await es.openExternal(${J(out('x.exe'))});
    const ff = await es.ffmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc', '-t', '0.1', '-f', 'wav', ${J(out('evil.cmd'))}]); res.ff = ff.ok ? 'ran' : ff.error;
    res.as = await es.audiostage.setPath(${J(out('AudioStage.exe'))});
    return res;`);
  ok('a .bat cannot be written', /may not write/.test(r.bat) && !fs.existsSync(out('evil.bat')), J(r));
  ok('a file outside the app data / picked folders cannot be deleted', r.rm === false && fs.existsSync(path.join(__dirname, 'harness.cjs')));
  ok('a program is not opened with the system', /does not open programs/.test(r.open || ''), J(r.open));
  ok('FFmpeg may not write a script file', /may not write/.test(r.ff || '') && !fs.existsSync(out('evil.cmd')), J(r.ff));
  ok('the AudioStage location must come from a dialog', r.as === null, J(r.as));
  r = await js(`const w = window.open('https://example.com/'); const before = location.href; try { location.href = 'file:///C:/Windows/win.ini'; } catch { /* refused */ } await T.tick(300);
    return { w: w === null, same: location.href === before, es: !!window.editorstage };`);
  ok('window.open is denied and the page cannot navigate away', r.w && r.same && r.es, J(r));

  console.log('E12 number fields, E13 shortcut focus');
  r = await js(`const host = document.createElement('div'); document.body.appendChild(host); const { createRoot } = E.reactDom; const root = createRoot(host);
    const got = []; const React = E.react;
    root.render(React.createElement(E.NumInput, { value: 100, onChange: (e) => got.push(+e.target.value), className: 'p8num' })); await T.tick(50);
    const el = host.querySelector('input'); el.focus(); await T.tick(10);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; const type = (v) => { setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    type(''); await T.tick(10); type('-'); await T.tick(10); type('-8'); await T.tick(10); type('80'); await T.tick(10);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await T.tick(10);
    root.unmount(); host.remove(); return got;`);
  ok('typing "", "-", "-8", "80" reports only -8 and 80 (never 0); Esc restores 100', J(r) === J([-8, 80, 100]), J(r));
  r = await js(`T.fresh(160, 90); E.gfx.addGraphic('rect', 0, { x: 0.5, y: 0.5, w: 1, h: 1, color: '#00ff00', stroke: false }); E.store.set({ playing: false, playhead: 0 });
    const cb = document.createElement('input'); cb.type = 'checkbox'; document.body.appendChild(cb); cb.focus();
    cb.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); await T.tick(50); const playing = E.store.getState().playing; E.store.set({ playing: false });
    const tx = document.createElement('input'); tx.type = 'text'; document.body.appendChild(tx); tx.focus();
    tx.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); await T.tick(50); const inText = E.store.getState().playing;
    cb.remove(); tx.remove(); E.store.set({ playing: false }); return { playing, inText };`);
  ok('Space plays with a checkbox focused, not while typing in a text field', r.playing === true && r.inText === false, J(r));
});
