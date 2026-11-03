// Video presets (built-in), written for EditorStage. Keyframes: { keys: [{ t, v, interp? }] } with t in seconds of `dur`;
// type 'anchorIn' keeps the times from the clip start, 'anchorOut' from the clip end, 'scale' stretches them over the clip.
const K = (...pairs) => ({ keys: pairs.map(([t, v, interp]) => ({ t, v, ...(interp ? { interp } : {}) })) });
const fx = (name, params = {}) => ({ name, category: 'Video', params });
const P = (folder, name, body, tags = []) => ({ id: `video/${folder.join('/')}/${name}`, name, folder: ['Video', ...folder], media: 'video', tags, ...body });

// ---------- Picture in Picture ----------
const SPOTS = [['Top Left', 0, 0], ['Top Center', 1, 0], ['Top Right', 2, 0], ['Middle Left', 0, 1], ['Center', 1, 1], ['Middle Right', 2, 1], ['Bottom Left', 0, 2], ['Bottom Center', 1, 2], ['Bottom Right', 2, 2]];
const spot = (sz, ix, iy, m = 0.03) => [ix === 1 ? 0.5 : ix === 0 ? sz / 2 + m : 1 - sz / 2 - m, iy === 1 ? 0.5 : iy === 0 ? sz / 2 + m * 16 / 9 : 1 - sz / 2 - m * 16 / 9];
const pips = [25, 33, 50].flatMap((pct) => SPOTS.map(([n, ix, iy]) => P(['PiPs', `${pct}%`], `PiP ${pct}% ${n}`, { motion: { scale: pct, position: spot(pct / 100, ix, iy) } }, ['pip', 'picture in picture'])));
const pipSlides = [['Top Left', 0, 0, -1], ['Top Right', 2, 0, 1], ['Bottom Left', 0, 2, -1], ['Bottom Right', 2, 2, 1]].flatMap(([n, ix, iy, side]) => {
  const at = spot(0.25, ix, iy), off = [side < 0 ? -0.2 : 1.2, at[1]];
  return [P(['PiPs', 'Slides'], `PiP 25% ${n} Slide In`, { type: 'anchorIn', dur: 0.6, motion: { scale: 25, position: K([0, off, 'easeOut'], [0.6, at]) } }, ['pip', 'slide', 'in']),
    P(['PiPs', 'Slides'], `PiP 25% ${n} Slide Out`, { type: 'anchorOut', dur: 0.6, motion: { scale: 25, position: K([0, at, 'easeIn'], [0.6, off]) } }, ['pip', 'slide', 'out'])];
});

// ---------- Motion ----------
const DIRS = [['Left', [-0.5, 0.5]], ['Right', [1.5, 0.5]], ['Top', [0.5, -0.5]], ['Bottom', [0.5, 1.5]]];
const motion = [
  P(['Motion', 'Zoom'], 'Slow Zoom In', { type: 'scale', dur: 5, motion: { scale: K([0, 100], [5, 115]) } }, ['zoom', 'ken burns']),
  P(['Motion', 'Zoom'], 'Slow Zoom Out', { type: 'scale', dur: 5, motion: { scale: K([0, 115], [5, 100]) } }, ['zoom', 'ken burns']),
  P(['Motion', 'Zoom'], 'Fast Zoom In', { type: 'anchorIn', dur: 0.5, motion: { scale: K([0, 160, 'easeOut'], [0.5, 100]) } }, ['zoom', 'in']),
  P(['Motion', 'Zoom'], 'Fast Zoom Out', { type: 'anchorOut', dur: 0.5, motion: { scale: K([0, 100, 'easeIn'], [0.5, 160]) } }, ['zoom', 'out']),
  P(['Motion', 'Zoom'], 'Punch In 120%', { motion: { scale: 120 } }, ['zoom', 'punch']),
  P(['Motion', 'Zoom'], 'Punch In 150%', { motion: { scale: 150 } }, ['zoom', 'punch']),
  P(['Motion', 'Zoom'], 'Zoom From Zero', { type: 'anchorIn', dur: 0.4, motion: { scale: K([0, 0, 'easeOut'], [0.4, 100]) } }, ['zoom', 'in']),
  P(['Motion', 'Zoom'], 'Zoom To Zero', { type: 'anchorOut', dur: 0.4, motion: { scale: K([0, 100, 'easeIn'], [0.4, 0]) } }, ['zoom', 'out']),
  P(['Motion', 'Pop'], 'Pop In', { type: 'anchorIn', dur: 0.35, motion: { scale: K([0, 0, 'easeOut'], [0.25, 110, 'easeInOut'], [0.35, 100]) } }, ['pop', 'bounce', 'in']),
  P(['Motion', 'Pop'], 'Pop Out', { type: 'anchorOut', dur: 0.35, motion: { scale: K([0, 100, 'easeInOut'], [0.1, 110, 'easeIn'], [0.35, 0]) } }, ['pop', 'out']),
  P(['Motion', 'Spin'], 'Spin In', { type: 'anchorIn', dur: 0.7, motion: { rotation: K([0, -360, 'easeOut'], [0.7, 0]), scale: K([0, 0, 'easeOut'], [0.7, 100]) } }, ['spin', 'rotate', 'in']),
  P(['Motion', 'Spin'], 'Spin Out', { type: 'anchorOut', dur: 0.7, motion: { rotation: K([0, 0, 'easeIn'], [0.7, 360]), scale: K([0, 100, 'easeIn'], [0.7, 0]) } }, ['spin', 'rotate', 'out']),
  P(['Motion', 'Spin'], 'Slow Rotate', { type: 'scale', dur: 5, motion: { rotation: K([0, -3], [5, 3]), scale: 108 } }, ['rotate']),
  P(['Motion', 'Spin'], 'Tilt Left 5°', { motion: { rotation: -5, scale: 110 } }, ['rotate', 'tilt']),
  P(['Motion', 'Spin'], 'Tilt Right 5°', { motion: { rotation: 5, scale: 110 } }, ['rotate', 'tilt']),
  ...DIRS.map(([n, off]) => P(['Motion', 'Slide'], `Slide In From ${n}`, { type: 'anchorIn', dur: 0.5, motion: { position: K([0, off, 'easeOut'], [0.5, [0.5, 0.5]]) } }, ['slide', 'in'])),
  ...DIRS.map(([n, off]) => P(['Motion', 'Slide'], `Slide Out To ${n}`, { type: 'anchorOut', dur: 0.5, motion: { position: K([0, [0.5, 0.5], 'easeIn'], [0.5, off]) } }, ['slide', 'out'])),
  P(['Motion', 'Slide'], 'Drop In', { type: 'anchorIn', dur: 0.6, motion: { position: K([0, [0.5, -0.5], 'easeIn'], [0.45, [0.5, 0.52], 'easeOut'], [0.6, [0.5, 0.5]]) } }, ['drop', 'bounce', 'in']),
  P(['Motion', 'Slide'], 'Rise Up', { type: 'anchorIn', dur: 0.6, motion: { position: K([0, [0.5, 0.6], 'easeOut'], [0.6, [0.5, 0.5]]) }, opacity: { opacity: K([0, 0], [0.6, 100]) } }, ['rise', 'in']),
  ...[['Left', [0.56, 0.5], [0.44, 0.5]], ['Right', [0.44, 0.5], [0.56, 0.5]], ['Up', [0.5, 0.56], [0.5, 0.44]], ['Down', [0.5, 0.44], [0.5, 0.56]], ['Up Left', [0.56, 0.56], [0.44, 0.44]], ['Up Right', [0.44, 0.56], [0.56, 0.44]], ['Down Left', [0.56, 0.44], [0.44, 0.56]], ['Down Right', [0.44, 0.44], [0.56, 0.56]]]
    .map(([n, a, b]) => P(['Motion', 'Ken Burns'], `Ken Burns Pan ${n}`, { type: 'scale', dur: 5, motion: { scale: 115, position: K([0, a, 'easeInOut'], [5, b]) } }, ['ken burns', 'pan'])),
  P(['Motion', 'Fades'], 'Fade In', { type: 'anchorIn', dur: 0.5, opacity: { opacity: K([0, 0], [0.5, 100]) } }, ['fade', 'opacity', 'in']),
  P(['Motion', 'Fades'], 'Fade Out', { type: 'anchorOut', dur: 0.5, opacity: { opacity: K([0, 100], [0.5, 0]) } }, ['fade', 'opacity', 'out']),
  P(['Motion', 'Fades'], 'Slow Fade In', { type: 'anchorIn', dur: 2, opacity: { opacity: K([0, 0], [2, 100]) } }, ['fade', 'opacity', 'in']),
  P(['Motion', 'Fades'], 'Slow Fade Out', { type: 'anchorOut', dur: 2, opacity: { opacity: K([0, 100], [2, 0]) } }, ['fade', 'opacity', 'out']),
  P(['Motion', 'Fades'], 'Half Transparent', { opacity: { opacity: 50 } }, ['opacity']),
  ...[['Screen', 'Screen'], ['Multiply', 'Multiply'], ['Overlay', 'Overlay'], ['Add', 'Add']].map(([n, b]) => P(['Motion', 'Blend'], `Blend ${n}`, { opacity: { blend: b } }, ['blend mode'])),
];

// ---------- effect ins / outs (Premiere-style "Fast Blur In" etc.) ----------
const io = (name, effect, param, from, to, dur = 0.5, extra = {}, tags = []) => [
  P(['Effect Ins & Outs', name], `${name} In`, { type: 'anchorIn', dur, effects: [fx(effect, { ...extra, [param]: K([0, from], [dur, to]) })] }, [...tags, 'in']),
  P(['Effect Ins & Outs', name], `${name} Out`, { type: 'anchorOut', dur, effects: [fx(effect, { ...extra, [param]: K([0, to], [dur, from]) })] }, [...tags, 'out']),
];
const insOuts = [
  ...io('Fast Blur', 'Fast Blur', 'blurriness', 60, 0, 0.5, {}, ['blur']),
  ...io('Gaussian Blur', 'Gaussian Blur', 'blurriness', 80, 0, 0.8, {}, ['blur']),
  ...io('Horizontal Blur', 'Directional Blur', 'length', 120, 0, 0.4, { angle: 90 }, ['blur', 'motion']),
  ...io('Vertical Blur', 'Directional Blur', 'length', 120, 0, 0.4, { angle: 0 }, ['blur', 'motion']),
  ...io('Zoom Blur', 'Radial Blur', 'amount', 60, 0, 0.5, { type: 1 }, ['blur', 'zoom']),
  ...io('Mosaic', 'Mosaic', 'h', 2, 200, 0.6, { v: 10 }, ['pixel']).map((p) => ({ ...p, effects: p.effects.map((e) => ({ ...e, params: { ...e.params, v: { keys: e.params.h.keys.map((k) => ({ ...k, v: Math.round(k.v * 9 / 16) })) } } })) })),
  ...io('Twirl', 'Twirl', 'angle', 360, 0, 0.6, {}, ['distort']),
  ...io('Solarize', 'Solarize', 'thresh', 0, 100, 0.5, {}, ['color']),
  ...io('Lens Distortion', 'Lens Distortion', 'curv', -100, 0, 0.5, {}, ['distort']),
  ...io('RGB Split', 'RGB Split', 'amount', 80, 0, 0.4, {}, ['glitch']),
  ...io('Glitch', 'Digital Glitch', 'amount', 100, 0, 0.5, { rate: 15 }, ['glitch']),
  ...io('Light Leak', 'Light Leak', 'amount', 100, 0, 0.8, {}, ['light']),
  ...io('Exposure Flash', 'Brightness & Contrast', 'bright', 100, 0, 0.3, {}, ['flash', 'light']),
  ...io('Shake', 'Camera Shake', 'amp', 80, 0, 0.5, { freq: 14 }, ['shake']),
  ...io('Ripple', 'Ripple', 'amp', 100, 0, 0.8, {}, ['distort', 'water']),
  ...io('Kaleidoscope', 'Kaleidoscope', 'zoom', 400, 100, 0.6, {}, ['distort']),
];

// ---------- stylized looks (single effects with tuned values) ----------
const look = (folder, name, effects, tags = []) => P(['Stylize', folder], name, { effects }, tags);
const DUOS = [['Midnight Pink', '#1d2b64', '#f8cdda'], ['Ocean Sand', '#03304a', '#f6e7c1'], ['Purple Gold', '#2a0845', '#ffcf5c'], ['Forest Mint', '#0b3d20', '#bff5d0'], ['Red Cream', '#5c0a0a', '#fff1d6'], ['Navy Orange', '#0f1c3f', '#ff9a3c'], ['Teal Lime', '#003c43', '#d4ff6a'], ['Charcoal Sky', '#232526', '#a8d8ff']];
const stylized = [
  look('Glitch', 'RGB Split Subtle', [fx('RGB Split', { amount: 4 })], ['glitch', 'chromatic']), look('Glitch', 'RGB Split Strong', [fx('RGB Split', { amount: 25 })], ['glitch', 'chromatic']),
  look('Glitch', 'RGB Split Pulse', [fx('RGB Split', { amount: 15, animate: true })], ['glitch']), look('Glitch', 'VHS Light', [fx('VHS', { amount: 30, bleed: 25 })], ['vhs', 'retro']),
  look('Glitch', 'VHS Heavy', [fx('VHS', { amount: 90, bleed: 80, tapeNoise: 60 })], ['vhs', 'retro']), look('Glitch', 'Bad TV', [fx('Bad TV', { distort: 50, stat: 30 })], ['tv', 'retro']),
  look('Glitch', 'Data Glitch', [fx('Block Glitch', { amount: 50 }), fx('RGB Split', { amount: 6 })], ['glitch']), look('Glitch', 'Signal Lost', [fx('Signal Noise', { amount: 60, lines: 60 })], ['noise']),
  look('Retro', 'CRT Monitor', [fx('CRT')], ['crt', 'retro']), look('Retro', 'Scanlines', [fx('Scan Lines', { amount: 40 })], ['retro']),
  look('Retro', 'Film Grain Fine', [fx('Film Grain', { amount: 20, size: 1 })], ['grain', 'film']), look('Retro', 'Film Grain Coarse', [fx('Film Grain', { amount: 45, size: 2.5 })], ['grain', 'film']),
  look('Retro', 'Film Grain Color', [fx('Film Grain', { amount: 30, color: true })], ['grain', 'film']), look('Retro', 'Old Film', [fx('Old Film')], ['film', 'vintage']),
  look('Retro', 'Silent Movie', [fx('Old Film', { amount: 100 }), fx('Black & White')], ['film', 'vintage', 'mono']), look('Retro', 'Super 8 Home Movie', [fx('Super 8')], ['film', 'vintage']),
  look('Retro', 'Damaged Film', [fx('Film Damage', { scratch: 70, dust: 70 })], ['film']), look('Retro', 'Sepia Tone', [fx('Sepia')], ['vintage']),
  look('Retro', 'Two-Strip Color', [fx('Dye Transfer Color', { mode: 0 })], ['vintage']), look('Retro', 'Pocket Console', [fx('Pocket Console')], ['pixel', 'retro']),
  look('Retro', '8-Bit Dither', [fx('Ordered Dither', { levels: 4, pixel: 3 })], ['pixel', 'retro']), look('Retro', 'Vintage Fade', [fx('Vintage Fade')], ['vintage']),
  look('Artistic', 'Halftone Small', [fx('Halftone', { size: 5 })], ['print']), look('Artistic', 'Halftone Large', [fx('Halftone', { size: 14 })], ['print']),
  look('Artistic', 'Color Halftone', [fx('Color Halftone')], ['print']), look('Artistic', 'Comic Book', [fx('Comic')], ['comic']),
  look('Artistic', 'Cartoon', [fx('Cartoon')], ['cartoon']), look('Artistic', 'Pencil Sketch', [fx('Pencil Sketch')], ['sketch', 'drawing']),
  look('Artistic', 'Ink Drawing', [fx('Ink')], ['drawing']), look('Artistic', 'Oil Painting', [fx('Oil Paint')], ['paint']),
  look('Artistic', 'Watercolor', [fx('Watercolor')], ['paint']), look('Artistic', 'Stained Glass', [fx('Stained Glass')], ['glass']),
  look('Artistic', 'ASCII Terminal', [fx('ASCII', { color: false })], ['text', 'retro']), look('Artistic', 'Mosaic Tiles', [fx('Mosaic Tiles')], ['tiles']),
  ...DUOS.map(([n, a, b]) => look('Duotone', `Duotone ${n}`, [fx('Duotone', { dark: a, light: b })], ['duotone', 'color'])),
  ...['Sunset', 'Ocean', 'Fire', 'Purple Haze', 'Gold', 'Ice', 'Forest', 'Neon'].map((g, i) => look('Gradient Maps', `Gradient Map ${g}`, [fx('Gradient Map', { grad: i })], ['gradient', 'color'])),
  look('Light', 'Soft Glow', [fx('Glow', { thresh: 60, radius: 30, intensity: 60 })], ['glow']), look('Light', 'Strong Glow', [fx('Glow', { thresh: 40, radius: 40, intensity: 160 })], ['glow']),
  look('Light', 'Dreamy Bloom', [fx('Bloom', { thresh: 50, radius: 50, intensity: 120 })], ['bloom', 'dream']), look('Light', 'Film Halation', [fx('Halation')], ['halation', 'film']),
  look('Light', 'Anamorphic Streaks', [fx('Anamorphic Flare')], ['flare']), look('Light', 'Star Filter', [fx('Star Glow')], ['star']),
  look('Light', 'Sun Rays', [fx('God Rays', { center: [0.75, 0.15] })], ['rays']), look('Light', 'Warm Light Leak', [fx('Light Leak')], ['leak']),
  look('Light', 'Cool Light Leak', [fx('Light Leak', { color: '#4fb3ff', color2: '#9a6bff' })], ['leak']), look('Light', 'Bokeh Lights', [fx('Bokeh Overlay')], ['bokeh']),
  ...[['Cyan', '#28f0ff'], ['Pink', '#ff3cc7'], ['Green', '#3cff6a']].map(([n, c]) => look('Light', `Neon Edges ${n}`, [fx('Neon Edge', { color: c })], ['neon'])),
  look('Light', 'Shine Sweep', [fx('Light Sweep')], ['shine']),
  look('Camera', 'Tilt-Shift Miniature', [fx('Tilt Shift')], ['miniature', 'blur']), look('Camera', 'Camera Shake Light', [fx('Camera Shake', { amp: 8 })], ['shake']),
  look('Camera', 'Camera Shake Medium', [fx('Camera Shake', { amp: 20 })], ['shake']), look('Camera', 'Camera Shake Heavy', [fx('Camera Shake', { amp: 50, freq: 14 })], ['shake']),
  look('Camera', 'Handheld Subtle', [fx('Handheld Wobble', { amp: 12 })], ['handheld']), look('Camera', 'Handheld Documentary', [fx('Handheld Wobble', { amp: 35 })], ['handheld']),
  look('Camera', 'Earthquake', [fx('Earthquake')], ['shake']), look('Camera', 'Beat Zoom 120 BPM', [fx('Zoom Punch', { bpm: 120 })], ['beat', 'zoom']),
  look('Camera', 'Beat Zoom 128 BPM', [fx('Zoom Punch', { bpm: 128 })], ['beat', 'zoom']), look('Camera', 'Fisheye Lens', [fx('Fisheye', { amount: 60 })], ['lens']),
  look('Framing', 'Vignette Soft', [fx('Vignette', { amount: -30 })], ['vignette']), look('Framing', 'Vignette Strong', [fx('Vignette', { amount: -70, mid: 35 })], ['vignette']),
  look('Framing', 'Vignette White', [fx('Vignette', { amount: 60 })], ['vignette']), look('Framing', 'Vignette Blur', [fx('Vignette Blur')], ['vignette', 'blur']),
  ...['2.39:1', '2.35:1', '1.85:1', '4:3'].map((r, i) => look('Framing', `Letterbox ${r}`, [fx('Letterbox', { ratio: [0, 1, 3, 5][i] })], ['letterbox', 'cinema'])),
  ...[30, 60, 120].map((r) => look('Framing', `Rounded Corners ${r}`, [fx('Rounded Corners', { radius: r })], ['corners'])),
  look('Framing', 'White Border', [fx('Frame Border')], ['border']), look('Framing', 'Instant Photo Frame', [fx('Frame Border', { style: 3, color: '#f4f1e8' })], ['border']),
  look('Framing', 'Split Screen 2', [fx('Split Screen', { arrange: 0 })], ['split']), look('Framing', 'Grid 3×3', [fx('Grid Repeat')], ['grid']),
  look('Color', 'Day for Night', [fx('Day for Night')], ['night']), look('Color', 'Infrared', [fx('Infrared')], ['infrared']),
  look('Color', 'Thermal Camera', [fx('Thermal')], ['thermal']), look('Color', 'Hue Cycle', [fx('Hue Cycle')], ['hue', 'rainbow']),
  look('Color', 'Vibrant', [fx('Vibrance', { vib: 60 })], ['vibrance']), look('Color', 'Classic B&W Red Filter', [fx('Black & White Mixer', { w0: 120, w4: -20 })], ['mono']),
];

export const VIDEO_PRESETS = [...pips, ...pipSlides, ...motion, ...insOuts, ...stylized];
