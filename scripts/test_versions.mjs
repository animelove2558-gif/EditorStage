// Project history, auto-save and project files, run in Node against a real temp folder standing in for the main process.
// Phase 8 audit E6 (damaged .esproj), E7 (one auto-save folder per project), E8 (crash recovery marker),
// E9 (Save and auto-save never lose each other's revision; unreferenced objects are collected), F3 (In / Out saved).
// Run: node scripts/test_versions.mjs
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-versions-'));
const entry = path.join(tmp, 'entry.js');
fs.writeFileSync(entry, `export * as V from ${JSON.stringify(path.join(root, 'src/Services/versions.js'))};\nexport * as S from ${JSON.stringify(path.join(root, 'src/Core/store.js'))};\nexport * as P from ${JSON.stringify(path.join(root, 'src/Core/projectFile.js'))};\n`);
const out = path.join(tmp, 'bundle.mjs');
await esbuild.build({ absWorkingDir: root, entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });

const ud = path.join(tmp, 'userData'); fs.mkdirSync(ud);
const slow = { on: false };
const delay = () => new Promise((r) => setTimeout(r, slow.on ? 2 : 0));
globalThis.window = { editorstage: {
  userData: async () => ud,
  readText: async (p) => { await delay(); return fs.readFileSync(p, 'utf8'); },
  writeFile: async (p, d) => { await delay(); fs.writeFileSync(p, d); },
  mkdir: async (p) => { fs.mkdirSync(p, { recursive: true }); return true; },
  exists: async (p) => fs.existsSync(p),
  readdir: async (p) => { try { return fs.readdirSync(p); } catch { return []; } },
  removeFile: async (p) => { try { fs.rmSync(p, { force: true }); return true; } catch { return false; } },
  rename: async (a, b) => { fs.renameSync(a, b); return true; },
} };
const { V, S, P } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const edit = (k) => S.edit('E', ({ seq }) => { seq.clips.push({ id: 'c' + k, track: 'V1', start: k, dur: 1 }); });

// ---- E7: two never-saved "Untitled" projects keep separate histories ----
S.resetProject(); const id1 = S.getState().projectId; edit(1); await V.commitRevision('Auto-save', { auto: true });
const d1 = await V.historyDir();
S.resetProject(); const id2 = S.getState().projectId; edit(2); await V.commitRevision('Auto-save', { auto: true });
const d2 = await V.historyDir();
ok('every new project gets its own id', id1 && id2 && id1 !== id2);
ok('two Untitled projects use different auto-save folders', d1 !== d2 && d1.includes(id1) && d2.includes(id2), `${d1} ${d2}`);
ok('each folder holds only its own project', (await V.latestRevision(d1)).clips === 1 && Object.keys(JSON.parse(fs.readFileSync(path.join(d2, 'refs.json'))).revisions).length === 1);
const proj = path.join(tmp, 'My Film.esproj');
ok('first Save moves the auto-save history next to the file', await V.adoptAutosaveHistory(id2, 'Untitled', proj) && fs.existsSync(path.join(tmp, 'My Film.history', 'refs.json')) && !fs.existsSync(d2));
const json = P.projectJson({ ...S.getState(), inPoint: 2, outPoint: 5 });
ok('the project file keeps its id', JSON.parse(json).projectId === id2);
S.loadProject(P.parseProject(json), proj);
ok('a loaded project keeps its id', S.getState().projectId === id2);
ok('F3: sequence In / Out are saved and loaded', S.getState().inPoint === 2 && S.getState().outPoint === 5);
S.loadProject(P.parseProject(JSON.stringify({ sequence: { tracks: [], clips: [] } })), proj);
ok('an old project without an id gets one on load', typeof S.getState().projectId === 'string' && S.getState().projectId.length > 8);

// ---- E9: Save and auto-save at the same time ----
S.resetProject(); S.set({ projectPath: path.join(tmp, 'Race.esproj') });
slow.on = true;
edit(1); const a = V.commitRevision('Auto-save', { auto: true });
edit(2); const b = V.commitRevision('Save');
edit(3); const c = V.commitRevision('Auto-save', { auto: true });
ok('commits made together are queued', V.commitBusy());
await Promise.all([a, b, c]); slow.on = false;
const refs = JSON.parse(fs.readFileSync(path.join(tmp, 'Race.history', 'refs.json')));
ok('no revision is lost when commits overlap', Object.keys(refs.revisions).length === 3, JSON.stringify(Object.values(refs.revisions).map((r) => r.label)));
const chainOk = (() => { let n = 0, id = refs.branches.main; while (id) { n++; id = refs.revisions[id].parent; } return n === 3; })();
ok('...and they form one chain', chainOk);
ok('the queue is idle afterwards', !V.commitBusy());

// ---- E9: objects no revision uses are deleted after pruning ----
{
  const keep = { n: 0 }; S.resetProject(); S.set({ projectPath: path.join(tmp, 'Gc.esproj') });
  const countObjects = () => fs.readdirSync(path.join(tmp, 'Gc.history', 'objects')).reduce((n, d) => n + fs.readdirSync(path.join(tmp, 'Gc.history', 'objects', d)).length, 0);
  for (let i = 0; i < 6; i++) { S.edit('E', ({ seq }) => { seq.clips = [{ id: 'x', track: 'V1', start: i, dur: 1, name: 'v' + i }]; }); await V.commitRevision('Auto-save', { auto: false }); keep.n++; }
  const before = countObjects();
  const r = JSON.parse(fs.readFileSync(path.join(tmp, 'Gc.history', 'refs.json')));
  for (const x of Object.values(r.revisions)) x.auto = true; // pretend they were all auto-saves
  const dropped = V.pruneAuto(r, 2);
  const removed = await V.collectGarbage(r, path.join(tmp, 'Gc.history'));
  ok('pruning keeps the newest auto-saves', dropped === 4 && Object.keys(r.revisions).length === 2);
  ok('garbage collection deletes the objects of dropped revisions', removed > 0 && countObjects() === before - removed, `${before} ${removed}`);
  const head = r.branches.main; fs.writeFileSync(path.join(tmp, 'Gc.history', 'refs.json'), JSON.stringify(r));
  await V.restoreRevision(head);
  ok('the kept revisions still restore', S.getState().sequence.clips[0]?.name === 'v5', JSON.stringify(S.getState().sequence.clips));
}

// ---- E8: crash marker ----
{
  fs.rmSync(path.join(ud, 'session.json'), { force: true });
  S.resetProject(); S.set({ projectName: 'Crashy' });
  ok('no marker: nothing to recover', (await V.bootRecovery()) === null);
  ok('the session writes a marker', fs.existsSync(path.join(ud, 'session.json')));
  edit(7); await V.commitRevision('Auto-save', { auto: true });
  await new Promise((r) => setTimeout(r, 20));
  // the process dies here: the marker stays. Next start:
  const rec = await V.bootRecovery();
  ok('after a crash the newest auto-save is offered', rec && rec.rev.auto && rec.marker.projectName === 'Crashy', JSON.stringify(rec));
  S.resetProject(); edit(1); edit(2);
  await V.recoverSession(rec);
  ok('recovering loads the auto-saved project', S.getState().projectName === 'Crashy' && S.getState().sequence.clips.some((c) => c.id === 'c7'));
  ok('...marked unsaved', S.getState().dirty === true);
  await V.clearSessionMarker();
  ok('a normal close removes the marker', !fs.existsSync(path.join(ud, 'session.json')));
  ok('after a normal close nothing is offered', (await V.bootRecovery()) === null);
}

// ---- E6: damaged project files ----
{
  const bad = (t) => { try { P.parseProject(t); return null; } catch (e) { return e.message; } };
  ok('a cut-short file is reported', /not valid project data/.test(bad('{"sequence": {"tracks": [')));
  ok('a file that is not a project is reported', /not an EditorStage project/.test(bad('[1,2]')));
  ok('a project without a sequence is reported', /sequence is missing/.test(bad('{"media": []}')));
  ok('a sequence without clips is reported', /no clip list/.test(bad('{"sequence": {"tracks": []}}')));
  ok('a damaged clip is reported', /damaged clip/.test(bad('{"sequence": {"tracks": [], "clips": [{"id": 3}]}}')));
  ok('a damaged inactive sequence is reported', /sequence B/.test(bad('{"sequence": {"tracks": [], "clips": []}, "seqs": {"b": {"name": "B", "tracks": 1}}}')));
  ok('a damaged media list is reported', /media list/.test(bad('{"sequence": {"tracks": [], "clips": []}, "media": {}}')));
  const good = P.parseProject('{"sequence": {"tracks": [{"id": "V1"}], "clips": []}}');
  ok('a minimal project passes with defaults', Array.isArray(good.media) && Array.isArray(good.bins) && typeof good.seqs === 'object');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`versions: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
