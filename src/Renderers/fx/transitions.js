// Video transitions. One fragment shader, `tr(id, uv, p)`; p goes 0 (all A) -> 1 (all B). uv origin bottom-left.
export const VIDEO_TRANSITION_IDS = [
  'Cross Dissolve', 'Additive Dissolve', 'Dip to Black', 'Dip to White', 'Film Dissolve', 'Morph Cut', 'Non-Additive Dissolve',
  'Iris Box', 'Iris Cross', 'Iris Diamond', 'Iris Round', 'Iris Star',
  'Page Peel', 'Page Turn',
  'Band Slide', 'Center Merge', 'Push', 'Slide', 'Split',
  'Band Wipe', 'Barn Doors', 'Checker Wipe', 'Clock Wipe', 'Gradient Wipe', 'Linear Wipe', 'Radial Wipe', 'Venetian Blinds', 'Wedge Wipe', 'Zig-Zag Blocks',
  'Cross Zoom', 'Cube Spin', 'Flip Over',
];
export const transitionIndex = (name) => Math.max(0, VIDEO_TRANSITION_IDS.indexOf(name));
export const APPROX_TRANSITIONS = new Set([]);

export const TRANSITION_FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D u_a; uniform sampler2D u_b;
uniform sampler2D u_flow; uniform vec3 u_sim; uniform float u_useSim; uniform float u_p; uniform vec2 u_res; uniform int u_id;
const float PI = 3.14159265;
vec4 A(vec2 p){ return (p.x<0.||p.x>1.||p.y<0.||p.y>1.)?vec4(0.):texture(u_a,p); }
vec4 B(vec2 p){ return (p.x<0.||p.x>1.||p.y<0.||p.y>1.)?vec4(0.):texture(u_b,p); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float asp(){ return u_res.x/u_res.y; }

vec4 tr(int id, vec2 uv, float p){
  vec4 a=A(uv), b=B(uv);
  vec2 c=uv-0.5; vec2 ca=vec2(c.x*asp(),c.y);
  if(id==99){ vec2 fl=texture(u_flow,uv).xy; return vec4(fl*2.+0.5,0.,1.); }
  if(id==0) return mix(a,b,p);
  if(id==5 && u_useSim>0.5){ vec2 x=uv*vec2(asp(),1.); float s=1.+u_sim.x; vec2 tt=u_sim.yz; vec2 xa=(x-p*tt)/((1.-p)+p*s); vec2 xb=s*xa+tt; vec4 wa=texture(u_a,clamp(xa/vec2(asp(),1.),0.,1.)), wb=texture(u_b,clamp(xb/vec2(asp(),1.),0.,1.)); return mix(wa,wb,smoothstep(0.,1.,p)); }
  if(id==5){ vec2 fl=texture(u_flow,uv).xy; vec4 wa=texture(u_a,clamp(uv-p*fl,0.,1.)), wb=texture(u_b,clamp(uv+(1.-p)*fl,0.,1.)); return mix(wa,wb,smoothstep(0.,1.,p)); }
  if(id==1){ vec4 m=mix(a,b,p); return vec4(min(m.rgb+min(a.rgb,b.rgb)*sin(p*PI)*0.6,1.),m.a); }
  if(id==2) return p<0.5 ? mix(a,vec4(0.,0.,0.,1.),p*2.) : mix(vec4(0.,0.,0.,1.),b,(p-0.5)*2.);
  if(id==3) return p<0.5 ? mix(a,vec4(1.),p*2.) : mix(vec4(1.),b,(p-0.5)*2.);
  if(id==4){ vec3 l=mix(pow(a.rgb,vec3(2.2)),pow(b.rgb,vec3(2.2)),p); return vec4(pow(l,vec3(1./2.2)),mix(a.a,b.a,p)); }
  if(id==6) return vec4(max(a.rgb*(1.-p),b.rgb*p),mix(a.a,b.a,p));
  if(id>=7&&id<=11){
    float r=p*0.9; float d; vec2 q=abs(ca);
    if(id==7) d=max(q.x,q.y)*1.4;
    else if(id==8) d=min(min(q.x,q.y)*4.,max(q.x,q.y)*1.4);
    else if(id==9) d=(q.x+q.y)*1.2;
    else if(id==10) d=length(ca)*1.2;
    else { float an=atan(ca.y,ca.x); d=length(ca)*(1.+0.55*cos(5.*an))*0.9; }
    return d<r?b:a;
  }
  if(id==12||id==13){
    float R=(id==12)?0.07:0.12; float c0=1.-p*(1.+R*(PI+1.)); float x=uv.x;
    if(x>c0+R) return b;
    vec4 col=a;
    if(x>=c0){
      float th=asin(clamp((x-c0)/R,0.,1.));
      float sBack=PI*R-R*th, sFront=R*th;
      if(c0+sBack<=1.){ vec4 bk=A(vec2(c0+sBack,uv.y)); return vec4(mix(bk.rgb,vec3(0.92),0.35)*(0.75+0.25*cos(th)),bk.a); }
      vec4 fr=A(vec2(c0+sFront,uv.y)); return vec4(fr.rgb*(0.55+0.45*cos(th)),fr.a);
    }
    float sh=smoothstep(c0-0.08,c0,x); col.rgb*=1.-0.35*sh; return col;
  }  if(id==14){ float band=floor(uv.y*8.); float dir=mod(band,2.)<0.5?1.:-1.; vec2 q=vec2(uv.x-dir*(1.-p),uv.y); float inside=(q.x>=0.&&q.x<=1.)?1.:0.; return mix(a,B(q),inside); }
  if(id==15){ vec2 sgn=sign(c); vec2 q=uv-sgn*(1.-p)*0.5; bool ok=(q.x>=0.&&q.x<=1.&&q.y>=0.&&q.y<=1.&&sign(q-0.5)==sgn); return ok?B(q):a; }
  if(id==16) return uv.x<1.-p ? A(uv+vec2(p,0.)) : B(uv-vec2(1.-p,0.));
  if(id==17) return uv.x>=1.-p ? B(uv-vec2(1.-p,0.)) : a;
  if(id==18){ float h=p*0.5; return abs(uv.x-0.5)<h ? b : (uv.x<0.5 ? A(uv+vec2(h,0.)) : A(uv-vec2(h,0.))); }
  if(id==19){ float band=floor(uv.y*10.); float lp=clamp(p*1.4-hash(vec2(band,1.))*0.4,0.,1.); return uv.x<lp?b:a; }
  if(id==20) return abs(uv.x-0.5)<p*0.5?b:a;
  if(id==21){ vec2 g=floor(uv*vec2(10.*asp()/1.78,10.)); float k=mod(g.x+g.y,2.); return uv.x<p*1.25-(k<0.5?0.:0.12)?b:a; }
  if(id==22){ float an=atan(c.x,c.y); if(an<0.) an+=2.*PI; return an<p*2.*PI?b:a; }
  if(id==23){ float g=(uv.x*0.6+(1.-uv.y)*0.4)+(hash(floor(uv*40.))-0.5)*0.12; return g<p*1.2-0.1?b:a; }
  if(id==24) return uv.x<p?b:a;
  if(id==25){ float an=atan(uv.x,1.-uv.y); return an<p*PI*0.5?b:a; }
  if(id==26) return fract(uv.y*8.)<p?b:a;
  if(id==27){ float an=atan(c.x,c.y); if(an<0.) an+=2.*PI; float hw=p*PI; return (an<hw||an>2.*PI-hw)?b:a; }
  if(id==28){ float zz=abs(fract(uv.y*8.)-0.5)*0.12; return uv.x<p*1.2+zz-0.1?b:a; }
  if(id==29){
    vec4 sa=vec4(0.), sb=vec4(0.);
    for(int i=0;i<16;i++){ float f=float(i)/15.; sa+=A(0.5+c/(1.+p*f*1.5)); sb+=B(0.5+c*(1.+(1.-p)*(1.-f)*1.5)); }
    return mix(sa/16.,sb/16.,smoothstep(0.3,0.7,p));
  }
  if(id==30||id==31){
    float h=asp()*0.5; float D=h+1.8; float f=1.8;
    vec3 ro=vec3(0.,0.,-D); vec3 rd=normalize(vec3(ca,f));
    float phi=(id==30)?p*PI*0.5:p*PI; float cs=cos(phi), sn=sin(phi);
    vec3 o2=vec3(ro.x*cs-ro.z*sn, ro.y, ro.x*sn+ro.z*cs); vec3 d2=vec3(rd.x*cs-rd.z*sn, rd.y, rd.x*sn+rd.z*cs);
    if(id==30){
      vec3 bmin=vec3(-h,-0.5,-h), bmax=vec3(h,0.5,h);
      vec3 inv=1./d2; vec3 t0=(bmin-o2)*inv, t1=(bmax-o2)*inv; vec3 tmn=min(t0,t1), tmx=max(t0,t1);
      float tn=max(max(tmn.x,tmn.y),tmn.z), tf=min(min(tmx.x,tmx.y),tmx.z);
      if(tf<0.||tn>tf) return vec4(0.,0.,0.,1.);
      vec3 hit=o2+d2*tn; vec4 col; float shade;
      bool zf=tmn.z>=tmn.x;
      if(zf && d2.z>0.){ col=A(vec2((hit.x+h)/(2.*h),hit.y+0.5)); shade=0.85+0.15*cs; }
      else if(!zf && d2.x<0.){ col=B(vec2((hit.z+h)/(2.*h),hit.y+0.5)); shade=0.6+0.4*sn; }
      else return vec4(0.05,0.05,0.05,1.);
      return vec4(col.rgb*shade,1.);
    }
    if(abs(d2.z)<1e-5) return vec4(0.,0.,0.,1.);
    float tt=-o2.z/d2.z; if(tt<0.) return vec4(0.,0.,0.,1.);
    vec3 hit=o2+d2*tt; if(abs(hit.x)>h||abs(hit.y)>0.5) return vec4(0.,0.,0.,1.);
    float u=(hit.x+h)/(2.*h), v=hit.y+0.5; vec4 col=(p<0.5)?A(vec2(u,v)):B(vec2(1.-u,v));
    return vec4(col.rgb*(0.55+0.45*abs(cs)),1.);
  }  return mix(a,b,p);
}
void main(){ o=tr(u_id, uv, u_p); }
`;

// Morph Cut flow. Level 0: coarse block matching (80x45) centred on a landmark-derived global similarity (handles big jumps).
// Level 1: refinement + a face-landmark field evaluated at the *intermediate* landmark positions for the current progress p.
const FLOW_HEAD = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D u_a; uniform sampler2D u_b; uniform vec2 u_res;
float cost(vec2 p, vec2 d, float sp){
  float s=0.;
  for(int ky=-2;ky<=2;ky++) for(int kx=-2;kx<=2;kx++){ vec2 k=vec2(kx,ky)*sp/u_res; s+=dot(abs(texture(u_a,clamp(p+k,0.,1.)).rgb-texture(u_b,clamp(p+k+d/u_res,0.,1.)).rgb),vec3(1.)); }
  return s;
}`;
export const FLOW_COARSE_FRAG = FLOW_HEAD + `
uniform vec3 u_sim; // (scale-1, tx, ty) of the similarity A->B in aspect-corrected uv
void main(){
  float asp=u_res.x/u_res.y; vec2 x=uv*vec2(asp,1.); vec2 d0=(u_sim.x*x+u_sim.yz)/vec2(asp,1.)*u_res;
  float best=cost(uv,d0,8.)*0.7; vec2 bd=d0;
  for(int dy=-8;dy<=8;dy++) for(int dx=-8;dx<=8;dx++){ vec2 d=d0+vec2(dx,dy)*6.; float c=cost(uv,d,8.)+length(d-d0)*0.03; if(c<best){ best=c; bd=d; } }
  o=vec4(bd/u_res,0.,1.);
}`;
export const FLOW_FINE_FRAG = FLOW_HEAD + `
uniform sampler2D u_prev; uniform sampler2D u_lmA; uniform sampler2D u_lmB; uniform float u_hasLm; uniform int u_nLm; uniform float u_p;
void main(){
  vec2 d0=texture(u_prev,uv).xy*u_res; float best=cost(uv,d0,3.)*0.8; vec2 bd=d0;
  for(int dy=-3;dy<=3;dy++) for(int dx=-3;dx<=3;dx++){ vec2 d=d0+vec2(dx,dy)*2.; float c=cost(uv,d,3.)+length(d-d0)*0.03; if(c<best){ best=c; bd=d; } }
  vec2 f=bd/u_res;
  o=vec4(f,0.,1.);
}`;export const FLOW_SMOOTH_FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o; uniform sampler2D u_tex; uniform vec2 u_px;
void main(){ vec2 s=vec2(0.); float w=0.; for(int y=-2;y<=2;y++) for(int x=-2;x<=2;x++){ float k=exp(-float(x*x+y*y)/4.5); s+=texture(u_tex,uv+vec2(x,y)*u_px).xy*k; w+=k; } o=vec4(s/w,0.,1.); }`;
