// Lumetri looks (built-in presets), written for EditorStage: plain Lumetri Color values, no LUT files.
// Each base look comes in three strengths: the deviation from the neutral grade is scaled (Saturation around 100).
const BASE = {
  'Cinematic': {
    'Teal & Orange': { temperature: 8, contrast: 18, highlights: -10, shadows: 8, saturation: 112, liftR: -6, liftG: 2, liftB: 10, gainR: 8, gainG: 2, gainB: -6 },
    'Blockbuster': { contrast: 28, highlights: -18, shadows: -6, blacks: -10, saturation: 108, liftB: 8, gainR: 6, vigAmount: -15 },
    'Neo Noir': { contrast: 32, exposure: -0.2, saturation: 70, temperature: -12, liftB: 10, gammaG: 3, vigAmount: -30 },
    'Desert Heat': { temperature: 30, tint: 4, contrast: 14, highlights: -8, saturation: 104, gainR: 8, gainB: -10 },
    'Arctic': { temperature: -30, contrast: 10, highlights: 6, saturation: 80, liftB: 8, gainB: 6 },
    'Moonlit': { exposure: -0.35, temperature: -36, tint: 6, contrast: 12, saturation: 60, liftB: 14, vigAmount: -25 },
    'Emerald City': { tint: -16, contrast: 16, saturation: 110, gammaG: 6, liftG: 4 },
    'Golden Hour': { temperature: 26, exposure: 0.1, highlights: -6, shadows: 10, saturation: 115, gainR: 6, gainG: 3 },
    'Bleached Steel': { contrast: 34, saturation: 55, highlights: -10, temperature: -6, fade: 4 },
    'Epic Sky': { highlights: -30, whites: -8, contrast: 20, vibrance: 25, temperature: -4 },
    'Thriller Green': { tint: -20, contrast: 24, saturation: 85, gammaG: 5, liftG: 3, vigAmount: -20 },
    'Romance': { temperature: 14, tint: 10, contrast: -6, fade: 10, saturation: 96, gainR: 4 },
  },
  'Film': {
    'Warm Negative': { temperature: 14, contrast: 8, fade: 12, saturation: 92, liftR: 4, liftB: -4, gammaR: 3 },
    'Cool Negative': { temperature: -12, contrast: 8, fade: 10, saturation: 90, liftB: 6, gainR: -2 },
    'Slide Film': { contrast: 30, saturation: 128, blacks: -12, highlights: -6, vibrance: 10 },
    'Faded Print': { contrast: -14, fade: 30, saturation: 82, temperature: 6, liftR: 4, liftG: 3 },
    'Expired Stock': { temperature: 18, tint: 14, fade: 22, saturation: 78, gammaB: 6, liftG: 4 },
    'Cross Processed': { contrast: 22, tint: -10, saturation: 118, liftB: 14, gainR: 10, gainB: -12 },
    'Bleach Bypass': { contrast: 38, saturation: 45, highlights: -6, blacks: -8, sharpen: 10 },
    'Portrait Film': { temperature: 6, contrast: 4, saturation: 92, shadows: 8, gainR: 3, gainG: 1, vibrance: -6 },
    'Night Stock': { exposure: 0.15, temperature: -14, contrast: 12, saturation: 88, liftB: 8, fade: 6 },
    'Pushed Two Stops': { exposure: 0.25, contrast: 34, blacks: -14, saturation: 90, sharpen: 15 },
  },
  'Black & White': {
    'Classic Mono': { saturation: 0, contrast: 14 },
    'High Contrast Mono': { saturation: 0, contrast: 45, blacks: -15, whites: 10 },
    'Soft Mono': { saturation: 0, contrast: -12, fade: 14 },
    'Warm Mono': { saturation: 0, contrast: 12, liftR: 6, liftB: -6, gainR: 6, gainB: -6 },
    'Cool Mono': { saturation: 0, contrast: 12, liftB: 8, gainB: 4, gainR: -2 },
    'Silver Print': { saturation: 0, contrast: 22, highlights: -14, shadows: 10, sharpen: 15 },
    'Noir Mono': { saturation: 0, contrast: 40, exposure: -0.25, vigAmount: -40 },
    'Sepia Mono': { saturation: 8, temperature: 30, contrast: 8, fade: 10, gainR: 8, gainB: -10 },
  },
  'Vintage': {
    'Seventies': { temperature: 22, tint: 6, fade: 18, saturation: 88, contrast: -4, gammaG: 3 },
    'Eighties Video': { contrast: 12, saturation: 125, tint: 8, liftB: 6, fade: 6, sharpen: -10 },
    'Instant Photo': { temperature: 12, fade: 26, contrast: -10, saturation: 85, liftB: 6, gainR: 4 },
    'Old Postcard': { temperature: 20, fade: 22, saturation: 60, contrast: 6, vigAmount: -20 },
    'Washed Out': { contrast: -24, fade: 34, saturation: 70 },
    'Retro Teal': { tint: -8, temperature: -8, fade: 16, saturation: 90, liftG: 6, liftB: 6 },
  },
  'Warm': {
    'Warm Sun': { temperature: 22, exposure: 0.08, saturation: 108 },
    'Amber': { temperature: 30, tint: 6, contrast: 8, gainR: 6, gainB: -8 },
    'Autumn': { temperature: 18, tint: 4, saturation: 115, vibrance: 15, gammaR: 4 },
    'Candlelight': { temperature: 40, exposure: -0.15, contrast: 10, saturation: 95, vigAmount: -20 },
  },
  'Cool': {
    'Cool Breeze': { temperature: -20, saturation: 96, highlights: 6 },
    'Blue Hour': { temperature: -32, tint: 8, exposure: -0.1, saturation: 92, liftB: 10 },
    'Winter': { temperature: -24, saturation: 72, highlights: 10, fade: 8 },
    'Clinical': { temperature: -10, tint: -6, contrast: 18, saturation: 80, sharpen: 15 },
  },
  'Moody': {
    'Dark & Moody': { exposure: -0.3, contrast: 24, shadows: -12, saturation: 82, vigAmount: -30 },
    'Forest Moody': { tint: -12, temperature: -6, exposure: -0.2, saturation: 78, gammaG: 4, liftB: 4 },
    'Stormy': { temperature: -16, contrast: 28, highlights: -20, saturation: 65, liftB: 6 },
    'Rainy City': { temperature: -12, contrast: 14, saturation: 70, fade: 8, liftB: 8 },
  },
  'Bright & Airy': {
    'Airy': { exposure: 0.3, contrast: -10, shadows: 20, saturation: 92, fade: 6 },
    'Clean White': { exposure: 0.2, whites: 14, temperature: -4, saturation: 96, contrast: 6 },
    'Morning Light': { exposure: 0.2, temperature: 10, highlights: -6, shadows: 14, vibrance: 10 },
  },
  'Stylized': {
    'Pastel': { contrast: -18, fade: 20, saturation: 80, exposure: 0.15, liftR: 4, liftB: 6 },
    'Neon Night': { contrast: 26, saturation: 140, tint: 14, temperature: -10, vibrance: 20 },
    'Pop Color': { contrast: 20, saturation: 150, vibrance: 20 },
    'Day for Night': { exposure: -0.9, temperature: -40, tint: 6, saturation: 55, contrast: 14, liftB: 10 },
    'Infrared Look': { temperature: 20, tint: 30, saturation: 60, contrast: 22, highlights: 10 },
  },
};
const STRENGTH = [['Subtle', 0.5], ['Medium', 1], ['Strong', 1.5]];
const scale = (look, k) => Object.fromEntries(Object.entries(look).map(([key, v]) => [key, key === 'saturation' ? Math.max(0, 100 + (v - 100) * k) : Math.round(v * k * 100) / 100]));

export const LUMETRI_LOOK_PRESETS = Object.entries(BASE).flatMap(([folder, looks]) => Object.entries(looks).flatMap(([name, look]) =>
  STRENGTH.map(([st, k]) => ({ id: `lumetri/${folder}/${name}/${st}`, name: `${name} (${st})`, folder: ['Lumetri Looks', folder], media: 'video', tags: ['look', 'grade', 'color', folder.toLowerCase()], lumetri: scale(look, k) }))));
