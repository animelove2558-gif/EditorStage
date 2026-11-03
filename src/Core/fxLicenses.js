// Where every effect, transition and preset comes from, and under which license (docs/PROMPT_FIX_ROUND2.md E6).
// All of them are written for EditorStage ('own'): the Premiere-named ones re-implement Premiere's controls in our own GLSL /
// Web Audio code, nothing is copied from Premiere, Shadertoy, LYGIA, FFmpeg filters or paid preset packs. An entry that ever
// comes from elsewhere must set { source: '<project + URL>', license: '<SPDX id>' } on its definition, with a license from the list below.
import { EFFECT_ROOTS } from './effectsCatalog';
import { VIDEO_FX } from '../Renderers/fx/videoEffects';
import { AUDIO_FX } from '../Services/audioFx';
import { EXT_TRANSITIONS } from '../Renderers/fx/moreTransitions';
import { BUILTIN_PRESETS } from '../presets';

export const LICENSE_ALLOWLIST = ['own', 'MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Zlib', 'Apache-2.0', 'CC0-1.0', 'Unlicense', 'public-domain', 'CC-BY-4.0'];
const defOf = (root, name) => (root === 'Video Effects' ? VIDEO_FX[name] : root === 'Audio Effects' ? AUDIO_FX[name] : root === 'Video Transitions' ? EXT_TRANSITIONS[name] : null);

/** { source, license } of a catalog item ('own' unless its definition says otherwise) */
export function fxLicense(root, name) {
  const d = defOf(root, name);
  return { source: d?.source || 'own', license: d?.license || 'own' };
}
/** Every catalog item and built-in preset with its source and license */
export function licenseTable() {
  const rows = [];
  for (const r of EFFECT_ROOTS) for (const [folder, list] of Object.entries(r.tree)) for (const name of list) rows.push({ kind: r.name, folder, name, ...fxLicense(r.name, name) });
  for (const p of BUILTIN_PRESETS) rows.push({ kind: 'Presets', folder: p.folder.join(' › '), name: p.name, source: p.source, license: p.license });
  return rows;
}
