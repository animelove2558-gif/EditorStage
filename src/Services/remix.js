// Remix (Premiere: Essential Sound > Music > Duration > Remix / the Remix Tool): change the length of a piece of music by
// re-editing it at musically matching beats, never by changing its speed or pitch. Pure functions, used by the DSP worker
// (analysis, rendering), the main thread (planning, which is instant once a file is analysed) and the unit tests.
//
//   analyzeMusic(pcm, sr)        -> { bpm, conf, beats (s), feats (per beat), D, downbeat, duration }   [worker, cached per file]
//   planRemix(an, range, target) -> { segments: [{ srcIn, srcOut }], dur, cost, cuts }                [instant]
//   renderRemix(chans, sr, ...)  -> rendered channels (equal-power crossfade at every cut)            [worker]
//
// Analysis: STFT -> log-mel spectral flux (onsets) -> tempo by weighted autocorrelation -> beats by dynamic programming
// (Ellis 2007) -> per-beat chroma + MFCC + loudness. A cut "play to beat i, continue at beat j" costs the feature distance
// of the beats around i and around j, so the music on both sides of the cut sounds like what would have followed.

const N_FFT = 2048, HOP = 512, N_MEL = 40, N_MFCC = 12;
export const REMIX_DEFAULTS = Object.freeze({ segments: 0.5, variations: 0.5, xfade: 30 });
export class NoBeatError extends Error { constructor(msg) { super(msg); this.code = 'nobeat'; } }

// ---------- FFT (radix-2, in place) ----------
function fftTables(n) {
  const rev = new Uint32Array(n); const bits = Math.log2(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  return { rev, cos, sin };
}
function fft(re, im, T) {
  const n = re.length;
  for (let i = 0; i < n; i++) { const j = T.rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let s = 0; s < n; s += size) for (let k = 0; k < half; k++) {
      const wr = T.cos[k * step], wi = T.sin[k * step]; const a = s + k, b = a + half;
      const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
      re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
    }
  }
}
const hz2mel = (f) => 2595 * Math.log10(1 + f / 700), mel2hz = (m) => 700 * (10 ** (m / 2595) - 1);
function melBank(sr) {
  const nb = N_FFT / 2 + 1; const lo = hz2mel(30), hi = hz2mel(Math.min(8000, sr / 2));
  const pts = Array.from({ length: N_MEL + 2 }, (_, i) => (mel2hz(lo + ((hi - lo) * i) / (N_MEL + 1)) * N_FFT) / sr);
  // sparse triangles: { k0, w } with weights for bins k0 .. k0 + w.length - 1
  return Array.from({ length: N_MEL }, (_, m) => { const k0 = Math.max(0, Math.floor(pts[m])), k1 = Math.min(nb - 1, Math.ceil(pts[m + 2])); const w = new Float32Array(Math.max(1, k1 - k0 + 1)); for (let k = k0; k <= k1; k++) { const a = (k - pts[m]) / (pts[m + 1] - pts[m] || 1), b = (pts[m + 2] - k) / (pts[m + 2] - pts[m + 1] || 1); w[k - k0] = Math.max(0, Math.min(a, b)); } return { k0, w }; });
}

/**
 * Beat and feature analysis of mono PCM. Throws NoBeatError when the audio has no steady beat (speech, sound effects,
 * too short). progress(0..1) is called while it works.
 */
export function analyzeMusic(pcm, sr, progress = () => {}) {
  const duration = pcm.length / sr;
  if (duration < 8) throw new NoBeatError('The clip is too short to remix (at least 8 seconds of music are needed)');
  const nF = Math.max(0, Math.floor((pcm.length - N_FFT) / HOP) + 1); const nb = N_FFT / 2 + 1;
  const T = fftTables(N_FFT); const win = new Float64Array(N_FFT).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT));
  const bank = melBank(sr);
  // chroma bin of every FFT bin (55 Hz .. 4 kHz), -1 outside
  const pc = new Int8Array(nb).fill(-1); for (let k = 1; k < nb; k++) { const f = (k * sr) / N_FFT; if (f >= 55 && f <= 4000) pc[k] = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12) % 12; }
  const logmel = new Float32Array(nF * N_MEL), chroma = new Float32Array(nF * 12), rms = new Float32Array(nF);
  const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT), mag = new Float64Array(nb);
  for (let f = 0; f < nF; f++) {
    const o = f * HOP; let e = 0;
    for (let i = 0; i < N_FFT; i++) { const v = pcm[o + i]; re[i] = v * win[i]; im[i] = 0; e += v * v; }
    rms[f] = Math.sqrt(e / N_FFT);
    fft(re, im, T);
    for (let k = 0; k < nb; k++) mag[k] = Math.hypot(re[k], im[k]);
    for (let m = 0; m < N_MEL; m++) { const { k0, w } = bank[m]; let s = 0; for (let k = 0; k < w.length; k++) { const v = mag[k0 + k]; s += w[k] * v * v; } logmel[f * N_MEL + m] = Math.log10(1e-10 + s); }
    for (let k = 0; k < nb; k++) if (pc[k] >= 0) chroma[f * 12 + pc[k]] += mag[k];
    if ((f & 255) === 0) progress((0.7 * f) / nF);
  }
  // onset strength: positive log-mel flux, minus its local mean, normalised
  const env = new Float64Array(nF);
  // low bands (kick / bass, below ~150 Hz): used below to tell the beat from the off-beat
  const bandW = Float64Array.from({ length: N_MEL }, (_, m) => (mel2hz(hz2mel(30) + ((hz2mel(Math.min(8000, sr / 2)) - hz2mel(30)) * (m + 1)) / (N_MEL + 1)) < 150 ? 4 : 1));
  for (let f = 1; f < nF; f++) { let s = 0; for (let m = 0; m < N_MEL; m++) { const d = logmel[f * N_MEL + m] - logmel[(f - 1) * N_MEL + m]; if (d > 0) s += d; } env[f] = s; }
  const half = Math.round((0.25 * sr) / HOP); const loc = new Float64Array(nF); { let acc = 0; for (let f = 0; f < nF + half; f++) { if (f < nF) acc += env[f]; if (f - 2 * half - 1 >= 0) acc -= env[f - 2 * half - 1]; const c = f - half; if (c >= 0 && c < nF) loc[c] = acc / (Math.min(nF - 1, c + half) - Math.max(0, c - half) + 1); } }
  for (let f = 0; f < nF; f++) env[f] = Math.max(0, env[f] - loc[f]);
  let mean = 0, sd = 0; for (const v of env) mean += v; mean /= nF || 1; for (const v of env) sd += (v - mean) ** 2; sd = Math.sqrt(sd / (nF || 1)) || 1;
  for (let f = 0; f < nF; f++) env[f] /= sd;
  // tempo: autocorrelation of the onset envelope, weighted towards 120 BPM (log-Gaussian, ~1 octave)
  const fr = sr / HOP; const lagMin = Math.floor((60 / 210) * fr), lagMax = Math.ceil((60 / 50) * fr);
  const ac = new Float64Array(lagMax + 2); for (let L = 0; L <= lagMax + 1; L++) { let s = 0; for (let f = L; f < nF; f++) s += env[f] * env[f - L]; ac[L] = s / (nF - L || 1); }
  let best = -1, bestL = lagMin;
  for (let L = lagMin; L <= lagMax; L++) { const bpm = (60 * fr) / L; const w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 1) ** 2); const v = w * ac[L]; if (v > best) { best = v; bestL = L; } }
  const a0 = ac[bestL - 1], a1 = ac[bestL], a2 = ac[bestL + 1]; const den = a0 - 2 * a1 + a2; const P = bestL + (den < 0 ? (0.5 * (a0 - a2)) / den : 0);
  // pulse clarity: the tempo peak against the autocorrelation around it (steady music ≫ 1, effects / speech ≈ 1)
  let floor = 0, cnt = 0; for (let L = lagMin; L <= lagMax; L++) if (Math.abs(L - bestL) > 2 && Math.abs(L - 2 * bestL) > 2 && Math.abs(2 * L - bestL) > 2) { floor += ac[L]; cnt++; }
  floor = cnt ? floor / cnt : 0; const conf = ac[0] > 0 ? (a1 - floor) / ac[0] : 0;
  const bpm = (60 * fr) / P;
  progress(0.75);
  // beats: dynamic programming over the onset envelope with the tempo as prior
  const alpha = 100; const score = new Float64Array(nF), back = new Int32Array(nF).fill(-1);
  for (let f = 0; f < nF; f++) {
    let bv = 0, bp = -1; const lo = Math.max(0, Math.round(f - 2 * P)), hi = Math.round(f - P / 2);
    for (let p = lo; p <= hi; p++) { const v = score[p] - alpha * Math.log((f - p) / P) ** 2; if (bp < 0 || v > bv) { bv = v; bp = p; } }
    score[f] = env[f] + (bp >= 0 ? bv : 0); back[f] = bp;
  }
  let end = Math.max(0, nF - Math.round(P)); for (let f = end; f < nF; f++) if (score[f] > score[end]) end = f;
  let frames = []; for (let f = end; f >= 0; f = back[f]) frames.push(f); frames.reverse();
  // on the beat or half a beat off? Kick / bass onsets (low bands) decide: the tracker can lock to off-beat hats
  const lowOn = (f) => { let v = 0; for (let g = Math.max(1, f - 2); g <= Math.min(nF - 1, f + 2); g++) { let d = 0; for (let m = 0; m < N_MEL; m++) if (bandW[m] > 1) d += Math.max(0, logmel[g * N_MEL + m] - logmel[(g - 1) * N_MEL + m]); v = Math.max(v, d); } return v; };
  const offs = frames.map((f) => Math.round(f + P / 2)).filter((f) => f < nF);
  const lowMean = (a) => a.reduce((x, f) => x + lowOn(f), 0) / (a.length || 1);
  if (lowMean(offs) > 1.2 * lowMean(frames)) frames = offs;
  const beats = Float64Array.from(frames, (f) => (f * HOP + N_FFT / 2) / sr);
  // steadiness: the tempo of every 8 s window agrees with the song's (or is its half / double), and onsets fall on the beats
  const wl = Math.round(8 * fr); let agree = 0, wins = 0;
  for (let w0 = 0; w0 + wl <= nF; w0 += Math.round(wl / 2)) {
    let bv = -Infinity, bl = lagMin;
    for (let L = lagMin; L <= lagMax; L++) { let s2 = 0; for (let f = w0 + L; f < w0 + wl; f++) s2 += env[f] * env[f - L]; const bp = (60 * fr) / L; const v = Math.exp(-0.5 * (Math.log2(bp / 120) / 1) ** 2) * s2; if (v > bv) { bv = v; bl = L; } }
    wins++; if ([1, 2, 0.5].some((k) => Math.abs(bl - P * k) <= Math.max(1, 0.04 * P * k))) agree++;
  }
  const steady = wins ? agree / wins : 0;
  let on = 0, all = 0; for (const f of frames) on += env[f]; for (const v of env) all += v; const pulse = frames.length && all ? (on / frames.length) / (all / nF) : 0;
  const info = { bpm, conf, steady, pulse, beats: beats.length };
  // measured on music (pulse 6..9, steady 0.7..0.95) against sound effects (pulse 3..4.9): see docs/PROGRESS.md Phase 7C
  if (beats.length < 16 || !(bpm >= 50 && bpm <= 220) || pulse < 5.5 || steady < 0.6 || conf < 0.04) throw Object.assign(new NoBeatError('No steady musical beat found in this audio — Remix needs music with a beat'), { info });
  progress(0.85);
  // per-beat features: chroma (L2-normalised), MFCC 1..12 (z-scored over the song), loudness (dB)
  const nB = beats.length; const D = 12 + N_MFCC + 1; const feats = new Float32Array(nB * D);
  const dct = Array.from({ length: N_MFCC }, (_, k) => Float64Array.from({ length: N_MEL }, (_, m) => Math.cos((Math.PI * (k + 1) * (m + 0.5)) / N_MEL)));
  for (let b = 0; b < nB; b++) {
    const f0 = frames[b], f1 = b + 1 < nB ? frames[b + 1] : Math.min(nF, f0 + Math.round(P)); const n = Math.max(1, f1 - f0); const o = b * D;
    for (let f = f0; f < f0 + n && f < nF; f++) {
      for (let c = 0; c < 12; c++) feats[o + c] += chroma[f * 12 + c];
      for (let k = 0; k < N_MFCC; k++) { let s = 0; for (let m = 0; m < N_MEL; m++) s += dct[k][m] * logmel[f * N_MEL + m]; feats[o + 12 + k] += s / n; }
      feats[o + D - 1] += (rms[f] * rms[f]) / n;
    }
    let nn = 0; for (let c = 0; c < 12; c++) nn += feats[o + c] ** 2; nn = Math.sqrt(nn) || 1; for (let c = 0; c < 12; c++) feats[o + c] /= nn;
    feats[o + D - 1] = 10 * Math.log10(1e-10 + feats[o + D - 1]);
  }
  for (let k = 0; k < N_MFCC; k++) { let m = 0, s = 0; for (let b = 0; b < nB; b++) m += feats[b * D + 12 + k]; m /= nB; for (let b = 0; b < nB; b++) s += (feats[b * D + 12 + k] - m) ** 2; s = Math.sqrt(s / nB) || 1; for (let b = 0; b < nB; b++) feats[b * D + 12 + k] = (feats[b * D + 12 + k] - m) / s; }
  // downbeat phase (4/4): the beat of the bar where harmony changes most and onsets are strongest
  let downbeat = 0, dbBest = -Infinity;
  for (let ph = 0; ph < 4; ph++) { let s = 0, n = 0; for (let b = ph; b < nB; b += 4) { s += env[frames[b]] + (b > 0 ? 2 * beatDist(feats, D, b - 1, b) : 0); n++; } if (n && s / n > dbBest) { dbBest = s / n; downbeat = ph; } }
  progress(1);
  return { version: 1, sr, bpm, conf, info, duration, beats, feats, D, downbeat };
}

/** Distance between two beats (0 = identical): chroma cosine distance + timbre + loudness */
export function beatDist(feats, D, a, b) {
  const oa = a * D, ob = b * D; let dot = 0, tim = 0;
  for (let c = 0; c < 12; c++) dot += feats[oa + c] * feats[ob + c];
  for (let k = 12; k < D - 1; k++) tim += (feats[oa + k] - feats[ob + k]) ** 2;
  return (1 - dot) + 0.5 * Math.sqrt(tim / (D - 13)) + 0.3 * Math.min(2, Math.abs(feats[oa + D - 1] - feats[ob + D - 1]) / 6);
}
/** Cost of the cut "play until beat i, continue at beat j": the 4 beats before and after the cut must sound alike. */
export function jumpCost(an, i, j) {
  const n = an.beats.length; const W = 4; let s = 0, c = 0;
  for (let k = 0; k < W; k++) {
    if (i + k < n && j + k < n) { s += beatDist(an.feats, an.D, i + k, j + k); c++; }
    if (i - 1 - k >= 0 && j - 1 - k >= 0) { s += beatDist(an.feats, an.D, i - 1 - k, j - 1 - k); c++; }
  }
  const bar = ((i - j) % 4 + 4) % 4 === 0 ? 0 : 0.6; // keep the bar structure: cut between the same beats of a bar
  return (c ? s / c : 2) + bar;
}

/**
 * Plan a remix of the source range [r0, r1] (seconds of the analysed file) to about `target` seconds. The intro (first
 * two bars) and the ending (last two bars) are always kept; cuts sit on beats. params: { segments 0..1 (short ↔ long
 * segments), variations 0..1 (repeat the same section ↔ vary) }. Returns { segments, dur, cost, cuts: [clip-local times] }.
 */
export function planRemix(an, range, target, params = {}) {
  const p = { ...REMIX_DEFAULTS, ...params }; const [r0, r1] = range; const S = r1 - r0;
  const bt = an.beats; const idx = []; for (let k = 0; k < bt.length; k++) if (bt[k] > r0 + 0.05 && bt[k] < r1 - 0.05) idx.push(k);
  const period = 60 / an.bpm; const single = { segments: [{ srcIn: r0, srcOut: r1 }], dur: S, cost: 0, cuts: [] };
  if (Math.abs(target - S) < period / 2 || idx.length < 24) {
    if (Math.abs(target - S) >= period / 2) throw new NoBeatError('The music in this clip is too short to remix');
    return single;
  }
  const keep = 8; const lo = idx[keep], hi = idx[idx.length - 1 - keep]; // middle beats where cuts may go
  const t = (k) => bt[k];
  const build = (jumps) => { // jumps: [{ from: beat, to: beat }] in playing order
    const segs = []; let pos = r0; for (const j of jumps) { segs.push({ srcIn: pos, srcOut: t(j.from) }); pos = t(j.to); } segs.push({ srcIn: pos, srcOut: r1 });
    let u = 0; const cuts = []; for (let k = 0; k < segs.length - 1; k++) { u += segs[k].srcOut - segs[k].srcIn; cuts.push(u); }
    return { segments: segs, dur: u + segs[segs.length - 1].srcOut - segs[segs.length - 1].srcIn, cost: jumps.reduce((a, j) => a + j.cost, 0) / Math.max(1, jumps.length), cuts };
  };
  // the best cut that moves `want` seconds (forward skip > 0, backward loop < 0) with both beats inside [a, b]
  const bestJump = (want, a, b, avoid = []) => {
    let best = null;
    for (let i = a; i <= b; i++) {
      // j near t(i) + want: scan the beats whose distance is within one beat of the wanted length
      let j0 = i; while (j0 > a && t(j0) > t(i) + want - period) j0--; while (j0 < b && t(j0) < t(i) + want - period) j0++;
      for (let j = j0; j <= b && t(j) <= t(i) + want + period; j++) {
        if (j === i || t(j) < t(i) + want - period || avoid.some((x) => Math.abs(x - i) < 4 || Math.abs(x - j) < 4)) continue; // within one beat of the wanted length
        const len = t(j) - t(i); const err = Math.abs(len - want) / period;
        const c = jumpCost(an, i, j) + 0.25 * err;
        if (!best || c < best.cost) best = { from: i, to: j, cost: c, len };
      }
    }
    return best;
  };
  const diff = target - S; let plan = null;
  if (diff < 0) {
    // shorten: skip the middle once, or in two smaller skips when shorter segments are preferred
    const skip = -diff; if (t(hi) - t(lo) < skip - period) throw new NoBeatError('The target is shorter than the intro and ending of this music');
    const one = bestJump(skip, lo, hi); const cands = one ? [build([one])] : [];
    if (p.segments < 0.5 && t(hi) - t(lo) > skip + 8 * period) {
      const mid = Math.round((lo + hi) / 2); const a = bestJump(skip / 2, lo, mid);
      if (a) { const b = bestJump(skip - (t(a.to) - t(a.from)), Math.max(a.to + 4, mid), hi); if (b) cands.push({ ...build([a, b]), cost: (a.cost + b.cost) / 2 + 0.15 * (0.5 - p.segments) }); }
    }
    plan = cands.sort((x, y) => x.cost + Math.abs(x.dur - target) / period * 0.2 - (y.cost + Math.abs(y.dur - target) / period * 0.2))[0];
  } else {
    // lengthen: loop back k times; longer segments allow longer loops (fewer cuts)
    const room = t(hi) - t(lo); const maxLoop = Math.min(room - 2 * period, 16 + 44 * p.segments);
    if (maxLoop < 4 * period) throw new NoBeatError('The music in this clip is too short to loop');
    const k = Math.max(1, Math.ceil(diff / maxLoop)); const each = diff / k;
    if (p.variations < 0.5 || k === 1) {
      const j = bestJump(-each, lo, hi); if (!j) throw new NoBeatError('No loop point found in this music');
      plan = build(Array.from({ length: k }, () => j));
    } else {
      // vary: k different loops (sorted by where they start), each one played once
      const picks = []; let rest = diff;
      for (let m = 0; m < k; m++) { const want = rest / (k - m); const j = bestJump(-want, lo, hi, picks.flatMap((x) => [x.from, x.to])); if (!j) break; picks.push(j); rest -= t(j.from) - t(j.to); }
      if (picks.length < k) { const j = bestJump(-each, lo, hi); plan = build(Array.from({ length: k }, () => j)); }
      else { picks.sort((a, b) => a.from - b.from); plan = build(picks); }
    }
  }
  if (!plan) throw new NoBeatError('No good cut found in this music');
  return plan;
}

/**
 * Render a remix: `chans` (source channels at `sr`, sample 0 = time `srcOffset` of the file) played through the segments,
 * with an equal-power crossfade of `xfade` seconds centred on every cut. Output sample 0 is clip-local time -pre; n samples.
 * Before the first segment / after the last one the source simply continues (transition handles).
 */
export function renderRemix(chans, sr, segments, xfade, pre, n, srcOffset = 0) {
  const out = chans.map(() => new Float32Array(n)); const h = Math.max(1, Math.round((xfade * sr) / 2));
  const U = [0]; for (const s of segments) U.push(U[U.length - 1] + (s.srcOut - s.srcIn));
  const last = segments.length - 1;
  for (let m = 0; m <= last; m++) {
    const seg = segments[m]; const a = Math.round((U[m] + pre) * sr), b = Math.round((U[m + 1] + pre) * sr);
    const from = m === 0 ? 0 : a - h, to = m === last ? n : b + h;
    const src0 = (seg.srcIn - srcOffset) * sr - a; // source sample = k + src0
    for (let ci = 0; ci < chans.length; ci++) {
      const s = chans[ci], o = out[ci];
      for (let k = Math.max(0, from); k < Math.min(n, to); k++) {
        const j = Math.round(k + src0); if (j < 0 || j >= s.length) continue;
        let g = 1;
        if (m > 0 && k < a + h) g *= Math.sin((Math.PI / 2) * ((k - (a - h)) / (2 * h)));
        if (m < last && k > b - h) g *= Math.cos((Math.PI / 2) * ((k - (b - h)) / (2 * h)));
        o[k] += s[j] * g;
      }
    }
  }
  return out;
}

/** Interchange (XML / FCPXML / EDL): a remixed clip becomes one clip per segment, with short crossfades at the cuts. */
export function expandRemix(seq) {
  if (!seq.clips.some((c) => c.remix?.segments?.length > 1)) return seq;
  const clips = [], transitions = [...(seq.transitions || [])];
  for (const c of seq.clips) {
    if (!(c.remix?.segments?.length > 1)) { clips.push(c); continue; }
    let u = c.start; let prev = null;
    c.remix.segments.forEach((s, k) => {
      const id = `${c.id}_r${k}`; const dur = s.srcOut - s.srcIn; const { remix, ...rest } = c;
      clips.push({ ...rest, id, start: u, dur, inPoint: s.srcIn });
      if (prev) transitions.push({ id: `${id}_x`, track: c.track, kind: 'audio', aId: prev, bId: id, at: u, dur: Math.max(1 / (seq.fps || 30), (c.remix.params?.xfade ?? REMIX_DEFAULTS.xfade) / 1000), name: 'Constant Power' });
      prev = id; u += dur;
    });
  }
  return { ...seq, clips, transitions };
}

// ---------- serialisation (cache files) ----------
export const analysisToJson = (an) => ({ ...an, beats: Array.from(an.beats), feats: Array.from(an.feats, (v) => +v.toFixed(4)) });
export const analysisFromJson = (j) => ({ ...j, beats: Float64Array.from(j.beats), feats: Float32Array.from(j.feats) });

/** Source time heard at clip-local time u of a remix (cuts are hard here; the crossfades are only in the rendered audio). */
export function remixSourceAt(segments, u) {
  let a = 0;
  for (let k = 0; k < segments.length; k++) { const s = segments[k]; const len = s.srcOut - s.srcIn; if (u < a + len || k === segments.length - 1) return s.srcIn + Math.max(0, u - a); a += len; }
  return segments[0]?.srcIn ?? 0;
}
