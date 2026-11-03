// Speed / reverse / Time Remapping time model (src/Core/clipTime.js). Run: node scripts/test_timeremap.mjs
import { sourceAt, sourceSpan, integral, trimHead, setReverse, localAtSource, applySpeedCurve, sourcePositions, maxDuration, headRoom, playRateAt, SPEED_CURVES } from '../src/Core/clipTime.js';
import { evalParam, setKeyInterp } from '../src/Core/params.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;
const clone = (x) => structuredClone(x);
const clip = (o = {}) => ({ id: 'c', start: 10, dur: 4, inPoint: 2, speed: 1, effects: [], ...o });
const ramp = { speed: { v: 100, keys: [{ t: 0, v: 100 }, { t: 2, v: 300 }] } }; // rate 1 -> 3 over 2 s, then 3

// ---- basics ----
ok('plain', near(sourceAt(clip(), 11.5), 3.5));
ok('speed 200%', near(sourceAt(clip({ speed: 2 }), 11), 4));
ok('reverse plays from the head backwards', near(sourceAt(clip({ reverse: true, inPoint: 6 }), 11), 5));
ok('ramp integral (1 -> 3 linear over 2 s = 4 s of source)', near(integral(clip({ timeRemap: ramp }), 2), 4, 2e-3), integral(clip({ timeRemap: ramp }), 2));
ok('ramp then constant 3x', near(sourceAt(clip({ timeRemap: ramp }), 13), 2 + 4 + 3, 3e-3));
ok('speed x ramp', near(sourceSpan(clip({ timeRemap: ramp, speed: 0.5 })), 0.5 * (4 + 6), 5e-3));
ok('clamp to media end', near(sourceAt(clip({ speed: 10 }), 13, 30, 8), 8 - 0.04));
ok('play rate signed', near(playRateAt(clip({ reverse: true, speed: 2 }), 11), -2) && near(playRateAt(clip({ timeRemap: ramp }), 11), 2, 1e-6));
ok('frame hold freezes', near(sourceAt(clip({ frameHold: { on: true, mode: 'source', time: 3.3 } }), 13), 3.3));
ok('frame hold out point with ramp', near(sourceAt(clip({ timeRemap: ramp, frameHold: { on: true, mode: 'out' } }), 10, 30), 2 + 10 - 1 / 30, 5e-3));

// ---- split / trim keep every frame where it was ----
const variants = {
  forward: clip(),
  speed: clip({ speed: 1.7 }),
  reverse: clip({ reverse: true, inPoint: 9, speed: 1.3 }),
  ramp: clip({ timeRemap: clone(ramp) }),
  'ramp eased': clip({ timeRemap: { speed: setKeyInterp(setKeyInterp(clone(ramp.speed), 0, 'easeInOut'), 2, 'easeInOut') } }),
  'reverse ramp': clip({ reverse: true, inPoint: 20, timeRemap: clone(ramp) }),
  'time warp': clip({ effects: [{ name: 'Time Warp', enabled: true, params: { speed: { v: 100, keys: [{ t: 0, v: 50 }, { t: 4, v: 250 }] } } }] }),
};
for (const [name, c] of Object.entries(variants)) {
  let worst = 0;
  for (const cut of [0.37, 1.0, 1.9, 2.6, 3.3]) {
    const at = c.start + cut;
    const left = { ...clone(c), dur: cut }; const right = trimHead({ ...clone(c), start: at, dur: c.dur - cut }, cut);
    for (let t = c.start; t < c.start + c.dur; t += 0.05) {
      const part = t < at ? left : right;
      worst = Math.max(worst, Math.abs(sourceAt(part, t) - sourceAt(c, t)));
    }
  }
  ok(`split keeps source times: ${name}`, worst < 2e-3, `worst ${worst}`);
}
// the original clip is not mutated by trimHead on a shallow copy (flatten relies on this)
{ const c = variants['time warp']; const before = JSON.stringify(c); trimHead({ ...c }, 1); ok('trimHead does not mutate shared effects', JSON.stringify(c) === before); }

// ---- reverse ----
for (const [name, c] of Object.entries({ forward: clip(), ramp: clip({ timeRemap: clone(ramp) }), speed: clip({ speed: 2 }) })) {
  const r = setReverse(clone(c), true); let worst = 0;
  for (let lt = 0; lt <= c.dur; lt += 0.1) worst = Math.max(worst, Math.abs(sourceAt(r, c.start + lt) - sourceAt(c, c.start + c.dur - lt)));
  ok(`reverse mirrors the source range: ${name}`, worst < 3e-3, worst);
  const back = setReverse(clone(r), false); ok(`reverse twice = original: ${name}`, near(back.inPoint, c.inPoint, 1e-6) && !back.reverse);
}

// ---- inverse / limits ----
{ const c = clip({ timeRemap: clone(ramp) }); ok('localAtSource inverts sourceAt', near(localAtSource(c, sourceAt(c, 12.5)), 2.5, 1e-3)); }
ok('maxDuration forward', near(maxDuration(clip({ speed: 2 }), 12), 5));
ok('maxDuration reverse', near(maxDuration(clip({ reverse: true, inPoint: 6 }), 100), 6));
ok('maxDuration ramp', near(sourceSpan(clip({ timeRemap: clone(ramp) }), maxDuration(clip({ timeRemap: clone(ramp) }), 20)), 18, 2e-3));
ok('headRoom forward / reverse', near(headRoom(clip({ speed: 2 }), 10), 1) && near(headRoom(clip({ reverse: true, inPoint: 6 }), 10), 4));

// ---- speed curves (CapCut presets) keep the source range ----
for (const name of Object.keys(SPEED_CURVES)) {
  const c = clip(); const span = sourceSpan(c); applySpeedCurve(c, name);
  ok(`speed curve ${name} keeps the source span`, near(sourceSpan(c), span, 5e-3), `${sourceSpan(c)} vs ${span}`);
}
{ const c = clip(); applySpeedCurve(c, 'Bullet'); const mid = evalParam(c.timeRemap.speed, c.dur / 2); ok('Bullet is slow in the middle', mid < 30, mid); }

// ---- audio sample positions follow the same mapping ----
{
  const c = clip({ timeRemap: clone(ramp), reverse: true, inPoint: 30 }); const sr = 48000; const pos = sourcePositions(c, 10.5, sr * 2, sr); let worst = 0;
  for (let i = 0; i < pos.length; i += 997) worst = Math.max(worst, Math.abs(pos[i] - sourceAt(c, 10.5 + i / sr)));
  ok('sourcePositions = sourceAt', worst < 1e-4, worst);
}

// ---- ease presets ----
{
  const P = (interp) => ({ v: 0, keys: [{ t: 0, v: 0, interp }, { t: 1, v: 100 }] });
  ok('bounce ends on the key', near(evalParam(P('bounce'), 0.999), 100, 0.5) && evalParam(P('bounce'), 0.5) > 50);
  let over = 0; for (let t = 0; t < 1; t += 0.01) over = Math.max(over, evalParam(P('back'), t)); ok('back overshoots', over > 105, over);
  let osc = 0; for (let t = 0; t < 1; t += 0.01) if (evalParam(P('elastic'), t) > 100) osc++; ok('elastic oscillates around the target', osc > 5, osc);
}

console.log(`timeremap: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
