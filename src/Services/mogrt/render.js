import { openMogrt } from './library';
import { parseAep } from './aep/index.js';
import { createEvaluator } from './evaluator.js';
import { createPainter, paintWithMotionBlur, hasMotionBlur } from './painter';
import { measureText, registerTemplateFonts } from './text';
import { decodeFootageFile, videoFrame, seekVideos } from './footage';
import { evalParam } from '../../Core/params';
import { getState } from '../../Core/store';
import { elementForMedia } from '../media';

// A prepared template: parsed AEP scene + decoded footage + evaluator + painter. One per installed template.
const prepared = new Map(); // libId -> Promise<Instance>
const baseName = (p) => String(p || '').split(/[\\/]/).pop().toLowerCase();

export function prepareMogrt(libId) {
  if (!prepared.has(libId)) prepared.set(libId, build(libId).catch((e) => { prepared.delete(libId); throw e; }));
  return prepared.get(libId);
}
export const getPrepared = (libId) => { const p = prepared.get(libId); return p && p.__ready ? p.__ready : null; };

async function build(libId) {
  const entry = await openMogrt(libId); const { pkg } = entry;
  if (!pkg.aep) throw new Error('This template has no After Effects project to render');
  const t0 = performance.now();
  const scene = parseAep(pkg.aep);
  const comp = scene.comps.find((c) => c.name === pkg.meta.compName) || scene.comps.slice().sort((a, b) => b.layers.length - a.layers.length)[0];
  if (!comp) throw new Error('No composition found in the template');
  // decode packed footage (images, PSD, AI/PDF, video, audio, FFmpeg fallback for the rest)
  const sources = new Map(); const failedFootage = []; const missingFootage = [];
  const byFile = new Map([...pkg.footage.values()].map((f) => [baseName(f.name), f]));
  await Promise.all(scene.footage.filter((f) => f.kind === 'file').map(async (f) => {
    const file = byFile.get(baseName(f.path)) || byFile.get(baseName(f.name));
    if (!file) { missingFootage.push(f.name || f.path); return; }
    const src = await decodeFootageFile(file, f);
    if (!src || src.kind === 'error') failedFootage.push(`${file.name}${src?.error ? ` (${src.error})` : ''}`);
    else sources.set(f.id, src);
  }));
  const missingFonts = await registerTemplateFonts(scene.usedFonts, pkg.fonts);
  if (missingFonts.length) console.warn('MOGRT: fonts not installed/embedded, using fallback:', missingFonts.join(', '));
  const replaced = new Map(); // footageId -> media element (media replacement controls)
  const fps = comp.frameRate || pkg.meta.fps || 30;
  const mode = { playing: false }; // set per render: playing -> template videos play instead of seeking every frame
  const getImage = (id, time) => {
    const el = replaced.get(id);
    if (el) { if (el.tagName === 'VIDEO') videoFrame({ video: el }, time || 0, fps, mode.playing); return el; }
    const s = sources.get(id); if (!s) return null;
    if (s.kind === 'image') return s.image;
    if (s.kind === 'video') return videoFrame(s, time || 0, fps, mode.playing);
    return null;
  };
  const painter = createPainter({ getImage });
  const inst = { libId, entry, scene, comp, sources, replaced, painter, mode, missingFonts, failedFootage, missingFootage, fps, canvas: null, lastKey: '', evaluator: null, lastAudio: new Map(), buildMs: performance.now() - t0 };
  const mctx = document.createElement('canvas').getContext('2d');
  inst.evaluator = createEvaluator(scene, {
    measureText: (doc) => measureText(mctx, doc), // real glyph metrics for sourceRectAtTime()
    footageSize: (id) => { const el = replaced.get(id); return el ? { width: el.videoWidth || el.naturalWidth || el.width, height: el.videoHeight || el.naturalHeight || el.height } : null; },
  });
  inst.__ready = inst;
  prepared.get(libId).__ready = inst;
  return inst;
}

/** Problems worth showing to the user for a prepared template. */
export function templateWarnings(inst) {
  if (!inst) return [];
  const out = [];
  if (inst.missingFonts.length) out.push(`Missing fonts (fallback used): ${inst.missingFonts.join(', ')}`);
  if (inst.missingFootage.length) out.push(`Footage not packed in the template: ${inst.missingFootage.join(', ')}`);
  if (inst.failedFootage.length) out.push(`Footage that could not be decoded: ${inst.failedFootage.join(', ')}`);
  const fx = [...inst.painter.stats.unsupportedEffects]; if (fx.length) out.push(`Effects not rendered: ${fx.join(', ')}`);
  return out;
}

/** Control values (keyframed params in clip.mogrt.values) -> evaluator overrides at template time t. */
export function controlOverrides(inst, values, localTime) {
  const out = {};
  for (const c of inst.entry.controls.list) {
    if (c.type === 'group' || c.type === 'comment') continue;
    const p = values?.[c.id]; let v = p === undefined ? undefined : evalParam(p, localTime);
    if (v === undefined) continue;
    if (c.type === 'media') {
      const mid = v && typeof v === 'object' ? v.mediaId : null; const m = mid && getState().media.find((x) => x.id === mid);
      const el = m && m.status === 'ready' && m.kind !== 'audio' ? elementForMedia(m, 'mogrt:' + mid) : null;
      if (el) { const fid = 'media:' + mid; inst.replaced.set(fid, el); out[c.id] = { footageId: fid }; }
      continue;
    }
    out[c.id] = v;
  }
  return out;
}

function evaluateFrame(inst, tmplTime, ov) {
  inst.evaluator.setControls?.(ov);
  return inst.evaluator.evaluateComp(inst.comp.id, tmplTime, ov);
}

/** list of {src, time} for every video source used by a frame (recursively) */
function videosOf(inst, frame, out = []) {
  for (const l of frame.layers) {
    if (l.visible && l.kind === 'footage' && l.source) { const s = inst.sources.get(l.source.footageId); if (s && s.kind === 'video') out.push({ src: s, time: l.source.time }); const r = inst.replaced.get(l.source.footageId); if (r && r.tagName === 'VIDEO') out.push({ src: { video: r }, time: l.source.time }); }
    if (l.precomp) videosOf(inst, l.precomp.frame, out);
    if (l.echo) for (const c of l.echo.copies) if (c.layer.source) { const s = inst.sources.get(c.layer.source.footageId); if (s && s.kind === 'video') out.push({ src: s, time: c.layer.source.time }); }
  }
  return out;
}

const vidKey = (vids) => vids.map((v) => Math.round((v.src.video.currentTime || 0) * 1000)).join(',');

/**
 * Render the template at `tmplTime` (seconds inside the template) with the clip's control values.
 * Returns a canvas (reused per clip) sized to the comp aspect at `outWidth` pixels wide.
 * opts: { playing, fps } from the live preview. Preview frames are quantized to `fps`, reused without re-evaluating the
 * template when nothing changed, and rendered at an adaptive resolution while playing so playback keeps real time.
 */
export function renderMogrt(inst, clipKey, values, tmplTime, localTime, outWidth, opts = {}) {
  const c = inst.comp; const playing = !!opts.playing && !opts.export;
  if (!inst.canvasByClip) inst.canvasByClip = new Map();
  let slot = inst.canvasByClip.get(clipKey);
  if (!slot) { slot = { canvas: document.createElement('canvas'), key: '', pre: null, vids: [], vkey: '', scale: 1, ms: 0 }; inst.canvasByClip.set(clipKey, slot); }
  if (opts.fps && !opts.export) tmplTime = Math.round(tmplTime * opts.fps) / opts.fps; // the display refresh (60 Hz) is faster than the sequence
  const scale = playing ? slot.scale : 1;
  // fast path: same values / frame / size as the last paint and its videos have not moved -> skip the (expensive) expression evaluation
  const pre = slot.pre;
  if (pre && pre.values === values && pre.t === tmplTime && pre.w === outWidth && pre.scale === scale && pre.playing === playing && (!pre.animated || pre.local === localTime)
    && !slot.vids.some((v) => v.src.video.seeking) && vidKey(slot.vids) === slot.vkey) return slot.canvas;
  inst.mode.playing = playing;
  const t0 = performance.now();
  const s = (Math.min(outWidth, 3840) / c.width) * scale;
  const ov = controlOverrides(inst, values, localTime);
  const frame = evaluateFrame(inst, tmplTime, ov);
  inst.lastAudio.set(clipKey, frame.audio || []);
  const vids = videosOf(inst, frame); const vkey = vidKey(vids);
  const key = JSON.stringify([ov, +tmplTime.toFixed(4), Math.round(outWidth), scale, playing, vkey]); // playing frames have no motion blur
  const animated = !!values && Object.values(values).some((p) => p && p.keys); // keyframed controls depend on clip-local time too
  slot.pre = { values, t: tmplTime, w: outWidth, scale, playing, local: localTime, animated };
  if (slot.key === key && !vids.some((v) => v.src.video.seeking)) { slot.vids = vids; slot.vkey = vkey; return slot.canvas; }
  // motion blur re-renders every blurred layer once per shutter sample (8x the cost): playback shows the unblurred frame,
  // paused frames and export keep the full blur
  const sub = playing ? inst.painter.paintComp(frame, s) : paintWithMotionBlur(inst.painter, frame, s, (tk) => evaluateFrame(inst, tk, ov), inst.fps, opts.export ? 64 : 8);
  if (!playing && hasMotionBlur(frame)) evaluateFrame(inst, tmplTime, ov); // leave the evaluator at the centre time
  if (slot.canvas.width !== sub.width || slot.canvas.height !== sub.height) { slot.canvas.width = sub.width; slot.canvas.height = sub.height; }
  const g = slot.canvas.getContext('2d'); g.clearRect(0, 0, sub.width, sub.height); g.drawImage(sub, 0, 0);
  inst.painter.release(sub); slot.key = key; slot.vids = vids; slot.vkey = vidKey(vids);
  slot.canvas.__ver = (slot.canvas.__ver || 0) + 1; // lets the compositor skip re-uploading an unchanged canvas
  if (playing) adaptScale(slot, performance.now() - t0, opts.fps || inst.fps);
  return slot.canvas;
}

/** Playback: lower the template's render resolution while a frame costs more than half the frame budget, raise it back when cheap. */
function adaptScale(slot, ms, fps) {
  slot.ms = slot.ms ? slot.ms * 0.6 + ms * 0.4 : ms;
  const budget = 500 / (fps || 30);
  if (slot.ms > budget && slot.scale > 0.35) { slot.scale = Math.max(0.35, +(slot.scale * 0.8).toFixed(3)); slot.ms = 0; }
  else if (slot.ms < budget * 0.35 && slot.scale < 1) { slot.scale = Math.min(1, +(slot.scale * 1.15).toFixed(3)); slot.ms = 0; }
}

/** Export: seek every template video to the exact frame before rendering. */
export async function prepareMogrtFrame(inst, values, tmplTime, localTime) {
  const ov = controlOverrides(inst, values, localTime);
  const frame = evaluateFrame(inst, tmplTime, ov);
  await seekVideos(videosOf(inst, frame));
}
