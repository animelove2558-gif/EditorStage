// After Effects scene evaluator: Scene JSON (docs/mogrt-scene-schema.md) -> ResolvedFrame.
// Pure ES module (no Node APIs, no eval / new Function).
import { interpolateKeys } from './expr/anim.js';
import { Interp, parseExpression, SandboxError } from './expr/interp.js';
import { createApi } from './expr/aeapi.js';
import { hashStr, isVec } from './expr/vecmath.js';
import { textUnits } from './textUnits.js';

const EPS = 1e-6;
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

const ALIASES = {
  rotation: ['ADBE Rotate Z', 'ADBE Vector Rotation', 'ADBE Text Rotation'],
  zrotation: ['ADBE Rotate Z'], xrotation: ['ADBE Rotate X'], yrotation: ['ADBE Rotate Y'],
  startopacity: ['ADBE Vector Repeater Opacity 1'], endopacity: ['ADBE Vector Repeater Opacity 2'],
  anchorpoint: ['ADBE Anchor Point', 'ADBE Vector Anchor'],
  opacity: ['ADBE Opacity', 'ADBE Vector Group Opacity', 'ADBE Vector Fill Opacity', 'ADBE Vector Stroke Opacity'],
  scale: ['ADBE Scale', 'ADBE Vector Scale'],
  position: ['ADBE Position', 'ADBE Vector Position'],
  path: ['ADBE Vector Shape', 'ADBE Mask Shape'],
  timeremap: ['ADBE Time Remapping'],
};

export function findChild(g, key) {
  const ch = g && g.children;
  if (!ch) return null;
  if (typeof key === 'number') return ch[key - 1] || null;
  key = String(key);
  for (let i = 0; i < ch.length; i++) if (ch[i].matchName === key) return ch[i];
  for (let i = 0; i < ch.length; i++) if (ch[i].name === key) return ch[i];
  const nk = norm(key);
  for (let i = 0; i < ch.length; i++) if (norm(ch[i].name) === nk) return ch[i];
  const al = ALIASES[nk];
  if (al) for (const a of al) for (let i = 0; i < ch.length; i++) if (ch[i].matchName === a) return ch[i];
  for (let i = 0; i < ch.length; i++) if (norm(ch[i].matchName) === nk) return ch[i];
  return null;
}

const byMatchCache = new WeakMap();
function childByMatch(g, mn) {
  if (!g || !g.children) return null;
  let m = byMatchCache.get(g);
  if (!m) {
    m = new Map();
    for (const c of g.children) if (!m.has(c.matchName)) m.set(c.matchName, c);
    byMatchCache.set(g, m);
  }
  return m.get(mn) || null;
}

const mulM = (p, c) => [
  p[0] * c[0] + p[2] * c[1], p[1] * c[0] + p[3] * c[1],
  p[0] * c[2] + p[2] * c[3], p[1] * c[2] + p[3] * c[3],
  p[0] * c[4] + p[2] * c[5] + p[4], p[1] * c[4] + p[3] * c[5] + p[5],
];
const IDENT = [1, 0, 0, 1, 0, 0];

function colorFrom(v) {
  if (typeof v === 'string') {
    const m = /^#?([0-9a-f]{6})$/i.exec(v.trim());
    if (m) { const n = parseInt(m[1], 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1]; }
  }
  if (Array.isArray(v)) return v.length >= 4 ? v.slice(0, 4) : [v[0], v[1], v[2], 1];
  if (v && typeof v === 'object' && 'r' in v) return [v.r, v.g, v.b, v.a === undefined ? 1 : v.a];
  return [0, 0, 0, 1];
}

export function createEvaluator(scene, options = {}) {
  let controls = options.controls || {};
  const measureTextOpt = options.measureText || null;
  const footageSizeOpt = options.footageSize || null;

  // ------------------------------------------------------------------ model
  const metaOf = new WeakMap(); // node -> {layer, parent, idx, hash}
  const compsById = new Map(), compsByName = new Map();
  const footageById = new Map(), footageByName = new Map();
  for (const f of scene.footage || []) { footageById.set(f.id, f); if (!footageByName.has(f.name)) footageByName.set(f.name, f); }

  const virtualOf = new WeakMap();
  function indexNode(node, parent, idx, lrt, pathHash) {
    const h = (pathHash * 31 + hashStr(node.matchName || '') + idx) >>> 0;
    metaOf.set(node, { layer: lrt, parent, idx, hash: h });
    if (node.kind === 'group') node.children.forEach((c, i) => indexNode(c, node, i, lrt, h));
    else if (node.keyframes && node.keyframes.length > 1) {
      let sorted = true;
      for (let i = 1; i < node.keyframes.length; i++) if (node.keyframes[i].time < node.keyframes[i - 1].time) { sorted = false; break; }
      if (!sorted) node.keyframes = node.keyframes.slice().sort((a, b) => a.time - b.time);
    }
  }

  for (const c of scene.comps) {
    const crt = { comp: c, id: c.id, layers: [], byId: new Map(), byName: new Map() };
    compsById.set(c.id, crt);
    if (!compsByName.has(c.name)) compsByName.set(c.name, crt);
    c.layers.forEach((l) => {
      const lrt = { layer: l, comp: crt, root: { kind: 'group', matchName: '', name: l.name, enabled: true, children: l.properties } };
      lrt.hash = hashStr(String(l.id));
      crt.layers.push(lrt);
      crt.byId.set(l.id, lrt);
      if (!crt.byName.has(l.name)) crt.byName.set(l.name, lrt);
      l.properties.forEach((p, i) => indexNode(p, lrt.root, i, lrt, lrt.hash));
      // transform shortcuts
      const tg = childByMatch(lrt.root, 'ADBE Transform Group');
      const T = (mn) => childByMatch(tg, mn);
      lrt.tf = { group: tg, anchor: T('ADBE Anchor Point'), pos: T('ADBE Position'), scale: T('ADBE Scale'), rot: T('ADBE Rotate Z'),
        rx: T('ADBE Rotate X'), ry: T('ADBE Rotate Y'), orient: T('ADBE Orientation'), opacity: T('ADBE Opacity') };
      const pos = lrt.tf.pos;
      if (pos && (pos.dimensionsSeparated || (T('ADBE Position_0') && T('ADBE Position_0').keyframes.length))) {
        const px = T('ADBE Position_0'), py = T('ADBE Position_1'), pz = T('ADBE Position_2');
        if (px && py && (pos.dimensionsSeparated || px.keyframes.length || py.keyframes.length || px.expression || py.expression)) {
          const vnode = {
            kind: 'prop', matchName: 'ADBE Position', name: 'Position', enabled: true, valueType: pos.valueType, dimensions: pos.dimensions,
            isSpatial: true, value: pos.value, keyframes: [], expression: pos.expression, expressionEnabled: pos.expressionEnabled,
            virtual: (t) => [evalProp(px, t), evalProp(py, t), pz ? evalProp(pz, t) : 0].slice(0, pos.dimensions || 3),
            virtualParts: [px, py, pz],
          };
          vnode.__real = pos;
          metaOf.set(vnode, metaOf.get(pos));
          virtualOf.set(pos, vnode);
          lrt.tf.pos = vnode;
        }
      }
    });
  }
  for (const crt of compsById.values()) {
    crt.layers.forEach((lrt, i) => { lrt.compIndex = i; });
  }

  // ------------------------------------------------------------- controls
  const ctlNodes = new Map(); // uuid -> {node, ctl, comp, layerRT, media}
  function walkPath(layerRT, path) {
    let cur = layerRT.root;
    for (const step of path) {
      if (!cur || !cur.children) return null;
      if (typeof step === 'number') cur = cur.children[step];
      else cur = childByMatch(cur, step) || cur.children.find((c) => c.matchName === step);
    }
    return cur && cur.kind === 'prop' ? cur : null;
  }
  for (const crt of compsById.values()) {
    for (const ctl of crt.comp.essentialControllers || []) {
      if (!ctl.layerId || !ctl.propertyPath) continue;
      const lrt = crt.byId.get(ctl.layerId);
      if (!lrt) continue;
      const node = walkPath(lrt, ctl.propertyPath);
      if (node || ctl.type === 'media') ctlNodes.set(ctl.uuid, { node, ctl, layerRT: lrt, comp: crt });
    }
  }
  let overrides = new Map(); // node -> fn(base)->value
  let footageOverride = new Map(); // layer id -> footage id
  function findFootage(v) {
    if (v && typeof v === 'object') v = v.footageId !== undefined ? v.footageId : v.id !== undefined ? v.id : v.name;
    if (footageById.has(v)) return footageById.get(v);
    if (footageByName.has(v)) return footageByName.get(v);
    return null;
  }
  function buildOverrides(ctrls) {
    overrides = new Map();
    footageOverride = new Map();
    if (!ctrls) return;
    for (const uuid of Object.keys(ctrls)) {
      const e = ctlNodes.get(uuid);
      let v = ctrls[uuid];
      if (!e) {
        continue;
      }
      const ctl = e.ctl, node = e.node;
      if (ctl.type === 'media' || (node && node.matchName === 'ADBE Layer Source Alternate')) {
        const f = findFootage(v);
        if (f) footageOverride.set(e.layerRT.layer.id, f.id);
        continue;
      }
      if (v === undefined || v === null) continue;
      switch (node.valueType) {
        case 'TEXT_DOCUMENT': {
          const patch = typeof v === 'object' ? { ...v } : { text: String(v) };
          overrides.set(node, (base) => ({ ...(base || {}), ...patch, text: patch.text !== undefined ? patch.text : (base || {}).text }));
          break;
        }
        case 'COLOR': { const c = colorFrom(v); overrides.set(node, () => c); break; }
        case 'ONE_D': case 'LAYER_INDEX': case 'MASK_INDEX': {
          let n = typeof v === 'boolean' ? (v ? 1 : 0) : Array.isArray(v) ? v[0] : Number(v);
          if (!Number.isFinite(n)) break;
          overrides.set(node, () => n);
          break;
        }
        case 'TWO_D': case 'THREE_D': {
          let a = Array.isArray(v) ? v.slice() : v && typeof v === 'object' ? [v.x, v.y, v.z] : [Number(v), Number(v)];
          overrides.set(node, (base) => {
            const out = Array.isArray(base) ? base.slice() : [0, 0, 0];
            for (let i = 0; i < a.length && i < out.length; i++) if (typeof a[i] === 'number') out[i] = a[i];
            return out;
          });
          break;
        }
        default: overrides.set(node, () => v);
      }
    }
  }
  buildOverrides(controls);
  let lastControlsRef = controls;

  // ---------------------------------------------------------- property eval
  let frameCache = new Map();
  const stack = []; // in-progress {node,t}
  const E = { exprTime: 0, virtualOf };
  let api = null;

  function evalBase(node, t) {
    if (node.virtual) return node.virtual(t);
    const ov = overrides.size ? overrides.get(node) : undefined;
    if (ov) return ov(node.value);
    const ks = node.keyframes;
    if (ks && ks.length) {
      if (node.valueType === 'MARKER') return node.value;
      return ks.length === 1 ? ks[0].value : interpolateKeys(ks, t, !!node.isSpatial);
    }
    return node.value;
  }

  function coerceResult(node, r, base) {
    if (r && typeof r === 'object' && r.__unwrapProp) r = r.value;
    const vt = node.valueType;
    switch (vt) {
      case 'ONE_D': case 'LAYER_INDEX': case 'MASK_INDEX': {
        if (Array.isArray(r)) r = r[0];
        if (typeof r === 'boolean') r = r ? 1 : 0;
        if (typeof r === 'string') r = Number(r);
        if (typeof r !== 'number' || Number.isNaN(r)) return base;
        return r;
      }
      case 'TWO_D': case 'THREE_D': case 'COLOR': {
        const dims = vt === 'TWO_D' ? 2 : vt === 'THREE_D' ? 3 : 4;
        if (typeof r === 'number') r = new Array(dims).fill(r);
        if (!Array.isArray(r)) return base;
        r = r.map((x) => Number(x));
        if (r.some((x) => Number.isNaN(x))) return base;
        if (vt === 'COLOR' && r.length === 3) r.push(1);
        if (r.length > dims) r = r.slice(0, dims);
        while (r.length < dims) r.push(Array.isArray(base) && typeof base[r.length] === 'number' ? base[r.length] : 0);
        return r;
      }
      case 'TEXT_DOCUMENT': {
        if (typeof r === 'string' || typeof r === 'number') return { ...(base || {}), text: String(r) };
        if (r && typeof r === 'object' && typeof r.text === 'string') return r;
        return base;
      }
      case 'SHAPE': return r && r.vertices ? r : base;
      default: return r === undefined ? base : r;
    }
  }

  function evalProp(node, t) {
    let tm = frameCache.get(node);
    if (tm) { const hit = tm.get(t); if (hit !== undefined) return hit; } else { tm = new Map(); frameCache.set(node, tm); }
    const base = evalBase(node, t);
    let value = base;
    if (node.expression && node.expressionEnabled && !(node.__real && false)) {
      let busy = false;
      for (let i = 0; i < stack.length; i++) if (stack[i].node === node && stack[i].t === t) { busy = true; break; }
      if (busy || stack.length > 48) return base;
      stack.push({ node, t });
      const savedT = E.exprTime;
      try {
        const m = metaOf.get(node);
        const r = runExpression(node, m ? m.layer : null, t, base);
        value = coerceResult(node, r, base);
      } catch (e) {
        value = base;
        if (options.onExpressionError) options.onExpressionError(e, node);
      } finally {
        stack.pop();
        E.exprTime = savedT;
      }
    }
    tm.set(t, value);
    return value;
  }

  function runExpression(node, lrt, t, base) {
    E.exprTime = t;
    const ast = parseExpression(node.expression);
    const host = api.makeHost(node, lrt, t, base);
    const it = new Interp(host, 300000);
    return it.run(ast);
  }

  // ------------------------------------------------------------ transforms
  const num = (v, d = 0) => (typeof v === 'number' && !Number.isNaN(v) ? v : d);
  function layerLocal(lrt, t) {
    const tf = lrt.tf;
    const anchor = tf.anchor ? evalProp(tf.anchor, t) : [0, 0, 0];
    const pos = tf.pos ? evalProp(tf.pos, t) : [0, 0, 0];
    const scl = tf.scale ? evalProp(tf.scale, t) : [100, 100, 100];
    let rot = tf.rot ? num(evalProp(tf.rot, t)) : 0;
    if (lrt.layer.threeD && tf.orient) rot += num(evalProp(tf.orient, t)[2]);
    const op = tf.opacity ? num(evalProp(tf.opacity, t), 100) : 100;
    return { anchor: [num(anchor[0]), num(anchor[1])], pos: [num(pos[0]), num(pos[1])], scale: [num(scl[0], 100), num(scl[1], 100)], rot, opacity: op };
  }
  function localMatrix(L) {
    const r = (L.rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    const sx = L.scale[0] / 100, sy = L.scale[1] / 100;
    // T(pos) * R * S * T(-anchor)
    const a = c * sx, b = s * sx, cc = -s * sy, d = c * sy;
    return [a, b, cc, d, L.pos[0] - (a * L.anchor[0] + cc * L.anchor[1]), L.pos[1] - (b * L.anchor[0] + d * L.anchor[1])];
  }
  const wmCache = new Map();
  function worldMatrix(lrt, t, depth = 0) {
    const key = lrt;
    let m = wmCache.get(key);
    if (m && m.has(t)) return m.get(t);
    if (!m) { m = new Map(); wmCache.set(key, m); }
    let M = localMatrix(layerLocal(lrt, t));
    const pid = lrt.layer.parentId;
    if (pid != null && depth < 32) {
      const p = lrt.comp.byId.get(pid);
      if (p && p !== lrt) M = mulM(worldMatrix(p, t, depth + 1), M);
    }
    m.set(t, M);
    return M;
  }

  // ------------------------------------------------------------- 3D / camera
  // 4x4 column-major (m[c*4+r]); AE space: x right, y down, z into the screen. Camera looks along +z.
  const m4 = {
    I: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
    T: (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1],
    S: (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1],
    Rz: (d) => { const r = (d * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
    Rx: (d) => { const r = (d * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]; }, // +X: top recedes
    Ry: (d) => { const r = (d * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]; }, // +Y: right side recedes
    pt: (m, p, w = 1) => { const x = p[0] || 0, y = p[1] || 0, z = p[2] || 0; return [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w]; },
    inv(m) {
      const a = m, o = new Array(16);
      const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
      const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06; if (!det) return m4.I(); det = 1 / det;
      o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det; o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
      o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det; o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
      o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det; o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
      o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det; o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
      return o;
    },
  };
  const v3 = (v, d = 0) => [num(v?.[0], d), num(v?.[1], d), num(v?.[2], d)];
  const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  /** rotation whose +z axis points from `from` to `to` (y stays "down") */
  function lookRot(from, to) {
    const f = norm3([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);
    let x = cross3([0, 1, 0], f); if (Math.hypot(...x) < 1e-6) x = [1, 0, 0]; x = norm3(x); const y = cross3(f, x);
    return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, f[0], f[1], f[2], 0, 0, 0, 0, 1];
  }
  const isRig = (l) => l.type === 'camera' || l.type === 'light';
  function local4(lrt, t) {
    const l = lrt.layer, tf = lrt.tf, three = l.threeD || isRig(l);
    const a = isRig(l) ? [0, 0, 0] : v3(tf.anchor ? evalProp(tf.anchor, t) : [0, 0, 0]); const p = v3(tf.pos ? evalProp(tf.pos, t) : [0, 0, 0]);
    const s = isRig(l) ? [100, 100, 100] : v3(tf.scale ? evalProp(tf.scale, t) : [100, 100, 100], 100);
    if (!three) { a[2] = 0; p[2] = 0; s[2] = 100; }
    const o = three && tf.orient ? v3(evalProp(tf.orient, t)) : [0, 0, 0];
    const rx = three && tf.rx ? num(evalProp(tf.rx, t)) : 0, ry = three && tf.ry ? num(evalProp(tf.ry, t)) : 0, rz = tf.rot ? num(evalProp(tf.rot, t)) : 0;
    let R = m4.mul(m4.mul(m4.Rx(o[0]), m4.Ry(o[1])), m4.mul(m4.Rz(o[2]), m4.mul(m4.Rx(rx), m4.mul(m4.Ry(ry), m4.Rz(rz)))));
    if (isRig(l) && l.autoOrient === 'CAMERA_OR_POINT_OF_INTEREST' && (l.type === 'camera' || l.lightType === 'SPOT' || l.lightType === 'PARALLEL')) {
      const poi = v3(tf.anchor ? evalProp(tf.anchor, t) : [0, 0, 0]); R = m4.mul(lookRot(p, poi), R);
    }
    return m4.mul(m4.T(p[0], p[1], p[2]), m4.mul(R, m4.mul(m4.S(s[0] / 100, s[1] / 100, s[2] / 100), m4.T(-a[0], -a[1], -a[2]))));
  }
  const w4Cache = new Map();
  function world4(lrt, t, depth = 0) {
    let m = w4Cache.get(lrt); if (m && m.has(t)) return m.get(t); if (!m) { m = new Map(); w4Cache.set(lrt, m); }
    let M = local4(lrt, t);
    const pid = lrt.layer.parentId;
    if (pid != null && depth < 32) { const p = lrt.comp.byId.get(pid); if (p && p !== lrt) M = m4.mul(world4(p, t, depth + 1), M); }
    m.set(t, M); return M;
  }
  const inRange = (l, t) => t >= l.inPoint - EPS && t < l.outPoint - EPS;
  function cameraFor(crt, t) {
    const c = crt.comp;
    const cam = crt.layers.find((x) => x.layer.type === 'camera' && x.layer.enabled && inRange(x.layer, t));
    if (cam) {
      const co = childByMatch(cam.root, 'ADBE Camera Options Group');
      const zoom = num(P(co, 'ADBE Camera Zoom', t, c.width * 1.3889), c.width * 1.3889) || c.width * 1.3889;
      return { view: m4.inv(world4(cam, t)), zoom, cx: c.width / 2, cy: c.height / 2, layerId: cam.layer.id };
    }
    const zoom = c.width * 1.3889; // default comp camera (50mm preset)
    return { view: m4.T(-c.width / 2, -c.height / 2, zoom), zoom, cx: c.width / 2, cy: c.height / 2, layerId: null };
  }
  function lightsFor(crt, t) {
    const out = [];
    for (const lrt of crt.layers) {
      const l = lrt.layer; if (l.type !== 'light' || !l.enabled || !inRange(l, t)) continue;
      const lo = childByMatch(lrt.root, 'ADBE Light Options Group'); const W = world4(lrt, t);
      out.push({ type: l.lightType || 'POINT', pos: m4.pt(W, [0, 0, 0]), dir: norm3(m4.pt(W, [0, 0, 1], 0)), intensity: num(P(lo, 'ADBE Light Intensity', t, 100), 100) / 100,
        color: P(lo, 'ADBE Light Color', t, [1, 1, 1, 1]), cone: num(P(lo, 'ADBE Light Cone Angle', t, 90), 90), feather: num(P(lo, 'ADBE Light Cone Feather 2', t, 50), 50) / 100,
        falloff: num(P(lo, 'ADBE Light Falloff Type', t, 1), 1), radius: num(P(lo, 'ADBE Light Falloff Start', t, 500), 500), distance: num(P(lo, 'ADBE Light Falloff Distance', t, 500), 500) });
    }
    return out;
  }
  /** flat (per-layer) AE lighting: { mul:[r,g,b], add:[r,g,b] } or null when unlit */
  function shadeLayer(lrt, t, W4, lights, camPos, cx, cy) {
    if (!lights.length) return null;
    const mo = childByMatch(lrt.root, 'ADBE Material Options Group');
    if (!num(P(mo, 'ADBE Accepts Lights', t, 1), 1)) return null;
    const amb = num(P(mo, 'ADBE Ambient Coefficient', t, 100), 100) / 100, dif = num(P(mo, 'ADBE Diffuse Coefficient', t, 50), 50) / 100;
    const spec = num(P(mo, 'ADBE Specular Coefficient', t, 50), 50) / 100, shin = Math.max(1, num(P(mo, 'ADBE Shininess Coefficient', t, 5), 5));
    const ctr = m4.pt(W4, [cx, cy, 0]); const n = norm3(m4.pt(W4, [0, 0, -1], 0)); const vdir = norm3([camPos[0] - ctr[0], camPos[1] - ctr[1], camPos[2] - ctr[2]]);
    const mul = [0, 0, 0], add = [0, 0, 0];
    for (const L of lights) {
      const col = L.color, I = L.intensity;
      if (L.type === 'AMBIENT') { for (let k = 0; k < 3; k++) mul[k] += amb * I * col[k]; continue; }
      let ldir, att = 1;
      if (L.type === 'PARALLEL') ldir = [-L.dir[0], -L.dir[1], -L.dir[2]];
      else {
        const d = [L.pos[0] - ctr[0], L.pos[1] - ctr[1], L.pos[2] - ctr[2]]; const dist = Math.hypot(...d) || 1; ldir = [d[0] / dist, d[1] / dist, d[2] / dist];
        if (L.falloff === 2) att = dist <= L.radius ? 1 : Math.max(0, 1 - (dist - L.radius) / Math.max(1, L.distance));
        else if (L.falloff === 3) att = dist <= L.radius ? 1 : (L.radius * L.radius) / (dist * dist);
        if (L.type === 'SPOT') { const ang = (Math.acos(Math.max(-1, Math.min(1, -dot3(ldir, L.dir)))) * 180) / Math.PI; const half = L.cone / 2, inner = half * (1 - L.feather); att *= ang <= inner ? 1 : ang >= half ? 0 : 1 - (ang - inner) / Math.max(1e-6, half - inner); }
      }
      const ndl = Math.abs(dot3(n, ldir)); const nn = dot3(n, vdir) < 0 ? n.map((x) => -x) : n;
      const h = norm3([ldir[0] + vdir[0], ldir[1] + vdir[1], ldir[2] + vdir[2]]); const sp = Math.pow(Math.max(0, dot3(nn, h)), shin) * spec;
      for (let k = 0; k < 3; k++) { mul[k] += dif * I * att * ndl * col[k]; add[k] += sp * I * att * col[k]; }
    }
    return { mul, add };
  }
  const in3D = (lrt) => !!(lrt && lrt.layer.threeD);
  function toWorld3(lrt, p, t, vec) { return m4.pt(world4(lrt, t), p, vec ? 0 : 1); }
  function fromWorld3(lrt, p, t, vec) { return m4.pt(m4.inv(world4(lrt, t)), p, vec ? 0 : 1); }
  function toComp3(lrt, p, t) {
    const cam = cameraFor(lrt.comp, t); const q = m4.pt(m4.mul(cam.view, world4(lrt, t)), p); const z = Math.max(1e-3, q[2]);
    return [cam.cx + (q[0] * cam.zoom) / z, cam.cy + (q[1] * cam.zoom) / z, q[2]];
  }
  function fromComp3(lrt, p, t) { // intersect the camera ray through comp point p with the layer plane
    const cam = cameraFor(lrt.comp, t); const MV = m4.mul(cam.view, world4(lrt, t));
    const d = [(p[0] - cam.cx) / cam.zoom, (p[1] - cam.cy) / cam.zoom, 1];
    // MV*(u,v,0,1) = s*d  ->  u*c0 + v*c1 - s*d = -c3
    const A = [[MV[0], MV[4], -d[0]], [MV[1], MV[5], -d[1]], [MV[2], MV[6], -d[2]]], b = [-MV[12], -MV[13], -MV[14]];
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(A) || 1e-12; const col = (i) => A.map((r, k) => r.map((x, j) => (j === i ? b[k] : x)));
    return [det(col(0)) / D, det(col(1)) / D, 0];
  }

  // -------------------------------------------------------------- helpers
  const P = (g, mns, t, def) => {
    if (!g) return def;
    for (const mn of Array.isArray(mns) ? mns : [mns]) {
      const n = childByMatch(g, mn);
      if (n) return evalProp(n, t);
    }
    return def;
  };
  const Pn = (g, key, t, def) => {
    const n = findChild(g, key);
    return n && n.kind === 'prop' ? evalProp(n, t) : def;
  };

  // ------------------------------------------------------------ shapes
  const BLEND = ['NORMAL', 'NORMAL', 'DISSOLVE', 'DARKEN', 'MULTIPLY', 'COLOR_BURN', 'LINEAR_BURN', 'DARKER_COLOR', 'LIGHTEN', 'SCREEN'];
  function shapeItems(vg, t) {
    const out = [];
    if (!vg) return out;
    for (const n of vg.children) {
      if (!n.enabled && n.kind === 'group') continue;
      if (n.kind !== 'group') continue;
      const it = shapeItem(n, t);
      if (it) out.push(it);
    }
    return out;
  }
  const dir = (g, t) => num(P(g, 'ADBE Vector Shape Direction', t, 1), 1);
  function shapeItem(n, t) {
    const mn = n.matchName;
    switch (mn) {
      case 'ADBE Vector Group': {
        const tg = childByMatch(n, 'ADBE Vector Transform Group');
        const sc = P(tg, 'ADBE Vector Scale', t, [100, 100]);
        return {
          type: 'group', name: n.name,
          items: shapeItems(childByMatch(n, 'ADBE Vectors Group'), t),
          transform: {
            anchor: P(tg, 'ADBE Vector Anchor', t, [0, 0]).slice(0, 2),
            position: P(tg, 'ADBE Vector Position', t, [0, 0]).slice(0, 2),
            scale: [sc[0], sc[1]],
            rotation: num(P(tg, 'ADBE Vector Rotation', t, 0)),
            skew: num(P(tg, 'ADBE Vector Skew', t, 0)),
            skewAxis: num(P(tg, 'ADBE Vector Skew Axis', t, 0)),
            opacity: num(P(tg, 'ADBE Vector Group Opacity', t, 100), 100) / 100,
          },
          blendMode: blendName(P(n, 'ADBE Vector Blend Mode', t, 1)),
        };
      }
      case 'ADBE Vector Shape - Group': {
        const s = P(n, 'ADBE Vector Shape', t, null);
        return s ? { type: 'path', name: n.name, closed: s.closed, vertices: s.vertices, inTangents: s.inTangents, outTangents: s.outTangents, direction: dir(n, t) } : null;
      }
      case 'ADBE Vector Shape - Rect':
        return { type: 'rect', name: n.name, size: P(n, 'ADBE Vector Rect Size', t, [0, 0]), position: P(n, 'ADBE Vector Rect Position', t, [0, 0]),
          roundness: num(P(n, 'ADBE Vector Rect Roundness', t, 0)), direction: dir(n, t) };
      case 'ADBE Vector Shape - Ellipse':
        return { type: 'ellipse', name: n.name, size: P(n, 'ADBE Vector Ellipse Size', t, [0, 0]), position: P(n, 'ADBE Vector Ellipse Position', t, [0, 0]), direction: dir(n, t) };
      case 'ADBE Vector Shape - Star':
        return { type: 'star', name: n.name, starType: num(P(n, 'ADBE Vector Star Type', t, 1), 1) === 2 ? 'polygon' : 'star',
          points: num(P(n, 'ADBE Vector Star Points', t, 5), 5), position: P(n, 'ADBE Vector Star Position', t, [0, 0]),
          rotation: num(P(n, 'ADBE Vector Star Rotation', t, 0)), innerRadius: num(P(n, 'ADBE Vector Star Inner Radius', t, 0)),
          outerRadius: num(P(n, 'ADBE Vector Star Outer Radius', t, 0)), innerRoundness: num(P(n, 'ADBE Vector Star Inner Roundess', t, 0)),
          outerRoundness: num(P(n, 'ADBE Vector Star Outer Roundess', t, 0)), direction: dir(n, t) };
      case 'ADBE Vector Graphic - Fill':
        return { type: 'fill', name: n.name, color: P(n, 'ADBE Vector Fill Color', t, [1, 1, 1, 1]), opacity: num(P(n, 'ADBE Vector Fill Opacity', t, 100), 100) / 100,
          rule: num(P(n, 'ADBE Vector Fill Rule', t, 1), 1) === 2 ? 'evenodd' : 'nonzero', blendMode: blendName(P(n, 'ADBE Vector Blend Mode', t, 1)) };
      case 'ADBE Vector Graphic - G-Fill': {
        const g = P(n, 'ADBE Vector Grad Colors', t, null);
        const gt = num(P(n, 'ADBE Vector Grad Type', t, 1), 1) === 2 ? 'RADIAL' : 'LINEAR';
        return { type: 'gradientFill', name: n.name, gradient: g ? { ...g, type: gt } : null, startPoint: P(n, 'ADBE Vector Grad Start Pt', t, [0, 0]),
          endPoint: P(n, 'ADBE Vector Grad End Pt', t, [0, 0]), gradientType: gt, opacity: num(P(n, 'ADBE Vector Fill Opacity', t, 100), 100) / 100,
          rule: num(P(n, 'ADBE Vector Fill Rule', t, 1), 1) === 2 ? 'evenodd' : 'nonzero', highlightLength: num(P(n, 'ADBE Vector Grad HiLite Length', t, 0)),
          highlightAngle: num(P(n, 'ADBE Vector Grad HiLite Angle', t, 0)), blendMode: blendName(P(n, 'ADBE Vector Blend Mode', t, 1)) };
      }
      case 'ADBE Vector Graphic - Stroke': return strokeBase(n, t, 'stroke');
      case 'ADBE Vector Graphic - G-Stroke': {
        const s = strokeBase(n, t, 'gradientStroke');
        const g = P(n, 'ADBE Vector Grad Colors', t, null);
        const gt = num(P(n, 'ADBE Vector Grad Type', t, 1), 1) === 2 ? 'RADIAL' : 'LINEAR';
        s.gradient = g ? { ...g, type: gt } : null; s.gradientType = gt;
        s.startPoint = P(n, 'ADBE Vector Grad Start Pt', t, [0, 0]); s.endPoint = P(n, 'ADBE Vector Grad End Pt', t, [0, 0]);
        s.highlightLength = num(P(n, 'ADBE Vector Grad HiLite Length', t, 0)); s.highlightAngle = num(P(n, 'ADBE Vector Grad HiLite Angle', t, 0));
        return s;
      }
      case 'ADBE Vector Filter - Trim':
        return { type: 'trim', name: n.name, start: num(P(n, 'ADBE Vector Trim Start', t, 0)), end: num(P(n, 'ADBE Vector Trim End', t, 100), 100),
          offset: num(P(n, 'ADBE Vector Trim Offset', t, 0)), mode: num(P(n, 'ADBE Vector Trim Type', t, 1), 1) === 2 ? 'individual' : 'simultaneous' };
      case 'ADBE Vector Filter - Repeater': {
        const tg = childByMatch(n, 'ADBE Vector Repeater Transform');
        const sc = P(tg, 'ADBE Vector Repeater Scale', t, [100, 100]);
        return { type: 'repeater', name: n.name, copies: num(P(n, 'ADBE Vector Repeater Copies', t, 3), 3), offset: num(P(n, 'ADBE Vector Repeater Offset', t, 0)),
          anchor: P(tg, 'ADBE Vector Repeater Anchor', t, [0, 0]).slice(0, 2), position: P(tg, 'ADBE Vector Repeater Position', t, [0, 0]).slice(0, 2),
          scale: [sc[0], sc[1]], rotation: num(P(tg, 'ADBE Vector Repeater Rotation', t, 0)),
          startOpacity: num(P(tg, 'ADBE Vector Repeater Opacity 1', t, 100), 100) / 100, endOpacity: num(P(tg, 'ADBE Vector Repeater Opacity 2', t, 100), 100) / 100,
          composite: num(P(n, 'ADBE Vector Repeater Order', t, 1), 1) === 2 ? 'above' : 'below' };
      }
      case 'ADBE Vector Filter - Merge': return { type: 'merge', name: n.name, mode: ['', 'merge', 'add', 'subtract', 'intersect', 'excludeIntersections'][num(P(n, 'ADBE Vector Merge Type', t, 1), 1)] || 'add' };
      case 'ADBE Vector Filter - RC': return { type: 'roundCorners', name: n.name, radius: num(P(n, 'ADBE Vector RoundCorner Radius', t, 0)) };
      case 'ADBE Vector Filter - Offset':
        return { type: 'offsetPaths', name: n.name, amount: num(P(n, 'ADBE Vector Offset Amount', t, 0)),
          lineJoin: ['', 'miter', 'round', 'bevel'][num(P(n, 'ADBE Vector Offset Line Join', t, 1), 1)] || 'miter', miterLimit: num(P(n, 'ADBE Vector Offset Miter Limit', t, 4), 4) };
      case 'ADBE Vector Filter - PB': return { type: 'puckerBloat', name: n.name, amount: num(P(n, 'ADBE Vector PuckerBloat Amount', t, 0)) };
      case 'ADBE Vector Filter - Zigzag':
        return { type: 'zigzag', name: n.name, size: num(P(n, 'ADBE Vector Zigzag Size', t, 10)), detail: num(P(n, 'ADBE Vector Zigzag Detail', t, 5)),
          points: num(P(n, 'ADBE Vector Zigzag Points', t, 1), 1) === 2 ? 'smooth' : 'corner' };
      case 'ADBE Vector Filter - Twist': return { type: 'twist', name: n.name, angle: num(P(n, 'ADBE Vector Twist Angle', t, 0)), center: P(n, 'ADBE Vector Twist Center', t, [0, 0]) };
      case 'ADBE Vector Filter - Roughen': case 'ADBE Vector Filter - Wiggler': case 'ADBE Vector Filter - Repeater2': {
        const params = {};
        for (const c of n.children) if (c.kind === 'prop') params[c.name] = evalProp(c, t);
        return { type: mn.endsWith('Roughen') ? 'roughen' : 'wigglePaths', name: n.name, params };
      }
      default: return null;
    }
  }
  function blendName(v) {
    const names = ['NORMAL', 'NORMAL', 'DISSOLVE', 'DARKEN', 'MULTIPLY', 'COLOR_BURN', 'LINEAR_BURN', 'DARKER_COLOR', 'LIGHTEN', 'SCREEN', 'COLOR_DODGE', 'LINEAR_DODGE', 'LIGHTER_COLOR', 'OVERLAY', 'SOFT_LIGHT', 'HARD_LIGHT', 'LINEAR_LIGHT', 'VIVID_LIGHT', 'PIN_LIGHT', 'HARD_MIX', 'DIFFERENCE', 'EXCLUSION', 'HUE', 'SATURATION', 'COLOR', 'LUMINOSITY'];
    return typeof v === 'string' ? v : names[v] || 'NORMAL';
  }
  function strokeBase(n, t, type) {
    const dg = childByMatch(n, 'ADBE Vector Stroke Dashes');
    const dashes = [];
    if (dg) {
      let active = false;
      const entries = [];
      for (const c of dg.children) {
        const v = num(evalProp(c, t));
        const mnm = c.matchName;
        entries.push([mnm, v]);
        if (c.keyframes.length || c.expression || (v !== 10 && !/Offset/.test(mnm)) || (/Offset/.test(mnm) && v !== 0)) active = true;
      }
      if (active) for (const [mnm, v] of entries) dashes.push({ kind: /Dash/.test(mnm) ? 'dash' : /Gap/.test(mnm) ? 'gap' : 'offset', value: v });
    }
    return {
      type, name: n.name, color: P(n, 'ADBE Vector Stroke Color', t, [1, 1, 1, 1]), opacity: num(P(n, 'ADBE Vector Stroke Opacity', t, 100), 100) / 100,
      width: num(P(n, 'ADBE Vector Stroke Width', t, 1), 1),
      cap: ['butt', 'butt', 'round', 'square'][num(P(n, 'ADBE Vector Stroke Line Cap', t, 1), 1)] || 'butt',
      join: ['miter', 'miter', 'round', 'bevel'][num(P(n, 'ADBE Vector Stroke Line Join', t, 1), 1)] || 'miter',
      miterLimit: num(P(n, 'ADBE Vector Stroke Miter Limit', t, 4), 4), dashes, blendMode: blendName(P(n, 'ADBE Vector Blend Mode', t, 1)),
    };
  }

  // -------------------------------------------------------------- text
  const TEXT_ANIM_KEYS = {
    'ADBE Text Position 3D': 'position', 'ADBE Text Anchor Point 3D': 'anchorPoint', 'ADBE Text Scale 3D': 'scale', 'ADBE Text Skew': 'skew',
    'ADBE Text Skew Axis': 'skewAxis', 'ADBE Text Rotation X': 'rotationX', 'ADBE Text Rotation Y': 'rotationY', 'ADBE Text Rotation': 'rotation',
    'ADBE Text Opacity': 'opacity', 'ADBE Text Fill Opacity': 'fillOpacity', 'ADBE Text Stroke Opacity': 'strokeOpacity',
    'ADBE Text Fill Color': 'fillColor', 'ADBE Text Stroke Color': 'strokeColor', 'ADBE Text Fill Hue': 'fillHue', 'ADBE Text Stroke Hue': 'strokeHue',
    'ADBE Text Fill Saturation': 'fillSaturation', 'ADBE Text Stroke Saturation': 'strokeSaturation', 'ADBE Text Fill Brightness': 'fillBrightness',
    'ADBE Text Stroke Brightness': 'strokeBrightness', 'ADBE Text Stroke Width': 'strokeWidth', 'ADBE Text Line Anchor': 'lineAnchor',
    'ADBE Text Tracking Amount': 'tracking', 'ADBE Text Line Spacing': 'lineSpacing', 'ADBE Text Character Offset': 'characterOffset', 'ADBE Text Blur': 'blur',
  };
  const TEXT_ANIM_DEFAULT = {
    position: 0, anchorPoint: 0, scale: 100, skew: 0, skewAxis: 0, rotationX: 0, rotationY: 0, rotation: 0, opacity: 100, fillOpacity: 100, strokeOpacity: 100,
    fillHue: 0, strokeHue: 0, fillSaturation: 0, strokeSaturation: 0, fillBrightness: 0, strokeBrightness: 0, strokeWidth: 0, lineAnchor: 50,
    tracking: 0, lineSpacing: 0, characterOffset: 0, blur: 0,
  };
  const RANGE_BASED = ['', 'characters', 'charactersExcludingSpaces', 'words', 'lines'];
  const RANGE_MODE = ['', 'add', 'subtract', 'intersect', 'min', 'max', 'difference'];
  const RANGE_SHAPE = ['', 'square', 'rampUp', 'rampDown', 'triangle', 'round', 'smooth'];
  /** Expression selector: evaluate the Amount expression once per unit (textIndex 1-based, textTotal, selectorValue). */
  function expressionAmounts(s, lrt, t, doc, basedOn) {
    const an = childByMatch(s, 'ADBE Text Expressible Amount');
    if (!an) return [];
    const U = textUnits(String(doc?.text ?? ''));
    const total = Math.max(0, U.counts[basedOn] ?? U.counts.characters);
    const base = evalBase(an, t); const out = new Array(total).fill(100);
    if (!(an.expression && an.expressionEnabled)) return out.map(() => (Array.isArray(base) ? base[0] : num(base, 100)));
    const saved = E.textVars;
    try {
      for (let i = 0; i < total && i < 2000; i++) {
        E.textVars = { textIndex: i + 1, textTotal: total, selectorValue: [100, 100, 100] };
        try { const r = runExpression(an, lrt, t, base); const v = Array.isArray(r) ? r[0] : r && r.__unwrapProp ? r.value : r; out[i] = num(Array.isArray(v) ? v[0] : Number(v), 100); }
        catch (e) { if (options.onExpressionError) options.onExpressionError(e, an); break; }
      }
    } finally { E.textVars = saved; }
    return out;
  }
  function textPathOptions(tp, lrt, t) {
    const po = childByMatch(tp, 'ADBE Text Path Options'); if (!po) return {};
    const pn = childByMatch(po, 'ADBE Text Path'); const idx = pn ? num(Array.isArray(pn.value) ? pn.value[0] : evalProp(pn, t), 0) : 0;
    if (!(idx > 0)) return {};
    const mp = childByMatch(lrt.root, 'ADBE Mask Parade'); const m = mp && mp.children.filter((c) => c.kind === 'group')[idx - 1];
    const shape = m ? P(m, 'ADBE Mask Shape', t, null) : null; if (!shape) return {};
    return { path: shape, reverse: !!num(P(po, 'ADBE Text Reverse Path', t, 0)), perpendicular: !!num(P(po, 'ADBE Text Perpendicular To Path', t, 1), 1),
      forceAlignment: !!num(P(po, 'ADBE Text Force Align Path', t, 0)), firstMargin: num(P(po, 'ADBE Text First Margin', t, 0)), lastMargin: num(P(po, 'ADBE Text Last Margin', t, 0)) };
  }
  function textMoreOptions(tp, t) {
    const mo = childByMatch(tp, 'ADBE Text More Options'); if (!mo) return {};
    return { anchorGrouping: ['', 'character', 'word', 'line', 'all'][num(P(mo, 'ADBE Text Anchor Point Option', t, 1), 1)] || 'character',
      groupingAlignment: P(mo, 'ADBE Text Anchor Point Align', t, [0, 0]),
      // "Fill & Stroke": Per Character Palette / All Fills Over All Strokes / All Strokes Over All Fills
      renderOrder: ['', 'perCharacter', 'allFillsOverAllStrokes', 'allStrokesOverAllFills'][num(P(mo, 'ADBE Text Render Order', t, 1), 1)] || 'perCharacter',
      characterBlendMode: blendName(num(P(mo, 'ADBE Text Character Blend Mode', t, 1), 1)) };
  }
  function textAnimators(tp, t, lrt, doc) {
    const out = [];
    const ag = childByMatch(tp, 'ADBE Text Animators');
    if (!ag) return out;
    for (const an of ag.children) {
      if (an.kind !== 'group' || an.enabled === false) continue;
      const selectors = [];
      const sg = childByMatch(an, 'ADBE Text Selectors');
      if (sg) for (const s of sg.children) {
        if (s.kind !== 'group' || s.enabled === false) continue;
        if (s.matchName === 'ADBE Text Selector') {
          const adv = childByMatch(s, 'ADBE Text Range Advanced');
          const units = num(P(adv, 'ADBE Text Range Units', t, 1), 1) === 2 ? 'index' : 'percent';
          const pfx = units === 'index' ? 'Index' : 'Percent';
          selectors.push({
            type: 'range', name: s.name, units,
            start: num(P(s, `ADBE Text ${pfx} Start`, t, 0)), end: num(P(s, `ADBE Text ${pfx} End`, t, units === 'index' ? 0 : 100), 100),
            offset: num(P(s, `ADBE Text ${pfx} Offset`, t, 0)),
            basedOn: RANGE_BASED[num(P(adv, 'ADBE Text Range Type2', t, 1), 1)] || 'characters',
            mode: RANGE_MODE[num(P(adv, 'ADBE Text Selector Mode', t, 1), 1)] || 'add',
            amount: num(P(adv, 'ADBE Text Selector Max Amount', t, 100), 100),
            shape: RANGE_SHAPE[num(P(adv, 'ADBE Text Range Shape', t, 1), 1)] || 'square',
            easeHigh: num(P(adv, 'ADBE Text Levels Max Ease', t, 0)), easeLow: num(P(adv, 'ADBE Text Levels Min Ease', t, 0)),
            randomize: num(P(adv, 'ADBE Text Randomize Order', t, 0)) === 1, randomSeed: num(P(adv, 'ADBE Text Random Seed', t, 0)),
            smoothness: num(P(adv, 'ADBE Text Selector Smoothness', t, 100), 100),
          });
        } else if (s.matchName === 'ADBE Text Wiggly Selector') {
          selectors.push({
            type: 'wiggly', name: s.name, time: t,
            mode: RANGE_MODE[num(P(s, 'ADBE Text Selector Mode', t, 4), 4)] || 'intersect',
            maxAmount: num(P(s, 'ADBE Text Wiggly Max Amount', t, 100), 100), minAmount: num(P(s, 'ADBE Text Wiggly Min Amount', t, -100), -100),
            basedOn: RANGE_BASED[num(P(s, 'ADBE Text Range Type2', t, 1), 1)] || 'characters',
            wigglesPerSecond: num(P(s, 'ADBE Text Temporal Freq', t, 2), 2), correlation: num(P(s, 'ADBE Text Character Correlation', t, 50), 50),
            temporalPhase: num(P(s, 'ADBE Text Temporal Phase', t, 0)), spatialPhase: num(P(s, 'ADBE Text Spatial Phase', t, 0)),
            lockDimensions: !!num(P(s, 'ADBE Text Wiggly Lock Dim', t, 0)), randomSeed: num(P(s, 'ADBE Text Wiggly Random Seed', t, 0)),
          });
        } else if (s.matchName === 'ADBE Text Expressible Selector') {
          const basedOn = RANGE_BASED[num(P(s, 'ADBE Text Range Type2', t, 1), 1)] || 'characters';
          selectors.push({ type: 'expression', name: s.name, basedOn, mode: 'add', amounts: expressionAmounts(s, lrt, t, doc, basedOn) });
        } else {
          const params = {};
          const walk = (g) => g.children.forEach((c) => { if (c.kind === 'group') walk(c); else params[c.name || c.matchName] = evalProp(c, t); });
          walk(s);
          selectors.push({ type: 'other', name: s.name, matchName: s.matchName, params });
        }
      }
      const properties = {};
      const pg = childByMatch(an, 'ADBE Text Animator Properties');
      if (pg) for (const p of pg.children) {
        const key = TEXT_ANIM_KEYS[p.matchName];
        if (!key || p.kind !== 'prop' || p.enabled === false) continue;
        const v = evalProp(p, t);
        const animated = p.keyframes.length > 0 || (p.expression && p.expressionEnabled);
        const d = TEXT_ANIM_DEFAULT[key];
        let used = animated;
        if (!used) {
          if (d === undefined) used = !(Array.isArray(v) && v.slice(0, 3).join() === '1,0,0'); // colors: default [1,0,0]
          else if (Array.isArray(v)) used = v.some((x) => x !== d);
          else used = v !== d;
        }
        if (!used) continue;
        properties[key] = (key === 'opacity' || key === 'fillOpacity' || key === 'strokeOpacity') ? v / 100 : v;
      }
      out.push({ name: an.name, selectors, properties });
    }
    return out;
  }

  // ---------------------------------------------------- effects / styles
  function readEffects(lrt, t) {
    const out = [];
    const ep = childByMatch(lrt.root, 'ADBE Effect Parade');
    if (!ep) return out;
    for (const fx of ep.children) {
      if (fx.kind !== 'group') continue;
      const params = {}, byMatch = {};
      let effectOpacity = 1;
      for (const c of fx.children) {
        if (c.kind === 'prop') {
          if (c.matchName === 'ADBE Force CPU GPU') continue;
          if (c.matchName === 'ADBE Effect Mask Opacity') { effectOpacity = num(evalProp(c, t), 100) / 100; continue; }
          const v = evalProp(c, t);
          params[c.name || c.matchName] = v; byMatch[c.matchName] = v;
        } else if (c.matchName === 'ADBE Effect Built In Params') {
          const eo = childByMatch(c, 'ADBE Effect Mask Opacity'); if (eo) effectOpacity = num(evalProp(eo, t), 100) / 100;
        } else {
          const sub = {};
          c.children.forEach((cc) => { if (cc.kind === 'prop') { const v = evalProp(cc, t); sub[cc.name || cc.matchName] = v; byMatch[cc.matchName] = v; } });
          params[c.name] = sub;
        }
      }
      out.push({ matchName: fx.matchName, name: fx.name, enabled: fx.enabled !== false, params, paramsByMatchName: byMatch, effectOpacity });
    }
    return out;
  }
  const STYLE_KEYS = { dropShadow: 'dropShadow', innerShadow: 'innerShadow', outerGlow: 'outerGlow', innerGlow: 'innerGlow', bevelEmboss: 'bevelEmboss',
    chromeFX: 'satin', solidFill: 'colorOverlay', gradientFill: 'gradientOverlay', patternFill: 'patternOverlay', frameFX: 'stroke' };
  function readLayerStyles(lrt, t) {
    const ls = childByMatch(lrt.root, 'ADBE Layer Styles');
    if (!ls) return undefined;
    let res;
    for (const g of ls.children) {
      if (g.kind !== 'group' || !g.matchName.endsWith('/enabled') || g.enabled === false) continue;
      const pre = g.matchName.split('/')[0];
      const key = STYLE_KEYS[pre];
      if (!key) continue;
      const o = {};
      for (const c of g.children) if (c.kind === 'prop') o[c.matchName.split('/')[1] || c.name] = evalProp(c, t);
      if (!res) {
        res = {};
        const bo = childByMatch(ls, 'ADBE Blend Options Group');
        res.globalAngle = num(P(bo, 'ADBE Global Angle2', t, 120), 120);
        res.globalAltitude = num(P(bo, 'ADBE Global Altitude2', t, 30), 30);
      }
      res[key] = o;
    }
    return res;
  }
  const MASK_MODES = ['NONE', 'ADD', 'SUBTRACT', 'INTERSECT', 'LIGHTEN', 'DARKEN', 'DIFFERENCE'];
  function readMasks(lrt, t) {
    const mp = childByMatch(lrt.root, 'ADBE Mask Parade');
    const out = [];
    if (!mp) return out;
    for (const m of mp.children) {
      if (m.kind !== 'group') continue;
      const shape = P(m, 'ADBE Mask Shape', t, null);
      if (!shape) continue;
      let mode = m.maskMode !== undefined ? m.maskMode : m.mode;
      if (typeof mode === 'number') mode = MASK_MODES[mode] || 'ADD';
      if (typeof mode === 'string') mode = mode.toUpperCase().replace('MASKMODE.', '');
      out.push({
        shape, mode: mode || 'ADD', inverted: !!(m.inverted || m.maskInverted),
        opacity: num(P(m, 'ADBE Mask Opacity', t, 100), 100) / 100,
        feather: P(m, 'ADBE Mask Feather', t, [0, 0]), expansion: num(P(m, 'ADBE Mask Offset', t, 0)), name: m.name,
      });
    }
    return out;
  }

  function measureText(doc) {
    if (measureTextOpt) { const r = measureTextOpt(doc); if (r) return r; }
    const lines = String(doc.text || '').split(/\r\n|\r|\n|\u0003/);
    const fs = doc.fontSize || 12;
    const lh = (doc.autoLeading === false && doc.leading) ? doc.leading : fs * 1.2;
    let w = 0;
    for (const l of lines) w = Math.max(w, l.length * fs * 0.55 + Math.max(0, l.length - 1) * (doc.tracking || 0) * fs / 1000);
    return { width: w, height: lh * lines.length, lineHeight: lh, ascent: fs * 0.8, lines: lines.length };
  }

  // ------------------------------------------------------ resolve layers
  function footageDims(f, lrt) {
    if (!f) return { width: lrt.layer.width, height: lrt.layer.height };
    if (footageOverride.has(lrt.layer.id) && footageSizeOpt) {
      const s = footageSizeOpt(f.id);
      if (s && s.width) return s;
    }
    return { width: f.width || lrt.layer.width, height: f.height || lrt.layer.height };
  }

  function layerKind(l) {
    if (l.nullLayer) return 'null';
    if (l.adjustmentLayer) return 'adjustment';
    if (l.sourceKind === 'comp') return 'precomp';
    if (l.type === 'text') return 'text';
    if (l.type === 'shape') return 'shape';
    const f = l.sourceKind === 'footage' ? footageById.get(l.sourceId) : null;
    if (f && f.kind === 'solid') return 'solid';
    return 'footage';
  }

  function matteInfo(crt) {
    // layer id -> matte layer id ; set of matte ids
    if (crt.matteMap) return crt.matteMap;
    const map = new Map(), mattes = new Set();
    crt.layers.forEach((lrt, i) => {
      const l = lrt.layer;
      if (l.trackMatteType && l.trackMatteType !== 'NO_TRACK_MATTE') {
        let mid = l.matteLayerId;
        if (mid == null && i > 0) mid = crt.layers[i - 1].layer.id;
        if (mid != null) { map.set(l.id, mid); mattes.add(mid); }
      }
    });
    crt.matteMap = { map, mattes };
    return crt.matteMap;
  }

  /**
   * Essential Properties of a precomp layer ("ADBE Layer Overrides"): child i <-> layer.essentialPropertyUuids[i].
   * A property counts as overridden when it is animated/expressed or its value differs from the master property.
   */
  function precompOverrides(lrt, t) {
    const l = lrt.layer; const uu = l.essentialPropertyUuids || [];
    const ov = childByMatch(lrt.root, 'ADBE Layer Overrides'); if (!ov || !ov.children || !uu.length) return null;
    const out = {}; let any = false;
    const props = []; const walk = (g) => { for (const c of g.children || []) { if (c.kind === 'prop') props.push(c); else walk(c); } }; walk(ov);
    props.forEach((p, i) => {
      const uuid = uu[i]; const e = uuid && ctlNodes.get(uuid); if (!e) return;
      if (lastControlsRef && lastControlsRef[uuid] !== undefined) return; // an explicit control wins
      const v = evalProp(p, t);
      const animated = (p.keyframes && p.keyframes.length) || (p.expression && p.expressionEnabled);
      const master = e.node ? (e.node.keyframes && e.node.keyframes.length ? null : e.node.value) : null;
      if (!animated && master !== null && JSON.stringify(master) === JSON.stringify(v)) return;
      if (e.ctl.type === 'media' || (e.node && e.node.matchName === 'ADBE Layer Source Alternate')) { if (v && (typeof v === 'number' || typeof v === 'object')) { out[uuid] = v; any = true; } return; }
      out[uuid] = v; any = true;
    });
    return any ? out : null;
  }
  function withScopedControls(extra, fn) {
    const saved = { overrides, footageOverride, frameCache, ref: lastControlsRef };
    const wm = new Map(wmCache), w4 = new Map(w4Cache);
    buildOverrides({ ...(lastControlsRef || {}), ...extra }); frameCache = new Map(); wmCache.clear(); w4Cache.clear();
    try { return fn(); } finally {
      overrides = saved.overrides; footageOverride = saved.footageOverride; frameCache = saved.frameCache; lastControlsRef = saved.ref;
      wmCache.clear(); for (const [k, v] of wm) wmCache.set(k, v); w4Cache.clear(); for (const [k, v] of w4) w4Cache.set(k, v);
    }
  }

  let precompDepth = 0;
  function resolveLayer(lrt, t, anySolo, minfo, ctx3) {
    const l = lrt.layer;
    const kind = layerKind(l);
    const isMatte = minfo.mattes.has(l.id);
    const inRange = t >= l.inPoint - EPS && t < l.outPoint - EPS;
    let visible = inRange && (l.enabled || isMatte);
    if (anySolo && !l.solo && !isMatte) visible = false;
    if (l.guideLayer) visible = false;
    const base = {
      id: l.id, index: l.index, name: l.name, parentId: l.parentId, kind, visible, opacity: 0, blendMode: l.blendMode || 'NORMAL',
      matrix: IDENT, width: l.width, height: l.height, masks: [], effects: [], isTrackMatte: isMatte, collapseTransformation: !!l.collapseTransformation,
    };
    if (!visible) return base;
    const local = layerLocal(lrt, t);
    const opacity = Math.min(1, Math.max(0, local.opacity / 100));
    base.opacity = opacity;
    if (opacity <= 0 && !isMatte) { base.visible = false; return base; }
    base.visible = opacity > 0 || isMatte;
    base.matrix = worldMatrix(lrt, t);
    if (ctx3 && l.threeD) {
      const W4 = world4(lrt, t); const MV = m4.mul(ctx3.cam.view, W4);
      const cx = (l.width || 0) / 2, cy = (l.height || 0) / 2; const c = m4.pt(MV, [cx, cy, 0]);
      base.threeD = { mv: MV, zoom: ctx3.cam.zoom, cx: ctx3.cam.cx, cy: ctx3.cam.cy, depth: c[2], lighting: shadeLayer(lrt, t, W4, ctx3.lights, ctx3.camPos, cx, cy) };
      // affine approximation at the layer centre (for consumers that only understand 2D)
      const pr = (p) => { const q = m4.pt(MV, p); const z = Math.max(1e-3, q[2]); return [ctx3.cam.cx + (q[0] * ctx3.cam.zoom) / z, ctx3.cam.cy + (q[1] * ctx3.cam.zoom) / z]; };
      const o = pr([0, 0, 0]), ex = pr([1, 0, 0]), ey = pr([0, 1, 0]); base.matrix = [ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]];
    }
    if (l.motionBlur) base.motionBlur = true;
    const mid = minfo.map.get(l.id);
    if (mid != null) base.trackMatte = { type: l.trackMatteType, layerId: mid };
    if (kind === 'null') return base;
    resolveContent(lrt, base, t, kind);
    return base;
  }

  /** Posterize Time effect: content (source, masks, effects, text, shapes) is sampled at the effect's frame rate. */
  function contentTime(lrt, t) {
    const ep = childByMatch(lrt.root, 'ADBE Effect Parade'); if (!ep) return t;
    for (const fx of ep.children) {
      if (fx.kind !== 'group' || fx.enabled === false || fx.matchName !== 'ADBE Posterize Time') continue;
      const fr = num(evalProp(fx.children.find((c) => c.kind === 'prop' && c.matchName !== 'ADBE Effect Built In Params') || { value: 0, keyframes: [] }, t), 0);
      if (fr > 0) return Math.floor(t * fr + 1e-6) / fr;
    }
    return t;
  }
  let echoDepth = 0;
  function resolveContent(lrt, base, t0, kind) {
    const l = lrt.layer; const t = contentTime(lrt, t0);
    base.masks = readMasks(lrt, t);
    base.effects = readEffects(lrt, t);
    const ls = readLayerStyles(lrt, t);
    if (ls) base.layerStyles = ls;
    if (kind === 'adjustment') return;

    // source time
    let srcTime = (t - l.startTime) * (l.stretch ? 100 / l.stretch : 1);
    if (l.timeRemapEnabled) {
      const tr = childByMatch(lrt.root, 'ADBE Time Remapping');
      if (tr) srcTime = num(evalProp(tr, t));
    }
    if (kind === 'footage' || kind === 'solid') {
      const fid = footageOverride.get(l.id) !== undefined ? footageOverride.get(l.id) : l.sourceId;
      const f = footageById.get(fid);
      const d = footageDims(f, lrt);
      base.width = d.width; base.height = d.height;
      base.source = { footageId: fid, time: srcTime };
      if (f && f.kind === 'solid') base.source.color = f.color;
      if (f && f.kind === 'solid') { base.width = l.width || f.width; base.height = l.height || f.height; }
    } else if (kind === 'precomp') {
      const sub = compsById.get(l.sourceId);
      if (sub && precompDepth < 12) {
        base.width = sub.comp.width; base.height = sub.comp.height;
        precompDepth++;
        try {
          const scoped = precompOverrides(lrt, t);
          base.precomp = { frame: scoped ? withScopedControls(scoped, () => evalCompRT(sub, srcTime)) : evalCompRT(sub, srcTime) };
        } finally { precompDepth--; }
      }
    } else if (kind === 'text') {
      const tp = childByMatch(lrt.root, 'ADBE Text Properties');
      const dn = tp && childByMatch(tp, 'ADBE Text Document');
      let doc = dn ? evalProp(dn, t) : {};
      // replaced text: per-run styles no longer line up -> AE keeps the first character's style for the whole text
      if (doc && doc.styleRuns && dn && dn.value && String(dn.value.text ?? '') !== String(doc.text ?? '')) {
        const first = doc.styleRuns[0]; const merged = { ...doc, styleRuns: null };
        for (const [k, v] of Object.entries(first)) if (k !== 'start' && k !== 'end' && v !== null && v !== undefined) merged[k] = v;
        doc = merged;
      }
      base.text = { document: doc, animators: textAnimators(tp, t, lrt, doc), pathOptions: textPathOptions(tp, lrt, t), moreOptions: textMoreOptions(tp, t), time: t };
      base.width = 0; base.height = 0;
    } else if (kind === 'shape') {
      base.shape = { items: shapeItems(childByMatch(lrt.root, 'ADBE Root Vectors Group'), t), time: t };
      base.width = 0; base.height = 0;
    }
    // Echo effect: earlier/later copies of the layer content (painted by the painter with the echo operator)
    const echo = base.effects.find((e) => e.enabled && e.matchName === 'ADBE Echo');
    if (echo && echoDepth === 0) {
      const p = (n, i, d) => { const v = echo.params[n] ?? echo.paramsByMatchName[`ADBE Echo-000${i}`]; return num(Array.isArray(v) ? v[0] : v, d); };
      const dt = p('Echo Time (seconds)', 1, -1 / 30), n = Math.max(0, Math.min(50, Math.round(p('Number Of Echoes', 2, 1)))), i0 = p('Starting Intensity', 3, 1), decay = p('Decay', 4, 1), op = p('Echo Operator', 5, 1);
      const copies = [];
      echoDepth++;
      try {
        for (let k = 1; k <= n; k++) {
          const tk = t0 + dt * k; const cp = { ...base, effects: [], masks: [], echoes: undefined };
          resolveContent(lrt, cp, tk, kind);
          cp.effects = cp.effects.filter((e) => e.matchName !== 'ADBE Echo');
          copies.push({ layer: cp, intensity: i0 * Math.pow(decay, k) });
        }
      } finally { echoDepth--; }
      base.echo = { operator: op, startingIntensity: i0, copies };
      base.effects = base.effects.filter((e) => e.matchName !== 'ADBE Echo');
    }
  }

  function evalCompRT(crt, t) {
    const c = crt.comp;
    const minfo = matteInfo(crt);
    let anySolo = false;
    for (const lrt of crt.layers) if (lrt.layer.solo) { anySolo = true; break; }
    if (crt.has3D === undefined) crt.has3D = crt.layers.some((x) => x.layer.threeD);
    let ctx3 = null;
    if (crt.has3D) {
      const cam = cameraFor(crt, t); const ci = m4.inv(cam.view);
      ctx3 = { cam, lights: lightsFor(crt, t), camPos: m4.pt(ci, [0, 0, 0]) };
    }
    const layers = [];
    for (let i = crt.layers.length - 1; i >= 0; i--) {
      const lrt = crt.layers[i];
      const k = lrt.layer.type;
      if (k === 'camera' || k === 'light' || k === '3dmodel' || k === 'mesh') continue;
      try {
        layers.push(resolveLayer(lrt, t, anySolo, minfo, ctx3));
      } catch (e) {
        if (options.onError) options.onError(e, lrt);
        layers.push({ id: lrt.layer.id, index: lrt.layer.index, name: lrt.layer.name, parentId: lrt.layer.parentId, kind: 'null', visible: false, opacity: 0,
          blendMode: 'NORMAL', matrix: IDENT, width: 0, height: 0, masks: [], effects: [], isTrackMatte: false, collapseTransformation: false });
      }
    }
    if (ctx3) { // AE draws adjacent 3D layers back to front (2D layers split the runs)
      for (let i = 0; i < layers.length;) {
        if (!layers[i].threeD) { i++; continue; }
        let j = i; while (j < layers.length && layers[j].threeD) j++;
        const run = layers.slice(i, j).map((l, k) => [l, k]).sort((a, b) => (b[0].threeD.depth - a[0].threeD.depth) || (a[1] - b[1])).map((x) => x[0]);
        layers.splice(i, j - i, ...run); i = j;
      }
    }
    // audio: footage layers with sound (independent of the video switch), nested precomps included
    const audio = [];
    const levelDb = (lrt) => { const ag = childByMatch(lrt.root, 'ADBE Audio Group'); const lv = ag ? P(ag, 'ADBE Audio Levels', t, [0, 0]) : [0, 0]; return Array.isArray(lv) ? Math.max(num(lv[0]), num(lv[1])) : num(lv); };
    for (const lrt of crt.layers) {
      const l = lrt.layer; if (l.sourceKind !== 'footage' || !inRange(l, t) || (anySolo && !l.solo)) continue;
      const fid = footageOverride.get(l.id) !== undefined ? footageOverride.get(l.id) : l.sourceId; const f = footageById.get(fid);
      if (!f || !f.hasAudio) continue;
      let st = (t - l.startTime) * (l.stretch ? 100 / l.stretch : 1);
      if (l.timeRemapEnabled) { const tr = childByMatch(lrt.root, 'ADBE Time Remapping'); if (tr) st = num(evalProp(tr, t)); }
      audio.push({ footageId: fid, time: st, gainDb: levelDb(lrt), key: `${c.id}:${l.id}`, rate: l.stretch ? 100 / l.stretch : 1 });
    }
    for (const L of layers) {
      const sub = L.precomp?.frame?.audio; if (!sub || !sub.length) continue; const lrt = crt.byId.get(L.id); const g = lrt ? levelDb(lrt) : 0;
      for (const a of sub) audio.push({ ...a, gainDb: a.gainDb + g, key: `${c.id}:${L.id}/${a.key}` });
    }
    return { compId: c.id, name: c.name, width: c.width, height: c.height, bgColor: c.bgColor, time: t, layers, audio,
      motionBlur: c.motionBlurEnabled !== false && layers.some((l) => l.motionBlur) ? { shutterAngle: c.shutterAngle ?? 180, shutterPhase: c.shutterPhase ?? -90, samples: Math.max(2, Math.min(64, c.motionBlurSamples || 16)) } : null };
  }

  // ------------------------------------------------------------ engine
  Object.assign(E, {
    scene, compsById, compsByName, footageById, footageByName,
    evalProp, evalBase, meta: (n) => metaOf.get(n), findChild, childByMatch, worldMatrix, layerLocal,
    keysOf: (n) => (n.virtual ? [] : n.keyframes || []),
    isInProgress: (n) => stack.some((s) => s.node === n),
    measureText, stack,
    shapeBounds: (lrt, t) => shapeBoundsOf(shapeItems(childByMatch(lrt.root, 'ADBE Root Vectors Group'), t)),
    srcTimeOf: (lrt, t) => (t - lrt.layer.startTime) * (lrt.layer.stretch ? 100 / lrt.layer.stretch : 1),
    footageSizeOf: (lrt) => footageDims(footageById.get(lrt.layer.sourceId), lrt),
    in3D, toWorld3, fromWorld3, toComp3, fromComp3, world4,
  });
  api = createApi(E);

  function shapeBoundsOf(items) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    const walk = (list, ox, oy, sx, sy) => {
      for (const it of list) {
        if (it.type === 'group') {
          const tr = it.transform;
          walk(it.items, ox + (tr.position[0] - tr.anchor[0] * tr.scale[0] / 100) * sx, oy + (tr.position[1] - tr.anchor[1] * tr.scale[1] / 100) * sy, sx * tr.scale[0] / 100, sy * tr.scale[1] / 100);
        } else if (it.type === 'rect' || it.type === 'ellipse') {
          add(ox + (it.position[0] - it.size[0] / 2) * sx, oy + (it.position[1] - it.size[1] / 2) * sy);
          add(ox + (it.position[0] + it.size[0] / 2) * sx, oy + (it.position[1] + it.size[1] / 2) * sy);
        } else if (it.type === 'path') it.vertices.forEach((v) => add(ox + v[0] * sx, oy + v[1] * sy));
      }
    };
    walk(items, 0, 0, 1, 1);
    return x0 === Infinity ? { left: 0, top: 0, width: 0, height: 0 } : { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
  }

  function setControls(c) {
    controls = c || {};
    lastControlsRef = controls;
    buildOverrides(controls);
  }

  return {
    evaluateComp(compId, t, controlsOverride) {
      if (controlsOverride) { lastControlsRef = controlsOverride; buildOverrides(controlsOverride); }
      const crt = compsById.get(compId);
      if (!crt) throw new Error('unknown comp ' + compId);
      frameCache = new Map();
      wmCache.clear(); w4Cache.clear();
      stack.length = 0;
      precompDepth = 0;
      return evalCompRT(crt, t);
    },
    setControls,
    getFootageForController(uuid) {
      const e = ctlNodes.get(uuid);
      if (!e) return null;
      const id = footageOverride.get(e.layerRT.layer.id);
      return id === undefined ? null : footageById.get(id) || null;
    },
    /** Evaluate a single property node (debug/testing). */
    _evalProp: (node, t) => { frameCache = new Map(); wmCache.clear(); return evalProp(node, t); },
    _engine: E,
    controllerNodes: ctlNodes,
  };
}
