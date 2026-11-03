const { app, BrowserWindow, ipcMain, dialog, Menu, session, protocol, net, shell, desktopCapturer } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs/promises');
const { atomicWrite, renameRetry, guard, inside, MEDIA_EXT } = require('./fileGuard');
const { killAll } = require('./ffjobs');
require('./media');
require('./workflow');

// Privileged media scheme: CORS-enabled + streamable so <video>/<audio> can feed WebAudio and WebGL.
protocol.registerSchemesAsPrivileged([{ scheme: 'es-app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true } }, { scheme: 'es-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } }]);

// Hardware acceleration / WebGPU / WebCodecs flags
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('enable-features', 'WebCodecs,VaapiVideoDecoder,PlatformHEVCDecoderSupport');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

function createWindow() {
  const win = new BrowserWindow({
    width: 1680, height: 1000, minWidth: 1100, minHeight: 700,
    backgroundColor: '#1d1d1d', title: 'EditorStage', show: false,
    icon: path.join(__dirname, '..', 'dist', 'logo.png'), // build/icon.png, copied by scripts/build.mjs
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      autoplayPolicy: 'no-user-gesture-required', contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      devTools: !app.isPackaged, // the installed app has no DevTools
    },
  });
  lockNavigation(win.webContents);
  Menu.setApplicationMenu(null); // the UI renders its own Premiere-style menu bar
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // Closing asks the page first (unsaved changes: Save / Don't Save / Cancel). The page acknowledges at once and later
  // answers app:closeOk; a page that does not acknowledge (crashed, hung) does not keep the window open.
  win.on('close', (e) => {
    if (win.closeOk || win.webContents.isCrashed()) return;
    e.preventDefault(); let acked = false;
    const ack = (ev) => { if (ev.sender === win.webContents) acked = true; };
    ipcMain.once('app:closeAck', ack);
    win.webContents.send('app:closeRequest');
    setTimeout(() => { ipcMain.removeListener('app:closeAck', ack); if (!acked && !win.isDestroyed()) { win.closeOk = true; win.close(); } }, 2000);
  });
  win.on('maximize', () => win.webContents.send('win:state', 'maximized'));
  win.on('unmaximize', () => win.webContents.send('win:state', 'normal'));
  return win;
}

const appPage = pathToFileURL(path.join(__dirname, '..', 'dist')).toString().toLowerCase() + '/';
const isWeb = (url) => /^https?:\/\//i.test(String(url));
/**
 * The main window never navigates away from the app and never opens other Electron windows (they would get the preload
 * API): links (MOGRT text, dropped files) to http(s) open in the system browser, everything else is refused.
 */
function lockNavigation(wc) {
  wc.setWindowOpenHandler(({ url }) => { if (isWeb(url)) shell.openExternal(url).catch(() => {}); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!String(url).toLowerCase().startsWith(appPage)) { e.preventDefault(); if (isWeb(url)) shell.openExternal(url).catch(() => {}); } });
  wc.on('will-attach-webview', (e) => e.preventDefault());
}

// 100% offline: block every non-local request
function enforceOffline() {
  // Capture > Screen: the user confirms before the whole screen and the speaker sound are recorded
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const w = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const r = await dialog.showMessageBox(w, { type: 'question', buttons: ['Record Screen', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Screen Capture', message: 'EditorStage wants to record your whole screen and the sound of your speakers.', detail: 'Recording starts when you choose Record Screen.' });
    if (r.response !== 0) return cb({});
    const src = await desktopCapturer.getSources({ types: ['screen'] }); cb(src[0] ? { video: src[0], audio: 'loopback' } : {});
  });
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media' || perm === 'local-fonts'));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media' || perm === 'local-fonts');
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const ok = /^(file|devtools|chrome-extension|data|blob|es-media|es-app):/.test(details.url);
    cb({ cancel: !ok });
  });
}

const filters = {
  project: [{ name: 'EditorStage Project', extensions: ['esproj'] }],
  media: [{ name: 'All Supported Media', extensions: ['mp4','mov','avi','mkv','webm','prores','hevc','h265','h264','264','mpeg','mpg','m4v','ts','flv','jpg','jpeg','png','gif','webp','tiff','tif','bmp','svg','heic','heif','raw','cr2','nef','arw','dng','wav','mp3','aac','m4a','flac','ogg','aiff','aif','wma','xml','fcpxml','edl'] }, { name: 'Sequence (XML / FCPXML / EDL)', extensions: ['xml', 'fcpxml', 'edl'] }, { name: 'All Files', extensions: ['*'] }],
  mogrt: [{ name: 'Motion Graphics Template', extensions: ['mogrt'] }],
  ffmpeg: process.platform === 'win32' ? [{ name: 'FFmpeg', extensions: ['exe'] }, { name: 'All Files', extensions: ['*'] }] : [{ name: 'All Files', extensions: ['*'] }],
  interchange: [{ name: 'Sequence (Premiere / FCP7 XML, FCPXML, EDL)', extensions: ['xml', 'fcpxml', 'edl'] }],
  lut: [{ name: '3D LUT (.cube, .3dl)', extensions: ['cube', '3dl'] }],
  keymap: [{ name: 'EditorStage Keyboard Shortcuts', extensions: ['eskeys', 'json'] }],
  preset: [{ name: 'Effect Presets (.espreset, Premiere .prfpset)', extensions: ['espreset', 'prfpset', 'json'] }],
  app: [{ name: 'Application', extensions: process.platform === 'win32' ? ['exe'] : ['app', '*'] }],
};

// paths picked in a dialog are what the renderer may write / delete / run beyond its own data (electron/fileGuard.js)
const G = guard();
// projects the user opened or saved (in a dialog, from Explorer, by drag and drop) stay openable from File > Open Recent:
// the list is kept by the main process (userData/recent-projects.json), not by the page
const recentFile = () => path.join(app.getPath('userData'), 'recent-projects.json');
let recent = null;
const loadRecent = () => { if (recent) return recent; try { recent = JSON.parse(require('fs').readFileSync(recentFile(), 'utf8')).filter((p) => typeof p === 'string'); } catch { recent = []; } for (const p of recent) G.grantProject(p); return recent; };
/** a project file the user opens: the file, its history folder (<name>.history) and its own folders may be written */
const grantProject = (p) => {
  if (!/\.esproj$/i.test(String(p))) return; G.grantProject(p);
  const list = loadRecent(); const k = path.resolve(p).toLowerCase(); recent = [p, ...list.filter((x) => path.resolve(x).toLowerCase() !== k)].slice(0, 30);
  atomicWrite(recentFile(), JSON.stringify(recent)).catch(() => {});
};
ipcMain.handle('dialog:open', async (_e, kind, multi) => {
  const r = await dialog.showOpenDialog({ filters: filters[kind], properties: ['openFile', ...(multi ? ['multiSelections'] : [])] });
  if (r.canceled) return [];
  for (const p of r.filePaths) { G.grantFile(p); grantProject(p); }
  return r.filePaths;
});
ipcMain.handle('dialog:save', async (_e, kind, name, ext) => {
  const flt = kind === 'export' ? [{ name: String(ext).toUpperCase(), extensions: [ext] }] : filters[kind];
  const r = await dialog.showSaveDialog({ filters: flt, defaultPath: name });
  if (r.canceled || !r.filePath) return null;
  G.grantFile(r.filePath); grantProject(r.filePath);
  return r.filePath;
});
ipcMain.handle('dialog:folder', async () => { const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }); if (r.canceled) return null; G.grantDir(r.filePaths[0]); return r.filePaths[0]; });
const refuse = (what, p) => Object.assign(new Error(`EACCES: EditorStage may not ${what} ${p}`), { code: 'EACCES' });
ipcMain.handle('fs:read', async (_e, p) => { loadRecent(); if (!G.canRead(p)) throw refuse('read', p); return fs.readFile(p); });
// reading a project the user opened also allows what it refers to (media, LUTs, captions, scratch disks)
ipcMain.handle('fs:readText', async (_e, p) => { loadRecent(); if (!G.canRead(p)) throw refuse('read', p); const t = await fs.readFile(p, 'utf8'); if (/\.esproj$/i.test(String(p))) { grantProject(p); G.grantProjectContent(p, t); } return t; });
// drag and drop: the preload takes the path from the dropped File object (page script cannot make one up)
ipcMain.on('fs:dropped', (_e, p) => { G.grantDropped(p); if (/\.esproj$/i.test(String(p))) grantProject(p); });
// every write is atomic (temp file + fsync + rename): a failed Save never damages the file that was there
ipcMain.handle('fs:write', async (_e, p, data) => { loadRecent(); if (!G.canWrite(p)) throw refuse('write', p); await atomicWrite(p, data); G.made(p); if (/\.esproj$/i.test(String(p))) grantProject(p); });

ipcMain.handle('fs:listRoots', async () => { const out = []; for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') { try { await fs.access(l + ':\\'); out.push(l + ':\\'); } catch { /* none */ } } return process.platform === 'win32' ? out : ['/']; });
ipcMain.handle('fs:listDir', async (_e, dir) => { try { const ents = await fs.readdir(dir, { withFileTypes: true }); return { dirs: ents.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort(), files: ents.filter((e) => e.isFile() && MEDIA_EXT.has(e.name.split('.').pop().toLowerCase())).map((e) => e.name).sort() }; } catch { return { dirs: [], files: [] }; } });

// rename over an existing file (finished exports: <name>.es-part.<ext> -> <name>.<ext>)
ipcMain.handle('fs:rename', async (_e, from, to) => {
  if (!G.canRemove(from)) throw refuse('move', from); if (!G.canWrite(to)) throw refuse('write', to);
  await renameRetry(from, to); G.made(to); return true;
});
ipcMain.handle('fs:copy', async (_e, from, to) => { if (!G.canRead(from)) throw refuse('read', from); if (!G.canWrite(to)) throw refuse('write', to); await fs.copyFile(from, to); G.made(to); return true; });
// retries: a file FFmpeg was just stopped writing (a cancelled export) stays locked on Windows for a moment
ipcMain.handle('fs:rm', async (_e, p) => { if (!G.canRemove(p)) return false; try { await fs.rm(p, { force: true, maxRetries: 8, retryDelay: 150 }); return true; } catch { return false; } });
// the system opens documents and folders, never programs or scripts (a media path in a project from someone else)
ipcMain.handle('shell:open', async (_e, p) => (await G.canOpen(p) ? shell.openPath(p) : 'EditorStage does not open programs or scripts'));
ipcMain.handle('shell:reveal', (_e, p) => shell.showItemInFolder(p));
ipcMain.on('win:control', (e, action) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (action === 'minimize') w.minimize();
  else if (action === 'maximize') (w.isMaximized() ? w.unmaximize() : w.maximize());
  else if (action === 'close') w.close();
  else if (action === 'devtools') { if (!app.isPackaged) w.webContents.toggleDevTools(); }
  else if (action === 'fullscreen') w.setFullScreen(!w.isFullScreen());
});

app.whenReady().then(() => {
  const MIME = { '.wasm': 'application/wasm', '.js': 'text/javascript', '.task': 'application/octet-stream', '.tflite': 'application/octet-stream' };
  protocol.handle('es-app', async (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
    const dist = path.join(__dirname, '..', 'dist'); const full = path.join(dist, rel);
    if (!inside(full, dist)) return new Response('forbidden', { status: 403 }); // a sibling such as dist-other/ is outside dist/
    const r = await net.fetch(pathToFileURL(full).toString());
    const h = new Headers(r.headers); h.set('Access-Control-Allow-Origin', '*'); const ct = MIME[path.extname(full)]; if (ct) h.set('Content-Type', ct);
    return new Response(r.body, { status: r.status, headers: h });
  });
  // es-media://local/<path>: local media with HTTP byte ranges (206), so <video>/<audio> can seek anywhere
  const MEDIA_MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' };
  protocol.handle('es-media', async (req) => {
    const p = decodeURIComponent(new URL(req.url).pathname.slice(1));
    if (!G.canRead(p)) return new Response('forbidden', { status: 403 });
    const fsSync = require('fs'); const { Readable } = require('stream');
    let st; try { st = await fs.stat(p); } catch { return new Response('not found', { status: 404 }); }
    const h = new Headers({ 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Type': MEDIA_MIME[path.extname(p).slice(1).toLowerCase()] || 'application/octet-stream' });
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
    if (m && st.size > 0) {
      let a = m[1] === '' ? Math.max(0, st.size - +m[2]) : +m[1]; let b = m[1] !== '' && m[2] !== '' ? +m[2] : st.size - 1; b = Math.min(b, st.size - 1);
      if (a > b || a >= st.size) { h.set('Content-Range', `bytes */${st.size}`); return new Response(null, { status: 416, headers: h }); }
      h.set('Content-Range', `bytes ${a}-${b}/${st.size}`); h.set('Content-Length', String(b - a + 1));
      return new Response(Readable.toWeb(fsSync.createReadStream(p, { start: a, end: b })), { status: 206, headers: h });
    }
    h.set('Content-Length', String(st.size));
    return new Response(Readable.toWeb(fsSync.createReadStream(p)), { status: 200, headers: h });
  });
  enforceOffline();
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
// child processes (FFmpeg exports, renders, conversions) do not end with EditorStage on Windows: stop them
app.on('will-quit', () => { killAll(); });

ipcMain.on('app:closeOk', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) { w.closeOk = true; w.close(); } });
// .esproj opened from Explorer (file association): the path comes on the command line, or from a second launch
const projectArg = (argv) => argv.slice(1).find((a) => /\.esproj$/i.test(a) && require('fs').existsSync(a)) || null;
let pendingProject = projectArg(process.argv); if (pendingProject) { G.grantFile(pendingProject); grantProject(pendingProject); }
ipcMain.handle('app:takeOpenFile', () => { const p = pendingProject; pendingProject = null; return p; });
if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', (_e, argv) => {
  const w = BrowserWindow.getAllWindows()[0]; if (!w) return;
  if (w.isMinimized()) w.restore(); w.focus();
  const p = projectArg(argv); if (p) { G.grantFile(p); grantProject(p); w.webContents.send('app:openFile', p); }
});
