import { moreAudioFx, MORE_CROSSFADES } from './moreAudioFx';
// Web Audio effect library. Each entry: { params, build(ctx, p) -> { input, output } , status? }.
const s = (id, label, min, max, def, step) => ({ id, label, type: 'slider', min, max, def, step: step ?? (max - min <= 10 ? 0.01 : 1) });
const sel = (id, label, options, def = 0) => ({ id, label, type: 'select', options, def });
const chk = (id, label, def = false) => ({ id, label, type: 'checkbox', def });
import { fftFilterKernel, FFT_SIZES } from './fir';
const db = (x) => Math.pow(10, x / 20);

const pass = (ctx) => { const g = ctx.createGain(); return { input: g, output: g }; };
const chain = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return { input: nodes[0], output: nodes[nodes.length - 1] }; };
const biquad = (ctx, type, f, q = 1, gain = 0) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gain; return b; };
const gainNode = (ctx, v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
const comp = (ctx, th, ratio, atk, rel, knee = 6) => { const c = ctx.createDynamicsCompressor(); c.threshold.value = th; c.ratio.value = ratio; c.attack.value = atk; c.release.value = rel; c.knee.value = knee; return c; };

function mixWrap(ctx, wet, mix) { // parallel wet/dry
  const input = ctx.createGain(), out = ctx.createGain(), dry = gainNode(ctx, 1 - mix), w = gainNode(ctx, mix);
  input.connect(dry); dry.connect(out); input.connect(wet.input); wet.output.connect(w); w.connect(out);
  return { input, output: out };
}
function echo(ctx, time, fb, mix) {
  const d = ctx.createDelay(5); d.delayTime.value = time; const f = gainNode(ctx, fb); d.connect(f); f.connect(d);
  const wet = { input: d, output: d };
  return mixWrap(ctx, wet, mix);
}
function impulse(ctx, secs, decay) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * secs)); const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
  return b;
}
function reverb(ctx, p) {
  const conv = ctx.createConvolver(); conv.buffer = impulse(ctx, Math.max(0.2, p.decay), 2.5);
  const pre = ctx.createDelay(1); pre.delayTime.value = (p.preDelay || 0) / 1000;
  pre.connect(conv); return mixWrap(ctx, { input: pre, output: conv }, (p.wet ?? 30) / 100);
}
function lfo(ctx, rate, depth, target) {
  const o = ctx.createOscillator(); o.frequency.value = rate; const g = ctx.createGain(); g.gain.value = depth; o.connect(g); g.connect(target); o.start(); return o;
}
function shaper(ctx, amount) {
  const ws = ctx.createWaveShaper(); const n = 1024, c = new Float32Array(n), k = amount;
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  ws.curve = c; ws.oversample = '2x'; return ws;
}
const ISO = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const graphicEq = (n) => {
  const bands = n === 10 ? ISO : Array.from({ length: n }, (_, i) => 20 * Math.pow(1000, i / (n - 1)));
  return { params: bands.map((f, i) => s(`b${i}`, `${f >= 1000 ? (f / 1000).toFixed(f % 1000 ? 1 : 0) + 'k' : f.toFixed(f % 1 ? 1 : 0)} Hz`, -20, 20, 0, 0.5)),
    build: (ctx, p) => chain(...bands.map((f, i) => biquad(ctx, 'peaking', f, n === 10 ? 1.4 : n === 20 ? 2.8 : 4.3, p[`b${i}`] || 0))) };
};

export const METERS = new Map(); // fx id -> AnalyserNode (Loudness Radar)
function workletFx(c, name, opts) {
  if (!c.__pitchReady) throw new Error('worklet not ready');
  const n = new AudioWorkletNode(c, name, { outputChannelCount: [2], processorOptions: opts }); return { input: n, output: n };
}
const PRECISION = ['Low Precision', 'Medium Precision', 'High Precision'];
/** Phase-vocoder pitch shift (pitch.wk 'pv-pitch'): Precision = FFT size 1024 / 2048 / 4096, optional formant preservation. */
function pitchNode(c, p) {
  if (!c.__pitchReady) throw new Error('pitch worklet not ready');
  const n = new AudioWorkletNode(c, 'pv-pitch', { outputChannelCount: [2], processorOptions: { N: [1024, 2048, 4096][p.precision ?? 1] || 2048, formant: !!p.formant } });
  n.parameters.get('ratio').value = Math.pow(2, ((p.semitones || 0) + (p.cents || 0) / 100) / 12); return { input: n, output: n };
}
/** FFT Filter: minimum-phase FIR drawn on FFT bins (fir.js) run by a ConvolverNode. */
function fftFilter(c, p) {
  const h = fftFilterKernel({ low: p.low, high: p.high, mode: p.mode | 0, size: FFT_SIZES[p.fft ?? 1] || 2048, sampleRate: c.sampleRate });
  const b = c.createBuffer(1, h.length, c.sampleRate); b.copyToChannel(h, 0);
  const cv = c.createConvolver(); cv.normalize = false; cv.buffer = b; return { input: cv, output: cv };
}
/** momentary loudness (LUFS-ish) from the K-weighted analyser */
export function readLoudness(id) {
  const an = METERS.get(id); if (!an) return null; const b = new Float32Array(an.fftSize); an.getFloatTimeDomainData(b);
  let s = 0; for (const v of b) s += v * v; s /= b.length; return s > 1e-12 ? -0.691 + 10 * Math.log10(s) : -Infinity;
}


// Voice Changer presets (Create > Audio): chains of the effects above + the pitch-shifter worklet
const ring = (c, hz) => { const g = c.createGain(); g.gain.value = 0; const o = c.createOscillator(); o.frequency.value = hz; o.connect(g.gain); o.start(); return g; };
const comb = (c, ms, fb) => { const i = c.createGain(), d = c.createDelay(0.1); d.delayTime.value = ms / 1000; const f = gainNode(c, fb); i.connect(d); d.connect(f); f.connect(d); const o = c.createGain(); i.connect(o); d.connect(o); return { input: i, output: o }; };
const seq2 = (...parts) => { for (let i = 0; i < parts.length - 1; i++) parts[i].output.connect(parts[i + 1].input); return { input: parts[0].input, output: parts[parts.length - 1].output }; };
const n2 = (node) => ({ input: node, output: node });
export const VOICES = [
  ['Chipmunk', (c) => seq2(pitchNode(c, { semitones: 7 }), n2(biquad(c, 'highshelf', 4000, 0.7, 2)))],
  ['Deep', (c) => seq2(pitchNode(c, { semitones: -5 }), n2(biquad(c, 'lowshelf', 200, 0.7, 3)))],
  ['Robot', (c) => seq2(n2(ring(c, 55)), comb(c, 9, 0.55), n2(biquad(c, 'highpass', 120, 0.7)), n2(gainNode(c, 1.6)))],
  ['Radio', (c) => chain(biquad(c, 'highpass', 500, 0.8), biquad(c, 'lowpass', 3500, 0.8), shaper(c, 4), comp(c, -24, 6, 0.005, 0.1), gainNode(c, 1.4))],
  ['Telephone', (c) => chain(biquad(c, 'highpass', 300, 0.9), biquad(c, 'highpass', 300, 0.9), biquad(c, 'lowpass', 3400, 0.9), biquad(c, 'lowpass', 3400, 0.9), biquad(c, 'peaking', 1500, 1.2, 6), comp(c, -20, 4, 0.005, 0.1), gainNode(c, 1.6))],
  ['Megaphone', (c) => chain(biquad(c, 'highpass', 600, 1), biquad(c, 'lowpass', 4000, 1), biquad(c, 'peaking', 2000, 1.5, 9), shaper(c, 25), gainNode(c, 0.8))],
  ['Echo Hall', (c) => seq2(reverb(c, { decay: 3.5, preDelay: 30, wet: 45 }), echo(c, 0.32, 0.35, 0.3))],
  ['Monster', (c) => seq2(pitchNode(c, { semitones: -9 }), n2(shaper(c, 8)), n2(biquad(c, 'lowshelf', 180, 0.7, 5)), n2(gainNode(c, 0.8)))],
];

const pitchLatency = (p) => [1024, 2048, 4096][p.precision ?? 1] || 2048;
const PITCHED_VOICES = new Set(['Chipmunk', 'Deep', 'Monster']);
export const AUDIO_FX = {
  // Amplitude and Compression
  'Amplify': { params: [s('amount', 'Amount (dB)', -60, 40, 0, 0.1)], build: (c, p) => chain(gainNode(c, db(p.amount))) },
  'Channel Volume': { params: [s('left', 'Left (dB)', -60, 20, 0, 0.1), s('right', 'Right (dB)', -60, 20, 0, 0.1)],
    build: (c, p) => { const sp = c.createChannelSplitter(2), mg = c.createChannelMerger(2), l = gainNode(c, db(p.left)), r = gainNode(c, db(p.right)); const i = c.createGain(); i.channelCount = 2; i.channelCountMode = 'explicit'; i.connect(sp); sp.connect(l, 0); sp.connect(r, 1); l.connect(mg, 0, 0); r.connect(mg, 0, 1); return { input: i, output: mg }; } },
  'Dynamics': { params: [s('threshold', 'Threshold (dB)', -60, 0, -20), s('ratio', 'Ratio', 1, 20, 4, 0.1), s('attack', 'Attack (ms)', 0, 200, 10), s('release', 'Release (ms)', 10, 1000, 100), s('makeup', 'Make Up (dB)', 0, 30, 0, 0.1)],
    build: (c, p) => chain(comp(c, p.threshold, p.ratio, p.attack / 1000, p.release / 1000), gainNode(c, db(p.makeup))) },
  'Hard Limiter': { params: [s('max', 'Maximum Amplitude (dB)', -24, 0, -3, 0.1), s('release', 'Release (ms)', 10, 500, 50)],
    build: (c, p) => chain(comp(c, p.max, 20, 0.001, p.release / 1000, 0), gainNode(c, db(Math.min(0, p.max) * 0 + 0))) },
  'Multiband Compressor': { params: [s('threshold', 'Threshold (dB)', -60, 0, -22), s('ratio', 'Ratio', 1, 20, 3, 0.1), s('makeup', 'Make Up (dB)', 0, 20, 0, 0.1)],
    build: (c, p) => { const i = c.createGain(), o = c.createGain(); for (const [type, f] of [['lowpass', 250], ['bandpass', 1500], ['highpass', 5000]]) { const b = biquad(c, type, f, 0.7); const k = comp(c, p.threshold, p.ratio, 0.01, 0.15); i.connect(b); b.connect(k); k.connect(o); } o.gain.value = db(p.makeup); return { input: i, output: o }; } },
  'Single-band Compressor': { params: [s('threshold', 'Threshold (dB)', -60, 0, -20), s('ratio', 'Ratio', 1, 20, 3, 0.1), s('attack', 'Attack (ms)', 0, 200, 10), s('release', 'Release (ms)', 10, 1000, 100), s('makeup', 'Make Up (dB)', 0, 30, 0, 0.1)],
    build: (c, p) => chain(comp(c, p.threshold, p.ratio, p.attack / 1000, p.release / 1000), gainNode(c, db(p.makeup))) },
  'Tube-modeled Compressor': { params: [s('threshold', 'Threshold (dB)', -60, 0, -20), s('ratio', 'Ratio', 1, 20, 3, 0.1), s('warmth', 'Tube Warmth', 0, 10, 2, 0.1)],
    build: (c, p) => chain(comp(c, p.threshold, p.ratio, 0.01, 0.12), shaper(c, p.warmth), gainNode(c, 0.9)) },

  // Delay and Echo
  'Analog Delay': { params: [s('delay', 'Delay (ms)', 0, 1000, 250), s('feedback', 'Feedback (%)', 0, 95, 35), s('mix', 'Mix (%)', 0, 100, 35)],
    build: (c, p) => { const d = c.createDelay(5); d.delayTime.value = p.delay / 1000; const lp = biquad(c, 'lowpass', 3500), f = gainNode(c, p.feedback / 100); d.connect(lp); lp.connect(f); f.connect(d); return mixWrap(c, { input: d, output: d }, p.mix / 100); } },
  'Delay': { params: [s('delay', 'Delay (ms)', 0, 2000, 300), s('feedback', 'Feedback (%)', 0, 95, 0), s('mix', 'Mix (%)', 0, 100, 50)], build: (c, p) => echo(c, p.delay / 1000, p.feedback / 100, p.mix / 100) },
  'Echo': { params: [s('delay', 'Delay (ms)', 20, 2000, 400), s('feedback', 'Feedback (%)', 0, 95, 40), s('mix', 'Mix (%)', 0, 100, 40)], build: (c, p) => echo(c, p.delay / 1000, p.feedback / 100, p.mix / 100) },

  // Filter and EQ
  'Bandpass': { params: [s('center', 'Center (Hz)', 20, 20000, 2000), s('q', 'Q', 0.1, 20, 2, 0.1)], build: (c, p) => chain(biquad(c, 'bandpass', p.center, p.q)) },
  'FFT Filter': { params: [sel('mode', 'Mode', ['Pass Band', 'Reject Band']), s('low', 'Low Frequency (Hz)', 20, 20000, 80), s('high', 'High Frequency (Hz)', 20, 20000, 16000), sel('fft', 'FFT Size', FFT_SIZES.map(String), 1)], build: (c, p) => fftFilter(c, p) },
  'Graphic Equalizer (10 Bands)': graphicEq(10),
  'Graphic Equalizer (20 Bands)': graphicEq(20),
  'Graphic Equalizer (30 Bands)': graphicEq(30),
  'Highpass': { params: [s('cutoff', 'Cutoff (Hz)', 20, 20000, 200)], build: (c, p) => chain(biquad(c, 'highpass', p.cutoff, 0.7)) },
  'Lowpass': { params: [s('cutoff', 'Cutoff (Hz)', 20, 20000, 5000)], build: (c, p) => chain(biquad(c, 'lowpass', p.cutoff, 0.7)) },
  'Notch Filter': { params: [s('center', 'Center (Hz)', 20, 20000, 1000), s('q', 'Q', 0.1, 50, 10, 0.1)], build: (c, p) => chain(biquad(c, 'notch', p.center, p.q)) },
  'Parametric Equalizer': { params: [s('lowG', 'Low Shelf Gain (dB)', -20, 20, 0, 0.5), s('lowF', 'Low Shelf (Hz)', 20, 500, 120), s('midF', 'Mid Freq (Hz)', 100, 8000, 1000), s('midG', 'Mid Gain (dB)', -20, 20, 0, 0.5), s('midQ', 'Mid Q', 0.1, 10, 1, 0.1), s('highG', 'High Shelf Gain (dB)', -20, 20, 0, 0.5), s('highF', 'High Shelf (Hz)', 2000, 16000, 6000)],
    build: (c, p) => chain(biquad(c, 'lowshelf', p.lowF, 0.7, p.lowG), biquad(c, 'peaking', p.midF, p.midQ, p.midG), biquad(c, 'highshelf', p.highF, 0.7, p.highG)) },
  'Simple Notch Filter': { params: [s('center', 'Center (Hz)', 20, 20000, 60), s('q', 'Q', 0.1, 50, 15, 0.1)], build: (c, p) => chain(biquad(c, 'notch', p.center, p.q)) },
  'Treble': { params: [s('boost', 'Boost (dB)', -20, 20, 0, 0.5)], build: (c, p) => chain(biquad(c, 'highshelf', 4000, 0.7, p.boost)) },

  // Modulation
  'Chorus': { params: [s('rate', 'Rate (Hz)', 0.1, 10, 1.2, 0.1), s('depth', 'Depth (%)', 0, 100, 40), s('mix', 'Mix (%)', 0, 100, 50)],
    build: (c, p) => { const d = c.createDelay(0.1); d.delayTime.value = 0.025; lfo(c, p.rate, 0.004 * (p.depth / 100) * 2, d.delayTime); return mixWrap(c, { input: d, output: d }, p.mix / 100); } },
  'Flanger': { params: [s('rate', 'Rate (Hz)', 0.05, 10, 0.4, 0.05), s('depth', 'Depth (%)', 0, 100, 60), s('feedback', 'Feedback (%)', 0, 90, 40), s('mix', 'Mix (%)', 0, 100, 50)],
    build: (c, p) => { const d = c.createDelay(0.02); d.delayTime.value = 0.004; lfo(c, p.rate, 0.003 * (p.depth / 100), d.delayTime); const f = gainNode(c, p.feedback / 100); d.connect(f); f.connect(d); return mixWrap(c, { input: d, output: d }, p.mix / 100); } },
  'Phaser': { params: [s('rate', 'Rate (Hz)', 0.05, 10, 0.5, 0.05), s('depth', 'Depth (%)', 0, 100, 60), s('mix', 'Mix (%)', 0, 100, 50)],
    build: (c, p) => { const stages = [350, 700, 1400, 2800].map((f) => { const a = biquad(c, 'allpass', f, 0.7); lfo(c, p.rate, f * 0.8 * (p.depth / 100), a.frequency); return a; }); const w = chain(...stages); return mixWrap(c, w, p.mix / 100); } },

  // Noise reduction / restoration (approximations built from filters + dynamics)
  'Automatic Click Remover': { worklet: true, latency: () => 48, params: [s('thresh', 'Threshold', 0, 100, 30)], build: (c, p) => workletFx(c, 'declick', { thresh: p.thresh }) },
  'DeNoise': { worklet: true, latency: () => 1024, params: [s('amount', 'Amount (%)', 0, 100, 30)], build: (c, p) => workletFx(c, 'spectral', { mode: 'denoise', amount: p.amount }) },
  'DeReverb': { worklet: true, latency: () => 1024, params: [s('amount', 'Amount (%)', 0, 100, 40)], build: (c, p) => workletFx(c, 'spectral', { mode: 'dereverb', amount: p.amount }) },

  // Reverb
  'Convolution Reverb': { params: [s('decay', 'Decay (s)', 0.2, 8, 2.2, 0.1), s('preDelay', 'Pre-delay (ms)', 0, 200, 20), s('wet', 'Wet (%)', 0, 100, 30)], build: (c, p) => reverb(c, p) },
  'Studio Reverb': { params: [s('decay', 'Decay (s)', 0.2, 6, 1.2, 0.1), s('preDelay', 'Pre-delay (ms)', 0, 200, 10), s('wet', 'Wet (%)', 0, 100, 25)], build: (c, p) => reverb(c, p) },
  'Surround Reverb': { params: [s('decay', 'Decay (s)', 0.2, 10, 3, 0.1), s('preDelay', 'Pre-delay (ms)', 0, 200, 30), s('wet', 'Wet (%)', 0, 100, 35)], build: (c, p) => reverb(c, p) },

  // Special
  'Distortion': { params: [s('amount', 'Amount', 0, 100, 20), s('level', 'Output (dB)', -20, 6, -3, 0.5)], build: (c, p) => chain(shaper(c, p.amount), gainNode(c, db(p.level))) },
  'Guitar Suite': { params: [
      s('comp', 'Compressor Amount', 0, 100, 40), s('filter', 'Filter Cutoff (Hz)', 500, 20000, 12000), s('modRate', 'Modulation Rate (Hz)', 0.1, 8, 1.0, 0.1), s('modDepth', 'Modulation Depth', 0, 100, 0),
      s('drive', 'Distortion Drive', 0, 100, 30), s('gain', 'Amp Gain (dB)', -12, 12, 0, 0.5), s('bass', 'Amp Bass (dB)', -12, 12, 0, 0.5), s('mid', 'Amp Mid (dB)', -12, 12, 0, 0.5), s('treble', 'Amp Treble (dB)', -12, 12, 0, 0.5),
      chk('cab', 'Cabinet Simulation', true), s('reverb', 'Reverb Mix', 0, 100, 15), s('out', 'Output (dB)', -24, 12, 0, 0.5)],
    build: (c, p) => {
      const nodes = [];
      nodes.push(comp(c, -10 - p.comp * 0.3, 1.5 + p.comp / 12, 0.008, 0.12), gainNode(c, db(p.comp / 25)), biquad(c, 'highpass', 80, 0.7)); // compressor + input cleanup
      nodes.push(shaper(c, p.drive * 0.6), gainNode(c, db(-p.drive / 14)));                                                              // distortion
      nodes.push(gainNode(c, db(p.gain)), biquad(c, 'lowshelf', 120, 0.7, p.bass), biquad(c, 'peaking', 800, 0.9, p.mid), biquad(c, 'highshelf', 3500, 0.7, p.treble)); // amplifier tone stack
      if (p.cab) nodes.push(biquad(c, 'lowpass', 5200, 0.9), biquad(c, 'peaking', 2400, 1.2, 3), biquad(c, 'highpass', 90, 0.9));           // speaker cabinet voicing
      let w = chain(...nodes);
      if (p.modDepth > 0) { const d = c.createDelay(0.05); d.delayTime.value = 0.012; lfo(c, p.modRate, 0.004 * (p.modDepth / 100), d.delayTime); const m = mixWrap(c, { input: d, output: d }, 0.5 * (p.modDepth / 100)); w = { input: w.input, output: (w.output.connect(m.input), m.output) }; }
      if (p.reverb > 0) { const r = reverb(c, { decay: 1.4, preDelay: 12, wet: p.reverb }); w = { input: w.input, output: (w.output.connect(r.input), r.output) }; }
      const tail = chain(biquad(c, 'lowpass', p.filter, 0.7), gainNode(c, db(p.out))); w.output.connect(tail.input);
      return { input: w.input, output: tail.output };
    } },
  'Loudness Radar': { meter: true, params: [], build: (c, p, fx) => { const k = [biquad(c, 'highpass', 38, 0.5), biquad(c, 'highshelf', 1500, 0.7, 4)]; const an = c.createAnalyser(); an.fftSize = 16384; const g = gainNode(c, 1); k.reduce((a, b) => (a.connect(b), b)); g.connect(k[0]); k[1].connect(an); if (fx?.id) METERS.set(fx.id, an); return { input: g, output: g }; } },
  'Mastering': { params: [s('lowG', 'Bass (dB)', -12, 12, 2, 0.5), s('highG', 'Treble (dB)', -12, 12, 2, 0.5), s('ceiling', 'Limiter (dB)', -12, 0, -1, 0.1)], build: (c, p) => chain(biquad(c, 'lowshelf', 120, 0.7, p.lowG), biquad(c, 'highshelf', 7000, 0.7, p.highG), comp(c, -14, 3, 0.02, 0.2), comp(c, p.ceiling, 20, 0.001, 0.05, 0)) },
  'Vocal Enhancer': { params: [s('presence', 'Presence (dB)', 0, 12, 4, 0.5), s('rumble', 'Rumble Cut (Hz)', 20, 300, 80), s('comp', 'Compression', 0, 10, 3, 0.1)], build: (c, p) => chain(biquad(c, 'highpass', p.rumble, 0.7), biquad(c, 'peaking', 3500, 1, p.presence), comp(c, -24, 1 + p.comp, 0.005, 0.15)) },

  'Voice Changer': { worklet: true, latency: (p) => (p.mix >= 100 && PITCHED_VOICES.has(VOICES[p.voice | 0]?.[0]) ? 2048 : 0), params: [sel('voice', 'Voice', VOICES.map((v) => v[0])), s('mix', 'Mix (%)', 0, 100, 100)],
    build: (c, p) => mixWrap(c, VOICES[p.voice | 0]?.[1](c) || pass(c), p.mix / 100) },

  // Stereo imagery
  'Binauralizer': { params: [s('azimuth', 'Azimuth (deg)', -180, 180, 30), s('distance', 'Distance (m)', 0.2, 10, 1.5, 0.1)],
    build: (c, p) => { const pn = c.createPanner(); pn.panningModel = 'HRTF'; const a = (p.azimuth * Math.PI) / 180; pn.positionX.value = Math.sin(a) * p.distance; pn.positionZ.value = -Math.cos(a) * p.distance; return chain(pn); } },
  'Panner': { params: [s('pan', 'Pan', -100, 100, 0)], build: (c, p) => { const sp = c.createStereoPanner(); sp.pan.value = p.pan / 100; return chain(sp); } },

  // Time and pitch: phase vocoder (pitch.wk). Duration changes are Clip > Speed/Duration with Maintain Audio Pitch.
  'Pitch Shifter': { worklet: true, latency: pitchLatency, params: [s('semitones', 'Semitones', -12, 12, 0, 1), s('cents', 'Cents', -100, 100, 0, 1), sel('precision', 'Precision', PRECISION, 1), chk('formant', 'Formant Preserve')], build: (c, p) => pitchNode(c, p) },
  'Pitch and Time': { worklet: true, latency: pitchLatency, params: [s('semitones', 'Pitch (semitones)', -12, 12, 0, 1), s('cents', 'Pitch (cents)', -100, 100, 0, 1), sel('precision', 'Precision', PRECISION, 1), chk('formant', 'Preserve Formants')], build: (c, p) => pitchNode(c, p) },
};

// round 2 effects (moreAudioFx.js): a name already used above keeps the original
export const MORE_AUDIO_FX = moreAudioFx({ chain, biquad, gainNode, comp, mixWrap, lfo, shaper, db });
for (const items of Object.values(MORE_AUDIO_FX)) for (const [name, def] of Object.entries(items)) if (!AUDIO_FX[name]) AUDIO_FX[name] = def;

export const audioDefaults = (name) => Object.fromEntries((AUDIO_FX[name]?.params || []).map((p) => [p.id, { v: p.def, keys: null }]));

// Audio transition crossfade curves: g(p) is the gain of the incoming clip (p: 0..1); outgoing uses g(1-p) mirrored.
export const crossfadeGains = (name, p) => {
  if (name === 'Constant Power') return [Math.cos(p * Math.PI / 2), Math.sin(p * Math.PI / 2)];
  if (name === 'Exponential Fade') return [Math.pow(1 - p, 2), Math.pow(p, 2)];
  if (MORE_CROSSFADES[name]) return MORE_CROSSFADES[name](p);
  return [1 - p, p]; // Constant Gain
};

/** Processing delay of a clip's audio effects in samples (STFT worklets output one window late); export starts those clips early by this much. */
export function chainLatency(clip) {
  let n = 0;
  for (const fx of clip.effects || []) {
    if (!fx.enabled || fx.category !== 'Audio') continue; const d = AUDIO_FX[fx.name];
    if (d?.latency) n += d.latency(Object.fromEntries(Object.entries(fx.params || {}).map(([k, v]) => [k, v?.v]))) || 0;
  }
  return n;
}
