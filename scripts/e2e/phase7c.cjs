// Phase 7 end-to-end test, part C: Remix (docs/PROMPT_PREMIERE_FINAL.md Phase C).
// A synthetic 120 BPM track (test-assets/e2e/beat_music.wav) and, when the folder exists, the real music in D:\test music
// (read in place, never copied into the repo; set REMIX_MUSIC_DIR to use another folder, REMIX_LISTEN_DIR for where the
// remixed WAVs to listen to are written — default: this run's temp folder).
const { suite } = require('./harness.cjs');
const fs = require('fs');
const path = require('path');

const MUSIC = process.env.REMIX_MUSIC_DIR || 'D:\\test music';

suite('phase7c e2e (Remix)', async ({ js, ok, A, out, tmp }) => {
  const J = (x) => JSON.stringify(x);
  const listen = process.env.REMIX_LISTEN_DIR || path.join(tmp, 'remix-listen'); fs.mkdirSync(listen, { recursive: true });
  const P = (p) => JSON.stringify(p);
  // helpers in the page: remix the clip, export it, measure clicks at the cuts and compare the export with the playback buffer
  await js(`window.RX = {
    async place(file) { const m = await T.imp(file); let id; E.store.edit('place', ({ seq }) => { [id] = E.cmds.placeMedia(seq, m, 0, 'A1'); }); return { id, m }; },
    clip: (id) => T.clip(id),
    async check(id, wav) {
      const s = E.store.getState(); const c = T.clip(id); const sr = s.sequence.sampleRate || 48000;
      const pcm = await E.exporter.renderAudioMix(s, 0, c.dur); const n = pcm.length / 2; const L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = pcm[2 * i] / 32768;
      // clicks: the largest sample step within 25 ms of each cut against the 99.9th percentile step elsewhere
      const cuts = E.remixClip.remixCuts(c).map((u) => Math.round(u * sr)); const w = Math.round(0.025 * sr); const near = (k) => cuts.some((x) => Math.abs(k - x) < w);
      const steps = []; let atCut = 0; for (let k = 1; k < n; k++) { const d = Math.abs(L[k] - L[k - 1]); if (near(k)) atCut = Math.max(atCut, d); else if (k % 7 === 0) steps.push(d); }
      steps.sort((a, b) => a - b); const p999 = steps[Math.floor(steps.length * 0.999)] || 1e-9, mx = steps[steps.length - 1] || 1e-9;
      // preview = export: the playback path plays retimedAudio(); correlate it with the export
      const ctx = new OfflineAudioContext(2, 1, sr); const r = await E.retimed.retimedAudio(ctx, s.sequence, c, E.media.mediaById(c.mediaId));
      const off = Math.round((c.start - r.w0) * r.sr); let xy = 0, xx = 0, yy = 0; const m = Math.min(n, r.chans[0].length - off);
      for (let k = 0; k < m; k += 3) { const a = L[k], b = r.chans[0][k + off]; xy += a * b; xx += a * a; yy += b * b; }
      const corr = xy / Math.sqrt(xx * yy || 1);
      if (wav) await E.exporter.exportSequence({ path: wav, preset: 'WAV (audio only)', start: 0, end: c.dur, audio: true }, () => {}, () => false);
      return { dur: c.dur, n: n / sr, cuts: cuts.length, atCut, p999, mx, corr };
    },
  }; return true;`);

  console.log('C2/C3 synthetic 120 BPM track');
  let r = await js(`T.fresh(320, 240); const { id } = await RX.place('${A('beat_music.wav')}'); window.RID = id; const a0 = E.remixClip.remixStats.analyses;
    const t0 = performance.now(); const res = await E.remixClip.remixClip(id, 30); const ms = performance.now() - t0; const c = T.clip(id);
    await T.tick(200); const badge = [...document.querySelectorAll('.clip')].find((d) => d.dataset.clip === id);
    return { res: { dur: res.dur, cuts: res.segments.length - 1, bpm: res.bpm }, c: { dur: c.dur, remix: !!c.remix, segs: c.remix?.segments, inPoint: c.inPoint }, analyses: E.remixClip.remixStats.analyses - a0, ms,
      badge: !!badge?.querySelector('.fxbadge.remix'), zig: badge?.querySelectorAll('.remix-cut').length, hist: E.store.getState().history.at(-1).label };`);
  ok('60 s → 30 s: clip is the remix length, within one beat (0.5 s)', Math.abs(r.c.dur - 30) <= 0.5 && r.c.remix && Math.abs(r.res.bpm - 120) < 2, J(r));
  ok('intro and ending kept, cuts on the timeline (Remix badge + zigzag per cut), one undo step "Remix"', r.c.segs[0].srcIn === 0 && Math.abs(r.c.segs.at(-1).srcOut - 60) < 0.01 && r.badge && r.zig === r.res.cuts && r.hist === 'Remix', J(r));
  r = await js(`return await RX.check(RID, ${P(path.join(listen, 'beat_music 30s.wav'))});`);
  ok('export length = clip length; no click at the cuts; preview buffer = export (correlation)', Math.abs(r.n - r.dur) < 0.01 && r.atCut <= Math.max(r.mx, r.p999 * 1.5) && r.corr > 0.99, J(r));
  r = await js(`const a0 = E.remixClip.remixStats.analyses; const t0 = performance.now(); const res = await E.remixClip.remixClip(RID, 90); return { dur: T.clip(RID).dur, ms: performance.now() - t0, again: E.remixClip.remixStats.analyses - a0, segs: res.segments.length };`);
  ok('60 s → 90 s from the cached analysis (no new analysis, instant)', Math.abs(r.dur - 90) <= 0.5 && r.again === 0 && r.ms < 1500 && r.segs >= 2, J(r));
  r = await js(`return await RX.check(RID, ${P(path.join(listen, 'beat_music 90s.wav'))});`);
  ok('90 s: no click, preview = export', Math.abs(r.n - r.dur) < 0.01 && r.atCut <= Math.max(r.mx, r.p999 * 1.5) && r.corr > 0.99, J(r));
  r = await js(`E.cmds.run('edit.undo'); const a = T.clip(RID); E.cmds.run('edit.undo'); const b = T.clip(RID); E.cmds.run('edit.redo'); return { a: a.dur, b: { dur: b.dur, remix: !!b.remix }, c: T.clip(RID).dur };`);
  ok('undo / redo step through the remixes, back to the original 60 s', Math.abs(r.a - 30) <= 0.5 && Math.abs(r.b.dur - 60) < 0.01 && !r.b.remix && Math.abs(r.c - 30) <= 0.5, J(r));

  console.log('C2 cache by content: a copy of the file is not analysed again');
  const copy = path.join(tmp, 'same music copy.wav'); fs.copyFileSync(path.join(__dirname, '..', '..', 'test-assets', 'e2e', 'beat_music.wav'), copy);
  r = await js(`const a0 = E.remixClip.remixStats.analyses; const { id } = await RX.place(${P(copy)}); E.store.edit('move', ({ seq }) => { seq.clips.find((c) => c.id === id).track = 'A2'; });
    const res = await E.remixClip.remixClip(id, 40); const d = await window.editorstage.userData(); const files = await window.editorstage.readdir(d + '/remix-cache');
    return { again: E.remixClip.remixStats.analyses - a0, dur: T.clip(id).dur, files: files.length };`);
  ok('copy of the same file: no new analysis; analysis saved in userData/remix-cache', r.again === 0 && Math.abs(r.dur - 40) <= 0.5 && r.files >= 1, J(r));

  console.log('C1 refusing what cannot be remixed');
  r = await js(`T.fresh(320, 240); const { id } = await RX.place('${A('whoosh.wav')}'); let msg = ''; try { await E.remixClip.remixClip(id, 6); } catch (e) { msg = String(e.message); }
    const c = T.clip(id); const { id: v } = await (async () => { const m = await T.imp('${A('rgb_seconds.mp4')}'); let vid; E.store.edit('p', ({ seq }) => { [vid] = E.cmds.placeMedia(seq, m, 5, 'V1'); }); return { id: vid }; })();
    const linked = E.store.getState().sequence.clips.find((x) => x.linkId && x.id !== v && x.track.startsWith('A'));
    const why = E.remixClip.remixProblem(E.store.getState().sequence, linked); const whyV = E.remixClip.remixProblem(E.store.getState().sequence, T.clip(v));
    return { msg, remix: !!c.remix, dur: c.dur, why, whyV };`);
  ok('beat-less sound (whoosh): clear message, clip untouched', /No steady musical beat/.test(r.msg) && !r.remix && Math.abs(r.dur - 12) < 0.05, J(r));
  ok('sound linked to video / a video clip: refused with the reason', /Unlink/.test(r.why || '') && /audio clips/.test(r.whyV || ''), J(r));

  console.log('C1 Remix Tool, Clip > Remix..., Essential Sound > Music > Duration');
  r = await js(`T.fresh(320, 240); const { id } = await RX.place('${A('beat_music.wav')}'); E.store.set({ pps: 10 }); await T.tick(200);
    E.store.set({ tool: 'remix' }); await T.tick(150); const el = [...document.querySelectorAll('.clip')].find((d) => d.dataset.clip === id); const rc = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: rc.right - 2, clientY: rc.top + 5 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: rc.right - 2 - 200, clientY: rc.top + 5 })); await T.tick(30); const ghost = document.querySelector('.remix-ghost')?.textContent;
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: rc.right - 2 - 200, clientY: rc.top + 5 }));
    for (let i = 0; i < 100 && !T.clip(id).remix; i++) await T.tick(50);
    E.store.set({ tool: 'selection', selection: [id] }); E.cmds.run('clip.remix'); await T.tick(100); const dlg = !!document.querySelector('.modal .remix-controls'); E.store.set({ dialog: null });
    const menu = E.menus.clipContextMenu('audio').tail.some((i) => i.cmd === 'clip.remix');
    return { ghost, dur: T.clip(id).dur, dlg, menu };`);
  ok('Remix Tool: dragging the end 20 s shorter (at 10 px/s) remixes to about 40 s; ghost shows the length', r.ghost && /(39|40)\.\d\d s/.test(r.ghost) && Math.abs(r.dur - 40) <= 0.5, J(r));
  ok('Clip > Remix... opens the Remix settings; audio clip right-click menu has Remix...', r.dlg && r.menu, J(r));

  console.log('C3 interchange: a remix goes out as one clip per segment');
  r = await js(`const s = E.store.getState(); const seq = E.remix.expandRemix(s.sequence); const desc = E.interchange.quantize(E.interchange.describeSequence(seq, s.media));
    const xml = E.interchange.writeXMEML(desc); const segs = s.sequence.clips.find((c) => c.remix).remix.segments.length;
    return { segs, clips: desc.clips.length, items: (xml.match(/<clipitem/g) || []).length, trans: desc.transitions.length, skipped: desc.skipped };`);
  ok('XML export: one clip per remix segment + crossfades between them, nothing skipped', r.clips === r.segs && r.items >= r.segs && r.trans === r.segs - 1 && !r.skipped, J(r));

  // ---- real music (D:\test music) ----
  if (!fs.existsSync(MUSIC)) { console.log(`  skip  real music: ${MUSIC} not found`); return; }
  console.log(`C real music from ${MUSIC} (remixed WAVs for listening: ${listen})`);
  const songs = [
    ['Detective Conan theme (HoK x Detective Conan collab).mp3', [60, 300]],
    ['Ultraman_ The Ultimate Hero aka Ultraman Powered OP (60fps 4K) ウルトラマンパワードOP USA Ver..mp3', [30, 150]],
    ['シンガロンスーパー戦隊SONGTheme Tribute50th Anniversary Super Sentaiスーパー戦隊50周年記念ENG SUBS.mp3', [90]],
    ['Powered_mixdown.mp3', [45, 120]],
  ];
  const report = [];
  for (const [file, targets] of songs) {
    const fp = path.join(MUSIC, file); if (!fs.existsSync(fp)) { console.log('  skip  missing', file); continue; }
    r = await js(`T.fresh(320, 240); const { id, m } = await RX.place(${P(fp)}); window.RID = id; const a0 = E.remixClip.remixStats.analyses; const t0 = performance.now();
      const { an } = await E.remixClip.analyzeMedia(m); return { ms: Math.round(performance.now() - t0), dur: m.duration, bpm: an.bpm, analyses: E.remixClip.remixStats.analyses - a0 };`);
    const beat = 60 / r.bpm; const short = file.slice(0, 28);
    ok(`${short}…: analysed once (${r.ms} ms, ${r.bpm.toFixed(1)} BPM)`, r.analyses <= 1 && r.bpm > 50, J(r));
    for (const tg of targets) {
      const wav = path.join(listen, `${file.replace(/\.mp3$/, '').slice(0, 40)} ${tg}s.wav`);
      const q = await js(`const res = await E.remixClip.remixClip(RID, ${tg}); const c = T.clip(RID); const m = E.media.mediaById(c.mediaId);
        const k = await RX.check(RID, ${P(wav)}); return { ...k, segs: c.remix ? c.remix.segments : null, cost: res.cost, srcDur: m.duration };`);
      const kept = q.segs && q.segs[0].srcIn === 0 && Math.abs(q.segs.at(-1).srcOut - q.srcDur) < 0.05;
      ok(`${short}… → ${tg} s: ${q.dur.toFixed(2)} s (±1 beat), intro / ending kept`, Math.abs(q.dur - tg) <= beat + 1e-6 && kept, J({ dur: q.dur, beat }));
      ok(`${short}… → ${tg} s: no click at ${q.cuts} cut(s), preview = export`, q.atCut <= Math.max(q.mx, q.p999 * 1.5) && q.corr > 0.99 && Math.abs(q.n - q.dur) < 0.01, J({ atCut: q.atCut, p999: q.p999, mx: q.mx, corr: q.corr }));
      report.push(`${file.slice(0, 40)} → ${tg}s: ${q.dur.toFixed(2)}s, ${q.cuts} cut(s), cost ${q.cost.toFixed(2)}, worst step at cut ${(q.atCut / q.mx).toFixed(2)}× the loudest step elsewhere`);
    }
  }
  // duplicates: the same bytes are never analysed twice; a different encoding of the same song is a different file
  for (const [a, b] of [['Powered_mixdown.mp3', 'Powered_mixd1own.mp3'], ['シンガロンスーパー戦隊SONGTheme Tribute50th Anniversary Super Sentaiスーパー戦隊50周年記念ENG SUBS.mp3', 'audio [music] (1).mp3']]) {
    const pa = path.join(MUSIC, a), pb = path.join(MUSIC, b); if (!fs.existsSync(pa) || !fs.existsSync(pb)) continue;
    const same = Buffer.compare(fs.readFileSync(pa), fs.readFileSync(pb)) === 0;
    r = await js(`T.fresh(320, 240); const { m: ma } = await RX.place(${P(pa)}); await E.remixClip.analyzeMedia(ma); const a0 = E.remixClip.remixStats.analyses;
      const { m: mb } = await RX.place(${P(pb)}); const t0 = performance.now(); const x = await E.remixClip.analyzeMedia(mb); return { again: E.remixClip.remixStats.analyses - a0, ms: Math.round(performance.now() - t0), cached: x.cached };`);
    if (same) ok(`${b.slice(0, 28)}… has the same bytes as ${a.slice(0, 20)}…: not analysed again (${r.ms} ms)`, r.again === 0, J(r));
    else { ok(`${b.slice(0, 28)}… is a different file (other encoding): analysed on its own`, r.again === 1, J(r)); report.push(`${b} differs byte-wise from ${a}: analysed separately (${r.ms} ms)`); }
  }
  // sound effects are refused
  const fx = fs.readdirSync(MUSIC).filter((f) => /^ES_.*\.mp3$/i.test(f));
  for (const f of fx) {
    r = await js(`T.fresh(320, 240); const { id } = await RX.place(${P(path.join(MUSIC, f))}); let msg = ''; try { await E.remixClip.remixClip(id, 30); } catch (e) { msg = String(e.message); } return { msg, remix: !!T.clip(id).remix };`);
    ok(`${f.slice(0, 40)}… refused: "${r.msg.slice(0, 60)}"`, !!r.msg && !r.remix && /beat|short/i.test(r.msg), J(r));
  }
  fs.writeFileSync(path.join(listen, 'report.txt'), report.join('\n') + '\n');
  console.log('  ' + report.join('\n  '));
});
