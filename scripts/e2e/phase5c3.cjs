// Phase 5 end-to-end test, part C3: running on an LGPL FFmpeg. The bundled GPL build is made to report libx264 / libx265
// as missing (EDITORSTAGE_FFMPEG_HIDE_ENCODERS), as an LGPL build would, and every feature that used them must still work
// with a non-GPL encoder - with no x264 / x265 in the output. Also Preferences > FFmpeg (path setting). Run: npm run test:e2e
process.env.EDITORSTAGE_FFMPEG_HIDE_ENCODERS = 'libx264,libx265';
const fs = require('fs');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { suite } = require('./harness.cjs');

suite('phase5c3 e2e', async ({ js, ok, A, out }) => {
  const J = (x) => JSON.stringify(x);
  const probe = (f) => String(spawnSync(ffmpeg, ['-hide_banner', '-i', f]).stderr);
  const vcodec = (f) => /Video: (\w+)/.exec(probe(f))?.[1];
  const noX26x = (f) => { const b = fs.readFileSync(f); return !b.includes('x264 - core') && !b.includes('x265 (build'); };

  console.log('FFmpeg capabilities');
  const info = await js(`return await window.editorstage.ffmpegInfo();`);
  ok('info: version, bundled source, GPL configuration read from -version', info.ok && !!info.version && info.source === 'bundled' && info.gpl === true, J({ ...info, encoders: info.encoders?.length }));
  ok('info: x264 / x265 reported missing (LGPL build), other encoders listed', !info.encoders.includes('libx264') && !info.encoders.includes('libx265') && info.encoders.includes('h264_mf') && info.encoders.includes('prores_ks'));

  console.log('export without x264 / x265');
  await js(`T.fresh(320, 240); const m = await T.imp('${A('rgb_seconds.mp4')}'); T.place(m, 0); return true;`);
  const notes = async (file, preset) => js(`const s = E.store.getState().sequence; const r = await E.exporter.exportSequence({ path: ${J(file)}, preset: ${J(preset)}, width: 320, height: 240, fps: s.fps, start: 0, end: 1, audio: true }, () => {}, () => false); return r;`);
  const h264 = out('lgpl_h264.mp4'); const r1 = await notes(h264, 'H.264 (MP4)');
  ok('H.264 (MP4) exports with a non-GPL encoder and says so', r1.ok && /x264 \(H\.264\) is not in this FFmpeg build: encoded with/.test((r1.notes || []).join()), J(r1));
  ok('H.264 output is H.264 and has no x264 in it', vcodec(h264) === 'h264' && noX26x(h264), vcodec(h264));
  const hevc = out('lgpl_hevc.mp4'); const r2 = await notes(hevc, 'H.265 / HEVC (MP4)');
  ok('HEVC (MP4) exports without x265', r2.ok && vcodec(hevc) === 'hevc' && noX26x(hevc), J({ r2, c: vcodec(hevc) }));
  const pr = out('lgpl_prores.mov'); const r3 = await notes(pr, 'Apple ProRes 422 (MOV)');
  ok('ProRes (LGPL encoder) unchanged, no note', r3.ok && vcodec(pr) === 'prores' && !(r3.notes || []).some((n) => /not in this FFmpeg/.test(n)), J(r3));
  const sw = await js(`const r = await E.exporter.softwareVideo(E.exporter.PRESETS['Preview (H.264, fast)'], { width: 640, height: 360, fps: 30 }); return r;`);
  ok('Render In to Out preset (x264 ultrafast) also gets the replacement', sw.encoder !== 'software' && !sw.args.includes('libx264'), J(sw));

  console.log('import conversion and proxies');
  const avi = out('mpeg4.avi');
  spawnSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=320x240:r=30:d=1', '-c:v', 'mpeg4', avi]);
  const tc = await js(`return await window.editorstage.transcode(${J(avi)}, 'video');`);
  ok('conversion of a format Chromium cannot play works without x264', tc.ok && fs.existsSync(tc.path) && ['h264', 'vp9'].includes(vcodec(tc.path)) && noX26x(tc.path), J({ tc, c: tc.path && vcodec(tc.path) }));
  const proxy = await js(`const m = E.store.getState().media[0]; E.proxy.createProxies([m.id], { preset: 'h264', height: 120 });
    for (let i = 0; i < 300 && E.media.mediaById(m.id).proxy?.status !== 'ready' && !E.store.getState().proxyJobs?.[m.id]?.error; i++) await T.tick(100);
    return { proxy: E.media.mediaById(m.id).proxy, job: E.store.getState().proxyJobs?.[m.id] };`);
  ok('Create Proxies (H.264) works without x264', proxy.proxy?.status === 'ready' && vcodec(proxy.proxy.path) === 'h264' && noX26x(proxy.proxy.path), J(proxy));

  console.log('Preferences > FFmpeg');
  const bad = await js(`return await window.editorstage.setFfmpegPath(${J(out('nothing.exe'))});`);
  ok('a path that is not FFmpeg is refused', bad.ok === false && /not found|not an FFmpeg/.test(bad.error), J(bad));
  const set = await js(`return await window.editorstage.setFfmpegPath(${J(ffmpeg)});`);
  ok('a valid FFmpeg is saved and used (source: preferences)', set.ok && set.info.source === 'preferences' && set.info.path === ffmpeg, J(set.info && { s: set.info.source, p: set.info.path }));
  await js(`E.store.set({ dialog: { type: 'preferences' } }); return true;`);
  const text = await js(`await T.modal(); [...document.querySelectorAll('.pref-tabs button')].find((b) => b.textContent === 'Media')?.click(); await T.tick(50); for (let i = 0; i < 80 && /checking…|reading…/.test(document.querySelector('.modal').textContent); i++) await T.tick(100); return document.querySelector('.modal').textContent;`);
  ok('Preferences shows the binary, license and what replaces x264 / x265', /GPL build/.test(text) && /set here/.test(text) && /Create Proxies: H\.264/.test(text) && /conversion of formats Chromium cannot play(OpenH264|Windows Media Foundation|VP9)/.test(text) && !/checking…|x264 \(H\.264\) \(GPL\)/.test(text), text.slice(0, 600));
  await js(`E.store.set({ dialog: null }); return true;`);
  const back = await js(`return await window.editorstage.setFfmpegPath(null);`);
  ok('Use Default goes back to the bundled binary', back.ok && back.info.source === 'bundled', J(back.info && back.info.source));
});
