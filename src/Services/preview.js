import { getState, set } from '../Core/store';
import { exportSequence, renderAudioMix, wavBytesFromPcm } from './exporter';
import { sequenceEnd } from '../Core/editing';
import { sequenceHash } from '../Core/previewState';
import { scratchDir } from '../Core/scratch';

// Preview render cache: pre-rendered video (and mixed audio) for ranges of the sequence, valid only while the sequence is unchanged.
const hasFx = (seq, c) => (c.effects || []).some((e) => e.enabled && e.category !== 'Audio') || (c.lumetri && Object.keys(c.lumetri).length) || (c.masks || []).length || c.nestId || c.graphic;
function effectRanges(seq) {
  const r = [];
  for (const c of seq.clips) if (hasFx(seq, c) && ['video'].includes(seq.tracks.find((t) => t.id === c.track)?.kind)) r.push([c.start, c.start + c.dur]);
  for (const t of seq.transitions || []) if (t.kind === 'video') r.push([t.at - t.dur / 2, t.at + t.dur / 2]);
  r.sort((a, b) => a[0] - b[0]); const out = [];
  for (const x of r) { const l = out[out.length - 1]; if (l && x[0] <= l[1] + 0.05) l[1] = Math.max(l[1], x[1]); else out.push([Math.max(0, x[0]), x[1]]); }
  return out;
}

/** mode: 'inout' (In to Out / whole sequence), 'effects' (only parts with effects/transitions), 'audio' */
export async function renderPreview(mode, cancel = () => false) {
  const st = getState(); const seq = st.sequence; const end = sequenceEnd(seq); if (end <= 0) return { ok: false, error: 'Sequence is empty' };
  const rangeIO = st.inPoint != null && st.outPoint != null && st.outPoint > st.inPoint ? [[st.inPoint, st.outPoint]] : [[0, end]];
  const ranges = mode === 'effects' ? effectRanges(seq).map(([a, b]) => [Math.max(0, a), Math.min(end, b)]) : rangeIO;
  if (!ranges.length) return { ok: false, error: 'No effects or transitions to render' };
  const tmp = await scratchDir('previews'); const sp = tmp.includes('\\') ? '\\' : '/'; const hash = sequenceHash(st); const made = [];
  for (let i = 0; i < ranges.length; i++) {
    const [a, b] = ranges[i];
    set({ renderProgress: { text: `Rendering ${mode === 'audio' ? 'audio' : 'video'} ${i + 1}/${ranges.length}`, p: 0 } });
    if (mode === 'audio') {
      const pcm = await renderAudioMix(structuredClone({ ...st, log: [] }), a, b); const path = `${tmp}${sp}es-apreview-${hash}-${i}.wav`;
      await window.editorstage.writeFile(path, wavBytesFromPcm(pcm)); made.push({ kind: 'audio', start: a, end: b, path, hash });
    } else {
      const path = `${tmp}${sp}es-preview-${hash}-${i}.mp4`;
      const r = await exportSequence({ path, preset: 'Preview (H.264, fast)', width: Math.min(seq.width, 1280), height: Math.round((Math.min(seq.width, 1280) * seq.height) / seq.width / 2) * 2, fps: seq.fps, start: a, end: b, audio: false }, (p, text) => set({ renderProgress: { text: `${text}  (${i + 1}/${ranges.length})`, p } }), cancel);
      if (!r.ok) { set({ renderProgress: null }); return r; }
      made.push({ kind: 'video', start: a, end: b, path, hash });
    }
  }
  const kind = mode === 'audio' ? 'audio' : 'video';
  set((s) => ({ previews: [...(s.previews || []).filter((p) => p.kind !== kind || p.hash !== hash), ...made], renderProgress: null }));
  return { ok: true, ranges: made.length };
}
export async function deleteRenderFiles() {
  for (const p of getState().previews || []) await window.editorstage.removeFile(p.path);
  set({ previews: [] });
}
