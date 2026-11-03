// Auto Ducking (Premiere: Essential Sound > Music > Ducking > Generate Keyframes). The clips tagged with the "duck against"
// types are analysed (where their sound is really active, not just where the clips are) and Volume > Level keyframes are
// written on the music clips: dip by "Reduce By" with fades around each active stretch. The keyframes are ordinary
// keyframes, so they can be edited afterwards in Effect Controls or on the timeline.
import { getState, edit } from '../Core/store';
import { DEFAULT_VOLUME, evalParam } from '../Core/params';
import { clipPCM, audioClipsOf } from './ai/audioSource';

export const DUCK_DEFAULTS = { against: ['Dialogue'], sensitivity: 6, reduceBy: -15, fadeMs: 800 };
const SR = 8000; const WIN = 0.02; // analysis rate / window (s)
const HOLD = 0.5; // pauses shorter than this (s) do not bring the music back up
const MIN_ACTIVE = 0.12; // ignore clicks shorter than this (s)

/** Active stretches [[a, b], ...] (sequence seconds) of the clips with the given audio types (except `exclude` ids). sensitivity 0..10 (higher = quieter sounds count). */
export async function activeRanges(seq, against, sensitivity = DUCK_DEFAULTS.sensitivity, onProgress, exclude = []) {
  const clips = audioClipsOf(seq).filter((c) => !exclude.includes(c.id) && against.includes(c.audio?.tag || 'Untagged') && !seq.tracks.find((t) => t.id === c.track)?.muted);
  const raw = [];
  for (let k = 0; k < clips.length; k++) {
    const c = clips[k]; const pcm = await clipPCM(c, SR); const n = Math.round(WIN * SR); const lv = [];
    for (let i = 0; i + n <= pcm.length; i += n) { let s = 0; for (let j = i; j < i + n; j++) s += pcm[j] * pcm[j]; lv.push(10 * Math.log10(s / n + 1e-12)); }
    // threshold relative to the clip's loud passages, never below -50 dBFS
    const sorted = [...lv].sort((x, y) => x - y); const loud = sorted[Math.floor(sorted.length * 0.95)] ?? -100;
    const th = Math.max(-50, loud - (8 + 3 * sensitivity));
    let st = null;
    lv.forEach((v, i) => { const t = c.start + i * WIN; if (v >= th && st == null) st = t; else if (v < th && st != null) { raw.push([st, t]); st = null; } });
    if (st != null) raw.push([st, c.start + lv.length * WIN]);
    onProgress?.((k + 1) / clips.length);
  }
  raw.sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const r of raw) { const l = out[out.length - 1]; if (l && r[0] - l[1] < HOLD) l[1] = Math.max(l[1], r[1]); else out.push([...r]); }
  return out.filter(([a, b]) => b - a >= MIN_ACTIVE);
}

/** Level keyframes (clip-local times) dipping `reduceBy` dB under each range, fading over `fade` s. Existing keys inside the dips are replaced. */
export function duckKeys(clip, ranges, reduceBy, fade) {
  const vol = { ...DEFAULT_VOLUME(), ...(clip.volume || {}) }; const lvl = vol.level;
  const base = (lt) => evalParam(lvl, lt) ?? 0;
  const dips = [];
  for (const [a, b] of ranges) {
    const s = a - clip.start, e = b - clip.start; if (e <= 0 || s >= clip.dur) continue;
    const d0 = Math.max(0, s - fade), d1 = Math.min(clip.dur, e + fade);
    const l = dips[dips.length - 1]; if (l && d0 <= l[3]) { l[2] = e; l[3] = d1; } else dips.push([d0, s, e, d1]); // overlapping fades merge
  }
  if (!dips.length) return null;
  const keep = (lvl.keys || []).filter((k) => !dips.some(([d0, , , d1]) => k.t >= d0 - 1e-4 && k.t <= d1 + 1e-4));
  const keys = [...keep];
  for (const [d0, s, e, d1] of dips) {
    const down = Math.max(d0, s), up = Math.min(d1, e);
    if (d0 < down - 1e-4) keys.push({ t: d0, v: base(d0) });
    keys.push({ t: down, v: base(down) + reduceBy }, { t: up, v: base(up) + reduceBy });
    if (d1 > up + 1e-4) keys.push({ t: d1, v: base(d1) });
  }
  keys.sort((x, y) => x.t - y.t);
  return { ...lvl, keys: keys.map((k) => ({ ...k, t: +k.t.toFixed(4), v: +k.v.toFixed(2) })) };
}

/** Generate ducking keyframes on clips (default: the selected Music clips). opts as DUCK_DEFAULTS. Undoable; returns the number of dips. */
export async function generateDucking(clipIds, opts = {}, onProgress) {
  const o = { ...DUCK_DEFAULTS, ...opts }; const seq = getState().sequence;
  const targets = seq.clips.filter((c) => clipIds.includes(c.id));
  if (!targets.length) throw new Error('Select the music clips to duck');
  const ranges = await activeRanges(seq, o.against, o.sensitivity, onProgress, clipIds); // a music clip never ducks against itself
  let dips = 0;
  edit('Generate Ducking Keyframes', ({ seq: sq }) => {
    for (const id of clipIds) {
      const c = sq.clips.find((x) => x.id === id); if (!c) continue;
      const lvl = duckKeys(c, ranges, o.reduceBy, o.fadeMs / 1000); if (!lvl) continue;
      dips += lvl.keys.filter((k, i, a) => i > 0 && k.v < a[i - 1].v - 0.01).length;
      c.volume = { ...DEFAULT_VOLUME(), ...(c.volume || {}), level: lvl };
      c.audio = { ...(c.audio || {}), duck: false, ducking: { against: o.against, sensitivity: o.sensitivity, reduceBy: o.reduceBy, fadeMs: o.fadeMs } };
    }
  });
  return { ranges, dips };
}
