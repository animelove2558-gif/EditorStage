// Main-process file guard and atomic write (electron/fileGuard.js), run in Node with a fake Electron app object.
// Phase 8 audit E5 (Save is atomic, a failed write leaves the original intact) and E15 (what the renderer may read,
// write, delete, open and run). Run: node scripts/test_guard.mjs
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
const G = createGuard(app, { appDirs: [path.join(tmp, 'App')] });
const docs = path.join(tmp, 'Documents');
const startup = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');

// ---- writes: only where the user chose, the app's own data, and the project's own folders ----
ok('a project file nobody picked cannot be written', !G.canWrite(path.join(docs, 'film.esproj')));
ok('an export nobody picked cannot be written', !G.canWrite(path.join(docs, 'film.mp4')));
G.grantFile(path.join(docs, 'film.mp4'));
ok('an export path picked in the save dialog can be written', G.canWrite(path.join(docs, 'film.mp4')));
ok('...and files named after it beside it (caption sidecar, unfinished export, per-track EDL)', G.canWrite(path.join(docs, 'film.srt')) && G.canWrite(path.join(docs, 'film.es-part.mp4')) && G.canWrite(path.join(docs, 'film V2.edl')));
ok('...but not other names in that folder, nor programs', !G.canWrite(path.join(docs, 'other.mp4')) && !G.canWrite(path.join(docs, 'film.exe')));
ok('userData and temp can be written', G.canWrite(path.join(ud, 'prefs.json')) && G.canWrite(path.join(tp, 'x.wav')));
ok('a program cannot be written', !G.canWrite(path.join(ud, 'evil.exe')) && !G.canWrite(path.join(tp, 'run.bat')) && !G.canWrite(path.join(ud, 'x.lnk')));
ok('nothing is written into the Startup folder', !G.canWrite(path.join(startup, 'film.mp4')));
ok('a relative path is refused', !G.canWrite('film.esproj'));
ok('an alternate data stream is refused', isDangerous(path.join(docs, 'a.txt:evil.exe')));
G.grantFile(path.join(docs, 'chosen.cmd'));
ok('a script path the user picked in the save dialog can be written', G.canWrite(path.join(docs, 'chosen.cmd')));
ok('...but never into Startup, even when picked', (G.grantFile(path.join(startup, 'x.mp4')), !G.canWrite(path.join(startup, 'x.mp4'))));
const proj = path.join(docs, 'Show', 'film.esproj'); G.grantProject(proj);
ok('an opened project can be saved', G.canWrite(proj));
ok('its history, Captured and AudioStage Edits folders can be written', G.canWrite(path.join(docs, 'Show', 'film.history', 'objects', 'a.json')) && G.canWrite(path.join(docs, 'Show', 'Captured', 'Voice 1.wav')) && G.canWrite(path.join(docs, 'Show', 'AudioStage Edits', 'a.wav')));
ok('...and created', G.canMakeDir(path.join(docs, 'Show', 'Captured')) && G.canMakeDir(path.join(docs, 'Show', 'film.history', 'objects')));
ok('other files in the project folder cannot', !G.canWrite(path.join(docs, 'Show', 'notes.txt')) && !G.canMakeDir(path.join(docs, 'Show', 'Other')));
const media = path.join(tmp, 'Footage', 'a.mp4');
const text = JSON.stringify({ media: [{ path: media }], lut: path.join(tmp, 'Looks', 'warm.cube'), scratch: { previews: path.join(tmp, 'Renders') } });
ok('a project grants nothing unless the user opened it', G.grantProjectContent(path.join(docs, 'stranger.esproj'), text) === 0);
ok('the opened project names its media, LUT and scratch disk', G.grantProjectContent(proj, text) >= 3);
ok('Proxies beside the project media can be written', G.canWrite(path.join(tmp, 'Footage', 'Proxies', 'a_Proxy.mp4')) && G.canMakeDir(path.join(tmp, 'Footage', 'Proxies')));
ok('...but not the media folder itself', !G.canWrite(path.join(tmp, 'Footage', 'a.txt')));
ok('the project scratch disk can be written', G.canWrite(path.join(tmp, 'Renders', 'p.mp4')));
G.grantDir(path.join(tmp, 'Drive'));
ok('a folder picked in the folder dialog can be written', G.canWrite(path.join(tmp, 'Drive', 'a', 'b.json')) && G.canMakeDir(path.join(tmp, 'Drive', 'a')));
ok('a folder nobody picked cannot be created', !G.canMakeDir(path.join(tmp, 'Elsewhere')));

// ---- reads ----
ok('media files can be read anywhere (Media Browser, relinking)', G.canRead(path.join(tmp, 'Anywhere', 'clip.mov')) && G.canRead(path.join(tmp, 'x', 'song.WAV')));
ok('other files nobody picked cannot be read', !G.canRead(path.join(tmp, 'Anywhere', 'passwords.txt')) && !G.canRead(path.join(tmp, '.ssh', 'id_rsa')));
ok('a file the opened project names can be read (its LUT)', G.canRead(path.join(tmp, 'Looks', 'warm.cube')));
ok('the app data, temp and app folder can be read', G.canRead(path.join(ud, 'prefs.json')) && G.canRead(path.join(tp, 'list.ffconcat')) && G.canRead(path.join(tmp, 'App', 'licenses', 'A.txt')));
ok('a picked file can be read', G.canRead(path.join(docs, 'chosen.cmd')));
ok('a file in the project folder not owned by EditorStage cannot be read', !G.canRead(path.join(docs, 'Show', 'notes.txt')));
fs.mkdirSync(path.join(tmp, 'Dropped'), { recursive: true }); fs.writeFileSync(path.join(tmp, 'Dropped', 'a.srt'), 'x'); fs.writeFileSync(path.join(tmp, 'b.cube'), 'x');
G.grantDropped(path.join(tmp, 'Dropped')); G.grantDropped(path.join(tmp, 'b.cube')); G.grantDropped(path.join(tmp, 'missing.txt'));
ok('dropped files and folders can be read', G.canRead(path.join(tmp, 'Dropped', 'a.srt')) && G.canRead(path.join(tmp, 'b.cube')));
ok('...but not written, and a missing path grants nothing', !G.canWrite(path.join(tmp, 'Dropped', 'a.srt')) && !G.canRead(path.join(tmp, 'missing.txt')));
ok('archiving may remove only media the project uses', G.canArchiveRemove(media) && !G.canArchiveRemove(path.join(tmp, 'Anywhere', 'clip.mov')));

// ---- deletes ----
ok('files in userData / temp can be removed', G.canRemove(path.join(ud, 'a.json')) && G.canRemove(path.join(tp, 'x.wav')));
ok('a user file elsewhere cannot be removed', !G.canRemove(path.join(docs, 'holiday.mp4')));
G.made(path.join(docs, 'made.json'));
ok('a file EditorStage wrote this session can be removed', G.canRemove(path.join(docs, 'made.json')));
G.grantDir(path.join(docs, 'film.history'));
ok('the history folder of an opened project can be cleaned up', G.canRemove(path.join(docs, 'film.history', 'objects', 'ab', 'x.json')));
ok('an unfinished export (.es-part) beside a picked export can be removed / renamed', G.canRemove(path.join(docs, 'film.es-part.mp4')) && !G.canRemove(path.join(docs, 'film.es-part.exe')) && !G.canRemove(path.join(tmp, 'Anywhere', 'x.es-part.mp4')));
ok('a sibling folder with a similar name is outside it', !G.canRemove(path.join(docs, 'film.history-other', 'x.json')));

// ---- open / run ----
ok('a folder may be opened', await G.canOpen(docs) || (fs.mkdirSync(docs, { recursive: true }), await G.canOpen(docs)));
ok('a video may be opened with the system', await G.canOpen(path.join(docs, 'film.mp4')));
ok('a program is never opened with the system', !(await G.canOpen(path.join(docs, 'setup.exe'))) && !(await G.canOpen(path.join(docs, 'x.ps1'))));
ok('only picked paths count as picked', !G.picked(path.join(docs, 'ffmpeg.exe')) && (G.grantFile(path.join(docs, 'ffmpeg.exe')), G.picked(path.join(docs, 'ffmpeg.exe'))));

// ---- FFmpeg arguments ----
const out = path.join(docs, 'film.es-part.mp4');
ok('normal export arguments pass', G.checkFfmpegArgs(['-y', '-i', path.join(docs, 'in.mov'), '-c:v', 'libx264', out]) === null);
ok('frames from the app and generated sources pass', G.checkFfmpegArgs(['-f', 'rawvideo', '-i', 'pipe:0', '-f', 'lavfi', '-i', 'color=c=gray:s=320x240', out]) === null && G.checkFfmpegArgs(['-i', '-', out]) === null);
ok('an output that is a program is refused', /may not write/.test(G.checkFfmpegArgs(['-i', path.join(docs, 'in.mov'), '-f', 'data', path.join(docs, 'evil.bat')]) || ''));
ok('an output nobody picked is refused', /may not write/.test(G.checkFfmpegArgs(['-i', path.join(docs, 'in.mov'), path.join(docs, 'elsewhere.mp4')]) || ''));
ok('an output into Startup is refused', !!G.checkFfmpegArgs(['-i', path.join(docs, 'in.mov'), path.join(startup, 'a.mp4')]));
ok('an input that is not readable is refused', /may not read/.test(G.checkFfmpegArgs(['-i', path.join(tmp, 'Anywhere', 'secret.txt'), '-f', 'null', '-']) || ''));
ok('a media input in any folder is fine', G.checkFfmpegArgs(['-i', path.join(tmp, 'Anywhere', 'clip.mkv'), '-f', 'null', '-']) === null);
ok('protocol inputs are refused', !!G.checkFfmpegArgs(['-i', 'concat:a.mp4|b.mp4', out]) && !!G.checkFfmpegArgs(['-i', 'http://x/a.mp4', out]));
ok('filters that read files are refused', !!G.checkFfmpegArgs(['-i', path.join(docs, 'in.mov'), '-vf', "movie=secret.png[m];[in][m]overlay", out]) && !!G.checkFfmpegArgs(['-f', 'lavfi', '-i', 'amovie=x.wav', out]));
ok('options that read files are refused', !!G.checkFfmpegArgs(['-filter_complex_script', path.join(tp, 'f.txt'), out]));
{
  const list = path.join(tp, 'seg.ffconcat'); const q = (p) => `'${p.replace(/'/g, "'\\''")}'`;
  fs.writeFileSync(list, ['ffconcat version 1.0', `file ${q(path.join(tmp, "Foot'age", 'a.mp4'))}`, 'inpoint 0'].join('\n'));
  ok('a concat list of media passes', G.checkFfmpegArgs(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]) === null);
  fs.writeFileSync(list, ['ffconcat version 1.0', `file ${q(path.join(tmp, 'Anywhere', 'secret.txt'))}`].join('\n'));
  ok('a concat list naming an unreadable file is refused', /may not read/.test(G.checkFfmpegArgs(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]) || ''));
}
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
