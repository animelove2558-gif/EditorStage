// After Effects project (.aep) reader -> Scene JSON (docs/mogrt-scene-schema.md section 1 + "Reader additions").
// Pure ES module: Uint8Array / DataView / TextDecoder only. Port of py_aep (MIT) semantics.
//
//   import { parseAep } from './aep/index.js';
//   const scene = parseAep(new Uint8Array(buffer));
//
// Never throws on unknown chunks / properties (they are skipped); throws only if the input is not an RIFX file.
import { readRoot, findT, filterT, findL, filterL } from './chunks.js';
import { parseGroupChildren, layerTimebase } from './properties.js';
import { parseEffectDefs } from './effects.js';
import { synthesizeLayer } from './synth.js';

const BM = {
  0: 'NORMAL', 2: 'NORMAL', 3: 'DISSOLVE', 4: 'ADD', 5: 'MULTIPLY', 6: 'SCREEN', 7: 'OVERLAY', 8: 'SOFT_LIGHT', 9: 'HARD_LIGHT',
  10: 'DARKEN', 11: 'LIGHTEN', 12: 'CLASSIC_DIFFERENCE', 13: 'HUE', 14: 'SATURATION', 15: 'COLOR', 16: 'LUMINOSITY',
  17: 'STENCIL_ALPHA', 18: 'STENCIL_LUMA', 19: 'SILHOUETE_ALPHA', 20: 'SILHOUETTE_LUMA', 21: 'LUMINESCENT_PREMUL', 22: 'ALPHA_ADD',
  23: 'CLASSIC_COLOR_DODGE', 24: 'CLASSIC_COLOR_BURN', 25: 'EXCLUSION', 26: 'DIFFERENCE', 27: 'COLOR_DODGE', 28: 'COLOR_BURN',
  29: 'LINEAR_DODGE', 30: 'LINEAR_BURN', 31: 'LINEAR_LIGHT', 32: 'VIVID_LIGHT', 33: 'PIN_LIGHT', 34: 'HARD_MIX', 35: 'LIGHTER_COLOR',
  36: 'DARKER_COLOR', 37: 'SUBTRACT', 38: 'DIVIDE',
};
const MATTE = ['NO_TRACK_MATTE', 'ALPHA', 'ALPHA_INVERTED', 'LUMA', 'LUMA_INVERTED'];
const CTRL_TYPES = { 1: 'checkbox', 2: 'slider', 4: 'color', 5: 'point', 6: 'text', 8: 'comment', 9: 'multidim', 10: 'group', 13: 'dropdown', 14: 'media' };
const LAYER_TYPE = { 0: 'av', 1: 'light', 2: 'camera', 3: 'text', 4: 'shape', 5: '3dmodel', 7: 'mesh' };
const utf8 = new TextDecoder('utf-8');

const fin = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const div = (a, b) => (b === 0 ? null : fin(a / b));
function pyRound(x) {
  if (Math.abs(x % 1) === 0.5) return 2 * Math.round(x / 2);
  return Math.round(x);
}
const str0 = (s) => { const i = s.indexOf('\0'); return i >= 0 ? s.slice(0, i) : s; };
const firstUtf8 = (kids) => { const c = findT(kids, 'Utf8'); return c ? str0(c.text()) : ''; };
const lastSlash = (p) => Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
const basename = (p) => p.slice(lastSlash(p) + 1);
function cstr(c, off, len) {
  const u8 = c.src.u8;
  let e = c.start + off;
  const lim = Math.min(c.end, c.start + off + len);
  const s = e;
  while (e < lim && u8[e] !== 0) e++;
  return utf8.decode(u8.subarray(s, e));
}

// ------------------------------------------------------------------ footage sources

function parseSource(pin) {
  const kids = pin.kids;
  const sspc = findT(kids, 'sspc');
  const opti = findT(kids, 'opti');
  if (!sspc) return null;
  let kind = 'file';
  let assetType = '';
  let assetInt = 0;
  if (opti && opti.len >= 6) {
    const u8 = opti.src.u8;
    let e = 0;
    while (e < 4 && u8[opti.start + e] !== 0) e++;
    assetType = String.fromCharCode(...u8.subarray(opti.start, opti.start + e));
    assetInt = opti.u2(4);
  }
  if (!assetType && assetInt === 2 && opti && opti.len >= 10 + 1) kind = 'placeholder';
  else if (assetType.startsWith('Soli')) kind = 'solid';
  const s = {
    kind, pin, sspc, opti,
    width: sspc.u2(32), height: sspc.u2(36),
    durDiv: sspc.u4(38), durDivisor: sspc.u4(42),
    native: sspc.u4(56) + sspc.u2(60) / 65536,
    conform: sspc.u2(148) + sspc.u2(150) / 65536,
    pulldown: sspc.u1(147),
    loop: sspc.u4(126),
    audioRate: sspc.len >= 168 ? sspc.f8(160) : 0,
  };
  const dur = s.durDivisor === 0 ? 0 : s.durDiv / s.durDivisor;
  s.stillDur = dur;
  if (s.conform === 0) s.duration = dur * s.loop;
  else s.duration = (pyRound(dur * s.native) / s.conform) * s.loop;
  s.frameRate = (s.conform !== 0 ? s.conform : s.native) * (s.pulldown !== 0 ? 0.8 : 1);
  s.hasAudio = s.audioRate > 0;
  s.isStill = dur === 0;
  if (kind === 'solid' && opti) {
    s.color = [opti.f4(14), opti.f4(18), opti.f4(22)];
    s.name = cstr(opti, 26, 256);
  } else if (kind === 'placeholder' && opti) {
    s.name = cstr(opti, 10, 256);
  } else {
    let full = '';
    let isFolder = false;
    const als2 = findL(kids, 'Als2');
    if (als2) {
      const alas = findT(als2.kids, 'alas');
      if (alas) {
        try {
          const j = JSON.parse(alas.text());
          if (j && typeof j === 'object') { full = j.fullpath || ''; isFolder = !!j.target_is_folder; }
        } catch (e) { /* ignore */ }
      }
    }
    const stvc = findL(kids, 'StVc');
    const names = stvc ? filterT(stvc.kids, 'Utf8').map((c) => str0(c.text())) : [];
    if (names.length) {
      const sep = full.includes('\\') ? '\\' : '/';
      full = full ? (full.endsWith(sep) ? full : full + sep) + names[0] : names[0];
    }
    s.file = full;
    s.isFolder = isFolder;
  }
  return s;
}

function footageName(rawName, src) {
  if (src.kind === 'solid' || src.kind === 'placeholder') return src.name || '';
  if (rawName) return rawName;
  return basename(src.file || '');
}

// ------------------------------------------------------------------ essential graphics

function rawCtl(cctl) {
  const kids = cctl.kids;
  const utf8s = [];
  const byType = {};
  for (const k of kids) {
    if (k.isList) continue;
    if (k.type === 'Utf8') utf8s.push(str0(k.text()));
    else if (!(k.type in byType)) byType[k.type] = k;
  }
  const ctyp = byType.CTyp ? byType.CTyp.u4(0) : null;
  const dec = (c) => {
    if (!c) return null;
    const n = c.len;
    if (ctyp === 1) return n ? !!c.u1(0) : null;
    if (ctyp === 4 && n === 16) return [c.f4(0), c.f4(4), c.f4(8), c.f4(12)];
    if (n % 8 === 0 && n >= 8) {
      const v = [];
      for (let i = 0; i < n / 8; i++) v.push(c.f8(i * 8));
      return v.length === 1 ? v[0] : v;
    }
    return null;
  };
  const out = { ctyp, utf8s, value: dec(byType.CVal), default: dec(byType.CDef), min: dec(byType.Smin), max: dec(byType.Smax) };
  if (ctyp === 6 && utf8s.length >= 2) {
    out.value = utf8s[1];
    out.default = utf8s.length > 2 ? utf8s[2] : utf8s[1];
  }
  return out;
}

const effectNodes = new WeakSet();

function findChildByMatchName(group, mn) {
  for (const c of group.children) if (c.matchName === mn) return c;
  return null;
}

function walkPath(layerNode, refs, effectDefs) {
  let cur = layerNode;
  const path = [];
  for (const ref of refs) {
    if (!cur || cur.kind !== 'group') return null;
    let child = null;
    if (ref.index !== null && ref.index !== undefined) {
      if (effectNodes.has(cur)) {
        const defs = effectDefs.get(cur.matchName);
        if (defs) {
          const keys = [...defs.keys()];
          const pos = ref.index - 1;
          if (pos >= 0 && pos < keys.length && keys[pos] === ref.matchName) child = findChildByMatchName(cur, ref.matchName);
        }
      } else if (cur.groupType === 'indexed') {
        const c = cur.children[ref.index];
        if (c && c.matchName === ref.matchName) child = c;
      }
    }
    if (!child) child = findChildByMatchName(cur, ref.matchName);
    if (!child) return null;
    path.push(cur.groupType === 'indexed' ? cur.children.indexOf(child) : child.matchName);
    cur = child;
  }
  return { node: cur, path };
}

function parseControllers(itemKids, layerById, effectDefs) {
  let cif = null;
  for (const lt of ['CIF3', 'CIF2', 'CIFO']) { cif = findL(itemKids, lt); if (cif) break; }
  if (!cif) return [];
  const out = [];
  let groupName = null;
  for (const cctl of filterL(cif.kids, 'CCtl')) {
    try {
      const cps2 = findL(cctl.kids, 'CpS2');
      const nameC = cps2 ? findT(cps2.kids, 'Utf8') : null;
      const ctypC = findT(cctl.kids, 'CTyp');
      const ct = ctypC ? ctypC.u4(0) : null;
      const uu = findT(cctl.kids, 'Utf8');
      let refs = [];
      let layerId = null;
      const cprp = findL(cctl.kids, 'CPrp');
      if (cprp) {
        const pu = findT(cprp.kids, 'Utf8');
        if (pu) {
          try {
            const nodes = JSON.parse(pu.text());
            refs = Object.keys(nodes).sort((a, b) => Number(a) - Number(b)).map((k) => {
              const n = nodes[k];
              return { matchName: n.matchName || '', index: n.index === 0xFFFFFFFF || n.index === undefined ? null : n.index };
            });
          } catch (e) { refs = []; }
        }
        const clid = findT(cprp.kids, 'CLId');
        if (clid) layerId = clid.u4(0);
      }
      const rv = rawCtl(cctl);
      const d = {
        uuid: uu ? str0(uu.text()) : '',
        name: nameC ? str0(nameC.text()) : '',
        type: CTRL_TYPES[ct] || `type${ct}`,
        controllerType: ct,
        layerId,
        propertyPath: null,
        defaultValue: rv.default,
        value: rv.value,
      };
      if (rv.min !== null) d.min = rv.min;
      if (rv.max !== null) d.max = rv.max;
      if (ct === 10) groupName = d.name;
      else if (groupName !== null) d.groupName = groupName;
      const layer = layerId !== null ? layerById.get(layerId) : null;
      if (layer && refs.length) {
        const w = walkPath(layer.rootNode, refs, effectDefs);
        if (w) {
          d.propertyPath = w.path;
          if (w.node.kind === 'prop' && w.node.dropdownItems) d.dropdownItems = w.node.dropdownItems.slice();
        }
      } else if (layer && ct === 14) {
        d.propertyPath = ['ADBE Source Options Group', 'ADBE Layer Source Alternate'];
      }
      d.sourcePath = refs.map((r) => ({ matchName: r.matchName, index: r.index }));
      out.push(d);
    } catch (e) { /* skip controller */ }
  }
  return out;
}

// ------------------------------------------------------------------ layers

function parseOvg2(tdgp) {
  const out = [];
  for (const ov of filterL(tdgp.kids, 'OvG2')) {
    for (const cp of filterL(ov.kids, 'CPrp')) {
      const u = findT(cp.kids, 'Utf8');
      if (u) out.push(str0(u.text()));
    }
  }
  return out;
}

function markerOut(m) {
  return { time: m.time === undefined ? null : m.time, protectedRegion: !!m.protectedRegion, duration: fin(m.duration), comment: m.comment, label: m.label };
}

/** Build a layer from a Layr / SecL list. Returns { layer, ldta, rootNode } */
function buildLayer(layrChunk, comp, project, warnings) {
  const kids = layrChunk.kids;
  const ldta = findT(kids, 'ldta');
  if (!ldta) return null;
  const lname = firstUtf8(kids);
  const ltype = ldta.u1(131);
  const isAV = ltype !== 1 && ltype !== 2;
  const f1 = ldta.u1(38);
  const f0 = ldta.u1(37);
  const f2 = ldta.u1(39);
  const sourceId = ldta.u4(40);
  const src = isAV && sourceId ? project.items.get(sourceId) || null : null;
  const stretchDiv = ldta.s4(8);
  const stretchDivisor = ldta.u4(108);
  const stretch = stretchDivisor === 0 ? 0 : (stretchDiv * 100) / stretchDivisor;
  const factor = stretch !== 0 ? stretch / 100 : 1;
  const startTime = div(ldta.s4(12), ldta.u4(16));
  const rawIn = div(ldta.s4(20), ldta.u4(24));
  const rawOut = div(ldta.s4(28), ldta.u4(32));
  const timeOrigin = (startTime === null ? 0 : startTime) + (factor < 0 ? factor / 3000 : 0);
  const width = src ? src.width : isAV ? comp.width : 0;
  const height = src ? src.height : isAV ? comp.height : 0;

  const L = {
    comp,
    width: isAV ? width : 0,
    height: isAV ? height : 0,
    hasSource: !!src,
    threeD: isAV ? !!(f1 & 0x04) : false,
    timebase: layerTimebase(comp.internalTimebase, factor),
    timeStretch: factor,
    timeOrigin,
    maskScale: src ? [src.width, src.height] : [1, 1],
    usedFonts: project.usedFonts,
    warnings,
  };
  const root = findL(kids, 'tdgp');
  let properties = [];
  if (root) {
    try { properties = parseGroupChildren(root, L, { parentMN: 'LAYER' }); } catch (e) { warnings.push(`layer ${ldta.u4(0)}: ${e && e.message}`); }
  }
  try {
    properties = synthesizeLayer(properties, {
      kind: LAYER_TYPE[ltype] || 'av', nullLayer: !!(f1 & 0x80), threeD: isAV && !!(f1 & 0x04), aeMajor: project.aeMajor,
      compW: comp.width, compH: comp.height, layerW: width, layerH: height,
    });
  } catch (e) { warnings.push(`synth layer ${ldta.u4(0)}: ${e && e.message}`); }
  for (const g of walkEffects(properties)) effectNodes.add(g);

  const timeRemap = properties.find((p) => p.matchName === 'ADBE Time Remapping');
  const timeRemapEnabled = isAV && !!(timeRemap && timeRemap.kind === 'prop' && timeRemap.keyframes.length > 0);

  // in/out points (AVLayer clamps to the source for non-still, non-remapped footage)
  let inPoint = rawIn === null ? null : timeOrigin + rawIn * factor;
  let outPoint = rawOut === null ? null : timeOrigin + rawOut * factor;
  if (isAV && src) {
    const clamp = !(src.kind === 'footage' && src.isStill) && !timeRemapEnabled && src.duration > 0 && stretch >= 0;
    if (clamp) {
      if (inPoint !== null && startTime !== null) inPoint = Math.max(inPoint, startTime);
      if (outPoint !== null && startTime !== null) outPoint = Math.min(outPoint, startTime + src.duration * factor);
    }
  }

  let autoOrient = 'NO_AUTO_ORIENT';
  const three = !!(f1 & 0x04);
  if (f1 & 0x01) autoOrient = 'ALONG_PATH';
  else if (((f1 & 0x20) || (f1 & 0x40)) && three) autoOrient = 'CAMERA_OR_POINT_OF_INTEREST';
  else if ((f0 & 0x10) && (f0 & 0x08)) autoOrient = 'CHARACTERS_TOWARD_CAMERA';

  let blend = 'NORMAL';
  let matte = 'NO_TRACK_MATTE';
  let matteId = null;
  if (isAV) {
    blend = BM[ldta.u1(99)] || 'NORMAL';
    if (blend === 'DISSOLVE' && (ldta.u1(103) & 2)) blend = 'DANCING_DISSOLVE';
    matte = MATTE[ldta.u1(107)] || 'NO_TRACK_MATTE';
    if (ldta.len >= 164) matteId = ldta.u4(160) || null;
  }
  const parentRaw = ldta.u4(132);

  const layer = {
    id: ldta.u4(0),
    index: 0,
    name: lname || (src ? src.name : ''),
    type: LAYER_TYPE[ltype] || 'av',
    sourceId: src ? src.id : null,
    sourceKind: src ? (src.isComp ? 'comp' : 'footage') : null,
    width: isAV ? width : 0,
    height: isAV ? height : 0,
    inPoint: fin(inPoint),
    outPoint: fin(outPoint),
    startTime: startTime,
    stretch: fin(stretch),
    parentId: parentRaw || null,
    enabled: !!(f2 & 0x01),
    solo: !!(f1 & 0x08),
    shy: !!(f2 & 0x40),
    locked: !!(f2 & 0x20),
    nullLayer: !!(f1 & 0x80),
    adjustmentLayer: isAV && !!(f1 & 0x02),
    threeD: isAV && three,
    collapseTransformation: isAV && !!(f2 & 0x80),
    guideLayer: isAV && !!(f0 & 0x02),
    motionBlur: isAV && !!(f2 & 0x08),
    timeRemapEnabled,
    autoOrient,
    blendMode: blend,
    trackMatteType: matte,
    matteLayerId: matteId,
    essentialPropertyUuids: root ? parseOvg2(root) : [],
    properties,
  };
  const mk = properties.find((p) => p.matchName === 'ADBE Marker' && p.kind === 'prop');
  layer.markers = mk ? mk.keyframes.map((k) => { const v = k.value || {}; return markerOut({ ...v, time: k.time }); }) : [];
  if (ltype === 1) layer.lightType = ['PARALLEL', 'SPOT', 'POINT', 'AMBIENT', 'ENVIRONMENT'][ldta.u1(139)] || 'POINT'; // JS reader addition
  layer.rootNode = { kind: 'group', matchName: 'ROOT', children: properties, groupType: 'named' };
  return { layer, ldta };
}

function* walkEffects(nodes) {
  for (const n of nodes) {
    if (n.kind === 'group' && n.matchName === 'ADBE Effect Parade') for (const e of n.children) yield e;
  }
}

// ------------------------------------------------------------------ project walk

function collectItems(listKids, out) {
  for (const it of filterL(listKids, 'Item')) {
    const idta = findT(it.kids, 'idta');
    if (!idta) continue;
    const type = idta.u2(0);
    out.push({ chunk: it, type, id: idta.u4(16), idta });
    if (type === 1) {
      const sfdr = findL(it.kids, 'Sfdr');
      if (sfdr) collectItems(sfdr.kids, out);
    }
  }
}

function compMeta(rec) {
  const kids = rec.chunk.kids;
  const cdta = findT(kids, 'cdta');
  const name = firstUtf8(kids);
  const c = {
    id: rec.id, isComp: true, name, kind: 'comp', chunk: rec.chunk, kids, cdta,
    width: 0, height: 0, duration: 0, internalTimebase: 24576,
  };
  if (cdta && cdta.len >= 172) {
    c.width = cdta.u2(140);
    c.height = cdta.u2(142);
    c.internalTimebase = cdta.u4(8);
    c.duration = div(cdta.u4(44), cdta.u4(48)) || 0;
  }
  return c;
}

export function parseAep(bytes) {
  const root = readRoot(bytes);
  const rootKids = root.kids;
  const warnings = [];
  const project = { items: new Map(), effectDefs: new Map(), usedFonts: new Set(), warnings, aeMajor: 26 };
  const head = findT(rootKids, 'head');
  if (head && head.len >= 8) {
    const w = head.u4(4);
    project.aeMajor = ((w >>> 26) & 0x1f) * 8 + ((w >>> 19) & 0x07);
  }
  try { project.effectDefs = parseEffectDefs(rootKids); } catch (e) { warnings.push(`effectDefs: ${e && e.message}`); }

  const exen = findL(rootKids, 'ExEn');
  const scene = {
    version: 1,
    comps: [],
    footage: [],
    usedFonts: [],
    expressionEngine: exen ? firstUtf8(exen.kids) || 'extendscript' : 'extendscript',
  };

  const recs = [];
  const fold = findL(rootKids, 'Fold');
  if (fold) collectItems(fold.kids, recs);

  // pass 1: item metadata
  const footageOut = [];
  const comps = [];
  for (const rec of recs) {
    try {
      if (rec.type === 7) {
        const kids = rec.chunk.kids;
        const pins = filterL(kids, 'Pin ');
        const src = pins.length ? parseSource(pins[0]) : null;
        if (!src) continue;
        const rawName = firstUtf8(kids);
        const name = footageName(rawName, src);
        const item = {
          id: rec.id, isComp: false, kind: 'footage', name, width: src.width, height: src.height, duration: src.duration,
          isStill: src.isStill, src,
        };
        project.items.set(rec.id, item);
        const f = {
          id: rec.id, name, kind: src.kind, path: '', width: src.width, height: src.height,
          duration: fin(src.duration) ?? 0, frameRate: fin(src.frameRate) ?? 0,
          hasVideo: src.width > 0 && src.height > 0, hasAudio: src.hasAudio,
        };
        if (src.kind === 'file') f.path = src.file || '';
        if (src.kind === 'solid') f.color = src.color;
        footageOut.push(f);
      } else if (rec.type === 4) {
        const m = compMeta(rec);
        project.items.set(rec.id, m);
        comps.push(m);
      }
    } catch (e) { warnings.push(`item ${rec.id}: ${e && e.message}`); }
  }

  // pass 2: comps
  for (const m of comps) {
    try {
      scene.comps.push(buildComp(m, project, warnings));
    } catch (e) { warnings.push(`comp ${m.id}: ${e && e.message}`); }
  }
  scene.comps.sort((a, b) => a.id - b.id);
  footageOut.sort((a, b) => a.id - b.id);
  scene.footage = footageOut;
  scene.usedFonts = [...project.usedFonts].filter(Boolean).sort();
  Object.defineProperty(scene, '_warnings', { value: warnings, enumerable: false });
  return scene;
}

function buildComp(m, project, warnings) {
  const cdta = m.cdta;
  const kids = m.kids;
  const layrs = filterL(kids, 'Layr');
  const layerIdToIndex = new Map();
  layrs.forEach((l, i) => {
    const ld = findT(l.kids, 'ldta');
    if (ld) layerIdToIndex.set(ld.u4(0), i);
  });
  const comp = {
    id: m.id, width: m.width, height: m.height, internalTimebase: m.internalTimebase, project, layerIdToIndex,
  };
  const layers = [];
  const layerById = new Map();
  for (const l of layrs) {
    try {
      const b = buildLayer(l, comp, project, warnings);
      if (!b) continue;
      b.layer.index = layers.length + 1;
      layers.push(b.layer);
      layerById.set(b.layer.id, b.layer);
    } catch (e) { warnings.push(`layer in comp ${m.id}: ${e && e.message}`); }
  }
  for (const l of layers) {
    if (l.parentId !== null && !layerById.has(l.parentId)) l.parentId = null;
  }
  let markers = [];
  const secl = findL(kids, 'SecL');
  if (secl) {
    try {
      const b = buildLayer(secl, comp, project, warnings);
      if (b) markers = b.layer.markers;
    } catch (e) { warnings.push(`markers comp ${m.id}: ${e && e.message}`); }
  }
  const out = {
    id: m.id, name: m.name, width: m.width, height: m.height,
    pixelAspect: null, frameRate: null, duration: null, displayStartTime: null,
    bgColor: [0, 0, 0], workAreaStart: null, workAreaDuration: null,
  };
  if (cdta && cdta.len >= 172) {
    out.pixelAspect = div(cdta.u4(144), cdta.u4(148));
    out.frameRate = cdta.u2(156) + cdta.u2(158) / 65536;
    out.duration = div(cdta.u4(44), cdta.u4(48));
    out.displayStartTime = div(cdta.s4(164), cdta.u4(168));
    out.bgColor = [cdta.u1(52) / 255, cdta.u1(53) / 255, cdta.u1(54) / 255];
    const waStart = div(cdta.s4(28), cdta.u4(32));
    out.workAreaStart = waStart;
    if (cdta.u4(36) === 0xFFFFFFFF) out.workAreaDuration = out.duration === null || waStart === null ? null : fin(out.duration - waStart);
    else {
      const e = div(cdta.u4(36), cdta.u4(40));
      out.workAreaDuration = e === null || waStart === null ? null : fin(e - waStart);
    }
    // JS reader additions (motion blur settings)
    out.motionBlurEnabled = !!(cdta.u1(139) & 0x08);
    if (cdta.len >= 188) { out.shutterAngle = cdta.u2(174); out.shutterPhase = cdta.s4(180); }
    if (cdta.len >= 204) out.motionBlurSamples = cdta.s4(200);
  }
  out.layers = layers.map(({ rootNode, ...rest }) => rest);
  out.markers = markers;
  out.essentialControllers = parseControllers(kids, layerById, project.effectDefs);
  return out;
}

export default parseAep;

