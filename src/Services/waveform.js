import { mediaUrl } from './media';
import { audioContext } from './audioEngine';

// Peak cache per media item (and file revision): 200 buckets/second, decoded once.
const cache = new Map();
export function peaksFor(media) {
  const key = `${media.id}:${media.rev || 0}`;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    const buf = await (await fetch(mediaUrl(media))).arrayBuffer();
    const ab = await audioContext().decodeAudioData(buf);
    const per = 200, n = Math.max(1, Math.ceil(ab.duration * per)), out = new Float32Array(n);
    const ch = ab.getChannelData(0), step = Math.max(1, Math.floor(ab.length / n));
    for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step; j < Math.min(ab.length, (i + 1) * step); j += 8) m = Math.max(m, Math.abs(ch[j])); out[i] = m; }
    return { out, per };
  })().catch(() => null);
  cache.set(key, p); return p;
}
export const clearPeaks = (mediaId) => { for (const k of [...cache.keys()]) if (k.startsWith(`${mediaId}:`)) cache.delete(k); };
