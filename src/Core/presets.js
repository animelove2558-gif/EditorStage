// Effect presets (Effects panel > Presets): built-in presets (src/presets) and the user's own (userData/presets/*.json).
// A preset: { id, name, folder: [...], media: 'video'|'audio', type: 'anchorIn'|'anchorOut'|'scale', dur, tags, source, license,
//   effects?: [{ name, category, params: { id: value | { keys: [{ t, v, interp? }] } } }], motion?, opacity?, lumetri? (plain values),
//   transition?: { name, folder, params } }.
// Keyframe times are seconds within `dur`: anchorIn keeps them from the clip's start, anchorOut from its end, scale stretches them
// over the clip (Premiere's In Point / Out Point / Scale preset types).
import { edit, getState, set } from './store';
import { VIDEO_FX, defaultParams } from '../Renderers/fx/videoEffects';
import { AUDIO_FX, audioDefaults } from '../Services/audioFx';
import { DEFAULT_MOTION, DEFAULT_OPACITY } from './params';
import { addTransition, autoAnalyzeNewTransitions, setPresetApplier } from './dnd';
import { VIDEO_EFFECTS, AUDIO_EFFECTS } from './effectsCatalog';
import { BUILTIN_PRESETS } from '../presets';

export const PRESET_TYPES = [['anchorIn', 'Anchor to In Point'], ['anchorOut', 'Anchor to Out Point'], ['scale', 'Scale']];
const uid = () => Math.random().toString(36).slice(2, 9);
let userPresets = [];
const bump = () => set({ presetsRev: (getState().presetsRev || 0) + 1 });
export const getUserPresets = () => userPresets;
export const allPresets = () => [...BUILTIN_PRESETS, ...userPresets];
export const findPreset = (id) => allPresets().find((p) => p.id === id);

const folderOf = (name, cat) => Object.entries(cat === 'Audio' ? AUDIO_EFFECTS : VIDEO_EFFECTS).find(([, list]) => list.includes(name))?.[0];
/** keyframe time of a preset key on a clip of length clipDur */
export function mapTime(t, preset, clipDur) {
  const d = preset.dur || clipDur;
  const v = preset.type === 'scale' ? (t / (d || 1)) * clipDur : preset.type === 'anchorOut' ? clipDur - (d - t) : t;
  return Math.max(0, Math.min(clipDur, v));
}
const toParam = (v, preset, clipDur) => (v && typeof v === 'object' && Array.isArray(v.keys)
  ? { v: v.keys[0]?.v, keys: v.keys.map((k) => ({ ...k, t: mapTime(k.t, preset, clipDur) })).sort((a, b) => a.t - b.t) }
  : { v, keys: null });
const mapParams = (vals, preset, clipDur) => Object.fromEntries(Object.entries(vals || {}).map(([k, v]) => [k, toParam(v, preset, clipDur)]));

/** Problems with a preset (missing effects / params) — empty when it can be applied */
export function validatePreset(p) {
  const bad = [];
  for (const e of p.effects || []) {
    const def = e.category === 'Audio' ? AUDIO_FX[e.name] : VIDEO_FX[e.name];
    if (!def) { bad.push(`effect ${e.name}`); continue; }
    const ids = new Set(def.params.map((x) => x.id));
    for (const k of Object.keys(e.params || {})) if (!ids.has(k)) bad.push(`${e.name}.${k}`);
  }
  for (const k of Object.keys(p.motion || {})) if (!(k in DEFAULT_MOTION())) bad.push(`motion.${k}`);
  for (const k of Object.keys(p.opacity || {})) if (!(k in DEFAULT_OPACITY())) bad.push(`opacity.${k}`);
  return bad;
}

/** Apply to clips (one undo step). Clips on tracks of the other kind are skipped. Returns how many clips changed. */
export function applyPreset(clipIds, preset, edge = 'start') {
  if (!preset) return 0;
  let n = 0; const before = new Set((getState().sequence.transitions || []).map((x) => x.id));
  edit(`Apply Preset ${preset.name}`, ({ seq }) => {
    for (const c of seq.clips) {
      if (!clipIds.includes(c.id)) continue;
      const kind = seq.tracks.find((x) => x.id === c.track)?.kind;
      if (kind !== preset.media || seq.tracks.find((x) => x.id === c.track)?.locked) continue;
      n++;
      if (preset.transition) { addTransition(seq, c, edge, { media: preset.media, effectName: preset.transition.name, folder: preset.transition.folder, transitionParams: preset.transition.params }); continue; }
      for (const e of preset.effects || []) {
        const base = e.category === 'Audio' ? audioDefaults(e.name) : defaultParams(e.name);
        (c.effects = c.effects || []).push({ id: uid(), effectId: `Preset/${preset.id}`, name: e.name, category: e.category, folder: folderOf(e.name, e.category), enabled: true, preset: preset.name, params: { ...base, ...mapParams(e.params, preset, c.dur) } });
      }
      if (preset.motion) c.motion = { ...DEFAULT_MOTION(), ...(c.motion || {}), ...mapParams(preset.motion, preset, c.dur) };
      if (preset.opacity) c.opacity = { ...DEFAULT_OPACITY(), ...(c.opacity || {}), ...mapParams(preset.opacity, preset, c.dur) };
      if (preset.lumetri) c.lumetri = { ...(c.lumetri || {}), ...preset.lumetri };
    }
  });
  autoAnalyzeNewTransitions(before);
  recordRecent(`preset:${preset.id}`);
  return n;
}
setPresetApplier((ids, id, edge) => applyPreset(ids, findPreset(id), edge));

const fromParam = (p, preset, clipDur) => {
  if (!p || typeof p !== 'object' || !('v' in p)) return p;
  if (!p.keys?.length) return p.v;
  return { keys: p.keys.map((k) => ({ ...k, t: preset.type === 'anchorOut' ? preset.dur - (clipDur - k.t) : k.t })) };
};
/** Build a preset from a clip: picked effect ids (and optionally its Motion / Opacity / Lumetri). */
export function presetFromClip(clip, { name, type = 'anchorIn', fxIds = [], motion = false, opacity = false, lumetri = false, description = '' }) {
  const media = getState().sequence.tracks.find((t) => t.id === clip.track)?.kind || 'video';
  const p = { id: `user/${uid()}`, name: name || 'Custom Preset', folder: ['My Presets'], media, type, dur: clip.dur, tags: ['user'], description, source: 'own', license: 'own' };
  p.effects = (clip.effects || []).filter((e) => fxIds.includes(e.id)).map((e) => ({ name: e.name, category: e.category, params: Object.fromEntries(Object.entries(e.params || {}).map(([k, v]) => [k, fromParam(v, p, clip.dur)])) }));
  if (motion && clip.motion) p.motion = Object.fromEntries(Object.entries(clip.motion).map(([k, v]) => [k, fromParam(v, p, clip.dur)]));
  if (opacity && clip.opacity) p.opacity = Object.fromEntries(Object.entries(clip.opacity).map(([k, v]) => [k, fromParam(v, p, clip.dur)]));
  if (lumetri && clip.lumetri) p.lumetri = JSON.parse(JSON.stringify(clip.lumetri));
  return p;
}

// ---------- user presets on disk ----------
const dir = async () => { const d = await window.editorstage?.userData?.(); return d ? `${d}/presets` : null; };
const safe = (s) => s.replace(/[^\w.-]+/g, '_');
export async function loadUserPresets() {
  const d = await dir(); if (!d) return userPresets;
  const out = [];
  for (const f of (await window.editorstage.readdir(d)) || []) {
    if (!f.endsWith('.json')) continue;
    try { const p = JSON.parse(await window.editorstage.readText(`${d}/${f}`)); if (p?.id && p.name) out.push({ ...p, file: f }); } catch { /* skip a broken file */ }
  }
  userPresets = out.sort((a, b) => a.name.localeCompare(b.name)); bump(); return userPresets;
}
export async function saveUserPreset(p) {
  p = { ...p, folder: p.folder?.length ? p.folder : ['My Presets'] };
  userPresets = [...userPresets.filter((x) => x.id !== p.id), p].sort((a, b) => a.name.localeCompare(b.name)); bump();
  try { const d = await dir(); if (d) { await window.editorstage.mkdir(d); const { file, ...data } = p; await window.editorstage.writeFile(`${d}/${safe(p.id)}.json`, JSON.stringify(data, null, 1)); } } catch { /* kept for this session */ }
  return p;
}
export async function deleteUserPreset(id) {
  userPresets = userPresets.filter((x) => x.id !== id); bump();
  try { const d = await dir(); if (d) await window.editorstage.removeFile?.(`${d}/${safe(id)}.json`); } catch { /* ignore */ }
}
export async function renameUserPreset(id, name) { const p = userPresets.find((x) => x.id === id); if (p) await saveUserPreset({ ...p, name }); }

// ---------- export / import ----------
export const presetsFileText = (list) => JSON.stringify({ format: 'editorstage-preset', version: 1, presets: list.map(({ file, builtin, ...p }) => p) }, null, 1);
/** text of a .espreset (or a Premiere .prfpset, best effort) -> presets (not yet saved) */
export function parsePresetsFile(text) {
  const t = String(text).trim();
  if (t.startsWith('{')) {
    const j = JSON.parse(t); const list = j.format === 'editorstage-preset' ? j.presets : Array.isArray(j) ? j : [j];
    return list.filter((p) => p && p.name).map((p) => ({ ...p, id: `user/${uid()}`, folder: ['My Presets', ...(p.folder || []).filter((x) => x !== 'My Presets').slice(-1)], builtin: undefined }));
  }
  return parsePrfpset(t);
}
/** Premiere .prfpset: the effect names are readable but the parameter values are stored in Premiere's own binary blobs, so only
 * the effects that EditorStage also has come across, at their default values. */
export function parsePrfpset(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml'); const out = [];
  const known = (n) => { const k = n.replace(/^(AE\.)?ADBE\s*/i, '').replace(/\s*\d+$/, '').trim().toLowerCase(); return Object.keys(VIDEO_FX).find((x) => x.toLowerCase() === k) || Object.keys(AUDIO_FX).find((x) => x.toLowerCase() === k); };
  for (const fp of doc.querySelectorAll('FilterPreset, PresetBin FilterPreset, *[ClassID] FilterPreset')) {
    const name = fp.getAttribute('Name') || fp.querySelector(':scope > Name')?.textContent || 'Imported Preset';
    const effects = [];
    for (const n of fp.querySelectorAll('MatchName, DisplayName, Name')) { const e = known(n.textContent || ''); if (e && !effects.some((x) => x.name === e)) effects.push({ name: e, category: AUDIO_FX[e] && !VIDEO_FX[e] ? 'Audio' : 'Video', params: {} }); }
    if (effects.length) out.push({ id: `user/${uid()}`, name, folder: ['My Presets', 'Imported'], media: effects[0].category === 'Audio' ? 'audio' : 'video', type: 'anchorIn', tags: ['imported'], effects, source: 'user', license: 'user' });
  }
  return out;
}

// ---------- favorites / recently used (per user, localStorage) ----------
const LS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
export const getFavorites = () => LS('es-fx-favorites', []);
export function toggleFavorite(key) { const f = getFavorites(); const next = f.includes(key) ? f.filter((x) => x !== key) : [...f, key]; SV('es-fx-favorites', next); bump(); return next; }
export const getRecent = () => LS('es-fx-recent', []);
export function recordRecent(key) { SV('es-fx-recent', [key, ...getRecent().filter((x) => x !== key)].slice(0, 15)); bump(); }
