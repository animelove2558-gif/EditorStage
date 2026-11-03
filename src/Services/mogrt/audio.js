// Sound inside MOGRT templates (audio footage / videos with audio): live playback during preview and an offline
// segment list for the export mix.
import { getPrepared, prepareMogrt, controlOverrides } from './render';
import { templateTime } from './clip';
import { audioContext, masterNode, computeGain, dialogueAt } from '../audioEngine';

const db = (x) => Math.pow(10, (x || 0) / 20);
const players = new Map(); // key -> { el, src, gain, last }
const urlOf = (inst, fid) => { const s = inst.sources.get(fid); return s ? s.url || null : null; };

/** Keep template audio elements in step with the playhead (called every frame from syncPlayback). */
export function syncMogrtAudio(state) {
  const seq = state.sequence; const t = state.playhead; const playing = state.playing && (state.rate || 1) > 0;
  const solo = seq.tracks.some((x) => x.solo); const dlg = dialogueAt(seq, t); const seen = new Set();
  for (const clip of seq.clips) {
    if (!clip.mogrt || !clip.enabled || t < clip.start || t >= clip.start + clip.dur) continue;
    const inst = getPrepared(clip.mogrt.libId); if (!inst) continue;
    const list = inst.lastAudio.get(clip.id) || [];
    const cg = computeGain(seq, clip, t, solo, dlg);
    for (const a of list) {
      const url = urlOf(inst, a.footageId); if (!url) continue;
      const key = `${clip.id}|${a.key}`; seen.add(key);
      let p = players.get(key);
      if (!p || p.url !== url) {
        if (p) { try { p.el.pause(); p.gain.disconnect(); } catch { /* ok */ } }
        const el = new Audio(); el.crossOrigin = 'anonymous'; el.src = url; el.preload = 'auto';
        const ctx = audioContext(); const src = ctx.createMediaElementSource(el); const gain = ctx.createGain(); src.connect(gain); gain.connect(masterNode());
        p = { el, src, gain, url }; players.set(key, p);
      }
      p.last = performance.now();
      if (Math.abs(p.el.currentTime - a.time) > (playing ? 0.25 : 0.03)) { try { p.el.currentTime = Math.max(0, a.time); } catch { /* not ready */ } }
      p.el.playbackRate = Math.min(16, Math.max(0.0625, (a.rate || 1) * (clip.speed || 1) * (state.rate || 1)));
      p.gain.gain.setTargetAtTime(cg * db(a.gainDb), audioContext().currentTime, 0.015);
      if (playing) { if (p.el.paused) p.el.play().catch(() => {}); } else if (!p.el.paused) p.el.pause();
    }
  }
  for (const [k, p] of players) if (!seen.has(k)) { if (!p.el.paused) p.el.pause(); if (performance.now() - (p.last || 0) > 30000) { try { p.gain.disconnect(); } catch { /* ok */ } players.delete(k); } }
}

/**
 * Offline: continuous audio segments of a MOGRT clip inside [a,b): [{ url, seqStart, seqEnd, srcStart, rate, gainDb }].
 * The template is sampled at 50 Hz so time remapping, responsive time and precomps are all honoured.
 */
export async function mogrtAudioSegments(clip, a, b) {
  const inst = await prepareMogrt(clip.mogrt.libId).catch(() => null); if (!inst) return [];
  const lo = Math.max(a, clip.start), hi = Math.min(b, clip.start + clip.dur); if (hi <= lo) return [];
  const step = 1 / 50; const open = new Map(); const out = [];
  const close = (k) => { const s = open.get(k); if (s && s.seqEnd > s.seqStart) out.push(s); open.delete(k); };
  for (let t = lo; t < hi; t += step) {
    const { tt, local } = templateTime(inst, clip, t);
    const ov = controlOverrides(inst, clip.mogrt.values, local); inst.evaluator.setControls?.(ov);
    const f = inst.evaluator.evaluateComp(inst.comp.id, tt, ov); const now = new Set();
    for (const s of f.audio || []) {
      const url = urlOf(inst, s.footageId); if (!url) continue; now.add(s.key);
      const cur = open.get(s.key);
      if (cur && Math.abs(cur.srcStart + (t - cur.seqStart) * cur.rate - s.time) < 0.06 && Math.abs(cur.gainDb - s.gainDb) < 0.5) { cur.seqEnd = t + step; continue; }
      if (cur) close(s.key);
      open.set(s.key, { url, seqStart: t, seqEnd: t + step, srcStart: s.time, rate: (s.rate || 1) * (clip.speed || 1), gainDb: s.gainDb });
    }
    for (const k of [...open.keys()]) if (!now.has(k)) close(k);
  }
  for (const k of [...open.keys()]) close(k);
  return out;
}
