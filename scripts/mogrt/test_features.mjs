// Evaluator feature tests on synthetic scenes: node scripts/mogrt/test_features.mjs
import { createEvaluator } from '../../src/Services/mogrt/evaluator.js';
import { layer, prop, group, anim } from './synthetic_scenes.mjs';

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;
const comp = (id, name, layers, extra = {}) => ({ id, name, width: 1920, height: 1080, pixelAspect: 1, frameRate: 30, duration: 10, displayStartTime: 0, bgColor: [0, 0, 0], workAreaStart: 0, workAreaDuration: 10, markers: [], essentialControllers: [], ...extra, layers: layers.map((l, i) => ({ ...l, index: i + 1 })) });
const doc = (text) => ({ text, font: 'ArialMT', fontSize: 50, fillColor: [1, 1, 1], strokeColor: [0, 0, 0], strokeWidth: 0, applyFill: true, applyStroke: false, justification: 'LEFT_JUSTIFY', autoLeading: true });
const textL = (id, text, extra = {}) => layer({ id, type: 'text', text: { doc: doc(text), ...extra }, tf: { pos: [100, 100, 0] } });

// 1. Essential Properties of a precomp layer override the precomp's controller
{
  const inner = comp(2, 'inner', [textL(21, 'MASTER')], { essentialControllers: [{ uuid: 'u-text', name: 'Title', type: 'text', layerId: 21, propertyPath: ['ADBE Text Properties', 'ADBE Text Document'] }] });
  const pre = layer({ id: 11, sourceId: 2, sourceKind: 'comp', w: 1920, h: 1080, tf: { anchor: [960, 540, 0], pos: [960, 540, 0] } });
  pre.essentialPropertyUuids = ['u-text'];
  pre.properties.push(group('ADBE Layer Overrides', [prop('ADBE Layer Overrides-0001', doc('OVERRIDDEN'), { name: 'Title' })]));
  const pre2 = layer({ id: 12, sourceId: 2, sourceKind: 'comp', w: 1920, h: 1080, tf: { anchor: [960, 540, 0], pos: [960, 540, 0] } }); // no overrides
  const scene = { version: 1, comps: [comp(1, 'main', [pre, pre2]), inner], footage: [] };
  const f = createEvaluator(scene, {}).evaluateComp(1, 1);
  const txt = (l) => l.precomp.frame.layers[0].text.document.text;
  ok(txt(f.layers.find((l) => l.id === 11)) === 'OVERRIDDEN', 'precomp override applied');
  ok(txt(f.layers.find((l) => l.id === 12)) === 'MASTER', 'second instance of the precomp keeps the master value');
  const f2 = createEvaluator(scene, { controls: { 'u-text': 'FROM CONTROL' } }).evaluateComp(1, 1);
  ok(txt(f2.layers.find((l) => l.id === 11)) === 'FROM CONTROL', 'explicit control wins over the layer override');
}
// 2. 3D: default camera maps the z=0 plane 1:1; camera zoom / depth sort / lighting
{
  const solid = { id: 1, name: 's', kind: 'solid', path: '', width: 200, height: 100, duration: 0, frameRate: 30, hasVideo: true, hasAudio: false, color: [1, 0, 0] };
  const a = layer({ id: 31, sourceId: 1, sourceKind: 'footage', w: 200, h: 100, threeD: true, tf: { anchor: [100, 50, 0], pos: [960, 540, 0] } });
  const b = layer({ id: 32, sourceId: 1, sourceKind: 'footage', w: 200, h: 100, threeD: true, tf: { anchor: [100, 50, 0], pos: [960, 540, 500] } });
  const scene = { version: 1, comps: [comp(1, 'c', [a, b])], footage: [solid] };
  const ev = createEvaluator(scene, {}); const f = ev.evaluateComp(1, 0);
  const la = f.layers.find((l) => l.id === 31); const m = la.matrix;
  ok(near(m[0], 1) && near(m[3], 1) && near(m[4], 860) && near(m[5], 490), `3D layer at z=0 is unscaled with the default camera (${m.map((x) => x.toFixed(2))})`);
  ok(f.layers[0].id === 32, 'farther 3D layer is painted first');
  const lb = f.layers.find((l) => l.id === 32); ok(lb.matrix[0] < 1, 'farther layer is smaller');
  const lrt = ev._engine.compsById.get(1).layers.find((x) => x.layer.id === 31);
  const p = ev._engine.toComp3(lrt, [0, 0, 0], 0); ok(near(p[0], 860) && near(p[1], 490), 'toComp of a 3D layer corner');
  const back = ev._engine.fromComp3(lrt, [960, 540], 0); ok(near(back[0], 100) && near(back[1], 50), 'fromComp inverts toComp');
  const cam = layer({ id: 30, type: 'camera', autoOrient: 'CAMERA_OR_POINT_OF_INTEREST', camera: { zoom: 2666.7 }, tf: { anchor: [960, 540, 0], pos: [960, 540, -2666.7] } });
  const light = layer({ id: 29, type: 'light', lightType: 'AMBIENT', light: { intensity: 50 } });
  const f2 = createEvaluator({ ...scene, comps: [comp(1, 'c', [cam, light, a, b])] }, {}).evaluateComp(1, 0);
  const la2 = f2.layers.find((l) => l.id === 31);
  ok(near(la2.matrix[0], 1, 1e-2) && near(la2.matrix[4], 860, 0.5), 'camera equivalent to the default camera');
  ok(la2.threeD.lighting && near(la2.threeD.lighting.mul[0], 0.5), 'ambient light at 50% halves the colour');
}
// 3. Text: expression selector amounts per character, wiggly selector, text replacement drops style runs
{
  const animator = group('ADBE Text Animator', [group('ADBE Text Selectors', [group('ADBE Text Expressible Selector', [prop('ADBE Text Range Type2', 1), prop('ADBE Text Expressible Amount', [100, 100, 100], { expr: 'textIndex * 10' })])]), group('ADBE Text Animator Properties', [prop('ADBE Text Opacity', 0)])]);
  const t = textL(41, 'ABCD', { animators: [animator] });
  const ev = createEvaluator({ version: 1, comps: [comp(1, 'c', [t])], footage: [] }, {});
  const sel = ev.evaluateComp(1, 0).layers[0].text.animators[0].selectors[0];
  ok(sel.type === 'expression' && JSON.stringify(sel.amounts) === '[10,20,30,40]', `expression selector amounts ${JSON.stringify(sel.amounts)}`);
}
// 4. Posterize Time effect quantises content time, Echo produces earlier copies
{
  const tl = layer({ id: 51, type: 'text', text: { doc: doc('x') }, tf: { pos: [0, 0, 0] }, effects: [{ mn: 'ADBE Posterize Time', params: { 'Frame Rate': 2 } }] });
  tl.properties.find((p) => p.matchName === 'ADBE Text Properties').children[0] = anim('ADBE Text Document', [[0, doc('A')], [0.3, doc('B')], [0.6, doc('C')]]);
  tl.properties.find((p) => p.matchName === 'ADBE Text Properties').children[0].keyframes.forEach((k) => { k.inInterpolation = k.outInterpolation = 'HOLD'; });
  const e1 = layer({ id: 52, type: 'shape', shape: [], tf: { pos: [0, 0, 0] }, effects: [{ mn: 'ADBE Echo', params: { 'Echo Time (seconds)': -0.1, 'Number Of Echoes': 3, 'Starting Intensity': 1, Decay: 0.5, 'Echo Operator': 1 } }] });
  const ev = createEvaluator({ version: 1, comps: [comp(1, 'c', [tl, e1])], footage: [] }, {});
  const f = ev.evaluateComp(1, 0.4);
  ok(f.layers.find((l) => l.id === 51).text.document.text === 'A', 'posterize time (2 fps) holds the content at t=0');
  const echo = f.layers.find((l) => l.id === 52).echo;
  ok(echo && echo.copies.length === 3 && near(echo.copies[1].intensity, 0.25), 'echo copies + decay');
}

console.log(`feature tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
