// After Effects effects for the MOGRT painter. Each effect runs on the layer buffer in LAYER space:
//   ctx = { canvas, ls (buffer px per layer unit), off:[x,y] (layer coords of buffer pixel 0,0), time, pool, masks, getLayer, compW, compH }
// Parameters are read by display name (English AE) with the "<matchName>-NNNN" index as fallback.
import { runShader } from './gl';

const rgba = (c, a = 1) => `rgba(${Math.round((c?.[0] ?? 0) * 255)},${Math.round((c?.[1] ?? 0) * 255)},${Math.round((c?.[2] ?? 0) * 255)},${(c?.[3] ?? 1) * a})`;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const pct = (v, d = 100) => { const x = v === undefined || v === null ? d : Number(v); return x; };

function findParam(params, name) {
  if (!params) return undefined;
  if (params[name] !== undefined) return params[name];
  const lc = name.toLowerCase();
  for (const [k, v] of Object.entries(params)) {
    if (k.toLowerCase() === lc) return v;
    if (v && typeof v === 'object' && !Array.isArray(v)) { const r = findParam(v, name); if (r !== undefined) return r; }
  }
  return undefined;
}
/** param by any of the names, else by index ("<matchName>-0001" = 1) */
function P(eff, names, idx, dflt) {
  for (const n of [].concat(names || [])) { const v = findParam(eff.params, n); if (v !== undefined) return v; }
  if (idx != null && eff.paramsByMatchName) { const v = eff.paramsByMatchName[`${eff.matchName}-${String(idx).padStart(4, '0')}`]; if (v !== undefined) return v; }
  return dflt;
}
const N = (eff, names, idx, d = 0) => { const v = P(eff, names, idx, d); const n = Array.isArray(v) ? v[0] : typeof v === 'boolean' ? +v : Number(v); return Number.isFinite(n) ? n : d; };
const C = (eff, names, idx, d = [1, 1, 1, 1]) => { const v = P(eff, names, idx, d); return Array.isArray(v) ? [v[0], v[1], v[2], v[3] ?? 1] : d; };
const V2 = (eff, names, idx, d = [0, 0]) => { const v = P(eff, names, idx, d); return Array.isArray(v) ? [v[0], v[1]] : d; };

// ---------------------------------------------------------------- helpers
function copyOf(ctx) { const t = ctx.pool.acquire(ctx.canvas.width, ctx.canvas.height); t.getContext('2d').drawImage(ctx.canvas, 0, 0); return t; }
function replace(ctx, src) { const g = ctx.canvas.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'copy'; g.globalAlpha = 1; g.filter = 'none'; g.drawImage(src, 0, 0); g.restore(); }
/** run a shader with the layer buffer as u_src (+ u_ls/u_off/u_time), result replaces the buffer */
function shade(ctx, key, body, uniforms = {}, extra = {}) {
  const out = ctx.pool.acquire(ctx.canvas.width, ctx.canvas.height);
  const ok = runShader('fx:' + key, body, { u_src: ctx.canvas, ...extra }, { u_ls: ctx.ls, u_off: ctx.off, u_time: ctx.time, ...uniforms }, out);
  if (ok) replace(ctx, out);
  ctx.pool.release(out);
  return ok;
}
/** the layer's rectangle in layer space ([x0,y0,x1,y1]) */
const boxOf = (ctx) => ctx.box || [0, 0, ctx.layerW || ctx.canvas.width / ctx.ls, ctx.layerH || ctx.canvas.height / ctx.ls];
const boxCenter = (ctx) => { const b = boxOf(ctx); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };
/** layer point -> buffer pixel */
const bp = (ctx, p) => [(p[0] - ctx.off[0]) * ctx.ls, (p[1] - ctx.off[1]) * ctx.ls];

const BLUR_BODY = `
vec4 acc = vec4(0.); float ws = 0.; float sg = max(u_sig, 0.0001); float st = max(1., sg * 3. / 40.);
for (int i = -40; i <= 40; i++) { float x = float(i) * st; if (abs(x) > sg * 3. + st) continue; float w = exp(-x * x / (2. * sg * sg));
  vec2 q = uv + u_dir * x / u_res; vec4 c = (u_rep > .5 || (q.x >= 0. && q.y >= 0. && q.x <= 1. && q.y <= 1.)) ? texture(u_src, clamp(q, 0., 1.)) : vec4(0.);
  acc += c * w; ws += w; }
acc /= ws; o = acc.a > 0. ? vec4(acc.rgb / acc.a, acc.a) : vec4(0.);`;
/** Gaussian blur of a canvas in place (sigma in buffer pixels per axis). */
export function gaussian(canvas, sx, sy, pool, repeatEdge = false) {
  const ctx = { canvas, pool, ls: 1, off: [0, 0], time: 0 };
  let ok = true;
  if (sx > 0.3) ok = shade(ctx, 'blur', BLUR_BODY, { u_sig: sx, u_dir: [1, 0], u_rep: repeatEdge ? 1 : 0 });
  if (sy > 0.3 && ok) ok = shade(ctx, 'blur', BLUR_BODY, { u_sig: sy, u_dir: [0, 1], u_rep: repeatEdge ? 1 : 0 });
  if (!ok && (sx > 0.3 || sy > 0.3)) { // Canvas2D fallback
    const t = copyOf(ctx); const g = canvas.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
    g.filter = `blur(${Math.max(sx, sy).toFixed(2)}px)`; g.drawImage(t, 0, 0); g.restore(); pool.release(t);
  }
}
/** draw `src` with an affine transform (buffer px) into the buffer, replacing it */
function affine(ctx, m, opacity = 1) {
  const t = copyOf(ctx); const g = ctx.canvas.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  g.setTransform(...m); g.globalAlpha = opacity; g.imageSmoothingQuality = 'high'; g.drawImage(t, 0, 0); g.restore(); ctx.pool.release(t);
}
/** buffer = buffer*(1-k) + orig*k (premultiplied mix), amount 0..100 */
const blendBack = (ctx, orig, amount) => {
  const k = clamp01(amount / 100); if (!(k > 0)) return;
  const t = copyOf(ctx); const g = ctx.canvas.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'copy'; g.globalAlpha = 1 - k; g.drawImage(t, 0, 0);
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = k; g.drawImage(orig, 0, 0); g.restore(); ctx.pool.release(t);
};
const level01 = (v, d) => { const x = v === undefined ? d : Number(v); return x > 1.5 ? x / 255 : x; };

// GLSL helpers available in effect bodies through the uniforms u_ls/u_off (layer coords: L = u_off + px/u_ls)
const LC = 'vec2 L = u_off + px / u_ls;';

// ---------------------------------------------------------------- effects
const FX = {};
const def = (names, fn) => { for (const n of [].concat(names)) FX[n] = fn; };

// --- Blur & Sharpen
def(['ADBE Gaussian Blur 2', 'ADBE Gaussian Blur', 'ADBE Fast Blur', 'ADBE Camera Lens Blur', 'ADBE Box Blur2', 'ADBE Box Blur'], (e, ctx) => {
  const box = /Box/.test(e.matchName);
  let b = N(e, ['Blurriness', 'Blur Radius'], 1, 0);
  if (box) b *= Math.sqrt(Math.max(1, N(e, ['Iterations'], 2, 3))) * 0.6; else if (/Lens/.test(e.matchName)) b *= 0.7; else b *= 0.5;
  const dimIdx = box ? 3 : 2; const dim = N(e, ['Blur Dimensions'], dimIdx, 1); const rep = !!N(e, ['Repeat Edge Pixels'], box ? 4 : 3, 0);
  const s = b * ctx.ls; gaussian(ctx.canvas, dim === 3 ? 0 : s, dim === 2 ? 0 : s, ctx.pool, rep);
});
def('ADBE Channel Blur', (e, ctx) => {
  const r = N(e, ['Red Blurriness'], 1), g = N(e, ['Green Blurriness'], 2), b = N(e, ['Blue Blurriness'], 3), a = N(e, ['Alpha Blurriness'], 4);
  const m = Math.max(r, g, b, a); if (m > 0) gaussian(ctx.canvas, m * 0.5 * ctx.ls, m * 0.5 * ctx.ls, ctx.pool); // approximation: max channel radius
});
def(['ADBE Motion Blur'], (e, ctx) => { // Directional Blur
  const dir = (N(e, ['Direction'], 1, 0) * Math.PI) / 180, len = N(e, ['Blur Length'], 2, 0) * ctx.ls; if (len < 0.5) return;
  shade(ctx, 'dirblur', `vec4 acc=vec4(0.); for(int i=0;i<64;i++){ float f=float(i)/63.-.5; acc+=texture(u_src, uv+u_d*f/u_res); } acc/=64.; o=acc.a>0.?vec4(acc.rgb/acc.a,acc.a):vec4(0.);`,
    { u_d: [Math.sin(dir) * len, -Math.cos(dir) * len] });
});
def(['ADBE Radial Blur', 'CC Radial Fast Blur', 'CC Radial Blur'], (e, ctx) => {
  const cc = /^CC/.test(e.matchName);
  const amount = N(e, ['Amount'], cc ? 2 : 1, 10); const c = bp(ctx, V2(e, ['Center'], cc ? 1 : 2, boxCenter(ctx)));
  const zoom = e.matchName === 'CC Radial Fast Blur' ? 1 : N(e, ['Type'], cc ? 1 : 3, 1) === 2 || (cc && N(e, ['Type'], 1, 1) >= 3) ? 1 : 0;
  shade(ctx, 'radblur', `vec4 acc=vec4(0.); vec2 c=u_c; for(int i=0;i<48;i++){ float f=float(i)/47.; vec2 p=px-c; if(u_zoom<.5){ float an=(f-.5)*u_amt*0.0175; float cs=cos(an),sn=sin(an); p=vec2(p.x*cs-p.y*sn,p.x*sn+p.y*cs);} else p*=1.-f*u_amt*0.01; acc+=TC(u_src,(c+p)/u_res)*vec4(1.); } acc/=48.; o=acc;`,
    { u_c: c, u_amt: amount, u_zoom: zoom });
});
def(['ADBE Sharpen'], (e, ctx) => {
  const a = N(e, ['Sharpen Amount'], 1, 0); if (!a) return;
  shade(ctx, 'sharpen', `vec4 c=T(u_src,uv); vec2 d=1./u_res; vec3 b=(T(u_src,uv+vec2(d.x,0.)).rgb+T(u_src,uv-vec2(d.x,0.)).rgb+T(u_src,uv+vec2(0.,d.y)).rgb+T(u_src,uv-vec2(0.,d.y)).rgb)*.25; o=vec4(c.rgb+(c.rgb-b)*u_a/25.,c.a);`, { u_a: a });
});
def(['ADBE Unsharp Mask2', 'ADBE Unsharp Mask'], (e, ctx) => {
  const amt = N(e, ['Amount'], 1, 50), rad = N(e, ['Radius'], 2, 1), th = N(e, ['Threshold'], 3, 0);
  const orig = copyOf(ctx); gaussian(ctx.canvas, rad * ctx.ls, rad * ctx.ls, ctx.pool);
  const out = ctx.pool.acquire(ctx.canvas.width, ctx.canvas.height);
  if (runShader('fx:usm', `vec4 c=T(u_o,uv), b=T(u_b,uv); vec3 d=c.rgb-b.rgb; if(abs(luma(d))*255.<u_th) d=vec3(0.); o=vec4(c.rgb+d*u_a/100.,c.a);`, { u_o: orig, u_b: ctx.canvas }, { u_a: amt, u_th: th }, out)) replace(ctx, out);
  else replace(ctx, orig);
  ctx.pool.release(out); ctx.pool.release(orig);
});

// --- Color
def('ADBE Fill', (e, ctx) => {
  const col = C(e, ['Color'], 3, [1, 0, 0, 1]); let op = N(e, ['Opacity'], 7, 1); if (op > 1) op /= 100; const inv = !!N(e, ['Invert'], 4, 0);
  const g = ctx.canvas.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  if (inv) { const t = copyOf(ctx); g.globalCompositeOperation = 'copy'; g.fillStyle = rgba(col, op); g.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); g.globalCompositeOperation = 'destination-out'; g.drawImage(t, 0, 0); g.globalCompositeOperation = 'destination-over'; g.drawImage(t, 0, 0); ctx.pool.release(t); }
  else { const t = copyOf(ctx); g.globalCompositeOperation = 'source-atop'; g.fillStyle = rgba([col[0], col[1], col[2], 1]); g.globalAlpha = op; g.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.pool.release(t); }
  g.restore();
});
def('ADBE Tint', (e, ctx) => {
  let lo = C(e, ['Map Black To'], 1, [0, 0, 0, 1]), hi = C(e, ['Map White To'], 2, [1, 1, 1, 1]); const amt = N(e, ['Amount to Tint'], 3, 100) / 100;
  if (N(e, ['Swap Colors'], 4, 0)) [lo, hi] = [hi, lo];
  shade(ctx, 'tint', `vec4 c=T(u_src,uv); float l=lum601(c.rgb); o=vec4(mix(c.rgb, mix(u_lo,u_hi,l), u_amt), c.a);`, { u_lo: lo.slice(0, 3), u_hi: hi.slice(0, 3), u_amt: amt });
});
def('ADBE Tritone', (e, ctx) => {
  const hi = C(e, ['Highlights'], 1, [1, 1, 1, 1]), mid = C(e, ['Midtones'], 2, [0.5, 0.4, 0.3, 1]), sh = C(e, ['Shadows'], 3, [0, 0, 0, 1]); const bl = N(e, ['Blend With Original'], 4, 0) / 100;
  shade(ctx, 'tritone', `vec4 c=T(u_src,uv); float l=lum601(c.rgb); vec3 r=l<.5?mix(u_s,u_m,l*2.):mix(u_m,u_h,l*2.-1.); o=vec4(mix(r,c.rgb,u_b),c.a);`, { u_h: hi.slice(0, 3), u_m: mid.slice(0, 3), u_s: sh.slice(0, 3), u_b: bl });
});
def('CC Toner', (e, ctx) => {
  const hi = C(e, ['Highlights'], 2, [1, 1, 1, 1]), mid = C(e, ['Midtones'], 4, [0.5, 0.5, 0.5, 1]), sh = C(e, ['Shadows'], 6, [0, 0, 0, 1]); const bl = N(e, ['Blend w. Original', 'Blend With Original'], 7, 0) / 100;
  shade(ctx, 'tritone', `vec4 c=T(u_src,uv); float l=lum601(c.rgb); vec3 r=l<.5?mix(u_s,u_m,l*2.):mix(u_m,u_h,l*2.-1.); o=vec4(mix(r,c.rgb,u_b),c.a);`, { u_h: hi.slice(0, 3), u_m: mid.slice(0, 3), u_s: sh.slice(0, 3), u_b: bl });
});
def(['ADBE Brightness & Contrast 2', 'ADBE Brightness & Contrast'], (e, ctx) => {
  const b = N(e, ['Brightness'], 1, 0) / 100, c = N(e, ['Contrast'], 2, 0) / 100;
  shade(ctx, 'bc', `vec4 x=T(u_src,uv); vec3 r=x.rgb+u_b*.6; r=(r-.5)*(u_c>=0.?1./max(1.-u_c*.99,.01):1.+u_c)+.5; o=vec4(r,x.a);`, { u_b: b, u_c: c });
});
def('ADBE HUE SATURATION', (e, ctx) => {
  const colorize = !!N(e, ['Colorize'], 6, 0);
  const hue = N(e, ['Master Hue'], 3, 0), sat = N(e, ['Master Saturation'], 4, 0), lig = N(e, ['Master Lightness'], 5, 0);
  const ch = N(e, ['Colorize Hue'], 7, 0), cs = N(e, ['Colorize Saturation'], 8, 25), cl = N(e, ['Colorize Lightness'], 9, 0);
  shade(ctx, 'huesat', `vec4 c=T(u_src,uv); vec3 h=rgb2hsl(c.rgb);
    if(u_col>.5){ h.x=fract(u_ch/360.); h.y=u_cs/100.; } else { h.x=fract(h.x+u_h/360.); h.y=clamp(h.y*(1.+u_s/100.),0.,1.); }
    vec3 r=hsl2rgb(h); float L=u_col>.5?u_cl:u_l; r = L>=0. ? mix(r, vec3(1.), L/100.) : r*(1.+L/100.); o=vec4(r,c.a);`, { u_col: colorize ? 1 : 0, u_h: hue, u_s: sat, u_l: lig, u_ch: ch, u_cs: cs, u_cl: cl });
});
def('ADBE Invert', (e, ctx) => {
  const ch = N(e, ['Channel'], 1, 1), bl = N(e, ['Blend With Original'], 2, 0) / 100;
  shade(ctx, 'invert', `vec4 c=T(u_src,uv); vec3 r=c.rgb; float a=c.a; int k=int(u_ch+.5);
    if(k<=1||k==2) r=1.-r; else if(k==3||k==6) r.r=1.-r.r; else if(k==4||k==7) r.g=1.-r.g; else if(k==5||k==8) r.b=1.-r.b;
    else if(k==9){ vec3 h=rgb2hsl(r); h.x=fract(h.x+.5); r=hsl2rgb(h);} else if(k==10){ vec3 h=rgb2hsl(r); h.z=1.-h.z; r=hsl2rgb(h);} else if(k==11){ vec3 h=rgb2hsl(r); h.y=1.-h.y; r=hsl2rgb(h);} else if(k>=15) a=1.-a; else r=1.-r;
    o=vec4(mix(r,c.rgb,u_b),mix(a,c.a,u_b));`, { u_ch: ch, u_b: bl });
});
def('ADBE Exposure2', (e, ctx) => {
  const ex = N(e, ['Exposure'], 2, 0), offs = N(e, ['Offset'], 3, 0), gam = N(e, ['Gamma Correction'], 4, 1);
  shade(ctx, 'exposure', `vec4 c=T(u_src,uv); vec3 r=pow(max(c.rgb*exp2(u_e)+u_o,0.),vec3(1./max(u_g,.01))); o=vec4(r,c.a);`, { u_e: ex, u_o: offs, u_g: gam });
});
def('ADBE Black&White', (e, ctx) => {
  const w = ['Reds', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Magentas'].map((n, i) => N(e, [n], i + 1, [40, 60, 40, 60, 20, 80][i]) / 100);
  const tint = !!N(e, ['Tint'], 7, 0), tc = C(e, ['Tint Color'], 8, [0.88, 0.8, 0.6, 1]);
  shade(ctx, 'bw', `vec4 c=T(u_src,uv); float mn=min(c.r,min(c.g,c.b)); vec3 d=c.rgb-mn; float r=d.r,g=d.g,b=d.b;
    float y=min(r,g), cy=min(g,b), m=min(r,b); r-=max(y,m); g-=max(y,cy); b-=max(cy,m);
    float l = mn + max(r,0.)*u_w0 + max(y,0.)*u_w1 + max(g,0.)*u_w2 + max(cy,0.)*u_w3 + max(b,0.)*u_w4 + max(m,0.)*u_w5;
    vec3 out_ = vec3(clamp(l,0.,1.)); if(u_t>.5){ vec3 h=rgb2hsl(u_tc); out_=hsl2rgb(vec3(h.x,h.y,out_.x)); } o=vec4(out_,c.a);`,
  { u_w0: w[0], u_w1: w[1], u_w2: w[2], u_w3: w[3], u_w4: w[4], u_w5: w[5], u_t: tint ? 1 : 0, u_tc: tc.slice(0, 3) });
});
def(['ADBE Easy Levels2', 'ADBE Easy Levels', 'ADBE Pro Levels2', 'ADBE Pro Levels'], (e, ctx) => {
  const ib = level01(P(e, ['Input Black'], 3), 0), iw = level01(P(e, ['Input White'], 4), 1), gm = N(e, ['Gamma'], 5, 1), ob = level01(P(e, ['Output Black'], 6), 0), ow = level01(P(e, ['Output White'], 7), 1);
  shade(ctx, 'levels', `vec4 c=T(u_src,uv); vec3 r=clamp((c.rgb-u_ib)/max(u_iw-u_ib,.0001),0.,1.); r=pow(r,vec3(1./max(u_g,.01))); o=vec4(mix(vec3(u_ob),vec3(u_ow),r),c.a);`, { u_ib: ib, u_iw: iw, u_g: gm, u_ob: ob, u_ow: ow });
});
def(['ADBE Color Balance 2'], (e, ctx) => {
  const v = ['Shadow Red Balance', 'Shadow Green Balance', 'Shadow Blue Balance', 'Midtone Red Balance', 'Midtone Green Balance', 'Midtone Blue Balance', 'Hilight Red Balance', 'Hilight Green Balance', 'Hilight Blue Balance'].map((n, i) => N(e, [n, n.replace('Hilight', 'Highlight')], i + 1, 0) / 100);
  shade(ctx, 'cbal', `vec4 c=T(u_src,uv); float l=luma(c.rgb); float sh=clamp(1.-l*2.,0.,1.), hi=clamp(l*2.-1.,0.,1.), mi=1.-sh-hi; o=vec4(c.rgb+u_s*sh*.5+u_m*mi*.5+u_h*hi*.5,c.a);`, { u_s: v.slice(0, 3), u_m: v.slice(3, 6), u_h: v.slice(6, 9) });
});
def('ADBE Vibrance', (e, ctx) => {
  const vib = N(e, ['Vibrance'], 1, 0) / 100, sat = N(e, ['Saturation'], 2, 0) / 100;
  shade(ctx, 'vibrance', `vec4 c=T(u_src,uv); vec3 h=rgb2hsl(c.rgb); h.y=clamp(h.y*(1.+u_s)+(1.-h.y)*h.y*u_v,0.,1.); o=vec4(hsl2rgb(h),c.a);`, { u_v: vib, u_s: sat });
});
def('ADBE Photo Filter', (e, ctx) => {
  const col = C(e, ['Color'], 2, [0.93, 0.54, 0.0, 1]), dens = N(e, ['Density'], 3, 25) / 100, pres = !!N(e, ['Preserve Luminosity'], 4, 1);
  shade(ctx, 'photofilter', `vec4 c=T(u_src,uv); vec3 r=mix(c.rgb, c.rgb*u_c, u_d); if(u_p>.5) r*= luma(c.rgb)/max(luma(r),.001); o=vec4(r,c.a);`, { u_c: col.slice(0, 3), u_d: dens, u_p: pres ? 1 : 0 });
});
def('ADBE Posterize', (e, ctx) => { const l = Math.max(2, N(e, ['Level'], 1, 6)); shade(ctx, 'posterize', `vec4 c=T(u_src,uv); o=vec4(floor(c.rgb*u_l)/(u_l-1.),c.a);`, { u_l: l }); });
def(['ADBE Threshold2', 'ADBE Threshold'], (e, ctx) => { const l = level01(P(e, ['Level'], 1), 128 / 255); shade(ctx, 'threshold', `vec4 c=T(u_src,uv); o=vec4(vec3(step(u_l,luma(c.rgb))),c.a);`, { u_l: l }); });
def(['ADBE Gamma/Pedestal/Gain2', 'ADBE Gamma/Pedestal/Gain'], (e, ctx) => {
  const bs = N(e, ['Black Stretch'], 1, 1); const g = ['Red', 'Green', 'Blue'].map((c, i) => [N(e, [`${c} Gamma`], 2 + i * 3, 1), N(e, [`${c} Pedestal`], 3 + i * 3, 0), N(e, [`${c} Gain`], 4 + i * 3, 1)]);
  shade(ctx, 'gpg', `vec4 c=T(u_src,uv); vec3 r=u_ped+(u_gain-u_ped)*pow(c.rgb,vec3(1.)/max(u_gam,vec3(.01))); r=mix(r,r*r*(3.-2.*r),clamp(u_bs-1.,0.,1.)*.25); o=vec4(r,c.a);`,
    { u_gam: g.map((x) => x[0]), u_ped: g.map((x) => x[1]), u_gain: g.map((x) => x[2]), u_bs: bs });
});
def(['ADBE CHANNEL MIXER'], (e, ctx) => {
  const k = (n, i, d) => N(e, [n], i, d) / 100;
  const m = [k('Red-Red', 1, 100), k('Red-Green', 2, 0), k('Red-Blue', 3, 0), k('Red-Const', 4, 0), k('Green-Red', 5, 0), k('Green-Green', 6, 100), k('Green-Blue', 7, 0), k('Green-Const', 8, 0), k('Blue-Red', 9, 0), k('Blue-Green', 10, 0), k('Blue-Blue', 11, 100), k('Blue-Const', 12, 0)];
  const mono = !!N(e, ['Monochrome'], 13, 0);
  shade(ctx, 'chmix', `vec4 c=T(u_src,uv); vec3 r=vec3(dot(c.rgb,u_r.xyz)+u_r.w, dot(c.rgb,u_g.xyz)+u_g.w, dot(c.rgb,u_b.xyz)+u_b.w); if(u_mono>.5) r=vec3(r.r); o=vec4(r,c.a);`,
    { u_r: m.slice(0, 4), u_g: m.slice(4, 8), u_b: m.slice(8, 12), u_mono: mono ? 1 : 0 });
});
def(['ADBE Leave Color'], (e, ctx) => {
  const amt = N(e, ['Amount to Decolor'], 1, 0) / 100, col = C(e, ['Color To Leave'], 2, [1, 0, 0, 1]), tol = N(e, ['Tolerance'], 3, 15) / 100, soft = N(e, ['Edge Softness'], 4, 0) / 100;
  shade(ctx, 'leave', `vec4 c=T(u_src,uv); vec3 h=rgb2hsl(c.rgb), k=rgb2hsl(u_k); float dh=abs(h.x-k.x); dh=min(dh,1.-dh); float m=1.-smoothstep(u_t,u_t+u_s+.0001,dh*2.); o=vec4(mix(c.rgb,vec3(luma(c.rgb)),u_a*(1.-m)),c.a);`,
    { u_a: amt, u_k: col.slice(0, 3), u_t: tol, u_s: soft });
});
def(['ADBE Change To Color'], (e, ctx) => {
  const from = C(e, ['From'], 1, [1, 0, 0, 1]), to = C(e, ['To'], 2, [0, 0, 1, 1]), tol = N(e, ['Hue'], 5, 5) / 100, soft = N(e, ['Softness'], 8, 50) / 100;
  shade(ctx, 'c2c', `vec4 c=T(u_src,uv); vec3 h=rgb2hsl(c.rgb), f=rgb2hsl(u_f), t=rgb2hsl(u_t); float dh=abs(h.x-f.x); dh=min(dh,1.-dh); float m=1.-smoothstep(u_tol,u_tol+u_soft*.2+.0001,dh); h.x=fract(h.x+(t.x-f.x)*m); o=vec4(hsl2rgb(h),c.a);`,
    { u_f: from.slice(0, 3), u_t: to.slice(0, 3), u_tol: tol, u_soft: soft });
});
def(['ADBE Color Key'], (e, ctx) => {
  const k = C(e, ['Key Color'], 1, [0, 0, 1, 1]), tol = N(e, ['Color Tolerance'], 2, 0) / 255, feather = N(e, ['Edge Feather'], 4, 0);
  shade(ctx, 'ckey', `vec4 c=T(u_src,uv); float d=max(abs(c.r-u_k.r),max(abs(c.g-u_k.g),abs(c.b-u_k.b))); o=vec4(c.rgb, c.a*step(u_t+.0001,d));`, { u_k: k.slice(0, 3), u_t: tol });
  if (feather > 0) gaussian(ctx.canvas, feather * ctx.ls * 0.5, feather * ctx.ls * 0.5, ctx.pool);
});
def(['ADBE Linear Color Key2', 'ADBE Linear Color Key'], (e, ctx) => {
  const k = C(e, ['Key Color'], 3, [0, 0, 1, 1]), tol = N(e, ['Matching Tolerance'], 4, 10) / 100, soft = N(e, ['Matching Softness'], 5, 10) / 100;
  shade(ctx, 'lckey', `vec4 c=T(u_src,uv); float d=distance(c.rgb,u_k)/1.732; o=vec4(c.rgb,c.a*smoothstep(u_t,u_t+u_s+.0001,d));`, { u_k: k.slice(0, 3), u_t: tol, u_s: soft });
});
def(['ADBE Luma Key'], (e, ctx) => {
  const type = N(e, ['Key Type'], 1, 1), th = N(e, ['Threshold'], 2, 0) / 255, tol = N(e, ['Tolerance'], 3, 0) / 255, feather = N(e, ['Edge Feather'], 5, 0);
  shade(ctx, 'lkey', `vec4 c=T(u_src,uv); float l=luma(c.rgb); int k=int(u_ty+.5); float keep = k==1 ? step(u_th,l) : k==2 ? step(l,u_th) : k==3 ? 1.-step(abs(l-u_th),u_tol) : step(abs(l-u_th),u_tol); o=vec4(c.rgb,c.a*keep);`, { u_ty: type, u_th: th, u_tol: tol });
  if (feather > 0) gaussian(ctx.canvas, feather * ctx.ls * 0.5, feather * ctx.ls * 0.5, ctx.pool);
});
def(['ADBE Extract'], (e, ctx) => {
  const bp_ = N(e, ['Black Point'], 3, 0) / 255, wp = N(e, ['White Point'], 4, 255) / 255, bs = N(e, ['Black Softness'], 5, 0) / 255, ws = N(e, ['White Softness'], 6, 0) / 255, inv = !!N(e, ['Invert'], 7, 0);
  shade(ctx, 'extract', `vec4 c=T(u_src,uv); float l=luma(c.rgb); float k=smoothstep(u_b-u_bs,u_b+.0001,l)*(1.-smoothstep(u_w,u_w+u_ws+.0001,l)); if(u_i>.5) k=1.-k; o=vec4(c.rgb,c.a*k);`, { u_b: bp_, u_w: wp, u_bs: bs, u_ws: ws, u_i: inv ? 1 : 0 });
});
def(['ADBE Lumetri'], (e, ctx) => { // basic correction section only
  const ex = N(e, ['Exposure'], null, 0), co = N(e, ['Contrast'], null, 0) / 100, hi = N(e, ['Highlights'], null, 0) / 100, sh = N(e, ['Shadows'], null, 0) / 100,
    wh = N(e, ['Whites'], null, 0) / 100, bl = N(e, ['Blacks'], null, 0) / 100, sat = N(e, ['Saturation'], null, 100) / 100, temp = N(e, ['Temperature'], null, 0) / 100, tint = N(e, ['Tint'], null, 0) / 100;
  shade(ctx, 'lumetri', `vec4 c=T(u_src,uv); vec3 r=c.rgb*exp2(u_ex); r+=vec3(u_tp,0.,-u_tp)*.1+vec3(0.,-u_tn,0.)*.1; float l=luma(r);
    r+=u_hi*.3*smoothstep(.5,1.,l)+u_sh*.3*(1.-smoothstep(0.,.5,l))+u_wh*.2*l+u_bl*.2*(1.-l); r=(r-.5)*(1.+u_co)+.5; r=mix(vec3(luma(r)),r,u_sat); o=vec4(r,c.a);`,
  { u_ex: ex, u_co: co, u_hi: hi, u_sh: sh, u_wh: wh, u_bl: bl, u_sat: sat, u_tp: temp, u_tn: tint });
});

// --- Channel / Matte
def(['ADBE Simple Choker', 'ADBE Matte Choker'], (e, ctx) => {
  const ch = N(e, ['Choke Matte', 'Choke 1'], /Simple/.test(e.matchName) ? 2 : 3, 0) * ctx.ls; if (Math.abs(ch) < 0.3) return;
  minimax(ctx, ch > 0 ? 'min' : 'max', Math.abs(ch), true);
});
def('ADBE Minimax', (e, ctx) => {
  const op = N(e, ['Operation'], 1, 1), r = N(e, ['Radius'], 2, 0) * ctx.ls, chan = N(e, ['Channel'], 3, 2);
  if (r < 0.5) return; const mode = op === 2 || op === 3 ? 'min' : 'max'; minimax(ctx, mode, r, chan === 2);
});
function minimax(ctx, mode, r, alphaOnly) {
  const body = (dir) => `vec4 c=T(u_src,uv); vec4 best=c; for(int i=-24;i<=24;i++){ float x=float(i)*u_r/24.; vec4 s=TC(u_src,uv+${dir}*x/u_res); ${mode === 'min' ? 'best=min(best,s);' : 'best=max(best,s);'} } o=${alphaOnly ? 'vec4(c.rgb,best.a)' : 'best'};`;
  shade(ctx, 'minimax' + mode + alphaOnly + 'x', body('vec2(1.,0.)'), { u_r: r });
  shade(ctx, 'minimax' + mode + alphaOnly + 'y', body('vec2(0.,1.)'), { u_r: r });
}
def(['ADBE Set Matte3', 'ADBE Set Matte2'], (e, ctx) => {
  const li = N(e, ['Take Matte From Layer'], 1, 0); const use = N(e, ['Use For Matte'], 2, 4); const inv = !!N(e, ['Invert Matte'], 3, 0);
  const m = li > 0 && ctx.getLayer ? ctx.getLayer(li) : null; if (!m) return;
  shade(ctx, 'setmatte', `vec4 c=T(u_src,uv), m=T(u_m,uv); int k=int(u_use+.5); float a = k==1?m.r:k==2?m.g:k==3?m.b:k==4?m.a:k==5?luma(m.rgb)*m.a:k==6?rgb2hsl(m.rgb).x:k==7?rgb2hsl(m.rgb).z:k==8?rgb2hsl(m.rgb).y:m.a;
    if(u_inv>.5) a=1.-a; o=vec4(c.rgb,c.a*a);`, { u_use: use, u_inv: inv ? 1 : 0 }, { u_m: m });
  ctx.pool.release(m);
});
def(['ADBE Shift Channels'], (e, ctx) => {
  const sel = [N(e, ['Take Alpha From'], 1, 4), N(e, ['Take Red From'], 2, 1), N(e, ['Take Green From'], 3, 2), N(e, ['Take Blue From'], 4, 3)];
  shade(ctx, 'shiftch', `vec4 c=T(u_src,uv); vec3 h=rgb2hsl(c.rgb); float v[11]=float[11](0.,c.r,c.g,c.b,c.a,luma(c.rgb),h.x,h.y,h.z,1.,0.);
    o=vec4(v[int(u_s.y)],v[int(u_s.z)],v[int(u_s.w)],v[int(u_s.x)]);`, { u_s: sel });
});
def(['CC Composite'], (e, ctx) => { /* compositing the original back over itself: visually a no-op for opaque results */ });
def(['ADBE Solid Composite'], (e, ctx) => {
  const so = N(e, ['Source Opacity'], 1, 100) / 100, col = C(e, ['Color'], 2, [1, 1, 1, 1]), op = N(e, ['Opacity'], 3, 100) / 100;
  const t = copyOf(ctx); const g = ctx.canvas.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'copy'; g.fillStyle = rgba(col, op); g.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = so; g.drawImage(t, 0, 0); g.restore(); ctx.pool.release(t);
});
def(['ADBE Alpha Levels2', 'ADBE Alpha Levels'], (e, ctx) => {
  const ib = level01(P(e, ['Input Black Level'], 1), 0), iw = level01(P(e, ['Input White Level'], 2), 1), gm = N(e, ['Gamma'], 3, 1), ob = level01(P(e, ['Output Black Level'], 4), 0), ow = level01(P(e, ['Output White Level'], 5), 1);
  shade(ctx, 'alevels', `vec4 c=T(u_src,uv); float a=clamp((c.a-u_ib)/max(u_iw-u_ib,.0001),0.,1.); a=pow(a,1./max(u_g,.01)); o=vec4(c.rgb,mix(u_ob,u_ow,a));`, { u_ib: ib, u_iw: iw, u_g: gm, u_ob: ob, u_ow: ow });
});

// --- Generate (all draw in layer space)
// AE generator "Blending Mode" dropdown: 1 None, 2 Normal, 3 Add, 4 Multiply, 5 Screen, 6 Overlay, 7 Soft Light, 8 Hard Light, 9 Color Dodge,
// 10 Color Burn, 11 Darken, 12 Lighten, 13 Difference, 14 Exclusion, 15 Hue, 16 Saturation, 17 Color, 18 Luminosity, 19 Stencil Alpha, 20 Silhouette Alpha
const GEN_OPS = [null, 'copy', 'source-over', 'lighter', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'color-dodge', 'color-burn', 'darken', 'lighten', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'destination-in', 'destination-out'];
/** composite a generated canvas into the buffer; `noneOp` = canvas op used for "None" (1) */
function compositeGenerated(ctx, gen, mode, opacity, noneOp = 'copy') {
  const g = ctx.canvas.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  const op = !mode || mode === 1 ? noneOp : GEN_OPS[mode] || 'source-over';
  if (op === 'copy' && opacity < 1) { // fade between original and generated
    const t = copyOf(ctx); g.globalCompositeOperation = 'copy'; g.globalAlpha = 1 - opacity; g.drawImage(t, 0, 0); g.globalCompositeOperation = 'lighter'; g.globalAlpha = opacity; g.drawImage(gen, 0, 0); ctx.pool.release(t);
  } else { g.globalCompositeOperation = op; g.globalAlpha = opacity; g.drawImage(gen, 0, 0); }
  g.restore();
}
def('ADBE Ramp', (e, ctx) => {
  const s = bp(ctx, V2(e, ['Start of Ramp'], 1, [0, 0])), sc = C(e, ['Start Color'], 2, [0, 0, 0, 1]), en = bp(ctx, V2(e, ['End of Ramp'], 3, [0, 100])), ec = C(e, ['End Color'], 4, [1, 1, 1, 1]);
  const radial = N(e, ['Ramp Shape'], 5, 1) === 2, scat = N(e, ['Ramp Scatter'], 6, 0), bl = N(e, ['Blend With Original'], 7, 0) / 100;
  shade(ctx, 'ramp', `vec4 c=T(u_src,uv); vec2 d=u_e-u_s; float f = u_rad>.5 ? length(px-u_s)/max(length(d),.001) : dot(px-u_s,d)/max(dot(d,d),.001);
    f=clamp(f+(hash(px)-.5)*u_sc*.002,0.,1.); vec3 g=mix(u_sc0,u_ec,f); o=vec4(mix(g,c.rgb,u_bl), c.a);`,
  { u_s: s, u_e: en, u_rad: radial ? 1 : 0, u_sc: scat, u_sc0: sc.slice(0, 3), u_ec: ec.slice(0, 3), u_bl: bl });
});
def('ADBE 4ColorGradient', (e, ctx) => {
  const pts = [1, 3, 5, 7].map((i, k) => bp(ctx, V2(e, [`Point ${k + 1}`], i + 1, [0, 0])));
  const cols = [2, 4, 6, 8].map((i, k) => C(e, [`Color ${k + 1}`], i + 2, [1, 1, 1, 1]).slice(0, 3));
  const blend = N(e, ['Blend'], 10, 100), op = N(e, ['Opacity'], 12, 100) / 100, mode = N(e, ['Blending Mode'], 13, 1);
  const gen = ctx.pool.acquire(ctx.canvas.width, ctx.canvas.height);
  runShader('fx:4col', `vec3 acc=vec3(0.); float ws=0.; ${[0, 1, 2, 3].map((i) => `{ float d=length(px-u_p${i}); float w=1./pow(max(d,1.),u_bl/50.+1.); acc+=u_c${i}*w; ws+=w; }`).join('')} o=vec4(acc/ws,1.);`,
    { u_src: ctx.canvas }, { u_p0: pts[0], u_p1: pts[1], u_p2: pts[2], u_p3: pts[3], u_c0: cols[0], u_c1: cols[1], u_c2: cols[2], u_c3: cols[3], u_bl: blend }, gen);
  compositeGenerated(ctx, gen, mode, op, 'source-atop'); ctx.pool.release(gen);
});
def('ADBE Circle', (e, ctx) => {
  const c = bp(ctx, V2(e, ['Center'], 1, [0, 0])), r = N(e, ['Radius'], 2, 75) * ctx.ls, edge = N(e, ['Edge'], 3, 1), thick = N(e, ['Thickness', 'Edge Radius'], 4, 10) * ctx.ls;
  const fo = N(e, ['Feather Outer Edge'], 6, 0) * ctx.ls, fi = N(e, ['Feather Inner Edge'], 7, 0) * ctx.ls, inv = !!N(e, ['Invert Circle'], 8, 0), col = C(e, ['Color'], 9, [1, 1, 1, 1]), op = N(e, ['Opacity'], 10, 100) / 100, mode = N(e, ['Blending Mode'], 11, 1);
  const gen = ctx.pool.acquire(ctx.canvas.width, ctx.canvas.height);
  runShader('fx:circle', `float d=length(px-u_c); float a=1.-smoothstep(u_r-u_fo*.5-.5,u_r+u_fo*.5+.5,d);
    if(u_edge>1.5){ float ri=u_edge<2.5?u_r-u_t:u_edge<3.5?u_t:u_r*(1.-u_t/max(u_r,1.)); ri=max(ri,0.); a*=smoothstep(ri-u_fi*.5-.5,ri+u_fi*.5+.5,d); }
    if(u_inv>.5) a=1.-a; o=vec4(u_col,a);`, { u_src: ctx.canvas }, { u_c: c, u_r: r, u_edge: edge, u_t: thick, u_fo: fo, u_fi: fi, u_inv: inv ? 1 : 0, u_col: col.slice(0, 3) }, gen);
  compositeGenerated(ctx, gen, mode, op); ctx.pool.release(gen);
});
def('ADBE Ellipse', (e, ctx) => {
  const c = bp(ctx, V2(e, ['Center'], 1, [0, 0])), w = N(e, ['Width'], 2, 200) * ctx.ls, h = N(e, ['Height'], 3, 200) * ctx.ls, th = N(e, ['Thickness'], 4, 10) * ctx.ls, soft = N(e, ['Softness'], 5, 10) / 100;
  const ic = C(e, ['Inside Color'], 6, [1, 1, 1, 1]), oc = C(e, ['Outside Color'], 7, [0, 0, 1, 1]), comp = !!N(e, ['Composite On Original'], 8, 0);
  const gen = ctx.pool.acquire(ctx.canvas.width, ctx.canvas.height);
  runShader('fx:ellipse', `vec2 q=(px-u_c)/(vec2(u_w,u_h)*.5); float d=(length(q)-1.)*min(u_w,u_h)*.5; float hw=u_t*.5; float a=1.-smoothstep(hw*(1.-u_s),hw+.5,abs(d)); o=vec4(mix(u_oc,u_ic,a),a);`,
    { u_src: ctx.canvas }, { u_c: c, u_w: w, u_h: h, u_t: th, u_s: soft, u_ic: ic.slice(0, 3), u_oc: oc.slice(0, 3) }, gen);
  compositeGenerated(ctx, gen, comp ? 2 : 1, 1); ctx.pool.release(gen);
});
def(['ADBE Grid', 'ADBE Checkerboard'], (e, ctx) => {
  const grid = e.matchName === 'ADBE Grid';
  const anchor = bp(ctx, V2(e, ['Anchor'], 1, [0, 0])); const from = N(e, ['Size From'], 2, 3); const corner = bp(ctx, V2(e, ['Corner'], 3, [100, 100]));
  let w = N(e, ['Width'], 4, 50) * ctx.ls, h = N(e, ['Height'], 5, 50) * ctx.ls;
  if (from === 1) { w = Math.abs(corner[0] - anchor[0]); h = Math.abs(corner[1] - anchor[1]); } else if (from === 2) h = w;
  const border = grid ? N(e, ['Border'], 6, 3) * ctx.ls : 0; const inv = grid && !!N(e, ['Invert Grid'], 9, 0);
  const col = C(e, ['Color'], grid ? 10 : 8, [1, 1, 1, 1]), op = N(e, ['Opacity'], grid ? 11 : 9, 100) / 100, mode = N(e, ['Blending Mode'], grid ? 12 : 10, 1);
  const gen = ctx.pool.acquire(ctx.canvas.width, ctx.canvas.height);
  runShader('fx:grid', `vec2 q=(px-u_a)/vec2(max(u_w,1.),max(u_h,1.)); vec2 f=fract(q)*vec2(u_w,u_h); float a;
    if(u_grid>.5){ float bx=min(f.x,u_w-f.x), by=min(f.y,u_h-f.y); a=1.-step(u_b*.5,min(bx,by)); if(u_inv>.5) a=1.-a; }
    else { vec2 i=floor(q); a=mod(i.x+i.y,2.); } o=vec4(u_col,a);`, { u_src: ctx.canvas }, { u_a: anchor, u_w: w, u_h: h, u_b: border, u_grid: grid ? 1 : 0, u_inv: inv ? 1 : 0, u_col: col.slice(0, 3) }, gen);
  compositeGenerated(ctx, gen, mode, op); ctx.pool.release(gen);
});
def(['ADBE Fractal Noise', 'ADBE Turbulent Noise'], (e, ctx) => {
  const type = N(e, ['Fractal Type'], 1, 1), inv = !!N(e, ['Invert'], 3, 0), contrast = N(e, ['Contrast'], 4, 100) / 100, bright = N(e, ['Brightness'], 5, 0) / 100;
  const rot = N(e, ['Rotation'], null, 0), uniform = !!N(e, ['Uniform Scaling'], null, 1), sc = N(e, ['Scale'], null, 100), sw = N(e, ['Scale Width'], null, 100), sh = N(e, ['Scale Height'], null, 100);
  const offs = V2(e, ['Offset Turbulence'], null, [0, 0]), cx = N(e, ['Complexity'], null, 6), subInf = N(e, ['Sub Influence (%)', 'Sub Influence'], null, 70) / 100, subSc = N(e, ['Sub Scaling'], null, 56) / 100;
  const evo = N(e, ['Evolution'], null, 0), seed = N(e, ['Random Seed'], null, 0), op = N(e, ['Opacity'], null, 100) / 100, mode = N(e, ['Blending Mode'], null, 1);
  const scale = uniform ? [sc, sc] : [sw * sc / 100, sh * sc / 100];
  const gen = ctx.pool.acquire(ctx.canvas.width, ctx.canvas.height);
  runShader('fx:fractal', `${LC} float r=radians(u_rot); vec2 p=L-u_ofs; p=mat2(cos(r),sin(r),-sin(r),cos(r))*p; p/=max(u_scale,vec2(1.))*.01*64.;
    float amp=1., tot=0., v=0.; vec2 q=p; float z=u_evo/360.+u_seed*7.31;
    for(int i=0;i<10;i++){ if(float(i)>=u_cx) break; float n=vnoise3(vec3(q*1.,z+float(i)*3.1)); if(u_type>1.5&&u_type<3.5) n=abs(n*2.-1.); v+=n*amp; tot+=amp; amp*=u_si; q=q/max(u_ss,.05)+vec2(17.3,9.1); }
    v/=max(tot,.001); if(u_type>2.5&&u_type<3.5) v=1.-v; v=(v-.5)*u_con+.5+u_br; if(u_inv>.5) v=1.-v; o=vec4(vec3(clamp(v,0.,1.)),1.);`,
  { u_src: ctx.canvas }, { u_ls: ctx.ls, u_off: ctx.off, u_rot: rot, u_ofs: offs, u_scale: scale, u_evo: evo, u_seed: seed, u_cx: Math.min(10, Math.max(1, cx)), u_si: subInf, u_ss: subSc, u_type: type, u_con: contrast, u_br: bright, u_inv: inv ? 1 : 0 }, gen);
  compositeGenerated(ctx, gen, mode, op); ctx.pool.release(gen);
});
def('ADBE Noise', (e, ctx) => {
  const amt = N(e, ['Amount of Noise'], 1, 0) / 100, col = !!N(e, ['Use Color Noise', 'Noise Type'], 2, 1);
  shade(ctx, 'noise', `vec4 c=T(u_src,uv); float t=floor(u_time*30.); vec3 n=u_col>.5?vec3(hash(px+t),hash(px+t+7.1),hash(px+t+3.3)):vec3(hash(px+t)); o=vec4(c.rgb+(n-.5)*u_a,c.a);`, { u_a: amt, u_col: col ? 1 : 0 });
});
def(['ADBE Median', 'ADBE Dust & Scratches'], (e, ctx) => { const r = N(e, ['Radius'], 1, 1) * ctx.ls; if (r >= 1) gaussian(ctx.canvas, r * 0.5, r * 0.5, ctx.pool); });
def('ADBE Stroke', (e, ctx) => {
  const all = !!N(e, ['All Masks'], 2, 0), maskIdx = N(e, ['Path'], 1, 0), col = C(e, ['Color'], 4, [1, 1, 1, 1]), size = N(e, ['Brush Size'], 5, 2) * ctx.ls, hard = N(e, ['Brush Hardness'], 6, 75) / 100;
  const op = N(e, ['Opacity'], 7, 100) / 100, start = N(e, ['Start'], 8, 0) / 100, end = N(e, ['End'], 9, 100) / 100, style = N(e, ['Paint Style'], 11, 1);
  const masks = (ctx.masks || []).filter((m, i) => all || i + 1 === maskIdx || (!maskIdx && i === 0)); if (!masks.length) return;
  const gen = ctx.pool.acquire(ctx.canvas.width, ctx.canvas.height); const g = gen.getContext('2d');
  g.setTransform(ctx.ls, 0, 0, ctx.ls, -ctx.off[0] * ctx.ls, -ctx.off[1] * ctx.ls); g.strokeStyle = rgba(col); g.lineWidth = size / ctx.ls; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const m of masks) { const pts = sampleBezier(m.shape, 6); const tot = polyLen(pts); g.beginPath(); drawPartial(g, pts, tot * start, tot * end); g.stroke(); }
  if (hard < 1) gaussian(gen, size * (1 - hard) * 0.3, size * (1 - hard) * 0.3, ctx.pool);
  const out = ctx.canvas.getContext('2d'); out.save(); out.setTransform(1, 0, 0, 1, 0, 0); out.globalAlpha = op;
  if (style === 2) { out.globalCompositeOperation = 'copy'; out.drawImage(gen, 0, 0); } else if (style === 3) { out.globalCompositeOperation = 'destination-in'; out.drawImage(gen, 0, 0); } else out.drawImage(gen, 0, 0);
  out.restore(); ctx.pool.release(gen);
});

// --- Transition
def('ADBE Linear Wipe', (e, ctx) => {
  const done = N(e, ['Transition Completion'], 1, 0) / 100, ang = N(e, ['Wipe Angle'], 2, 90), fe = N(e, ['Feather'], 3, 0) * ctx.ls; if (done <= 0) return;
  shade(ctx, 'lwipe', `vec4 c=T(u_src,uv); float a=radians(u_ang); vec2 d=vec2(sin(a),-cos(a)); vec2 h=u_res*.5; float ext=abs(d.x)*h.x+abs(d.y)*h.y+u_fe*.5;
    float pos=dot(px-h,d); float edge=mix(-ext,ext,u_done); float m=smoothstep(edge-u_fe*.5-.5,edge+u_fe*.5+.5,pos); o=vec4(c.rgb,c.a*m);`, { u_done: done, u_ang: ang, u_fe: fe });
});
def('ADBE Radial Wipe', (e, ctx) => {
  const done = N(e, ['Transition Completion'], 1, 0) / 100, st = N(e, ['Start Angle'], 2, 0), c = bp(ctx, V2(e, ['Wipe Center'], 3, boxCenter(ctx))), dir = N(e, ['Wipe'], 4, 1), fe = N(e, ['Feather'], 5, 0) * ctx.ls;
  if (done <= 0) return;
  shade(ctx, 'rwipe', `vec4 c=T(u_src,uv); vec2 d=px-u_c; float a=degrees(atan(d.x,-d.y))-u_st; a=mod(a,360.); float lim=u_done*360.; float k;
    if(u_dir<1.5) k=a; else if(u_dir<2.5) k=mod(360.-a,360.); else { k=min(a,360.-a)*2.; }
    float soft=u_fe/max(length(d),1.)*57.3; float m=smoothstep(lim-soft*.5,lim+soft*.5+.001,k); o=vec4(c.rgb,c.a*m);`, { u_done: done, u_st: st, u_c: c, u_dir: dir, u_fe: fe });
});
def('ADBE Venetian Blinds', (e, ctx) => {
  const done = N(e, ['Transition Completion'], 1, 0) / 100, ang = N(e, ['Direction'], 2, 0), w = N(e, ['Width'], 3, 10) * ctx.ls, fe = N(e, ['Feather'], 4, 0) * ctx.ls; if (done <= 0) return;
  shade(ctx, 'blinds', `vec4 c=T(u_src,uv); float a=radians(u_ang); vec2 d=vec2(cos(a),sin(a)); float p=mod(dot(px,d),max(u_w,1.)); float edge=u_done*u_w; float m=smoothstep(edge-u_fe*.5-.5,edge+u_fe*.5+.5,p); o=vec4(c.rgb,c.a*m);`, { u_done: done, u_ang: ang, u_w: w, u_fe: fe });
});
def('ADBE Block Dissolve', (e, ctx) => {
  const done = N(e, ['Transition Completion'], 1, 0) / 100, bw = N(e, ['Block Width'], 2, 1) * ctx.ls, bh = N(e, ['Block Height'], 3, 1) * ctx.ls; if (done <= 0) return;
  shade(ctx, 'blockdis', `vec4 c=T(u_src,uv); vec2 b=floor(px/vec2(max(u_bw,1.),max(u_bh,1.))); float r=hash(b+.37); o=vec4(c.rgb,c.a*step(u_done,r));`, { u_done: done, u_bw: bw, u_bh: bh });
});
def('ADBE Iris Wipe', (e, ctx) => {
  const c = bp(ctx, V2(e, ['Iris Center'], 1, [0, 0])), pts = Math.max(3, N(e, ['Iris Points'], 2, 6)), outer = N(e, ['Outer Radius'], 3, 0) * ctx.ls, useIn = !!N(e, ['Use Inner Radius'], 4, 0), inner = N(e, ['Inner Radius'], 5, 0) * ctx.ls, rot = N(e, ['Rotation'], 6, 0), fe = N(e, ['Feather'], 7, 0) * ctx.ls;
  shade(ctx, 'iris', `vec4 c=T(u_src,uv); vec2 d=px-u_c; float a=atan(d.y,d.x)-radians(u_rot)+PI*.5; float seg=2.*PI/u_n; float f=abs(mod(a,seg)/seg*2.-1.);
    float R = u_in>.5 ? mix(u_ri,u_ro,f) : u_ro*cos(PI/u_n)/max(cos((mod(a,seg)-seg*.5)),.001); float m=smoothstep(R-u_fe*.5-.5,R+u_fe*.5+.5,length(d)); o=vec4(c.rgb,c.a*m);`,
  { u_c: c, u_n: pts, u_ro: outer, u_in: useIn ? 1 : 0, u_ri: inner, u_rot: rot, u_fe: fe });
});
def('ADBE Gradient Wipe', (e, ctx) => {
  const done = N(e, ['Transition Completion'], 1, 0) / 100, soft = N(e, ['Transition Softness'], 2, 0) / 100, li = N(e, ['Gradient Layer'], 3, 0), inv = !!N(e, ['Invert Gradient'], 5, 0);
  const m = li > 0 && ctx.getLayer ? ctx.getLayer(li) : null;
  const body = `vec4 c=T(u_src,uv); float l=${m ? 'luma(T(u_m,uv).rgb)' : 'lum601(c.rgb)'}; if(u_inv>.5) l=1.-l; float t=u_done*(1.+u_s); float k=smoothstep(t-u_s-.0001,t,l); o=vec4(c.rgb,c.a*k);`;
  shade(ctx, 'gwipe' + !!m, body, { u_done: done, u_s: soft, u_inv: inv ? 1 : 0 }, m ? { u_m: m } : {}); if (m) ctx.pool.release(m);
});
def('CC Grid Wipe', (e, ctx) => {
  const done = N(e, ['Completion'], 1, 0) / 100, c = bp(ctx, V2(e, ['Center'], 2, [0, 0])), rot = N(e, ['Rotation'], 3, 0), tiles = Math.max(1, N(e, ['Tiles'], 5, 10)), rev = !!N(e, ['Reverse Transition'], 7, 0);
  shade(ctx, 'ccgrid', `vec4 c=T(u_src,uv); float r=radians(u_rot); vec2 p=mat2(cos(r),sin(r),-sin(r),cos(r))*(px-u_c); float cell=max(u_res.x,u_res.y)/u_t; vec2 f=fract(p/cell)-.5; float dist=length(floor(p/cell))/u_t*1.4;
    float k=clamp(u_done*2.-dist*.5,0.,1.); float m=step(k*.5,max(abs(f.x),abs(f.y))); if(u_rev>.5) m=1.-m; o=vec4(c.rgb,c.a*m);`, { u_done: done, u_c: c, u_rot: rot, u_t: tiles, u_rev: rev ? 1 : 0 });
});
def(['CC Line Sweep'], (e, ctx) => {
  const done = N(e, ['Completion'], 1, 0) / 100, dir = N(e, ['Direction'], 2, 0), th = N(e, ['Thickness'], 3, 20) * ctx.ls, slant = N(e, ['Slant'], 4, 0) * ctx.ls, flip = !!N(e, ['Flip Direction'], 5, 0);
  shade(ctx, 'ccline', `vec4 c=T(u_src,uv); float a=radians(u_dir); vec2 d=vec2(sin(a),-cos(a)); vec2 n=vec2(-d.y,d.x); float along=dot(px-u_res*.5,d); float across=dot(px,n); float band=mod(across,max(u_th,1.))/max(u_th,1.);
    float ext=length(u_res)*.5+abs(u_sl); float edge=mix(-ext,ext,u_done)+band*u_sl; float m=step(edge,along); if(u_f>.5) m=1.-m; o=vec4(c.rgb,c.a*m);`, { u_done: done, u_dir: dir, u_th: th, u_sl: slant, u_f: flip ? 1 : 0 });
});

// --- Distort
def('ADBE Geometry2', (e, ctx) => { // Transform effect
  const an = V2(e, ['Anchor Point'], 1, [0, 0]), pos = V2(e, ['Position'], 2, an); const uni = !!N(e, ['Uniform Scale'], 11, 1);
  const sh = N(e, ['Scale Height', 'Scale'], 3, 100) / 100, sw = uni ? sh : N(e, ['Scale Width'], 4, 100) / 100;
  const skew = N(e, ['Skew'], 5, 0), skAx = N(e, ['Skew Axis'], 6, 0), rot = N(e, ['Rotation'], 7, 0), op = N(e, ['Opacity'], 8, 100) / 100;
  // layer-space affine: T(pos) R Skew S T(-anchor), then wrap into buffer space
  const r = (rot * Math.PI) / 180, k = Math.tan((-skew * Math.PI) / 180), ax = (skAx * Math.PI) / 180;
  let M = [sw, 0, 0, sh, -an[0] * sw, -an[1] * sh];
  const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  if (skew) { const ca = Math.cos(ax), sa = Math.sin(ax); M = mul([ca, sa, -sa, ca, 0, 0], mul([1, 0, k, 1, 0, 0], mul([ca, -sa, sa, ca, 0, 0], M))); }
  M = mul([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), pos[0], pos[1]], M);
  const B = [ctx.ls, 0, 0, ctx.ls, -ctx.off[0] * ctx.ls, -ctx.off[1] * ctx.ls], Bi = [1 / ctx.ls, 0, 0, 1 / ctx.ls, ctx.off[0], ctx.off[1]];
  affine(ctx, mul(B, mul(M, Bi)), op);
});
def(['ADBE Corner Pin', 'CC Power Pin'], (e, ctx) => {
  const cc = e.matchName === 'CC Power Pin'; const w = ctx.canvas.width / ctx.ls, h = ctx.canvas.height / ctx.ls; const o = ctx.off;
  const ul = bp(ctx, V2(e, ['Upper Left', 'Top Left'], 1, [o[0], o[1]])), ur = bp(ctx, V2(e, ['Upper Right', 'Top Right'], 2, [o[0] + w, o[1]]));
  const ll = bp(ctx, V2(e, ['Lower Left', 'Bottom Left'], cc ? 3 : 3, [o[0], o[1] + h])), lr = bp(ctx, V2(e, ['Lower Right', 'Bottom Right'], cc ? 4 : 4, [o[0] + w, o[1] + h]));
  // source rect = the layer box (layer coords 0..lw, 0..lh)
  const bx = boxOf(ctx); const s0 = bp(ctx, [bx[0], bx[1]]), s1 = bp(ctx, [bx[2], bx[3]]);
  const Hm = homography([ul, ur, lr, ll], [[s0[0], s0[1]], [s1[0], s0[1]], [s1[0], s1[1]], [s0[0], s1[1]]]); // dst -> src
  shade(ctx, 'cornerpin', `vec3 q=u_h*vec3(px,1.); vec2 s=q.xy/q.z; o = q.z>0. ? TC(u_src, s/u_res) : vec4(0.);`, { u_h: { mat3: Hm } });
});
def('ADBE Offset', (e, ctx) => {
  const sh = bp(ctx, V2(e, ['Shift Center To'], 1, [0, 0])); const bl = N(e, ['Blend With Original'], 2, 0) / 100; const c0 = bp(ctx, boxCenter(ctx));
  const bx = boxOf(ctx); const lw = (bx[2] - bx[0]) * ctx.ls, lh = (bx[3] - bx[1]) * ctx.ls; const b0 = bp(ctx, [bx[0], bx[1]]);
  shade(ctx, 'offset', `vec2 q=px-u_b0; vec2 s=mod(q-(u_sh-u_c0),u_sz)+u_b0; vec4 a=TC(u_src,s/u_res), c=T(u_src,uv); o=mix(a,c,u_bl);`, { u_sh: sh, u_c0: c0, u_sz: [lw, lh], u_b0: b0, u_bl: bl });
});
def(['ADBE Tile'], (e, ctx) => { // Motion Tile
  const bx = boxOf(ctx); const lw = bx[2] - bx[0], lh = bx[3] - bx[1];
  const c = bp(ctx, V2(e, ['Tile Center'], 1, boxCenter(ctx))), tw = N(e, ['Tile Width'], 2, 100) / 100 * lw * ctx.ls, th = N(e, ['Tile Height'], 3, 100) / 100 * lh * ctx.ls;
  const mirror = !!N(e, ['Mirror Edges'], 6, 0), phase = N(e, ['Phase'], 7, 0), hshift = !!N(e, ['Horizontal Phase Shift'], 8, 0); const b0 = bp(ctx, [0, 0]);
  shade(ctx, 'mtile', `vec2 q=(px-u_c)/vec2(u_tw,u_th); float ph=u_ph/360.; if(u_hs>.5) q.y+=floor(q.x)*ph; else q.x+=floor(q.y)*ph; vec2 f=fract(q+.5); vec2 i=floor(q+.5);
    if(u_m>.5){ if(mod(i.x,2.)!=0.) f.x=1.-f.x; if(mod(i.y,2.)!=0.) f.y=1.-f.y; } vec2 s=u_b0+f*u_lsz; o=TC(u_src,s/u_res);`, { u_c: c, u_tw: tw, u_th: th, u_ph: phase, u_hs: hshift ? 1 : 0, u_m: mirror ? 1 : 0, u_b0: b0, u_lsz: [lw * ctx.ls, lh * ctx.ls] });
});
def(['CC RepeTile'], (e, ctx) => {
  const bx = boxOf(ctx); const lw = bx[2] - bx[0], lh = bx[3] - bx[1]; const tiling = N(e, ['Tiling'], 5, 1); const b0 = bp(ctx, [bx[0], bx[1]]);
  shade(ctx, 'repetile', `vec2 q=(px-u_b0)/u_lsz; vec2 i=floor(q); vec2 f=fract(q); if(u_t>1.5){ if(mod(i.x,2.)!=0.) f.x=1.-f.x; if(mod(i.y,2.)!=0.) f.y=1.-f.y; } o=TC(u_src,(u_b0+f*u_lsz)/u_res);`, { u_t: tiling, u_b0: b0, u_lsz: [lw * ctx.ls, lh * ctx.ls] });
});
def(['CC Tiler'], (e, ctx) => {
  const sc = N(e, ['Scale'], 1, 50) / 100, c = bp(ctx, V2(e, ['Center'], 2, boxCenter(ctx))), bl = N(e, ['Blend w. Original'], 3, 0) / 100; const bx = boxOf(ctx); const b0 = bp(ctx, [bx[0], bx[1]]);
  const lsz = [(bx[2] - bx[0]) * ctx.ls, (bx[3] - bx[1]) * ctx.ls];
  shade(ctx, 'tiler', `vec2 t=u_lsz*max(u_sc,.01); vec2 f=fract((px-u_c)/t+.5); vec4 a=TC(u_src,(u_b0+f*u_lsz)/u_res); o=mix(a,T(u_src,uv),u_bl);`, { u_sc: sc, u_c: c, u_bl: bl, u_b0: b0, u_lsz: lsz });
});
def('ADBE Mirror', (e, ctx) => {
  const c = bp(ctx, V2(e, ['Reflection Center'], 1, [0, 0])), a = (N(e, ['Reflection Angle'], 2, 0) * Math.PI) / 180;
  shade(ctx, 'mirror', `vec2 n=vec2(cos(u_a),sin(u_a)); vec2 d=px-u_c; float k=dot(d,n); vec2 s = k>0. ? px-2.*k*n : px; o=TC(u_src,s/u_res);`, { u_c: c, u_a: a });
});
def('ADBE Twirl', (e, ctx) => {
  const ang = N(e, ['Angle'], 1, 0), rad = N(e, ['Twirl Radius'], 2, 30) / 100, c = bp(ctx, V2(e, ['Twirl Center'], 3, [0, 0]));
  const bx = boxOf(ctx); const R = rad * Math.max(bx[2] - bx[0], bx[3] - bx[1]) * ctx.ls * 0.5;
  shade(ctx, 'twirl', `vec2 d=px-u_c; float r=length(d); float f=clamp(1.-r/max(u_r,1.),0.,1.); float a=radians(u_ang)*f*f; vec2 s=u_c+mat2(cos(a),-sin(a),sin(a),cos(a))*d; o=TC(u_src,s/u_res);`, { u_c: c, u_r: R, u_ang: ang });
});
def('ADBE Bulge', (e, ctx) => {
  const hr = N(e, ['Horizontal Radius'], 1, 50) * ctx.ls, vr = N(e, ['Vertical Radius'], 2, 50) * ctx.ls, c = bp(ctx, V2(e, ['Bulge Center'], 3, [0, 0])), ht = N(e, ['Bulge Height'], 4, 1);
  shade(ctx, 'bulge', `vec2 d=(px-u_c)/vec2(max(u_hr,1.),max(u_vr,1.)); float r=length(d); vec2 s=px; if(r<1.){ float k=pow(r, 1.+u_h*.6*(1.-r)); s=u_c+d/max(r,.0001)*k*vec2(u_hr,u_vr); } o=TC(u_src,s/u_res);`, { u_c: c, u_hr: hr, u_vr: vr, u_h: ht });
});
def('ADBE Spherize', (e, ctx) => {
  const r = N(e, ['Radius'], 1, 0) * ctx.ls, c = bp(ctx, V2(e, ['Center of Sphere'], 2, [0, 0])); if (r < 1) return;
  shade(ctx, 'spherize', `vec2 d=(px-u_c)/u_r; float l=length(d); vec2 s=px; if(l<1.){ float k=asin(l)/(PI*.5); s=u_c+d/max(l,.0001)*k*u_r; } o=TC(u_src,s/u_res);`, { u_c: c, u_r: r });
});
def('ADBE Wave Warp', (e, ctx) => {
  const type = N(e, ['Wave Type'], 1, 1), hgt = N(e, ['Wave Height'], 2, 10) * ctx.ls, wid = N(e, ['Wave Width'], 3, 40) * ctx.ls, dir = N(e, ['Direction'], 4, 90), speed = N(e, ['Wave Speed'], 5, 1), phase = N(e, ['Phase'], 7, 0);
  shade(ctx, 'wavewarp', `float a=radians(u_dir); vec2 d=vec2(sin(a),-cos(a)); vec2 n=vec2(-d.y,d.x); float x=dot(px,n)/max(u_w,1.)+u_time*u_sp+u_ph/360.; float f=fract(x); int t=int(u_ty+.5);
    float w = t==1?sin(x*2.*PI): t==2?(f<.5?1.:-1.): t==3?(1.-abs(f*2.-1.))*2.-1.: t==4?f*2.-1.: t==5?sin(x*2.*PI)>0.?sin(x*2.*PI):-sin(x*2.*PI): sin(x*2.*PI);
    vec2 s=px-d*w*u_h; o=TC(u_src,s/u_res);`, { u_ty: type, u_h: hgt, u_w: wid, u_dir: dir, u_sp: speed, u_ph: phase });
});
def(['ADBE Turbulent Displace'], (e, ctx) => {
  const amt = N(e, ['Amount'], 2, 50) * ctx.ls * 0.5, size = N(e, ['Size'], 3, 100) * ctx.ls, offs = bp(ctx, V2(e, ['Offset (Turbulence)', 'Offset'], 4, [0, 0])), cx = N(e, ['Complexity'], 5, 1), evo = N(e, ['Evolution'], 6, 0);
  shade(ctx, 'turbdisp', `vec2 q=(px-u_o)/max(u_sz,1.); float z=u_evo/360.; vec2 dsp=vec2(0.); float amp=1.; for(int i=0;i<4;i++){ if(float(i)>=u_cx) break; dsp+=amp*(vec2(vnoise3(vec3(q,z)),vnoise3(vec3(q+19.7,z)))-.5); q*=2.; amp*=.5; }
    o=TC(u_src,(px+dsp*u_amt*2.)/u_res);`, { u_o: offs, u_sz: size, u_evo: evo, u_cx: Math.max(1, cx), u_amt: amt });
});
def(['ADBE Ripple'], (e, ctx) => {
  const r = N(e, ['Radius'], 1, 50) / 100 * Math.max(ctx.canvas.width, ctx.canvas.height), c = bp(ctx, V2(e, ['Center of Ripple'], 2, [0, 0])), sp = N(e, ['Wave Speed'], 4, 1), w = N(e, ['Wave Width'], 5, 20) * ctx.ls, h = N(e, ['Wave Height'], 6, 20) * ctx.ls, ph = N(e, ['Ripple Phase'], 7, 0);
  shade(ctx, 'ripple', `vec2 d=px-u_c; float l=length(d); float k=clamp(1.-l/max(u_r,1.),0.,1.); float wv=sin((l/max(u_w,1.)-u_time*u_sp)*2.*PI+radians(u_ph))*u_h*k; o=TC(u_src,(px+d/max(l,.001)*wv)/u_res);`, { u_c: c, u_r: r, u_sp: sp, u_w: w, u_h: h, u_ph: ph });
});
def(['ADBE Polar Coordinates'], (e, ctx) => {
  const interp = N(e, ['Interpolation'], 1, 0) / 100, type = N(e, ['Type of Conversion'], 2, 1);
  shade(ctx, 'polar', `vec2 c=u_res*.5; vec2 s; if(u_t<1.5){ vec2 d=px-c; float a=atan(d.x,-d.y)/(2.*PI)+.5; float r=length(d)/(min(u_res.x,u_res.y)*.5); s=vec2(a*u_res.x, r*u_res.y); }
    else { float a=(px.x/u_res.x-.5)*2.*PI; float r=px.y/u_res.y*min(u_res.x,u_res.y)*.5; s=c+vec2(sin(a),-cos(a))*r; } s=mix(px,s,u_i); o=TC(u_src,s/u_res);`, { u_i: interp, u_t: type });
});
def(['ADBE Displacement Map'], (e, ctx) => {
  const li = N(e, ['Displacement Map Layer'], 1, 0); const m = li > 0 && ctx.getLayer ? ctx.getLayer(li) : null; if (!m) return;
  const hc = N(e, ['Use For Horizontal Displacement'], 2, 1), mh = N(e, ['Max Horizontal Displacement'], 3, 5) * ctx.ls, vc = N(e, ['Use For Vertical Displacement'], 4, 2), mv = N(e, ['Max Vertical Displacement'], 5, 5) * ctx.ls;
  shade(ctx, 'dispmap', `vec4 m=T(u_m,uv); vec3 h=rgb2hsl(m.rgb); float ch[12]=float[12](0.,m.r,m.g,m.b,m.a,luma(m.rgb),h.x,h.z,h.y,1.,.5,0.);
    vec2 d=vec2((ch[int(u_hc)]-.5)*2.*u_mh,(ch[int(u_vc)]-.5)*2.*u_mv); o=TC(u_src,(px+d)/u_res);`, { u_hc: Math.min(11, hc), u_mh: mh, u_vc: Math.min(11, vc), u_mv: mv }, { u_m: m });
  ctx.pool.release(m);
});
def(['ADBE Optics Compensation'], (e, ctx) => {
  const fov = N(e, ['Field Of View (FOV)', 'Field of View (FOV)'], 1, 0), rev = !!N(e, ['Reverse Lens Distortion'], 2, 0); if (!fov) return;
  shade(ctx, 'optics', `vec2 c=u_res*.5; vec2 d=(px-c)/(length(u_res)*.5); float r=length(d); float k=tan(radians(u_f)*.5); float rr = u_rev>.5 ? atan(r*k)/max(atan(k),.0001) : tan(r*atan(k))/max(k,.0001); o=TC(u_src,(c+d/max(r,.0001)*rr*length(u_res)*.5)/u_res);`, { u_f: fov, u_rev: rev ? 1 : 0 });
});
def(['CC Lens'], (e, ctx) => {
  const c = bp(ctx, V2(e, ['Center'], 1, [0, 0])), size = N(e, ['Size'], 2, 50) / 100 * Math.max(ctx.canvas.width, ctx.canvas.height), conv = N(e, ['Convergence'], 3, 50) / 100;
  shade(ctx, 'cclens', `vec2 d=(px-u_c)/max(u_s,1.); float r=length(d); vec2 s=u_c+d*pow(max(r,.0001),u_cv)*u_s; o= r<1. ? TC(u_src,s/u_res) : vec4(0.);`, { u_c: c, u_s: size, u_cv: 1 - conv * 0.9 });
});
def(['CC Kaleida'], (e, ctx) => {
  const c = bp(ctx, V2(e, ['Center'], 1, [0, 0])), size = N(e, ['Size'], 2, 100) * ctx.ls, rot = N(e, ['Rotation'], 4, 0);
  shade(ctx, 'kaleida', `vec2 d=px-u_c; float a=atan(d.y,d.x)-radians(u_r); float seg=PI/3.; a=mod(a,seg*2.); if(a>seg) a=seg*2.-a; float l=length(d); l=mod(l,max(u_s,1.)*2.); if(l>u_s) l=u_s*2.-l; o=TC(u_src,(u_c+vec2(cos(a),sin(a))*l)/u_res);`, { u_c: c, u_s: size, u_r: rot });
});
def(['CC Bend It'], (e, ctx) => {
  const bend = N(e, ['Bend'], 1, 0), st = bp(ctx, V2(e, ['Start'], 2, [0, 0])), en = bp(ctx, V2(e, ['End'], 3, [0, 100]));
  shade(ctx, 'bendit', `vec2 ax=u_e-u_s; float L=length(ax); vec2 d=ax/max(L,.001); vec2 n=vec2(-d.y,d.x); vec2 q=px-u_s; float t=clamp(dot(q,d)/max(L,.001),0.,1.); float off=sin(t*PI*.5)*u_b*.01*L*t; o=TC(u_src,(px-n*off)/u_res);`, { u_s: st, u_e: en, u_b: bend });
});
def(['CC Split', 'CC Split 2'], (e, ctx) => {
  const a = bp(ctx, V2(e, ['Point A'], 1, [0, 0])), b = bp(ctx, V2(e, ['Point B'], 2, [100, 0])), sp = N(e, ['Split'], 3, 0) * ctx.ls;
  shade(ctx, 'ccsplit', `vec2 ab=u_b-u_a; float L=length(ab); vec2 d=ab/max(L,.001); vec2 n=vec2(-d.y,d.x); vec2 q=px-u_a; float t=dot(q,d)/max(L,.001); float side=dot(q,n); float w=t>0.&&t<1.?sin(t*PI)*u_sp*.5:0.;
    vec2 s = abs(side)<w ? vec2(-1.) : px - n*sign(side)*w; o = s.x<0. ? vec4(0.) : TC(u_src,s/u_res);`, { u_a: a, u_b: b, u_sp: sp });
});
def(['CC Griddler'], (e, ctx) => {
  const hs = N(e, ['Horizontal Scale'], 1, 100) / 100, vs = N(e, ['Vertical Scale'], 2, 100) / 100, ts = Math.max(1, N(e, ['Tile Size'], 3, 10) / 100 * Math.min(ctx.canvas.width, ctx.canvas.height)), rot = N(e, ['Rotation'], 4, 0), cut = !!N(e, ['Cut Tiles'], 5, 0);
  shade(ctx, 'griddler', `vec2 cell=floor(px/u_ts); vec2 cc=(cell+.5)*u_ts; vec2 d=px-cc; float r=radians(u_r); d=mat2(cos(r),-sin(r),sin(r),cos(r))*d/vec2(max(u_hs,.01),max(u_vs,.01)); vec2 s=cc+d;
    o = (u_cut>.5 && (abs(d.x)>u_ts*.5||abs(d.y)>u_ts*.5)) ? vec4(0.) : TC(u_src,s/u_res);`, { u_ts: ts, u_hs: hs, u_vs: vs, u_r: rot, u_cut: cut ? 1 : 0 });
});

// --- Stylize / Perspective
def('ADBE Glo2', (e, ctx) => {
  const basedOn = N(e, ['Glow Based On'], 1, 2), th = level01(P(e, ['Glow Threshold'], 2), 0.6), rad = N(e, ['Glow Radius'], 3, 10) * ctx.ls, inten = N(e, ['Glow Intensity'], 4, 1);
  const compOrig = N(e, ['Composite Original'], 5, 2), opn = N(e, ['Glow Operation'], 6, 3), colors = N(e, ['Glow Colors'], 7, 1), ca = C(e, ['Color A'], 12, [1, 1, 1, 1]), cb = C(e, ['Color B'], 13, [0, 0, 0, 1]), dim = N(e, ['Glow Dimensions'], 14, 1);
  if (th > 1) return;
  const orig = copyOf(ctx); const glow = ctx.pool.acquire(ctx.canvas.width, ctx.canvas.height);
  runShader('fx:glowsrc', `vec4 c=T(u_src,uv); float v=u_b<1.5?c.a:luma(c.rgb)*c.a; float k=clamp((v-u_th)/max(1.-u_th,.0001),0.,1.); vec3 col = u_cm>1.5 ? mix(u_cb,u_ca,k) : c.rgb; o=vec4(col,k*(u_b<1.5?1.:1.));`,
    { u_src: orig }, { u_b: basedOn, u_th: th, u_cm: colors, u_ca: ca.slice(0, 3), u_cb: cb.slice(0, 3) }, glow);
  gaussian(glow, dim === 3 ? 0 : rad * 0.5, dim === 2 ? 0 : rad * 0.5, ctx.pool);
  const g = ctx.canvas.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  const op = ['lighter', 'lighter', 'source-over', 'lighter', 'screen', 'multiply', 'overlay', 'soft-light', 'hard-light', 'color-dodge', 'color-burn', 'darken', 'lighten', 'difference'][opn] || 'lighter';
  if (compOrig === 3) { g.globalCompositeOperation = 'copy'; g.drawImage(glow, 0, 0); } // None: glow only
  else if (compOrig === 1) { g.globalCompositeOperation = 'copy'; g.globalAlpha = 1; g.drawImage(glow, 0, 0); g.globalCompositeOperation = 'source-over'; g.drawImage(orig, 0, 0); } // On Top
  else { for (let i = 0; i < Math.ceil(inten); i++) { g.globalCompositeOperation = op; g.globalAlpha = Math.min(1, inten - i); g.drawImage(glow, 0, 0); } } // Behind / default
  g.restore(); ctx.pool.release(glow); ctx.pool.release(orig);
});
def('ADBE Mosaic', (e, ctx) => {
  const hb = Math.max(1, N(e, ['Horizontal Blocks'], 1, 10)), vb = Math.max(1, N(e, ['Vertical Blocks'], 2, 10));
  shade(ctx, 'mosaic', `vec2 n=vec2(u_h,u_v); vec2 c=(floor(uv*n)+.5)/n; o=T(u_src,c);`, { u_h: hb, u_v: vb });
});
def(['ADBE Find Edges'], (e, ctx) => {
  const inv = !!N(e, ['Invert'], 1, 0), bl = N(e, ['Blend With Original'], 2, 0) / 100;
  shade(ctx, 'findedges', `vec2 d=1./u_res; vec4 c=T(u_src,uv); vec3 gx=T(u_src,uv+vec2(d.x,0.)).rgb-T(u_src,uv-vec2(d.x,0.)).rgb, gy=T(u_src,uv+vec2(0.,d.y)).rgb-T(u_src,uv-vec2(0.,d.y)).rgb;
    vec3 ed=1.-clamp(sqrt(gx*gx+gy*gy)*2.,0.,1.); if(u_i>.5) ed=1.-ed; o=vec4(mix(ed,c.rgb,u_b),c.a);`, { u_i: inv ? 1 : 0, u_b: bl });
});
def(['ADBE Emboss', 'ADBE Color Emboss'], (e, ctx) => {
  const dir = (N(e, ['Direction'], 1, 45) * Math.PI) / 180, relief = N(e, ['Relief'], 2, 1.5) * ctx.ls, contrast = N(e, ['Contrast'], 3, 100) / 100, bl = N(e, ['Blend With Original'], 4, 0) / 100; const colr = e.matchName === 'ADBE Color Emboss';
  shade(ctx, 'emboss' + colr, `vec2 d=vec2(cos(u_d),-sin(u_d))*u_r/u_res; vec4 c=T(u_src,uv); vec3 df=(T(u_src,uv-d).rgb-T(u_src,uv+d).rgb)*u_c; vec3 r=${colr ? 'c.rgb+df' : 'vec3(.5+luma(df))'}; o=vec4(mix(r,c.rgb,u_b),c.a);`, { u_d: dir, u_r: relief, u_c: contrast, u_b: bl });
});
def(['ADBE Roughen Edges'], (e, ctx) => {
  const border = N(e, ['Border'], 3, 8) * ctx.ls, sharp = N(e, ['Edge Sharpness'], 4, 1), scale = N(e, ['Scale'], 6, 100) * ctx.ls * 0.25, evo = N(e, ['Evolution'], 10, 0);
  const orig = copyOf(ctx); gaussian(ctx.canvas, border * 0.5, border * 0.5, ctx.pool);
  const out = ctx.pool.acquire(ctx.canvas.width, ctx.canvas.height);
  if (runShader('fx:roughen', `vec4 c=T(u_o,uv); float b=T(u_b,uv).a; float n=vnoise3(vec3(px/max(u_sc,1.),u_evo/360.))*.6+vnoise3(vec3(px/max(u_sc*.4,1.),u_evo/360.+3.))*.4; float a=smoothstep(.5-.5/u_sh,.5+.5/u_sh,b+(n-.5)); o=vec4(c.rgb,min(c.a,a)*step(.001,c.a+a));`,
    { u_o: orig, u_b: ctx.canvas }, { u_sc: scale, u_evo: evo, u_sh: Math.max(0.1, sharp * 2) }, out)) replace(ctx, out);
  ctx.pool.release(out); ctx.pool.release(orig);
});
def(['ADBE Scatter'], (e, ctx) => {
  const amt = N(e, ['Scatter Amount'], 1, 20) * ctx.ls, rnd = !!N(e, ['Randomize Scatter Every Frame'], 3, 0);
  shade(ctx, 'scatter', `float t=u_rnd>.5?floor(u_time*30.):0.; vec2 d=(vec2(hash(px+t),hash(px.yx+t+1.7))-.5)*u_a*2.; o=TC(u_src,(px+d)/u_res);`, { u_a: amt, u_rnd: rnd ? 1 : 0 });
});
def(['ADBE Strobe Light'], (e, ctx) => {
  const col = C(e, ['Strobe Color'], 1, [1, 1, 1, 1]), bl = N(e, ['Blend With Original'], 2, 0) / 100, dur = N(e, ['Strobe Duration (secs)'], 3, 0.05), per = N(e, ['Strobe Period (secs)'], 4, 1);
  if (per <= 0 || ctx.time % per > dur) return;
  shade(ctx, 'strobe', `vec4 c=T(u_src,uv); o=vec4(mix(u_c,c.rgb,u_b),c.a);`, { u_c: col.slice(0, 3), u_b: bl });
});
def('ADBE Drop Shadow', (e, ctx) => {
  const col = C(e, ['Shadow Color'], 1, [0, 0, 0, 1]); let op = N(e, ['Opacity'], 2, 127.5); if (op > 1) op /= 255;
  const dir = (N(e, ['Direction'], 3, 135) * Math.PI) / 180, dist = N(e, ['Distance'], 4, 5) * ctx.ls, soft = N(e, ['Softness'], 5, 0) * ctx.ls, only = !!N(e, ['Shadow Only'], 6, 0);
  dropShadow(ctx, col, op, Math.sin(dir) * dist, -Math.cos(dir) * dist, soft * 0.5, only);
});
def('ADBE Radial Shadow', (e, ctx) => {
  const col = C(e, ['Shadow Color'], 1, [0, 0, 0, 1]); let op = N(e, ['Opacity'], 2, 50); if (op > 1) op /= 100;
  const light = bp(ctx, V2(e, ['Light Source'], 3, [0, 0])), dist = N(e, ['Projection Distance'], 4, 10) * ctx.ls, soft = N(e, ['Softness'], 5, 0) * ctx.ls, only = !!N(e, ['Shadow Only'], 8, 0);
  const cx = ctx.canvas.width / 2, cy = ctx.canvas.height / 2; const d = Math.hypot(cx - light[0], cy - light[1]) || 1;
  dropShadow(ctx, col, op, ((cx - light[0]) / d) * dist, ((cy - light[1]) / d) * dist, soft * 0.5, only);
});
function dropShadow(ctx, col, op, dx, dy, blur, only) {
  const sh = ctx.pool.acquire(ctx.canvas.width, ctx.canvas.height); const sg = sh.getContext('2d');
  sg.drawImage(ctx.canvas, dx, dy); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = rgba(col, op); sg.fillRect(0, 0, sh.width, sh.height);
  if (blur > 0.3) gaussian(sh, blur, blur, ctx.pool);
  const g = ctx.canvas.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  if (only) { g.globalCompositeOperation = 'copy'; g.drawImage(sh, 0, 0); } else { g.globalCompositeOperation = 'destination-over'; g.drawImage(sh, 0, 0); }
  g.restore(); ctx.pool.release(sh);
}
def(['ADBE Bevel Alpha', 'ADBE Bevel Edges'], (e, ctx) => {
  const th = N(e, ['Edge Thickness'], 1, 2) * ctx.ls, ang = (N(e, ['Light Angle'], 2, -60) * Math.PI) / 180, lc = C(e, ['Light Color'], 3, [1, 1, 1, 1]), li = N(e, ['Light Intensity'], 4, 0.4);
  const edges = e.matchName === 'ADBE Bevel Edges';
  const orig = copyOf(ctx); const hgt = ctx.pool.acquire(ctx.canvas.width, ctx.canvas.height); hgt.getContext('2d').drawImage(orig, 0, 0);
  if (!edges) gaussian(hgt, th * 0.5, th * 0.5, ctx.pool);
  const out = ctx.pool.acquire(ctx.canvas.width, ctx.canvas.height);
  if (runShader('fx:bevel' + edges, `vec4 c=T(u_o,uv); vec2 d=1./u_res; float h;
    ${edges ? 'vec2 q=min(px,u_res-px); float e=min(q.x,q.y); h=clamp(e/max(u_th,1.),0.,1.);' : 'h=T(u_h,uv).a;'}
    float hx=${edges ? 'clamp(min(px.x+1.,u_res.x-px.x-1.)/max(u_th,1.),0.,1.)-clamp(min(px.x-1.,u_res.x-px.x+1.)/max(u_th,1.),0.,1.)' : 'T(u_h,uv+vec2(d.x,0.)).a-T(u_h,uv-vec2(d.x,0.)).a'};
    float hy=${edges ? 'clamp(min(px.y+1.,u_res.y-px.y-1.)/max(u_th,1.),0.,1.)-clamp(min(px.y-1.,u_res.y-px.y+1.)/max(u_th,1.),0.,1.)' : 'T(u_h,uv+vec2(0.,d.y)).a-T(u_h,uv-vec2(0.,d.y)).a'};
    vec2 l=vec2(cos(u_a),-sin(u_a)); float s=clamp(-(hx*l.x+hy*l.y)*u_th*.5,-1.,1.)*u_i*2.; vec3 r = s>0. ? mix(c.rgb,u_lc,s) : c.rgb*(1.+s); o=vec4(r,c.a);`,
  { u_o: orig, u_h: hgt }, { u_th: Math.max(1, th), u_a: ang, u_lc: lc.slice(0, 3), u_i: li }, out)) replace(ctx, out);
  ctx.pool.release(out); ctx.pool.release(hgt); ctx.pool.release(orig);
});
def(['ADBE Basic 3D'], (e, ctx) => {
  const sw = (N(e, ['Swivel'], 1, 0) * Math.PI) / 180, tl = (N(e, ['Tilt'], 2, 0) * Math.PI) / 180, dist = N(e, ['Distance to Image'], 3, 0) * ctx.ls;
  const w = ctx.canvas.width, h = ctx.canvas.height, f = Math.max(w, h) * 1.5;
  const proj = ([x, y]) => { let X = x - w / 2, Y = y - h / 2, Z = 0; const x1 = X * Math.cos(sw) + Z * Math.sin(sw), z1 = -X * Math.sin(sw) + Z * Math.cos(sw); const y2 = Y * Math.cos(tl) - z1 * Math.sin(tl), z2 = Y * Math.sin(tl) + z1 * Math.cos(tl) + dist; const k = f / (f + z2); return [w / 2 + x1 * k, h / 2 + y2 * k]; };
  const src = [[0, 0], [w, 0], [w, h], [0, h]]; const Hm = homography(src.map(proj), src);
  shade(ctx, 'cornerpin', `vec3 q=u_h*vec3(px,1.); vec2 s=q.xy/q.z; o = q.z>0. ? TC(u_src, s/u_res) : vec4(0.);`, { u_h: { mat3: Hm } });
});
def(['CC Light Sweep'], (e, ctx) => {
  const c = bp(ctx, V2(e, ['Center'], 1, [0, 0])), dir = N(e, ['Direction'], 2, -35), shape = N(e, ['Shape'], 3, 2), w = N(e, ['Width'], 4, 50) * ctx.ls, si = N(e, ['Sweep Intensity'], 5, 50) / 100;
  const ei = N(e, ['Edge Intensity'], 6, 100) / 100, et = N(e, ['Edge Thickness'], 7, 1) * ctx.ls, lc = C(e, ['Light Color'], 8, [1, 1, 1, 1]), rec = N(e, ['Light Reception'], 9, 1);
  shade(ctx, 'lightsweep', `vec4 c=T(u_src,uv); float a=radians(u_dir); vec2 n=vec2(cos(a),sin(a)); float d=abs(dot(px-u_c,n))/max(u_w,1.);
    float k = u_sh<1.5 ? step(d,1.) : u_sh<2.5 ? max(0.,1.-d) : max(0.,1.-d*d); k*=u_si*2.;
    vec2 g=1./u_res; float edge=clamp((c.a-T(u_src,uv+vec2(g.x,0.)*u_et).a)+(c.a-T(u_src,uv-vec2(0.,g.y)*u_et).a),0.,1.)*u_ei*k;
    vec3 r = u_rec<1.5 ? c.rgb+u_lc*(k+edge) : u_rec<2.5 ? u_lc*(k+edge) : mix(c.rgb, c.rgb*u_lc, k+edge); o=vec4(r, u_rec>1.5&&u_rec<2.5 ? c.a*clamp(k+edge,0.,1.) : c.a);`,
  { u_c: c, u_dir: dir, u_sh: shape, u_w: w, u_si: si, u_ei: ei, u_et: Math.max(1, et), u_lc: lc.slice(0, 3), u_rec: rec });
});
def(['CC Light Rays', 'CC Light Burst 2.5'], (e, ctx) => {
  const rays = e.matchName === 'CC Light Rays';
  const inten = N(e, ['Intensity'], rays ? 1 : 2, 100) / 100, c = bp(ctx, V2(e, ['Center'], rays ? 2 : 1, [0, 0])), rad = N(e, ['Radius', 'Ray Length'], 3, 50);
  const orig = copyOf(ctx);
  shade(ctx, 'lightrays', `vec4 acc=vec4(0.); for(int i=0;i<48;i++){ float f=float(i)/47.; vec2 p=u_c+(px-u_c)*(1.-f*u_r*.01); acc+=texture(u_src,p/u_res)*(1.-f); } acc/=24.; o=acc.a>0.?vec4(acc.rgb/acc.a,min(1.,acc.a*u_i)):vec4(0.);`, { u_c: c, u_r: Math.min(95, rad), u_i: inten });
  const g = ctx.canvas.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'destination-over'; g.drawImage(orig, 0, 0); g.restore(); ctx.pool.release(orig);
});
def(['ADBE Lens Flare'], (e, ctx) => {
  const c = bp(ctx, V2(e, ['Flare Center'], 1, [0, 0])), br = N(e, ['Flare Brightness'], 2, 100) / 100, bl = N(e, ['Blend With Original'], 4, 0) / 100;
  shade(ctx, 'flare', `vec4 c=T(u_src,uv); vec2 d=(px-u_c)/length(u_res); float r=length(d); vec3 f=vec3(1.,.95,.85)*exp(-r*r*120./max(u_b,.01))*u_b + vec3(.6,.7,1.)*exp(-pow(r-.25*u_b,2.)*3000.)*.3*u_b;
    vec2 g=u_res*.5-(u_c-u_res*.5); f+=vec3(.5,.8,1.)*exp(-pow(length(px-g)/length(u_res),2.)*4000.)*.3*u_b; vec3 r_=c.rgb*c.a+f; o=vec4(mix(r_,c.rgb,u_bl),max(c.a,clamp(max(f.r,max(f.g,f.b)),0.,1.)));`, { u_c: c, u_b: br, u_bl: bl });
});
def(['ADBE Beam'], (e, ctx) => {
  const a = bp(ctx, V2(e, ['Starting Point'], 1, [0, 0])), b = bp(ctx, V2(e, ['Ending Point'], 2, [100, 100])), len = N(e, ['Length'], 3, 100) / 100, tm = N(e, ['Time'], 4, 0) / 100;
  const t0 = N(e, ['Starting Thickness'], 5, 8) * ctx.ls, t1 = N(e, ['Ending Thickness'], 6, 8) * ctx.ls, soft = N(e, ['Softness'], 7, 20) / 100, ic = C(e, ['Inside Color'], 8, [1, 1, 1, 1]), oc = C(e, ['Outside Color'], 9, [0.5, 0.6, 1, 1]), comp = !!N(e, ['Composite On Original'], 11, 0);
  const gen = ctx.pool.acquire(ctx.canvas.width, ctx.canvas.height);
  runShader('fx:beam', `vec2 ab=u_b-u_a; float L=length(ab); vec2 d=ab/max(L,.001); vec2 q=px-u_a; float t=dot(q,d)/max(L,.001); float s0=(u_tm*(1.+u_len))-u_len, s1=s0+u_len;
    float w=mix(u_t0,u_t1,clamp(t,0.,1.))*.5; float dist=abs(dot(q,vec2(-d.y,d.x))); float inside = step(max(s0,0.),t)*step(t,min(s1,1.)); float k=(1.-smoothstep(w*(1.-u_sf),w+.5,dist))*inside;
    o=vec4(mix(u_oc,u_ic,clamp(1.-dist/max(w,.5),0.,1.)),k);`, { u_src: ctx.canvas }, { u_a: a, u_b: b, u_len: len, u_tm: tm, u_t0: t0, u_t1: t1, u_sf: soft, u_ic: ic.slice(0, 3), u_oc: oc.slice(0, 3) }, gen);
  compositeGenerated(ctx, gen, comp ? 2 : 1, 1); ctx.pool.release(gen);
});
def(['CC Vignette'], (e, ctx) => {
  const amt = N(e, ['Amount'], 1, 100) / 100, aov = N(e, ['Angle of View'], 2, 60), c = bp(ctx, V2(e, ['Center'], 3, [0, 0]));
  shade(ctx, 'ccvig', `vec4 c=T(u_src,uv); float r=length(px-u_c)/(length(u_res)*.5); float k=pow(cos(clamp(r*radians(u_aov)*.5,0.,1.5)),4.); o=vec4(c.rgb*mix(1.,k,u_a),c.a);`, { u_a: amt, u_aov: aov, u_c: c });
});

// expression controls and no-op containers
const NOOP = /^ADBE (Posterize Time|Echo)$|^ADBE (Slider|Checkbox|Color|Point|Point3D|3D Point|Angle|Layer|Dropdown) Control$|^ADBE (Point3D|Dropdown) Control$|^ADBE Effect Built In Params$|^Pseudo\//;

// ---------------------------------------------------------------- geometry helpers
export function homography(src, dst) { // 3x3 (column-major for GLSL) mapping src[i] -> dst[i]
  const A = [], b = [];
  for (let i = 0; i < 4; i++) { const [x, y] = src[i], [u, v] = dst[i]; A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u); A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v); }
  const h = solve(A, b); if (!h) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return [h[0], h[3], h[6], h[1], h[4], h[7], h[2], h[5], 1];
}
function solve(A, b) {
  const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null; [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
export function sampleBezier(p, step = 4) {
  const v = p.vertices || [], n = v.length, out = []; if (!n) return out; const last = p.closed ? n : n - 1; out.push(v[0]);
  for (let i = 0; i < last; i++) {
    const a = v[i], b = v[(i + 1) % n], ot = p.outTangents?.[i] || [0, 0], it = p.inTangents?.[(i + 1) % n] || [0, 0];
    const c1 = [a[0] + ot[0], a[1] + ot[1]], c2 = [b[0] + it[0], b[1] + it[1]]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(ot[0], ot[1]) + Math.hypot(it[0], it[1]);
    const k = Math.max(1, Math.ceil(len / step));
    for (let j = 1; j <= k; j++) { const t = j / k, u = 1 - t; out.push([u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0], u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]); }
  }
  return out;
}
const polyLen = (pts) => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; };
function drawPartial(g, pts, a, b) {
  let acc = 0, started = false;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i], l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l === 0) continue;
    const s = Math.max(a, acc), e = Math.min(b, acc + l);
    if (e > s) { const f0 = (s - acc) / l, f1 = (e - acc) / l; const P0 = [p[0] + (q[0] - p[0]) * f0, p[1] + (q[1] - p[1]) * f0], P1 = [p[0] + (q[0] - p[0]) * f1, p[1] + (q[1] - p[1]) * f1]; if (!started) { g.moveTo(...P0); started = true; } g.lineTo(...P1); }
    acc += l;
  }
}

/**
 * Apply one evaluated effect to ctx.canvas. Returns 'ok' | 'noop' | 'unsupported'.
 * Effect Opacity (Compositing Options) is applied by mixing with the input.
 */
export function applyEffect(eff, ctx) {
  const mn = eff.matchName || '';
  if (NOOP.test(mn) || /Control$/.test(mn)) return 'noop';
  const fn = FX[mn]; if (!fn) return 'unsupported';
  const eo = eff.effectOpacity ?? 1; const before = eo < 1 ? copyOf(ctx) : null;
  try { fn(eff, ctx); } catch (e) { console.warn('MOGRT effect failed', mn, e); }
  if (before) { blendBack(ctx, before, (1 - eo) * 100); ctx.pool.release(before); }
  return 'ok';
}
export const supportedEffects = () => Object.keys(FX);
