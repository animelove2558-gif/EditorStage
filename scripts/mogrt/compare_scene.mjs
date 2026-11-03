// Usage: node scripts/mogrt/compare_scene.mjs <project.aep> [--max N] [--all] [--group] [--ignore-synthetic]
// Parses the .aep with the JS reader (src/Services/mogrt/aep/index.js) and diffs the Scene against the sibling
// scene.oracle.json (written by scripts/mogrt/aep_to_scene.py / py_aep).
// Rules: floats equal within 1e-6 (abs or relative), undefined == null, `_oracleErrors` ignored. `synthetic:true` nodes (the default
// properties py_aep/the JS reader synthesise) ARE compared; pass --ignore-synthetic to skip them outside effects.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { parseAep } = await import(pathToFileURL(path.join(here, '../../src/Services/mogrt/aep/index.js')).href);

export function diffScenes(a, b, opts = {}) {
  const tol = opts.tol ?? 1e-6;
  const out = [];
  const IGNORE_KEYS = new Set(['_oracleErrors', 'styleRuns', 'paraRuns', 'motionBlurEnabled', 'shutterAngle', 'shutterPhase', 'motionBlurSamples', 'lightType']); // JS-reader-only additions
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const nodeLabel = (n) => (n && typeof n === 'object' && n.matchName ? `:${n.matchName}` : n && n.name && n.id !== undefined ? `:${n.name}` : '');

  function filterSynth(arr, inEffect) {
    if (!Array.isArray(arr) || inEffect || opts.keepSynthetic) return arr;
    return arr.filter((n) => !(n && n.synthetic));
  }

  function rec(x, y, p, inEffect) {
    if (x === undefined) x = null;
    if (y === undefined) y = null;
    if (x === null && y === null) return;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x === y) return;
      const d = Math.abs(x - y);
      if (d <= tol || d <= tol * Math.max(Math.abs(x), Math.abs(y))) return;
      out.push({ p, a: x, b: y });
      return;
    }
    if (Array.isArray(x) && Array.isArray(y)) {
      const kx = /\.(children|properties)$/.test(p);
      const fx = kx ? filterSynth(x, inEffect) : x;
      const fy = kx ? filterSynth(y, inEffect) : y;
      if (fx.length !== fy.length) {
        out.push({ p: `${p}.length`, a: fx.length, b: fy.length, detail: `A=[${fx.map((n) => n && n.matchName || '').join(',')}] B=[${fy.map((n) => n && n.matchName || '').join(',')}]` });
      }
      const n = Math.min(fx.length, fy.length);
      for (let i = 0; i < n; i++) {
        const eff = inEffect || (fx[i] && fx[i].matchName === 'ADBE Effect Parade');
        rec(fx[i], fy[i], `${p}[${i}${nodeLabel(fx[i])}]`, eff);
      }
      return;
    }
    if (isObj(x) && isObj(y)) {
      const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
      for (const k of keys) {
        if (IGNORE_KEYS.has(k)) continue;
        if (k === 'synthetic' && !opts.keepSynthetic) continue;
        const eff = inEffect || x.matchName === 'ADBE Effect Parade';
        rec(x[k], y[k], `${p}.${k}`, eff);
      }
      return;
    }
    if (x === y) return;
    out.push({ p, a: x, b: y });
  }
  rec(a, b, '$', false);
  return out;
}

const fmt = (v) => {
  const s = JSON.stringify(v);
  return s && s.length > 140 ? s.slice(0, 137) + '...' : s;
};

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) { console.error('usage: compare_scene.mjs <project.aep> [--max N] [--all] [--group] [--ignore-synthetic]'); process.exit(2); }
  const maxIdx = args.indexOf('--max');
  const max = args.includes('--all') ? Infinity : maxIdx >= 0 ? Number(args[maxIdx + 1]) : 40;
  const oraclePath = path.join(path.dirname(file), 'scene.oracle.json');
  const oracle = JSON.parse(fs.readFileSync(oraclePath, 'utf8'));
  const bytes = new Uint8Array(fs.readFileSync(file));
  const t0 = performance.now();
  const js = parseAep(bytes);
  const ms = performance.now() - t0;
  // normalise through JSON (drops undefined, NaN -> null) like the oracle
  const jsN = JSON.parse(JSON.stringify(js));
  const diffs = diffScenes(oracle, jsN, { keepSynthetic: !args.includes('--ignore-synthetic') });
  console.log(`${path.basename(path.dirname(path.resolve(file)))}: parse ${ms.toFixed(0)} ms, ${jsN.comps.length} comps, ${jsN.footage.length} footage, ${diffs.length} mismatch(es)`);
  const warn = js._warnings || [];
  if (warn.length) console.log(`  reader warnings (${warn.length}): ${warn.slice(0, 5).join(' | ')}`);
  if (args.includes('--group')) {
    // one line per distinct (matchName path, field) with count + first example
    const by = new Map();
    for (const d of diffs) {
      const k = d.p.replace(/^\$\.comps\[\d+:[^\]]*\]\./, '').replace(/layers\[\d+:[^\]]*\]\./, '').replace(/\[\d+:([^\]]*)\]/g, '[$1]').replace(/\.(children|properties)\[/g, '[');
      const e = by.get(k);
      if (e) e.n++; else by.set(k, { n: 1, d });
    }
    for (const [k, e] of by) console.log(`  ${e.n}x ${k}\n       e.g. oracle=${fmt(e.d.a)} js=${fmt(e.d.b)}`);
    process.exit(diffs.length ? 1 : 0);
  }
  for (const d of diffs.slice(0, max)) console.log(`  ${d.p}\n     oracle=${fmt(d.a)}  js=${fmt(d.b)}${d.detail ? '\n     ' + d.detail : ''}`);
  if (diffs.length > max) {
    // summary by path shape
    const by = new Map();
    for (const d of diffs) {
      const k = d.p.replace(/\[\d+(:[^\]]*)?\]/g, '[]').replace(/^\$\.comps\[\]\.layers\[\]\./, '');
      by.set(k, (by.get(k) || 0) + 1);
    }
    console.log(`  ... ${diffs.length - max} more. Top path shapes:`);
    for (const [k, n] of [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`     ${n}x ${k}`);
  }
  process.exit(diffs.length ? 1 : 0);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();

