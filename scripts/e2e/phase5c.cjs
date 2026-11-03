// Phase 5 end-to-end test, part C: the effects rebuilt to follow Premiere (premiereFx.js, Equalize / Paint Bucket passes,
// FFT Filter, phase-vocoder pitch) and File > Export > AAF. Pixels come from the preview renderer; a few are re-checked on an
// exported file. Run: npm run test:e2e
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { suite } = require('./harness.cjs');

const REBUILT = ['Lighting Effects', 'Compound Blur', 'Arithmetic', 'Blend', 'Calculations', 'Equalize', 'Turbulent Displace', 'Lightning', 'Paint Bucket',
  'VR Chromatic Aberrations', 'VR Color Gradients', 'VR De-Noise', 'VR Glow', 'VR Plane to Sphere', 'Difference Matte', 'Bevel Alpha', 'Bevel Edges',
  'Radial Shadow', 'Brush Strokes', 'Roughen Edges', 'Texturize'];

suite('phase5c e2e', async ({ js, ok, out, frames, px, near, nextSave }) => {
  const J = (x) => JSON.stringify(x);
  const ff = (args) => { const r = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 }); if (r.status) throw new Error(String(r.stderr)); };
  const W = 320, H = 240;
  const img = (name, lavfi) => { const f = out(name); ff(['-f', 'lavfi', '-i', lavfi, '-frames:v', '1', f]); return f; };
  const geq = (expr) => `color=c=black:s=${W}x${H}:d=1,format=rgb24,geq=r='${expr}':g='${expr}':b='${expr}'`;
  const files = {
    ramp: img('ramp.png', geq(`64+X*64/${W}`)), // low-contrast gray ramp 64..128
    box: img('box.png', geq(`if(between(X,80,239)*between(Y,60,179)+between(X,10,29)*between(Y,10,29),255,0)`)), // white box + a separate small square
    gray: img('gray.png', `color=c=0xC8C8C8:s=${W}x${H}:d=1`),
    red: img('red.png', `color=c=0xC83214:s=${W}x${H}:d=1`),
    black: img('black.png', `color=c=black:s=${W}x${H}:d=1`),
    half: img('half.png', geq(`if(lt(X,${W / 2}),255,0)`)),
  };
  const tone = out('tone.wav'), duo = out('duo.wav');
  ff(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-ac', '2', tone]);
  ff(['-f', 'lavfi', '-i', "aevalsrc='0.4*sin(2*PI*200*t)+0.4*sin(2*PI*5000*t)':s=48000:d=2", '-ac', '2', duo]);

  await js(`window.FILES = ${J(files)};
    window.frame = async (t = 0.5) => { await E.exporter.renderFrame(t, ${W}, ${H}); await T.tick(120); const img = await E.exporter.renderFrame(t, ${W}, ${H}); return (x, y) => [...img.data.slice((y * ${W} + x) * 4, (y * ${W} + x) * 4 + 3)]; };
    window.setup = async (v1, v2) => { T.fresh(${W}, ${H}); E.store.edit('track', ({ seq }) => { if (!seq.tracks.some((t) => t.id === 'V2')) E.cmds.addTrackTo(seq, 'video'); });
      const a = await T.imp(FILES[v1]); window.C1 = T.place(a, 0, 'V1')[0]; window.C2 = null; if (v2) { const b = v1 === v2 ? a : await T.imp(FILES[v2]); window.C2 = T.place(b, 0, 'V2')[0]; } return true; };
    window.fx = (id, name, params = {}) => { T.patch(id, (c) => { c.effects = [{ id: 'fx' + Math.random(), name, category: 'Video', enabled: true, params: { ...Object.fromEntries(E.VIDEO_FX[name].params.map((q) => [q.id, { v: q.def, keys: null }])), ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, { v, keys: null }])) } }]; }); };
    return true;`);
  const look = (code, pts) => js(`${code}; const at = await frame(); return ${J(pts)}.map(([x, y]) => at(x, y));`);

  console.log('every rebuilt effect compiles and renders');
  await js(`await setup('ramp', 'gray'); return true;`);
  const bad = [];
  for (const name of REBUILT) {
    const r = await js(`fx(C1, ${J(name)}); const at = await frame(); const p = at(160, 120); return p.every((v) => Number.isFinite(v)) ? null : p;`);
    if (r) bad.push(name);
  }
  ok('21 effects render with their default settings (shader errors would show as console errors)', !bad.length, J(bad));

  console.log('Equalize');
  let p = await look(`await setup('ramp'); fx(C1, 'Equalize', { style: 0, amount: 100 })`, [[4, 120], [316, 120]]);
  ok('RGB, 100%: a 64..128 ramp is stretched to the full range', p[0][0] < 30 && p[1][0] > 225, J(p));
  p = await look(`fx(C1, 'Equalize', { style: 1, amount: 50 })`, [[4, 120], [316, 120]]);
  ok('Brightness, 50%: half way', p[0][0] > 25 && p[0][0] < 60 && p[1][0] > 170 && p[1][0] < 215, J(p));

  console.log('Paint Bucket');
  const PB = [[160, 120], [20, 20], [300, 220]];
  p = await look(`await setup('box'); fx(C1, 'Paint Bucket', { fillPt: [0.5, 0.5], fill: '#ff0000' })`, PB);
  ok('fills the connected box only (the separate square stays white, the background black)', near(p[0], [255, 0, 0], 8) && near(p[1], [255, 255, 255], 8) && near(p[2], [0, 0, 0], 8), J(p));
  p = await look(`fx(C1, 'Paint Bucket', { fillPt: [0.5, 0.5], fill: '#ff0000', invert: true })`, PB);
  ok('Invert Fill', near(p[0], [255, 255, 255], 8) && near(p[2], [255, 0, 0], 8), J(p));
  p = await look(`fx(C1, 'Paint Bucket', { fillPt: [0.95, 0.95], fill: '#0000ff', opacity: 50 })`, PB);
  ok('fill point on the background, 50% opacity: the background half blue, both white shapes untouched', near(p[2], [0, 0, 128], 10) && near(p[0], [255, 255, 255], 8) && near(p[1], [255, 255, 255], 8), J(p));

  console.log('layer inputs');
  p = await look(`await setup('red', 'gray'); fx(C2, 'Blend', { layer: 'V1', mode: 3 })`, [[160, 120]]);
  ok('Blend > Darken Only with V1', near(p[0], [200, 50, 20], 6), J(p));
  p = await look(`fx(C2, 'Blend', { layer: 'V1', mode: 4 })`, [[160, 120]]);
  ok('Blend > Lighten Only with V1', near(p[0], [200, 200, 200], 6), J(p));
  p = await look(`fx(C2, 'Blend', { layer: 'V1', mode: 0, amount: 50 })`, [[160, 120]]);
  ok('Blend > Crossfade, 50% with original', near(p[0], [200, 125, 110], 8), J(p));
  p = await look(`fx(C2, 'Calculations', { layer: 'V1', mode: 2 })`, [[160, 120]]);
  ok('Calculations: second layer Multiply', near(p[0], [157, 39, 16], 6), J(p));
  p = await look(`fx(C2, 'Blend', { layer: 'None', mode: 3 })`, [[160, 120]]);
  ok('no layer chosen: no change (as in Premiere)', near(p[0], [200, 200, 200], 4), J(p));
  p = await look(`await setup('half', 'box'); fx(C2, 'Compound Blur', { layer: 'V1', max: 20 })`, [[77, 120], [243, 120]]);
  ok('Compound Blur: blurred where the blur layer is bright (left), sharp where dark (right)', p[0][0] > 15 && p[1][0] < 6, J(p));
  p = await look(`await setup('box', 'box'); fx(C2, 'Difference Matte', { layer: 'V1', view: 2 })`, [[160, 120], [300, 220]]);
  ok('Difference Matte (Matte Only): identical layers -> fully keyed', p.every((q) => q[0] < 8), J(p));
  p = await look(`await setup('gray', 'box'); fx(C2, 'Difference Matte', { layer: 'V1', view: 2 })`, [[160, 120], [300, 220]]);
  ok('Difference Matte: different pixels stay', p.every((q) => q[0] > 247), J(p));
  const loop = await js(`await setup('gray', 'red'); fx(C1, 'Blend', { layer: 'V2', mode: 0 }); fx(C2, 'Blend', { layer: 'V1', mode: 0 }); const at = await frame(); return at(160, 120);`);
  ok('two layers blending with each other do not recurse forever', Array.isArray(loop) && loop.length === 3, J(loop));

  console.log('channel / generate / perspective');
  p = await look(`await setup('gray'); fx(C1, 'Arithmetic', { op: 6, r: 255, g: 255, b: 255 })`, [[160, 120]]);
  ok('Arithmetic Xor 255: 200 -> 55', near(p[0], [55, 55, 55], 2), J(p));
  p = await look(`fx(C1, 'Arithmetic', { op: 11, r: 150, g: 250, b: 150 })`, [[160, 120]]);
  ok('Arithmetic Slice: above -> 255, below -> 0', near(p[0], [255, 0, 255], 2), J(p));
  p = await look(`fx(C1, 'Arithmetic', { op: 0, r: 100, g: 100, b: 100, clipRes: false })`, [[160, 120]]);
  ok('Arithmetic Add without Clip Result Values wraps (300 -> 44)', near(p[0], [44, 44, 44], 2), J(p));
  p = await look(`await setup('black'); fx(C1, 'Lightning', { start: [0.1, 0.5], end: [0.9, 0.5], amp: 0, branching: 0 })`, [[160, 120], [160, 20]]);
  ok('Lightning: a bright bolt between the points, dark away from it', p[0][0] > 200 && p[1][0] < 40, J(p));
  p = await look(`await setup('gray'); fx(C1, 'Lighting Effects')`, [[160, 96], [5, 235]]);
  ok('Lighting Effects: the default spotlight lights its centre, the corner keeps the ambience', p[0][0] > p[1][0] + 60 && p[1][0] < 80, J(p));
  p = await look(`fx(C1, 'Bevel Edges', { thick: 0.1, angle: -90, intensity: 0.5 })`, [[5, 120], [160, 120], [315, 120]]);
  ok('Bevel Edges: lit left edge, dark right edge', p[0][0] > p[1][0] + 30 && p[2][0] < p[1][0] - 30, J(p));
  p = await look(`await setup('box'); fx(C1, 'Bevel Alpha', { edge: 30, angle: -90, intensity: 1 })`, [[3, 120], [316, 120]]);
  ok('Bevel Alpha: the frame edge facing the light is lit', p[0][0] > 40 && p[1][0] < 10, J(p));
  p = await look(`await setup('gray'); fx(C1, 'VR Plane to Sphere', { fov: 90 })`, [[160, 120], [310, 120]]);
  ok('VR Plane to Sphere: the plane faces forward (centre), nothing behind', near(p[0], [200, 200, 200], 6) && p[1][0] < 5, J(p));
  p = await look(`T.patch(C1, (c) => { c.motion = { scale: { v: 50, keys: null } }; }); fx(C1, 'Radial Shadow', { color: '#ffffff', opacity: 100, light: [0.2, 0.2], proj: 50, soft: 0 })`, [[250, 190], [70, 55]]);
  ok('Radial Shadow: cast away from the light source', p[0][0] > 200 && p[1][0] < 10, J(p));
  p = await js(`await setup('box'); const at0 = await frame(); fx(C1, 'Turbulent Displace', { amount: 80, size: 40 }); const at = await frame(); let d = 0; for (let x = 60; x < 100; x++) for (let y = 40; y < 200; y += 4) d += Math.abs(at(x, y)[0] - at0(x, y)[0]); return d;`);
  ok('Turbulent Displace moves the box edge', p > 2000, p);
  p = await js(`fx(C1, 'Roughen Edges', { border: 20 }); const at = await frame(); let n = 0; for (let x = 0; x < 320; x += 2) if (at(x, 1)[0] < 128 && x > 0) n++; return n;`);
  ok('Roughen Edges eats into the frame edge', p > 0, p);

  console.log('preview = export');
  await js(`await setup('ramp'); fx(C1, 'Equalize', { style: 0, amount: 100 }); return true;`);
  const pv = await js(`const at = await frame(0.5); return [at(4, 120), at(316, 120)];`);
  const fexp = out('eq.mov'); await js(`return T.exp(${J(fexp)}, 'Apple ProRes 422 (MOV)', ${W}, ${H}, 0.5, 0.5 + 1 / 30);`);
  const [fr] = frames(fexp, W, H);
  ok('Equalize: exported frame matches the preview', near(px(fr, W, 4, 120), pv[0], 6) && near(px(fr, W, 316, 120), pv[1], 6), J([pv, px(fr, W, 4, 120), px(fr, W, 316, 120)]));

  console.log('audio: FFT Filter, Pitch and Time');
  const audio = async (file, name, params) => js(`T.fresh(${W}, ${H}); const m = await T.imp(${J(file)}); const a = T.place(m, 0)[0];
    T.patch(a, (c) => { c.effects = ${name ? `[{ id: 'af', name: ${J(name)}, category: 'Audio', enabled: true, params: ${J(Object.fromEntries(Object.entries(params || {}).map(([k, v]) => [k, { v, keys: null }])))} }]` : '[]'}; });
    const pcm = await T.pcm(0.5, 1.5); const n = pcm.length / 2; let s = 0, zc = 0; for (let i = 0; i < n; i++) { const v = pcm[2 * i] / 32768; s += v * v; if (i && pcm[2 * i - 2] < 0 && pcm[2 * i] >= 0) zc++; } return { rms: Math.sqrt(s / n), hz: zc };`);
  const dry = await audio(duo), rej = await audio(duo, 'FFT Filter', { mode: 1, low: 4000, high: 6000, fft: 1 }), band = await audio(duo, 'FFT Filter', { mode: 0, low: 1000, high: 20000, fft: 1 });
  ok('FFT Filter > Reject Band 4–6 kHz keeps only the 200 Hz tone (RMS ×0.707)', Math.abs(rej.rms / dry.rms - 0.707) < 0.03 && Math.abs(rej.hz - 200) < 4, J({ dry, rej }));
  ok('FFT Filter > Pass Band 1–20 kHz keeps only the 5 kHz tone', Math.abs(band.rms / dry.rms - 0.707) < 0.03 && Math.abs(band.hz - 5000) < 30, J({ dry, band }));
  const up = await audio(tone, 'Pitch and Time', { semitones: 12, cents: 0, precision: 1 }), down = await audio(tone, 'Pitch Shifter', { semitones: -12, cents: 0, precision: 2, formant: false });
  ok('Pitch and Time +12: 440 -> 880 Hz, level kept (tone RMS 0.0625)', Math.abs(up.hz - 880) < 8 && up.rms > 0.055, J(up));
  ok('Pitch Shifter −12 (High Precision): 440 -> 220 Hz', Math.abs(down.hz - 220) < 6 && down.rms > 0.055, J(down));

  console.log('File > Export > AAF (Embedded Audio)');
  await js(`T.fresh(${W}, ${H}); const m = await T.imp(${J(tone)}); const a = T.place(m, 0, 'A1')[0]; T.patch(a, (c) => { c.dur = 1; c.inPoint = 0.5; });
    const b = T.place(m, 3, 'A2')[0]; T.patch(b, (c) => { c.speed = 2; c.dur = 1; }); return true;`);
  const aafFile = out('seq.aaf'); nextSave.push(aafFile);
  const log = await js(`await E.cmds.commands['file.exportAAF'](); return E.store.getState().log.slice(-1)[0];`);
  ok('AAF export reports the 2 clips', /Exported seq\.aaf \(2 audio clips/.test(log), log);
  const st = await js(`const f = E.interchange.readCFB(new Uint8Array(await window.editorstage.readFile(${J(aafFile)})));
    const kid = (n, name) => n.children.find((c) => c.name === name);
    const content = kid(kid(f.tree, 'Header-2'), 'Content-3b03'); const comp = kid(content, 'Mobs-1901{0}');
    const ess = [0, 1, 2, 3, 4].map((i) => kid(content, 'EssenceData-1902{' + i + '}')).filter(Boolean).map((e) => kid(e, 'Data-2702').data());
    const tone24 = (d) => { const n = d.length / 3; let zc = 0, s = 0, prev = 0; for (let i = 0; i < n; i++) { const v = ((d[i * 3] | (d[i * 3 + 1] << 8) | (d[i * 3 + 2] << 16)) << 8 >> 8) / 8388608; if (i && prev < 0 && v >= 0) zc++; prev = v; s += v * v; } return { sec: n / 48000, hz: zc / (n / 48000), rms: Math.sqrt(s / n) }; };
    return { ess: ess.map(tone24), slots: comp.children.map((x) => x.name).filter((x) => /^Slots-4403\{/.test(x)) };`);
  ok('AAF: 4 mono essences (2 clips x L/R)', st.ess.length === 4, J(st));
  ok('AAF: plain clip embeds its source with 1 s handles (0..2 s of the file), 440 Hz', Math.abs(st.ess[0].sec - 2) < 0.01 && Math.abs(st.ess[0].hz - 440) < 3 && st.ess[0].rms > 0.05, J(st.ess[0]));
  ok('AAF: the 2x speed clip embeds the rendered (retimed) audio: 1 s at 880 Hz', Math.abs(st.ess[2].sec - 1) < 0.01 && Math.abs(st.ess[2].hz - 880) < 6, J(st.ess[2]));
  ok('AAF: composition has A1 L/R, A2 L/R + timecode', st.slots.length === 5, J(st.slots));
  nextSave.push(out('cancel.aaf'));
  const c = await js(`const p = E.cmds.commands['file.exportAAF'](); E.cmds.cancelRender(); await p; return { log: E.store.getState().log.slice(-1)[0], dialog: E.store.getState().dialog };`);
  ok('AAF: Cancel stops the export, nothing is written', /cancelled/.test(c.log) && !c.dialog && !require('fs').existsSync(out('cancel.aaf')), J(c));
});
