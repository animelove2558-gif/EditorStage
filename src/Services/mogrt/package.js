import JSZip from 'jszip';

/**
 * Read a real Adobe .mogrt. Layout (verified against Premiere/After Effects exports):
 *   definition.json     - template metadata + Essential Graphics controls (clientControls)
 *   project.aegraphic   - a nested ZIP: <name>.aep (After Effects project), (Footage)/*, optional Fonts/
 *   thumb.png, thumb.mp4 - preview stills / Adobe-rendered preview video
 * (An older, non-Adobe layout used manifest.json + a Lottie file; that is detected and reported, not rendered.)
 */
export async function loadMogrtPackage(bytes) {
  const outer = await JSZip.loadAsync(bytes);
  const names = Object.keys(outer.files).filter((n) => !outer.files[n].dir);
  const get = (n) => outer.file(n);
  const defFile = get('definition.json');
  if (!defFile) {
    const legacy = get('manifest.json');
    throw new Error(legacy ? 'This .mogrt uses a manifest.json layout (not an Adobe motion graphics template)' : 'Not a valid .mogrt: definition.json is missing');
  }
  const definition = JSON.parse(stripBom(await defFile.async('string')));

  const pkg = { definition, aep: null, aepName: '', footage: new Map(), fonts: [], thumbPng: null, thumbMp4: null, files: names };
  const th = get('thumb.png'); if (th) pkg.thumbPng = await th.async('blob');
  const tv = get('thumb.mp4'); if (tv) pkg.thumbMp4 = await tv.async('blob');

  // project.aegraphic is itself a zip
  const ag = get('project.aegraphic') || outer.file(/\.aegraphic$/i)[0];
  if (ag) {
    const inner = await JSZip.loadAsync(await ag.async('uint8array'));
    for (const n of Object.keys(inner.files)) {
      const f = inner.files[n]; if (f.dir) continue;
      const lower = n.toLowerCase(); const base = n.split('/').pop();
      if (/\.aep$/.test(lower) && !pkg.aep) { pkg.aep = await f.async('uint8array'); pkg.aepName = base; }
      else if (/\.(ttf|otf|ttc|woff2?)$/.test(lower)) pkg.fonts.push({ name: base, data: await f.async('uint8array') });
      else if (!/\.(aep|aepx|json|xml|txt|ds_store|ini)$/.test(lower) && !/(^|\/)\._/.test(lower)) { // every packed media file ((Footage)/...)
        pkg.footage.set(base, { name: base, path: n, data: await f.async('uint8array') });
      }
    }
  }
  const info = definition.sourceInfoLocalized ? Object.values(definition.sourceInfoLocalized)[0] || {} : {};
  const num = (t) => (t && t.scale ? t.value / t.scale : 0);
  pkg.meta = {
    name: pick(definition.capsuleNameLocalized) || definition.capsuleName || 'Untitled Template',
    id: definition.capsuleID || '',
    width: info.framesize?.size?.x || 1920, height: info.framesize?.size?.y || 1080,
    duration: num(info.duration) || 5, inPoint: Math.max(0, num(info.workinpoint)), workOut: num(info.workoutpoint) || num(info.duration),
    compName: info.name || '', fps: info.framerate?.ticksperframe ? 254016000000 / info.framerate.ticksperframe : 30,
    hasAudio: !!info.hasaudio, usedFonts: Object.values(definition.usedFontsLocalized || {})[0] || [], usedEffects: definition.usedEffects || [],
    responsiveDesignVersion: String(definition.responsiveDesignVersion || '0'), author: definition.authorApp || '', description: definition.description || '',
  };
  return pkg;
}

const stripBom = (s) => s.replace(/^﻿/, '');
/** pick a localized string from {strDB:[{localeString,str}]} (en_US first, else first entry) */
export function pick(loc) {
  const db = loc?.strDB; if (!Array.isArray(db) || !db.length) return typeof loc === 'string' ? loc : '';
  return (db.find((x) => x.localeString === 'en_US') || db[0]).str ?? '';
}

// ---- Essential Graphics controls (definition.json clientControls) ----
// type codes observed in real templates: 1 checkbox, 2 slider, 4 color, 5 point, 6 source text (font/size/faux editing),
// 8 comment/note, 10 group (value = child ids), 14 media replacement. Unknown codes are kept as 'unknown'.
// 3 angle, 9 multi-dimensional (3D point), 13 dropdown (menu), 11/12 scalar variants are decoded from the value shape.
const TYPES = { 1: 'checkbox', 2: 'slider', 3: 'angle', 4: 'color', 5: 'point', 6: 'text', 8: 'comment', 9: 'point3d', 10: 'group', 13: 'dropdown', 14: 'media' };
const inferType = (v) => (typeof v === 'boolean' ? 'checkbox' : typeof v === 'number' ? 'slider' : Array.isArray(v) ? (v.length >= 3 && v.length !== 4 ? 'point3d' : v.length === 4 ? 'color' : 'point') : v && typeof v === 'object' && 'x' in v ? ('z' in v ? 'point3d' : 'point') : 'unknown');
const menuItems = (c) => { const raw = c.menuItems || c.dropdownItems || c.dropDownItems || c.items || c.menu || c.options || []; return (Array.isArray(raw) ? raw : []).map((x) => (typeof x === 'string' ? x : pick(x) || x?.name || x?.str || String(x))); };

export function decodeControls(definition) {
  const list = (definition.clientControls || []).map((c) => {
    const type = TYPES[c.type] || inferType(c.value);
    const base = { id: c.id, code: c.type, type, name: pick(c.uiName) || '', suffix: pick(c.uiSuffix), tooltip: pick(c.uiToolTip), canAnimate: !!c.canAnimate, raw: c };
    if (type === 'checkbox') return { ...base, default: !!c.value };
    if (type === 'slider') return { ...base, default: +c.value || 0, min: c.min ?? 0, max: c.max ?? 100 };
    if (type === 'color') return { ...base, default: Array.isArray(c.value) ? c.value : [1, 1, 1, 1] };
    if (type === 'point') return { ...base, default: Array.isArray(c.value) ? [c.value[0] ?? 0, c.value[1] ?? 0] : [c.value?.x ?? 0, c.value?.y ?? 0] };
    if (type === 'point3d') return { ...base, default: Array.isArray(c.value) ? [c.value[0] ?? 0, c.value[1] ?? 0, c.value[2] ?? 0] : [c.value?.x ?? 0, c.value?.y ?? 0, c.value?.z ?? 0] };
    if (type === 'angle') return { ...base, default: +c.value || 0 };
    if (type === 'dropdown') return { ...base, default: Number.isFinite(+c.value) ? +c.value : 1, items: menuItems(c) };
    if (type === 'text') return { ...base, default: pick(c.value), font: c.fonteditinfo || {}, name: base.name };
    if (type === 'comment') return { ...base, default: pick(c.value) };
    if (type === 'group') return { ...base, children: Array.isArray(c.value) ? c.value : [], expanded: c.groupexpanded !== false };
    if (type === 'media') return { ...base, default: null, width: c.width, height: c.height, thumbnail: c.thumbnail, start: c.starttime, end: c.endtime, timescale: c.timescale };
    return { ...base, default: c.value };
  });
  const byId = new Map(list.map((c) => [c.id, c]));
  const nested = new Set(list.flatMap((c) => c.children || []));
  const tree = list.filter((c) => !nested.has(c.id)).map((c) => (c.type === 'group' ? { ...c, items: c.children.map((id) => byId.get(id)).filter(Boolean) } : c));
  // nested groups
  const expand = (n) => (n.type === 'group' ? { ...n, items: (n.children || []).map((id) => byId.get(id)).filter(Boolean).map(expand) } : n);
  return { list, byId, tree: tree.map(expand) };
}
