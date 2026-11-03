// File > Export > AAF (Embedded Audio): the sequence's audio tracks for a DAW (Pro Tools / Resolve Fairlight / Nuendo ...).
// Like Premiere's "breakout to mono": every audio track becomes two mono AAF tracks (L, R) and every clip embeds its own
// 48 kHz / 24-bit PCM. Plain clips carry their source with handles (FFmpeg, in the main process); retimed clips (speed,
// reverse, Time Remapping) embed the same rendered audio Preview plays. Volume, effects and crossfades are not carried.
import { getState } from '../../Core/store';
import { needsRetimedAudio, retimedAudio } from '../retimedAudio';
import { runFfmpeg } from '../ffjob';
import { buildAAF } from './aaf.js';
import { joinChunks } from './cfb.js';

const SR = 48000, HANDLE = 1;
const trackNum = (id) => parseInt(String(id).replace(/\D/g, ''), 10) || 0;
const sep = (p) => (p.includes('\\') ? '\\' : '/');
const toPcm24 = (f) => { const b = new Uint8Array(f.length * 3); for (let i = 0; i < f.length; i++) { const v = Math.round(Math.max(-1, Math.min(1, f[i])) * 8388607); b[i * 3] = v & 255; b[i * 3 + 1] = (v >> 8) & 255; b[i * 3 + 2] = (v >> 16) & 255; } return b; };

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

/** Export the active sequence. Returns { files, clips, skipped } or null when cancelled at the save dialog. */
export async function exportAAFFile({ onProgress, cancelled = () => false } = {}) {
  const s = getState(); const seq = s.sequence; const es = window.editorstage;
  const { tracks, skipped } = aafClips(seq, s.media);
  const all = tracks.flatMap((t) => t.clips);
  if (!all.length) throw new Error('nothing to export - no audio clips on the audio tracks');
  const path = await es.saveDialog('export', `${seq.name}.aaf`, 'aaf'); if (!path) return null;
  const tmp = await es.tmpDir(); const stem = `${tmp}${sep(tmp)}es-aaf-${Date.now().toString(36)}-`;
  const sources = []; const out = tracks.flatMap((t) => [{ name: `${t.id} L`, clips: [] }, { name: `${t.id} R`, clips: [] }]);
  let ctx = null; let done = 0; const temps = [];
  try {
    for (const [ti, t] of tracks.entries()) for (const { clip: c, media: m } of t.clips) {
      if (cancelled()) throw new Error('Cancelled');
      onProgress?.(done / all.length, `Preparing audio ${done + 1}/${all.length}: ${c.name || m.name}`);
      const name = (c.name || m.name).replace(/\.[^.]+$/, '');
      let chans, offset, start = Math.round(c.start * SR); const len = Math.round(c.dur * SR);
      if (needsRetimedAudio(c)) {
        ctx ||= new OfflineAudioContext(2, 1, SR);
        const r = await retimedAudio(ctx, seq, c, m); // window starts at r.w0 (transition handles included)
        chans = [r.chans[0], r.chans[1] || r.chans[0]]; offset = Math.max(0, Math.round((c.start - r.w0) * SR));
      } else {
        const inP = c.inPoint || 0, a = Math.max(0, inP - HANDLE), b = Math.min(m.duration || Infinity, inP + c.dur + HANDLE);
        const L = `${stem}${sources.length}L.raw`, R = `${stem}${sources.length}R.raw`; temps.push(L, R);
        const job = runFfmpeg(['-y', '-hide_banner', '-nostdin', '-ss', a.toFixed(6), '-t', (b - a).toFixed(6), '-i', m.path || m.playPath, '-filter_complex',
          '[0:a:0]aresample=48000,aformat=sample_fmts=s32:channel_layouts=stereo,channelsplit=channel_layout=stereo[L][R]',
          '-map', '[L]', '-c:a', 'pcm_s24le', '-f', 's24le', L, '-map', '[R]', '-c:a', 'pcm_s24le', '-f', 's24le', R],
        { duration: b - a, onProgress: (p) => onProgress?.((done + p) / all.length, `Extracting audio ${done + 1}/${all.length}: ${c.name || m.name}`) });
        const watch = setInterval(() => { if (cancelled()) job.cancel(); }, 200);
        const r = await job.finally(() => clearInterval(watch));
        if (r.cancelled || cancelled()) throw new Error('Cancelled');
        if (!r.ok) throw new Error(`could not read the audio of ${m.name}: ${r.error || 'FFmpeg failed'}`);
        chans = [await es.readFile(L), await es.readFile(R)].map((x) => new Uint8Array(x.buffer || x, x.byteOffset || 0, x.byteLength));
        offset = Math.round((inP - a) * SR);
      }
      chans.forEach((ch, k) => {
        const pcm = ch instanceof Float32Array ? toPcm24(ch) : ch.subarray(0, ch.length - (ch.length % 3));
        out[ti * 2 + k].clips.push({ source: sources.length, start, len, offset });
        sources.push({ name: `${name} ${k ? 'R' : 'L'}`, pcm, samples: pcm.length / 3, bits: 24, channels: 1 });
      });
      done++;
    }
  } finally { for (const f of temps) await es.removeFile(f); }
  onProgress?.(1, 'Writing AAF…');
  const { chunks } = buildAAF({ name: seq.name, fps: seq.fps, sampleRate: SR, sources, tracks: out });
  await es.writeFile(path, joinChunks(chunks));
  return { files: [path], clips: all.length, skipped };
}
