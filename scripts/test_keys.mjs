// Shortcut keys on non-Latin keyboard layouts. Run: node scripts/test_keys.mjs
import { shortcutKey, codeKey } from '../src/Core/keys.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const k = (key, code) => shortcutKey({ key, code });

// Thai Kedmanee: e.key is the Thai character, e.code the physical key
ok('Thai I key -> i', k('ร', 'KeyI') === 'i');
ok('Thai Z key (Ctrl+Z) -> z', k('ผ', 'KeyZ') === 'z');
ok('Thai Shift+I -> i', k('ณ', 'KeyI') === 'i');
ok('Thai digit row -> digit', k('ๅ', 'Digit1') === '1');
ok('Thai comma key -> ,', k('ม', 'Comma') === ',');
ok('Thai period key -> .', k('ใ', 'Period') === '.');
ok('Thai slash key -> /', k('ฝ', 'Slash') === '/');
ok('Thai semicolon key -> ;', k('ว', 'Semicolon') === ';');
ok('Thai quote key -> \'', k('ง', 'Quote') === "'");
ok('Thai backslash key -> \\', k('ฃ', 'Backslash') === '\\');
ok('Thai equal / minus keys', k('ช', 'Equal') === '=' && k('ข', 'Minus') === '-');
// other non-Latin layouts and IME states
ok('Russian Ctrl+S -> s', k('ы', 'KeyS') === 's');
ok('IME Process -> physical key', k('Process', 'KeyK') === 'k');
ok('Dead key -> physical key', k('Dead', 'KeyE') === 'e');
// English and named keys unchanged
ok('English letter', k('i', 'KeyI') === 'i');
ok('English Shift+letter lower-cased', k('M', 'KeyM') === 'm');
ok('named keys', k('ArrowLeft', 'ArrowLeft') === 'arrowleft' && k('Delete', 'Delete') === 'delete' && k('F5', 'F5') === 'f5');
ok('space', k(' ', 'Space') === ' ');
// Latin layouts keep the printed letter (AZERTY: the key at Q types 'a')
ok('AZERTY keeps e.key', k('a', 'KeyQ') === 'a');
// Shift + symbol keys are named by the key itself (Ctrl+Shift+/ = Duplicate)
const ks = (key, code) => shortcutKey({ key, code, shiftKey: true });
ok('US Shift+/ ("?") -> /', ks('?', 'Slash') === '/');
ok('US Shift+; (":") -> ;', ks(':', 'Semicolon') === ';');
ok('US Shift+1 ("!") -> 1', ks('!', 'Digit1') === '1');
ok('Thai Shift+/ -> /', ks('ฦ', 'Slash') === '/');
ok('Shift+letter keeps the letter', ks('M', 'KeyM') === 'm' && ks('A', 'KeyQ') === 'a');
ok('Shift+named key unchanged', ks('Delete', 'Delete') === 'delete' && ks('ArrowLeft', 'ArrowLeft') === 'arrowleft');
// unknown physical key falls back to e.key
ok('unknown code', codeKey('NumpadAdd') === null && k('+', 'NumpadAdd') === '+');

console.log(`keys: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
