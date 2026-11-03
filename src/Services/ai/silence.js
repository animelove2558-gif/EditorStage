// Auto-Cut Silence & Dead Air: find quiet stretches in the timeline audio and ripple-delete them on every track.
import { edit, getState } from '../../Core/store';
import * as ed from '../../Core/editing';
import { sequencePCM, timelineSpan } from './audioSource';

const SR = 16000;
/**
 * Analyse the sequence audio (or the selected clips' audio) and return the silent ranges in timeline seconds.
 * opts: { thresholdDb (e.g. -40), minSilence (s), padding (s kept at each side), ids (clip ids or null), smooth (s) }
 * The level is measured as RMS in 20 ms windows with a short hold so single consonants do not split a silence.
 */
export async function detectSilence(opts = {}) {
  const { thresholdDb = -40, minSilence = 0.6, padding = 0.12, ids = null } = opts;
  const seq = getState().sequence; const span = opts.range || timelineSpan(seq, ids);
  if (!span) return { ranges: [], levels: null, span: null };
  const [a, b] = span; const pcm = await sequencePCM(seq, a, b, SR, ids);
  const { ranges, levels } = silentRanges(pcm, SR, a, { thresholdDb, minSilence, padding });
  return { ranges, levels, span, total: ranges.reduce((s, r) => s + r[1] - r[0], 0) };
}
/** Silent ranges (seconds from `a`) in mono PCM. Used by detectSilence and Long-to-Shorts. */
export function silentRanges(pcm, SR, a, { thresholdDb = -40, minSilence = 0.6, padding = 0.12 } = {}) {
  const win = Math.round(SR * 0.02); const nw = Math.ceil(pcm.length / win); const db = new Float32Array(nw);
  for (let w = 0; w < nw; w++) { let s = 0; const i0 = w * win, i1 = Math.min(pcm.length, i0 + win); for (let i = i0; i < i1; i++) s += pcm[i] * pcm[i]; db[w] = 10 * Math.log10(s / Math.max(1, i1 - i0) + 1e-12); }
  // loud windows are extended by a 100 ms hold (speech has short dips between syllables)
  const hold = 5; const loud = new Uint8Array(nw);
  for (let w = 0; w < nw; w++) if (db[w] > thresholdDb) for (let k = Math.max(0, w - hold); k <= Math.min(nw - 1, w + hold); k++) loud[k] = 1;
  const ranges = []; let s0 = -1;
  for (let w = 0; w <= nw; w++) {
    const q = w < nw && !loud[w];
    if (q && s0 < 0) s0 = w;
    if (!q && s0 >= 0) {
      let t0 = a + (s0 * win) / SR, t1 = a + (w * win) / SR;
      const atStart = s0 === 0, atEnd = w === nw;
      if (!atStart) t0 += padding; if (!atEnd) t1 -= padding;
      if (t1 - t0 >= Math.max(0.05, minSilence - (atStart || atEnd ? padding : 2 * padding))) ranges.push([t0, t1]);
      s0 = -1;
    }
  }
  return { ranges, levels: { db, per: SR / win, start: a } };
}

/** Ripple-delete the ranges across all unlocked tracks (keeps video and audio in sync). One undo step. */
export function cutRanges(ranges, label = 'Auto-Cut Silence') {
  if (!ranges.length) return 0;
  const sorted = ranges.slice().sort((x, y) => y[0] - x[0]); // last first, so earlier times stay valid
  edit(label, ({ seq }) => removeRangesIn(seq, sorted));
  return sorted.reduce((s, r) => s + r[1] - r[0], 0);
}
/** The ripple delete of cutRanges on a sequence object (mutates it). */
export function removeRangesIn(seq, ranges) {
  for (const [x, y] of ranges.slice().sort((p, q) => q[0] - p[0])) {
    ed.removeRange(seq, x, y, true);
    for (const m of seq.markers || []) { if (m.time >= y) m.time -= y - x; else if (m.time > x) m.time = x; }
  }
  seq.clips = seq.clips.filter((c) => c.dur > 1e-3);
  ed.fixTransitions(seq);
}
