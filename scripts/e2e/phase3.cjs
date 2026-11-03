// Phase 3 end-to-end test. Run: npm run test:e2e
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { suite } = require('./harness.cjs');

suite('phase3 e2e', async ({ js, ok, A, out, frames, px, near, wavRms, nextSave, nextOpen }) => {
  const J = (x) => JSON.stringify(x);
  const ff = (args) => spawnSync(ffmpeg, args, { maxBuffer: 1 << 28 });
  const EX = (o) => `return E.exporter.exportSequence(${J(o)}, () => {}, () => false);`;
  const W = 320, H = 240;
  /** Rows (y) of the frame that contain caption-white pixels, grouped into bands (text lines). */
  const bands = (f, w, h, test) => { const rows = []; for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) if (test(px(f, w, x, y))) n++; rows.push(n > 0); } const out = []; let st = -1; rows.forEach((r, y) => { if (r && st < 0) st = y; if (!r && st >= 0) { if (y - st > 2) out.push([st, y]); st = -1; } }); return out; };
  const white = (p) => p[0] > 200 && p[1] > 200 && p[2] > 200;

  // ---------------- Auto Captions: Thai line breaking, presets, keywords, emoji, SRT / VTT / ASS, burn-in ----------------
  console.log('Auto Captions');
  const thai = 'วันนี้อากาศดีมากเราจะไปเที่ยวทะเลกันที่จังหวัดชลบุรี';
  await js(`T.fresh(${W}, ${H});
    const words = [...new Intl.Segmenter('th', { granularity: 'word' }).segment(${J(thai)})].map((s, i, a) => ({ text: s.segment, t0: i * 0.2, t1: (i + 1) * 0.2 }));
    window.CT = E.stt.placeCaptions([{ t0: 0, t1: 3, text: ${J(thai)}, words }], { style: { ...E.captions.defaultCaptionStyle(), preset: 'plain', maxWidthPct: 60, shadow: false, sizePct: 8, charsPerLine: 10, color: '#ffffff' } });
    return true;`);
  let f = await js(`const img = await E.exporter.renderFrame(1, ${W}, ${H}); return [...img.data];`);
  const rgb = Buffer.from(f.filter((_, i) => i % 4 !== 3));
  const bs = bands(rgb, W, H, white);
  ok('a long Thai caption wraps onto several lines in the frame', bs.length >= 3, J(bs));
  const srt = await js(`return E.stt.captionsToSrt(E.store.getState().sequence, CT);`);
  const lines = srt.split('\n').slice(2).filter((x) => x && !/-->/.test(x));
  const seg = new Intl.Segmenter('th', { granularity: 'word' }); const b = new Set([0]); let o = 0; for (const s of seg.segment(thai)) { o += s.segment.length; b.add(o); }
  let at = 0; const okBreaks = lines.every((l) => { const r = b.has(at); at += l.length; return r; });
  ok('SRT lines (10 clusters) break between Thai words, never inside one', lines.length >= 3 && lines.join('') === thai && okBreaks, J(lines));
  const vtt = await js(`return E.stt.captionsToVtt(E.store.getState().sequence, CT);`);
  ok('WebVTT export', /^WEBVTT/.test(vtt) && /00:00:00\.000 --> 00:00:03\.000/.test(vtt), vtt.slice(0, 80));
  const ass = await js(`return E.stt.captionsToAss(E.store.getState().sequence, CT);`);
  ok('ASS export: PlayRes, style from the caption style, dialogue with line breaks', /PlayResX: 320/.test(ass) && /Style: Default,Noto Sans Thai,19,&H00FFFFFF/.test(ass) && /Dialogue: 0,0:00:00\.00,0:00:03\.00,Default,,0,0,0,,.+\\N/.test(ass), ass);
  const assP = out('caps.ass'); fs.writeFileSync(assP, ass);
  const burnAss = ff(['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:d=1`, '-vf', `subtitles='${assP.replace(/\\/g, '/').replace(':', '\\:')}'`, '-frames:v', '1', out('ass.png')]);
  ok('…FFmpeg reads the ASS file', burnAss.status === 0, String(burnAss.stderr).slice(0, 300));

  // keyword emphasis and emoji
  const kw = await js(`const w = E.captions.markKeywords([{ text: 'we' }, { text: ' sold' }, { text: ' 500' }, { text: ' cars' }]); return [w.findIndex((x) => x.emph), E.captions.emojiFor('รัก'), E.captions.emojiFor('money!'), E.captions.emojiFor('table')];`);
  ok('keyword: a number wins; emoji for รัก / money, none for other words', kw[0] === 2 && kw[1] === ' ❤️' && kw[2] === ' 💰' && kw[3] === '', J(kw));
  await js(`T.fresh(${W}, ${H}); window.CT = E.stt.placeCaptions([{ t0: 0, t1: 2, text: 'we sold 500 cars', words: [{ text: 'we', t0: 0, t1: 0.5 }, { text: ' sold', t0: 0.5, t1: 1 }, { text: ' 500', t0: 1, t1: 1.5 }, { text: ' cars', t0: 1.5, t1: 2 }] }],
    { style: { ...E.captions.defaultCaptionStyle(), preset: 'plain', shadow: false, sizePct: 10, emphasis: true, emphColor: '#00ff00' } }); return true;`);
  f = await js(`const img = await E.exporter.renderFrame(0.2, ${W}, ${H}); let g = 0; for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 1] > 200 && img.data[i] < 80 && img.data[i + 2] < 80) g++; return g;`);
  ok('Emphasize keyword: the keyword is drawn in the keyword colour', f > 30, f);
  const pre = await js(`const s = { ...E.captions.defaultCaptionStyle(), ...E.captions.CAPTION_PRESETS['Yellow Box'] }; return [Object.keys(E.captions.CAPTION_PRESETS).length, s.box, s.boxColor];`);
  ok('Caption style presets (10)', pre[0] >= 10 && pre[1] === true && pre[2] === '#ffd400', J(pre));

  // burn-in toggle + sidecar
  const mp = out('nocaps.mp4');
  let r = await js(EX({ path: mp, preset: 'H.264 (MP4)', width: W, height: H, fps: 30, start: 0.5, end: 1.5, audio: false, burnCaptions: false, sidecar: 'srt' }));
  const side = out('nocaps.srt');
  const fr = frames(mp, W, H)[0]; let lit = 0; for (let i = 0; i < fr.length; i++) if (fr[i] > 100) lit++;
  ok('Export with Burn Captions off: no caption in the picture', r.ok && lit < 20, lit);
  const st = fs.existsSync(side) ? fs.readFileSync(side, 'utf8') : '';
  ok('…and a sidecar .srt next to the file, timed from the export start', /00:00:00,000 --> 00:00:01,500/.test(st) && /we sold 500 cars/.test(st), st);
  r = await js(EX({ path: out('caps.mp4'), preset: 'H.264 (MP4)', width: W, height: H, fps: 30, start: 0.5, end: 0.6, audio: false }));
  const fr2 = frames(out('caps.mp4'), W, H)[0]; lit = 0; for (let i = 0; i < fr2.length; i++) if (fr2[i] > 100) lit++;
  ok('Burn Captions on (default): the caption is in the picture', r.ok && lit > 200, lit);

  // ---------------- Filters ----------------
  console.log('Filters');
  const fl = await js(`const F = E.filters; return { n: F.FILTERS.length, cats: F.FILTER_CATEGORIES, teal: F.applyLook('teal-orange', [1, 0, 0]).map((v) => Math.round(v * 255)) };`);
  ok('at least 30 built-in looks in several categories', fl.n >= 30 && fl.cats.length >= 6, J(fl));
  await js(`T.fresh(${W}, ${H}); const m = await T.imp('${A('rgb_seconds.mp4')}'); window.V = T.place(m, 0, 'V1')[0]; T.patch(V, (c) => { c.filter = { id: 'mono-classic', intensity: 100 }; }); return true;`);
  const expF = async (n, s0 = 0.5) => { const p = out(n); await js(`return T.exp(${J(p)}, 'Apple ProRes 422 (MOV)', ${W}, ${H}, ${s0}, ${s0} + 1 / 30);`); return frames(p, W, H)[0]; };
  f = await expF('filter_mono.mov');
  ok('Filter Mono Classic: red becomes grey 54 (Rec.709 luma) in the export', near(px(f, W, 160, 120), [54, 54, 54], 8), px(f, W, 160, 120));
  await js(`T.patch(V, (c) => { c.filter.intensity = 50; }); return true;`);
  f = await expF('filter_mono50.mov');
  ok('Intensity 50%: halfway between the original and the look', near(px(f, W, 160, 120), [155, 27, 27], 10), px(f, W, 160, 120));
  await js(`T.patch(V, (c) => { c.filter = { id: 'teal-orange', intensity: 100 }; }); return true;`);
  f = await expF('filter_teal.mov');
  ok('Filter Teal & Orange: export matches the look math (GPU LUT = CPU)', near(px(f, W, 160, 120), fl.teal, 10), J([px(f, W, 160, 120), fl.teal]));

  // ---------------- Canvas / Background Fill ----------------
  console.log('Canvas / Background Fill');
  const tall = out('tall.mp4'); ff(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=lime:s=120x240:r=30:d=2', '-pix_fmt', 'yuv420p', tall]);
  await js(`T.fresh(${W}, ${H}); const m = await T.imp(${J(tall)}); window.V = T.place(m, 0, 'V1')[0]; return true;`);
  f = await expF('fill_none.mov');
  ok('a portrait clip leaves black bars without a fill', near(px(f, W, 10, 120), [0, 0, 0], 10) && near(px(f, W, 160, 120), [0, 255, 0], 30), J([px(f, W, 10, 120), px(f, W, 160, 120)]));
  await js(`T.patch(V, (c) => { c.canvasFill = { type: 'color', color: '#ff00ff' }; }); return true;`);
  f = await expF('fill_color.mov');
  ok('Canvas Color: the bars are the chosen colour, the clip stays on top', near(px(f, W, 10, 120), [255, 0, 255], 20) && near(px(f, W, 160, 120), [0, 255, 0], 30), J([px(f, W, 10, 120), px(f, W, 160, 120)]));
  await js(`T.patch(V, (c) => { c.canvasFill = { type: 'blur', blur: 60 }; }); return true;`);
  f = await expF('fill_blur.mov');
  ok('Canvas Blur: the bars show a zoomed, blurred copy of the clip', near(px(f, W, 10, 120), [0, 255, 0], 50), J(px(f, W, 10, 120)));
  await js(`const im = await T.imp('${A('flat.png')}'); T.patch(V, (c) => { delete c.canvasFill; }); E.store.edit('seq fill', ({ seq }) => { seq.canvasFill = { type: 'image', mediaId: im.id }; }); return true;`);
  f = await expF('fill_image.mov');
  const fp = px(f, W, 10, 120);
  ok('Canvas Image for the whole sequence (main track): the bars show the image', fp[0] > 70 && Math.abs(fp[0] - fp[1]) < 12 && Math.abs(fp[1] - fp[2]) < 12 && near(px(f, W, 160, 120), [0, 255, 0], 30), J(fp));

  // ---------------- Voice Changer ----------------
  console.log('Voice Changer');
  const tone = (hz, n) => { const p = out(n); ff(['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=2:sample_rate=48000`, '-af', 'volume=0.5', '-ac', '2', p]); return p; };
  const zc = (file) => { const b = fs.readFileSync(file); let o = 12; while (b.toString('ascii', o, o + 4) !== 'data') o += 8 + b.readUInt32LE(o + 4); const n = (b.readUInt32LE(o + 4) / 4) | 0; let z = 0, prev = 0; const a = Math.floor(n * 0.25), e = Math.floor(n * 0.75); for (let i = a; i < e; i++) { const v = b.readInt16LE(o + 8 + i * 4); if (prev < 0 && v >= 0) z++; prev = v; } return z / ((e - a) / 48000); };
  const voice = async (file, i, name) => {
    await js(`T.fresh(${W}, ${H}); const m = await T.imp(${J(file)}); const a = T.place(m, 0)[0]; T.patch(a, (c) => { if (${i} >= 0) c.effects = [{ id: 'vc', name: 'Voice Changer', category: 'Audio', enabled: true, params: { voice: { v: ${i}, keys: null }, mix: { v: 100, keys: null } } }]; }); return true;`);
    const p = out(name); const rr = await js(EX({ path: p, preset: 'WAV (audio only)', start: 0, end: 2, audio: true })); return rr.ok ? p : null;
  };
  const t300 = tone(300, 't300.wav');
  const dry = await voice(t300, -1, 'v_dry.wav'), chip = await voice(t300, 0, 'v_chip.wav'), deep = await voice(t300, 1, 'v_deep.wav');
  ok('Chipmunk raises the pitch 7 semitones (300 → 449 Hz)', Math.abs(zc(dry) - 300) < 6 && Math.abs(zc(chip) - 449.5) < 12, J([zc(dry), zc(chip)]));
  ok('Deep lowers the pitch 5 semitones (300 → 225 Hz)', Math.abs(zc(deep) - 224.7) < 10, zc(deep));
  const t100 = tone(100, 't100.wav'); const tel = await voice(t100, 4, 'v_tel.wav'); const dry100 = await voice(t100, -1, 'v_dry100.wav');
  const telDb = 20 * Math.log10(wavRms(tel)[0] / wavRms(dry100)[0]);
  ok('Telephone cuts the low end (100 Hz down by more than 15 dB)', telDb < -15, telDb.toFixed(1));
  const all = []; for (let i = 0; i < 8; i++) { const p = await voice(t300, i, `v_${i}.wav`); all.push(p ? +wavRms(p)[0].toFixed(3) : 0); }
  ok('every voice preset renders sound in the export (8 presets)', all.every((x) => x > 0.01), J(all));

  // ---------------- Remove Background ----------------
  console.log('Remove Background');
  const mk = await js(`const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256; const g = cv.getContext('2d'); g.fillStyle = '#888'; g.fillRect(0, 0, 256, 256);
    const m = await E.segment.computeMask('probe:0', cv); return [m.w, m.h];`);
  ok('the bundled Selfie Segmenter model loads offline and returns a mask', mk[0] > 0 && mk[1] > 0, J(mk));
  await js(`T.fresh(${W}, ${H}); const m = await T.imp('${A('rgb_seconds.mp4')}'); window.V = T.place(m, 0, 'V1')[0];
    T.patch(V, (c) => { c.effects = [{ id: 'rb', name: 'Remove Background', category: 'Video', enabled: true, params: { threshold: { v: 50, keys: null }, feather: { v: 0, keys: null }, choke: { v: 0, keys: null }, invert: { v: false, keys: null } } }]; });
    const d = new Uint8Array(256 * 256 * 4); for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const v = y < 128 ? 255 : 0; d.set([v, v, v, 255], (y * 256 + x) * 4); }
    E.segment.putMask(E.segment.maskKey(m.id, 15), { w: 256, h: 256, data: d }); return true;`);
  f = await expF('rbg.mov');
  ok('Remove Background keeps the person (mask top half) and cuts the rest (export uses the cached mask, right way up)', near(px(f, W, 160, 40), [255, 0, 0], 30) && near(px(f, W, 160, 200), [0, 0, 0], 20), J([px(f, W, 160, 40), px(f, W, 160, 200)]));
  await js(`T.patch(V, (c) => { c.effects[0].params.invert = { v: true, keys: null }; }); return true;`);
  f = await expF('rbg_inv.mov');
  ok('Invert keeps the background instead', near(px(f, W, 160, 40), [0, 0, 0], 20) && near(px(f, W, 160, 200), [255, 0, 0], 30), J([px(f, W, 160, 40), px(f, W, 160, 200)]));

  // ---------------- Create panel: hover preview, click = one undo step, save / reopen ----------------
  console.log('Create panel');
  await js(`T.fresh(${W}, ${H}); const m = await T.imp('${A('rgb_seconds.mp4')}'); window.V = T.place(m, 0, 'V1')[0]; E.store.set({ selection: [V], playhead: 0.5, createTab: 'filters' }); await E.cmds.run('panel.create'); await T.tick(300); return true;`);
  const cp = await js(`const tile = document.querySelector('.createpanel [data-filter="sepia"]'); if (!tile) return { err: 'no tile' };
    tile.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await T.tick(50); const during = T.clip(V).filter?.id || null;
    tile.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); await T.tick(50); const after = T.clip(V).filter?.id || null;
    tile.click(); await T.tick(50); const applied = T.clip(V).filter?.id || null;
    await E.cmds.run('edit.undo'); await T.tick(50); const undone = T.clip(V).filter?.id || null;
    await E.cmds.run('edit.redo'); await T.tick(50); return { during, after, applied, undone, redo: T.clip(V).filter?.id || null, tiles: document.querySelectorAll('.createpanel [data-filter]').length };`);
  ok('Create > Filters: pointing previews, leaving restores, click applies, undo / redo', cp.during === 'sepia' && cp.after === null && cp.applied === 'sepia' && cp.undone === null && cp.redo === 'sepia' && cp.tiles >= 30, J(cp));
  const tabs = await js(`const o = {}; for (const t of ['canvas', 'captions', 'voice', 'ai']) { E.store.set({ createTab: t }); await T.tick(100); o[t] = document.querySelectorAll('.createpanel .ctile, .createpanel button.primary').length; } return o;`);
  ok('Create tabs: Canvas, Captions, Voice, AI render their tools', tabs.canvas >= 4 && tabs.voice >= 9 && tabs.ai >= 1, J(tabs));
  const sp = out('create.esproj'); nextSave.push(sp);
  await js(`T.patch(V, (c) => { c.canvasFill = { type: 'blur', blur: 40 }; c.effects = [{ id: 'rb', name: 'Remove Background', category: 'Video', enabled: true, params: { threshold: { v: 60, keys: null }, feather: { v: 3, keys: null }, choke: { v: 0, keys: null }, invert: { v: false, keys: null } } }]; });
    E.store.edit('sf', ({ seq }) => { seq.canvasFill = { type: 'color', color: '#123456' }; }); E.store.set({ projectPath: null }); await E.cmds.run('file.saveAs'); await T.tick(300); E.store.resetProject(); return true;`);
  nextOpen.push(sp);
  const ro = await js(`await E.cmds.run('file.open'); await T.tick(800); const c = E.store.getState().sequence.clips.find((x) => x.filter); return { filter: c?.filter, fill: c?.canvasFill, rb: c?.effects?.[0]?.params?.threshold?.v, seq: E.store.getState().sequence.canvasFill };`);
  ok('save / reopen keeps Filter, Canvas Fill (clip and sequence) and Remove Background settings', ro.filter?.id === 'sepia' && ro.fill?.type === 'blur' && ro.rb === 60 && ro.seq?.color === '#123456', J(ro));

  // ---------------- Phase 4: Project Health Check ----------------
  console.log('Project Health Check');
  const loudTone = out('loud_tone.wav'); ff(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=48000', '-af', 'volume=7.9', '-ac', '2', loudTone]);
  const doomed = out('doomed.mp4'); fs.copyFileSync(path.join(__dirname, '..', '..', 'test-assets', 'e2e', 'rgb_seconds.mp4'), doomed);
  await js(`T.fresh(${W}, ${H}); E.store.set({ dialog: null }); const m = await T.imp('${A('rgb_seconds.mp4')}'); const a = T.place(m, 0, 'V1')[0]; const b = T.place(m, 2, 'V1')[0]; T.patch(a, (c) => { c.dur = 1; }); T.patch(b, (c) => { c.start = 2; c.dur = 1; });
    E.store.edit('noaudio', ({ seq }) => { seq.clips = seq.clips.filter((c) => seq.tracks.find((t) => t.id === c.track)?.kind !== 'audio'); });
    const tone = await T.imp(${J(loudTone)}); const t = T.place(tone, 2)[0]; T.patch(t, (c) => { c.start = 2; c.dur = 1; c.volume = { level: { v: 6, keys: null }, bypass: { v: false, keys: null } }; });
    const g = E.gfx.addGraphic('text', 0, { text: 'Edge', font: 'NoSuchFont123', x: 0.02, y: 0.5, size: 60 }); T.patch(g, (c) => { c.dur = 1; });
    const d = await T.imp(${J(doomed)}); T.place(d, 3, 'V1');
    E.store.edit('trim', ({ seq }) => { seq.clips = seq.clips.filter((c) => !(c.asAudio && c.mediaId === d.id)); for (const c of seq.clips) if (c.mediaId === d.id) { c.start = 3; c.dur = 1; delete c.linkId; } });
    return true;`);
  fs.unlinkSync(doomed);
  const hc = await js(`await E.mediaLink.checkOffline();
    const r = await E.health.runHealthCheck({ loudness: -14 }); return r.map((i) => ({ id: i.id, level: i.level, title: i.title, at: i.at, fix: i.fix?.label || null }));`);
  const has = (re) => hc.find((i) => re.test(i.id));
  ok('Health Check: offline media (error, Link Media fix)', has(/^offline$/)?.level === 'error' && has(/^offline$/)?.fix === 'Link Media…', J(hc));
  ok('Health Check: missing font (Replace Fonts fix)', /NoSuchFont123|font/.test(J(has(/^fonts$/))) && has(/^fonts$/)?.fix === 'Replace Fonts…', J(hc));
  ok('Health Check: black gap 1–2 s with a Close Gap fix', has(/^gap:1\.000$/)?.fix === 'Close Gap', J(hc));
  ok('Health Check: title outside the action-safe area', !!has(/^safe:/), J(hc));
  ok('Health Check: clipping in the mix (tone at +6 dB)', !!has(/^clip$/) && Math.abs(has(/^clip$/).at - 2) < 0.1, J(hc));
  ok('Health Check: loudness off the −14 LUFS target', !!has(/^loudness$/), J(hc));
  const fixed = await js(`const r = await E.health.runHealthCheck({ audio: false }); const g = r.find((i) => i.id === 'gap:1.000'); g.fix.run(); await T.tick(50);
    const after = await E.health.runHealthCheck({ audio: false }); await E.cmds.run('edit.undo'); return { before: r.length, gaps: after.filter((i) => /^gap:/.test(i.id)).length, undone: E.health.blackGaps(E.store.getState().sequence).length };`);
  ok('Close Gap fixes the gap (one undo step)', fixed.gaps === 0 && fixed.undone === 1, J(fixed));
  const hd = await js(`await E.cmds.run('file.healthCheck'); await T.modal(); for (let i = 0; i < 200 && !document.querySelector('.modal .healthlist, .modal .health-ok'); i++) await T.tick(50);
    const n = document.querySelectorAll('.modal .health').length; T.button('Close').click(); await T.tick(100);
    await E.cmds.run('file.exportMedia'); await T.modal(); for (let i = 0; i < 200 && /checking/.test(document.querySelector('.modal .health-summary')?.textContent || 'checking'); i++) await T.tick(50);
    const sum = document.querySelector('.modal .health-summary')?.textContent; T.button('Close').click(); return { n, sum };`);
  ok('File > Export > Project Health Check lists the issues; the Export dialog shows a summary', hd.n >= 5 && /issue/.test(hd.sum || ''), J(hd));
});
