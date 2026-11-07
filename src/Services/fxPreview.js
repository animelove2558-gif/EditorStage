// Hover preview in the Effects panel: a small animated render of a video effect / transition / preset on built-in test pictures,
// with its own offscreen Compositor (never the Program monitor's).
import { Compositor } from '../Renderers/Compositor';
import { VIDEO_FX } from '../Renderers/fx/videoEffects';
import { EXT_TRANSITIONS, extDefaults } from '../Renderers/fx/moreTransitions';
import { evalParam } from '../Core/params';

export const PW = 192, PH = 108;
let C = null, pics = null, px = null;

function picture(dark) {
  const cv = document.createElement('canvas'); cv.width = PW * 2; cv.height = PH * 2; const g = cv.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, cv.height); sky.addColorStop(0, dark ? '#1b2a6b' : '#5fb4ff'); sky.addColorStop(0.62, dark ? '#c0507a' : '#ffe0a6'); sky.addColorStop(0.63, dark ? '#20331f' : '#3f8a3a'); sky.addColorStop(1, dark ? '#0d160c' : '#25551f');
  g.fillStyle = sky; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = dark ? '#f6f2d0' : '#fff7c2'; g.beginPath(); g.arc(cv.width * 0.72, cv.height * 0.32, cv.height * 0.13, 0, Math.PI * 2); g.fill();
  ['#e53935', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'].forEach((c, i) => { g.fillStyle = c; g.fillRect(cv.width * (0.08 + i * 0.07), cv.height * 0.5, cv.width * 0.06, cv.height * 0.3); });
  g.fillStyle = '#ffffff'; g.font = `bold ${cv.height * 0.3}px system-ui, sans-serif`; g.textBaseline = 'middle'; g.fillText(dark ? 'B' : 'A', cv.width * 0.06, cv.height * 0.24);
  return cv;
}
function init() {
  if (C) return true;
  try { const cv = document.createElement('canvas'); C = new Compositor(cv); C.resize(PW, PH); pics = [picture(false), picture(true)]; px = new Uint8Array(PW * PH * 4); return true; } catch { C = null; return false; }
}
const src = (i) => { const t = C.upload(`pv:${i}`, pics[i]); if (t) t.static = true; return t; };
const valsAt = (params, t) => Object.fromEntries(Object.entries(params || {}).map(([k, v]) => [k, v && typeof v === 'object' && Array.isArray(v.keys) ? evalParam({ v: v.keys[0]?.v, keys: v.keys }, t) : v]));
const defaults = (name) => Object.fromEntries((VIDEO_FX[name]?.params || []).map((p) => [p.id, p.def]));

/** Can this item be previewed as a picture? item: { kind: 'effect'|'transition'|'preset', name, preset } */
export function previewable(item) {
  if (item.kind === 'effect') return !!VIDEO_FX[item.name] && !VIDEO_FX[item.name].custom;
  if (item.kind === 'transition') return item.media === 'video';
  const p = item.preset; return !!p && p.media === 'video' && !!(p.transition || p.lumetri || p.effects?.length);
}
/** Draw item at time t (seconds, loops) into a 2D canvas of PW x PH. Returns false if nothing could be drawn. */
export function drawPreview(ctx2d, item, t) {
  if (!init() || !previewable(item) || C.gl.isContextLost()) return false; // after a restore the test pictures upload again
  const a = src(0), b = src(1); if (!a || !b) return false;
  let out = a;
  try {
    if (item.kind === 'effect') out = C.effect(VIDEO_FX[item.name], item.name, defaults(item.name), a, t);
    else if (item.kind === 'transition') { const p = Math.min(1, (t % 2.4) / 2); out = C.transition(item.name, a, b, p, null, EXT_TRANSITIONS[item.name] ? extDefaults(item.name) : null); }
    else {
      const pr = item.preset;
      if (pr.transition) { const p = Math.min(1, (t % 2.4) / 2); out = C.transition(pr.transition.name, a, b, p, null, { ...(EXT_TRANSITIONS[pr.transition.name] ? extDefaults(pr.transition.name) : {}), ...pr.transition.params }); }
      else {
        const d = pr.dur || 2; const lt = pr.type === 'anchorOut' ? (t % (d + 0.8)) : Math.min(d, t % (d + 0.8));
        if (pr.lumetri) out = C.lumetri(out, pr.lumetri);
        for (const e of pr.effects || []) { const def = VIDEO_FX[e.name]; if (def && !def.custom) out = C.effect(def, e.name, { ...defaults(e.name), ...valsAt(e.params, lt) }, out, t); }
      }
    }
    const gl = C.gl; C.target(out); gl.readPixels(0, 0, PW, PH, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const img = ctx2d.createImageData(PW, PH);
    for (let y = 0; y < PH; y++) img.data.set(px.subarray((PH - 1 - y) * PW * 4, (PH - y) * PW * 4), y * PW * 4);
    ctx2d.putImageData(img, 0, 0);
    return true;
  } catch { return false; } finally { if (out && out !== a && out !== b) C.release(out); }
}
