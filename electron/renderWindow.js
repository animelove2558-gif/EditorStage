// Background render window (Export Queue): a hidden copy of the app page that only renders queued exports, so the main
// window's Program Monitor, playback and editing stay live while the queue renders (each window has its own media
// elements and WebGL compositor). The main window sends a job (project snapshot + export options); the render window
// reports progress and the result back through here.
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let win = null; let ready = null;
const pending = new Map(); // job id -> { resolve, owner (webContents of the window that queued it) }
let lockNavigation = () => {};

function failAll(error) { for (const [id, p] of pending) { p.resolve({ ok: false, error }); pending.delete(id); } }

function ensure() {
  if (win && !win.isDestroyed()) return ready;
  win = new BrowserWindow({
    show: false, width: 640, height: 360, title: 'EditorStage Render',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      backgroundThrottling: false, // a hidden window must not slow its timers / media down
      autoplayPolicy: 'no-user-gesture-required', devTools: false,
    },
  });
  lockNavigation(win.webContents);
  const w = win;
  ready = new Promise((resolve, reject) => {
    const onReady = (e) => { if (e.sender === w.webContents) { ipcMain.removeListener('render:ready', onReady); resolve(w); } };
    ipcMain.on('render:ready', onReady);
    w.webContents.once('did-fail-load', (_e, code, desc) => { ipcMain.removeListener('render:ready', onReady); reject(new Error(`render window failed to load: ${desc}`)); });
    setTimeout(() => { ipcMain.removeListener('render:ready', onReady); reject(new Error('render window did not start')); }, 30000);
  });
  w.webContents.on('render-process-gone', (_e, d) => { failAll(`the render window stopped (${d.reason})`); if (!w.isDestroyed()) w.destroy(); });
  w.on('closed', () => { if (win === w) { win = null; ready = null; } failAll('the render window was closed'); });
  w.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { mode: 'render' } });
  return ready;
}

ipcMain.handle('render:start', async (e, job) => {
  if (!job || typeof job.id !== 'string') return { ok: false, error: 'invalid job' };
  let w; try { w = await ensure(); } catch (err) { return { ok: false, error: String(err.message || err), unavailable: true }; }
  return new Promise((resolve) => { pending.set(job.id, { resolve, owner: e.sender }); w.webContents.send('render:job', job); });
});
ipcMain.on('render:cancel', (_e, id) => { if (win && !win.isDestroyed()) win.webContents.send('render:cancel', id); });
ipcMain.on('render:progress', (e, id, p, msg) => { if (!win || e.sender !== win.webContents) return; const j = pending.get(id); if (j && !j.owner.isDestroyed()) j.owner.send('render:progress', id, p, msg); });
ipcMain.on('render:done', (e, id, r) => { if (!win || e.sender !== win.webContents) return; const j = pending.get(id); if (j) { pending.delete(id); j.resolve(r); } });

module.exports = {
  /** main.js passes its navigation lock (the render window follows the same rules) */
  setNavigationLock(fn) { lockNavigation = fn; },
  isRenderWindow: (wc) => !!win && !win.isDestroyed() && wc === win.webContents,
  close() { if (win && !win.isDestroyed()) win.destroy(); },
  windowCount: () => (win && !win.isDestroyed() ? 1 : 0),
};
