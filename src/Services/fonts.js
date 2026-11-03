// Installed font families (Local Font Access API, granted to the app in electron/main.js) + availability checks.
export const BASE_FONTS = ['Noto Sans Thai', 'Leelawadee UI', 'Tahoma', 'Segoe UI', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Impact', 'Trebuchet MS', 'Comic Sans MS', 'Consolas'];

let listP = null; let localSet = null;
/** Sorted list of every font family on this computer (falls back to BASE_FONTS when the API is unavailable). */
export const loadFontList = () => listP || (listP = (async () => {
  const set = new Set(BASE_FONTS.filter((f) => isFontInstalled(f)));
  try { for (const ff of document.fonts) set.add(ff.family.replace(/^["']|["']$/g, '')); } catch { /* ignore */ }
  try { if (window.queryLocalFonts) { localSet = new Set(); for (const f of await window.queryLocalFonts()) { set.add(f.family); localSet.add(f.family.toLowerCase()); } } } catch { localSet = null; /* permission denied */ }
  return [...set].sort((a, b) => a.localeCompare(b));
})());

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace']);
/** First family of a CSS font stack ("Noto Sans Thai, Arial, sans-serif" -> "Noto Sans Thai"). */
export const primaryFamily = (stack) => String(stack || '').split(',')[0].trim().replace(/^["']|["']$/g, '');

let ctx2d = null;
const width = (font, text) => { ctx2d = ctx2d || document.createElement('canvas').getContext('2d'); ctx2d.font = font; return ctx2d.measureText(text).width; };
const LATIN = 'mmmmmmmmmmlliiWWQq@#0123', THAI = 'กขฃคฅฆงจฉชซฌญฎฏสวัสดีครับ';
/** True when `family` renders with its own glyphs (not a fallback). Works without the Local Font Access permission. */
export function isFontInstalled(family) {
  if (!family) return true; if (GENERIC.has(family.toLowerCase())) return true;
  if (localSet && localSet.has(family.toLowerCase())) return true;
  try {
    for (const base of ['monospace', 'serif', 'sans-serif']) for (const txt of [LATIN, THAI]) {
      if (Math.abs(width(`40px "${family}", ${base}`, txt) - width(`40px ${base}`, txt)) > 0.5) return true;
    }
  } catch { return true; } // no canvas (tests): assume present
  return false;
}
const thaiCache = new Map();
/** True when the family has its own Thai glyphs. */
export function supportsThai(family) {
  if (thaiCache.has(family)) return thaiCache.get(family);
  let r = false;
  try { for (const base of ['monospace', 'serif']) if (Math.abs(width(`40px "${family}", ${base}`, THAI) - width(`40px ${base}`, THAI)) > 0.5) r = true; } catch { r = true; }
  thaiCache.set(family, r); return r;
}

/** Every font family the project uses: titles, captions, MOGRT text overrides (all sequences). */
export function fontsUsed(state) {
  const out = new Map(); // family -> [where]
  const add = (f, where) => { const fam = primaryFamily(f); if (!fam || GENERIC.has(fam.toLowerCase())) return; out.set(fam, [...(out.get(fam) || []), where]); };
  const seqs = { ...(state.seqs || {}), [state.sequence.id]: state.sequence };
  for (const seq of Object.values(seqs)) for (const c of seq.clips || []) {
    if (c.graphic?.font) add(c.graphic.font, `${seq.name} / ${c.name}`);
    if (c.caption?.style?.font) add(c.caption.style.font, `${seq.name} / ${c.name}`);
    for (const v of Object.values(c.mogrt?.values || {})) { const val = v && typeof v === 'object' && 'v' in v ? v.v : v; if (val && typeof val === 'object' && val.fontFamily) add(val.fontFamily, `${seq.name} / ${c.name}`); }
  }
  return out;
}
/** Families used by the project that this computer does not have. */
export async function missingFonts(state) {
  await loadFontList().catch(() => {});
  return [...fontsUsed(state).entries()].filter(([f]) => !isFontInstalled(f)).map(([family, where]) => ({ family, where }));
}
