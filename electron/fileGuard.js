// What the renderer may read, write, delete, run and hand to the system (main process side).
// - reads: media files (by extension) anywhere, so the Media Browser, relinking and projects from other people work;
//   any other file only when the user picked it (dialog, drag and drop, Explorer / command line), when an opened project
//   refers to it, or when it is EditorStage's own data (userData, temp, the app's folder, files it wrote this session)
// - writes are atomic: <file>.es-tmp in the same folder -> fsync -> rename over the target, so a crash, power cut,
//   full disk or a file held by OneDrive / a virus scanner during Save never leaves a damaged original
// - writes go only to: paths picked in a dialog (and files named after a picked file in its folder: sidecar captions,
//   per-track EDLs, unfinished exports), folders picked in a dialog (scratch disks, archive), the app's own data, the
//   project's own folders (<name>.history, Captured, AudioStage Edits) and Proxies folders next to the project's media
// - executable / script types are only written where the user picked the exact path, never into Startup
// - deletes are limited to the app's own data, temp, folders the user picked, and files the app wrote this session
// - programs (FFmpeg / AudioStage locations) are only accepted when the user picked them in a dialog
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const DANGEROUS = new Set(('exe com scr pif bat cmd ps1 ps1xml ps2 psc1 psc2 psm1 psd1 vb vbs vbe js jse wsf wsh wsc hta lnk url scf ' +
  'msi msp mst msc cpl dll ocx sys drv reg inf ins isp jar appref-ms application gadget chm hlp settingcontent-ms ' +
  'xbap xll iqy slk library-ms diagcab appx appxbundle msix msixbundle website shb shs app command sh').split(' '));
const MEDIA_EXT = new Set(('mp4 mov avi mkv webm prores hevc h265 h264 264 mpeg mpg m4v ts flv mts m2ts mxf 3gp wmv jpg jpeg png gif webp ' +
  'tiff tif bmp svg heic heif raw cr2 nef arw dng wav mp3 aac m4a flac ogg aiff aif wma opus avif').split(' '));
/** folders inside a project's folder that EditorStage writes on its own (besides <name>.history) */
const PROJECT_SUBDIRS = ['Captured', 'AudioStage Edits'];
/** FFmpeg options / filters that read a file named inside an argument (not via -i) */
const FFMPEG_FILE_OPTS = new Set(['-filter_script', '-filter_complex_script', '-/filter', '-/filter_complex', '-/af', '-/vf', '-attach', '-dump_attachment', '-passlogfile', '-vstats_file', '-sdp_file', '-progress']);
const FFMPEG_FILE_FILTERS = /(^|[,;\[\]\s'"])(movie|amovie|subtitles|ass|lut3d|lut1d|haldclutsrc|sendcmd|asendcmd|zmq|azmq|frei0r|ladspa|lv2)\s*=/i;

const ext = (p) => path.extname(String(p)).slice(1).toLowerCase();
const isDangerous = (p) => DANGEROUS.has(ext(p)) || /:/.test(path.basename(String(p))); // ':' = alternate data stream
const isMedia = (p) => MEDIA_EXT.has(ext(p));
const norm = (p) => path.resolve(String(p)).toLowerCase();
const inside = (p, dir) => norm(p).startsWith(norm(dir).replace(/[\\/]+$/, '') + path.sep);
const abs = (p) => typeof p === 'string' && p.length > 0 && p.length < 4096 && path.isAbsolute(p) && !p.includes('\0');
const stem = (p) => path.basename(String(p)).replace(/\.[^.]*$/, '').toLowerCase();

function createGuard(app, opts = {}) {
  const files = new Set(); const dirs = new Set(); const ours = new Set();
  const known = new Set(); // read only: files an opened project refers to, dropped files
  const readDirs = new Set(); // read only: dropped folders
  const projectDirs = new Set(); // folders of opened / saved projects
  const mediaDirs = new Set(); // folders of the project's media (their Proxies subfolder may be written)
  const appDirs = () => (opts.appDirs || [path.join(__dirname, '..'), process.resourcesPath].filter(Boolean));
  const roots = () => [app.getPath('userData'), app.getPath('temp')];
  const startup = () => { try { return [path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'), path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'StartUp')]; } catch { return []; } };
  const under = (p, set) => [...set].some((d) => norm(p) === d || inside(p, d));
  const picked = (p) => files.has(norm(p)) || under(p, dirs);
  /** a file named after a picked file, in its folder: film.mp4 -> film.srt, film V2.edl, film.es-part.mp4 */
  const besidePicked = (p) => { const d = norm(path.dirname(p)), s = stem(p); return [...files].some((f) => path.dirname(f) === d && s.startsWith(stem(f)) && stem(f).length > 0); };
  const projectOwned = (p) => [...projectDirs].some((pd) => PROJECT_SUBDIRS.some((sd) => under(p, new Set([norm(path.join(pd, sd))]))));
  const proxyFolder = (p) => [...mediaDirs].some((md) => under(p, new Set([norm(path.join(md, 'Proxies'))])));
  const own = (p) => roots().some((d) => inside(p, d)) || ours.has(norm(p));
  const g = {
    grantFile(p) { if (abs(p)) { files.add(norm(p)); if (isMedia(p)) mediaDirs.add(norm(path.dirname(p))); } },
    grantDir(p) { if (abs(p)) dirs.add(norm(p)); },
    made(p) { if (abs(p)) ours.add(norm(p)); },
    /** a project file the user opened / saved: the file, its history folder and its own subfolders */
    grantProject(p) {
      if (!abs(p) || !/\.esproj$/i.test(p)) return;
      files.add(norm(p)); dirs.add(norm(p.replace(/\.esproj$/i, '') + '.history')); projectDirs.add(norm(path.dirname(p)));
    },
    /** the text of an opened project: every absolute path it names may be read, its media folders get Proxies, its scratch disks are writable */
    grantProjectContent(p, text) {
      if (!files.has(norm(p))) return 0;
      let data; try { data = JSON.parse(text); } catch { return 0; }
      let n = 0; const seen = new Set();
      const walk = (v, depth) => {
        if (depth > 40 || n > 200000) return;
        if (typeof v === 'string') { if (abs(v) && !seen.has(v)) { seen.add(v); known.add(norm(v)); n++; if (isMedia(v)) mediaDirs.add(norm(path.dirname(v))); } return; }
        if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], depth + 1);
      };
      walk(data, 0);
      for (const d of Object.values(data?.scratch || {})) if (abs(d)) dirs.add(norm(d));
      return n;
    },
    /** a file or folder the user dropped on the window (the path comes from the File object, not from page script) */
    grantDropped(p) {
      if (!abs(p)) return;
      let st = null; try { st = fs.statSync(p); } catch { return; }
      if (st.isDirectory()) readDirs.add(norm(p)); else { known.add(norm(p)); if (isMedia(p)) mediaDirs.add(norm(path.dirname(p))); }
    },
    picked: (p) => abs(p) && picked(p),
    inStartup: (p) => abs(p) && startup().some((d) => inside(p, d)),
    canRead(p) {
      if (!abs(p)) return false;
      if (isMedia(p)) return true;
      return picked(p) || own(p) || known.has(norm(p)) || under(p, readDirs) || besidePicked(p) || projectOwned(p) || proxyFolder(p)
        || appDirs().some((d) => norm(p) === norm(d) || inside(p, d));
    },
    canWrite(p) {
      if (!abs(p)) return false;
      if (g.inStartup(p)) return false;
      if (files.has(norm(p))) return true; // the user chose this exact path
      if (isDangerous(p)) return false;
      return under(p, dirs) || own(p) || besidePicked(p) || projectOwned(p) || proxyFolder(p);
    },
    /** a folder EditorStage may create (scratch folders, Proxies, presets, history) */
    canMakeDir(p) {
      if (!abs(p) || g.inStartup(p)) return false;
      return under(p, dirs) || roots().some((d) => norm(p) === norm(d) || inside(p, d)) || projectOwned(p) || proxyFolder(p)
        || [...projectDirs].some((pd) => PROJECT_SUBDIRS.some((sd) => norm(p) === norm(path.join(pd, sd))));
    },
    canRemove(p) {
      if (!abs(p) || g.inStartup(p)) return false;
      if (/\.es-(part|tmp)(\.[^.\\/]+)?$/i.test(p) && !isDangerous(p) && (g.canWrite(p))) return true; // EditorStage's own unfinished exports / writes
      return roots().some((d) => inside(p, d)) || [...dirs].some((d) => inside(p, d)) || ours.has(norm(p)) || files.has(norm(p));
    },
    /** Archive > remove originals: only media the open project uses (or the user picked) */
    canArchiveRemove: (p) => abs(p) && !g.inStartup(p) && (known.has(norm(p)) || files.has(norm(p))),
    async canOpen(p) {
      if (!abs(p)) return false;
      const st = await fsp.stat(p).catch(() => null);
      if (st?.isDirectory()) return true;
      return !isDangerous(p);
    },
    /**
     * FFmpeg arguments: every input (-i) must be readable (a concat list's entries too), every other absolute path must be
     * writable, and options / filters that read a file named inside an argument are refused.
     */
    checkFfmpegArgs(args) {
      if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) return 'invalid arguments';
      let fmt = null; // the -f given for the next input
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (FFMPEG_FILE_OPTS.has(a.toLowerCase())) return `FFmpeg option ${a} is not allowed`;
        if (args[i - 1] === '-f') { fmt = a.toLowerCase(); continue; }
        if (/^-(vf|af|filter|filter_complex|lavfi)(:|$)/.test(args[i - 1] || '') && FFMPEG_FILE_FILTERS.test(a)) return 'FFmpeg filters that read files are not allowed';
        if (args[i - 1] === '-i') {
          const f = fmt; fmt = null;
          if (f === 'lavfi') { if (FFMPEG_FILE_FILTERS.test(a)) return 'FFmpeg filters that read files are not allowed'; continue; }
          const src = a.replace(/^file:/i, '');
          if (/^[a-z][a-z0-9+.-]+:/i.test(a) && !/^file:/i.test(a) && !/^[a-z]:[\\/]/i.test(a) && a !== 'pipe:0') return `FFmpeg input ${a.slice(0, 40)} is not allowed`;
          if (!abs(src)) continue; // '-' / pipe:0 (frames from the app)
          if (!g.canRead(src)) return `FFmpeg may not read ${src}`;
          if (f === 'concat') { const bad = g.checkConcatList(src); if (bad) return bad; }
          continue;
        }
        if (!abs(a)) continue;
        if (!g.canWrite(a)) return `FFmpeg may not write ${a}`;
      }
      return null;
    },
    /** entries of an FFmpeg concat list (`file '<path>'`) must be readable */
    checkConcatList(list) {
      let text = ''; try { text = fs.readFileSync(list, 'utf8'); } catch { return null; } // FFmpeg reports a missing list itself
      for (const line of text.split(/\r?\n/)) {
        const m = /^\s*file\s+(?:'((?:[^']|'\\'')*)'|(\S+))/.exec(line); if (!m) continue;
        const p = (m[1] != null ? m[1].replace(/'\\''/g, "'") : m[2]).replace(/^file:/i, '');
        const full = path.isAbsolute(p) ? p : path.join(path.dirname(list), p);
        if (!g.canRead(full)) return `FFmpeg may not read ${full}`;
      }
      return null;
    },
  };
  return g;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Rename with retries: on Windows a scanner / indexer / OneDrive may hold the file for a moment. */
async function renameRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { await fsp.rename(from, to); return; } catch (e) {
      const locked = e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES';
      if (locked && attempt < 5) { await sleep(120 * (attempt + 1)); continue; }
      throw e;
    }
  }
}
/**
 * Write `data` to `p` without ever leaving a half-written file at `p`. Errors carry a code and a readable message:
 * ENOSPC (not enough room, checked first), ELOCKED (the target cannot be replaced), else the system error.
 */
async function atomicWrite(p, data) {
  const tmp = p + '.es-tmp';
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.isBuffer(data) ? data : Buffer.from(data);
  const sf = await fsp.statfs?.(path.dirname(p)).catch(() => null);
  if (sf && sf.bavail * sf.bsize < buf.length + 1024 * 1024) throw Object.assign(new Error(`ENOSPC: not enough free disk space to save ${p}; the original was not changed`), { code: 'ENOSPC' });
  let fh;
  try { fh = await fsp.open(tmp, 'w'); await fh.writeFile(buf); await fh.sync(); }
  catch (e) { await fh?.close().catch(() => {}); fh = null; await fsp.rm(tmp, { force: true }).catch(() => {}); throw e; }
  await fh.close();
  try { await renameRetry(tmp, p); } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    if (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES') throw Object.assign(new Error(`ELOCKED: ${p} is open in another program, read-only or being synced; the original was not changed`), { code: 'ELOCKED' });
    throw e;
  }
}

let shared = null;
/** The guard of this app (one per process, shared by main.js, media.js, workflow.js and ffmpegBin.js). */
const guard = () => (shared ||= createGuard(require('electron').app));
const refuse = (what, p) => Object.assign(new Error(`EACCES: EditorStage may not ${what} ${p}`), { code: 'EACCES' });

module.exports = { createGuard, guard, atomicWrite, renameRetry, isDangerous, isMedia, inside, refuse, MEDIA_EXT };
