import { TOOLS, selectTool } from './tools';
import { set, getState } from './store';
import { run } from './commands';
import { shortcutKey, keyBelongsToField } from './keys';
import { trimKey } from './trimMode';

export const combos = {
  'ctrl+z': 'edit.undo', 'ctrl+shift+z': 'edit.redo', 'ctrl+y': 'edit.redo',
  'ctrl+x': 'edit.cut', 'ctrl+c': 'edit.copy', 'ctrl+v': 'edit.paste', 'ctrl+shift+v': 'edit.pasteInsert', 'ctrl+alt+v': 'edit.pasteAttributes',
  'ctrl+a': 'edit.selectAll', 'ctrl+shift+a': 'edit.deselectAll', 'ctrl+f': 'edit.find',
  'ctrl+s': 'file.save', 'ctrl+shift+s': 'file.saveAs', 'ctrl+o': 'file.open', 'ctrl+i': 'file.import', 'ctrl+m': 'file.exportMedia',
  'ctrl+n': 'file.newSequence', 'ctrl+alt+n': 'file.newProject', 'ctrl+alt+k': 'edit.shortcuts',
  'ctrl+k': 'seq.addEdit', 'shift+t': 'seq.trimMode', 'ctrl+shift+k': 'seq.addEditAll', 'ctrl+shift+/': 'edit.duplicate',
  'ctrl+d': 'seq.videoTransition', 'ctrl+shift+d': 'seq.audioTransition', 'shift+d': 'seq.defaultTransitions',
  'ctrl+r': 'clip.speed', 'g': 'clip.audioGain', 'shift+e': 'clip.enable', 'f': 'seq.matchFrame',
  'ctrl+shift+l': 'seq.linked', 'ctrl+u': 'clip.makeSubclip', 'shift+u': 'clip.makeSubsequence', 'shift+g': 'clip.audioChannels', 'ctrl+w': 'file.close',
  'delete': 'edit.clear', 'backspace': 'edit.clear', 'shift+delete': 'edit.rippleDelete', 'shift+backspace': 'edit.rippleDelete',
  's': 'seq.snap', 'm': 'marker.add', 'shift+m': 'marker.next', 'ctrl+shift+m': 'marker.prev',
  'i': 'marker.markIn', 'o': 'marker.markOut', 'x': 'marker.markClip', '/': 'marker.markSelection',
  'shift+i': 'marker.goIn', 'shift+o': 'marker.goOut', 'ctrl+shift+i': 'marker.clearIn', 'ctrl+shift+o': 'marker.clearOut', 'ctrl+shift+x': 'marker.clearInOut',
  ',': 'edit.insert', '.': 'edit.overwrite',
  'ctrl+/': 'file.newBin', 'ctrl+shift+w': 'file.closeProject', 'ctrl+alt+s': 'file.saveCopy', 'ctrl+alt+r': 'file.saveRevision', 'f5': 'file.capture', 'ctrl+q': 'app.quit',
  'ctrl+alt+a': 'edit.audiostage', 'ctrl+l': 'clip.linkToggle', 'ctrl+g': 'clip.group', 'ctrl+shift+g': 'clip.ungroup', 'enter': 'seq.renderEffects',
  'ctrl+shift+alt+m': 'marker.clear', 'q': 'seq.rippleTrimPrev', 'w': 'seq.rippleTrimNext', 'alt+q': 'seq.trimPrev', 'alt+w': 'seq.trimNext', 'e': 'seq.extendEdit', 'd': 'seq.selectAtPlayhead',
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [String(n), `clip.multicam${n}`])), 'ctrl+alt+m': 'marker.clearSelected', 'ctrl+t': 'gfx.newText', 'ctrl+;': 'view.guides', 'ctrl+shift+e': 'file.exportFrame',
  ' ': 'play.toggle', 'shift+k': 'play.around', 'home': 'play.start', 'end': 'play.end', 'k': 'play.pause', 'l': 'play.shuttleFwd', 'j': 'play.shuttleBack',
  'arrowright': 'play.stepForward', 'arrowleft': 'play.stepBack', 'arrowdown': 'play.nextEdit', 'arrowup': 'play.prevEdit',
  'alt+arrowup': 'clip.nudgeUp', 'alt+arrowdown': 'clip.nudgeDown', 'alt+arrowleft': 'clip.nudgeLeft', 'alt+arrowright': 'clip.nudgeRight',
  'shift+alt+arrowleft': 'clip.nudgeLeft5', 'shift+alt+arrowright': 'clip.nudgeRight5',
  ';': 'seq.lift', "'": 'seq.extract', '\\': 'seq.zoomFit', '=': 'seq.zoomIn', '-': 'seq.zoomOut',
};

// ---- Keymap (Edit > Keyboard Shortcuts) ----
// combos above are the defaults; the user's keymap replaces them in place (the menus, the key handler and the dialog all read
// `combos`). It is kept in userData/keymap.json, never in the project, and can be exported / imported as a .eskeys file.
export const DEFAULT_COMBOS = Object.freeze({ ...combos });
const keymapFile = async () => { const d = await window.editorstage?.userData?.(); return d ? `${d}/keymap.json` : null; };
/** replace the live keymap (combo → command id) */
export function setKeymap(map) {
  for (const k of Object.keys(combos)) delete combos[k];
  for (const [k, v] of Object.entries(map || {})) if (typeof k === 'string' && typeof v === 'string' && v) combos[normCombo(k)] = v; // imported maps may write modifiers in any order
  set({ keymapRev: (getState().keymapRev || 0) + 1 });
}
export async function loadKeymap() {
  try { const p = await keymapFile(); if (!p) return; const j = JSON.parse(await window.editorstage.readText(p)); if (j && j.keys) setKeymap(j.keys); } catch { /* no saved keymap: defaults */ }
}
export async function saveKeymap() { const p = await keymapFile(); if (p) await window.editorstage.writeFile(p, JSON.stringify({ app: 'EditorStage', version: 1, keys: combos }, null, 1)); }
export function resetKeymap() { setKeymap(DEFAULT_COMBOS); return saveKeymap(); }
/** bind combo to cmd (null = remove the combo) and save */
/** 'alt+Ctrl+X' -> 'ctrl+alt+x' in the order comboOf() writes (ctrl, shift, alt, key) */
export function normCombo(c) {
  const parts = String(c).toLowerCase().split('+'); const key = parts.pop() || '+';
  return ['ctrl', 'shift', 'alt'].filter((m) => parts.includes(m) || (m === 'ctrl' && parts.includes('meta'))).map((m) => m + '+').join('') + key;
}
export function bindKey(combo, cmd) { const k = normCombo(combo); const m = { ...combos }; if (cmd) m[k] = cmd; else delete m[k]; setKeymap(m); return saveKeymap(); }
export const combosFor = (cmd) => Object.keys(combos).filter((k) => combos[k] === cmd);
const KEY_LABELS = { ' ': 'Space', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right', delete: 'Delete', backspace: 'Backspace', enter: 'Enter', home: 'Home', end: 'End', escape: 'Esc', tab: 'Tab', pageup: 'Page Up', pagedown: 'Page Down' };
/** 'ctrl+shift+arrowup' → 'Ctrl+Shift+Up' */
export function comboLabel(c) {
  const p = c.split('+'); let key = p.pop(); if (key === '' && c.endsWith('+')) { p.pop(); key = '+'; }
  const k = KEY_LABELS[key] || (/^f\d+$/.test(key) ? key.toUpperCase() : key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1));
  return [...p.map((m) => m[0].toUpperCase() + m.slice(1)), k].join('+');
}
/** the shortcut a menu item shows: its command's current key (the default label while that key is still bound) */
export function menuShortcut(it) {
  if (!it?.cmd || it.arg !== undefined) return it?.shortcut || '';
  const ks = combosFor(it.cmd);
  if (ks.length) { const same = it.shortcut && ks.find((k) => comboLabel(k).toLowerCase() === it.shortcut.toLowerCase()); return comboLabel(same || ks[0]); }
  return Object.values(DEFAULT_COMBOS).includes(it.cmd) ? '' : it.shortcut || '';
}
/** the combo string of a key event ('ctrl+shift+k'), as the key handler reads it; null for a lone modifier */
export function comboOf(e) {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return null;
  return (e.ctrlKey || e.metaKey ? 'ctrl+' : '') + (e.shiftKey ? 'shift+' : '') + (e.altKey ? 'alt+' : '') + shortcutKey(e);
}

export function installShortcuts() {
  loadKeymap();
  const onKey = (e) => {
    // text fields keep their keys; after clicking a checkbox / slider / button the shortcuts still work (Premiere)
    if (keyBelongsToField(e.target, e)) return;
    if (getState().dialog) return;
    const k = shortcutKey(e);
    const mod = comboOf(e) || k;
    if (trimKey(e, mod)) return; // Trim Mode keys (Ctrl+Left / Right, Ctrl+T, J / K / L, Space, Esc) come first while it is open
    if (combos[mod]) { e.preventDefault(); run(combos[mod]); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tool = TOOLS.find((t) => t.key && ((t.shift && e.shiftKey && k === t.key.toLowerCase()) || (!t.shift && !e.shiftKey && k === t.key)));
    if (tool) selectTool(tool.id);
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
