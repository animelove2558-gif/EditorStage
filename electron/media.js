// Main-process media engine: FFmpeg fallback transcoding for formats Chromium cannot decode natively.
const { app, ipcMain } = require('electron');
const { createJobs, spawnTracked } = require('./ffjobs');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { ffmpegPath, hasEncoder } = require('./ffmpegBin');
const { renameRetry, guard } = require('./fileGuard');

const ARGS = {
  video: (i, o) => ['-y', '-i', i, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:a', 'aac', '-movflags', '+faststart', o],
  audio: (i, o) => ['-y', '-i', i, '-vn', '-c:a', 'pcm_s16le', o],
  image: (i, o) => ['-y', '-i', i, '-frames:v', '1', o],
  // sources with an alpha channel (ProRes 4444, QuickTime Animation, PNG sequences in MOV, ...) keep it as VP9 + alpha
  videoAlpha: (i, o) => ['-y', '-i', i, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '24', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-c:a', 'libopus', o],
};
const OUT_EXT = { video: 'mp4', audio: 'wav', image: 'png', videoAlpha: 'webm' };
// FFmpeg builds without libx264 (LGPL, Preferences > FFmpeg): the same conversion with another H.264 encoder, else VP9 / WebM
const VIDEO_ALT = [
  { enc: 'libopenh264', ext: 'mp4', args: (i, o) => ['-y', '-i', i, '-c:v', 'libopenh264', '-b:v', '10M', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:a', 'aac', '-movflags', '+faststart', o] },
  { enc: 'h264_mf', ext: 'mp4', args: (i, o) => ['-y', '-i', i, '-c:v', 'h264_mf', '-b:v', '10M', '-pix_fmt', 'nv12', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:a', 'aac', '-movflags', '+faststart', o] },
  { enc: 'libvpx-vp9', ext: 'webm', args: (i, o) => ['-y', '-i', i, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', o] },
];
async function conversions(kind) {
  if (kind !== 'video' || await hasEncoder('libx264')) return [{ ext: OUT_EXT[kind], args: ARGS[kind] }];
  const out = []; for (const a of VIDEO_ALT) if (await hasEncoder(a.enc)) out.push(a);
  return out;
}
const runOnce = (bin, args) => new Promise((resolve) => {
  const p = spawnTracked(bin, args, { windowsHide: true });
  let err = '';
  p.stderr.on('data', (d) => { err = (err + d).slice(-600); });
  p.on('error', (e) => resolve({ ok: false, error: String(e) }));
  p.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: err.trim().split('\n').pop() || `ffmpeg exit ${code}` }));
});

// one conversion per source at a time: a second request for the same file waits for the first
const transcoding = new Map();
ipcMain.handle('media:transcode', (_e, src, kind) => {
  if (!guard().canRead(src)) return { ok: false, error: `EditorStage may not read ${src}` };
  const k = `${kind}|${src}`;
  if (!transcoding.has(k)) transcoding.set(k, transcode(src, kind).catch((e) => ({ ok: false, error: String(e.message || e) })).finally(() => transcoding.delete(k)));
  return transcoding.get(k);
});
async function transcode(src, kind) {
  const bin = ffmpegPath();
  if (!bin || !fs.existsSync(bin)) return { ok: false, error: 'FFmpeg binary not available' };
  const dir = path.join(app.getPath('userData'), 'media-cache');
  fs.mkdirSync(dir, { recursive: true });
  const st = fs.statSync(src);
  const key = crypto.createHash('sha1').update(`${src}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16);
  const ways = await conversions(kind);
  for (const w of ways) { const out = path.join(dir, `${key}.${w.ext}`); if (fs.existsSync(out)) return { ok: true, path: out, cached: true }; }
  if (!ways.length) return { ok: false, error: 'this FFmpeg build has no H.264 or VP9 encoder to convert the video with' };
  let r = null;
  for (const w of ways) { // an encoder can be listed but not work here (Media Foundation without a codec): try the next one
    // FFmpeg writes <key>.part.<ext>; only a finished conversion is renamed to the cache name, so a crash or quit
    // during the conversion never leaves a half file that a later run would take as ready
    const out = path.join(dir, `${key}.${w.ext}`); const part = path.join(dir, `${key}.part.${w.ext}`);
    r = await runOnce(bin, w.args(src, part));
    if (r.ok) { try { await renameRetry(part, out); return { ok: true, path: out }; } catch (e) { r = { ok: false, error: String(e.message || e) }; } }
    try { fs.rmSync(part, { force: true }); } catch { /* partial file */ }
  }
  return r;
}

// ---- Encode jobs: raw frames are piped into FFmpeg's stdin. Several can run at once (Export Queue, generated media). ----
// job ids are chosen by the renderer; the legacy export:* calls use the id 'export'.
const { jobStart, jobWrite, jobEnd, jobCancel } = createJobs(ffmpegPath);
// FFmpeg may only write where the renderer itself may write (no programs, nothing into Startup)
const argsRefused = (args) => guard().checkFfmpegArgs(args);
ipcMain.handle('job:start', (_e, id, args) => { const bad = argsRefused(args); return bad ? { ok: false, error: bad } : jobStart(id, args); });
ipcMain.handle('job:write', (_e, id, buf) => jobWrite(id, buf));
ipcMain.handle('job:end', (_e, id) => jobEnd(id));
ipcMain.handle('job:cancel', (_e, id) => jobCancel(id));
ipcMain.handle('export:start', (_e, args) => { const bad = argsRefused(args); return bad ? { ok: false, error: bad } : jobStart('export', args); });
ipcMain.handle('export:frame', (_e, buf) => jobWrite('export', buf));
ipcMain.handle('export:end', () => jobEnd('export'));
ipcMain.handle('export:cancel', () => jobCancel('export'));
/**
 * Run FFmpeg to completion with arguments only (no stdin). Returns { ok, stderr, cancelled }.
 * With an id the run can be killed (ffmpeg:kill) and reports its position ("time=" of the stats line) as ffmpeg:progress events.
 */
const runs = new Map();
ipcMain.handle('ffmpeg:run', (e, args, id) => new Promise((resolve) => {
  const bin = ffmpegPath(); if (!bin || !fs.existsSync(bin)) return resolve({ ok: false, error: 'FFmpeg binary not available' });
  const bad = argsRefused(args); if (bad) return resolve({ ok: false, error: bad });
  const p = spawnTracked(bin, args, { windowsHide: true }); let err = ''; const run = { p, killed: false }; if (id) runs.set(id, run);
  p.stderr.on('data', (d) => {
    err += d; if (err.length > 4e6) err = err.slice(-2e6);
    if (id) { const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)[^\n]*$/.exec(String(d)); if (m) { try { e.sender.send('ffmpeg:progress', id, +m[1] * 3600 + +m[2] * 60 + +m[3]); } catch { /* window gone */ } } }
  });
  p.on('error', (x) => { runs.delete(id); resolve({ ok: false, error: String(x) }); });
  p.on('close', (code) => { runs.delete(id); resolve({ ok: code === 0 && !run.killed, cancelled: run.killed, stderr: err, error: run.killed ? 'Cancelled' : code === 0 ? undefined : err.trim().split('\n').pop() }); });
}));
ipcMain.handle('ffmpeg:kill', (_e, id) => { const r = runs.get(id); if (r) { r.killed = true; r.p.kill(); } return !!r; });
ipcMain.handle('app:tmp', () => app.getPath('temp'));

// ---- Probe: stream info via `ffmpeg -i` ----
ipcMain.handle('media:probe', (_e, src) => new Promise((resolve) => {
  const bin = ffmpegPath(); if (!bin || !guard().canRead(src)) return resolve({ ok: false });
  const p = spawnTracked(bin, ['-hide_banner', '-i', src], { windowsHide: true });
  let err = ''; p.stderr.on('data', (d) => { err += d; });
  p.on('error', () => resolve({ ok: false }));
  p.on('close', () => {
    const fps = /(\d+(?:\.\d+)?) fps/.exec(err);
    const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
    const vline = /Stream #.*Video: ([^\n]*)/.exec(err); const pix = vline && /(?:^|, )(\w+)(?:\(|,)/.exec(vline[1].split(', ').slice(1).join(', ') + ',');
    const size = vline && /, (\d{2,5})x(\d{2,5})/.exec(vline[1]); const still = vline && /(png|mjpeg|bmp|tiff|webp|gif|jpeg2000|dpx|exr|targa|psd|qoi|pcx|sgi|sunrast|xwd|pbm|pgm|ppm|pam)/.test(vline[1].split(',')[0]) && !/Duration: (?!00:00:00\.0[0-4])/.test(err);
    resolve({ ok: true, hasAudio: /Stream #.*Audio:/.test(err), hasVideo: !!vline, fps: fps ? +fps[1] : null, duration: dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : null,
      pixFmt: pix ? pix[1] : null, alpha: !!(vline && /\b(yuva|rgba|argb|bgra|abgr|gbrap|ya8|ya16|pal8)/.test(vline[1])), width: size ? +size[1] : 0, height: size ? +size[2] : 0, still: !!still, codec: vline ? vline[1].split(/[ ,]/)[0] : null, audio: (/Stream #.*Audio: ([^\n]*)/.exec(err) || [])[1]?.trim() || null, bitrate: (/bitrate: (\d+ kb\/s)/.exec(err) || [])[1] || null });
  });
}));

// ---- MOGRT library (installed Motion Graphics Templates) ----
const libDir = () => { const d = path.join(app.getPath('userData'), 'mogrt-library'); fs.mkdirSync(d, { recursive: true }); return d; };
ipcMain.handle('mogrt:install', async (_e, src) => {
  if (!guard().canRead(src)) throw new Error(`EACCES: EditorStage may not read ${src}`);
  const base = path.basename(src).replace(/[^\w.\-\u0E00-\u0E7F ]+/g, '_');
  let name = base; let n = 1;
  while (fs.existsSync(path.join(libDir(), name))) name = `${path.parse(base).name}-${n++}${path.extname(base)}`;
  await fs.promises.copyFile(src, path.join(libDir(), name));
  return { id: name };
});
ipcMain.handle('mogrt:list', async () => (await fs.promises.readdir(libDir())).filter((f) => /\.mogrt$/i.test(f)).map((f) => ({ id: f, size: fs.statSync(path.join(libDir(), f)).size })));
ipcMain.handle('mogrt:read', async (_e, id) => fs.promises.readFile(path.join(libDir(), path.basename(id))));
ipcMain.handle('mogrt:remove', async (_e, id) => { await fs.promises.rm(path.join(libDir(), path.basename(id)), { force: true }); return true; });
