const { app, BrowserWindow, ipcMain, dialog, Menu, session, protocol, net, shell, desktopCapturer } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs/promises');
const { atomicWrite } = require('./fileGuard');
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
      autoplayPolicy: 'no-user-gesture-required', contextIsolation: true, nodeIntegration: false, sandbox: false, webSecurity: true,
    },
  });
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

// 100% offline: block every non-local request
function enforceOffline() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => { const src = await desktopCapturer.getSources({ types: ['screen'] }); cb({ video: src[0], audio: 'loopback' }); });
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

ipcMain.handle('dialog:open', async (_e, kind, multi) => {
  const r = await dialog.showOpenDialog({ filters: filters[kind], properties: ['openFile', ...(multi ? ['multiSelections'] : [])] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('dialog:save', async (_e, kind, name, ext) => {
  const flt = kind === 'export' ? [{ name: String(ext).toUpperCase(), extensions: [ext] }] : filters[kind];
  const r = await dialog.showSaveDialog({ filters: flt, defaultPath: name });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('dialog:folder', async () => { const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('fs:read', async (_e, p) => fs.readFile(p));
ipcMain.handle('fs:readText', async (_e, p) => fs.readFile(p, 'utf8'));
// every write is atomic (temp file + fsync + rename): a failed Save never damages the file that was there
ipcMain.handle('fs:write', async (_e, p, data) => atomicWrite(p, data));

const MEDIA_EXT = new Set('mp4 mov avi mkv webm prores hevc h265 h264 mpeg mpg m4v ts flv mts m2ts mxf 3gp wmv jpg jpeg png gif webp tiff tif bmp svg heic heif raw cr2 nef arw dng wav mp3 aac m4a flac ogg aiff aif wma opus'.split(' '));
ipcMain.handle('fs:listRoots', async () => { const out = []; for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') { try { await fs.access(l + ':\\'); out.push(l + ':\\'); } catch { /* none */ } } return process.platform === 'win32' ? out : ['/']; });
ipcMain.handle('fs:listDir', async (_e, dir) => { try { const ents = await fs.readdir(dir, { withFileTypes: true }); return { dirs: ents.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort(), files: ents.filter((e) => e.isFile() && MEDIA_EXT.has(e.name.split('.').pop().toLowerCase())).map((e) => e.name).sort() }; } catch { return { dirs: [], files: [] }; } });

ipcMain.handle('fs:rm', async (_e, p) => { try { await fs.rm(p, { force: true }); return true; } catch { return false; } });
ipcMain.handle('shell:open', (_e, p) => shell.openPath(p));
ipcMain.handle('shell:reveal', (_e, p) => shell.showItemInFolder(p));
ipcMain.on('win:control', (e, action) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (action === 'minimize') w.minimize();
  else if (action === 'maximize') (w.isMaximized() ? w.unmaximize() : w.maximize());
  else if (action === 'close') w.close();
  else if (action === 'devtools') w.webContents.toggleDevTools();
  else if (action === 'fullscreen') w.setFullScreen(!w.isFullScreen());
});

app.whenReady().then(() => {
  const MIME = { '.wasm': 'application/wasm', '.js': 'text/javascript', '.task': 'application/octet-stream', '.tflite': 'application/octet-stream' };
  protocol.handle('es-app', async (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
    const full = path.join(__dirname, '..', 'dist', rel); if (!full.startsWith(path.join(__dirname, '..', 'dist'))) return new Response('forbidden', { status: 403 });
    const r = await net.fetch(pathToFileURL(full).toString());
    const h = new Headers(r.headers); h.set('Access-Control-Allow-Origin', '*'); const ct = MIME[path.extname(full)]; if (ct) h.set('Content-Type', ct);
    return new Response(r.body, { status: r.status, headers: h });
  });
  // es-media://local/<path>: local media with HTTP byte ranges (206), so <video>/<audio> can seek anywhere
  const MEDIA_MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' };
  protocol.handle('es-media', async (req) => {
    const p = decodeURIComponent(new URL(req.url).pathname.slice(1));
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

ipcMain.on('app:closeOk', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) { w.closeOk = true; w.close(); } });
// .esproj opened from Explorer (file association): the path comes on the command line, or from a second launch
const projectArg = (argv) => argv.slice(1).find((a) => /\.esproj$/i.test(a) && require('fs').existsSync(a)) || null;
let pendingProject = projectArg(process.argv);
ipcMain.handle('app:takeOpenFile', () => { const p = pendingProject; pendingProject = null; return p; });
if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', (_e, argv) => {
  const w = BrowserWindow.getAllWindows()[0]; if (!w) return;
  if (w.isMinimized()) w.restore(); w.focus();
  const p = projectArg(argv); if (p) w.webContents.send('app:openFile', p);
});
