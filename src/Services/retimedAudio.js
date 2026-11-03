// Audio of retimed clips (reverse, Speed/Duration, Time Remapping ramps, Time Warp) is rendered once per timing change into an
// AudioBuffer covering the clip's playing window (transition handles included). Playback (audioEngine) and export (exporter)
// both play that same buffer, so what you hear in the timeline is what gets exported.
import { getState } from '../Core/store';
import { rawSource, isRetimed } from '../Core/clipTime';
import { runDsp } from './dsp';
import { syntheticAudioUrl } from './synthetic';

const fileUrl = (p) => `es-media://local/${encodeURIComponent(p)}`;
const decoded = new Map(); // `${mediaId}@${rev}@${sr}` -> Promise<{ chans, sr }>
const rendered = new Map(); // signature -> Promise<{ chans, sr, w0 }>

/** Decoded source audio (per media + sample rate), as plain channel arrays. */
export function decodedSource(ctx, media) {
  const key = `${media.id}@${media.rev || 0}@${ctx.sampleRate}`;
  if (!decoded.has(key)) {
    decoded.set(key, (async () => {
      const ab = await ctx.decodeAudioData(await (await fetch(media.synthetic ? syntheticAudioUrl(media) : fileUrl(media.playPath) + (media.rev ? `?v=${media.rev}` : ''))).arrayBuffer());
      return { chans: Array.from({ length: Math.min(2, ab.numberOfChannels) }, (_, i) => ab.getChannelData(i).slice()), sr: ab.sampleRate };
    })());
    decoded.get(key).catch(() => decoded.delete(key));
    while (decoded.size > 12) decoded.delete(decoded.keys().next().value);
  }
  return decoded.get(key);
}

/** Sequence-time window in which the clip sounds (its transitions extend it by half their duration). */
export function clipWindow(seq, c) {
  let pre = 0, post = 0;
  for (const tr of seq.transitions || []) { if (tr.track !== c.track) continue; if (tr.bId === c.id) pre = Math.max(pre, tr.dur / 2); if (tr.aId === c.id) post = Math.max(post, tr.dur / 2); }
  return [c.start - pre, c.start + c.dur + post];
}
const timingSig = (seq, c, media, sr) => JSON.stringify([media.id, media.rev || 0, sr, clipWindow(seq, c), c.start, c.dur, c.inPoint, c.speed, c.reverse, c.maintainPitch, c.timeRemap?.speed, c.remix?.segments, c.remix?.params?.xfade,
  (c.effects || []).filter((e) => e.enabled && (e.name === 'Time Warp')).map((e) => e.params?.speed), c.frameHold]);
/** A remixed clip (Remix: music re-edited at matching beats) plays its rendered remix, like a retimed clip. */
export const isRemixed = (c) => !!c.remix?.segments?.length;
export const needsRetimedAudio = (c) => !c.frameHold?.on && (isRetimed(c) || isRemixed(c));

/**
 * Rendered audio for the clip's window: { chans: Float32Array[], sr, w0 } (w0 = sequence time of sample 0).
 * `ctx` decodes the source (its sampleRate is the render rate). Cached by timing signature.
 */
export function retimedAudio(ctx, seq, c, media) {
  const sr = ctx.sampleRate; const sig = timingSig(seq, c, media, sr);
  if (rendered.has(sig)) { const p = rendered.get(sig); rendered.delete(sig); rendered.set(sig, p); return p; }
  const p = (async () => {
    const src = await decodedSource(ctx, media);
    const [w0, w1] = clipWindow(seq, c); const n = Math.max(1, Math.ceil((w1 - w0) * sr));
    if (isRemixed(c)) { // the segments, joined by equal-power crossfades (src/Services/remix.js renderRemix), at the source rate
      const m = Math.max(1, Math.ceil((w1 - w0) * src.sr)); const chans = src.chans.map((x) => x.slice());
      const out = await runDsp('remixRender', { chans, sr: src.sr, segments: c.remix.segments, xfade: (c.remix.params?.xfade ?? 30) / 1000, pre: c.start - w0, n: m, srcOffset: 0 }, { transfer: chans.map((x) => x.buffer) });
      return { chans: out, sr: src.sr, w0 };
    }
    const step = Math.max(1, Math.round(sr / 240)); const cn = Math.ceil(n / step) + 2;
    const ctl = new Float64Array(cn); for (let k = 0; k < cn; k++) ctl[k] = rawSource(c, w0 + (k * step) / sr);
    // send only the part of the source that is read (plus a margin for the anti-alias / WSOLA search)
    let lo = Infinity, hi = -Infinity; for (const v of ctl) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const margin = 0.1; const s0 = Math.max(0, Math.floor((lo - margin) * src.sr)), s1 = Math.min(src.chans[0].length, Math.ceil((hi + margin) * src.sr));
    const chans = s1 > s0 ? src.chans.map((x) => x.slice(s0, s1)) : src.chans.map(() => new Float32Array(1));
    const off = s0 / src.sr; for (let k = 0; k < cn; k++) ctl[k] -= off;
    const out = await runDsp('retime', { chans, sr: src.sr, ctl, step, n, maintainPitch: !!c.maintainPitch }, { transfer: [...chans.map((x) => x.buffer), ctl.buffer] });
    return { chans: out, sr: src.sr, w0 };
  })();
  rendered.set(sig, p); p.catch(() => rendered.delete(sig));
  while (rendered.size > 24) rendered.delete(rendered.keys().next().value);
  return p;
}
/** AudioBuffer for an AudioContext / OfflineAudioContext from retimedAudio(). */
export function toAudioBuffer(ctx, r) {
  const b = ctx.createBuffer(Math.max(1, r.chans.length), r.chans[0].length, r.sr);
  r.chans.forEach((x, i) => b.copyToChannel(x, i));
  return b;
}
export const mediaFor = (c) => getState().media.find((m) => m.id === c.mediaId);
