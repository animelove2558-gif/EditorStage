// GPU video effects. Each effect: { params:[...], body:GLSL, passes?:n, status?:'approx'|'unsupported' } (layer/src/fns/custom: see premiereFx.js).
// Uniforms are generated from params (slider/select/checkbox -> float, point -> vec2, color -> vec3).
// Coordinates: uv origin bottom-left, points are normalized (y-down values are flipped by the compositor where needed).
import { s, sel, chk, pt, col, trk, med, SC } from './fxParams';
import { PRO_FX } from './premiereFx';
import { MORE_VIDEO_FX } from './moreVideoFx';

export const PRELUDE = `
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); float e=1e-10; return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)), d/(q.x+e), q.x); }
vec3 hsv2rgb(vec3 c){ vec4 K=vec4(1.,2./3.,1./3.,3.); vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www); return c.z*mix(K.xxx,clamp(p-K.xxx,0.,1.),c.y); }
vec4 S(vec2 p){ return texture(u_tex, p); }
vec4 blurDir(vec2 d, float r){ vec4 a=vec4(0.); float w=0.; for(int i=-12;i<=12;i++){ float f=float(i)/12.; float k=exp(-f*f*2.5); a+=S(uv+d*f*r)*k; w+=k; } return a/w; }
float noise2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
// (no max()/length() below: Compound Blur / Directional Blur have params with those names, which hide the built-ins)
vec4 SZ(vec2 p){ return (p.x<0.||p.x>1.||p.y<0.||p.y>1.)?vec4(0.):S(p); }
float fbm(vec2 p, float oct, float rough){ float a=0.5, s=0., n=0.; for(int i=0;i<10;i++){ if(float(i)>=oct) break; s+=a*noise2(p); n+=a; p=p*2.03+vec2(17.1,9.7); a*=rough; } float f=oct-floor(oct); if(f>0.&&oct<10.){ s+=a*f*noise2(p); n+=a*f; } return s/(n+1e-6); }
vec3 bm(vec3 b, vec3 s, float m){ int k=int(m+0.5);
  if(k==1) return min(b,s); if(k==2) return b*s; if(k==3) return 1.-min(vec3(1.),(1.-b)/(s+1e-4)); if(k==4) return -min(-b,-s); if(k==5) return 1.-(1.-b)*(1.-s);
  if(k==6) return min(vec3(1.),b/(1.-s+1e-4)); if(k==7) return mix(2.*b*s,1.-2.*(1.-b)*(1.-s),step(0.5,b)); if(k==8) return mix(b-(1.-2.*s)*b*(1.-b),b+(2.*s-1.)*(sqrt(b)-b),step(0.5,s));
  if(k==9) return mix(2.*b*s,1.-2.*(1.-b)*(1.-s),step(0.5,s)); if(k==10) return abs(b-s); if(k==11) return b+s-2.*b*s; if(k==12) return min(b+s,vec3(1.)); return s; }
vec4 vrEye(float lay){ if(lay<0.5) return vec4(1.,1.,0.,0.); if(lay<1.5) return vec4(1.,.5,0.,step(.5,uv.y)*.5); return vec4(.5,1.,step(.5,uv.x)*.5,0.); }
vec3 vrDir(vec2 q){ float lo=(q.x-.5)*6.2831853, la=(q.y-.5)*3.1415927; return vec3(cos(la)*sin(lo),sin(la),cos(la)*cos(lo)); }
vec2 vrUV(vec3 d){ return vec2(atan(d.x,d.z)/6.2831853+.5,asin(clamp(d.y,-1.,1.))/3.1415927+.5); }
vec4 vrS(vec4 E, vec2 q){ return S(E.zw+vec2(fract(q.x),clamp(q.y,0.,1.))*E.xy); }
`;


export const VIDEO_FX = {
  // ---------------- Adjust ----------------
  'Extract': { params: [s('black', 'Input Black Level', 0, 255, 0), s('white', 'Input White Level', 0, 255, 255), s('soft', 'Softness', 0, 100, 0)],
    body: `vec4 c=S(uv); float l=luma(c.rgb); float v=smoothstep(black/255.-soft/200., white/255.+soft/200.+0.0001, l); o=vec4(vec3(v), c.a);` },
  'Levels': { params: [s('inBlack', 'Input Black', 0, 255, 0), s('inWhite', 'Input White', 0, 255, 255), s('gamma', 'Gamma', 0.1, 10, 1), s('outBlack', 'Output Black', 0, 255, 0), s('outWhite', 'Output White', 0, 255, 255)],
    body: `vec4 c=S(uv); vec3 r=clamp((c.rgb-inBlack/255.)/max(inWhite/255.-inBlack/255.,0.001),0.,1.); r=pow(r,vec3(1./gamma)); r=mix(vec3(outBlack/255.),vec3(outWhite/255.),r); o=vec4(r,c.a);` },
  'Lighting Effects': PRO_FX['Lighting Effects'],
  'ProcAmp': { params: [s('bright', 'Brightness', -100, 100, 0), s('contrast', 'Contrast', 0, 200, 100), s('hue', 'Hue', -180, 180, 0), s('sat', 'Saturation', 0, 200, 100), chk('split', 'Split Screen')],
    body: `vec4 c=S(uv); vec3 r=c.rgb+bright/100.; r=(r-0.5)*(contrast/100.)+0.5; vec3 h=rgb2hsv(clamp(r,0.,1.)); h.x=fract(h.x+hue/360.); h.y*=sat/200.*2.; r=hsv2rgb(h); if(split>0.5&&uv.x<0.5) r=c.rgb; o=vec4(r,c.a);` },

  // ---------------- Blur & Sharpen ----------------
  'Camera Blur': { params: [s('percent', 'Percent Blur', 0, 100, 0)], passes: 2,
    body: `float r=percent*0.6*${SC}; o=blurDir(u_pass<0.5?vec2(1./u_res.x,0.):vec2(0.,1./u_res.y), r);` },
  'Channel Blur': { params: [s('red', 'Red Blurriness', 0, 100, 0), s('green', 'Green Blurriness', 0, 100, 0), s('blue', 'Blue Blurriness', 0, 100, 0), s('alpha', 'Alpha Blurriness', 0, 100, 0)], passes: 2,
    body: `vec2 d=u_pass<0.5?vec2(1./u_res.x,0.):vec2(0.,1./u_res.y); o=vec4(blurDir(d,red*${SC}).r, blurDir(d,green*${SC}).g, blurDir(d,blue*${SC}).b, blurDir(d,alpha*${SC}).a);` },
  'Compound Blur': PRO_FX['Compound Blur'],
  'Directional Blur': { params: [s('angle', 'Direction', -360, 360, 0), s('length', 'Blur Length', 0, 200, 10)],
    body: `float a=radians(angle); vec2 d=vec2(cos(a),sin(a))/u_res; o=blurDir(d, length*${SC});` },
  'Fast Blur': { params: [s('blurriness', 'Blurriness', 0, 100, 0), sel('dim', 'Blur Dimensions', ['Horizontal and Vertical', 'Horizontal', 'Vertical']), chk('repeat', 'Repeat Edge Pixels')], passes: 2,
    body: `float r=blurriness*0.5*${SC}; bool h=(dim<1.5&&u_pass<0.5); bool v=(dim!=1.&&u_pass>0.5); vec2 d=h?vec2(1./u_res.x,0.):(v?vec2(0.,1./u_res.y):vec2(0.)); o=(h||v)?blurDir(d,r):S(uv);` },
  'Gaussian Blur': { params: [s('blurriness', 'Blurriness', 0, 100, 0), sel('dim', 'Blur Dimensions', ['Horizontal and Vertical', 'Horizontal', 'Vertical']), chk('repeat', 'Repeat Edge Pixels')], passes: 2,
    body: `float r=blurriness*0.5*${SC}; bool h=(dim<1.5&&u_pass<0.5); bool v=(dim!=1.&&u_pass>0.5); vec2 d=h?vec2(1./u_res.x,0.):(v?vec2(0.,1./u_res.y):vec2(0.)); o=(h||v)?blurDir(d,r):S(uv);` },
  'Radial Blur': { params: [s('amount', 'Amount', 0, 100, 10), sel('type', 'Type', ['Spin', 'Zoom']), pt('center', 'Center')],
    body: `vec2 c0=vec2(center.x,1.-center.y); vec4 a=vec4(0.); for(int i=0;i<24;i++){ float f=float(i)/23.-0.5; vec2 p=uv-c0; if(type<0.5){ float an=f*amount*0.02; float cs=cos(an),sn=sin(an); p=vec2(p.x*cs-p.y*sn,p.x*sn+p.y*cs);} else p*=1.+f*amount*0.01; a+=S(c0+p);} o=a/24.;` },
  'Sharpen': { params: [s('amount', 'Sharpen Amount', 0, 200, 0)],
    body: `vec2 px=1./u_res; vec4 c=S(uv); vec4 b=(S(uv+vec2(px.x,0.))+S(uv-vec2(px.x,0.))+S(uv+vec2(0.,px.y))+S(uv-vec2(0.,px.y)))*0.25; o=vec4(c.rgb+(c.rgb-b.rgb)*amount/50.,c.a);` },
  'Unsharp Mask': { params: [s('amount', 'Amount', 0, 500, 50), s('radius', 'Radius', 0.1, 250, 3), s('threshold', 'Threshold', 0, 255, 0)], passes: 1,
    body: `vec2 px=1./u_res*radius*${SC}; vec4 c=S(uv); vec4 b=(S(uv+vec2(px.x,0.))+S(uv-vec2(px.x,0.))+S(uv+vec2(0.,px.y))+S(uv-vec2(0.,px.y))+S(uv+px)+S(uv-px)+S(uv+vec2(px.x,-px.y))+S(uv+vec2(-px.x,px.y)))/8.; vec3 d=c.rgb-b.rgb; if(abs(luma(d))*255.<threshold) d=vec3(0.); o=vec4(c.rgb+d*amount/100.,c.a);` },

  // ---------------- Channel ----------------
  'Arithmetic': PRO_FX['Arithmetic'],
  'Blend': PRO_FX['Blend'],
  'Calculations': PRO_FX['Calculations'],
  'Invert': { params: [sel('ch', 'Channel', ['RGB', 'Red', 'Green', 'Blue', 'Hue', 'Lightness', 'Saturation', 'Alpha']), s('blend', 'Blend With Original', 0, 100, 0)],
    body: `vec4 c=S(uv); vec3 r=c.rgb; float a=c.a; if(ch<0.5) r=1.-r; else if(ch<1.5) r.r=1.-r.r; else if(ch<2.5) r.g=1.-r.g; else if(ch<3.5) r.b=1.-r.b; else if(ch<4.5){ vec3 h=rgb2hsv(r); h.x=fract(h.x+0.5); r=hsv2rgb(h);} else if(ch<5.5){ vec3 h=rgb2hsv(r); h.z=1.-h.z; r=hsv2rgb(h);} else if(ch<6.5){ vec3 h=rgb2hsv(r); h.y=1.-h.y; r=hsv2rgb(h);} else a=1.-a; o=vec4(mix(r,c.rgb,blend/100.),mix(a,c.a,blend/100.));` },
  'Set Matte': { matte: true, params: [trk('takeFrom', 'Take Matte From Layer'), sel('use', 'Use For Matte', ['Alpha Channel', 'Luminance', 'Red Channel', 'Green Channel', 'Blue Channel']), chk('invert', 'Invert Matte'), chk('composite', 'Composite Matte With Original')], body: `o=S(uv);` },
  'Shift Channels': { params: [sel('r', 'Take Red From', ['Red', 'Green', 'Blue', 'Alpha', 'Luminance', 'Full On', 'Full Off'], 0), sel('g', 'Take Green From', ['Red', 'Green', 'Blue', 'Alpha', 'Luminance', 'Full On', 'Full Off'], 1), sel('b', 'Take Blue From', ['Red', 'Green', 'Blue', 'Alpha', 'Luminance', 'Full On', 'Full Off'], 2)],
    body: `vec4 c=S(uv); float L=luma(c.rgb); float v[7]=float[7](c.r,c.g,c.b,c.a,L,1.,0.); o=vec4(v[int(r)],v[int(g)],v[int(b)],c.a);` },

  // ---------------- Color Correction ----------------
  'ASC CDL': { params: [s('sr', 'Red Slope', 0, 3, 1), s('sg', 'Green Slope', 0, 3, 1), s('sb', 'Blue Slope', 0, 3, 1), s('or', 'Red Offset', -1, 1, 0), s('og', 'Green Offset', -1, 1, 0), s('ob', 'Blue Offset', -1, 1, 0), s('pr', 'Red Power', 0.1, 4, 1), s('pg', 'Green Power', 0.1, 4, 1), s('pb', 'Blue Power', 0.1, 4, 1), s('sat', 'Saturation', 0, 3, 1)],
    body: `vec4 c=S(uv); vec3 r=pow(max(c.rgb*vec3(sr,sg,sb)+vec3(or,og,ob),0.),vec3(pr,pg,pb)); r=mix(vec3(luma(r)),r,sat); o=vec4(r,c.a);` },
  'Brightness & Contrast': { params: [s('bright', 'Brightness', -100, 100, 0), s('contrast', 'Contrast', -100, 100, 0)],
    body: `vec4 c=S(uv); vec3 r=c.rgb+bright/255.*1.5; r=(r-0.5)*(1.+contrast/100.)+0.5; o=vec4(r,c.a);` },
  'Change Color': { params: [col('from', 'Color To Change', '#ff0000'), s('hue', 'Hue Transform', -180, 180, 0), s('lightness', 'Lightness Transform', -100, 100, 0), s('sat', 'Saturation Transform', -100, 100, 0), s('tol', 'Color Tolerance', 0, 100, 30), s('soft', 'Softness', 0, 100, 50)],
    body: `vec4 c=S(uv); vec3 h=rgb2hsv(c.rgb); vec3 hf=rgb2hsv(from); float dh=abs(h.x-hf.x); dh=min(dh,1.-dh); float m=1.-smoothstep(tol/200.,tol/200.+soft/200.+0.001,dh); h.x=fract(h.x+m*hue/360.); h.z=clamp(h.z+m*lightness/100.,0.,1.); h.y=clamp(h.y+m*sat/100.,0.,1.); o=vec4(hsv2rgb(h),c.a);` },
  'Change to Color': { params: [col('from', 'From', '#ff0000'), col('to', 'To', '#0000ff'), s('tol', 'Tolerance', 0, 100, 30), s('soft', 'Softness', 0, 100, 30)],
    body: `vec4 c=S(uv); float d=distance(c.rgb,from); float m=1.-smoothstep(tol/100.,tol/100.+soft/100.+0.001,d); o=vec4(mix(c.rgb,to*luma(c.rgb)/max(luma(from),0.05),m),c.a);` },
  'Channel Mixer': { params: [s('rr', 'Red-Red', -200, 200, 100), s('rg', 'Red-Green', -200, 200, 0), s('rb', 'Red-Blue', -200, 200, 0), s('gr', 'Green-Red', -200, 200, 0), s('gg', 'Green-Green', -200, 200, 100), s('gb', 'Green-Blue', -200, 200, 0), s('br', 'Blue-Red', -200, 200, 0), s('bg', 'Blue-Green', -200, 200, 0), s('bb', 'Blue-Blue', -200, 200, 100), chk('mono', 'Monochrome')],
    body: `vec4 c=S(uv); vec3 r=vec3(dot(c.rgb,vec3(rr,rg,rb)),dot(c.rgb,vec3(gr,gg,gb)),dot(c.rgb,vec3(br,bg,bb)))/100.; if(mono>0.5) r=vec3(r.g); o=vec4(r,c.a);` },
  'Color Balance': { params: [s('sr', 'Shadow Red', -100, 100, 0), s('sg', 'Shadow Green', -100, 100, 0), s('sb', 'Shadow Blue', -100, 100, 0), s('mr', 'Midtone Red', -100, 100, 0), s('mg', 'Midtone Green', -100, 100, 0), s('mb', 'Midtone Blue', -100, 100, 0), s('hr', 'Highlight Red', -100, 100, 0), s('hg', 'Highlight Green', -100, 100, 0), s('hb', 'Highlight Blue', -100, 100, 0)],
    body: `vec4 c=S(uv); float l=luma(c.rgb); float sh=1.-smoothstep(0.,0.5,l); float hi=smoothstep(0.5,1.,l); float mi=1.-sh-hi; vec3 r=c.rgb+vec3(sr,sg,sb)/200.*sh+vec3(mr,mg,mb)/200.*mi+vec3(hr,hg,hb)/200.*hi; o=vec4(r,c.a);` },
  'Equalize': PRO_FX['Equalize'],
  'Leave Color': { params: [s('amount', 'Amount to Decolor', 0, 100, 100), col('keep', 'Color to Leave', '#ff0000'), s('tol', 'Tolerance', 0, 100, 30), s('edge', 'Edge Softness', 0, 100, 0)],
    body: `vec4 c=S(uv); float d=distance(rgb2hsv(c.rgb).x,rgb2hsv(keep).x); d=min(d,1.-d); float m=1.-smoothstep(tol/200.,tol/200.+edge/200.+0.001,d); m=max(m,1.-step(0.1,rgb2hsv(c.rgb).y)); o=vec4(mix(vec3(luma(c.rgb)),c.rgb,max(m,1.-amount/100.)),c.a);` },
  'Lumetri Color': { status: 'builtin', params: [], body: `o=S(uv);` },
  'Tint': { params: [col('black', 'Map Black To', '#000000'), col('white', 'Map White To', '#ffffff'), s('amount', 'Amount to Tint', 0, 100, 100)],
    body: `vec4 c=S(uv); o=vec4(mix(c.rgb,mix(black,white,luma(c.rgb)),amount/100.),c.a);` },
  'Video Limiter': { params: [s('lo', 'Signal Min', 0, 255, 16), s('hi', 'Signal Max', 0, 255, 235)], body: `vec4 c=S(uv); o=vec4(clamp(c.rgb,lo/255.,hi/255.),c.a);` },

  // ---------------- Distort ----------------
  'Corner Pin': { params: [pt('tl', 'Upper Left', 0, 0), pt('tr', 'Upper Right', 1, 0), pt('bl', 'Lower Left', 0, 1), pt('br', 'Lower Right', 1, 1)],
    body: `vec2 TL=vec2(tl.x,1.-tl.y),TR=vec2(tr.x,1.-tr.y),BL=vec2(bl.x,1.-bl.y),BR=vec2(br.x,1.-br.y);
      vec2 q=uv; vec2 uvs=vec2(0.5); for(int i=0;i<12;i++){ vec2 P=mix(mix(BL,BR,uvs.x),mix(TL,TR,uvs.x),uvs.y); vec2 dx=mix(BR-BL,TR-TL,uvs.y); vec2 dy=mix(TL-BL,TR-BR,uvs.x); vec2 e=q-P; float det=dx.x*dy.y-dx.y*dy.x; if(abs(det)<1e-6) break; uvs+=vec2(e.x*dy.y-e.y*dy.x,-e.x*dx.y+e.y*dx.x)/det; }
      o=(uvs.x<0.||uvs.x>1.||uvs.y<0.||uvs.y>1.)?vec4(0.):S(uvs);` },
  'Lens Distortion': { params: [s('curv', 'Curvature', -100, 100, 0), s('vdec', 'Vertical Decentering', -100, 100, 0), s('hdec', 'Horizontal Decentering', -100, 100, 0), s('fill', 'Fill Alpha', 0, 1, 0, 1)],
    body: `vec2 p=(uv-0.5)*2.-vec2(hdec,vdec)/100.; float k=curv/100.; vec2 q=p*(1.+k*dot(p,p)); vec2 st=q*0.5+0.5+vec2(hdec,vdec)/200.; o=(st.x<0.||st.x>1.||st.y<0.||st.y>1.)?vec4(0.):S(st);` },
  'Magnify': { params: [pt('center', 'Center'), s('mag', 'Magnification', 100, 600, 200), s('size', 'Size', 10, 500, 100), s('feather', 'Feather', 0, 100, 10)],
    body: `vec2 c0=vec2(center.x,1.-center.y); vec2 d=(uv-c0)*vec2(u_res.x/u_res.y,1.); float r=size/400.; float m=1.-smoothstep(r*(1.-feather/100.),r,length(d)); vec2 st=c0+(uv-c0)/mix(1.,mag/100.,m); o=S(st);` },
  'Mirror': { params: [s('angle', 'Reflection Angle', -360, 360, 0), pt('center', 'Reflection Center')],
    body: `vec2 c0=vec2(center.x,1.-center.y); float a=radians(angle); vec2 n=vec2(cos(a),sin(a)); vec2 d=(uv-c0)*vec2(u_res.x/u_res.y,1.); float side=dot(d,n); vec2 p=uv; if(side>0.){ d-=2.*side*n; p=c0+d/vec2(u_res.x/u_res.y,1.);} o=S(p);` },
  'Offset': { params: [pt('shift', 'Shift Center To'), s('blend', 'Blend With Original', 0, 100, 0)], body: `vec2 off=vec2(shift.x-0.5,0.5-shift.y); o=mix(S(fract(uv-off)),S(uv),blend/100.);` },
  'Spherize': { params: [s('radius', 'Radius', 0, 500, 100), pt('center', 'Center of Sphere')],
    body: `vec2 c0=vec2(center.x,1.-center.y); vec2 d=(uv-c0)*vec2(u_res.x/u_res.y,1.); float r=radius/200.; float l=length(d); vec2 p=uv; if(l<r){ float z=sqrt(1.-(l/r)*(l/r)); float k=asin(l/r)/(3.14159/2.); p=c0+(l>0.?d/l*k*r:vec2(0.))/vec2(u_res.x/u_res.y,1.);} o=S(p);` },
  'Transform': { params: [pt('anchor', 'Anchor Point'), pt('position', 'Position'), s('scale', 'Scale', 0, 400, 100), s('rotation', 'Rotation', -360, 360, 0), s('opacity', 'Opacity', 0, 100, 100)],
    body: `vec2 a=vec2(anchor.x,1.-anchor.y), p=vec2(position.x,1.-position.y); vec2 d=(uv-p)*vec2(u_res.x/u_res.y,1.)/(max(scale,0.01)/100.); float r=radians(-rotation); d=vec2(d.x*cos(r)-d.y*sin(r),d.x*sin(r)+d.y*cos(r)); vec2 st=a+d/vec2(u_res.x/u_res.y,1.); vec4 c=(st.x<0.||st.x>1.||st.y<0.||st.y>1.)?vec4(0.):S(st); o=vec4(c.rgb,c.a*opacity/100.);` },
  'Turbulent Displace': PRO_FX['Turbulent Displace'],
  'Twirl': { params: [s('angle', 'Angle', -720, 720, 0), s('radius', 'Twirl Radius', 0, 100, 50), pt('center', 'Twirl Center')],
    body: `vec2 c0=vec2(center.x,1.-center.y); vec2 d=(uv-c0)*vec2(u_res.x/u_res.y,1.); float r=radius/100.; float l=length(d); float k=max(1.-l/r,0.); float a=radians(angle)*k*k; vec2 q=vec2(d.x*cos(a)-d.y*sin(a),d.x*sin(a)+d.y*cos(a)); o=S(c0+q/vec2(u_res.x/u_res.y,1.));` },
  'Warp Stabilizer': { special: true, analyze: 'stabilize', params: [s('smoothing', 'Smoothness', 0, 100, 50), sel('method', 'Method', ['Position', 'Position, Scale, Rotation'], 1), s('crop', 'Crop Less <-> Smooth More', 0, 2, 1)], body: `o=S(uv);` },
  'Wave Warp': { params: [sel('type', 'Wave Type', ['Sine', 'Triangle', 'Square']), s('height', 'Wave Height', 0, 600, 10), s('width', 'Wave Width', 1, 600, 50), s('dir', 'Direction', -360, 360, 90), s('speed', 'Wave Speed', -10, 10, 1)],
    body: `float a=radians(dir); vec2 n=vec2(cos(a),sin(a)); vec2 t=vec2(-n.y,n.x); float ph=dot((uv-0.5)*u_res,n)/width*6.2832+u_time*speed*6.2832; float w=type<0.5?sin(ph):type<1.5?asin(sin(ph))*0.6366:sign(sin(ph)); o=S(uv+t*w*height*${SC}/u_res);` },

  // ---------------- Generate ----------------
  '4-Color Gradient': { params: [col('c1', 'Color 1', '#ff0000'), col('c2', 'Color 2', '#00ff00'), col('c3', 'Color 3', '#0000ff'), col('c4', 'Color 4', '#ffff00'), s('blend', 'Blend', 0, 100, 100)],
    body: `vec4 c=S(uv); vec3 g=mix(mix(c3,c4,uv.x),mix(c1,c2,uv.x),uv.y); o=vec4(mix(c.rgb,g,blend/100.),max(c.a,blend/100.));` },
  'Cell Pattern': { params: [sel('type', 'Cell Pattern', ['Bubbles', 'Crystals', 'Plates']), s('size', 'Size', 2, 300, 60), s('contrast', 'Contrast', 0, 400, 100), chk('invert', 'Invert'), s('blend', 'Blend', 0, 100, 100)],
    body: `vec2 p=uv*u_res/(size*${SC}); vec2 i=floor(p), f=fract(p); float md=8.; for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(x,y); vec2 r=g+vec2(hash(i+g),hash(i+g+7.))-f; md=min(md,dot(r,r)); } float v=type<0.5?1.-sqrt(md):type<1.5?sqrt(md):sqrt(md)*0.8; v=clamp((v-0.5)*contrast/100.+0.5,0.,1.); if(invert>0.5) v=1.-v; vec4 c=S(uv); o=vec4(mix(c.rgb,vec3(v),blend/100.),1.);` },
  'Checkerboard': { params: [s('size', 'Size', 2, 400, 80), col('c1', 'Color', '#ffffff'), col('c2', 'Color 2', '#000000'), s('opacity', 'Opacity', 0, 100, 100)],
    body: `vec4 c=S(uv); vec2 p=floor(uv*u_res/(size*${SC})); float k=mod(p.x+p.y,2.); o=vec4(mix(c.rgb,mix(c2,c1,k),opacity/100.),max(c.a,opacity/100.));` },
  'Circle': { params: [pt('center', 'Center'), s('radius', 'Radius', 1, 1000, 150), s('edge', 'Feather', 0, 200, 0), col('color', 'Color', '#ffffff'), chk('invert', 'Invert Circle'), s('opacity', 'Opacity', 0, 100, 100)],
    body: `vec4 c=S(uv); vec2 d=(uv-vec2(center.x,1.-center.y))*u_res; float r=radius*${SC}; float m=1.-smoothstep(r-edge*${SC},r+0.5,length(d)); if(invert>0.5) m=1.-m; m*=opacity/100.; o=vec4(mix(c.rgb,color,m),max(c.a,m));` },
  'Ellipse': { params: [pt('center', 'Center'), s('w', 'Width', 1, 1500, 300), s('h', 'Height', 1, 1500, 150), s('thick', 'Thickness', 1, 400, 20), s('soft', 'Softness', 0, 100, 10), col('color', 'Color', '#ffffff'), s('opacity', 'Opacity', 0, 100, 100)],
    body: `vec4 c=S(uv); vec2 d=(uv-vec2(center.x,1.-center.y))*u_res/${SC}; float e=length(d/vec2(w,h)*2.); float t=thick/max(w,h)*2.; float m=1.-smoothstep(t*0.5,t*0.5+soft/200.+0.002,abs(e-1.)); m*=opacity/100.; o=vec4(mix(c.rgb,color,m),max(c.a,m));` },
  'Grid': { params: [pt('anchor', 'Anchor'), s('size', 'Size From', 4, 600, 80), s('border', 'Border', 0.5, 60, 4), s('feather', 'Feather', 0, 50, 0), col('color', 'Color', '#ffffff'), s('opacity', 'Opacity', 0, 100, 100)],
    body: `vec4 c=S(uv); vec2 p=(uv-vec2(anchor.x,1.-anchor.y))*u_res/${SC}; vec2 f=abs(mod(p+size*0.5,size)-size*0.5); float m=1.-smoothstep(border*0.5,border*0.5+feather+0.7,min(f.x,f.y)); m*=opacity/100.; o=vec4(mix(c.rgb,color,m),max(c.a,m));` },
  'Lens Flare': { params: [pt('center', 'Flare Center', 0.3, 0.3), s('bright', 'Flare Brightness', 0, 300, 100), sel('lens', 'Lens Type', ['50-300mm Zoom', '35mm Prime', '105mm Prime'])],
    body: `vec4 c=S(uv); vec2 L=vec2(center.x,1.-center.y); vec2 d=(uv-L)*vec2(u_res.x/u_res.y,1.); float core=exp(-dot(d,d)*180.)*1.5+exp(-dot(d,d)*18.)*0.35; vec2 ax=(vec2(0.5)-L); vec3 f=vec3(0.); for(int i=1;i<5;i++){ vec2 q=L+ax*float(i)*0.5; vec2 e=(uv-q)*vec2(u_res.x/u_res.y,1.); float r=0.03*float(i); f+=vec3(0.5+0.1*float(i),0.8,1.-0.1*float(i))*smoothstep(r,r*0.7,length(e))*0.18; } vec3 add=(vec3(1.,0.92,0.8)*core+f)*bright/100.; o=vec4(c.rgb+add,c.a);` },
  'Lightning': PRO_FX['Lightning'],
  'Paint Bucket': PRO_FX['Paint Bucket'],
  'Ramp': { params: [pt('start', 'Start of Ramp', 0.5, 0), col('c1', 'Start Color', '#000000'), pt('end', 'End of Ramp', 0.5, 1), col('c2', 'End Color', '#ffffff'), sel('shape', 'Ramp Shape', ['Linear', 'Radial']), s('blend', 'Blend With Original', 0, 100, 0)],
    body: `vec4 c=S(uv); vec2 A=vec2(start.x,1.-start.y), B=vec2(end.x,1.-end.y); vec2 ab=(B-A)*vec2(u_res.x/u_res.y,1.); vec2 ap=(uv-A)*vec2(u_res.x/u_res.y,1.); float t=shape<0.5?dot(ap,ab)/max(dot(ab,ab),1e-5):length(ap)/max(length(ab),1e-5); vec3 g=mix(c1,c2,clamp(t,0.,1.)); o=vec4(mix(g,c.rgb,blend/100.),1.);` },
  'Write-on': { special: true, params: [{ id: 'brushPos', label: 'Brush Position', type: 'point', def: [0.3, 0.5] }, col('color', 'Color', '#ffffff'), s('size', 'Brush Size', 1, 300, 20), s('hardness', 'Brush Hardness', 0, 100, 80), s('opacity', 'Brush Opacity', 0, 100, 100), s('strokeLen', 'Stroke Length (secs)', 0, 30, 0, 0.1), sel('style', 'Paint Style', ['On Original Image', 'On Transparent', 'Reveal Original Image'])], body: `o=S(uv);` },

  // ---------------- Image Control ----------------
  'Black & White': { params: [], body: `vec4 c=S(uv); o=vec4(vec3(luma(c.rgb)),c.a);` },
  'Color Pass': { params: [s('amount', 'Similarity', 0, 100, 25), col('keep', 'Color', '#ff0000'), chk('reverse', 'Reverse')],
    body: `vec4 c=S(uv); float d=distance(c.rgb,keep)/1.7321; float m=1.-smoothstep(amount/100.,amount/100.+0.05,d); if(reverse>0.5) m=1.-m; o=vec4(mix(vec3(luma(c.rgb)),c.rgb,m),c.a);` },
  'Color Replace': { params: [s('sim', 'Similarity', 0, 100, 30), chk('solid', 'Solid Colors'), col('target', 'Target Color', '#ffffff'), col('repl', 'Replace Color', '#ff0000')],
    body: `vec4 c=S(uv); float m=1.-smoothstep(sim/100.,sim/100.+0.05,distance(c.rgb,target)/1.7321); vec3 r=solid>0.5?repl:repl*luma(c.rgb)/max(luma(target),0.1); o=vec4(mix(c.rgb,r,m),c.a);` },
  'Gamma Correction': { params: [s('gamma', 'Gamma', 1, 28, 10, 1)], body: `vec4 c=S(uv); o=vec4(pow(c.rgb,vec3(10./gamma)),c.a);` },

  // ---------------- Immersive Video (equirectangular 360: wrap-around sampling, latitude-corrected radii, Frame Layout) ----------------
  'VR Chromatic Aberrations': PRO_FX['VR Chromatic Aberrations'],
  'VR Color Gradients': PRO_FX['VR Color Gradients'],
  'VR De-Noise': PRO_FX['VR De-Noise'],
  'VR Glow': PRO_FX['VR Glow'],
  'VR Plane to Sphere': PRO_FX['VR Plane to Sphere'],

  // ---------------- Keying ----------------
  'Alpha Adjust': { params: [s('opacity', 'Opacity', 0, 100, 100), chk('ignore', 'Ignore Alpha'), chk('invert', 'Invert Alpha'), chk('mask', 'Mask Only')],
    body: `vec4 c=S(uv); float a=ignore>0.5?1.:c.a; if(invert>0.5) a=1.-a; a*=opacity/100.; o=mask>0.5?vec4(vec3(a),1.):vec4(c.rgb,a);` },
  'Color Key': { params: [col('key', 'Key Color', '#00ff00'), s('tol', 'Color Tolerance', 0, 255, 60), s('edge', 'Edge Thin', -5, 5, 0), s('feather', 'Edge Feather', 0, 10, 1)],
    body: `vec4 c=S(uv); float d=distance(c.rgb,key)*255.; float m=smoothstep(tol,tol+feather*20.+1.,d+edge*8.); o=vec4(c.rgb,c.a*m);` },
  'Difference Matte': PRO_FX['Difference Matte'],
  'Image Matte Key': { matte: true, params: [med('image', 'Matte Image'), sel('mode', 'Composite Using', ['Matte Alpha', 'Matte Luma']), chk('reverse', 'Reverse')], body: `o=S(uv);` },
  'Luma Key': { params: [sel('type', 'Key Type', ['Key Out Brighter', 'Key Out Darker']), s('thresh', 'Threshold', 0, 100, 50), s('cutoff', 'Cutoff', 0, 100, 0)],
    body: `vec4 c=S(uv); float l=luma(c.rgb); float t=thresh/100.; float m=type<0.5?1.-smoothstep(t,t+cutoff/100.+0.02,l):smoothstep(t-cutoff/100.-0.02,t,l); o=vec4(c.rgb,c.a*m);` },
  'Non Red Key': { params: [s('thresh', 'Threshold', 0, 100, 40), s('cutoff', 'Cutoff', 0, 100, 10), s('defringe', 'Defringe', 0, 100, 0)],
    body: `vec4 c=S(uv); float k=c.b-c.r; float m=1.-smoothstep(thresh/100.,thresh/100.+cutoff/100.+0.01,max(k,c.g-c.r)); o=vec4(c.rgb,c.a*m);` },
  'Track Matte Key': { matte: true, params: [trk('track', 'Matte'), sel('mode', 'Composite Using', ['Matte Alpha', 'Matte Luma']), chk('reverse', 'Reverse')], body: `o=S(uv);` },
  // applied on the source frame by the compositor (mask from MediaPipe Selfie Segmenter, Services/segment.js)
  'Remove Background': { status: 'builtin', params: [s('threshold', 'Threshold', 0, 100, 50), s('feather', 'Feather', 0, 20, 3), s('choke', 'Choke', -10, 10, 0), chk('invert', 'Invert')] },
  'Ultra Key': { params: [col('key', 'Key Color', '#00ff00'), sel('outMode', 'Output', ['Composite', 'Alpha Channel', 'Color Channel']), s('transp', 'Transparency', 0, 100, 45), s('highlight', 'Highlight', 0, 100, 10), s('shadow', 'Shadow', 0, 100, 50), s('tol', 'Tolerance', 0, 100, 50), s('pedestal', 'Pedestal', 0, 100, 0), s('spill', 'Spill Suppression', 0, 100, 25)],
    body: `vec4 c=S(uv); vec3 hk=rgb2hsv(key); vec3 hc=rgb2hsv(c.rgb); float dh=abs(hc.x-hk.x); dh=min(dh,1.-dh); float dist=dh*2.+abs(hc.y-hk.y)*0.5*(1.-pedestal/200.); float m=smoothstep((100.-transp)/200.,(100.-transp)/200.+tol/150.+0.01,dist); if(hc.z>0.8) m=max(m,highlight/100.*hc.z); if(hc.z<0.25) m=max(m,shadow/100.*(1.-hc.z*4.)*0.2); vec3 r=c.rgb; float ks=dot(normalize(key+0.001),vec3(1.)); if(m<1.) r=mix(r,vec3(luma(r)),(1.-m)*spill/100.); o=outMode<0.5?vec4(r,c.a*m):outMode<1.5?vec4(vec3(m),1.):vec4(r,1.);` },

  // ---------------- Noise & Grain ----------------
  'Add Noise': { params: [s('amount', 'Amount of Noise', 0, 100, 10), chk('color', 'Use Color Noise', true), chk('clip', 'Clip Result Values', true)],
    body: `vec4 c=S(uv); vec2 p=uv*u_res+u_time*61.; vec3 n=color>0.5?vec3(hash(p),hash(p+3.1),hash(p+6.7)):vec3(hash(p)); o=vec4(c.rgb+(n-0.5)*amount/50.,c.a);` },
  'Dust & Scratches': { params: [s('radius', 'Radius', 0, 20, 2), s('thresh', 'Threshold', 0, 255, 20)],
    body: `vec2 px=1./u_res*radius; vec4 c=S(uv); vec4 m=(S(uv+vec2(px.x,0.))+S(uv-vec2(px.x,0.))+S(uv+vec2(0.,px.y))+S(uv-vec2(0.,px.y)))*0.25; o=abs(luma(c.rgb-m.rgb))*255.>thresh?m:c;` },
  'Median': { params: [s('radius', 'Radius', 0, 20, 1)],
    body: `vec2 px=1./u_res*max(radius,0.5); vec3 v[9]; int k=0; for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ v[k++]=S(uv+vec2(x,y)*px).rgb; } for(int i=0;i<9;i++) for(int j=i+1;j<9;j++){ if(luma(v[j])<luma(v[i])){ vec3 t=v[i]; v[i]=v[j]; v[j]=t; } } o=vec4(v[4],S(uv).a);` },
  'Noise': { params: [s('amount', 'Amount of Noise', 0, 100, 20), chk('color', 'Use Color Noise', true)], body: `vec4 c=S(uv); vec2 p=uv*u_res*0.5+u_time*37.; vec3 n=color>0.5?vec3(hash(p),hash(p+1.3),hash(p+2.9)):vec3(hash(p)); o=vec4(mix(c.rgb,n,amount/200.),c.a);` },
  'Noise Alpha': { params: [s('amount', 'Amount', 0, 100, 30)], body: `vec4 c=S(uv); o=vec4(c.rgb,c.a*(1.-hash(uv*u_res+u_time*13.)*amount/100.));` },

  // ---------------- Perspective ----------------
  'Basic 3D': { params: [s('swivel', 'Swivel', -90, 90, 0), s('tilt', 'Tilt', -90, 90, 0), s('dist', 'Distance to Image', 0, 200, 0), chk('spec', 'Specular Highlight')],
    body: `float sw=radians(swivel), tl=radians(tilt); vec2 p=(uv-0.5)*vec2(u_res.x/u_res.y,1.); float z0=1.+dist/100.; vec3 ro=vec3(0.,0.,-2.*z0); vec3 rd=normalize(vec3(p,1.8)); mat3 R=mat3(cos(sw),0.,-sin(sw),0.,1.,0.,sin(sw),0.,cos(sw))*mat3(1.,0.,0.,0.,cos(tl),sin(tl),0.,-sin(tl),cos(tl)); vec3 n=R*vec3(0.,0.,-1.); float den=dot(rd,n); if(abs(den)<1e-4){ o=vec4(0.); } else { float t=dot(-ro,n)/den; vec3 hit=ro+rd*t; vec3 loc=transpose(R)*hit; vec2 st=loc.xy/vec2(u_res.x/u_res.y,1.)+0.5; o=(t<0.||st.x<0.||st.x>1.||st.y<0.||st.y>1.)?vec4(0.):S(st); if(spec>0.5) o.rgb+=0.2*pow(max(dot(n,normalize(vec3(0.3,0.5,-1.))),0.),20.); }` },
  'Bevel Alpha': PRO_FX['Bevel Alpha'],
  'Bevel Edges': PRO_FX['Bevel Edges'],
  'Drop Shadow': { params: [col('color', 'Shadow Color', '#000000'), s('opacity', 'Opacity', 0, 100, 50), s('dir', 'Direction', -360, 360, 135), s('dist', 'Distance', 0, 300, 10), s('soft', 'Softness', 0, 300, 20), chk('only', 'Shadow Only')],
    body: `vec4 c=S(uv); float a=radians(dir-90.); vec2 off=vec2(sin(a),-cos(a))*dist*${SC}/u_res; float sa=0.; float w=0.; for(int i=-4;i<=4;i++) for(int j=-4;j<=4;j++){ float k=exp(-float(i*i+j*j)/10.); sa+=S(uv-off+vec2(i,j)*soft*${SC}/u_res*0.25).a*k; w+=k; } sa=sa/w*opacity/100.; vec3 r=mix(color,c.rgb,c.a); float oa=c.a+sa*(1.-c.a); o=only>0.5?vec4(color,sa):vec4(r,oa);` },
  'Radial Shadow': PRO_FX['Radial Shadow'],

  // ---------------- Stylize ----------------
  'Alpha Glow': { params: [s('glow', 'Glow', 0, 255, 10), s('bright', 'Brightness', 0, 255, 255), col('start', 'Start Color', '#ffffff'), col('end', 'End Color', '#ff8800'), s('fade', 'Fade Out', 0, 1, 1, 1)],
    body: `vec4 c=S(uv); float a=0.; float w=0.; for(int i=0;i<24;i++){ float an=float(i)*0.2618; for(int j=1;j<4;j++){ float r=float(j)*glow*${SC}/3.; a+=S(uv+vec2(cos(an),sin(an))*r/u_res).a; w+=1.; } } a/=w; vec3 g=mix(start,end,a)*bright/255.; float ga=a*(1.-c.a); o=vec4(mix(c.rgb,g,ga/max(c.a+ga,0.001)),clamp(c.a+ga,0.,1.));` },
  'Brush Strokes': PRO_FX['Brush Strokes'],
  'Color Emboss': { params: [s('dir', 'Direction', -360, 360, 45), s('relief', 'Relief', 0, 10, 1), s('contrast', 'Contrast', 0, 200, 100)],
    body: `float a=radians(dir); vec2 d=vec2(cos(a),sin(a))/u_res; vec4 c=S(uv); vec3 e=S(uv+d).rgb-S(uv-d).rgb; o=vec4(c.rgb*0.5+e*relief*contrast/100.,c.a);` },
  'Emboss': { params: [s('dir', 'Direction', -360, 360, 45), s('relief', 'Relief', 0, 10, 1), s('contrast', 'Contrast', 0, 200, 100)],
    body: `float a=radians(dir); vec2 d=vec2(cos(a),sin(a))/u_res; vec4 c=S(uv); float e=luma(S(uv+d).rgb)-luma(S(uv-d).rgb); o=vec4(vec3(0.5+e*relief*contrast/100.),c.a);` },
  'Find Edges': { params: [chk('invert', 'Invert'), s('blend', 'Blend With Original', 0, 100, 0)],
    body: `vec2 px=1./u_res; vec4 c=S(uv); float tl=luma(S(uv+vec2(-px.x,px.y)).rgb), t=luma(S(uv+vec2(0.,px.y)).rgb), tr=luma(S(uv+px).rgb), l=luma(S(uv-vec2(px.x,0.)).rgb), r=luma(S(uv+vec2(px.x,0.)).rgb), bl=luma(S(uv-px).rgb), b=luma(S(uv-vec2(0.,px.y)).rgb), br=luma(S(uv+vec2(px.x,-px.y)).rgb); float gx=-tl-2.*l-bl+tr+2.*r+br, gy=-tl-2.*t-tr+bl+2.*b+br; float e=clamp(length(vec2(gx,gy)),0.,1.); vec3 rr=invert>0.5?vec3(e):vec3(1.-e); o=vec4(mix(rr,c.rgb,blend/100.),c.a);` },
  'Mosaic': { params: [s('h', 'Horizontal Blocks', 1, 200, 10, 1), s('v', 'Vertical Blocks', 1, 200, 10, 1), chk('sharp', 'Sharp Colors')],
    body: `vec2 g=vec2(h,v); vec2 p=(floor(uv*g)+0.5)/g; o=S(p);` },
  'Posterize': { params: [s('level', 'Level', 2, 64, 6, 1)], body: `vec4 c=S(uv); o=vec4(floor(c.rgb*level)/(level-1.),c.a);` },
  'Replicate': { params: [s('count', 'Count', 1, 16, 2, 1)], body: `float n=floor(count); o=S(fract(uv*n));` },
  'Roughen Edges': PRO_FX['Roughen Edges'],
  'Solarize': { params: [s('thresh', 'Threshold', 0, 100, 50)], body: `vec4 c=S(uv); vec3 r=c.rgb; float t=thresh/100.; o=vec4(mix(r,1.-r,step(t,r)),c.a);` },
  'Strobe Light': { params: [col('color', 'Strobe Color', '#ffffff'), s('dur', 'Strobe Duration (secs)', 0, 5, 0.1), s('period', 'Strobe Period (secs)', 0.05, 5, 1)],
    body: `vec4 c=S(uv); float on=step(mod(u_time,period),dur); o=vec4(mix(c.rgb,color,on),c.a);` },
  'Texturize': PRO_FX['Texturize'],
  'Threshold': { params: [s('level', 'Level', 0, 255, 128)], body: `vec4 c=S(uv); o=vec4(vec3(step(level/255.,luma(c.rgb))),c.a);` },

  // ---------------- Time ----------------
  'Echo': { special: true, params: [s('time', 'Echo Time (seconds)', -1, 1, -0.1, 0.01), s('num', 'Number of Echoes', 1, 8, 3, 1), s('start', 'Starting Intensity', 0, 1, 1), s('decay', 'Decay', 0, 1, 0.6), sel('op', 'Echo Operator', ['Add', 'Maximum', 'Screen', 'Composite in Back', 'Composite in Front'])], body: `o=S(uv);` },
  'Posterize Time': { status: 'time', params: [s('fps', 'Frame Rate', 1, 60, 8, 1)], body: `o=S(uv);` },
  'Time Warp': { status: 'time', params: [s('speed', 'Speed (%)', 0, 1000, 100)], body: `o=S(uv);` },

  // ---------------- Transform ----------------
  'Auto Reframe': { special: true, analyze: 'reframe', params: [sel('ratio', 'Aspect Ratio', ['Vertical 9:16', 'Square 1:1', 'Horizontal 16:9', 'Vertical 4:5']), sel('motion', 'Motion Tracking', ['Slower motion', 'Default', 'Faster motion'], 1)], body: `o=S(uv);` },
  'Crop': { params: [s('l', 'Left', 0, 100, 0), s('t', 'Top', 0, 100, 0), s('r', 'Right', 0, 100, 0), s('b', 'Bottom', 0, 100, 0), chk('zoom', 'Zoom'), s('feather', 'Edge Feather', 0, 100, 0)],
    body: `vec4 c=S(uv); vec2 q=uv; if(zoom>0.5){ float x0=l/100.,x1=1.-r/100.,y0=b/100.,y1=1.-t/100.; q=vec2(mix(x0,x1,uv.x),mix(y0,y1,uv.y)); c=S(q); o=c; } else { float f=feather*0.002+0.0005; float m=smoothstep(l/100.,l/100.+f,uv.x)*smoothstep(r/100.,r/100.+f,1.-uv.x)*smoothstep(b/100.,b/100.+f,uv.y)*smoothstep(t/100.,t/100.+f,1.-uv.y); o=vec4(c.rgb,c.a*m); }` },
  'Edge Feather': { params: [s('amount', 'Amount', 0, 100, 20)], body: `vec4 c=S(uv); float f=amount/200.+0.0005; vec2 d=min(uv,1.-uv); float m=smoothstep(0.,f,d.x)*smoothstep(0.,f,d.y); o=vec4(c.rgb,c.a*m);` },
  'Horizontal Flip': { params: [], body: `o=S(vec2(1.-uv.x,uv.y));` },
  'Vertical Flip': { params: [], body: `o=S(vec2(uv.x,1.-uv.y));` },

  // ---------------- Utility ----------------
  'Cineon Converter': { params: [sel('type', 'Conversion Type', ['Linear to Log', 'Log to Linear', 'Over Range']), s('black', '10 Bit Black Point', 0, 1023, 95, 1), s('white', '10 Bit White Point', 0, 1023, 685, 1), s('gamma', 'Gamma', 0.1, 4, 1)],
    body: `vec4 c=S(uv); vec3 r=c.rgb; float bp=black/1023., wp=white/1023.; if(type<0.5){ r=(log(max(r,0.0001)*(1.-0.0108)+0.0108)/log(10.)*0.2+0.6); r=clamp((r-bp)/(wp-bp),0.,1.); } else { r=bp+r*(wp-bp); r=(pow(vec3(10.),(r-0.6)/0.2)-0.0108)/(1.-0.0108); } o=vec4(pow(max(r,0.),vec3(1./gamma)),c.a);` },
};

/** Built-in Lumetri pass (clip.lumetri). Numeric params are float uniforms; `curves` / `lut` are objects handled by the compositor. */
export const LUMETRI_DEFAULTS = {
  temperature: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 100,
  fade: 0, vibrance: 0, sharpen: 0, lutAmt: 100,
  liftR: 0, liftG: 0, liftB: 0, gammaR: 0, gammaG: 0, gammaB: 0, gainR: 0, gainG: 0, gainB: 0,
  hslOn: 0, hslHLo: 0, hslHHi: 360, hslSLo: 0, hslSHi: 100, hslLLo: 0, hslLHi: 100, hslFeather: 20, hslHue: 0, hslSat: 0, hslLum: 0, hslMask: 0,
  vigAmount: 0, vigMid: 50, vigRound: 0, vigFeather: 50,
};
export const LUMETRI_EXTRA_UNIFORMS = `uniform sampler2D u_curves; uniform float u_curvesOn; uniform sampler2D u_lut; uniform float u_lutOn; uniform float u_lutN; uniform sampler2D u_ilut; uniform float u_ilutOn; uniform float u_ilutN;
float cv(float x,float row){ return texture(u_curves,vec2(clamp(x,0.,1.)*(255./256.)+0.5/256.,(row+0.5)/5.)).r; }
vec3 lut3(sampler2D t, float N, vec3 c){ vec3 s=clamp(c,0.,1.)*(N-1.); float b0=floor(s.b), b1=min(b0+1.,N-1.), fb=s.b-b0;
  vec3 l0=texture(t,vec2((b0*N+s.r+0.5)/(N*N),(s.g+0.5)/N)).rgb; vec3 l1=texture(t,vec2((b1*N+s.r+0.5)/(N*N),(s.g+0.5)/N)).rgb; return mix(l0,l1,fb); }
vec3 lutSample(vec3 c){ return lut3(u_lut,u_lutN,c); }`;
export const LUMETRI_BODY = `
vec4 c=S(uv); vec3 r=c.rgb;
if(u_ilutOn>0.5) r=lut3(u_ilut,u_ilutN,r);
r*=exp2(exposure); r.r+=temperature/400.; r.b-=temperature/400.; r.g+=tint/400.;
float l=luma(r);
r+=(highlights/200.)*smoothstep(0.5,1.,l)+(shadows/200.)*(1.-smoothstep(0.,0.5,l));
r+=(whites/300.)*smoothstep(0.75,1.,l)+(blacks/300.)*(1.-smoothstep(0.,0.25,l));
r=(r-0.5)*(1.+contrast/100.)+0.5;
r=mix(r,vec3(0.5)*0.5+r*0.5,fade/100.*0.5);
if(u_curvesOn>0.5){ r=clamp(r,0.,1.); r=vec3(cv(r.r,0.),cv(r.g,0.),cv(r.b,0.)); r=vec3(cv(r.r,1.),cv(r.g,2.),cv(r.b,3.)); vec3 hh=rgb2hsv(r); hh.y=clamp(hh.y*cv(hh.x,4.)*2.,0.,1.); r=hsv2rgb(hh); }
vec3 lift=vec3(liftR,liftG,liftB)/200., gam=vec3(gammaR,gammaG,gammaB)/200., gn=vec3(gainR,gainG,gainB)/200.;
r=r+lift*(1.-r); r=pow(max(r,0.),vec3(1.)-gam); r*=1.+gn;
vec3 h=rgb2hsv(clamp(r,0.,1.)); h.y=clamp(h.y*(saturation/100.)+vibrance/100.*(1.-h.y)*h.y*2.,0.,1.); r=hsv2rgb(h);
if(hslOn>0.5){
  vec3 q=rgb2hsv(clamp(r,0.,1.)); float hd=q.x*360.; float f=hslFeather/100.*30.+0.001;
  float mh=hslHLo<=hslHHi ? smoothstep(hslHLo-f,hslHLo,hd)*(1.-smoothstep(hslHHi,hslHHi+f,hd)) : max(smoothstep(hslHLo-f,hslHLo,hd),1.-smoothstep(hslHHi,hslHHi+f,hd));
  float ms=smoothstep(hslSLo-f/3.,hslSLo,q.y*100.)*(1.-smoothstep(hslSHi,hslSHi+f/3.,q.y*100.));
  float ml=smoothstep(hslLLo-f/3.,hslLLo,q.z*100.)*(1.-smoothstep(hslLHi,hslLHi+f/3.,q.z*100.));
  float mk=mh*ms*ml;
  if(hslMask>0.5){ o=vec4(vec3(mk),c.a); return; }
  q.x=fract(q.x+mk*hslHue/360.); q.y=clamp(q.y*(1.+mk*hslSat/100.),0.,1.); q.z=clamp(q.z+mk*hslLum/100.,0.,1.); r=hsv2rgb(q);
}
if(sharpen!=0.){ vec2 px=1./u_res; vec3 b=(S(uv+vec2(px.x,0.)).rgb+S(uv-vec2(px.x,0.)).rgb+S(uv+vec2(0.,px.y)).rgb+S(uv-vec2(0.,px.y)).rgb)*0.25; r+=(c.rgb-b)*sharpen/50.; }
if(u_lutOn>0.5){ vec3 lk=lutSample(r); r=mix(r,lk,lutAmt/100.); }
float d=length((uv-0.5)*vec2(mix(1.,u_res.x/u_res.y,vigRound<0.?0.:vigRound/100.),1.))*1.414;
float vg=smoothstep(vigMid/100.*0.9,vigMid/100.*0.9+vigFeather/100.+0.01,d);
r*=1.-clamp(-vigAmount/100.,0.,1.)*vg; r+=clamp(vigAmount/100.,0.,1.)*vg;
o=vec4(r,c.a);`;
// round 2 effects (moreVideoFx.js / moreVideoFx2.js): a name already used by a Premiere effect keeps the Premiere one
for (const items of Object.values(MORE_VIDEO_FX)) for (const [name, def] of Object.entries(items)) if (!VIDEO_FX[name]) VIDEO_FX[name] = def;
export const effectDef = (name) => VIDEO_FX[name];
export const defaultParams = (name) => {
  const out = {};
  for (const p of VIDEO_FX[name]?.params || []) out[p.id] = { v: p.def, keys: null };
  return out;
};
