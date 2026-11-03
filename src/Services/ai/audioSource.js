// Decoded PCM for analysis (silence detection, speech-to-text, speaker diarization).
import { getState } from '../../Core/store';
import { mediaById, mediaUrl } from '../media';
import { sourceAt } from '../../Core/clipTime';

const cache = new Map(); // `${mediaId}:${rev}:${sr}` -> Promise<Float32Array mono>
/** Whole media file as mono Float32 at `sr` Hz (decodeAudioData resamples to the context rate). */
export function mediaPCM(media, sr = 16000) {
  const key = `${media.id}:${media.rev || 0}:${sr}`;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const buf = await (await fetch(mediaUrl(media))).arrayBuffer();
      const ctx = new OfflineAudioContext(1, 1, sr);
      const ab = await ctx.decodeAudioData(buf);
      const out = new Float32Array(ab.length);
      for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < d.length; i++) out[i] += d[i] / ab.numberOfChannels; }
      return out;
    })().catch((e) => { cache.delete(key); throw e; }));
    if (cache.size > 12) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

const isAudioClip = (seq, c) => { const tr = seq.tracks.find((t) => t.id === c.track); return tr && tr.kind === 'audio' && c.mediaId && c.enabled !== false; };
export const audioClipsOf = (seq, ids = null) => seq.clips.filter((c) => isAudioClip(seq, c) && (!ids || ids.includes(c.id)));

/** The portion of a clip as mono PCM, following the shared time model (speed, reverse, ramps, holds). */
export async function clipPCM(clip, sr = 16000) {
  const m = mediaById(clip.mediaId); if (!m) throw new Error('Clip has no media');
  const src = await mediaPCM(m, sr); const n = Math.max(0, Math.round(clip.dur * sr)); const out = new Float32Array(n);
  // source position every 10 ms, linear in between
  const step = Math.max(1, Math.round(sr / 100)); let a = sourceAt(clip, clip.start, 1e6, Infinity) * sr;
  for (let i0 = 0; i0 < n; i0 += step) {
    const b = sourceAt(clip, clip.start + Math.min(n, i0 + step) / sr, 1e6, Infinity) * sr;
    for (let i = i0; i < Math.min(n, i0 + step); i++) { const j = Math.round(a + ((b - a) * (i - i0)) / step); out[i] = j >= 0 && j < src.length ? src[j] : 0; }
    a = b;
  }
  return out;
}

/**
 * Mix of the audio clips of a sequence between timeline times [a, b) as mono PCM (track mute respected, clip gain ignored).
 * `ids` limits the mix to some clips.
 */
export async function sequencePCM(seq, a, b, sr = 16000, ids = null) {
  const n = Math.max(1, Math.ceil((b - a) * sr)); const out = new Float32Array(n);
  const muted = new Set(seq.tracks.filter((t) => t.muted).map((t) => t.id));
  for (const c of audioClipsOf(seq, ids)) {
    if (muted.has(c.track) || c.start >= b || c.start + c.dur <= a) continue;
    const pcm = await clipPCM(c, sr); const off = Math.round((c.start - a) * sr);
    for (let i = Math.max(0, -off); i < pcm.length && i + off < n; i++) out[i + off] += pcm[i];
  }
  return out;
}
export const timelineSpan = (seq, ids = null) => {
  const cs = audioClipsOf(seq, ids); if (!cs.length) return null;
  return [Math.min(...cs.map((c) => c.start)), Math.max(...cs.map((c) => c.start + c.dur))];
};
export const currentSeq = () => getState().sequence;
