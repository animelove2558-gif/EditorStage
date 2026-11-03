// Video transitions added in round 2 (docs/PROMPT_FIX_ROUND2.md E2/E3). All written for EditorStage (source 'own').
// Each entry: { params, glsl } where glsl defines `vec4 transition(vec2 uv)`; `progress` goes 0 (all A) -> 1 (all B), and
// main() returns A exactly at progress 0 and B exactly at 1. Parameters are per transition (Effect Controls), not keyframed.
// Helpers (see EXT_PRELUDE): A/B (transparent outside the frame), Ac/Bc (clamped), asp(uv) (centred, aspect-correct),
// wipeMask(x, soft) (0 = A .. 1 = B for a front that travels x = 0 -> 1), blurs bl / dbl / zbl / sbl, noise, fbm, hash2, rot.
import { s, sel, chk, pt, col } from './fxParams';

const DIRS = ['From Left', 'From Right', 'From Bottom', 'From Top'];
const dir = (def = 0) => sel('dir', 'Direction', DIRS, def);
const soft = (def = 10) => s('soft', 'Softness', 0, 100, def);
const seed = () => s('seed', 'Random Seed', 0, 100, 1);
const amount = (def = 50, label = 'Amount') => s('amount', label, 0, 100, def);
const center = () => pt('center', 'Center');

export const EXT_PRELUDE = `
const float PI = 3.14159265;
float ratio;
vec4 A(vec2 p){ return (p.x<0.||p.x>1.||p.y<0.||p.y>1.)?vec4(0.):texture(u_a,p); }
vec4 B(vec2 p){ return (p.x<0.||p.x>1.||p.y<0.||p.y>1.)?vec4(0.):texture(u_b,p); }
vec4 Ac(vec2 p){ return texture(u_a,clamp(p,0.,1.)); }
vec4 Bc(vec2 p){ return texture(u_b,clamp(p,0.,1.)); }
bool inside(vec2 p){ return p.x>=0.&&p.x<=1.&&p.y>=0.&&p.y<=1.; }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec2 hash2(vec2 p){ return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y); }
float fbm(vec2 p){ float a=0.5, r=0.; for(int i=0;i<5;i++){ r+=a*noise(p); p=p*2.03+vec2(17.1,9.7); a*=0.5; } return r/0.97; }
vec2 rot(vec2 p, float a){ float c=cos(a), s=sin(a); return vec2(p.x*c-p.y*s, p.x*s+p.y*c); }
float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec2 asp(vec2 p){ return vec2((p.x-.5)*ratio, p.y-.5); }
vec2 unasp(vec2 q){ return vec2(q.x/ratio+.5, q.y+.5); }
vec2 dirv(float d){ return d<0.5?vec2(1.,0.):d<1.5?vec2(-1.,0.):d<2.5?vec2(0.,1.):vec2(0.,-1.); }
float along(vec2 p, vec2 d){ return dot(p-0.5,d)+0.5; }
float wipeMask(float x, float sft){ float q=progress*(1.+sft); return 1.-smoothstep(q-sft,q,x); }
float maxR(vec2 c){ vec2 m=max(c,1.-c); return length(vec2(m.x*ratio,m.y)); }
float bump(){ return sin(PI*progress); }
float xf(float a, float b){ return smoothstep(a,b,progress); }
vec3 hsv2rgb(vec3 c){ vec4 K=vec4(1.,2./3.,1./3.,3.); vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www); return c.z*mix(K.xxx,clamp(p-K.xxx,0.,1.),c.y); }
vec3 hueRot(vec3 c, float a){ const vec3 k=vec3(0.57735); float ca=cos(a); return c*ca+cross(k,c)*sin(a)+k*dot(k,c)*(1.-ca); }
vec4 bl(sampler2D t, vec2 p, float r){ if(r<=1e-4) return texture(t,clamp(p,0.,1.)); vec4 a=vec4(0.); float w=0.; for(int i=0;i<24;i++){ float f=(float(i)+.5)/24.; float an=float(i)*2.39996; vec2 o=vec2(cos(an),sin(an))*sqrt(f)*r*vec2(1./ratio,1.); float k=1.-f*0.5; a+=texture(t,clamp(p+o,0.,1.))*k; w+=k; } return a/w; }
vec4 dbl(sampler2D t, vec2 p, vec2 d){ vec4 a=vec4(0.); for(int i=0;i<16;i++){ a+=texture(t,clamp(p+d*(float(i)/15.-.5),0.,1.)); } return a/16.; }
vec4 zbl(sampler2D t, vec2 p, vec2 c, float s){ vec4 a=vec4(0.); for(int i=0;i<16;i++){ a+=texture(t,clamp(c+(p-c)*(1.-s*float(i)/15.),0.,1.)); } return a/16.; }
vec4 sbl(sampler2D t, vec2 p, vec2 c, float an){ vec4 a=vec4(0.); vec2 q=vec2((p.x-c.x)*ratio,p.y-c.y); for(int i=0;i<16;i++){ vec2 r=rot(q,an*(float(i)/15.-.5)); a+=texture(t,clamp(vec2(r.x/ratio,r.y)+c,0.,1.)); } return a/16.; }
vec3 vrDir(vec2 q){ float lo=(q.x-.5)*6.2831853, la=(q.y-.5)*3.1415927; return vec3(cos(la)*sin(lo),sin(la),cos(la)*cos(lo)); }
vec4 Aw(vec2 p){ return texture(u_a,vec2(fract(p.x),clamp(p.y,0.,1.))); }
vec4 Bw(vec2 p){ return texture(u_b,vec2(fract(p.x),clamp(p.y,0.,1.))); }
`;

/** folder -> name -> { params, glsl } */
export const MORE_TRANSITIONS = {
  // ---------------- Premiere Pro transitions that were missing ----------------
  'Wipe': {
    'Inset': { params: [sel('corner', 'Corner', ['Top Left', 'Top Right', 'Bottom Left', 'Bottom Right']), soft(0)],
      glsl: `vec4 transition(vec2 uv){ vec2 c=vec2(mod(corner,2.)>0.5?1.:0., corner<1.5?1.:0.); vec2 d=abs(uv-c); return mix(A(uv),B(uv),wipeMask(max(d.x,d.y),soft/500.)); }` },
    'Paint Splatter': { params: [s('n', 'Splats', 4, 60, 28), seed()],
      glsl: `vec4 transition(vec2 uv){ vec2 q=vec2(uv.x*ratio,uv.y); float m=0.;
        for(int i=0;i<60;i++){ if(float(i)>=n) break; vec2 h=hash2(vec2(float(i),seed)); vec2 c=vec2(h.x*ratio,h.y); float t0=hash(vec2(seed+3.,float(i)))*0.6;
          float r=(0.1+0.22*hash(h*7.1))*smoothstep(t0,t0+0.35,progress); float d=length(q-c)+0.3*r*(noise(q*16.+h*40.)-.5); m=max(m,1.-smoothstep(r-0.004,r,d)); }
        m=max(m,step(fbm(q*5.+seed)*0.3+0.7,progress)); return mix(A(uv),B(uv),m); }` },
    'Pinwheel': { params: [s('blades', 'Blades', 2, 16, 6), soft(5)],
      glsl: `vec4 transition(vec2 uv){ vec2 c=asp(uv); float f=fract((atan(c.y,c.x)/(2.*PI)+.5)*blades); return mix(A(uv),B(uv),wipeMask(f,soft/300.)); }` },
    'Random Blocks': { params: [s('cols', 'Wide', 2, 80, 16), s('rows', 'High', 2, 80, 9), seed()],
      glsl: `vec4 transition(vec2 uv){ vec2 g=floor(uv*vec2(cols,rows)); return hash(g+seed*1.7)<progress?B(uv):A(uv); }` },
    'Random Wipe': { params: [dir(), s('cols', 'Wide', 2, 80, 24), s('rows', 'High', 2, 80, 14), s('spread', 'Randomness', 0, 100, 40), seed()],
      glsl: `vec4 transition(vec2 uv){ vec2 N=vec2(cols,rows); vec2 g=floor(uv*N); float x=along((g+.5)/N,dirv(dir)); float sp=spread/100.; float k=x*(1.-sp)+hash(g+seed)*sp; return k<progress?B(uv):A(uv); }` },
    'Spiral Boxes': { params: [s('cols', 'Wide', 2, 40, 8), s('rows', 'High', 2, 40, 6)],
      glsl: `vec4 transition(vec2 uv){ vec2 N=vec2(cols,rows); vec2 g=floor(uv*N); float ring=min(min(g.x,N.x-1.-g.x),min(g.y,N.y-1.-g.y)); float rings=ceil(min(N.x,N.y)/2.);
        vec2 cc=g+.5-N*.5; float an=fract(atan(cc.y,cc.x)/(2.*PI)+.25); return (ring+an)/rings<progress?B(uv):A(uv); }` },
    'Wipe': { params: [s('angle', 'Angle', -180, 180, 0), soft(10)],
      glsl: `vec4 transition(vec2 uv){ float a=radians(angle); vec2 d=vec2(cos(a),sin(a)); float x=dot(asp(uv),d)/(abs(d.x)*ratio+abs(d.y))+.5; return mix(A(uv),B(uv),wipeMask(x,soft/100.)); }` },
    'Diagonal Split': { params: [sel('diag', 'Diagonal', ['/', '\\'])],
      glsl: `vec4 transition(vec2 uv){ vec2 d=diag<.5?normalize(vec2(ratio,1.)):normalize(vec2(ratio,-1.)); vec2 nrm=vec2(-d.y,d.x); vec2 q=asp(uv); float e=progress*progress*1.2;
        for(int i=0;i<2;i++){ float sd=i==0?1.:-1.; vec2 qa=q-nrm*sd*e; vec2 pa=unasp(qa); if(inside(pa)&&dot(qa,nrm)*sd>=0.) return A(pa); } return B(uv); }` },
    'Double Clock': { params: [soft(2)],
      glsl: `vec4 transition(vec2 uv){ vec2 c=asp(uv); float an=abs(atan(c.x,c.y))/PI; return mix(A(uv),B(uv),wipeMask(an,soft/200.)); }` },
    'Zebra Wipe': { params: [s('n', 'Stripes', 2, 40, 10), soft(3)],
      glsl: `vec4 transition(vec2 uv){ float k=floor(uv.y*n); float x=mod(k,2.)<0.5?uv.x:1.-uv.x; return mix(A(uv),B(uv),wipeMask(x,soft/200.)); }` },
    'Wave Wipe': { params: [dir(), s('waves', 'Waves', 0, 20, 4), s('height', 'Wave Height', 0, 100, 30), soft(4)],
      glsl: `vec4 transition(vec2 uv){ vec2 d=dirv(dir); vec2 t=vec2(-d.y,d.x); float x=along(uv,d)+sin(along(uv,t)*waves*2.*PI)*height/1000.; x=x*(1.-height/500.)+height/1000.; return mix(A(uv),B(uv),wipeMask(x,soft/200.)); }` },
    'Noise Wipe': { params: [dir(), s('rough', 'Roughness', 0, 100, 40), s('scale', 'Detail', 1, 40, 8), soft(2)],
      glsl: `vec4 transition(vec2 uv){ float r=rough/250.; float x=along(uv,dirv(dir))*(1.-r)+fbm(uv*scale)*r; return mix(A(uv),B(uv),wipeMask(x,soft/200.)); }` },
    'Brush Stroke Wipe': { params: [s('n', 'Strokes', 1, 12, 4), s('rough', 'Bristles', 0, 100, 50)],
      glsl: `vec4 transition(vec2 uv){ float k=floor(uv.y*n); float local=fract(uv.y*n); float x=mod(k,2.)<0.5?uv.x:1.-uv.x; float t=clamp(progress*n-k,0.,1.);
        float rag=(noise(vec2(uv.y*u_res.y*0.25,k))*0.06+abs(local-.5)*0.08)*rough/50.; return (x+rag)*0.85<t?B(uv):A(uv); }` },
    'Curtain': { params: [s('folds', 'Folds', 2, 30, 10)],
      glsl: `vec4 transition(vec2 uv){ float h=1.-progress; float x=uv.x<.5?uv.x:1.-uv.x; if(x>h*.5) return B(uv); float u=x/(h*.5+1e-5)*.5; float ax=uv.x<.5?u:1.-u;
        vec4 a=A(vec2(ax,uv.y)); float sh=0.75+0.25*cos(u*folds*2.*PI*(1.+progress*2.)); return vec4(a.rgb*mix(1.,sh,progress),a.a); }` },
    'Shutter': { params: [s('n', 'Blades', 2, 40, 8)],
      glsl: `vec4 transition(vec2 uv){ float k=floor(uv.y*n), y=fract(uv.y*n)-.5; float th=progress*PI; float c=cos(th); float yy=y/max(abs(c),1e-4);
        if(abs(yy)>.5) return vec4(0.,0.,0.,1.); vec2 p=vec2(uv.x,(k+yy+.5)/n); vec4 col=c>0.?A(p):B(p); return vec4(col.rgb*(0.55+0.45*abs(c)),col.a); }` },
    'Burst Lines': { params: [s('n', 'Lines', 4, 120, 40), seed()],
      glsl: `vec4 transition(vec2 uv){ vec2 c=asp(uv); float k=floor((atan(c.y,c.x)/(2.*PI)+.5)*n); float r=length(c)/maxR(vec2(.5)); return r*0.4+hash(vec2(k,seed))*0.6<progress?B(uv):A(uv); }` },
  },
  'Slide': {
    'Whip': { params: [dir(1), amount(60, 'Blur')],
      fns: `vec4 W(vec2 p, vec2 d, float e){ vec2 pa=p-d*e; return inside(pa)?texture(u_a,pa):Bc(pa+d); }`,
      glsl: `vec4 transition(vec2 uv){ vec2 d=dirv(dir); float e=progress<.5?4.*progress*progress*progress:1.-pow(-2.*progress+2.,3.)/2.; float b=bump()*amount*0.004; vec4 a=vec4(0.);
        for(int i=0;i<16;i++){ a+=W(uv+d*b*(float(i)/15.-.5),d,e); } return a/16.; }` },
    'Reveal': { params: [dir(1)],
      glsl: `vec4 transition(vec2 uv){ vec2 pa=uv-dirv(dir)*progress; vec4 a=A(pa); return inside(pa)?a:B(uv); }` },
    'Bounce Slide': { params: [dir(), s('bounce', 'Bounce', 0, 100, 50)],
      glsl: `vec4 transition(vec2 uv){ float c1=1.70158*bounce/50., c3=c1+1.; float e=1.+c3*pow(progress-1.,3.)+c1*pow(progress-1.,2.); vec2 pb=uv+dirv(dir)*(1.-e); return inside(pb)?B(pb):A(uv); }` },
    'Elastic Push': { params: [dir(1)],
      glsl: `vec4 transition(vec2 uv){ float x=progress; float e=x<=0.?0.:x>=1.?1.:pow(2.,-10.*x)*sin((x*10.-.75)*(2.*PI/3.))+1.; vec2 d=dirv(dir); vec2 pa=uv-d*e; return inside(pa)?A(pa):B(pa+d); }` },
    'Split Slide 4': { params: [s('spin', 'Spin', 0, 100, 0)],
      glsl: `vec4 transition(vec2 uv){ vec2 q=asp(uv); vec2 sg=vec2(q.x<0.?-1.:1.,q.y<0.?-1.:1.); float e=progress*progress; vec2 qa=rot(q-sg*vec2(ratio*.5,.5)*e*1.2,-sg.x*sg.y*spin*0.02*e); vec2 pa=unasp(qa);
        if(inside(pa)&&sign(qa.x+1e-6)==sg.x&&sign(qa.y+1e-6)==sg.y) return A(pa); return B(uv); }` },
    'Strips Slide': { params: [dir(), s('n', 'Strips', 2, 40, 8), s('stagger', 'Stagger', 0, 100, 50)],
      glsl: `vec4 transition(vec2 uv){ vec2 d=dirv(dir); vec2 t=vec2(abs(d.y),abs(d.x)); float k=floor(dot(uv,t)*n); float st=stagger/100.; float lp=clamp((progress-k/n*st)/(1.-st+1e-4),0.,1.);
        lp=1.-pow(1.-lp,3.); vec2 pb=uv-d*(lp-1.); return inside(pb)?B(pb):A(uv); }` },
    'Swap': { params: [s('depth', 'Depth', 0, 100, 50)],
      glsl: `vec4 transition(vec2 uv){ float z=1.-bump()*depth/200.; vec2 q=(uv-.5)/z+.5; vec4 a=A(q+vec2(progress*1.05,0.)), b=B(q-vec2((1.-progress)*1.05,0.)); return progress<.5?(a.a>0.?a:b):(b.a>0.?b:a); }` },
    'Perspective Push': { params: [dir(1), s('tilt', 'Tilt', 0, 100, 40)],
      glsl: `vec4 transition(vec2 uv){ vec2 d=dirv(dir); float e=smoothstep(0.,1.,progress); float z=1.-bump()*0.15; vec2 q=(uv-.5)/z+.5; float t=along(q,d);
        q=.5+(q-.5)*vec2(1.+abs(d.y)*(t-.5)*tilt/250.*bump(),1.+abs(d.x)*(t-.5)*tilt/250.*bump()); vec2 pa=q-d*e; return inside(pa)?A(pa):B(pa+d); }` },
  },
  'Immersive Video': {
    'VR Chroma Leaks': { params: [amount(60), seed()],
      glsl: `vec4 transition(vec2 uv){ vec4 m=mix(Aw(uv),Bw(uv),xf(.25,.75)); float w=bump(); vec3 leak=hsv2rgb(vec3(fract(uv.x*1.5+progress*.7+fbm(uv*3.+seed)),0.75,1.));
        float k=smoothstep(.35,.9,fbm(vec2(uv.x*4.+progress*3.,uv.y*2.)+seed)); return vec4(min(m.rgb+leak*w*k*amount/50.,1.),m.a); }` },
    'VR Gradient Wipe': { params: [soft(15), chk('invert', 'Invert Gradient')],
      glsl: `vec4 transition(vec2 uv){ vec3 d=vrDir(uv); float g=clamp(.5+.35*d.y+.15*(fbm(vec2(atan(d.x,d.z)*1.5,d.y*3.))-.5),0.,1.); if(invert>.5) g=1.-g; return mix(Aw(uv),Bw(uv),wipeMask(g,soft/100.)); }` },
    'VR Iris Wipe': { params: [center(), soft(5)],
      glsl: `vec4 transition(vec2 uv){ vec3 c=vrDir(vec2(center.x,1.-center.y)); float an=acos(clamp(dot(vrDir(uv),c),-1.,1.))/PI; return mix(Aw(uv),Bw(uv),wipeMask(an,soft/200.)); }` },
    'VR Light Leaks': { params: [col('color', 'Leak Color', '#ff9a3c'), amount(70), seed()],
      glsl: `vec4 transition(vec2 uv){ vec4 m=mix(Aw(uv),Bw(uv),xf(.3,.7)); float k=smoothstep(.4,1.,fbm(vec2(uv.x*3.-progress*2.,uv.y*1.5)+seed))*bump(); vec3 r=1.-(1.-m.rgb)*(1.-color*k*amount/50.); return vec4(r,m.a); }` },
    'VR Light Rays': { params: [center(), col('color', 'Ray Color', '#fff2d0'), amount(70)],
      glsl: `vec4 transition(vec2 uv){ vec4 m=mix(Aw(uv),Bw(uv),xf(.35,.65)); vec2 c=vec2(center.x,1.-center.y); vec2 dd=uv-c; dd.x-=floor(dd.x+.5); float an=atan(dd.y,dd.x);
        float rays=pow(noise(vec2(an*9.,progress*3.)),3.)*bump()*(1.-smoothstep(0.,.6,length(dd))); return vec4(min(m.rgb+color*rays*amount/30.,1.),m.a); }` },
    'VR Mobius Zoom': { params: [center(), amount(50, 'Zoom')],
      glsl: `vec4 transition(vec2 uv){ vec2 c=vec2(center.x,1.-center.y); float k=amount/12.; vec2 dd=uv-c; dd.x-=floor(dd.x+.5); return mix(Aw(c+dd/(1.+progress*k)),Bw(c+dd/(1.+(1.-progress)*k)),xf(.3,.7)); }` },
    'VR Random Blocks': { params: [s('cols', 'Blocks Around', 4, 96, 32), s('rows', 'Blocks High', 2, 48, 14), seed()],
      glsl: `vec4 transition(vec2 uv){ float row=floor(uv.y*rows); float la=((row+.5)/rows-.5)*PI; float nc=max(1.,floor(cols*cos(la))); vec2 g=vec2(floor(uv.x*nc),row); return hash(g+seed*1.3)<progress?Bw(uv):Aw(uv); }` },
    'VR Spherical Blur': { params: [amount(60, 'Blurriness')],
      glsl: `vec4 transition(vec2 uv){ float r=bump()*amount*0.0012; float sx=1./max(.15,cos((uv.y-.5)*PI)); vec4 a=vec4(0.), b=vec4(0.);
        for(int i=0;i<20;i++){ float f=(float(i)+.5)/20.; float an=float(i)*2.39996; vec2 o=vec2(cos(an)*sx,sin(an))*sqrt(f)*r; a+=Aw(uv+o); b+=Bw(uv+o); } return mix(a,b,xf(.4,.6))/20.; }` },
  },
  // ---------------- beyond Premiere ----------------
  'Blur': {
    'Blur Dissolve': { params: [amount(50, 'Blurriness')],
      glsl: `vec4 transition(vec2 uv){ float r=bump()*amount*0.0016; return mix(bl(u_a,uv,r),bl(u_b,uv,r),xf(.2,.8)); }` },
    'Zoom Blur Dissolve': { params: [center(), amount(50, 'Strength')],
      glsl: `vec4 transition(vec2 uv){ vec2 c=vec2(center.x,1.-center.y); float k=bump()*amount/150.; return mix(zbl(u_a,uv,c,k),zbl(u_b,uv,c,k),xf(.35,.65)); }` },
    'Spin Blur': { params: [center(), amount(50, 'Strength')],
      glsl: `vec4 transition(vec2 uv){ vec2 c=vec2(center.x,1.-center.y); float k=bump()*amount/80.; return mix(sbl(u_a,uv,c,k),sbl(u_b,uv,c,k),xf(.35,.65)); }` },
    'Directional Blur Wipe': { params: [dir(), amount(50, 'Blur'), soft(30)],
      glsl: `vec4 transition(vec2 uv){ vec2 d=dirv(dir); vec2 bv=d*bump()*amount*0.004; float m=wipeMask(along(uv,d),soft/100.); return mix(dbl(u_a,uv,bv),dbl(u_b,uv,bv),m); }` },
    'Defocus': { params: [amount(60, 'Blurriness')],
      glsl: `vec4 transition(vec2 uv){ float r=(progress<.5?progress*2.:(1.-progress)*2.)*amount*0.0015; return mix(bl(u_a,uv,r),bl(u_b,uv,r),xf(.45,.55)); }` },
    'Smear': { params: [sel('axis', 'Axis', ['Horizontal', 'Vertical']), amount(60, 'Length')],
      glsl: `vec4 transition(vec2 uv){ vec2 d=(axis<.5?vec2(1.,0.):vec2(0.,1.))*bump()*amount*0.006; vec2 st=(axis<.5?vec2(1.+bump()*amount/60.,1.):vec2(1.,1.+bump()*amount/60.)); vec2 q=(uv-.5)/st+.5; return mix(dbl(u_a,q,d),dbl(u_b,q,d),xf(.4,.6)); }` },
    'Frosted Glass': { params: [amount(50, 'Frost'), s('scale', 'Grain', 1, 100, 40)],
      glsl: `vec4 transition(vec2 uv){ vec2 o=(hash2(floor(uv*u_res/max(1.,scale/20.)))-.5)*bump()*amount*0.002; return mix(Ac(uv+o),Bc(uv+o),xf(.3,.7)); }` },
  },
  'Glitch': {
    'Glitch Cut': { params: [amount(50, 'Strength'), seed()],
      fns: `vec4 pick(vec2 p, float t){ return hash(vec2(t,3.7+seed))<progress?Bc(p):Ac(p); }`,
      glsl: `vec4 transition(vec2 uv){ float w=bump(); float t=floor(progress*24.); float row=floor(uv.y*36.); float on=step(.55,hash(vec2(t,row*.37+seed)));
        vec2 p=vec2(uv.x+(hash(vec2(row,t))-.5)*.25*w*on*amount/50.,uv.y); float sh=w*amount*0.0004*on*40.; return vec4(pick(p+vec2(sh,0.),t).r,pick(p,t).g,pick(p-vec2(sh,0.),t).b,1.); }` },
    'RGB Split': { params: [s('angle', 'Angle', -180, 180, 0), amount(50, 'Split')],
      glsl: `vec4 transition(vec2 uv){ vec2 d=vec2(cos(radians(angle)),sin(radians(angle)))*bump()*amount*0.0012; float m=xf(.4,.6);
        vec4 c=mix(Ac(uv),Bc(uv),m); return vec4(mix(Ac(uv+d),Bc(uv+d),m).r,c.g,mix(Ac(uv-d),Bc(uv-d),m).b,c.a); }` },
    'Digital Blocks': { params: [s('size', 'Block Size', 4, 200, 40), seed()],
      glsl: `vec4 transition(vec2 uv){ vec2 g=floor(uv*u_res/size); float t=floor(progress*16.); vec2 h=hash2(g+t+seed); vec2 off=(h-.5)*bump()*0.08*step(.6,hash(g*1.3+t));
        return hash(g+seed)<progress?Bc(uv+off):Ac(uv+off); }` },
    'Scan Line Switch': { params: [s('lineH', 'Line Height (px)', 1, 40, 4), seed()],
      glsl: `vec4 transition(vec2 uv){ float row=floor(uv.y*u_res.y/lineH); vec4 c=hash(vec2(row,seed))<progress?B(uv):A(uv); float sc=0.85+0.15*step(.5,fract(uv.y*u_res.y/(lineH*2.))); return vec4(c.rgb*mix(1.,sc,bump()),c.a); }` },
    'Signal Loss': { params: [amount(70, 'Noise')],
      glsl: `vec4 transition(vec2 uv){ float n=hash(floor(uv*u_res/2.)+floor(progress*60.)*7.1); float k=pow(bump(),0.7)*amount/100.; float roll=sin(uv.y*40.+progress*80.)*0.004*k; vec4 m=progress<.5?Ac(uv+vec2(roll,0.)):Bc(uv+vec2(roll,0.)); return vec4(mix(m.rgb,vec3(n),k),m.a); }` },
    'Pixel Shift': { params: [s('cols', 'Columns', 4, 400, 120), amount(60, 'Shift'), seed()],
      glsl: `vec4 transition(vec2 uv){ float c=floor(uv.x*cols); float sh=(hash(vec2(c,seed))-.5)*bump()*amount/100.; vec2 p=vec2(uv.x,fract(uv.y+sh)); return hash(vec2(seed,c))*0.5+uv.y*0.5<progress?Bc(p):Ac(p); }` },
    'VHS Rewind': { params: [amount(60, 'Tracking')],
      glsl: `vec4 transition(vec2 uv){ float k=bump()*amount/100.; float band=step(.75,noise(vec2(uv.y*6.-progress*20.,progress*5.))); float wob=(noise(vec2(uv.y*30.,progress*40.))-.5)*0.04*k+band*0.03*k;
        vec2 p=vec2(uv.x+wob,fract(uv.y+progress*k*2.)); vec4 m=progress<.5?Ac(p):Bc(p); vec4 m2=progress<.5?Ac(p+vec2(0.006*k,0.)):Bc(p+vec2(0.006*k,0.)); return vec4(m2.r,m.g,m.b*.9+band*k*.2,m.a); }` },
    'Datamosh Look': { params: [s('size', 'Block Size', 4, 64, 16), amount(60, 'Smear')],
      glsl: `vec4 transition(vec2 uv){ vec2 g=floor(uv*u_res/size); vec2 off=(hash2(g)-.5)*0.12*(1.-progress)*amount/50.; vec4 b=Bc(uv+off*bump()), a=Ac(uv-off*progress*.5); return hash(g*.7)<progress*1.15-.1?b:a; }` },
    'Chroma Glitch': { params: [s('n', 'Bands', 2, 60, 18), amount(70)],
      glsl: `vec4 transition(vec2 uv){ float band=floor(uv.y*n); float t=floor(progress*20.); float h=hash(vec2(band,t)); vec4 m=mix(Ac(uv),Bc(uv),xf(.45,.55)); float k=bump()*step(.6,h)*amount/50.; return vec4(clamp(hueRot(m.rgb,h*6.283*k),0.,1.),m.a); }` },
    'Slice Shift': { params: [s('n', 'Slices', 2, 40, 10), s('stagger', 'Stagger', 0, 100, 40), seed()],
      glsl: `vec4 transition(vec2 uv){ float k=floor(uv.y*n); float dl=hash(vec2(k,seed))*stagger/100.; float lp=clamp((progress-dl)/(1.-stagger/100.+1e-4),0.,1.); lp=lp*lp*(3.-2.*lp); float sd=mod(k,2.)<.5?1.:-1.;
        vec2 pb=uv-vec2(sd*(1.-lp),0.); return inside(pb)?B(pb):A(uv); }` },
  },
  'Light': {
    'Light Leak': { params: [col('color', 'Color', '#ff8a3d'), amount(70), seed()],
      glsl: `vec4 transition(vec2 uv){ vec4 m=mix(A(uv),B(uv),xf(.3,.7)); vec2 q=asp(uv); float k=smoothstep(.35,1.,fbm(q*2.+vec2(progress*2.,0.)+seed))*bump()*(0.6+0.4*uv.x);
        vec3 r=1.-(1.-m.rgb)*(1.-color*k*amount/45.); return vec4(r,m.a); }` },
    'Flash': { params: [col('color', 'Color', '#ffffff'), amount(100, 'Intensity'), s('width', 'Duration', 5, 100, 30)],
      glsl: `vec4 transition(vec2 uv){ float f=exp(-pow((progress-.5)*(14.-width/10.),2.)); vec4 m=progress<.5?A(uv):B(uv); vec3 r=1.-(1.-m.rgb)*(1.-color*f*amount/100.); return vec4(r,max(m.a,f)); }` },
    'Lens Flare Sweep': { params: [col('color', 'Color', '#ffd9a0'), amount(70)],
      glsl: `vec4 transition(vec2 uv){ vec4 m=mix(A(uv),B(uv),xf(.42,.58)); vec2 fp=vec2(mix(-.2,1.2,progress),.65); vec2 q=asp(uv)-asp(fp);
        float core=exp(-dot(q,q)*60.); float streak=exp(-abs(q.y)*120.)*exp(-abs(q.x)*2.); float g1=exp(-dot(asp(uv)+asp(fp)*.6-vec2(.0),asp(uv)+asp(fp)*.6)*400.)*.4;
        vec3 fl=color*(core*1.6+streak*.8+g1)*bump()*amount/50.; return vec4(min(m.rgb+fl,1.),m.a); }` },
    'Light Sweep': { params: [s('angle', 'Angle', -90, 90, 30), col('color', 'Color', '#ffffff'), s('width', 'Width', 1, 100, 25)],
      glsl: `vec4 transition(vec2 uv){ vec2 d=vec2(cos(radians(angle)),sin(radians(angle))); float x=dot(asp(uv),d)/(abs(d.x)*ratio+abs(d.y))+.5; float pos=progress*(1.+width/50.)-width/100.;
        float band=exp(-pow((x-pos)/(width/400.),2.)); vec4 m=x<pos?B(uv):A(uv); return vec4(min(m.rgb+color*band,1.),m.a); }` },
    'Exposure Blowout': { params: [amount(70, 'Exposure')],
      glsl: `vec4 transition(vec2 uv){ float e=bump()*amount/12.; vec4 m=mix(A(uv),B(uv),xf(.4,.6)); return vec4(min(m.rgb*(1.+e)+e*0.08,1.),m.a); }` },
    'Glow Dissolve': { params: [amount(60, 'Glow'), s('thresh', 'Threshold', 0, 100, 50)],
      glsl: `vec4 transition(vec2 uv){ float r=bump()*0.03; vec4 m=mix(A(uv),B(uv),xf(.2,.8)); vec4 g=mix(bl(u_a,uv,r),bl(u_b,uv,r),xf(.2,.8)); vec3 hi=max(g.rgb-thresh/100.,0.)/(1.-thresh/101.); return vec4(min(m.rgb+hi*bump()*amount/40.,1.),m.a); }` },
    'Rainbow Leak': { params: [amount(60), s('angle', 'Angle', -90, 90, -20)],
      glsl: `vec4 transition(vec2 uv){ vec4 m=mix(A(uv),B(uv),xf(.3,.7)); vec2 d=vec2(cos(radians(angle)),sin(radians(angle))); float x=dot(asp(uv),d)+.5-mix(-.6,.6,progress);
        vec3 rb=hsv2rgb(vec3(fract(x*1.5),.8,1.))*exp(-x*x*8.); vec3 r=1.-(1.-m.rgb)*(1.-rb*bump()*amount/60.); return vec4(r,m.a); }` },
    'Bokeh Dissolve': { params: [s('n', 'Lights', 4, 60, 30), col('color', 'Color', '#ffe2b0'), seed()],
      glsl: `vec4 transition(vec2 uv){ vec4 m=mix(bl(u_a,uv,bump()*.012),bl(u_b,uv,bump()*.012),xf(.3,.7)); vec2 q=vec2(uv.x*ratio,uv.y); float b=0.;
        for(int i=0;i<60;i++){ if(float(i)>=n) break; vec2 h=hash2(vec2(float(i),seed)); vec2 c=vec2(h.x*ratio,h.y+progress*.15*(h.x-.5)); float r=.02+.05*hash(h); b+=smoothstep(r,r*.85,length(q-c))*(0.4+0.6*hash(h*3.)); }
        return vec4(min(m.rgb+color*b*bump()*0.6,1.),m.a); }` },
  },
  'Shape': {
    'Heart': { params: [soft(2)],
      glsl: `vec4 transition(vec2 uv){ vec2 q=asp(uv)/(progress*1.9+1e-4)*1.35; q.y+=0.1; float v=pow(dot(q,q)-1.,3.)-q.x*q.x*q.y*q.y*q.y; float m=1.-smoothstep(-soft/400.,soft/400.+1e-4,v); return mix(A(uv),B(uv),m); }` },
    'Star Burst': { params: [s('points', 'Points', 3, 16, 5), s('spin', 'Spin', -100, 100, 30), soft(1)],
      glsl: `vec4 transition(vec2 uv){ vec2 q=asp(uv); float an=atan(q.y,q.x)+progress*spin*0.03; float r=length(q)/maxR(vec2(.5)); float k=r*(0.65+0.35*cos(points*an))/1.; return mix(A(uv),B(uv),wipeMask(k,soft/100.)); }` },
    'Circle Open': { params: [center(), soft(3)],
      glsl: `vec4 transition(vec2 uv){ vec2 c=vec2(center.x,1.-center.y); float d=length(vec2((uv.x-c.x)*ratio,uv.y-c.y))/maxR(c); return mix(A(uv),B(uv),wipeMask(d,soft/100.)); }` },
    'Circle Close': { params: [center(), soft(3)],
      glsl: `vec4 transition(vec2 uv){ vec2 c=vec2(center.x,1.-center.y); float d=length(vec2((uv.x-c.x)*ratio,uv.y-c.y))/maxR(c); return mix(A(uv),B(uv),wipeMask(1.-d,soft/100.)); }` },
    'Hexagon Iris': { params: [soft(2)],
      fns: `float hx(vec2 q){ q=abs(q); return max(q.x*0.866+q.y*0.5,q.y); }`,
      glsl: `vec4 transition(vec2 uv){ float m=hx(vec2(ratio*.5,.5)); return mix(A(uv),B(uv),wipeMask(hx(asp(uv))/m,soft/100.)); }` },
    'Diamond Grid': { params: [s('n', 'Size', 2, 40, 10), soft(2)],
      glsl: `vec4 transition(vec2 uv){ vec2 N=vec2(n*ratio,n); vec2 g=floor(uv*N), q=fract(uv*N)-.5; float dl=length((g+.5)/N-.5)*0.6; float lp=clamp((progress-dl)/0.4,0.,1.); return (abs(q.x)+abs(q.y))<lp*1.001?B(uv):A(uv); }` },
    'Circle Grid': { params: [s('n', 'Size', 2, 40, 10), dir()],
      glsl: `vec4 transition(vec2 uv){ vec2 N=vec2(n*ratio,n); vec2 g=floor(uv*N), q=fract(uv*N)-.5; float dl=along((g+.5)/N,dirv(dir))*0.6; float lp=clamp((progress-dl)/0.4,0.,1.); return length(q)<lp*0.7072?B(uv):A(uv); }` },
    'Polka Dots': { params: [s('n', 'Size', 2, 40, 12), seed()],
      glsl: `vec4 transition(vec2 uv){ vec2 N=vec2(n*ratio,n); vec2 g=floor(uv*N), q=fract(uv*N)-.5; float dl=hash(g+seed)*0.6; float lp=clamp((progress-dl)/0.4,0.,1.); return length(q)<lp*0.7072?B(uv):A(uv); }` },
    'Triangle Iris': { params: [soft(2)],
      fns: `float tri(vec2 q){ q.y+=0.08; return max(abs(q.x)*0.866+q.y*0.5,-q.y); }`,
      glsl: `vec4 transition(vec2 uv){ vec2 h=vec2(ratio*.5,.5); float m=max(max(tri(h),tri(-h)),max(tri(vec2(h.x,-h.y)),tri(vec2(-h.x,h.y)))); return mix(A(uv),B(uv),wipeMask(tri(asp(uv))/m,soft/100.)); }` },
    'Rounded Rect Iris': { params: [s('roundness', 'Roundness', 0, 100, 40), soft(2)],
      glsl: `vec4 transition(vec2 uv){ vec2 q=abs(asp(uv)); vec2 hb=vec2(ratio*.5,.5)*progress*1.12; float r=min(hb.x,hb.y)*roundness/100.; vec2 dd=q-hb+r; float d=length(max(dd,0.))+min(max(dd.x,dd.y),0.)-r;
        float m=1.-smoothstep(-soft/500.,soft/500.+1e-4,d); return mix(A(uv),B(uv),m); }` },
    'Spiral Iris': { params: [s('turns', 'Turns', 0, 10, 2), center()],
      glsl: `vec4 transition(vec2 uv){ vec2 c=vec2(center.x,1.-center.y); vec2 q=vec2((uv.x-c.x)*ratio,uv.y-c.y); float r=length(q)/maxR(c); float an=fract(atan(q.y,q.x)/(2.*PI)+.5+r*turns); return r*.7+an*.3<progress?B(uv):A(uv); }` },
    'Ellipse Iris': { params: [s('aspect', 'Aspect', 10, 400, 200), center(), soft(3)],
      glsl: `vec4 transition(vec2 uv){ vec2 c=vec2(center.x,1.-center.y); vec2 q=vec2((uv.x-c.x)*ratio,(uv.y-c.y)*aspect/100.); float d=length(q)/length(vec2(max(c.x,1.-c.x)*ratio,max(c.y,1.-c.y)*aspect/100.)); return mix(A(uv),B(uv),wipeMask(d,soft/100.)); }` },
    'Diagonal Blinds': { params: [s('n', 'Stripes', 2, 40, 10), sel('diag', 'Diagonal', ['/', '\\'])],
      glsl: `vec4 transition(vec2 uv){ float x=diag<.5?uv.x*ratio+uv.y:uv.x*ratio-uv.y; return fract(x*n/(ratio+1.))<progress?B(uv):A(uv); }` },
  },
  'Zoom & Spin': {
    'Zoom In': { params: [amount(50, 'Zoom'), center()],
      glsl: `vec4 transition(vec2 uv){ vec2 c=vec2(center.x,1.-center.y); float k=1.+amount/25.; vec4 a=Ac(c+(uv-c)/mix(1.,k,progress)), b=Bc(c+(uv-c)/mix(1./k,1.,progress)); return mix(a,b,xf(.35,.65)); }` },
    'Zoom Out': { params: [amount(50, 'Zoom'), center()],
      glsl: `vec4 transition(vec2 uv){ vec2 c=vec2(center.x,1.-center.y); float k=1.+amount/25.; vec4 a=Ac(c+(uv-c)/mix(1.,1./k,progress)), b=Bc(c+(uv-c)/mix(k,1.,progress)); return mix(a,b,xf(.35,.65)); }` },
    'Spin Zoom': { params: [amount(50, 'Zoom'), s('turns', 'Rotation (deg)', -720, 720, 180)],
      glsl: `vec4 transition(vec2 uv){ float e=smoothstep(0.,1.,progress); float z=1.+bump()*amount/30.; vec2 q=rot(asp(uv)/z,radians(turns)*(e-(progress<.5?0.:1.))); vec2 p=unasp(q); vec4 a=sbl(u_a,p,vec2(.5),bump()*.6), b=sbl(u_b,p,vec2(.5),bump()*.6); return progress<.5?a:b; }` },
    'Swirl': { params: [amount(60, 'Twist'), s('radius', 'Radius', 10, 100, 60)],
      glsl: `vec4 transition(vec2 uv){ vec2 q=asp(uv); float r=length(q); float R=radius/100.; float k=bump()*amount/8.*max(0.,1.-r/R); q=rot(q,k*(1.-r/R)); vec2 p=unasp(q); return mix(Ac(p),Bc(p),xf(.35,.65)); }` },
    'Spin': { params: [s('turns', 'Rotation (deg)', -720, 720, 180)],
      glsl: `vec4 transition(vec2 uv){ vec2 q=asp(uv); if(progress<.5){ vec2 p=unasp(rot(q,-radians(turns)*progress)/(1.-progress*1.6)); return A(p); } vec2 p=unasp(rot(q,radians(turns)*(1.-progress))/(1.-(1.-progress)*1.6)); return B(p); }` },
    'Zoom Through': { params: [amount(50, 'Speed')],
      glsl: `vec4 transition(vec2 uv){ float e=pow(progress,1.+amount/50.); vec2 pb=.5+(uv-.5)/max(e,1e-4); vec2 pa=.5+(uv-.5)/(1.+progress*6.); vec4 b=B(pb); return inside(pb)?b:A(pa); }` },
    'Rotate Zoom Out': { params: [s('turns', 'Rotation (deg)', -720, 720, 90)],
      glsl: `vec4 transition(vec2 uv){ float z=max(1.-progress,1e-4); vec2 pa=unasp(rot(asp(uv),-radians(turns)*progress)/z); return inside(pa)?A(pa):B(uv); }` },
    'Tunnel': { params: [amount(50, 'Depth')],
      glsl: `vec4 transition(vec2 uv){ vec2 q=asp(uv); float r=length(q)+1e-4; float k=bump()*amount/40.; float rr=pow(r/0.6,1.+k)*0.6; vec2 p=unasp(q/r*rr); return mix(Ac(p),Bc(p),xf(.4,.6)); }` },
    'Barrel Roll': { params: [sel('way', 'Direction', ['Clockwise', 'Counter-clockwise'])],
      glsl: `vec4 transition(vec2 uv){ float sg=way<.5?-1.:1.; float e=smoothstep(0.,1.,progress); vec2 q=rot(asp(uv),sg*2.*PI*e); vec2 p=unasp(q/(1.+bump()*.4)); vec4 a=sbl(u_a,p,vec2(.5),bump()*.8), b=sbl(u_b,p,vec2(.5),bump()*.8); return progress<.5?a:b; }` },
    'Stretch': { params: [sel('axis', 'Axis', ['Horizontal', 'Vertical']), amount(70, 'Stretch')],
      glsl: `vec4 transition(vec2 uv){ float k=1.+bump()*amount/8.; vec2 st=axis<.5?vec2(k,1.):vec2(1.,k); vec2 p=(uv-.5)/st+.5; return mix(Ac(p),Bc(p),xf(.4,.6)); }` },
    'Squeeze': { params: [sel('axis', 'Axis', ['Horizontal', 'Vertical'])],
      glsl: `vec4 transition(vec2 uv){ float z=progress<.5?1.-progress*2.:(progress-.5)*2.; z=max(z,1e-4); vec2 st=axis<.5?vec2(z,1.):vec2(1.,z); vec2 p=(uv-.5)/st+.5; return progress<.5?A(p):B(p); }` },
  },
  '3D': {
    'Door': { params: [sel('hinge', 'Hinge', ['Left', 'Right']), s('persp', 'Perspective', 0, 100, 50)],
      glsl: `vec4 transition(vec2 uv){ float X=hinge<.5?uv.x:1.-uv.x; float Y=uv.y-.5; float th=progress*PI*.5; float k=persp/60.; float den=cos(th)-X*sin(th)*k; if(den<=1e-4) return B(uv);
        float u=X/den; float y=Y*(1.+u*sin(th)*k); if(u>=0.&&u<=1.&&abs(y)<=.5){ vec2 p=vec2(hinge<.5?u:1.-u,y+.5); vec4 a=A(p); return vec4(a.rgb*(1.-0.5*sin(th)),a.a); } return B(uv); }` },
    'Doorway': { params: [s('persp', 'Perspective', 0, 100, 50)],
      glsl: `vec4 transition(vec2 uv){ bool L=uv.x<.5; float X=L?uv.x*2.:(1.-uv.x)*2.; float Y=uv.y-.5; float th=progress*PI*.5; float k=persp/60.; float den=cos(th)-X*sin(th)*k;
        if(den>1e-4){ float u=X/den; float y=Y*(1.+u*sin(th)*k); if(u>=0.&&u<=1.&&abs(y)<=.5){ vec2 p=vec2(L?u*.5:1.-u*.5,y+.5); vec4 a=A(p); return vec4(a.rgb*(1.-0.5*sin(th)),a.a); } }
        float z=mix(.75,1.,progress); return B((uv-.5)/z+.5); }` },
    'Fold': { params: [sel('side', 'Fold Toward', ['Right', 'Left'])],
      glsl: `vec4 transition(vec2 uv){ float x=side<.5?uv.x:1.-uv.x; float e=progress;
        if(x>e){ float u=(x-e)/(1.-e+1e-5); vec4 a=A(vec2(side<.5?u:1.-u,uv.y)); return vec4(a.rgb*(1.-.4*e),a.a); }
        float u=x/(e+1e-5); vec4 b=B(vec2(side<.5?u:1.-u,uv.y)); return vec4(b.rgb*(.6+.4*e),b.a); }` },
    'Card Flip Vertical': { params: [s('persp', 'Perspective', 0, 100, 50)],
      glsl: `vec4 transition(vec2 uv){ float th=progress*PI; float c=cos(th); vec2 q=uv-.5; float pp=1.+q.y*sin(th)*persp/80.*sign(c); vec2 sp=vec2(q.x*pp,q.y/max(abs(c),1e-4)); if(abs(sp.y)>.5||abs(sp.x)>.5) return vec4(0.,0.,0.,1.);
        vec4 col=c>0.?A(sp+.5):B(sp+.5); return vec4(col.rgb*(0.5+0.5*abs(c)),col.a); }` },
    'Cube Vertical': { params: [sel('way', 'Direction', ['Up', 'Down'])],
      glsl: `vec4 transition(vec2 uv){ float y=way<.5?uv.y:1.-uv.y; float e=progress; float pz=sin(PI*e)*.18;
        if(y<e){ float v=y/(e+1e-5); float sx=1.-pz*(1.-v); float x=(uv.x-.5)/sx+.5; vec4 b=B(vec2(x,way<.5?v:1.-v)); return abs(x-.5)<=.5?vec4(b.rgb*(0.6+0.4*e),b.a):vec4(0.,0.,0.,1.); }
        float v=(y-e)/(1.-e+1e-5); float sx=1.-pz*v; float x=(uv.x-.5)/sx+.5; vec4 a=A(vec2(x,way<.5?v:1.-v)); return abs(x-.5)<=.5?vec4(a.rgb*(1.-0.4*e),a.a):vec4(0.,0.,0.,1.); }` },
    'Swing': { params: [sel('hinge', 'Hinge', ['Top', 'Bottom']), s('persp', 'Perspective', 0, 100, 50)],
      glsl: `vec4 transition(vec2 uv){ float Y=hinge<.5?1.-uv.y:uv.y; float X=uv.x-.5; float th=progress*PI*.5; float k=persp/60.; float den=cos(th)-Y*sin(th)*k; if(den<=1e-4) return B(uv);
        float v=Y/den; float x=X*(1.+v*sin(th)*k); if(v>=0.&&v<=1.&&abs(x)<=.5){ vec4 a=A(vec2(x+.5,hinge<.5?1.-v:v)); return vec4(a.rgb*(1.-.5*sin(th)),a.a); } return B(uv); }` },
    'Book Flip': {
      params: [],
      glsl: `vec4 transition(vec2 uv){ float th=progress*PI; float c=cos(th); float x=uv.x-.5;
        if(x>=0.){ if(c>0.&&x<.5*c){ vec4 a=A(vec2(.5+x/c,uv.y)); return vec4(a.rgb*(.6+.4*c),a.a); } return B(uv); }
        if(c<0.&&-x<.5*(-c)){ vec4 b=B(vec2(.5+x/(-c),uv.y)); return vec4(b.rgb*(.6+.4*(-c)),b.a); } return A(uv); }` },
    'Tumble': { params: [s('turns', 'Rotation (deg)', -360, 360, 40)],
      glsl: `vec4 transition(vec2 uv){ float e=progress*progress; vec2 q=asp(uv)+vec2(0.,e*1.3); q=rot(q,-radians(turns)*e); vec2 p=unasp(q/(1.-progress*.3)); return inside(p)?A(p):B(uv); }` },
    'Fold Up': { params: [s('n', 'Folds', 1, 20, 6)],
      glsl: `vec4 transition(vec2 uv){ float e=progress; if(uv.y<e) return B(uv); float v=(uv.y-e)/(1.-e+1e-5); float f=fract(v*n); vec4 a=A(vec2(uv.x,v)); float sh=mod(floor(v*n),2.)<.5?1.-.5*e*f:1.-.5*e*(1.-f); return vec4(a.rgb*sh,a.a); }` },
  },
  'Blocks & Grid': {
    'Pixelize': { params: [s('size', 'Max Block Size', 2, 200, 60)],
      glsl: `vec4 transition(vec2 uv){ float b=max(1.,floor(bump()*size)); vec2 px=b/u_res; vec2 p=b>1.?(floor(uv/px)+.5)*px:uv; return progress<.5?Ac(p):Bc(p); }` },
    'Mosaic Reveal': { params: [s('n', 'Tiles High', 2, 40, 8), seed()],
      glsl: `vec4 transition(vec2 uv){ vec2 N=vec2(floor(n*ratio+.5),n); vec2 g=floor(uv*N), q=fract(uv*N)-.5; float dl=hash(g+seed)*.6; float lp=clamp((progress-dl)/.4,0.,1.); vec2 qs=q/max(lp,1e-4); return max(abs(q.x),abs(q.y))<lp*.5?Bc((g+.5+qs)/N):A(uv); }` },
    'Squares Wire': { params: [s('n', 'Squares High', 2, 40, 10), col('color', 'Wire Color', '#ffffff'), s('wire', 'Wire Width', 0, 10, 2)],
      glsl: `vec4 transition(vec2 uv){ vec2 N=vec2(floor(n*ratio+.5),n); vec2 g=floor(uv*N), q=fract(uv*N); float k=(g.x/N.x+g.y/N.y)*.5; float lp=clamp((progress*1.4-k)/.4,0.,1.);
        vec4 c=lp>=1.?B(uv):A(uv); float wpx=wire/ (u_res.y/N.y); float line=(lp>0.&&lp<1.)?step(min(min(q.x,q.y),min(1.-q.x,1.-q.y)),wpx):0.; return mix(c,vec4(color,1.),line); }` },
    'Squares Grow': { params: [s('n', 'Squares High', 2, 40, 10)],
      glsl: `vec4 transition(vec2 uv){ vec2 N=vec2(floor(n*ratio+.5),n); vec2 g=floor(uv*N), q=fract(uv*N)-.5; float dl=length((g+.5)/N-.5)*.8; float lp=clamp((progress-dl)/.45,0.,1.); return max(abs(q.x),abs(q.y))<lp*.5001?B(uv):A(uv); }` },
    'Grid Flip': { params: [s('n', 'Tiles High', 2, 30, 6)],
      glsl: `vec4 transition(vec2 uv){ vec2 N=vec2(floor(n*ratio+.5),n); vec2 g=floor(uv*N), q=fract(uv*N)-.5; float dl=(g.x/N.x+g.y/N.y)*.25; float th=clamp((progress-dl)*2.,0.,1.)*PI; float c=cos(th);
        float x=q.x/max(abs(c),1e-4); if(abs(x)>.5) return vec4(0.,0.,0.,1.); vec2 p=(g+.5+vec2(x,q.y))/N; vec4 col=c>0.?A(p):B(p); return vec4(col.rgb*(.55+.45*abs(c)),col.a); }` },
    'Tiles Slide': { params: [s('n', 'Tiles High', 2, 30, 6)],
      glsl: `vec4 transition(vec2 uv){ vec2 N=vec2(floor(n*ratio+.5),n); vec2 g=floor(uv*N), q=fract(uv*N); float dl=hash(g)*.5; float lp=clamp((progress-dl)/.5,0.,1.); lp=1.-pow(1.-lp,3.);
        vec2 d=dirv(floor(hash(g*1.7)*4.)); vec2 qb=q+d*(1.-lp); return (qb.x>=0.&&qb.x<=1.&&qb.y>=0.&&qb.y<=1.)?Bc((g+qb)/N):A(uv); }` },
    'Checker Fade': { params: [s('n', 'Squares High', 2, 40, 8)],
      glsl: `vec4 transition(vec2 uv){ vec2 N=vec2(floor(n*ratio+.5),n); vec2 g=floor(uv*N); float odd=mod(g.x+g.y,2.); float m=odd<.5?clamp(progress*2.,0.,1.):clamp(progress*2.-1.,0.,1.); return mix(A(uv),B(uv),m); }` },
    'Hex Tiles': { params: [s('n', 'Size', 2, 40, 10), seed()],
      fns: `vec2 hexCell(vec2 p){ vec2 r=vec2(1.,1.7320508); vec2 h=r*.5; vec2 a=mod(p,r)-h, b=mod(p-h,r)-h; vec2 gv=dot(a,a)<dot(b,b)?a:b; return p-gv; }`,
      glsl: `vec4 transition(vec2 uv){ vec2 id=hexCell(vec2(uv.x*ratio,uv.y)*n); return hash(id+seed)<progress?B(uv):A(uv); }` },
    'Triangle Tiles': { params: [s('n', 'Size', 2, 40, 8), seed()],
      glsl: `vec4 transition(vec2 uv){ vec2 p=vec2(uv.x*ratio,uv.y)*n; p.x+=p.y*.57735; vec2 g=floor(p); float up=step(fract(p.x),fract(p.y)); return hash(vec2(g.x*2.+up,g.y)+seed)<progress?B(uv):A(uv); }` },
    'Stripes Slide': { params: [s('n', 'Stripes', 2, 40, 8)],
      glsl: `vec4 transition(vec2 uv){ float k=floor(uv.x*n); float sd=mod(k,2.)<.5?1.:-1.; float e=1.-pow(1.-progress,3.); vec2 pb=uv+vec2(0.,sd*(1.-e)); return inside(pb)?B(pb):A(uv); }` },
    'Bricks': { params: [s('n', 'Rows', 2, 30, 8), seed()],
      glsl: `vec4 transition(vec2 uv){ float row=floor(uv.y*n); float bx=floor(uv.x*n/ratio*.5+mod(row,2.)*.5); float dl=row/n*.55+hash(vec2(bx,row)+seed)*.15; float lp=clamp((progress-dl)/.3,0.,1.); return mix(A(uv),B(uv),smoothstep(0.,1.,lp)); }` },
    'Domino': { params: [s('n', 'Columns', 2, 40, 10)],
      glsl: `vec4 transition(vec2 uv){ float k=floor(uv.x*n); float dl=k/n*.6; float lp=clamp((progress-dl)/.4,0.,1.); float u=fract(uv.x*n); float h=cos(lp*PI*.5);
        if(uv.y>h) return B(uv); vec4 a=A(vec2((k+u)/n,uv.y/max(h,1e-4))); return vec4(a.rgb*(1.-.5*lp),a.a); }` },
  },
  'Liquid': {
    'Ripple': { params: [s('waves', 'Ripples', 1, 60, 20), amount(50, 'Strength'), center()],
      glsl: `vec4 transition(vec2 uv){ vec2 c=vec2(center.x,1.-center.y); vec2 q=vec2((uv.x-c.x)*ratio,uv.y-c.y); float r=length(q)+1e-5; float k=sin(r*waves*6.283-progress*30.)*bump()*amount*0.0006;
        vec2 p=uv+q/r*k*vec2(1./ratio,1.); return mix(Ac(p),Bc(p),xf(.3,.7)); }` },
    'Water Drop': { params: [center(), amount(50, 'Refraction')],
      glsl: `vec4 transition(vec2 uv){ vec2 c=vec2(center.x,1.-center.y); vec2 q=vec2((uv.x-c.x)*ratio,uv.y-c.y); float r=length(q)/maxR(c); float ring=exp(-pow((r-progress)*18.,2.));
        vec2 p=uv-q*ring*amount*0.002; return r<progress?Bc(p):Ac(p); }` },
    'Morph Look': { params: [amount(50, 'Warp')],
      glsl: `vec4 transition(vec2 uv){ vec2 e=vec2(2./u_res.x,0.), f=vec2(0.,2./u_res.y); vec2 ga=vec2(lum(Ac(uv+e).rgb)-lum(Ac(uv-e).rgb),lum(Ac(uv+f).rgb)-lum(Ac(uv-f).rgb));
        vec2 gb=vec2(lum(Bc(uv+e).rgb)-lum(Bc(uv-e).rgb),lum(Bc(uv+f).rgb)-lum(Bc(uv-f).rgb)); float k=amount*0.003; return mix(Ac(uv+gb*progress*k*4.),Bc(uv-ga*(1.-progress)*k*4.),xf(.2,.8)); }` },
    'Displacement': { params: [amount(50, 'Strength'), s('scale', 'Scale', 1, 40, 6), seed()],
      glsl: `vec4 transition(vec2 uv){ vec2 n=vec2(fbm(uv*scale+seed),fbm(uv*scale+seed+5.2))-.5; vec2 p=uv+n*bump()*amount*0.004; return mix(Ac(p),Bc(p),xf(.35,.65)); }` },
    'Melt': { params: [amount(60, 'Drips'), seed()],
      glsl: `vec4 transition(vec2 uv){ float col=floor(uv.x*u_res.x/6.); float sp=0.6+0.8*hash(vec2(col,seed))*amount/60.+0.15*noise(vec2(uv.x*30.,seed)); float off=progress*progress*sp*1.6; vec2 pa=uv+vec2(0.,off); return pa.y<=1.?A(pa):B(uv); }` },
    'Wave': { params: [s('waves', 'Waves', 1, 30, 6), amount(50, 'Height')],
      glsl: `vec4 transition(vec2 uv){ float k=bump()*amount*0.0012; vec2 p=uv+vec2(sin(uv.y*waves*6.283+progress*12.)*k,0.); return mix(Ac(p),Bc(p),xf(.3,.7)); }` },
    'Ink Bleed': { params: [s('scale', 'Detail', 1, 20, 4), col('color', 'Ink Edge', '#101010'), seed()],
      glsl: `vec4 transition(vec2 uv){ float n=fbm(vec2(uv.x*ratio,uv.y)*scale+seed)*.75+(1.-length(asp(uv))/maxR(vec2(.5)))*.25; float t=1.-progress; float m=smoothstep(t-.02,t+.02,n); float edge=exp(-pow((n-t)*40.,2.))*bump();
        vec4 c=mix(A(uv),B(uv),progress>=1.?1.:m); return vec4(mix(c.rgb,color,edge*.8),c.a); }` },
    'Oil Swirl': { params: [amount(50, 'Swirl'), s('scale', 'Scale', 1, 20, 3)],
      glsl: `vec4 transition(vec2 uv){ float a=fbm(uv*scale+progress)*6.283*bump()*amount/40.; vec2 p=uv+vec2(cos(a),sin(a))*bump()*0.03*amount/50.; float m=smoothstep(.0,.25,progress*1.25-fbm(uv*scale*.7+3.)*.25); return mix(Ac(p),Bc(p),m); }` },
    'Wind': { params: [dir(), s('size', 'Streaks', 0, 100, 30)],
      glsl: `vec4 transition(vec2 uv){ vec2 d=dirv(dir); vec2 t=vec2(abs(d.y),abs(d.x)); float r=hash(vec2(0.,floor(dot(uv,t)*u_res.y/2.))); float sz=size/100.; float x=along(uv,d); return mix(A(uv),B(uv),step(x*(1.-sz)+r*sz,progress)); }` },
    'Dreamy Wave': { params: [amount(50)],
      glsl: `vec4 transition(vec2 uv){ float k=bump()*amount*0.0008; vec2 p=uv+vec2(sin(uv.y*18.+progress*9.),cos(uv.x*14.+progress*7.))*k; return mix(bl(u_a,p,bump()*.008),bl(u_b,p,bump()*.008),xf(.25,.75)); }` },
  },
  'Film': {
    'Film Burn': { params: [s('scale', 'Detail', 1, 20, 5), col('color', 'Burn Color', '#ff7a1a'), seed()],
      glsl: `vec4 transition(vec2 uv){ float n=fbm(vec2(uv.x*ratio,uv.y)*scale+seed); float t=1.-progress*1.15+.0; float m=smoothstep(t-.01,t+.01,n+progress*.15); float ed=exp(-pow((n+progress*.15-t)*25.,2.));
        vec4 c=mix(A(uv),B(uv),m); vec3 r=c.rgb+color*ed*2.*bump()+vec3(1.,.9,.6)*ed*ed*bump(); return vec4(min(r,1.),c.a); }` },
    'Dip to Color': { params: [col('color', 'Color', '#1a1a1a'), s('hold', 'Hold (%)', 0, 80, 0)],
      glsl: `vec4 transition(vec2 uv){ float h=hold/200.; vec4 C=vec4(color,1.); if(progress<.5-h) return mix(A(uv),C,progress/(.5-h)); if(progress>.5+h) return mix(C,B(uv),(progress-.5-h)/(.5-h)); return C; }` },
    'Luma Fade': { params: [chk('invert', 'Dark Areas First'), soft(20)],
      glsl: `vec4 transition(vec2 uv){ float l=lum(A(uv).rgb); if(invert<.5) l=1.-l; return mix(A(uv),B(uv),wipeMask(l,soft/100.)); }` },
    'Film Roll': { params: [sel('way', 'Direction', ['Up', 'Down']), amount(40, 'Blur')],
      glsl: `vec4 transition(vec2 uv){ float sd=way<.5?1.:-1.; float e=smoothstep(0.,1.,progress)*1.06; vec4 a=vec4(0.); float b=bump()*amount*0.0012;
        for(int i=0;i<12;i++){ float y=uv.y-sd*e+sd*b*(float(i)/11.-.5); float k=floor(y/1.06); float fy=y-k*1.06; vec4 c=fy>1.?vec4(0.,0.,0.,1.):(abs(k)>0.5?Bc(vec2(uv.x,fy)):Ac(vec2(uv.x,fy))); a+=c; } return a/12.; }` },
    'Projector Flicker': { params: [amount(60, 'Flicker')],
      glsl: `vec4 transition(vec2 uv){ float t=floor(progress*30.); float f=1.+(hash(vec2(t,1.))-.5)*bump()*amount/60.; vec4 m=mix(A(uv),B(uv),xf(.35,.65)); return vec4(clamp(m.rgb*f,0.,1.),m.a); }` },
    'Gate Weave Dissolve': { params: [amount(50, 'Weave'), s('grain', 'Grain', 0, 100, 30)],
      glsl: `vec4 transition(vec2 uv){ float t=floor(progress*24.); vec2 j=(hash2(vec2(t,7.))-.5)*bump()*amount*0.0005; vec4 m=mix(Ac(uv+j),Bc(uv+j),xf(.2,.8)); float g=(hash(uv*u_res+t)-.5)*bump()*grain/250.; return vec4(clamp(m.rgb+g,0.,1.),m.a); }` },
    'Sepia Dissolve': { params: [amount(100, 'Sepia')],
      glsl: `vec4 transition(vec2 uv){ vec4 m=mix(A(uv),B(uv),xf(.3,.7)); float l=lum(m.rgb); vec3 sp=vec3(l*1.07+.03,l*.92+.02,l*.72); return vec4(mix(m.rgb,clamp(sp,0.,1.),bump()*amount/100.),m.a); }` },
    'Old Film Cut': { params: [amount(60, 'Damage'), seed()],
      glsl: `vec4 transition(vec2 uv){ float t=floor(progress*24.); vec4 m=progress<.5?A(uv):B(uv); float k=bump()*amount/60.; float sc=step(.997,hash(vec2(floor(uv.x*u_res.x/2.),t+seed)))*k; float dust=step(.9985,hash(floor(uv*u_res/3.)+t))*k;
        float l=lum(m.rgb); vec3 r=mix(m.rgb,vec3(l)*vec3(1.05,.95,.8),k*.6)*(1.-.15*k*hash(vec2(t,9.))); return vec4(clamp(r+sc*.6-dust*.6,0.,1.),m.a); }` },
    'Frame Slip': { params: [sel('way', 'Direction', ['Up', 'Down'])],
      glsl: `vec4 transition(vec2 uv){ float sd=way<.5?1.:-1.; float e=progress<.5?progress*2.*.35:1.-(1.-progress)*2.*.35; float y=uv.y+sd*e*1.1; y=y-floor(y/1.1)*1.1; if(y>1.) return vec4(0.,0.,0.,1.); return progress<.5?Ac(vec2(uv.x,y)):Bc(vec2(uv.x,y)); }` },
  },
  'Color': {
    'Color Fade': { params: [],
      glsl: `vec4 transition(vec2 uv){ vec4 m=mix(A(uv),B(uv),xf(.35,.65)); float l=lum(m.rgb); return vec4(mix(m.rgb,vec3(l),bump()),m.a); }` },
    'Hue Shift Dissolve': { params: [s('turns', 'Hue Rotation (deg)', -720, 720, 360)],
      glsl: `vec4 transition(vec2 uv){ vec4 m=mix(A(uv),B(uv),xf(.3,.7)); return vec4(clamp(hueRot(m.rgb,radians(turns)*bump()),0.,1.),m.a); }` },
    'Invert Flash': { params: [s('width', 'Duration', 5, 100, 25)],
      glsl: `vec4 transition(vec2 uv){ vec4 m=progress<.5?A(uv):B(uv); float f=step(abs(progress-.5),width/400.); return vec4(mix(m.rgb,1.-m.rgb,f),m.a); }` },
    'Multiply Dissolve': { params: [],
      glsl: `vec4 transition(vec2 uv){ vec4 a=A(uv), b=B(uv); vec3 mul=a.rgb*b.rgb; vec3 r=progress<.5?mix(a.rgb,mul,progress*2.):mix(mul,b.rgb,progress*2.-1.); return vec4(r,mix(a.a,b.a,progress)); }` },
    'Screen Dissolve': { params: [],
      glsl: `vec4 transition(vec2 uv){ vec4 a=A(uv), b=B(uv); vec3 sc=1.-(1.-a.rgb)*(1.-b.rgb); vec3 r=progress<.5?mix(a.rgb,sc,progress*2.):mix(sc,b.rgb,progress*2.-1.); return vec4(r,mix(a.a,b.a,progress)); }` },
    'Difference Flash': { params: [],
      glsl: `vec4 transition(vec2 uv){ vec4 a=A(uv), b=B(uv); vec3 df=abs(a.rgb-b.rgb); vec3 r=progress<.5?mix(a.rgb,df,progress*2.):mix(df,b.rgb,progress*2.-1.); return vec4(r,mix(a.a,b.a,progress)); }` },
    'Posterize Dissolve': { params: [s('levels', 'Fewest Levels', 2, 16, 3)],
      glsl: `vec4 transition(vec2 uv){ vec4 m=mix(A(uv),B(uv),xf(.4,.6)); float L=mix(64.,levels,bump()); return vec4(floor(m.rgb*L+.5)/L,m.a); }` },
    'Threshold Cut': { params: [s('level', 'Threshold', 0, 100, 50)],
      glsl: `vec4 transition(vec2 uv){ vec4 m=progress<.5?A(uv):B(uv); float t=step(level/100.,lum(m.rgb)); return vec4(mix(m.rgb,vec3(t),smoothstep(.2,.45,bump())),m.a); }` },
    'Duotone Dissolve': { params: [col('dark', 'Shadow Color', '#1b2a6b'), col('light', 'Highlight Color', '#ffb26b')],
      glsl: `vec4 transition(vec2 uv){ vec4 m=mix(A(uv),B(uv),xf(.35,.65)); vec3 d=mix(dark,light,lum(m.rgb)); return vec4(mix(m.rgb,d,bump()),m.a); }` },
  },
};

/** name -> { folder, params, glsl, fns } */
export const EXT_TRANSITIONS = Object.fromEntries(Object.entries(MORE_TRANSITIONS).flatMap(([folder, items]) => Object.entries(items).map(([name, d]) => [name, { folder, ...d }])));
export const extDefaults = (name) => Object.fromEntries((EXT_TRANSITIONS[name]?.params || []).map((p) => [p.id, p.def]));

/** fragment shader of one extended transition */
export function extTransitionFrag(def) {
  const uni = def.params.map((p) => `uniform ${p.type === 'point' ? 'vec2' : p.type === 'color' ? 'vec3' : 'float'} ${p.id};`).join('\n');
  return `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D u_a; uniform sampler2D u_b; uniform float progress; uniform vec2 u_res;
${uni}
${EXT_PRELUDE}
${def.fns || ''}
${def.glsl}
void main(){ ratio = u_res.x / u_res.y; o = progress <= 0. ? texture(u_a, uv) : progress >= 1. ? texture(u_b, uv) : transition(uv); }
`;
}
