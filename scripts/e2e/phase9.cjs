// Phase 9 end-to-end test (the audit items left open after Phase 8): main-process read / write guard (E15), one History per
// sequence (D13), Optical Flow time interpolation (D2) and the other D items (added below as they are done).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { suite } = require('./harness.cjs');

suite('phase9 e2e', async ({ js, ok, out, frames, px, near, nextSave, nextOpen, tmp }) => {
  const J = JSON.stringify;
  const make = (name, args) => { const p = out(name); const r = spawnSync(ffmpeg, ['-y', '-v', 'error', ...args, p]); if (r.status !== 0) throw new Error(String(r.stderr)); return p; };

  console.log('E15 main-process guard');
  const winIni = path.join(process.env.SystemRoot || 'C:\\Windows', 'win.ini');
  let r = await js(`try { await window.editorstage.readText(${J(winIni)}); return 'read'; } catch (e) { return String(e.message || e); }`);
  ok('a text file nobody picked (win.ini) cannot be read', /may not read/.test(r), r);
  r = await js(`const x = await fetch('es-media://local/' + encodeURIComponent(${J(winIni.replace(/\\/g, '/'))})).catch((e) => ({ status: 'error' })); return x.status;`);
  ok('...nor through the media protocol', r === 403 || r === 'error', J(r));
  const probe = path.join(os.homedir(), `es-guard-probe-${process.pid}.json`);
  r = await js(`try { await window.editorstage.writeFile(${J(probe)}, '{}'); return 'written'; } catch (e) { return String(e.message || e); }`);
  ok('a file cannot be written where nobody chose', /may not write/.test(r) && !fs.existsSync(probe), r);
  if (fs.existsSync(probe)) fs.rmSync(probe);
  r = await js(`try { await window.editorstage.mkdir(${J(path.join(os.homedir(), `es-guard-dir-${process.pid}`))}); return 'made'; } catch (e) { return String(e.message || e); }`);
  ok('a folder cannot be created where nobody chose', /may not create/.test(r), r);
  r = await js(`const r = await window.editorstage.ffmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=red:s=16x16:d=0.1', ${J(path.join(os.homedir(), `es-guard-${process.pid}.png`))}], 'g1'); return r;`);
  ok('FFmpeg cannot write there either', r && r.ok === false && /may not write/.test(r.error || ''), J(r));
  const lut = out('look.cube'); fs.writeFileSync(lut, 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n');
  nextOpen.push(lut);
  r = await js(`const [p] = await window.editorstage.openDialog('lut'); const t = await window.editorstage.readText(p); return t.startsWith('LUT_3D_SIZE');`);
  ok('a file picked in the open dialog can be read', r === true);
  const proj = out('p9.esproj');
  nextSave.push(proj);
  r = await js(`T.fresh(160, 90); E.store.set({ projectName: 'p9' }); const ok1 = await E.cmds.commands['file.save'](); await T.tick(50); return { ok1, dirty: E.store.getState().dirty };`);
  ok('Save As to a picked path works', fs.existsSync(proj), J(r));
  r = await js(`const s = await window.editorstage.mkdir(${J(path.join(path.dirname(proj), 'Captured'))}); return s;`);
  ok("the project's Captured folder may be created", r === true);

  console.log('D13 one History per sequence');
  r = await js(`T.fresh(160, 90); const main = E.store.getState().sequence.id;
    E.store.addSequence({ id: 'short', name: 'Short', fps: 30, width: 90, height: 160, duration: 10, tracks: E.store.getState().sequence.tracks, clips: [], transitions: [], markers: [] });
    E.store.edit('Edit Main', ({ seq }) => { seq.note = 'main'; });
    E.store.switchSequence('short'); E.store.edit('Edit Short', ({ seq }) => { seq.note = 'short'; });
    E.store.switchSequence(main); await T.tick(80);
    const h = E.store.getState().history.map((x) => x.label);
    const rows = [...document.querySelectorAll('.panel, .history, body')].length;
    E.cmds.run('edit.undo'); await T.tick(30); const undone = E.store.getState().sequence.note;
    E.store.switchSequence('short'); await T.tick(30); const h2 = E.store.getState().history.map((x) => x.label);
    E.cmds.run('edit.undo'); const undone2 = E.store.getState().sequence.note;
    E.store.switchSequence(main); E.cmds.run('edit.redo'); const back = E.store.getState().sequence.note;
    return { h, undone, h2, undone2, back, rows };`);
  ok('back in the main sequence its History still lists its edit', r.h.includes('Edit Main') && !r.h.includes('Edit Short'), J(r.h));
  ok('...which Undo reverts', r.undone === undefined);
  ok('the Short kept its own History', r.h2.includes('Edit Short') && !r.h2.includes('Edit Main'), J(r.h2));
  ok('...and its undo is separate', r.undone2 === undefined && r.back === 'main', J(r));

  console.log('D2 Optical Flow');
  // a 20 px white box moving 6 px per frame on black, 10 fps
  const moving = make('moving.mp4', ['-f', 'lavfi', '-i', "color=c=black:s=160x90:r=10:d=2[bg];color=c=white:s=20x20:r=10[fg];[bg][fg]overlay=x='t*60':y=35:shortest=1", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '1']);
  const frameAt = async (mode) => js(`T.fresh(160, 90); const m = await T.imp(${J(moving)}); const [id] = T.place(m, 0, 'V1');
    E.store.edit('speed', ({ seq }) => E.editing.setSpeed(seq, [id], { speed: 50, ripple: true, sampling: ${J(mode)} }));
    const img = await E.exporter.renderFrame(0.7, 160, 90); const row = (y) => [...Array(160).keys()].map((x) => img.data[(y * 160 + x) * 4]);
    return row(45);`);
  const sample = await frameAt('sample'); const blend = await frameAt('blend'); const flow = await frameAt('flow');
  // source frame 3.5: frame 3 has the box at x 18..38, frame 4 at 24..44; halfway it is at 21..41
  ok('control: Frame Blending shows two half-bright boxes (x 20 and x 42 are grey)', blend[20] > 70 && blend[20] < 190 && blend[42] > 70 && blend[42] < 190, J([blend[20], blend[42]]));
  ok('Optical Flow moves the box halfway: x 20 is dark, x 30 and x 40 are white', flow[20] < 90 && flow[30] > 200 && flow[40] > 170, J([flow[20], flow[30], flow[40]]));
  ok('...where Frame Sampling shows one of the two real frames', (sample[20] > 200) !== (sample[42] > 200), J([sample[20], sample[42]]));
  r = await js(`const st = E.store.getState(); return JSON.parse(E.projectFile.projectJson(st)).sequence.clips[0].frameSampling;`);
  ok('Optical Flow is saved with the clip', r === 'flow', J(r));

  console.log('D3 Export Queue in a background render window');
  const { BrowserWindow } = require('electron');
  const queueRun = async (bgOn, file) => {
    await js(`E.exportQueue.setBackgroundRender(${bgOn}); T.fresh(160, 90); const m = await T.imp(${J(moving)}); T.place(m, 0, 'V1'); return true;`);
    const id = await js(`return E.exportQueue.queueExport({ path: ${J(out(file))}, preset: 'Apple ProRes 422 (MOV)', width: 160, height: 90, fps: 30, start: 0, end: 2 });`);
    const seen = { locked: false, bg: false, windows: 1, edits: 0 };
    for (let i = 0; i < 600; i++) {
      const s = await js(`const j = E.store.getState().exportQueue.find((x) => x.id === ${J(id)}); if (j.status === 'rendering') { E.store.edit('tweak', ({ seq }) => { seq.tweak = (seq.tweak || 0) + 1; }); } return { st: j.status, msg: j.msg, locked: E.media.playbackLocked(), bg: E.exportQueue.runningInBackground() };`);
      if (s.st === 'rendering') { seen.locked ||= s.locked; seen.bg ||= s.bg; seen.edits++; seen.windows = Math.max(seen.windows, BrowserWindow.getAllWindows().length); }
      if (['done', 'error', 'cancelled'].includes(s.st)) { seen.st = s.st; seen.msg = s.msg; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    return seen;
  };
  r = await queueRun(true, 'queued_bg.mov');
  ok('the queued export renders in a second (hidden) window', r.st === 'done' && r.bg === true && r.windows === 2, J(r));
  ok('...while the main window keeps its preview (playback not locked) and can be edited', r.locked === false && r.edits > 0, J(r));
  let fr = frames(out('queued_bg.mov'), 160, 90);
  ok('the background export has every frame and the right picture', fr.length === 60 && px(fr[0], 160, 10, 45)[0] > 200 && px(fr[0], 160, 60, 45)[0] < 40, J({ n: fr.length, a: px(fr[0], 160, 10, 45), b: px(fr[0], 160, 60, 45) }));
  r = await queueRun(false, 'queued_fg.mov');
  ok('control: rendering in the main window locks its playback meanwhile', r.st === 'done' && r.locked === true && r.bg === false, J(r));
  await js('E.exportQueue.setBackgroundRender(true); return true;');
  r = await js(`T.fresh(160, 90); const m = await T.imp(${J(moving)}); T.place(m, 0, 'V1'); const id = E.exportQueue.queueExport({ path: ${J(out('queued_cancel.mov'))}, preset: 'Apple ProRes 422 (MOV)', width: 160, height: 90, fps: 30, start: 0, end: 2 });
    for (let i = 0; i < 200 && E.store.getState().exportQueue.find((x) => x.id === id).status !== 'rendering'; i++) await T.tick(20);
    await T.tick(150); E.exportQueue.cancelExport(id); const j = await E.exportQueue.whenExported(id); return j.status;`);
  ok('a background export can be cancelled and leaves no file', r === 'cancelled' && !fs.existsSync(out('queued_cancel.mov')) && !fs.existsSync(out('queued_cancel.es-part.mov')), J(r));
});
