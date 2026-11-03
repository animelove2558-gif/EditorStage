import { edit, getState } from './store';
import { defaultParams } from '../Renderers/fx/videoEffects';
import { audioDefaults } from '../Services/audioFx';
import { getPrefs } from './prefs';
import { EXT_TRANSITIONS, extDefaults } from '../Renderers/fx/moreTransitions';

export const EFFECT_MIME = 'application/x-editorstage-effect';
// dataTransfer.getData() is unreadable during dragover, so the active payload is also kept here.
let active = null;

/** payload: { type:'EFFECT', effectId, effectName, category:'Video'|'Audio'|'Transition', media:'video'|'audio', folder } */
export function beginEffectDrag(e, payload) {
  active = payload;
  e.dataTransfer.setData(EFFECT_MIME, JSON.stringify(payload));
  e.dataTransfer.setData('text/plain', payload.effectName);
  e.dataTransfer.effectAllowed = 'copy';
}
export const endEffectDrag = () => { active = null; };
export const activeEffectDrag = () => active;

/** Video effects/transitions -> video tracks only; audio -> audio tracks only. */
export const canDropEffect = (payload, trackKind) => !!payload && payload.type === 'EFFECT' && payload.media === trackKind;

const uid = () => Math.random().toString(36).slice(2, 9);
const TOL = 0.08;

/** Add a transition at a clip's start/end edge (joins the neighbouring clip on the same track when adjacent). */
export function addTransition(seq, clip, edge, payload) {
  const at = edge === 'start' ? clip.start : clip.start + clip.dur;
  const neighbor = seq.clips.find((c) => c.id !== clip.id && c.track === clip.track && Math.abs((edge === 'start' ? c.start + c.dur : c.start) - at) < TOL);
  const aId = edge === 'start' ? neighbor?.id ?? null : clip.id;
  const bId = edge === 'start' ? clip.id : neighbor?.id ?? null;
  const lens = [clip.dur, neighbor?.dur ?? clip.dur];
  const def = payload.media === 'audio' ? getPrefs().audioTransitionDur : getPrefs().videoTransitionDur; // Preferences > default transition duration
  const dur = Math.max(0.2, Math.min(def, Math.min(...lens) * (neighbor ? 1 : 0.5)));
  seq.transitions = (seq.transitions || []).filter((t) => !(t.track === clip.track && Math.abs(t.at - at) < TOL));
  const params = payload.media === 'video' && EXT_TRANSITIONS[payload.effectName] ? extDefaults(payload.effectName) : undefined;
  seq.transitions.push({ id: uid(), track: clip.track, kind: payload.media, name: payload.effectName, folder: payload.folder, at, dur, aId, bId, reverse: false, ...(params ? { params } : {}), ...(payload.transitionParams ? { params: { ...(params || {}), ...payload.transitionParams } } : {}) });
}

// presets (payload.preset) are applied by src/Core/presets.js, which registers itself here (no import cycle)
let presetApplier = null;
export const setPresetApplier = (fn) => { presetApplier = fn; };

/** Apply an effect (or transition at `edge`) to clips. Returns nothing; goes through the undoable store. */
export function applyEffectToClips(clipIds, payload, edge = 'start') {
  if (payload.preset) { presetApplier?.(clipIds, payload.preset, edge); return; }
  const before = new Set((getState().sequence.transitions || []).map((x) => x.id));
  edit(`Apply ${payload.effectName}`, ({ seq }) => {
    for (const c of seq.clips) {
      if (!clipIds.includes(c.id)) continue;
      if (seq.tracks.find((x) => x.id === c.track)?.kind !== payload.media) continue;
      if (payload.category === 'Transition') { addTransition(seq, c, edge, payload); continue; }
      c.effects = c.effects || [];
      c.effects.push({
        id: uid(), effectId: payload.effectId, name: payload.effectName, category: payload.category, folder: payload.folder, enabled: true,
        params: payload.category === 'Audio' ? audioDefaults(payload.effectName) : defaultParams(payload.effectName),
      });
    }
  });
  autoAnalyzeNewTransitions(before);
}

// A newly added Morph Cut analyses faces in the background
export function autoAnalyzeNewTransitions(before) {
  for (const t of getState().sequence.transitions || []) {
    if (!before.has(t.id) && t.name === 'Morph Cut') import('../Services/morph').then((m) => m.analyzeMorphCut(t.id)).catch(() => {});
  }
}

export const selectedClips = () => { const { sequence, selection } = getState(); return sequence.clips.filter((c) => selection.includes(c.id)); };
