// Project Health Check (File > Project Health Check, and the Export dialog): problems that would spoil an export.
//   offline media · missing fonts · black gaps in the picture · clipping in the mix · loudness off target ·
//   captions / titles outside the action-safe area (90 %)
// Every issue can take the user to the spot (playhead + selection); some have a one-click fix.
import { getState, set, edit } from '../Core/store';
import { flatten } from '../Core/flatten';
import { sequenceEnd, removeRange } from '../Core/editing';
import { missingFonts } from './fonts';
import { renderAudioMix, measureLoudness, wavBytesFromPcm } from './exporter';
import { captionCanvas } from './ai/captions';
import { graphicCanvas } from './graphics';

const SAFE = 0.05; // action safe: 5 % margin on each side
const visual = (seq, c) => { const k = seq.tracks.find((t) => t.id === c.track)?.kind; return (k === 'video' || k === 'caption') && c.enabled !== false && !c.asAudio; };
const tc = (t, fps) => { const f = Math.round(t * fps); const p = (n) => String(n).padStart(2, '0'); return `${p(Math.floor(f / fps / 3600))}:${p(Math.floor(f / fps / 60) % 60)}:${p(Math.floor(f / fps) % 60)}:${p(f % Math.round(fps))}`; };

/** Black gaps: stretches of [0, end) where no enabled clip shows on any video track (≥ 1 frame). */
export function blackGaps(seq) {
  const fps = seq.fps || 30; const end = sequenceEnd(seq);
  const iv = seq.clips.filter((c) => visual(seq, c) && seq.tracks.find((t) => t.id === c.track)?.kind === 'video' && !seq.tracks.find((t) => t.id === c.track)?.hidden).map((c) => [c.start, c.start + c.dur]).sort((a, b) => a[0] - b[0]);
  const gaps = []; let at = 0;
  for (const [a, b] of iv) { if (a - at >= 1 / fps - 1e-6) gaps.push([at, a]); at = Math.max(at, b); }
  if (end - at >= 1 / fps - 1e-6) gaps.push([at, end]);
  return gaps;
}
/** Video clips that play their own sound while an audio clip of the same file plays the same source moment at the same time. */
export function doubledAudio(seq) {
  const kind = (c) => seq.tracks.find((t) => t.id === c.track)?.kind;
  const near = (a, b) => Math.abs(a - b) < 0.02;
  return seq.clips.filter((v) => v.mediaId && kind(v) === 'video' && !v.asAudio && !v.noAudio && !v.frameHold?.on && seq.clips.some((a) =>
    a.mediaId === v.mediaId && kind(a) === 'audio' && a.start < v.start + v.dur && v.start < a.start + a.dur
    && near(a.start - (a.inPoint || 0) / (a.speed || 1), v.start - (v.inPoint || 0) / (v.speed || 1)) && near(a.speed || 1, v.speed || 1)));
}
/** Pixel bounds (fraction of the frame) of what a canvas draws, or null when it is empty. */
function inkBounds(cv) {
  const w = cv.width, h = cv.height; const sw = Math.min(w, 320), sh = Math.max(2, Math.round((sw * h) / w));
  const t = document.createElement('canvas'); t.width = sw; t.height = sh; const g = t.getContext('2d', { willReadFrequently: true }); g.drawImage(cv, 0, 0, sw, sh);
  const d = g.getImageData(0, 0, sw, sh).data; let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (d[(y * sw + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : [x0 / sw, y0 / sh, (x1 + 1) / sw, (y1 + 1) / sh];
}

/**
 * Run the checks. opts: { loudness: target LUFS (null = skip), audio: check the mix (default true), onProgress(text) }.
 * Returns [{ id, level: 'error' | 'warning' | 'info', title, detail, at?, clipIds?, fix?: { label, run() } }].
 */
export async function runHealthCheck(opts = {}) {
  const st = getState(); const seq = st.sequence; const fps = seq.fps || 30; const out = []; const say = opts.onProgress || (() => {});
  const end = sequenceEnd(seq);
  if (end <= 0) return [{ id: 'empty', level: 'info', title: 'The sequence is empty' }];

  // offline media used by the sequence (any sequence that is nested in it is flattened first)
  say('Media…');
  const fl = flatten(st).sequence;
  const offIds = new Set(st.media.filter((m) => m.status === 'offline').map((m) => m.id));
  const offClips = fl.clips.filter((c) => c.mediaId && offIds.has(c.mediaId));
  if (offClips.length) {
    const names = [...new Set(offClips.map((c) => st.media.find((m) => m.id === c.mediaId)?.name))];
    out.push({ id: 'offline', level: 'error', title: `${names.length} media file${names.length > 1 ? 's are' : ' is'} offline`, detail: names.slice(0, 6).join(', '), at: Math.min(...offClips.map((c) => c.start)), clipIds: offClips.map((c) => c.id).filter((id) => seq.clips.some((c) => c.id === id)),
      fix: { label: 'Link Media…', run: () => set({ dialog: { type: 'linkMedia' } }) } });
  }
  // doubled sound: a video clip that plays its own sound while an audio clip of the same file plays the same stretch
  // (projects saved while Unlink still turned the video clip's sound back on)
  const doubled = doubledAudio(seq);
  if (doubled.length) out.push({ id: 'doubledAudio', level: 'error', title: `${doubled.length} video clip${doubled.length > 1 ? 's play' : ' plays'} the same sound as an audio clip (twice as loud)`, detail: 'The video clip and the audio clip both play the sound of the file', at: Math.min(...doubled.map((c) => c.start)), clipIds: doubled.map((c) => c.id),
    fix: { label: 'Mute the video clips', run: () => { const ids = new Set(doubled.map((c) => c.id)); edit('Fix Doubled Audio', ({ seq: q }) => { for (const c of q.clips) if (ids.has(c.id)) c.noAudio = true; }); } } });
  // fonts
  say('Fonts…');
  const fonts = await missingFonts(st).catch(() => []);
  if (fonts.length) out.push({ id: 'fonts', level: 'warning', title: `${fonts.length} font${fonts.length > 1 ? 's are' : ' is'} missing on this computer`, detail: fonts.map((f) => f.family).join(', '), fix: { label: 'Replace Fonts…', run: () => set({ dialog: { type: 'replaceFonts' } }) } });

  // black gaps
  const gaps = blackGaps(seq);
  for (const [a, b] of gaps) {
    const audioThere = seq.clips.some((c) => c.enabled !== false && c.start < b - 1e-6 && c.start + c.dur > a + 1e-6);
    out.push({ id: `gap:${a.toFixed(3)}`, level: 'warning', title: `Black gap ${tc(a, fps)} – ${tc(b, fps)} (${(b - a).toFixed(2)} s)`, detail: audioThere ? 'Audio plays here but there is no picture.' : 'Nothing on any track.', at: a,
      fix: audioThere ? null : { label: 'Close Gap', run: () => edit('Close Gap', ({ seq: q }) => { removeRange(q, a, b, true); }) } });
  }

  // captions / titles outside the action-safe area
  say('Captions and titles…');
  const dims = { w: Math.min(640, seq.width), h: Math.round((Math.min(640, seq.width) * seq.height) / seq.width) };
  for (const c of seq.clips.filter((x) => (x.caption || x.graphic) && visual(seq, x))) {
    let cv = null; try { cv = c.caption ? captionCanvas(c, c.start + c.dur / 2, dims) : graphicCanvas(c, dims, { w: seq.width, h: seq.height }); } catch { /* not drawable */ }
    const b = cv && inkBounds(cv); if (!b) continue;
    if (b[0] < SAFE - 0.002 || b[1] < SAFE - 0.002 || b[2] > 1 - SAFE + 0.002 || b[3] > 1 - SAFE + 0.002) {
      out.push({ id: `safe:${c.id}`, level: 'warning', title: `${c.caption ? 'Caption' : 'Title'} outside the safe area at ${tc(c.start, fps)}`, detail: String(c.caption?.text || c.graphic?.text || c.name).slice(0, 60), at: c.start, clipIds: [c.id] });
    }
  }

  // the mix: clipping and loudness
  if (opts.audio !== false && seq.clips.some((c) => c.mediaId && st.media.find((m) => m.id === c.mediaId)?.hasAudio)) {
    say('Mixing audio…');
    const pcm = await renderAudioMix(structuredClone({ ...st, log: [] }), 0, end);
    let clips = 0; const where = []; let lastT = -1;
    for (let i = 0; i < pcm.length; i++) if (pcm[i] >= 32766 || pcm[i] <= -32767) { clips++; const t = Math.floor(i / 2) / (pcm.sampleRate || 48000); if (t - lastT > 1) { where.push(t); lastT = t; } }
    if (clips > 0) out.push({ id: 'clip', level: 'warning', title: `Audio clipping (${clips} samples at full scale)`, detail: `First at ${tc(where[0], fps)}${where.length > 1 ? ` and ${where.length - 1} more place(s)` : ''}. Lower the clip / track volume or use Loudness Normalization on export.`, at: where[0] });
    if (opts.loudness != null) {
      say('Measuring loudness…');
      const es = window.editorstage; const tmp = await es.tmpDir(); const p = `${tmp}${tmp.includes('\\') ? '\\' : '/'}editorstage-health-${Date.now()}.wav`;
      await es.writeFile(p, wavBytesFromPcm(pcm)); const m = await measureLoudness(p).catch(() => null); es.removeFile(p).catch(() => {});
      if (m && Number.isFinite(m.i) && Math.abs(m.i - opts.loudness) > 2) out.push({ id: 'loudness', level: m.i > opts.loudness ? 'warning' : 'info', title: `Loudness ${m.i.toFixed(1)} LUFS (target ${opts.loudness} LUFS)`, detail: `True peak ${m.tp.toFixed(1)} dBTP. Turn on Loudness Normalization in Export to fix it automatically.`, loudness: m });
    }
  }
  say('');
  return out;
}
/** Take the user to an issue: playhead to its time and select its clips. */
export function gotoIssue(issue) {
  const patch = {}; if (issue.at != null) patch.playhead = issue.at; if (issue.clipIds?.length) patch.selection = issue.clipIds; set(patch);
}
