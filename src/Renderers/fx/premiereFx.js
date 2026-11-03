// Effects rebuilt to follow Premiere Pro / After Effects (Phase 5C1). Same shape as VIDEO_FX entries, plus:
//   layer: '<trackSel param id>'  -> the chosen video track is bound as u_layer, read with L(p); u_hasLayer = 0 when None
//   src: true                     -> the effect's input stays readable in every pass as SRC(p) (passes otherwise only see the previous pass)
//   fns: GLSL                     -> helper functions placed before main()
//   custom: 'equalize' | 'paintBucket' -> handled by the compositor (needs a histogram / a CPU flood fill)
// Legacy param ids are kept where the meaning is the same, so old projects keep their values.
import { s, sel, chk, pt, col, trk, SC } from './fxParams';

const BLEND = ['Normal', 'Darken', 'Multiply', 'Color Burn', 'Lighten', 'Screen', 'Color Dodge', 'Overlay', 'Soft Light', 'Hard Light', 'Difference', 'Exclusion', 'Linear Dodge (Add)'];
const LAYOUT = () => sel('frameLayout', 'Frame Layout', ['Monoscopic', 'Stereoscopic - Over/Under', 'Stereoscopic - Side by Side']);
const CHANNELS = ['RGB', 'Red', 'Green', 'Blue', 'Gray', 'Alpha'];
const chan = (v, k) => `(${k}<0.5?${v}.rgb:${k}<1.5?vec3(${v}.r):${k}<2.5?vec3(${v}.g):${k}<3.5?vec3(${v}.b):${k}<4.5?vec3(luma(${v}.rgb)):vec3(${v}.a))`;
// two separable blur passes of the alpha (outside the frame counts as transparent) -> a soft ramp across every edge; the last pass shades
const alphaRamp = (radius, last) => `float R=${radius}; if(u_pass<1.5){ vec2 d=u_pass<0.5?vec2(1./u_res.x,0.):vec2(0.,1./u_res.y); float a=0.,w=0.; for(int i=-12;i<=12;i++){ float f=float(i)/12.; float k=exp(-f*f*2.5); a+=SZ(uv+d*f*R).a*k; w+=k; } o=vec4(a/w); return; } ${last}`;

// ---------------- Lighting Effects: five lights (Directional / Omni / Spotlight), ambience, surface, bump layer ----------------
const LIGHT_TYPES = ['None', 'Directional', 'Omni', 'Spotlight'];
const lid = (i, k, legacy) => (i === 1 && legacy ? legacy : `l${i}${k}`);
const lightParams = [];
for (let i = 1; i <= 5; i++) {
  lightParams.push(
    sel(`l${i}type`, `Light ${i}: Light Type`, LIGHT_TYPES, i === 1 ? 3 : 0),
    s(lid(i, 'int', 'intensity'), `Light ${i}: Intensity`, -100, 100, i === 1 ? 35 : 20),
    col(`l${i}col`, `Light ${i}: Light Color`, '#ffffff'),
    pt(lid(i, 'center', 'light'), `Light ${i}: Center`, 0.5, i === 1 ? 0.4 : 0.5),
    s(lid(i, 'major', 'radius'), `Light ${i}: Major Radius`, 0, 100, i === 1 ? 60 : 20),
    s(`l${i}minor`, `Light ${i}: Minor Radius`, 0, 100, i === 1 ? 60 : 20),
    s(`l${i}angle`, `Light ${i}: Angle`, -360, 360, 0),
    s(`l${i}focus`, `Light ${i}: Focus`, -100, 100, 50));
}
const LIGHT_FN = `
vec3 lit(float ty,float inten,vec3 lc,vec2 cen,float maj,float mnr,float ang,float foc,vec3 N,vec3 base,inout vec3 spec){
  if(ty<0.5) return vec3(0.);
  vec2 asp=vec2(u_res.x/u_res.y,1.); vec2 P=uv*asp, C=vec2(cen.x,1.-cen.y)*asp; float rM=max(maj,0.1)/100.*asp.x, rm=max(mnr,0.1)/100.*asp.x;
  vec2 d=P-C; float foot=1.; vec3 Lv;
  if(ty<1.5) Lv=normalize(vec3(C-0.5*asp,max(rM,0.05)));
  else { Lv=normalize(vec3(C-P,rM));
    if(ty<2.5) foot=1./(1.+dot(d,d)/(rM*rM));
    else { float a=radians(ang); vec2 q=vec2(d.x*cos(a)+d.y*sin(a),-d.x*sin(a)+d.y*cos(a)); float e=length(q/vec2(rM,rm)); float hard=clamp((foc+100.)/200.,0.,0.98); foot=1.-smoothstep(hard,1.,e); } }
  float k=inten/33.*foot; float df=max(dot(N,Lv),0.);
  vec3 H=normalize(Lv+vec3(0.,0.,1.)); spec+=mix(lc,base,clamp((material+100.)/200.,0.,1.))*pow(max(dot(N,H),0.),24.)*clamp((gloss+100.)/200.,0.,1.)*k;
  return lc*df*k; }
float bh(vec2 p){ vec4 t=L(p); float v=bumpCh<0.5?t.r:bumpCh<1.5?t.g:bumpCh<2.5?t.b:t.a; return white>0.5?v:1.-v; }`;
const LIGHT_BODY = `vec4 c=S(uv); vec3 N=vec3(0.,0.,1.);
  if(u_hasLayer>0.5){ vec2 px=1./u_res; float hx=bh(uv+vec2(px.x,0.))-bh(uv-vec2(px.x,0.)), hy=bh(uv+vec2(0.,px.y))-bh(uv-vec2(0.,px.y)); N=normalize(vec3(-hx*bumpH*2.,-hy*bumpH*2.,1.)); }
  vec3 sp=vec3(0.); vec3 li=ambCol*ambient/100.;
  ${[1, 2, 3, 4, 5].map((i) => `li+=lit(l${i}type,${lid(i, 'int', 'intensity')},l${i}col,${lid(i, 'center', 'light')},${lid(i, 'major', 'radius')},l${i}minor,l${i}angle,l${i}focus,N,c.rgb,sp);`).join('\n  ')}
  o=vec4(clamp((c.rgb*li+sp)*exp2(exposure/50.),0.,1.),c.a);`;

// ---------------- Lightning ----------------
const LIGHTNING_FN = `
vec2 lbp(vec2 A,vec2 B,float t,float f0,float sd,float tm,float fx){
  vec2 ab=B-A; vec2 n=vec2(-ab.y,ab.x); float d=0., a=1., f=f0;
  for(int k=0;k<4;k++){ if(float(k)>detail) break; d+=(noise2(vec2(t*f+sd*13.17,tm*(1.+float(k))+float(k)*7.31+sd*3.1))-0.5)*a; a*=detailAmp; f*=2.; }
  float env=fx>0.5?sin(3.14159*t):min(1.,t*6.);
  return A+ab*t+n*d*amp/50.*env; }
float lseg(vec2 p,vec2 a,vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-9),0.,1.); return length(pa-ba*h); }
float lpath(vec2 P,vec2 A,vec2 B,float nseg,float sd,float tm,float fx,int N){
  float d=1e9; vec2 pr=A; for(int i=1;i<=48;i++){ if(i>N) break; vec2 q=lbp(A,B,float(i)/float(N),nseg,sd,tm,fx); d=min(d,lseg(P,pr,q)); pr=q; } return d; }`;
const LIGHTNING_BODY = `vec4 c=S(uv); vec2 asp=vec2(u_res.x/u_res.y,1.); vec2 P=uv*asp; vec2 A=vec2(start.x,1.-start.y)*asp, B=vec2(end.x,1.-end.y)*asp;
  float tm=u_time*speed/10.; vec2 ab=B-A;
  int N=int(clamp(segments*pow(2.,detail),2.,48.));
  float dn=lpath(P,A,B,segments,seed,tm,fixedEnd,N);
  for(int b=0;b<6;b++){ float fb=float(b); if(hash(vec2(fb*7.7+seed,3.3))*100.>=branching) continue;
    float tb=(fb+0.25+0.5*hash(vec2(fb,seed+1.)))/6.; vec2 B0=lbp(A,B,tb,segments,seed,tm,fixedEnd);
    float an=radians(branchAngle)*(hash(vec2(fb,seed+2.))>0.5?1.:-1.); vec2 dir=vec2(ab.x*cos(an)-ab.y*sin(an),ab.x*sin(an)+ab.y*cos(an));
    vec2 E=B0+dir*(1.-tb)*branchLen/100.;
    dn=min(dn,lpath(P,B0,E,max(segments*0.5,2.),seed+fb*5.1+1.,tm,0.,16)/max(branchWidth/100.,0.01)); }
  float dpx=dn*u_res.y/(${SC}); float w=max(width,0.5)*(1.+(noise2(P*6.+tm)-0.5)*widthVar*2.);
  float cr=w*core; float inner=1.-smoothstep(cr,cr+1.,dpx); float glow=exp(-max(dpx-cr,0.)/(w*0.6));
  vec3 lc=mix(color*glow,inside,inner); float a=max(inner,glow);
  vec3 r=blendM<0.5?mix(c.rgb,lc/max(a,1e-4),a):blendM<1.5?c.rgb+lc:1.-(1.-c.rgb)*(1.-lc);
  o=vec4(clamp(r,0.,1.),max(c.a,a));`;

// ---------------- VR (equirectangular) ----------------
const VR_EYE = `vec4 E=vrEye(frameLayout); vec2 q=(uv-E.zw)/E.xy;`;

export const PRO_FX = {
  'Lighting Effects': {
    layer: 'bump',
    params: [...lightParams, col('ambCol', 'Ambience Light Color', '#ffffff'), s('ambient', 'Ambience Light Intensity', -100, 100, 20),
      s('gloss', 'Surface Gloss', -100, 100, 0), s('material', 'Surface Material', -100, 100, 0), s('exposure', 'Exposure', -100, 100, 0),
      trk('bump', 'Bump Layer'), sel('bumpCh', 'Bump Channel', ['R', 'G', 'B', 'A']), s('bumpH', 'Bump Height', -100, 100, 1), chk('white', 'White is High', true)],
    fns: LIGHT_FN, body: LIGHT_BODY,
  },
  'Compound Blur': {
    layer: 'layer', src: true, passes: 2,
    params: [trk('layer', 'Blur Layer'), s('max', 'Maximum Blur', 0, 100, 20), chk('invert', 'Invert Blur')],
    body: `vec4 m4=u_hasLayer>0.5?L(uv):SRC(uv); float m=luma(m4.rgb); if(invert>0.5) m=1.-m; o=blurDir(u_pass<0.5?vec2(1./u_res.x,0.):vec2(0.,1./u_res.y), max*m*${SC});`,
  },
  'Arithmetic': {
    // the first four keep their old indices (Add/Subtract/Multiply/Difference); the rest follow After Effects' list
    params: [sel('op', 'Operator', ['Add', 'Subtract', 'Multiply', 'Difference', 'And', 'Or', 'Xor', 'Min', 'Max', 'Block Above', 'Block Below', 'Slice', 'Screen']),
      s('r', 'Red Value', 0, 255, 0), s('g', 'Green Value', 0, 255, 0), s('b', 'Blue Value', 0, 255, 0), chk('clipRes', 'Clip Result Values', true)],
    body: `vec4 c=S(uv); ivec3 a=ivec3(floor(c.rgb*255.+0.5)); ivec3 v=ivec3(int(r+0.5),int(g+0.5),int(b+0.5)); int k=int(op+0.5); ivec3 x;
  if(k==0) x=a+v; else if(k==1) x=a-v; else if(k==2) x=a*v/255; else if(k==3) x=abs(a-v); else if(k==4) x=a&v; else if(k==5) x=a|v; else if(k==6) x=a^v;
  else if(k==7) x=min(a,v); else if(k==8) x=max(a,v); else if(k==9) x=a*ivec3(lessThanEqual(a,v)); else if(k==10) x=a*ivec3(greaterThanEqual(a,v));
  else if(k==11) x=ivec3(greaterThanEqual(a,v))*255; else x=255-(255-a)*(255-v)/255;
  x=clipRes>0.5?clamp(x,0,255):(x&255); o=vec4(vec3(x)/255.,c.a);`,
  },
  'Blend': {
    layer: 'layer',
    params: [trk('layer', 'Blend With Layer'), sel('mode', 'Mode', ['Crossfade', 'Color Only', 'Tint Only', 'Darken Only', 'Lighten Only']), s('amount', 'Blend With Original', 0, 100, 0)],
    body: `vec4 c=S(uv); if(u_hasLayer<0.5){ o=c; return; } vec4 l=L(uv); vec3 r; float a=c.a;
  vec3 hc=rgb2hsv(c.rgb), hl=rgb2hsv(l.rgb);
  if(mode<0.5){ r=mix(c.rgb,l.rgb,l.a); a=mix(c.a,l.a,1.-amount/100.); }
  else if(mode<1.5) r=mix(c.rgb,hsv2rgb(vec3(hl.x,hl.y,hc.z)),l.a);
  else if(mode<2.5) r=mix(c.rgb,hsv2rgb(vec3(hl.x,hl.y,hc.z)),l.a*smoothstep(0.02,0.15,hc.y));
  else if(mode<3.5) r=mix(c.rgb,min(c.rgb,l.rgb),l.a); else r=mix(c.rgb,max(c.rgb,l.rgb),l.a);
  o=vec4(mix(r,c.rgb,amount/100.),a);`,
  },
  'Calculations': {
    layer: 'layer',
    params: [sel('ch', 'Input Channel', CHANNELS), chk('invert', 'Invert Input'), trk('layer', 'Second Layer'), sel('ch2', 'Second Layer Channel', CHANNELS),
      s('op2', 'Second Layer Opacity', 0, 100, 100), chk('inv2', 'Invert Second Layer'), sel('mode', 'Blending Mode', BLEND), chk('keepA', 'Preserve Transparency')],
    body: `vec4 c=S(uv); vec3 a=${chan('c', 'ch')}; if(invert>0.5) a=1.-a; vec3 r=a; float al=c.a;
  if(u_hasLayer>0.5){ vec4 l=L(uv); vec3 b=${chan('l', 'ch2')}; if(inv2>0.5) b=1.-b; float w=l.a*op2/100.; r=mix(a,bm(a,b,mode),w); if(keepA<0.5) al=max(c.a,w); }
  o=vec4(clamp(r,0.,1.),al);`,
  },
  'Equalize': {
    custom: 'equalize',
    params: [sel('style', 'Equalize', ['RGB', 'Brightness', 'Photoshop Style']), s('amount', 'Amount to Equalize', 0, 100, 50)], body: 'o=S(uv);',
  },
  'Turbulent Displace': {
    params: [sel('type', 'Displacement', ['Turbulent', 'Bulge', 'Twist', 'Turbulent Smoother', 'Bulge Smoother', 'Twist Smoother', 'Vertical Displacement', 'Horizontal Displacement', 'Cross Displacement']),
      s('amount', 'Amount', -500, 500, 50), s('size', 'Size', 2, 1000, 100), pt('offset', 'Offset (Turbulence)', 0.5, 0.5), s('complexity', 'Complexity', 1, 10, 1, 0.1),
      s('evo', 'Evolution', -3600, 3600, 0), sel('pin', 'Pinning', ['None', 'Pin All Corners', 'Pin All Edges', 'Pin All'])],
    body: `vec2 asp=vec2(u_res.x/u_res.y,1.); float sz=max(size,1.)*${SC}/u_res.y; vec2 P=(uv-vec2(offset.x,1.-offset.y))*asp/sz;
  float e=radians(evo); P+=vec2(cos(e),sin(e))*0.8+vec2(e*0.05);
  float smooth_=type>2.5&&type<5.5?0.35:0.55; float t=mod(type,3.); vec2 d;
  if(type>5.5){ float n=fbm(P,complexity,smooth_)-0.5; d=type<6.5?vec2(0.,n):type<7.5?vec2(n,0.):vec2(n); }
  else if(t<0.5) d=vec2(fbm(P,complexity,smooth_),fbm(P+31.4,complexity,smooth_))-0.5;
  else { float h=0.05; float n=fbm(P,complexity,smooth_); vec2 g=vec2(fbm(P+vec2(h,0.),complexity,smooth_)-n,fbm(P+vec2(0.,h),complexity,smooth_)-n)/h*0.12; d=t<1.5?-g:vec2(-g.y,g.x); }
  float w=1.; vec2 m=min(uv,1.-uv);
  if(pin>0.5&&pin<1.5) w=clamp(min(min(length(uv),length(uv-vec2(1.,0.))),min(length(uv-vec2(0.,1.)),length(uv-1.)))*4.,0.,1.);
  else if(pin>1.5) w=clamp(min(m.x,m.y)*8.,0.,1.);
  o=S(uv-d*amount*2.*${SC}/u_res*w);`,
  },
  'Lightning': {
    params: [pt('start', 'Start Point', 0.2, 0.5), pt('end', 'End Point', 0.8, 0.5), s('segments', 'Segments', 1, 32, 7, 1), s('amp', 'Amplitude', 0, 100, 10),
      s('detail', 'Detail Level', 0, 3, 2, 1), s('detailAmp', 'Detail Amplitude', 0, 1, 0.3), s('branching', 'Branching', 0, 100, 30), s('branchAngle', 'Branch Angle', -90, 90, 20),
      s('branchLen', 'Branch Seg. Length', 0, 100, 50), s('branchWidth', 'Branch Width', 0, 100, 70), s('speed', 'Speed', 0, 100, 10), chk('fixedEnd', 'Fixed Endpoint', true),
      s('width', 'Width', 1, 50, 6), s('widthVar', 'Width Variation', 0, 1, 0), s('core', 'Core Width', 0, 1, 0.4), col('color', 'Outside Color', '#7fb0ff'), col('inside', 'Inside Color', '#ffffff'),
      s('seed', 'Random Seed', 0, 1000, 0, 1), sel('blendM', 'Blending Mode', ['Normal', 'Add', 'Screen'], 1)],
    fns: LIGHTNING_FN, body: LIGHTNING_BODY,
  },
  'Paint Bucket': {
    custom: 'paintBucket',
    params: [pt('fillPt', 'Fill Point', 0.5, 0.5), sel('selector', 'Fill Selector', ['Color & Alpha', 'Straight Color', 'Transparency', 'Opacity', 'Alpha Channel']),
      s('tol', 'Tolerance', 0, 255, 10), chk('view', 'View Threshold'), sel('stroke', 'Stroke', ['Antialias', 'Feather', 'Spread', 'Choke']),
      s('feather', 'Feather Softness', 0, 50, 10), s('spread', 'Spread Width', 0, 50, 3), s('choke', 'Choke Width', 0, 50, 3), chk('invert', 'Invert Fill'),
      col('fill', 'Color', '#ff0000'), s('opacity', 'Opacity', 0, 100, 100), sel('mode', 'Blending Mode', ['Normal', 'Add', 'Multiply', 'Screen', 'Overlay', 'Behind Original', 'Fill Only'])],
    body: 'o=S(uv);',
  },
  'VR Chromatic Aberrations': {
    params: [s('amount', 'Chromatic Aberration (Red)', -100, 100, 10), s('ag', 'Chromatic Aberration (Green)', -100, 100, 0), s('ab', 'Chromatic Aberration (Blue)', -100, 100, -10),
      pt('center', 'Center Point', 0.5, 0.5), s('falloff', 'Falloff Distance', 1, 100, 50), chk('inverse', 'Inverse Falloff'), LAYOUT()],
    fns: `vec3 vrTurn(vec3 C,vec3 ax,float th){ return C*cos(th)+ax*sin(th); }`,
    body: `${VR_EYE} vec3 d=vrDir(q), C=vrDir(vec2(center.x,1.-center.y)); float cs=clamp(dot(d,C),-1.,1.); float th=acos(cs); vec3 ax=d-C*cs; float al=length(ax); ax=al>1e-5?ax/al:vec3(0.);
  float f=smoothstep(0.,max(falloff,1.)/100.,th/3.14159); if(inverse>0.5) f=1.-f;
  float rr=vrS(E,vrUV(vrTurn(C,ax,th*(1.+amount/500.*f)))).r, gg=vrS(E,vrUV(vrTurn(C,ax,th*(1.+ag/500.*f)))).g, bb=vrS(E,vrUV(vrTurn(C,ax,th*(1.+ab/500.*f)))).b;
  o=vec4(rr,gg,bb,vrS(E,q).a);`,
  },
  'VR Color Gradients': {
    params: [pt('p1', 'Point 1', 0.15, 0.3), col('c1', 'Color 1', '#ff3366'), pt('p2', 'Point 2', 0.4, 0.7), col('c2', 'Color 2', '#3366ff'), pt('p3', 'Point 3', 0.65, 0.3), col('c3', 'Color 3', '#ffcc33'),
      pt('p4', 'Point 4', 0.9, 0.7), col('c4', 'Color 4', '#33cc99'), s('blend', 'Blend', 0, 100, 40), s('opacity', 'Opacity', 0, 100, 100), sel('mode', 'Blending Mode', BLEND), LAYOUT()],
    body: `${VR_EYE} vec3 d=vrDir(q); float pw=mix(6.,1.,blend/100.); vec3 acc=vec3(0.); float ws=0.;
  vec2 P[4]; P[0]=p1; P[1]=p2; P[2]=p3; P[3]=p4; vec3 K[4]; K[0]=c1; K[1]=c2; K[2]=c3; K[3]=c4;
  for(int i=0;i<4;i++){ float th=acos(clamp(dot(d,vrDir(vec2(P[i].x,1.-P[i].y))),-1.,1.)); float w=1./pow(th+1e-3,pw); acc+=K[i]*w; ws+=w; }
  vec4 c=S(uv); vec3 g=acc/ws; o=vec4(mix(c.rgb,bm(c.rgb,g,mode),opacity/100.),c.a);`,
  },
  'VR De-Noise': {
    params: [s('amount', 'Noise Level', 0, 100, 30), LAYOUT()],
    body: `${VR_EYE} float lat=(q.y-.5)*3.14159; vec2 px=vec2(1./max(cos(lat),0.05),1.)/(u_res*E.xy)*(1.+amount/25.); vec4 c=vrS(E,q);
  float sg=0.02+amount/250.; vec4 a=vec4(0.); float w=0.;
  for(int j=-3;j<=3;j++) for(int i=-3;i<=3;i++){ vec4 t=vrS(E,q+vec2(i,j)*px); vec3 dd=t.rgb-c.rgb; float k=exp(-float(i*i+j*j)/8.)*exp(-dot(dd,dd)/(2.*sg*sg)); a+=t*k; w+=k; }
  o=amount<=0.?c:a/w;`,
  },
  'VR Glow': {
    src: true, passes: 2,
    params: [s('thresh', 'Luminance Threshold', 0, 100, 70), s('radius', 'Glow Radius', 0, 200, 40), s('intensity', 'Glow Brightness', 0, 400, 100), s('sat', 'Glow Saturation', 0, 200, 100),
      chk('useTint', 'Use Tint Color'), col('tint', 'Tint Color', '#ffffff'), LAYOUT()],
    body: `${VR_EYE} float lat=(q.y-.5)*3.14159; vec2 px=1./(u_res*E.xy); float R=radius*${SC}; vec3 a=vec3(0.); float w=0.;
  if(u_pass<0.5){ vec2 d=vec2(px.x/max(cos(lat),0.05),0.); for(int i=-16;i<=16;i++){ float f=float(i)/16.; float k=exp(-f*f*3.); vec4 t=vrS(E,q+d*f*R); a+=t.rgb*t.a*smoothstep(thresh/100.,1.,luma(t.rgb))*k; w+=k; } o=vec4(a/w,1.); return; }
  for(int i=-16;i<=16;i++){ float f=float(i)/16.; float k=exp(-f*f*3.); a+=vrS(E,q+vec2(0.,px.y)*f*R).rgb*k; w+=k; } a/=w;
  vec3 h=rgb2hsv(max(a,0.)); h.y=clamp(h.y*sat/100.,0.,1.); a=hsv2rgb(h); if(useTint>0.5) a=luma(a)*tint;
  vec4 c=SRC(uv); o=vec4(clamp(c.rgb+a*intensity/50.,0.,1.),max(c.a,clamp(luma(a),0.,1.)));`,
  },
  'VR Plane to Sphere': {
    params: [s('fov', 'Scale (Degrees)', 1, 179, 90), s('rotY', 'Pan (Y Axis)', -180, 180, 0), s('rotX', 'Tilt (X Axis)', -90, 90, 0), s('roll', 'Roll (Z Axis)', -180, 180, 0),
      s('feather', 'Feather', 0, 100, 0), LAYOUT()],
    body: `${VR_EYE} vec3 d=vrDir(q); float ry=radians(rotY), rx=radians(rotX), rz=radians(roll);
  d=vec3(d.x*cos(ry)-d.z*sin(ry),d.y,d.x*sin(ry)+d.z*cos(ry));
  d=vec3(d.x,d.y*cos(rx)-d.z*sin(rx),d.y*sin(rx)+d.z*cos(rx));
  d=vec3(d.x*cos(rz)+d.y*sin(rz),-d.x*sin(rz)+d.y*cos(rz),d.z);
  if(d.z<=1e-4){ o=vec4(0.); return; }
  float hw=tan(radians(fov)*.5); float ar=(u_res.x*E.x)/(u_res.y*E.y); vec2 st=vec2(d.x/d.z/hw,d.y/d.z/(hw/ar))*.5+.5;
  if(st.x<0.||st.x>1.||st.y<0.||st.y>1.){ o=vec4(0.); return; }
  float m=smoothstep(0.,feather/200.+1e-4,min(min(st.x,1.-st.x),min(st.y,1.-st.y))); vec4 c=S(E.zw+st*E.xy); o=vec4(c.rgb,c.a*m);`,
  },
  'Difference Matte': {
    layer: 'layer',
    params: [sel('view', 'View', ['Final Output', 'Source Only', 'Matte Only']), trk('layer', 'Difference Layer'), s('tol', 'Matching Tolerance', 0, 100, 15), s('soft', 'Matching Softness', 0, 100, 0),
      s('blur', 'Blur Before Difference', 0, 100, 0)],
    body: `vec4 c=S(uv); if(view>0.5&&view<1.5||u_hasLayer<0.5){ o=c; return; }
  vec3 a=c.rgb, b=L(uv).rgb; if(blur>0.){ vec2 px=blur*${SC}/u_res/2.; a=vec3(0.); b=vec3(0.); for(int j=-2;j<=2;j++) for(int i=-2;i<=2;i++){ vec2 p=uv+vec2(i,j)*px; a+=S(p).rgb; b+=L(p).rgb; } a/=25.; b/=25.; }
  vec3 df=abs(a-b); float d=max(max(df.r,df.g),df.b); float t=tol/100.;
  float m=smoothstep(t,t+soft/100.+1e-3,d); if(view>1.5){ o=vec4(vec3(m),1.); return; } o=vec4(c.rgb,c.a*m);`,
  },
  'Bevel Alpha': {
    src: true, passes: 3,
    params: [s('edge', 'Edge Thickness', 0, 50, 4), s('angle', 'Light Angle', -360, 360, -60), col('lcol', 'Light Color', '#ffffff'), s('intensity', 'Light Intensity', 0, 1, 0.4)],
    body: alphaRamp(`max(edge,0.5)*${SC}`, `vec2 px=1./u_res; vec2 g=vec2(S(uv+vec2(px.x,0.)).r-S(uv-vec2(px.x,0.)).r,S(uv+vec2(0.,px.y)).r-S(uv-vec2(0.,px.y)).r)*R;
  float a=radians(angle); float v=dot(-g,vec2(sin(a),cos(a)))*intensity*2.; vec4 c=SRC(uv);
  o=vec4(clamp(c.rgb+lcol*max(v,0.)-c.rgb*max(-v,0.),0.,1.),c.a);`),
  },
  'Bevel Edges': {
    params: [s('thick', 'Edge Thickness', 0, 0.5, 0.1), s('angle', 'Light Angle', -360, 360, -60), col('lcol', 'Light Color', '#ffffff'), s('intensity', 'Light Intensity', 0, 1, 0.25)],
    body: `vec4 c=S(uv); vec2 asp=vec2(u_res.x/u_res.y,1.); vec2 p=uv*asp; float dl=p.x, dr=asp.x-p.x, db=p.y, dt=1.-p.y; float m=min(min(dl,dr),min(db,dt));
  vec2 n=vec2(0.); if(m<thick*0.5) n=m==dl?vec2(-1.,0.):m==dr?vec2(1.,0.):m==db?vec2(0.,-1.):vec2(0.,1.);
  float a=radians(angle); float v=dot(n,vec2(sin(a),cos(a)))*intensity*2.;
  o=vec4(clamp(c.rgb+lcol*max(v,0.)-c.rgb*max(-v,0.),0.,1.),c.a);`,
  },
  'Radial Shadow': {
    params: [col('color', 'Shadow Color', '#000000'), s('opacity', 'Opacity', 0, 100, 50), pt('light', 'Light Source', 0.2, 0.2), s('proj', 'Projection Distance', 0, 100, 10),
      s('soft', 'Softness', 0, 50, 0), sel('render', 'Render', ['Regular', 'Glass Edge']), s('influence', 'Color Influence', 0, 100, 100), chk('only', 'Shadow Only')],
    body: `vec4 c=S(uv); vec2 Lp=vec2(light.x,1.-light.y); float k=1.+proj/100.; vec2 q=Lp+(uv-Lp)/k; float R=soft*${SC}*k;
  float sa=0.; vec3 sc=vec3(0.);
  for(int i=0;i<16;i++){ float an=float(i)*2.3999632; float r=sqrt((float(i)+0.5)/16.); vec4 t=SZ(q+vec2(cos(an),sin(an))*r*R/u_res); sa+=t.a; sc+=t.rgb*t.a; }
  sc/=max(sa,1e-4); sa/=16.;
  vec3 shc=render<0.5?color:mix(color,sc,influence/100.); float shA=sa*opacity/100.;
  o=only>0.5?vec4(shc,shA):vec4(mix(shc,c.rgb,c.a),c.a+shA*(1.-c.a));`,
  },
  'Brush Strokes': {
    params: [s('angle', 'Stroke Angle', -360, 360, 45), s('size', 'Brush Size', 0, 5, 2), s('len', 'Stroke Length', 0, 40, 8), s('density', 'Stroke Density', 0, 2, 1),
      s('random', 'Stroke Randomness', 0, 2, 1), sel('surface', 'Paint Surface', ['Paint On Original Image', 'Paint On Transparent', 'Paint On White', 'Paint On Black']), s('blend', 'Blend With Original', 0, 100, 0)],
    body: `float a0=radians(angle); float sz=max(size,0.)*${SC}+0.75; float ln=max(len,0.)*${SC}+0.5; float dens=max(density,0.05);
  float g=max(max(ln*0.5,sz*2.),1.5)/sqrt(dens); g=max(g,max(ln*0.5,sz*2.)); vec2 P=uv*u_res; vec2 cell=floor(P/g);
  vec4 best=vec4(0.); float bz=-1.;
  for(int j=-2;j<=2;j++) for(int i=-2;i<=2;i++) for(int k=0;k<3;k++){
    if(float(k)>=ceil(dens)) break;
    vec2 cc=cell+vec2(i,j); vec2 sd=cc+float(k)*vec2(37.1,11.7);
    if(float(k)+1.>dens && hash(sd+5.3)>fract(dens)) continue;
    vec2 C=(cc+vec2(hash(sd),hash(sd+1.7)))*g; float an=a0+(hash(sd+2.9)-0.5)*random*1.2; float l=ln*(1.+(hash(sd+4.1)-0.5)*random*0.8);
    vec2 dir=vec2(cos(an),sin(an)); vec2 d=P-C; float u=clamp(dot(d,dir),-l*0.5,l*0.5);
    if(length(d-dir*u)<sz){ float z=hash(sd+7.7); if(z>bz){ bz=z; best=S(C/u_res); } } }
  vec4 c=S(uv); vec4 surf=surface<0.5?c:surface<1.5?vec4(0.):surface<2.5?vec4(1.):vec4(0.,0.,0.,1.);
  o=mix(bz<0.?surf:best,c,blend/100.);`,
  },
  'Roughen Edges': {
    src: true, passes: 3,
    // legacy indices 0/1 = Roughen/Rusty stay; the other After Effects edge types follow
    params: [sel('type', 'Edge Type', ['Roughen', 'Rusty', 'Roughen Color', 'Rusty Color', 'Cut', 'Photocopy', 'Photocopy Color']), col('ecol', 'Edge Color', '#5a3418'),
      s('border', 'Border', 0, 100, 8), s('contrast', 'Edge Sharpness', 0, 10, 1), s('influence', 'Fractal Influence', 0, 1, 1), s('scale', 'Scale', 1, 200, 50),
      s('stretch', 'Stretch Width or Height', -5, 5, 0), pt('offset', 'Offset (Turbulence)', 0, 0), s('complexity', 'Complexity', 1, 10, 2, 0.1), s('evo', 'Evolution', -3600, 3600, 0)],
    body: alphaRamp(`max(border,0.5)*${SC}`, `vec4 c=SRC(uv); float h=S(uv).r; float st=pow(2.,stretch);
  vec2 P=(uv-vec2(offset.x,1.-offset.y))*u_res/(max(scale,1.)*${SC})*vec2(1./st,st); float e=radians(evo); P+=vec2(cos(e),sin(e))*1.3+vec2(e*0.05);
  float n=fbm(P,complexity,0.5); bool rusty=(type>0.5&&type<1.5)||(type>2.5&&type<3.5); bool photo=type>4.5;
  float v=h+(n-0.5)*influence*(rusty?1.4:0.9);
  if(photo) v-=step(0.72,fbm(P*3.+7.,2.,0.5))*0.6*influence*smoothstep(0.55,0.9,h);
  float sw=type>3.5&&type<4.5?0.002:0.5/(1.+contrast*3.); float a=smoothstep(0.5-sw*0.5,0.5+sw*0.5,v);
  vec3 rgb=c.rgb; bool colored=(type>1.5&&type<3.5)||type>5.5; if(colored) rgb=mix(c.rgb,ecol,1.-smoothstep(0.5,0.62+sw,v));
  o=vec4(rgb,c.a*a);`),
  },
  'Texturize': {
    layer: 'layer',
    params: [trk('layer', 'Texture Layer'), s('dir', 'Light Direction', -360, 360, 135), s('contrast', 'Texture Contrast', 0, 2, 1)],
    body: `vec4 c=S(uv); if(u_hasLayer<0.5){ o=c; return; } float a=radians(dir); vec2 d=vec2(sin(a),cos(a))/u_res*1.5;
  float e=luma(L(uv+d).rgb)-luma(L(uv-d).rgb); o=vec4(clamp(c.rgb*(1.+e*contrast*3.),0.,1.),c.a);`,
  },
};
