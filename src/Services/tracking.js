// Mask Tracking (Track Forward / Backward / one frame) and the Point Tracker (a title, sticker or any clip follows an object).
// Frames are decoded by FFmpeg (grayscale, small), the tracker runs in the DSP worker, and the result is written as
// ordinary keyframes (mask path / Motion), so it can be edited, undone and saved like any other animation.
import { getState, set, edit } from '../Core/store';
import { evalParam, resolveParams, DEFAULT_MOTION, frameScaled } from '../Core/params';
import { sourceAt } from '../Core/clipTime';
import { applySim } from './tracker';
import { runDsp } from './dsp';

export const TRACK_METHODS = { position: 'Position', rotation: 'Position & Rotation', full: 'Position, Scale & Rotation' };

/** Source uv <-> sequence uv (both y down) through a resolved Motion (same math as the Compositor's draw pass). */
export function motionMap(mo, sa, fa) {
  const ws = sa >= fa ? fa : sa, hs = sa >= fa ? fa / sa : 1;
  const sc = mo.scale / 100, sw = mo.uniform === false ? mo.scaleW / 100 : sc;
  const r = (mo.rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const ax = mo.anchor[0], ayU = 1 - mo.anchor[1], px = mo.position[0], pyU = 1 - mo.position[1];
  return {
    toSeq: ([x, y]) => { const qx = (x - ax) * ws * sw, qy = (1 - y - ayU) * hs * sc; return [px + (qx * c - qy * s) / fa, 1 - (pyU + qx * s + qy * c)]; },
    toSrc: ([X, Y]) => { const rx = (X - px) * fa, ry = 1 - Y - pyU; const qx = rx * c + ry * s, qy = -rx * s + ry * c; return [ax + qx / (ws * sw), 1 - (ayU + qy / (hs * sc))]; },
  };
}
const motionAt = (clip, local) => Object.fromEntries(Object.entries({ ...DEFAULT_MOTION(), ...(clip.motion || {}) }).map(([k, p]) => [k, evalParam(p, local)]));
const mapFor = (clip, media, seq, local) => motionMap(frameScaled(motionAt(clip, local), clip, media.width, media.height, seq.width, seq.height), (media.width || seq.width) / (media.height || seq.height), seq.width / seq.height);

let job = null; // { cancelled, dsp }
export function cancelTracking() { if (!job) return; job.cancelled = true; job.dsp?.cancel?.(); }
const progress = (label, p) => set({ tracking: p == null ? null : { label, p } });

/**
 * Timeline frames from `t0` in direction dir (+1/-1) inside the clip, their source frames decoded to gray8 (in travel order).
 * Returns { frames, w, h, times } (times[k] = sequence time of frames[k]).
 */
async function decodeFrames(clip, media, t0, dir, count) {
  const seq = getState().sequence; const fps = seq.fps || 30; const mfps = media.fps || fps;
  const end = clip.start + clip.dur - 1e-6; const times = [];
  for (let k = 0; k <= count; k++) { const t = t0 + (dir * k) / fps; if (t < clip.start - 1e-6 || t > end) break; times.push(t); }
  if (times.length < 2) throw new Error(dir > 0 ? 'Already at the end of the clip' : 'Already at the start of the clip');
  // source frame numbers (the frame whose interval contains the source time, like the preview element shows)
  const fr = times.map((t) => Math.floor(sourceAt(clip, t, mfps, media.duration) * mfps + 1e-6));
  const f0 = Math.min(...fr), f1 = Math.max(...fr);
  const sw = media.width || seq.width, sh = media.height || seq.height; const k = Math.min(1, 480 / Math.max(sw, sh));
  const w = Math.max(16, Math.round((sw * k) / 2) * 2), h = Math.max(16, Math.round((sh * k) / 2) * 2);
  const tmp = await window.editorstage.tmpDir(); const out = `${tmp}${tmp.includes('\\') ? '\\' : '/'}editorstage-track-${Date.now()}.gray`;
  // accurate seek: the first decoded frame is the first one at or after the seek point = frame f0
  const r = await window.editorstage.ffmpeg(['-v', 'error', '-y', '-ss', ((f0 - 0.25) / mfps).toFixed(5), '-i', media.path || media.playPath, '-frames:v', String(f1 - f0 + 1), '-an',
    '-vf', `scale=${w}:${h}:flags=area,format=gray`, '-fps_mode', 'passthrough', '-f', 'rawvideo', out]);
  if (!r.ok) throw new Error(r.error || 'FFmpeg could not decode the clip');
  const raw = new Uint8Array(await window.editorstage.readFile(out)); window.editorstage.removeFile(out).catch(() => {});
  const avail = Math.floor(raw.length / (w * h)); if (!avail) throw new Error('No frames decoded');
  const frames = new Uint8Array(times.length * w * h);
  fr.forEach((f, i) => { const j = Math.min(avail - 1, Math.max(0, f - f0)); frames.set(raw.subarray(j * w * h, (j + 1) * w * h), i * w * h); });
  return { frames, w, h, times };
}

async function runTrack(label, clip, media, t0, dir, count, region, mode) {
  if (job) throw new Error('A tracking job is already running');
  job = { cancelled: false }; const me = job;
  try {
    progress(label, 0);
    const d = await decodeFrames(clip, media, t0, dir, count); if (me.cancelled) throw new Error('Cancelled');
    const reg = region.map(([x, y]) => [x * d.w, y * d.h]);
    me.dsp = runDsp('track', { frames: d.frames, w: d.w, h: d.h, start: 0, dir: 1, count: d.times.length - 1, region: reg, mode }, { onProgress: (p) => progress(label, p), transfer: [d.frames.buffer] });
    const res = await me.dsp;
    // T maps start-frame pixels to frame i: express it in source uv
    const toUv = (T) => (p) => { const q = applySim(T, [p[0] * d.w, p[1] * d.h]); return [q[0] / d.w, q[1] / d.h]; };
    return { steps: res.map(({ i, T }) => ({ t: d.times[i], map: toUv(T), scale: Math.hypot(T.a, T.b), angle: Math.atan2(T.b, T.a) })), wanted: d.times.length - 1 };
  } finally { job = null; progress(label, null); }
}
const replaceKeys = (p, keys, lo, hi) => {
  const old = (p?.keys || []).filter((k) => k.t < lo - 1e-6 || k.t > hi + 1e-6);
  return { v: keys[0]?.v ?? p?.v, keys: [...old, ...keys].sort((a, b) => a.t - b.t) };
};
function trackable(clip) {
  const m = clip && clip.mediaId && getState().media.find((x) => x.id === clip.mediaId);
  if (!m || m.kind !== 'video' || m.synthetic) throw new Error('Tracking needs a video clip (render nested sequences or graphics first)');
  return m;
}
const ellipsePoly = (c, s) => Array.from({ length: 16 }, (_, i) => [c[0] + (s[0] / 2) * Math.cos((i * Math.PI) / 8), c[1] + (s[1] / 2) * Math.sin((i * Math.PI) / 8)]);

/** Track one mask of a clip. dir: +1 / -1, count: frames (1 = frame by frame, Infinity = to the clip edge). */
export async function trackMask(clipId, maskId, dir, count = Infinity, mode = 'full') {
  const s = getState(); const seq = s.sequence; const clip = seq.clips.find((c) => c.id === clipId); const media = trackable(clip);
  const mask = clip.masks?.find((m) => m.id === maskId); if (!mask) throw new Error('Mask not found');
  const fps = seq.fps || 30; const t0 = Math.min(clip.start + clip.dur - 1 / fps, Math.max(clip.start, Math.round(s.playhead * fps) / fps));
  const l0 = t0 - clip.start; const mp = resolveParams(mask.params, l0); const m0 = mapFor(clip, media, seq, l0);
  const ell = mask.type === 'ellipse';
  const shape = ell ? ellipsePoly(mp.center, mp.size) : mp.points; // sequence uv
  const srcShape = shape.map(m0.toSrc); const srcCenter = ell ? m0.toSrc(mp.center) : null;
  const n = Math.min(count, Math.ceil(clip.dur * fps) + 1);
  const r = await runTrack(`Tracking ${ell ? 'Ellipse' : 'Polygon'} Mask ${dir > 0 ? 'forward' : 'backward'}`, clip, media, t0, dir, n, srcShape, mode);
  if (!r.steps.length) throw new Error('Could not find trackable detail inside the mask');
  edit(`Track Mask ${dir > 0 ? 'Forward' : 'Backward'}`, ({ seq: sq }) => {
    const c = sq.clips.find((x) => x.id === clipId); const mk = c.masks.find((x) => x.id === maskId);
    const at = (t) => mapFor(c, media, sq, t - c.start);
    const steps = [{ t: t0, map: (p) => p, scale: 1 }, ...r.steps];
    const ts = steps.map((x) => x.t - c.start); const lo = Math.min(...ts), hi = Math.max(...ts);
    if (ell) {
      mk.params.center = replaceKeys(mk.params.center, steps.map((x) => ({ t: x.t - c.start, v: at(x.t).toSeq(x.map(srcCenter)) })), lo, hi);
      if (mode === 'full') mk.params.size = replaceKeys(mk.params.size, steps.map((x) => ({ t: x.t - c.start, v: [mp.size[0] * x.scale, mp.size[1] * x.scale] })), lo, hi);
    } else mk.params.points = replaceKeys(mk.params.points, steps.map((x) => ({ t: x.t - c.start, v: srcShape.map((p) => at(x.t).toSeq(x.map(p))) })), lo, hi);
  });
  return { tracked: r.steps.length, wanted: r.wanted };
}

/** Video clip under `follower` at time t that the Point Tracker follows by default (topmost lower video track). */
export function defaultTrackTarget(seq, follower, t) {
  const vids = seq.tracks.filter((x) => x.kind === 'video').map((x) => x.id); const fi = vids.indexOf(follower.track);
  const media = getState().media;
  return seq.clips.filter((c) => c.id !== follower.id && c.enabled !== false && !c.asAudio && t >= c.start && t < c.start + c.dur && vids.indexOf(c.track) > fi
    && media.find((m) => m.id === c.mediaId && m.kind === 'video' && !m.synthetic)).sort((a, b) => vids.indexOf(a.track) - vids.indexOf(b.track))[0] || null;
}

/**
 * Point Tracker: follow an object in `targetId` with clip `followerId`'s Motion.
 * opts: { point: [x, y] sequence uv at the playhead, box: tracked box size (fraction of the frame height), dir: 1 | -1 | 0 (both),
 *         scale, rotation (also follow scale / rotation), mode }
 */
export async function trackPoint(followerId, targetId, opts) {
  const s = getState(); const seq = s.sequence; const fps = seq.fps || 30;
  const F = seq.clips.find((c) => c.id === followerId); const V = seq.clips.find((c) => c.id === targetId); const media = trackable(V);
  if (!F) throw new Error('Select the clip that should follow');
  const lo = Math.max(F.start, V.start), hi = Math.min(F.start + F.dur, V.start + V.dur) - 1 / fps;
  if (hi <= lo) throw new Error('The two clips do not overlap in time');
  const t0 = Math.min(hi, Math.max(lo, Math.round(s.playhead * fps) / fps));
  const mv = mapFor(V, media, seq, t0 - V.start); const P = opts.point; const Psrc = mv.toSrc(P);
  const fa = seq.width / seq.height; const bh = (opts.box || 0.15) / 2, bw = bh / fa; // half box in sequence uv
  const region = [[P[0] - bw, P[1] - bh], [P[0] + bw, P[1] - bh], [P[0] + bw, P[1] + bh], [P[0] - bw, P[1] + bh]].map(mv.toSrc);
  const mode = opts.mode || (opts.rotation || opts.scale ? 'full' : 'position');
  const dirs = opts.dir === 0 ? [1, -1] : [opts.dir || 1]; const all = [];
  for (const dir of dirs) {
    const n = Math.round(((dir > 0 ? hi - t0 : t0 - lo) * fps)); if (n < 1) continue;
    const r = await runTrack(`Tracking point ${dir > 0 ? 'forward' : 'backward'}`, V, media, t0, dir, n, region, mode);
    all.push(...r.steps);
  }
  if (!all.length) throw new Error('Could not find trackable detail around the point');
  const base = motionAt(F, t0 - F.start);
  edit('Track Object', ({ seq: sq }) => {
    const c = sq.clips.find((x) => x.id === followerId); const vc = sq.clips.find((x) => x.id === targetId);
    c.motion = { ...DEFAULT_MOTION(), ...(c.motion || {}) };
    const steps = [{ t: t0, map: (p) => p, scale: 1, angle: 0 }, ...all].sort((a, b) => a.t - b.t);
    const ts = steps.map((x) => x.t - c.start); const a = Math.min(...ts), b = Math.max(...ts);
    c.motion.position = replaceKeys(c.motion.position, steps.map((x) => { const q = mapFor(vc, media, sq, x.t - vc.start).toSeq(x.map(Psrc)); return { t: x.t - c.start, v: [base.position[0] + q[0] - P[0], base.position[1] + q[1] - P[1]] }; }), a, b);
    if (opts.scale) c.motion.scale = replaceKeys(c.motion.scale, steps.map((x) => ({ t: x.t - c.start, v: base.scale * x.scale })), a, b);
    // tracker angles are clockwise on screen (y down); Motion rotation turns the other way
    if (opts.rotation) c.motion.rotation = replaceKeys(c.motion.rotation, steps.map((x) => ({ t: x.t - c.start, v: base.rotation - (x.angle * 180) / Math.PI })), a, b);
  });
  return { tracked: all.length };
}
