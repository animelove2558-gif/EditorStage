// Offline media and Link Media (Premiere: Media Offline / Link Media / Locate). Items whose file is missing are marked
// offline (clips show "Media Offline"); Link Media relinks an item to a new file and searches folders for the other missing
// files by name (and size, when it was recorded at import).
import { getState, set, edit } from '../Core/store';
import { importPaths, invalidateMedia } from './media';

const nameOf = (p) => String(p || '').split(/[\\/]/).pop();
const dirOf = (p) => p.slice(0, Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')));

/** Mark items whose source file is gone as offline (and bring back ones whose file reappeared). Returns the offline ids. */
export async function checkOffline() {
  const es = window.editorstage; const out = [];
  for (const m of getState().media) {
    if (m.synthetic || !m.path || m.archived) continue;
    const here = await es.exists(m.path).catch(() => true);
    if (!here && m.status !== 'offline') { set((s) => ({ media: s.media.map((x) => (x.id === m.id ? { ...x, status: 'offline', wasStatus: x.status, error: 'Media offline' } : x)) })); invalidateMedia(m.id); }
    else if (here && m.status === 'offline' && !m.madeOffline) { set((s) => ({ media: s.media.map((x) => (x.id === m.id ? { ...x, status: x.wasStatus || 'ready', error: undefined } : x)) })); invalidateMedia(m.id); }
    if (!here) out.push(m.id);
    // a playable copy made by FFmpeg (temp folder) was cleaned up: make it again from the original
    else if (m.transcoded && m.playPath && m.playPath !== m.path && !(await es.exists(m.playPath).catch(() => true))) await linkMedia(m.id, m.path).catch(() => {});
  }
  return out;
}
export const offlineItems = (s = getState()) => s.media.filter((m) => m.status === 'offline');

/** Relink one item to `path` (probed like an import; the item keeps its id so every clip follows). Undoable. */
export async function linkMedia(id, path) {
  const old = getState().media.find((m) => m.id === id); if (!old) return false;
  const [probe] = await importPaths([path], () => {}, { noAdd: true, kind: old.kind });
  if (!probe || probe.status !== 'ready') throw new Error(probe?.error || 'The file cannot be read');
  if (old.kind !== probe.kind && !(old.kind === 'video' && probe.kind === 'video')) throw new Error(`Expected a ${old.kind} file`);
  edit(`Link Media ${old.name}`, ({ media }) => {
    const m = media.find((x) => x.id === id); if (!m) return;
    Object.assign(m, { path: probe.path, playPath: probe.playPath, name: probe.name, ext: probe.ext, transcoded: probe.transcoded, size: probe.size, status: 'ready', error: undefined, wasStatus: undefined, madeOffline: undefined });
    for (const k of ['width', 'height', 'fps', 'hasAudio']) if (probe[k]) m[k] = probe[k];
    if (!m.duration || probe.duration > m.duration) m.duration = probe.duration; // never shorten: clips keep their In/Out
  });
  invalidateMedia(id); return true;
}
/**
 * Search folders for the missing files (name, then size). Returns [{ id, path }] best matches.
 * roots: folders to search (e.g. the folder where the user located one file, its parent, the project folder).
 */
export async function findMissing(roots, ids = offlineItems().map((m) => m.id)) {
  const items = getState().media.filter((m) => ids.includes(m.id));
  const found = await window.editorstage.findFiles(roots.filter(Boolean), [...new Set(items.map((m) => nameOf(m.path)))], 6);
  const out = [];
  for (const m of items) {
    const c = found[nameOf(m.path).toLowerCase()] || []; if (!c.length) continue;
    const best = (m.size && c.find((x) => x.size === m.size)) || (!m.size ? c[0] : null);
    if (best) out.push({ id: m.id, path: best.path });
  }
  return out;
}
/** After one file was located: relink every other missing item found near it. Returns the number relinked. */
export async function relinkOthersNear(path) {
  const d = dirOf(path); const roots = [d, dirOf(d)];
  const pp = getState().projectPath; if (pp) roots.push(dirOf(pp));
  let n = 0; for (const { id, path: p } of await findMissing(roots)) { try { await linkMedia(id, p); n++; } catch { /* leave it offline */ } }
  return n;
}
