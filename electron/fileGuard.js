// What the renderer may write, delete, run and hand to the system (main process side).
// - writes are atomic: <file>.es-tmp in the same folder -> fsync -> rename over the target, so a crash, power cut,
//   full disk or a file held by OneDrive / a virus scanner during Save never leaves a damaged original
// - executable / script types are only written where the user picked the path in a dialog, never into Startup
// - deletes are limited to the app's own data, temp, folders the user picked, and files the app wrote this session
// - programs (FFmpeg / AudioStage locations) are only accepted when the user picked them in a dialog
const path = require('path');
const fsp = require('fs/promises');

const DANGEROUS = new Set(('exe com scr pif bat cmd ps1 ps1xml ps2 psc1 psc2 psm1 psd1 vb vbs vbe js jse wsf wsh wsc hta lnk url scf ' +
  'msi msp mst msc cpl dll ocx sys drv reg inf ins isp jar appref-ms application gadget chm hlp settingcontent-ms ' +
  'xbap xll iqy slk library-ms diagcab appx appxbundle msix msixbundle website shb shs app command sh').split(' '));

const ext = (p) => path.extname(String(p)).slice(1).toLowerCase();
const isDangerous = (p) => DANGEROUS.has(ext(p)) || /:/.test(path.basename(String(p))); // ':' = alternate data stream
const norm = (p) => path.resolve(String(p)).toLowerCase();
const inside = (p, dir) => norm(p).startsWith(norm(dir).replace(/[\\/]+$/, '') + path.sep);
const abs = (p) => typeof p === 'string' && p.length > 0 && path.isAbsolute(p);

function createGuard(app) {
  const files = new Set(); const dirs = new Set(); const ours = new Set();
  const roots = () => [app.getPath('userData'), app.getPath('temp')];
  const startup = () => { try { return [path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'), path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'StartUp')]; } catch { return []; } };
  const picked = (p) => files.has(norm(p)) || [...dirs].some((d) => norm(p) === d || inside(p, d));
  const g = {
    grantFile(p) { if (abs(p)) files.add(norm(p)); },
    grantDir(p) { if (abs(p)) dirs.add(norm(p)); },
    made(p) { if (abs(p)) ours.add(norm(p)); },
    picked: (p) => abs(p) && picked(p),
    inStartup: (p) => abs(p) && startup().some((d) => inside(p, d)),
    canWrite(p) {
      if (!abs(p)) return false;
      if (g.inStartup(p)) return false;
      if (picked(p)) return true; // the user chose this path
      return !isDangerous(p);
    },
    canRemove(p) {
      if (!abs(p) || g.inStartup(p)) return false;
      if (/\.es-(part|tmp)(\.[^.\\/]+)?$/i.test(p) && !isDangerous(p)) return true; // EditorStage's own unfinished exports / writes
      return roots().some((d) => inside(p, d)) || [...dirs].some((d) => inside(p, d)) || ours.has(norm(p)) || files.has(norm(p));
    },
    async canOpen(p) {
      if (!abs(p)) return false;
      const st = await fsp.stat(p).catch(() => null);
      if (st?.isDirectory()) return true;
      return !isDangerous(p);
    },
    /** FFmpeg arguments: every absolute path that is not an input (-i) must be writable (no .exe / .bat / Startup). */
    checkFfmpegArgs(args) {
      if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) return 'invalid arguments';
      for (let i = 0; i < args.length; i++) {
        const a = args[i]; if (args[i - 1] === '-i' || !abs(a)) continue;
        if (!g.canWrite(a)) return `FFmpeg may not write ${a}`;
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

module.exports = { createGuard, guard, atomicWrite, renameRetry, isDangerous, inside };
