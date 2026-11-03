// After Effects layer blending modes. Canvas2D composite ops where they are exact, a WebGL pass for the rest.
import { runShader } from './gl';

const CANVAS = {
  NORMAL: 'source-over', MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay', SOFT_LIGHT: 'soft-light', HARD_LIGHT: 'hard-light',
  COLOR_DODGE: 'color-dodge', COLOR_BURN: 'color-burn', CLASSIC_COLOR_DODGE: 'color-dodge', CLASSIC_COLOR_BURN: 'color-burn',
  DARKEN: 'darken', LIGHTEN: 'lighten', DIFFERENCE: 'difference', CLASSIC_DIFFERENCE: 'difference', EXCLUSION: 'exclusion',
  HUE: 'hue', SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity', ADD: 'lighter', LINEAR_DODGE: 'lighter',
};
const GL_MODES = { LINEAR_BURN: 1, LINEAR_LIGHT: 2, VIVID_LIGHT: 3, PIN_LIGHT: 4, HARD_MIX: 5, DARKER_COLOR: 6, LIGHTER_COLOR: 7, SUBTRACT: 8, DIVIDE: 9,
  DISSOLVE: 10, DANCING_DISSOLVE: 11, STENCIL_ALPHA: 12, STENCIL_LUMA: 13, SILHOUETE_ALPHA: 14, SILHOUETTE_ALPHA: 14, SILHOUETTE_LUMA: 15, ALPHA_ADD: 16, LUMINESCENT_PREMUL: 17 };

const BODY = `
vec4 d = T(u_dst, uv), s = T(u_src, uv); s.a *= u_op; int m = int(u_mode + .5);
if (m >= 12 && m <= 15) { // stencil / silhouette: modify the layers below only (s.a already includes opacity)
  float k = m == 12 || m == 14 ? s.a : luma(s.rgb) * s.a;
  float f = m <= 13 ? 1. - u_op + k : 1. - k;
  o = vec4(d.rgb, d.a * clamp(f, 0., 1.));
} else {
if (m == 10 || m == 11) { float r = hash(px + (m == 11 ? vec2(u_time * 97.13, u_time * 31.7) : vec2(0.))); s.a = r < s.a ? 1. : 0.; m = 0; }
vec3 cb = d.rgb, cs = s.rgb, B = cs;
if (m == 1) B = max(cb + cs - 1., 0.);
else if (m == 2) B = clamp(cb + 2. * cs - 1., 0., 1.);
else if (m == 3) { for (int i = 0; i < 3; i++) B[i] = cs[i] < .5 ? (cs[i] <= 0. ? 0. : max(0., 1. - (1. - cb[i]) / (2. * cs[i]))) : (cs[i] >= 1. ? 1. : min(1., cb[i] / (2. * (1. - cs[i])))); }
else if (m == 4) { for (int i = 0; i < 3; i++) B[i] = cs[i] < .5 ? min(cb[i], 2. * cs[i]) : max(cb[i], 2. * cs[i] - 1.); }
else if (m == 5) B = step(1., cb + cs);
else if (m == 6) B = (cs.r + cs.g + cs.b) < (cb.r + cb.g + cb.b) ? cs : cb;
else if (m == 7) B = (cs.r + cs.g + cs.b) > (cb.r + cb.g + cb.b) ? cs : cb;
else if (m == 8) B = max(cb - cs, 0.);
else if (m == 9) { for (int i = 0; i < 3; i++) B[i] = cs[i] <= 0. ? 1. : min(1., cb[i] / cs[i]); }
float ao = s.a + d.a * (1. - s.a);
if (m == 16) ao = min(1., s.a + d.a);
vec3 pre = (1. - s.a) * d.a * cb + (1. - d.a) * s.a * cs + s.a * d.a * B;
if (m == 17) pre = d.rgb * d.a + s.rgb * s.a;
o = vec4(ao > 0. ? pre / ao : vec3(0.), ao);
}`;

/** Composite `src` (same size) onto `dst` (2D canvas) with an AE blend mode and opacity 0..1. */
export function blendOnto(dst, src, mode, opacity = 1, time = 0, pool) {
  const g = dst.getContext('2d');
  const op = CANVAS[mode] || (GL_MODES[mode] ? null : 'source-over');
  if (op) {
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = Math.max(0, Math.min(1, opacity)); g.globalCompositeOperation = op; g.drawImage(src, 0, 0); g.restore();
    return;
  }
  const out = pool.acquire(dst.width, dst.height);
  const ok = runShader('blend', BODY,{ u_dst: dst, u_src: src }, { u_mode: GL_MODES[mode], u_op: Math.max(0, Math.min(1, opacity)), u_time: time }, out);
  if (ok) { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'copy'; g.drawImage(out, 0, 0); g.restore(); }
  else { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = opacity; g.drawImage(src, 0, 0); g.restore(); }
  pool.release(out);
}

/** Blend modes valid for shape fills/strokes inside a layer (canvas ops; GL-only ones fall back to normal). */
export const canvasBlendOp = (mode) => CANVAS[mode] || 'source-over';
