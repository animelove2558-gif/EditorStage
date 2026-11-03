// Audio effects added in round 2 (docs/PROMPT_FIX_ROUND2.md E2), written for EditorStage (source 'own'), built from Web Audio nodes only.
// moreAudioFx(h) gets the node helpers of audioFx.js (no import cycle) and returns { folder: { name: { params, build } } }.
// Randomness (noise, reverb impulses) is seeded so Preview and Export render the same thing.
const s = (id, label, min, max, def, step) => ({ id, label, type: 'slider', min, max, def, step: step ?? (max - min <= 10 ? 0.01 : 1) });
const sel = (id, label, options, def = 0) => ({ id, label, type: 'select', options, def });
const chk = (id, label, def = false) => ({ id, label, type: 'checkbox', def });
const mix = (def = 50) => s('mix', 'Mix (%)', 0, 100, def);

export function seededRandom(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function moreAudioFx(h) {
  const { chain, biquad, gainNode, comp, mixWrap, lfo, shaper, db } = h;
  const stereoIn = (c) => { const g = c.createGain(); g.channelCount = 2; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers'; return g; };
  // matrix: out L = a*L + b*R, out R = c*L + d*R
  const matrix = (c, a, b, cc, d) => {
    const i = stereoIn(c), sp = c.createChannelSplitter(2), m = c.createChannelMerger(2); i.connect(sp);
    const k = (from, to, v) => { if (!v) return; const g = gainNode(c, v); sp.connect(g, from); g.connect(m, 0, to); };
    k(0, 0, a); k(1, 0, b); k(0, 1, cc); k(1, 1, d); return { input: i, output: m };
  };
  const curveShaper = (c, fn, n = 2048) => { const ws = c.createWaveShaper(); const cv = new Float32Array(n); for (let i = 0; i < n; i++) cv[i] = fn((i / (n - 1)) * 2 - 1); ws.curve = cv; ws.oversample = '4x'; return ws; };
  const seededImpulse = (c, secs, decay, { seed = 1, reverse = false, gate = 0, early = 0 } = {}) => {
    const n = Math.max(1, Math.floor(c.sampleRate * secs)); const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const r = seededRandom(seed * 7 + ch), d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) { const x = i / n; let env = gate ? (x < gate ? 1 : 0) : Math.pow(1 - x, decay); if (reverse) env = Math.pow(x, decay); d[i] = (r() * 2 - 1) * env; }
      if (early) for (let k = 1; k <= 6; k++) { const at = Math.floor(c.sampleRate * early * k * (0.7 + 0.6 * r())); if (at < n) d[at] += (r() > 0.5 ? 1 : -1) * 0.6 / k; }
    }
    return b;
  };
  const verb = (c, p, opts = {}, tone = []) => {
    const conv = c.createConvolver(); conv.buffer = seededImpulse(c, Math.max(0.05, p.decay ?? opts.secs), opts.decay ?? 2.5, opts);
    const pre = c.createDelay(1); pre.delayTime.value = (p.preDelay || 0) / 1000; pre.connect(conv);
    const wet = tone.length ? (() => { const t = chain(...tone); conv.connect(t.input); return { input: pre, output: t.output }; })() : { input: pre, output: conv };
    return mixWrap(c, wet, (p.wet ?? 30) / 100);
  };
  const noiseSource = (c, seed, secs = 2) => { const n = Math.floor(c.sampleRate * secs); const b = c.createBuffer(1, n, c.sampleRate); const r = seededRandom(seed); const d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = r() * 2 - 1; const src = c.createBufferSource(); src.buffer = b; src.loop = true; src.start(); return src; };
  const addNoise = (c, dry, noise, level) => { const out = c.createGain(); dry.output.connect(out); const g = gainNode(c, level); noise.connect(g); g.connect(out); return { input: dry.input, output: out }; };
  const parallel = (c, branches) => { const i = c.createGain(), o = c.createGain(); for (const b of branches) { i.connect(b.input); b.output.connect(o); } return { input: i, output: o }; };
  const delayLine = (c, sec, max = 5) => { const d = c.createDelay(max); d.delayTime.value = sec; return d; };
  const crush = (bits) => (x) => { const q = Math.pow(2, bits - 1); return Math.round(x * q) / q; };

  return {
    'Amplitude and Compression': {
      'Brickwall Limiter': { params: [s('ceiling', 'Ceiling (dB)', -24, 0, -1, 0.1), s('input', 'Input Gain (dB)', 0, 24, 0, 0.5)], build: (c, p) => chain(gainNode(c, db(p.input)), comp(c, p.ceiling - 1, 20, 0.001, 0.05, 0), gainNode(c, db(1))) },
      'Soft Clipper': { params: [s('drive', 'Drive (dB)', 0, 24, 6, 0.5), s('out', 'Output (dB)', -24, 6, -3, 0.5)], build: (c, p) => chain(gainNode(c, db(p.drive)), curveShaper(c, Math.tanh), gainNode(c, db(p.out))) },
      'Leveler': { params: [s('target', 'Target Level (dB)', -40, 0, -18), s('speed', 'Speed', 1, 10, 4, 0.1), s('makeup', 'Make Up (dB)', 0, 24, 8, 0.5)], build: (c, p) => chain(comp(c, p.target, 3, 0.2 / p.speed, 1.5 / p.speed, 12), gainNode(c, db(p.makeup))) },
      'Upward Compressor': { params: [s('threshold', 'Threshold (dB)', -60, 0, -35), s('amount', 'Amount (dB)', 0, 24, 10, 0.5)],
        build: (c, p) => { const wet = chain(gainNode(c, db(p.amount)), comp(c, p.threshold, 12, 0.005, 0.2, 6)); return mixWrap(c, wet, 0.5); } },
      'Invert': { params: [chk('left', 'Invert Left', true), chk('right', 'Invert Right', true)], build: (c, p) => matrix(c, p.left ? -1 : 1, 0, 0, p.right ? -1 : 1) },
      'Balance': { params: [s('balance', 'Balance', -100, 100, 0)], build: (c, p) => matrix(c, Math.min(1, 1 - p.balance / 100), 0, 0, Math.min(1, 1 + p.balance / 100)) },
      'Noise Floor Trim': { params: [s('cut', 'Rumble Cut (Hz)', 20, 200, 60), s('hiss', 'Hiss Cut (Hz)', 4000, 20000, 14000), s('expand', 'Downward Expand', 0, 100, 30)],
        build: (c, p) => chain(biquad(c, 'highpass', p.cut, 0.7), biquad(c, 'lowpass', p.hiss, 0.7), comp(c, -45, 1 + p.expand / 50, 0.01, 0.3, 20)) },
    },
    'Delay and Echo': {
      'Ping-Pong Delay': { params: [s('delay', 'Delay (ms)', 20, 2000, 350), s('feedback', 'Feedback (%)', 0, 95, 45), mix(35)],
        build: (c, p) => { const i = stereoIn(c), sp = c.createChannelSplitter(2), m = c.createChannelMerger(2), dl = delayLine(c, p.delay / 1000), dr = delayLine(c, p.delay / 1000), fl = gainNode(c, p.feedback / 100), fr = gainNode(c, p.feedback / 100), mono = gainNode(c, 0.5);
          i.connect(sp); sp.connect(mono, 0); sp.connect(mono, 1); mono.connect(dl); dl.connect(fl); fl.connect(dr); dr.connect(fr); fr.connect(dl); dl.connect(m, 0, 0); dr.connect(m, 0, 1); return mixWrap(c, { input: i, output: m }, p.mix / 100); } },
      'Slapback Delay': { params: [s('delay', 'Delay (ms)', 40, 200, 90), s('tone', 'Tone (Hz)', 1000, 12000, 5000), mix(30)],
        build: (c, p) => { const d = delayLine(c, p.delay / 1000); const t = chain(d, biquad(c, 'lowpass', p.tone, 0.7)); return mixWrap(c, t, p.mix / 100); } },
      'Multi-Tap Delay': { params: [s('t1', 'Tap 1 (ms)', 10, 2000, 150), s('t2', 'Tap 2 (ms)', 10, 2000, 300), s('t3', 'Tap 3 (ms)', 10, 2000, 450), s('t4', 'Tap 4 (ms)', 10, 2000, 600), s('decay', 'Tap Decay (%)', 0, 100, 60), mix(35)],
        build: (c, p) => mixWrap(c, parallel(c, [p.t1, p.t2, p.t3, p.t4].map((t, k) => chain(delayLine(c, t / 1000), gainNode(c, Math.pow(p.decay / 100, k))))), p.mix / 100) },
      'Tape Echo': { params: [s('delay', 'Delay (ms)', 50, 1500, 330), s('feedback', 'Feedback (%)', 0, 95, 50), s('wow', 'Wow & Flutter', 0, 100, 30), s('tone', 'Tape Tone (Hz)', 1000, 10000, 3500), mix(35)],
        build: (c, p) => { const d = delayLine(c, p.delay / 1000), lp = biquad(c, 'lowpass', p.tone, 0.7), hp = biquad(c, 'highpass', 120, 0.7), sat = shaper(c, 2), f = gainNode(c, p.feedback / 100);
          d.connect(lp); lp.connect(hp); hp.connect(sat); sat.connect(f); f.connect(d); lfo(c, 0.7, 0.0004 * p.wow / 10, d.delayTime); lfo(c, 6.5, 0.00005 * p.wow / 10, d.delayTime); return mixWrap(c, { input: d, output: sat }, p.mix / 100); } },
      'Dub Delay': { params: [s('delay', 'Delay (ms)', 50, 2000, 500), s('feedback', 'Feedback (%)', 0, 98, 70), s('low', 'Low Cut (Hz)', 20, 2000, 400), s('high', 'High Cut (Hz)', 500, 20000, 2500), mix(40)],
        build: (c, p) => { const d = delayLine(c, p.delay / 1000), b = chain(biquad(c, 'highpass', p.low, 0.7), biquad(c, 'lowpass', p.high, 0.7)), f = gainNode(c, p.feedback / 100); d.connect(b.input); b.output.connect(f); f.connect(d); return mixWrap(c, { input: d, output: b.output }, p.mix / 100); } },
    },
    'Filter and EQ': {
      'Bass': { params: [s('boost', 'Boost (dB)', -20, 20, 0, 0.5)], build: (c, p) => chain(biquad(c, 'lowshelf', 200, 0.7, p.boost)) },
      'Low Shelf': { params: [s('freq', 'Frequency (Hz)', 20, 2000, 150), s('gain', 'Gain (dB)', -24, 24, 0, 0.5)], build: (c, p) => chain(biquad(c, 'lowshelf', p.freq, 0.7, p.gain)) },
      'High Shelf': { params: [s('freq', 'Frequency (Hz)', 1000, 20000, 6000), s('gain', 'Gain (dB)', -24, 24, 0, 0.5)], build: (c, p) => chain(biquad(c, 'highshelf', p.freq, 0.7, p.gain)) },
      'Peak Filter': { params: [s('freq', 'Frequency (Hz)', 20, 20000, 1000), s('gain', 'Gain (dB)', -24, 24, 0, 0.5), s('q', 'Q', 0.1, 20, 1, 0.1)], build: (c, p) => chain(biquad(c, 'peaking', p.freq, p.q, p.gain)) },
      'Band Reject': { params: [s('low', 'Low (Hz)', 20, 20000, 400), s('high', 'High (Hz)', 20, 20000, 2000)],
        build: (c, p) => { const lo = Math.min(p.low, p.high), hi = Math.max(p.low, p.high, lo + 1); const f = Math.sqrt(lo * hi); return chain(biquad(c, 'notch', f, f / (hi - lo))); } },
      'Scientific Filter': { params: [sel('type', 'Type', ['Lowpass', 'Highpass', 'Bandpass']), s('freq', 'Cutoff (Hz)', 20, 20000, 1000), sel('order', 'Order', ['12 dB/oct', '24 dB/oct', '48 dB/oct'], 1)],
        build: (c, p) => { const t = ['lowpass', 'highpass', 'bandpass'][p.type | 0]; const n = [1, 2, 4][p.order | 0]; return chain(...Array.from({ length: n }, () => biquad(c, t, p.freq, t === 'bandpass' ? 2 : 0.707))); } },
      'Tilt EQ': { params: [s('tilt', 'Tilt (dB)', -12, 12, 0, 0.5), s('pivot', 'Pivot (Hz)', 200, 5000, 1000)], build: (c, p) => chain(biquad(c, 'lowshelf', p.pivot, 0.5, -p.tilt / 2), biquad(c, 'highshelf', p.pivot, 0.5, p.tilt / 2)) },
      'Loudness Contour': { params: [s('amount', 'Amount', 0, 100, 50)], build: (c, p) => chain(biquad(c, 'lowshelf', 100, 0.7, p.amount / 10), biquad(c, 'peaking', 3000, 1, -p.amount / 50), biquad(c, 'highshelf', 10000, 0.7, p.amount / 20)) },
      'DeHummer': { params: [sel('mains', 'Frequency', ['50 Hz', '60 Hz']), s('harm', 'Harmonics', 1, 8, 4, 1), s('q', 'Q', 5, 60, 30, 1)],
        build: (c, p) => { const f0 = p.mains >= 1 ? 60 : 50; return chain(...Array.from({ length: p.harm | 0 }, (_, k) => biquad(c, 'notch', f0 * (k + 1), p.q))); } },
      'DeEsser': { params: [s('freq', 'Frequency (Hz)', 3000, 12000, 6500), s('reduction', 'Reduction (dB)', 0, 24, 8, 0.5)],
        build: (c, p) => { const sib = chain(biquad(c, 'bandpass', p.freq, 1.5), comp(c, -40, 10, 0.001, 0.05, 6), gainNode(c, -(1 - db(-p.reduction)))); const i = c.createGain(), o = c.createGain(); i.connect(o); i.connect(sib.input); sib.output.connect(o); return { input: i, output: o }; } },
      'Auto-Wah': { params: [s('rate', 'Rate (Hz)', 0.1, 10, 2, 0.1), s('low', 'Low (Hz)', 100, 2000, 350), s('high', 'High (Hz)', 500, 6000, 2500), s('q', 'Resonance', 0.5, 20, 6, 0.1), mix(100)],
        build: (c, p) => { const b = biquad(c, 'bandpass', (p.low + p.high) / 2, p.q); lfo(c, p.rate, Math.abs(p.high - p.low) / 2, b.frequency); return mixWrap(c, chain(b, gainNode(c, 2)), p.mix / 100); } },
      'Formant Filter': { params: [sel('vowel', 'Vowel', ['A', 'E', 'I', 'O', 'U']), s('q', 'Resonance', 1, 30, 8, 0.1), mix(80)],
        build: (c, p) => { const F = [[800, 1150, 2900], [400, 1600, 2700], [350, 1700, 2700], [450, 800, 2830], [325, 700, 2530]][p.vowel | 0]; return mixWrap(c, parallel(c, F.map((f, k) => chain(biquad(c, 'bandpass', f, p.q), gainNode(c, [1.6, 1.2, 0.8][k])))), p.mix / 100); } },
    },
    'Modulation': {
      'Tremolo': { params: [s('rate', 'Rate (Hz)', 0.1, 20, 5, 0.1), s('depth', 'Depth (%)', 0, 100, 50)],
        build: (c, p) => { const g = gainNode(c, 1 - p.depth / 200); lfo(c, p.rate, p.depth / 200, g.gain); return chain(g); } },
      'Auto Pan': { params: [s('rate', 'Rate (Hz)', 0.05, 10, 0.5, 0.05), s('depth', 'Width (%)', 0, 100, 80)],
        build: (c, p) => { const i = stereoIn(c), sp = c.createStereoPanner(); sp.pan.value = 0; i.connect(sp); lfo(c, p.rate, p.depth / 100, sp.pan); return { input: i, output: sp }; } },
      'Vibrato': { params: [s('rate', 'Rate (Hz)', 0.5, 12, 5, 0.1), s('depth', 'Depth (%)', 0, 100, 30)],
        build: (c, p) => { const d = delayLine(c, 0.006, 0.05); lfo(c, p.rate, 0.004 * p.depth / 100, d.delayTime); return chain(d); } },
      'Ring Modulator': { params: [s('freq', 'Frequency (Hz)', 1, 2000, 120), mix(60)],
        build: (c, p) => { const g = c.createGain(); g.gain.value = 0; const o = c.createOscillator(); o.frequency.value = p.freq; o.connect(g.gain); o.start(); return mixWrap(c, { input: g, output: g }, p.mix / 100); } },
      'Rotary Speaker': { params: [sel('speed', 'Speed', ['Slow (Chorale)', 'Fast (Tremolo)']), s('depth', 'Depth (%)', 0, 100, 60)],
        build: (c, p) => { const r = p.speed >= 1 ? 6.7 : 0.8; const i = stereoIn(c), d = delayLine(c, 0.004, 0.02), g = gainNode(c, 1 - p.depth / 400), sp = c.createStereoPanner(); i.connect(d); d.connect(g); g.connect(sp);
          lfo(c, r, 0.0015 * p.depth / 100, d.delayTime); lfo(c, r, p.depth / 400, g.gain); lfo(c, r, 0.6 * p.depth / 100, sp.pan); return { input: i, output: sp }; } },
      'Ensemble': { params: [s('voices', 'Voices', 2, 6, 3, 1), s('depth', 'Depth (%)', 0, 100, 40), s('spread', 'Stereo Spread (%)', 0, 100, 70), mix(50)],
        build: (c, p) => { const n = p.voices | 0; const br = Array.from({ length: n }, (_, k) => { const d = delayLine(c, 0.012 + k * 0.004, 0.05), sp = c.createStereoPanner(); sp.pan.value = ((k / Math.max(1, n - 1)) * 2 - 1) * p.spread / 100; d.connect(sp); lfo(c, 0.3 + k * 0.17, 0.003 * p.depth / 100, d.delayTime); return { input: d, output: sp }; });
          const pr = parallel(c, br); const o = gainNode(c, 1.5 / n); pr.output.connect(o); return mixWrap(c, { input: pr.input, output: o }, p.mix / 100); } },
    },
    'Reverb': {
      'Room Reverb': { params: [s('decay', 'Decay (s)', 0.1, 3, 0.6, 0.05), s('preDelay', 'Pre-delay (ms)', 0, 100, 5), s('wet', 'Wet (%)', 0, 100, 25)], build: (c, p) => verb(c, p, { decay: 3, early: 0.007, seed: 11 }, [biquad(c, 'lowpass', 7000, 0.7)]) },
      'Hall Reverb': { params: [s('decay', 'Decay (s)', 0.5, 10, 2.8, 0.1), s('preDelay', 'Pre-delay (ms)', 0, 200, 35), s('wet', 'Wet (%)', 0, 100, 30)], build: (c, p) => verb(c, p, { decay: 2.2, early: 0.019, seed: 23 }, [biquad(c, 'lowpass', 6000, 0.7)]) },
      'Plate Reverb': { params: [s('decay', 'Decay (s)', 0.3, 6, 1.8, 0.1), s('preDelay', 'Pre-delay (ms)', 0, 100, 0), s('wet', 'Wet (%)', 0, 100, 30)], build: (c, p) => verb(c, p, { decay: 1.8, seed: 37 }, [biquad(c, 'highpass', 300, 0.7), biquad(c, 'highshelf', 5000, 0.7, 3)]) },
      'Spring Reverb': { params: [s('decay', 'Decay (s)', 0.3, 5, 1.6, 0.1), s('boing', 'Spring Tone', 0, 100, 50), s('wet', 'Wet (%)', 0, 100, 30)], build: (c, p) => verb(c, p, { decay: 2, seed: 41 }, [biquad(c, 'bandpass', 1800, 0.8), biquad(c, 'peaking', 2500, 4, p.boing / 6), gainNode(c, 1.6)]) },
      'Cathedral Reverb': { params: [s('decay', 'Decay (s)', 2, 15, 6, 0.1), s('preDelay', 'Pre-delay (ms)', 0, 250, 60), s('wet', 'Wet (%)', 0, 100, 35)], build: (c, p) => verb(c, p, { decay: 1.6, early: 0.033, seed: 53 }, [biquad(c, 'lowpass', 4500, 0.7)]) },
      'Reverse Reverb': { params: [s('decay', 'Length (s)', 0.2, 4, 1.2, 0.05), s('preDelay', 'Pre-delay (ms)', 0, 200, 0), s('wet', 'Wet (%)', 0, 100, 40)], build: (c, p) => verb(c, p, { decay: 2, reverse: true, seed: 67 }) },
      'Gated Reverb': { params: [s('decay', 'Gate Length (s)', 0.05, 1, 0.3, 0.01), s('preDelay', 'Pre-delay (ms)', 0, 100, 0), s('wet', 'Wet (%)', 0, 100, 40)], build: (c, p) => verb(c, p, { gate: 0.98, seed: 71 }, [biquad(c, 'highpass', 200, 0.7)]) },
    },
    'Special': {
      'Saturation': { params: [s('drive', 'Drive', 0, 100, 30), s('warmth', 'Warmth (dB)', -6, 12, 2, 0.5), mix(100)],
        build: (c, p) => mixWrap(c, chain(gainNode(c, db(p.drive / 6)), curveShaper(c, (x) => Math.tanh(x * 1.5) / Math.tanh(1.5)), biquad(c, 'lowshelf', 250, 0.7, p.warmth), gainNode(c, db(-p.drive / 8))), p.mix / 100) },
      'Overdrive': { params: [s('drive', 'Drive', 0, 100, 50), s('tone', 'Tone (Hz)', 800, 12000, 3500), s('out', 'Output (dB)', -24, 6, -6, 0.5)],
        build: (c, p) => chain(biquad(c, 'highpass', 100, 0.7), gainNode(c, db(p.drive / 4)), curveShaper(c, (x) => (x > 0 ? 1 - Math.exp(-x * 2) : -1 + Math.exp(x * 1.6))), biquad(c, 'lowpass', p.tone, 0.7), gainNode(c, db(p.out))) },
      'Fuzz': { params: [s('fuzz', 'Fuzz', 0, 100, 70), s('tone', 'Tone (Hz)', 500, 8000, 2500), s('out', 'Output (dB)', -30, 0, -12, 0.5)],
        build: (c, p) => chain(gainNode(c, db(p.fuzz / 3)), curveShaper(c, (x) => Math.sign(x) * Math.min(1, Math.abs(x) * 4)), biquad(c, 'lowpass', p.tone, 0.9), gainNode(c, db(p.out))) },
      'Bitcrusher': { params: [s('bits', 'Bit Depth', 2, 16, 8, 1), s('rate', 'Sample Rate Reduction', 1, 50, 1, 1), mix(100)],
        build: (c, p) => { const nodes = [curveShaper(c, crush(p.bits | 0), 8192)]; if (p.rate > 1) nodes.push(biquad(c, 'lowpass', Math.max(500, c.sampleRate / 2 / p.rate), 0.7)); return mixWrap(c, chain(...nodes), p.mix / 100); } },
      'Lo-Fi': { params: [s('bits', 'Bit Depth', 4, 16, 10, 1), s('bandwidth', 'Bandwidth (Hz)', 1000, 16000, 5000), s('noise', 'Noise', 0, 100, 15), s('wobble', 'Wobble', 0, 100, 20)],
        build: (c, p) => { const d = delayLine(c, 0.005, 0.05); lfo(c, 0.6, 0.0006 * p.wobble / 50, d.delayTime); const dry = chain(biquad(c, 'highpass', 150, 0.7), d, curveShaper(c, crush(p.bits | 0), 8192), biquad(c, 'lowpass', p.bandwidth, 0.7));
          return addNoise(c, dry, chain(noiseSource(c, 5), biquad(c, 'lowpass', 4000, 0.7)).output, p.noise / 2000); } },
      'Vinyl': { params: [s('crackle', 'Crackle', 0, 100, 40), s('hiss', 'Hiss', 0, 100, 20), s('warmth', 'Warmth', 0, 100, 50), s('wow', 'Wow', 0, 100, 15)],
        build: (c, p) => { const d = delayLine(c, 0.004, 0.05); lfo(c, 0.55, 0.0005 * p.wow / 50, d.delayTime); const dry = chain(d, biquad(c, 'lowshelf', 150, 0.7, p.warmth / 20), biquad(c, 'lowpass', 12000 - p.warmth * 60, 0.7));
          const cr = c.createBufferSource(); const n = c.sampleRate * 3; const b = c.createBuffer(1, n, c.sampleRate); const r = seededRandom(9); const dd = b.getChannelData(0); for (let i = 0; i < n; i++) dd[i] = r() < 0.00025 * (1 + p.crackle / 25) ? (r() * 2 - 1) : 0; cr.buffer = b; cr.loop = true; cr.start();
          const mixd = addNoise(c, dry, cr, p.crackle / 120); return addNoise(c, mixd, chain(noiseSource(c, 13), biquad(c, 'highpass', 3000, 0.7)).output, p.hiss / 4000); } },
      'Telephone': { params: [s('band', 'Narrowness', 0, 100, 50), s('drive', 'Distortion', 0, 100, 20)],
        build: (c, p) => chain(biquad(c, 'highpass', 250 + p.band * 2, 0.9), biquad(c, 'lowpass', 3800 - p.band * 10, 0.9), curveShaper(c, (x) => Math.tanh(x * (1 + p.drive / 15))), gainNode(c, 1.4)) },
      'Walkie-Talkie': { params: [s('static', 'Static', 0, 100, 25), s('drive', 'Distortion', 0, 100, 40)],
        build: (c, p) => addNoise(c, chain(biquad(c, 'highpass', 600, 1), biquad(c, 'lowpass', 2800, 1), comp(c, -30, 10, 0.002, 0.08), curveShaper(c, (x) => Math.tanh(x * (1 + p.drive / 10))), gainNode(c, 1.2)), chain(noiseSource(c, 21), biquad(c, 'bandpass', 2000, 0.8)).output, p.static / 1500) },
      'Underwater': { params: [s('depth', 'Depth', 0, 100, 60), s('wobble', 'Wobble', 0, 100, 40)],
        build: (c, p) => { const d = delayLine(c, 0.008, 0.05); lfo(c, 0.35, 0.002 * p.wobble / 50, d.delayTime); const lp = biquad(c, 'lowpass', 2000 - p.depth * 17, 1.2); return chain(d, lp, biquad(c, 'peaking', 300, 1, p.depth / 10), gainNode(c, 1 + p.depth / 200)); } },
      'Exciter': { params: [s('freq', 'Frequency (Hz)', 1000, 12000, 4000), s('amount', 'Harmonics', 0, 100, 30)],
        build: (c, p) => { const h = chain(biquad(c, 'highpass', p.freq, 0.7), curveShaper(c, (x) => Math.tanh(x * 4)), gainNode(c, p.amount / 150)); const i = c.createGain(), o = c.createGain(); i.connect(o); i.connect(h.input); h.output.connect(o); return { input: i, output: o }; } },
      'Sub Bass Enhancer': { params: [s('freq', 'Frequency (Hz)', 30, 150, 70), s('amount', 'Amount', 0, 100, 40)],
        build: (c, p) => { const h = chain(biquad(c, 'lowpass', p.freq * 1.6, 0.7), curveShaper(c, (x) => Math.abs(x) * 1.5 - 0.3), biquad(c, 'lowpass', p.freq, 0.9), biquad(c, 'highpass', 25, 0.7), gainNode(c, p.amount / 60)); const i = c.createGain(), o = c.createGain(); i.connect(o); i.connect(h.input); h.output.connect(o); return { input: i, output: o }; } },
      'Noise Gate': { params: [s('threshold', 'Threshold (dB)', -80, 0, -45), s('reduction', 'Reduction', 0, 100, 60)],
        build: (c, p) => chain(comp(c, p.threshold + 20, 1, 0.003, 0.2, 0), comp(c, p.threshold, 1 + p.reduction / 10, 0.002, 0.15, 30)) },
    },
    'Stereo Imagery': {
      'Fill Left with Right': { params: [], build: (c) => matrix(c, 0, 1, 0, 1) },
      'Fill Right with Left': { params: [], build: (c) => matrix(c, 1, 0, 1, 0) },
      'Swap Channels': { params: [], build: (c) => matrix(c, 0, 1, 1, 0) },
      'Mono Maker': { params: [s('below', 'Mono Below (Hz) (0 = all)', 0, 500, 0)],
        build: (c, p) => { if (!p.below) return matrix(c, 0.5, 0.5, 0.5, 0.5); const lo = chain(biquad(c, 'lowpass', p.below, 0.7)); const loM = matrix(c, 0.5, 0.5, 0.5, 0.5); lo.output.connect(loM.input); const hi = chain(biquad(c, 'highpass', p.below, 0.7)); return parallel(c, [{ input: lo.input, output: loM.output }, hi]); } },
      'Stereo Expander': { params: [s('width', 'Width (%)', 0, 300, 150)],
        build: (c, p) => { const w = p.width / 100; const a = (1 + w) / 2, b = (1 - w) / 2; return matrix(c, a, b, b, a); } },
      'Haas Widener': { params: [s('delay', 'Delay (ms)', 1, 40, 12, 0.5), sel('side', 'Delayed Side', ['Right', 'Left']), mix(100)],
        build: (c, p) => { const i = stereoIn(c), sp = c.createChannelSplitter(2), m = c.createChannelMerger(2), d = delayLine(c, p.delay / 1000, 0.1); i.connect(sp); const del = p.side >= 1 ? 0 : 1; sp.connect(d, del); d.connect(m, 0, del); sp.connect(m, 1 - del, 1 - del); return mixWrap(c, { input: i, output: m }, p.mix / 100); } },
      'Channel Mixer': { params: [s('ll', 'Left from Left (%)', -100, 200, 100), s('lr', 'Left from Right (%)', -100, 200, 0), s('rl', 'Right from Left (%)', -100, 200, 0), s('rr', 'Right from Right (%)', -100, 200, 100)],
        build: (c, p) => matrix(c, p.ll / 100, p.lr / 100, p.rl / 100, p.rr / 100) },
    },
  };
}

/** Audio transition curves added in round 2 (gains of outgoing, incoming clip at progress p). */
export const MORE_CROSSFADES = {
  'Logarithmic Fade': (p) => [Math.sqrt(1 - p), Math.sqrt(p)],
  'S-Curve': (p) => { const g = p * p * (3 - 2 * p); return [1 - g, g]; },
  'Sine Fade': (p) => [(1 + Math.cos(Math.PI * p)) / 2, (1 - Math.cos(Math.PI * p)) / 2],
  'Dip to Silence': (p) => [Math.max(0, 1 - 2 * p), Math.max(0, 2 * p - 1)],
  'Quick Crossfade': (p) => { const g = Math.min(1, Math.max(0, (p - 0.4) / 0.2)); return [Math.cos(g * Math.PI / 2), Math.sin(g * Math.PI / 2)]; },
  'Fast Fade Out': (p) => [Math.pow(1 - p, 4), Math.sqrt(p)],
  'Fast Fade In': (p) => [Math.sqrt(1 - p), 1 - Math.pow(1 - p, 4)],
  'Early Crossfade': (p) => { const g = Math.min(1, p * 2); return [Math.cos(g * Math.PI / 2), Math.sin(g * Math.PI / 2)]; },
  'Late Crossfade': (p) => { const g = Math.max(0, p * 2 - 1); return [Math.cos(g * Math.PI / 2), Math.sin(g * Math.PI / 2)]; },
};
