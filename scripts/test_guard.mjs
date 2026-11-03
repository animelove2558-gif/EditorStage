// Main-process file guard and atomic write (electron/fileGuard.js), run in Node with a fake Electron app object.
// Phase 8 audit E5 (Save is atomic, a failed write leaves the original intact) and E15 (what the renderer may write,
// delete, open and run). Run: node scripts/test_guard.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const { createGuard, atomicWrite, isDangerous } = require('../electron/fileGuard.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-guard-'));
const ud = path.join(tmp, 'userData'); const tp = path.join(tmp, 'temp'); const appData = path.join(tmp, 'AppData');
for (const d of [ud, tp]) fs.mkdirSync(d, { recursive: true });
const app = { getPath: (k) => ({ userData: ud, temp: tp, appData }[k]) };
const G = createGuard(app);
const docs = path.join(tmp, 'Documents');
const startup = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');

// ---- writes ----
ok('a project file can be written', G.canWrite(path.join(docs, 'film.esproj')));
ok('an export can be written', G.canWrite(path.join(docs, 'film.mp4')));
ok('a program cannot be written', !G.canWrite(path.join(docs, 'evil.exe')) && !G.canWrite(path.join(docs, 'run.bat')) && !G.canWrite(path.join(docs, 'x.lnk')));
ok('nothing is written into the Startup folder', !G.canWrite(path.join(startup, 'film.mp4')));
ok('a relative path is refused', !G.canWrite('film.esproj'));
ok('an alternate data stream is refused', isDangerous(path.join(docs, 'a.txt:evil.exe')));
G.grantFile(path.join(docs, 'chosen.cmd'));
ok('a script path the user picked in the save dialog can be written', G.canWrite(path.join(docs, 'chosen.cmd')));
ok('...but never into Startup, even when picked', (G.grantFile(path.join(startup, 'x.mp4')), !G.canWrite(path.join(startup, 'x.mp4'))));

// ---- deletes ----
ok('files in userData / temp can be removed', G.canRemove(path.join(ud, 'a.json')) && G.canRemove(path.join(tp, 'x.wav')));
ok('a user file elsewhere cannot be removed', !G.canRemove(path.join(docs, 'holiday.mp4')));
G.made(path.join(docs, 'made.json'));
ok('a file EditorStage wrote this session can be removed', G.canRemove(path.join(docs, 'made.json')));
G.grantDir(path.join(docs, 'film.history'));
ok('the history folder of an opened project can be cleaned up', G.canRemove(path.join(docs, 'film.history', 'objects', 'ab', 'x.json')));
ok('an unfinished export (.es-part) can be removed / renamed anywhere', G.canRemove(path.join(docs, 'film.es-part.mp4')) && !G.canRemove(path.join(docs, 'film.es-part.exe')));
ok('a sibling folder with a similar name is outside it', !G.canRemove(path.join(docs, 'film.history-other', 'x.json')));

// ---- open / run ----
ok('a folder may be opened', await G.canOpen(docs) || (fs.mkdirSync(docs, { recursive: true }), await G.canOpen(docs)));
ok('a video may be opened with the system', await G.canOpen(path.join(docs, 'film.mp4')));
ok('a program is never opened with the system', !(await G.canOpen(path.join(docs, 'setup.exe'))) && !(await G.canOpen(path.join(docs, 'x.ps1'))));
ok('only picked paths count as picked', !G.picked(path.join(docs, 'ffmpeg.exe')) && (G.grantFile(path.join(docs, 'ffmpeg.exe')), G.picked(path.join(docs, 'ffmpeg.exe'))));

// ---- FFmpeg arguments ----
ok('normal export arguments pass', G.checkFfmpegArgs(['-y', '-i', path.join(docs, 'in.mov'), '-c:v', 'libx264', path.join(docs, 'out.es-part.mp4')]) === null);
ok('an output that is a program is refused', /may not write/.test(G.checkFfmpegArgs(['-i', path.join(docs, 'in.mov'), '-f', 'data', path.join(docs, 'evil.bat')]) || ''));
ok('an output into Startup is refused', !!G.checkFfmpegArgs(['-i', path.join(docs, 'in.mov'), path.join(startup, 'a.mp4')]));
ok('an input with any name is fine (it is only read)', G.checkFfmpegArgs(['-i', path.join(docs, 'odd.exe'), '-f', 'null', '-']) === null);
ok('non-string arguments are refused', !!G.checkFfmpegArgs(['-i', { x: 1 }]));

// ---- atomic write ----
{
  const f = path.join(tmp, 'p.esproj');
  await atomicWrite(f, 'one');
  ok('atomic write creates the file', fs.readFileSync(f, 'utf8') === 'one');
  await atomicWrite(f, new Uint8Array([116, 119, 111]));
  ok('atomic write replaces it (bytes too)', fs.readFileSync(f, 'utf8') === 'two');
  ok('no temp file is left behind', !fs.existsSync(f + '.es-tmp'));
  let err = null; try { await atomicWrite(path.join(tmp, 'no-such-dir', 'x.esproj'), 'x'); } catch (e) { err = e; }
  ok('a write that cannot happen throws', !!err);
  // the target cannot be replaced (it is a folder): the error is reported and nothing else changes
  const dirTarget = path.join(tmp, 'folder.esproj'); fs.mkdirSync(dirTarget);
  err = null; try { await atomicWrite(dirTarget, 'x'); } catch (e) { err = e; }
  ok('a target that cannot be replaced is reported', !!err && fs.statSync(dirTarget).isDirectory(), String(err));
  ok('...and its temp file is removed', !fs.existsSync(dirTarget + '.es-tmp'));
  ok('the original file is untouched by failed writes', fs.readFileSync(f, 'utf8') === 'two');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`guard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
