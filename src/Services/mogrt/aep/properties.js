// Property tree reader: groups (tdgp), leaves (tdbs), keyframes (lhd3/ldat), orientation, shapes, text, gradients, markers.
// Port of py_aep parsers/property*.py + models/properties semantics (values in AE/ExtendScript units).
import { findT, filterT, findL, filterL, utf8Decoder } from './chunks.js';
import { AUTO_NAMES } from './matchNames.js';
import { parseShap } from './shapes.js';
import { parseGradientXml } from './shapes.js';
import { parseBtdk } from './text.js';
import { parseEffect } from './effects.js';
import { PROPERTY_MIN_MAX } from './specData.js';

export const SENTINEL = '-_0_/-';
const INDEXED = new Set(['ADBE Effect Parade', 'ADBE Mask Parade', 'ADBE Effect Mask Parade', 'ADBE Text Animators', 'ADBE Text Selectors', 'ADBE Root Vectors Group', 'ADBE Vectors Group']);
const PERCENT = new Set(['ADBE Opacity', 'ADBE Scale', 'ADBE Mask Opacity']);
const ISSPATIAL_OVERRIDES = new Set([
  'ADBE Orientation', 'ADBE Fill-0002', 'ADBE Mask Shape', 'ADBE Vector Shape', 'ADBE Shadow Color', 'ADBE Vector Fill Color',
  'ADBE Text Fill Color', 'ADBE Text Stroke Color', 'ADBE 3DText Front RGB', 'ADBE 3DText Bevel RGB', 'ADBE 3DText Side RGB',
  'ADBE 3DText Back RGB', 'ADBE HUE SATURATION-0003', 'ADBE CurvesCustom-0001', 'ADBE Easy Levels-0002', 'ADBE Easy Levels2-0002',
  'ADBE LIQUIFY-0014', 'ADBE Lumetri-0032', 'ADBE Lumetri-0047', 'ADBE Lumetri-0073', 'ADBE Lumetri-0085', 'ADBE MESH WARP-0004',
  'ADBE RESHAPE-0006', 'APC Colorama-0012',
]);
const PLACEHOLDER_UNBOUNDED = new Set(['ADBE Scale', 'ADBE Position_0', 'ADBE Position_1', 'ADBE Position_2', 'ADBE Light Falloff Distance',
  'ADBE Light Falloff Start', 'ADBE Light Shadow Darkness', 'ADBE Light Shadow Diffusion', 'ADBE Light Intensity', 'ADBE Camera Zoom',
  'ADBE3D Material Texturre Offset', 'ADBE3D Material Scale']);
const UNBOUNDED = new Set(['ADBE R Channel Blend', 'ADBE G Channel Blend', 'ADBE B Channel Blend', 'ADBE Blend Interior', 'ADBE Blend Ranges',
  'ADBE Vector Scale', 'ADBE Vector Repeater Scale']);
const MIN_MAX = PROPERTY_MIN_MAX;
const DEFAULT_INFLUENCE = 100 / 6;
const COLOR_SPEED_SCALE = 255;

export const CONTROL = { 0: 'LAYER', 1: 'SLIDER', 2: 'SLIDER', 3: 'ANGLE', 4: 'CHECKBOX', 5: 'COLOR', 6: 'POINT', 7: 'DROPDOWN', 9: 'NO_CONTROL', 10: 'SLIDER', 11: 'CURVE', 12: 'MASK', 13: 'GROUP', 18: 'POINT3D' };
// Value type tags used internally (PropertyValueType)
export const PVT = { UNKNOWN: 'UNKNOWN', NO_VALUE: 'NO_VALUE', THREE_SP: 'THREE_SP', THREE: 'THREE', TWO_SP: 'TWO_SP', TWO: 'TWO', ONE: 'ONE', COLOR: 'COLOR', CUSTOM: 'CUSTOM', MARKER: 'MARKER', LAYER_INDEX: 'LAYER_INDEX', MASK_INDEX: 'MASK_INDEX', SHAPE: 'SHAPE', TEXT: 'TEXT', ORIENTATION: 'ORIENTATION' };
const VT_OUT = { UNKNOWN: 'CUSTOM', NO_VALUE: 'NO_VALUE', THREE_SP: 'THREE_D', THREE: 'THREE_D', TWO_SP: 'TWO_D', TWO: 'TWO_D', ONE: 'ONE_D', COLOR: 'COLOR', CUSTOM: 'CUSTOM', MARKER: 'MARKER', LAYER_INDEX: 'LAYER_INDEX', MASK_INDEX: 'MASK_INDEX', SHAPE: 'SHAPE', TEXT: 'TEXT_DOCUMENT', ORIENTATION: 'THREE_D' };
export const VT_OUT_PUBLIC = VT_OUT;
const DIMS = { ONE_D: 1, TWO_D: 2, THREE_D: 3, COLOR: 4 };
const INTERP = { 1: 'LINEAR', 2: 'BEZIER', 3: 'HOLD' };

export const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'number' ? null : v));

// ------------------------------------------------------------------ small chunk decoders

function decodeTdb4(c) {
  const f5 = c.u1(5);
  return {
    dimensions: c.u2(2),
    spatialRaw: !!(f5 & 0x08),
    noValue: !!(c.u1(57) & 1),
    vector: !!(c.u1(59) & 8),
    integer: !!(c.u1(59) & 4),
    color: !!(c.u1(59) & 1),
    animated: c.u1(68) !== 0,
    exprDisabled: !!(c.u1(119) & 1),
  };
}
function decodeTdsb(c) {
  const lock = c ? c.u1(2) : 0;
  return { enabled: c ? !!(c.u1(3) & 1) : true, dimSeparated: !!(lock & 0x08) };
}

function readTdum(c, t4) {
  if (!c) return undefined;
  const n = c.len;
  if (t4.color) {
    if (n < 16) return undefined;
    return [c.f4(0), c.f4(4), c.f4(8), c.f4(12)];
  }
  if (t4.integer && n < 8) return n >= 4 ? c.u4(0) : undefined;
  const cnt = Math.floor(n / 8);
  if (cnt < 1) return undefined;
  const vals = [];
  for (let i = 0; i < cnt; i++) vals.push(c.f8(i * 8));
  return cnt === 1 ? vals[0] : vals;
}

export function computeTypes(t4, isSpatial) {
  let pct = 'UNKNOWN';
  let pvt = PVT.UNKNOWN;
  if (t4.noValue) pvt = PVT.NO_VALUE;
  if (t4.color) { pct = 5; pvt = PVT.COLOR; }
  else if (t4.integer && t4.dimensions <= 1) { pct = 4; pvt = PVT.ONE; }
  else if (t4.vector || (t4.integer && t4.dimensions > 1)) {
    if (t4.dimensions === 1) { pct = 2; pvt = PVT.ONE; }
    else if (t4.dimensions === 2) { pct = 6; pvt = isSpatial ? PVT.TWO_SP : PVT.TWO; }
    else if (t4.dimensions === 3) { pct = 18; pvt = isSpatial ? PVT.THREE_SP : PVT.THREE; }
  } else if (t4.dimensions === 1) { pct = 2; pvt = PVT.ONE; }
  return { pct, pvt };
}

// ------------------------------------------------------------------ layer timing helpers

export function layerTimebase(internal, stretchFactor) {
  const fixed = Math.floor(Math.abs(stretchFactor) * 65536 + 0.5);
  if (fixed <= 65536) return internal;
  return Math.min(Math.floor((internal * fixed) / 65536), 115200);
}

// ------------------------------------------------------------------ keyframes

function itemType(raw, size) {
  const k = `${raw}:${size}`;
  switch (k) {
    case '4:152': return 'color';
    case '4:128': return 'three';
    case '4:104': return 'two_sp';
    case '4:88': return 'two';
    case '4:80': return 'orientation';
    case '4:64': return 'no_value';
    case '4:48': return 'one';
    case '4:16': return 'marker';
    case '4:8': return 'shape';
    default: return 'unknown';
  }
}

function parseKeyItems(listChunk, t4) {
  if (!listChunk) return [];
  const lhd3 = findT(listChunk.kids, 'lhd3');
  const ldat = findT(listChunk.kids, 'ldat');
  if (!lhd3 || !ldat) return [];
  const count = lhd3.u4(8);
  const size = lhd3.u4(16);
  let type = itemType(lhd3.u1(23), size);
  if (type === 'three' && t4.spatialRaw) type = 'three_sp';
  if (size === 0 || count === 0) return [];
  const items = [];
  for (let i = 0; i < count; i++) {
    const o = i * size;
    if (o + size > ldat.len) break;
    const time = ldat.src.dv.getInt32(ldat.start + o, false);
    const inI = ldat.u1(o + 4);
    const outI = ldat.u1(o + 5);
    const flags = ldat.u2(o + 6);
    const p = o + 8;
    const it = {
      timeUnits: time,
      inInterp: INTERP[inI] || 'LINEAR',
      outInterp: INTERP[outI] || 'LINEAR',
      roving: !!(flags & 0x20),
      temporalAutoBezier: !!(flags & 0x10),
      temporalContinuous: !!(flags & 0x08),
      type,
      value: undefined, inSpeed: [], inInf: [], outSpeed: [], outInf: [],
      spatialContinuous: false, spatialAutoBezier: false, inTan: null, outTan: null,
      isArray: false,
    };
    const d = (q) => ldat.f8(p + q);
    if (type === 'color') {
      it.inSpeed = [d(16)]; it.inInf = [d(24)]; it.outSpeed = [d(32)]; it.outInf = [d(40)];
      it.value = [d(48), d(56), d(64), d(72)];
    } else if (type === 'no_value' || type === 'orientation') {
      it.inSpeed = [d(16)]; it.inInf = [d(24)]; it.outSpeed = [d(32)]; it.outInf = [d(40)];
    } else if (type === 'two_sp' || type === 'three_sp') {
      const n = type === 'two_sp' ? 2 : 3;
      const fl = ldat.u1(p + 3);
      it.spatialContinuous = !!(fl & 1);
      it.spatialAutoBezier = !!(fl & 2);
      it.inSpeed = [d(16)]; it.inInf = [d(24)]; it.outSpeed = [d(32)]; it.outInf = [d(40)];
      it.value = []; it.inTan = []; it.outTan = [];
      for (let k = 0; k < n; k++) it.value.push(d(48 + k * 8));
      for (let k = 0; k < n; k++) it.inTan.push(d(48 + (n + k) * 8));
      for (let k = 0; k < n; k++) it.outTan.push(d(48 + (2 * n + k) * 8));
    } else if (type === 'one' || type === 'two' || type === 'three' || type === 'three_sp') {
      const n = type === 'one' ? 1 : type === 'two' ? 2 : 3;
      it.isArray = true;
      const arr = (b) => { const r = []; for (let k = 0; k < n; k++) r.push(d((b * n + k) * 8)); return r; };
      it.value = arr(0); it.inSpeed = arr(1); it.inInf = arr(2); it.outSpeed = arr(3); it.outInf = arr(4);
    }
    items.push(it);
  }
  return items;
}

// ------------------------------------------------------------------ leaf property

/**
 * Parse a leaf from a tdbs list.
 * o: { pvt?, ctrl?, effectDef?, inEffect, wrapperKind: null|'orientation'|'shape'|'text'|'gradient'|'marker', wrapper }
 */
export function parseLeaf(tdbs, mn, L, o = {}) {
  const kids = tdbs.kids;
  const tdsbC = findT(kids, 'tdsb');
  const tdb4C = findT(kids, 'tdb4');
  if (!tdb4C) return null;
  const tdsb = decodeTdsb(tdsbC);
  const t4 = decodeTdb4(tdb4C);
  const kind = o.wrapperKind || null;
  let dims = t4.dimensions;
  if (kind === 'orientation') { dims = 3; t4.vector = true; }
  const isSpatial = ISSPATIAL_OVERRIDES.has(mn) ? true : t4.color ? true : t4.spatialRaw;
  const def = o.effectDef || null;

  // value / control type
  let { pct, pvt } = computeTypes({ ...t4, dimensions: dims }, isSpatial);
  if (kind === 'orientation') { pct = 3; pvt = PVT.THREE_SP; }
  if (kind === 'shape') pvt = PVT.SHAPE;
  if (kind === 'text') pvt = PVT.TEXT;
  if (kind === 'marker') pvt = PVT.MARKER;
  if (def) {
    pct = def.ctrl;
    if (def.pvt) pvt = def.pvt;
  }

  // names
  let name;
  const tdsn = findT(kids, 'tdsn');
  const tdsnText = tdsn ? tdsn.containerString().split('\0')[0] : '';
  const autoName = def && def.name ? def.name : AUTO_NAMES[mn] || mn;
  let autoNamed = false;
  if (tdsnText && tdsnText !== SENTINEL) name = tdsnText;
  else { name = autoName; autoNamed = true; }
  if (pvt === PVT.NO_VALUE && name === mn && o.inEffect) name = '';

  const percent = PERCENT.has(mn);
  const effScale = effectScaleFor(mn, pct, o.inEffect, L);
  const pc = { mn, color: t4.color, percent, effScale, L, dims };
  const exprC = findT(kids, 'Utf8');
  const expression = exprC ? exprC.text() : '';
  const cdat = findT(kids, 'cdat');
  const tdpi = findT(kids, 'tdpi');
  const tdli = findT(kids, 'tdli');
  const tdum = readTdum(findT(kids, 'tdum'), t4);
  const tduM = readTdum(findT(kids, 'tduM'), t4);

  // keyframes
  const keyList = findL(kids, 'list');
  const items = parseKeyItems(keyList, t4);

  // complex per-key values
  let complex = null; // array aligned with items (or [single static])
  if (kind === 'shape') {
    const omks = findL(o.wrapper.kids, 'omks');
    complex = omks ? filterL(omks.kids, 'shap').map((s) => parseShap(s, mn === 'ADBE Mask Shape' ? L.maskScale : null)) : [];
  } else if (kind === 'text') {
    const btdk = findL(o.wrapper.kids, 'btdk');
    const parsed = btdk ? parseBtdk(btdk.listBody) : null;
    complex = parsed ? parsed.docs : [];
    if (parsed && L.usedFonts) for (const f of parsed.usedFonts) L.usedFonts.add(f);
  } else if (kind === 'gradient') {
    const gcky = findL(o.wrapper.kids, 'GCky');
    complex = [];
    if (gcky) for (const u of filterT(gcky.kids, 'Utf8')) { const g = parseGradientXml(u.text()); if (g) complex.push(g); }
    if (complex.length) pvt = pvt === PVT.NO_VALUE ? pvt : pvt;
  } else if (kind === 'marker') {
    const mrky = findL(o.wrapper.kids, 'mrky');
    complex = mrky ? filterL(mrky.kids, 'Nmrd').map(parseMarker) : [];
  } else if (kind === 'orientation') {
    const otky = findL(o.wrapper.kids, 'otky');
    complex = otky ? filterT(otky.kids, 'otda').map((c) => { const r = []; for (let i = 0; i < Math.floor(c.len / 8); i++) r.push(c.f8(i * 8)); return r; }) : [];
  }

  // static value
  const resolve = (raw) => resolveValue(raw, pc);
  let staticValue = null;
  const readCdat = () => {
    if (!cdat) return null;
    const le = kind === 'orientation';
    const n = Math.floor(cdat.len / 8);
    const vals = [];
    for (let i = 0; i < Math.min(n, dims); i++) vals.push(cdat.src.dv.getFloat64(cdat.start + i * 8, le));
    if (!vals.length) return null;
    if (dims === 1 && !t4.color) return vals[0];
    return vals;
  };
  const isGrad = kind === 'gradient' && complex && complex.length > 0;
  if (kind === 'orientation') {
    const vals = [];
    if (cdat) { const n = Math.floor(cdat.len / 8); for (let i = 0; i < n; i++) vals.push(cdat.src.dv.getFloat64(cdat.start + i * 8, true)); }
    while (vals.length < 3 && cdat) vals.push(0);
    staticValue = cdat ? vals.slice(0, 3) : null;
  } else if (kind === 'shape' || kind === 'text' || kind === 'gradient') {
    staticValue = complex && complex.length ? complex[0] : null;
  } else if (tdpi && L.comp) {
    const lid = tdpi.s4(0);
    staticValue = lid === 0 ? 0 : (L.comp.layerIdToIndex.get(lid) ?? -1) + 1;
  } else if (tdli) {
    staticValue = tdli.s4(0);
  } else if (cdat && !t4.noValue) {
    staticValue = resolve(readCdat());
  } else if (cdat) {
    staticValue = resolve(readCdat());
  }
  if (staticValue !== null && Array.isArray(staticValue) === false && typeof staticValue === 'object') {
    // complex objects pass through
  } else {
    staticValue = maskInertZ(staticValue, pc);
  }
  if (t4.noValue && kind !== 'shape' && !cdat) staticValue = null;
  // NO_VALUE properties carry an empty 4-byte cdat: treated as no value
  if (pvt === PVT.NO_VALUE && kind === null) staticValue = null;

  // keyframes
  const keys = [];
  const nKeys = items.length;
  const unitFactor = def ? undefined : undefined;
  for (let i = 0; i < nKeys; i++) {
    const it = items[i];
    let value;
    if (kind === 'shape' || kind === 'text' || kind === 'gradient' || kind === 'marker') value = complex && i < complex.length ? complex[i] : null;
    else if (kind === 'orientation') value = complex && i < complex.length ? complex[i] : null;
    else if (it.value !== undefined && it.type !== 'no_value') {
      const raw = it.isArray && it.value.length === 1 && !t4.color ? it.value[0] : it.value;
      value = maskInertZ(resolve(raw), pc);
    } else value = null;
    it._resolved = value;
    keys.push(it);
  }
  const keyOut = [];
  const layerTime = (it) => it.timeUnits / L.timebase;
  const stored = (it) => {
    if (it.value === undefined) return null;
    const raw = it.isArray && it.value.length === 1 && !t4.color ? it.value[0] : it.value;
    return resolve(raw);
  };
  const isMotion = isSpatial && !t4.color;
  const speedFactor = effScale && effScale[1] ? effScale[1] : percent ? 100 : 1;
  for (let i = 0; i < nKeys; i++) {
    const it = keys[i];
    const prev = i > 0 ? keys[i - 1] : null;
    const next = i < nKeys - 1 ? keys[i + 1] : null;
    const k = {
      time: layerTime(it) * L.timeStretch + L.timeOrigin,
      value: it._resolved,
      inInterpolation: it.inInterp,
      outInterpolation: it.outInterp,
    };
    const ease = (dir) => {
      const interp = dir === 'in' ? it.inInterp : it.outInterp;
      const speeds = dir === 'in' ? it.inSpeed : it.outSpeed;
      const infs = dir === 'in' ? it.inInf : it.outInf;
      const nb = dir === 'in' ? prev : next;
      const raw = speeds.map((s, d) => ({ speed: s, influence: infs[d] * 100 }));
      if (!raw.length) return [{ speed: 0, influence: 0 }];
      if (interp === 'HOLD') return raw.map(() => ({ speed: 0, influence: DEFAULT_INFLUENCE }));
      if (interp === 'LINEAR') return linearEase(it, nb, dir, raw.length, t4, stored, layerTime, isMotion, pc);
      const facingHold = nb && (dir === 'in' ? nb.outInterp : nb.inInterp) === 'HOLD';
      if (!nb || facingHold) return raw.map((e) => ({ speed: 0, influence: e.influence }));
      const fac = effScale && effScale[1] ? effScale[1] : percent ? 100 : 1;
      return raw.map((e) => ({ speed: e.speed * fac, influence: e.influence }));
    };
    k.inTemporalEase = ease('in');
    k.outTemporalEase = ease('out');
    if (isSpatial) {
      k.spatialInTangent = it.inTan ? scaleVec(it.inTan, effScale) : null;
      k.spatialOutTangent = it.outTan ? scaleVec(it.outTan, effScale) : null;
    }
    k.temporalContinuous = it.temporalContinuous;
    k.temporalAutoBezier = it.temporalAutoBezier;
    k.spatialContinuous = it.spatialContinuous;
    k.spatialAutoBezier = it.spatialAutoBezier;
    k.roving = it.roving;
    keyOut.push(k);
  }
  void speedFactor; void unitFactor;
  if (kind === 'marker') for (const k of keyOut) if (k.value) k.value.time = k.time;

  const value = keyOut.length ? keyOut[0].value : staticValue;

  const node = {
    kind: 'prop',
    matchName: mn,
    name,
    enabled: tdsb.enabled,
    valueType: isGrad ? 'GRADIENT' : VT_OUT[pvt] || 'CUSTOM',
  };
  if (o.inEffect) node.controlType = CONTROL[pct] || 'NO_CONTROL';
  node.dimensions = DIMS[node.valueType] ?? (node.valueType === 'LAYER_INDEX' || node.valueType === 'MASK_INDEX' ? 1 : 0);
  node.isSpatial = isSpatial;
  if (mn === 'ADBE Marker' && kind !== 'marker') node.valueType = 'MARKER';
  node.value = value === undefined ? null : value;
  node.keyframes = keyOut;
  node.expression = expression || null;
  node.expressionEnabled = !t4.exprDisabled && !!expression;
  // bounds
  let mn_ = def && def.min !== undefined ? def.min : undefined;
  let mx_ = def && def.max !== undefined ? def.max : undefined;
  if (!def || def.min === undefined) {
    if (MIN_MAX[mn]) { mn_ = MIN_MAX[mn][0]; mx_ = MIN_MAX[mn][1]; }
    else if (!UNBOUNDED.has(mn)) {
      const placeholder = (v) => PLACEHOLDER_UNBOUNDED.has(mn) && (Array.isArray(v) ? v.every((x) => x === 0) : v === 0);
      if (tdum !== undefined && !placeholder(tdum)) mn_ = tdum;
      if (tduM !== undefined && !placeholder(tduM)) mx_ = tduM;
    }
  }
  if (!UNBOUNDED.has(mn)) {
    if (mn_ !== undefined && mn_ !== null) node.min = mn_;
    if (mx_ !== undefined && mx_ !== null) node.max = mx_;
  }
  if (def && def.items) node.dropdownItems = def.items;
  if (mn === 'ADBE Position' && tdsb.dimSeparated) node.dimensionsSeparated = true;
  if (autoNamed && !o.inEffect) Object.defineProperty(node, '_auto', { value: true, writable: true, configurable: true });
  if (!findT(kids, 'tduM')) Object.defineProperty(node, '_noTduM', { value: true, writable: true, configurable: true });
  return node;
}

function scaleVec(v, scale) {
  if (!scale) return v.slice();
  return v.map((x, i) => (i < scale.length ? x * scale[i] : x));
}

function linearEase(it, nb, dir, n, t4, stored, layerTime, isMotion, pc) {
  const mk = (s) => ({ speed: s, influence: DEFAULT_INFLUENCE });
  if (!nb) return Array.from({ length: n }, () => mk(0));
  const adjacentInterp = dir === 'out' ? nb.inInterp : nb.outInterp;
  if (adjacentInterp === 'HOLD') return Array.from({ length: n }, () => mk(0));
  const left = dir === 'out' ? it : nb;
  const right = dir === 'out' ? nb : it;
  const span = layerTime(right) - layerTime(left);
  const va = stored(left), vb = stored(right);
  if (it.type === 'orientation' || it.type === 'shape' || it.type === 'no_value' || it.type === 'marker') {
    // path / orientation: AE reports unit chord slope (shape, orientation); no value => 0
    return Array.from({ length: n }, () => mk(it.type === 'orientation' || it.type === 'shape' ? 1 : 0));
  }
  if (t4.color) {
    if (!(Array.isArray(va) && Array.isArray(vb)) || span <= 0) return [mk(0)];
    let s = 0;
    for (let i = 0; i < va.length; i++) s += (vb[i] - va[i]) ** 2;
    return Array.from({ length: n }, () => mk((Math.sqrt(s) * COLOR_SPEED_SCALE) / span));
  }
  if (isMotion && Array.isArray(va) && Array.isArray(vb)) {
    // approximation: chord length (AE uses arc length of the bezier path)
    let s = 0;
    for (let i = 0; i < va.length; i++) s += (vb[i] - va[i]) ** 2;
    return Array.from({ length: n }, () => mk(span > 0 ? Math.sqrt(s) / span : 0));
  }
  if (span === 0) return [mk(0)];
  if (typeof va === 'number' && typeof vb === 'number') return [mk((vb - va) / span)];
  if (Array.isArray(va) && Array.isArray(vb)) return va.map((a, i) => mk((vb[i] - a) / span));
  return [mk(0)];
}

function effectScaleFor(mn, pct, inEffect, L) {
  if (mn === 'ADBE Anchor Point') {
    if (L.hasSource) {
      if (L.width && L.height) return [L.width, L.height, L.height];
    }
    return null;
  }
  if ((pct === 6 || pct === 18) && inEffect) {
    if (L.width && L.height) {
      const s = [L.width, L.height];
      if (pct === 18) s.push(L.height);
      return s;
    }
  }
  return null;
}

function resolveValue(raw, pc) {
  if (raw === null || raw === undefined) return null;
  if (pc.percent) {
    if (typeof raw === 'number') raw = raw * 100;
    else if (Array.isArray(raw)) {
      raw = raw.map((v) => v * 100);
      if (pc.mn === 'ADBE Scale' && raw.length >= 3 && !pc.L.threeD) raw[2] = 100;
    }
  }
  if (pc.color && Array.isArray(raw) && raw.length === 4) {
    const [a, r, g, b] = raw;
    raw = [r / 255, g / 255, b / 255, a / 255];
  }
  if (pc.effScale && Array.isArray(raw) && raw.length >= 2) {
    raw = raw.map((v, i) => (i < pc.effScale.length ? v * pc.effScale[i] : v));
  }
  return raw;
}

function maskInertZ(v, pc) {
  if (Array.isArray(v) && v.length === 3 && (pc.mn === 'ADBE Position' || pc.mn === 'ADBE Anchor Point') && !pc.L.threeD) return [v[0], v[1], 0];
  return v;
}

function parseMarker(nmrd) {
  const nm = findT(nmrd.kids, 'NmHd');
  const us = filterT(nmrd.kids, 'Utf8');
  const dv = nm ? nm.u4(8) : 0;
  const ds = nm ? nm.u4(12) : 600;
  return {
    time: null,
    duration: dv / (ds || 600),
    comment: us[0] ? us[0].text() : '',
    label: nm ? nm.u1(16) : 0,
    protectedRegion: nm ? !!(nm.u1(3) & 2) : false,
    chapter: us[1] ? us[1].text() : '',
    url: us[2] ? us[2].text() : '',
    frameTarget: us[3] ? us[3].text() : '',
    cuePointName: us[4] ? us[4].text() : '',
  };
}

// ------------------------------------------------------------------ groups

export function matchNameRuns(tdgp) {
  const runs = [];
  let skip = true;
  for (const c of tdgp.kids) {
    if (c.type === 'tdmn') {
      const mn = c.tdmn();
      if (mn === 'ADBE Group End') { skip = true; continue; }
      skip = false;
      if (!runs.length || runs[runs.length - 1].mn !== mn) runs.push({ mn, chunks: [] });
      runs[runs.length - 1].chunks.push(c);
    } else if (!skip && c.type !== 'engv') {
      runs[runs.length - 1].chunks.push(c);
    }
  }
  return runs;
}

const MASK_MODES = ['NONE', 'ADD', 'SUBTRACT', 'INTERSECT', 'LIGHTEN', 'DARKEN', 'DIFFERENCE'];

/** Parse the children (one tdgp) into nodes. `L` = layer context. */
export function parseGroupChildren(tdgp, L, opts = {}) {
  const nodes = [];
  let runs = matchNameRuns(tdgp);
  if (opts.skipZero) runs = runs.filter((r) => !r.mn.endsWith('-0000'));
  for (const run of runs) {
    let first = null;
    for (const c of run.chunks) if (c.isList) { first = c; break; }
    if (!first) continue;
    try {
      const lt = first.listType;
      const mn = run.mn;
      if (lt === 'sspc') {
        const tdmns = run.chunks.filter((c) => c.type === 'tdmn');
        const sspcs = filterL(run.chunks, 'sspc');
        const n = Math.min(tdmns.length, sspcs.length);
        for (let i = 0; i < n; i++) nodes.push(parseEffect(sspcs[i], mn, L));
      } else if (lt === 'tdgp') {
        const tdgps = filterL(run.chunks, 'tdgp');
        if (mn === 'ADBE Mask Atom') {
          const mkifs = filterT(run.chunks, 'mkif');
          const n = Math.min(tdgps.length, mkifs.length);
          for (let i = 0; i < n; i++) {
            const g = parseGroup(tdgps[i], mn, L, { autoName: `Mask ${nodes.filter((x) => x.matchName === 'ADBE Mask Atom').length + 1}` });
            const mk = mkifs[i];
            const shapeTdsb = (() => {
              const oms = findL(tdgps[i].kids.filter((c, idx, arr) => true), 'om-s');
              return oms;
            })();
            void shapeTdsb;
            g.mask = {
              mode: MASK_MODES[Math.max(0, Math.min(6, mk.u2(6)))],
              inverted: !!mk.u1(0),
              locked: !!mk.u1(1),
              color: [mk.u1(45) / 255, mk.u1(46) / 255, mk.u1(47) / 255],
              motionBlur: mk.u1(2),
              featherFalloff: mk.u1(3),
              rotoBezier: maskRoto(tdgps[i]),
            };
            g.maskMode = g.mask.mode; g.inverted = g.mask.inverted; g.locked = g.mask.locked;
            g.color = g.mask.color; g.rotoBezier = g.mask.rotoBezier;
            nodes.push(g);
          }
        } else {
          const tdmns = run.chunks.filter((c) => c.type === 'tdmn');
          const n = Math.min(tdgps.length, tdmns.length);
          for (let i = 0; i < n; i++) nodes.push(parseGroup(tdgps[i], mn, L, {}));
        }
      } else if (lt === 'tdbs') {
        const leaf = parseLeaf(first, mn, L, { inEffect: !!opts.inEffect, effectDef: opts.defs ? opts.defs.get(mn) : undefined });
        if (leaf) nodes.push(leaf);
      } else if (lt === 'otst') {
        const tdbs = findL(first.kids, 'tdbs');
        if (tdbs) { const leaf = parseLeaf(tdbs, mn, L, { wrapperKind: 'orientation', wrapper: first }); if (leaf) nodes.push(leaf); }
      } else if (lt === 'btds') {
        const tdbs = findL(first.kids, 'tdbs');
        if (tdbs) { const leaf = parseLeaf(tdbs, mn, L, { wrapperKind: 'text', wrapper: first }); if (leaf) nodes.push(leaf); }
      } else if (lt === 'om-s') {
        const tdbs = findL(first.kids, 'tdbs');
        if (tdbs) { const leaf = parseLeaf(tdbs, mn, L, { wrapperKind: 'shape', wrapper: first }); if (leaf) nodes.push(leaf); }
      } else if (lt === 'GCst') {
        const tdbs = findL(first.kids, 'tdbs');
        if (tdbs) { const leaf = parseLeaf(tdbs, mn, L, { wrapperKind: 'gradient', wrapper: first }); if (leaf) nodes.push(leaf); }
      } else if (lt === 'mrst') {
        const tdbs = findL(first.kids, 'tdbs');
        if (tdbs) { const leaf = parseLeaf(tdbs, 'ADBE Marker', L, { wrapperKind: 'marker', wrapper: first }); if (leaf) nodes.push(leaf); }
      } else if (lt === 'OvG2') {
        const tdgps = filterL(run.chunks, 'tdgp');
        if (tdgps.length) nodes.push(parseGroup(tdgps[0], mn, L, {}));
      }
    } catch (e) {
      // unknown / corrupt property: skip, never throw
      if (L.warnings) L.warnings.push(`${run.mn}: ${e && e.message}`);
    }
  }
  return nodes;
}

function maskRoto(maskTdgp) {
  for (const run of matchNameRuns(maskTdgp)) {
    if (run.mn === 'ADBE Mask Shape') {
      const oms = run.chunks.find((c) => c.isList && c.listType === 'om-s');
      if (oms) {
        const tdbs = findL(oms.kids, 'tdbs');
        const tdsb = tdbs ? findT(tdbs.kids, 'tdsb') : null;
        if (tdsb) return !!tdsb.u1(0);
      }
      return false;
    }
  }
  return false;
}

export function parseGroup(tdgp, mn, L, o = {}) {
  const tdsbC = findT(tdgp.kids, 'tdsb');
  const tdsn = findT(tdgp.kids, 'tdsn');
  const tdsnText = tdsn ? tdsn.containerString().split('\0')[0] : '';
  const name = tdsnText && tdsnText !== SENTINEL ? tdsnText : o.autoName || o.fnam || AUTO_NAMES[mn] || mn;
  const g = {
    kind: 'group',
    matchName: mn,
    name,
    enabled: tdsbC ? !!(tdsbC.u1(3) & 1) : true,
    groupType: INDEXED.has(mn) && !o.isEffect ? 'indexed' : 'named',
    children: [],
  };
  if (!(tdsnText && tdsnText !== SENTINEL)) Object.defineProperty(g, '_auto', { value: true, writable: true, configurable: true });
  g.children = parseGroupChildren(tdgp, L, { parentMN: mn });
  return g;
}
