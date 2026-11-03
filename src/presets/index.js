// Built-in presets shown under Effects > Presets. All written for EditorStage (source 'own').
import { LUMETRI_LOOK_PRESETS } from './lumetriLooks';
import { VIDEO_PRESETS } from './videoPresets';
import { AUDIO_PRESETS } from './audioPresets';
import { TRANSITION_PRESETS } from './transitionPresets';

export const BUILTIN_PRESETS = [...VIDEO_PRESETS, ...LUMETRI_LOOK_PRESETS, ...AUDIO_PRESETS, ...TRANSITION_PRESETS]
  .map((p) => ({ type: 'anchorIn', source: 'own', license: 'own', builtin: true, ...p }));
