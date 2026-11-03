// Paste Attributes / Remove Attributes (Premiere): the attributes of a clip that can be copied to other clips or reset, each
// one a checkbox in the dialogs. Effects are listed one by one ('fx:<index>'). Keyframe times can be scaled to the length of
// the clip they are pasted on ("Scale Attribute Times").

const has = (v) => v != null && !(Array.isArray(v) && !v.length);
/** fixed attributes: key, label, kind ('video' | 'audio'), fields of the clip it covers */
export const ATTRS = [
  { key: 'motion', label: 'Motion', kind: 'video', fields: ['motion'] },
  { key: 'opacity', label: 'Opacity', kind: 'video', fields: ['opacity', 'masks'] },
  { key: 'timeRemap', label: 'Time Remapping', kind: 'video', fields: ['timeRemap', 'speedCurve'] },
  { key: 'lumetri', label: 'Lumetri Color', kind: 'video', fields: ['lumetri', 'filter'] },
  { key: 'volume', label: 'Volume', kind: 'audio', fields: ['volume'] },
  { key: 'channel', label: 'Channel Volume', kind: 'audio', fields: ['audio'] },
  { key: 'pan', label: 'Panner', kind: 'audio', fields: ['pan'] },
];
const isAudioFx = (fx) => fx.category === 'Audio';

/** the attributes a clip has (not at their defaults): [{ key, label, kind }], effects as 'fx:<i>' with their names */
export function attrsOf(c) {
  const out = ATTRS.filter((a) => a.fields.some((f) => has(c[f]))).map(({ key, label, kind }) => ({ key, label, kind }));
  (c.effects || []).forEach((fx, i) => { if (fx.category !== 'Transition') out.push({ key: `fx:${i}`, label: fx.name, kind: isAudioFx(fx) ? 'audio' : 'video' }); });
  return out;
}

/** every keyframe time inside an attribute value multiplied by k (params are { v, keys: [{ t, ... }] }) */
export function scaleKeyTimes(v, k) {
  if (!v || typeof v !== 'object' || k === 1) return v;
  if (Array.isArray(v)) return v.map((x) => scaleKeyTimes(x, k));
  const out = {};
  for (const [n, x] of Object.entries(v)) out[n] = n === 'keys' && Array.isArray(x) ? x.map((q) => (q && typeof q.t === 'number' ? { ...q, t: q.t * k } : q)) : scaleKeyTimes(x, k);
  return out;
}

/** copy the chosen attributes of src onto dst (keys from attrsOf; scale = Scale Attribute Times). Effects are added after dst's own. */
export function pasteAttrs(src, dst, keys, scale = false) {
  const k = scale && src.dur > 0 ? dst.dur / src.dur : 1; const copy = (v) => scaleKeyTimes(structuredClone(v), k);
  for (const a of ATTRS) if (keys.includes(a.key)) for (const f of a.fields) { if (has(src[f])) dst[f] = copy(src[f]); else delete dst[f]; }
  const fx = keys.filter((x) => x.startsWith('fx:')).map((x) => src.effects?.[+x.slice(3)]).filter(Boolean);
  if (fx.length) dst.effects = [...(dst.effects || []), ...fx.map((e) => ({ ...copy(e), id: `${e.id || 'fx'}-${Math.random().toString(36).slice(2, 8)}` }))];
}

/** reset the chosen attributes of a clip (keys from attrsOf; 'fxn:<name>' removes every effect of that name) */
export function removeAttrs(c, keys) {
  for (const a of ATTRS) if (keys.includes(a.key)) for (const f of a.fields) delete c[f];
  const drop = new Set(keys.filter((x) => x.startsWith('fx:')).map((x) => +x.slice(3)));
  const names = new Set(keys.filter((x) => x.startsWith('fxn:')).map((x) => x.slice(4)));
  if (drop.size || names.size) c.effects = (c.effects || []).filter((fx, i) => fx.category === 'Transition' || (!drop.has(i) && !names.has(fx.name)));
}
/** Remove Attributes dialog rows for several clips: the fixed attributes any of them has, and each effect name once */
export function attrsOfMany(clips) {
  const out = new Map();
  for (const c of clips) for (const a of attrsOf(c)) { const key = a.key.startsWith('fx:') ? `fxn:${a.label}` : a.key; if (!out.has(key)) out.set(key, { ...a, key }); }
  return [...out.values()];
}
