// Scene Edit Detection (Premiere: right-click a clip > Scene Edit Detection): FFmpeg's scdet filter finds the cuts inside the
// clip's source range; then the clip is cut there, and/or subclips and markers are created.
import { getState, edit } from '../Core/store';
import { sourceAt, localAtSource } from '../Core/clipTime';
import { splitClipsAt } from '../Core/editing';
import { runFfmpeg } from './ffjob';

const uid = () => Math.random().toString(36).slice(2, 9);

/** Detected cut times (source seconds) inside [a, b) of a media file. threshold: scdet score 1..100 (lower = more cuts). */
export function detectCuts(media, a, b, threshold = 10, onProgress) {
  const job = runFfmpeg(['-hide_banner', '-nostdin', '-ss', a.toFixed(4), '-i', media.path || media.playPath, '-t', (b - a).toFixed(4), '-an', '-sn',
    '-vf', `scale=320:-2,scdet=threshold=${threshold}`, '-f', 'null', '-'], { duration: b - a, onProgress });
  const p = job.then((r) => {
    if (r.cancelled) throw new Error('Cancelled');
    if (!r.ok) throw new Error(r.error || 'Scene detection failed');
    const cuts = [...r.stderr.matchAll(/lavfi\.scd\.time:\s*([\d.]+)/g)].map((m) => a + +m[1]).filter((t) => t > a + 0.04 && t < b - 0.04);
    return [...new Set(cuts.map((t) => Math.round(t * 1000) / 1000))].sort((x, y) => x - y);
  });
  p.cancel = job.cancel; return p;
}

/**
 * Run on clips. opts: { cut, subclips, markers, threshold, onProgress }. Returns { cuts: number, perClip: [{ id, times }] } (sequence times).
 * The promise has .cancel().
 */
export function sceneEditDetection(clipIds, opts) {
  let current = null; let cancelled = false;
  const p = (async () => {
    const s = getState(); const seq = s.sequence; const fps = seq.fps || 30;
    const clips = seq.clips.filter((c) => clipIds.includes(c.id) && !c.asAudio && s.media.find((m) => m.id === c.mediaId && m.kind === 'video' && !m.synthetic));
    if (!clips.length) throw new Error('Select one or more video clips');
    const perClip = [];
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i]; const m = s.media.find((x) => x.id === c.mediaId);
      const s0 = sourceAt(c, c.start, m.fps || fps, m.duration), s1 = sourceAt(c, c.start + c.dur - 1e-6, m.fps || fps, m.duration);
      const lo = Math.min(s0, s1), hi = Math.max(s0, s1) + 1 / (m.fps || fps);
      current = detectCuts(m, lo, hi, opts.threshold ?? 10, (f) => opts.onProgress?.((i + f) / clips.length));
      const src = await current; if (cancelled) throw new Error('Cancelled');
      // source time -> sequence time (works with speed / reverse); snap to frames
      const times = src.map((t) => Math.round((c.start + localAtSource(c, t)) * fps) / fps).filter((t) => t > c.start + 0.5 / fps && t < c.start + c.dur - 0.5 / fps);
      perClip.push({ id: c.id, mediaId: m.id, name: c.name, times, src });
    }
    if (opts.markers) edit('Scene Edit Detection: Markers', ({ seq: sq }) => { for (const pc of perClip) pc.times.forEach((t, k) => sq.markers.push({ id: uid(), time: t, name: `Scene ${k + 2}`, comment: `Scene Edit Detection (${pc.name})` })); });
    if (opts.subclips) {
      edit('Scene Edit Detection: Subclips', ({ media }) => {
        for (const pc of perClip) {
          const m = media.find((x) => x.id === pc.mediaId); const c = getState().sequence.clips.find((x) => x.id === pc.id);
          const s0 = sourceAt(c, c.start, m.fps || 30, m.duration), s1 = sourceAt(c, c.start + c.dur - 1e-6, m.fps || 30, m.duration) + 1 / (m.fps || 30);
          const bounds = [Math.min(s0, s1), ...pc.src, Math.max(s0, s1)];
          for (let k = 0; k + 1 < bounds.length; k++) media.push({ ...structuredClone(m), id: uid(), name: `${m.name.replace(/\.[^.]+$/, '')} Scene ${k + 1}`, subclip: { parent: m.id, in: bounds[k], out: bounds[k + 1] } });
        }
      });
    }
    if (opts.cut) edit('Scene Edit Detection: Cut', ({ seq: sq }) => { for (const pc of perClip) splitClipsAt(sq, [pc.id], pc.times); });
    return { cuts: perClip.reduce((n, pc) => n + pc.times.length, 0), perClip };
  })();
  p.cancel = () => { cancelled = true; current?.cancel?.(); };
  return p;
}
