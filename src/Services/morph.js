import { getState, edit } from '../Core/store';
import { mediaById, fileUrl, clipSourceTime } from './media';
import { detectFace } from './vision';

const open = async (media) => {
  const el = document.createElement('video'); el.crossOrigin = 'anonymous'; el.muted = true; el.preload = 'auto'; el.src = fileUrl(media.playPath);
  await new Promise((res, rej) => { el.onloadeddata = res; el.onerror = () => rej(new Error('load failed')); });
  return el;
};
const seekTo = (el, t) => new Promise((res) => { el.currentTime = t; const d = () => { el.removeEventListener('seeked', d); res(); }; el.addEventListener('seeked', d); setTimeout(d, 1500); });

/** Face landmarks for every frame of both clips across the transition window. Stored on the transition (tr.analysis). */
export async function analyzeMorphCut(trId, onProgress) {
  const s = getState(); const tr = (s.sequence.transitions || []).find((x) => x.id === trId); if (!tr) return { ok: false, error: 'no transition' };
  const A = s.sequence.clips.find((c) => c.id === tr.aId), B = s.sequence.clips.find((c) => c.id === tr.bId);
  const fps = Math.min(30, s.sequence.fps), t0 = tr.at - tr.dur / 2, n = Math.max(2, Math.round(tr.dur * fps) + 1);
  const cv = document.createElement('canvas'); cv.width = 384; cv.height = 216; const g = cv.getContext('2d', { willReadFrequently: true });
  const run = async (clip) => {
    const media = clip && mediaById(clip.mediaId); if (!media || media.kind !== 'video') return null;
    const el = await open(media); const frames = []; let found = 0;
    for (let k = 0; k < n; k++) {
      await seekTo(el, clipSourceTime(clip, t0 + k / fps, media)); g.drawImage(el, 0, 0, cv.width, cv.height);
      let lm = null; try { lm = await detectFace(cv); } catch { /* no face */ }
      if (lm) found++; frames.push(lm ? lm.flatMap((p) => [+p[0].toFixed(4), +p[1].toFixed(4)]) : null);
      onProgress?.((k + 1) / n / 2 + (clip === B ? 0.5 : 0));
    }
    el.removeAttribute('src'); el.load(); return { frames, found };
  };
  const ra = await run(A), rb = await run(B);
  edit('Analyze Morph Cut', ({ seq }) => { const t = seq.transitions.find((x) => x.id === trId); if (t) t.analysis = { t0, fps, a: ra?.frames || null, b: rb?.frames || null, facesA: ra?.found || 0, facesB: rb?.found || 0 }; });
  return { ok: true, facesA: ra?.found || 0, facesB: rb?.found || 0, frames: n };
}
