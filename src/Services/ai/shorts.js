// Long-to-Shorts (Create > Shorts, Smart Tools > Long-to-Shorts...): find the moments of a long sequence (podcast, stream,
// vlog) that work as short videos, then build one vertical sequence per moment with Auto-Reframe, captions and the
// silences cut. Moments are scored from the transcript (speech, keywords, hooks), the audio energy, loud bursts (laughter,
// shouts, applause) and scene changes; the user re-weights the scores, edits the ranges, and picks which ones to create.
import { getState, edit } from '../../Core/store';
import { sequenceEnd, copyRange } from '../../Core/editing';
import { sourceAt, localAtSource } from '../../Core/clipTime';
import { mediaById } from '../media';
import { detectCuts } from '../sceneDetect';
import { sequencePCM } from './audioSource';
import { sequenceWords } from './transcript';
import { silentRanges, removeRangesIn } from './silence';
import { segmentWords, captionsInto } from './stt';
import { defaultCaptionStyle, CAPTION_PRESETS, emojiFor } from './captions';
import { reframeClips, ASPECTS } from './reframe';

const SR = 16000;
const STEP = 0.1; // analysis bins (s)
const uid = () => Math.random().toString(36).slice(2, 9);

export const FEATURES = [['speech', 'Speech'], ['energy', 'Energy'], ['loud', 'Laughter / Loud'], ['scenes', 'Scene Changes'], ['keywords', 'Keywords & Hooks']];
export const DEFAULT_WEIGHTS = { speech: 1, energy: 0.8, loud: 0.8, scenes: 0.5, keywords: 1 };
// words that open or carry a good short (questions, reveals, superlatives), Thai and English
const HOOKS = /^(why|how|what|secret|never|always|best|worst|mistake|truth|crazy|insane|amazing|wow|money|free|first|last|tip|ทำไม|ยังไง|อย่างไร|อะไร|ความลับ|ไม่เคย|ที่สุด|ห้าม|พลาด|ความจริง|สุดยอด|ว้าว|เงิน|ฟรี|เคล็ดลับ|วิธี|ห้ามพลาด|จริงๆ|ช็อก)/i;

let current = null;
/** Cancel analyze / create in progress. */
export function cancelShorts() { if (current) { current.cancelled = true; current.job?.cancel?.(); } }
const check = (me) => { if (me.cancelled) throw new Error('Cancelled'); };

/** Scene cuts (timeline seconds) inside the video clips of a sequence, plus the edit points between clips. */
async function sceneCuts(seq, me, onProgress) {
  const fps = seq.fps || 30; const out = new Set();
  const vt = new Set(seq.tracks.filter((t) => t.kind === 'video' && !t.hidden).map((t) => t.id));
  const clips = seq.clips.filter((c) => vt.has(c.track) && c.mediaId && !c.asAudio && c.enabled !== false);
  for (const c of clips) if (c.start > 0.05) out.add(Math.round(c.start * 10) / 10);
  const vids = clips.filter((c) => { const m = mediaById(c.mediaId); return m?.kind === 'video' && !m.synthetic; });
  for (let i = 0; i < vids.length; i++) {
    const c = vids[i]; const m = mediaById(c.mediaId);
    const s0 = sourceAt(c, c.start, m.fps || fps, m.duration), s1 = sourceAt(c, c.start + c.dur - 1e-6, m.fps || fps, m.duration);
    me.job = detectCuts(m, Math.min(s0, s1), Math.max(s0, s1) + 1 / (m.fps || fps), 10, (f) => onProgress((i + f) / vids.length));
    const src = await me.job.catch((e) => { if (me.cancelled) throw e; return []; }); me.job = null; check(me);
    for (const t of src) { const l = localAtSource(c, t); if (l > 0.04 && l < c.dur - 0.04) out.add(Math.round((c.start + l) * 10) / 10); }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Analyse the active sequence. opts: { minLen, maxLen, scenes (bool), thresholdDb }.
 * Returns { candidates: [{ t0, t1, raw: {feature: value}, norm: {feature: 0..1}, text, lenFit }], duration, hasTranscript, cuts }.
 */
export async function analyzeMoments(opts = {}, onProgress = () => {}) {
  const { minLen = 15, maxLen = 60, scenes = true, thresholdDb = -40 } = opts;
  const me = current = { cancelled: false };
  try {
    const seq = getState().sequence; const end = sequenceEnd(seq);
    if (end < minLen) throw new Error(`The sequence is shorter than ${minLen} s`);
    onProgress({ stage: 'Reading audio', progress: 0 });
    const pcm = await sequencePCM(seq, 0, end, SR); check(me);
    const nb = Math.ceil(end / STEP); const per = Math.round(SR * STEP);
    const db = new Float32Array(nb);
    for (let k = 0; k < nb; k++) { let s = 0; const i0 = k * per, i1 = Math.min(pcm.length, i0 + per); for (let i = i0; i < i1; i++) s += pcm[i] * pcm[i]; db[k] = 10 * Math.log10(s / Math.max(1, i1 - i0) + 1e-12); }
    const { ranges: quiet } = silentRanges(pcm, SR, 0, { thresholdDb, minSilence: 0.35, padding: 0 });
    const voiced = new Uint8Array(nb).fill(1); for (const [a, b] of quiet) for (let k = Math.floor(a / STEP); k < Math.min(nb, Math.ceil(b / STEP)); k++) voiced[k] = 0;
    // loud bursts: well above the typical level of the voiced parts
    const lv = [...db].filter((_, k) => voiced[k]).sort((a, b) => a - b); const med = lv.length ? lv[Math.floor(lv.length / 2)] : -60; const p90 = lv.length ? lv[Math.floor(lv.length * 0.9)] : -60;
    const loudTh = Math.max(p90, med + 6);
    const words = sequenceWords(seq);
    const speech = new Uint8Array(nb); const kw = new Float32Array(nb);
    for (const w of words) {
      for (let k = Math.floor(w.t0 / STEP); k < Math.min(nb, Math.ceil(w.t1 / STEP)); k++) speech[k] = 1;
      const t = String(w.text).trim(); const k = Math.min(nb - 1, Math.floor(w.t0 / STEP));
      if (HOOKS.test(t)) kw[k] += 1; else if (emojiFor(t) || /\d/.test(t)) kw[k] += 0.5;
      if (/[?!？！]$/.test(t)) kw[k] += 0.7;
    }
    onProgress({ stage: 'Scene changes', progress: 0.3 });
    const cuts = scenes ? await sceneCuts(seq, me, (p) => onProgress({ stage: 'Scene changes', progress: 0.3 + p * 0.6 })) : [];
    check(me);
    // prefix sums for O(1) window features
    const P = (f) => { const p = new Float64Array(nb + 1); for (let k = 0; k < nb; k++) p[k + 1] = p[k] + f(k); return p; };
    const pSpeech = P((k) => (words.length ? speech[k] : voiced[k])), pVoiced = P((k) => voiced[k]), pDb = P((k) => (voiced[k] ? Math.max(-60, db[k]) : 0));
    const pLoud = P((k) => (voiced[k] && db[k] >= loudTh ? 1 : 0)), pKw = P((k) => kw[k]);
    const sum = (p, a, b) => { const i = Math.max(0, Math.min(nb, Math.round(a / STEP))), j = Math.max(0, Math.min(nb, Math.round(b / STEP))); return p[j] - p[i]; };
    // boundaries: sentence starts / ends (transcript), else speech starts / ends, else a 2 s grid
    let starts = [], ends = [];
    if (words.length) {
      words.forEach((w, i) => {
        const prev = words[i - 1], next = words[i + 1];
        if (!prev || w.t0 - prev.t1 > 0.45 || /[.!?。！？]$/.test(String(prev.text).trim())) starts.push(Math.max(0, w.t0 - 0.15));
        if (!next || next.t0 - w.t1 > 0.45 || /[.!?。！？]$/.test(String(w.text).trim())) ends.push(Math.min(end, w.t1 + 0.25));
      });
    } else if (quiet.length) {
      starts = [0, ...quiet.map((r) => r[1])].filter((t) => t < end - minLen); ends = [...quiet.map((r) => r[0]), end].filter((t) => t > minLen);
    }
    if (starts.length < 2) { starts = []; ends = []; for (let t = 0; t <= end; t += 2) { starts.push(t); ends.push(Math.min(end, t + 2)); } }
    const target = (minLen + maxLen) / 2; const cands = [];
    for (const a of starts) for (const b of ends) {
      const len = b - a; if (len < minLen || len > maxLen) continue;
      const v = sum(pVoiced, a, b) * STEP; const cut = cuts.filter((t) => t > a + 0.2 && t < b - 0.2).length;
      const hook = sum(pKw, a, Math.min(b, a + 4)); // a strong first line counts twice
      cands.push({ t0: +a.toFixed(2), t1: +b.toFixed(2), lenFit: 1 - Math.abs(len - target) / Math.max(1, maxLen - minLen),
        raw: { speech: (sum(pSpeech, a, b) * STEP) / len, energy: v > 0 ? sum(pDb, a, b) / (v / STEP) : -60, loud: (sum(pLoud, a, b) * STEP * 60) / len, scenes: Math.min(cut, len * 2) * (10 / len), keywords: ((sum(pKw, a, b) + hook) * 10) / len } });
    }
    // rank-normalise every feature over the candidates so the weights compare like with like
    for (const [f] of FEATURES) {
      const vals = cands.map((c) => c.raw[f]).sort((x, y) => x - y); const n = vals.length;
      const rank = (x) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] < x) lo = m + 1; else hi = m; } let up = lo; while (up < n && vals[up] === x) up++; return n > 1 ? (lo + up - 1) / 2 / (n - 1) : 0.5; };
      const flat = n && vals[0] === vals[n - 1];
      for (const c of cands) (c.norm ||= {})[f] = flat ? (vals[0] > 0 ? 0.5 : 0) : rank(c.raw[f]);
    }
    for (const c of cands) c.text = words.filter((w) => w.t0 >= c.t0 - 0.01 && w.t0 < c.t1).map((w) => w.text).join('').trim();
    onProgress({ stage: '', progress: 1 });
    return { candidates: cands, duration: end, hasTranscript: words.length > 0, cuts };
  } finally { if (current === me) current = null; }
}

/** Score 0..100 of a candidate under some weights. */
export function momentScore(c, weights = DEFAULT_WEIGHTS) {
  let s = 0, w = 0; for (const [f] of FEATURES) { const k = Math.max(0, weights[f] ?? 0); s += k * (c.norm?.[f] ?? 0); w += k; }
  return Math.round(((w ? s / w : 0) * 0.9 + 0.1 * Math.max(0, c.lenFit ?? 0)) * 100);
}
/** The best non-overlapping moments: [{ t0, t1, score, text, ... }], highest score first. */
export function rankMoments(cands, weights = DEFAULT_WEIGHTS, { count = 5, gap = 1 } = {}) {
  const all = cands.map((c) => ({ ...c, score: momentScore(c, weights) })).sort((a, b) => b.score - a.score || a.t0 - b.t0);
  const out = [];
  for (const c of all) { if (out.length >= count) break; if (out.some((o) => c.t0 < o.t1 + gap && c.t1 > o.t0 - gap)) continue; out.push(c); }
  return out;
}
export const momentTitle = (m) => { const t = String(m.text || '').trim(); return t ? (t.length > 40 ? `${t.slice(0, 40)}…` : t) : `Moment at ${Math.floor(m.t0 / 60)}:${String(Math.floor(m.t0 % 60)).padStart(2, '0')}`; };

/** Time after ripple-deleting `ranges` (sorted, non-overlapping) or null when t falls inside one. */
const afterCuts = (t, ranges) => { let d = 0; for (const [a, b] of ranges) { if (t >= b) d += b - a; else if (t > a) return null; } return t - d; };

/**
 * Build one sequence per moment (one undo step adds them all). opts: { aspect ('9:16' | 'source'), reframe, captions,
 * captionPreset, cutSilence, thresholdDb, charsPerLine }. Returns [{ id, name, dur }].
 */
export async function createShorts(moments, opts = {}, onProgress = () => {}) {
  const { aspect = '9:16', reframe = true, captions = true, captionPreset = 'Bold Yellow Highlight', cutSilence = true, thresholdDb = -40, charsPerLine = 16 } = opts;
  if (!moments.length) throw new Error('Choose at least one moment');
  const me = current = { cancelled: false };
  try {
    const src = getState().sequence; const words = sequenceWords(src);
    const ar = ASPECTS.find((a) => a[0] === aspect)?.[1];
    const long = Math.min(1920, Math.max(src.width, src.height));
    const H = ar ? (ar < 1 ? long : Math.round(long / ar)) & ~1 : src.height, W = ar ? Math.round(H * ar) & ~1 : src.width;
    const made = [];
    for (let i = 0; i < moments.length; i++) {
      const m = moments[i]; const step = (p, stage) => onProgress({ stage: `Short ${i + 1}/${moments.length}: ${stage}`, progress: (i + p) / moments.length });
      step(0, 'copying');
      const seq = { ...structuredClone({ ...src, clips: [] }), id: uid(), name: `Short ${i + 1} – ${momentTitle(m)}`, width: W, height: H, markers: [], clips: copyRange(src, m.t0, m.t1) };
      delete seq.inPoint; delete seq.outPoint;
      let cut = [];
      if (cutSilence) {
        step(0.1, 'cutting silence');
        const pcm = await sequencePCM(src, m.t0, m.t1, SR); check(me);
        cut = silentRanges(pcm, SR, 0, { thresholdDb, minSilence: 0.5, padding: 0.12 }).ranges.filter(([a, b]) => b - a > 0.05);
        removeRangesIn(seq, cut);
      }
      if (captions && words.length && !seq.clips.some((c) => c.caption)) { // captions already in the range are kept as they are
        step(0.2, 'captions');
        const ws = []; for (const w of words) { if (w.t1 <= m.t0 || w.t0 >= m.t1) continue; const mid = afterCuts((w.t0 + w.t1) / 2 - m.t0, cut); if (mid == null) continue; const a = afterCuts(Math.max(0, w.t0 - m.t0), cut) ?? mid, b = afterCuts(Math.min(m.t1, w.t1) - m.t0, cut) ?? mid; ws.push({ text: w.text, t0: Math.min(a, mid), t1: Math.max(b, mid + 0.05) }); }
        const segs = segmentWords(ws, { maxChars: charsPerLine * 2, maxDur: 3 });
        if (segs.length) captionsInto(seq, segs, { style: { ...defaultCaptionStyle(), ...(CAPTION_PRESETS[captionPreset] || {}), charsPerLine } });
      }
      if (reframe && ar && Math.abs(ar - src.width / src.height) > 0.01) {
        step(0.3, 'reframing');
        await reframeClips(seq, { rate: 4, isCancelled: () => me.cancelled }, (p) => step(0.3 + 0.7 * (p.progress || 0), `reframing ${p.clip || ''}`)); check(me);
      }
      const dur = sequenceEnd(seq);
      made.push({ seq, dur });
    }
    check(me);
    edit(`Create ${made.length} Short${made.length > 1 ? 's' : ''}`, ({ seqs }) => { for (const { seq } of made) seqs[seq.id] = seq; });
    onProgress({ stage: '', progress: 1 });
    return made.map(({ seq, dur }) => ({ id: seq.id, name: seq.name, dur }));
  } finally { if (current === me) current = null; }
}
