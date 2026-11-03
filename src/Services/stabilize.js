import { getState, edit } from '../Core/store';
import { mediaById, fileUrl, clipSourceTime } from './media';
import { detectObjects, detectFace } from './vision';

async function openClipVideo(clipId) {
  const s = getState(); const clip = s.sequence.clips.find((c) => c.id === clipId); const media = clip && mediaById(clip.mediaId);
  if (!media || media.kind !== 'video') throw new Error('Needs a video clip');
  const el = document.createElement('video'); el.crossOrigin = 'anonymous'; el.muted = true; el.preload = 'auto'; el.src = fileUrl(media.playPath);
  await new Promise((res, rej) => { el.onloadeddata = res; el.onerror = () => rej(new Error('load failed')); });
  return { s, clip, media, el };
}
const seekTo = (el, t) => new Promise((res) => { el.currentTime = t; const d = () => { el.removeEventListener('seeked', d); res(); }; el.addEventListener('seeked', d); setTimeout(d, 1500); });
let W = 96, H = 54;
function grabber(el) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d', { willReadFrequently: true });
  return () => { g.drawImage(el, 0, 0, W, H); const d = g.getImageData(0, 0, W, H).data; const o = new Float32Array(W * H); for (let i = 0; i < W * H; i++) o[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; return o; };
}

/** Warp Stabilizer: block-match a grid of blocks between frames, fit a similarity (translation, rotation, scale) per frame. */
export async function analyzeStabilizer(clipId, fxId, onProgress) {
  let ctx; try { ctx = await openClipVideo(clipId); } catch (e) { return { ok: false, error: e.message }; }
  const { s, clip, media, el } = ctx; const fps = s.sequence.fps, n = Math.max(2, Math.floor(clip.dur * fps));
  const AW = 160, AH = 90; const cv = document.createElement('canvas'); cv.width = AW; cv.height = AH; const g = cv.getContext('2d', { willReadFrequently: true });
  const gray = () => { g.drawImage(el, 0, 0, AW, AH); const d = g.getImageData(0, 0, AW, AH).data; const o = new Float32Array(AW * AH); for (let i = 0; i < AW * AH; i++) o[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; return o; };
  const R = 6, BS = 24, cols = 5, rows = 3; const path = []; let prev = null; let x = 0, y = 0, rot = 0, ls = 0;
  const blocks = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) blocks.push([Math.round(12 + (c * (AW - 24 - BS)) / (cols - 1)), Math.round(8 + (r * (AH - 16 - BS)) / (rows - 1))]);
  for (let k = 0; k < n; k++) {
    await seekTo(el, clipSourceTime(clip, clip.start + k / fps, media));
    const cur = gray();
    if (prev) {
      const obs = [];
      for (const [bx, by] of blocks) {
        const sad = (dx, dy) => { let a = 0; for (let yy = 0; yy < BS; yy += 2) for (let xx = 0; xx < BS; xx += 2) a += Math.abs(cur[(by + yy) * AW + bx + xx] - prev[Math.min(AH - 1, Math.max(0, by + yy - dy)) * AW + Math.min(AW - 1, Math.max(0, bx + xx - dx))]); return a; };
        let best = Infinity, mx = 0, my = 0;
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const v = sad(dx, dy); if (v < best) { best = v; mx = dx; my = dy; } }
        const par = (a, b2, c2) => { const dn = a - 2 * b2 + c2; return Math.abs(dn) < 1e-6 ? 0 : Math.max(-0.5, Math.min(0.5, (a - c2) / (2 * dn))); };
        const fx = par(sad(mx - 1, my), best, sad(mx + 1, my)), fy = par(sad(mx, my - 1), best, sad(mx, my + 1));
        obs.push({ px: bx + BS / 2 - AW / 2, py: by + BS / 2 - AH / 2, mx: mx + fx, my: my + fy });
      }
      let n4 = obs.length, Sx = 0, Sy = 0, Spp = 0, Su = 0, Sv = 0, Sa = 0, Sb = 0;
      for (const o of obs) { Sx += o.px; Sy += o.py; Spp += o.px * o.px + o.py * o.py; Su += o.mx; Sv += o.my; Sa += o.mx * o.px + o.my * o.py; Sb += o.my * o.px - o.mx * o.py; }
      const mxm = Sx / n4, mym = Sy / n4; const denom = Spp - n4 * (mxm * mxm + mym * mym) || 1;
      const a = (Sa - (Su * mxm + Sv * mym)) / denom, b = (Sb - (Sv * mxm - Su * mym)) / denom;
      const tx = Su / n4 - a * mxm + b * mym, ty = Sv / n4 - b * mxm - a * mym;
      x += tx / AW; y += ty / AH; rot += b; ls += Math.log(1 + a);
    }
    path.push([x, y, rot, ls]); prev = cur;
    if (k % 4 === 0) onProgress?.(k / n);
  }
  el.removeAttribute('src'); el.load();
  // margin from the high-frequency part only (what the effect actually removes)
  const hp = (i) => { const w = Math.round(fps * 1.5); let sm = [0, 0, 0]; let c = 0; for (let j = Math.max(0, i - w); j <= Math.min(path.length - 1, i + w); j++) { for (let q = 0; q < 3; q++) sm[q] += path[j][q]; c++; } return [0, 1, 2].map((q) => Math.abs(path[i][q] - sm[q] / c)); };
  let mx = 0, mr = 0; for (let i = 0; i < path.length; i++) { const h = hp(i); mx = Math.max(mx, h[0], h[1]); mr = Math.max(mr, h[2]); }
  const margin = Math.min(0.35, Math.max(0.02, mx * 1.2 + mr * 0.6 + 0.01));
  edit('Analyze Warp Stabilizer', ({ seq }) => { const f = seq.clips.find((c) => c.id === clipId).effects.find((q) => q.id === fxId); f.analysis = { fps, path, margin }; });
  return { ok: true, frames: n };
}
/** Auto Reframe: find the subject per frame (person via object detection, else any salient object/face, else motion/detail centroid). */
export async function analyzeReframe(clipId, fxId, onProgress) {
  let ctx; try { ctx = await openClipVideo(clipId); } catch (e) { return { ok: false, error: e.message }; }
  const { s, clip, media, el } = ctx; const fps = Math.min(s.sequence.fps, 15), n = Math.max(2, Math.floor(clip.dur * fps)); const gray = grabber(el);
  const dv = document.createElement('canvas'); dv.width = 320; dv.height = Math.round(320 * ((el.videoHeight || 9) / (el.videoWidth || 16))); const dg = dv.getContext('2d', { willReadFrequently: true });
  const path = []; let prev = null; let hits = 0;
  for (let k = 0; k < n; k++) {
    await seekTo(el, clipSourceTime(clip, clip.start + k / fps, media));
    const cur = gray(); dg.drawImage(el, 0, 0, dv.width, dv.height);
    let center = null;
    try {
      const objs = await detectObjects(dv);
      const people = objs.filter((o) => o.cat === 'person').sort((a, b) => b.score * b.box[2] * b.box[3] - a.score * a.box[2] * a.box[3]);
      const pick = people[0] || objs.sort((a, b) => b.score * Math.sqrt(b.box[2] * b.box[3]) - a.score * Math.sqrt(a.box[2] * a.box[3]))[0];
      if (pick) center = [pick.box[0] + pick.box[2] / 2, pick.box[1] + pick.box[3] * (pick.cat === 'person' ? 0.4 : 0.5)];
      if (!center) { const fl = await detectFace(dv); if (fl) { let x = 0, y = 0; for (const p of fl) { x += p[0]; y += p[1]; } center = [x / fl.length, y / fl.length]; } }
    } catch { /* detector unavailable */ }
    if (center) hits++;
    else { // fallback: motion/detail weighted centroid
      let sw = 0, sx = 0, sy = 0;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; const w = (Math.abs(cur[i + 1] - cur[i - 1]) + Math.abs(cur[i + W] - cur[i - W])) * 0.3 + (prev ? Math.abs(cur[i] - prev[i]) * 2 : 0) + 0.01; sw += w; sx += w * x; sy += w * y; }
      center = [sx / sw / W, sy / sw / H];
    }
    path.push(center); prev = cur;
    if (k % 2 === 0) onProgress?.(k / n);
  }
  el.removeAttribute('src'); el.load();
  edit('Analyze Auto Reframe', ({ seq }) => { const f = seq.clips.find((c) => c.id === clipId).effects.find((q) => q.id === fxId); f.analysis = { fps, path, subjectFrames: hits }; });
  return { ok: true, frames: n, subjectFrames: hits };
}