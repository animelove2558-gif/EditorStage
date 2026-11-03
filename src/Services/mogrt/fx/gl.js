// Small WebGL2 image-processing runner for the MOGRT painter (effects, exact blend modes, 3D perspective warps).
// Inputs/outputs are 2D canvases (premultiplied, as Canvas2D stores them). Shaders see STRAIGHT colour:
//   in vec2 uv (0..1, origin top-left)  ·  vec2 px = uv*u_res (buffer pixels)  ·  out vec4 o (straight alpha)
//   T(name, uv) samples input `name` as straight colour; u_res = output size.

let gl = null, glCanvas = null, quad = null, failed = false;
const progs = new Map();
const texCache = [];

const VS = `#version 300 es
in vec2 a; out vec2 uv; uniform vec4 u_xf; // optional sub-rect (x,y,w,h in 0..1) for warps
void main(){ uv = vec2(a.x*0.5+0.5, 0.5-a.y*0.5); gl_Position = vec4(a, 0., 1.); }`;

export const GLSL_LIB = `
#define PI 3.14159265358979
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float lum601(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float hash3(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
vec3 rgb2hsl(vec3 c){ float mx=max(c.r,max(c.g,c.b)), mn=min(c.r,min(c.g,c.b)); float l=(mx+mn)*.5; if(mx==mn) return vec3(0.,0.,l);
  float d=mx-mn; float s=l>.5?d/(2.-mx-mn):d/(mx+mn); float h = mx==c.r ? (c.g-c.b)/d+(c.g<c.b?6.:0.) : mx==c.g ? (c.b-c.r)/d+2. : (c.r-c.g)/d+4.; return vec3(h/6.,s,l); }
float h2r(float p,float q,float t){ t=fract(t); if(t<1./6.) return p+(q-p)*6.*t; if(t<.5) return q; if(t<2./3.) return p+(q-p)*(2./3.-t)*6.; return p; }
vec3 hsl2rgb(vec3 h){ if(h.y<=0.) return vec3(h.z); float q=h.z<.5?h.z*(1.+h.y):h.z+h.y-h.z*h.y; float p=2.*h.z-q; return vec3(h2r(p,q,h.x+1./3.),h2r(p,q,h.x),h2r(p,q,h.x-1./3.)); }
vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); float e=1e-10; return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)), d/(q.x+e), q.x); }
vec3 hsv2rgb(vec3 c){ vec4 K=vec4(1.,2./3.,1./3.,3.); vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www); return c.z*mix(K.xxx,clamp(p-K.xxx,0.,1.),c.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
float vnoise3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  float a=mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y);
  float b=mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y); return mix(a,b,f.z); }
`;

function init() {
  if (gl || failed) return gl;
  try {
    glCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(16, 16) : document.createElement('canvas');
    gl = glCanvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('no webgl2');
    quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  } catch (e) { failed = true; gl = null; console.warn('MOGRT: WebGL2 unavailable, GPU effects disabled', e); }
  return gl;
}
export const glAvailable = () => !!init();

function compile(key, inputs, uniformDecl, body) {
  const k = key + '|' + inputs.join(',');
  if (progs.has(k)) return progs.get(k);
  const fs = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o; uniform vec2 u_res;
${inputs.map((n) => `uniform sampler2D ${n};`).join('\n')}
${uniformDecl}
${GLSL_LIB}
vec4 T(sampler2D s, vec2 p){ vec4 c = texture(s, p); return c.a > 0. ? vec4(c.rgb / c.a, c.a) : vec4(0.); }
vec4 TC(sampler2D s, vec2 p){ return (p.x<0.||p.y<0.||p.x>1.||p.y>1.) ? vec4(0.) : T(s,p); }
void main(){ vec2 px = uv*u_res; ${body}
  o = vec4(clamp(o.rgb,0.,1.)*clamp(o.a,0.,1.), clamp(o.a,0.,1.)); }`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => i + 1 + ': ' + l).join('\n')); return s; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const prog = { p, loc: new Map() }; progs.set(k, prog); return prog;
}

function tex(unit, src) {
  let t = texCache[unit]; if (!t) { t = texCache[unit] = gl.createTexture(); }
  gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); // canvases are premultiplied; keep them that way
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/**
 * Run a fragment body. `inputs` {samplerName: canvas}, `uniforms` {name: number|number[]} (declared automatically:
 * number -> float, [2] vec2, [3] vec3, [4] vec4, {mat3:[9]} mat3, {arr:[...], n} float array).
 * Draws the result into `out` (a 2D canvas of size w x h) replacing its contents. Returns false if WebGL is unavailable.
 */
export function runShader(key, body, inputs, uniforms, out) {
  if (!init()) return false;
  const w = out.width, h = out.height;
  const names = Object.keys(inputs);
  const decl = Object.entries(uniforms).map(([n, v]) => {
    if (typeof v === 'number' || typeof v === 'boolean') return `uniform float ${n};`;
    if (v && v.mat3) return `uniform mat3 ${n};`;
    if (v && v.arr) return `uniform float ${n}[${v.arr.length}];`;
    if (v && v.vec4arr) return `uniform vec4 ${n}[${v.vec4arr.length / 4}];`;
    return `uniform vec${v.length} ${n};`;
  }).join('\n');
  const declKey = Object.entries(uniforms).map(([n, v]) => n + ':' + (typeof v === 'number' || typeof v === 'boolean' ? 1 : v.mat3 ? 'm' : v.arr ? 'a' + v.arr.length : v.vec4arr ? 'v' + v.vec4arr.length : v.length)).join(',');
  const prog = compile(key + '#' + declKey, names, decl, body);
  if (glCanvas.width !== w || glCanvas.height !== h) { glCanvas.width = w; glCanvas.height = h; }
  gl.viewport(0, 0, w, h); gl.useProgram(prog.p);
  const L = (n) => { if (!prog.loc.has(n)) prog.loc.set(n, gl.getUniformLocation(prog.p, n)); return prog.loc.get(n); };
  names.forEach((n, i) => { tex(i, inputs[n]); gl.uniform1i(L(n), i); });
  gl.uniform2f(L('u_res'), w, h);
  for (const [n, v] of Object.entries(uniforms)) {
    const l = L(n); if (!l) continue;
    if (typeof v === 'number' || typeof v === 'boolean') gl.uniform1f(l, +v);
    else if (v.mat3) gl.uniformMatrix3fv(l, false, v.mat3);
    else if (v.arr) gl.uniform1fv(l, v.arr);
    else if (v.vec4arr) gl.uniform4fv(l, v.vec4arr);
    else [, , gl.uniform2fv, gl.uniform3fv, gl.uniform4fv][v.length].call(gl, l, v);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const g = out.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'copy'; g.filter = 'none';
  g.drawImage(glCanvas, 0, 0); g.restore();
  return true;
}
