import { VIDEO_FX, PRELUDE, LUMETRI_BODY, LUMETRI_DEFAULTS, LUMETRI_EXTRA_UNIFORMS } from './fx/videoEffects';
import { getLut } from '../Services/lut';
import { filterLut } from '../Services/filters';
import { faceMesh } from '../Services/vision';
import { curvesTextureData, isDefaultCurves } from '../Core/curves';
import { TRANSITION_FRAG, FLOW_COARSE_FRAG, FLOW_FINE_FRAG, FLOW_SMOOTH_FRAG, transitionIndex } from './fx/transitions';
import { EXT_TRANSITIONS, extTransitionFrag } from './fx/moreTransitions';
import { evalParam, resolveParams, DEFAULT_MOTION, DEFAULT_OPACITY, frameScaled } from '../Core/params';
import { paramLocal, fieldOptionsActive, sourceAt } from '../Core/clipTime';
import { getState } from '../Core/store';
import { floodFill } from './fx/floodFill';

export const BLEND_MODES = ['Normal', 'Darken', 'Multiply', 'Color Burn', 'Lighten', 'Screen', 'Color Dodge', 'Overlay', 'Soft Light', 'Hard Light', 'Difference', 'Exclusion', 'Linear Dodge (Add)'];

const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;

const hex = (h) => { const n = parseInt((h || '#ffffff').slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

function uniformDecls(params) {
  return params.filter((p) => p.type !== 'text').map((p) => (p.type === 'point' ? `uniform vec2 ${p.id};` : p.type === 'color' ? `uniform vec3 ${p.id};` : `uniform float ${p.id};`)).join('\n');
}
const fxFrag = (def) => `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D u_tex; uniform vec2 u_res; uniform float u_time; uniform float u_pass;
${uniformDecls(def.params)}
${def.layer || def.text ? 'uniform sampler2D u_layer; uniform float u_hasLayer;' : ''}${def.src ? 'uniform sampler2D u_src;' : ''}
${PRELUDE}
${def.layer || def.text ? 'vec4 L(vec2 p){ return texture(u_layer, p); }' : ''}${def.src ? 'vec4 SRC(vec2 p){ return texture(u_src, p); }' : ''}
${def.fns || ''}
void main(){ ${def.body} }`;

const DRAW_FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D u_tex; uniform float u_fa; uniform float u_sa; uniform vec2 u_pos; uniform vec2 u_scale; uniform float u_rot; uniform vec2 u_anchor;
void main(){
  vec2 q=(uv-u_pos)*vec2(u_fa,1.);
  float r=-u_rot; q=vec2(q.x*cos(r)-q.y*sin(r), q.x*sin(r)+q.y*cos(r));
  q/=u_scale;
  float ws=u_sa>=u_fa?u_fa:u_sa; float hs=u_sa>=u_fa?u_fa/u_sa:1.;
  vec2 st=u_anchor+vec2(q.x/ws,q.y/hs);
  o=(st.x<0.||st.x>1.||st.y<0.||st.y>1.)?vec4(0.):texture(u_tex,st);
}`;

const FINAL_FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D u_tex; uniform float u_opacity; uniform float u_fa;
uniform int u_mask; uniform vec2 u_mc; uniform vec2 u_ms; uniform float u_mf; uniform float u_mi; uniform float u_mo; uniform vec2 u_poly[16]; uniform int u_np;
float cross2(vec2 a, vec2 b){ return a.x*b.y-a.y*b.x; }
void main(){
  vec4 c=texture(u_tex,uv); float m=1.;
  if(u_mask==1){ vec2 d=(uv-u_mc)/max(u_ms*0.5,vec2(0.0001)); float e=length(d); m=1.-smoothstep(1.-u_mf,1.,e); }
  else if(u_mask==2){ bool inside=false; float dist=1e9; for(int i=0;i<16;i++){ if(i>=u_np) break; vec2 a=u_poly[i]; vec2 b=u_poly[(i+1)%u_np]; if(((a.y>uv.y)!=(b.y>uv.y)) && (uv.x<(b.x-a.x)*(uv.y-a.y)/(b.y-a.y)+a.x)) inside=!inside; vec2 e=b-a; float h=clamp(dot(uv-a,e)/max(dot(e,e),1e-8),0.,1.); dist=min(dist,length(uv-a-e*h)); } m=inside?(u_mf<=0.?1.:smoothstep(0.,u_mf*0.5,dist)):(u_mf<=0.?0.:1.-smoothstep(0.,u_mf*0.5,dist)); m=inside?m:m*0.; }
  if(u_mask!=0){ if(u_mi>0.5) m=1.-m; m=mix(1.,m,u_mo); }
  o=vec4(c.rgb,c.a*u_opacity*m);
}`;

const COMP_FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D u_dst; uniform sampler2D u_src; uniform int u_mode;
float ch(float b,float s,int m){
  if(m==1) return min(b,s);
  if(m==2) return b*s;
  if(m==3) return s<=0.?0.:1.-min(1.,(1.-b)/s);
  if(m==4) return max(b,s);
  if(m==5) return 1.-(1.-b)*(1.-s);
  if(m==6) return s>=1.?1.:min(1.,b/(1.-s));
  if(m==7) return b<0.5?2.*b*s:1.-2.*(1.-b)*(1.-s);
  if(m==8){ float d=b<=0.25?((16.*b-12.)*b+4.)*b:sqrt(b); return s<=0.5?b-(1.-2.*s)*b*(1.-b):b+(2.*s-1.)*(d-b); }
  if(m==9) return s<0.5?2.*b*s:1.-2.*(1.-b)*(1.-s);
  if(m==10) return abs(b-s);
  if(m==11) return b+s-2.*b*s;
  if(m==12) return min(1.,b+s);
  return s;
}
void main(){
  vec4 d=texture(u_dst,uv), s=texture(u_src,uv);
  vec3 bl=vec3(ch(d.r,s.r,u_mode),ch(d.g,s.g,u_mode),ch(d.b,s.b,u_mode));
  float a=s.a; o=vec4(mix(d.rgb,bl,a), max(d.a, a));
}`;

// mask rows: MediaPipe masks are top row first; source textures have uv.y = 0 at the bottom of the picture
const SEG_FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o; uniform sampler2D u_tex; uniform sampler2D u_mask; uniform vec2 u_mres; uniform float u_th; uniform float u_soft; uniform float u_inv;
void main(){ vec4 c=texture(u_tex,uv); vec2 q=vec2(uv.x,1.-uv.y); float m=0.; vec2 d=1./u_mres;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) m+=texture(u_mask,q+vec2(float(x),float(y))*d).r; m/=9.;
  if(u_inv>0.5) m=1.-m; float a=smoothstep(u_th-u_soft,u_th+u_soft,m); o=vec4(c.rgb,c.a*a); }`;

const FILTER_FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o; uniform sampler2D u_tex; uniform sampler2D u_lut; uniform float u_lutN; uniform float u_amt;
vec3 lut3(sampler2D t, float N, vec3 c){ vec3 s=clamp(c,0.,1.)*(N-1.); float b0=floor(s.b), b1=min(b0+1.,N-1.), fb=s.b-b0;
  vec3 l0=texture(t,vec2((b0*N+s.r+0.5)/(N*N),(s.g+0.5)/N)).rgb; vec3 l1=texture(t,vec2((b1*N+s.r+0.5)/(N*N),(s.g+0.5)/N)).rgb; return mix(l0,l1,fb); }
void main(){ vec4 c=texture(u_tex,uv); o=vec4(mix(c.rgb,lut3(u_lut,u_lutN,c.rgb),u_amt),c.a); }`;

const ECHO_FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o; uniform sampler2D u_a; uniform sampler2D u_b; uniform float u_w; uniform int u_op;
void main(){ vec4 a=texture(u_a,uv), b=texture(u_b,uv); b.a*=u_w; b.rgb*=1.;
  if(u_op==0){ o=vec4(a.rgb+b.rgb*b.a, max(a.a,b.a)); }
  else if(u_op==1){ o=vec4(max(a.rgb,b.rgb*b.a), max(a.a,b.a)); }
  else if(u_op==2){ o=vec4(1.-(1.-a.rgb)*(1.-b.rgb*b.a), max(a.a,b.a)); }
  else if(u_op==3){ float al=a.a+b.a*(1.-a.a); o=vec4((a.rgb*a.a+b.rgb*b.a*(1.-a.a))/max(al,1e-4),al); }
  else { float al=b.a+a.a*(1.-b.a); o=vec4((b.rgb*b.a+a.rgb*a.a*(1.-b.a))/max(al,1e-4),al); } }`;

const WRITEON_FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o; uniform sampler2D u_tex; uniform vec2 u_res; uniform vec2 u_pts[48]; uniform int u_n; uniform int u_i0;
uniform float u_size; uniform float u_hard; uniform float u_op; uniform int u_style; uniform vec3 u_col;
void main(){
  vec4 c=texture(u_tex,uv); vec2 p=uv*u_res; float md=1e9;
  for(int i=0;i<47;i++){ if(i<u_i0||i+1>=u_n) continue; vec2 a=u_pts[i]*u_res, b=u_pts[i+1]*u_res; vec2 e=b-a; float h=clamp(dot(p-a,e)/max(dot(e,e),1e-6),0.,1.); md=min(md,length(p-a-e*h)); }
  float r=u_size*u_res.y/1080.*0.5; float m=1.-smoothstep(r*u_hard,r+0.5,md); m*=u_op;
  if(u_style==0) o=vec4(mix(c.rgb,u_col,m),max(c.a,m));
  else if(u_style==1) o=vec4(u_col,m);
  else o=vec4(c.rgb,c.a*m);
}`;

const STAB_FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o; uniform sampler2D u_tex; uniform vec2 u_shift; uniform float u_scale; uniform float u_rot; uniform float u_ls; uniform float u_asp;
void main(){
  vec2 p=(uv-0.5)*vec2(u_asp,1.)/u_scale;
  p/=exp(u_ls); float c=cos(-u_rot), s=sin(-u_rot); p=vec2(p.x*c-p.y*s,p.x*s+p.y*c);
  vec2 q=p/vec2(u_asp,1.)+0.5-u_shift;
  o=(q.x<0.||q.x>1.||q.y<0.||q.y>1.)?vec4(0.):texture(u_tex,q);
}`;

const REFRAME_FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o; uniform sampler2D u_tex; uniform vec2 u_c; uniform vec2 u_wh;
void main(){ vec2 d=uv-0.5; o=(abs(d.x)>u_wh.x*0.5||abs(d.y)>u_wh.y*0.5)?vec4(0.):texture(u_tex,u_c+d); }`;
const MATTE_FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o; uniform sampler2D u_tex; uniform sampler2D u_matte; uniform int u_use; uniform float u_inv; uniform float u_comp;
void main(){ vec4 c=texture(u_tex,uv); vec4 m=texture(u_matte,uv);
  float v = u_use==0 ? m.a : u_use==1 ? dot(m.rgb,vec3(0.2126,0.7152,0.0722)) : u_use==2 ? m.r : u_use==3 ? m.g : m.b;
  if(u_inv>0.5) v=1.-v; o=vec4(c.rgb, u_comp>0.5 ? min(c.a,v) : v*(u_use==0?1.:1.)*max(c.a,0.0)+0.0*c.a); }`;

// Equalize: cumulative histograms (256 levels x 2 rows: R,G,B,luma | pooled RGB) from 64x36 samples, then a lookup pass
const EQ_CDF_FRAG = `#version 300 es
precision highp float; out vec4 o; uniform sampler2D u_tex;
void main(){ float lv=floor(gl_FragCoord.x)/255.+1e-4; bool r1=gl_FragCoord.y>1.; vec4 n=vec4(0.); float tot=0.;
  for(int j=0;j<36;j++) for(int i=0;i<64;i++){ vec4 s=texture(u_tex,(vec2(i,j)+0.5)/vec2(64.,36.)); if(s.a<0.01) continue; tot+=1.;
    vec3 q=floor(s.rgb*255.+0.5)/255.; float l=floor(dot(s.rgb,vec3(0.2126,0.7152,0.0722))*255.+0.5)/255.; vec3 st=step(q,vec3(lv));
    n+=r1?vec4((st.r+st.g+st.b)/3.,0.,0.,0.):vec4(st,step(l,lv)); }
  o=n/max(tot,1.); }`;
const EQ_APPLY_FRAG = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D u_tex; uniform sampler2D u_cdf; uniform float u_style; uniform float u_amt;
vec4 C(float v,float row){ return texture(u_cdf,vec2((floor(clamp(v,0.,1.)*255.+0.5)+0.5)/256.,row)); }
void main(){ vec4 c=texture(u_tex,uv); vec3 r;
  if(u_style<0.5) r=vec3(C(c.r,.25).r,C(c.g,.25).g,C(c.b,.25).b);
  else if(u_style<1.5){ float l=dot(c.rgb,vec3(0.2126,0.7152,0.0722)); r=c.rgb*(C(l,.25).a/max(l,1e-3)); }
  else r=vec3(C(c.r,.75).r,C(c.g,.75).r,C(c.b,.75).r);
  o=vec4(mix(c.rgb,clamp(r,0.,1.),u_amt),c.a); }`;
// Paint Bucket: the flood-filled region (CPU, fx/floodFill.js) shaped by the Stroke option and composited with the Blending Mode
const BUCKET_FRAG = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D u_tex; uniform sampler2D u_mask; uniform vec2 u_res;
uniform float u_stroke; uniform float u_rad; uniform float u_inv; uniform float u_view; uniform float u_op; uniform float u_mode; uniform vec3 u_col;
float disc(float R,float k){ float acc=k<-0.5?1.:0.; for(int i=0;i<32;i++){ float an=float(i)*2.3999632; float r=sqrt((float(i)+0.5)/32.)*R;
  float v=texture(u_mask,uv+vec2(cos(an),sin(an))*r/u_res).r; acc=k>0.5?max(acc,v):k<-0.5?min(acc,v):acc+v; } return abs(k)>0.5?acc:acc/32.; }
void main(){ vec4 c=texture(u_tex,uv); float m=u_stroke<1.5?disc(u_rad,0.):u_stroke<2.5?disc(u_rad,1.):disc(u_rad,-1.);
  if(u_inv>0.5) m=1.-m; if(u_view>0.5){ o=vec4(vec3(m),1.); return; }
  vec3 f=u_col; float a=m*u_op; int k=int(u_mode+0.5); vec3 b=c.rgb;
  if(k==6){ o=vec4(f,a); return; }
  if(k==5){ float oa=c.a+a*(1.-c.a); o=vec4((b*c.a+f*a*(1.-c.a))/max(oa,1e-4),oa); return; }
  vec3 x=k==1?min(b+f,vec3(1.)):k==2?b*f:k==3?1.-(1.-b)*(1.-f):k==4?mix(2.*b*f,1.-2.*(1.-b)*(1.-f),step(0.5,b)):f;
  o=vec4(mix(b,x,a),c.a+a*(1.-c.a)); }`;

const MESH_VERT = `#version 300 es
layout(location=0) in vec2 pos; layout(location=1) in vec2 tc; layout(location=2) in float al; out vec2 vtc; out float val;
void main(){ vtc=tc; val=al; gl_Position=vec4(pos*2.-1.,0.,1.); }`;
const MESH_FRAG = `#version 300 es
precision highp float; in vec2 vtc; in float val; out vec4 o; uniform sampler2D u_tex;
void main(){ o=vec4(texture(u_tex,vtc).rgb,val); }`;
const FACEBLEND_FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o; uniform sampler2D u_bg; uniform sampler2D u_fa; uniform sampler2D u_fb; uniform float u_p;
void main(){ vec4 bg=texture(u_bg,uv), fa=texture(u_fa,uv), fb=texture(u_fb,uv); float ps=smoothstep(0.,1.,u_p);
  float wa=fa.a*(1.-ps), wb=fb.a*ps; float al=wa+wb; vec3 col=al>1e-4?(fa.rgb*wa+fb.rgb*wb)/al:bg.rgb; float cov=mix(fa.a,fb.a,ps);
  o=vec4(mix(bg.rgb,col,cov),1.); }`;

// Clip > Video Options > Field Options, in source pixels (interlaced footage):
//   reverse = swap the two fields (line pairs), deinterlace = keep one field and interpolate the other, flicker = vertical [1 2 1] filter
const MIX_FRAG = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D u_a, u_b; uniform float u_w;
void main(){ o = mix(texture(u_a, uv), texture(u_b, uv), u_w); }`;
const FIELD_FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o; uniform sampler2D u_tex; uniform float u_h; uniform int u_rev; uniform int u_dei; uniform int u_flk;
vec4 line(float y){ return texture(u_tex, vec2(uv.x, clamp((y+0.5)/u_h, 0., 1.))); }
void main(){
  // the texture is uploaded flipped (row 0 = bottom); field parity is counted from the top line (upper field = even lines)
  float yt=u_h-1.-floor(uv.y*u_h);
  if(u_rev==1) yt+= mod(yt,2.)>0.5 ? -1. : 1.;
  float y=u_h-1.-yt;
  vec4 c=line(y);
  if(u_dei==1 && mod(yt,2.)>0.5) c=0.5*(line(y-1.)+line(y+1.));
  if(u_flk==1) c=0.25*line(y-1.)+0.5*c+0.25*line(y+1.);
  o=c;
}`;

const BLIT_FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o; uniform sampler2D u_tex;
void main(){ o=texture(u_tex,uv); }`;

/** Least-squares similarity b = (1+s)*a + t in aspect-corrected coordinates; returns [s, tx, ty]. */
function similarity(la, lb, asp) {
  const n = la.length / 2; let ax = 0, ay = 0, bx = 0, by = 0;
  for (let i = 0; i < n; i++) { ax += la[i * 2] * asp; ay += la[i * 2 + 1]; bx += lb[i * 2] * asp; by += lb[i * 2 + 1]; }
  ax /= n; ay /= n; bx /= n; by /= n; let num = 0, den = 0;
  for (let i = 0; i < n; i++) { const dx = la[i * 2] * asp - ax, dy = la[i * 2 + 1] - ay; num += dx * (lb[i * 2] * asp - bx) + dy * (lb[i * 2 + 1] - by); den += dx * dx + dy * dy; }
  const s = den > 1e-9 ? num / den : 1; return [s - 1, bx - s * ax, by - s * ay];
}

/** The background fill of a clip: its own setting, else the sequence's (main track = the lowest video track only). */
export function canvasFillOf(clip, ctx) {
  const own = clip.canvasFill; if (own) return own.type && own.type !== 'none' ? own : null;
  const sf = ctx?.seq?.canvasFill; if (!sf || !sf.type || sf.type === 'none' || ctx.depth) return null;
  const main = ctx.seq.tracks.filter((t) => t.kind === 'video').slice(-1)[0];
  return main && clip.track === main.id && clip.mediaId && !clip.graphic && !clip.caption ? sf : null;
}
export const hasGrade = (lu) => !!lu.lut || !!lu.inputLut || !isDefaultCurves(lu.curves) || Object.keys(LUMETRI_DEFAULTS).some((k) => lu[k] !== undefined && lu[k] !== LUMETRI_DEFAULTS[k]);

export class Compositor {
  constructor(canvas) {
    const gl = (this.gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, alpha: false }));
    if (!gl) throw new Error('WebGL2 unavailable');
    this.canvas = canvas;
    this.w = 0; this.h = 0;
    this.progs = new Map(); this.pool = []; this.srcTex = new Map(); this.fbos = new Map();
    this.errors = {};
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND);
  }

  // ---- programs ----
  prog(key, frag, vert = VERT) {
    if (this.progs.has(key)) return this.progs.get(key);
    const gl = this.gl;
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    let entry = null;
    try {
      const p = gl.createProgram();
      gl.attachShader(p, mk(gl.VERTEX_SHADER, vert)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, frag));
      if (vert === VERT) gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      entry = { p, u: new Map() };
    } catch (e) { this.errors[key] = String(e.message || e); console.error('Shader', key, e.message); }
    this.progs.set(key, entry);
    return entry;
  }
  loc(pr, name) { if (!pr.u.has(name)) pr.u.set(name, this.gl.getUniformLocation(pr.p, name)); return pr.u.get(name); }
  f1(pr, n, v) { const l = this.loc(pr, n); if (l) this.gl.uniform1f(l, v); }
  f2(pr, n, v) { const l = this.loc(pr, n); if (l) this.gl.uniform2f(l, v[0], v[1]); }
  f3(pr, n, v) { const l = this.loc(pr, n); if (l) this.gl.uniform3f(l, v[0], v[1], v[2]); }
  i1(pr, n, v) { const l = this.loc(pr, n); if (l) this.gl.uniform1i(l, v); }

  // ---- render targets ----
  resize(w, h) {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    for (const t of this.pool) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
    this.pool = []; this.w = w; this.h = h; this.canvas.width = w; this.canvas.height = h;
  }
  acquire() {
    const t = this.pool.pop(); if (t) return t;
    const gl = this.gl;
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo };
  }
  release(t) { if (t && !t.static) this.pool.push(t); }
  target(t) { const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null); gl.viewport(0, 0, this.w, this.h); }
  clear(t, r = 0, g = 0, b = 0, a = 0) { this.target(t); this.gl.clearColor(r, g, b, a); this.gl.clear(this.gl.COLOR_BUFFER_BIT); }
  bind(unit, tex) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
  quad() { this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4); }
  use(pr) { this.gl.useProgram(pr.p); }

  // ---- source upload ----
  upload(key, el) {
    const gl = this.gl;
    let st = this.srcTex.get(key);
    if (!st) { const tex = gl.createTexture(); st = { tex, w: 0, h: 0, ok: false }; this.srcTex.set(key, st); gl.bindTexture(gl.TEXTURE_2D, tex); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); }
    const w = el.videoWidth || el.naturalWidth || el.width, h = el.videoHeight || el.naturalHeight || el.height;
    if (!w || !h || (el.readyState !== undefined && el.readyState < 2)) return st.ok ? st : null; // keep last good frame
    if (el.__ver !== undefined && st.ok && st.el === el && st.ver === el.__ver) return st; // versioned canvas (MOGRT) unchanged since the last upload
    st.el = el; st.ver = el.__ver;
    gl.bindTexture(gl.TEXTURE_2D, st.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el); st.ok = true; } catch { return st.ok ? st : null; }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    st.w = w; st.h = h; return st;
  }

  // ---- one clip -> transparent-background RGBA frame in sequence resolution ----
  /** Draw a source (element or {tex,w,h}) through the Motion transform into a fresh target. */
  drawSource(st, mo, seqDims) {
    const draw = this.prog('draw', DRAW_FRAG); if (!draw) return null;
    const cur = this.acquire(); this.clear(cur);
    this.use(draw); this.bind(0, st.tex); this.i1(draw, 'u_tex', 0);
    const sc = mo.scale / 100, sw = mo.uniform === false ? mo.scaleW / 100 : sc;
    this.f1(draw, 'u_fa', seqDims.w / seqDims.h); this.f1(draw, 'u_sa', st.w / st.h);
    this.f2(draw, 'u_pos', [mo.position[0], 1 - mo.position[1]]); this.f2(draw, 'u_scale', [Math.max(sw, 0.0001), Math.max(sc, 0.0001)]);
    this.f1(draw, 'u_rot', (mo.rotation * Math.PI) / 180); this.f2(draw, 'u_anchor', [mo.anchor[0], 1 - mo.anchor[1]]);
    this.quad(); return cur;
  }

  /** Field Options pre-pass on the source frame (its own size), cached per clip. */
  fieldPass(key, st, fo) {
    const gl = this.gl; const pr = this.prog('field', FIELD_FRAG); if (!pr) return st;
    this._fields = this._fields || new Map(); let e = this._fields.get(key);
    if (!e || e.w !== st.w || e.h !== st.h) {
      if (e) { gl.deleteTexture(e.tex); gl.deleteFramebuffer(e.fbo); }
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, st.w, st.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      e = { tex, fbo, w: st.w, h: st.h }; this._fields.set(key, e);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, e.fbo); gl.viewport(0, 0, e.w, e.h); this.use(pr);
    this.bind(0, st.tex); this.i1(pr, 'u_tex', 0); this.f1(pr, 'u_h', st.h);
    this.i1(pr, 'u_rev', fo.reverse ? 1 : 0); this.i1(pr, 'u_dei', fo.deinterlace ? 1 : 0); this.i1(pr, 'u_flk', fo.flicker ? 1 : 0);
    this.quad(); gl.viewport(0, 0, this.w, this.h);
    return { tex: e.tex, w: e.w, h: e.h };
  }

  /** Remove Background: cut the source frame (own size) with the person mask; Threshold / Feather / Choke shape the edge. */
  segPass(key, st, mk, v) {
    const gl = this.gl; const pr = this.prog('seg', SEG_FRAG); if (!pr) return st;
    this._seg = this._seg || new Map(); let e = this._seg.get(key);
    if (!e || e.w !== st.w || e.h !== st.h) {
      if (e) { gl.deleteTexture(e.tex); gl.deleteFramebuffer(e.fbo); }
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, st.w, st.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, x] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, x);
      const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      e = { tex, fbo, w: st.w, h: st.h }; this._seg.set(key, e);
    }
    const mt = this.dataTexture(`mask:${mk.key}`, mk.w, mk.h, mk.data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, e.fbo); gl.viewport(0, 0, e.w, e.h); this.use(pr);
    this.bind(0, st.tex); this.i1(pr, 'u_tex', 0); this.bind(1, mt); this.i1(pr, 'u_mask', 1);
    this.f2(pr, 'u_mres', [mk.w, mk.h]); this.f1(pr, 'u_th', (v.threshold ?? 50) / 100 + (v.choke ?? 0) / 40); this.f1(pr, 'u_soft', 0.04 + (v.feather ?? 3) / 50); this.f1(pr, 'u_inv', v.invert ? 1 : 0);
    this.quad(); gl.viewport(0, 0, this.w, this.h);
    return { tex: e.tex, w: e.w, h: e.h };
  }
  /** Frame Blending: mix two source frames (own size) into a cached target. */
  mixPass(key, a, b, w) {
    const gl = this.gl; const pr = this.prog('mix', MIX_FRAG); if (!pr || a.w !== b.w || a.h !== b.h) return a;
    this._mix = this._mix || new Map(); let e = this._mix.get(key);
    if (!e || e.w !== a.w || e.h !== a.h) {
      if (e) { gl.deleteTexture(e.tex); gl.deleteFramebuffer(e.fbo); }
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, a.w, a.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      e = { tex, fbo, w: a.w, h: a.h }; this._mix.set(key, e);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, e.fbo); gl.viewport(0, 0, e.w, e.h); this.use(pr);
    this.bind(0, a.tex); this.bind(1, b.tex); this.i1(pr, 'u_a', 0); this.i1(pr, 'u_b', 1); this.f1(pr, 'u_w', w);
    this.quad(); gl.viewport(0, 0, this.w, this.h);
    return { tex: e.tex, w: e.w, h: e.h };
  }

  renderClip(clip, t, el, seqDims, ctx) {
    const gl = this.gl;
    let st = el && el.tex ? el : this.upload(clip.elKey || clip.id, el); if (!st) return null;
    const bl = !el?.tex && ctx?.deps?.blendFor?.(clip, t);
    if (bl) { const sb = this.upload(`${clip.elKey || clip.id}#b`, bl.el); if (sb) st = this.mixPass(clip.elKey || clip.id, st, sb, bl.w); }
    if (fieldOptionsActive(clip) && !el?.tex) st = this.fieldPass(clip.elKey || clip.id, st, clip.fieldOptions);
    const local = paramLocal(clip, t);
    const rb = !el?.tex && (clip.effects || []).find((e) => e.enabled && e.name === 'Remove Background');
    if (rb) { const mk = ctx?.deps?.maskFor?.(clip, t); if (mk) st = this.segPass(clip.elKey || clip.id, st, mk, resolveParams(rb.params, local)); }
    const mo = Object.fromEntries(Object.entries({ ...DEFAULT_MOTION(), ...(clip.motion || {}) }).map(([k, p]) => [k, evalParam(p, local)]));
    let cur = this.drawSource(st, el?.tex ? mo : frameScaled(mo, clip, st.w, st.h, seqDims.w, seqDims.h), seqDims); if (!cur) return null;

    const lu = clip.lumetri;
    if (lu && hasGrade(lu)) cur = this.lumetri(cur, lu);
    if (clip.filter?.id && (clip.filter.intensity ?? 100) > 0) cur = this.filterPass(cur, clip.filter);

    for (const fx of clip.effects || []) {
      if (!fx.enabled || fx.category === 'Audio' || fx.category === 'Transition') continue;
      const def = VIDEO_FX[fx.name]; if (!def || def.status === 'unsupported' || def.status === 'builtin') continue;
      const vals = resolveParams(fx.params, local);
      if (fx.name === 'Echo') cur = this.echo(clip, fx, vals, cur, mo, seqDims, ctx, local);
      else if (fx.name === 'Write-on') cur = this.writeOn(fx, vals, cur, local);
      else if (fx.name === 'Warp Stabilizer') cur = this.stabilize(fx, vals, cur, local);
      else if (fx.name === 'Auto Reframe') cur = this.reframe(fx, vals, cur, local);
      else if (def.matte) cur = this.matteFx(fx.name, vals, cur, ctx, seqDims, clip);
      else if (def.custom === 'equalize') cur = this.equalize(vals, cur);
      else if (def.custom === 'paintBucket') cur = this.paintBucket(vals, cur);
      else if (def.text) { const tx = this.textLayer(fx, def, vals, clip, t, local, ctx); cur = this.effect(def, fx.name, vals, cur, local, tx); }
      else {
        const lay = def.layer ? this.layerFor(ctx, clip, vals[def.layer]) : null;
        cur = this.effect(def, fx.name, vals, cur, local, lay?.tex.tex); if (lay) this.release(lay.tex);
      }
    }
    const fill = !el?.tex && canvasFillOf(clip, ctx); // not for adjustment layers / pre-rendered textures
    if (fill) cur = this.canvasFill(cur, st, fill, seqDims, ctx);
    const op = Object.fromEntries(Object.entries({ ...DEFAULT_OPACITY(), ...(clip.opacity || {}) }).map(([k, p]) => [k, evalParam(p, local)]));
    const out = this.acquire(); this.target(out);
    const fin = this.prog('final', FINAL_FRAG); this.use(fin);
    this.bind(0, cur.tex); this.i1(fin, 'u_tex', 0); this.f1(fin, 'u_opacity', op.opacity / 100); this.f1(fin, 'u_fa', seqDims.w / seqDims.h);
    const mask = (clip.masks || []).find((m) => m.enabled !== false);
    this.i1(fin, 'u_mask', mask ? (mask.type === 'ellipse' ? 1 : 2) : 0);
    if (mask) {
      const mp = resolveParams(mask.params, local);
      if (mask.type === 'ellipse') { this.f2(fin, 'u_mc', [mp.center[0], 1 - mp.center[1]]); this.f2(fin, 'u_ms', [mp.size[0], mp.size[1]]); }
      else { const pts = mp.points.slice(0, 16); const arr = new Float32Array(32); pts.forEach((p, i) => { arr[i * 2] = p[0]; arr[i * 2 + 1] = 1 - p[1]; }); gl.uniform2fv(this.loc(fin, 'u_poly'), arr); this.i1(fin, 'u_np', pts.length); }
      this.f1(fin, 'u_mf', mp.feather / 100); this.f1(fin, 'u_mi', mp.invert ? 1 : 0); this.f1(fin, 'u_mo', mp.opacity / 100);
    }
    this.quad(); this.release(cur);
    return { tex: out, blend: op.blend };
  }

  /** Echo: accumulate time-offset copies of the clip (extra elements seeked by media.js). */
  echo(clip, fx, vals, cur, mo, seqDims, ctx, local) {
    const n = Math.min(8, Math.max(1, Math.round(vals.num)));
    const pr = this.prog('echoComb', ECHO_FRAG); if (!pr) return cur;
    for (let k = 1; k <= n; k++) {
      const el = ctx.deps.echoElement?.(clip, k, vals.time * k); if (!el) continue;
      const st = this.upload(`${clip.elKey || clip.id}#e${k}`, el); if (!st) continue;
      const e = this.drawSource(st, mo, seqDims); if (!e) continue;
      const out = this.acquire(); this.target(out); this.use(pr);
      this.bind(0, cur.tex); this.bind(1, e.tex); this.i1(pr, 'u_a', 0); this.i1(pr, 'u_b', 1);
      this.f1(pr, 'u_w', vals.start * Math.pow(vals.decay, k - 1)); this.i1(pr, 'u_op', Math.round(vals.op));
      this.quad(); this.release(cur); this.release(e); cur = out;
    }
    return cur;
  }

  /** Write-on: reveal/paint a brush stroke along the keyframed Brush Position path up to the current time. */
  writeOn(fx, vals, cur, local) {
    const pr = this.prog('writeon', WRITEON_FRAG); if (!pr) return cur;
    const N = 48; const param = fx.params.brushPos; const pts = new Float32Array(N * 2);
    const span = Math.max(local, 1e-3);
    for (let i = 0; i < N; i++) { const p = evalParam(param, (span * i) / (N - 1)) || [0.5, 0.5]; pts[i * 2] = p[0]; pts[i * 2 + 1] = 1 - p[1]; }
    const i0 = vals.strokeLen > 0 && local > 0 ? Math.max(0, Math.round((N - 1) * (1 - vals.strokeLen / local))) : 0;
    const out = this.acquire(); this.target(out); this.use(pr);
    this.bind(0, cur.tex); this.i1(pr, 'u_tex', 0); this.f2(pr, 'u_res', [this.w, this.h]);
    this.gl.uniform2fv(this.loc(pr, 'u_pts'), pts); this.i1(pr, 'u_n', N); this.i1(pr, 'u_i0', i0);
    this.f1(pr, 'u_size', vals.size); this.f1(pr, 'u_hard', vals.hardness / 100); this.f1(pr, 'u_op', vals.opacity / 100); this.i1(pr, 'u_style', Math.round(vals.style));
    this.f3(pr, 'u_col', hex(vals.color));
    this.quad(); this.release(cur); return out;
  }

  /** Warp Stabilizer: smoothed-minus-raw camera path (translation, rotation, scale) from fx.analysis. */
  stabilize(fx, vals, cur, local) {
    const an = fx.analysis; if (!an || !an.path?.length) return cur;
    const idx = Math.min(an.path.length - 1, Math.max(0, Math.round(local * an.fps)));
    const win = Math.max(1, Math.round((vals.smoothing / 100) * an.fps * 1.5));
    const avg = [0, 0, 0, 0]; let c = 0;
    for (let i = Math.max(0, idx - win); i <= Math.min(an.path.length - 1, idx + win); i++) { for (let k = 0; k < 4; k++) avg[k] += an.path[i][k]; c++; }
    const raw = an.path[idx]; const full = Math.round(vals.method) === 1;
    const d = avg.map((v, k) => v / c - raw[k]);
    const pr = this.prog('stab', STAB_FRAG); if (!pr) return cur;
    const out = this.acquire(); this.target(out); this.use(pr);
    this.bind(0, cur.tex); this.i1(pr, 'u_tex', 0); this.f2(pr, 'u_shift', [d[0], -d[1]]);
    this.f1(pr, 'u_rot', full ? -d[2] : 0); this.f1(pr, 'u_ls', full ? d[3] : 0); this.f1(pr, 'u_asp', this.w / this.h);
    this.f1(pr, 'u_scale', 1 + (an.margin || 0.05) * (vals.crop ?? 1));
    this.quad(); this.release(cur); return out;
  }

  /** Auto Reframe: crop to the target aspect following the tracked centre (smoothed). */
  reframe(fx, vals, cur, local) {
    const ta = [9 / 16, 1, 16 / 9, 4 / 5][Math.round(vals.ratio)] ?? 1; const fa = this.w / this.h;
    let cx = 0.5, cy = 0.5; const an = fx.analysis;
    if (an?.path?.length) {
      const idx = Math.min(an.path.length - 1, Math.round(local * an.fps)); const win = Math.max(1, Math.round([1.5, 0.8, 0.3][Math.round(vals.motion)] * an.fps)); let sx = 0, sy = 0, n = 0;
      for (let i = Math.max(0, idx - win); i <= Math.min(an.path.length - 1, idx + win); i++) { sx += an.path[i][0]; sy += an.path[i][1]; n++; }
      cx = sx / n; cy = 1 - sy / n;
    }
    const w = Math.min(ta / fa, 1), h = Math.min(fa / ta, 1);
    cx = Math.min(1 - w / 2, Math.max(w / 2, cx)); cy = Math.min(1 - h / 2, Math.max(h / 2, cy));
    const pr = this.prog('reframe', REFRAME_FRAG); const out = this.acquire(); this.target(out); this.use(pr);
    this.bind(0, cur.tex); this.i1(pr, 'u_tex', 0); this.f2(pr, 'u_c', [cx, cy]); this.f2(pr, 'u_wh', [w, h]);
    this.quad(); this.release(cur); return out;
  }
  /** Track Matte Key / Image Matte Key / Set Matte: use another layer (or an image) as the alpha source. */
  matteFx(name, vals, cur, ctx, seqDims, clip) {
    let matte = null; let owned = null;
    if (name === 'Image Matte Key') {
      const el = vals.image && ctx.deps.imageById?.(vals.image); const st = el && this.upload(`matte:${vals.image}`, el);
      if (st) { matte = st.tex; }
    } else {
      owned = this.layerFor(ctx, clip, name === 'Track Matte Key' ? vals.track : vals.takeFrom); matte = owned?.tex.tex;
    }
    if (!matte) { return cur; }
    const pr = this.prog('matte', MATTE_FRAG); if (!pr) return cur;
    const out = this.acquire(); this.target(out); this.use(pr);
    this.bind(0, cur.tex); this.bind(1, matte); this.i1(pr, 'u_tex', 0); this.i1(pr, 'u_matte', 1);
    this.i1(pr, 'u_use', Math.round(vals.use ?? vals.mode ?? 0)); this.f1(pr, 'u_inv', vals.invert || vals.reverse ? 1 : 0); this.f1(pr, 'u_comp', vals.composite ? 1 : 0);
    this.quad(); this.release(cur); if (owned) { this.release(owned.tex); } return out;
  }
  dataTexture(key, w, h, data, nearest = false) {
    this._dt = this._dt || new Map(); let e = this._dt.get(key);
    // created on a spare unit: binding it on the active unit would replace a texture already bound for the pass being set up
    if (!e) { const gl = this.gl; const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : gl.LINEAR], [gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      e = { tex }; this._dt.set(key, e); if (this._dt.size > 40) { const first = this._dt.keys().next().value; gl.deleteTexture(this._dt.get(first).tex); this._dt.delete(first); } }
    return e.tex;
  }

  lumetri(inp, lu) {
    const vals = { ...LUMETRI_DEFAULTS, ...lu };
    const decl = Object.keys(LUMETRI_DEFAULTS).map((k) => `uniform float ${k};`).join('\n');
    const pr = this.prog('lumetri', `#version 300 es\nprecision highp float;\nin vec2 uv; out vec4 o;\nuniform sampler2D u_tex; uniform vec2 u_res;\n${decl}\n${LUMETRI_EXTRA_UNIFORMS}\n${PRELUDE}\nvoid main(){ ${LUMETRI_BODY} }`);
    if (!pr) return inp;
    const out = this.acquire(); this.target(out); this.use(pr);
    this.bind(0, inp.tex); this.i1(pr, 'u_tex', 0); this.f2(pr, 'u_res', [this.w, this.h]);
    for (const k of Object.keys(LUMETRI_DEFAULTS)) this.f1(pr, k, vals[k]);
    const curvesOn = !isDefaultCurves(lu.curves);
    this.f1(pr, 'u_curvesOn', curvesOn ? 1 : 0);
    this.bind(1, curvesOn ? this.dataTexture(`curves:${JSON.stringify(lu.curves)}`, 256, 5, curvesTextureData(lu.curves)) : inp.tex); this.i1(pr, 'u_curves', 1);
    const lut = lu.lut && getLut(lu.lut.path);
    this.f1(pr, 'u_lutOn', lut ? 1 : 0);
    this.bind(2, lut ? this.dataTexture(`lut:${lu.lut.path}`, lut.N * lut.N, lut.N, lut.data) : inp.tex); this.i1(pr, 'u_lut', 2); this.f1(pr, 'u_lutN', lut ? lut.N : 2);
    const ilut = lu.inputLut && getLut(lu.inputLut.path); this.f1(pr, 'u_ilutOn', ilut ? 1 : 0);
    this.bind(3, ilut ? this.dataTexture(`lut:${lu.inputLut.path}`, ilut.N * ilut.N, ilut.N, ilut.data) : inp.tex); this.i1(pr, 'u_ilut', 3); this.f1(pr, 'u_ilutN', ilut ? ilut.N : 2);
    this.quad(); this.release(inp); return out;
  }
  /** Canvas / Background Fill: the area around a clip that does not fill the frame shows a blurred, zoomed copy of the clip, a colour or an image. */
  canvasFill(cur, st, fill, seqDims, ctx) {
    let bg = null;
    const cover = (w, h) => { const fa = seqDims.w / seqDims.h, sa = w / h; return Math.max(sa / fa, fa / sa) * 100; };
    const centred = (k) => ({ ...Object.fromEntries(Object.entries(DEFAULT_MOTION()).map(([n, p]) => [n, p.v])), scale: k });
    if (fill.type === 'blur') {
      bg = this.drawSource(st, centred(cover(st.w, st.h) * 1.02), seqDims);
      const amt = fill.blur ?? 50; if (bg && amt > 0) bg = this.effect(VIDEO_FX['Gaussian Blur'], 'Gaussian Blur', { blurriness: amt, dim: 0, repeat: true }, bg, 0);
    } else if (fill.type === 'image') {
      const el = fill.mediaId && ctx?.deps?.imageById?.(fill.mediaId); const ist = el && this.upload(`fill:${fill.mediaId}`, el);
      if (ist) bg = this.drawSource(ist, centred(cover(ist.w, ist.h)), seqDims);
    }
    if (!bg) { bg = this.acquire(); const c = hex(fill.color || '#000000'); this.clear(bg, c[0], c[1], c[2], 1); }
    const next = this.composite(bg, { tex: cur, blend: 'Normal' }); this.release(bg); this.release(cur); return next;
  }
  /** Create > Filters: a built-in look (3D LUT) mixed by Intensity. */
  filterPass(inp, f) {
    const lut = filterLut(f.id); if (!lut) return inp;
    const pr = this.prog('filter', FILTER_FRAG); if (!pr) return inp;
    const out = this.acquire(); this.target(out); this.use(pr);
    this.bind(0, inp.tex); this.i1(pr, 'u_tex', 0);
    this.bind(2, this.dataTexture(`filter:${f.id}`, lut.N * lut.N, lut.N, lut.data)); this.i1(pr, 'u_lut', 2); this.f1(pr, 'u_lutN', lut.N); this.f1(pr, 'u_amt', (f.intensity ?? 100) / 100);
    this.quad(); this.release(inp); return out;
  }
  /** Another video track rendered at this time (layer inputs: Track Matte, Blend, Compound Blur, …); layers that point at each other stop after two levels. */
/** Clip Name / Simple Text / Timecode: the effect's text drawn into a canvas the size of the frame (bound as u_layer) */
  textLayer(fx, def, vals, clip, t, local, ctx) {
    const fps = ctx?.seq?.fps || 30; const media = clip.mediaId ? getState().media.find((m) => m.id === clip.mediaId) : null;
    const tcOf = (sec, fmt) => { const f = Math.max(0, Math.round(sec * fps)); if (fmt === 1) return String(f); if (fmt === 2) return (f / fps).toFixed(2) + 's'; const r = Math.round(fps); const p = (n) => String(n).padStart(2, '0'); return `${p(Math.floor(f / r / 3600))}:${p(Math.floor(f / r / 60) % 60)}:${p(Math.floor(f / r) % 60)}:${p(f % r)}`; };
    const info = { clipName: clip.name, fileName: media?.name || clip.name,
      timecode: (src, off, fmt) => tcOf((src >= 2 ? local : src >= 1 ? t : sourceAt(clip, t, fps, media?.duration ?? Infinity)) + (off || 0) / fps, fmt | 0) };
    const text = String(def.text(vals, info) ?? '');
    const cv = (this._textCv = this._textCv || new Map()).get(fx.id) || document.createElement('canvas'); this._textCv.set(fx.id, cv);
    const key = [text, this.w, this.h, vals.size, vals.color, vals.bg, vals.bgColor, ...(vals.pos || [])].join('|');
    if (cv.__key !== key) {
      cv.width = this.w; cv.height = this.h; const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
      const px = Math.max(4, (vals.size ?? 48) * this.h / 1080); g.font = `600 ${px}px "Segoe UI", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const [x, y] = (vals.pos || [0.5, 0.88]).map((v, i) => v * (i ? this.h : this.w)); const lines = text.split('\n'); const lh = px * 1.25; const w = Math.max(...lines.map((l) => g.measureText(l).width), 1);
      if ((vals.bg ?? 0) > 0 && text) { g.globalAlpha = vals.bg / 100; g.fillStyle = vals.bgColor || '#000000'; g.fillRect(x - w / 2 - px * 0.3, y - (lines.length * lh) / 2 - px * 0.12, w + px * 0.6, lines.length * lh + px * 0.24); g.globalAlpha = 1; }
      g.fillStyle = vals.color || '#ffffff'; lines.forEach((l, i) => g.fillText(l, x, y + (i - (lines.length - 1) / 2) * lh));
      cv.__key = key; cv.__ver = (cv.__ver || 0) + 1;
    }
    return this.upload(`fxtext:${fx.id}`, cv)?.tex || null;
  }
  layerFor(ctx, clip, tid) {
    if (!ctx?.seq || !tid || tid === 'None' || tid === clip.track || (ctx.layerDepth || 0) >= 2) return null;
    const tr = ctx.seq.tracks.find((x) => x.id === tid); if (!tr) return null;
    ctx.layerDepth = (ctx.layerDepth || 0) + 1;
    try { return this.trackLayer(ctx, tr, null); } finally { ctx.layerDepth--; }
  }
  /** def.layer: `layer` (a texture or null) is bound as u_layer; def.src: the input stays bound as u_src in every pass. */
  effect(def, name, vals, inp, time, layer = null) {
    const pr = this.prog(`fx:${name}`, fxFrag(def)); if (!pr) return inp;
    let cur = inp;
    for (let pass = 0; pass < (def.passes || 1); pass++) {
      const out = this.acquire(); this.target(out); this.use(pr);
      this.bind(0, cur.tex); this.i1(pr, 'u_tex', 0); this.f2(pr, 'u_res', [this.w, this.h]); this.f1(pr, 'u_time', time); this.f1(pr, 'u_pass', pass);
      if (def.layer || def.text) { this.bind(1, layer || this.dataTexture('blank', 1, 1, new Uint8Array(4))); this.i1(pr, 'u_layer', 1); this.f1(pr, 'u_hasLayer', layer ? 1 : 0); }
      if (def.src) { this.bind(2, inp.tex); this.i1(pr, 'u_src', 2); }
      for (const p of def.params) {
        if (p.type === 'text') continue;
        let v = vals[p.id]; if (v === undefined) v = p.def;
        if (p.type === 'point') this.f2(pr, p.id, v); else if (p.type === 'color') this.f3(pr, p.id, hex(v)); else this.f1(pr, p.id, typeof v === 'boolean' ? (v ? 1 : 0) : +v);
      }
      this.quad(); if (!def.src || cur !== inp) this.release(cur); cur = out;
    }
    if (def.src) this.release(inp);
    return cur;
  }

  /** Equalize (RGB / Brightness / Photoshop Style): remap through the frame's cumulative histogram. */
  equalize(vals, cur) {
    const gl = this.gl; const pc = this.prog('eqCdf', EQ_CDF_FRAG), pa = this.prog('eqApply', EQ_APPLY_FRAG); if (!pc || !pa) return cur;
    if (!this._eqCdf) { // 8-bit 256x2 target: needs no float-render extension; 1/255 steps are enough for a CDF
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); this._eqCdf = { tex, fbo };
    }
    const cdf = this._eqCdf;
    gl.bindFramebuffer(gl.FRAMEBUFFER, cdf.fbo); gl.viewport(0, 0, 256, 2); this.use(pc); this.bind(0, cur.tex); this.i1(pc, 'u_tex', 0); this.quad();
    const out = this.acquire(); this.target(out); this.use(pa);
    this.bind(0, cur.tex); this.i1(pa, 'u_tex', 0); this.bind(1, cdf.tex); this.i1(pa, 'u_cdf', 1);
    this.f1(pa, 'u_style', Math.round(vals.style || 0)); this.f1(pa, 'u_amt', (vals.amount ?? 50) / 100);
    this.quad(); this.release(cur); return out;
  }
  /** Paint Bucket: flood fill from the Fill Point on the frame read back from the GPU, then stroke + blend on the GPU. */
  paintBucket(vals, cur) {
    const gl = this.gl, w = this.w, h = this.h; const pr = this.prog('bucket', BUCKET_FRAG); if (!pr) return cur;
    if (this._bucketPx?.length !== w * h * 4) this._bucketPx = new Uint8Array(w * h * 4);
    this.target(cur); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this._bucketPx);
    const fp = vals.fillPt || [0.5, 0.5];
    const mask = floodFill(this._bucketPx, w, h, Math.round(fp[0] * (w - 1)), Math.round((1 - fp[1]) * (h - 1)), Math.round(vals.selector || 0), vals.tol ?? 10);
    if (!this._bucketTex) {
      this._bucketTex = gl.createTexture(); gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, this._bucketTex);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    }
    this.bind(1, this._bucketTex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, mask); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    const st = Math.round(vals.stroke || 0), sc = h / 1080;
    const out = this.acquire(); this.target(out); this.use(pr);
    this.bind(0, cur.tex); this.i1(pr, 'u_tex', 0); this.bind(1, this._bucketTex); this.i1(pr, 'u_mask', 1); this.f2(pr, 'u_res', [w, h]);
    this.f1(pr, 'u_stroke', st); this.f1(pr, 'u_rad', st === 0 ? 1 : Math.max(0.5, [0, vals.feather ?? 10, vals.spread ?? 3, vals.choke ?? 3][st] * sc));
    this.f1(pr, 'u_inv', vals.invert ? 1 : 0); this.f1(pr, 'u_view', vals.view ? 1 : 0); this.f1(pr, 'u_op', (vals.opacity ?? 100) / 100);
    this.f1(pr, 'u_mode', Math.round(vals.mode || 0)); this.f3(pr, 'u_col', hex(vals.fill));
    this.quad(); this.release(cur); return out;
  }
  /** Half-float render target of a fixed (small) size for flow fields. */
  flowTarget(key, w, h) {
    this._flows = this._flows || {}; if (this._flows[key]) return this._flows[key];
    const gl = this.gl; const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return (this._flows[key] = { tex, fbo, w, h });
  }
  landmarkTexture(key, arr) {
    const gl = this.gl; this._lm = this._lm || {}; let tex = this._lm[key];
    if (!tex) { tex = this._lm[key] = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); }
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, arr.length / 2, 1, 0, gl.RG, gl.FLOAT, arr); return tex;
  }

  /** Draw the face mesh (vertices at intermediate landmark positions, texcoords from src landmarks) into a fresh target. */
  drawMesh(tex, lmSrc, lmA, lmB, p) {
    const gl = this.gl; const pr = this.prog('mesh', MESH_FRAG, MESH_VERT); if (!pr) return null; const { indices, oval } = faceMesh(); const n = 468;
    if (!this._mesh) { const vao = gl.createVertexArray(); gl.bindVertexArray(vao); const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, n * 5 * 4, gl.DYNAMIC_DRAW); for (const [loc, size, off] of [[0, 2, 0], [1, 2, 8], [2, 1, 16]]) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 20, off); } const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW); this._mesh = { vao, vb }; }
    const data = new Float32Array(n * 5);
    for (let i = 0; i < n; i++) { data[i * 5] = lmA[i * 2] + p * (lmB[i * 2] - lmA[i * 2]); data[i * 5 + 1] = lmA[i * 2 + 1] + p * (lmB[i * 2 + 1] - lmA[i * 2 + 1]); data[i * 5 + 2] = lmSrc[i * 2]; data[i * 5 + 3] = lmSrc[i * 2 + 1]; data[i * 5 + 4] = oval.has(i) ? 0 : 1; }
    const out = this.acquire(); this.clear(out, 0, 0, 0, 0); this.use(pr); this.bind(0, tex); this.i1(pr, 'u_tex', 0);
    gl.bindVertexArray(this._mesh.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this._mesh.vb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, data); gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(this.vao); return out;
  }

  /** Overlay the landmark-warped faces (A forward, B backward) on the background morph. */
  faceMorph(bgOut, a, b, p, lm) {
    const fa = this.drawMesh(a.tex, lm.a, lm.a, lm.b, p), fb = this.drawMesh(b.tex, lm.b, lm.a, lm.b, p); if (!fa || !fb) return bgOut;
    const pr = this.prog('faceBlend', FACEBLEND_FRAG); const out = this.acquire(); this.target(out); this.use(pr);
    this.bind(0, bgOut.tex); this.bind(1, fa.tex); this.bind(2, fb.tex); this.i1(pr, 'u_bg', 0); this.i1(pr, 'u_fa', 1); this.i1(pr, 'u_fb', 2); this.f1(pr, 'u_p', p); this.quad();
    this.release(bgOut); this.release(fa); this.release(fb); return out;
  }

  /** Face landmarks (source-frame uv, y down) -> layer uv (y up) through the clip's Motion transform. */
  mapLandmarks(frame, clip, t, dims) {
    const st = this.srcTex.get(clip.elKey || clip.id); if (!frame || !st) return null;
    const local = Math.max(0, t - clip.start);
    const mo = frameScaled(Object.fromEntries(Object.entries({ ...DEFAULT_MOTION(), ...(clip.motion || {}) }).map(([k, p]) => [k, evalParam(p, local)])), clip, st.w, st.h, dims.w, dims.h);
    const fa = dims.w / dims.h, sa = st.w / st.h, ws = sa >= fa ? fa : sa, hs = sa >= fa ? fa / sa : 1;
    const sc = mo.scale / 100, sw = mo.uniform === false ? mo.scaleW / 100 : sc; const rot = (mo.rotation * Math.PI) / 180, c = Math.cos(rot), s = Math.sin(rot);
    const out = new Float32Array(frame.length);
    for (let i = 0; i < frame.length; i += 2) {
      const sx = frame[i], sy = 1 - frame[i + 1];
      const qx = (sx - mo.anchor[0]) * ws * sw, qy = (sy - (1 - mo.anchor[1])) * hs * sc;
      const rx = qx * c - qy * s, ry = qx * s + qy * c;
      out[i] = mo.position[0] + rx / fa; out[i + 1] = (1 - mo.position[1]) + ry;
    }
    return out;
  }

  /** a transition from moreTransitions.js: its own program, parameters from the transition (defaults when missing) */
  extTransition(def, name, a, b, p, params = {}) {
    const pr = this.prog(`tr:${name}`, extTransitionFrag(def)); if (!pr) return p < 0.5 ? a : b;
    const out = this.acquire(); this.target(out); this.use(pr);
    this.bind(0, a.tex); this.bind(1, b.tex); this.i1(pr, 'u_a', 0); this.i1(pr, 'u_b', 1);
    this.f1(pr, 'progress', Math.min(1, Math.max(0, p))); this.f2(pr, 'u_res', [this.w, this.h]);
    for (const q of def.params) {
      let v = params?.[q.id]; if (v === undefined || v === null) v = q.def;
      if (q.type === 'point') this.f2(pr, q.id, v); else if (q.type === 'color') this.f3(pr, q.id, hex(v)); else this.f1(pr, q.id, typeof v === 'boolean' ? (v ? 1 : 0) : +v);
    }
    this.quad(); return out;
  }
  transition(name, a, b, p, lm = null, params = null) {
    const ext = EXT_TRANSITIONS[name]; if (ext) return this.extTransition(ext, name, a, b, p, params || {});
    const pr = this.prog('transition', TRANSITION_FRAG); if (!pr) return b || a;
    const gl = this.gl;
    let flowTex = a.tex;
    if (name === 'Morph Cut') {
      const fc = this.prog('flowCoarse', FLOW_COARSE_FRAG), ff = this.prog('flowFine', FLOW_FINE_FRAG);
      if (fc && ff && gl.getExtension('EXT_color_buffer_float')) {
        const f0 = this.flowTarget('f0', 80, 45), f1 = this.flowTarget('f1', 160, 90);
        gl.bindFramebuffer(gl.FRAMEBUFFER, f0.fbo); gl.viewport(0, 0, f0.w, f0.h); this.use(fc);
        this.bind(0, a.tex); this.bind(1, b.tex); this.i1(fc, 'u_a', 0); this.i1(fc, 'u_b', 1); this.f2(fc, 'u_res', [this.w, this.h]);
        const sim = lm ? similarity(lm.a, lm.b, this.w / this.h) : [0, 0, 0]; this.f3(fc, 'u_sim', sim); this.quad();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f1.fbo); gl.viewport(0, 0, f1.w, f1.h); this.use(ff);
        this.bind(0, a.tex); this.bind(1, b.tex); this.bind(2, f0.tex); this.i1(ff, 'u_a', 0); this.i1(ff, 'u_b', 1); this.i1(ff, 'u_prev', 2); this.f2(ff, 'u_res', [this.w, this.h]);
        this.f1(ff, 'u_p', Math.min(1, Math.max(0, p))); this.f1(ff, 'u_hasLm', lm ? 1 : 0); this.i1(ff, 'u_nLm', lm ? lm.a.length / 2 : 0);
        if (lm) { this.bind(3, this.landmarkTexture('a', lm.a)); this.bind(4, this.landmarkTexture('b', lm.b)); this.i1(ff, 'u_lmA', 3); this.i1(ff, 'u_lmB', 4); }
        this.quad(); flowTex = f1.tex;
        const sm = this.prog('flowSmooth', FLOW_SMOOTH_FRAG); if (sm) { const f2 = this.flowTarget('f2', 160, 90); gl.bindFramebuffer(gl.FRAMEBUFFER, f2.fbo); gl.viewport(0, 0, 160, 90); this.use(sm); this.bind(0, f1.tex); this.i1(sm, 'u_tex', 0); this.f2(sm, 'u_px', [1 / 160, 1 / 90]); this.quad(); flowTex = f2.tex; }
      }
    }
    const out = this.acquire(); this.target(out); this.use(pr);
    this.bind(0, a.tex); this.bind(1, b.tex); this.bind(2, flowTex); this.i1(pr, 'u_a', 0); this.i1(pr, 'u_b', 1); this.i1(pr, 'u_flow', 2);
    this.f1(pr, 'u_p', Math.min(1, Math.max(0, p))); this.f2(pr, 'u_res', [this.w, this.h]); this.i1(pr, 'u_id', window.__morphDebug && name === 'Morph Cut' ? 99 : transitionIndex(name));
    const simv = lm ? similarity(lm.a, lm.b, this.w / this.h) : [0, 0, 0]; this.f3(pr, 'u_sim', simv); this.f1(pr, 'u_useSim', lm ? 1 : 0);
    this.quad();
    return lm && !window.__morphDebug ? this.faceMorph(out, a, b, p, lm) : out;
  }
  composite(dst, layer) {
    const pr = this.prog('comp', COMP_FRAG);
    const out = this.acquire(); this.target(out); this.use(pr);
    this.bind(0, dst.tex); this.bind(1, layer.tex.tex); this.i1(pr, 'u_dst', 0); this.i1(pr, 'u_src', 1);
    this.i1(pr, 'u_mode', Math.max(0, BLEND_MODES.indexOf(layer.blend)));
    this.quad(); return out;
  }

  /** Multi-camera view: every camera in a grid tile (tile i = camera i). */
  multicamGrid(sub, tt, deps, dims, lookup, depth) {
    const gl = this.gl; const n = sub.tracks.filter((x) => x.kind === 'video').length || 1; const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    const acc = this.acquire(); this.clear(acc, 0, 0, 0, 1); const bl = this.prog('blit', BLIT_FRAG);
    for (let i = 0; i < n; i++) {
      const inner = this.renderSequence(multicamView(sub, { cuts: [{ t: 0, cam: i }] }, 0), tt, deps, dims, lookup, depth + 1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fbo); const tw = Math.floor(this.w / cols), th = Math.floor(this.h / rows);
      gl.viewport((i % cols) * tw, (rows - 1 - Math.floor(i / cols)) * th, tw - 2, th - 2); this.use(bl); this.bind(0, inner.tex); this.i1(bl, 'u_tex', 0); this.quad(); this.release(inner);
    }
    gl.viewport(0, 0, this.w, this.h); return acc;
  }

  /** One track's visible layer at ctx.t (handles nested clips and transitions). Returns {tex, blend} or null. */
  trackLayer(ctx, tr, empty) {
    const { seq, t, deps, dims, lookup, depth } = ctx;
    const clipLayer = (c) => {
      if (!c) return null;
      if (c.nestId) {
        const sub = lookup(c.nestId); if (!sub || depth > 4) return null;
        const tt = (c.inPoint || 0) + (t - c.start) * (c.speed || 1);
        if (c.multicam && this.mcView && depth === 0) return { tex: this.multicamGrid(sub, tt, deps, dims, lookup, depth), blend: 'Normal' };
        const inner = this.renderSequence(c.multicam && !c.mcDisabled ? multicamView(sub, c, t - c.start) : sub, tt, deps, dims, lookup, depth + 1);
        const layer = this.renderClip(c, t, { tex: inner.tex, w: dims.w, h: dims.h }, dims, ctx);
        this.release(inner); return layer;
      }
      const el = deps.elementFor(c, t, dims); if (!el) return null;
      // Adjustment Layer: its effects/Motion/opacity/mask work on everything composited below it
      if (el.adjustment) return ctx.below ? this.renderClip(c, t, { tex: ctx.below.tex, w: dims.w, h: dims.h }, dims, ctx) : null;
      return this.renderClip(c, t, el, dims, ctx);
    };
    const trn = (seq.transitions || []).find((x) => x.track === tr.id && x.kind === 'video' && t >= x.at - x.dur / 2 && t <= x.at + x.dur / 2);
    if (trn) {
      const ca = seq.clips.find((c) => c.id === trn.aId), cb = seq.clips.find((c) => c.id === trn.bId);
      const la = clipLayer(ca), lb = clipLayer(cb);
      if (!la && !lb) return null;
      let own = null; if (!empty) { own = this.acquire(); this.clear(own, 0, 0, 0, 0); }
      const p = (t - (trn.at - trn.dur / 2)) / trn.dur;
      let lm = null;
      if (trn.name === 'Morph Cut' && trn.analysis && ca && cb && trn.analysis.a && trn.analysis.b) {
        const an = trn.analysis; const idx = Math.max(0, Math.min(an.a.length - 1, Math.round((t - an.t0) * an.fps)));
        const ma = this.mapLandmarks(an.a[idx], ca, t, dims), mb = this.mapLandmarks(an.b[idx], cb, t, dims); if (ma && mb && ma.length === mb.length) lm = { a: ma, b: mb };
      }
      const tex = this.transition(trn.name, la ? la.tex : (empty || own), lb ? lb.tex : (empty || own), trn.reverse ? 1 - p : p, lm, trn.params);
      this.release(la?.tex); this.release(lb?.tex); if (own) this.release(own);
      return { tex, blend: (lb || la).blend };
    }
    return clipLayer(seq.clips.find((x) => x.track === tr.id && x.enabled && t >= x.start && t < x.start + x.dur));
  }

  /** Render one sequence at time t into a pool texture (opaque black background). Handles nested sequences recursively. */
  renderSequence(seq, t, deps, dims, lookup, depth = 0, bgAlpha = 1) {
    let acc = this.acquire(); this.clear(acc, 0, 0, 0, bgAlpha);
    const empty = this.acquire(); this.clear(empty, 0, 0, 0, 0);
    const ctx = { seq, t, deps, dims, lookup, depth };
    // V1 first (bottom), caption tracks on top; a hidden track (Toggle Track Output) is not drawn, but still feeds track mattes / layer inputs
    for (const tr of seq.tracks.filter((x) => (x.kind === 'video' || x.kind === 'caption') && !x.hidden).reverse()) {
      ctx.below = acc; const layer = this.trackLayer(ctx, tr, empty);
      if (layer) { const next = this.composite(acc, layer); this.release(acc); this.release(layer.tex); acc = next; }
    }
    this.release(empty);
    return acc;
  }
  /** Show a pre-rendered preview frame (element) directly. Returns false if the element has no frame yet. */
  blitElement(el, size) {
    this.resize(size.w, size.h); const st = this.upload('preview-blit', el); if (!st) return false;
    this.target(null); const bl = this.prog('blit', BLIT_FRAG); this.use(bl); this.bind(0, st.tex); this.i1(bl, 'u_tex', 0); this.quad(); return true;
  }

  /** state: { sequence, seqs, playhead }, deps: { elementFor(clip) }. Draws to the canvas. */
  render(state, deps, size) {
    this.resize(size.w, size.h); this.mcView = !!state.mcView;
    const lookup = (id) => (id === state.sequence.id ? state.sequence : state.seqs?.[id]);
    // size.alpha: transparent background (export with an alpha channel); size.read: Uint8Array that receives the RGBA frame
    // (bottom row first, colour premultiplied by alpha) read from the composite itself, since the canvas has no alpha
    const acc = this.renderSequence(state.sequence, state.playhead, deps, { w: size.w, h: size.h }, lookup, 0, size.alpha ? 0 : 1);
    if (size.read) { const gl = this.gl; this.target(acc); gl.readPixels(0, 0, size.w, size.h, gl.RGBA, gl.UNSIGNED_BYTE, size.read); }
    this.target(null);
    const bl = this.prog('blit', BLIT_FRAG); this.use(bl); this.bind(0, acc.tex); this.i1(bl, 'u_tex', 0); this.quad();
    this.release(acc);
    return true;
  }
}

/** Multicam: show only the active camera's video track (or a grid when the clip is in multi-view mode). */
export function multicamView(sub, clip, local) {
  const cuts = clip.cuts || [{ t: 0, cam: 0 }];
  const cam = [...cuts].reverse().find((c) => c.t <= local + 1e-4)?.cam ?? 0;
  const vt = sub.tracks.filter((t) => t.kind === 'video').map((t) => t.id).sort();
  const keep = vt[Math.min(cam, vt.length - 1)];
  return { ...sub, tracks: sub.tracks.filter((t) => t.kind !== 'video' || t.id === keep) };
}