// Unit tests for the AE expression engine. Run: node scripts/mogrt/test_expressions.mjs
import { createEvaluator } from '../../src/Services/mogrt/evaluator.js';

let pass = 0, fail = 0;
const near = (a, b, e = 1e-6) => (Array.isArray(a) ? a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < e) : Math.abs(a - b) < e);
function check(name, got, want, eps) {
  const ok = typeof want === 'string' || typeof want === 'boolean' ? got === want : near(got, want, eps);
  if (ok) pass++; else { fail++; console.log('FAIL', name, 'got', JSON.stringify(got), 'want', JSON.stringify(want)); }
}

const prop = (matchName, name, vt, value, extra = {}) => ({ kind: 'prop', matchName, name, enabled: true, valueType: vt, dimensions: vt === 'ONE_D' ? 1 : vt === 'TWO_D' ? 2 : vt === 'THREE_D' ? 3 : 4, isSpatial: false, value, keyframes: [], expression: null, expressionEnabled: false, ...extra });
const grp = (matchName, name, children) => ({ kind: 'group', matchName, name, enabled: true, groupType: 'named', children });
const key = (time, value, o = {}) => ({ time, value, inInterpolation: 'LINEAR', outInterpolation: 'LINEAR', inTemporalEase: [{ speed: 0, influence: 16.7 }], outTemporalEase: [{ speed: 0, influence: 16.7 }], ...o });

function mkScene(exprSrc, { valueType = 'ONE_D', value = 0, keys = [], extraLayers = [] } = {}) {
  const tp = prop('ADBE Position', 'Position', 'THREE_D', [10, 20, 0], { isSpatial: true });
  const target = prop('ADBE Opacity', 'Opacity', valueType, value, { keyframes: keys, expression: exprSrc, expressionEnabled: !!exprSrc });
  const layer = (id, index, name, props) => ({
    id, index, name, type: 'shape', sourceId: null, sourceKind: null, width: 100, height: 100, inPoint: 0, outPoint: 10, startTime: 0, stretch: 100, parentId: null,
    enabled: true, solo: false, nullLayer: false, adjustmentLayer: false, threeD: false, trackMatteType: 'NO_TRACK_MATTE', properties: props, essentialPropertyUuids: [],
  });
  const ctrl = layer(1, 2, 'Control', [grp('ADBE Effect Parade', 'Effects', [
    grp('ADBE Slider Control', 'Amount', [prop('ADBE Slider Control-0001', 'Slider', 'ONE_D', 42)]),
    grp('ADBE Checkbox Control', 'Check', [prop('ADBE Checkbox Control-0001', 'Checkbox', 'ONE_D', 1)]),
    grp('ADBE Color Control', 'Tint', [prop('ADBE Color Control-0001', 'Color', 'COLOR', [1, 0.5, 0, 1])]),
  ])]);
  const L = layer(2, 1, 'L', [grp('ADBE Transform Group', 'Transform', [tp, target])]);
  return { version: 1, comps: [{ id: 1, name: 'Main', width: 1920, height: 1080, pixelAspect: 1, frameRate: 30, duration: 10, bgColor: [0, 0, 0], layers: [L, ctrl, ...extraLayers], markers: [], essentialControllers: [] }], footage: [], usedFonts: [] };
}
function run(src, t = 1, opts) {
  const scene = mkScene(src, opts);
  const errs = [];
  const ev = createEvaluator(scene, { onExpressionError: (e) => errs.push(e) });
  const node = scene.comps[0].layers[0].properties[0].children[1];
  const v = ev._evalProp(node, t);
  if (errs.length) console.log('  expr error:', src.slice(0, 60), '->', errs[0].message);
  return v;
}

// --- basics
check('literal', run('5 + 3'), 8);
check('time', run('time * 2', 1.5), 3);
check('math', run('Math.sin(Math.PI/2) + Math.max(1,2,3)'), 4);
check('vec add', run('[1,2]+[3,4]', 1, { valueType: 'TWO_D', value: [0, 0] }), [4, 6]);
check('vec mul', run('[1,2]*3', 1, { valueType: 'TWO_D', value: [0, 0] }), [3, 6]);
check('value+vec', run('value + [10,0]', 1, { valueType: 'TWO_D', value: [5, 5] }), [15, 5]);
check('if/else completion', run('x = 3; if (x > 2) { "a"; 7 } else { 9 }'), 7);
check('var + function', run('function f(a,b){ return a*b } var r = f(3,4); r'), 12);
check('arrow', run('var f = (a) => a*2; f(5)'), 10);
check('for loop', run('var s=0; for (var i=0;i<10;i++){ if(i==5) continue; s+=i } s'), 40);
check('while break', run('var i=0; while(true){ i++; if(i>=7) break } i'), 7);
check('switch', run('var x=2; var r; switch(x){case 1: r=10; break; case 2: r=20; break; default: r=0} r'), 20);
check('try/catch', run('var r; try { null.x } catch(e) { r = 5 } r'), 5);
check('array methods', run('[3,1,2].sort().join("") * 1'), 123);
check('string', run('"abc".toUpperCase().length'), 3);
check('ternary', run('time > 0.5 ? 10 : 20', 1), 10);
check('typeof', run('typeof foo === "undefined" ? 1 : 0'), 1);
// --- sandbox
check('no constructor', run('[].constructor.constructor("return 1")()', 1, { value: 77 }), 77);
check('no Function', run('Function("return 1")()', 1, { value: 77 }), 77);
check('no globalThis', run('globalThis.process', 1, { value: 77 }), 77);
check('no __proto__', run('({}).__proto__', 1, { value: 77 }), 77);
check('infinite loop budget', run('while(true){}', 1, { value: 55 }), 55);
check('error falls back', run('nonexistent.foo', 1, { value: 66 }), 66);
// --- AE API
check('linear', run('linear(time, 0, 2, 0, 100)', 0.5), 25);
check('linear clamp', run('linear(time, 0, 2, 0, 100)', 5), 100);
check('linear vec', run('linear(time, 0, 2, [0,0], [100,200])', 1, { valueType: 'TWO_D', value: [0, 0] }), [50, 100]);
check('ease mid', run('ease(time, 0, 2, 0, 100)', 1), 50);
check('ease quarter', run('ease(time, 0, 4, 0, 100)', 1), 15.625);
check('easeIn<linear', run('easeIn(time, 0, 4, 0, 100)', 1) < 25, true);
check('easeOut>linear', run('easeOut(time, 0, 4, 0, 100)', 1) > 25, true);
check('clamp', run('clamp(150, 0, 100)'), 100);
check('length', run('length([3,4])'), 5);
check('length2', run('length([0,0],[3,4])'), 5);
check('normalize', run('normalize([0,5])', 1, { valueType: 'TWO_D', value: [0, 0] }), [0, 1]);
check('dot', run('dot([1,2],[3,4])'), 11);
check('cross3', run('cross([1,0,0],[0,1,0])', 1, { valueType: 'THREE_D', value: [0, 0, 0] }), [0, 0, 1]);
check('add()', run('add([1,2],[3,4])', 1, { valueType: 'TWO_D', value: [0, 0] }), [4, 6]);
check('mul()', run('mul([1,2],2)', 1, { valueType: 'TWO_D', value: [0, 0] }), [2, 4]);
check('degToRad', run('degreesToRadians(180)'), Math.PI);
check('radToDeg', run('radiansToDegrees(Math.PI)'), 180);
check('timeToFrames', run('timeToFrames(1, 30)'), 30);
check('framesToTime', run('framesToTime(15, 30)'), 0.5);
check('hsl roundtrip', run('hslToRgb(rgbToHsl([1,0.5,0,1]))', 1, { valueType: 'COLOR', value: [0, 0, 0, 1] }), [1, 0.5, 0, 1], 1e-9);
check('thisComp props', run('thisComp.width + thisComp.height + thisComp.numLayers'), 1920 + 1080 + 2);
check('frameDuration', run('thisComp.frameDuration'), 1 / 30);
check('layer by name effect', run('thisComp.layer("Control").effect("Amount")("Slider")'), 42);
check('layer by idx effect', run('thisComp.layer(2).effect(1)(1) * 2'), 84);
check('checkbox*100', run('thisComp.layer("Control").effect("Check")("Checkbox")*100'), 100);
check('color effect', run('thisComp.layer("Control").effect("Tint")("Color")', 1, { valueType: 'COLOR', value: [0, 0, 0, 1] }), [1, 0.5, 0, 1]);
check('transform.position', run('transform.position[1]'), 20);
check('position global', run('position[0] + 1'), 11);
check('thisLayer.name', run('thisLayer.name === "L" ? 1 : 0'), 1);
check('index', run('index'), 1);
check('layer rel', run('thisComp.layer(thisLayer, 1).name === "Control" ? 1 : 0'), 1);
check('hasParent', run('hasParent ? 1 : 0'), 0);
check('toComp', run('toComp([0,0])[0]', 1, {}), 10);
check('sourceRectAtTime shape', run('thisLayer.sourceRectAtTime(0).width', 1), 0);
check('seedRandom timeless same', run('seedRandom(5,true); var a = random(); seedRandom(5,true); a == random() ? 1 : 0'), 1);
check('random range', run('seedRandom(1,true); var r=random(10,20); (r>=10 && r<20) ? 1 : 0'), 1);
check('random deterministic', run('seedRandom(3,true); random()') === run('seedRandom(3,true); random()'), true);
check('gaussRandom finite', Number.isFinite(run('gaussRandom()')), true);
check('noise range', Math.abs(run('noise(time*3)')) <= 1.2, true);
check('wiggle deterministic', run('wiggle(2, 10)', 1.3) === run('wiggle(2, 10)', 1.3), true);
check('wiggle amplitude', Math.abs(run('wiggle(3, 10)', 2.2, { value: 50 }) - 50) <= 25, true);
check('wiggle zero amp', run('wiggle(3, 0)', 2.2, { value: 50 }), 50);
check('posterizeTime', run('posterizeTime(2); time', 0.74), 0.5);
check('createPath', run('createPath([[0,0],[10,0]],[],[],false).vertices.length'), 2);
check('thisProject', run('thisProject.bitsPerChannel'), 8);

// --- keyframes
const K2 = [key(0, 0), key(2, 100)];
check('key linear', run(null, 1, { keys: K2 }), 50);
check('key before', run(null, -1, { keys: K2 }), 0);
check('key after', run(null, 5, { keys: K2 }), 100);
check('hold', run(null, 1, { keys: [key(0, 0, { outInterpolation: 'HOLD' }), key(2, 100)] }), 0);
{ // ease in/out symmetric influence 33.3 speed 0 : midpoint = 50
  const e = { speed: 0, influence: 33.333333 };
  const ks = [key(0, 0, { outInterpolation: 'BEZIER', outTemporalEase: [e] }), key(2, 100, { inInterpolation: 'BEZIER', inTemporalEase: [e] })];
  check('bezier mid', run(null, 1, { keys: ks }), 50, 1e-4);
  const v = run(null, 0.5, { keys: ks });
  check('bezier quarter < linear', v < 25 && v > 0, true);
  // known: x(u)=u for these handles, y(0.25)=0.15625
  check('bezier value', run(null, 0.5, { keys: ks }) / 100, 0.15625, 1e-6);
}
{ // speed matters: out ease speed 100/s with influence 50 over 2s from 0->100 (linear slope 50)
  const ks = [key(0, 0, { outInterpolation: 'BEZIER', outTemporalEase: [{ speed: 100, influence: 50 }] }), key(2, 100, { inInterpolation: 'BEZIER', inTemporalEase: [{ speed: 0, influence: 33.333 }] })];
  check('bezier speed end', run(null, 2, { keys: ks }), 100);
  check('bezier speed > linear early', run(null, 0.4, { keys: ks }) > 20, true);
}
check('numKeys', run('numKeys', 1, { keys: K2 }), 2);
check('key(2).value', run('key(2).value', 1, { keys: K2 }), 100);
check('key(1).time', run('key(2).time', 1, { keys: K2 }), 2);
check('nearestKey', run('nearestKey(1.8).index', 1, { keys: K2 }), 2);
check('valueAtTime', run('valueAtTime(1.5)', 0, { keys: K2 }), 75);
check('velocity', run('velocity', 1, { keys: K2 }), 50, 1e-3);
check('speed', run('speed', 1, { keys: K2 }), 50, 1e-3);
check('loopOut cycle', run('loopOut("cycle")', 3, { keys: K2 }), 50);
check('loopOut pingpong', run('loopOut("pingpong")', 3, { keys: K2 }), 50);
check('loopOut pingpong2', run('loopOut("pingpong")', 2.5, { keys: K2 }), 75);
check('loopOut offset', run('loopOut("offset")', 3, { keys: K2 }), 150);
check('loopOut continue', run('loopOut("continue")', 3, { keys: K2 }), 150, 1e-3);
check('loopIn cycle', run('loopIn("cycle")', -0.5, { keys: K2 }), 75);
check('loopIn offset', run('loopIn("offset")', -1, { keys: K2 }), -50);
check('smooth constant', run('smooth(0.2, 5)', 1, { keys: K2 }), 50, 1e-6);
check('value keyed', run('value * 2', 1, { keys: K2 }), 100);
{ // spatial position along a bezier path
  const mk = () => {
    const sc = mkScene(null);
    const pos = sc.comps[0].layers[0].properties[0].children[0];
    pos.keyframes = [
      { ...key(0, [0, 0, 0]), spatialOutTangent: [0, 100, 0], spatialInTangent: [0, 0, 0] },
      { ...key(2, [100, 0, 0]), spatialInTangent: [0, 100, 0], spatialOutTangent: [0, 0, 0] },
    ];
    pos.isSpatial = true;
    return { sc, pos };
  };
  const { sc, pos } = mk();
  const ev = createEvaluator(sc);
  const mid = ev._evalProp(pos, 1);
  check('spatial mid x', mid[0], 50, 1e-6);
  check('spatial mid y (bezier bulge)', mid[1], 75, 1e-6);
  const start = ev._evalProp(pos, 0), end = ev._evalProp(pos, 2);
  check('spatial ends', [...start, ...end], [0, 0, 0, 100, 0, 0]);
}
// --- bounce expression from lower template
const BOUNCE = `amp = .03; freq = 2.0; decay = 5.0; n = 0; time_max = 4;
if (numKeys > 0){ n = nearestKey(time).index; if (key(n).time > time){ n--; } }
if (n == 0){ t = 0; }else{ t = time - key(n).time; }
if (n > 0 && t < time_max){ v = velocityAtTime(key(n).time - thisComp.frameDuration/10);
value + v*amp*Math.sin(freq*t*2*Math.PI)/Math.exp(decay*t); }else{value}`;
{
  const ks = [key(0, [0, 0, 100]), key(1, [100, 100, 100])];
  const a = run(BOUNCE, 0.5, { valueType: 'THREE_D', value: [0, 0, 100], keys: ks });
  check('bounce before key = interp', a, [50, 50, 100]);
  const b = run(BOUNCE, 1.1, { valueType: 'THREE_D', value: [0, 0, 100], keys: ks });
  // v = (100,100,0)/s ; t=.1 -> 100 + 100*.03*sin(2*.1*2pi)/exp(.5)
  const want = 100 + 100 * 0.03 * Math.sin(2 * 0.1 * 2 * Math.PI) / Math.exp(0.5);
  check('bounce after key', b[0], want, 5e-3);
  check('bounce z unchanged', b[2], 100, 1e-6);
}

console.log(`expression tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

