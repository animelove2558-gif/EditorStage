// Edit in AudioStage (like "Edit in Adobe Audition"): render the selected audio clip to a 48 kHz / 24-bit WAV, swap the
// clip onto that file, open it in AudioStage, and reload the clip whenever AudioStage saves (Ctrl+S) the file.
import { getState, set, edit } from '../Core/store';
import { sourceSpan } from '../Core/clipTime';
import { importPaths, mediaById, invalidateMedia } from './media';

const notify = (msg) => set((s) => ({ log: [...s.log.slice(-49), msg] }));
const sep = (p) => (p.includes('\\') ? '\\' : '/');
const dirOf = (p) => p.slice(0, Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')));

/** The audio clip to edit: a selected clip on an audio track (or the audio partner of a selected video clip). */
export function audioClipForEdit(s = getState()) {
  const seq = s.sequence; const kind = (c) => seq.tracks.find((t) => t.id === c.track)?.kind;
  const sel = seq.clips.filter((c) => s.selection.includes(c.id) && c.mediaId);
  let c = sel.find((x) => kind(x) === 'audio');
  if (!c) { const v = sel.find((x) => kind(x) === 'video' && x.linkId); if (v) c = seq.clips.find((x) => x.linkId === v.linkId && kind(x) === 'audio'); }
  const m = c && mediaById(c.mediaId);
  return c && m && (m.kind === 'audio' || m.kind === 'video') ? c : null;
}
export const canEditInAudioStage = () => !!audioClipForEdit();

async function workDir() {
  const p = getState().projectPath;
  const base = p ? dirOf(p) : await window.editorstage.tmpDir();
  const d = `${base}${sep(base)}AudioStage Edits`; await window.editorstage.mkdir(d); return d;
}

export async function editInAudioStage() {
  const s = getState(); const clip = audioClipForEdit(s); if (!clip) return notify('Edit in AudioStage: select an audio clip on the timeline');
  const media = mediaById(clip.mediaId); const es = window.editorstage;
  const loc = await es.audiostage.locate(); if (!loc) { set({ dialog: { type: 'audiostagePath' } }); return; }
  const dir = await workDir(); const base = (clip.name || media.name).replace(/\.[^.]+$/, '').replace(/[^\w฀-๿ -]+/g, '_').slice(0, 60);
  let out = `${dir}${sep(dir)}${base} - AudioStage.wav`; for (let n = 2; await es.exists(out); n++) out = `${dir}${sep(dir)}${base} - AudioStage ${n}.wav`;
  notify(`Rendering “${clip.name}” for AudioStage…`);
  const span = sourceSpan(clip);
  const r = await es.extractAudio(media.path || media.playPath, clip.inPoint || 0, span, out, { rate: 48000, bits: 24 });
  if (!r.ok) return notify('Could not render the clip: ' + r.error);
  const [nm] = await importPaths([out], notify, { kind: 'audio' }); if (!nm) return;
  edit('Edit in AudioStage', ({ seq, media: ml }) => {
    const c = seq.clips.find((x) => x.id === clip.id); if (!c) return;
    c.mediaId = nm.id; c.inPoint = 0; c.name = `${clip.name} (AudioStage)`; c.audiostage = { file: out, from: { mediaId: clip.mediaId, inPoint: clip.inPoint || 0 } };
    const mm = ml.find((x) => x.id === nm.id); if (mm) { mm.audiostage = true; mm.name = out.split(/[\\/]/).pop(); }
  });
  const o = await es.audiostage.open(out);
  notify(o.ok ? `Opened in AudioStage — save there (Ctrl+S) and the clip updates here automatically` : 'AudioStage: ' + o.error);
}

/** Reload every media item whose file is `path` (called by the file watcher). */
export async function reloadEditedFile(path) {
  const s = getState(); const items = s.media.filter((m) => m.path === path || m.playPath === path); if (!items.length) return;
  const pr = await window.editorstage.probe(path).catch(() => null); const dur = pr?.ok && pr.duration ? pr.duration : null;
  for (const m of items) invalidateMedia(m.id);
  edit('AudioStage: update clip', ({ seq, media }) => {
    for (const m of media.filter((x) => items.some((i) => i.id === x.id))) {
      m.rev = (m.rev || 0) + 1; if (dur) m.duration = dur;
      for (const c of seq.clips.filter((x) => x.mediaId === m.id)) if (dur && (c.inPoint || 0) === 0) c.dur = Math.max(0.04, dur / (c.speed || 1)); // follow length changes made in AudioStage
    }
  });
  for (const m of items) invalidateMedia(m.id);
  notify(`Updated from AudioStage: ${items[0].name}`);
}

let installed = false;
/** Hook up the watcher events once; also re-arm watches for edits that exist in a reopened project. */
export function installAudioStageSync() {
  if (installed || !window.editorstage?.audiostage) return; installed = true;
  window.editorstage.audiostage.onChanged(({ path }) => reloadEditedFile(path));
}
export function rearmWatches() {
  for (const m of getState().media) if (m.audiostage) window.editorstage?.audiostage?.watch(m.path);
}
