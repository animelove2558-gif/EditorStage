// Canvas2D painter for evaluated After Effects shape-layer contents (ResolvedFrame layer.shape.items).
// Item order in `items` is AE stack order (top -> bottom). Paints/modifiers apply to the geometry ABOVE them in the same group.
import ClipperLib from 'clipper-lib';
import { canvasBlendOp } from './fx/blend';

const rgba = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${(c[3] ?? 1) * a})`;
const GEOM = new Set(['path', 'rect', 'ellipse', 'star']);
const PAINT = new Set(['fill', 'stroke', 'gradientFill', 'gradientStroke']);
const zero = (n) => Array.from({ length: n }, () => [0, 0]);
const poly = (pts, closed) => ({ closed, vertices: pts, inTangents: zero(pts.length), outTangents: zero(pts.length) });

/** bezier path {closed,vertices,inTangents,outTangents} -> cubic segments */
function bezierSegments(p) {
  const v = p.vertices, n = v.length; if (!n) return [];
  const segs = []; const last = p.closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = v[i], b = v[(i + 1) % n], ot = p.outTangents?.[i] || [0, 0], it = p.inTangents?.[(i + 1) % n] || [0, 0];
    segs.push([a, [a[0] + ot[0], a[1] + ot[1]], [b[0] + it[0], b[1] + it[1]], b]);
  }
  return segs;
}
const bz = (s, t) => { const u = 1 - t; return [u * u * u * s[0][0] + 3 * u * u * t * s[1][0] + 3 * u * t * t * s[2][0] + t * t * t * s[3][0], u * u * u * s[0][1] + 3 * u * u * t * s[1][1] + 3 * u * t * t * s[2][1] + t * t * t * s[3][1]]; };
const segLen = (s) => { let l = 0, prev = s[0]; for (let i = 1; i <= 12; i++) { const q = bz(s, i / 12); l += Math.hypot(q[0] - prev[0], q[1] - prev[1]); prev = q; } return l; };
/** flatten to a polyline (closed paths do not repeat the first point) */
function flatten(p, step = 1.5, subdivideLines = false) {
  const out = []; const segs = bezierSegments(p); if (!segs.length) return p.vertices.slice();
  out.push(segs[0][0]);
  for (const s of segs) { const flat = s[1][0] === s[0][0] && s[1][1] === s[0][1] && s[2][0] === s[3][0] && s[2][1] === s[3][1]; const k = flat && !subdivideLines ? 1 : Math.max(2, Math.ceil(segLen(s) / step)); for (let j = 1; j <= k; j++) out.push(bz(s, j / k)); }
  if (p.closed && out.length > 1) out.pop();
  return out;
}

/** Normalised geometry: every geometry item becomes a bezier path object (closed, vertices, inTangents, outTangents). */
function toPaths(g) {
  let p;
  if (g.type === 'path') p = { closed: !!g.closed, vertices: g.vertices || [], inTangents: g.inTangents || [], outTangents: g.outTangents || [] };
  else if (g.type === 'rect') {
    const [w, h] = g.size, [cx, cy] = g.position, x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
    const r = Math.min(Math.max(g.roundness || 0, 0), Math.abs(w) / 2, Math.abs(h) / 2);
    // AE rect starts at the top-right corner and runs clockwise
    if (r <= 0) p = poly([[x1, y0], [x1, y1], [x0, y1], [x0, y0]], true);
    else {
      const k = r * 0.5523; const v = [[x1, y0 + r], [x1, y1 - r], [x1 - r, y1], [x0 + r, y1], [x0, y1 - r], [x0, y0 + r], [x0 + r, y0], [x1 - r, y0]];
      const it = [[0, -k], [0, 0], [k, 0], [0, 0], [0, k], [0, 0], [-k, 0], [0, 0]], ot = [[0, 0], [0, k], [0, 0], [-k, 0], [0, 0], [0, -k], [0, 0], [k, 0]];
      p = { closed: true, vertices: v, inTangents: it, outTangents: ot };
    }
  } else if (g.type === 'ellipse') {
    const [w, h] = g.size, [cx, cy] = g.position, rx = w / 2, ry = h / 2, kx = rx * 0.5523, ky = ry * 0.5523;
    p = { closed: true, vertices: [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]], inTangents: [[-kx, 0], [0, -ky], [kx, 0], [0, ky]], outTangents: [[kx, 0], [0, ky], [-kx, 0], [0, -ky]] };
  } else if (g.type === 'star') {
    const polygon = g.starType === 'polygon'; const n = Math.max(3, Math.round(g.points || 5)); const cnt = polygon ? n : n * 2;
    const rot = ((g.rotation || 0) - 90) * Math.PI / 180; const [cx, cy] = g.position;
    const v = [], it = [], ot = [];
    for (let i = 0; i < cnt; i++) {
      const outer = polygon || i % 2 === 0; const r = outer ? g.outerRadius : g.innerRadius; const rnd = (outer ? g.outerRoundness : g.innerRoundness) || 0;
      const a = rot + (i * 2 * Math.PI) / cnt; const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a); v.push([x, y]);
      const perim = (2 * Math.PI * r) / cnt; const tl = (perim * rnd) / 100 * 0.5; const tx = -Math.sin(a) * tl, ty = Math.cos(a) * tl;
      ot.push([tx, ty]); it.push([-tx, -ty]);
    }
    p = { closed: true, vertices: v, inTangents: it, outTangents: ot };
  } else return [];
  if (g.direction === 3) p = reversePath(p); // AE "Reversed" path direction
  return [p];
}
function reversePath(p) {
  const n = p.vertices.length; const idx = [0, ...Array.from({ length: n - 1 }, (_, i) => n - 1 - i)];
  return { closed: p.closed, vertices: idx.map((i) => p.vertices[i]), inTangents: idx.map((i) => p.outTangents[i] || [0, 0]), outTangents: idx.map((i) => p.inTangents[i] || [0, 0]) };
}

function pathTo(ctx, p) {
  const v = p.vertices; const n = v.length; if (!n) return;
  ctx.moveTo(v[0][0], v[0][1]);
  const last = p.closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = v[i], b = v[(i + 1) % n], ot = p.outTangents?.[i] || [0, 0], it = p.inTangents?.[(i + 1) % n] || [0, 0];
    if (!ot[0] && !ot[1] && !it[0] && !it[1]) ctx.lineTo(b[0], b[1]);
    else ctx.bezierCurveTo(a[0] + ot[0], a[1] + ot[1], b[0] + it[0], b[1] + it[1], b[0], b[1]);
  }
  if (p.closed) ctx.closePath();
}

/** Trim Paths: keep the [start,end]% (+offset deg) portion of the arc length. */
function trimPaths(paths, t) {
  let s = (t.start ?? 0) / 100, e = (t.end ?? 100) / 100; if (s > e) [s, e] = [e, s];
  const off = (t.offset || 0) / 360;
  if (e - s >= 1 - 1e-6) return paths;
  if (e - s <= 1e-6) return [];
  const lens = paths.map((p) => bezierSegments(p).map(segLen));
  const totals = lens.map((l) => l.reduce((a, x) => a + x, 0));
  const sum = totals.reduce((a, x) => a + x, 0) || 1;
  const out = [];
  const cut = (p, segL, total, r0, r1) => { // r0<r1 in [0,1] of this path's length
    const L0 = r0 * total, L1 = r1 * total; const segs = bezierSegments(p); const pts = []; let acc = 0;
    segs.forEach((sg, si) => {
      const sl = segL[si]; if (acc + sl < L0 - 1e-9 || acc > L1 + 1e-9) { acc += sl; return; }
      const steps = Math.max(4, Math.ceil(sl / 1.5));
      for (let k = 0; k <= steps; k++) { const d = acc + (sl * k) / steps; if (d < L0 - 1e-6 || d > L1 + 1e-6) continue; pts.push(bz(sg, k / steps)); }
      acc += sl;
    });
    if (pts.length > 1) out.push(poly(pts, false));
  };
  const ranges = (a, b) => { a -= Math.floor(a); b = a + (e - s); return b <= 1 ? [[a, b]] : [[a, 1], [0, b - 1]]; };
  if (t.mode === 'individual') paths.forEach((p, i) => { for (const [a, b] of ranges(s + off, e + off)) cut(p, lens[i], totals[i], a, b); });
  else {
    for (const [a, b] of ranges(s + off, e + off)) {
      let acc = 0;
      paths.forEach((p, i) => {
        const lo = (a * sum - acc) / (totals[i] || 1), hi = (b * sum - acc) / (totals[i] || 1); acc += totals[i];
        const k0 = Math.max(0, lo), k1 = Math.min(1, hi); if (k1 > k0) cut(p, lens[i], totals[i], k0, k1);
      });
    }
  }
  return out;
}

// ---------- path modifiers
const SCALE = 100;
const toClip = (pts) => pts.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
const fromClip = (P) => poly(P.map((q) => [q.X / SCALE, q.Y / SCALE]), true);
function mergePaths(paths, mode) {
  if (mode === 'merge' || paths.length < 2) return paths;
  const closed = paths.filter((p) => p.closed); if (closed.length < 1) return paths;
  const ct = { add: ClipperLib.ClipType.ctUnion, subtract: ClipperLib.ClipType.ctDifference, intersect: ClipperLib.ClipType.ctIntersection, excludeIntersections: ClipperLib.ClipType.ctXor }[mode] ?? ClipperLib.ClipType.ctUnion;
  // AE combines path by path, top to bottom: result = ((p0 op p1) op p2) ...
  let acc = [toClip(flatten(closed[0]))];
  for (let i = 1; i < closed.length; i++) {
    const c = new ClipperLib.Clipper(); c.AddPaths(acc, ClipperLib.PolyType.ptSubject, true); c.AddPath(toClip(flatten(closed[i])), ClipperLib.PolyType.ptClip, true);
    const sol = new ClipperLib.Paths(); c.Execute(ct, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero); acc = sol;
  }
  return acc.map(fromClip);
}
function offsetPaths(paths, amount, join, miter) {
  if (!amount) return paths;
  const jt = join === 'round' ? ClipperLib.JoinType.jtRound : join === 'bevel' ? ClipperLib.JoinType.jtSquare : ClipperLib.JoinType.jtMiter;
  const co = new ClipperLib.ClipperOffset(Math.max(1, miter || 4), 0.25 * SCALE);
  for (const p of paths) co.AddPath(toClip(flatten(p)), jt, p.closed ? ClipperLib.EndType.etClosedPolygon : ClipperLib.EndType.etOpenRound);
  const sol = new ClipperLib.Paths(); co.Execute(sol, amount * SCALE);
  return sol.map(fromClip);
}
function puckerBloat(p, amount) { // lottie-web PuckerAndBloatModifier
  const n = p.vertices.length; if (!n || !amount) return p; const k = amount / 100;
  let cx = 0, cy = 0; for (const v of p.vertices) { cx += v[0]; cy += v[1]; } cx /= n; cy /= n;
  const vs = [], it = [], ot = [];
  for (let i = 0; i < n; i++) {
    const v = p.vertices[i], o = [v[0] + (p.outTangents[i]?.[0] || 0), v[1] + (p.outTangents[i]?.[1] || 0)], ii = [v[0] + (p.inTangents[i]?.[0] || 0), v[1] + (p.inTangents[i]?.[1] || 0)];
    const nv = [v[0] + (cx - v[0]) * k, v[1] + (cy - v[1]) * k]; const no = [o[0] + (cx - o[0]) * -k, o[1] + (cy - o[1]) * -k], ni = [ii[0] + (cx - ii[0]) * -k, ii[1] + (cy - ii[1]) * -k];
    vs.push(nv); ot.push([no[0] - nv[0], no[1] - nv[1]]); it.push([ni[0] - nv[0], ni[1] - nv[1]]);
  }
  return { closed: p.closed, vertices: vs, inTangents: it, outTangents: ot };
}
function zigzag(p, size, ridges, smooth) {
  const segs = bezierSegments(p); if (!segs.length) return p; const r = Math.max(0, Math.round(ridges));
  const pts = []; let sign = 1;
  segs.forEach((s, si) => {
    const parts = r + 1;
    for (let j = 0; j < parts + (si === segs.length - 1 && !p.closed ? 1 : 0); j++) {
      const t = j / parts; const q = bz(s, t); const q2 = bz(s, Math.min(1, t + 0.001)), q1 = bz(s, Math.max(0, t - 0.001));
      const dx = q2[0] - q1[0], dy = q2[1] - q1[1], l = Math.hypot(dx, dy) || 1; const nx = -dy / l, ny = dx / l;
      const amp = j === 0 && si === 0 && !p.closed ? 0 : size * sign; pts.push([q[0] + nx * amp, q[1] + ny * amp, dx / l, dy / l]); sign = -sign;
    }
  });
  const out = poly(pts.map((x) => [x[0], x[1]]), p.closed);
  if (smooth) { const segL = size * 0.5; out.inTangents = pts.map((x) => [-x[2] * segL, -x[3] * segL]); out.outTangents = pts.map((x) => [x[2] * segL, x[3] * segL]); }
  return out;
}
function twist(p, angle, center) {
  if (!angle) return p; const pts = flatten(p, 2, true); let maxD = 0; for (const q of pts) maxD = Math.max(maxD, Math.hypot(q[0] - center[0], q[1] - center[1]));
  return poly(pts.map(([x, y]) => { const d = Math.hypot(x - center[0], y - center[1]); const a = ((angle * Math.PI) / 180) * (1 - d / (maxD || 1)); const c = Math.cos(a), s = Math.sin(a); const dx = x - center[0], dy = y - center[1]; return [center[0] + dx * c - dy * s, center[1] + dx * s + dy * c]; }), p.closed);
}
const rng = (seed) => { let s = (seed * 9301 + 49297) % 233280 || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };
const smoothNoise = (x, seed) => { const i = Math.floor(x), f = x - i; const h = (k) => { const r = Math.sin((k + seed * 13.37) * 12.9898) * 43758.5453; return r - Math.floor(r); }; const u = f * f * (3 - 2 * f); return h(i) * (1 - u) + h(i + 1) * u; };
function roughen(p, prm, time, wiggle) {
  const size = Number(prm.Size ?? prm['Size'] ?? 5), detail = Math.max(0, Number(prm.Detail ?? 10)); const seed = Number(prm['Random Seed'] ?? 0); const smooth = Number(prm.Points ?? 1) === 2;
  const wps = Number(prm['Wiggles/Second'] ?? 2), phaseT = Number(prm['Temporal Phase'] ?? 0) / 360, corr = Number(prm.Correlation ?? 50) / 100;
  const pts = flatten(p, 1); const total = pts.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0), 0) || 1;
  const count = Math.max(3, Math.round((total / 100) * detail)); const out = []; let acc = 0, idx = 0; const R = rng(seed + 1);
  const tt = wiggle ? time * wps + phaseT : 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total; while (idx < pts.length - 1) { const l = Math.hypot(pts[idx + 1][0] - pts[idx][0], pts[idx + 1][1] - pts[idx][1]); if (acc + l >= target) break; acc += l; idx++; }
    const q = pts[Math.min(idx, pts.length - 1)];
    const jx = wiggle ? (smoothNoise(tt + k * (1 - corr) * 3.1, seed + 1) - 0.5) * 2 : R() * 2 - 1, jy = wiggle ? (smoothNoise(tt + k * (1 - corr) * 3.1 + 50, seed + 2) - 0.5) * 2 : R() * 2 - 1;
    out.push([q[0] + jx * size, q[1] + jy * size]);
  }
  const res = poly(out, p.closed);
  if (smooth) { const n = out.length; res.inTangents = out.map((_, i) => { const a = out[(i - 1 + n) % n], b = out[(i + 1) % n]; return [(a[0] - b[0]) / 6, (a[1] - b[1]) / 6]; }); res.outTangents = res.inTangents.map(([x, y]) => [-x, -y]); }
  return res;
}

function applyMatrix(ctx, tr) {
  const [ax, ay] = tr.anchor || [0, 0], [px, py] = tr.position || [0, 0], [sx, sy] = tr.scale || [100, 100];
  ctx.translate(px, py);
  if (tr.rotation) ctx.rotate((tr.rotation * Math.PI) / 180);
  if (tr.skew) { const sk = Math.tan((-tr.skew * Math.PI) / 180); const ang = ((tr.skewAxis || 0) * Math.PI) / 180; ctx.rotate(ang); ctx.transform(1, 0, sk, 1, 0, 0); ctx.rotate(-ang); }
  ctx.scale(sx / 100, sy / 100);
  ctx.translate(-ax, -ay);
}

function makeGradient(ctx, it) {
  const g = it.gradient || {}; const [x0, y0] = it.startPoint || [0, 0], [x1, y1] = it.endPoint || [100, 0];
  let grad;
  if (it.gradientType === 'RADIAL' || g.type === 'RADIAL') {
    const r = Math.hypot(x1 - x0, y1 - y0) || 1; const hl = Math.max(-99, Math.min(99, it.highlightLength || 0)) / 100; const ha = Math.atan2(y1 - y0, x1 - x0) + ((it.highlightAngle || 0) * Math.PI) / 180;
    grad = ctx.createRadialGradient(x0 + Math.cos(ha) * r * hl, y0 + Math.sin(ha) * r * hl, 0, x0, y0, r);
  } else grad = ctx.createLinearGradient(x0, y0, x1, y1);
  const as = g.alphaStops || [];
  const alphaAt = (pos) => { if (!as.length) return 1; let prev = as[0]; if (pos <= prev.position) return prev.alpha; for (const s of as) { if (s.position >= pos) { const d = s.position - prev.position || 1; return prev.alpha + ((s.alpha - prev.alpha) * (pos - prev.position)) / d; } prev = s; } return prev.alpha; };
  const colorAt = (pos) => { const cs = g.colorStops || []; if (!cs.length) return [1, 1, 1]; let prev = cs[0]; if (pos <= prev.position) return prev.color; for (const s of cs) { if (s.position >= pos) { const d = s.position - prev.position || 1; const f = (pos - prev.position) / d; return prev.color.map((c, k) => c + (s.color[k] - c) * f); } prev = s; } return prev.color; };
  const positions = [...new Set([...(g.colorStops || []).map((s) => s.position), ...as.map((s) => s.position)])].sort((a, b) => a - b);
  for (const p of positions.length ? positions : [0, 1]) grad.addColorStop(Math.min(1, Math.max(0, p)), rgba([...colorAt(p).slice(0, 3), alphaAt(p)], it.opacity ?? 1));
  return grad;
}

/** Draw `items` (a group's contents) with ctx already set to the group's coordinate space. opts.time = layer time (wiggle paths). */
export function drawShapeItems(ctx, items, opts = {}) {
  const ops = []; // in top -> bottom order: {kind:'paint', item, paths} | {kind:'group', item}
  let paths = [];  // geometry accumulated above the current position
  for (const it of items || []) {
    if (GEOM.has(it.type)) paths = paths.concat(toPaths(it));
    else if (it.type === 'trim') paths = trimPaths(paths, it);
    else if (it.type === 'roundCorners' && it.radius > 0) paths = paths.map((p) => roundCorners(p, it.radius));
    else if (it.type === 'merge') paths = mergePaths(paths, it.mode);
    else if (it.type === 'offsetPaths') paths = offsetPaths(paths, it.amount, it.lineJoin, it.miterLimit);
    else if (it.type === 'puckerBloat') paths = paths.map((p) => puckerBloat(p, it.amount));
    else if (it.type === 'zigzag') paths = paths.map((p) => zigzag(p, it.size, it.detail, it.points === 'smooth'));
    else if (it.type === 'twist') paths = paths.map((p) => twist(p, it.angle, it.center || [0, 0]));
    else if (it.type === 'roughen' || it.type === 'wigglePaths') paths = paths.map((p) => roughen(p, it.params || {}, opts.time || 0, it.type === 'wigglePaths'));
    else if (PAINT.has(it.type)) ops.push({ kind: 'paint', item: it, paths: paths.slice() });
    else if (it.type === 'group') ops.push({ kind: 'group', item: it });
    else if (it.type === 'repeater') {
      const copies = Math.max(0, Math.round(it.copies ?? 1)); if (copies < 1) { ops.length = 0; paths = []; continue; }
      const base = ops.slice(); const baseGeom = paths.slice(); ops.length = 0;
      for (let c = 0; c < copies; c++) {
        const idx = it.composite === 'below' ? copies - 1 - c : c; // ops are painted bottom -> top (reverse)
        const k = idx + (it.offset || 0);
        const an = it.anchor || [0, 0]; const tr = { anchor: an, position: [an[0] + (it.position?.[0] || 0) * k, an[1] + (it.position?.[1] || 0) * k], scale: [100 * Math.pow((it.scale?.[0] ?? 100) / 100, k), 100 * Math.pow((it.scale?.[1] ?? 100) / 100, k)], rotation: (it.rotation || 0) * k };
        const op = copies > 1 ? (it.startOpacity ?? 1) + (((it.endOpacity ?? 1) - (it.startOpacity ?? 1)) * idx) / (copies - 1) : (it.startOpacity ?? 1);
        for (const o of base) ops.push({ ...o, repeat: { tr, op, outer: o.repeat } });
      }
      paths = baseGeom;
    }
  }
  // paint bottom -> top
  for (let i = ops.length - 1; i >= 0; i--) {
    const o = ops[i];
    ctx.save();
    const chain = []; for (let r = o.repeat; r; r = r.outer) chain.unshift(r);
    for (const r of chain) { applyMatrix(ctx, r.tr); ctx.globalAlpha *= r.op; }
    if (o.kind === 'group') {
      const g = o.item; ctx.globalAlpha *= g.transform?.opacity ?? 1; applyMatrix(ctx, g.transform || {});
      if (g.blendMode && g.blendMode !== 'NORMAL') ctx.globalCompositeOperation = canvasBlendOp(g.blendMode);
      drawShapeItems(ctx, g.items, opts);
    } else paintOp(ctx, o);
    ctx.restore();
  }
}

function roundCorners(p, r) {
  if (p.vertices.length < 3) return p;
  const v = p.vertices, n = v.length, nv = [], it = [], ot = [], c = 0.5523;
  for (let i = 0; i < n; i++) {
    const hasCurve = (p.inTangents[i] && (p.inTangents[i][0] || p.inTangents[i][1])) || (p.outTangents[i] && (p.outTangents[i][0] || p.outTangents[i][1]));
    if (hasCurve || (!p.closed && (i === 0 || i === n - 1))) { nv.push(v[i]); it.push(p.inTangents[i] || [0, 0]); ot.push(p.outTangents[i] || [0, 0]); continue; }
    const a = v[(i + n - 1) % n], b = v[i], d = v[(i + 1) % n];
    const d1 = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, d2 = Math.hypot(d[0] - b[0], d[1] - b[1]) || 1; const rr = Math.min(r, d1 / 2, d2 / 2);
    const p1 = [b[0] + ((a[0] - b[0]) * rr) / d1, b[1] + ((a[1] - b[1]) * rr) / d1], p2 = [b[0] + ((d[0] - b[0]) * rr) / d2, b[1] + ((d[1] - b[1]) * rr) / d2];
    nv.push(p1, p2); it.push([0, 0], [(b[0] - p2[0]) * c, (b[1] - p2[1]) * c]); ot.push([(b[0] - p1[0]) * c, (b[1] - p1[1]) * c], [0, 0]);
  }
  return { closed: p.closed, vertices: nv, inTangents: it, outTangents: ot };
}
function paintOp(ctx, o) {
  const it = o.item; if (!o.paths.length) return;
  ctx.beginPath(); for (const p of o.paths) pathTo(ctx, p);
  const op = it.opacity ?? 1;
  if (it.blendMode && it.blendMode !== 'NORMAL') ctx.globalCompositeOperation = canvasBlendOp(it.blendMode);
  if (it.type === 'fill' || it.type === 'gradientFill') {
    ctx.fillStyle = it.type === 'fill' ? rgba(it.color, op) : makeGradient(ctx, it);
    ctx.fill(it.rule === 'evenodd' ? 'evenodd' : 'nonzero');
  } else {
    if (!(it.width > 0)) return;
    ctx.strokeStyle = it.type === 'stroke' ? rgba(it.color, op) : makeGradient(ctx, it);
    ctx.lineWidth = it.width; ctx.lineCap = it.cap || 'butt'; ctx.lineJoin = it.join || 'miter'; ctx.miterLimit = it.miterLimit || 4;
    const dashes = (it.dashes || []).filter((d) => d.kind !== 'offset').map((d) => d.value); const dOff = (it.dashes || []).find((d) => d.kind === 'offset')?.value || 0;
    if (dashes.length && dashes.some((d) => d > 0)) { ctx.setLineDash(dashes.length % 2 ? dashes.concat(dashes) : dashes); ctx.lineDashOffset = -dOff; }
    ctx.stroke();
  }
}

/** content bounds of shape items in layer space (for buffer sizing); null if empty */
export function shapeItemsBounds(items) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, pad = 0;
  const walk = (list, M) => {
    let paths = [];
    for (const it of list || []) {
      if (GEOM.has(it.type)) paths = paths.concat(toPaths(it));
      else if (it.type === 'stroke' || it.type === 'gradientStroke') pad = Math.max(pad, (it.width || 0) * Math.hypot(M[0], M[1]));
      else if (it.type === 'offsetPaths') pad = Math.max(pad, Math.abs(it.amount || 0) * Math.hypot(M[0], M[1]));
      else if (it.type === 'roughen' || it.type === 'wigglePaths' || it.type === 'zigzag') pad = Math.max(pad, Math.abs(Number(it.params?.Size ?? it.size ?? 0)) * Math.hypot(M[0], M[1]));
      else if (it.type === 'repeater') { pad = Infinity; }
      else if (it.type === 'group') {
        const tr = it.transform || {}; const r = ((tr.rotation || 0) * Math.PI) / 180, sx = (tr.scale?.[0] ?? 100) / 100, sy = (tr.scale?.[1] ?? 100) / 100;
        const a = Math.cos(r) * sx, b = Math.sin(r) * sx, c = -Math.sin(r) * sy, d = Math.cos(r) * sy; const ax = tr.anchor?.[0] || 0, ay = tr.anchor?.[1] || 0;
        const L = [a, b, c, d, (tr.position?.[0] || 0) - a * ax - c * ay, (tr.position?.[1] || 0) - b * ax - d * ay];
        walk(it.items, [M[0] * L[0] + M[2] * L[1], M[1] * L[0] + M[3] * L[1], M[0] * L[2] + M[2] * L[3], M[1] * L[2] + M[3] * L[3], M[0] * L[4] + M[2] * L[5] + M[4], M[1] * L[4] + M[3] * L[5] + M[5]]);
        if (tr.skew) pad = Infinity;
      }
    }
    for (const p of paths) for (const s of bezierSegments(p).length ? bezierSegments(p) : [[p.vertices[0] || [0, 0]]]) for (const q of s) { const x = M[0] * q[0] + M[2] * q[1] + M[4], y = M[1] * q[0] + M[3] * q[1] + M[5]; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  };
  walk(items, [1, 0, 0, 1, 0, 0]);
  if (x0 === Infinity || pad === Infinity) return null;
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}
