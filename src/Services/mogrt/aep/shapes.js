// Shape paths (om-s / shap / shph / ldat), mask-path denormalisation and gradient XML (GCky).
import { findT, findL, filterL } from './chunks.js';

/**
 * Parse one `shap` list into an AE Shape object.
 * maskScale: [w,h] for mask paths (stored normalised to layer source size), null for shape-layer paths.
 * RotoBezier masks: stored tangents are reported (AE derives its own; approximate).
 */
export function parseShap(shap, maskScale) {
  const shph = findT(shap.kids, 'shph');
  if (!shph) return null;
  const list = findL(shap.kids, 'list');
  let pts = [];
  if (list) {
    const ldat = findT(list.kids, 'ldat');
    if (ldat) {
      const n = Math.floor(ldat.len / 8);
      pts = new Array(n);
      for (let i = 0; i < n; i++) pts[i] = [ldat.f4(i * 8), ldat.f4(i * 8 + 4)];
    }
  }
  const flags = shph.u1(3);
  const closed = !(flags & 0x08);
  const tlx = shph.f4(4), tly = shph.f4(8), brx = shph.f4(12), bry = shph.f4(16);
  const den = (p) => [tlx * (1 - p[0]) + brx * p[0], tly * (1 - p[1]) + bry * p[1]];
  const total = pts.length;
  const vertices = [], inT = [], outT = [];
  const sx = maskScale ? maskScale[0] : 1;
  const sy = maskScale ? maskScale[1] : 1;
  for (let i = 0; i < total; i += 3) {
    const v = den(pts[i]);
    const o = den(pts[(i + 1) % total]);
    const n = den(pts[((i - 1) % total + total) % total]);
    vertices.push([v[0] * sx, v[1] * sy]);
    outT.push([(o[0] - v[0]) * sx, (o[1] - v[1]) * sy]);
    inT.push([(n[0] - v[0]) * sx, (n[1] - v[1]) * sy]);
  }
  return { closed, vertices, inTangents: inT, outTangents: outT };
}

export function parseShapes(omsKids, maskScale) {
  const omks = findL(omsKids, 'omks');
  if (!omks) return null;
  return filterL(omks.kids, 'shap').map((s) => parseShap(s, maskScale));
}

// ---- gradient XML (prop.map / prop.list / prop.pair) ----

function parseXml(text) {
  // Minimal XML tokenizer sufficient for AE gradient documents.
  const re = /<(\/?)([A-Za-z0-9_.]+)([^>]*?)(\/?)>|([^<]+)/g;
  const root = { tag: '#root', children: [], text: '' };
  const stack = [root];
  let m;
  while ((m = re.exec(text))) {
    if (m[2] !== undefined) {
      if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
      const node = { tag: m[2], children: [], text: '' };
      stack[stack.length - 1].children.push(node);
      if (!m[4]) stack.push(node);
    } else if (m[5] !== undefined) {
      stack[stack.length - 1].text += m[5];
    }
  }
  return root;
}

function pairs(listNode) {
  const out = {};
  for (const pr of listNode.children) {
    if (pr.tag !== 'prop.pair') continue;
    const key = pr.children[0];
    const val = pr.children[1];
    if (!key || key.tag !== 'key' || !val) continue;
    out[key.text.trim()] = val;
  }
  return out;
}

function floats(arr) {
  const out = [];
  for (const c of arr.children) if (c.tag === 'float') { const f = parseFloat(c.text); if (!Number.isNaN(f)) out.push(f); }
  return out;
}

export function parseGradientXml(text) {
  if (!text) return null;
  let root;
  try { root = parseXml(text); } catch (e) { return null; }
  const map = root.children[0];
  if (!map) return null;
  const list = map.children.find((c) => c.tag === 'prop.list');
  if (!list) return null;
  const pr = pairs(list);
  const gd = pr['Gradient Color Data'];
  if (!gd) return null;
  const dp = pairs(gd);
  const stops = (node, key, need) => {
    const out = [];
    if (!node) return out;
    const sl = pairs(node)['Stops List'];
    if (!sl) return out;
    const sp = pairs(sl);
    const count = Object.keys(sp).length;
    for (let i = 0; i < count; i++) {
      const s = sp[`Stop-${i}`];
      if (!s) break;
      const arr = pairs(s)[key];
      if (!arr) continue;
      const f = floats(arr);
      if (f.length >= need) out.push(f);
    }
    return out;
  };
  const colorStops = stops(dp['Color Stops'], 'Stops Color', 5).map((f) => ({ position: f[0], midpoint: f[1], color: [f[2], f[3], f[4]] }));
  const alphaStops = stops(dp['Alpha Stops'], 'Stops Alpha', 3).map((f) => ({ position: f[0], midpoint: f[1], alpha: f[2] }));
  return { type: null, colorStops, alphaStops };
}
