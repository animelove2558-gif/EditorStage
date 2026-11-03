// Phase 5C1 effects: Paint Bucket flood fill, FFT Filter kernel, phase-vocoder pitch shifter (run outside the browser),
// and the effect tables (no approximations left among the rebuilt ones). Run: node scripts/test_effects.mjs
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-effects-'));
const entry = path.join(tmp, 'entry.js'); const out = path.join(tmp, 'bundle.mjs');
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/Renderers/fx/floodFill.js'))};
export * from ${JSON.stringify(path.join(root, 'src/Services/fir.js'))};
export { VIDEO_FX } from ${JSON.stringify(path.join(root, 'src/Renderers/fx/videoEffects.js'))};
export { PRO_FX } from ${JSON.stringify(path.join(root, 'src/Renderers/fx/premiereFx.js'))};
export { AUDIO_FX } from ${JSON.stringify(path.join(root, 'src/Services/audioFx.js'))};`);
await esbuild.build({ absWorkingDir: root, entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error', loader: { '.js': 'jsx', '.wk': 'text' } });
const m = await import(pathToFileURL(out).href);
fs.rmSync(tmp, { recursive: true, force: true });

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const J = JSON.stringify;

// ---- Paint Bucket ----
const W = 20, H = 10; const px = new Uint8Array(W * H * 4);
const put = (x, y, r, g, b, a = 255) => { const i = (y * W + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, 0, 0, 0);
for (let y = 2; y < 8; y++) for (let x = 2; x < 9; x++) put(x, y, 250, 250, 250); // white box
for (let y = 2; y < 5; y++) for (let x = 12; x < 15; x++) put(x, y, 255, 255, 255); // a separate white box
for (let y = 0; y < H; y++) put(17, y, 0, 0, 0, 0); // a transparent column
const at = (mk, x, y) => mk[y * W + x];
let mk = m.floodFill(px, W, H, 5, 5, 0, 10);
ok('fill stays inside the connected region', at(mk, 2, 2) === 255 && at(mk, 8, 7) === 255 && at(mk, 13, 3) === 0 && at(mk, 1, 1) === 0);
ok('tolerance: 250 vs 255 is inside 10, the other box is not connected anyway', m.floodFill(px, W, H, 13, 3, 0, 10)[3 * W + 13] === 255 && m.floodFill(px, W, H, 13, 3, 0, 10)[5 * W + 5] === 0);
ok('tolerance 0 excludes a 5-level difference', (() => { const q = px.slice(); put.call(null, 3, 3, 245, 245, 245); const r = m.floodFill(px, W, H, 5, 5, 0, 0)[3 * W + 3] === 0; px.set(q); return r; })());
mk = m.floodFill(px, W, H, 0, 0, 0, 10);
ok('background fill goes around the boxes, stops at the transparent column (Color & Alpha)', at(mk, 0, 9) === 255 && at(mk, 10, 5) === 255 && at(mk, 5, 5) === 0 && at(mk, 17, 0) === 0 && at(mk, 19, 0) === 0);
mk = m.floodFill(px, W, H, 0, 0, 1, 10);
ok('Straight Color ignores alpha: crosses the transparent column', at(mk, 17, 0) === 255 && at(mk, 19, 5) === 255);
mk = m.floodFill(px, W, H, 17, 4, 2, 10);
ok('Transparency: only the transparent column', at(mk, 17, 0) === 255 && at(mk, 17, 9) === 255 && at(mk, 16, 4) === 0);
mk = m.floodFill(px, W, H, 0, 0, 3, 10);
ok('Opacity: every opaque pixel connected to the point', at(mk, 5, 5) === 255 && at(mk, 13, 3) === 255 && at(mk, 17, 3) === 0);
ok('fill point outside the frame: empty', m.floodFill(px, W, H, -1, 0).every((v) => v === 0));

// ---- FFT Filter ----
const sr = 48000;
const resp = (h, f) => { let re = 0, im = 0; for (let n = 0; n < h.length; n++) { const a = (-2 * Math.PI * f * n) / sr; re += h[n] * Math.cos(a); im += h[n] * Math.sin(a); } return 20 * Math.log10(Math.hypot(re, im) + 1e-12); };
let h = m.fftFilterKernel({ low: 1000, high: 4000, mode: 0, size: 4096, sampleRate: sr });
const g = [200, 500, 2000, 3000, 8000, 15000].map((f) => resp(h, f));
ok('Pass Band 1k–4k: 0 dB inside, ≤ −40 dB an octave outside', Math.abs(g[2]) < 0.5 && Math.abs(g[3]) < 0.5 && g[0] < -40 && g[1] < -40 && g[4] < -40 && g[5] < -40, J(g.map((x) => +x.toFixed(1))));
let peak = 0; for (let i = 1; i < h.length; i++) if (Math.abs(h[i]) > Math.abs(h[peak])) peak = i;
let e = 0, e10 = 0; for (let i = 0; i < h.length; i++) { e += h[i] * h[i]; if (i < h.length / 10) e10 += h[i] * h[i]; }
ok('minimum phase: the energy sits at the start (little delay)', peak < 200 && e10 / e > 0.95, J({ peak, early: e10 / e }));
h = m.fftFilterKernel({ low: 4000, high: 6000, mode: 1, size: 2048, sampleRate: sr });
ok('Reject Band 4k–6k removes 5 kHz, keeps 1 kHz and 12 kHz', resp(h, 5000) < -40 && Math.abs(resp(h, 1000)) < 0.5 && Math.abs(resp(h, 12000)) < 0.5, J([resp(h, 5000), resp(h, 1000), resp(h, 12000)]));
ok('steep edge: the old biquad pair was −3 dB at the cut-off and −12 dB an octave out; this is ≤ −40 dB a third-octave out', (() => { const k = m.fftFilterKernel({ low: 1000, high: 20000, mode: 0, size: 8192, sampleRate: sr }); return resp(k, 790) < -40 && Math.abs(resp(k, 1260)) < 0.5; })());

// ---- phase vocoder (pitch.wk run in a vm with an AudioWorklet shim) ----
const procs = {};
const ctx = vm.createContext({ Math, Float32Array, Uint8Array, Array, sampleRate: sr, AudioWorkletProcessor: class {}, registerProcessor: (n, c) => { procs[n] = c; } });
vm.runInContext(fs.readFileSync(path.join(root, 'src/Services/pitch.wk'), 'utf8'), ctx);
ok('worklet module registers pv-pitch, spectral, declick (granular shifter removed)', procs['pv-pitch'] && procs.spectral && procs.declick && !procs['pitch-shifter'], J(Object.keys(procs)));
const run = (ratio, opts, f0 = 440, secs = 1, wave = (t) => Math.sin(2 * Math.PI * f0 * t)) => {
  const p = new procs['pv-pitch']({ processorOptions: opts }); const n = sr * secs; const y = new Float32Array(n);
  for (let o = 0; o < n; o += 128) { const x = new Float32Array(128).map((_, i) => wave((o + i) / sr)); const out = [new Float32Array(128), new Float32Array(128)]; p.process([[x, x]], [out], { ratio: [ratio] }); y.set(out[0].subarray(0, Math.min(128, n - o)), o); }
  return y;
};
const freq = (y) => { let zc = 0; const a = Math.floor(y.length / 3); for (let i = a + 1; i < y.length; i++) if (y[i - 1] < 0 && y[i] >= 0) zc++; return zc / ((y.length - a) / sr); };
const rms = (y) => { let s = 0; const a = Math.floor(y.length / 3); for (let i = a; i < y.length; i++) s += y[i] * y[i]; return Math.sqrt(s / (y.length - a)); };
let y = run(2, { N: 2048 });
ok('+12 semitones: 440 Hz → 880 Hz, level kept', Math.abs(freq(y) - 880) < 6 && Math.abs(rms(y) - 0.707) < 0.1, J([freq(y), rms(y)]));
y = run(0.5, { N: 4096 });
ok('−12 semitones, High Precision: 440 Hz → 220 Hz, level kept', Math.abs(freq(y) - 220) < 4 && Math.abs(rms(y) - 0.707) < 0.1, J([freq(y), rms(y)]));
// two partials (chord) both move: 300 + 500 Hz up a fifth -> 449.5 + 749.2 Hz
y = run(Math.pow(2, 7 / 12), { N: 2048 }, 0, 1, (t) => 0.5 * Math.sin(2 * Math.PI * 300 * t) + 0.5 * Math.sin(2 * Math.PI * 500 * t));
const tonePow = (y, f) => { let re = 0, im = 0; const a = Math.floor(y.length / 3); for (let i = a; i < y.length; i++) { re += y[i] * Math.cos(2 * Math.PI * f * i / sr); im += y[i] * Math.sin(2 * Math.PI * f * i / sr); } return Math.hypot(re, im) / (y.length - a) * 2; };
ok('two partials both shift (+7 semitones)', tonePow(y, 449.5) > 0.35 && tonePow(y, 749.2) > 0.35 && tonePow(y, 300) < 0.05 && tonePow(y, 500) < 0.05, J([449.5, 749.2, 300, 500].map((f) => +tonePow(y, f).toFixed(3))));
y = run(Math.pow(2, -5 / 12), { N: 2048 });
ok('−5 semitones: 440 Hz → 329.6 Hz', Math.abs(freq(y) - 329.6) < 5, freq(y));
ok('level kept (sine RMS 0.707 ± 15%)', Math.abs(rms(y) - 0.707) < 0.1, rms(y));
y = run(1, { N: 1024 });
ok('ratio 1, Low Precision: unchanged pitch and level', Math.abs(freq(y) - 440) < 4 && Math.abs(rms(y) - 0.707) < 0.08, J([freq(y), rms(y)]));
// formant preservation: a pulse train (harmonics of 150 Hz through a fixed 1 kHz resonance) shifted up an octave keeps its resonance
const formantWave = (t) => { let s = 0; for (let k = 1; k <= 40; k++) { const f = 150 * k; s += Math.sin(2 * Math.PI * f * t) / (1 + ((f - 1000) / 250) ** 2); } return s * 0.3; };
const centroid = (y) => { const N = 8192, a = sr / 2; const re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < N; i++) re[i] = y[a + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); m.fft(re, im); let s = 0, w = 0; for (let k = 1; k < N / 2; k++) { const mg = Math.hypot(re[k], im[k]); s += mg * k; w += mg; } return (s / w) * (sr / N); };
const c0 = centroid(run(1, { N: 2048 }, 0, 1, formantWave)), cp = centroid(run(2, { N: 2048 }, 0, 1, formantWave)), cf = centroid(run(2, { N: 2048, formant: true }, 0, 1, formantWave));
ok('Formant Preserve keeps the spectral centroid near the original (plain shift doubles it)', cp > c0 * 1.6 && Math.abs(cf - c0) < Math.abs(cp - c0) * 0.5, J({ c0, cp, cf }));

// ---- tables ----
const rebuilt = Object.keys(m.PRO_FX);
ok('21 rebuilt video effects, none flagged approx', rebuilt.length === 21 && rebuilt.every((n) => m.VIDEO_FX[n] === m.PRO_FX[n] && !m.VIDEO_FX[n].status), J(rebuilt.filter((n) => m.VIDEO_FX[n]?.status)));
ok('no video effect is flagged approx', !Object.entries(m.VIDEO_FX).some(([, d]) => d.status === 'approx'), J(Object.entries(m.VIDEO_FX).filter(([, d]) => d.status === 'approx').map(([k]) => k)));
ok('FFT Filter and Pitch and Time are no longer approx', !m.AUDIO_FX['FFT Filter'].status && !m.AUDIO_FX['Pitch and Time'].status && !Object.values(m.AUDIO_FX).some((d) => d.status === 'approx'));
ok('a layer input names one of the effect\'s Track params', Object.values(m.VIDEO_FX).filter((d) => d.layer).every((d) => d.params.some((p) => p.id === d.layer && p.type === 'trackSel')));
const glslReserved = new Set(['layout', 'point', 'smooth', 'flat', 'input', 'output', 'sample', 'filter', 'common', 'active', 'texture', 'max', 'length']);
const legacy = new Set(['Compound Blur:max', 'Directional Blur:length']); // old ids, see the PRELUDE note
ok('param ids are unique and never GLSL reserved words / built-ins used by the shared prelude', Object.entries(m.VIDEO_FX).every(([n, d]) => new Set(d.params.map((p) => p.id)).size === d.params.length && d.params.every((p) => !glslReserved.has(p.id) || legacy.has(`${n}:${p.id}`))),
  J(Object.entries(m.VIDEO_FX).flatMap(([n, d]) => d.params.filter((p) => glslReserved.has(p.id) && !legacy.has(`${n}:${p.id}`)).map((p) => `${n}:${p.id}`))));
ok('legacy ids kept: Lighting light/intensity/radius/ambient, Arithmetic op indices, Roughen Edges Roughen/Rusty', ['light', 'intensity', 'radius', 'ambient'].every((id) => m.VIDEO_FX['Lighting Effects'].params.some((p) => p.id === id))
  && m.VIDEO_FX.Arithmetic.params[0].options.slice(0, 4).join() === 'Add,Subtract,Multiply,Difference' && m.VIDEO_FX['Roughen Edges'].params[0].options.slice(0, 2).join() === 'Roughen,Rusty');

console.log(`effects: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
