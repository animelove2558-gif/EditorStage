// Effects: sspc (fnam + parT parameter definitions + tdgp values). Missing (default-valued) parameters are
// synthesised from the pard defaults like py_aep does (flagged synthetic:true).
import { findT, findL } from './chunks.js';
import { AUTO_NAMES } from './matchNames.js';
import { parseGroupChildren, matchNameRuns, PVT, CONTROL, SENTINEL, VT_OUT_PUBLIC } from './properties.js';

const PROPERTY_DEFAULTS = { 'ADBE Lumetri-0130': 27, 'ADBE Playgnd-0253': 0, 'ADBE Playgnd-0501': 0, '/fm_quality': 1 };
const ISSPATIAL_FIX = new Set(['ADBE Fill-0002', 'ADBE Shadow Color', 'ADBE HUE SATURATION-0003', 'ADBE CurvesCustom-0001', 'ADBE Easy Levels-0002', 'ADBE Easy Levels2-0002']);
const intify = (v) => (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) ? v : v);

function pardString(c) {
  const u8 = c.src.u8;
  let e = c.start + 16;
  const lim = c.start + 48;
  while (e < lim && u8[e] !== 0) e++;
  return new TextDecoder('utf-8').decode(u8.subarray(c.start + 16, e));
}

function parsePard(c) {
  const len = c.len;
  if (len < 16) return { ctrl: 15, name: '', canVary: true, exprDisabled: false, pvt: PVT.NO_VALUE };
  const ctrl = c.u1(15);
  const d = { ctrl, name: len >= 48 ? pardString(c) : '', canVary: len > 51 ? !(c.u1(51) & 2) : true, exprDisabled: len > 6 ? !!(c.u1(6) & 2) : false };
  if (len < 56) return d;
  const fin = Number.isFinite;
  try {
    switch (ctrl) {
      case 3:
        d.last = c.s4(56) / 65536;
        if (len >= 64) d.default = intify(c.s4(60) / 65536);
        d.pvt = PVT.ONE;
        break;
      case 4:
        d.last = c.u4(56); d.default_value = c.u1(60); d.min = 0; d.max = 1;
        break;
      case 5:
        d.last = [c.u1(57) / 255, c.u1(58) / 255, c.u1(59) / 255, c.u1(56) / 255];
        d.default_value = [c.u1(61) / 255, c.u1(62) / 255, c.u1(63) / 255, c.u1(60) / 255];
        d.min = -3921568.62745098; d.max = 3921568.62745098; d.pvt = PVT.COLOR;
        break;
      case 7:
        d.last = c.u4(56); d.nb = c.src.dv.getInt16(c.start + 60, false); d.default_value = c.src.dv.getInt16(c.start + 62, false);
        d.min = 1; d.max = d.nb;
        break;
      case 1:
        d.last = c.s4(56); d.min = c.s4(124); d.max = c.s4(128);
        if (len >= 144) d.default = c.s4(140);
        break;
      case 2:
        d.last = c.s4(56) / 65536;
        if (len >= 144) d.default = intify(c.s4(140) / 65536);
        d.min = intify(c.s4(124) / 65536); d.max = intify(c.s4(128) / 65536);
        break;
      case 10: {
        d.last = c.f8(56);
        const vmin = c.f4(104), vmax = c.f4(108);
        if (len >= 124) { const df = c.f4(120); if (fin(df)) d.default = intify(df); }
        if (fin(vmin)) d.min = intify(vmin);
        if (fin(vmax)) d.max = intify(vmax);
        if (len >= 128 && (c.u2(126) & 1)) d.units = 'percent';
        break;
      }
      case 18:
        d.default_value = [c.f8(80), c.f8(88), c.f8(96)]; d.pvt = PVT.THREE_SP;
        break;
      case 6:
        d.default_value = [c.s4(68) / 65536, c.s4(72) / 65536]; d.pvt = PVT.TWO_SP;
        break;
      case 0: d.pvt = PVT.LAYER_INDEX; d.default_value = 0; break;
      case 12: d.pvt = PVT.MASK_INDEX; d.default_value = 0; break;
      case 11: d.pvt = PVT.CUSTOM; break;
      case 13: case 15: case 14: case 9: d.pvt = PVT.NO_VALUE; break;
      default: break;
    }
  } catch (e) { /* short pard: keep what we have */ }
  return d;
}

/** parT -> Map(matchName -> def) in file order (first entry = group header, skipped). */
export function parseParamDefs(sspcKids) {
  const defs = new Map();
  const part = findL(sspcKids, 'parT');
  if (!part) return defs;
  const merged = new Map();
  for (const run of matchNameRuns(part)) {
    if (!merged.has(run.mn)) merged.set(run.mn, []);
    merged.get(run.mn).push(...run.chunks);
  }
  let idx = 0;
  for (const [mn, chunks] of merged) {
    if (idx++ === 0) continue;
    const pard = chunks.find((c) => c.type === 'pard');
    if (!pard) continue;
    const d = parsePard(pard);
    const pdnm = chunks.find((c) => c.type === 'pdnm');
    if (pdnm) {
      const s = pdnm.containerString();
      if (d.ctrl === 7) d.items = s.split('|');
      else if (s) d.name = s;
    }
    defs.set(mn, d);
  }
  return defs;
}

export function parseEffectDefs(rootKids) {
  const out = new Map();
  const efdg = findL(rootKids, 'EfdG');
  if (!efdg) return out;
  for (const efdf of efdg.kids) {
    if (!efdf.isList || efdf.listType !== 'EfDf') continue;
    try {
      const t = findT(efdf.kids, 'tdmn');
      const sspc = findL(efdf.kids, 'sspc');
      if (t && sspc) out.set(t.tdmn(), parseParamDefs(sspc.kids));
    } catch (e) { /* skip */ }
  }
  return out;
}

function synthesize(mn, d, L, pointSize) {
  const pvt = d.pvt || PVT.ONE;
  if (pvt === PVT.NO_VALUE) {
    return { kind: 'group', matchName: mn, name: typeof d.name === 'string' && d.name ? d.name : AUTO_NAMES[mn] || '', enabled: true, groupType: 'named', children: [], synthetic: true };
  }
  let value;
  if (d.ctrl === 7) {
    value = d.default_value;
    if (d.last !== undefined && d.last !== null && (value === undefined || value === null || d.last > (d.nb || 0))) value = d.last;
  } else if (d.ctrl === 6 || d.ctrl === 18) {
    value = d.default_value;
    if (Array.isArray(value) && value.length >= 2) {
      const scale = [pointSize[0], pointSize[1], pointSize[1]];
      value = value.map((v, i) => (v / 100) * scale[i]);
    }
  } else {
    value = d.default_value;
    if (value === undefined || value === null) value = PROPERTY_DEFAULTS[mn];
    if (value === undefined || value === null) value = d.default;
    if (value === undefined || value === null) value = d.last;
  }
  const vt = VT_OUT_PUBLIC[pvt] || 'CUSTOM';
  const spatial = pvt === PVT.TWO_SP || pvt === PVT.THREE_SP || d.ctrl === 5 || ISSPATIAL_FIX.has(mn);
  const n = {
    kind: 'prop', matchName: mn, name: d.name || mn, enabled: true, valueType: vt, controlType: CONTROL[d.ctrl] || 'NO_CONTROL',
    dimensions: vt === 'COLOR' ? 4 : vt === 'THREE_D' ? 3 : vt === 'TWO_D' ? 2 : vt === 'ONE_D' || vt === 'LAYER_INDEX' || vt === 'MASK_INDEX' ? 1 : 0,
    isSpatial: spatial, value: value === undefined ? null : value, keyframes: [], expression: null, expressionEnabled: false, synthetic: true,
  };
  if (d.min !== undefined) n.min = d.min;
  if (d.max !== undefined) n.max = d.max;
  if (d.items) n.dropdownItems = d.items;
  return n;
}

export function parseEffect(sspc, mn, L) {
  const kids = sspc.kids;
  const fnamC = findT(kids, 'fnam');
  const tdgp = findL(kids, 'tdgp');
  const fnam = fnamC ? fnamC.containerString().split('\0')[0] : '';
  const proj = L.comp.project;
  let defs = new Map();
  try { defs = parseParamDefs(kids); } catch (e) { defs = new Map(); }
  if (!defs.size && proj.effectDefs.has(mn)) defs = proj.effectDefs.get(mn);
  if (defs.size && !proj.effectDefs.has(mn)) proj.effectDefs.set(mn, defs);
  const tdsb = tdgp ? findT(tdgp.kids, 'tdsb') : null;
  const tdsn = tdgp ? findT(tdgp.kids, 'tdsn') : null;
  const tdsnText = tdsn ? tdsn.containerString().split('\0')[0] : '';
  const node = {
    kind: 'group', matchName: mn,
    name: tdsnText && tdsnText !== SENTINEL ? tdsnText : fnam || AUTO_NAMES[mn] || mn,
    enabled: tdsb ? !!(tdsb.u1(3) & 1) : true,
    groupType: 'named',
    children: [],
  };
  const parsed = tdgp ? parseGroupChildren(tdgp, L, { skipZero: true, inEffect: true, defs }) : [];
  const byMn = new Map();
  for (const p of parsed) byMn.set(p.matchName, p);
  const pointSize = L.width && L.height ? [L.width, L.height] : [L.comp.width, L.comp.height];
  const ordered = [];
  for (const [pmn, d] of defs) {
    const ex = byMn.get(pmn);
    if (ex) ordered.push(ex);
    else if (pmn === 'ADBE Force CPU GPU') continue;
    else ordered.push(synthesize(pmn, d, L, pointSize));
  }
  for (const p of parsed) if (!defs.has(p.matchName)) ordered.push(p);
  let builtIn = ordered.find((c) => c.matchName === 'ADBE Effect Built In Params');
  if (!builtIn) {
    builtIn = { kind: 'group', matchName: 'ADBE Effect Built In Params', name: 'Compositing Options', enabled: true, groupType: 'named', children: [], synthetic: true };
    ordered.push(builtIn);
  }
  void builtIn; // its Masks / Effect Opacity / GPU Rendering children are added by synth.js (spec table)
  node.children = ordered;
  return node;
}
