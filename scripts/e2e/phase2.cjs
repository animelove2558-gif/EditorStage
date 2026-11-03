// Phase 2 end-to-end test. Run: npm run test:e2e
// ramp_gray.mp4: gray level = 2 x source frame number (30 fps), so one pixel tells which source frame was rendered.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { suite } = require('./harness.cjs');

suite('phase2 e2e', async ({ js, ok, A, out, frames, px, near, wavRms, nextSave, nextOpen }) => {
  const W = 160, H = 120;
  const gray = (file) => frames(file, W, H).map((f) => px(f, W, 80, 60)[0]);
  /** Export [t, t + n frames) and return the gray level of each frame. */
  const exportGray = async (name, t, n = 1) => { const f = out(`${name}.mov`); await js(`return T.exp(${JSON.stringify(f)}, 'Apple ProRes 422 (MOV)', ${W}, ${H}, ${t}, ${t} + ${n} / 30);`); return gray(f); };
  const expectSrc = (g, src, tol = 5) => Math.abs(g - 2 * src * 30) <= tol;
  const setup = async (extra = '') => js(`T.fresh(${W}, ${H}); const m = await T.imp('${A('ramp_gray.mp4')}'); window.V = T.place(m, 0)[0]; ${extra} return V;`);

  // ---------------- 2. Speed / Reverse / Time Remapping ----------------
  console.log('Speed / Reverse (Speed/Duration dialog)');
  await setup();
  await js(`E.store.set({ selection: [V] }); await E.cmds.run('clip.speed'); await T.modal();
    const inp = document.querySelector('.modal input[type=number]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '200'); inp.dispatchEvent(new Event('input', { bubbles: true })); await T.tick(); T.button('OK').click(); await T.tick(); return true;`);
  let c = await js('return T.clip(V);');
  ok('Speed 200% halves the duration', Math.abs(c.dur - 2) < 1e-6 && c.speed === 2, JSON.stringify([c.dur, c.speed]));
  let g = await exportGray('speed200', 1.0);
  ok('Speed 200%: t=1 s shows source 2 s', expectSrc(g[0], 2), g);
  await js(`E.store.set({ selection: [V] }); await E.cmds.run('clip.speed'); await T.modal(); [...document.querySelectorAll('.modal input[type=checkbox]')][0].click(); await T.tick(); T.button('OK').click(); await T.tick(); return true;`);
  c = await js('return T.clip(V);');
  ok('Reverse Speed via the dialog', c.reverse === true && Math.abs(c.inPoint - 4) < 1e-6, JSON.stringify([c.reverse, c.inPoint]));
  g = await exportGray('reverse', 0.5, 2);
  ok('reverse 200%: t=0.5 s shows source 3 s, then earlier frames', expectSrc(g[0], 3) && g[1] < g[0], g);
  await js('E.store.undo(); return true;');
  ok('undo un-reverses', !(await js('return T.clip(V).reverse;')));

  console.log('Time Remapping ramp');
  await setup(`T.patch(V, (c) => { c.timeRemap = { speed: { v: 100, keys: [{ t: 0, v: 100 }, { t: 2, v: 300 }] } }; });`);
  g = await exportGray('ramp', 1.5);
  ok('ramp 100->300%: t=1.5 s shows source 2.625 s', expectSrc(g[0], 2.625), g);
  // Preview: the playback element is seeked to the same source time
  const pv = await js(`E.store.set({ playhead: 1.5, playing: false }); await T.tick(400); const el = E.media.elementForClip(T.clip(V)); return el.currentTime;`);
  ok('Preview element shows the same source time', Math.abs(pv - 2.625) < 0.02, pv);
  // splitting a ramped clip keeps every frame
  const before = await exportGray('ramp_before', 0.4, 50);
  await js(`E.store.set({ playhead: 1.1 }); E.cmds.addEdit(1.1); return true;`);
  const after = await exportGray('ramp_after', 0.4, 50);
  ok('split inside the ramp changes no frame', before.length === after.length && before.every((v, i) => Math.abs(v - after[i]) <= 2), JSON.stringify(before.map((v, i) => v - after[i]).filter((d) => d)));
  ok('split keeps the ramp keys on the right part', await js(`const cs = E.store.getState().sequence.clips.filter((c) => c.track === 'V1').sort((a, b) => a.start - b.start); return cs.length === 2 && !!cs[1].timeRemap.speed.keys && cs[1].timeRemap.speed.keys[0].t === 0;`));

  console.log('Speed curve presets');
  await setup();
  const bullet = await js(`E.store.set({ selection: [V] }); E.cmds.run('panel.effectControls'); await T.tick(300);
    const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'Bullet')); if (!sel) return null;
    sel.value = 'Bullet'; sel.dispatchEvent(new Event('change', { bubbles: true })); await T.tick(); const c = T.clip(V);
    return { dur: c.dur, curve: c.speedCurve, keys: c.timeRemap?.speed?.keys?.length };`);
  ok('Effect Controls > Speed Curve: Bullet applied', bullet && bullet.curve === 'Bullet' && bullet.keys === 4, JSON.stringify(bullet));
  if (bullet) {
    g = await exportGray('bullet_end', bullet.dur - 1 / 30);
    ok('Bullet keeps the whole source range (last frame ~ source end)', expectSrc(g[0], 4 - 1 / 30, 9), g);
  }

  console.log('Frame Blending');
  await js(`T.fresh(${W}, ${H}); const m = await T.imp('${A('blink.mp4')}'); const [v] = T.place(m, 0); window.V = v; T.patch(v, (c) => { c.speed = 0.5; c.dur = 4; }); return true;`);
  const sampled = await exportGray('blink_sample', 1 / 30, 1); // source frame 0.5 -> frame 0 (black)
  await js(`T.patch(V, (c) => { c.frameSampling = 'blend'; }); return true;`);
  const blended = await exportGray('blink_blend', 1 / 30, 1);
  ok('Frame Sampling shows a whole frame', sampled[0] < 20 || sampled[0] > 235, sampled);
  ok('Frame Blending mixes the two frames (mid gray)', Math.abs(blended[0] - 128) < 30, blended);

  console.log('Retimed audio');
  const freq = (pcm, sr = 48000) => { let z = 0; for (let i = 1; i < pcm.length / 2; i++) if ((pcm[2 * (i - 1)] < 0) !== (pcm[2 * i] < 0)) z++; return z / 2 / (pcm.length / 2 / sr); };
  const tone = await js(`T.fresh(${W}, ${H}); const m = await T.imp('${A('left_tone.wav')}'); const [a] = T.place(m, 0); window.AU = a;
    T.patch(a, (c) => { c.speed = 2; c.dur = 1; }); const p1 = Array.from(await T.pcm(0.1, 0.9));
    T.patch(a, (c) => { c.maintainPitch = true; }); const p2 = Array.from(await T.pcm(0.1, 0.9)); return { p1, p2 };`);
  const f1 = freq(tone.p1), f2 = freq(tone.p2);
  ok('speed 200% without Maintain Pitch: 880 Hz', Math.abs(f1 - 880) < 15, f1.toFixed(1));
  ok('speed 200% with Maintain Audio Pitch: 440 Hz', Math.abs(f2 - 440) < 15, f2.toFixed(1));
  const rev = await js(`T.fresh(${W}, ${H}); const m = await T.imp('${A('ramp_tone.wav')}'); const [a] = T.place(m, 0);
    const rms = async (x, y) => (await T.mix(x, y))[0]; const fwd = [await rms(0.2, 1), await rms(3, 3.8)];
    E.store.set({ selection: [a] }); E.store.edit('rev', ({ seq }) => E.editing.setSpeed(seq, [a], { speed: 100, reverse: true }));
    return { fwd, rev: [await rms(0.2, 1), await rms(3, 3.8)] };`);
  ok('reverse audio: loud end now plays first', rev.fwd[0] < rev.fwd[1] * 0.5 && rev.rev[0] > rev.rev[1] * 2, JSON.stringify(rev));

  // ---------------- 3. Freeze Frame ----------------
  console.log('Freeze Frame');
  await setup(`E.store.set({ playhead: 1, selection: [] });`);
  await js(`await E.cmds.run('clip.addFrameHold'); return true;`);
  g = await exportGray('addhold', 3);
  ok('Add Frame Hold: after the playhead the frame at 1 s stays', expectSrc(g[0], 1), g);
  g = await exportGray('addhold_before', 0.5);
  ok('Add Frame Hold: before the playhead plays normally', expectSrc(g[0], 0.5), g);
  await setup(`E.store.set({ playhead: 1, selection: [] });`);
  await js(`await E.cmds.run('clip.insertFrameHold'); return true;`);
  const end = await js('return E.editing.sequenceEnd(E.store.getState().sequence);');
  ok('Insert Frame Hold Segment adds 2 s', Math.abs(end - 6) < 1e-6, end);
  g = await exportGray('inshold', 2.5); ok('held segment shows the frame at 1 s', expectSrc(g[0], 1), g);
  g = await exportGray('inshold_after', 3.5); ok('material after the segment is pushed by 2 s', expectSrc(g[0], 1.5), g);
  await js('E.store.undo(); return true;');
  ok('undo removes the segment', Math.abs((await js('return E.editing.sequenceEnd(E.store.getState().sequence);')) - 4) < 1e-6);

  const png = out('frame.png'); nextSave.push(png);
  await js(`E.store.set({ playhead: 2 }); await E.cmds.run('file.exportFrame'); await T.modal(); T.button('OK').click(); for (let i = 0; i < 100 && document.querySelector('.modal'); i++) await T.tick(50); return true;`);
  ok('Export Frame writes a PNG', fs.existsSync(png));
  if (fs.existsSync(png)) { const [f] = frames(png, W, H); ok('Export Frame shows the frame at the playhead', expectSrc(px(f, W, 80, 60)[0], 2), px(f, W, 80, 60)); }

  // ---------------- 4. File > New synthetic items ----------------
  console.log('File > New synthetic items');
  const W2 = 160, H2 = 120;
  const exp1 = async (name, t) => { const f = out(`${name}.mov`); await js(`return T.exp(${JSON.stringify(f)}, 'Apple ProRes 422 (MOV)', ${W2}, ${H2}, ${t}, ${t} + 1 / 30);`); return frames(f, W2, H2)[0]; };
  // the dialog (sets the color through the real input) creates a project item; place it like any other item
  const newItem = (cmd, color) => js(`T.fresh(${W2}, ${H2}); await E.cmds.run('${cmd}'); await T.modal();
    ${color ? `const inp = document.querySelector('.modal input[type=color]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '${color}'); inp.dispatchEvent(new Event('input', { bubbles: true })); await T.tick();` : ''}
    T.button('OK').click(); await T.tick(); const s = E.store.getState(); const m = s.media[s.media.length - 1]; window.SM = m; window.SV = T.place(m, 0, 'V1'); return m;`);
  let m = await newItem('file.newColorMatte', '#ff8000');
  ok('Color Matte item created (no file, sequence size)', m.synthetic?.type === 'color' && !m.path && m.width === W2 && m.synthetic.color === '#ff8000', JSON.stringify(m.synthetic));
  let f = await exp1('matte', 1);
  ok('Color Matte exports its color', near(px(f, W2, 80, 60), [255, 128, 0], 10), px(f, W2, 80, 60));
  ok('Color Matte is a still (any length)', await js(`T.patch(SV[0], (c) => { c.dur = 60; }); return T.clip(SV[0]).dur === 60;`));

  m = await newItem('file.newBarsAndTone');
  ok('Bars and Tone: video + linked audio clip', (await js('return SV.length;')) === 2 && m.hasAudio);
  f = await exp1('bars', 1);
  ok('Bars: 75% gray and blue bars', near(px(f, W2, 8, 30), [191, 191, 191], 10) && near(px(f, W2, 152, 30), [0, 0, 191], 14), JSON.stringify([px(f, W2, 8, 30), px(f, W2, 152, 30)]));
  let rms = await js('return T.mix(0.5, 1.5);');
  ok('Bars: 1 kHz tone at -12 dBFS (RMS 0.178)', Math.abs(rms[0] - 0.178) < 0.01, JSON.stringify(rms));

  m = await newItem('file.newCountdown');
  f = await exp1('leader_a', 0.5);
  const right = px(f, W2, 140, 40), left = px(f, W2, 20, 40);
  ok('Counting Leader: the wipe has covered the right half at 0.5 s', right[0] > left[0] + 30, JSON.stringify([right, left]));
  f = await exp1('leader_black', 7.5);
  ok('Counting Leader: black after the 2', px(f, W2, 80, 60)[0] < 12, px(f, W2, 80, 60));
  const blip = await js('return [await T.mix(6, 6 + 1 / 30), await T.mix(3, 5.9)];');
  ok('Counting Leader: cue blip on 2 only', blip[0][0] > 0.2 && blip[1][0] < 0.001, JSON.stringify(blip));

  console.log('Adjustment Layer / Transparent Video');
  await js(`T.fresh(${W2}, ${H2}); const s0 = E.store.getState();
    const mk = async (cmd, color) => { await E.cmds.run(cmd); await T.modal(); if (color) { const inp = document.querySelector('.modal input[type=color]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, color); inp.dispatchEvent(new Event('input', { bubbles: true })); await T.tick(); } T.button('OK').click(); await T.tick(); const s = E.store.getState(); return s.media[s.media.length - 1]; };
    const matte = await mk('file.newColorMatte', '#c83214'); T.place(matte, 0, 'V1');
    E.store.edit('track', ({ seq }) => { E.cmds.addTrackTo(seq, 'video'); E.cmds.addTrackTo(seq, 'video'); });
    const adj = await mk('file.newAdjustmentLayer'); window.ADJ = T.place(adj, 0, 'V2')[0];
    const tr = await mk('file.newTransparentVideo'); window.TR = T.place(tr, 0, 'V3')[0];
    E.dnd.applyEffectToClips([ADJ], { effectName: 'Invert', media: 'video', category: 'Video', folder: 'Channel' }); return true;`);
  f = await exp1('adjust', 1);
  ok('Adjustment Layer inverts the tracks below (transparent video on top shows through)', near(px(f, W2, 80, 60), [55, 205, 235], 12), px(f, W2, 80, 60));
  await js(`T.patch(ADJ, (c) => { c.opacity = { opacity: { v: 50, keys: null } }; }); return true;`);
  f = await exp1('adjust50', 1);
  ok('Adjustment Layer opacity 50% mixes with the original', near(px(f, W2, 80, 60), [128, 128, 128], 14), px(f, W2, 80, 60));
  await js('E.store.undo(); E.store.undo(); return true;');
  f = await exp1('adjust_undo', 1);
  ok('undo removes the effect', near(px(f, W2, 80, 60), [200, 50, 20], 12), px(f, W2, 80, 60));
  await js('E.store.redo(); E.store.redo(); return true;');
  // save -> reopen: synthetic items regenerate from the project file
  const proj = out('synthetic.esproj'); nextSave.push(proj); nextOpen.push(proj);
  await js(`E.store.set({ projectPath: null }); await E.cmds.run('file.saveAs'); await T.tick(200); E.store.resetProject(); await E.cmds.run('file.open'); await T.tick(300); return true;`);
  f = await exp1('adjust_reopen', 1);
  ok('save / reopen keeps the synthetic items and the adjustment', near(px(f, W2, 80, 60), [128, 128, 128], 14), px(f, W2, 80, 60));

  // ---------------- 5. Mask Tracking / Point Tracker ----------------
  console.log('Mask Tracking');
  const BW = 320, BH = 180; const at = (t) => [(70 + 40 * t) / BW, (90 + 10 * t) / BH];
  const waitTrack = 'for (let i = 0; i < 600 && E.store.getState().tracking !== null && E.store.getState().tracking !== undefined; i++) await T.tick(50); await T.tick(100);';
  await js(`T.fresh(${BW}, ${BH}); const m = await T.imp('${A('moving_box.mp4')}'); window.V = T.place(m, 0, 'V1')[0];
    T.patch(V, (c) => { c.masks = [{ id: 'mk1', type: 'ellipse', enabled: true, params: { center: { v: [${70 / BW}, ${90 / BH}], keys: null }, size: { v: [${50 / BW}, ${50 / BH}], keys: null }, feather: { v: 0, keys: null }, opacity: { v: 100, keys: null }, invert: { v: false, keys: null } } }]; });
    E.store.set({ selection: [V], playhead: 0 }); E.cmds.run('panel.effectControls'); await T.tick(300); return true;`);
  const clicked = await js(`const b = document.querySelector('button[title="Track selected mask forward"]'); if (!b) return false; b.click(); await T.tick(200); ${waitTrack} return true;`);
  ok('Mask path ▶▶ (Track Forward) button', clicked);
  const mk = await js(`return T.clip(V).masks[0].params.center;`);
  const k3 = mk.keys && mk.keys.find((k) => Math.abs(k.t - 3) < 1e-6);
  ok('mask tracked to the end of the clip (one key per frame)', mk.keys && mk.keys.length >= 115, mk.keys && mk.keys.length);
  ok('tracked mask centre at 3 s follows the box (±1.5 px)', k3 && Math.abs(k3.v[0] - at(3)[0]) * BW < 1.5 && Math.abs(k3.v[1] - at(3)[1]) * BH < 1.5, JSON.stringify(k3 && [k3.v[0] * BW, k3.v[1] * BH]));
  f = await (async () => { const fl = out('masktrack.mov'); await js(`return T.exp(${JSON.stringify(fl)}, 'Apple ProRes 422 (MOV)', ${BW}, ${BH}, 3, 3 + 1 / 30);`); return frames(fl, BW, BH)[0]; })();
  ok('export: the mask shows the box at its new place, hides the old place', px(f, BW, 190, 120)[0] > 40 && px(f, BW, 70, 90)[0] < 8, JSON.stringify([px(f, BW, 190, 120), px(f, BW, 70, 90)]));
  await js('E.store.undo(); return true;');
  ok('undo removes the tracked keyframes', !(await js('return T.clip(V).masks[0].params.center.keys;')));
  await js(`T.patch(V, (c) => { c.masks[0].params.center = { v: [${at(2)[0]}, ${at(2)[1]}], keys: null }; }); E.store.set({ playhead: 2 }); await E.tracking.trackMask(V, 'mk1', -1, 1, 'position'); return true;`);
  const one = await js('return T.clip(V).masks[0].params.center.keys;');
  ok('frame-by-frame backward writes 2 keys (2 s and 2 s - 1 frame)', one && one.length === 2 && Math.abs(one[0].t - (2 - 1 / 30)) < 1e-6 && Math.abs(one[0].v[0] - at(2 - 1 / 30)[0]) * BW < 1, JSON.stringify(one));
await js('E.store.undo(); return true;');
  await js('E.store.undo(); return true;');

  console.log('Point Tracker (Track Object)');
  await js(`const s0 = E.store.getState(); await E.cmds.run('file.newColorMatte'); await T.modal();
    const inp = document.querySelector('.modal input[type=color]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '#00ff00'); inp.dispatchEvent(new Event('input', { bubbles: true })); await T.tick();
    T.button('OK').click(); await T.tick(); const s = E.store.getState(); const mt = s.media[s.media.length - 1];
    window.FOL = T.place(mt, 0, 'V2')[0]; T.patch(FOL, (c) => { c.dur = 4; c.motion = { position: { v: [${70 / BW}, ${90 / BH}], keys: null }, scale: { v: 6, keys: null } }; });
    E.store.set({ selection: [FOL], playhead: 0 }); await E.cmds.run('clip.trackObject'); await T.modal();
    const sel = [...document.querySelectorAll('.modal select')][1]; sel.value = '1'; sel.dispatchEvent(new Event('change', { bubbles: true })); await T.tick();
    T.button('Track').click(); await T.tick(200); for (let i = 0; i < 600 && document.querySelector('.modal'); i++) await T.tick(50); return true;`);
  const pos = await js('return T.clip(FOL).motion.position;');
  const p3 = pos.keys && pos.keys.find((k) => Math.abs(k.t - 3) < 1e-6);
  ok('Track Object writes Position keyframes that follow the box', p3 && Math.abs(p3.v[0] - at(3)[0]) * BW < 1.5 && Math.abs(p3.v[1] - at(3)[1]) * BH < 1.5, JSON.stringify(p3 && [p3.v[0] * BW, p3.v[1] * BH]));
  const sticker = async (name, t) => { const fl = out(`${name}.mov`); await js(`return T.exp(${JSON.stringify(fl)}, 'Apple ProRes 422 (MOV)', ${BW}, ${BH}, ${t}, ${t} + 1 / 30);`); return frames(fl, BW, BH)[0]; };
  f = await sticker('follow', 3);
  ok('export: the follower sits on the box at 3 s', near(px(f, BW, 190, 120), [0, 255, 0], 30), px(f, BW, 190, 120));
  // a split keeps every keyframe on its frame (keys of the right part are shifted)
  const fb = await sticker('follow_before', 2.5);
  await js(`E.store.set({ playhead: 1.5, selection: [] }); E.cmds.addEdit(1.5); return true;`);
  const fa = await sticker('follow_after', 2.5);
  ok('split keeps the tracked motion (right part keys shifted)', near(px(fa, BW, 170, 115), px(fb, BW, 170, 115), 6) && near(px(fa, BW, 170, 115), [0, 255, 0], 30), JSON.stringify([px(fb, BW, 170, 115), px(fa, BW, 170, 115)]));

  // ---------------- 6. Color ----------------
  console.log('Color: LUTs');
  // Input LUT (.cube, swap red/blue) and Creative Look (.3dl, invert) with Intensity
  const cube = ['LUT_3D_SIZE 2']; for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) cube.push(`${b} ${g} ${r}`);
  fs.writeFileSync(out('swap.cube'), cube.join('\n'));
  const tdl = ['0 1023']; for (let r = 0; r < 2; r++) for (let g = 0; g < 2; g++) for (let b = 0; b < 2; b++) tdl.push(`${1023 - r * 1023} ${1023 - g * 1023} ${1023 - b * 1023}`);
  fs.writeFileSync(out('invert.3dl'), tdl.join('\n'));
  const lutP = (n) => JSON.stringify(out(n));
  await js(`T.fresh(${W2}, ${H2}); await E.cmds.run('file.newColorMatte'); await T.modal();
    const inp = document.querySelector('.modal input[type=color]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '#c83214'); inp.dispatchEvent(new Event('input', { bubbles: true })); await T.tick();
    T.button('OK').click(); await T.tick(); const s = E.store.getState(); window.MV = T.place(s.media[s.media.length - 1], 0, 'V1')[0];
    T.patch(MV, (c) => { c.lumetri = { inputLut: { path: ${lutP('swap.cube')}, name: 'swap.cube' } }; }); return true;`);
  f = await exp1('inlut', 1);
  ok('Input LUT (.cube) applied on the first exported frame', near(px(f, W2, 80, 60), [20, 50, 200], 10), px(f, W2, 80, 60));
  await js(`T.patch(MV, (c) => { c.lumetri = { lut: { path: ${lutP('invert.3dl')}, name: 'invert.3dl' }, lutAmt: 100 }; }); return true;`);
  f = await exp1('look', 1);
  ok('Creative Look (.3dl)', near(px(f, W2, 80, 60), [55, 205, 235], 10), px(f, W2, 80, 60));
  await js(`T.patch(MV, (c) => { c.lumetri.lutAmt = 50; }); return true;`);
  f = await exp1('look50', 1);
  ok('Look Intensity 50%', near(px(f, W2, 80, 60), [128, 128, 128], 10), px(f, W2, 80, 60));

  console.log('Color: Auto Tone / Auto Color / Color Match');
  const lumetri = async (img, action) => js(`T.fresh(${W2}, ${H2}); const m = await T.imp('${A(img)}'); window.CV = T.place(m, 0, 'V1')[0];
    E.store.set({ selection: [CV], playhead: 1 }); E.cmds.run('panel.lumetriColor'); await T.tick(300);
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '${action}'); if (!b) return null; b.click();
    for (let i = 0; i < 200 && !T.clip(CV).lumetri; i++) await T.tick(50); await T.tick(100); return T.clip(CV).lumetri;`);
  const spread = (fr) => px(fr, W2, 150, 60)[1] - px(fr, W2, 8, 60)[1];
  const flat0 = await exp1('flat0', 1);
  const at1 = await lumetri('flat.png', 'Auto Tone');
  f = await exp1('flat_auto', 1);
  ok('Auto Tone (Lumetri button) widens a flat image', at1 && spread(f) > spread(flat0) * 1.8, JSON.stringify({ at1, before: spread(flat0), after: spread(f) }));
  const cast0 = await (async () => { await js(`T.fresh(${W2}, ${H2}); const m = await T.imp('${A('cast.png')}'); T.place(m, 0, 'V1'); return true;`); return exp1('cast0', 1); })();
  const ac1 = await lumetri('cast.png', 'Auto Color');
  f = await exp1('cast_auto', 1);
  const bias = (fr) => Math.abs(px(fr, W2, 80, 60)[2] - px(fr, W2, 80, 60)[0]);
  ok('Auto Color removes the blue cast', ac1 && ac1.temperature > 0 && bias(f) < bias(cast0) * 0.5, JSON.stringify({ t: ac1 && [ac1.temperature, ac1.tint], before: px(cast0, W2, 80, 60), after: px(f, W2, 80, 60) }));
  const cm = await js(`T.fresh(${W2}, ${H2}); const a = await T.imp('${A('neutral.png')}'); const b = await T.imp('${A('warm.png')}');
    const [r] = T.place(a, 0, 'V1'); const [t] = T.place(b, 5, 'V1'); window.REF = r; window.TGT = t;
    E.store.set({ selection: [t], playhead: 7 }); E.cmds.run('panel.lumetriColor'); await T.tick(300);
    const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === r)); sel.value = r; sel.dispatchEvent(new Event('change', { bubbles: true })); await T.tick();
    [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Apply Match').click();
    for (let i = 0; i < 300 && !T.clip(t).lumetri; i++) await T.tick(50); await T.tick(100); return T.clip(t).lumetri;`);
  const refF = await exp1('cm_ref', 1), tgt0 = await (async () => { await js('E.store.undo(); return true;'); return exp1('cm_before', 7); })();
  await js('E.store.redo(); return true;');
  const tgtF = await exp1('cm_after', 7);
  const d = (a, b, x, y) => { const p = px(a, W2, x, y), q = px(b, W2, x, y); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
  ok('Color Match (Apply Match) brings the shot close to the reference', cm && d(tgtF, refF, 120, 60) < d(tgt0, refF, 120, 60) * 0.5 && d(tgtF, refF, 60, 100) < d(tgt0, refF, 60, 100) * 0.6,
    JSON.stringify({ cm, skin: [px(refF, W2, 120, 60), px(tgt0, W2, 120, 60), px(tgtF, W2, 120, 60)], bg: [px(refF, W2, 60, 100), px(tgt0, W2, 60, 100), px(tgtF, W2, 60, 100)] }));

  console.log('Lumetri Scopes');
  const scopes = await js(`T.fresh(${W2}, ${H2}); await E.cmds.run('file.newColorMatte'); await T.modal();
    const inp = document.querySelector('.modal input[type=color]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '#bf0000'); inp.dispatchEvent(new Event('input', { bubbles: true })); await T.tick();
    T.button('OK').click(); await T.tick(); const s = E.store.getState(); T.place(s.media[s.media.length - 1], 0, 'V1'); E.store.set({ playhead: 1 });
    E.cmds.run('panel.lumetriScopes'); await T.tick(400); const out = {};
    for (const label of ['Waveform (Luma)', 'RGB Parade', 'Histogram', 'Vectorscope YUV']) {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === label); if (!b) { out[label] = 'no button'; continue; } b.click();
      const cv = document.querySelector('canvas.scope'); const f0 = +(cv.dataset.frames || 0); for (let i = 0; i < 40 && (+(cv.dataset.frames || 0) < f0 + 2 || cv.dataset.mode !== ({ 'Waveform (Luma)': 'waveform', 'RGB Parade': 'parade', Histogram: 'histogram', 'Vectorscope YUV': 'vectorscope' })[label]); i++) await T.tick(50);
      const g = cv.getContext('2d'); const d = g.getImageData(0, 0, cv.width, cv.height).data; let lit = 0, red = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; if (d[i] > 150 && d[i + 1] < 120) red++; }
      // probe the expected trace position for a 75% red frame
      const H = cv.height, W = cv.width; const at = (x, y) => { const p = g.getImageData(Math.round(x), Math.round(y), 1, 1).data; return p[0] + p[1] + p[2]; };
      out[label] = { lit, red, probe: label === 'RGB Parade' ? at(W / 6, H - (191 / 255) * H) : label === 'Waveform (Luma)' ? at(W / 2, H - ((0.2126 * 191) / 255) * H) : label === 'Vectorscope YUV' ? at(W / 2 + (-0.169 * 0.75) * 2 * (H / 2 - 8), H / 2 - (0.5 * 0.75) * 2 * (H / 2 - 8)) : 0 };
    }
    return out;`);
  ok('Scopes: Waveform shows the luma level', scopes['Waveform (Luma)'].probe > 60, JSON.stringify(scopes['Waveform (Luma)']));
  ok('Scopes: RGB Parade shows red at 75%', scopes['RGB Parade'].probe > 60, JSON.stringify(scopes['RGB Parade']));
  ok('Scopes: Histogram draws', scopes.Histogram.lit > 50, JSON.stringify(scopes.Histogram));
  ok('Scopes: Vectorscope dot on the red target', scopes['Vectorscope YUV'].probe > 100, JSON.stringify(scopes['Vectorscope YUV']));

  // ---------------- 7. Scene Edit Detection ----------------
  console.log('Scene Edit Detection');
  const sd = await js(`T.fresh(320, 240); const m = await T.imp('${A('rgb_seconds.mp4')}'); const ids = T.place(m, 2, 'V1');
    E.store.set({ selection: ids }); await E.cmds.run('clip.sceneEditDetection'); await T.modal();
    const cb = [...document.querySelectorAll('.modal input[type=checkbox]')]; cb[1].click(); cb[2].click(); await T.tick();
    T.button('Analyze').click(); for (let i = 0; i < 400 && document.querySelector('.modal'); i++) await T.tick(50);
    const s = E.store.getState(); const v = s.sequence.clips.filter((c) => c.track === 'V1').sort((a, b) => a.start - b.start);
    const a = s.sequence.clips.filter((c) => c.track === 'A1').sort((a, b) => a.start - b.start);
    return { v: v.map((c) => [c.start, c.dur, c.inPoint]), a: a.map((c) => [c.start, c.dur]), linked: v.every((c, i) => a[i] && c.linkId && c.linkId === a[i].linkId), markers: s.sequence.markers.map((x) => x.time), subs: s.media.filter((x) => x.subclip).map((x) => [x.subclip.in, x.subclip.out]) };`);
  const near2 = (x, y) => Math.abs(x - y) < 0.04;
  ok('Scene Edit Detection cuts at the two scene changes (1 s and 2 s of the source)', sd.v.length === 3 && near2(sd.v[1][0], 3) && near2(sd.v[2][0], 4) && near2(sd.v[1][2], 1), JSON.stringify(sd.v));
  ok('linked audio is cut too and stays linked', sd.a.length === 3 && sd.linked, JSON.stringify(sd.a));
  ok('markers at the cuts', sd.markers.length === 2 && near2(sd.markers[0], 3) && near2(sd.markers[1], 4), JSON.stringify(sd.markers));
  ok('a subclip per scene', sd.subs.length === 3 && near2(sd.subs[1][0], 1) && near2(sd.subs[1][1], 2), JSON.stringify(sd.subs));
  await js('E.store.undo(); E.store.undo(); E.store.undo(); return true;');
  ok('undo (3 steps) restores the single clip', (await js("return E.store.getState().sequence.clips.filter((c) => c.track === 'V1').length;")) === 1);

  // ---------------- 8. Text-Based Editing ----------------
  console.log('Text-Based Editing');
  // rgb_seconds.mp4: red 0-1 s, green 1-2 s, blue 2-3 s. A transcript in source seconds (as Whisper would store it) is attached to the item.
  const words = [['Hello', 0.1, 0.4], [' um', 0.45, 0.6], [' red', 0.65, 0.95], [' green', 1.1, 1.4], [' แบบ', 1.5, 1.6], ['ว่า', 1.6, 1.7], [' blue', 2.1, 2.5], [' end', 2.6, 2.9]];
  const tb = await js(`T.fresh(320, 240); const m = await T.imp('${A('rgb_seconds.mp4')}'); T.place(m, 0, 'V1');
    E.store.edit('t', ({ media }) => { media.find((x) => x.id === m.id).transcript = { words: ${JSON.stringify(words.map(([text, t0, t1]) => ({ text, t0, t1 })))}, language: 'english' }; });
    E.cmds.run('panel.text'); await T.tick(300);
    const ws = [...document.querySelectorAll('.transcript .w')]; return { n: ws.length, text: ws.map((w) => w.textContent).join('') };`);
  ok('Text panel shows the sequence transcript', tb.n === 8 && tb.text.startsWith('Hello um red'), JSON.stringify(tb));
  const searched = await js(`const inp = document.querySelector('.textpanel input[placeholder="Search transcript"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, 'gre'); inp.dispatchEvent(new Event('input', { bubbles: true })); await T.tick();
    return [...document.querySelectorAll('.transcript .w.hit')].map((w) => w.textContent);`);
  ok('search highlights the matching word', searched.length === 1 && searched[0] === ' green', JSON.stringify(searched));
  // select "green" and press Delete: 1.1..1.4 s is ripple-deleted on every track
  await js(`const w = [...document.querySelectorAll('.transcript .w')].find((x) => x.textContent === ' green'); w.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await T.tick();
    document.querySelector('.textpanel').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); await T.tick(100); return true;`);
  let tl = await js(`const s = E.store.getState(); return { end: E.editing.sequenceEnd(s.sequence), words: E.transcript.sequenceWords().map((w) => w.text).join('') };`);
  ok('Delete text ripples the timeline (video + audio)', Math.abs(tl.end - 2.7) < 0.02 && !tl.words.includes('green'), JSON.stringify(tl));
  f = await (async () => { const fl = out('text_del.mov'); await js(`return T.exp(${JSON.stringify(fl)}, 'Apple ProRes 422 (MOV)', 320, 240, 1.15, 1.15 + 1 / 30);`); return frames(fl, 320, 240)[0]; })();
  ok('after the delete, 1.15 s shows source 1.45 s (green)', near(px(f, 320, 160, 120), [0, 255, 0], 40), px(f, 320, 160, 120));
  await js('E.store.undo(); return true;');
  // fillers: "um" and "แบบว่า" (two Whisper words) are removed in one step
  const fl = await js(`const ws = E.transcript.sequenceWords(); const f = E.transcript.findFillers(ws); E.transcript.removeFillers(ws); return { found: f, end: E.editing.sequenceEnd(E.store.getState().sequence), words: E.transcript.sequenceWords().map((w) => w.text).join('') };`);
  ok('filler words (um, แบบว่า across 2 words) removed', fl.found.length === 2 && !fl.words.includes('um') && !fl.words.includes('แบบ') && Math.abs(fl.end - (3 - 0.15 - 0.2)) < 0.04, JSON.stringify(fl));
  await js('E.store.undo(); return true;');
  // move: cut "blue" and paste before "Hello"
  const mv = await js(`const ws = E.transcript.sequenceWords(); const i = ws.findIndex((w) => w.text === ' blue'); E.transcript.moveWords(ws, i, i, 0);
    return { words: E.transcript.sequenceWords().map((w) => w.text).join(''), end: E.editing.sequenceEnd(E.store.getState().sequence) };`);
  ok('moving text moves the media (blue now first)', mv.words.startsWith(' blueHello') && Math.abs(mv.end - 3) < 0.02, JSON.stringify(mv));
  f = await (async () => { const p2 = out('text_move.mov'); await js(`return T.exp(${JSON.stringify(p2)}, 'Apple ProRes 422 (MOV)', 320, 240, 0.1, 0.1 + 1 / 30);`); return frames(p2, 320, 240)[0]; })();
  ok('export after the move starts with blue', near(px(f, 320, 160, 120), [0, 0, 255], 40), px(f, 320, 160, 120));
  await js('E.store.undo(); return true;');
  const wt = await js(`T.fresh(320, 240); const m = await T.imp('${A('left_tone.wav')}'); T.place(m, 0, 'A1'); const t0 = Date.now();
    const n = await E.transcript.transcribeSequence({}, () => {}); const tr = E.media.mediaById(m.id).transcript; return { n, ok: !!tr && Array.isArray(tr.words), secs: (Date.now() - t0) / 1000 };`);
  ok('Transcribe runs the offline Whisper model and stores the transcript on the item', wt.n === 1 && wt.ok, JSON.stringify(wt));

  // ---------------- 9. Proxy Workflow ----------------
  console.log('Proxy Workflow');
  const pdir = out('proxsrc'); fs.mkdirSync(pdir, { recursive: true }); const psrc = path.join(pdir, 'ramp.mp4'); fs.copyFileSync(path.join(__dirname, '..', '..', 'test-assets', 'e2e', 'ramp_gray.mp4'), psrc);
  const J = (x) => JSON.stringify(x);
  const pr = await js(`T.fresh(${W}, ${H}); const m = await T.imp(${J(psrc)}); window.PM = m.id; window.V = T.place(m, 0, 'V1')[0];
    E.store.set({ selectedMedia: m.id }); await E.cmds.run('media.createProxies'); await T.modal(); T.button('OK').click();
    for (let i = 0; i < 400 && E.media.mediaById(m.id).proxy?.status !== 'ready'; i++) await T.tick(50); return E.media.mediaById(m.id).proxy;`);
  const proxyFile = path.join(pdir, 'Proxies', 'ramp_Proxy.mp4');
  ok('Create Proxies writes an H.264 proxy next to the source (background job)', pr && pr.status === 'ready' && fs.existsSync(proxyFile), J(pr));
  // a proxy that looks different (white) proves which file each path uses
  const white = out('white_proxy.mp4'); spawnSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=white:s=${W}x${H}:r=30:d=4`, '-pix_fmt', 'yuv420p', white]);
  const short = out('short_proxy.mp4'); spawnSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=white:s=${W}x${H}:r=30:d=1`, '-pix_fmt', 'yuv420p', short]);
  nextOpen.push(short);
  const bad = await js(`const before = E.store.getState().log.length; await E.cmds.run('media.attachProxy'); await T.tick(200); return E.store.getState().log.slice(before).join(' | ');`);
  ok('Attach Proxies refuses a file of another length', /long but the original/.test(bad), bad);
  nextOpen.push(white);
  await js(`await E.cmds.run('media.attachProxy'); await T.tick(200); return true;`);
  const pv2 = await js(`E.cmds.run('view.toggleProxies'); E.store.set({ playhead: 1, playing: false }); await T.tick(500); const el = E.media.elementForClip(T.clip(V)); return { src: decodeURIComponent(el.src), on: E.store.getState().useProxies };`);
  ok('Toggle Proxies: the Program Monitor plays the proxy', pv2.on && /white_proxy/.test(pv2.src), J(pv2));
  g = await exportGray('proxy_export', 1);
  ok('Export with proxies on still renders the full-resolution original', expectSrc(g[0], 1), g);
  const pv3 = await js(`await T.tick(300); E.store.set({ playhead: 1.2 }); await T.tick(500); return decodeURIComponent(E.media.elementForClip(T.clip(V)).src);`);
  ok('after the export the monitor is back on the proxy', /white_proxy/.test(pv3), pv3);
  await js(`E.cmds.run('view.toggleProxies'); await T.tick(300); return true;`);
  ok('Toggle Proxies off: the original plays', !/proxy/i.test(await js(`E.store.set({ playhead: 1.3 }); await T.tick(400); return decodeURIComponent(E.media.elementForClip(T.clip(V)).src);`)));

  // ---------------- 10. Offline media / Link Media ----------------
  console.log('Offline media / Link Media');
  const la = out('linkA'); fs.mkdirSync(path.join(la, 'sub'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', '..', 'test-assets', 'e2e', 'rgb_seconds.mp4'), path.join(la, 'clipA.mp4'));
  fs.copyFileSync(path.join(__dirname, '..', '..', 'test-assets', 'e2e', 'ramp_gray.mp4'), path.join(la, 'sub', 'clipB.mp4'));
  const lproj = out('link.esproj'); nextSave.push(lproj);
  await js(`T.fresh(320, 240); const a = await T.imp(${J(path.join(la, 'clipA.mp4'))}); const b = await T.imp(${J(path.join(la, 'sub', 'clipB.mp4'))});
    T.place(a, 0, 'V1'); T.place(b, 3, 'V1'); E.store.set({ projectPath: null }); await E.cmds.run('file.saveAs'); await T.tick(200); E.store.resetProject(); return true;`);
  const lb = out('linkB'); fs.renameSync(la, lb);
  nextOpen.push(lproj);
  const off = await js(`await E.cmds.run('file.open'); for (let i = 0; i < 40 && !document.querySelector('.modal'); i++) await T.tick(50);
    return { offline: E.store.getState().media.filter((m) => m.status === 'offline').length, dialog: document.querySelector('.modal .modal-title')?.textContent || '' };`);
  ok('opening a project with moved files: items offline + Link Media opens', off.offline === 2 && /Link Media/.test(off.dialog), J(off));
  f = await (async () => { const p2 = out('offline.mov'); await js(`return T.exp(${J(p2)}, 'Apple ProRes 422 (MOV)', 320, 240, 0.5, 0.5 + 1 / 30);`); return frames(p2, 320, 240)[0]; })();
  ok('offline clips render "Media Offline" (preview = export)', near(px(f, 320, 20, 20), [122, 16, 16], 20), px(f, 320, 20, 20));
  nextOpen.push(path.join(lb, 'clipA.mp4'));
  const rl = await js(`const b = [...document.querySelectorAll('.modal button')].find((x) => x.textContent === 'Locate…'); b.click();
    for (let i = 0; i < 100 && E.store.getState().media.some((m) => m.status === 'offline'); i++) await T.tick(100);
    return E.store.getState().media.map((m) => [m.status, m.path]);`);
  ok('Locate one file: the other missing file is found in a subfolder and relinked', rl.every(([st]) => st === 'ready') && rl.some(([, p]) => /linkB.sub.clipB/.test(p)), J(rl));
  f = await (async () => { const p2 = out('relinked.mov'); await js(`document.querySelectorAll('.modal button').forEach((b) => b.textContent === 'OK' && b.click()); return T.exp(${J(p2)}, 'Apple ProRes 422 (MOV)', 320, 240, 0.5, 0.5 + 1 / 30);`); return frames(p2, 320, 240)[0]; })();
  ok('relinked clips render again', near(px(f, 320, 160, 120), [255, 0, 0], 40), px(f, 320, 160, 120));

  // ---------------- 11. Export: loudness, chapters, Smart Render, alpha, codecs, scaling, encoders, queue ----------------
  console.log('Export');
  const ff = (args) => spawnSync(ffmpeg, args, { maxBuffer: 1 << 28 });
  const info = (file) => String(ff(['-hide_banner', '-i', file]).stderr);
  const ebur = (file) => { const e = String(ff(['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']).stderr); const sum = e.slice(e.lastIndexOf('Summary')); return { i: +(/I:\s+(-?[\d.]+) LUFS/.exec(sum) || [])[1], tp: +(/Peak:\s+(-?[\d.]+) dBFS/.exec(sum) || [])[1] }; };
  const noise = out('noise.wav'); ff(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.04:duration=6:seed=7', '-ac', '2', '-ar', '48000', noise]);
  const smartSrc = out('smart.mp4'); ff(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=6', '-c:v', 'libx264', '-g', '30', '-bf', '0', '-pix_fmt', 'yuv420p', smartSrc]);
  const EX = (o) => `return E.exporter.exportSequence(${J(o)}, () => {}, () => false);`;

  // Loudness Normalization
  await js(`T.fresh(320, 240); const m = await T.imp(${J(noise)}); T.place(m, 0); return true;`);
  const nb = ebur(noise);
  const l14 = out('loud14.wav'); let r = await js(EX({ path: l14, preset: 'WAV (audio only)', start: 0, end: 6, audio: true, loudness: -14, truePeak: -1 }));
  let m14 = ebur(l14);
  ok('Loudness Normalization −14 LUFS (two-pass loudnorm): integrated loudness within ±1 LU', r.ok && Math.abs(m14.i + 14) <= 1 && nb.i < -25, J({ nb, m14, r }));
  ok('…and the true peak stays under the ceiling (−1 dBTP)', m14.tp <= -0.5, J(m14));
  const l23 = out('loud23.m4a'); r = await js(EX({ path: l23, preset: 'AAC (audio only, M4A)', start: 0, end: 6, audio: true, loudness: -23 }));
  ok('Loudness Normalization −23 LUFS (EBU R128) into AAC', r.ok && Math.abs(ebur(l23).i + 23) <= 1, J(ebur(l23)));

  // Smart Render + chapters
  const sm = await js(`T.fresh(320, 240); const m = await T.imp(${J(smartSrc)}); const a = T.place(m, 0, 'V1')[0]; const b = T.place(m, 2, 'V1')[0];
    T.patch(a, (c) => { c.dur = 2; }); T.patch(b, (c) => { c.start = 2; c.inPoint = 3; c.dur = 1; }); window.SB = b;
    E.store.edit('markers', ({ seq }) => { seq.markers.push({ id: 'mk1', time: 0, name: 'Intro' }, { id: 'mk2', time: 2, name: 'Part Two' }); });
    return E.store.getState().sequence.clips.map((c) => [c.start, c.inPoint, c.dur]);`);
  const sOut = out('smart_out.mp4'); r = await js(EX({ path: sOut, preset: 'H.264 (MP4)', width: 320, height: 240, fps: 30, start: 0, end: 3, audio: false, smart: true, chapters: true }));
  ok('Smart Render: untouched H.264 clips cut on keyframes are stream-copied', r.ok && r.smart === true, J({ r, sm }));
  const so = frames(sOut, 320, 240), ss = frames(smartSrc, 320, 240);
  const same = (x, y) => x && y && Buffer.compare(x, y) === 0;
  ok('…the copied frames are bit-identical to the source (0–2 s = src 0–2 s, 2–3 s = src 3–4 s)', so.length === 90 && same(so[10], ss[10]) && same(so[59], ss[59]) && same(so[60], ss[90]) && same(so[89], ss[119]), `n=${so.length}`);
  const meta = String(ff(['-v', 'error', '-i', sOut, '-f', 'ffmetadata', '-']).stdout);
  const ch = [...meta.matchAll(/\[CHAPTER\]\s*TIMEBASE=(\d+)\/(\d+)\s*START=(\d+)\s*END=(\d+)\s*title=([^\n]*)/g)].map((x) => [+x[3] * +x[1] / +x[2], x[5].trim()]);
  ok('Chapters: sequence markers become MP4 chapters (Intro @0 s, Part Two @2 s)', ch.length === 2 && ch[0][1] === 'Intro' && Math.abs(ch[1][0] - 2) < 0.05 && ch[1][1] === 'Part Two', J(ch));
  await js(`T.patch(SB, (c) => { c.inPoint = 3.5; }); return true;`);
  const sOut2 = out('smart_out2.mp4'); r = await js(EX({ path: sOut2, preset: 'H.264 (MP4)', width: 320, height: 240, fps: 30, start: 0, end: 3, audio: false, smart: true }));
  ok('Smart Render falls back to a full render when a cut is not on a keyframe (and says why)', r.ok && !r.smart && (r.notes || []).some((n) => /keyframe/.test(n)) && frames(sOut2, 320, 240).length === 90, J(r));
  await js(`T.patch(SB, (c) => { c.inPoint = 3; c.opacity = { opacity: { v: 80, keys: null } }; }); return true;`);
  r = await js(EX({ path: out('smart_out3.mp4'), preset: 'H.264 (MP4)', width: 320, height: 240, fps: 30, start: 0, end: 3, audio: false, smart: true }));
  ok('Smart Render is not used for clips with changed Opacity', r.ok && !r.smart && (r.notes || []).some((n) => /Opacity/.test(n)), J(r));

  // ProRes 4444 with alpha
  await js(`T.fresh(320, 240); const m = await T.imp('${A('rgb_seconds.mp4')}'); const v = T.place(m, 0, 'V1')[0];
    T.patch(v, (c) => { c.motion = { ...E.params.DEFAULT_MOTION(), scale: { v: 50, keys: null } }; c.opacity = { opacity: { v: 50, keys: null }, blend: { v: 'Normal', keys: null } }; }); return true;`);
  const al = out('alpha.mov'); r = await js(EX({ path: al, preset: 'Apple ProRes 4444 with Alpha (MOV)', width: 320, height: 240, fps: 30, start: 0.5, end: 0.5 + 1 / 30, audio: false }));
  const ar = ff(['-v', 'error', '-i', al, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']).stdout; const apx = (x, y) => [...ar.subarray((y * 320 + x) * 4, (y * 320 + x) * 4 + 4)];
  ok('ProRes 4444 with Alpha: empty areas are transparent, a 50% clip has alpha ≈ 128 with straight (unpremultiplied) colour', r.ok && /yuva444p/.test(info(al)) && apx(5, 5)[3] < 3 && Math.abs(apx(160, 120)[3] - 128) < 6 && near(apx(160, 120).slice(0, 3), [255, 0, 0], 30), J([apx(5, 5), apx(160, 120)]));

  // HEVC Main10 and AV1
  const h10 = out('main10.mp4'); r = await js(EX({ path: h10, preset: 'H.265 / HEVC Main10 (MP4)', width: 320, height: 240, fps: 30, start: 0, end: 0.5, audio: false }));
  ok('HEVC Main10 export (yuv420p10le)', r.ok && /hevc \(Main 10\)/.test(info(h10)) && /yuv420p10le/.test(info(h10)), info(h10).split('\n').find((x) => /Video:/.test(x)));
  const av1 = out('av1.mp4'); r = await js(EX({ path: av1, preset: 'AV1 (MP4)', width: 320, height: 240, fps: 30, start: 0, end: 0.5, audio: false }));
  ok('AV1 export', r.ok && /Video: av1/.test(info(av1)) && near(px(frames(av1, 320, 240)[3], 320, 160, 120), [128, 0, 0], 40), info(av1).split('\n').find((x) => /Video:/.test(x)));

  // output with another aspect ratio: Scale to Fit / Fill
  await js(`T.patch(E.store.getState().sequence.clips[0].id, (c) => { c.motion = undefined; c.opacity = undefined; }); return true;`);
  const fitP = out('fit.mp4'); r = await js(EX({ path: fitP, preset: 'H.264 (MP4)', width: 240, height: 320, fps: 30, start: 0.2, end: 0.3, audio: false, fit: 'fit' }));
  let fr = frames(fitP, 240, 320)[0];
  ok('9:16 output from a 4:3 sequence, Scale to Fit: black bars top and bottom, picture in the middle', r.ok && near(px(fr, 240, 120, 10), [0, 0, 0], 20) && near(px(fr, 240, 120, 160), [255, 0, 0], 40), J([px(fr, 240, 120, 10), px(fr, 240, 120, 160)]));
  const fillP = out('fill.mp4'); r = await js(EX({ path: fillP, preset: 'H.264 (MP4)', width: 240, height: 320, fps: 30, start: 0.2, end: 0.3, audio: false, fit: 'fill' }));
  fr = frames(fillP, 240, 320)[0];
  ok('Scale to Fill: the picture covers the whole frame (cropped)', r.ok && near(px(fr, 240, 120, 10), [255, 0, 0], 40), J(px(fr, 240, 120, 10)));

  // hardware encoders
  const hw = await js(`return E.exporter.detectEncoders();`);
  console.log('    hardware encoders found:', J(hw));
  if (hw.h264.length) {
    const hp = out('hw.mp4'); r = await js(EX({ path: hp, preset: 'H.264 (MP4)', width: 320, height: 240, fps: 30, start: 0, end: 0.5, audio: false, encoder: hw.h264[0] }));
    ok(`Hardware Encoding (${hw.h264[0]}) produces H.264`, r.ok && r.encoder === hw.h264[0] && /Video: h264/.test(info(hp)), J(r));
  } else ok('no hardware H.264 encoder on this machine: Encoding offers Software only', Array.isArray(hw.h264));
  const missing = ['nvenc', 'qsv', 'amf'].find((k) => !hw.h264.includes(k));
  if (missing) {
    r = await js(EX({ path: out('hwfallback.mp4'), preset: 'H.264 (MP4)', width: 320, height: 240, fps: 30, start: 0, end: 0.3, audio: false, encoder: missing }));
    ok(`an unavailable hardware encoder (${missing}) falls back to software with a note`, r.ok && r.encoder === 'software' && (r.notes || []).some((n) => /failed/.test(n)), J(r));
  }

  // Export Queue: background jobs on a snapshot, cancel
  const q1 = out('queue1.mp4'), q2 = out('queue2.wav'), q3 = out('queue3.mp4');
  const qs = await js(`const Q = E.exportQueue; const s = E.store.getState().sequence;
    const ids = [Q.queueExport({ path: ${J(q1)}, preset: 'H.264 (MP4)', width: 320, height: 240, fps: 30, start: 0, end: 1.5, audio: false }),
      Q.queueExport({ path: ${J(q2)}, preset: 'WAV (audio only)', start: 0, end: 1, audio: true }),
      Q.queueExport({ path: ${J(q3)}, preset: 'H.264 (MP4)', width: 320, height: 240, fps: 30, start: 0, end: 1, audio: false })];
    E.store.edit('wipe', ({ seq }) => { seq.clips = []; }); // edits after queueing do not change the queued exports
    Q.cancelExport(ids[2]);
    for (let i = 0; i < 600 && E.store.getState().exportQueue.some((j) => j.status === 'queued' || j.status === 'rendering'); i++) await T.tick(50);
    return E.store.getState().exportQueue.map((j) => j.status);`);
  ok('Export Queue renders jobs one after another; a cancelled job is skipped', J(qs) === J(['done', 'done', 'cancelled']) && fs.existsSync(q1) && fs.existsSync(q2) && !fs.existsSync(q3), J(qs));
  fr = frames(q1, 320, 240);
  ok('…each job renders the project as it was when queued (editing went on)', fr.length === 45 && near(px(fr[5], 320, 160, 120), [255, 0, 0], 40) && near(px(fr[40], 320, 160, 120), [0, 255, 0], 40), J(px(fr[5], 320, 160, 120)));

  // Export Settings dialog: presets for platforms, Queue button
  await js(`await E.cmds.run('edit.undo'); return true;`);
  const ui = await js(`E.store.set({ exportQueue: [] }); await E.cmds.run('file.exportMedia'); await T.modal();
    const sel = [...document.querySelectorAll('.modal select')]; return { presets: [...sel[0].options].map((o) => o.textContent), formats: [...sel[1].options].map((o) => o.textContent) };`);
  ok('Export Settings lists platform presets and the new formats', ui.presets.some((x) => /TikTok/.test(x)) && ui.presets.some((x) => /YouTube 2160p/.test(x)) && ui.formats.includes('Apple ProRes 4444 with Alpha (MOV)') && ui.formats.includes('AV1 (MP4)'), J(ui));
  const q4 = out('queue_ui.mp4'); nextSave.push(q4);
  const qu = await js(`T.button('Queue').click(); for (let i = 0; i < 40 && !E.store.getState().exportQueue.length; i++) await T.tick(50);
    for (let i = 0; i < 1200 && E.store.getState().exportQueue.some((j) => j.status === 'queued' || j.status === 'rendering'); i++) await T.tick(50);
    await E.cmds.run('file.exportQueue'); await T.modal(); return { st: E.store.getState().exportQueue.map((j) => j.status), rows: document.querySelectorAll('.modal .equeue').length };`);
  ok('Queue button: the export runs in the background and shows in File > Export > Export Queue', J(qu.st) === J(['done']) && qu.rows === 1 && fs.existsSync(q4), J(qu));
  await js(`T.button('Close')?.click(); return true;`);

  // ---------------- 12. Auto Ducking (keyframes) ----------------
  console.log('Auto Ducking');
  const talk = out('talk.wav'); ff(['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='0.3*sin(2*PI*300*t)*(between(t,1,2.5)+between(t,4,5))':s=48000:d=6", '-ac', '2', talk]);
  const music = out('music.wav'); ff(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.2:duration=6:seed=3', '-ac', '2', '-ar', '48000', music]);
  const dk = await js(`T.fresh(320, 240); const t = await T.imp(${J(talk)}); const m = await T.imp(${J(music)});
    const d = T.place(t, 0, 'A1')[0]; const mu = T.place(m, 0, 'A2')[0]; window.MU = mu;
    T.patch(d, (c) => { c.audio = { tag: 'Dialogue', loudnessTarget: -23, gain: 0 }; }); T.patch(mu, (c) => { c.audio = { tag: 'Music', loudnessTarget: -20, gain: 0 }; });
    const r = await E.ducking.generateDucking([mu], { against: ['Dialogue'], sensitivity: 6, reduceBy: -15, fadeMs: 500 });
    return { ranges: r.ranges, keys: T.clip(mu).volume.level.keys, tracks: E.store.getState().sequence.tracks.filter((x) => x.kind === 'audio').map((x) => x.id), clips: E.store.getState().sequence.clips.map((c) => [c.track, c.start, c.dur]) };`);
  const rg = dk.ranges || [];
  ok('Auto Ducking finds where the dialogue really speaks (1–2.5 s, 4–5 s)', rg.length === 2 && Math.abs(rg[0][0] - 1) < 0.06 && Math.abs(rg[0][1] - 2.5) < 0.06 && Math.abs(rg[1][0] - 4) < 0.06 && Math.abs(rg[1][1] - 5) < 0.06, J(dk));
  const kv = (t) => { const ks = dk.keys || []; const k = ks.find((x) => Math.abs(x.t - t) < 0.06); return k && k.v; };
  ok('Generate Keyframes writes Volume Level keyframes: fade 0.5 s, −15 dB under speech', (dk.keys || []).length === 8 && kv(0.5) === 0 && kv(1) === -15 && kv(2.5) === -15 && kv(3) === 0 && kv(4) === -15 && kv(5.5) === 0, J(dk.keys));
  // the dip is in the exported mix (only the music: mute the dialogue track)
  const dw = out('duck.wav');
  await js(`E.store.edit('mute', ({ seq }) => { const tr = seq.tracks.find((x) => x.id === E.store.getState().sequence.clips.find((c) => c.id !== MU).track); tr.muted = true; }); return true;`);
  r = await js(EX({ path: dw, preset: 'WAV (audio only)', start: 0, end: 6, audio: true }));
  const seg = (f, a, b) => { const x = out(`seg${a}.wav`); ff(['-v', 'error', '-y', '-i', f, '-ss', String(a), '-to', String(b), '-c:a', 'pcm_s16le', x]); return wavRms(x)[0]; };
  const gainDb = (a, b) => 20 * Math.log10(seg(dw, a, b) / seg(music, a, b)); // exported music vs the source over the same stretch
  const dipDb = gainDb(1.5, 2.2), flatDb = gainDb(3.0, 3.45);
  ok('…the exported music is 15 dB lower while the dialogue speaks', r.ok && Math.abs(dipDb + 15) < 0.5 && Math.abs(flatDb) < 0.5, J([dipDb, flatDb]));
  const ed = await js(`await E.cmds.run('edit.undo'); await E.cmds.run('edit.undo'); return !T.clip(MU).volume?.level?.keys?.length;`);
  ok('Undo removes the generated keyframes', ed);
});
