// Program Monitor > Comparison View (Premiere): a Reference image next to (or split with) the Current one.
// Shot comparison: the reference is another moment of the sequence (match the look of two shots).
// Frame comparison: the reference is the same frame before the clips' colour / effects (before / after).
// View only: never part of the project, never in an export. The last mode is remembered per viewer.

export const COMPARE_MODES = [['side', 'Side by Side'], ['vsplit', 'Vertical Split'], ['hsplit', 'Horizontal Split']];
const KEY = 'es-compare';
const saved = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
export const rememberCompare = (c) => { try { localStorage.setItem(KEY, JSON.stringify({ mode: c.mode, kind: c.kind, split: c.split })); } catch { /* private window */ } };

/** Initial comparison state (off): last mode / kind / split position of this viewer. */
export const compareDefaults = () => { const s = saved(); return { on: false, mode: s.mode || 'side', kind: s.kind || 'shot', split: s.split ?? 0.5, swap: false, refTime: 0 }; };

const videoKinds = (seq) => new Set(seq.tracks.filter((t) => t.kind === 'video').map((t) => t.id));
const active = (c, t) => c.enabled !== false && t >= c.start && t < c.start + c.dur;

/** Sorted edit points (clip starts / ends) of the video tracks: Previous / Next Edit of the reference. */
export function videoEdits(seq) {
  const vt = videoKinds(seq); const pts = new Set([0]);
  for (const c of seq.clips) if (vt.has(c.track)) { pts.add(+c.start.toFixed(4)); pts.add(+(c.start + c.dur).toFixed(4)); }
  return [...pts].sort((a, b) => a - b);
}
export const prevEdit = (seq, t) => videoEdits(seq).filter((x) => x < t - 1e-4).pop() ?? 0;
export const nextEdit = (seq, t) => { const e = videoEdits(seq).find((x) => x > t + 1e-4); return e ?? t; };

/** Topmost enabled video clip with picture at time t (the shot Color Match uses as its reference). */
export function shotClipAt(seq, t) {
  const order = seq.tracks.filter((x) => x.kind === 'video').map((x) => x.id); // V3 .. V1: topmost first
  for (const id of order) { const c = seq.clips.find((x) => x.track === id && active(x, t) && (x.mediaId || x.nestId)); if (c) return c; }
  return null;
}

/** Reference time when Comparison View opens: the middle of the previous shot, else the playhead. */
export function defaultRefTime(seq, t) {
  const cur = shotClipAt(seq, t); const vt = videoKinds(seq);
  const prev = seq.clips.filter((c) => vt.has(c.track) && c.enabled !== false && (c.mediaId || c.nestId) && c.start + c.dur <= (cur ? cur.start : t) + 1e-4).sort((a, b) => b.start + b.dur - (a.start + a.dur))[0];
  return prev ? prev.start + prev.dur / 2 : t;
}

/** A clip as it was before grading: no Lumetri, no Filter, no video effects (Motion, Opacity, masks stay). */
const ungraded = (c) => ({ ...c, lumetri: null, filter: null, effects: (c.effects || []).filter((e) => e.category === 'Audio' || e.category === 'Transition') });

/**
 * The state the Reference side renders. Frame: the clips under the playhead ungraded (in nested sequences too).
 * Shot: the sequence at refTime; media clips get their own `cmp:` element so seeking the reference never moves the
 * elements the Current image plays from.
 */
export function referenceState(st, cmp) {
  if (cmp.kind === 'frame') {
    const t = st.playhead; const nests = new Set();
    const clips = st.sequence.clips.map((c) => { if (!active(c, t)) return c; if (c.nestId) nests.add(c.nestId); return ungraded(c); });
    const seqs = { ...(st.seqs || {}) };
    for (const id of nests) if (seqs[id]) seqs[id] = { ...seqs[id], clips: seqs[id].clips.map(ungraded) };
    return { ...st, sequence: { ...st.sequence, clips }, seqs };
  }
  return { ...st, playhead: Math.max(0, cmp.refTime || 0) };
}
export const REF_PREFIX = 'cmp:'; // element key prefix of the Shot reference (src/Services/media.js keyedDeps)
