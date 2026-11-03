// Phase 6 end-to-end test, part E: every effect / transition compiles and behaves (transition p = 0 -> A, p = 1 -> B, no NaN),
// presets, Lumetri looks, the Effects panel. docs/PROMPT_FIX_ROUND2.md Phase E. Run: npm run test:e2e
const { suite } = require('./harness.cjs');

suite('phase6e e2e', async ({ js, ok, A }) => {
  const J = (x) => JSON.stringify(x);
  console.log('E3 video transitions');
  let r = await js(`const cv = document.createElement('canvas'); const C = new E.compositor.Compositor(cv); C.resize(48, 27); const gl = C.gl;
    const solid = (r, g, b) => { const t = C.acquire(); C.clear(t, r, g, b, 1); return t; }; const A = solid(1, 0, 0), B = solid(0, 0, 1);
    const px = new Uint8Array(48 * 27 * 4); const read = (t) => { C.target(t); gl.readPixels(0, 0, 48, 27, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    const all = (t, f) => { const p = read(t); for (let i = 0; i < p.length; i += 4) if (!f(p[i], p[i + 1], p[i + 2], p[i + 3])) return false; return true; };
    const names = Object.keys(E.moreTransitions.EXT_TRANSITIONS); const bad = [];
    for (const n of names) {
      const t0 = C.transition(n, A, B, 0), t1 = C.transition(n, A, B, 1), tm = C.transition(n, A, B, 0.5);
      const isA = all(t0, (r, g, b) => r > 250 && b < 5), isB = all(t1, (r, g, b) => b > 250 && r < 5); read(tm); C.release(t0); C.release(t1); C.release(tm);
      if (C.errors['tr:' + n] || !isA || !isB) bad.push(n + (C.errors['tr:' + n] ? ': ' + C.errors['tr:' + n].slice(0, 160) : !isA ? ' p=0 is not A' : ' p=1 is not B'));
    }
    return { n: names.length, bad, total: Object.values(E.catalog.VIDEO_TRANSITIONS).flat().length };`);
  ok(`all ${r.n} new transitions compile, p=0 → A, p=1 → B`, r.bad.length === 0, J(r.bad));
  ok('Video Transitions ≥ 150', r.total >= 150, String(r.total));

  console.log('E2/E3 video effects');
  r = await js(`const cv = document.createElement('canvas'); const C = new E.compositor.Compositor(cv); C.resize(64, 36); const gl = C.gl; const px = new Uint8Array(64 * 36 * 4);
    const src = C.acquire(); C.clear(src, 0.6, 0.4, 0.2, 1); const names = Object.values(E.catalog.VIDEO_EFFECTS).flat(); const mine = new Set(Object.values(E.moreVideoFx.MORE_VIDEO_FX).flatMap((x) => Object.keys(x))); const bad = [];
    for (const n of mine) { const def = E.VIDEO_FX[n]; if (!def) { bad.push(n + ': missing'); continue; } const vals = Object.fromEntries(def.params.map((p) => [p.id, p.def]));
      let out; try { out = def.text ? C.effect(def, n, vals, src, 0.5, null) : C.effect(def, n, vals, src, 0.5, null); } catch (e) { bad.push(n + ': ' + e.message); continue; }
      if (C.errors['fx:' + n]) { bad.push(n + ': ' + C.errors['fx:' + n].slice(0, 200)); continue; } C.target(out); gl.readPixels(0, 0, 64, 36, gl.RGBA, gl.UNSIGNED_BYTE, px); if (out !== src) C.release(out); }
    return { n: mine.size, bad, total: names.length };`);
  ok(`all ${r.n} new video effects compile and render`, r.bad.length === 0, J(r.bad));
  ok('Video Effects ≥ 220', r.total >= 220, String(r.total));

  console.log('E2 audio effects and transitions');
  r = await js(`const names = Object.values(E.catalog.AUDIO_EFFECTS).flat(); const bad = [], silent = [];
    for (const n of names) { const def = E.AUDIO_FX[n]; if (!def) { bad.push(n + ': missing'); continue; } if (def.worklet || def.meter) continue;
      const ctx = new OfflineAudioContext(2, 24000, 48000); const o = ctx.createOscillator(); o.frequency.value = 440; const g = ctx.createGain(); g.gain.value = 0.3; o.connect(g);
      const p = Object.fromEntries(def.params.map((x) => [x.id, x.def]));
      try { const node = def.build(ctx, p); g.connect(node.input); node.output.connect(ctx.destination); o.start(); const buf = await ctx.startRendering();
        let nan = false, peak = 0; for (let c = 0; c < 2; c++) for (const v of buf.getChannelData(c)) { if (!Number.isFinite(v)) nan = true; peak = Math.max(peak, Math.abs(v)); }
        if (nan) bad.push(n + ': NaN'); else if (peak < 1e-4) silent.push(n); } catch (e) { bad.push(n + ': ' + e.message); } }
    const tr = Object.values(E.catalog.AUDIO_TRANSITIONS).flat(); const trBad = tr.filter((n) => { for (const p of [0, 0.5, 1]) { const g = E.crossfadeGains(n, p); if (!g.every(Number.isFinite)) return true; } const a = E.crossfadeGains(n, 0), b = E.crossfadeGains(n, 1); return !(a[0] > 0.99 && a[1] < 0.01 && b[0] < 0.01 && b[1] > 0.99); });
    return { n: names.length, bad, silent, tr: tr.length, trBad };`);
  ok(`every audio effect renders (${r.n})`, r.bad.length === 0 && r.silent.length === 0, J({ bad: r.bad, silent: r.silent }));
  ok('Audio Effects ≥ 75', r.n >= 75, String(r.n));
  ok('Audio Transitions ≥ 12, all start on A and end on B', r.tr >= 12 && r.trBad.length === 0, J(r));

  console.log('E4 presets');
  r = await js(`const P = E.presets; const all = P.allPresets(); const bad = [];
    const trNames = new Set(Object.values(E.catalog.VIDEO_TRANSITIONS).flat());
    for (const p of all) { const v = P.validatePreset(p); if (v.length) bad.push(p.name + ': ' + v.join(', ')); if (p.transition && !trNames.has(p.transition.name)) bad.push(p.name + ': transition ' + p.transition.name); }
    const ids = new Set(all.map((p) => p.id));
    return { n: all.length, looks: all.filter((p) => p.folder[0] === 'Lumetri Looks').length, bad: bad.slice(0, 20), nBad: bad.length, dupIds: all.length - ids.size, noLicense: all.filter((p) => !p.source || !p.license).length };`);
  ok('≥ 400 built-in presets, ≥ 150 Lumetri looks', r.n >= 400 && r.looks >= 150, J({ n: r.n, looks: r.looks }));
  ok('every preset refers to real effects / params / transitions, unique ids, source + license', r.nBad === 0 && r.dupIds === 0 && r.noLicense === 0, J(r));

  r = await js(`T.fresh(320, 240); window.R = await T.imp('${A('ramp_gray.mp4')}'); const [id] = T.place(R, 0, 'V1'); E.store.set({ selection: [id] }); const P = E.presets; const c0 = () => T.clip(id); const dur = c0().dur;
    const H0 = E.store.getState().history?.past?.length ?? E.store.getState().past?.length;
    P.applyPreset([id], P.findPreset('video/Motion/Fades/Fade Out')); const op = c0().opacity.opacity;
    P.applyPreset([id], P.findPreset('video/Motion/Zoom/Slow Zoom In')); const sc = c0().motion.scale;
    P.applyPreset([id], P.findPreset('lumetri/Black & White/Classic Mono/Strong')); const lu = c0().lumetri;
    P.applyPreset([id], P.findPreset('video/Effect Ins & Outs/Fast Blur/Fast Blur In')); const fx = c0().effects.at(-1);
    const nFx = c0().effects.length; E.cmds.run('edit.undo'); await T.tick(20); const afterUndo = c0().effects.length;
    return { dur, op, sc, lu: lu && lu.saturation, fx: fx && { name: fx.name, keys: fx.params.blurriness.keys }, nFx, afterUndo };`);
  ok('Anchor to Out Point: Fade Out keys sit at the clip end', Math.abs(r.op.keys[0].t - (r.dur - 0.5)) < 1e-6 && Math.abs(r.op.keys[1].t - r.dur) < 1e-6 && r.op.keys[1].v === 0, J(r.op));
  ok('Scale: Slow Zoom In keys stretch over the whole clip', r.sc.keys[0].t === 0 && Math.abs(r.sc.keys[1].t - r.dur) < 1e-6 && r.sc.keys[1].v === 115, J(r.sc));
  ok('Lumetri look sets the grade (Classic Mono → saturation 0)', r.lu === 0, String(r.lu));
  ok('Anchor to In Point: Fast Blur In = Fast Blur 60 → 0 over 0.5 s from the start; one undo step per preset', r.fx.name === 'Fast Blur' && r.fx.keys[0].t === 0 && r.fx.keys[0].v === 60 && r.fx.keys[1].t === 0.5 && r.afterUndo === r.nFx - 1, J(r));

  r = await js(`const [a, b] = [T.place(R, 0, 'V2')[0], T.place(R, 4, 'V2')[0]]; const P = E.presets; const p = P.allPresets().find((x) => x.transition); E.store.set({ selection: [b] });
    E.dnd.applyEffectToClips([b], { type: 'EFFECT', preset: p.id, effectName: p.name, category: 'Transition', media: 'video' }, 'start');
    const t = E.store.getState().sequence.transitions.find((x) => x.track === 'V2'); return { p: p.transition, t: t && { name: t.name, params: t.params } };`);
  const tk = r.p && Object.keys(r.p.params)[0];
  ok('transition preset (dropped like an effect) adds the transition with its option', r.t && r.t.name === r.p.name && r.t.params[tk] === r.p.params[tk], J(r));

  r = await js(`const P = E.presets; const id = E.store.getState().sequence.clips[0].id; P.applyPreset([id], P.findPreset('video/Stylize/Glitch/Data Glitch')); const c = T.clip(id);
    const mine = P.presetFromClip(c, { name: 'Round Trip', type: 'anchorIn', fxIds: c.effects.map((e) => e.id), motion: true, lumetri: true });
    await P.saveUserPreset(mine); const text = P.presetsFileText(P.getUserPresets()); const back = P.parsePresetsFile(text);
    const xml = '<?xml version="1.0"?><PremiereData Version="3"><PresetBin><FilterPreset Name="My Blur"><MatchName>AE.ADBE Gaussian Blur 2</MatchName><MatchName>AE.ADBE Mosaic</MatchName></FilterPreset></PresetBin></PremiereData>';
    const pr = P.parsePrfpset(xml); await P.deleteUserPreset(mine.id);
    return { saved: mine.effects.length, motion: !!mine.motion, back: back.map((x) => ({ name: x.name, n: x.effects.length, folder: x.folder, valid: P.validatePreset(x).length })), pr: pr.map((x) => ({ name: x.name, fx: x.effects.map((e) => e.name) })), left: P.getUserPresets().length };`);
  ok('Save Preset → .espreset text → import gives the same preset in My Presets', r.back.length === 1 && r.back[0].name === 'Round Trip' && r.back[0].n === r.saved && r.back[0].valid === 0 && r.back[0].folder[0] === 'My Presets', J(r));
  ok('.prfpset (best effort): effect names that EditorStage has are imported', r.pr.length === 1 && r.pr[0].name === 'My Blur' && r.pr[0].fx.join() === 'Gaussian Blur,Mosaic', J(r.pr));

  console.log('E5 Effects panel');
  r = await js(`E.layout?.requestPanel?.('effects'); await T.tick(50); const cv = document.createElement('canvas'); cv.width = E.fxPreview.PW; cv.height = E.fxPreview.PH; const g = cv.getContext('2d');
    const P = E.presets; const avg = () => { const d = g.getImageData(0, 0, cv.width, cv.height).data; let r = 0, gg = 0, b = 0, s = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; s += Math.abs(d[i] - d[i + 2]); } const n = d.length / 4; return [r / n, gg / n, b / n, s / n]; };
    const okBase = E.fxPreview.drawPreview(g, { kind: 'preset', preset: P.findPreset('video/Motion/Fades/Fade In') }, 0);
    const okFx = E.fxPreview.drawPreview(g, { kind: 'effect', name: 'Invert' }, 0.2); const inv = avg();
    const okMono = E.fxPreview.drawPreview(g, { kind: 'preset', preset: P.findPreset('lumetri/Black & White/Classic Mono/Strong') }, 0.2); const mono = avg();
    const okTr = E.fxPreview.drawPreview(g, { kind: 'transition', name: 'Iris Diamond', media: 'video' }, 1);
    E.fxPreview.drawPreview(g, { kind: 'effect', name: 'Brightness & Contrast' }, 0); const top = g.getImageData(0, 2, cv.width, 1).data, bot = g.getImageData(0, cv.height - 3, cv.width, 1).data;
    const upright = top[2] > top[1] && bot[1] > bot[2];
    return { okFx, okMono, okTr, mono, inv, upright, top: [...top.slice(0, 4)], bot: [...bot.slice(0, 4)] };`);
  ok('hover preview renders an effect, a Lumetri look (gray) and a transition', r.okFx && r.okMono && r.okTr && r.mono[3] < 3 && r.mono[0] > 5 && r.upright, J(r));
  r = await js(`const P = E.presets; const hit = (q) => P.allPresets().filter((p) => E.panels?.fxMatches ? E.panels.fxMatches(q, p.name, p.folder, p.tags) : [p.name, ...p.folder, ...(p.tags || [])].join(' ').toLowerCase().includes(q)).map((p) => p.name);
    P.toggleFavorite('Video Effects/Gaussian Blur'); const fav = P.getFavorites(); P.toggleFavorite('Video Effects/Gaussian Blur');
    P.recordRecent('preset:video/Motion/Pop/Pop In'); return { pip: hit('pip').length, kb: hit('ken burns').length, fav, recent: P.getRecent()[0] };`);
  ok('search by tag (pip, ken burns), favorites and recently used', r.pip >= 27 && r.kb >= 8 && r.fav.includes('Video Effects/Gaussian Blur') && r.recent === 'preset:video/Motion/Pop/Pop In', J(r));
});
