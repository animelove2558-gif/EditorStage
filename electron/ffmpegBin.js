// Which FFmpeg binary EditorStage runs, and what it can do. First match wins:
//   1. Preferences > FFmpeg (userData/ffmpeg.json { path })
//   2. EDITORSTAGE_FFMPEG environment variable
//   3. build config: ffmpeg.json { path } in the app's resources folder (packaged) or the project root (dev);
//      a relative path is resolved from that file's folder - ship an LGPL build with electron-builder "extraResources"
//   4. the bundled ffmpeg-static (a GPL build: libx264 / libx265)
// EDITORSTAGE_FFMPEG_HIDE_ENCODERS=libx264,libx265 (tests) reports those encoders as missing, as an LGPL build would.
const { app, ipcMain } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const settingsFile = () => path.join(app.getPath('userData'), 'ffmpeg.json');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const bundled = () => { try { return require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked'); } catch { return null; } };
function buildConfig() {
  for (const dir of [process.resourcesPath, path.join(__dirname, '..')].filter(Boolean)) {
    const f = path.join(dir, 'ffmpeg.json'); const j = readJson(f);
    if (j?.path) return path.resolve(dir, j.path);
  }
  return null;
}
/** { path, source } of the binary in use. */
function resolveFfmpeg() {
  const pref = readJson(settingsFile())?.path;
  if (pref && fs.existsSync(pref)) return { path: pref, source: 'preferences' };
  const env = process.env.EDITORSTAGE_FFMPEG;
  if (env && fs.existsSync(env)) return { path: env, source: 'env' };
  const build = buildConfig();
  if (build && fs.existsSync(build)) return { path: build, source: 'build' };
  return { path: bundled(), source: 'bundled' };
}
let current = null;
const ffmpegPath = () => (current ||= resolveFfmpeg()).path;

const run = (bin, args) => new Promise((resolve) => execFile(bin, args, { windowsHide: true, maxBuffer: 8 << 20, timeout: 15000 }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '') + String(stderr || '') })));
const hidden = () => String(process.env.EDITORSTAGE_FFMPEG_HIDE_ENCODERS || '').split(',').map((s) => s.trim()).filter(Boolean);
const infoCache = new Map(); // path -> Promise<info>
/** Version, license and encoder list of a binary: { ok, path, version, configuration, gpl, nonfree, encoders }. */
function probeBinary(bin) {
  if (!bin) return Promise.resolve({ ok: false, error: 'no FFmpeg binary' });
  if (!infoCache.has(bin)) infoCache.set(bin, (async () => {
    if (!fs.existsSync(bin)) return { ok: false, path: bin, error: 'file not found' };
    const v = await run(bin, ['-hide_banner', '-version']);
    const version = /ffmpeg version (\S+)/.exec(v.out)?.[1];
    if (!version) return { ok: false, path: bin, error: 'not an FFmpeg executable' };
    const configuration = /configuration:([^\n]*)/.exec(v.out)?.[1].trim() || '';
    const e = await run(bin, ['-hide_banner', '-encoders']);
    const hide = hidden();
    const encoders = [...e.out.matchAll(/^ [VAS][.A-Z]{5} (\S+)/gm)].map((x) => x[1]).filter((x) => x !== '=' && !hide.includes(x));
    return { ok: true, path: bin, version, configuration, gpl: /--enable-gpl\b/.test(configuration), nonfree: /--enable-nonfree\b/.test(configuration), encoders };
  })());
  return infoCache.get(bin);
}
async function ffmpegInfo() {
  const r = current ||= resolveFfmpeg();
  const i = await probeBinary(r.path);
  return { ...i, source: r.source, bundled: bundled() };
}
const hasEncoder = async (name) => { const i = await ffmpegInfo(); return !i.ok || i.encoders.includes(name); };

ipcMain.handle('ffmpeg:info', () => ffmpegInfo());
/** Preferences > FFmpeg: use this binary (null = back to the default chain). Checked before it is saved. */
ipcMain.handle('ffmpeg:setPath', async (_e, p) => {
  // only a binary the user picked in the file dialog is run (a path from anywhere else could be any program)
  if (p && !require('./fileGuard').guard().picked(p)) return { ok: false, error: 'Choose the FFmpeg executable with Browse...' };
  if (p) {
    const i = await probeBinary(p); infoCache.delete(p);
    if (!i.ok) return { ok: false, error: `${p}: ${i.error}` };
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify({ path: p }));
  } else { try { fs.rmSync(settingsFile(), { force: true }); } catch { /* none */ } }
  current = null;
  return { ok: true, info: await ffmpegInfo() };
});

module.exports = { ffmpegPath, ffmpegInfo, hasEncoder };
