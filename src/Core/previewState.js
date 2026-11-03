import { getState } from './store';

let h = 0;
const hashStr = (s) => { h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
let cacheKey = null, cacheHash = '';
/** Hash of everything that affects rendering (memoized on object identity). */
export function sequenceHash(st = getState()) {
  if (cacheKey && cacheKey[0] === st.sequence && cacheKey[1] === st.seqs && cacheKey[2] === st.media) return cacheHash;
  cacheKey = [st.sequence, st.seqs, st.media]; return (cacheHash = hashStr(JSON.stringify([st.sequence, st.seqs, st.media.map((m) => [m.id, m.playPath, m.synthetic])])));
}
export const validPreviewAt = (t, kind = 'video') => { const st = getState(); if (!(st.previews || []).length) return null; const hh = sequenceHash(st); return st.previews.find((p) => p.kind === kind && p.hash === hh && t >= p.start && t < p.end) || null; };
