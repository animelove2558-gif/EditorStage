// Photoshop-style Layer Styles (AE "Layer Styles"), rendered in layer space on the layer buffer.
// Keys come from the evaluator (`<style>/<param>` suffixes): opacity 0..100, distances/sizes in layer px, angles in degrees.
import { gaussian } from './effects';
import { blendOnto } from './blend';
import { runShader } from './gl';

// layer-style blend enum (1-based; 5 = Multiply and 11 = Screen are the AE defaults for shadows / glows)
const STYLE_BLEND = [null, 'NORMAL', 'DISSOLVE', 'DANCING_DISSOLVE', 'DARKEN', 'MULTIPLY', 'COLOR_BURN', 'LINEAR_BURN', 'DARKER_COLOR', 'ADD', 'LIGHTEN', 'SCREEN', 'COLOR_DODGE',
  'LINEAR_DODGE', 'LIGHTER_COLOR', 'OVERLAY', 'SOFT_LIGHT', 'HARD_LIGHT', 'VIVID_LIGHT', 'LINEAR_LIGHT', 'PIN_LIGHT', 'HARD_MIX', 'DIFFERENCE', 'EXCLUSION', 'SUBTRACT', 'DIVIDE', 'HUE', 'SATURATION', 'COLOR', 'LUMINOSITY'];
const rgba = (c, a = 1) => `rgba(${Math.round((c?.[0] ?? 0) * 255)},${Math.round((c?.[1] ?? 0) * 255)},${Math.round((c?.[2] ?? 0) * 255)},${(c?.[3] ?? 1) * a})`;
const v = (o, k, d) => (o && o[k] !== undefined && o[k] !== null ? o[k] : d);
const pct = (o, d) => { const x = Number(v(o, 'opacity', d)); return x > 1 ? x / 100 : x; };
const on = (o) => o && o.enabled !== false;
const modeOf = (o, d = 1) => { const m = v(o, 'mode2', d); return typeof m === 'string' ? m : STYLE_BLEND[m] || 'NORMAL'; };

function silhouette(pool, src, color, op = 1) {
  const c = pool.acquire(src.width, src.height); const g = c.getContext('2d'); g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in'; g.fillStyle = rgba(color, op); g.fillRect(0, 0, c.width, c.height); g.globalCompositeOperation = 'source-over';
  return c;
}
function inverseAlpha(pool, src) {
  const c = pool.acquire(src.width, src.height); const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-out'; g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-over'; return c;
}
/** grow alpha by r px (GPU max filter, Canvas2D stamping fallback) */
export function dilate(pool, src, r) {
  const c = pool.acquire(src.width, src.height); const g = c.getContext('2d'); g.drawImage(src, 0, 0);
  if (r < 0.5) return c;
  const body = (dir) => `vec4 best=vec4(0.); for(int i=-32;i<=32;i++){ float x=float(i)*u_r/32.; vec4 s=texture(u_src,uv+${dir}*x/u_res); if(s.a>best.a) best=s; } o=best.a>0.?vec4(best.rgb/best.a,best.a):vec4(0.);`;
  const tmp = pool.acquire(src.width, src.height);
  // separable square max is close enough to a disc for strokes/spreads up to ~40px; use a 2-step (axis + diagonal) for roundness
  if (runShader('dil-x', body('vec2(1.,0.)'), { u_src: c }, { u_r: r }, tmp) && runShader('dil-y', body('vec2(0.,1.)'), { u_src: tmp }, { u_r: r }, c)) {
    // round the corners: intersect with a diagonal pass at r/sqrt2
    pool.release(tmp); return c;
  }
  pool.release(tmp);
  for (let ring = Math.ceil(r / 3); ring >= 1; ring--) {
    const rr = (r * ring) / Math.ceil(r / 3); const n = Math.min(72, Math.max(12, Math.ceil(rr * 1.5)));
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; g.drawImage(src, Math.cos(a) * rr, Math.sin(a) * rr); }
  }
  return c;
}
function edgeRing(pool, lc, r, inside) {
  if (!inside) { const d = dilate(pool, lc, r); const g = d.getContext('2d'); g.globalCompositeOperation = 'destination-out'; g.drawImage(lc, 0, 0); g.globalCompositeOperation = 'source-over'; return d; }
  const inv = inverseAlpha(pool, lc); const d = dilate(pool, inv, r); pool.release(inv);
  const g = d.getContext('2d'); g.globalCompositeOperation = 'destination-in'; g.drawImage(lc, 0, 0); g.globalCompositeOperation = 'source-over'; return d;
}
/** spread (hard, chokeMatte %) + soft blur of `size` px */
function spreadBlur(pool, c, size, spread) {
  const hard = size * Math.max(0, Math.min(1, spread)); let out = c;
  if (hard > 0.5) { out = dilate(pool, c, hard); pool.release(c); }
  const soft = size - hard; if (soft > 0.5) gaussian(out, soft * 0.5, soft * 0.5, pool);
  return out;
}
const gradientStops = (grad) => { // -> [{p, c:[r,g,b,a]}]
  const cs = grad?.colorStops?.length ? grad.colorStops : [{ position: 0, color: [0, 0, 0] }, { position: 1, color: [1, 1, 1] }];
  const as = grad?.alphaStops || [];
  const alphaAt = (pos) => { if (!as.length) return 1; let prev = as[0]; if (pos <= prev.position) return prev.alpha; for (const s of as) { if (s.position >= pos) { const d = s.position - prev.position || 1; return prev.alpha + ((s.alpha - prev.alpha) * (pos - prev.position)) / d; } prev = s; } return prev.alpha; };
  return cs.map((s) => ({ p: Math.max(0, Math.min(1, s.position)), c: [...s.color.slice(0, 3), alphaAt(s.position)] }));
};

/** Apply all layer styles to the layer buffer `lc` (layer space, ls px per unit). */
export function applyLayerStyles(lc, st, ls, pool, time = 0) {
  if (!st) return;
  const W = lc.width, H = lc.height; const g = lc.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0);
  const src = pool.acquire(W, H); src.getContext('2d').drawImage(lc, 0, 0); // un-styled layer
  const angleOf = (d) => ((v(d, 'useGlobalAngle', 0) ? v(st, 'globalAngle', 120) : v(d, 'localLightingAngle', 120)) * Math.PI) / 180;
  const below = []; const above = [];

  if (on(st.dropShadow)) {
    const d = st.dropShadow; const a = angleOf(d), dist = v(d, 'distance', 5) * ls;
    let sh = silhouette(pool, src, v(d, 'color', [0, 0, 0, 1]), 1); sh = spreadBlur(pool, sh, v(d, 'blur', 5) * ls, v(d, 'chokeMatte', 0) / 100);
    const off = pool.acquire(W, H); off.getContext('2d').drawImage(sh, -Math.cos(a) * dist, Math.sin(a) * dist); pool.release(sh);
    if (v(d, 'layerConceals', 1)) { const og = off.getContext('2d'); og.globalCompositeOperation = 'destination-out'; og.drawImage(src, 0, 0); og.globalCompositeOperation = 'source-over'; }
    below.push([off, modeOf(d, 5), pct(d, 75)]);
  }
  if (on(st.outerGlow)) {
    const d = st.outerGlow; const useGrad = v(d, 'AEColorChoice', 1) === 2;
    let gl = silhouette(pool, src, useGrad ? gradientStops(v(d, 'gradient'))[0].c : v(d, 'color', [1, 1, 0.75, 1]), 1);
    gl = spreadBlur(pool, gl, v(d, 'blur', 5) * ls, v(d, 'chokeMatte', 0) / 100);
    const og = gl.getContext('2d'); og.globalCompositeOperation = 'destination-out'; og.drawImage(src, 0, 0); og.globalCompositeOperation = 'source-over';
    below.push([gl, modeOf(d, 11), pct(d, 75)]);
  }
  const inner = (d, color, dx, dy, edge = true) => { // inner shadow / inner glow from the inverted alpha, clipped to the layer
    let inv = inverseAlpha(pool, src); const sz = v(d, 'blur', 5) * ls;
    const sh = pool.acquire(W, H); const sg = sh.getContext('2d'); sg.fillStyle = '#000'; sg.fillRect(0, 0, W, H); sg.globalCompositeOperation = 'destination-out'; sg.drawImage(src, dx, dy); pool.release(inv);
    inv = edge ? spreadBlur(pool, sh, sz, v(d, 'chokeMatte', 0) / 100) : sh;
    const c = silhouette(pool, inv, color, 1); pool.release(inv);
    const cg = c.getContext('2d'); cg.globalCompositeOperation = 'destination-in'; cg.drawImage(src, 0, 0); cg.globalCompositeOperation = 'source-over';
    return c;
  };
  if (on(st.innerShadow)) {
    const d = st.innerShadow; const a = angleOf(d), dist = v(d, 'distance', 5) * ls;
    above.push([inner(d, v(d, 'color', [0, 0, 0, 1]), -Math.cos(a) * dist, Math.sin(a) * dist), modeOf(d, 5), pct(d, 75)]);
  }
  if (on(st.innerGlow)) {
    const d = st.innerGlow; const color = v(d, 'AEColorChoice', 1) === 2 ? gradientStops(v(d, 'gradient'))[0].c : v(d, 'color', [1, 1, 0.75, 1]);
    let c = inner(d, color, 0, 0);
    if (v(d, 'innerGlowSource', 2) === 1) { // center: glow is the inverse of the edge glow
      const cc = silhouette(pool, src, color, 1); const g2 = cc.getContext('2d'); g2.globalCompositeOperation = 'destination-out'; g2.drawImage(c, 0, 0); pool.release(c); c = cc;
    }
    above.push([c, modeOf(d, 11), pct(d, 75)]);
  }
  if (on(st.bevelEmboss)) {
    const d = st.bevelEmboss; const size = Math.max(1, v(d, 'blur', 5) * ls); const depth = v(d, 'strengthRatio', 100) / 100; const up = v(d, 'bevelDirection', 1) === 1;
    const styl = v(d, 'bevelStyle', 2); const a = angleOf(d); const alt = ((v(d, 'useGlobalAngle', 0) ? v(st, 'globalAltitude', 30) : v(d, 'localLightingAltitude', 30)) * Math.PI) / 180;
    const hgt = pool.acquire(W, H); hgt.getContext('2d').drawImage(src, 0, 0); gaussian(hgt, size * 0.5, size * 0.5, pool);
    const hi = pool.acquire(W, H), lo = pool.acquire(W, H);
    const body = (sign) => `vec2 d=1./u_res; float hx=texture(u_h,uv+vec2(d.x,0.)).a-texture(u_h,uv-vec2(d.x,0.)).a, hy=texture(u_h,uv+vec2(0.,d.y)).a-texture(u_h,uv-vec2(0.,d.y)).a;
      vec3 n=normalize(vec3(-hx*u_sz*u_dep*(u_up>.5?1.:-1.), -hy*u_sz*u_dep*(u_up>.5?1.:-1.), 1.)); vec3 l=normalize(vec3(-cos(u_a)*cos(u_alt), sin(u_a)*cos(u_alt), sin(u_alt)));
      float s=dot(n,l)-sin(u_alt); float a=${sign}>0.?max(s,0.):max(-s,0.); float sa=texture(u_s,uv).a;
      float region = u_st<1.5 ? (1.-sa) : u_st<2.5 ? sa : 1.; o=vec4(u_c, clamp(a*3.,0.,1.)*region);`;
    const ok = runShader('bevel-hi', body('1.'), { u_h: hgt, u_s: src }, { u_sz: size, u_dep: depth, u_up: up ? 1 : 0, u_a: a, u_alt: alt, u_st: styl, u_c: v(d, 'highlightColor', [1, 1, 1, 1]).slice(0, 3) }, hi)
      && runShader('bevel-lo', body('-1.'), { u_h: hgt, u_s: src }, { u_sz: size, u_dep: depth, u_up: up ? 1 : 0, u_a: a, u_alt: alt, u_st: styl, u_c: v(d, 'shadowColor', [0, 0, 0, 1]).slice(0, 3) }, lo);
    pool.release(hgt);
    if (ok) {
      const hiOp = Number(v(d, 'highlightOpacity', 75)), loOp = Number(v(d, 'shadowOpacity', 75));
      (styl === 1 ? below : above).push([hi, STYLE_BLEND[v(d, 'highlightMode', 11)] || 'SCREEN', hiOp > 1 ? hiOp / 100 : hiOp], [lo, STYLE_BLEND[v(d, 'shadowMode', 5)] || 'MULTIPLY', loOp > 1 ? loOp / 100 : loOp]);
    } else { pool.release(hi); pool.release(lo); }
  }
  if (on(st.satin)) {
    const d = st.satin; const a = angleOf(d), dist = v(d, 'distance', 11) * ls, size = v(d, 'blur', 14) * ls;
    const sat = pool.acquire(W, H); const sg = sat.getContext('2d'); sg.drawImage(src, Math.cos(a) * dist, -Math.sin(a) * dist); sg.globalCompositeOperation = 'xor'; sg.drawImage(src, -Math.cos(a) * dist, Math.sin(a) * dist);
    sg.globalCompositeOperation = 'source-in'; sg.fillStyle = rgba(v(d, 'color', [0, 0, 0, 1])); sg.fillRect(0, 0, W, H); sg.globalCompositeOperation = 'source-over';
    if (size > 0.5) gaussian(sat, size * 0.5, size * 0.5, pool);
    if (v(d, 'invert', 0)) { const iv = silhouette(pool, src, v(d, 'color', [0, 0, 0, 1])); const ig = iv.getContext('2d'); ig.globalCompositeOperation = 'destination-out'; ig.drawImage(sat, 0, 0); sg.globalCompositeOperation = 'copy'; sg.drawImage(iv, 0, 0); pool.release(iv); }
    sg.globalCompositeOperation = 'destination-in'; sg.drawImage(src, 0, 0); sg.globalCompositeOperation = 'source-over';
    above.push([sat, modeOf(d, 5), pct(d, 50)]);
  }
  if (on(st.colorOverlay)) { const d = st.colorOverlay; above.push([silhouette(pool, src, v(d, 'color', [1, 0, 0, 1])), modeOf(d, 1), pct(d, 100)]); }
  if (on(st.gradientOverlay)) {
    const d = st.gradientOverlay; const stops = gradientStops(v(d, 'gradient')); if (v(d, 'reverse', 0)) stops.forEach((s) => { s.p = 1 - s.p; });
    const ang = (v(d, 'angle', 90) * Math.PI) / 180, scale = v(d, 'scale', 100) / 100, type = v(d, 'type', 1); const off = v(d, 'offset', [0, 0]);
    const gr = pool.acquire(W, H); const gg = gr.getContext('2d'); const cx = W / 2 + (off[0] || 0) * W / 100, cy = H / 2 + (off[1] || 0) * H / 100;
    const half = (Math.abs(Math.cos(ang)) * W + Math.abs(Math.sin(ang)) * H) / 2 * scale;
    const grad = type === 2 ? gg.createRadialGradient(cx, cy, 0, cx, cy, half) : type === 3 && gg.createConicGradient ? gg.createConicGradient(-ang, cx, cy)
      : gg.createLinearGradient(cx - Math.cos(ang) * half, cy + Math.sin(ang) * half, cx + Math.cos(ang) * half, cy - Math.sin(ang) * half);
    for (const s of stops.sort((x, y) => x.p - y.p)) grad.addColorStop(type === 4 ? 0.5 + s.p / 2 : s.p, rgba(s.c));
    if (type === 4) for (const s of stops) grad.addColorStop(0.5 - s.p / 2, rgba(s.c));
    gg.fillStyle = grad; gg.fillRect(0, 0, W, H); gg.globalCompositeOperation = 'destination-in'; gg.drawImage(src, 0, 0);
    above.push([gr, modeOf(d, 1), pct(d, 100)]);
  }
  if (on(st.stroke)) { // frameFX; position 1 outside, 2 inside, 3 center
    const d = st.stroke; const size = v(d, 'size', 3) * ls; const pos = v(d, 'style', 1);
    let ring;
    if (pos === 2) ring = edgeRing(pool, src, size, true);
    else if (pos === 3) { ring = edgeRing(pool, src, size / 2, false); const i = edgeRing(pool, src, size / 2, true); ring.getContext('2d').drawImage(i, 0, 0); pool.release(i); }
    else ring = edgeRing(pool, src, size, false);
    const col = silhouette(pool, ring, v(d, 'color', [1, 0, 0, 1])); pool.release(ring);
    above.push([col, modeOf(d, 1), pct(d, 100)]);
  }

  // composite: [below styles] + layer + [above styles]
  if (below.length) {
    const base = pool.acquire(W, H);
    for (const [c, m, o] of below) { blendOnto(base, c, m, o, time, pool); pool.release(c); }
    const bg = base.getContext('2d'); bg.globalCompositeOperation = 'source-over'; bg.drawImage(lc, 0, 0);
    g.save(); g.globalCompositeOperation = 'copy'; g.drawImage(base, 0, 0); g.restore(); pool.release(base);
  }
  for (const [c, m, o] of above) {
    // blend inside the layer only: blend onto a copy, then keep the original coverage
    const tmp = pool.acquire(W, H); tmp.getContext('2d').drawImage(lc, 0, 0); blendOnto(tmp, c, m, o, time, pool); pool.release(c);
    const tg = tmp.getContext('2d'); tg.globalCompositeOperation = 'destination-in'; tg.drawImage(src, 0, 0);
    // stroke outside the layer must survive: re-add pixels outside the original coverage
    g.save(); g.globalCompositeOperation = 'source-atop'; g.drawImage(tmp, 0, 0); g.restore(); pool.release(tmp);
  }
  if (on(st.stroke) && v(st.stroke, 'style', 1) !== 2) { // outside/center strokes extend past the layer: add them under/over
    const d = st.stroke; const size = v(d, 'size', 3) * ls; const ring = edgeRing(pool, src, v(d, 'style', 1) === 3 ? size / 2 : size, false);
    const col = silhouette(pool, ring, v(d, 'color', [1, 0, 0, 1]), pct(d, 100)); pool.release(ring);
    g.save(); g.globalCompositeOperation = 'source-over'; g.drawImage(col, 0, 0); g.restore(); pool.release(col);
  }
  pool.release(src);
}
