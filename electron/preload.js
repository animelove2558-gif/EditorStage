const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('editorstage', {
  openDialog: (kind, multi = false) => ipcRenderer.invoke('dialog:open', kind, multi),
  saveDialog: (kind, name, ext) => ipcRenderer.invoke('dialog:save', kind, name, ext),
  readFile: (p) => ipcRenderer.invoke('fs:read', p),
  readText: (p) => ipcRenderer.invoke('fs:readText', p),
  writeFile: (p, data) => ipcRenderer.invoke('fs:write', p, data),
  windowControl: (action) => ipcRenderer.send('win:control', action),
  onWindowState: (cb) => ipcRenderer.on('win:state', (_e, s) => cb(s)),
  // window close: the page acknowledges at once, then answers closeOk when the window may close
  onCloseRequest: (cb) => ipcRenderer.on('app:closeRequest', () => { ipcRenderer.send('app:closeAck'); cb(); }),
  closeOk: () => ipcRenderer.send('app:closeOk'),
  takeOpenFile: () => ipcRenderer.invoke('app:takeOpenFile'),
  onOpenFile: (cb) => ipcRenderer.on('app:openFile', (_e, p) => cb(p)),
  // the path of a dropped / chosen File; the main process may then read it (a page cannot make up a File with a path)
  pathForFile: (file) => { const p = webUtils.getPathForFile(file); if (p) ipcRenderer.send('fs:dropped', p); return p; },
  transcode: (src, kind) => ipcRenderer.invoke('media:transcode', src, kind),
  exportStart: (args) => ipcRenderer.invoke('export:start', args),
  exportFrame: (buf) => ipcRenderer.invoke('export:frame', buf),
  exportEnd: () => ipcRenderer.invoke('export:end'),
  exportCancel: () => ipcRenderer.invoke('export:cancel'),
  job: { start: (id, args) => ipcRenderer.invoke('job:start', id, args), write: (id, buf) => ipcRenderer.invoke('job:write', id, buf), end: (id) => ipcRenderer.invoke('job:end', id), cancel: (id) => ipcRenderer.invoke('job:cancel', id) },
  ffmpeg: (args, id) => ipcRenderer.invoke('ffmpeg:run', args, id),
  ffmpegKill: (id) => ipcRenderer.invoke('ffmpeg:kill', id),
  ffmpegInfo: () => ipcRenderer.invoke('ffmpeg:info'), setFfmpegPath: (p) => ipcRenderer.invoke('ffmpeg:setPath', p),
  onFfmpegProgress: (cb) => { const h = (_e, id, t) => cb(id, t); ipcRenderer.on('ffmpeg:progress', h); return () => ipcRenderer.removeListener('ffmpeg:progress', h); },
  tmpDir: () => ipcRenderer.invoke('app:tmp'),
  listRoots: () => ipcRenderer.invoke('fs:listRoots'),
  listDir: (d) => ipcRenderer.invoke('fs:listDir', d),
  probe: (p) => ipcRenderer.invoke('media:probe', p),
  openExternal: (p) => ipcRenderer.invoke('shell:open', p),
  revealInFolder: (p) => ipcRenderer.invoke('shell:reveal', p),
  removeFile: (p) => ipcRenderer.invoke('fs:rm', p),
  rename: (from, to) => ipcRenderer.invoke('fs:rename', from, to),
  copyFile: (from, to) => ipcRenderer.invoke('fs:copy', from, to),
  mogrt: { install: (p) => ipcRenderer.invoke('mogrt:install', p), list: () => ipcRenderer.invoke('mogrt:list'), read: (id) => ipcRenderer.invoke('mogrt:read', id), remove: (id) => ipcRenderer.invoke('mogrt:remove', id) },
  platform: process.platform,
  // workflow features (electron/workflow.js)
  mkdir: (p) => ipcRenderer.invoke('fs:mkdir', p), exists: (p) => ipcRenderer.invoke('fs:exists', p), stat: (p) => ipcRenderer.invoke('fs:stat', p), readdir: (p) => ipcRenderer.invoke('fs:readdir', p), findFiles: (roots, names, depth) => ipcRenderer.invoke('fs:findFiles', roots, names, depth),
  userData: () => ipcRenderer.invoke('app:userData'), licensesDir: () => ipcRenderer.invoke('app:licenses'), licensesFile: () => ipcRenderer.invoke('app:licensesFile'), version: () => ipcRenderer.invoke('app:version'), env: () => ipcRenderer.invoke('app:env'),
  extractAudio: (src, start, dur, out, opts) => ipcRenderer.invoke('media:extractAudio', src, start, dur, out, opts),
  audiostage: {
    locate: () => ipcRenderer.invoke('audiostage:locate'), setPath: (p) => ipcRenderer.invoke('audiostage:setPath', p),
    open: (file) => ipcRenderer.invoke('audiostage:open', file), watch: (file) => ipcRenderer.invoke('audiostage:watch', file), unwatch: (file) => ipcRenderer.invoke('audiostage:unwatch', file),
    onChanged: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('audiostage:changed', h); return () => ipcRenderer.removeListener('audiostage:changed', h); },
  },
  archive: {
    run: (o) => ipcRenderer.invoke('archive:run', o), index: () => ipcRenderer.invoke('archive:index'), forget: (id) => ipcRenderer.invoke('archive:forget', id),
    importIndex: (dir) => ipcRenderer.invoke('archive:importIndex', dir), restore: (o) => ipcRenderer.invoke('archive:restore', o), online: (dest) => ipcRenderer.invoke('archive:online', dest),
    onProgress: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('archive:progress', h); return () => ipcRenderer.removeListener('archive:progress', h); },
  },
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  // optional AI model packs (electron/models.js): downloaded by the main process only when the user asks
  models: {
    list: () => ipcRenderer.invoke('models:list'), download: (id) => ipcRenderer.invoke('models:download', id), cancel: (id) => ipcRenderer.invoke('models:cancel', id),
    onProgress: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('models:progress', h); return () => ipcRenderer.removeListener('models:progress', h); },
  },
  // Export Queue in the hidden render window (electron/renderWindow.js): start/cancel/progress from the main window,
  // onJob/progress/done/ready on the render window's side
  render: {
    start: (job) => ipcRenderer.invoke('render:start', job), cancel: (id) => ipcRenderer.send('render:cancel', id),
    onProgress: (cb) => { const h = (_e, id, p, msg) => cb(id, p, msg); ipcRenderer.on('render:progress', h); return () => ipcRenderer.removeListener('render:progress', h); },
    onJob: (cb) => ipcRenderer.on('render:job', (_e, job) => cb(job)), onCancel: (cb) => ipcRenderer.on('render:cancel', (_e, id) => cb(id)),
    progress: (id, p, msg) => ipcRenderer.send('render:progress', id, p, msg), done: (id, r) => ipcRenderer.send('render:done', id, r), ready: () => ipcRenderer.send('render:ready'),
  },
});
