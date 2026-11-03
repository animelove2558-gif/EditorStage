// Hover preview (Create panel): show a change in the Program Monitor without an undo step, and put the sequence back
// when the pointer leaves. If anything else changed the sequence meanwhile, that change wins and nothing is restored.
import { getState, set, beforeEdit } from '../Core/store';

let saved = null, shown = null;
/** fn(sequenceCopy) modifies a copy of the active sequence, which is shown until previewEnd(). */
export function previewStart(fn) {
  previewEnd();
  const orig = getState().sequence; const copy = structuredClone(orig);
  try { fn(copy); } catch { return; }
  saved = orig; shown = copy; set({ sequence: copy });
}
export function previewEnd() {
  if (saved && getState().sequence === shown) set({ sequence: saved });
  saved = null; shown = null;
}
export const previewing = () => !!shown && getState().sequence === shown;
beforeEdit.add(previewEnd);
