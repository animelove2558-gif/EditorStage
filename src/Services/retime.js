// Retimed audio rendering (pure DSP, runs in the dsp worker and in Node tests).
// The caller gives source positions (seconds) at a control rate; every output sample's source position is interpolated
// from them, so reverse, constant speed and speed ramps all come from the shared clip time model (Core/clipTime.js).
//   maintainPitch = false: varispeed (resampling, pitch follows speed, like tape) with a box anti-alias filter when fast
//   maintainPitch = true : WSOLA time-scale modification (pitch kept, Premiere's "Maintain Audio Pitch")

/** Source sample position (fractional, in input samples) of every output sample. */
function positions(ctl, step, n, sr) {
  const pos = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.floor(i / step); const a = ctl[Math.min(k, ctl.length - 1)], b = ctl[Math.min(k + 1, ctl.length - 1)];
    pos[i] = (a + (b - a) * ((i - k * step) / step)) * sr;
  }
  return pos;
}
const sampleAt = (x, p) => { const i = Math.floor(p); if (i < 0 || i + 1 >= x.length) return i === x.length - 1 ? x[i] : 0; const f = p - i; return x[i] + (x[i + 1] - x[i]) * f; };
/** Mean of x over [a, b) (fractional sample positions, any order): a box filter that removes most aliasing when reading fast. */
function boxMean(x, prefix, a, b) {
  if (a > b) [a, b] = [b, a];
  const lo = Math.max(0, a), hi = Math.min(x.length - 1, b); if (hi <= lo) return 0;
  const P = (p) => { const i = Math.floor(p), f = p - i; return prefix[i] + (prefix[Math.min(i + 1, x.length)] - prefix[i]) * f; };
  return (P(hi) - P(lo)) / (b - a);
}

function varispeed(chans, pos) {
  const n = pos.length;
  return chans.map((x) => {
    const out = new Float32Array(n); let prefix = null;
    for (let i = 0; i < n; i++) {
      const d = i ? Math.abs(pos[i] - pos[i - 1]) : (n > 1 ? Math.abs(pos[1] - pos[0]) : 1);
      if (d > 1.5) { // reading faster than 1.5x: average the samples skipped over
        if (!prefix) { prefix = new Float64Array(x.length + 1); for (let j = 0; j < x.length; j++) prefix[j + 1] = prefix[j] + x[j]; }
        out[i] = boxMean(x, prefix, pos[i] - d / 2, pos[i] + d / 2);
      } else out[i] = sampleAt(x, pos[i]);
    }
    return out;
  });
}

function wsola(chans, pos) {
  const n = pos.length; const N = 1024, H = N / 2, TOL = 256;
  const win = new Float32Array(N); for (let j = 0; j < N; j++) win[j] = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / N);
  const outs = chans.map(() => new Float32Array(n + N)); const norm = new Float32Array(n + N);
  const mono = chans.length > 1 ? chans[0].map((v, i) => (v + chans[1][i]) * 0.5) : chans[0];
  const len = mono.length;
  const read = (x, c, dir, j) => { const p = c + dir * (j - N / 2); return p >= 0 && p < len ? x[p] : 0; };
  let prevC = null, prevDir = 1;
  for (let o = -H; o < n; o += H) { // frame k covers output [o, o+N)
    const mid = Math.min(n - 1, Math.max(0, o + N / 2));
    const want = Math.round(pos[mid]);
    const nxt = Math.min(n - 1, Math.max(0, mid + 1)); const dir = pos[nxt] < pos[mid] - 1e-9 ? -1 : pos[nxt] > pos[mid] + 1e-9 ? 1 : prevDir;
    let best = want;
    if (prevC != null) {
      // natural continuation of the previous frame, compared on its overlapping half (every 4th sample is enough)
      const nat = prevC + prevDir * H; let bestScore = -Infinity;
      for (let off = -TOL; off <= TOL; off += 2) {
        const c = want + off; let sc = 0, e = 1e-9;
        for (let j = 0; j < H; j += 4) { const a = read(mono, c, dir, j), b = read(mono, nat, prevDir, j); sc += a * b; e += a * a; }
        sc /= Math.sqrt(e); if (sc > bestScore) { bestScore = sc; best = c; }
      }
    }
    for (let ch = 0; ch < chans.length; ch++) { const x = chans[ch], y = outs[ch]; for (let j = 0; j < N; j++) { const oi = o + j; if (oi >= 0 && oi < n) y[oi] += read(x, best, dir, j) * win[j]; } }
    for (let j = 0; j < N; j++) { const oi = o + j; if (oi >= 0 && oi < n) norm[oi] += win[j]; }
    prevC = best; prevDir = dir;
  }
  return outs.map((y) => { const r = new Float32Array(n); for (let i = 0; i < n; i++) r[i] = norm[i] > 1e-3 ? y[i] / norm[i] : 0; return r; });
}

/**
 * chans: Float32Array per channel (source audio at `sr`). ctl: source seconds at output samples 0, step, 2*step, ...
 * Returns Float32Array per channel, `n` samples at `sr`. Positions outside the source are silent.
 */
export function renderRetimed({ chans, sr, ctl, step, n, maintainPitch }) {
  const pos = positions(ctl, step, n, sr);
  return maintainPitch ? wsola(chans, pos) : varispeed(chans, pos);
}
