import { getState, set } from '../Core/store';
import { Compositor, hasGrade } from '../Renderers/Compositor';
import { elementForClip, mediaById, mediaUrl, clipSourceTime, renderDeps, echoElement, lockPlayback, blendTimes, blendElement } from './media';
import { flatten } from '../Core/flatten';
import { evalParam, DEFAULT_MOTION, DEFAULT_OPACITY } from '../Core/params';
import { rgbaToRgb } from '../Core/pixels';
import { AUDIO_FX, chainLatency } from './audioFx';
import { computeGain, computePan, masterGain, stereoPanner, dialogueAt, essentialNodes, loadWorklets, channelNode } from './audioEngine';
import { resolveParams } from '../Core/params';
import { sequenceEnd } from '../Core/editing';
import { prepareMogrtClipFrame } from './mogrt/clip';
import { mogrtAudioSegments } from './mogrt/audio';
import { needsRetimedAudio, retimedAudio, toAudioBuffer } from './retimedAudio';
import { loadLut } from './lut';
import { maskKey, getMask, computeMask, hasRemoveBg, removeBgOptions } from './segment';
import { captionsToSrt, captionsToVtt } from './ai/stt';
import { ffmpegInfo, hasEncoder, videoEncoderOf, GPL_ENCODERS } from './ffmpegCaps';

// codec: family used for hardware encoders and Smart Render; alpha: rendered on a transparent background
export const PRESETS = {
  'H.264 (MP4)': { ext: 'mp4', codec: 'h264', video: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p'], audio: ['-c:a', 'aac', '-b:a', '256k'] },
  'H.265 / HEVC (MP4)': { ext: 'mp4', codec: 'hevc', video: ['-c:v', 'libx265', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1'], audio: ['-c:a', 'aac', '-b:a', '256k'] },
  'H.265 / HEVC Main10 (MP4)': { ext: 'mp4', codec: 'hevc', tenBit: true, video: ['-c:v', 'libx265', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p10le', '-profile:v', 'main10', '-tag:v', 'hvc1'], audio: ['-c:a', 'aac', '-b:a', '256k'] },
  'AV1 (MP4)': { ext: 'mp4', codec: 'av1', video: ['-c:v', 'libaom-av1', '-crf', '30', '-b:v', '0', '-cpu-used', '6', '-row-mt', '1', '-tiles', '2x2', '-pix_fmt', 'yuv420p'], audio: ['-c:a', 'aac', '-b:a', '256k'] },
  'Apple ProRes 422 (MOV)': { ext: 'mov', video: ['-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le'], audio: ['-c:a', 'pcm_s16le'] },
  'Apple ProRes 422 HQ (MOV)': { ext: 'mov', video: ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le'], audio: ['-c:a', 'pcm_s16le'] },
  'Apple ProRes 4444 with Alpha (MOV)': { ext: 'mov', alpha: true, video: ['-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0'], audio: ['-c:a', 'pcm_s16le'] },
  // Avid DNxHR (resolution independent; the FFmpeg encoder is "dnxhd"). MXF needs 48 kHz audio, which the export always produces.
  'Avid DNxHR LB (MOV)': { ext: 'mov', video: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_lb', '-pix_fmt', 'yuv422p'], audio: ['-c:a', 'pcm_s16le'] },
  'Avid DNxHR SQ (MOV)': { ext: 'mov', video: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_sq', '-pix_fmt', 'yuv422p'], audio: ['-c:a', 'pcm_s16le'] },
  'Avid DNxHR HQ (MOV)': { ext: 'mov', video: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_hq', '-pix_fmt', 'yuv422p'], audio: ['-c:a', 'pcm_s16le'] },
  'Avid DNxHR HQX 10-bit (MOV)': { ext: 'mov', tenBit: true, video: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_hqx', '-pix_fmt', 'yuv422p10le'], audio: ['-c:a', 'pcm_s16le'] },
  'Avid DNxHR 444 10-bit (MOV)': { ext: 'mov', tenBit: true, video: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_444', '-pix_fmt', 'yuv444p10le'], audio: ['-c:a', 'pcm_s16le'] },
  'MXF OP1a DNxHR HQ': { ext: 'mxf', video: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_hq', '-pix_fmt', 'yuv422p', '-f', 'mxf'], audio: ['-c:a', 'pcm_s24le', '-ar', '48000'] },
  // one PNG per frame, with transparency: <name>_00001.png ... next to the chosen name (imageSeq: no single file, no temporary name)
  'PNG Sequence (RGBA)': { ext: 'png', alpha: true, imageSeq: true, video: ['-c:v', 'png', '-pix_fmt', 'rgba'], audio: null },
  'VP9 (WebM)': { ext: 'webm', video: ['-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-pix_fmt', 'yuv420p'], audio: ['-c:a', 'libopus'] },
  'Animated GIF': { ext: 'gif', video: ['-vf', 'vflip,split[a][b];[a]palettegen[p];[b][p]paletteuse'], audio: null },
  'Preview (H.264, fast)': { ext: 'mp4', hidden: true, video: ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p'], audio: null },
  'WAV (audio only)': { ext: 'wav', audioOnly: true, audio: ['-c:a', 'pcm_s16le'] },
  'MP3 (audio only)': { ext: 'mp3', audioOnly: true, audio: ['-c:a', 'libmp3lame', '-b:a', '256k'] },
  'AAC (audio only, M4A)': { ext: 'm4a', audioOnly: true, audio: ['-c:a', 'aac', '-b:a', '256k'] },
};
/** Ready-made settings per destination (Premiere: Export > Preset). Sizes are the platforms' recommended upload sizes. */
export const PLATFORM_PRESETS = {
  'YouTube 1080p Full HD': { preset: 'H.264 (MP4)', width: 1920, height: 1080, loudness: -14 },
  'YouTube 2160p 4K Ultra HD': { preset: 'H.264 (MP4)', width: 3840, height: 2160, loudness: -14 },
  'TikTok / Instagram Reels / YouTube Shorts (9:16)': { preset: 'H.264 (MP4)', width: 1080, height: 1920, loudness: -14 },
  'Instagram Square (1:1)': { preset: 'H.264 (MP4)', width: 1080, height: 1080, loudness: -14 },
  'Instagram Portrait (4:5)': { preset: 'H.264 (MP4)', width: 1080, height: 1350, loudness: -14 },
  'Facebook 1080p': { preset: 'H.264 (MP4)', width: 1920, height: 1080, loudness: -16 },
  'Podcast (MP3, −16 LUFS)': { preset: 'MP3 (audio only)', loudness: -16 },
  'Broadcast master (ProRes 422 HQ, EBU R128 −23 LUFS)': { preset: 'Apple ProRes 422 HQ (MOV)', loudness: -23 },
};
export const LOUDNESS_TARGETS = [[null, 'Off'], [-14, '−14 LUFS (YouTube, Spotify, TikTok, Instagram)'], [-16, '−16 LUFS (Apple Podcasts, Facebook)'], [-23, '−23 LUFS (EBU R128 broadcast)'], [-24, '−24 LKFS (ATSC A/85)']];
export const FIT_MODES = [['fit', 'Scale to Fit (black bars)'], ['fill', 'Scale to Fill (crop)'], ['stretch', 'Stretch to Fill']];
const CHAPTER_EXT = ['mp4', 'mov', 'm4a', 'mkv'];
export const supportsChapters = (P) => CHAPTER_EXT.includes(P.ext) && P.ext !== 'gif';

// ---- Hardware encoders: each one is tried with a tiny test encode; only the ones that really work are offered ----
const HW = {
  h264: { nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '19', '-b:v', '0'], qsv: ['-c:v', 'h264_qsv', '-global_quality', '20'], amf: ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '18', '-qp_p', '20'] },
  hevc: { nvenc: ['-c:v', 'hevc_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '22', '-b:v', '0', '-tag:v', 'hvc1'], qsv: ['-c:v', 'hevc_qsv', '-global_quality', '22', '-tag:v', 'hvc1'], amf: ['-c:v', 'hevc_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '22', '-qp_p', '24', '-tag:v', 'hvc1'] },
  av1: { nvenc: ['-c:v', 'av1_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '30', '-b:v', '0'], qsv: ['-c:v', 'av1_qsv', '-global_quality', '30'], amf: ['-c:v', 'av1_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '30', '-qp_p', '32'] },
};
export const HW_LABELS = { nvenc: 'NVIDIA NVENC', qsv: 'Intel Quick Sync', amf: 'AMD AMF' };
const hwArgs = (P, k) => [...HW[P.codec][k], '-pix_fmt', P.tenBit ? 'p010le' : k === 'qsv' ? 'nv12' : 'yuv420p', ...(P.tenBit ? ['-profile:v', 'main10'] : [])];
/** FFmpeg run that is killed after `ms` (a broken driver must not hang the export). */
async function ffTimed(args, ms) {
  const es = window.editorstage; const id = `hw${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const t = setTimeout(() => es.ffmpegKill(id), ms);
  try { return await es.ffmpeg(args, id); } finally { clearTimeout(t); }
}
const testEncode = (vargs) => ffTimed(['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x240:r=30:d=0.2', ...vargs, '-f', 'null', '-'], 10000).then((r) => !!r.ok);
let hwProbe = null;
/** Hardware encoders that work on this machine: { h264: ['nvenc', ...], hevc: [...], av1: [...] } (detected once). */
export function detectEncoders() {
  hwProbe ||= (async () => {
    const out = { h264: [], hevc: [], av1: [] };
    for (const codec of Object.keys(HW)) for (const k of Object.keys(HW[codec])) if (await testEncode(hwArgs({ codec }, k))) out[codec].push(k);
    return out;
  })();
  return hwProbe;
}
/** Video encoder arguments for a preset: encoder 'software' | 'nvenc' | 'qsv' | 'amf'. Falls back to software when the hardware one fails. */
async function videoArgs(P, encoder, size) {
  if (!encoder || encoder === 'software' || !P.codec || !HW[P.codec]?.[encoder]) return softwareVideo(P, size);
  const a = hwArgs(P, encoder);
  if (await testEncode(a)) return { args: a, encoder };
  const sw = await softwareVideo(P, size); return { ...sw, note: [`${HW_LABELS[encoder]} failed: software encoder used`, sw.note].filter(Boolean).join('; ') };
}
// Encoders that replace x264 / x265 when the FFmpeg in use is an LGPL build (Preferences > FFmpeg): all are LGPL / BSD or
// part of the OS. Rate-controlled by bitrate (these have no CRF): ~0.2 (H.264) / 0.12 (HEVC) bits per pixel per frame.
const ALT = {
  h264: {
    mf: (P, br) => ['-c:v', 'h264_mf', '-b:v', br, '-pix_fmt', 'nv12'],
    openh264: (P, br) => ['-c:v', 'libopenh264', '-b:v', br, '-pix_fmt', 'yuv420p'],
    videotoolbox: (P, br) => ['-c:v', 'h264_videotoolbox', '-b:v', br, '-pix_fmt', 'yuv420p'],
  },
  hevc: {
    mf: (P, br) => ['-c:v', 'hevc_mf', '-b:v', br, '-pix_fmt', P.tenBit ? 'p010le' : 'nv12', '-tag:v', 'hvc1'],
    videotoolbox: (P, br) => ['-c:v', 'hevc_videotoolbox', '-b:v', br, '-pix_fmt', P.tenBit ? 'p010le' : 'yuv420p', ...(P.tenBit ? ['-profile:v', 'main10'] : []), '-tag:v', 'hvc1'],
  },
};
export const ALT_LABELS = { ...HW_LABELS, mf: 'Windows Media Foundation', openh264: 'OpenH264', videotoolbox: 'Apple VideoToolbox' };
const CODEC_OF = { libx264: 'h264', libx264rgb: 'h264', libx265: 'hevc' };
const altPick = new Map(); // `${codec}|${tenBit}|${binary}` -> Promise<kind | null>
/**
 * Software encoder arguments for a preset: P.video when the FFmpeg in use has its encoder, otherwise (an LGPL build without
 * x264 / x265) the first non-GPL encoder that works here: hardware (NVENC / Quick Sync / AMF), Media Foundation, OpenH264,
 * VideoToolbox. size = { width, height, fps } sets the bitrate of the replacement. Throws when nothing can encode the codec.
 */
export async function softwareVideo(P, size = {}) {
  const inf = await ffmpegInfo(); const enc = videoEncoderOf(P.video);
  if (hasEncoder(inf, enc)) return { args: P.video, encoder: 'software' };
  const codec = P.codec || CODEC_OF[enc];
  const what = GPL_ENCODERS[enc] || enc;
  if (!ALT[codec]) throw new Error(`this FFmpeg has no ${what} encoder`);
  const w = size.width || 1920, h = size.height || 1080, fps = size.fps || 30;
  const br = `${Math.max(1, Math.round((w * h * fps * (codec === 'hevc' ? 0.12 : 0.2)) / 1e5) / 10)}M`;
  const key = `${codec}|${!!P.tenBit}|${inf?.path}`;
  if (!altPick.has(key)) altPick.set(key, (async () => {
    const hw = (await detectEncoders())[codec] || [];
    if (hw.length) return hw[0];
    for (const [k, f] of Object.entries(ALT[codec])) { const a = f(P, '4M'); if (hasEncoder(inf, videoEncoderOf(a)) && await testEncode(a)) return k; }
    return null;
  })());
  const k = await altPick.get(key);
  if (!k) throw new Error(`${codec === 'hevc' ? 'HEVC' : 'H.264'} export needs ${what} (GPL, not in this FFmpeg) or a hardware / Media Foundation / OpenH264 / VideoToolbox encoder - none works here. Choose another format or set an FFmpeg with one of them in Preferences > FFmpeg`);
  const args = HW[codec][k] ? hwArgs({ ...P, codec }, k) : ALT[codec][k](P, br);
  return { args, encoder: k, note: `${what} is not in this FFmpeg build: encoded with ${ALT_LABELS[k]}` };
}
/** Forget encoder choices (after Preferences > FFmpeg switched the binary). */
export const resetEncoderChoices = () => { altPick.clear(); hwProbe = null; };
const SR = 48000;
const decodeCache = new Map();
async function decode(ctx, media) {
  if (decodeCache.has(media.id)) return decodeCache.get(media.id);
  const buf = await (await fetch(mediaUrl(media))).arrayBuffer();
  const ab = await ctx.decodeAudioData(buf); decodeCache.set(media.id, ab); return ab;
}

/** Offline mix of every audio-bearing clip in [a,b) with effects, Volume, Essential Sound and crossfades. Returns Float32 stereo interleaved. */
export async function renderAudioMix(state, a, b, onProgress) {
  const sr = state.sequence?.sampleRate || SR; // Sequence Settings > Audio Sample Rate
  const seq = flatten(state).sequence; const len = Math.ceil((b - a) * sr);
  // clips whose effects delay the sound (pitch / denoise worklets) start that much earlier: the render gets a pre-roll that is cut off
  const lat = new Map(seq.clips.map((c) => [c.id, chainLatency(c) / sr])); const preN = Math.ceil(2 * Math.max(0, ...lat.values()) * sr), roll = preN / sr;
  const ctx = new OfflineAudioContext(2, len + preN, sr);
  const out0 = ctx.createGain(); out0.gain.value = masterGain(seq); out0.connect(ctx.destination); // Master track volume
  try { await loadWorklets(ctx); } catch { /* pitch effects skipped */ }
  const solo = seq.tracks.some((t) => t.solo);
  // sound packed inside motion graphics templates
  for (const c of seq.clips) {
    if (!c.mogrt || !c.enabled) continue;
    let segs = []; try { segs = await mogrtAudioSegments(c, a, b); } catch { /* template without audio */ }
    for (const s of segs) {
      let ab; try { if (!decodeCache.has(s.url)) decodeCache.set(s.url, await ctx.decodeAudioData(await (await fetch(s.url)).arrayBuffer())); ab = decodeCache.get(s.url); } catch { continue; }
      const src = ctx.createBufferSource(); src.buffer = ab; src.playbackRate.value = s.rate || 1;
      const g = ctx.createGain(); src.connect(g); g.connect(out0);
      for (let t = s.seqStart; t < s.seqEnd; t += 0.02) g.gain.setValueAtTime(computeGain(seq, c, t, solo, dialogueAt(seq, t)) * Math.pow(10, (s.gainDb || 0) / 20), Math.max(0, t - a) + roll);
      src.start(Math.max(0, s.seqStart - a) + roll, Math.max(0, s.srcStart), Math.max(0.01, (s.seqEnd - s.seqStart) * (s.rate || 1)));
    }
  }
  for (const c of seq.clips) {
    const media = c.mediaId && mediaById(c.mediaId); if (!media || (media.kind !== 'audio' && media.kind !== 'video')) continue;
    if (c.noAudio || c.frameHold?.on) continue; // same as playback: linked video clips are muted (their audio clip plays), frozen clips are silent
    const pre = Math.max(0, ...(seq.transitions || []).filter((x) => x.bId === c.id).map((x) => x.dur / 2));
    const post = Math.max(0, ...(seq.transitions || []).filter((x) => x.aId === c.id).map((x) => x.dur / 2));
    const s0 = c.start - pre, s1 = c.start + c.dur + post;
    if (s1 <= a || s0 >= b) continue;
    // retimed clips (reverse / speed / ramps) play the same rendered buffer as Preview; others play the decoded file
    const rt = needsRetimedAudio(c);
    let ab, w0 = 0; try { if (rt) { const r = await retimedAudio(ctx, seq, c, media); ab = toAudioBuffer(ctx, r); w0 = r.w0; } else ab = await decode(ctx, media); } catch { continue; }
    const src = ctx.createBufferSource(); src.buffer = ab;
    let prev = src;
    const chn = channelNode(ctx, c.audio?.channels); if (chn) { prev.connect(chn.input); prev = chn.output; }
    for (const fx of c.effects || []) {
      if (!fx.enabled || fx.category !== 'Audio') continue;
      const def = AUDIO_FX[fx.name]; if (!def || def.status === 'unsupported') continue;
      try { const n = def.build(ctx, resolveParams(fx.params, 0)); prev.connect(n.input); prev = n.output; } catch { /* skip */ }
    }
    for (const n of essentialNodes(ctx, c.audio)) { prev.connect(n); prev = n; }
    const g = ctx.createGain(); const pn = stereoPanner(ctx); prev.connect(g); g.connect(pn); pn.connect(out0);
    const lo = Math.max(s0, a), hi = Math.min(s1, b);
    for (let t = lo; t < hi; t += 0.02) { g.gain.setValueAtTime(computeGain(seq, c, t, solo, dialogueAt(seq, t)), t - a + roll); pn.pan.setValueAtTime(computePan(seq, c, t), t - a + roll); }
    // a delayed chain (latency L) is fed L early, plus up to L of the clip before the window (its analysis frames start there) and L after it
    const L = lat.get(c.id) || 0, lead = Math.max(0, Math.min(L, lo - s0, rt ? lo - w0 : Infinity));
    const at = lo - a + roll - L - lead, span = Math.max(0.01, Math.min(s1, hi + L) - lo + lead);
    if (rt) src.start(at, Math.max(0, lo - w0 - lead), span);
    else { const srcStart = (c.inPoint || 0) + (lo - c.start) - lead; src.start(at, Math.max(0, srcStart), span); }
    onProgress?.();
  }
  const out = await ctx.startRendering();
  decodeCache.clear(); // whole files as float samples (an hour of stereo is over 1 GB): kept for this mix only
  const L = out.getChannelData(0).subarray(preN), R = out.getChannelData(1).subarray(preN); const inter = new Int16Array(len * 2);
  for (let i = 0; i < len; i++) { inter[i * 2] = Math.max(-1, Math.min(1, L[i])) * 32767; inter[i * 2 + 1] = Math.max(-1, Math.min(1, R[i])) * 32767; }
  inter.sampleRate = sr; return inter;
}
function wavBytes(pcm16, sr = pcm16.sampleRate || SR) {
  const dl = pcm16.length * 2; const b = new ArrayBuffer(44 + dl); const v = new DataView(b);
  const w = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + dl, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, dl, true);
  new Int16Array(b, 44).set(pcm16); return new Uint8Array(b);
}

/** Seek every video element needed at time t and wait for the frames. */
async function prepareFrame(state, t) {
  const waits = [];
  const once = (el, ev) => new Promise((res) => { const done = () => { el.removeEventListener(ev, done); res(); }; el.addEventListener(ev, done); setTimeout(done, 2000); });
  // a just-created element has no metadata yet: a seek set then is not reported by 'seeked', so wait for it first
  const seek = (el, target) => waits.push((async () => {
    el.pause();
    if (el.readyState < 1) await once(el, 'loadedmetadata');
    if (Math.abs(el.currentTime - target) > 0.0005) { const p = once(el, 'seeked'); el.currentTime = target; await p; }
    if (el.readyState < 2) await once(el, 'loadeddata');
  })());
  const fl = flatten(state);
  for (const c of fl.sequence.clips) {
    if (!c.mediaId || !c.enabled || c.asAudio) continue;
    const media = mediaById(c.mediaId); if (!media || media.kind !== 'video' || media.synthetic || media.status !== 'ready') continue;
    const pre = Math.max(0, ...(fl.sequence.transitions || []).filter((x) => x.bId === c.id).map((x) => x.dur / 2));
    const post = Math.max(0, ...(fl.sequence.transitions || []).filter((x) => x.aId === c.id).map((x) => x.dur / 2));
    if (t < c.start - pre || t >= c.start + c.dur + post) continue;
    const el = elementForClip(c); if (!el) continue;
    const bt = blendTimes(c, t, media);
    if (bt) { seek(el, bt.t0); seek(blendElement(c), bt.t1); } else seek(el, clipSourceTime(c, t, media));
    const echo = (c.effects || []).find((e) => e.name === 'Echo' && e.enabled);
    if (echo) { const n = Math.min(8, Math.round(evalParam(echo.params.num, 0) ?? 3)), dt = evalParam(echo.params.time, 0) ?? -0.1; for (let k = 1; k <= n; k++) { const e2 = echoElement(c, k); if (e2) seek(e2, clipSourceTime(c, t + dt * k, media)); } }
  }
  // Lumetri LUTs load asynchronously: wait so no frame is rendered ungraded
  for (const c of fl.sequence.clips) for (const l of [c.lumetri?.lut, c.lumetri?.inputLut]) if (l?.path && c.enabled && t >= c.start && t < c.start + c.dur) waits.push(loadLut(l.path).catch(() => {}));
  // motion graphics templates: parse (first frame) and put their packed videos on the exact frame
  for (const c of fl.sequence.clips) if (c.mogrt && c.enabled && t >= c.start && t < c.start + c.dur) waits.push(prepareMogrtClipFrame(c, t));
  await Promise.all(waits);
  // Remove Background: segment the frames now on screen (cached; the preview uses the same masks)
  const segs = [];
  for (const c of fl.sequence.clips) {
    if (!c.enabled || !hasRemoveBg(c) || t < c.start || t >= c.start + c.dur) continue;
    const m = mediaById(c.mediaId); if (!m) continue; const fps = m.fps || state.sequence.fps || 30;
    const o = removeBgOptions(c, t - c.start); const key = maskKey(m.id, m.kind === 'image' ? 0 : Math.round(clipSourceTime(c, t, m) * fps), o.variant); if (getMask(key)) continue;
    const el = elementForClip(c, t); if (el) segs.push(computeMask(key, el, o).catch(() => {}));
  }
  await Promise.all(segs);
}
// ---- Loudness Normalization (two-pass FFmpeg loudnorm, ITU-R BS.1770 / EBU R128) ----
const lastJson = (txt) => { const a = txt.lastIndexOf('{'), b = txt.lastIndexOf('}'); try { return JSON.parse(txt.slice(a, b + 1)); } catch { return null; } };
/** Measure integrated loudness (LUFS), true peak (dBTP) and loudness range of a file. */
export async function measureLoudness(path) {
  const r = await window.editorstage.ffmpeg(['-hide_banner', '-nostdin', '-i', path, '-map', '0:a:0', '-af', 'loudnorm=print_format=json', '-f', 'null', '-']);
  const j = r.ok && lastJson(r.stderr || ''); if (!j) return null;
  return { i: +j.input_i, tp: +j.input_tp, lra: +j.input_lra, thresh: +j.input_thresh };
}
/** Write `out` = `inp` normalized to `target` LUFS with a true-peak ceiling (dBTP). Silent input is copied unchanged. */
export async function normalizeLoudness(inp, out, target, truePeak = -1) {
  const m = await measureLoudness(inp);
  if (!m || !Number.isFinite(m.i) || m.i < -70) return { ok: true, skipped: true, measured: m };
  const f = `loudnorm=I=${target}:TP=${truePeak}:LRA=${Math.max(11, Math.ceil(m.lra) || 11)}`;
  const r = await window.editorstage.ffmpeg(['-y', '-hide_banner', '-nostdin', '-i', inp, '-af',
    `${f}:measured_I=${m.i}:measured_TP=${m.tp}:measured_LRA=${m.lra}:measured_thresh=${m.thresh}:linear=true:print_format=json`, '-ar', String(SR), '-c:a', 'pcm_s16le', out]);
  if (!r.ok) return { ok: false, error: r.error || 'loudnorm failed' };
  const j = lastJson(r.stderr || '');
  return { ok: true, measured: m, output: j ? +j.output_i : null, mode: j?.normalization_type };
}

// ---- Chapters from sequence markers (MP4 / MOV / M4A / MKV) ----
function chapterFile(seq, a, b) {
  // Chapter markers become chapters; a sequence without any uses all its markers (older projects)
  const all = seq.markers || []; const chap = all.some((m) => m.type === 'chapter') ? all.filter((m) => m.type === 'chapter') : all;
  const ms = chap.filter((m) => m.time >= a - 1e-6 && m.time < b - 1e-3).sort((x, y) => x.time - y.time); if (!ms.length) return null;
  const esc = (s) => String(s).replace(/([=;#\\\n])/g, '\\$1');
  let txt = ';FFMETADATA1\n';
  ms.forEach((m, i) => {
    const s0 = Math.round((m.time - a) * 1000), s1 = Math.round(((ms[i + 1]?.time ?? b) - a) * 1000);
    txt += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${s0}\nEND=${s1}\ntitle=${esc(m.name || m.comment || `Chapter ${i + 1}`)}\n`;
  });
  return txt;
}

// ---- Smart Render: untouched, keyframe-aligned clips are stream-copied (no re-encode, no quality loss) ----
const isDefault = (p, v) => !p || (!(p.keys && p.keys.length) && JSON.stringify(p.v) === JSON.stringify(v));
function untouchedReason(c, m) {
  if (!m || m.kind !== 'video' || !m.path || m.synthetic || m.status !== 'ready') return 'a clip is not a plain video file';
  if (c.mogrt || c.gfx || c.seqId || c.nested || c.multicam) return 'a clip is a graphic, nest or multicam';
  if ((c.effects || []).some((e) => e.enabled && e.category !== 'Audio')) return 'a clip has video effects';
  if (c.lumetri && hasGrade(c.lumetri)) return 'a clip has a Lumetri grade';
  if ((c.masks || []).length) return 'a clip has masks';
  if (c.filter?.id || (c.canvasFill && c.canvasFill.type !== 'none')) return 'a clip has a filter or canvas fill';
  if (c.frameHold?.on || c.fieldOptions?.reverse || c.fieldOptions?.deinterlace || c.fieldOptions?.flicker || (c.frameSampling && c.frameSampling !== 'sample')) return 'a clip has frame hold / field options / frame blending / optical flow';
  if (Math.abs(c.speed || 1) !== 1 || c.reverse || !isDefault(c.timeRemap?.speed, 100)) return 'a clip is retimed';
  if (c.scaleToFrame === false) return 'a clip is not scaled to the frame size';
  const D = DEFAULT_MOTION(); if (Object.keys(D).some((k) => !isDefault(c.motion?.[k], D[k].v))) return 'a clip has Motion changes';
  const O = DEFAULT_OPACITY(); if (Object.keys(O).some((k) => !isDefault(c.opacity?.[k], O[k].v))) return 'a clip has Opacity changes';
  return null;
}
/** Keyframe times (s) of a file's first video stream (FFmpeg decodes only the keyframes). */
const keyframeCache = new Map();
async function keyframes(path) {
  if (keyframeCache.has(path)) return keyframeCache.get(path);
  const r = await window.editorstage.ffmpeg(['-hide_banner', '-nostdin', '-skip_frame', 'nokey', '-i', path, '-map', '0:v:0', '-vf', 'showinfo', '-f', 'null', '-']);
  const ks = r.ok ? [...(r.stderr || '').matchAll(/pts_time:\s*([\d.]+)/g)].map((x) => +x[1]) : [];
  keyframeCache.set(path, ks); return ks;
}
const SMART_SOURCE = { h264: { codec: 'h264', pix: ['yuv420p', 'yuvj420p'] }, hevc: { codec: 'hevc', pix: ['yuv420p'] }, hevc10: { codec: 'hevc', pix: ['yuv420p10le'] } };
/** Plan a Smart Render: { segments: [{ path, inPoint, outPoint }] } or { reason } when the range must be rendered. */
export async function smartRenderPlan(state, opts) {
  const P = PRESETS[opts.preset]; const want = P.codec === 'h264' ? SMART_SOURCE.h264 : P.codec === 'hevc' ? (P.tenBit ? SMART_SOURCE.hevc10 : SMART_SOURCE.hevc) : null;
  if (!want || P.audioOnly) return { reason: 'the format cannot be smart rendered (H.264 / HEVC only)' };
  const seq = flatten(state).sequence; const { start: a, end: b, fps } = opts; const half = 0.5 / fps;
  if (opts.width !== seq.width || opts.height !== seq.height) return { reason: 'the output size differs from the sequence' };
  if (seq.canvasFill && seq.canvasFill.type !== 'none') return { reason: 'the sequence has a canvas fill' };
  if (seq.par && seq.par !== '1/1') return { reason: 'the sequence pixels are not square' };
  const vis = seq.tracks.filter((t) => (t.kind === 'video' || t.kind === 'caption') && !t.hidden).map((t) => t.id); // Toggle Track Output: hidden tracks are not rendered
  const clips = seq.clips.filter((c) => vis.includes(c.track) && c.enabled && !c.asAudio && c.start < b - half && c.start + c.dur > a + half).sort((x, y) => x.start - y.start);
  if (!clips.length) return { reason: 'there is no video in the range' };
  if (new Set(clips.map((c) => c.track)).size > 1) return { reason: 'more than one video track is used' };
  if ((seq.transitions || []).some((x) => clips.some((c) => c.id === x.aId || c.id === x.bId))) return { reason: 'a clip has a transition' };
  const segs = []; let at = a;
  for (const c of clips) {
    const m = mediaById(c.mediaId); const why = untouchedReason(c, m); if (why) return { reason: why };
    if (c.start > at + half) return { reason: 'the range has a gap' };
    const s0 = Math.max(a, c.start), s1 = Math.min(b, c.start + c.dur);
    const pr = await window.editorstage.probe(m.path);
    if (!pr?.ok || pr.codec !== want.codec || !want.pix.includes(pr.pixFmt)) return { reason: `${m.name} is ${pr?.codec || '?'} ${pr?.pixFmt || ''}, not ${want.codec} ${want.pix[0]}` };
    if (pr.width !== opts.width || pr.height !== opts.height || Math.abs((pr.fps || 0) - fps) > 0.01) return { reason: `${m.name} does not match the output size / frame rate` };
    const inP = (c.inPoint || 0) + (s0 - c.start);
    if (!(await keyframes(m.path)).some((k) => Math.abs(k - inP) < half)) return { reason: `a cut in ${m.name} is not on a keyframe` };
    segs.push({ path: m.path, inPoint: inP, outPoint: inP + (s1 - s0) }); at = s1;
  }
  if (at < b - half) return { reason: 'the range has a gap' };
  return { segments: segs };
}

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
/**
 * opts: { path, preset, width, height, fps, start, end, audio, loudness (LUFS | null), truePeak, chapters, fit ('fit' | 'fill' | 'stretch'),
 *         encoder ('software' | 'nvenc' | 'qsv' | 'amf'), smart (try Smart Render), burnCaptions (default true), sidecar ('srt' | 'vtt'),
 *         state (snapshot; default: now), jobId }.
 * Calls onProgress(0..1, text). cancel() -> true aborts. Resolves { ok, error?, smart?, encoder?, notes[] }.
 */
/** The file an export renders into: <name>.es-part.<ext> beside the target (same container), renamed when finished. */
export const partPath = (p) => p.replace(/(\.[^.\\/]+)?$/, (x) => `.es-part${x}`);
const ipcError = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
/** <name>.png -> <name>_%05d.png: the numbered frames of an image sequence export. */
export const sequencePattern = (p) => p.replace(/(\.[^.\\/]+)?$/, '_%05d$1');
export async function exportSequence(opts, onProgress, cancel) {
  if (PRESETS[opts.preset]?.imageSeq) { // many files: written under their final names (a cancelled export leaves the frames made so far)
    try { return await renderExport({ ...opts, path: sequencePattern(opts.path), finalPath: opts.path }, onProgress, cancel); } catch (e) { return { ok: false, error: ipcError(e) }; }
  }
  // render into a temporary name and rename it once the encoder finished: a cancelled or failed export never leaves a
  // half-written file, and an existing file of the same name stays intact until the new one is complete
  const es = window.editorstage; const part = partPath(opts.path);
  let r;
  try { r = await renderExport({ ...opts, path: part, finalPath: opts.path }, onProgress, cancel); } catch (e) { r = { ok: false, error: ipcError(e) }; }
  if (r?.ok) { try { await es.rename(part, opts.path); } catch (e) { r = { ok: false, error: `Cannot replace ${opts.path}: ${ipcError(e)}` }; } }
  if (!r?.ok) await es.removeFile(part).catch(() => {});
  return r;
}
async function renderExport(opts, onProgress, cancel) {
  const es = window.editorstage; const P = PRESETS[opts.preset]; const id = opts.jobId || `export-${uid()}`; const notes = [];
  let state = opts.state || structuredClone({ ...getState(), log: [], dialog: null });
  const dur = opts.end - opts.start; if (dur <= 0) return { ok: false, error: 'Empty range' };
  // captions as a sidecar file (times relative to the exported range) and / or not burnt into the picture
  const capTrack = state.sequence.tracks.find((t) => t.kind === 'caption' && state.sequence.clips.some((c) => c.track === t.id && c.caption));
  if (opts.sidecar && capTrack) {
    const sq = { ...state.sequence, clips: state.sequence.clips.filter((c) => c.caption && c.start < opts.end && c.start + c.dur > opts.start).map((c) => ({ ...c, start: c.start - opts.start })) };
    await es.writeFile((opts.finalPath || opts.path).replace(/\.[^.\\/]+$/, '') + '.' + opts.sidecar, '﻿' + (opts.sidecar === 'vtt' ? captionsToVtt : captionsToSrt)(sq, capTrack.id));
  }
  if (opts.burnCaptions === false) state = { ...state, sequence: { ...state.sequence, clips: state.sequence.clips.filter((c) => !c.caption) } };
  const tmp = await es.tmpDir(); const sep = tmp.includes('\\') ? '\\' : '/'; const temps = [];
  const tmpFile = (ext) => { const p = `${tmp}${sep}editorstage-${id}-${temps.length}.${ext}`; temps.push(p); return p; };
  try {
    let audioPath = null;
    if (opts.audio && P.audio) {
      onProgress(0, 'Mixing audio…');
      const pcm = await renderAudioMix(state, opts.start, opts.end);
      audioPath = tmpFile('wav'); await es.writeFile(audioPath, wavBytes(pcm));
      if (opts.loudness != null) {
        onProgress(0, 'Loudness Normalization…');
        const norm = tmpFile('wav'); const r = await normalizeLoudness(audioPath, norm, opts.loudness, opts.truePeak ?? -1);
        if (!r.ok) return { ok: false, error: r.error };
        if (r.skipped) notes.push('Loudness Normalization skipped: the mix is silent'); else { audioPath = norm; notes.push(`Loudness ${r.measured.i.toFixed(1)} → ${opts.loudness} LUFS`); }
      }
    }
    if (cancel()) return { ok: false, error: 'Cancelled' };
    // extra inputs after the picture (stdin or concat list) and the audio
    const meta = opts.chapters && supportsChapters(P) ? chapterFile(flatten(state).sequence, opts.start, opts.end) : null;
    let metaPath = null; if (meta) { metaPath = tmpFile('txt'); await es.writeFile(metaPath, new TextEncoder().encode(meta)); }
    const tail = (vIn, aIn, mIn) => [...(vIn != null ? ['-map', `${vIn}:v:0`] : []), ...(aIn != null ? ['-map', `${aIn}:a:0`] : []), ...(mIn != null ? ['-map_metadata', String(mIn), '-map_chapters', String(mIn)] : [])];
    const done = async (r) => { if (!r.ok) return r; onProgress(1, 'Done'); return { ...r, notes, encoder: r.encoder }; };

    if (P.audioOnly) {
      if (!audioPath) return { ok: false, error: 'Audio disabled' };
      const r = await es.ffmpeg(['-y', '-hide_banner', '-nostdin', '-i', audioPath, ...(metaPath ? ['-i', metaPath] : []), ...tail(null, 0, metaPath ? 1 : null), ...P.audio, opts.path], id);
      return done(r.ok ? { ok: true } : { ok: false, error: r.error });
    }
    if (opts.smart) {
      onProgress(0, 'Smart Render: checking clips…');
      const plan = await smartRenderPlan(state, opts);
      if (plan.segments) {
        const q = (p) => `'${p.replace(/'/g, "'\\''")}'`;
        const list = tmpFile('ffconcat'); const L = ['ffconcat version 1.0', ...plan.segments.flatMap((g) => [`file ${q(g.path)}`, `inpoint ${g.inPoint.toFixed(6)}`, `outpoint ${g.outPoint.toFixed(6)}`])].join('\n');
        await es.writeFile(list, new TextEncoder().encode(L));
        onProgress(0.1, 'Smart Render: copying video…');
        const ins = ['-f', 'concat', '-safe', '0', '-i', list, ...(audioPath ? ['-i', audioPath] : []), ...(metaPath ? ['-i', metaPath] : [])];
        const r = await es.ffmpeg(['-y', '-hide_banner', '-nostdin', ...ins, ...tail(0, audioPath ? 1 : null, metaPath ? (audioPath ? 2 : 1) : null),
          '-c:v', 'copy', ...(P.codec === 'hevc' ? ['-tag:v', 'hvc1'] : []), ...(audioPath ? P.audio : []), '-t', dur.toFixed(6), opts.path], id);
        if (r.cancelled) return { ok: false, error: 'Cancelled' };
        if (r.ok) return done({ ok: true, smart: true, encoder: 'copy' });
        notes.push(`Smart Render failed (${r.error}): rendered instead`);
      } else notes.push(`Smart Render not used: ${plan.reason}`);
    }

    const { width: w, height: h, fps } = opts; const seq = state.sequence;
    // render at the sequence's shape and let FFmpeg pad / crop to the output frame (platform presets with another aspect)
    let rw = w, rh = h; let fitVf = null;
    const sa = seq.width / seq.height, oa = w / h;
    if (opts.fit !== 'stretch' && Math.abs(sa - oa) > 0.01) {
      const k = opts.fit === 'fill' ? Math.max(w / seq.width, h / seq.height) : Math.min(w / seq.width, h / seq.height);
      rw = Math.max(2, Math.round((seq.width * k) / 2) * 2); rh = Math.max(2, Math.round((seq.height * k) / 2) * 2);
      fitVf = opts.fit === 'fill' ? `crop=${w}:${h}` : `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`;
    }
    const va = P.ext === 'gif' ? { args: P.video, encoder: 'software' } : await videoArgs(P, opts.encoder, { width: rw, height: rh, fps }); if (va.note) notes.push(va.note);
    const canvas = document.createElement('canvas');
    const comp = new Compositor(canvas); comp.resize(rw, rh);
    const gl = comp.gl; const px = new Uint8Array(rw * rh * 4);
    // Each frame is copied through IPC: without an alpha channel, the unused fourth byte is left out (25% less per frame).
    const rgb = P.alpha ? null : new Uint8Array(rw * rh * 3);
    const args = ['-y', '-hide_banner', '-f', 'rawvideo', '-pix_fmt', P.alpha ? 'rgba' : 'rgb24', '-s', `${rw}x${rh}`, '-r', String(fps), '-i', '-'];
    if (audioPath) args.push('-i', audioPath);
    if (metaPath) args.push('-i', metaPath);
    args.push(...tail(0, audioPath ? 1 : null, metaPath ? (audioPath ? 2 : 1) : null));
    const vf = ['vflip', fitVf, seq.par && seq.par !== '1/1' ? `setsar=${seq.par}` : null].filter(Boolean).join(','); // Sequence Settings > Pixel Aspect Ratio
    if (P.ext === 'gif') args.push('-vf', `${vf},split[a][b];[a]palettegen[p];[b][p]paletteuse`); else args.push('-vf', vf, ...va.args);
    if (audioPath && P.audio) args.push(...P.audio, '-shortest');
    args.push(opts.path);
    const st = await es.job.start(id, args); if (!st.ok) return st;
    const frames = Math.round(dur * fps);
    if (getState().playing) set({ playing: false });
    lockPlayback(true);
    try {
      for (let i = 0; i < frames; i++) {
        if (cancel()) { await es.job.cancel(id); return { ok: false, error: 'Cancelled' }; }
        const t = opts.start + i / fps;
        // a frame drawn while the GPU context is lost would be black: wait for the restore and draw it again, or fail the export
        let drawn = false;
        for (let attempt = 0; attempt < 3 && !drawn; attempt++) {
          await prepareFrame(state, t);
          if (P.alpha) drawn = comp.render({ ...state, playhead: t }, renderDeps, { w: rw, h: rh, alpha: true, read: px });
          else {
            drawn = comp.render({ ...state, playhead: t }, renderDeps, { w: rw, h: rh });
            if (drawn) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, px); }
          }
          if (gl.isContextLost()) drawn = false;
          if (!drawn && !(await comp.whenRestored())) break;
        }
        if (!drawn) { await es.job.cancel(id); return { ok: false, error: 'The graphics context was lost during the export and did not come back. Save, restart EditorStage and export again.' }; }
        if (P.alpha) for (let j = 0; j < px.length; j += 4) { const al = px[j + 3]; if (al && al < 255) { const k = 255 / al; px[j] = Math.min(255, px[j] * k + 0.5); px[j + 1] = Math.min(255, px[j + 1] * k + 0.5); px[j + 2] = Math.min(255, px[j + 2] * k + 0.5); } } // straight alpha
        if (!(await es.job.write(id, rgb ? rgbaToRgb(px, rgb) : px))) { const r = await es.job.end(id); return { ok: false, error: r.error || 'The encoder stopped' }; }
        if (i % 3 === 0) onProgress(i / frames, `Rendering frame ${i + 1} / ${frames}`);
      }
    } finally { lockPlayback(false); comp.dispose(); }
    onProgress(1, 'Finalizing…');
    return done({ ...(await es.job.end(id)), encoder: va.encoder });
  } finally { for (const p of temps) es.removeFile(p).catch(() => {}); }
}
export const wavBytesFromPcm = (pcm) => wavBytes(pcm);
/** Render one sequence frame exactly like Export (same seeking and compositor). Returns ImageData (top row first). */
export async function renderFrame(t, w, h) { return renderStateFrame(structuredClone({ ...getState(), log: [], dialog: null }), t, w, h); }
/**
 * One clip alone at sequence time t (w x h, the sequence frame): timeline thumbnails of nested sequences and motion
 * graphics templates, which have no media file to decode. Its own effects, Motion and opacity apply; the clips around it
 * and transitions do not. null when the clip is not in the active sequence.
 */
export async function renderClipFrame(clipId, t, w, h) {
  const st = getState(); const seq = st.sequence; const c = seq.clips.find((x) => x.id === clipId); if (!c) return null;
  const tr = seq.tracks.find((x) => x.id === c.track) || { id: c.track, kind: 'video' };
  const one = { ...seq, clips: [c], transitions: [], tracks: [{ ...tr, hidden: false, muted: true, solo: false }] };
  return renderStateFrame(structuredClone({ ...st, sequence: one, mcView: false, log: [], dialog: null }), t, w, h);
}
async function renderStateFrame(state, t, w, h) {
  const canvas = document.createElement('canvas'); const comp = new Compositor(canvas); comp.resize(w, h);
  const gl = comp.gl; const px = new Uint8Array(w * h * 4);
  lockPlayback(true);
  try { await prepareFrame(state, t); comp.render({ ...state, playhead: t }, renderDeps, { w, h }); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  finally { lockPlayback(false); comp.dispose(); }
  const img = new ImageData(w, h); const row = w * 4;
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row); // GL rows are bottom-up
  return img;
}
export const defaultRange = () => ({ start: 0, end: sequenceEnd(getState().sequence) });
