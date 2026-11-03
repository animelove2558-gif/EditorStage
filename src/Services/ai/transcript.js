// Text-Based Editing (Premiere: Text panel > Transcript). Each source file is transcribed once (Whisper, offline) and the words
// are kept on the project item in SOURCE seconds (media.transcript). The sequence transcript is derived from the clips that use
// the file, so it follows every edit (trim, ripple, speed, reverse) and is saved with the project.
import { getState, edit } from '../../Core/store';
import { localAtSource, sourceAt } from '../../Core/clipTime';
import * as ed from '../../Core/editing';
import { mediaById } from '../media';
import { mediaPCM } from './audioSource';
import { transcribe, refineWords, cancelTranscription } from './stt';
import { cutRanges } from './silence';

export const DEFAULT_FILLERS = ['อืม', 'เอ่อ', 'อ่า', 'เอ้อ', 'แบบว่า', 'คือแบบ', 'um', 'uh', 'uhm', 'umm', 'erm', 'er', 'ah', 'hmm', 'you know', 'i mean'];
export const fillerList = () => { try { const v = JSON.parse(localStorage.getItem('es-fillers') || 'null'); return Array.isArray(v) && v.length ? v : DEFAULT_FILLERS; } catch { return DEFAULT_FILLERS; } };
export const setFillerList = (list) => { try { localStorage.setItem('es-fillers', JSON.stringify(list)); } catch { /* storage unavailable */ } };

const isSpeechClip = (seq, c) => c.mediaId && c.enabled !== false && seq.tracks.find((t) => t.id === c.track)?.kind === 'audio';
/** Project items heard in the sequence (audio clips), in timeline order. */
export const sequenceSources = (seq) => [...new Set(seq.clips.filter((c) => isSpeechClip(seq, c)).sort((a, b) => a.start - b.start).map((c) => c.mediaId))];

let running = null;
/** Transcribe the sources that have no transcript yet (or all with force). onProgress({ stage, progress }). */
export async function transcribeSequence({ model, language, force = false } = {}, onProgress = () => {}) {
  const seq = getState().sequence; const ids = sequenceSources(seq).filter((id) => force || !mediaById(id)?.transcript);
  if (!ids.length) { if (!sequenceSources(seq).length) throw new Error('No audio clips on the timeline'); return 0; }
  running = { cancelled: false }; const me = running;
  try {
    for (let i = 0; i < ids.length; i++) {
      const m = mediaById(ids[i]); const step = (p) => onProgress({ stage: `${m.name} (${i + 1}/${ids.length})`, progress: (i + (p.progress || 0)) / ids.length });
      step({ progress: 0 });
      const pcm = await mediaPCM(m, 16000); if (me.cancelled) throw new Error('Cancelled');
      const r = await transcribe(pcm.slice(), { model, language }, step); if (me.cancelled) throw new Error('Cancelled');
      const words = refineWords(r.words).map((w) => ({ text: String(w.text), t0: Math.round(w.t0 * 1000) / 1000, t1: Math.round(w.t1 * 1000) / 1000 }));
      edit(`Transcribe ${m.name}`, ({ media }) => { const x = media.find((q) => q.id === m.id); if (x) x.transcript = { words, language: r.language || language || '', model: model || '' }; });
    }
    return ids.length;
  } finally { running = null; }
}
export function cancelTranscribe() { if (running) running.cancelled = true; cancelTranscription(); }

/**
 * Words of the sequence in timeline order: [{ i, text, t0, t1, clipId }] (sequence seconds). A word is kept when its middle
 * is inside the part of the source the clip shows. Overlapping clips of the same file (e.g. dual tracks) count once.
 */
export function sequenceWords(seq = getState().sequence, media = getState().media) {
  const out = []; const seen = new Set();
  for (const c of seq.clips.filter((x) => isSpeechClip(seq, x)).sort((a, b) => a.start - b.start)) {
    const m = media.find((x) => x.id === c.mediaId); const tr = m?.transcript; if (!tr?.words?.length) continue;
    const s0 = sourceAt(c, c.start, 1e6, m.duration), s1 = sourceAt(c, c.start + c.dur, 1e6, m.duration); const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
    for (const w of tr.words) {
      const mid = (w.t0 + w.t1) / 2; if (mid < lo || mid >= hi) continue;
      const a = c.start + localAtSource(c, Math.max(lo, w.t0)), b = c.start + localAtSource(c, Math.min(hi, w.t1));
      const t0 = Math.max(c.start, Math.min(a, b)), t1 = Math.min(c.start + c.dur, Math.max(a, b));
      const key = `${m.id}:${w.t0}:${Math.round(t0 * 100)}`; if (seen.has(key)) continue; seen.add(key);
      out.push({ text: w.text, t0, t1, clipId: c.id });
    }
  }
  out.sort((x, y) => x.t0 - y.t0); out.forEach((w, i) => { w.i = i; });
  return out;
}
const snap = (t) => { const fps = getState().sequence.fps || 30; return Math.round(t * fps) / fps; };
/** Timeline range of words i..j (inclusive), on frame boundaries. */
export const wordsRange = (words, i, j) => [snap(words[Math.min(i, j)].t0), snap(words[Math.max(i, j)].t1)];

/** Delete words i..j: ripple-delete their time on every unlocked track (one undo step). */
export function deleteWords(words, i, j) { const [a, b] = wordsRange(words, i, j); return b > a ? cutRanges([[a, b]], 'Delete Text') : 0; }

/** Move words i..j so they play just before word k (k = words.length: to the end). Ripple on every unlocked track. */
export function moveWords(words, i, j, k) {
  const [a, b] = wordsRange(words, i, j); if (b <= a) return false;
  const lo = Math.min(i, j), hi = Math.max(i, j); if (k >= lo && k <= hi + 1) return false; // into itself: nothing to do
  const dest = k >= words.length ? snap(words[words.length - 1].t1) : snap(words[k].t0);
  edit('Move Text', ({ seq }) => {
    const pieces = ed.copyRange(seq, a, b);
    ed.removeRange(seq, a, b, true);
    for (const m of seq.markers || []) { if (m.time >= b) m.time -= b - a; else if (m.time > a) m.time = a; }
    const at = dest > a ? dest - (b - a) : dest;
    ed.openGap(seq, at, b - a); for (const p of pieces) { p.start += at; seq.clips.push(p); }
    seq.clips = seq.clips.filter((c) => c.dur > 1e-3); ed.fixTransitions(seq);
  });
  return true;
}

const norm = (s) => String(s).toLowerCase().replace(/[\s.,!?;:'"“”‘’()[\]{}…\-–—]/g, '');
/** Word ranges [i, j] whose joined text equals one of the fillers (a filler may span up to 3 words). */
export function findFillers(words, list = fillerList()) {
  const want = new Set(list.map(norm).filter(Boolean)); const hits = [];
  for (let i = 0; i < words.length; i++) {
    let joined = '';
    for (let j = i; j < Math.min(words.length, i + 3); j++) { joined += norm(words[j].text); if (want.has(joined)) { hits.push([i, j]); i = j; break; } }
  }
  return hits;
}
/** Remove every filler word (one undo step). Returns the seconds removed. */
export function removeFillers(words, list) {
  const r = findFillers(words, list).map(([i, j]) => wordsRange(words, i, j)).filter(([a, b]) => b > a);
  return cutRanges(r, 'Remove Filler Words');
}
/** Search: [[i, j], ...] word ranges containing the query (case-insensitive, spaces ignored for Thai/CJK). */
export function searchWords(words, q) {
  const nq = norm(q); if (!nq) return [];
  let text = ''; const owner = [];
  for (const w of words) { const t = norm(w.text); for (let k = 0; k < t.length; k++) owner.push(w.i); text += t; }
  const out = []; let at = text.indexOf(nq);
  while (at >= 0) { out.push([owner[at], owner[at + nq.length - 1]]); at = text.indexOf(nq, at + nq.length); }
  return out;
}
