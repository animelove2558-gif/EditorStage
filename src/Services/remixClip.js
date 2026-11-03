// Remix on the timeline: analyse a clip's music once per file (cached by content hash in memory and in
// userData/remix-cache, so a copy of the same file is never analysed again), plan the remix for a target duration
// (instant from the cache) and store it on the clip as `clip.remix` (one undo step). Playback and export render the
// remix through the retimed-audio path (src/Services/retimedAudio.js), so Preview = Export.
//   clip.remix = { targetDur, range: [r0, r1] (source s), segments: [{ srcIn, srcOut }], params: { segments, variations, xfade (ms) }, hash, cost }
import { getState, edit } from '../Core/store';
import * as ed from '../Core/editing';
import { mediaById, mediaUrl } from './media';
import { runDsp } from './dsp';
import { planRemix, analysisToJson, analysisFromJson, REMIX_DEFAULTS } from './remix';
import { isRetimed } from '../Core/clipTime';

const SR = 22050; // analysis rate
const mem = new Map(); // content hash -> analysis
const inflight = new Map(); // content hash -> Promise<analysis>
const hashOf = new Map(); // `${media.id}@${rev}` -> Promise<hash>
export const remixStats = { analyses: 0, diskHits: 0, memHits: 0 }; // tests: a file already analysed is never analysed again
let job = null;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function cacheDir() { const d = await window.editorstage?.userData?.(); return d ? `${d}/remix-cache` : null; }

/** SHA-256 of the file's bytes (two copies of one file share it) and the bytes themselves when they had to be read. */
async function contentHash(media) {
  const key = `${media.id}@${media.rev || 0}`;
  if (!hashOf.has(key)) hashOf.set(key, (async () => { const bytes = await (await fetch(mediaUrl(media))).arrayBuffer(); return { hash: hex(await crypto.subtle.digest('SHA-256', bytes)), bytes }; })());
  const p = hashOf.get(key); p.catch(() => hashOf.delete(key));
  return p;
}

/** Beat / feature analysis of a media file (cached). onProgress(0..1, label). Rejects with the NoBeat message for non-music. */
export async function analyzeMedia(media, onProgress = () => {}) {
  if (media.synthetic) throw new Error('Remix works on music files');
  onProgress(0, 'Reading file');
  const { hash, bytes } = await contentHash(media);
  if (mem.has(hash)) { remixStats.memHits++; return { hash, an: mem.get(hash), cached: 'memory' }; }
  if (inflight.has(hash)) return { hash, an: await inflight.get(hash), cached: 'shared' };
  const p = (async () => {
    const dir = await cacheDir();
    if (dir) { try { const an = analysisFromJson(JSON.parse(await window.editorstage.readText(`${dir}/${hash}.json`))); if (an.version === 1) { remixStats.diskHits++; return an; } } catch { /* not cached yet */ } }
    onProgress(0.02, 'Decoding audio');
    const ab = await new OfflineAudioContext(1, 1, SR).decodeAudioData(bytes.slice(0));
    const pcm = new Float32Array(ab.length); for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < d.length; i++) pcm[i] += d[i] / ab.numberOfChannels; }
    remixStats.analyses++;
    job = runDsp('remixAnalyze', { pcm, sr: SR }, { onProgress: (x) => onProgress(0.05 + 0.95 * x, 'Analysing beats'), transfer: [pcm.buffer] });
    const an = await job.finally(() => { job = null; });
    if (dir) { try { await window.editorstage.mkdir(dir); await window.editorstage.writeFile(`${dir}/${hash}.json`, JSON.stringify(analysisToJson(an))); } catch { /* read-only profile: memory cache only */ } }
    return an;
  })();
  inflight.set(hash, p);
  try { const an = await p; mem.set(hash, an); return { hash, an, cached: false }; } finally { inflight.delete(hash); }
}
/** Stop a running analysis (the worker is restarted). */
export function cancelRemix() { job?.cancel(); }

/** Why a clip cannot be remixed, or null. */
export function remixProblem(seq, c) {
  if (!c) return 'Select a clip';
  if (seq.tracks.find((t) => t.id === c.track)?.kind !== 'audio') return 'Remix works on audio clips (music on an audio track)';
  const m = c.mediaId && mediaById(c.mediaId); if (!m || (m.kind !== 'audio' && m.kind !== 'video') || m.synthetic) return 'Remix needs a music file';
  if (m.status === 'offline') return 'The media is offline';
  if (isRetimed(c) || c.timeRemap?.speed?.keys?.length) return 'Remix works on clips at 100% speed (reset Speed / Duration first)';
  if (c.linkId && seq.clips.some((x) => x.linkId === c.linkId && x.id !== c.id && seq.tracks.find((t) => t.id === x.track)?.kind !== 'audio')) return 'Unlink the music from its video first (Clip > Unlink)';
  return null;
}
/** The source range a clip's remix works on (kept from the first remix, so remixing again starts from the original music). */
export const remixRange = (c) => c.remix?.range || [c.inPoint || 0, (c.inPoint || 0) + c.dur];

/**
 * Remix a clip to about `target` seconds (one undo step). The clip's length becomes the remix's length (within a beat of
 * the target); a longer clip overwrites what follows it on its track. Returns { dur, segments, cost, cached }.
 */
export async function remixClip(clipId, target, params = {}, onProgress) {
  const s = getState(); const c = s.sequence.clips.find((x) => x.id === clipId);
  const why = remixProblem(s.sequence, c); if (why) throw new Error(why);
  const media = mediaById(c.mediaId); const { hash, an, cached } = await analyzeMedia(media, onProgress);
  const range = remixRange(c); const p = { ...REMIX_DEFAULTS, ...(c.remix?.params || {}), ...params };
  const plan = planRemix(an, range, Math.max(1, target), p);
  edit('Remix', ({ seq }) => {
    const x = seq.clips.find((q) => q.id === clipId); if (!x) return; const oldEnd = x.start + x.dur;
    x.inPoint = range[0];
    if (plan.segments.length === 1) { delete x.remix; x.dur = range[1] - range[0]; } // back to the original music
    else { x.remix = { targetDur: target, range, segments: plan.segments, params: p, hash, cost: +plan.cost.toFixed(3) }; x.dur = plan.dur; }
    if (x.start + x.dur > oldEnd) ed.overwriteRange(seq, x.track, oldEnd, x.start + x.dur, [x.id]);
    ed.fixTransitions(seq);
  });
  onProgress?.(1, 'Done');
  return { dur: plan.dur, segments: plan.segments, cost: plan.cost, cached, bpm: an.bpm };
}
/** Remove a clip's remix: the original music range again. */
export function unremixClip(clipId) {
  const c = getState().sequence.clips.find((x) => x.id === clipId); if (!c?.remix) return;
  edit('Remove Remix', ({ seq }) => { const x = seq.clips.find((q) => q.id === clipId); const [r0, r1] = x.remix.range; delete x.remix; x.inPoint = r0; const oldEnd = x.start + x.dur; x.dur = r1 - r0; if (x.start + x.dur > oldEnd) ed.overwriteRange(seq, x.track, oldEnd, x.start + x.dur, [x.id]); ed.fixTransitions(seq); });
}
/** Clip-local times of the remix cuts (the zigzags on the timeline clip). */
export const remixCuts = (c) => { if (!c.remix?.segments) return []; let u = 0; return c.remix.segments.slice(0, -1).map((s) => (u += s.srcOut - s.srcIn)); };
