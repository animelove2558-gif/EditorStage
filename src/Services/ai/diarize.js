// Speaker Diarization: find who speaks when (voice activity + MFCC/pitch voice prints + clustering) and split the
// selected audio clip(s) into one audio track per speaker. Runs locally, no model download. It is a signal-processing
// approach: works well for clearly different voices (e.g. male/female, different mics); similar voices may merge.
import { edit, getState } from '../../Core/store';
import { trimHead } from '../../Core/clipTime';
import * as ed from '../../Core/editing';
import { sequencePCM, audioClipsOf } from './audioSource';

const SR = 16000, WIN = 512, HOP = 256, NMEL = 26, NCEP = 13;

// ---------------------------------------------------------------- DSP
function fft(re, im) { // in-place radix-2
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
const mel = (f) => 2595 * Math.log10(1 + f / 700), imel = (m) => 700 * (10 ** (m / 2595) - 1);
const FB = (() => { // mel filterbank 80..7600 Hz
  const lo = mel(80), hi = mel(7600), pts = Array.from({ length: NMEL + 2 }, (_, i) => Math.floor(((imel(lo + ((hi - lo) * i) / (NMEL + 1))) * WIN) / SR));
  return Array.from({ length: NMEL }, (_, m) => { const f = new Float32Array(WIN / 2 + 1); for (let k = pts[m]; k < pts[m + 1]; k++) f[k] = (k - pts[m]) / Math.max(1, pts[m + 1] - pts[m]); for (let k = pts[m + 1]; k < pts[m + 2]; k++) f[k] = (pts[m + 2] - k) / Math.max(1, pts[m + 2] - pts[m + 1]); return f; });
})();
const HANN = Float32Array.from({ length: WIN }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1)));
/** per-frame features: [13 MFCC (c1..c13), log energy, pitch (Hz, 0 = unvoiced)] */
function frames(pcm) {
  const n = Math.floor((pcm.length - WIN) / HOP) + 1; const out = [];
  const re = new Float32Array(WIN), im = new Float32Array(WIN), lm = new Float32Array(NMEL);
  for (let f = 0; f < n; f++) {
    const o = f * HOP; let e = 0;
    for (let i = 0; i < WIN; i++) { const v = (pcm[o + i] - (i ? 0.97 * pcm[o + i - 1] : 0)) * HANN[i]; re[i] = v; im[i] = 0; e += pcm[o + i] * pcm[o + i]; }
    fft(re, im);
    for (let m = 0; m < NMEL; m++) { let s = 0; const fb = FB[m]; for (let k = 0; k <= WIN / 2; k++) if (fb[k]) s += fb[k] * (re[k] * re[k] + im[k] * im[k]); lm[m] = Math.log(s + 1e-10); }
    const c = new Float32Array(NCEP + 2);
    for (let k = 1; k <= NCEP; k++) { let s = 0; for (let m = 0; m < NMEL; m++) s += lm[m] * Math.cos((Math.PI * k * (m + 0.5)) / NMEL); c[k - 1] = s; }
    c[NCEP] = 10 * Math.log10(e / WIN + 1e-12);
    // pitch by autocorrelation (70..400 Hz)
    let best = 0, lag = 0; const e0 = e || 1e-9;
    for (let L = Math.floor(SR / 400); L <= Math.floor(SR / 70); L++) { let s = 0; for (let i = 0; i + L < WIN; i += 2) s += pcm[o + i] * pcm[o + i + L]; const r = s / e0 * 2; if (r > best) { best = r; lag = L; } }
    c[NCEP + 1] = best > 0.35 && lag ? SR / lag : 0;
    out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------- clustering
const cos = (a, b) => { let s = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return s / Math.sqrt(na * nb + 1e-12); };
function kmeans(X, k, iters = 30) {
  // farthest-point init (deterministic)
  const C = [X[0].slice()]; while (C.length < k) { let bi = 0, bd = -1; X.forEach((x, i) => { const d = Math.min(...C.map((c) => 1 - cos(x, c))); if (d > bd) { bd = d; bi = i; } }); C.push(X[bi].slice()); }
  let lab = new Array(X.length).fill(0);
  for (let it = 0; it < iters; it++) {
    lab = X.map((x) => { let b = 0, bs = -2; C.forEach((c, j) => { const s = cos(x, c); if (s > bs) { bs = s; b = j; } }); return b; });
    for (let j = 0; j < k; j++) { const m = X.filter((_, i) => lab[i] === j); if (!m.length) continue; C[j] = m[0].map((_, d) => m.reduce((s, v) => s + v[d], 0) / m.length); }
  }
  return lab;
}
function silhouette(X, lab, k) {
  if (k < 2) return 0; let tot = 0;
  for (let i = 0; i < X.length; i++) {
    const ds = Array.from({ length: k }, () => [0, 0]);
    for (let j = 0; j < X.length; j++) if (i !== j) { const d = 1 - cos(X[i], X[j]); ds[lab[j]][0] += d; ds[lab[j]][1]++; }
    const a = ds[lab[i]][1] ? ds[lab[i]][0] / ds[lab[i]][1] : 0; const b = Math.min(...ds.map((d, j) => (j === lab[i] || !d[1] ? Infinity : d[0] / d[1])));
    tot += b === Infinity ? 0 : (b - a) / Math.max(a, b, 1e-9);
  }
  return tot / X.length;
}

/**
 * Who speaks when. opts: { ids (clip ids), speakers: 0 = auto (1..6) or a fixed count, thresholdDb }
 * Returns { segments:[{t0,t1,speaker}], speakers, span }.
 */
export async function diarize(opts = {}) {
  const { ids = null, speakers = 0, thresholdDb = -42 } = opts;
  const seq = getState().sequence; const clips = audioClipsOf(seq, ids); if (!clips.length) throw new Error('Select audio clips to analyse');
  const a = Math.min(...clips.map((c) => c.start)), b = Math.max(...clips.map((c) => c.start + c.dur));
  const pcm = await sequencePCM(seq, a, b, SR, clips.map((c) => c.id));
  const F = frames(pcm); const fps = SR / HOP;
  // voice activity: energy above threshold (relative to the loudest part) with hangover
  const maxE = Math.max(...F.map((f) => f[NCEP])); const thr = Math.max(thresholdDb, maxE - 45);
  const voiced = F.map((f) => f[NCEP] > thr);
  for (let i = 0, run = 0; i < voiced.length; i++) { if (voiced[i]) run = 10; else if (run-- > 0) voiced[i] = true; }
  // 1.0 s windows (0.5 s hop) over speech -> voice print = mean+std of MFCC, mean log-pitch
  const W = Math.round(fps * 1.0), S = Math.round(fps * 0.5); const wins = [];
  for (let s = 0; s + W <= F.length; s += S) {
    const fr = []; for (let i = s; i < s + W; i++) if (voiced[i]) fr.push(F[i]); if (fr.length < W * 0.5) continue;
    const v = []; for (let d = 0; d < NCEP; d++) { const m = fr.reduce((x, f) => x + f[d], 0) / fr.length; v.push(m); }
    for (let d = 0; d < NCEP; d++) { const m = v[d]; v.push(Math.sqrt(fr.reduce((x, f) => x + (f[d] - m) ** 2, 0) / fr.length)); }
    const pv = fr.map((f) => f[NCEP + 1]).filter((p) => p > 0); const lp = pv.length ? Math.log(pv.sort((x, y) => x - y)[pv.length >> 1]) : Math.log(150);
    v.push(lp * 12); wins.push({ s, e: s + W, v });
  }
  if (!wins.length) return { segments: [], speakers: 0, span: [a, b] };
  // standardise each dimension so loudness/mic colour do not dominate
  const D = wins[0].v.length; const mu = Array(D).fill(0), sd = Array(D).fill(0);
  for (const w of wins) w.v.forEach((x, d) => { mu[d] += x / wins.length; });
  for (const w of wins) w.v.forEach((x, d) => { sd[d] += (x - mu[d]) ** 2 / wins.length; });
  const X = wins.map((w) => w.v.map((x, d) => (x - mu[d]) / Math.sqrt(sd[d] + 1e-9)));
  let k = speakers, lab;
  if (k > 0) lab = kmeans(X, Math.min(k, X.length));
  else {
    let best = { k: 1, s: 0.12, lab: new Array(X.length).fill(0) }; // need a clear structure to claim >1 speaker
    for (let kk = 2; kk <= Math.min(6, X.length); kk++) { const l = kmeans(X, kk); const s = silhouette(X, l, kk); if (s > best.s + 0.02) best = { k: kk, s, lab: l }; }
    k = best.k; lab = best.lab;
  }
  // smooth labels (majority over 5 windows), then per-frame labels -> segments
  const sm = lab.map((_, i) => { const cnt = {}; for (let j = Math.max(0, i - 2); j <= Math.min(lab.length - 1, i + 2); j++) cnt[lab[j]] = (cnt[lab[j]] || 0) + 1; return +Object.entries(cnt).sort((x, y) => y[1] - x[1])[0][0]; });
  const fl = new Int16Array(F.length).fill(-1);
  wins.forEach((w, i) => { for (let f = w.s; f < w.e; f++) if (voiced[f] && (fl[f] < 0 || f >= w.s + S / 2)) fl[f] = sm[i]; });
  for (let f = 0; f < F.length; f++) if (voiced[f] && fl[f] < 0) fl[f] = f ? fl[f - 1] : -1;
  const segs = []; let cur = null;
  for (let f = 0; f <= F.length; f++) {
    const l = f < F.length ? fl[f] : -1;
    if (cur && (l !== cur.speaker)) { if ((f - cur.f0) / fps >= 0.25) segs.push({ t0: a + (cur.f0 * HOP) / SR, t1: a + (f * HOP + WIN) / SR, speaker: cur.speaker }); cur = null; }
    if (!cur && l >= 0) cur = { f0: f, speaker: l };
  }
  // renumber speakers by first appearance
  const order = []; for (const s of segs) if (!order.includes(s.speaker)) order.push(s.speaker);
  for (const s of segs) s.speaker = order.indexOf(s.speaker);
  return { segments: segs, speakers: order.length, span: [a, b] };
}

const uid = () => Math.random().toString(36).slice(2, 9);
/** Split the analysed clips onto one new audio track per speaker (pieces keep their source sync). One undo step. */
export function splitBySpeaker(result, { ids = null, keepOriginal = false } = {}) {
  if (!result.segments.length) return 0;
  edit('Separate Speakers', ({ seq, sel }) => {
    const src = audioClipsOf(seq, ids);
    const tracks = []; for (let s = 0; s < result.speakers; s++) {
      let n = seq.tracks.filter((t) => t.kind === 'audio').length + 1; while (seq.tracks.some((t) => t.id === `A${n}`)) n++;
      const t = { id: `A${n}`, kind: 'audio', muted: false, solo: false, locked: false, sync: true, name: `Speaker ${s + 1}` }; seq.tracks.push(t); tracks.push(t.id);
    }
    const made = [];
    for (const c of src) for (const g of result.segments) {
      const a = Math.max(c.start, g.t0), b = Math.min(c.start + c.dur, g.t1); if (b - a < 0.05) continue;
      const piece = trimHead({ ...structuredClone(c), id: uid(), track: tracks[g.speaker], start: a, dur: b - a, linkId: undefined, name: `Speaker ${g.speaker + 1}` }, a - c.start);
      seq.clips.push(piece); made.push(piece.id);
    }
    if (keepOriginal) for (const c of seq.clips) { if (src.some((x) => x.id === c.id)) c.enabled = false; }
    else { const del = new Set(src.map((c) => c.id)); seq.clips = seq.clips.filter((c) => !del.has(c.id)); for (const c of seq.clips) if (c.linkId && src.some((x) => x.linkId === c.linkId)) c.noAudio = true; }
    ed.fixTransitions(seq); sel.splice(0, sel.length, ...made);
  });
  return result.speakers;
}
