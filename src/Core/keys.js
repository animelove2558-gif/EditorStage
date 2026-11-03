// Layout-independent shortcut keys. e.key is what the active keyboard layout types: on the Thai layout the I key gives
// 'ร' and Ctrl+Z gives 'ผ', so shortcuts written as Latin letters never match. When e.key is not a plain ASCII
// character, fall back to the physical key (e.code) read as on a US keyboard. Latin layouts (AZERTY, QWERTZ) keep
// using e.key, so a shortcut stays on the letter printed on the key.

const CODE_KEYS = {
  Space: ' ', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', IntlBackslash: '\\',
  Semicolon: ';', Quote: "'", Backquote: '`', Comma: ',', Period: '.', Slash: '/',
};

/** The physical key of a keyboard event as a lower-case US-layout character ('a', '1', '/'), or null. */
export function codeKey(code) {
  if (!code) return null;
  let m = /^Key([A-Z])$/.exec(code); if (m) return m[1].toLowerCase();
  m = /^Digit(\d)$/.exec(code); if (m) return m[1];
  return CODE_KEYS[code] ?? null;
}

/** The lower-case key name used in shortcut tables ('z', 'arrowleft', 'delete', ' '), the same on every layout. */
export function shortcutKey(e) {
  const key = e.key || '';
  const ascii = key.length === 1 && key.charCodeAt(0) < 128;
  // Shift changes the symbol a key types (Shift+/ gives '?' on a US keyboard) but shortcut tables name the key itself
  // ('ctrl+shift+/'): with Shift held, a symbol or digit key is read from the physical key. Letters keep e.key.
  if (e.shiftKey && ascii && !/[a-z]/i.test(key)) { const k = codeKey(e.code); if (k && !/[a-z]/.test(k)) return k; }
  if (ascii || (key.length > 1 && key !== 'Unidentified' && key !== 'Process' && key !== 'Dead')) return key.toLowerCase();
  return codeKey(e.code) ?? key.toLowerCase();
}
