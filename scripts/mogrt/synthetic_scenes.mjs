// Synthetic Scene JSON (docs/mogrt-scene-schema.md) exercising renderer features the sample templates do not use.
// Usage: node scripts/mogrt/synthetic_scenes.mjs <outDir>   -> writes <name>.scene.json files
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const VT = (v) => (typeof v === 'number' ? 'ONE_D' : Array.isArray(v) ? (v.length === 2 ? 'TWO_D' : v.length === 3 ? 'THREE_D' : 'COLOR') : v && v.vertices ? 'SHAPE' : v && 'text' in v ? 'TEXT_DOCUMENT' : 'CUSTOM');
export const prop = (matchName, value, o = {}) => ({ kind: 'prop', matchName, name: o.name || matchName, enabled: true, valueType: o.valueType || VT(value), dimensions: Array.isArray(value) ? value.length : 1, isSpatial: false, value, keyframes: o.keys || [], expression: o.expr || null, expressionEnabled: !!o.expr });
export const group = (matchName, children, name = matchName, extra = {}) => ({ kind: 'group', matchName, name, enabled: true, groupType: 'named', children, ...extra });
const key = (time, value) => ({ time, value, inInterpolation: 'LINEAR', outInterpolation: 'LINEAR', inTemporalEase: [{ speed: 0, influence: 33 }], outTemporalEase: [{ speed: 0, influence: 33 }], temporalContinuous: false, temporalAutoBezier: false, spatialContinuous: false, spatialAutoBezier: false, roving: false });
export const anim = (mn, keys) => prop(mn, keys[0][1], { keys: keys.map(([t, v]) => key(t, v)) });

function transform(t = {}) {
  const pos = t.posKeys ? anim('ADBE Position', t.posKeys) : prop('ADBE Position', t.pos || [0, 0, 0]);
  const rot = t.rotKeys ? anim('ADBE Rotate Z', t.rotKeys) : prop('ADBE Rotate Z', t.rot || 0);
  return group('ADBE Transform Group', [prop('ADBE Anchor Point', t.anchor || [0, 0, 0]), pos, prop('ADBE Scale', t.scale || [100, 100, 100]),
    prop('ADBE Orientation', t.orient || [0, 0, 0]), prop('ADBE Rotate X', t.rx || 0), prop('ADBE Rotate Y', t.ry || 0), rot, prop('ADBE Opacity', t.opacity ?? 100)]);
}
let nextId = 1000;
export function layer(o) {
  const props = [transform(o.tf)];
  if (o.masks) props.push(group('ADBE Mask Parade', o.masks.map((m) => group('ADBE Mask Atom', [prop('ADBE Mask Shape', m.shape), prop('ADBE Mask Feather', m.feather || [0, 0]), prop('ADBE Mask Opacity', 100), prop('ADBE Mask Offset', m.expansion || 0)], 'Mask', { maskMode: m.mode || 'ADD', inverted: !!m.inverted, groupType: 'indexed' })), 'Masks', { groupType: 'indexed' }));
  if (o.effects) props.push(group('ADBE Effect Parade', o.effects.map((e) => group(e.mn, Object.entries(e.params).map(([n, v], i) => prop(`${e.mn}-${String(i + 1).padStart(4, '0')}`, v, { name: n })), e.name || e.mn)), 'Effects', { groupType: 'indexed' }));
  if (o.styles) props.push(group('ADBE Layer Styles', [group('ADBE Blend Options Group', [prop('ADBE Global Angle2', 120), prop('ADBE Global Altitude2', 30)]), ...Object.entries(o.styles).map(([k, p]) => group(`${k}/enabled`, Object.entries(p).map(([n, v]) => prop(`${k}/${n}`, v))))]));
  if (o.shape) props.push(group('ADBE Root Vectors Group', o.shape));
  if (o.text) props.push(group('ADBE Text Properties', [prop('ADBE Text Document', o.text.doc), ...(o.text.path ? [group('ADBE Text Path Options', [prop('ADBE Text Path', 1), prop('ADBE Text Perpendicular To Path', 1)])] : []),
    group('ADBE Text More Options', [prop('ADBE Text Render Order', o.text.order || 1)]), group('ADBE Text Animators', (o.text.animators || []))]));
  if (o.camera) props.push(group('ADBE Camera Options Group', [prop('ADBE Camera Zoom', o.camera.zoom)]));
  if (o.light) props.push(group('ADBE Light Options Group', [prop('ADBE Light Intensity', o.light.intensity ?? 100), prop('ADBE Light Color', o.light.color || [1, 1, 1, 1])]));
  return { id: o.id || nextId++, index: 0, name: o.name || 'Layer', type: o.type || 'av', sourceId: o.sourceId ?? null, sourceKind: o.sourceKind ?? null, width: o.w ?? 0, height: o.h ?? 0,
    inPoint: 0, outPoint: 10, startTime: 0, stretch: 100, parentId: o.parentId ?? null, enabled: true, solo: false, shy: false, locked: false, nullLayer: !!o.nullLayer, adjustmentLayer: !!o.adjustment,
    threeD: !!o.threeD, collapseTransformation: !!o.collapse, guideLayer: false, motionBlur: !!o.motionBlur, timeRemapEnabled: false, autoOrient: o.autoOrient || 'NO_AUTO_ORIENT',
    blendMode: o.blend || 'NORMAL', trackMatteType: o.matte || 'NO_TRACK_MATTE', matteLayerId: null, essentialPropertyUuids: [], lightType: o.lightType, properties: props, markers: [] };
}
export const rectPath = (x, y, w, h) => ({ closed: true, vertices: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], inTangents: [[0, 0], [0, 0], [0, 0], [0, 0]], outTangents: [[0, 0], [0, 0], [0, 0], [0, 0]] });
const vgroup = (items, tr = {}) => group('ADBE Vector Group', [group('ADBE Vectors Group', items), group('ADBE Vector Transform Group', [prop('ADBE Vector Anchor', [0, 0]), prop('ADBE Vector Position', tr.pos || [0, 0]), prop('ADBE Vector Scale', [100, 100]), prop('ADBE Vector Rotation', 0), prop('ADBE Vector Group Opacity', 100)])]);
const rect = (w, h, r = 0, pos = [0, 0]) => group('ADBE Vector Shape - Rect', [prop('ADBE Vector Shape Direction', 1), prop('ADBE Vector Rect Size', [w, h]), prop('ADBE Vector Rect Position', pos), prop('ADBE Vector Rect Roundness', r)]);
const ellipse = (w, h, pos = [0, 0]) => group('ADBE Vector Shape - Ellipse', [prop('ADBE Vector Shape Direction', 1), prop('ADBE Vector Ellipse Size', [w, h]), prop('ADBE Vector Ellipse Position', pos)]);
const star = (o) => group('ADBE Vector Shape - Star', [prop('ADBE Vector Shape Direction', 1), prop('ADBE Vector Star Type', o.polygon ? 2 : 1), prop('ADBE Vector Star Points', o.points || 5), prop('ADBE Vector Star Position', [0, 0]), prop('ADBE Vector Star Rotation', 0), prop('ADBE Vector Star Inner Radius', o.ir || 30), prop('ADBE Vector Star Outer Radius', o.or || 70), prop('ADBE Vector Star Inner Roundess', o.iround || 0), prop('ADBE Vector Star Outer Roundess', o.oround || 0)]);
const fill = (c) => group('ADBE Vector Graphic - Fill', [prop('ADBE Vector Blend Mode', 1), prop('ADBE Vector Fill Rule', 1), prop('ADBE Vector Fill Color', c), prop('ADBE Vector Fill Opacity', 100)]);
const stroke = (c, w) => group('ADBE Vector Graphic - Stroke', [prop('ADBE Vector Blend Mode', 1), prop('ADBE Vector Stroke Color', c), prop('ADBE Vector Stroke Opacity', 100), prop('ADBE Vector Stroke Width', w), prop('ADBE Vector Stroke Line Cap', 2), prop('ADBE Vector Stroke Line Join', 2), prop('ADBE Vector Stroke Miter Limit', 4)]);
const mod = (mn, ps) => group(mn, Object.entries(ps).map(([k, v]) => prop(k, v)));
const doc = (text, o = {}) => ({ text, font: 'ArialMT', fontFamily: 'Arial', fontStyle: 'Bold', fontSize: o.size || 60, fillColor: o.fill || [1, 1, 1], strokeColor: o.stroke || [0, 0, 0], strokeWidth: o.sw || 0, applyFill: true, applyStroke: !!o.sw, strokeOverFill: o.sof ?? true,
  justification: o.just || 'CENTER_JUSTIFY', tracking: 0, leading: null, autoLeading: true, baselineShift: 0, horizontalScale: 1, verticalScale: 1, fauxBold: false, fauxItalic: false, allCaps: false, smallCaps: false, boxText: false, boxTextSize: null, boxTextPos: null, styleRuns: o.runs || null });
const solid = (id, color, w = 300, h = 200) => ({ id, name: `Solid ${id}`, kind: 'solid', path: '', width: w, height: h, duration: 0, frameRate: 30, hasVideo: true, hasAudio: false, color });
const comp = (id, name, layers, w = 1920, h = 1080, extra = {}) => ({ id, name, width: w, height: h, pixelAspect: 1, frameRate: 30, duration: 10, displayStartTime: 0, bgColor: [0, 0, 0], workAreaStart: 0, workAreaDuration: 10, markers: [], essentialControllers: [], ...extra, layers: layers.map((l, i) => ({ ...l, index: i + 1 })) });
const scene = (comps, footage) => ({ version: 1, comps, footage, usedFonts: [], expressionEngine: 'javascript-1.0' });
const solidLayer = (fid, x, y, o = {}) => layer({ ...o, sourceId: fid, sourceKind: 'footage', w: o.w || 300, h: o.h || 200, tf: { anchor: [(o.w || 300) / 2, (o.h || 200) / 2, 0], pos: [x, y, 0], ...(o.tf || {}) } });
const shapeLayer = (x, y, items, o = {}) => layer({ ...o, type: 'shape', shape: items, tf: { pos: [x, y, 0], ...(o.tf || {}) } });
const textLayer = (x, y, d, o = {}) => layer({ ...o, type: 'text', text: { doc: d, ...(o.text || {}) }, tf: { pos: [x, y, 0], ...(o.tf || {}) } });

// ---------------------------------------------------------------- scenes
const S = {};
{ // effects grid (5 x 4)
  const fx = [
    ['ADBE Gaussian Blur 2', { Blurriness: 30, 'Blur Dimensions': 1, 'Repeat Edge Pixels': 0 }],
    ['ADBE Glo2', { 'Glow Based On': 2, 'Glow Threshold': 0.4, 'Glow Radius': 40, 'Glow Intensity': 1.5, 'Composite Original': 2, 'Glow Operation': 3, 'Glow Colors': 1 }],
    ['ADBE Linear Wipe', { 'Transition Completion': 40, 'Wipe Angle': 45, Feather: 30 }],
    ['ADBE Radial Wipe', { 'Transition Completion': 30, 'Start Angle': 0, 'Wipe Center': [150, 100], Wipe: 1, Feather: 0 }],
    ['ADBE Ramp', { 'Start of Ramp': [0, 0], 'Start Color': [1, 0, 0, 1], 'End of Ramp': [300, 200], 'End Color': [0, 0, 1, 1], 'Ramp Shape': 1, 'Ramp Scatter': 0, 'Blend With Original': 0 }],
    ['ADBE Geometry2', { 'Anchor Point': [150, 100], Position: [150, 100], 'Uniform Scale': 1, 'Scale Height': 70, 'Scale Width': 70, Skew: 20, 'Skew Axis': 0, Rotation: 15, Opacity: 100 }],
    ['ADBE Tint', { 'Map Black To': [0.2, 0, 0.4, 1], 'Map White To': [1, 0.9, 0.3, 1], 'Amount to Tint': 100 }],
    ['ADBE HUE SATURATION', { 'Channel Control': 1, 'Master Hue': 120, 'Master Saturation': 0, 'Master Lightness': 0, Colorize: 0 }],
    ['ADBE Drop Shadow', { 'Shadow Color': [0, 0, 0, 1], Opacity: 200, Direction: 135, Distance: 20, Softness: 15, 'Shadow Only': 0 }],
    ['ADBE Fractal Noise', { 'Fractal Type': 1, 'Noise Type': 2, Invert: 0, Contrast: 100, Brightness: 0, Complexity: 6, Evolution: 0, Opacity: 100, 'Blending Mode': 1 }],
    ['ADBE Venetian Blinds', { 'Transition Completion': 50, Direction: 30, Width: 25, Feather: 0 }],
    ['CC Light Sweep', { Center: [150, 100], Direction: -35, Shape: 2, Width: 40, 'Sweep Intensity': 80, 'Edge Intensity': 100, 'Edge Thickness': 2, 'Light Color': [1, 1, 1, 1], 'Light Reception': 1 }],
    ['ADBE Twirl', { Angle: 180, 'Twirl Radius': 60, 'Twirl Center': [150, 100] }],
    ['ADBE Wave Warp', { 'Wave Type': 1, 'Wave Height': 12, 'Wave Width': 50, Direction: 90, 'Wave Speed': 1, Pinning: 1, Phase: 0 }],
    ['ADBE Mosaic', { 'Horizontal Blocks': 12, 'Vertical Blocks': 8, 'Sharp Colors': 0 }],
    ['ADBE Bevel Alpha', { 'Edge Thickness': 8, 'Light Angle': -60, 'Light Color': [1, 1, 1, 1], 'Light Intensity': 0.6 }],
    ['ADBE Invert', { Channel: 1, 'Blend With Original': 0 }],
    ['ADBE Tile', { 'Tile Center': [150, 100], 'Tile Width': 40, 'Tile Height': 40, 'Output Width': 100, 'Output Height': 100, 'Mirror Edges': 1, Phase: 0, 'Horizontal Phase Shift': 0 }],
    ['ADBE Corner Pin', { 'Upper Left': [40, 20], 'Upper Right': [280, 0], 'Lower Left': [0, 200], 'Lower Right': [300, 160] }],
    ['ADBE Circle', { Center: [150, 100], Radius: 70, Edge: 1, Thickness: 10, 'Feather Outer Edge': 6, 'Feather Inner Edge': 0, 'Invert Circle': 0, Color: [1, 1, 0, 1], Opacity: 100, 'Blending Mode': 2 }],
  ];
  const layers = fx.map(([mn, params], i) => {
    const x = 210 + (i % 5) * 375, y = 150 + Math.floor(i / 5) * 260;
    return shapeLayer(x, y, [vgroup([rect(300, 200, 30), fill([0.15, 0.6, 0.9, 1]), ellipse(150, 150, [40, 0]), fill([1, 0.85, 0.2, 1])])], { name: mn, effects: [{ mn, params }] });
  });
  S.effects = scene([comp(1, 'effects', layers)], []);
}
{ // layer styles
  const st = [
    { dropShadow: { mode2: 5, color: [0, 0, 0, 1], opacity: 90, useGlobalAngle: 1, distance: 15, chokeMatte: 0, blur: 20 } },
    { innerShadow: { mode2: 5, color: [0, 0, 0, 1], opacity: 90, useGlobalAngle: 1, distance: 12, chokeMatte: 0, blur: 15 } },
    { outerGlow: { mode2: 11, opacity: 100, color: [1, 0.9, 0.2, 1], chokeMatte: 20, blur: 30 } },
    { innerGlow: { mode2: 11, opacity: 100, color: [1, 1, 1, 1], innerGlowSource: 2, chokeMatte: 0, blur: 25 } },
    { bevelEmboss: { bevelStyle: 2, strengthRatio: 150, bevelDirection: 1, blur: 15, useGlobalAngle: 1, highlightMode: 11, highlightColor: [1, 1, 1, 1], highlightOpacity: 90, shadowMode: 5, shadowColor: [0, 0, 0, 1], shadowOpacity: 90 } },
    { chromeFX: { mode2: 5, color: [0, 0, 0, 1], opacity: 60, localLightingAngle: 19, distance: 20, blur: 20, invert: 1 } },
    { solidFill: { mode2: 1, color: [0.9, 0.2, 0.3, 1], opacity: 70 } },
    { gradientFill: { mode2: 1, opacity: 100, gradient: { colorStops: [{ position: 0, color: [1, 0, 0] }, { position: 1, color: [0, 0, 1] }], alphaStops: [] }, angle: 90, type: 1, scale: 100, offset: [0, 0] } },
    { frameFX: { mode2: 1, color: [1, 1, 1, 1], size: 10, opacity: 100, style: 1 } },
    { frameFX: { mode2: 1, color: [1, 0.3, 0, 1], size: 12, opacity: 100, style: 2 }, dropShadow: { mode2: 5, color: [0, 0, 0, 1], opacity: 80, useGlobalAngle: 1, distance: 10, blur: 10 } },
  ];
  const layers = st.map((styles, i) => shapeLayer(260 + (i % 5) * 350, 300 + Math.floor(i / 5) * 400, [vgroup([star({ points: 5, ir: 60, or: 130 }), fill([0.2, 0.55, 0.95, 1])])], { name: Object.keys(styles).join('+'), styles }));
  S.styles = scene([comp(1, 'styles', layers)], []);
}
{ // 3D + camera + light
  const f = [solid(1, [0.9, 0.3, 0.2], 600, 400), solid(2, [0.2, 0.7, 0.9], 600, 400), solid(3, [0.9, 0.9, 0.9], 1600, 1600)];
  const layers = [
    layer({ name: 'Camera', type: 'camera', autoOrient: 'CAMERA_OR_POINT_OF_INTEREST', camera: { zoom: 1600 }, tf: { anchor: [960, 540, 0], pos: [1400, 300, -1500] } }),
    layer({ name: 'Light', type: 'light', lightType: 'POINT', light: { intensity: 120, color: [1, 0.95, 0.85, 1] }, tf: { pos: [700, 200, -600] } }),
    layer({ name: 'Ambient', type: 'light', lightType: 'AMBIENT', light: { intensity: 25 } }),
    solidLayer(1, 760, 540, { name: 'red rotY', threeD: true, w: 600, h: 400, tf: { ry: 35, pos: [700, 540, 0] } }),
    solidLayer(2, 1250, 540, { name: 'blue rotX', threeD: true, w: 600, h: 400, tf: { rx: -40, pos: [1250, 540, 200] }, effects: [{ mn: 'ADBE Ramp', params: { 'Start of Ramp': [0, 0], 'Start Color': [0, 0.2, 0.6, 1], 'End of Ramp': [600, 400], 'End Color': [0.6, 1, 1, 1], 'Ramp Shape': 1 } }] }),
    textLayer(960, 300, doc('3D TEXT', { size: 120, fill: [1, 1, 0.3] }), { threeD: true, tf: { ry: -25 } }),
    solidLayer(3, 960, 900, { name: 'floor', threeD: true, w: 1600, h: 1600, tf: { rx: 90, pos: [960, 900, 300] } }),
  ];
  S.threeD = scene([comp(1, '3d', layers)], f);
}
{ // shape modifiers
  const it = [
    [star({ points: 6, ir: 50, or: 110, iround: 60, oround: 30 }), fill([1, 0.6, 0.1, 1])],
    [rect(200, 200), ellipse(150, 150, [60, 60]), mod('ADBE Vector Filter - Merge', { 'ADBE Vector Merge Type': 4 }), fill([0.3, 0.8, 0.4, 1])],
    [rect(160, 160), mod('ADBE Vector Filter - Offset', { 'ADBE Vector Offset Amount': 25, 'ADBE Vector Offset Line Join': 2, 'ADBE Vector Offset Miter Limit': 4 }), fill([0.4, 0.5, 1, 1])],
    [star({ polygon: true, points: 6, or: 110 }), mod('ADBE Vector Filter - PB', { 'ADBE Vector PuckerBloat Amount': -60 }), fill([1, 0.3, 0.6, 1])],
    [ellipse(220, 220), mod('ADBE Vector Filter - Zigzag', { 'ADBE Vector Zigzag Size': 12, 'ADBE Vector Zigzag Detail': 6, 'ADBE Vector Zigzag Points': 1 }), stroke([1, 1, 1, 1], 4)],
    [rect(220, 60), mod('ADBE Vector Filter - Twist', { 'ADBE Vector Twist Angle': 160, 'ADBE Vector Twist Center': [0, 0] }), fill([0.9, 0.9, 0.2, 1])],
    [ellipse(200, 200), mod('ADBE Vector Filter - Roughen', { 'ADBE Vector Roughen Size': 10 }), fill([0.5, 0.9, 0.9, 1])],
    [rect(40, 40), fill([1, 1, 1, 1]), mod('ADBE Vector Filter - Repeater', { 'ADBE Vector Repeater Copies': 6, 'ADBE Vector Repeater Offset': 0, 'ADBE Vector Repeater Order': 1 })],
  ];
  // repeater transform lives in a subgroup
  it[7][2].children.push(group('ADBE Vector Repeater Transform', [prop('ADBE Vector Repeater Anchor', [0, 0]), prop('ADBE Vector Repeater Position', [45, 0]), prop('ADBE Vector Repeater Scale', [90, 90]), prop('ADBE Vector Repeater Rotation', 15), prop('ADBE Vector Repeater Opacity 1', 100), prop('ADBE Vector Repeater Opacity 2', 30)]));
  // roughen params are read by display name
  it[6][1].children = [prop('ADBE Vector Roughen Size', 10, { name: 'Size' }), prop('ADBE Vector Roughen Detail', 12, { name: 'Detail' }), prop('ADBE Vector Roughen Points', 1, { name: 'Points' })];
  const layers = it.map((items, i) => shapeLayer(260 + (i % 4) * 460, 300 + Math.floor(i / 4) * 480, [vgroup(items)], { name: `shape ${i}` }));
  S.shapes = scene([comp(1, 'shapes', layers)], []);
}
{ // text features
  const sel = (mn, ps) => group(mn, Object.entries(ps).map(([k, v]) => prop(k, v)));
  const animator = (selectors, props) => group('ADBE Text Animator', [group('ADBE Text Selectors', selectors, 'Selectors', { groupType: 'indexed' }), group('ADBE Text Animator Properties', Object.entries(props).map(([k, v]) => prop(k, v)))], 'Animator');
  const exprSel = group('ADBE Text Expressible Selector', [prop('ADBE Text Range Type2', 1), prop('ADBE Text Expressible Amount', [100, 100, 100], { expr: 'linear(textIndex, 1, textTotal, 0, 100)' })]);
  const wig = sel('ADBE Text Wiggly Selector', { 'ADBE Text Selector Mode': 1, 'ADBE Text Wiggly Max Amount': 100, 'ADBE Text Wiggly Min Amount': -100, 'ADBE Text Range Type2': 1, 'ADBE Text Temporal Freq': 2, 'ADBE Text Character Correlation': 0, 'ADBE Text Temporal Phase': 0, 'ADBE Text Spatial Phase': 0, 'ADBE Text Wiggly Lock Dim': 0, 'ADBE Text Wiggly Random Seed': 3 });
  const layers = [
    textLayer(960, 160, doc('EXPRESSION SELECTOR OPACITY', { size: 70 }), { text: { animators: [animator([exprSel], { 'ADBE Text Opacity': 0 })] } }),
    textLayer(960, 330, doc('WIGGLY POSITION', { size: 80, fill: [0.4, 1, 0.6] }), { text: { animators: [animator([wig], { 'ADBE Text Position 3D': [0, 30, 0], 'ADBE Text Rotation': 20 })] } }),
    textLayer(960, 500, doc('Fill over stroke', { size: 90, fill: [1, 1, 1], stroke: [1, 0, 0], sw: 14 }), { text: { order: 2 } }),
    textLayer(960, 650, doc('Mixed Runs Style', { size: 80, runs: [{ start: 0, end: 6, fillColor: [1, 0.3, 0.3], fontSize: 100 }, { start: 6, end: 11, fillColor: [0.3, 0.6, 1], fontSize: 60 }, { start: 11, end: 17, fillColor: [1, 1, 0.3], fontSize: 80 }] })),
    textLayer(0, 0, doc('TEXT ON A CURVED PATH  TEXT ON A CURVED PATH', { size: 48, just: 'LEFT_JUSTIFY', fill: [1, 0.8, 0.2] }), { text: { path: true },
      masks: [{ shape: { closed: false, vertices: [[300, 950], [960, 760], [1620, 950]], inTangents: [[0, 0], [-300, 0], [0, 0]], outTangents: [[0, 0], [300, 0], [0, 0]] } }] }),
  ];
  S.text = scene([comp(1, 'text', layers)], []);
}
{ // compositing: blend modes, luma matte, adjustment, echo, motion blur, collapse
  const f = [solid(1, [0.95, 0.5, 0.1], 1920, 1080), solid(2, [0.1, 0.4, 0.9], 400, 400), solid(3, [1, 1, 1], 400, 400), solid(4, [0.5, 0.5, 0.5], 1920, 1080)];
  const inner = comp(2, 'inner', [shapeLayer(100, 100, [vgroup([star({ points: 5, ir: 20, or: 50 }), fill([1, 1, 0, 1])])], { name: 'tiny star' })], 200, 200);
  const grad = layer({ name: 'luma src', type: 'shape', shape: [vgroup([rect(400, 400), fill([1, 1, 1, 1])])], tf: { pos: [300, 300, 0] }, effects: [{ mn: 'ADBE Ramp', params: { 'Start of Ramp': [-200, 0], 'Start Color': [0, 0, 0, 1], 'End of Ramp': [200, 0], 'End Color': [1, 1, 1, 1], 'Ramp Shape': 1 } }] });
  const layers = [
    layer({ name: 'adjust', adjustment: true, sourceId: 4, sourceKind: 'footage', w: 1920, h: 1080, tf: { anchor: [960, 540, 0], pos: [1500, 540, 0] }, effects: [{ mn: 'ADBE HUE SATURATION', params: { 'Channel Control': 1, 'Master Hue': 0, 'Master Saturation': -100, 'Master Lightness': 0 } }] }),
    grad,
    solidLayer(2, 300, 300, { name: 'luma matted', w: 400, h: 400, matte: 'LUMA' }),
    solidLayer(3, 800, 300, { name: 'silhouette (hole through layers below)', w: 400, h: 400, blend: 'SILHOUETE_ALPHA', masks: [{ shape: { closed: true, vertices: [[200, 0], [400, 200], [200, 400], [0, 200]], inTangents: [[0, 0], [0, 0], [0, 0], [0, 0]], outTangents: [[0, 0], [0, 0], [0, 0], [0, 0]] } }] }),
    shapeLayer(1300, 300, [vgroup([rect(300, 300), fill([0.5, 0.2, 0.9, 1])])], { name: 'linear light', blend: 'LINEAR_LIGHT' }),
    shapeLayer(0, 800, [vgroup([ellipse(120, 120), fill([1, 1, 1, 1])])], { name: 'echo + motion blur', motionBlur: true, tf: { posKeys: [[0, [200, 800, 0]], [1, [1700, 800, 0]]] }, effects: [{ mn: 'ADBE Echo', params: { 'Echo Time (seconds)': -0.05, 'Number Of Echoes': 4, 'Starting Intensity': 1, Decay: 0.6, 'Echo Operator': 1 } }] }),
    layer({ name: 'collapsed 4x', sourceId: 2, sourceKind: 'comp', w: 200, h: 200, collapse: true, tf: { anchor: [100, 100, 0], pos: [1500, 850, 0], scale: [250, 250, 100] } }),
    layer({ name: 'bg', sourceId: 1, sourceKind: 'footage', w: 1920, h: 1080, tf: { anchor: [960, 540, 0], pos: [960, 540, 0] } }),
  ];
  S.composite = scene([comp(1, 'composite', layers, 1920, 1080, { motionBlurEnabled: true, shutterAngle: 180, shutterPhase: -90, motionBlurSamples: 16 }), inner], f);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const out = process.argv[2] || '.';
  fs.mkdirSync(out, { recursive: true });
  for (const [k, v] of Object.entries(S)) fs.writeFileSync(path.join(out, `${k}.scene.json`), JSON.stringify(v));
  console.log('wrote', Object.keys(S).join(', '));
}
