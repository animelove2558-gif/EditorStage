# MOGRT pipeline - shared contracts

A `.mogrt` is a ZIP: `definition.json` (controls), `project.aegraphic` (a nested ZIP holding an After Effects `.aep`
project + `(Footage)/` media + optional fonts), `thumb.png`, optional `thumb.mp4` (Adobe-rendered preview).
Premiere renders the template with After Effects' engine. EditorStage re-implements that in JavaScript:

```
.aep bytes ──(1) aep reader──▶ Scene JSON ──(2) evaluator(+expression engine)──▶ ResolvedFrame ──(3) painter──▶ canvas
```

(1) and (2) are plain ES modules, **no Node-only APIs** (they run in the Electron renderer / browser): use
`Uint8Array`, `DataView`, `TextDecoder`. No `eval` / `new Function` (CSP forbids them).

Reference implementation for the file format and for the *semantics* of every property: the Python package `py_aep`
(installed; source in `C:\Users\wachi\AppData\Local\Python\pythoncore-3.14-64\Lib\site-packages\py_aep`,
`from py_aep import parse; project = parse(path).project`). Use it as the oracle: the JS reader must produce the same
values py_aep reports (`Property.value`, `.keyframes`, `.expression`, `layer.in_point` ...).

Sample projects (extracted from real templates), each `…\ae\*.aep`:
`%TEMP%\mogrt_inspect\{steam,rank,sntb,lower}\ae\` (e.g. `steam\ae\544.aep`, `lower\ae\01-03.45 Lower Third Title V.45.aep`).
Matching Adobe-rendered previews: `%TEMP%\mogrt_inspect\<name>\out\thumb.mp4` (not for `lower`) and `thumb.png`.

## 1. Scene JSON (output of the aep reader)

All times are **seconds** (floats). Colors are `[r,g,b,a]` in 0..1. Points/sizes are in pixels unless stated.

```
Scene {
  version: 1,
  comps:   Comp[],
  footage: Footage[],
  folders?: ignored,
  usedFonts: string[],
  expressionEngine: 'javascript-1.0' | 'extendscript' | string,   // from the project
}
Comp {
  id: number, name: string, width, height, pixelAspect, frameRate, duration, displayStartTime,
  bgColor: [r,g,b],
  workAreaStart, workAreaDuration,
  layers: Layer[],                    // AE order: layers[0] is index 1 = TOP-most layer
  markers: { time, duration, comment, label }[],
  essentialControllers: Controller[], // properties exposed in the Essential Graphics panel
}
Footage {
  id, name, kind: 'file'|'solid'|'placeholder',
  path: string,         // as stored in the project (file name / relative path); '' if none
  width, height, duration, frameRate, hasVideo, hasAudio,
  color?: [r,g,b]       // solids
}
Layer {
  id, index (1-based), name,
  type: 'av'|'text'|'shape'|'camera'|'light'|'3dmodel'|'mesh',
  sourceId: number|null, sourceKind: 'footage'|'comp'|null,     // 'comp' = precomp
  width, height,                         // layer source size
  inPoint, outPoint, startTime, stretch, // stretch in percent
  parentId: number|null,
  enabled, solo, shy, locked, nullLayer, adjustmentLayer, threeD, collapseTransformation,
  guideLayer, motionBlur, timeRemapEnabled, autoOrient: 'NO_AUTO_ORIENT'|'ALONG_PATH'|'CAMERA_OR_POINT_OF_INTEREST'|'CHARACTERS_TOWARD_CAMERA',
  blendMode: 'NORMAL'|'MULTIPLY'|'SCREEN'|'OVERLAY'|... (py_aep BlendingMode names),
  trackMatteType: 'NO_TRACK_MATTE'|'ALPHA'|'ALPHA_INVERTED'|'LUMA'|'LUMA_INVERTED',
  matteLayerId: number|null,             // explicit matte layer (AE >= 23); else the layer directly above when trackMatteType != NO_TRACK_MATTE
  essentialPropertyUuids: string[],
  properties: Node[],                    // top-level property groups, exactly the AE property tree
}
Node =
  | { kind:'group', matchName, name, enabled, groupType:'named'|'indexed', children: Node[] }
  | { kind:'prop',  matchName, name, enabled, valueType, controlType?, dimensions, isSpatial,
      value,                    // static value, or (animated) the value at the first key
      keyframes: Key[],         // [] when not animated
      expression: string|null, expressionEnabled: boolean,
      min?, max?, dropdownItems?: string[], dimensionsSeparated?: boolean }
valueType: 'ONE_D'|'TWO_D'|'THREE_D'|'COLOR'|'SHAPE'|'TEXT_DOCUMENT'|'GRADIENT'|'MARKER'|'LAYER_INDEX'|'MASK_INDEX'|'CUSTOM'|'NO_VALUE'
controlType (effect parameters only): 'SLIDER'|'CHECKBOX'|'COLOR'|'POINT'|'POINT3D'|'ANGLE'|'DROPDOWN'|'LAYER'|'NO_CONTROL'|...
Values:
  ONE_D number · TWO_D [x,y] · THREE_D [x,y,z] · COLOR [r,g,b,a]
  SHAPE { closed:boolean, vertices:[x,y][], inTangents:[x,y][], outTangents:[x,y][] }   // tangents relative to vertex (AE Shape object)
  TEXT_DOCUMENT { text, font, fontFamily, fontStyle, fontSize, fillColor:[r,g,b], strokeColor:[r,g,b], strokeWidth,
                  applyFill, applyStroke, strokeOverFill, justification:'LEFT_JUSTIFY'|'CENTER_JUSTIFY'|'RIGHT_JUSTIFY'|'FULL_JUSTIFY_*',
                  tracking, leading, autoLeading, baselineShift, horizontalScale, verticalScale, tsume, fauxBold, fauxItalic,
                  allCaps, smallCaps, superscript, subscript, boxText, boxTextSize:[w,h], boxTextPos:[x,y], pointText }
  GRADIENT { type:'LINEAR'|'RADIAL', colorStops:[{position,color:[r,g,b]}], alphaStops:[{position,alpha}] }  (best effort)
Key {
  time,                                   // comp-time seconds (like ExtendScript keyTime)
  value,
  inInterpolation, outInterpolation: 'LINEAR'|'BEZIER'|'HOLD',
  inTemporalEase, outTemporalEase: {speed, influence}[],      // one entry per dimension (influence in percent, like ExtendScript)
  spatialInTangent?, spatialOutTangent?: number[],            // spatial props only
  temporalContinuous, temporalAutoBezier, spatialContinuous, spatialAutoBezier, roving
}
Controller {            // one Essential Graphics control (Comp.essentialControllers)
  uuid, name, type: string,            // 'checkbox'|'slider'|'color'|'text'|'point'|'angle'|'dropdown'|'media'|'comp'|'group'|...
  layerId: number|null, propertyPath: string[]|null,   // how to find the exposed property: layer id + chain of (matchName | child index)
  defaultValue, min?, max?, dropdownItems?, groupName?
}
```

Property match names are the standard AE ones (`ADBE Transform Group` > `ADBE Position`, `ADBE Effect Parade` > `ADBE Slider Control`
> `ADBE Slider Control-0001`, `ADBE Text Properties` > `ADBE Text Document`, `ADBE Root Vectors Group`, `ADBE Vector Group`,
`ADBE Vector Shape - Rect`, `ADBE Vector Graphic - Fill`, `ADBE Mask Parade` > `ADBE Mask Atom` > `ADBE Mask Shape`, ...).

## 2. Evaluator API (`src/Services/mogrt/evaluator.js`)

```js
import { createEvaluator } from './evaluator.js';
const ev = createEvaluator(scene, {
  controls: { [uuid]: value },        // Essential Graphics overrides; checkbox -> boolean, slider -> number, color -> [r,g,b,a],
                                      // text -> string, point -> [x,y], dropdown -> index, media -> footage id / name
  footageSize?: (footageId) => ({ width, height })   // optional, for replaced media
});
const frame = ev.evaluateComp(compId, timeSeconds);   // ResolvedFrame
```

```
ResolvedFrame { compId, name, width, height, bgColor:[r,g,b], time, layers: ResolvedLayer[] }   // layers[0] = BOTTOM-most layer (paint order)
ResolvedLayer {
  id, index, name, parentId,
  kind: 'footage'|'solid'|'text'|'shape'|'precomp'|'null'|'adjustment',
  visible: boolean,                    // enabled && comp time within [inPoint,outPoint) (solo handling applied) && opacity>0
  opacity: 0..1,
  blendMode: string,
  matrix: [a,b,c,d,e,f],               // 2D affine: layer-space (origin = top-left of the layer's own width x height box) -> comp pixels,
                                       //   already includes anchor, position, scale, rotation (+orientation z) and the full parent chain
  width, height,                       // layer box
  source?: { footageId, time, color? },// time = seconds inside the footage after stretch / time remap
  masks: { shape:{closed,vertices,inTangents,outTangents}, mode:'ADD'|'SUBTRACT'|'INTERSECT'|'LIGHTEN'|'DARKEN'|'DIFFERENCE'|'NONE', inverted, opacity, feather:[x,y], expansion }[],
  effects: { matchName, name, enabled, params: { [displayName]: value } }[],       // already evaluated (keyframes + expressions)
  layerStyles?: { dropShadow?, innerShadow?, outerGlow?, innerGlow?, bevelEmboss?, satin?, colorOverlay?, gradientOverlay?, stroke? },   // evaluated params
  trackMatte?: { type, layerId },      // the layer whose alpha/luma masks this layer
  isTrackMatte: boolean,               // layer is only used as a matte (hidden from output)
  text?: { document: <TEXT_DOCUMENT evaluated at t>, animators: ResolvedAnimator[], pathOptions?: {...} },
  shape?: { items: ShapeItem[] },      // evaluated vector contents, see below
  precomp?: { frame: ResolvedFrame },  // evaluated at the precomp's own time (stretch/start/time remap applied)
  collapseTransformation: boolean,
}
ShapeItem =
  | { type:'group', name, items: ShapeItem[], transform:{ anchor:[x,y], position:[x,y], scale:[sx,sy] (percent), rotation:deg, skew, skewAxis, opacity:0..1 }, blendMode }
  | { type:'path',    closed, vertices, inTangents, outTangents }
  | { type:'rect',    size:[w,h], position:[x,y], roundness, direction }
  | { type:'ellipse', size:[w,h], position:[x,y], direction }
  | { type:'star',    starType:'star'|'polygon', points, position, rotation, innerRadius, outerRadius, innerRoundness, outerRoundness }
  | { type:'fill',    color:[r,g,b,a], opacity:0..1, rule:'nonzero'|'evenodd', blendMode }
  | { type:'gradientFill', gradient, startPoint, endPoint, gradientType, opacity, rule, highlightLength, highlightAngle }
  | { type:'stroke',  color, opacity, width, cap:'butt'|'round'|'square', join:'miter'|'round'|'bevel', miterLimit, dashes:[{kind:'dash'|'gap'|'offset', value}] }
  | { type:'gradientStroke', ... }
  | { type:'trim',    start:0..100, end:0..100, offset:deg, mode:'simultaneous'|'individual' }
  | { type:'repeater',copies, offset, anchor, position, scale, rotation, startOpacity, endOpacity, composite:'above'|'below' }
  | { type:'merge', mode }  | { type:'roundCorners', radius } | { type:'offsetPaths', amount, lineJoin, miterLimit } | { type:'puckerBloat', amount } | { type:'zigzag', ... } | { type:'twist', angle, center }
ResolvedAnimator { selectors: {type:'range', start, end, offset, units:'percent'|'index', basedOn:'characters'|'words'|'lines'|..., mode:'add'|'subtract'|..., amount, shape, easeHigh, easeLow, randomize, randomSeed, smoothness}[],
                   properties: { position?, anchorPoint?, scale?, skew?, rotation?, opacity?, fillColor?, strokeColor?, strokeWidth?, tracking?, lineAnchor?, lineSpacing?, characterOffset?, blur?, ... } }
```

Expressions are AE expressions (ExtendScript/JavaScript ES5 syntax with the AE API). They run in a tree-walking interpreter
(`acorn` parser, no eval). `value` inside an expression is the property's pre-expression value (keyframes already applied);
control overrides replace the *base value* of the exposed property before its expression runs.

## 3. Painter

`src/Services/mogrt/painter.js` consumes `ResolvedFrame` (+ decoded footage) and draws to an offscreen canvas that EditorStage's WebGL compositor uses as a clip source.

- Plain 2D layers draw straight into comp space. Layers with effects, layer styles, echoes or 3D are rendered in their own LAYER space
  (where AE applies them; buffer bounded by content / viewport / effect reach), then transformed in (affine, or a WebGL perspective warp for 3D, with flat lighting).
  Shape/text layers use a comp-sized box centred on the layer origin as "the layer" for size-relative effects (Motion Tile, Twirl radius, Corner Pin ...).
- `fx/gl.js` WebGL2 runner; `fx/effects.js` ~90 AE effects (params by English display name, `<matchName>-NNNN` index fallback; Effect Opacity honoured);
  `fx/styles.js` all layer styles; `fx/blend.js` every AE blending mode (Canvas ops where exact, a shader for linear/vivid/pin light, hard mix, darker/lighter colour,
  subtract, divide, dissolve, stencil/silhouette alpha/luma, alpha add, luminescent premul).
- Masks: modes, inverted, opacity, feather, expansion (+/-); open masks never cut alpha. Track mattes alpha/luma (+inverted, matte opacity). Adjustment layers, Collapse Transformations.
- Motion blur: `paintWithMotionBlur()` samples only layers with the switch across the comp shutter (angle/phase/samples).
- `shapes.js`: all shape items incl. Merge Paths / Offset Paths (clipper-lib), Pucker & Bloat, Zig Zag, Twist, Roughen, Wiggle Paths, Repeater, rounded stars.
- `text.js`: per-run styles, paragraph runs, box text (first baseline = glyph ascent), Fill & Stroke order, every animator property, range/wiggly/expression selectors, path text.
- Footage (`footage.js`): images, SVG, PSD/PSB (`psd.js`), AI/PDF/EPS (pdf.js), video (blob URLs, frame-seeked), FFmpeg fallback for other formats, audio (`audio.js`: live + export mix).

Tests: `node scripts/mogrt/test_features.mjs` (evaluator features on synthetic scenes); visual checks: `scripts/mogrt/synthetic_scenes.mjs` /
`footage_test_scene.mjs` / `pack_mogrt.mjs` produce scenes / packed templates for the `dist/mogrt-test.html` harness (`window.__mt.load|loadScene|loadSceneDir|paint|e2e`).

## Late additions (renderer completion)

Reader: `TEXT_DOCUMENT.styleRuns` / `paraRuns` (per-run character / paragraph styles, UTF-16 spans, only when runs differ), `Comp.motionBlurEnabled|shutterAngle|shutterPhase|motionBlurSamples`, `Layer.lightType`.
Evaluator: `ResolvedLayer.threeD {mv (4x4 camera space), zoom, cx, cy, depth, lighting:{mul,add}|null}` (3D layers; adjacent 3D layers are depth sorted; `matrix` = affine approximation),
`motionBlur`, `echo {operator, startingIntensity, copies:[{layer, intensity}]}`, `effects[].effectOpacity`; Posterize Time quantises content time;
`text.pathOptions {path, reverse, perpendicular, forceAlignment, firstMargin, lastMargin}`, `text.moreOptions {anchorGrouping, groupingAlignment, renderOrder, characterBlendMode}`,
wiggly selectors are structured (`time` included), expression selectors carry `amounts[]` (per unit, `textIndex`/`textTotal`/`selectorValue` available to the expression);
precomp-layer Essential Properties (`ADBE Layer Overrides`) are applied (scoped per instance; explicit controls win);
`ResolvedFrame.audio [{footageId, time, gainDb, key, rate}]` and `ResolvedFrame.motionBlur {shutterAngle, shutterPhase, samples}|null`;
expression API `toComp/fromComp/toWorld/fromWorld(Vec)` are 3D-aware for 3D layers.

## Reader additions

Fields ADDED by the aep reader (never renamed/removed from section 1):

- `Comp.markers[]` and `Layer.markers[]` (same shape): `{ time, duration, comment, label, protectedRegion }`. `protectedRegion` (boolean) marks Responsive Design - Time regions. `time` = comp-time seconds (layer markers: comp time like keyTime).
- `Node.synthetic: true` on property/group nodes that were not stored in the file but synthesized by py_aep from defaults (the oracle only; the JS reader synthesizes just effect parameters from parT/pard defaults, flagged the same way). Absent node == AE default.
- `Controller.controllerType` (raw AE id: 1 checkbox, 2 slider, 4 color, 5 point, 6 text, 8 comment, 10 group, 13 dropdown, 14 media), `Controller.value`, `Controller.sourcePath` (raw `[{matchName,index}]`), `Controller.groupName`.
- `Controller.propertyPath` elements: a string = matchName (child of a named group or an effect parameter leaf); a number = 0-based index into `children` of an INDEXED group (effect in the Effect Parade, mask atom, shape group, text animator). Media controllers: `['ADBE Source Options Group','ADBE Layer Source Alternate']`.
- `Gradient` values also carry `midpoint` on stops; `type` is null (it is a separate sibling property).
- `usedFonts` = PostScript names.

## Evaluator additions

Files: `src/Services/mogrt/evaluator.js`, `src/Services/mogrt/expr/{interp,aeapi,anim,vecmath}.js` (pure ES modules, `acorn` is the only dependency).
Tests: `node scripts/mogrt/test_expressions.mjs`, `test_evaluator.mjs [name] [times] [--v]`, `test_controls.mjs`.

API (superset of section 2):
```js
const ev = createEvaluator(scene, { controls, footageSize, measureText, onExpressionError, onError });
ev.evaluateComp(compId, t, controlsOverride?)   // controlsOverride replaces the current controls for this call (and later calls)
ev.setControls(obj)                              // replace controls (cheap; only rebuilds the uuid -> node override map)
ev.getFootageForController(uuid)                 // Footage object currently selected by a media controller, or null
ev.controllerNodes                               // Map uuid -> { node, ctl, layerRT, comp }
```
- `measureText(doc) -> { width, height, lineHeight, ascent, lines }` (optional): used by `sourceRectAtTime` expressions on text layers; default is a rough heuristic (0.55 em per char). Supply a canvas-based one from the painter for accurate auto-sizing boxes.
- Controls values: checkbox boolean -> 0/1; slider/angle number; color [r,g,b,a] (or `#rrggbb`, `{r,g,b}`); point [x,y] or {x,y}; text string; dropdown number; media `{footageId}` | footage id | footage name (also changes `layer.source.footageId` and, if `footageSize` is given, the layer box).
  Controller property paths: string = matchName, number = 0-based child index (as emitted by aep_to_scene.py). Controllers of every comp (also precomps) are resolved, so overrides work inside precomps; the Essential-Properties override group of a *precomp layer* (`ADBE Layer Overrides` / `essentialPropertyUuids`) is NOT applied (limitation).
- Extra ResolvedLayer fields: effects[].paramsByMatchName; layerStyles.globalAngle/globalAltitude; layerStyles keys are the AE `<style>/<param>` suffixes (`dropShadow.localLightingAngle`, `distance`, `blur`, `chokeMatte`, `opacity` (0..100), `color`, `mode2` ...); `stroke` = frameFX, `satin` = chromeFX, `colorOverlay` = solidFill, `gradientOverlay` = gradientFill. Only styles whose group `enabled` is true are emitted.
- Effect params: checkbox -> 0/1, dropdown -> index, color -> [r,g,b,a], layer -> layer index number; built-in effect values are in AE units (Drop Shadow opacity is 0..255, as in AE).
- ResolvedLayer extras: `masks[].name`, `masks[].opacity` is 0..1; `kind:'null'/'adjustment'` have only matrix/opacity/(masks,effects for adjustment). Camera/light/3D layers are omitted from `layers`. A layer with `guideLayer` is `visible:false`. Track-matte layers are fully evaluated; `visible` ignores their `enabled` flag; `isTrackMatte:true`.
- Shape items are in AE order (first = top-most); path/rect/ellipse/star items have `name` and `direction`. Dashes are only emitted when a dash/gap/offset differs from the AE default (10/10/10/0) or is animated (the reader exposes the default dash group on every stroke). `trim.start/end` are percent, `repeater.offset` copies, `merge.mode` in `merge|add|subtract|intersect|excludeIntersections`.
- Text: `text.document` = the TEXT_DOCUMENT at t (text override applied). Layer matrix origin for text/shape layers is the AE layer origin (text baseline start/centre/end per `justification`; shape contents origin), the painter draws at (0,0). Animator `properties` only contain properties that are animated/expressed or differ from the AE default (the reader emits every possible animator property); opacities are 0..1; `selectors[]` follow the schema (`units` 'percent'|'index', `basedOn` 'characters'|'charactersExcludingSpaces'|'words'|'lines', `mode` add|subtract|intersect|min|max|difference, `shape` square|rampUp|rampDown|triangle|round|smooth); wiggly/expression selectors are emitted as `{type:'wiggly'|'expression', params}` (not evaluated).
- Masks: the reader currently emits no mask mode / inverted flag. The evaluator reads `maskMode` (string `ADD|SUBTRACT|INTERSECT|LIGHTEN|DARKEN|DIFFERENCE|NONE` or AE int) and `inverted` (bool) from the `ADBE Mask Atom` group node if present, otherwise defaults to ADD / not inverted. **Reader request: add `maskMode`, `inverted` (and `locked`) to Mask Atom group nodes.**
- Expression engine limits: no regex literals, no classes/generators/async, no `eval`/`Function`; 300k interpreter steps per expression; recursion depth 48 between expression-driven properties (cycle => un-expressed value). Random/noise/wiggle are deterministic but not bit-exact with AE's generators. Roving keyframes use their stored time/ease. `sampleImage`, `footage().sourceData`, text `animator()` expression access, 3D (lookAt only approximated, toWorld = toComp) are unsupported/minimal.

- `ADBE Mask Atom` group nodes also carry `maskMode`, `inverted`, `locked`, `color` [r,g,b], `rotoBezier` (and the same inside a `mask` object plus raw `motionBlur` / `featherFalloff` ints).


## Reader additions (final aep reader)

`src/Services/mogrt/aep/index.js` exports `parseAep(uint8array) -> Scene` (pure ES modules, no Node APIs, no eval; ~40-90 ms for the sample templates).
Files: `chunks.js` (RIFX tree), `properties.js` (property tree, keyframes), `effects.js` (parT/pard parameter definitions), `shapes.js`, `text.js` (btdk/COS text documents),
`synth.js` + `specData.js` (default-property synthesis; `specData.js` is generated by `scripts/mogrt/gen_aep_specs.py`), `matchNames.js` (generated name table).
Unknown chunks / properties are skipped (problems collected in the non-enumerable `scene._warnings`); only a non-RIFX input throws.

- `ADBE Mask Atom` group nodes carry `maskMode` ('NONE'|'ADD'|'SUBTRACT'|'INTERSECT'|'LIGHTEN'|'DARKEN'|'DIFFERENCE'), `inverted`, `locked`, `color` [r,g,b], `rotoBezier`, and a `mask` object with the same values plus raw `motionBlur` / `featherFalloff` ints (from the `mkif` chunk / py_aep `MaskPropertyGroup`).
- `Comp.markers[]` / `Layer.markers[]`: `{ time, duration, comment, label, protectedRegion }` (`protectedRegion` = Responsive Design - Time region, `NmHd` flag bit 1; `time` = comp seconds).
  The `MARKER` keyframe values inside the `ADBE Marker` property are the same object shape with `time: null` (the key's `time` holds the time).
- Synthetic nodes: like py_aep/ExtendScript the reader emits the full default property set of a layer (Transform children, Layer Styles, Material Options, Text/Shape/Mask/Selector defaults, Effect "Compositing Options" ...) with `synthetic: true` when the file does not store them. Camera/Light default Position/Zoom are approximated as the comp centre / zero.
- Controllers (`comp.essentialControllers`): `value`/`defaultValue`/`min`/`max` come from the raw `CVal`/`CDef`/`Smin`/`Smax` chunks; `propertyPath` is resolved against the emitted tree (number = child index of an INDEXED group, string = matchName); `sourcePath` keeps the raw path.
- `usedFonts` = PostScript names of fonts referenced by text documents; `expressionEngine` defaults to `'extendscript'` when the project has no `ExEn` list.

Verification: `node scripts/mogrt/compare_scene.mjs test-assets/mogrt/<name>/project.aep` diffs the JS reader against `scene.oracle.json` (float tolerance 1e-6, undefined == null, `--group` for a compact summary, `--ignore-synthetic`); all four samples: 0 mismatches.
`MOGRT_SCENE=js node scripts/mogrt/test_evaluator.mjs` / `test_controls.mjs` run the evaluator tests on the JS reader's output (default: the oracle JSON, via `scripts/mogrt/load_scene.mjs`).
Known approximations: camera/light synthetic defaults; Linear-interpolation speed of spatial (motion path) keyframes uses the chord length instead of the arc length; roving key times are the stored ones; sequences/proxy footage paths are best effort; media metadata of PSD/AI sub-layers is not decoded.
