// File > New synthetic items (Premiere): Adjustment Layer, Color Matte, Bars and Tone, Black Video, Transparent Video and
// Universal Counting Leader. They are project items without a file: the picture is drawn on a canvas from media.synthetic
// and the sound (tone / cue blips) is a WAV generated in memory, so preview, export and a reopened project all regenerate
// exactly the same media.
import { getState } from '../Core/store';

export const SYNTHETIC_TYPES = {
  adjustment: { name: 'Adjustment Layer', kind: 'image' },
  color: { name: 'Color Matte', kind: 'image' },
  bars: { name: 'Bars and Tone', kind: 'video', duration: 120, audio: true },
  black: { name: 'Black Video', kind: 'image' },
  transparent: { name: 'Transparent Video', kind: 'image' },
  countdown: { name: 'Universal Counting Leader', kind: 'video', duration: 11, audio: true },
};
export const COUNTDOWN_DEFAULTS = { wipeColor: '#5a5a5a', bgColor: '#1e1e1e', lineColor: '#d0d0d0', targetColor: '#ffffff', numeralColor: '#ffffff', cueOut: false, cueOn2: true, cueAll: false };
const uid = () => Math.random().toString(36).slice(2, 9);

/** A new project item. spec: { type, width, height, fps, color?, name?, ...countdown options }. */
export function makeSyntheticMedia(spec) {
  const T = SYNTHETIC_TYPES[spec.type]; const seq = getState().sequence;
  const syn = { type: spec.type, width: spec.width || seq.width, height: spec.height || seq.height, fps: spec.fps || seq.fps || 30 };
  if (spec.type === 'color') syn.color = spec.color || '#000000';
  if (spec.type === 'countdown') Object.assign(syn, COUNTDOWN_DEFAULTS, Object.fromEntries(Object.keys(COUNTDOWN_DEFAULTS).filter((k) => spec[k] !== undefined).map((k) => [k, spec[k]])));
  return {
    id: uid(), name: spec.name || T.name, path: null, playPath: null, ext: '', kind: T.kind, synthetic: syn,
    duration: T.duration || 5, width: syn.width, height: syn.height, fps: T.kind === 'video' ? syn.fps : undefined,
    hasAudio: !!T.audio, status: 'ready', transcoded: false,
  };
}
export const isAdjustment = (m) => m?.synthetic?.type === 'adjustment';

// ---- picture ----
const BARS_TOP = ['#bfbfbf', '#bfbf00', '#00bfbf', '#00bf00', '#bf00bf', '#bf0000', '#0000bf']; // 75% SMPTE bars
const BARS_MID = ['#0000bf', '#131313', '#bf00bf', '#131313', '#00bfbf', '#131313', '#bfbfbf'];
function drawBars(g, w, h) {
  const bw = w / 7; const h1 = Math.round(h * 0.67), h2 = Math.round(h * 0.75);
  BARS_TOP.forEach((c, i) => { g.fillStyle = c; g.fillRect(Math.round(i * bw), 0, Math.ceil(bw) + 1, h1); });
  BARS_MID.forEach((c, i) => { g.fillStyle = c; g.fillRect(Math.round(i * bw), h1, Math.ceil(bw) + 1, h2 - h1); });
  // bottom row: -I, 100% white, +Q, black, PLUGE (-4% / 0 / +4%), black
  const q = w / 7 * 5 / 4; const row = [['#00214c', q], ['#ffffff', q], ['#32006a', q], ['#131313', q], ['#090909', bw / 3], ['#131313', bw / 3], ['#1d1d1d', bw / 3], ['#131313', bw]];
  let x = 0; for (const [c, ww] of row) { g.fillStyle = c; g.fillRect(Math.round(x), h2, Math.ceil(ww) + 1, h - h2); x += ww; }
}
/** Universal Counting Leader: 8 .. 2 with a clock-hand wipe each second, the "2" shown for one frame (2-pop), then black. */
function drawCountdown(g, w, h, syn, t) {
  const fps = syn.fps || 30; const f = Math.floor(t * fps + 1e-6); const sec = Math.floor(f / fps);
  if (sec >= 6 && !(sec === 6 && f % fps === 0)) { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); return; } // after the 2-pop: black
  const n = 8 - sec; const p = (f % fps) / fps; const cx = w / 2, cy = h / 2, R = Math.hypot(w, h);
  g.fillStyle = syn.bgColor; g.fillRect(0, 0, w, h);
  g.fillStyle = syn.wipeColor; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + p * 2 * Math.PI); g.closePath(); g.fill();
  const lw = Math.max(1, h / 180); g.strokeStyle = syn.lineColor; g.lineWidth = lw;
  g.beginPath(); g.moveTo(0, cy); g.lineTo(w, cy); g.moveTo(cx, 0); g.lineTo(cx, h); g.stroke();
  g.strokeStyle = syn.targetColor; g.lineWidth = lw * 2;
  for (const r of [0.36, 0.42]) { g.beginPath(); g.arc(cx, cy, h * r, 0, 2 * Math.PI); g.stroke(); }
  g.fillStyle = syn.numeralColor; g.font = `bold ${Math.round(h * 0.5)}px Arial, Helvetica, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), cx, cy + h * 0.02);
}
const canvases = new Map(); // key -> { cv, sig }
/** The canvas showing a synthetic item at source time t (null for adjustment layers). One canvas per clip key. */
export function syntheticCanvas(m, key, t = 0) {
  const syn = m.synthetic; if (!syn || syn.type === 'adjustment') return null;
  const w = Math.max(2, syn.width | 0), h = Math.max(2, syn.height | 0);
  const frame = syn.type === 'countdown' ? Math.floor(Math.max(0, t) * (syn.fps || 30) + 1e-6) : 0;
  const sig = JSON.stringify([syn, frame]);
  let e = canvases.get(key);
  if (!e) { const cv = document.createElement('canvas'); e = { cv, sig: null }; cv.__ver = 0; canvases.set(key, e); }
  if (e.sig !== sig) {
    const { cv } = e; if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    cv.naturalWidth = w; cv.naturalHeight = h; // the Source Monitor and texture upload read these like an <img>
    const g = cv.getContext('2d'); g.clearRect(0, 0, w, h);
    if (syn.type === 'color' || syn.type === 'black') { g.fillStyle = syn.type === 'black' ? '#000' : syn.color; g.fillRect(0, 0, w, h); }
    else if (syn.type === 'bars') drawBars(g, w, h);
    else if (syn.type === 'countdown') drawCountdown(g, w, h, syn, frame / (syn.fps || 30));
    e.sig = sig; cv.__ver++; // Compositor re-uploads only when the version changes
  }
  return e.cv;
}

// ---- sound ----
const SR = 48000;
/** Generated channels: Bars and Tone = 1 kHz at -12 dBFS; Counting Leader = 1-frame 1 kHz cue blips. */
export function syntheticAudio(m) {
  const syn = m.synthetic; const n = Math.round((m.duration || 0) * SR); const x = new Float32Array(n);
  if (syn.type === 'bars') { const a = Math.pow(10, -12 / 20); for (let i = 0; i < n; i++) x[i] = a * Math.sin((2 * Math.PI * 1000 * i) / SR); }
  if (syn.type === 'countdown') {
    const fps = syn.fps || 30; const blip = (t0) => { const i0 = Math.round(t0 * SR), i1 = Math.min(n, i0 + Math.round(SR / fps)); for (let i = i0; i < i1; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * (i - i0)) / SR); };
    if (syn.cueAll) for (let s = 0; s <= 6; s++) blip(s); else if (syn.cueOn2) blip(6);
    if (syn.cueOut) blip(Math.max(0, m.duration - 1 / fps));
  }
  return [x, x.slice()];
}
const urls = new Map(); // signature -> blob URL
/** Blob URL of the generated sound as a 16-bit stereo WAV (used wherever a file URL would be). */
export function syntheticAudioUrl(m) {
  const sig = JSON.stringify([m.synthetic, m.duration]); if (urls.has(sig)) return urls.get(sig);
  const [l, r] = syntheticAudio(m); const n = l.length; const b = new DataView(new ArrayBuffer(44 + n * 4));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); b.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 2, true);
  b.setUint32(24, SR, true); b.setUint32(28, SR * 4, true); b.setUint16(32, 4, true); b.setUint16(34, 16, true); str(36, 'data'); b.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) { b.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, l[i])) * 32767), true); b.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, r[i])) * 32767), true); }
  const u = URL.createObjectURL(new Blob([b.buffer], { type: 'audio/wav' })); urls.set(sig, u); return u;
}

/** Premiere's "Media Offline" frame for clips whose file is missing (same canvas for preview and export). */
const offline = new Map();
export function offlineCanvas(dims) {
  const w = Math.max(16, dims.w | 0), h = Math.max(16, dims.h | 0); const key = `${w}x${h}`;
  if (offline.has(key)) return offline.get(key);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.naturalWidth = w; cv.naturalHeight = h; cv.__ver = 1;
  const g = cv.getContext('2d'); g.fillStyle = '#7a1010'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff'; g.font = `bold ${Math.round(h / 12)}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Media Offline', w / 2, h / 2);
  offline.set(key, cv); return cv;
}
