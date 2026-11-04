// File > Export > AAF (Embedded Audio): the sequence's audio tracks for a DAW (Pro Tools / Resolve Fairlight / Nuendo ...).
// Like Premiere's "breakout to mono": every audio track becomes mono AAF tracks (L, R; L, R, C, LFE, Ls, Rs when the track
// holds 5.1 audio) and every clip embeds its own 48 kHz / 24-bit PCM. Plain clips carry their source with handles (FFmpeg,
// in the main process); retimed clips (speed, reverse, Time Remapping) embed the same rendered audio Preview plays.
// Carried as AAF effects: clip Volume (level keyframes), clip gain and the Panner (as the balance of the L / R channels) in
// a Mono Audio Gain amplitude envelope, and audio crossfades as Transitions. The picture goes along as a video reference:
// the video tracks' clips point at the original files (not embedded). Audio effects (EQ, compressor ...) are not carried.
import { getState } from '../../Core/store';
import { evalParam } from '../../Core/params';
import { needsRetimedAudio, retimedAudio } from '../retimedAudio';
import { runFfmpeg } from '../ffjob';
import { buildAAF } from './aaf.js';
import { joinChunks } from './cfb.js';

const SR = 48000;
const trackNum = (id) => parseInt(String(id).replace(/\D/g, ''), 10) || 0;
const sep = (p) => (p.includes('\\') ? '\\' : '/');
const toPcm24 = (f) => { const b = new Uint8Array(f.length * 3); for (let i = 0; i < f.length; i++) { const v = Math.round(Math.max(-1, Math.min(1, f[i])) * 8388607); b[i * 3] = v & 255; b[i * 3 + 1] = (v >> 8) & 255; b[i * 3 + 2] = (v >> 16) & 255; } return b; };
const db = (x) => 10 ** (x / 20);
export const SURROUND = ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'];

/** Audio clips the AAF carries: { tracks: [{ id, clips }], skipped }. */
export function aafClips(seq, mediaList) {
  const byId = new Map(mediaList.map((m) => [m.id, m]));
  const tracks = seq.tracks.filter((t) => t.kind === 'audio').sort((a, b) => trackNum(a.id) - trackNum(b.id)).map((t) => ({ id: t.id, clips: [] }));
  let skipped = 0;
  for (const c of seq.clips) {
    const t = tracks.find((x) => x.id === c.track); if (!t) continue;
    const m = c.mediaId && byId.get(c.mediaId);
    if (!m || (m.kind !== 'audio' && m.kind !== 'video') || m.synthetic || m.status === 'offline' || m.hasAudio === false || c.enabled === false || c.frameHold?.on) { skipped++; continue; }
    t.clips.push({ clip: c, media: m });
  }
  for (const t of tracks) t.clips.sort((a, b) => a.clip.start - b.clip.start);
  while (tracks.length > 1 && !tracks[tracks.length - 1].clips.length) tracks.pop(); // trailing empty tracks
  return { tracks, skipped };
}

/** Linear gain of a clip at clip-local time lt on one output channel: Volume level, clip gain, Panner as L / R balance. */
export function clipGainAt(c, lt, ch) {
  let g = 1; const vol = c.volume || {};
  if (!evalParam(vol.bypass, lt)) g *= db(evalParam(vol.level, lt) ?? 0);
  g *= db(c.audio?.gain ?? 0);
  const p = Math.max(-1, Math.min(1, (evalParam(c.pan, lt) || 0) / 100));
  if (ch === 'L' || ch === 'Ls') g *= p > 0 ? 1 - p : 1;
  else if (ch === 'R' || ch === 'Rs') g *= p < 0 ? 1 + p : 1;
  return g;
}
/**
 * The AAF amplitude of a clip over [from, from + len) clip-local seconds: a number when it does not change, else control
 * points [[fraction of len, gain]] at the keyframes and every 0.1 s between (the app interpolates in dB, the AAF linearly
 * in gain), dropping points a straight line already gives within 0.5 %.
 */
export function gainEnvelope(c, ch, from, len) {
  const keyTimes = [c.volume?.level, c.volume?.bypass, c.pan].flatMap((p) => (p?.keys || []).map((k) => k.t));
  if (!keyTimes.length) return clipGainAt(c, from, ch);
  const ts = new Set([from, from + len]); for (let t = from; t < from + len; t += 0.1) ts.add(+t.toFixed(4));
  for (const k of keyTimes) if (k > from && k < from + len) { ts.add(k); ts.add(Math.max(from, k - 1e-3)); }
  const pts = [...ts].sort((a, b) => a - b).map((t) => [(t - from) / len, clipGainAt(c, Math.min(t, from + len - 1e-6), ch)]);
  if (pts.every((p) => Math.abs(p[1] - pts[0][1]) < 1e-5)) return pts[0][1];
  const keep = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = keep[keep.length - 1], b = pts[i + 1], x = pts[i]; const f = (x[0] - a[0]) / (b[0] - a[0] || 1);
    if (Math.abs(a[1] + (b[1] - a[1]) * f - x[1]) > 0.005 * Math.max(x[1], 1e-3)) keep.push(x);
  }
  keep.push(pts[pts.length - 1]);
  return keep.map(([t, g]) => [+t.toFixed(6), +g.toFixed(6)]);
}
/** Audio crossfades on a track: Map(bClipId -> seconds), between two clips that meet at the transition's centre. */
export function crossfades(seq, trackId) {
  const out = new Map();
  for (const tr of seq.transitions || []) {
    if (tr.kind !== 'audio' || tr.track !== trackId || !tr.aId || !tr.bId || !(tr.dur > 0)) continue;
    const a = seq.clips.find((c) => c.id === tr.aId), b = seq.clips.find((c) => c.id === tr.bId);
    if (a && b && Math.abs(a.start + a.dur - b.start) < 1e-3) out.set(b.id, { dur: tr.dur, aId: a.id });
  }
  return out;
}
/** Video clips the AAF references: [{ id, clips: [{ clip, media }] }] (file clips at normal speed, enabled). */
export function aafVideo(seq, mediaList) {
  const byId = new Map(mediaList.map((m) => [m.id, m]));
  return seq.tracks.filter((t) => t.kind === 'video' && !t.hidden).sort((a, b) => trackNum(a.id) - trackNum(b.id)).map((t) => ({
    id: t.id,
    clips: seq.clips.filter((c) => c.track === t.id && c.enabled !== false && c.mediaId && !needsRetimedAudio(c) && !c.frameHold?.on)
      .map((c) => ({ clip: c, media: byId.get(c.mediaId) })).filter((x) => x.media && x.media.kind === 'video' && !x.media.synthetic && x.media.status !== 'offline' && (x.media.path || x.media.playPath))
      .sort((a, b) => a.clip.start - b.clip.start),
  })).filter((t) => t.clips.length);
}
const fileUrl = (p) => 'file:///' + encodeURI(String(p).replace(/\\/g, '/').replace(/^\/+/, '')).replace(/#/g, '%23').replace(/\?/g, '%3F');

/** Export the active sequence. Returns { files, clips, skipped, videoClips, surround } or null when cancelled at the save dialog. */
export async function exportAAFFile({ onProgress, cancelled = () => false, video = true } = {}) {
  const s = getState(); const seq = s.sequence; const es = window.editorstage;
  const { tracks, skipped } = aafClips(seq, s.media);
  const all = tracks.flatMap((t) => t.clips);
  if (!all.length) throw new Error('nothing to export - no audio clips on the audio tracks');
  const path = await es.saveDialog('export', `${seq.name}.aaf`, 'aaf'); if (!path) return null;
  const tmp = await es.tmpDir(); const stem = `${tmp}${sep(tmp)}es-aaf-${Date.now().toString(36)}-`;
  // channels of each file (5.1 sources make their track a 5.1 breakout)
  const chOf = new Map();
  for (const { media: m } of all) if (!chOf.has(m.id)) { const p = await es.probe(m.path || m.playPath).catch(() => null); chOf.set(m.id, p?.audioChannels || 2); }
  const layout = tracks.map((t) => (t.clips.some(({ media: m }) => chOf.get(m.id) >= 6) ? SURROUND : ['L', 'R']));
  const sources = []; const out = []; const first = [];
  tracks.forEach((t, ti) => { first[ti] = out.length; for (const ch of layout[ti]) out.push({ name: `${t.id} ${ch}`, clips: [] }); });
  let ctx = null; let done = 0; const temps = [];
  try {
    for (const [ti, t] of tracks.entries()) {
      const xf = crossfades(seq, t.id); const xfOut = new Map([...xf].map(([b, v]) => [v.aId, v.dur]));
      for (const { clip: c, media: m } of t.clips) {
        if (cancelled()) throw new Error('Cancelled');
        onProgress?.(done / all.length, `Preparing audio ${done + 1}/${all.length}: ${c.name || m.name}`);
        const name = (c.name || m.name).replace(/\.[^.]+$/, '');
        // crossfades: the clip before runs on half the transition, the clip after starts half of it earlier
        const pre = (xf.get(c.id)?.dur || 0) / 2, post = (xfOut.get(c.id) || 0) / 2;
        const handle = Math.max(1, pre + 0.05, post + 0.05);
        const want = chOf.get(m.id) >= 6 && layout[ti].length === 6 ? SURROUND : ['L', 'R'];
        let chans, offset; const start = Math.round((c.start - pre) * SR); const len = Math.round((c.dur + pre + post) * SR);
        if (needsRetimedAudio(c)) {
          ctx ||= new OfflineAudioContext(2, 1, SR);
          const r = await retimedAudio(ctx, seq, c, m); // window starts at r.w0 (transition handles included)
          chans = [r.chans[0], r.chans[1] || r.chans[0]]; offset = Math.max(0, Math.round((c.start - pre - r.w0) * SR));
        } else {
          const inP = c.inPoint || 0, a = Math.max(0, inP - handle), b = Math.min(m.duration || Infinity, inP + c.dur + handle);
          const files = want.map((ch) => `${stem}${sources.length}${ch}.raw`); temps.push(...files);
          const split = want.length === 6
            ? '[0:a:0]aresample=48000,aformat=sample_fmts=s32:channel_layouts=5.1,channelsplit=channel_layout=5.1' + want.map((_, k) => `[c${k}]`).join('')
            : '[0:a:0]aresample=48000,aformat=sample_fmts=s32:channel_layouts=stereo,channelsplit=channel_layout=stereo[c0][c1]';
          const job = runFfmpeg(['-y', '-hide_banner', '-nostdin', '-ss', a.toFixed(6), '-t', (b - a).toFixed(6), '-i', m.path || m.playPath, '-filter_complex', split,
            ...files.flatMap((f, k) => ['-map', `[c${k}]`, '-c:a', 'pcm_s24le', '-f', 's24le', f])],
          { duration: b - a, onProgress: (p) => onProgress?.((done + p) / all.length, `Extracting audio ${done + 1}/${all.length}: ${c.name || m.name}`) });
          const watch = setInterval(() => { if (cancelled()) job.cancel(); }, 200);
          const r = await job.finally(() => clearInterval(watch));
          if (r.cancelled || cancelled()) throw new Error('Cancelled');
          if (!r.ok) throw new Error(`could not read the audio of ${m.name}: ${r.error || 'FFmpeg failed'}`);
          chans = [];
          for (const f of files) { const x = await es.readFile(f); chans.push(new Uint8Array(x.buffer || x, x.byteOffset || 0, x.byteLength)); }
          offset = Math.round((inP - pre - a) * SR);
        }
        chans.forEach((ch, k) => {
          const pcm = ch instanceof Float32Array ? toPcm24(ch) : ch.subarray(0, ch.length - (ch.length % 3));
          const lab = want[k]; const track = first[ti] + layout[ti].indexOf(lab);
          out[track].clips.push({ source: sources.length, start, len, offset, xfadeIn: pre ? Math.round(2 * pre * SR) : 0, gain: gainEnvelope(c, lab, -pre, c.dur + pre + post) });
          sources.push({ name: `${name} ${lab}`, pcm, samples: pcm.length / 3, bits: 24, channels: 1 });
        });
        done++;
      }
    }
  } finally { for (const f of temps) await es.removeFile(f); }
  // video reference: the files the video tracks show, linked (file URL), at the sequence frame rate
  const fps = seq.fps || 25; let videoSpec = null; let videoClips = 0;
  if (video) {
    const vt = aafVideo(seq, s.media); const vsrc = []; const vix = new Map();
    const vtracks = vt.map((t) => ({ name: t.id, clips: t.clips.map(({ clip: c, media: m }) => {
      if (!vix.has(m.id)) { vix.set(m.id, vsrc.length); vsrc.push({ name: m.name, url: fileUrl(m.path || m.playPath), width: m.width, height: m.height, frames: Math.max(1, Math.round((m.duration || c.dur) * fps)) }); }
      videoClips++; return { source: vix.get(m.id), start: Math.round(c.start * fps), len: Math.round(c.dur * fps), offset: Math.round((c.inPoint || 0) * fps) };
    }) }));
    if (vtracks.length) videoSpec = { sources: vsrc, tracks: vtracks };
  }
  onProgress?.(1, 'Writing AAF…');
  const { chunks } = buildAAF({ name: seq.name, fps, sampleRate: SR, sources, tracks: out, video: videoSpec });
  await es.writeFile(path, joinChunks(chunks));
  return { files: [path], clips: all.length, skipped, videoClips, surround: layout.some((l) => l.length === 6) };
}
