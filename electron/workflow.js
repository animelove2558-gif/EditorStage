// Main-process services for the workflow features: Edit in AudioStage (launch + file watch), audio extraction,
// cold-storage archive, project-history storage helpers and remote-session detection.
const { app, ipcMain, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const { ffmpegPath } = require('./ffmpegBin');
const send = (ch, payload) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(ch, payload); };
const runFfmpeg = (args) => new Promise((resolve) => {
  const bin = ffmpegPath(); if (!bin || !fs.existsSync(bin)) return resolve({ ok: false, error: 'FFmpeg binary not available' });
  const p = spawn(bin, args, { windowsHide: true }); let err = '';
  p.stderr.on('data', (d) => { err = (err + d).slice(-800); });
  p.on('error', (e) => resolve({ ok: false, error: String(e) }));
  p.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: err.trim().split('\n').pop() || `ffmpeg exit ${code}` }));
});

// ---------------------------------------------------------------- generic fs helpers (history / archive)
ipcMain.handle('fs:mkdir', async (_e, p) => { await fs.promises.mkdir(p, { recursive: true }); return true; });
ipcMain.handle('fs:exists', async (_e, p) => fs.existsSync(p));
ipcMain.handle('fs:stat', async (_e, p) => { try { const s = await fs.promises.stat(p); return { size: s.size, mtime: s.mtimeMs, dir: s.isDirectory() }; } catch { return null; } });
ipcMain.handle('fs:readdir', async (_e, p) => { try { return await fs.promises.readdir(p); } catch { return []; } });
/**
 * Locate Media: search `roots` (breadth first, up to `depth` folders deep, at most ~20000 folders) for files whose name is in
 * `names` (case-insensitive). Returns { [lowerName]: [{ path, size }] }.
 */
ipcMain.handle('fs:findFiles', async (_e, roots, names, depth = 6) => {
  const want = new Set(names.map((n) => n.toLowerCase())); const out = {}; let budget = 20000;
  const queue = roots.map((r) => [r, 0]); const seen = new Set();
  while (queue.length && budget-- > 0) {
    const [dir, d] = queue.shift(); if (seen.has(dir)) continue; seen.add(dir);
    let ents = []; try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (d < depth && !/^(\$RECYCLE\.BIN|System Volume Information|node_modules|\.git)$/i.test(e.name)) queue.push([p, d + 1]); continue; }
      const k = e.name.toLowerCase(); if (!want.has(k)) continue;
      let size = null; try { size = (await fs.promises.stat(p)).size; } catch { /* unreadable */ }
      (out[k] = out[k] || []).push({ path: p, size });
    }
  }
  return out;
});
ipcMain.handle('app:userData', () => app.getPath('userData'));
ipcMain.handle('app:version', () => require('../package.json').version); // app.getVersion() is Electron's own version when run unpackaged
// Help > Third-Party Notices: resources/licenses in the installed app, licenses/ in the project (after collect_licenses)
ipcMain.handle('app:licensesFile', () => [app.isPackaged && path.join(process.resourcesPath, 'licenses', 'THIRD_PARTY_LICENSES.md'), path.join(__dirname, '..', 'licenses', 'THIRD_PARTY_LICENSES.md'), path.join(__dirname, '..', 'THIRD_PARTY_LICENSES.md')].find((f) => f && fs.existsSync(f)) || null);
ipcMain.handle('app:licenses', () => [app.isPackaged && path.join(process.resourcesPath, 'licenses'), path.join(__dirname, '..', 'licenses')].find((d) => d && fs.existsSync(d)) || null);
ipcMain.handle('app:env', () => ({ remoteSession: process.platform === 'win32' && /^RDP-/i.test(process.env.SESSIONNAME || ''), sessionName: process.env.SESSIONNAME || '', platform: process.platform }));

// ---------------------------------------------------------------- audio extraction (Edit in AudioStage, AI tools)
/** Render a source range to a WAV (default 48 kHz / 24-bit PCM). */
ipcMain.handle('media:extractAudio', async (_e, src, start, dur, out, opts = {}) => {
  await fs.promises.mkdir(path.dirname(out), { recursive: true });
  const codec = opts.bits === 16 ? 'pcm_s16le' : opts.bits === 32 ? 'pcm_f32le' : 'pcm_s24le';
  const args = ['-y', '-hide_banner', '-ss', String(Math.max(0, start || 0)), ...(dur ? ['-t', String(dur)] : []), '-i', src, '-vn', '-map', '0:a:0?', '-c:a', codec, '-ar', String(opts.rate || 48000), ...(opts.mono ? ['-ac', '1'] : []), out];
  const r = await runFfmpeg(args); return r.ok ? { ok: true, path: out } : r;
});

// ---------------------------------------------------------------- Edit in AudioStage
const settingsFile = () => path.join(app.getPath('userData'), 'audiostage.json');
const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } };
/** Find AudioStage: user setting, installed builds, then the sibling development folder (run with Electron). */
function locateAudioStage() {
  const s = readSettings(); const cands = [];
  if (s.path) cands.push(s.path);
  const la = process.env.LOCALAPPDATA || '', pf = process.env.ProgramFiles || 'C:\\Program Files', pf86 = process.env['ProgramFiles(x86)'] || '';
  cands.push(path.join(la, 'Programs', 'AudioStage', 'AudioStage.exe'), path.join(pf, 'AudioStage', 'AudioStage.exe'), pf86 && path.join(pf86, 'AudioStage', 'AudioStage.exe'), '/Applications/AudioStage.app');
  const appRoot = path.join(__dirname, '..');
  cands.push(path.join(appRoot, '..', 'AudioStage'), path.join(path.dirname(process.execPath), '..', 'AudioStage'));
  for (const c of cands.filter(Boolean)) {
    try {
      const st = fs.statSync(c);
      if (st.isFile() || /\.app$/.test(c)) return { kind: 'exe', path: c };
      if (st.isDirectory() && fs.existsSync(path.join(c, 'package.json')) && fs.existsSync(path.join(c, 'main.js'))) {
        const own = path.join(c, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
        let electronBin = fs.existsSync(own) ? own : null;
        if (!electronBin && /^electron/i.test(path.basename(process.execPath))) electronBin = process.execPath; // EditorStage itself runs on a dev Electron
        if (typeof electronBin === 'string' && fs.existsSync(electronBin)) return { kind: 'dev', path: c, electron: electronBin };
      }
    } catch { /* not there */ }
  }
  return null;
}
ipcMain.handle('audiostage:locate', () => locateAudioStage());
ipcMain.handle('audiostage:setPath', (_e, p) => { const s = readSettings(); s.path = p || undefined; fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); return locateAudioStage(); });

const watchers = new Map(); // file -> { watcher, timer, last }
function watchFile(file) {
  if (watchers.has(file)) return;
  const dir = path.dirname(file), base = path.basename(file);
  let last = (() => { try { const s = fs.statSync(file); return `${s.size}:${s.mtimeMs}`; } catch { return ''; } })();
  const check = () => {
    // fire only once the file has stopped growing (AudioStage writes the whole file in one go, but be safe)
    let sig = ''; try { const s = fs.statSync(file); sig = `${s.size}:${s.mtimeMs}`; } catch { return; }
    if (sig === last) return;
    const ent = watchers.get(file); clearTimeout(ent.timer);
    ent.timer = setTimeout(() => { let s2 = ''; try { const s = fs.statSync(file); s2 = `${s.size}:${s.mtimeMs}`; } catch { return; } if (s2 !== sig) return check(); last = s2; send('audiostage:changed', { path: file, size: +s2.split(':')[0] }); }, 400);
  };
  // watch the folder (editors may replace the file instead of rewriting it in place)
  const w = fs.watch(dir, (_ev, name) => { if (!name || name.toLowerCase() === base.toLowerCase()) check(); });
  watchers.set(file, { watcher: w, timer: null });
}
ipcMain.handle('audiostage:open', async (_e, file) => {
  const loc = locateAudioStage();
  if (!loc) return { ok: false, error: 'AudioStage was not found. Set its location in Smart Tools > AudioStage.' };
  const arg = `--editorstage-edit=${file}`;
  try {
    const child = loc.kind === 'dev' ? spawn(loc.electron, [loc.path, arg], { cwd: loc.path, detached: true, stdio: 'ignore', windowsHide: false })
      : /\.app$/.test(loc.path) ? spawn('open', ['-a', loc.path, '--args', arg], { detached: true, stdio: 'ignore' })
        : spawn(loc.path, [arg], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
  watchFile(file);
  return { ok: true, launched: loc };
});
ipcMain.handle('audiostage:watch', (_e, file) => { watchFile(file); return true; });
ipcMain.handle('audiostage:unwatch', (_e, file) => { const w = watchers.get(file); if (w) { w.watcher.close(); clearTimeout(w.timer); watchers.delete(file); } return true; });
app.on('before-quit', () => { for (const w of watchers.values()) w.watcher.close(); });

// ---------------------------------------------------------------- Cold archive
const indexFile = () => path.join(app.getPath('userData'), 'archive-index.json');
const readIndex = () => { try { return JSON.parse(fs.readFileSync(indexFile(), 'utf8')); } catch { return { archives: [] }; } };
const writeIndex = (ix) => fs.writeFileSync(indexFile(), JSON.stringify(ix, null, 1));
const sha1File = (p) => new Promise((res, rej) => { const h = crypto.createHash('sha1'); fs.createReadStream(p).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
const volumeLabel = (p) => { const m = /^([A-Za-z]:)/.exec(p); return m ? m[1].toUpperCase() : path.parse(p).root; };

/**
 * Archive files: copy (gzip-compressed or stored) to `<dest>/EditorStage Archive/<project>/`, verify, optionally delete the
 * originals, and record everything in a searchable index (kept in userData and on the drive).
 * items: [{ path, name, kind, duration, width, height }]
 */
ipcMain.handle('archive:run', async (e, { items, dest, project, compress = true, removeOriginals = false, note = '' }) => {
  const root = path.join(dest, 'EditorStage Archive', String(project || 'Untitled').replace(/[<>:"/\\|?*]+/g, '_'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const dir = path.join(root, stamp);
  await fs.promises.mkdir(path.join(dir, 'files'), { recursive: true });
  const entries = []; let i = 0;
  for (const it of items) {
    i++; e.sender.send('archive:progress', { i, n: items.length, name: it.name });
    try {
      const st = await fs.promises.stat(it.path); const hash = await sha1File(it.path);
      const ext = path.extname(it.path); const stored = `${hash}${ext}${compress ? '.gz' : ''}`; const out = path.join(dir, 'files', stored);
      if (compress) await pipeline(fs.createReadStream(it.path), zlib.createGzip({ level: 6 }), fs.createWriteStream(out));
      else await fs.promises.copyFile(it.path, out);
      const ast = await fs.promises.stat(out);
      if (removeOriginals) { // verify before deleting: re-hash the archived copy
        const h2 = compress ? await new Promise((res, rej) => { const h = crypto.createHash('sha1'); fs.createReadStream(out).pipe(zlib.createGunzip()).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); }) : await sha1File(out);
        if (h2 !== hash) throw new Error('verification failed');
        await fs.promises.rm(it.path, { force: true });
      }
      entries.push({ ...it, originalPath: it.path, size: st.size, archivedSize: ast.size, mtime: st.mtimeMs, hash, stored, compressed: compress, removed: !!removeOriginals });
    } catch (err) { entries.push({ ...it, originalPath: it.path, error: String(err.message || err) }); }
  }
  const rec = { id: crypto.randomUUID(), project, created: Date.now(), dest: dir, volume: volumeLabel(dest), note, items: entries };
  await fs.promises.writeFile(path.join(dir, 'index.json'), JSON.stringify(rec, null, 1));
  const ix = readIndex(); ix.archives.push(rec); writeIndex(ix);
  return { ok: true, record: rec };
});
ipcMain.handle('archive:index', () => readIndex());
ipcMain.handle('archive:forget', (_e, id) => { const ix = readIndex(); ix.archives = ix.archives.filter((a) => a.id !== id); writeIndex(ix); return true; });
/** Re-read an archive folder's index.json (e.g. a drive archived on another machine) into the local index. */
ipcMain.handle('archive:importIndex', async (_e, folder) => {
  const rec = JSON.parse(await fs.promises.readFile(path.join(folder, 'index.json'), 'utf8')); rec.dest = folder;
  const ix = readIndex(); ix.archives = ix.archives.filter((a) => a.id !== rec.id); ix.archives.push(rec); writeIndex(ix); return rec;
});
/** Restore one archived item to `to` (default: its original path). Fails cleanly when the drive is not connected. */
ipcMain.handle('archive:restore', async (_e, { archiveId, hash, to }) => {
  const rec = readIndex().archives.find((a) => a.id === archiveId); if (!rec) return { ok: false, error: 'Unknown archive' };
  const it = rec.items.find((x) => x.hash === hash); if (!it) return { ok: false, error: 'Unknown item' };
  const src = path.join(rec.dest, 'files', it.stored);
  if (!fs.existsSync(src)) return { ok: false, error: `Archive drive not connected (${rec.volume}). Connect it and try again.`, offline: true };
  const out = to || it.originalPath; await fs.promises.mkdir(path.dirname(out), { recursive: true });
  if (it.compressed) await pipeline(fs.createReadStream(src), zlib.createGunzip(), fs.createWriteStream(out)); else await fs.promises.copyFile(src, out);
  return { ok: true, path: out };
});
ipcMain.handle('archive:online', (_e, dest) => fs.existsSync(dest));
