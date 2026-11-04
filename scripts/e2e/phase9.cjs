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
    await E.exporter.renderFrame(0.7, 160, 90); const img = await E.exporter.renderFrame(0.7, 160, 90); const row = (y) => [...Array(160).keys()].map((x) => img.data[(y * 160 + x) * 4]);
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

  console.log('D4 source patching');
  const av = make('av.mp4', ['-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
  r = await js(`T.fresh(160, 90); const m = await T.imp(${J(av)}); E.store.set({ selectedMedia: m.id, playhead: 0 }); await T.tick(150);
    const cell = (id) => document.querySelector('.tl-head[data-track="' + id + '"] .srcpatch button');
    const before = { v1: cell('V1')?.textContent, a1: cell('A1')?.textContent, v2empty: cell('V2')?.classList.contains('empty') };
    cell('V2').click(); await T.tick(60); cell('A2').click(); await T.tick(60);
    E.cmds.run('edit.overwrite'); await T.tick(60);
    const tracks = E.store.getState().sequence.clips.map((c) => c.track).sort();
    cell('A2').click(); await T.tick(60); const off = cell('A2').classList.contains('on');
    E.store.set({ playhead: 3 }); E.cmds.run('edit.overwrite'); await T.tick(60);
    const later = E.store.getState().sequence.clips.filter((c) => c.start >= 2.9).map((c) => c.track);
    return { before, tracks, off, later, label: E.store.getState().history.at(-1).label };`);
  ok('the source V1 / A1 indicators sit on the targeted tracks', r.before.v1 === 'V1' && r.before.a1 === 'A1' && r.before.v2empty === true, J(r.before));
  ok('clicking the empty slots patches V1 -> V2 and A1 -> A2; Overwrite lands there', J(r.tracks) === J(['A2', 'V2']), J(r.tracks));
  ok('clicking the A1 indicator leaves the sound out of the next edit (picture only)', r.off === false && J(r.later) === J(['V2']), J(r));

  console.log('D6 ellipse mask rotation');
  const maskPx = async (rot) => js(`T.fresh(160, 90); const id = E.gfx.addGraphic('rect', 0, { x: 0.5, y: 0.5, w: 1.2, h: 1.2, color: '#ffffff', stroke: false });
    T.patch(id, (c) => { c.dur = 2; c.masks = [{ id: 'm', type: 'ellipse', enabled: true, params: { center: { v: [0.5, 0.5], keys: null }, size: { v: [0.8, 0.1], keys: null }, rotation: { v: ${rot}, keys: null }, feather: { v: 0, keys: null }, opacity: { v: 100, keys: null }, invert: { v: false, keys: null } } }]; });
    const img = await E.exporter.renderFrame(0.5, 160, 90); const p = (x, y) => img.data[(y * 160 + x) * 4]; return { side: p(30, 45), top: p(80, 8) };`);
  const flat = await maskPx(0); const turned = await maskPx(90);
  ok('control: a wide flat ellipse covers the sides, not the top', flat.side > 200 && flat.top < 40, J(flat));
  ok('rotated 90 degrees it stands upright (top covered, sides not)', turned.side < 40 && turned.top > 200, J(turned));
  // a still picture (one test-pattern frame) turning clockwise at 0.5 rad/s
  const still = make('still.png', ['-f', 'lavfi', '-i', 'testsrc=s=200x200:r=1:d=1', '-frames:v', '1']);
  const spin = make('spin.mp4', ['-loop', '1', '-i', still, '-vf', "rotate=a='t*0.5':c=black,format=yuv420p", '-r', '30', '-t', '2', '-c:v', 'libx264', '-g', '1']);
  r = await js(`T.fresh(200, 200); const m = await T.imp(${J(spin)}); const [id] = T.place(m, 0, 'V1'); E.store.set({ playhead: 0 });
    T.patch(id, (c) => { c.masks = [{ id: 'm', type: 'ellipse', enabled: true, params: { center: { v: [0.5, 0.5], keys: null }, size: { v: [0.5, 0.5], keys: null }, rotation: { v: 0, keys: null }, feather: { v: 10, keys: null }, opacity: { v: 100, keys: null }, invert: { v: false, keys: null } } }]; });
    const res = await E.tracking.trackMask(id, 'm', 1, 31, 'rotation');
    const rot = T.clip(id).masks[0].params.rotation; const at1 = E.params.evalParam(rot, 1);
    return { res, keys: (rot.keys || []).length, at1 };`);
  ok('Track Forward (Position & Rotation) keyframes the ellipse rotation', r.keys >= 20, J(r));
  ok('...turning with the object (0.5 rad = 28.6 degrees clockwise after 1 s)', Math.abs(r.at1 - 28.6) < 8, J(r));

  console.log('D7 Color Match: RGB Curves, face model');
  const warmImg = make('warm_ref.png', ['-f', 'lavfi', '-i', 'gradients=s=160x90:c0=0x3a1a08:c1=0xf0b070:x0=0:y0=0:x1=160:y1=90:n=2', '-frames:v', '1']);
  const coolImg = make('cool_tgt.png', ['-f', 'lavfi', '-i', 'gradients=s=160x90:c0=0x081830:c1=0x90b0f0:x0=0:y0=0:x1=160:y1=90:n=2', '-frames:v', '1']);
  r = await js(`T.fresh(160, 90); const a = await T.imp(${J(coolImg)}); const b = await T.imp(${J(warmImg)});
    const [ta] = T.place(a, 0, 'V1'); const [tb] = T.place(b, 10, 'V1'); E.store.set({ playhead: 1 });
    const mean = async (t) => { await E.exporter.renderFrame(t, 160, 90); const img = await E.exporter.renderFrame(t, 160, 90); const m = [0, 0, 0]; for (let i = 0; i < img.data.length; i += 4) for (let k = 0; k < 3; k++) m[k] += img.data[i + k]; return m.map((v) => v / (img.data.length / 4)); };
    const ref = await mean(11), before = await mean(1);
    const v = await E.colorAuto.applyColorMatch(ta, tb, 11, true, true);
    const after = await mean(1); const lu = T.clip(ta).lumetri;
    return { ref, before, after, curves: !!lu.curves && lu.curves.r.length > 2, label: E.store.getState().history.at(-1).label, face: v.usedFaceModel };`);
  const dist = (x) => Math.hypot(...x.map((v, i) => v - r.ref[i]));
  ok('Color Match (RGB Curves) writes curves to the clip as one step', r.curves && r.label === 'Apply Color Match', J(r));
  ok('...and the matched clip looks like the reference (mean color)', dist(r.after) < dist(r.before) * 0.25, J({ ref: r.ref, before: r.before, after: r.after }));
  r = await js(`const { faceRegion } = E.colorAuto; const c = document.createElement('canvas'); c.width = 64; c.height = 36; const g = c.getContext('2d'); g.fillStyle = '#d9a080'; g.fillRect(0, 0, 64, 36); let model = 'ok'; try { await E.vision.detectFace(c); } catch (e) { model = String(e); } return { r: await faceRegion(c, 16, 9), model };`);
  ok('the face model loads and finds no face in a skin-coloured block (no false skin match)', r.r === null && r.model === 'ok', J(r));

  console.log('D8 Remove Background for other subjects');
  // a red disc (the "object") on a grey textured background
  const disc = make('disc.png', ['-f', 'lavfi', '-i', "color=c=gray:s=320x180:d=1,format=rgb24,geq=r='if(lt(hypot(X-160,Y-90),45),230,90+30*sin(X/7))':g='if(lt(hypot(X-160,Y-90),45),40,90+30*sin(Y/5))':b='if(lt(hypot(X-160,Y-90),45),40,100)'", '-frames:v', '1']);
  const rbg = async (subject, point) => js(`T.fresh(320, 180); const m = await T.imp(${J(disc)}); const [id] = T.place(m, 0, 'V1');
    T.patch(id, (c) => { c.effects = [{ id: 'rb', effectId: 'Video Effects/Keying/Remove Background', name: 'Remove Background', category: 'Video', folder: 'Keying', enabled: true,
      params: { subject: { v: ${subject}, keys: null }, objPoint: { v: ${J(point || [0.5, 0.5])}, keys: null }, threshold: { v: 50, keys: null }, feather: { v: 0, keys: null }, choke: { v: 0, keys: null }, invert: { v: false, keys: null } } }]; });
    const img = await E.exporter.renderFrame(0.5, 320, 180); const p = (x, y) => img.data[(y * 320 + x) * 4];
    return { center: p(160, 90), corner: p(20, 20), edge: p(300, 160) };`);
  r = await rbg(4, [0.5, 0.5]);
  ok('Object at Point keeps the object under the point (the red disc) and removes the rest', r.center > 180 && r.corner < 30 && r.edge < 30, J(r));
  r = await rbg(4, [0.08, 0.1]);
  ok('...a point on the background keeps the background around it instead', r.corner > 60, J(r));
  r = await js(`const clip = E.store.getState().sequence.clips[0]; T.patch(clip.id, (c) => { c.effects[0].params.subject = { v: 2, keys: null }; });
    let err = null; try { await E.exporter.renderFrame(0.5, 320, 180); } catch (e) { err = String(e); } return { err, variant: E.segment.removeBgOptions(T.clip(clip.id)).variant, has: !!E.segment.getMask(E.segment.maskKey(clip.mediaId, 0, 's2')) };`);
  ok('the Vehicles / Animals / Any Object subjects run the DeepLab model (own cached mask per subject)', r.err === null && r.variant === 's2' && r.has === true, J(r));

  console.log('D9 Smart B-Roll by meaning (multilingual sentence model pack)');
  const talk9 = make('talk9.mp4', ['-f', 'lavfi', '-i', 'color=c=gray:s=160x90:r=10:d=14', '-f', 'lavfi', '-i', 'sine=f=300:d=14', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
  const pics9 = [['beach_sunset.png', 'orange'], ['office_meeting.png', 'white'], ['mountain_hiking.png', 'green']].map(([n, c]) => make(n, ['-f', 'lavfi', '-i', `color=c=${c}:s=160x90:d=1`, '-frames:v', '1']));
  const words9 = [['ทะเล', 1, 1.3], ['สวย', 1.3, 1.6], ['มาก', 1.6, 1.9], ['คลื่น', 2, 2.3], ['ซัด', 2.3, 2.6], ['เข้า', 2.6, 2.8], ['หาด', 2.8, 3.1], ['ทราย', 3.1, 3.5],
    [' The', 5, 5.3], [' board', 5.3, 5.8], [' members', 5.8, 6.2], [' sat', 6.2, 6.5], [' around', 6.5, 7], [' the', 7, 7.2], [' conference', 7.2, 7.6], [' table.', 7.6, 8],
    [' Climbing', 10, 10.5], [' up', 10.5, 10.7], [' to', 10.7, 10.9], [' the', 10.9, 11], [' summit', 11, 11.5], [' was', 11.5, 11.7], [' exhausting.', 11.7, 12.5]].map(([text, t0, t1]) => ({ text, t0, t1 }));
  r = await js(`T.fresh(160, 90); const m = await T.imp(${J(talk9)}); T.place(m, 0, 'V1');
    E.store.edit('Transcribe', ({ media }) => { media.find((x) => x.id === m.id).transcript = { words: ${J(words9)}, language: 'th' }; });
    for (const p of ${J(pics9)}) await T.imp(p);
    const list = await E.modelPacks.listPacks(true); const n = await E.broll.indexMedia({ vision: false });
    const words = E.broll.suggestBRoll().map((g) => g.candidates.map((c) => c.name));
    const miss = await fetch('es-app://app/models/embed/paraphrase-multilingual-MiniLM-L12-v2/config.json').then((x) => x.status, () => 'error');
    return { packs: list.map((p) => [p.id, p.installed, p.bytes]), n, words, miss, vec: E.store.getState().media.some((x) => x.brollIndex?.vec) };`);
  ok('model packs are listed, none installed in a fresh profile; without the model nothing matches these sentences by words', r.packs.length === 3 && r.packs.every((p) => p[1] === false) && r.n === 4 && r.words.length === 0 && !r.vec, J(r));
  ok('a model file that is not installed is a 404 on es-app://app/models/', r.miss === 404, J(r.miss));
  r = await js(`await E.cmds.run('ai.broll'); await T.tick(300); const b = [...document.querySelectorAll('.broll .modelpack button')].map((x) => x.textContent); return b;`);
  ok('B-Roll tab offers "Download model (... MB)"', r.some((t) => /^Download model \(\d+ MB\)$/.test(t)), J(r));
  const t0 = Date.now();
  r = await js(`const seen = []; const off = E.modelPacks.subscribe((l) => { const p = l.find((x) => x.id === 'multilingual-embed'); if (p && p.got) seen.push(p.got); });
    let err = null; try { await E.modelPacks.downloadPack('multilingual-embed'); } catch (e) { err = String(e.message || e); } off();
    return { err, steps: seen.length, last: seen.at(-1), info: E.modelPacks.packInfo('multilingual-embed') };`);
  const embDir = path.join(tmp, 'userData', 'models', 'embed', 'paraphrase-multilingual-MiniLM-L12-v2');
  ok('Download fetches the pack into userData/models with progress (checked sizes + hashes)', r.err === null && r.info.installed && r.steps > 5 && r.last === r.info.bytes && fs.existsSync(path.join(embDir, 'onnx', 'model_quantized.onnx')), J({ ...r, secs: (Date.now() - t0) / 1000 }));
  console.log(`  download took ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  r = await js(`await T.tick(200); return [...document.querySelectorAll('.broll .modelpack')].map((x) => x.textContent);`);
  ok('...the tab then shows "Model installed"', r.some((t) => /Model installed/.test(t)), J(r));
  r = await js(`const n = await E.broll.indexMedia({ vision: false }); const vs = E.store.getState().media.filter((x) => x.brollIndex?.vec);
    const sug = await E.broll.suggestBRollSmart();
    const sv = await E.broll.embedTexts(['ทะเลสวยมาก คลื่นซัดเข้าหาดทราย', 'The board members sat around the conference table.', 'Climbing up to the summit was exhausting.']);
    const sims = sv.map((v) => vs.map((x) => x.name + ' ' + x.brollIndex.vec.reduce((a, y, i) => a + y * v[i], 0).toFixed(2)));
    return { sims, n, vecs: vs.map((x) => x.brollIndex.vec.length), sug: sug.map((g) => ({ t0: g.t0, c: g.candidates.map((c) => [c.name, c.score, c.why.join(' ')]) })) };`);
  ok('Index Media adds a 384-number meaning vector to every file', r.n === 4 && r.vecs.length === 4 && r.vecs.every((n) => n === 384), J(r));
  console.log('  similarities: ' + J(r.sims));
  const top = (t) => r.sug.find((g) => Math.abs(g.t0 - t) < 0.01)?.c[0];
  ok('Thai "the sea is beautiful, waves on the sand" suggests beach_sunset.png (by meaning)', top(1)?.[0] === 'beach_sunset.png' && /meaning/.test(top(1)[2]), J(r.sug));
  ok('"the board members sat around the conference table" suggests office_meeting.png', top(5)?.[0] === 'office_meeting.png', J(r.sug));
  ok('"climbing up to the summit" suggests mountain_hiking.png', top(10)?.[0] === 'mountain_hiking.png', J(r.sug));
  ok('unrelated files are not suggested for a sentence', r.sug.every((g) => g.c.length <= 2), J(r.sug));

  console.log('D15 Whisper Small / Medium model packs');
  // English speech from the Windows speech synthesizer (no Thai voice is installed on a stock Windows)
  const speech = out('speech_en.wav');
  spawnSync('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('Microsoft Zira Desktop'); $s.Rate = -1; $s.SetOutputToWaveFile('${speech}'); $s.Speak('The quick brown fox jumps over the lazy dog. Please call me tomorrow morning.'); $s.Dispose()`]);
  r = await js(`return E.stt.MODELS.map((m) => [m.id, m.pack || null, !!m.dtype]);`);
  ok('model list: Base (bundled), Small and Medium (download packs, 8-bit)', J(r) === J([['whisper/whisper-base', null, false], ['whisper/whisper-small', 'whisper-small', true], ['whisper/whisper-medium', 'whisper-medium', true]]), J(r));
  r = await js(`let err = null; try { await E.stt.transcribe(new Float32Array(16000), { model: 'whisper/whisper-medium' }); } catch (e) { err = String(e.message || e); } return err;`);
  ok('transcribing with a pack that is not downloaded says so (no crash, no network)', /not downloaded yet/.test(r || ''), J(r));
  r = await js(`await E.cmds.run('ai.subtitles'); await T.tick(300); const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'whisper/whisper-small'));
    if (!sel) return { sel: false }; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'whisper/whisper-small'); sel.dispatchEvent(new Event('change', { bubbles: true })); await T.tick(300);
    return { sel: true, btn: [...document.querySelectorAll('.modelpack button')].map((b) => b.textContent) };`);
  ok('choosing Whisper Small shows its Download model button', r.sel && r.btn.some((t) => /^Download model \(2\d\d MB\)$/.test(t)), J(r));
  const t15 = Date.now();
  r = await js(`let err = null; try { await E.modelPacks.downloadPack('whisper-small'); } catch (e) { err = String(e.message || e); } return { err, info: E.modelPacks.packInfo('whisper-small') };`);
  ok('Download installs Whisper Small (pinned revision, checked hashes)', r.err === null && r.info.installed && fs.existsSync(path.join(tmp, 'userData', 'models', 'whisper', 'whisper-small', 'onnx', 'encoder_model_quantized.onnx')), J(r));
  console.log(`  download took ${((Date.now() - t15) / 1000).toFixed(0)} s`);
  if (fs.existsSync(speech)) {
    const t1 = Date.now();
    r = await js(`const buf = await (await fetch('es-media://local/' + encodeURIComponent(${J(speech.replace(/\\/g, '/'))}))).arrayBuffer();
      const ctx = new OfflineAudioContext(1, 16000, 16000); const ab = await ctx.decodeAudioData(buf); const pcm = new Float32Array(ab.getChannelData(0));
      const res = await E.stt.transcribe(pcm, { model: 'whisper/whisper-small', language: 'english' }); return { text: res.words.map((w) => w.text).join(''), n: res.words.length, t: res.words.map((w) => [w.t0, w.t1]) };`);
    const low = String(r.text).toLowerCase();
    ok('Whisper Small transcribes speech with word times', ['quick', 'brown', 'fox', 'lazy', 'dog', 'tomorrow'].every((w) => low.includes(w)) && r.t.every(([a, b]) => b > a), J(r));
    console.log(`  Whisper Small: "${r.text.trim()}" in ${((Date.now() - t1) / 1000).toFixed(0)} s`);
    if (process.env.ES_E2E_MEDIUM) {
      r = await js(`let err = null; try { await E.modelPacks.downloadPack('whisper-medium'); } catch (e) { err = String(e.message || e); } return err;`);
      ok('Download installs Whisper Medium', r === null, J(r));
      r = await js(`const buf = await (await fetch('es-media://local/' + encodeURIComponent(${J(speech.replace(/\\/g, '/'))}))).arrayBuffer();
        const ctx = new OfflineAudioContext(1, 16000, 16000); const ab = await ctx.decodeAudioData(buf); const pcm = new Float32Array(ab.getChannelData(0));
        const res = await E.stt.transcribe(pcm, { model: 'whisper/whisper-medium', language: 'english' }); return res.words.map((w) => w.text).join('');`);
      ok('Whisper Medium transcribes speech', ['quick', 'fox', 'dog'].every((w) => String(r).toLowerCase().includes(w)), J(r));
    }
  } else ok('speech sample made by the Windows speech synthesizer', false, 'System.Speech did not write the file');

  console.log('D14 thumbnails of nested sequences and motion graphics templates');
  const redPng = make('red_still.png', ['-f', 'lavfi', '-i', 'color=c=red:s=160x90:d=1', '-frames:v', '1']);
  // average colour of the rendered tile of a clip (null while there is none)
  const tileOf = (clipId) => js(`for (let i = 0; i < 100; i++) { const img = [...document.querySelectorAll('.clip')].find((el) => el.dataset.clip === ${J(clipId)})?.querySelector('.thumbs.rendered img');
      if (img) { await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data;
        let r = 0, gg = 0, b = 0, lit = 0; const n = d.length / 4; for (let k = 0; k < d.length; k += 4) { r += d[k]; gg += d[k + 1]; b += d[k + 2]; if (d[k] + d[k + 1] + d[k + 2] > 120) lit++; } return { r: r / n, g: gg / n, b: b / n, lit: lit / n, w: c.width, h: c.height, src: img.src.slice(0, 22) }; }
      await T.tick(100); } return null;`);
  r = await js(`T.fresh(160, 90); E.cmds.run('view.thumbs.head'); const m = await T.imp(${J(redPng)}); const [id] = T.place(m, 0, 'V1'); E.store.set({ selection: [id] }); E.cmds.run('clip.nest'); await T.modal(); T.button('OK').click(); await T.tick(150);
    const c = E.store.getState().sequence.clips.find((x) => x.nestId); window.NEST = c && c.id; return { nest: !!c };`);
  ok('a nested sequence clip is on the timeline', r.nest, J(r));
  r = await tileOf(await js('return NEST;'));
  ok('the nested clip shows a real picture of its contents (red), not an icon', r && r.r > 180 && r.g < 60 && r.b < 60 && /^data:image\/jpeg/.test(r.src), J(r));
  r = await js(`const s = E.store.getState(); const sub = s.sequence.clips.find((x) => x.id === NEST).nestId; const main = s.sequence.id;
    E.store.switchSequence(sub); const inner = E.store.getState().sequence.clips[0].id; E.store.edit('Disable', ({ seq }) => { seq.clips.find((x) => x.id === inner).enabled = false; }); E.store.switchSequence(main); await T.tick(200); return true;`);
  r = await tileOf(await js('return NEST;'));
  ok('...an edit inside the nested sequence updates the thumbnail (the disabled red clip -> black)', r && r.r < 30, J(r));
  const lowerMogrt = out('lower.mogrt');
  spawnSync('node', [path.join(__dirname, '..', 'mogrt', 'pack_mogrt.mjs'), path.join(__dirname, '..', '..', 'test-assets', 'mogrt', 'lower'), lowerMogrt]);
  r = await js(`T.fresh(320, 180); const e = await E.mogrtLibrary.installMogrt(${J(lowerMogrt)}); await E.mogrt.addMogrtToTimeline(e.libId, 0); await T.tick(200);
    const c = E.store.getState().sequence.clips.find((x) => x.mogrt); window.MG = c && c.id; return { ok: !!c, dur: c && c.dur };`);
  ok('a motion graphics template clip is on the timeline', r.ok, J(r));
  r = await tileOf(await js('return MG;'));
  ok('the MOGRT clip shows a rendered frame of the template (lit pixels), not an icon', r && r.lit > 0.01, J(r));
  r = await js(`E.cmds.run('view.thumbs.headTail'); await T.tick(50); return true;`);

  console.log('D10 AAF: volume / gain / pan, crossfades, 5.1, video reference');
  // 5.1 file: a different tone in every channel (L 200, R 300, C 400, LFE 50, Ls 500, Rs 600 Hz)
  const six = make('six.wav', ['-f', 'lavfi', '-i', 'sine=f=200:d=3', '-f', 'lavfi', '-i', 'sine=f=300:d=3', '-f', 'lavfi', '-i', 'sine=f=400:d=3', '-f', 'lavfi', '-i', 'sine=f=50:d=3', '-f', 'lavfi', '-i', 'sine=f=500:d=3', '-f', 'lavfi', '-i', 'sine=f=600:d=3',
    '-filter_complex', '[0:a][1:a][2:a][3:a][4:a][5:a]join=inputs=6:channel_layout=5.1:map=0.0-FL|1.0-FR|2.0-FC|3.0-LFE|4.0-BL|5.0-BR[a]', '-map', '[a]', '-c:a', 'pcm_s16le']);
  const st2 = make('st2.wav', ['-f', 'lavfi', '-i', 'sine=f=440:d=4', '-ac', '2', '-c:a', 'pcm_s16le']);
  const pic = make('pic.mp4', ['-f', 'lavfi', '-i', 'testsrc=s=320x180:r=25:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
  r = await js(`T.fresh(320, 180, 25); const s6 = await T.imp(${J(six)}); const s2 = await T.imp(${J(st2)}); const v = await T.imp(${J(pic)});
    const p = await window.editorstage.probe(${J(six)});
    const [a6] = T.place(s6, 0, 'A1'); T.patch(a6, (c) => { c.dur = 2; c.volume = { level: { v: 0, keys: [{ t: 0.5, v: 0 }, { t: 1.5, v: -12 }] } }; c.audio = { ...(c.audio || {}), gain: -6 }; });
    const [x] = T.place(s2, 0, 'A2'); T.patch(x, (c) => { c.dur = 1.5; c.pan = { v: 60, keys: null }; }); const [y] = T.place(s2, 1.5, 'A2'); T.patch(y, (c) => { c.dur = 1.5; c.inPoint = 1; });
    E.store.edit('xfade', ({ seq }) => { seq.transitions = [...(seq.transitions || []), { id: 'xf1', kind: 'audio', name: 'Constant Power', track: 'A2', aId: x, bId: y, at: 1.5, dur: 0.5 }]; });
    const vids = E.store.getState().sequence.clips.filter((c) => c.track === 'V1'); for (const c of vids) E.store.edit('rm', ({ seq }) => { seq.clips = seq.clips.filter((q) => q.id !== c.id || q.mediaId === v.id); });
    const [vc] = T.place(v, 1, 'V1'); T.patch(vc, (c) => { c.inPoint = 0.4; c.dur = 2; });
    E.store.edit('noaudio', ({ seq }) => { const vv = seq.clips.find((q) => q.id === vc); seq.clips = seq.clips.filter((q) => !(q.linkId && q.linkId === vv.linkId && q.id !== vc)); });
    return { ch: p.audioChannels };`);
  ok('probe reports the channel count (5.1 file: 6)', r.ch === 6, J(r));
  const aaf2 = out('fx.aaf'); nextSave.push(aaf2);
  const log2 = await js(`await E.cmds.commands['file.exportAAF'](); return E.store.getState().log.slice(-1)[0];`);
  ok('AAF export reports 5.1 tracks and the video reference', /Exported fx\.aaf \(3 audio clips, 5\.1 tracks, 1 video clips as reference/.test(log2), log2);
  r = await js(`const f = E.interchange.readCFB(new Uint8Array(await window.editorstage.readFile(${J(aaf2)})));
    const kid = (n, name) => n && n.children.find((c) => c.name === name);
    const props = (stg) => { const d = kid(stg, 'properties').data(); const v = new DataView(d.buffer); const n = v.getUint16(2, true); const o = {}; let at = 4 + n * 6;
      for (let i = 0; i < n; i++) { const pid = v.getUint16(4 + i * 6, true), len = v.getUint16(8 + i * 6, true); o[pid] = d.slice(at, at + len); at += len; } return o; };
    const s16 = (b) => { let s = ''; for (let i = 0; i + 1 < b.length; i += 2) { const c = b[i] | (b[i + 1] << 8); if (!c) break; s += String.fromCharCode(c); } return s; };
    const cls = (s) => [...s.clsid].map((x) => x.toString(16).padStart(2, '0')).join('').slice(12, 16);
    const content = kid(kid(f.tree, 'Header-2'), 'Content-3b03'); const mobs = content.children.filter((c) => /^Mobs-1901\\{/.test(c.name));
    const comp = mobs.find((m) => cls(m) === '0035'); const slots = comp.children.filter((c) => /^Slots-4403\\{/.test(c.name)).sort((a, b) => parseInt(a.name.slice(11), 16) - parseInt(b.name.slice(11), 16));
    const names = slots.map((s) => s16(props(s)[0x4802]));
    const seg = (s) => kid(s, 'Segment-4803'); const comps = (s) => seg(s).children.filter((c) => /^Components-1001\\{/.test(c.name)).sort((a, b) => parseInt(a.name.slice(16), 16) - parseInt(b.name.slice(16), 16)).map(cls);
    const ess = content.children.filter((c) => /^EssenceData-1902\\{/.test(c.name)).map((e) => kid(e, 'Data-2702').data());
    const hz = (d) => { const n = d.length / 3; let zc = 0, prev = 0; for (let i = 0; i < n; i++) { const v = ((d[i * 3] | (d[i * 3 + 1] << 8) | (d[i * 3 + 2] << 16)) << 8 >> 8); if (i && prev < 0 && v >= 0) zc++; prev = v; } return Math.round(zc / (n / 48000)); };
    const srcNames = mobs.filter((m) => cls(m) === '0037').map((m) => s16(props(m)[0x4402]));
    const vsrc = mobs.find((m) => cls(m) === '0037' && cls(kid(m, 'EssenceDescription-4701')) === '0028');
    const url = vsrc ? s16(props(kid(kid(vsrc, 'EssenceDescription-4701'), 'Locator-2f01{0}'))[0x4001]) : null;
    return { names, a1: comps(slots[0]), a2l: comps(slots[6]), a2r: comps(slots[7]), v: comps(slots[8]), hz: ess.map(hz), srcNames, url, n: slots.length };`);
  ok('AAF: the 5.1 track breaks out to 6 mono tracks (L R C LFE Ls Rs), the stereo track to 2, then V1 + timecode', J(r.names) === J(['A1 L', 'A1 R', 'A1 C', 'A1 LFE', 'A1 Ls', 'A1 Rs', 'A2 L', 'A2 R', 'V1', 'TC1']), J(r.names));
  ok('AAF: each 5.1 channel embeds its own audio (200 / 300 / 400 / 50 / 500 / 600 Hz)', J(r.hz.slice(0, 6).map((h) => Math.round(h / 10) * 10)) === J([200, 300, 400, 50, 500, 600]), J(r.hz));
  ok('AAF: Volume keyframes + clip gain go as a Mono Audio Gain around each 5.1 clip', J(r.a1) === J(['000a']), J(r.a1));
  ok('AAF: the audio crossfade is a Transition between the two clips (Panner balance as gain on the first)', J(r.a2l) === J(['000a', '0017', '0011']) && J(r.a2r) === J(['0011', '0017', '0011']), J({ l: r.a2l, r: r.a2r }));
  ok('AAF: V1 is a video reference: filler, then the clip; the file is linked by URL, not embedded', J(r.v) === J(['0009', '0011']) && /^file:\/\/\/.*pic\.mp4$/.test(r.url || '') && r.hz.length === 10, J({ v: r.v, url: r.url, ess: r.hz.length }));
  console.log('D11 Import EDL / FCPXML with effects, color and keyframes');
  const redClip = make('red_clip.mp4', ['-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=25:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv444p', '-qp', '0']);
  const fxFile = out('graded.fcpxml');
  fs.writeFileSync(fxFile, `<?xml version="1.0" encoding="UTF-8"?>
<fcpxml version="1.9"><resources><format id="r1" frameDuration="1/25s" width="320" height="180"/>
<asset id="r2" name="red_clip" start="0s" duration="6s" hasVideo="1" hasAudio="0"><media-rep kind="original-media" src="${'file:///' + redClip.replace(/\\/g, '/')}"/></asset></resources>
<library><event name="E"><project name="Graded"><sequence format="r1" duration="4s"><spine>
<asset-clip ref="r2" offset="0s" start="1s" duration="4s" name="red_clip">
  <adjust-blend amount="0.5"><param name="amount"><keyframeAnimation><keyframe time="1s" value="0.5"/><keyframe time="3s" value="1"/></keyframeAnimation></param></adjust-blend>
  <adjust-transform scale="0.5 0.5"/>
</asset-clip></spine></sequence></project></event></library></fcpxml>`);
  r = await js(`const before = Object.keys(E.store.allSeqs()).length; const res = await E.interchange.importInterchange(${J(fxFile)}); const s = E.store.getState(); const c = s.sequence.clips.find((x) => x.track === 'V1');
    E.store.set({ playhead: 0 }); await T.tick(100);
    const a = await E.exporter.renderFrame(0, 320, 180), b = await E.exporter.renderFrame(2.5, 320, 180); const px = (img, x, y) => img.data[(y * 320 + x) * 4];
    return { res, seqs: Object.keys(E.store.allSeqs()).length - before, scale: c?.motion?.scale?.v, op: c?.opacity?.opacity, centre0: px(a, 160, 90), centre1: px(b, 160, 90), corner: px(b, 10, 10) };`);
  ok('FCPXML import brings the clip in with Opacity keyframes and Scale', r.seqs === 1 && r.scale === 50 && r.op?.v === 50 && r.op?.keys?.length === 2 && r.op.keys[1].t === 2 && r.res.withFx === 1, J(r));
  ok('...and they render: half-transparent red at the start, opaque later, scaled to half (black corner)', Math.abs(r.centre0 - 128) < 20 && r.centre1 > 235 && r.corner < 10, J(r));
  const edlFile = out('graded.edl');
  fs.writeFileSync(edlFile, ['TITLE: CDL', 'FCM: NON-DROP FRAME', '', '001  AX       V     C        00:00:00:00 00:00:02:00 01:00:00:00 01:00:02:00', '* FROM CLIP NAME: red_clip.mp4', `* SOURCE FILE: ${redClip}`, '* ASC_SOP (0.5 1 1)(0 0.2 0)(1 1 1)', '* ASC_SAT 1', ''].join('\r\n'));
  r = await js(`const res = await E.interchange.importInterchange(${J(edlFile)}); const s = E.store.getState(); const c = s.sequence.clips.find((x) => x.track === 'V1');
    const img = await E.exporter.renderFrame(0.5, s.sequence.width, s.sequence.height); const i = ((s.sequence.height >> 1) * s.sequence.width + (s.sequence.width >> 1)) * 4;
    return { res, fx: c?.effects?.map((e) => [e.name, e.effectId, e.params.sr.v, e.params.og.v]), rgb: [img.data[i], img.data[i + 1], img.data[i + 2]] };`);
  ok('EDL import: ASC_SOP / ASC_SAT become an ASC CDL effect on the clip', J(r.fx) === J([['ASC CDL', 'Video Effects/Color Correction/ASC CDL', 0.5, 0.2]]), J(r));
  ok('...and the grade renders (red slope 0.5, green offset +0.2)', Math.abs(r.rgb[0] - 128) < 20 && Math.abs(r.rgb[1] - 51) < 20 && r.rgb[2] < 20, J(r.rgb));
});
