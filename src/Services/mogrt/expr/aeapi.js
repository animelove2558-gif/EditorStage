// After Effects expression API objects (thisComp, thisLayer, properties, effects ...) bound to the evaluator engine.
import { NOT_HANDLED } from './interp.js';
import { derivative } from './anim.js';
import * as VM from './vecmath.js';

const { isVec } = VM;
const cp = (v) => (Array.isArray(v) ? v.slice() : v);
const normKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

const STATICS = (() => {
  const S = Object.create(null);
  Object.assign(S, {
    Math, Number, String, Array, Boolean, Date, Error, TypeError, RangeError,
    parseInt, parseFloat, isNaN, isFinite, NaN, Infinity,
    Object: { keys: (o) => Object.keys(o), values: (o) => Object.values(o), entries: (o) => Object.entries(o), assign: (...a) => Object.assign(...a) },
    linear: VM.linear, ease: VM.ease, easeIn: VM.easeIn, easeOut: VM.easeOut, clamp: VM.clamp,
    add: VM.add, sub: VM.sub, mul: VM.mul, div: VM.div, mod: VM.mod, dot: VM.dot, cross: VM.cross, normalize: VM.normalize, length: VM.vlength,
    lookAt: VM.lookAt, degreesToRadians: VM.degreesToRadians, radiansToDegrees: VM.radiansToDegrees,
    rgbToHsl: VM.rgbToHsl, hslToRgb: VM.hslToRgb, noise: VM.noise,
    framesToTime: VM.framesToTime,
    createPath: (points = [], inT = [], outT = [], closed = true) => ({
      closed: !!closed, vertices: points.map((p) => p.slice()), inTangents: points.map((_, i) => (inT[i] || [0, 0]).slice()), outTangents: points.map((_, i) => (outT[i] || [0, 0]).slice()),
    }),
  });
  return S;
})();

export function createApi(E) {
  const hosts = new WeakSet();
  const mark = (o) => { hosts.add(o); return o; };
  const propCache = new WeakMap(), groupCache = new WeakMap(), layerCache = new WeakMap(), compCache = new WeakMap();
  const virtualOf = E.virtualOf = E.virtualOf || new WeakMap();
  const sub = (n) => (n && virtualOf.get(n)) || n;

  const curT = () => E.exprTime;
  function valAt(node, t) {
    if (E.isInProgress(node)) return cp(E.evalBase(node, t));
    return cp(E.evalProp(node, t));
  }
  const baseAt = (node, t) => cp(E.evalBase(node, t));

  function wrap(node) {
    if (!node) return null;
    node = sub(node);
    return node.kind === 'group' ? groupObj(node) : propObj(node);
  }

  // ------------------------------------------------------------------ keys
  function keyObj(node, i) {
    const ks = E.keysOf(node);
    if (i < 1 || i > ks.length) throw new RangeError('key index out of range');
    const k = ks[i - 1];
    return mark({ time: k.time, value: cp(k.value), index: i, valueOf() { return k.value; } });
  }

  // ------------------------------------------------------------- PropObj
  class PropObj {
    constructor(node) { this.node = node; this.__unwrapProp = true; }
    get value() { const n = this.node; const v = valAt(n, curT()); return n.valueType === 'TEXT_DOCUMENT' ? (v && v.text !== undefined ? String(v.text) : '') : v; }
    valueOf() { return this.value; }
    toString() { return String(this.value); }
    __get(key) {
      const node = this.node;
      if (typeof key === 'string') {
        const f = propMethod(node, key);
        if (f !== NOT_HANDLED) return f;
      }
      const v = this.value;
      if (v == null) return NOT_HANDLED;
      const m = v[key];
      return typeof m === 'function' ? m.bind(v) : m;
    }
  }
  function propObj(node) {
    let o = propCache.get(node);
    if (!o) { o = mark(new PropObj(node)); propCache.set(node, o); }
    return o;
  }

  function styleObj(doc) {
    const d = { ...doc };
    const o = mark({});
    const get = (k, f) => Object.defineProperty(o, k, { get: () => d[f || k], enumerable: true });
    ['font', 'fontSize', 'fillColor', 'strokeColor', 'strokeWidth', 'tracking', 'leading', 'autoLeading', 'baselineShift', 'justification', 'applyFill', 'applyStroke', 'fauxBold', 'fauxItalic', 'allCaps', 'smallCaps'].forEach((k) => get(k));
    Object.defineProperty(o, 'isParagraphStyle', { get: () => !!d.boxText });
    const setter = (name, field) => { o[name] = (v) => { d[field] = v; return o; }; };
    [['setFontSize', 'fontSize'], ['setFont', 'font'], ['setFillColor', 'fillColor'], ['setStrokeColor', 'strokeColor'], ['setStrokeWidth', 'strokeWidth'],
      ['setTracking', 'tracking'], ['setLeading', 'leading'], ['setJustification', 'justification'], ['setApplyFill', 'applyFill'], ['setApplyStroke', 'applyStroke'],
      ['setFauxBold', 'fauxBold'], ['setFauxItalic', 'fauxItalic'], ['setAllCaps', 'allCaps'], ['setSmallCaps', 'smallCaps'], ['setText', 'text']].forEach(([n, f]) => setter(n, f));
    o.__doc = d;
    return o;
  }

  function shapeOf(node) { const v = valAt(node, curT()); return v && v.vertices ? v : null; }

  function propMethod(node, key) {
    const t0 = curT();
    switch (key) {
      case 'value': return NOT_HANDLED; // handled by getter fallback? (value is a real getter on class)
      case 'valueAtTime': return (t) => valAt(node, t === undefined ? curT() : t);
      case 'name': return node.name;
      case 'matchName': return node.matchName;
      case 'numKeys': return E.keysOf(node).length;
      case 'key': return (i) => {
        if (typeof i === 'string') { const ks = E.keysOf(node); const j = ks.findIndex((k) => k.value && k.value.comment === i); return keyObj(node, j + 1); }
        return keyObj(node, i);
      };
      case 'nearestKey': return (t) => {
        const ks = E.keysOf(node);
        if (!ks.length) throw new Error('no keyframes');
        let bi = 0, bd = Infinity;
        ks.forEach((k, i) => { const d = Math.abs(k.time - t); if (d < bd) { bd = d; bi = i; } });
        return keyObj(node, bi + 1);
      };
      case 'velocity': return () => derivative((t) => valAt(node, t), curT());
      case 'velocityAtTime': return (t) => derivative((x) => valAt(node, x), t);
      case 'speed': return () => VM.vlength(derivative((t) => valAt(node, t), curT()));
      case 'speedAtTime': return (t) => VM.vlength(derivative((x) => valAt(node, x), t));
      case 'smooth': return (width = 0.2, samples = 5, t = curT()) => {
        const n = Math.max(1, Math.floor(samples));
        let acc = null;
        for (let i = 0; i < n; i++) {
          const tt = n === 1 ? t : t - width / 2 + (width * i) / (n - 1);
          const v = valAt(node, tt);
          acc = acc === null ? v : VM.add(acc, v);
        }
        return VM.div(acc, n);
      };
      case 'wiggle': return (freq, amp, octaves = 1, ampMult = 0.5, t = curT()) => wiggle(node, freq, amp, octaves, ampMult, t);
      case 'temporalWiggle': return (freq, amp, octaves = 1, ampMult = 0.5, t = curT()) => wiggle(node, freq, amp, octaves, ampMult, t);
      case 'loopOut': return (type = 'cycle', n = 0) => loop(node, true, type, n, null);
      case 'loopIn': return (type = 'cycle', n = 0) => loop(node, false, type, n, null);
      case 'loopOutDuration': return (type = 'cycle', d = 0) => loop(node, true, type, 0, d);
      case 'loopInDuration': return (type = 'cycle', d = 0) => loop(node, false, type, 0, d);
      case 'propertyIndex': { const m = E.meta(node); return m ? m.idx + 1 : 0; }
      case 'propertyGroup': return (n = 1) => {
        let cur = node;
        for (let i = 0; i < n; i++) { const m = E.meta(cur); if (!m || !m.parent) return null; cur = m.parent; }
        if (cur.matchName === '' && cur.children) return layerObj(E.meta(node).layer);
        return wrap(cur);
      };
      case 'isModified': return true;
      case 'canSetExpression': return true;
      case 'expressionEnabled': return !!(node.expression && node.expressionEnabled);
      case 'expression': return node.expression || '';
      case 'dimensionsSeparated': return !!node.dimensionsSeparated;
      case 'propertyType': return 'PROPERTY';
      case 'style': return node.valueType === 'TEXT_DOCUMENT' ? styleObj(valAt(node, t0) || {}) : NOT_HANDLED;
      case 'points': return () => (shapeOf(node) || { vertices: [] }).vertices.map((v) => v.slice());
      case 'inTangents': return () => (shapeOf(node) || { inTangents: [] }).inTangents.map((v) => v.slice());
      case 'outTangents': return () => (shapeOf(node) || { outTangents: [] }).outTangents.map((v) => v.slice());
      case 'isClosed': return () => !!(shapeOf(node) || {}).closed;
      case 'posterizeTime': return NOT_HANDLED;
      default: return NOT_HANDLED;
    }
  }

  // PropObj `value` must be reachable through __get too
  const origGet = PropObj.prototype.__get;
  PropObj.prototype.__get = function (key) {
    if (key === 'value') return this.value;
    return origGet.call(this, key);
  };

  function wiggle(node, freq, amp, octaves, ampMult, t) {
    const v = valAt(node, t);
    const m = E.meta(node);
    const seed = ((m ? m.hash : 0) % 9973) / 97;
    const f = (d, base) => {
      let sum = 0, a = 1, fr = freq;
      for (let o = 0; o < octaves; o++) {
        sum += a * VM.perlin3(t * fr + 0.31, seed + d * 13.7 + o * 5.1, 0.5) * 1.6;
        a *= ampMult; fr *= 2;
      }
      return base + sum * amp;
    };
    if (isVec(v)) return v.map((x, d) => f(d, x));
    return f(0, v);
  }

  function loop(node, isOut, type, nKeys, duration) {
    const t = curT();
    const ks = E.keysOf(node);
    const base = (x) => baseAt(node, x);
    if (ks.length < 2) return base(t);
    let tFirst, tLast;
    if (isOut) {
      tLast = ks[ks.length - 1].time;
      if (duration != null && duration > 0) tFirst = Math.max(ks[0].time, tLast - duration);
      else tFirst = nKeys > 0 ? ks[Math.max(0, ks.length - nKeys)].time : ks[0].time;
      if (t <= tLast) return base(t);
    } else {
      tFirst = ks[0].time;
      if (duration != null && duration > 0) tLast = Math.min(ks[ks.length - 1].time, tFirst + duration);
      else tLast = nKeys > 0 ? ks[Math.min(ks.length - 1, nKeys)].time : ks[ks.length - 1].time;
      if (t >= tFirst) return base(t);
    }
    const D = tLast - tFirst;
    if (!(D > 0)) return base(t);
    const mod = (a, b) => ((a % b) + b) % b;
    switch (String(type)) {
      case 'cycle': return base(tFirst + mod(t - tFirst, D));
      case 'pingpong': { const m = mod(t - tFirst, 2 * D); return base(m <= D ? tFirst + m : tFirst + 2 * D - m); }
      case 'offset': {
        const cycles = Math.floor((t - tFirst) / D);
        const v = base(tFirst + mod(t - tFirst, D));
        return VM.add(v, VM.mul(VM.sub(base(tLast), base(tFirst)), cycles));
      }
      case 'continue': {
        if (isOut) { const h = 1e-3; const v = base(tLast); const vel = VM.div(VM.sub(v, base(tLast - h)), h); return VM.add(v, VM.mul(vel, t - tLast)); }
        const h = 1e-3; const v = base(tFirst); const vel = VM.div(VM.sub(base(tFirst + h), v), h); return VM.add(v, VM.mul(vel, t - tFirst));
      }
      default: return base(t);
    }
  }

  // ------------------------------------------------------------ GroupObj
  function groupObj(node) {
    let g = groupCache.get(node);
    if (g) return g;
    g = function (key) {
      const c = E.findChild(node, key);
      if (!c) throw new Error(`Couldn't find "${key}" in ${node.name || node.matchName}`);
      return wrap(c);
    };
    g.__get = (key) => groupMember(node, key);
    mark(g);
    groupCache.set(node, g);
    return g;
  }
  function contentsOf(node) {
    if (node.matchName === 'ADBE Vector Group') return E.childByMatch(node, 'ADBE Vectors Group');
    return node;
  }
  function groupMember(node, key) {
    if (typeof key !== 'string') return NOT_HANDLED;
    switch (key) {
      case 'name': return node.name;
      case 'matchName': return node.matchName;
      case 'numProperties': return node.children.length;
      case 'active': case 'enabled': return node.enabled !== false;
      case 'propertyIndex': { const m = E.meta(node); return m ? m.idx + 1 : 0; }
      case 'propertyGroup': return (n = 1) => {
        let cur = node;
        for (let i = 0; i < n; i++) { const m = E.meta(cur); if (!m || !m.parent) return null; cur = m.parent; }
        if (cur.matchName === '' && cur.children) return layerObj(E.meta(node).layer);
        return wrap(cur);
      };
      case 'param': return (k) => groupObj(node)(k);
      case 'content': case 'contents': { const c = contentsOf(node); return c ? groupObj(c) : NOT_HANDLED; }
      case 'transform': if (node.matchName === 'ADBE Vector Group') return wrap(E.childByMatch(node, 'ADBE Vector Transform Group')); break;
      default:
    }
    const c = E.findChild(node, key);
    if (c) return wrap(c);
    if (node.matchName === 'ADBE Vector Group') { const c2 = E.findChild(contentsOf(node), key); if (c2) return wrap(c2); }
    return NOT_HANDLED;
  }

  // ---------------------------------------------------------- CompObj
  function compObj(crt) {
    let o = compCache.get(crt);
    if (o) return o;
    const c = crt.comp;
    const f = function (key) { return f.layer(key); };
    f.layer = (arg, rel) => {
      if (typeof arg === 'object' && arg && arg.__lrt) {
        const idx = arg.__lrt.layer.index + (rel || 0);
        return layerObj(crt.layers[idx - 1]);
      }
      if (typeof arg === 'number') { const l = crt.layers[arg - 1]; if (!l) throw new Error('layer index out of range'); return layerObj(l); }
      const l = crt.byName.get(String(arg));
      if (!l) throw new Error(`Layer named "${arg}" not found`);
      return layerObj(l);
    };
    f.layerByIndex = (i) => f.layer(i);
    f.layerByName = (n) => f.layer(n);
    f.marker = markerObj(c.markers || []);
    f.__get = (key) => {
      switch (key) {
        case 'name': return c.name;
        case 'width': return c.width;
        case 'height': return c.height;
        case 'duration': return c.duration;
        case 'frameDuration': return 1 / (c.frameRate || 30);
        case 'frameRate': return c.frameRate;
        case 'pixelAspect': return c.pixelAspect || 1;
        case 'bgColor': return [...(c.bgColor || [0, 0, 0]), 1];
        case 'displayStartTime': return c.displayStartTime || 0;
        case 'numLayers': return c.layers.length;
        case 'activeCamera': return null;
        case 'ntscDropFrame': return false;
        case 'shutterAngle': return 180;
        case 'shutterPhase': return 0;
        default: return NOT_HANDLED;
      }
    };
    mark(f);
    compCache.set(crt, f);
    return f;
  }

  function markerObj(list) {
    const mk = (m, i) => mark({ time: m.time || 0, duration: m.duration || 0, comment: m.comment || '', index: i, label: m.label || 0, value: m.comment || '' });
    return mark({
      numKeys: list.length,
      key: (i) => {
        if (typeof i === 'string') { const j = list.findIndex((m) => m.comment === i); if (j < 0) throw new Error('marker not found'); return mk(list[j], j + 1); }
        if (i < 1 || i > list.length) throw new RangeError('marker index out of range');
        return mk(list[i - 1], i);
      },
      nearestKey: (t) => {
        let bi = 0, bd = Infinity;
        list.forEach((m, i) => { const d = Math.abs((m.time || 0) - t); if (d < bd) { bd = d; bi = i; } });
        if (!list.length) throw new Error('no markers');
        return mk(list[bi], bi + 1);
      },
    });
  }

  // ---------------------------------------------------------- LayerObj
  const TF_KEYS = new Set(['position', 'anchorpoint', 'scale', 'rotation', 'opacity', 'orientation', 'xrotation', 'yrotation', 'zrotation', 'xposition', 'yposition', 'zposition']);
  function layerObj(lrt) {
    if (!lrt) return null;
    let o = layerCache.get(lrt);
    if (o) return o;
    const l = lrt.layer;
    const self = mark({ __lrt: lrt });
    const M = (t) => E.worldMatrix(lrt, t === undefined ? curT() : t);
    const pt = (m, p, vec) => {
      const x = p[0], y = p[1];
      const out = vec ? [m[0] * x + m[2] * y, m[1] * x + m[3] * y] : [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
      if (p.length > 2) out.push(p[2]);
      return out;
    };
    const inv = (m) => {
      const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
      return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
    };
    const is3 = () => !!(E.in3D && E.in3D(lrt));
    const tt = (t) => (t === undefined ? curT() : t);
    const toComp = (p, t) => (is3() ? E.toComp3(lrt, p, tt(t)) : pt(M(t), p, false)), fromComp = (p, t) => (is3() ? E.fromComp3(lrt, p, tt(t)) : pt(inv(M(t)), p, false));
    const toWorld = (p, t) => (is3() ? E.toWorld3(lrt, p, tt(t), false) : pt(M(t), p, false)), fromWorld = (p, t) => (is3() ? E.fromWorld3(lrt, p, tt(t), false) : pt(inv(M(t)), p, false));
    const fns = {
      toComp, toWorld, fromComp, fromWorld,
      toCompVec: (p, t) => pt(M(t), p, true), fromCompVec: (p, t) => pt(inv(M(t)), p, true),
      toWorldVec: (p, t) => (is3() ? E.toWorld3(lrt, p, tt(t), true) : pt(M(t), p, true)), fromWorldVec: (p, t) => (is3() ? E.fromWorld3(lrt, p, tt(t), true) : pt(inv(M(t)), p, true)),
      fromCompToSurface: fromComp,
      sourceTime: (t = curT()) => E.srcTimeOf(lrt, t),
      sourceRectAtTime: (t = curT(), ext = false) => sourceRect(lrt, t),
      effect: (key) => {
        const ep = E.childByMatch(lrt.root, 'ADBE Effect Parade');
        const c = ep && E.findChild(ep, key);
        if (!c) throw new Error(`Effect "${key}" not found on layer "${l.name}"`);
        return groupObj(c);
      },
      mask: (key) => {
        const mp = E.childByMatch(lrt.root, 'ADBE Mask Parade');
        const c = mp && E.findChild(mp, key);
        if (!c) throw new Error(`Mask "${key}" not found`);
        return groupObj(c);
      },
      content: (key) => {
        const rv = E.childByMatch(lrt.root, 'ADBE Root Vectors Group');
        const c = rv && E.findChild(rv, key);
        if (!c) throw new Error(`Content "${key}" not found`);
        return groupObj(c);
      },
      sampleImage: () => [0, 0, 0, 0],
      propertyGroup: () => null,
    };
    self.__get = (key) => {
      if (typeof key !== 'string') return NOT_HANDLED;
      if (fns[key]) return fns[key];
      const nk = key.toLowerCase();
      if (TF_KEYS.has(nk) && lrt.tf.group) {
        const c = E.findChild(lrt.tf.group, key);
        if (c) return wrap(c);
      }
      switch (key) {
        case 'name': return l.name;
        case 'index': return l.index;
        case 'width': return E.footageSizeOf(lrt).width || l.width;
        case 'height': return E.footageSizeOf(lrt).height || l.height;
        case 'startTime': return l.startTime;
        case 'inPoint': return l.inPoint;
        case 'outPoint': return l.outPoint;
        case 'stretch': return l.stretch;
        case 'active': return l.enabled && curT() >= l.inPoint && curT() < l.outPoint;
        case 'enabled': return !!l.enabled;
        case 'audioActive': return false;
        case 'hasVideo': return true;
        case 'hasAudio': return false;
        case 'hasParent': return l.parentId != null && lrt.comp.byId.has(l.parentId);
        case 'parent': return l.parentId != null ? layerObj(lrt.comp.byId.get(l.parentId)) : null;
        case 'hasTrackMatte': return !!l.trackMatteType && l.trackMatteType !== 'NO_TRACK_MATTE';
        case 'isTrackMatte': return false;
        case 'transform': return lrt.tf.group ? groupObj(lrt.tf.group) : NOT_HANDLED;
        case 'text': { const tp = E.childByMatch(lrt.root, 'ADBE Text Properties'); return tp ? groupObj(tp) : NOT_HANDLED; }
        case 'marker': return markerObj((E.keysOf(E.childByMatch(lrt.root, 'ADBE Marker') || { keyframes: [] })).map((k) => ({ time: k.time, duration: (k.value && k.value.duration) || 0, comment: (k.value && k.value.comment) || '' })));
        case 'timeRemap': { const n = E.childByMatch(lrt.root, 'ADBE Time Remapping'); return n ? propObj(n) : NOT_HANDLED; }
        case 'source':
          if (l.sourceKind === 'comp') return compObj(E.compsById.get(l.sourceId));
          return footageObj(E.footageById.get(l.sourceId));
        case 'cameraOption': case 'lightOption': case 'materialOption': case 'geometryOption': return NOT_HANDLED;
        case 'threeDLayer': return !!l.threeD;
        case 'locked': return !!l.locked;
        case 'shy': return !!l.shy;
        case 'solo': return !!l.solo;
        case 'nullLayer': return !!l.nullLayer;
        case 'adjustmentLayer': return !!l.adjustmentLayer;
        default: {
          const g = lrt.root;
          const c = E.findChild(g, key);
          return c ? wrap(c) : NOT_HANDLED;
        }
      }
    };
    layerCache.set(lrt, self);
    return self;
  }

  function footageObj(f) {
    if (!f) return null;
    return mark({
      name: f.name, width: f.width, height: f.height, duration: f.duration, frameDuration: f.frameRate ? 1 / f.frameRate : 0, hasVideo: f.hasVideo, hasAudio: f.hasAudio,
      sourceText: '', sourceData: null,
    });
  }

  function sourceRect(lrt, t) {
    const l = lrt.layer;
    if (l.type === 'text') {
      const tp = E.childByMatch(lrt.root, 'ADBE Text Properties');
      const dn = tp && E.childByMatch(tp, 'ADBE Text Document');
      const doc = (dn && E.evalProp(dn, t)) || {};
      const m = E.measureText(doc);
      const j = String(doc.justification || 'LEFT_JUSTIFY');
      const left = j.startsWith('CENTER') ? -m.width / 2 : j.startsWith('RIGHT') ? -m.width : 0;
      return { top: -(m.ascent || (doc.fontSize || 12) * 0.8), left, width: m.width, height: m.height };
    }
    if (l.type === 'shape') return E.shapeBounds(lrt, t);
    const d = E.footageSizeOf(lrt);
    return { top: 0, left: 0, width: d.width || l.width, height: d.height || l.height };
  }

  // -------------------------------------------------------------- host
  function makeHost(node, lrt, t, base) {
    const st = { t, pt: null, rng: null, rngSeed: 0 };
    const meta = E.meta(node);
    const nodeHash = meta ? meta.hash : 0;
    const timeNow = () => (st.pt !== null ? st.pt : t);
    const layer = lrt ? layerObj(lrt) : null;
    const thisProp = propObj(node);
    const rng = () => {
      if (!st.rng) st.rng = new VM.Rng(VM.hashInts(nodeHash, lrt ? lrt.layer.id : 0, Math.round(timeNow() * 1000)));
      return st.rng;
    };
    const dyn = {
      time: () => timeNow(),
      value: () => (st.pt !== null ? baseAt(node, st.pt) : node.valueType === 'TEXT_DOCUMENT' ? (base && base.text !== undefined ? String(base.text) : '') : cp(base)),
      index: () => (lrt ? lrt.layer.index : 0),
      thisLayer: () => layer, thisComp: () => (lrt ? compObj(lrt.comp) : null), thisProperty: () => thisProp,
      thisProject: () => PROJECT, colorDepth: () => 8,
      comp: () => (name) => {
        const c = typeof name === 'string' ? E.compsByName.get(name) : null;
        if (!c) throw new Error(`Comp "${name}" not found`);
        return compObj(c);
      },
      footage: () => (name) => {
        const f = E.footageByName.get(name);
        if (!f) throw new Error(`Footage "${name}" not found`);
        return footageObj(f);
      },
      random: () => (a, b) => VM.randomRange(rng(), a, b),
      gaussRandom: () => (a, b) => VM.gaussRandom(rng(), a, b),
      seedRandom: () => (seed, timeless = false) => {
        st.rng = new VM.Rng(VM.hashInts(Math.floor(Number(seed) * 1000) || 0, timeless ? 0 : Math.round(timeNow() * 1000), 7));
        return undefined;
      },
      posterizeTime: () => (fps) => {
        st.pt = Math.floor(t * fps + 1e-6) / fps;
        E.exprTime = st.pt;
        return undefined;
      },
      timeToFrames: () => (tt = timeNow(), fps = lrt ? 1 / (1 / (lrt.comp.comp.frameRate || 30)) : 30, isDur = false) => VM.timeToFrames(tt, fps, isDur),
      timeToTimecode: () => (tt = timeNow(), base2 = 30, isDur) => VM.timeToTimecode(tt, base2, isDur),
      timeToNTSCTimecode: () => (tt = timeNow(), base2 = 30, isDur) => VM.timeToTimecode(tt, base2, isDur),
      timeToFeetAndFrames: () => (tt = timeNow(), fps, fpf) => VM.timeToFeetAndFrames(tt, fps, fpf),
      timeToCurrentFormat: () => (tt = timeNow(), fps, isDur) => VM.timeToTimecode(tt, fps || 30, isDur),
    };
    // property functions bound to thisProperty
    const PF = ['valueAtTime', 'velocity', 'velocityAtTime', 'speed', 'speedAtTime', 'smooth', 'wiggle', 'temporalWiggle', 'loopIn', 'loopOut', 'loopInDuration', 'loopOutDuration',
      'numKeys', 'key', 'nearestKey', 'propertyGroup', 'propertyIndex'];
    for (const k of PF) dyn[k] = () => propMethod(node, k);
    // properties that default time arg
    return {
      thisValue: layer,
      unwrap: (v) => (v !== null && typeof v === 'object' && v.__unwrapProp === true && v instanceof PropObj ? v.value : v),
      isHost: (o) => hosts.has(o),
      typeofValue: (v) => (v !== null && typeof v === 'object' && v instanceof PropObj ? v.value : v),
      lookup(name) {
        if (E.textVars && Object.prototype.hasOwnProperty.call(E.textVars, name)) return E.textVars[name]; // expression selector
        const d = dyn[name];
        if (d) return d();
        const s = STATICS[name];
        if (s !== undefined) return s;
        if (layer) {
          const r = layer.__get(name);
          if (r !== NOT_HANDLED) return r;
        }
        return NOT_HANDLED;
      },
    };
  }

  const PROJECT = mark({ fullPath: '', bitsPerChannel: 8, linearBlending: false, numItems: 0, toString() { return 'project'; } });

  return { makeHost, propObj, layerObj, compObj, wrap };
}
