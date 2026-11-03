// Cold Archive Manager: move media that no timeline uses to external storage (gzip-compressed, verified) and keep a
// searchable index that works while the drive is disconnected.
import { getState, edit, allSeqs } from '../Core/store';

/** media ids referenced by any clip in any sequence */
export function usedMediaIds(s = getState()) {
  const ids = new Set();
  for (const q of Object.values({ ...s.seqs, [s.sequence.id]: s.sequence })) for (const c of q.clips) if (c.mediaId) ids.add(c.mediaId);
  void allSeqs; return ids;
}
export function unusedMedia(s = getState()) { const used = usedMediaIds(s); return s.media.filter((m) => !used.has(m.id) && m.path); }

/** Archive the given media items. removeOriginals deletes the source files after verification; the project items are
 *  then marked offline (they keep their archive reference, so they can be restored later). */
export async function archiveMedia(items, { dest, compress = true, removeOriginals = false, removeFromProject = false, note = '' }, onProgress) {
  const off = window.editorstage.archive.onProgress((p) => onProgress?.(p));
  try {
    const r = await window.editorstage.archive.run({ items: items.map((m) => ({ path: m.path, name: m.name, kind: m.kind, duration: m.duration, width: m.width, height: m.height, mediaId: m.id })), dest, project: getState().projectName, compress, removeOriginals, note });
    const ok = r.record.items.filter((x) => !x.error);
    edit('Archive media', ({ media }) => {
      for (const it of ok) {
        const i = media.findIndex((m) => m.id === it.mediaId); if (i < 0) continue;
        if (removeFromProject) media.splice(i, 1);
        else media[i] = { ...media[i], archived: { id: r.record.id, hash: it.hash, volume: r.record.volume, dest: r.record.dest }, ...(removeOriginals ? { status: 'offline' } : {}) };
      }
    });
    return r.record;
  } finally { off(); }
}

/** Search every archive in the index (works offline): name / kind / project / note / original path. */
export async function searchArchives(q = '') {
  const ix = await window.editorstage.archive.index(); const t = q.trim().toLowerCase(); const out = [];
  for (const a of ix.archives) {
    const online = await window.editorstage.archive.online(a.dest);
    for (const it of a.items) {
      if (it.error) continue;
      const hay = `${it.name} ${it.kind} ${a.project} ${a.note} ${it.originalPath}`.toLowerCase();
      if (!t || t.split(/\s+/).every((w) => hay.includes(w))) out.push({ ...it, archiveId: a.id, project: a.project, created: a.created, volume: a.volume, online });
    }
  }
  return out.sort((x, y) => y.created - x.created);
}
export async function restoreItem(it, to = null) {
  const r = await window.editorstage.archive.restore({ archiveId: it.archiveId, hash: it.hash, to });
  if (r.ok) edit('Restore archived media', ({ media }) => { for (const m of media) if (m.archived?.hash === it.hash) { m.status = 'ready'; delete m.archived; } });
  return r;
}
