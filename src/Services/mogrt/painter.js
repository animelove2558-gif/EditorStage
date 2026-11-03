import { drawShapeItems, shapeItemsBounds } from './shapes';
import { drawText, textBounds } from './text';
import { applyEffect } from './fx/effects';
import { applyLayerStyles } from './fx/styles';
import { blendOnto } from './fx/blend';
import { runShader } from './fx/gl';

// Canvas2D/WebGL painter for an evaluated After Effects composition (ResolvedFrame, see docs/mogrt-scene-schema.md).
// A layer is rendered in its own LAYER space when it has effects, layer styles, echoes or is 3D (that is where AE applies
// them), then transformed into the comp (affine, or a perspective warp for 3D layers). Plain 2D layers draw straight into
// comp space. Track mattes, blending modes and opacity are applied in comp space.
const rgba = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${(c[3] ?? 1) * a})`;
const MAX_SIDE = 4096, MAX_PIX = 16e6;

const mulA = (p, c) => [p[0] * c[0] + p[2] * c[1], p[1] * c[0] + p[3] * c[1], p[0] * c[2] + p[2] * c[3], p[1] * c[2] + p[3] * c[3], p[0] * c[4] + p[2] * c[5] + p[4], p[1] * c[4] + p[3] * c[5] + p[5]];
const invA = (m) => { const d = m[0] * m[3] - m[1] * m[2] || 1e-12; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };
const apA = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
// 3x3 row-major helpers for homographies
const mul3 = (a, b) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m; const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g; const det = a * A + b * B + c * C || 1e-12;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
const ap3 = (m, x, y) => { const w = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w, w]; };
const colMajor = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

// effect "reach" in layer units (how far effects/styles may draw beyond the content)
function effectMargin(layer) {
  let m = 0; const keys = /blur|radius|distance|softness|length|size|feather|glow|displacement|height|amount|choke|spread|width/i;
  for (const e of layer.effects || []) {
    if (e.enabled === false || /Control$/.test(e.matchName)) continue;
    const walk = (o) => { for (const [k, v] of Object.entries(o || {})) { if (v && typeof v === 'object' && !Array.isArray(v)) walk(v); else if (keys.test(k) && typeof v === 'number' && Number.isFinite(v)) m += Math.min(2000, Math.abs(v)) * 1.5; } };
    walk(e.params); if (/Drop Shadow|Glo2|Radial Shadow|Light Rays|Geometry2|Wave|Turbulent|Ripple|Bulge/.test(e.matchName)) m += 50;
  }
  const st = layer.layerStyles;
  if (st) for (const k of ['dropShadow', 'outerGlow', 'stroke', 'bevelEmboss']) { const d = st[k]; if (d && d.enabled !== false) m += (Math.abs(d.distance || 0) + Math.abs(d.blur || 0) + Math.abs(d.size || 0)) * 1.2 + 4; }
  return m;
}
const geometryEffects = /Geometry2|Corner Pin|Power Pin|Offset|Tile|RepeTile|Tiler|Mirror|Basic 3D|Polar|Kaleida|Griddler|Optics/;

export function createPainter({ getImage }) {
  const free = [];
  const stats = { unsupportedEffects: new Set() };
  const pool = {
    acquire(w, h) {
      w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
      let i = free.findIndex((x) => x.width === w && x.height === h);
      const c = i >= 0 ? free.splice(i, 1)[0] : document.createElement('canvas');
      if (i < 0) { c.width = w; c.height = h; }
      const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.clearRect(0, 0, w, h); g.imageSmoothingQuality = 'high';
      return c;
    },
    release(c) { if (!c || free.includes(c)) return; free.push(c); if (free.length > 48) free.shift(); },
  };
  const acquire = pool.acquire, release = pool.release;

  // ------------------------------------------------------------ content
  function drawContent(g, layer, s, time) {
    if (layer.kind === 'solid') { const c = layer.source?.color || [0, 0, 0, 1]; g.fillStyle = rgba(c); g.fillRect(0, 0, layer.width, layer.height); }
    else if (layer.kind === 'footage') {
      const im = layer.source && getImage(layer.source.footageId, layer.source.time);
      if (im) { const w = im.videoWidth || im.naturalWidth || im.width || layer.width, h = im.videoHeight || im.naturalHeight || im.height || layer.height; try { g.drawImage(im, 0, 0, w, h, 0, 0, layer.width || w, layer.height || h); } catch { /* not decodable yet */ } }
    } else if (layer.kind === 'shape' && layer.shape) drawShapeItems(g, layer.shape.items, { time: layer.shape.time ?? time });
    else if (layer.kind === 'text' && layer.text) drawText(g, layer.text);
    else if (layer.kind === 'precomp' && layer.precomp) {
      const pf = layer.precomp.frame; const k = Math.hypot(g.getTransform().a, g.getTransform().b) || s;
      const sub = paintComp(pf, Math.min(k, 4)); g.drawImage(sub, 0, 0, pf.width, pf.height); release(sub);
    }
  }

  function pathOnto(g, p) {
    const v = p.vertices; const n = v.length; if (!n) return;
    g.moveTo(v[0][0], v[0][1]); const last = p.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = v[i], b = v[(i + 1) % n], ot = p.outTangents?.[i] || [0, 0], it = p.inTangents?.[(i + 1) % n] || [0, 0];
      g.bezierCurveTo(a[0] + ot[0], a[1] + ot[1], b[0] + it[0], b[1] + it[1], b[0], b[1]);
    }
    if (p.closed) g.closePath();
  }

  /** Apply the layer's masks to canvas `lc`; `xf` = transform (a,b,c,d,e,f) from mask (layer) coords to lc pixels, `k` = px per unit */
  function applyMasks(lc, masks, xf, k) {
    masks = (masks || []).filter((m) => m.mode !== 'NONE' && m.shape?.vertices?.length && m.shape.closed !== false); // open masks never cut the alpha (AE)
    if (!masks.length) return;
    const W = lc.width, H = lc.height; let acc = null;
    for (const m of masks) {
      const r = acquire(W, H); const g = r.getContext('2d'); g.setTransform(...xf);
      g.fillStyle = '#000'; g.strokeStyle = '#000'; g.lineJoin = 'round'; g.beginPath(); pathOnto(g, m.shape); g.fill();
      if (m.expansion > 0) { g.lineWidth = m.expansion * 2; g.stroke(); }
      else if (m.expansion < 0) { g.globalCompositeOperation = 'destination-out'; g.lineWidth = -m.expansion * 2; g.stroke(); g.globalCompositeOperation = 'source-over'; }
      g.setTransform(1, 0, 0, 1, 0, 0);
      let region = r;
      const feather = Math.max(m.feather?.[0] || 0, m.feather?.[1] || 0) * k;
      if (feather > 0.5) { const f = acquire(W, H); const fg = f.getContext('2d'); fg.filter = `blur(${(feather * 0.5).toFixed(2)}px)`; fg.drawImage(r, 0, 0); fg.filter = 'none'; release(r); region = f; }
      if (m.inverted) { const iv = acquire(W, H); const ig = iv.getContext('2d'); ig.fillStyle = '#000'; ig.fillRect(0, 0, W, H); ig.globalCompositeOperation = 'destination-out'; ig.drawImage(region, 0, 0); release(region); region = iv; }
      const op = m.opacity ?? 1;
      if (!acc) {
        acc = acquire(W, H); const ag = acc.getContext('2d');
        if (m.mode === 'SUBTRACT' || m.mode === 'INTERSECT' || m.mode === 'DARKEN') { ag.fillStyle = '#000'; ag.fillRect(0, 0, W, H); }
        if (m.mode === 'SUBTRACT') { ag.globalCompositeOperation = 'destination-out'; ag.globalAlpha = op; ag.drawImage(region, 0, 0); }
        else if (m.mode === 'INTERSECT' || m.mode === 'DARKEN') { ag.globalCompositeOperation = 'destination-in'; ag.drawImage(region, 0, 0); }
        else { ag.globalAlpha = op; ag.drawImage(region, 0, 0); }
        ag.globalAlpha = 1; ag.globalCompositeOperation = 'source-over'; release(region);
      } else {
        const ag = acc.getContext('2d'); ag.globalAlpha = op;
        ag.globalCompositeOperation = m.mode === 'SUBTRACT' ? 'destination-out' : m.mode === 'INTERSECT' || m.mode === 'DARKEN' ? 'destination-in' : m.mode === 'DIFFERENCE' ? 'xor' : 'source-over';
        if (ag.globalCompositeOperation === 'destination-in' && op < 1) { // partial-opacity intersect: keep (1-op) of the outside
          const t = acquire(W, H); const tg = t.getContext('2d'); tg.fillStyle = `rgba(0,0,0,${1 - op})`; tg.fillRect(0, 0, W, H); tg.drawImage(region, 0, 0); ag.globalAlpha = 1; ag.drawImage(t, 0, 0); release(t);
        } else ag.drawImage(region, 0, 0);
        ag.globalAlpha = 1; ag.globalCompositeOperation = 'source-over'; release(region);
      }
    }
    const g = lc.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'destination-in'; g.drawImage(acc, 0, 0); g.restore(); release(acc);
  }

  // ------------------------------------------------------------ geometry
  /** layer coords -> comp pixels mapping for the layer: { affine:[6] } or { H:[9 row-major] } (3D) */
  function layerToComp(layer, s) {
    if (layer.threeD) {
      const M = layer.threeD.mv, z = layer.threeD.zoom, cx = layer.threeD.cx, cy = layer.threeD.cy;
      // [sx*w, sy*w, w] = K * [c0 c1 c3] * [x y 1]
      const C = [M[0], M[4], M[12], M[1], M[5], M[13], M[2], M[6], M[14]];
      const K = [z * s, 0, cx * s, 0, z * s, cy * s, 0, 0, 1];
      return { H: mul3(K, C), zrow: [M[2], M[6], M[14]] };
    }
    const m = layer.matrix; return { affine: [m[0] * s, m[1] * s, m[2] * s, m[3] * s, m[4] * s, m[5] * s] };
  }
  /** comp-pixel rect -> layer-space bbox (or null when not invertible / behind the camera) */
  function viewportInLayer(map, W, H) {
    const corners = [[0, 0], [W, 0], [W, H], [0, H]]; const pts = [];
    if (map.affine) { const iv = invA(map.affine); for (const [x, y] of corners) pts.push(apA(iv, x, y)); }
    else {
      const iv = inv3(map.H); for (const [x, y] of corners) { const p = ap3(iv, x, y); const zc = map.zrow[0] * p[0] + map.zrow[1] * p[1] + map.zrow[2]; if (!Number.isFinite(p[0]) || zc <= 1) return null; pts.push(p); }
    }
    return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  }
  const scaleOf = (map, at) => {
    if (map.affine) return Math.sqrt(Math.abs(map.affine[0] * map.affine[3] - map.affine[1] * map.affine[2])) || 1;
    const [x, y] = at; const p0 = ap3(map.H, x, y), p1 = ap3(map.H, x + 1, y), p2 = ap3(map.H, x, y + 1);
    return Math.sqrt(Math.abs((p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]))) || 1;
  };
  const intersect = (a, b) => (!a ? b : !b ? a : [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
  const grow = (r, m) => r && [r[0] - m, r[1] - m, r[2] + m, r[3] + m];

  let measureCtx = null;
  function contentBounds(layer) {
    if (layer.kind === 'solid' || layer.kind === 'footage' || layer.kind === 'precomp') return [0, 0, layer.width || 0, layer.height || 0];
    if (layer.kind === 'shape' && layer.shape) return shapeItemsBounds(layer.shape.items);
    if (layer.kind === 'text' && layer.text) {
      if (layer.text.pathOptions?.path || (layer.text.animators || []).some((a) => a.properties && (a.properties.position || a.properties.scale || a.properties.anchorPoint))) return null;
      if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
      return textBounds(measureCtx, layer.text);
    }
    return null;
  }

  /** the layer's own rectangle in layer space: source box, or the comp-sized box around the origin for shape/text layers */
  const layerBox = (layer, frame) => (layer.width && layer.height ? [0, 0, layer.width, layer.height] : [-frame.width / 2, -frame.height / 2, frame.width / 2, frame.height / 2]);

  // ------------------------------------------------------------ layer pipeline
  const hasFx = (layer) => (layer.effects || []).some((e) => e.enabled !== false && !/Control$|^Pseudo\/|^ADBE (Posterize Time|Echo)$/.test(e.matchName || ''));

  /** Render one layer (content, masks, echoes, effects, styles, 3D, lighting) into a comp-size canvas. Caller releases. */
  function renderLayerBody(layer, frame, s, byId) {
    const W = Math.max(1, Math.round(frame.width * s)), H = Math.max(1, Math.round(frame.height * s));
    const out = acquire(W, H); const og = out.getContext('2d');
    const map = layerToComp(layer, s);
    const layerSpace = layer.threeD || hasFx(layer) || layer.layerStyles || layer.echo;
    if (!layerSpace) {
      og.setTransform(...map.affine); drawContent(og, layer, s, frame.time); og.setTransform(1, 0, 0, 1, 0, 0);
      applyMasks(out, layer.masks, map.affine, scaleOf(map));
      return out;
    }
    // --- layer-space buffer
    const margin = effectMargin(layer);
    const cb = contentBounds(layer); const vp = viewportInLayer(map, W, H);
    let R;
    const boxLayer = layer.kind === 'solid' || layer.kind === 'footage' || layer.kind === 'precomp';
    if (boxLayer && (layer.effects || []).some((e) => geometryEffects.test(e.matchName))) R = grow(cb, margin);
    else R = intersect(grow(cb, margin), grow(vp, margin));
    if (!R) R = cb ? grow(cb, margin) : [0, 0, frame.width, frame.height];
    if (!(R[2] > R[0] && R[3] > R[1])) { release(out); return null; }
    const ctr = [(R[0] + R[2]) / 2, (R[1] + R[3]) / 2];
    let ls = Math.max(0.02, Math.min(scaleOf(map, ctr), s * 4));
    let bw = (R[2] - R[0]) * ls, bh = (R[3] - R[1]) * ls;
    const k = Math.min(1, MAX_SIDE / bw, MAX_SIDE / bh, Math.sqrt(MAX_PIX / (bw * bh))); if (k < 1) { ls *= k; bw *= k; bh *= k; }
    const lb = acquire(Math.ceil(bw), Math.ceil(bh)); const lg = lb.getContext('2d');
    const xf = [ls, 0, 0, ls, -R[0] * ls, -R[1] * ls];
    lg.setTransform(...xf); drawContent(lg, layer, ls, frame.time); lg.setTransform(1, 0, 0, 1, 0, 0);
    applyMasks(lb, layer.masks, xf, ls);
    if (layer.echo && layer.echo.copies?.length) applyEcho(lb, layer, xf, ls, frame.time);
    const fxCtx = { canvas: lb, ls, off: [R[0], R[1]], time: frame.time, pool, masks: layer.masks, layerW: layer.width, layerH: layer.height, box: layerBox(layer, frame),
      compW: frame.width, compH: frame.height, getLayer: (idx) => layerInBuffer(frame, byId, idx, s, map.affine || layer.matrix.map((v) => v * s), xf, lb) };
    for (const eff of layer.effects || []) {
      if (eff.enabled === false) continue;
      const r = applyEffect(eff, fxCtx); if (r === 'unsupported') stats.unsupportedEffects.add(eff.matchName);
    }
    if (layer.layerStyles) applyLayerStyles(lb, layer.layerStyles, ls, pool, frame.time);
    // --- to comp space
    if (map.affine) {
      og.setTransform(...mulA(map.affine, [1 / ls, 0, 0, 1 / ls, R[0], R[1]])); og.imageSmoothingQuality = 'high'; og.drawImage(lb, 0, 0); og.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      // comp px -> buffer px:  inv( H * B ),  B: buffer px -> layer coords
      const B = [1 / ls, 0, R[0], 0, 1 / ls, R[1], 0, 0, 1]; const Hinv = inv3(mul3(map.H, B));
      const lit = layer.threeD.lighting;
      const ok = runShader('warp3d', `vec3 q=u_h*vec3(px,1.); vec2 p=q.xy/q.z; vec2 L=u_off+p/u_ls; float zc=dot(u_z,vec3(L,1.));
        vec4 c = (zc>1. && q.z!=0.) ? TC(u_src, p/u_bs) : vec4(0.); o=vec4(c.rgb*u_mul+u_add, c.a);`,
      { u_src: lb }, { u_h: { mat3: colMajor(Hinv) }, u_bs: [lb.width, lb.height], u_ls: ls, u_off: [R[0], R[1]], u_z: map.zrow, u_mul: lit ? lit.mul : [1, 1, 1], u_add: lit ? lit.add : [0, 0, 0] }, out);
      if (!ok) { const a = layer.matrix; og.setTransform(...mulA([a[0] * s, a[1] * s, a[2] * s, a[3] * s, a[4] * s, a[5] * s], [1 / ls, 0, 0, 1 / ls, R[0], R[1]])); og.drawImage(lb, 0, 0); og.setTransform(1, 0, 0, 1, 0, 0); }
    }
    release(lb);
    return out;
  }

  /** another layer of the frame (by AE index) rendered into the same buffer space (Set Matte, Displacement Map, Gradient Wipe ...) */
  function layerInBuffer(frame, byId, index, s, A, xf, lb) {
    const other = frame.layers.find((l) => l.index === index); if (!other) return null;
    const oc = renderLayerFull({ ...other, visible: true }, frame, s, byId, true); if (!oc) return null;
    const t = acquire(lb.width, lb.height); const tg = t.getContext('2d');
    // comp px -> buffer px = xf * inv(layer -> comp)  (3D layers use their affine approximation)
    tg.setTransform(...mulA(xf, invA(A))); tg.drawImage(oc, 0, 0); release(oc);
    return t;
  }

  function applyEcho(lb, layer, xf, ls, time) {
    const e = layer.echo; const g = lb.getContext('2d');
    const op = ['', 'lighter', 'lighten', 'darken', 'screen', 'destination-over', 'source-over', 'source-over'][e.operator] || 'lighter';
    const base = acquire(lb.width, lb.height); base.getContext('2d').drawImage(lb, 0, 0);
    if (e.operator === 7) { g.save(); g.globalCompositeOperation = 'copy'; g.globalAlpha = 1 / (e.copies.length + 1); g.drawImage(base, 0, 0); g.restore(); }
    else if ((e.startingIntensity ?? 1) !== 1) { g.save(); g.globalCompositeOperation = 'copy'; g.globalAlpha = Math.max(0, Math.min(1, e.startingIntensity)); g.drawImage(base, 0, 0); g.restore(); }
    release(base);
    for (const c of e.copies) {
      const cc = acquire(lb.width, lb.height); const cg = cc.getContext('2d'); cg.setTransform(...xf); drawContent(cg, c.layer, ls, time); cg.setTransform(1, 0, 0, 1, 0, 0);
      applyMasks(cc, c.layer.masks, xf, ls);
      g.save(); g.globalCompositeOperation = op; g.globalAlpha = e.operator === 7 ? 1 / (e.copies.length + 1) : Math.max(0, Math.min(1, c.intensity)); g.drawImage(cc, 0, 0); g.restore(); release(cc);
    }
  }

  function lumaToAlpha(c) {
    const out = acquire(c.width, c.height);
    if (runShader('luma2alpha', `vec4 c=T(u_src,uv); o=vec4(0.,0.,0.,luma(c.rgb)*c.a);`, { u_src: c }, {}, out)) { const g = c.getContext('2d'); g.save(); g.globalCompositeOperation = 'copy'; g.drawImage(out, 0, 0); g.restore(); release(out); return; }
    release(out);
    const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height); const p = d.data;
    for (let i = 0; i < p.length; i += 4) { const l = (0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]) * (p[i + 3] / 255); p[i] = p[i + 1] = p[i + 2] = 0; p[i + 3] = l; }
    g.putImageData(d, 0, 0);
  }

  /** layer body + track matte (comp size). `asMatte` = render even if hidden (matte source). */
  function renderLayerFull(layer, frame, s, byId, asMatte = false, depth = 0) {
    if (layer.mbSamples && layer.mbSamples.length > 1) { // motion blur: average the layer over the shutter samples
      const parts = layer.mbSamples.map((L) => renderLayerFull({ ...L, mbSamples: null, trackMatte: layer.trackMatte }, frame, s, byId, asMatte, depth)).filter(Boolean);
      if (!parts.length) return null;
      const out = acquire(parts[0].width, parts[0].height); averageInto(out, parts); parts.forEach(release);
      return out;
    }
    let lc;
    if (layer.kind === 'precomp' && layer.collapseTransformation && layer.precomp && !layer.threeD) lc = renderCollapsed(layer, frame, s);
    else lc = renderLayerBody(layer, frame, s, byId);
    if (!lc) return null;
    const tm = layer.trackMatte;
    if (tm && tm.type && tm.type !== 'NO_TRACK_MATTE' && depth < 8) {
      const ml = byId.get(tm.layerId);
      const g = lc.getContext('2d');
      if (ml && ml.visible !== false) {
        const mc = renderLayerFull(ml, frame, s, byId, true, depth + 1);
        if (mc) {
          // the matte layer's own opacity scales the matte
          if ((ml.opacity ?? 1) < 1) { const mg = mc.getContext('2d'); mg.save(); mg.globalCompositeOperation = 'destination-in'; mg.fillStyle = `rgba(0,0,0,${ml.opacity})`; mg.fillRect(0, 0, mc.width, mc.height); mg.restore(); }
          if (tm.type === 'LUMA' || tm.type === 'LUMA_INVERTED') lumaToAlpha(mc);
          g.save(); g.globalCompositeOperation = tm.type === 'ALPHA' || tm.type === 'LUMA' ? 'destination-in' : 'destination-out'; g.drawImage(mc, 0, 0); g.restore(); release(mc);
        } else if (tm.type === 'ALPHA' || tm.type === 'LUMA') g.clearRect(0, 0, lc.width, lc.height);
      } else if (tm.type === 'ALPHA' || tm.type === 'LUMA') g.clearRect(0, 0, lc.width, lc.height); // matte not present -> nothing shows
    }
    return lc;
  }

  /** Collapse Transformations: the precomp's layers are transformed straight into this comp (crisp vectors at any scale) */
  function renderCollapsed(layer, frame, s) {
    const pf = layer.precomp.frame; const M = layer.matrix;
    const tf = { ...pf, width: frame.width, height: frame.height, layers: pf.layers.map((l) => ({ ...l, matrix: mulA(M, l.matrix || [1, 0, 0, 1, 0, 0]) })) };
    const out = paintComp(tf, s);
    const map = layerToComp(layer, s);
    applyMasks(out, layer.masks, map.affine, scaleOf(map));
    if (hasFx(layer) || layer.layerStyles) {
      const ls = scaleOf(map); const iv = invA(map.affine); const o = apA(iv, 0, 0);
      const fxCtx = { canvas: out, ls, off: o, time: frame.time, pool, masks: layer.masks, layerW: layer.width, layerH: layer.height, compW: frame.width, compH: frame.height };
      for (const eff of layer.effects || []) { if (eff.enabled === false) continue; if (applyEffect(eff, fxCtx) === 'unsupported') stats.unsupportedEffects.add(eff.matchName); }
      if (layer.layerStyles) applyLayerStyles(out, layer.layerStyles, ls, pool, frame.time);
    }
    return out;
  }

  function applyAdjustment(out, layer, frame, s) {
    const W = out.width, H = out.height; const map = layerToComp(layer, s);
    const fxd = acquire(W, H); fxd.getContext('2d').drawImage(out, 0, 0);
    const ls = scaleOf(map); const o = map.affine ? apA(invA(map.affine), 0, 0) : [0, 0];
    const fxCtx = { canvas: fxd, ls, off: o, time: frame.time, pool, masks: layer.masks, layerW: layer.width, layerH: layer.height, compW: frame.width, compH: frame.height };
    for (const eff of layer.effects || []) { if (eff.enabled === false) continue; if (applyEffect(eff, fxCtx) === 'unsupported') stats.unsupportedEffects.add(eff.matchName); }
    // coverage = the adjustment layer's box (+ masks) x opacity
    const cov = acquire(W, H); const cg = cov.getContext('2d');
    if (map.affine) { cg.setTransform(...map.affine); cg.fillStyle = '#000'; cg.fillRect(0, 0, layer.width || frame.width, layer.height || frame.height); cg.setTransform(1, 0, 0, 1, 0, 0); applyMasks(cov, layer.masks, map.affine, ls); }
    else { cg.fillStyle = '#000'; cg.fillRect(0, 0, W, H); }
    const fg = fxd.getContext('2d'); fg.globalCompositeOperation = 'destination-in'; fg.drawImage(cov, 0, 0); fg.globalCompositeOperation = 'source-over';
    const g = out.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    const op = Math.max(0, Math.min(1, layer.opacity ?? 1));
    g.globalCompositeOperation = 'destination-out'; g.globalAlpha = op; g.drawImage(cov, 0, 0); // remove the covered part of the original ...
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = op; g.drawImage(fxd, 0, 0);           // ... and add the processed one
    g.restore(); release(cov); release(fxd);
  }

  /** Paint a ResolvedFrame; returns a (pooled, comp-size*scale) canvas the caller must release() or draw from. */
  function paintComp(frame, s) {
    const W = Math.max(1, Math.round(frame.width * s)), H = Math.max(1, Math.round(frame.height * s));
    const out = acquire(W, H); const og = out.getContext('2d');
    if (frame.bgColor && frame.opaqueBg) { og.fillStyle = rgba([...frame.bgColor, 1]); og.fillRect(0, 0, W, H); }
    const byId = new Map(frame.layers.map((l) => [l.id, l]));
    for (const layer of frame.layers) {
      if (!layer.visible || layer.isTrackMatte || layer.kind === 'null') continue;
      if (layer.kind === 'adjustment') { if (hasFx(layer)) applyAdjustment(out, layer, frame, s); continue; }
      const lc = renderLayerFull(layer, frame, s, byId);
      if (!lc) continue;
      blendOnto(out, lc, layer.blendMode || 'NORMAL', Math.max(0, Math.min(1, layer.opacity ?? 1)), frame.time, pool);
      release(lc);
    }
    return out;
  }

  return { paintComp, release, stats, pool };
}

// ---- motion blur (AE): only layers with the motion-blur switch are sampled across the shutter; the rest render once
function attachSamples(center, samples) {
  const out = { ...center, layers: center.layers.map((l) => {
    let r = l;
    if (l.motionBlur) r = { ...l, mbSamples: samples.map((f) => f.layers.find((x) => x.id === l.id)).filter(Boolean) };
    else if (l.precomp) { const subs = samples.map((f) => f.layers.find((x) => x.id === l.id)?.precomp?.frame).filter(Boolean); if (subs.length === samples.length && hasMotionBlur(l.precomp.frame)) r = { ...l, precomp: { frame: attachSamples(l.precomp.frame, subs) } }; }
    return r;
  }) };
  return out;
}
export const hasMotionBlur = (f) => !!f.motionBlur || f.layers.some((l) => l.motionBlur || (l.precomp && hasMotionBlur(l.precomp.frame)));
/**
 * Paint `frame` with AE motion blur when any layer asks for it. `evaluateAt(t)` returns the ResolvedFrame at template time t.
 * Returns a pooled canvas (painter.release it).
 */
export function paintWithMotionBlur(painter, frame, s, evaluateAt, fps, maxSamples = 8) {
  if (!hasMotionBlur(frame)) return painter.paintComp(frame, s);
  const mb = frame.motionBlur || { shutterAngle: 180, shutterPhase: -90, samples: 8 };
  const n = Math.max(2, Math.min(maxSamples, mb.samples || 8)); const samples = [];
  for (let k = 0; k < n; k++) samples.push(evaluateAt(Math.max(0, frame.time + ((mb.shutterPhase + ((k + 0.5) / n) * mb.shutterAngle) / 360) / (fps || 30))));
  return painter.paintComp(attachSamples(frame, samples), s);
}
/** Average several canvases (motion blur samples) into `out` (same size). */
export function averageInto(out, canvases) {
  const g = out.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, out.width, out.height); g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 1 / canvases.length; for (const c of canvases) g.drawImage(c, 0, 0); g.restore();
}
