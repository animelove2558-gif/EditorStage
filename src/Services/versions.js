// Project Version Control & Auto-Save: revisions + branches stored next to the project in "<project>.history/".
// Storage is content-addressed: the project is split into objects (each clip, media item, track list, sequence header,
// other sequences) hashed with SHA-256; a revision is a small manifest of hashes, so unchanged parts are stored once.
import { getState, set, loadProject } from '../Core/store';
import { getPrefs } from '../Core/prefs';

const es = () => window.editorstage;
const sep = (p) => (p.includes('\\') ? '\\' : '/');
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x));

export async function historyDir() {
  const s = getState();
  if (s.projectPath) return s.projectPath.replace(/\.esproj$/i, '') + '.history';
  const ud = await es().userData(); return `${ud}${sep(ud)}autosave${sep(ud)}${(s.projectName || 'Untitled').replace(/[<>:"/\\|?*]+/g, '_')}.history`;
}
async function paths() { const d = await historyDir(); const s = sep(d); return { d, objects: `${d}${s}objects`, refs: `${d}${s}refs.json`, s }; }
async function readRefs() { const p = await paths(); try { return JSON.parse(await es().readText(p.refs)); } catch { return { branches: { main: null }, current: 'main', revisions: {} }; } }
async function writeRefs(r) { const p = await paths(); await es().mkdir(p.d); await es().writeFile(p.refs, JSON.stringify(r, null, 1)); }

const projectData = (s = getState()) => ({ sequence: s.sequence, media: s.media, projectName: s.projectName, bins: s.bins, seqs: s.seqs });
/** split the project into objects -> { manifest, objects: Map(hash -> json) } */
async function explode(data) {
  const objects = new Map(); const put = async (v) => { const j = stable(v); const h = await sha(j); objects.set(h, j); return h; };
  const seqParts = async (q) => ({ head: await put({ ...q, clips: undefined, transitions: undefined }), clips: await Promise.all(q.clips.map(put)), transitions: await put(q.transitions || []) });
  const manifest = { projectName: data.projectName, bins: await put(data.bins || []), media: await Promise.all((data.media || []).map(put)), sequence: await seqParts(data.sequence), seqs: {} };
  for (const [id, q] of Object.entries(data.seqs || {})) manifest.seqs[id] = await seqParts(q);
  return { manifest, objects };
}
async function implode(manifest) {
  const p = await paths(); const get = async (h) => JSON.parse(await es().readText(`${p.objects}${p.s}${h.slice(0, 2)}${p.s}${h}.json`));
  const seq = async (sp) => ({ ...(await get(sp.head)), clips: await Promise.all(sp.clips.map(get)), transitions: await get(sp.transitions) });
  const seqs = {}; for (const [id, sp] of Object.entries(manifest.seqs || {})) seqs[id] = await seq(sp);
  return { projectName: manifest.projectName, bins: await get(manifest.bins), media: await Promise.all(manifest.media.map(get)), sequence: await seq(manifest.sequence), seqs };
}

/** Save a revision on the current branch. Skips when nothing changed since the branch head. Returns the revision or null. */
/**
 * Preferences > Auto Save > versions kept: drop the oldest auto-saved revisions beyond `keep` (manual saves and branch heads
 * stay). A dropped revision's children point to its parent, so the history stays one chain.
 */
export function pruneAuto(refs, keep) {
  if (!(keep > 0)) return;
  const heads = new Set(Object.values(refs.branches));
  const autos = Object.values(refs.revisions).filter((r) => r.auto).sort((a, b) => a.time - b.time);
  for (const r of autos.filter((x) => !heads.has(x.id)).slice(0, Math.max(0, autos.length - keep))) {
    for (const x of Object.values(refs.revisions)) if (x.parent === r.id) x.parent = r.parent;
    delete refs.revisions[r.id];
  }
}
export async function commitRevision(label = 'Manual save', { auto = false } = {}) {
  const p = await paths(); const refs = await readRefs();
  const { manifest, objects } = await explode(projectData());
  const mh = await sha(stable(manifest)); const head = refs.branches[refs.current];
  if (head && refs.revisions[head]?.manifest === mh) return null;
  let written = 0, bytes = 0;
  for (const [h, j] of objects) {
    const dir = `${p.objects}${p.s}${h.slice(0, 2)}`, f = `${dir}${p.s}${h}.json`;
    if (await es().exists(f)) continue; await es().mkdir(dir); await es().writeFile(f, j); written++; bytes += j.length;
  }
  const mdir = `${p.objects}${p.s}${mh.slice(0, 2)}`; await es().mkdir(mdir); await es().writeFile(`${mdir}${p.s}${mh}.json`, stable(manifest));
  const id = mh.slice(0, 12) + '-' + Date.now().toString(36);
  refs.revisions[id] = { id, parent: head || null, branch: refs.current, label, auto, time: Date.now(), manifest: mh, newObjects: written, newBytes: bytes, clips: getState().sequence.clips.length };
  refs.branches[refs.current] = id;
  if (auto) pruneAuto(refs, getPrefs().autoSaveKeep);
  await writeRefs(refs);
  set({ versionsRev: Date.now() });
  return refs.revisions[id];
}
export async function listHistory() { const r = await readRefs(); return { ...r, dir: await historyDir() }; }
/** Load a revision into the editor (stays on the current branch; the next save continues from it). */
export async function restoreRevision(id) {
  const refs = await readRefs(); const rev = refs.revisions[id]; if (!rev) throw new Error('Unknown revision');
  const p = await paths(); const manifest = JSON.parse(await es().readText(`${p.objects}${p.s}${rev.manifest.slice(0, 2)}${p.s}${rev.manifest}.json`));
  const data = await implode(manifest); const path = getState().projectPath;
  loadProject(data, path); set({ dirty: true, restoredFrom: id });
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

// ---------------------------------------------------------------- auto-save
let timer = null;
export function startAutoSave(minutes = 5) {
  stopAutoSave(); if (!(minutes > 0)) return;
  timer = setInterval(async () => {
    const s = getState(); if (!s.dirty) return;
    try { const r = await commitRevision('Auto-save', { auto: true }); if (r) set((x) => ({ log: [...x.log.slice(-49), `Auto-saved revision (${r.newObjects} new objects)`] })); } catch (e) { console.warn('auto-save failed', e); }
  }, minutes * 60000);
}
export const stopAutoSave = () => { if (timer) clearInterval(timer); timer = null; };
