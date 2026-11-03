import { multicamView } from '../Renderers/Compositor';
import { trimHead } from './clipTime';

/**
 * Expand nested-sequence clips into virtual inner clips with absolute timeline times, so playback sync and
 * the audio engine can treat the whole project as one flat sequence. Virtual ids are prefixed; `elKey` keeps the
 * media-element identity shared with the compositor.
 *
 * A nested clip on a video track carries the inner picture (and the sound of inner video-track clips); when it has a
 * linked nested clip on an audio track (Nest of picture + sound, or noAudio), the inner audio tracks are expanded from
 * that audio clip instead, so nothing plays twice. A nested clip on an audio track carries only the inner audio tracks.
 * The nested clip's speed scales the inner timing; its enable, its track's mute / solo and its Volume / gain apply to
 * everything inside (inner clips get `outer` gain stages, read by computeGain).
 */
export function flatten(state) {
  const seq = state.sequence; const seqs = state.seqs || {};
  if (!seq.clips.some((c) => c.nestId)) return state;
  const clips = [], tracks = [...seq.tracks], transitions = [...(seq.transitions || [])];
  const lookup = (id) => (id === seq.id ? seq : seqs[id]);
  const kindOf = (s, trackId) => s.tracks.find((t) => t.id === trackId)?.kind;
  // nest: the nested clip; map(x) = parent time of inner time x; k = speed; mode: 'video' | 'audio' | 'all'; outer: gain stages
  const expand = (nest, sub, prefix, map, k, lo, hi, depth, mode, ptrack, outer) => {
    const s = nest.multicam && !nest.mcDisabled ? multicamView(sub, nest, 0) : sub;
    const keep = (trackId) => { const kd = kindOf(s, trackId); return mode === 'all' || (mode === 'audio' ? kd === 'audio' : kd !== 'audio'); };
    for (const tr of s.tracks) if (keep(tr.id)) tracks.push({ ...tr, id: prefix + tr.id, muted: tr.muted || nest.muted || ptrack?.muted, solo: tr.solo || ptrack?.solo, pan: Math.max(-100, Math.min(100, (tr.pan || 0) + (ptrack?.pan || 0))), volume: (tr.volume || 0) + (ptrack?.volume || 0) });
    for (const t of s.transitions || []) if (keep(t.track)) transitions.push({ ...t, id: prefix + t.id, track: prefix + t.track, at: map(t.at), dur: t.dur / k, aId: t.aId ? prefix + t.aId : null, bId: t.bId ? prefix + t.bId : null });
    for (const ic of s.clips) {
      if (!keep(ic.track) || ic.enabled === false) continue;
      const a = map(ic.start), b = a + ic.dur / k;
      const s0 = Math.max(a, lo), s1 = Math.min(b, hi); if (s1 <= s0) continue;
      if (ic.nestId && depth < 4) {
        const inner = lookup(ic.nestId); if (!inner) continue;
        const k2 = k * (ic.speed || 1), in2 = ic.inPoint || 0;
        expand(ic, inner, `${prefix}${ic.id}/`, (x) => a + (x - in2) / k2, k2, s0, s1, depth + 1, kindOf(s, ic.track) === 'audio' ? 'audio' : mode, s.tracks.find((t) => t.id === ic.track), [...outer, gainStage(ic, a)]);
        continue;
      }
      clips.push(trimHead({ ...ic, id: prefix + ic.id, elKey: ic.elKey || ic.id, track: prefix + ic.track, start: s0, dur: s1 - s0, speed: (ic.speed || 1) * k, outer }, s0 - a)); // trimHead copies what it changes
    }
  };
  for (const c of seq.clips) {
    if (!c.nestId) { clips.push(c); continue; }
    const sub = lookup(c.nestId); if (!sub || c.enabled === false) continue;
    const k = c.speed || 1, in0 = c.inPoint || 0; const ptrack = seq.tracks.find((t) => t.id === c.track);
    const onAudio = ptrack?.kind === 'audio';
    const partner = !onAudio && c.linkId && seq.clips.some((x) => x.id !== c.id && x.nestId === c.nestId && x.linkId === c.linkId && kindOf(seq, x.track) === 'audio');
    const mode = onAudio ? 'audio' : partner || c.noAudio ? 'video' : 'all';
    expand(c, sub, `${c.id}/`, (x) => c.start + (x - in0) / k, k, c.start, c.start + c.dur, 0, mode, ptrack, [gainStage(c, c.start)]);
  }
  return { ...state, sequence: { ...seq, clips, tracks, transitions } };
}
/** Volume / gain of a nested clip, applied to everything inside it (local time = t - start). */
const gainStage = (c, start) => ({ start, volume: c.volume, gain: c.audio?.gain, pan: c.pan, id: c.id });
