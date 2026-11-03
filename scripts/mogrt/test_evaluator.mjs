// Evaluate the oracle scenes. Usage: node scripts/mogrt/test_evaluator.mjs [steam|rank|sntb|lower] [t1,t2,...] [--v]
import fs from 'node:fs';
import { createEvaluator } from '../../src/Services/mogrt/evaluator.js';
import { loadScene } from './load_scene.mjs';

const root = new URL('../../test-assets/mogrt/', import.meta.url);
const names = process.argv[2] && !process.argv[2].startsWith('-') ? [process.argv[2]] : ['steam', 'rank', 'sntb', 'lower'];
const times = process.argv[3] && !process.argv[3].startsWith('-') ? process.argv[3].split(',').map(Number) : null;
const verbose = process.argv.includes('--v');
const r3 = (x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : Array.isArray(x) ? x.map(r3) : x);

let bad = 0;
for (const name of names) {
  const scene = loadScene(name); // oracle JSON, or the JS .aep reader with MOGRT_SCENE=js
  const errs = [];
  const ev = createEvaluator(scene, { onExpressionError: (e, n) => errs.push(`${n.matchName}: ${e.message}`), onError: (e, l) => errs.push(`layer ${l.layer.name}: ${e.stack}`) });
  const comp = scene.comps[0].name === 'Comp 1' || true ? scene.comps.find((c) => c.layers.length) : null;
  // top comp = the one not used as a precomp source, else first
  const used = new Set(scene.comps.flatMap((c) => c.layers.map((l) => l.sourceKind === 'comp' ? l.sourceId : null)));
  const top = scene.comps.find((c) => !used.has(c.id)) || comp;
  const ts = times || [0, 0.25, 0.5, 1, 2, 3, 5];
  console.log(`== ${name}: comp "${top.name}" ${top.width}x${top.height} dur ${top.duration}`);
  for (const t of ts) {
    const t0 = performance.now();
    const f = ev.evaluateComp(top.id, t);
    const ms = performance.now() - t0;
    const vis = f.layers.filter((l) => l.visible);
    console.log(`t=${t} ${ms.toFixed(1)}ms visible ${vis.length}/${f.layers.length}`);
    if (verbose) for (const l of vis.slice().reverse()) {
      console.log(`  ${l.index} ${l.name.slice(0, 22).padEnd(22)} ${l.kind.padEnd(9)} op=${r3(l.opacity)} m=${JSON.stringify(r3(l.matrix))} fx=${l.effects.length}${l.text ? ' text="' + String(l.text.document.text).slice(0, 20).replace(/\r|\n/g, '/') + '" anim=' + l.text.animators.length : ''}${l.shape ? ' shapeItems=' + l.shape.items.length : ''}${l.masks.length ? ' masks=' + l.masks.length : ''}`);
    }
  }
  // timing over many frames
  const t0 = performance.now(); let n = 0;
  for (let t = 0; t < Math.min(top.duration, 5); t += 1 / 30) { ev.evaluateComp(top.id, t); n++; }
  console.log(`avg ${((performance.now() - t0) / n).toFixed(2)} ms/frame over ${n} frames`);
  const uniq = [...new Set(errs)];
  if (uniq.length) { bad += uniq.length; console.log('ERRORS:\n  ' + uniq.slice(0, 10).join('\n  ')); }
}
process.exit(bad ? 1 : 0);
