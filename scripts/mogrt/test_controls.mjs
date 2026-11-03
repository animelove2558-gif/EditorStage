// Essential Graphics controls tests against the oracle scenes. Run: node scripts/mogrt/test_controls.mjs
import fs from 'node:fs';
import { createEvaluator } from '../../src/Services/mogrt/evaluator.js';
import { loadScene } from './load_scene.mjs';

const root = new URL('../../test-assets/mogrt/', import.meta.url);
const load = (n) => loadScene(n); // oracle JSON, or the JS .aep reader with MOGRT_SCENE=js
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };

// steam: checkbox toggles layer visibility through the opacity expression
{
  const s = load('steam');
  const ctl = s.comps[0].essentialControllers.find((c) => c.name === 'First Steaming');
  const ev = createEvaluator(s);
  const vis = (f, id) => f.layers.find((l) => l.id === id).visible;
  ok('steam default on', vis(ev.evaluateComp(1, 1), ctl.layerId));
  ok('steam checkbox off', !vis(ev.evaluateComp(1, 1, { [ctl.uuid]: false }), ctl.layerId));
  ok('steam checkbox on again', vis(ev.evaluateComp(1, 1, { [ctl.uuid]: true }), ctl.layerId));
  const text = s.comps[0].essentialControllers.find((c) => c.name === 'Text');
  ok('steam text hidden by default', !ev.evaluateComp(1, 1).layers.find((l) => l.id === text.layerId).visible);
  ev.setControls({ [text.uuid]: true });
  ok('setControls works', ev.evaluateComp(1, 1).layers.find((l) => l.id === text.layerId).visible);
}
// rank: everything off by default, media swap
{
  const s = load('rank');
  const ev = createEvaluator(s);
  const comp = s.comps[0];
  const f0 = ev.evaluateComp(comp.id, 1);
  ok('rank default none visible', f0.layers.every((l) => !l.visible));
  const cb = comp.essentialControllers.find((c) => c.type === 'checkbox');
  const media = comp.essentialControllers.find((c) => c.type === 'media' && c.layerId === cb.layerId);
  const alt = s.footage[s.footage.length - 1];
  const f1 = ev.evaluateComp(comp.id, 1, { [cb.uuid]: true, [media.uuid]: { footageId: alt.id } });
  const L = f1.layers.find((l) => l.id === cb.layerId);
  ok('rank checkbox on -> visible', L.visible);
  ok('rank media swapped', L.source.footageId === alt.id, JSON.stringify(L.source));
  ok('getFootageForController', ev.getFootageForController(media.uuid).id === alt.id);
}
// lower: text, slider, color overrides
{
  const s = load('lower');
  const comp = s.comps[0];
  const ev = createEvaluator(s);
  const byName = (n) => comp.essentialControllers.filter((c) => c.name === n);
  const textCtl = comp.essentialControllers.find((c) => c.type === 'text' && c.name !== '' && c.propertyPath);
  const f = ev.evaluateComp(comp.id, 1, { [textCtl.uuid]: 'HELLO WORLD' });
  const layer = f.layers.find((l) => l.id === textCtl.layerId);
  ok('lower text override', layer.text.document.text === 'HELLO WORLD', layer.text && layer.text.document.text);
  ok('lower text keeps style', layer.text.document.fontSize > 0 && layer.text.document.font);
  const colorCtl = comp.essentialControllers.find((c) => c.type === 'color' && c.propertyPath);
  const f2 = ev.evaluateComp(comp.id, 1, { [colorCtl.uuid]: [0, 1, 0, 1] });
  ok('lower color override evaluated', JSON.stringify(f2).includes('[0,1,0,1]'));
  const sl = comp.essentialControllers.find((c) => c.type === 'slider' && c.propertyPath && /Slider/.test(c.propertyPath.join()));
  if (sl) { const f3 = ev.evaluateComp(comp.id, 1, { [sl.uuid]: 123 }); ok('lower slider override runs', !!f3); }
}
console.log(`controls tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
