// FFT Filter kernel: the magnitude response is drawn on FFT bins (band pass / band reject between two cut-offs, steep
// edges), then turned into a minimum-phase impulse response through the real cepstrum so the filter adds almost no delay.
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inverse ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2; const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

export const FFT_SIZES = [1024, 2048, 4096, 8192];

/** Desired gain at frequency f (Hz): 1 in the pass region; edges fall over `edge` octaves. */
export function fftFilterGain(f, { low = 80, high = 16000, mode = 0, edge = 1 / 12 }) {
  const lo = Math.min(low, high), hi = Math.max(low, high);
  const ramp = (x) => Math.min(1, Math.max(0, x)); const oct = (a, b) => Math.log2(Math.max(a, 1e-6) / b);
  const inBand = ramp(0.5 + oct(f, lo) / edge) * ramp(0.5 - oct(f, hi) / edge); // smooth 0..1 band membership
  return mode === 1 ? 1 - inBand : inBand;
}

/** Minimum-phase impulse response of length `size` for the FFT Filter settings. */
export function fftFilterKernel({ low, high, mode = 0, size = 2048, sampleRate = 48000 }) {
  const M = size * 4; const re = new Float64Array(M), im = new Float64Array(M);
  const floor = 1e-4; // -80 dB stop band
  for (let k = 0; k <= M / 2; k++) {
    const g = Math.max(floor, fftFilterGain((k * sampleRate) / M, { low, high, mode }));
    re[k] = Math.log(g); if (k > 0 && k < M / 2) re[M - k] = re[k];
  }
  fft(re, im, true); // real cepstrum
  for (let n = 1; n < M / 2; n++) { re[n] *= 2; im[n] = 0; }
  for (let n = M / 2 + 1; n < M; n++) { re[n] = 0; im[n] = 0; }
  im[0] = 0; im[M / 2] = 0;
  fft(re, im, false); // log spectrum of the minimum-phase version
  for (let k = 0; k < M; k++) { const e = Math.exp(re[k]); const ph = im[k]; re[k] = e * Math.cos(ph); im[k] = e * Math.sin(ph); }
  fft(re, im, true);
  const h = new Float32Array(size); const fade = size / 4;
  for (let n = 0; n < size; n++) h[n] = re[n] * (n < size - fade ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (n - (size - fade))) / fade));
  return h;
}
