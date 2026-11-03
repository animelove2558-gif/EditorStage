// Parameter descriptors shared by the effect tables (videoEffects.js, premiereFx.js).
export const s = (id, label, min, max, def, step) => ({ id, label, type: 'slider', min, max, def, step: step ?? (max - min <= 10 ? 0.01 : 1) });
export const sel = (id, label, options, def = 0) => ({ id, label, type: 'select', options, def });
export const chk = (id, label, def = false) => ({ id, label, type: 'checkbox', def });
export const pt = (id, label, x = 0.5, y = 0.5) => ({ id, label, type: 'point', def: [x, y] });
export const col = (id, label, def = '#ffffff') => ({ id, label, type: 'color', def });
export const trk = (id, label) => ({ id, label, type: 'trackSel', def: 'None' });
export const med = (id, label) => ({ id, label, type: 'mediaSel', def: '' });
export const SC = 'u_res.y / 1080.0'; // resolution scale so pixel sizes look the same at any preview size
