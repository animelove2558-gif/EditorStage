// Transition presets (built-in): the round 2 transitions with a direction / shape option preset to each of its other choices.
import { MORE_TRANSITIONS } from '../Renderers/fx/moreTransitions';

export const TRANSITION_PRESETS = Object.entries(MORE_TRANSITIONS).flatMap(([folder, items]) => Object.entries(items).flatMap(([name, def]) => {
  const p = (def.params || []).find((x) => x.type === 'select' && x.options.length > 1 && x.options.length <= 8);
  if (!p) return [];
  return p.options.map((opt, i) => i === p.def ? null : {
    id: `transition/${folder}/${name}/${opt}`, name: `${name} (${opt})`, folder: ['Transitions', folder], media: 'video', tags: ['transition', name.toLowerCase(), String(opt).toLowerCase()],
    transition: { name, folder, params: { [p.id]: i } },
  }).filter(Boolean);
}));
