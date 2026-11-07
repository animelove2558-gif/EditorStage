// Project Version Control & Auto-Save: revisions + branches stored next to the project in "<project>.history/".
// Storage is content-addressed: the project is split into objects (each clip, media item, track list, sequence header,
// other sequences) hashed with SHA-256; a revision is a small manifest of hashes, so unchanged parts are stored once.
// A project that was never saved keeps its history in userData/autosave/<projectId>.history (one folder per project,
// so two "Untitled" projects never mix); the first Save moves it next to the project file.
import { getState, set, loadProject, markDirty, subscribe } from '../Core/store';
import { getPrefs } from '../Core/prefs';

const es = () => window.editorstage;
const sep = (p) => (p.includes('\\') ? '\\' : '/');
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x));
const safeName = (s) => String(s).replace(/[<>:"/\\|?*]+/g, '_');

/** History folder of a project file. */
export const historyDirFor = (projectPath) => projectPath.replace(/\.esproj$/i, '') + '.history';
/** History folder of a project that was never saved: keyed by its projectId. */
export async function autosaveDirFor(projectId, projectName = 'Untitled') {
  const ud = await es().userData(); const s = sep(ud);
  return `${ud}${s}autosave${s}${safeName(projectId || projectName || 'Untitled')}.history`;
}
export async function historyDir(s = getState()) {
  if (s.projectPath) return historyDirFor(s.projectPath);
  return autosaveDirFor(s.projectId, s.projectName);
}
async function paths(dir) { const d = dir || await historyDir(); const s = sep(d); return { d, objects: `${d}${s}objects`, refs: `${d}${s}refs.json`, s }; }
const emptyRefs = () => ({ branches: { main: null }, current: 'main', revisions: {} });
async function readRefs(dir) { const p = await paths(dir); if (!(await es().exists(p.refs))) return emptyRefs(); try { return JSON.parse(await es().readText(p.refs)); } catch { return emptyRefs(); } }
async function writeRefs(r, dir) { const p = await paths(dir); await es().mkdir(p.d); await es().writeFile(p.refs, JSON.stringify(r, null, 1)); }

const projectData = (s = getState()) => ({ sequence: s.sequence, media: s.media, projectName: s.projectName, projectId: s.projectId, bins: s.bins, seqs: s.seqs });
/** split the project into objects -> { manifest, objects: Map(hash -> json) } */
async function explode(data) {
  const objects = new Map(); const put = async (v) => { const j = stable(v); const h = await sha(j); objects.set(h, j); return h; };
  const seqParts = async (q) => ({ head: await put({ ...q, clips: undefined, transitions: undefined }), clips: await Promise.all(q.clips.map(put)), transitions: await put(q.transitions || []) });
  const manifest = { projectName: data.projectName, projectId: data.projectId, bins: await put(data.bins || []), media: await Promise.all((data.media || []).map(put)), sequence: await seqParts(data.sequence), seqs: {} };
  for (const [id, q] of Object.entries(data.seqs || {})) manifest.seqs[id] = await seqParts(q);
  return { manifest, objects };
}
const objPath = (p, h) => `${p.objects}${p.s}${h.slice(0, 2)}${p.s}${h}.json`;
async function implode(manifest, dir) {
  const p = await paths(dir); const get = async (h) => JSON.parse(await es().readText(objPath(p, h)));
  const seq = async (sp) => ({ ...(await get(sp.head)), clips: await Promise.all(sp.clips.map(get)), transitions: await get(sp.transitions) });
  const seqs = {}; for (const [id, sp] of Object.entries(manifest.seqs || {})) seqs[id] = await seq(sp);
  return { projectName: manifest.projectName, ...(manifest.projectId ? { projectId: manifest.projectId } : {}), bins: await get(manifest.bins), media: await Promise.all(manifest.media.map(get)), sequence: await seq(manifest.sequence), seqs };
}
/** every object hash a manifest refers to */
const manifestHashes = (m) => {
  const out = [m.bins, ...(m.media || [])]; const sq = (sp) => { if (sp) out.push(sp.head, sp.transitions, ...(sp.clips || [])); };
  sq(m.sequence); for (const sp of Object.values(m.seqs || {})) sq(sp); return out.filter(Boolean);
};

/**
 * Preferences > Auto Save > versions kept: drop the oldest auto-saved revisions beyond `keep` (manual saves and branch heads
 * stay). A dropped revision's children point to its parent, so the history stays one chain. Returns how many were dropped.
 */
export function pruneAuto(refs, keep) {
  if (!(keep > 0)) return 0;
  const heads = new Set(Object.values(refs.branches));
  const autos = Object.values(refs.revisions).filter((r) => r.auto).sort((a, b) => a.time - b.time);
  const drop = autos.filter((x) => !heads.has(x.id)).slice(0, Math.max(0, autos.length - keep));
  for (const r of drop) {
    for (const x of Object.values(refs.revisions)) if (x.parent === r.id) x.parent = r.parent;
    delete refs.revisions[r.id];
  }
  return drop.length;
}
/** Delete the objects (and manifests) no revision refers to any more. Returns the number of files removed. */
export async function collectGarbage(refs, dir) {
  const p = await paths(dir); const keep = new Set();
  for (const r of Object.values(refs.revisions)) {
    keep.add(r.manifest);
    try { for (const h of manifestHashes(JSON.parse(await es().readText(objPath(p, r.manifest))))) keep.add(h); } catch { return 0; } // unreadable manifest: keep everything
  }
  let removed = 0;
  for (const sub of await es().readdir(p.objects)) {
    const d = `${p.objects}${p.s}${sub}`;
    for (const f of await es().readdir(d)) {
      const h = f.replace(/\.json$/, ''); if (keep.has(h) || !/^[0-9a-f]{64}$/.test(h)) continue;
      if (await es().removeFile(`${d}${p.s}${f}`)) removed++;
    }
  }
  return removed;
}

// Save and the auto-save timer may both commit: one queue, so neither overwrites the other's refs.json
let chain = Promise.resolve(); let busy = 0;
/** Save a revision on the current branch. Skips when nothing changed since the branch head. Returns the revision or null. */
export function commitRevision(label = 'Manual save', opts = {}) {
  busy++;
  const data = projectData(); const dir = historyDir(); // what is recorded is the project as it is now, even when the commit waits
  const run = async () => commitNow(label, opts, data, await dir);
  const r = chain.then(run, run); chain = r.catch(() => {}).finally(() => { busy--; });
  return r;
}
export const commitBusy = () => busy > 0;
async function commitNow(label, { auto = false } = {}, data = projectData(), dir) {
  const p = await paths(dir); const refs = await readRefs(p.d);
  const { manifest, objects } = await explode(data);
  const mh = await sha(stable(manifest)); const head = refs.branches[refs.current];
  if (head && refs.revisions[head]?.manifest === mh) return null;
  let written = 0, bytes = 0;
  for (const [h, j] of objects) {
    const dir = `${p.objects}${p.s}${h.slice(0, 2)}`, f = `${dir}${p.s}${h}.json`;
    if (await es().exists(f)) continue; await es().mkdir(dir); await es().writeFile(f, j); written++; bytes += j.length;
  }
  const mdir = `${p.objects}${p.s}${mh.slice(0, 2)}`; await es().mkdir(mdir); await es().writeFile(`${mdir}${p.s}${mh}.json`, stable(manifest));
  const id = mh.slice(0, 12) + '-' + Date.now().toString(36);
  refs.revisions[id] = { id, parent: head || null, branch: refs.current, label, auto, time: Date.now(), manifest: mh, newObjects: written, newBytes: bytes, clips: data.sequence.clips.length };
  refs.branches[refs.current] = id;
  const dropped = auto ? pruneAuto(refs, getPrefs().autoSaveKeep) : 0;
  await writeRefs(refs, p.d);
  if (dropped) await collectGarbage(refs, p.d).catch(() => 0);
  set({ versionsRev: Date.now() });
  return refs.revisions[id];
}
export async function listHistory() { const r = await readRefs(); return { ...r, dir: await historyDir() }; }
/** Load a revision into the editor (stays on the current branch; the next save continues from it). */
export async function restoreRevision(id, dir) {
  const refs = await readRefs(dir); const rev = refs.revisions[id]; if (!rev) throw new Error('Unknown revision');
  const p = await paths(dir); const manifest = JSON.parse(await es().readText(objPath(p, rev.manifest)));
  const data = await implode(manifest, dir); const s = getState();
  loadProject({ projectId: s.projectId, ...data }, s.projectPath); set({ restoredFrom: id }); markDirty();
  return rev;
}
/** Start a new branch at a revision (or at the current head) and switch to it. */
export async function createBranch(name, fromId = null) {
  const refs = await readRefs(); const n = String(name || '').trim(); if (!n) throw new Error('Branch name required');
  if (refs.branches[n] !== undefined) throw new Error('Branch exists');
  refs.branches[n] = fromId || refs.branches[refs.current] || null; refs.current = n; await writeRefs(refs);
  if (fromId) await restoreRevision(fromId);
  set({ versionsRev: Date.now() });
}
export async function switchBranch(name) {
  const refs = await readRefs(); if (refs.branches[name] === undefined) throw new Error('Unknown branch');
  refs.current = name; await writeRefs(refs); if (refs.branches[name]) await restoreRevision(refs.branches[name]);
  set({ versionsRev: Date.now() });
}
/** First Save of a project that had only an auto-save history: move that history next to the new project file. */
export async function adoptAutosaveHistory(projectId, projectName, projectPath) {
  const from = await autosaveDirFor(projectId, projectName); const to = historyDirFor(projectPath);
  if (!(await es().exists(from)) || (await es().exists(to))) return false;
  try { await chain; await es().rename(from, to); return true; } catch { return false; } // another drive: the history stays in userData
}
/** The newest revision of a history folder (any branch), or null. */
export async function latestRevision(dir) {
  const refs = await readRefs(dir); const revs = Object.values(refs.revisions || {}).sort((a, b) => b.time - a.time);
  return revs[0] || null;
}

// ---------------------------------------------------------------- auto-save
let timer = null;
export function startAutoSave(minutes = 5) {
  stopAutoSave(); if (!(minutes > 0)) return;
  timer = setInterval(async () => {
    const s = getState(); if (!s.dirty || commitBusy()) return; // a Save is being recorded: skip this tick
    try { const r = await commitRevision('Auto-save', { auto: true }); if (r) set((x) => ({ log: [...x.log.slice(-49), `Auto-saved revision (${r.newObjects} new objects)`] })); } catch (e) { console.warn('auto-save failed', e); }
  }, minutes * 60000);
}
export const stopAutoSave = () => { if (timer) clearInterval(timer); timer = null; };

// ---------------------------------------------------------------- recovery journal
// The auto-save interval is minutes; the journal is what a crash loses at most a few seconds against. About 2 s after the last
// edit the whole project goes to "journal.json" in the history folder (one file, replaced atomically). A big project is written
// less often: the gap is at least 20 times what the last write took, so journaling never costs more than 5% of the time.
// It follows Preferences > Auto Save: an interval of 0 turns it off too.
const SESSION = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const JOURNAL_DEBOUNCE_MS = 2000;
const journalPath = (dir) => `${dir}${sep(dir)}journal.json`;
let jTimer = null, jLastEnd = 0, jCost = 0, jBusy = false, jDir = null, jSeen = null, jWasDirty = false;
/** Milliseconds to wait before the next journal write. */
export const journalDelay = (sinceLastWrite, lastCost, debounce = JOURNAL_DEBOUNCE_MS) => Math.max(debounce, lastCost * 20 - sinceLastWrite);
export async function writeJournal() {
  const s = getState(); if (!s.dirty || !(getPrefs().autoSaveMin > 0)) return false;
  jBusy = true; const t0 = Date.now();
  try {
    const dir = await historyDir(s); await es().mkdir(dir);
    if (jDir && jDir !== dir) await removeJournal();
    await es().writeFile(journalPath(dir), JSON.stringify({ session: SESSION, time: Date.now(), data: projectData(s) })); jDir = dir;
    return true;
  } catch (e) { console.warn('journal failed', e); return false; } finally { jBusy = false; jCost = Date.now() - t0; jLastEnd = Date.now(); }
}
async function removeJournal() { if (!jDir) return; const d = jDir; jDir = null; try { await es().removeFile(journalPath(d)); } catch { /* none */ } }
function scheduleJournal() {
  if (jTimer) clearTimeout(jTimer);
  jTimer = setTimeout(async () => { jTimer = null; if (jBusy) { scheduleJournal(); return; } await writeJournal(); }, journalDelay(Date.now() - jLastEnd, jCost));
}
/** Store listener: an edit schedules a write; the project becoming clean (Save, a project opened) ends the journal. */
function watchJournal() {
  const s = getState(); const parts = [s.sequence, s.media, s.seqs, s.bins];
  const same = jSeen && parts.every((p, i) => p === jSeen[i]); jSeen = parts;
  if (jWasDirty && !s.dirty) { if (jTimer) { clearTimeout(jTimer); jTimer = null; } removeJournal(); }
  jWasDirty = s.dirty;
  if (s.dirty && !same) scheduleJournal();
}
/** The journal a crashed session left, or null (none, unreadable, or from another session than the marker). */
async function readJournal(marker) {
  try {
    const p = journalPath(marker.dir); if (!marker.session || !(await es().exists(p))) return null;
    const j = JSON.parse(await es().readText(p));
    return j.session === marker.session && j.data?.sequence ? j : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- crash recovery
// userData/session.json exists while EditorStage runs and is removed when the window closes normally. Found at start-up,
// it means the last session ended in a crash / power cut / kill: its newest auto-save is offered for recovery.
async function markerPath() { const ud = await es().userData(); return `${ud}${sep(ud)}session.json`; }
let markerKey = '';
async function writeMarker() {
  const s = getState(); const key = `${s.projectId}|${s.projectPath}|${s.projectName}`; if (key === markerKey) return; markerKey = key;
  try { await es().writeFile(await markerPath(), JSON.stringify({ started: Date.now(), session: SESSION, projectId: s.projectId, projectPath: s.projectPath, projectName: s.projectName, dir: await historyDir(s) })); } catch { /* read-only profile: no recovery */ }
}
/** Normal close: the session ended cleanly. */
export async function clearSessionMarker() { markerKey = '\u0000closed'; if (jTimer) { clearTimeout(jTimer); jTimer = null; } await removeJournal(); try { await es().removeFile(await markerPath()); } catch { /* none */ } }
/**
 * Start-up: read the marker of the previous session, start this session's marker. Returns what can be recovered
 * ({ marker, rev } when the previous session crashed after an auto-save that was not followed by a Save), else null.
 */
export async function bootRecovery() {
  let prev = null; const mp = await markerPath();
  try { if (await es().exists(mp)) prev = JSON.parse(await es().readText(mp)); } catch { /* unreadable: treated as a clean exit */ }
  await writeMarker(); subscribe(() => { if (markerKey !== '\u0000closed') { writeMarker(); watchJournal(); } });
  if (!prev?.dir) return null;
  const rev = await latestRevision(prev.dir).catch(() => null);
  const journal = await readJournal(prev); // edits after the last recorded revision
  if (journal && (!rev || journal.time > rev.time)) return { marker: prev, rev: { id: null, label: 'Journal', time: journal.time }, journal };
  if (!rev || rev.label === 'Save') return null; // nothing recorded, or the newest revision is a Save (the file has it)
  return { marker: prev, rev };
}
/** Load the recovered auto-save: same project identity and file as before the crash, marked unsaved. */
export async function recoverSession({ marker, rev, journal }) {
  set({ projectId: marker.projectId || getState().projectId, projectPath: marker.projectPath || null, projectName: marker.projectName || 'Untitled' });
  if (journal) { const s = getState(); loadProject({ projectId: s.projectId, ...journal.data }, s.projectPath); markDirty(); return rev; }
  return restoreRevision(rev.id, marker.dir);
}
