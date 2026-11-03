// Keyframe interpolation tests. Run: node scripts/test_keyframes.mjs
import { evalParam, writeParam, setKeyInterp, setKeyHandles, cubicBezier, toggleKeyAt } from '../src/Core/params.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;

const P = (keys) => ({ v: keys[0].v, keys });
// linear (default, also what old .esproj files contain: keys without `interp`)
{
  const p = P([{ t: 0, v: 0 }, { t: 2, v: 100 }]);
  ok('linear start', evalParam(p, 0) === 0);
  ok('linear mid', near(evalParam(p, 1), 50));
  ok('linear quarter', near(evalParam(p, 0.5), 25));
  ok('before first', evalParam(p, -1) === 0);
  ok('after last', evalParam(p, 5) === 100);
  ok('array lerp', JSON.stringify(evalParam(P([{ t: 0, v: [0, 0] }, { t: 1, v: [1, 2] }]), 0.5)) === '[0.5,1]');
  ok('static value', evalParam({ v: 7, keys: null }, 3) === 7);
  ok('boolean steps', evalParam(P([{ t: 0, v: false }, { t: 1, v: true }]), 0.5) === false && evalParam(P([{ t: 0, v: false }, { t: 1, v: true }]), 1) === true);
}
// hold
{
  const p = setKeyInterp(P([{ t: 0, v: 0 }, { t: 2, v: 100 }, { t: 4, v: 50 }]), 0, 'hold');
  ok('hold keeps value', evalParam(p, 1.99) === 0);
  ok('hold jumps at next key', evalParam(p, 2) === 100);
  ok('segment after hold is linear', near(evalParam(p, 3), 75));
}
// ease in / ease out / ease in-out
{
  const base = P([{ t: 0, v: 0 }, { t: 1, v: 100 }]);
  const eo = setKeyInterp(base, 0, 'easeOut');
  ok('ease out slow start', evalParam(eo, 0.1) < 10, evalParam(eo, 0.1));
  const ei = setKeyInterp(base, 1, 'easeIn');
  ok('ease in slow end', evalParam(ei, 0.9) > 90, evalParam(ei, 0.9));
  const eio = setKeyInterp(setKeyInterp(base, 0, 'easeInOut'), 1, 'easeInOut');
  ok('ease in-out symmetric', near(evalParam(eio, 0.5), 50, 1e-3), evalParam(eio, 0.5));
  ok('ease in-out slow start', evalParam(eio, 0.1) < 10);
  ok('ease in-out slow end', evalParam(eio, 0.9) > 90);
  let mono = true, prev = -1; for (let t = 0; t <= 1; t += 0.01) { const v = evalParam(eio, t); if (v < prev - 1e-9) mono = false; prev = v; }
  ok('ease monotonic', mono);
}
// bezier: auto handles, explicit handles with overshoot
{
  const p = setKeyInterp(P([{ t: 0, v: 0 }, { t: 1, v: 50 }, { t: 2, v: 100 }]), 1, 'bezier');
  ok('bezier stores handles', Array.isArray(p.keys[1].in) && Array.isArray(p.keys[1].out));
  ok('auto bezier passes through key', near(evalParam(p, 1), 50));
  ok('auto bezier smooth (straight line stays straight)', near(evalParam(p, 1.5), 75, 0.5), evalParam(p, 1.5));
  const back = setKeyHandles(P([{ t: 0, v: 0 }, { t: 1, v: 100 }]), 1, { in: [0.6, 1.4] });
  let max = 0; for (let t = 0; t <= 1; t += 0.01) max = Math.max(max, evalParam(back, t));
  ok('bezier overshoot (back ease)', max > 100, max);
  ok('cubicBezier linear', near(cubicBezier(1 / 3, 1 / 3, 2 / 3, 2 / 3, 0.3), 0.3));
  ok('cubicBezier css ease', near(cubicBezier(0.25, 0.1, 0.25, 1, 0.5), 0.8024, 2e-3), cubicBezier(0.25, 0.1, 0.25, 1, 0.5));
  ok('back to linear removes handles', !('in' in setKeyInterp(p, 1, 'linear').keys[1]) && !setKeyInterp(p, 1, 'linear').keys[1].interp);
}
// editing keeps interpolation
{
  let p = setKeyInterp(P([{ t: 0, v: 0 }, { t: 1, v: 100 }]), 0, 'hold');
  p = writeParam(p, 10, 0);
  ok('overwrite keeps interp', p.keys[0].interp === 'hold' && p.keys[0].v === 10);
  p = toggleKeyAt(p, 0.5);
  ok('new key inserted linear', p.keys.length === 3 && !p.keys[1].interp);
}

console.log(`keyframes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
