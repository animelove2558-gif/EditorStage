// Lists every command id used by menus, buttons (run('...') in src/) and keyboard shortcuts that does not exist,
// is still a stub, or whose menu shortcut label does not match the real key binding. Exit code = number of problems.
// Run: node scripts/check_commands.mjs
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-check-'));
const out = path.join(tmp, 'bundle.mjs');
// Load the real command table in Node: browser globals are stubbed just enough for module initialisation.
const shim = `
const __noop = () => {}; const __el = () => ({ getContext: () => null, style: {}, addEventListener: __noop, setAttribute: __noop, appendChild: __noop, classList: { toggle: __noop, add: __noop, remove: __noop } });
globalThis.window = globalThis.window || globalThis; globalThis.self = globalThis;
globalThis.document = globalThis.document || { createElement: __el, createElementNS: __el, body: __el(), fonts: { load: async () => {}, check: () => true, [Symbol.iterator]: function* () {} }, addEventListener: __noop, getElementById: () => null };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: __noop };
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((f) => setTimeout(f, 16));
globalThis.Image = globalThis.Image || class { };
globalThis.AudioContext = globalThis.AudioContext || class { }; globalThis.OfflineAudioContext = globalThis.OfflineAudioContext || class { };
globalThis.Worker = globalThis.Worker || class { postMessage() {} };
`;
await esbuild.build({
  absWorkingDir: root, entryPoints: [path.join(root, 'scripts/check_commands.entry.js')], bundle: true, platform: 'node', format: 'esm', outfile: out,
  loader: { '.js': 'jsx', '.wk': 'text' }, banner: { js: shim }, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
}).catch((e) => { console.error(e.message); process.exit(2); });
const { commands, MENUS, combos } = await import(pathToFileURL(out).href);

const problems = [];
const isStub = (f) => typeof f !== 'function' || /scaffolded|logic pending|not implemented|coming soon/i.test(f.toString()) || f.isStub;
const used = new Map(); // id -> [where]
const use = (id, where) => used.set(id, [...(used.get(id) || []), where]);

// 1. menus
const walk = (items, trail) => { for (const it of items) { if (!it || it === '-') continue; const lb = typeof it.label === "function" ? it.label() : it.label; if (it.children) walk(it.children, `${trail} > ${lb}`); else if (it.cmd) use(it.cmd, `menu ${trail} > ${lb}`); } };
for (const m of MENUS) walk(m.items, m.label);
// 2. buttons / code: run('id') and run(`prefix.${x}`) in src
const files = []; const scan = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) scan(p); else if (/\.(jsx?|mjs)$/.test(e.name)) files.push(p); } };
scan(path.join(root, 'src'));
const dynamicPrefixes = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8'); const rel = path.relative(root, f);
  for (const m of src.matchAll(/\brun\(\s*(['"`])([^'"`]+)\1/g)) {
    if (m[1] === '`' && m[2].includes('${')) dynamicPrefixes.push([m[2].split('${')[0], rel]); else use(m[2], rel);
  }
}
// 3. keyboard shortcuts
for (const [k, id] of Object.entries(combos)) use(id, `shortcut ${k}`);

for (const [id, where] of [...used].sort()) {
  if (!(id in commands)) problems.push(`MISSING  ${id}  (${[...new Set(where)].join('; ')})`);
  else if (isStub(commands[id])) problems.push(`STUB     ${id}  (${[...new Set(where)].join('; ')})`);
}
for (const [prefix, where] of dynamicPrefixes) if (!Object.keys(commands).some((k) => k.startsWith(prefix))) problems.push(`MISSING  ${prefix}*  (${where})`);
for (const [id, f] of Object.entries(commands)) if (isStub(f)) problems.push(`STUB     ${id}  (defined but not implemented)`);
// 4. menu shortcut labels must be real key bindings
// same order the key handler builds: ctrl+shift+alt+key
const KEY_NAMES = { up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright' }; // menu labels say Alt+Up, the handler sees ArrowUp
const norm = (s) => { const p = s.toLowerCase().replace(/\s+/g, '').split('+'); const key = p.pop(); return [...['ctrl', 'shift', 'alt'].filter((m) => p.includes(m)), KEY_NAMES[key] || key].join('+'); };
const walkS = (items) => { for (const it of items) { if (!it || it === '-') continue; if (it.children) walkS(it.children); else if (it.shortcut && it.cmd) { const k = norm(it.shortcut); if (combos[k] !== it.cmd) problems.push(`SHORTCUT ${it.shortcut} shown for ${it.cmd} but bound to ${combos[k] || 'nothing'}`); } } };
for (const m of MENUS) walkS(m.items);
// 5. no stub helpers / placeholder messages left in the command module
const cmdSrc = fs.readFileSync(path.join(root, 'src/Core/commands.js'), 'utf8');
if (/\bstub\(/.test(cmdSrc)) problems.push('STUB     commands.js still declares stub(...) commands');
if (/scaffolded|logic pending/i.test(cmdSrc)) problems.push('STUB     commands.js contains a "scaffolded / logic pending" message');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${used.size} command ids referenced, ${Object.keys(commands).length} commands defined`);
for (const p of problems) console.log(p);
console.log(problems.length ? `${problems.length} problem(s)` : '0 missing, 0 stubs, all menu shortcuts bound');
process.exit(Math.min(problems.length, 100));
