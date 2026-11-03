// Effects library licensing (docs/PROMPT_FIX_ROUND2.md E6): every effect, transition and built-in preset has a source and an
// allowed license, no names that imitate trademarks or paid packs, and no code from banned sources in the effect folders.
// Run: node scripts/test_effect_licenses.mjs
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-lic-'));
const entry = path.join(tmp, 'entry.js'); const out = path.join(tmp, 'bundle.mjs');
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/Core/fxLicenses.js'))};`);
// the effect tables only need a few browser globals at import time
await esbuild.build({ absWorkingDir: root, entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error', loader: { '.js': 'jsx', '.wk': 'text' },
  banner: { js: 'globalThis.window = globalThis.window || globalThis; globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {} };' } });
const m = await import(pathToFileURL(out).href);
fs.rmSync(tmp, { recursive: true, force: true });

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const rows = m.licenseTable();
ok('the table lists effects, transitions and presets', rows.length > 900, String(rows.length));
const badLic = rows.filter((r) => !r.source || !m.LICENSE_ALLOWLIST.includes(r.license));
ok('every item has a source and an allowed license', badLic.length === 0, JSON.stringify(badLic.slice(0, 10)));
ok('an item from elsewhere names its source (not just "own" with a foreign license)', rows.every((r) => (r.license === 'own') === (r.source === 'own')));
// names that would imitate a brand, a camera stock or a paid pack
const BANNED_NAMES = /\b(kodak|fuji|fujifilm|portra|ektar|velvia|cinestill|ilford|agfa|polaroid|technicolor|game ?boy|instagram|vsco|filmconvert|red giant|magic bullet|capcut|adobe|lumetri preset pack|shadertoy|lygia|isf)\b/i;
const badNames = rows.filter((r) => BANNED_NAMES.test(r.name) || BANNED_NAMES.test(r.folder));
ok('no trademark-imitating names', badNames.length === 0, JSON.stringify(badNames.map((r) => r.name)));
// code from banned sources would carry their URLs / headers
const DIRS = ['src/Renderers/fx', 'src/Services/audioFx.js', 'src/Services/moreAudioFx.js', 'src/presets'];
const BANNED_CODE = /shadertoy\.com|lygia|Created by .* on Shadertoy|ISF ?\{|"ISFVSN"|FilmConvert|Red Giant|CapCut|libavfilter|vf_[a-z]+\.c/i;
const files = DIRS.flatMap((d) => { const p = path.join(root, d); return fs.statSync(p).isDirectory() ? fs.readdirSync(p).map((f) => path.join(p, f)) : [p]; }).filter((f) => /\.(js|jsx|glsl|frag)$/.test(f));
const hits = files.filter((f) => BANNED_CODE.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f));
ok('no code from banned sources in the effect folders', hits.length === 0, hits.join(', '));
const tp = fs.readFileSync(path.join(root, 'THIRD_PARTY_LICENSES.md'), 'utf8');
ok('THIRD_PARTY_LICENSES.md has the effects library section', /Effects library/i.test(tp));

console.log(`effect licenses: ${pass} passed, ${fail} failed (${rows.length} items)`);
process.exit(fail ? 1 : 0);
