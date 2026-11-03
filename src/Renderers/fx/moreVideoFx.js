// Video effects added in round 2 (docs/PROMPT_FIX_ROUND2.md E2/E3), all written for EditorStage (source 'own').
// Same shape as VIDEO_FX entries (see videoEffects.js / premiereFx.js): { params, body, passes?, src?, fns?, layer?, text? }.
// body: GLSL in main(); reads S(p) (input / previous pass), u_time (clip time, seconds), u_res; writes o. Points are stored
// y-down (flip with 1.-y). text(vals, info) -> string: the compositor draws it into u_layer (read with L(p)).
import { s, sel, chk, pt, col, trk, SC } from './fxParams';
import { MORE_VIDEO_FX_2 } from './moreVideoFx2';

const txt = (id, label, def = '') => ({ id, label, type: 'text', def });
const amt = (def = 50, label = 'Amount', max = 100) => s('amount', label, 0, max, def);
const seed = () => s('seed', 'Random Seed', 0, 100, 1);
const ctr = (id = 'center', label = 'Center') => pt(id, label);
const ASP = 'vec2(u_res.x/u_res.y,1.)';
// three passes: bright parts blurred (H, V) from the source, then `comp` mixes SRC(uv) (c) and the glow (g)
const glow3 = (bright, radius, comp) => `float R=${radius}*${SC};
  if(u_pass<0.5){ vec4 a=vec4(0.); float w=0.; for(int i=-12;i<=12;i++){ float f=float(i)/12.; float k=exp(-f*f*2.5); vec4 x=SRC(uv+vec2(f*R/u_res.x,0.)); float l=luma(x.rgb); x.rgb*=${bright}; a+=x*k; w+=k; } o=a/w; }
  else if(u_pass<1.5){ o=blurDir(vec2(0.,1./u_res.y),R); }
  else { vec4 c=SRC(uv); vec3 g=S(uv).rgb; ${comp} }`;
const TEXT_PARAMS = () => [pt('pos', 'Position', 0.5, 0.88), s('size', 'Size', 8, 300, 48), col('color', 'Text Color', '#ffffff'), s('bg', 'Background Opacity', 0, 100, 50), col('bgColor', 'Background Color', '#000000')];
const TEXT_BODY = 'vec4 c=S(uv); vec4 t=L(uv); o=vec4(mix(c.rgb,t.rgb,t.a),max(c.a,t.a));';

export const MORE_VIDEO_FX = {
  // ---------------- Premiere Pro effects that were missing ----------------
  'Video': {
    'Clip Name': { params: [...TEXT_PARAMS(), sel('show', 'Display', ['Clip Name', 'File Name'])], body: TEXT_BODY, text: (v, i) => (v.show >= 1 ? i.fileName : i.clipName) || '' },
    'Simple Text': { params: [txt('text', 'Text', 'Text'), ...TEXT_PARAMS()], body: TEXT_BODY, text: (v) => String(v.text ?? '') },
    'Timecode': { params: [...TEXT_PARAMS(), sel('source', 'Time Display', ['Media', 'Sequence', 'Clip']), s('offset', 'Offset (frames)', -100000, 100000, 0, 1), sel('fmt', 'Format', ['Timecode', 'Frames', 'Seconds'])],
      body: TEXT_BODY, text: (v, i) => i.timecode(v.source, v.offset, v.fmt) },
    'SDR Conform': { params: [s('bright', 'Brightness', -100, 100, 0), s('contrast', 'Contrast', -100, 100, 0), s('knee', 'Soft Knee', 0, 100, 60), s('sat', 'Saturation', 0, 200, 100)],
      body: `vec4 c=S(uv); vec3 r=c.rgb*exp2(bright/60.); float l=luma(r); float k=0.4+knee/250.; float lm=l<k?l:k+(1.-k)*(1.-exp(-(l-k)/(1.-k))); r*=lm/max(l,1e-5);
        r=(r-.5)*(1.+contrast/150.)+.5; vec3 h=rgb2hsv(clamp(r,0.,1.)); h.y*=sat/100.; o=vec4(hsv2rgb(clamp(h,0.,1.)),c.a);` },
  },
  'Transition': {
    'Block Dissolve': { params: [s('done', 'Transition Completion', 0, 100, 0), s('bw', 'Block Width', 1, 400, 20), s('bh', 'Block Height', 1, 400, 20), s('feather', 'Feather', 0, 100, 0), chk('softEdges', 'Soft Edges (Best Quality)', true)],
      body: `vec4 c=S(uv); vec2 cell=vec2(bw,bh)*${SC}; vec2 g=floor(uv*u_res/cell); float h=hash(g); float f=feather/400.+(softEdges>0.5?0.01:0.); float keep=smoothstep(done/100.-f,done/100.+f,h*(1.-2.*f)+f); if(done>=100.) keep=0.; o=vec4(c.rgb,c.a*keep);` },
    'Gradient Wipe': { layer: 'layer', params: [s('done', 'Transition Completion', 0, 100, 0), s('soft', 'Transition Softness', 0, 100, 0), trk('layer', 'Gradient Layer'), chk('invert', 'Invert Gradient')],
      body: `vec4 c=S(uv); float g=u_hasLayer>0.5?luma(L(uv).rgb):1.-uv.y; if(invert>0.5) g=1.-g; float sf=soft/100.; float t=done/100.*(1.+sf); o=vec4(c.rgb,c.a*smoothstep(t-sf,t,g+1e-4));` },
    'Linear Wipe': { params: [s('done', 'Transition Completion', 0, 100, 0), s('angle', 'Wipe Angle', -360, 360, 90), s('feather', 'Feather', 0, 500, 0)],
      body: `vec4 c=S(uv); float a=radians(angle-90.); vec2 d=vec2(cos(a),-sin(a)); vec2 q=(uv-.5)*u_res; float span=abs(d.x)*u_res.x+abs(d.y)*u_res.y; float x=dot(q,d)/span+.5;
        float f=feather*${SC}/span; float t=done/100.*(1.+f); o=vec4(c.rgb,c.a*smoothstep(t-f,t,x+1e-5));` },
    'Radial Wipe': { params: [s('done', 'Transition Completion', 0, 100, 0), s('start', 'Start Angle', -360, 360, 0), ctr('center', 'Wipe Center'), sel('way', 'Wipe', ['Clockwise', 'Counterclockwise', 'Both']), s('feather', 'Feather', 0, 100, 0)],
      body: `vec4 c=S(uv); vec2 q=(uv-vec2(center.x,1.-center.y))*${ASP}; float an=atan(q.x,q.y)-radians(start); float f=fract(an/6.2831853); if(way>0.5&&way<1.5) f=1.-f; if(way>1.5) f=abs(f-.5)*2.; f=1.-f;
        float sf=feather/200.; float t=done/100.*(1.+sf); o=vec4(c.rgb,c.a*smoothstep(t-sf,t,1.-f+1e-5));` },
    'Venetian Blinds': { params: [s('done', 'Transition Completion', 0, 100, 0), s('angle', 'Direction', -360, 360, 0), s('width', 'Width', 1, 500, 40), s('feather', 'Feather', 0, 100, 0)],
      body: `vec4 c=S(uv); float a=radians(angle); vec2 d=vec2(sin(a),cos(a)); float x=fract(dot((uv-.5)*u_res,d)/(width*${SC})); float sf=feather/200.; float t=done/100.*(1.+sf); o=vec4(c.rgb,c.a*smoothstep(t-sf,t,x+1e-5));` },
  },
  'Immersive Video': {
    'VR Blur': { params: [s('blur', 'Blurriness', 0, 100, 10), sel('frameLayout', 'Frame Layout', ['Monoscopic', 'Stereoscopic - Over/Under', 'Stereoscopic - Side by Side'])], passes: 2,
      body: `float r=blur*0.5*${SC}; if(u_pass<0.5){ float sx=1./max(.15,cos((uv.y-.5)*3.1415927)); vec4 a=vec4(0.); float w=0.; for(int i=-12;i<=12;i++){ float f=float(i)/12.; float k=exp(-f*f*2.5); a+=S(vec2(fract(uv.x+f*r*sx/u_res.x),uv.y))*k; w+=k; } o=a/w; } else o=blurDir(vec2(0.,1./u_res.y),r);` },
    'VR Digital Glitch': { params: [s('master', 'Master Amplitude', 0, 100, 30), s('rate', 'Distortion Rate', 0, 100, 40), s('block', 'Block Size', 4, 200, 40), seed()],
      body: `float t=floor(u_time*(2.+rate/4.)); vec2 g=floor(uv*u_res/(block*${SC})); float on=step(1.-master/150.,hash(g+t+seed)); vec2 off=(vec2(hash(g*1.7+t),hash(g*2.3-t))-.5)*0.15*on*master/50.;
        vec2 p=vec2(fract(uv.x+off.x),clamp(uv.y+off.y,0.,1.)); vec4 c=S(p); float sh=on*master*0.0004; o=vec4(S(vec2(fract(p.x+sh),p.y)).r,c.g,S(vec2(fract(p.x-sh),p.y)).b,c.a);` },
    'VR Fractal Noise': { params: [s('contrast', 'Contrast', 0, 400, 100), s('bright', 'Brightness', -100, 100, 0), s('scale', 'Scale', 1, 400, 100), s('evo', 'Evolution', -3600, 3600, 0), s('opacity', 'Opacity', 0, 100, 100), sel('blend', 'Blending Mode', ['None', 'Multiply', 'Screen', 'Overlay', 'Add'])],
      fns: `float h3(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
        float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }`,
      body: `vec3 d=vrDir(uv)*400./scale+vec3(0.,0.,evo/90.); float a=0.5, n=0.; for(int i=0;i<6;i++){ n+=a*n3(d); d=d*2.02+vec3(5.3); a*=.5; } n=clamp((n/0.98-.5)*contrast/100.+.5+bright/100.,0.,1.);
        vec4 c=S(uv); vec3 nn=vec3(n); vec3 r=blend<0.5?nn:blend<1.5?c.rgb*nn:blend<2.5?1.-(1.-c.rgb)*(1.-nn):blend<3.5?mix(2.*c.rgb*nn,1.-2.*(1.-c.rgb)*(1.-nn),step(.5,c.rgb)):min(c.rgb+nn,1.); o=vec4(mix(c.rgb,r,opacity/100.),c.a);` },
    'VR Projection': { params: [s('pan', 'Pan', -180, 180, 0), s('tilt', 'Tilt', -90, 90, 0), s('roll', 'Roll', -180, 180, 0), s('fov', 'Field of View', 20, 150, 90)],
      body: `vec2 q=(uv-.5)*vec2(u_res.x/u_res.y,1.)*2.*tan(radians(fov)*.5); vec3 d=normalize(vec3(q,1.)); float r=radians(roll), t=radians(tilt), p=radians(pan);
        d.xy=mat2(cos(r),sin(r),-sin(r),cos(r))*d.xy; d.yz=mat2(cos(t),sin(t),-sin(t),cos(t))*d.yz; d.xz=mat2(cos(p),-sin(p),sin(p),cos(p))*d.xz; o=S(vec2(fract(vrUV(d).x),vrUV(d).y));` },
    'VR Rotate Sphere': { params: [s('tilt', 'Tilt (X Axis)', -180, 180, 0), s('pan', 'Pan (Y Axis)', -180, 180, 0), s('roll', 'Roll (Z Axis)', -180, 180, 0)],
      body: `vec3 d=vrDir(uv); float r=radians(roll), t=radians(tilt), p=radians(pan); d.xy=mat2(cos(r),sin(r),-sin(r),cos(r))*d.xy; d.yz=mat2(cos(t),sin(t),-sin(t),cos(t))*d.yz; d.xz=mat2(cos(p),-sin(p),sin(p),cos(p))*d.xz; vec2 q=vrUV(d); o=S(vec2(fract(q.x),clamp(q.y,0.,1.)));` },
    'VR Sharpen': { params: [s('amount', 'Sharpen Amount', 0, 200, 50)],
      body: `vec2 px=1./u_res; float sx=1./max(.15,cos((uv.y-.5)*3.1415927)); vec4 c=S(uv); vec4 b=(S(vec2(fract(uv.x+px.x*sx),uv.y))+S(vec2(fract(uv.x-px.x*sx),uv.y))+S(uv+vec2(0.,px.y))+S(uv-vec2(0.,px.y)))*.25; o=vec4(clamp(c.rgb+(c.rgb-b.rgb)*amount/50.,0.,1.),c.a);` },
  },
  'Distort': {
    'Rolling Shutter Repair': { params: [s('rate', 'Rolling Shutter Rate (%)', -100, 100, 0), sel('scan', 'Scan Direction', ['Top to Bottom', 'Bottom to Top', 'Left to Right', 'Right to Left']), s('skewV', 'Vertical Correction', -100, 100, 0)],
      body: `float sg=(scan<0.5||scan>2.5)?1.:-1.; vec2 p=uv; if(scan<1.5){ float row=(1.-uv.y)-.5; p.x=uv.x-row*rate/400.*sg; p.y=.5+(uv.y-.5)*(1.+skewV/400.); } else { float c=uv.x-.5; p.y=uv.y+c*rate/400.*sg; p.x=.5+(uv.x-.5)*(1.+skewV/400.); } o=SZ(p);` },
    'Bulge': { params: [ctr(), s('radius', 'Radius', 1, 100, 30), s('height', 'Bulge Height', -100, 100, 50)],
      body: `vec2 c0=vec2(center.x,1.-center.y); vec2 q=(uv-c0)*${ASP}; float r=length(q)/(radius/100.); vec2 p=uv; if(r<1.){ float k=height>0.?mix(1.,smoothstep(0.,1.,r),height/100.):1.+(-height/100.)*(1.-r)*1.2; p=c0+(uv-c0)*k; } o=S(p);` },
    'Ripple': { params: [ctr(), s('amp', 'Amplitude', 0, 100, 20), s('wave', 'Wavelength', 1, 200, 40), s('speed', 'Speed', -20, 20, 2), s('decay', 'Fade Out', 0, 100, 30)],
      body: `vec2 c0=vec2(center.x,1.-center.y); vec2 q=(uv-c0)*${ASP}; float r=length(q)+1e-5; float k=sin(r*1000./wave-u_time*speed*6.283)*amp*0.0004*exp(-r*decay/20.); o=S(uv+q/r*k/${ASP});` },
    'Water Ripple': { params: [s('drops', 'Drops', 1, 20, 5), s('amp', 'Strength', 0, 100, 30), s('speed', 'Speed', 0, 10, 1), s('shine', 'Highlights', 0, 100, 30), seed()],
      body: `vec2 asp=${ASP}; vec2 off=vec2(0.); float hl=0.; for(int i=0;i<20;i++){ if(float(i)>=drops) break; float cyc=u_time*speed*0.4+hash(vec2(float(i),seed)); float ph=fract(cyc); vec2 c0=vec2(hash(vec2(floor(cyc),float(i)+seed)),hash(vec2(float(i)*3.,floor(cyc)+seed)));
        vec2 q=(uv-c0)*asp; float r=length(q)+1e-5; float ring=sin((r-ph*.6)*60.)*exp(-pow((r-ph*.6)*8.,2.))*(1.-ph); off+=q/r*ring; hl+=max(ring,0.); }
        vec4 c=S(uv+off*amp*0.0004/asp); o=vec4(min(c.rgb+hl*shine/150.,1.),c.a);` },
    'Heat Haze': { params: [s('amp', 'Strength', 0, 100, 25), s('scale', 'Scale', 1, 100, 30), s('speed', 'Rise Speed', 0, 10, 2), s('top', 'Height (%)', 0, 100, 100)],
      body: `float m=smoothstep(1.-top/100.-.1,1.-top/100.+.1,1.-uv.y); float n=noise2(vec2(uv.x*scale*.5,uv.y*scale-u_time*speed))-.5; float n2=noise2(vec2(uv.x*scale*1.3+7.,uv.y*scale*1.7-u_time*speed*1.4))-.5; o=S(uv+vec2(n,n2*.5)*amp*0.0006*m);` },
    'Kaleidoscope': { params: [s('segments', 'Segments', 2, 32, 6), s('angle', 'Rotation', -360, 360, 0), ctr(), s('zoom', 'Zoom', 10, 400, 100)],
      body: `vec2 c0=vec2(center.x,1.-center.y); vec2 q=(uv-c0)*${ASP}*100./zoom; float r=length(q); float a=atan(q.y,q.x)+radians(angle); float seg=6.2831853/segments; a=mod(a,seg); a=min(a,seg-a); vec2 p=c0+vec2(cos(a),sin(a))*r/${ASP}; o=S(abs(mod(p+1.,2.)-1.));` },
    'Polar Coordinates': { params: [s('interp', 'Interpolation', 0, 100, 100), sel('way', 'Type of Conversion', ['Rect to Polar', 'Polar to Rect'])],
      body: `vec2 p; if(way<0.5){ vec2 q=(uv-.5)*2.; float r=length(q); float a=atan(q.x,-q.y); p=vec2(a/6.2831853+.5,1.-r); } else { float a=(uv.x-.5)*6.2831853; float r=1.-uv.y; p=vec2(.5+sin(a)*r*.5,.5-cos(a)*r*.5); } o=SZ(mix(uv,p,interp/100.));` },
    'Fisheye': { params: [s('amount', 'Amount', -100, 100, 50), chk('fill', 'Zoom to Fill', true)],
      body: `vec2 q=(uv-.5)*${ASP}; float r=length(q); float k=amount/100.; float R=length(vec2(.5)*${ASP}); float rn=r/R; float rr=k>0.?tan(rn*atan(k*2.))/(k*2.):k<0.?atan(rn*-k*2.)/atan(-k*2.):rn; float z=fill>0.5&&k>0.?tan(atan(k*2.)*.62)/(k*2.)/.62:1.; vec2 p=.5+q/max(r,1e-5)*rr*R*z/${ASP}; o=SZ(p);` },
    'Glass Distortion': { params: [s('amount', 'Refraction', 0, 100, 40), s('scale', 'Pattern Scale', 1, 100, 20), s('evo', 'Evolution', 0, 100, 0)],
      body: `vec2 p=uv*scale*${ASP}*.5; float e=evo*.05; float n=noise2(p+e), nx=noise2(p+vec2(.05,0.)+e), ny=noise2(p+vec2(0.,.05)+e); vec2 g=vec2(nx-n,ny-n)*20.; vec4 c=S(uv+g*amount*0.0008); o=vec4(min(c.rgb+max(g.x+g.y,0.)*amount/800.,1.),c.a);` },
    'Shockwave': { params: [ctr(), s('radius', 'Wave Radius (%)', 0, 150, 30), s('width', 'Wave Width', 1, 100, 15), s('amp', 'Strength', 0, 100, 40), s('chroma', 'Chromatic Split', 0, 100, 20)],
      body: `vec2 c0=vec2(center.x,1.-center.y); vec2 q=(uv-c0)*${ASP}; float r=length(q)+1e-5; float x=(r-radius/100.)/(width/400.); float k=x*exp(-x*x)*amp*0.003; vec2 d=q/r*k/${ASP}; vec4 c=S(uv-d); o=vec4(S(uv-d*(1.+chroma/50.)).r,c.g,S(uv-d*(1.-chroma/50.)).b,c.a);` },
    'Motion Tile': { params: [ctr('center', 'Tile Center'), s('tw', 'Tile Width', 1, 100, 100), s('th', 'Tile Height', 1, 100, 100), s('ow', 'Output Width', 1, 500, 100), s('oh', 'Output Height', 1, 500, 100), chk('mirror', 'Mirror Edges'), s('phase', 'Phase', -360, 360, 0)],
      body: `vec2 c0=vec2(center.x,1.-center.y); vec2 q=(uv-.5)*vec2(ow,oh)/100.+.5; vec2 t=(q-c0)/(vec2(tw,th)/100.)+.5; float row=floor(t.y); t.x+=phase/360.*mod(row,2.); vec2 f=fract(t); if(mirror>0.5){ vec2 m=mod(floor(t),2.); f=mix(f,1.-f,m); } o=S(c0+(f-.5)*vec2(tw,th)/100.);` },
    'Mirror Quad': { params: [sel('mode', 'Layout', ['Four Quadrants', 'Left to Right', 'Right to Left', 'Top to Bottom', 'Bottom to Top'])],
      body: `vec2 p=uv; if(mode<0.5) p=vec2(uv.x<.5?uv.x*2.:2.-uv.x*2.,uv.y<.5?uv.y*2.:2.-uv.y*2.)*.5+.25; else if(mode<1.5) p.x=uv.x<.5?uv.x:1.-uv.x; else if(mode<2.5) p.x=uv.x>.5?uv.x:1.-uv.x; else if(mode<3.5) p.y=uv.y>.5?uv.y:1.-uv.y; else p.y=uv.y<.5?uv.y:1.-uv.y; o=S(p);` },
    'Displacement Map': { layer: 'layer', params: [trk('layer', 'Displacement Map Layer'), sel('chH', 'Use For Horizontal', ['Red', 'Green', 'Blue', 'Luminance']), s('maxH', 'Max Horizontal Displacement', -200, 200, 20), sel('chV', 'Use For Vertical', ['Red', 'Green', 'Blue', 'Luminance'], 1), s('maxV', 'Max Vertical Displacement', -200, 200, 20), chk('wrap', 'Wrap Pixels Around')],
      body: `if(u_hasLayer<0.5){ o=S(uv); return; } vec4 m=L(uv); float h=chH<0.5?m.r:chH<1.5?m.g:chH<2.5?m.b:luma(m.rgb); float v=chV<0.5?m.r:chV<1.5?m.g:chV<2.5?m.b:luma(m.rgb);
        vec2 p=uv+vec2((h-.5)*2.*maxH,-(v-.5)*2.*maxV)*${SC}/u_res; o=wrap>0.5?S(fract(p)):SZ(p);` },
    'Tiny Planet': { params: [s('zoom', 'Zoom', 10, 400, 100), s('spin', 'Rotation', -360, 360, 0), chk('invert', 'Tunnel (Inverted)')],
      body: `vec2 q=(uv-.5)*${ASP}*4.*100./zoom; float r=length(q); float lat=2.*atan(r*.5)-1.5707963; if(invert>0.5) lat=-lat; float lon=atan(q.y,q.x)+radians(spin); o=S(vec2(fract(lon/6.2831853+.5),clamp(lat/3.1415927+.5,0.,1.)));` },
    'Barrel Swirl': { params: [ctr(), s('radius', 'Radius', 1, 100, 50), s('angle', 'Twist', -1440, 1440, 180), s('pinch', 'Pinch', -100, 100, 0)],
      body: `vec2 c0=vec2(center.x,1.-center.y); vec2 q=(uv-c0)*${ASP}; float r=length(q)/(radius/100.); vec2 p=uv; if(r<1.){ float k=(1.-r)*(1.-r); q=vec2(q.x*cos(radians(angle)*k)-q.y*sin(radians(angle)*k),q.x*sin(radians(angle)*k)+q.y*cos(radians(angle)*k)); q*=1.+pinch/100.*k; p=c0+q/${ASP}; } o=S(p);` },
  },
  'Obsolete': {
    'Fast Color Corrector': { params: [s('hue', 'Hue Balance Angle', -180, 180, 0), s('mag', 'Balance Magnitude', 0, 100, 0), s('gain', 'Balance Gain', 0, 100, 50), s('sat', 'Saturation', 0, 200, 100), s('inB', 'Input Black Level', 0, 255, 0), s('inG', 'Input Gray Level', 0.1, 10, 1), s('inW', 'Input White Level', 0, 255, 255), s('outB', 'Output Black Level', 0, 255, 0), s('outW', 'Output White Level', 0, 255, 255)],
      body: `vec4 c=S(uv); float a=radians(hue); vec3 bal=vec3(cos(a),cos(a-2.0944),cos(a+2.0944))*mag/250.*(gain/50.); vec3 r=c.rgb+bal; vec3 h=rgb2hsv(clamp(r,0.,1.)); h.y=clamp(h.y*sat/100.,0.,1.); r=hsv2rgb(h);
        r=clamp((r-inB/255.)/max((inW-inB)/255.,1e-3),0.,1.); r=pow(r,vec3(1./inG)); o=vec4(mix(vec3(outB/255.),vec3(outW/255.),r),c.a);` },
    'Three-Way Color Corrector': { params: [s('sA', 'Shadows Angle', -180, 180, 0), s('sM', 'Shadows Magnitude', 0, 100, 0), s('mA', 'Midtones Angle', -180, 180, 0), s('mM', 'Midtones Magnitude', 0, 100, 0), s('hA', 'Highlights Angle', -180, 180, 0), s('hM', 'Highlights Magnitude', 0, 100, 0), s('sat', 'Master Saturation', 0, 200, 100), s('lvl', 'Master Gamma', 0.1, 4, 1)],
      fns: `vec3 tint3(float a, float m){ a=radians(a); return vec3(cos(a),cos(a-2.0944),cos(a+2.0944))*m/250.; }`,
      body: `vec4 c=S(uv); float l=luma(c.rgb); float ws=1.-smoothstep(0.,.5,l), wh=smoothstep(.5,1.,l), wm=1.-ws-wh; vec3 r=c.rgb+tint3(sA,sM)*ws+tint3(mA,mM)*wm+tint3(hA,hM)*wh; r=pow(clamp(r,0.,1.),vec3(1./lvl)); vec3 h=rgb2hsv(r); h.y=clamp(h.y*sat/100.,0.,1.); o=vec4(hsv2rgb(h),c.a);` },
    'RGB Curves': { params: [s('mLo', 'Master Shadows', -100, 100, 0), s('mMid', 'Master Midtones', -100, 100, 0), s('mHi', 'Master Highlights', -100, 100, 0), s('rMid', 'Red Midtones', -100, 100, 0), s('gMid', 'Green Midtones', -100, 100, 0), s('bMid', 'Blue Midtones', -100, 100, 0)],
      fns: `float cur3(float x, float lo, float mid, float hi){ float y0=lo/400., y1=.5+mid/400., y2=1.+hi/400.; float a=clamp(x,0.,1.); return a<.5?mix(y0,y1,smoothstep(0.,1.,a*2.)*.5+a):mix(y1,y2,(a-.5)*2.); }`,
      body: `vec4 c=S(uv); vec3 r=vec3(cur3(c.r,mLo,mMid,mHi),cur3(c.g,mLo,mMid,mHi),cur3(c.b,mLo,mMid,mHi)); r=vec3(cur3(r.r,0.,rMid,0.),cur3(r.g,0.,gMid,0.),cur3(r.b,0.,bMid,0.)); o=vec4(clamp(r,0.,1.),c.a);` },
    'Luma Curve': { params: [s('lo', 'Shadows', -100, 100, 0), s('mid', 'Midtones', -100, 100, 0), s('hi', 'Highlights', -100, 100, 0)],
      body: `vec4 c=S(uv); float l=luma(c.rgb); float a=clamp(l,0.,1.); float y=a+lo/300.*(1.-smoothstep(0.,.5,a))*(1.-a)+mid/300.*sin(a*3.1415927)+hi/300.*smoothstep(.5,1.,a)*a; o=vec4(clamp(c.rgb+(y-l),0.,1.),c.a);` },
    'Color Balance (HLS)': { params: [s('hue', 'Hue', -180, 180, 0), s('light', 'Lightness', -100, 100, 0), s('sat', 'Saturation', -100, 100, 0)],
      body: `vec4 c=S(uv); vec3 h=rgb2hsv(c.rgb); h.x=fract(h.x+hue/360.); h.y=clamp(h.y*(1.+sat/100.),0.,1.); vec3 r=hsv2rgb(h); r=light>0.?mix(r,vec3(1.),light/100.):r*(1.+light/100.); o=vec4(r,c.a);` },
    'RGB Color Corrector': { params: [s('gamma', 'Gamma', 0.1, 4, 1), s('pedestal', 'Pedestal', -100, 100, 0), s('gain', 'Gain', 0, 400, 100), s('rG', 'Red Gamma', 0.1, 4, 1), s('gG', 'Green Gamma', 0.1, 4, 1), s('bG', 'Blue Gamma', 0.1, 4, 1), s('rGain', 'Red Gain', 0, 400, 100), s('gGain', 'Green Gain', 0, 400, 100), s('bGain', 'Blue Gain', 0, 400, 100)],
      body: `vec4 c=S(uv); vec3 r=pow(clamp(c.rgb,0.,1.),vec3(1./gamma)/vec3(rG,gG,bG)); r=r*gain/100.*vec3(rGain,gGain,bGain)/100.+pedestal/200.; o=vec4(clamp(r,0.,1.),c.a);` },
    'Luma Corrector': { params: [s('bright', 'Brightness', -100, 100, 0), s('contrast', 'Contrast', -100, 100, 0), s('clevel', 'Contrast Level', 0, 100, 50), s('gamma', 'Gamma', 0.1, 4, 1), s('pedestal', 'Pedestal', -100, 100, 0), s('gain', 'Gain', 0, 400, 100)],
      body: `vec4 c=S(uv); float l=luma(c.rgb); float y=(l-clevel/100.)*(1.+contrast/100.)+clevel/100.+bright/200.; y=pow(clamp(y,0.,1.),1./gamma)*gain/100.+pedestal/200.; o=vec4(clamp(c.rgb+(y-l),0.,1.),c.a);` },
    'Shadow/Highlight': { params: [s('shadow', 'Shadow Amount', 0, 100, 35), s('highlight', 'Highlight Amount', 0, 100, 0), s('midC', 'Midtone Contrast', -100, 100, 0)], passes: 3, src: true,
      body: `float R=40.*${SC}; if(u_pass<0.5){ vec4 a=vec4(0.); float w=0.; for(int i=-12;i<=12;i++){ float f=float(i)/12.; float k=exp(-f*f*2.5); a+=vec4(vec3(luma(SRC(uv+vec2(f*R/u_res.x,0.)).rgb)),1.)*k; w+=k; } o=a/w; }
        else if(u_pass<1.5) o=blurDir(vec2(0.,1./u_res.y),R); else { vec4 c=SRC(uv); float lb=S(uv).r; vec3 r=c.rgb*(1.+shadow/60.*(1.-smoothstep(0.,.5,lb))*1.5)-highlight/150.*smoothstep(.5,1.,lb)*c.rgb; float l=luma(r); r+=(l-.5)*midC/200.; o=vec4(clamp(r,0.,1.),c.a); }` },
  },
  // ---------------- beyond Premiere ----------------
  'Glitch': {
    'RGB Split': { params: [s('amount', 'Split Distance', 0, 200, 10), s('angle', 'Angle', -180, 180, 0), chk('animate', 'Animate')],
      body: `float a=radians(angle); float k=amount*${SC}*(animate>0.5?(0.5+0.5*sin(u_time*7.)):1.); vec2 d=vec2(cos(a),sin(a))*k/u_res; vec4 c=S(uv); o=vec4(S(uv+d).r,c.g,S(uv-d).b,c.a);` },
    'Digital Glitch': { params: [amt(40, 'Intensity'), s('rate', 'Glitch Rate', 1, 30, 8), seed()],
      body: `float t=floor(u_time*rate); float row=floor(uv.y*30.); float on=step(1.-amount/120.,hash(vec2(row,t+seed))); float off=(hash(vec2(t,row+seed))-.5)*0.2*on; vec2 p=vec2(fract(uv.x+off),uv.y);
        float sh=on*0.01; vec4 c=S(p); vec3 r=vec3(S(p+vec2(sh,0.)).r,c.g,S(p-vec2(sh,0.)).b); if(on>0.5&&hash(vec2(t*1.3,row))>0.8) r=1.-r; o=vec4(r,c.a);` },
    'Block Glitch': { params: [s('block', 'Block Size', 4, 200, 32), amt(40), s('rate', 'Rate', 1, 30, 10), seed()],
      body: `float t=floor(u_time*rate); vec2 g=floor(uv*u_res/(block*${SC})); float on=step(1.-amount/150.,hash(g+t+seed)); vec2 off=(vec2(hash(g+t*1.3),hash(g-t))-.5)*0.1*on; vec4 c=S(uv+off); o=on>0.5&&hash(g*7.+t)>0.6?vec4(c.gbr,c.a):c;` },
    'Scan Lines': { params: [s('lines', 'Line Count', 50, 2000, 480), amt(40, 'Darkness'), s('speed', 'Scroll Speed', -10, 10, 0), chk('flicker', 'Flicker')],
      body: `vec4 c=S(uv); float l=0.5+0.5*sin((uv.y+u_time*speed*.02)*lines*3.1415927); float f=flicker>0.5?0.97+0.03*sin(u_time*60.):1.; o=vec4(c.rgb*(1.-amount/100.*(1.-l))*f,c.a);` },
    'VHS': { params: [amt(50, 'Wear'), s('bleed', 'Color Bleed', 0, 100, 40), s('tapeNoise', 'Tape Noise', 0, 100, 30), chk('date', 'Tracking Lines', true)],
      body: `float t=u_time; float wob=(noise2(vec2(uv.y*20.,t*3.))-.5)*0.004*amount/50.; float band=step(.985,fract(uv.y*.7-t*.21))*float(date>0.5); vec2 p=vec2(uv.x+wob+band*0.02,uv.y); vec4 c=S(p);
        float b=bleed*0.00008*u_res.x/1920.*20.; vec3 r=vec3(S(p+vec2(b,0.)).r,c.g,S(p-vec2(b*.6,0.)).b); vec3 y=vec3(luma(r)); r=mix(y,r,0.75); r=mix(r,r*vec3(1.05,1.,.92),amount/100.);
        float n=(hash(uv*u_res*.5+t*91.)-.5)*tapeNoise/180.; r+=n+band*.3; o=vec4(clamp(r,0.,1.),c.a);` },
    'Datamosh Look': { params: [s('block', 'Block Size', 4, 64, 16), amt(50, 'Smear'), s('rate', 'Rate', 1, 30, 6)],
      body: `float t=floor(u_time*rate); vec2 g=floor(uv*u_res/(block*${SC})); vec2 v=(vec2(noise2(g*.15+t*.3),noise2(g*.15-t*.3+9.))-.5)*amount*0.004*(0.5+fract(u_time*rate)); vec4 c=S(uv-v*step(.35,hash(g+t))); o=c;` },
    'Signal Noise': { params: [amt(30), s('size', 'Noise Size', 1, 20, 1), chk('color', 'Color Noise'), s('lines', 'Interference Lines', 0, 100, 20)],
      body: `vec4 c=S(uv); vec2 g=floor(uv*u_res/(size*${SC})); float n=hash(g+fract(u_time*13.)*91.7); vec3 nn=color>0.5?vec3(hash(g+u_time),hash(g*1.3+u_time),hash(g*1.7+u_time)):vec3(n); float ln=step(1.-lines/400.,hash(vec2(floor(uv.y*200.),floor(u_time*30.))))*.5;
        o=vec4(mix(c.rgb,nn,amount/100.)+ln,c.a);` },
    'Pixel Sort': { params: [s('thresh', 'Threshold', 0, 100, 50), s('len', 'Streak Length', 1, 400, 80), sel('dir', 'Direction', ['Down', 'Up', 'Right', 'Left']), chk('dark', 'Sort Dark Areas')],
      body: `vec2 d=dir<0.5?vec2(0.,1.):dir<1.5?vec2(0.,-1.):dir<2.5?vec2(-1.,0.):vec2(1.,0.); d/=u_res; vec4 c=S(uv); float th=thresh/100.; bool sel0=dark>0.5?luma(c.rgb)<th:luma(c.rgb)>th; if(!sel0){ o=c; return; }
        vec4 best=c; float bl=luma(c.rgb); float L=len*${SC}; for(int i=1;i<48;i++){ vec2 p=uv+d*float(i)*L/48.; vec4 x=S(p); float l=luma(x.rgb); bool s2=dark>0.5?l<th:l>th; if(!s2||p.x<0.||p.x>1.||p.y<0.||p.y>1.) break; if(dark>0.5?l<bl:l>bl){ best=x; bl=l; } } o=vec4(mix(c.rgb,best.rgb,.85),c.a);` },
    'Wave Glitch': { params: [s('amp', 'Amplitude', 0, 100, 20), s('freq', 'Frequency', 1, 100, 20), s('speed', 'Speed', 0, 20, 4), chk('rgb', 'Split Channels', true)],
      body: `float w=sin(uv.y*freq+u_time*speed*3.)*amp*0.0005+step(.92,noise2(vec2(uv.y*8.,u_time*speed)))*amp*0.002; vec4 c=S(uv+vec2(w,0.)); o=rgb>0.5?vec4(S(uv+vec2(w*1.6,0.)).r,c.g,S(uv+vec2(w*.4,0.)).b,c.a):c;` },
    'Bad TV': { params: [s('distort', 'Distortion', 0, 100, 30), s('roll', 'Vertical Roll', 0, 100, 0), s('stat', 'Static', 0, 100, 20), s('desat', 'Desaturate', 0, 100, 30)],
      body: `float t=u_time; float y=fract(uv.y+t*roll*0.01); float d=(noise2(vec2(y*6.,t*4.))-.5)*distort*0.0016+(noise2(vec2(y*60.,t*20.))-.5)*distort*0.0004; vec4 c=S(vec2(uv.x+d,y)); float st=hash(uv*u_res+t*57.)*stat/100.;
        vec3 r=mix(c.rgb,vec3(luma(c.rgb)),desat/100.); o=vec4(clamp(r*(1.-stat/200.)+st,0.,1.),c.a);` },
    'Interlace Tear': { params: [amt(40, 'Tear'), s('field', 'Field Offset', 0, 100, 20)],
      body: `float line=mod(floor(uv.y*u_res.y),2.); float tear=step(.7,noise2(vec2(floor(uv.y*20.),floor(u_time*12.))))*amount*0.0008; o=S(uv+vec2(line*(field*0.0002+tear),0.));` },
    'Chroma Bleed': { params: [s('bleed', 'Bleed', 0, 200, 40), s('sat', 'Saturation Boost', 0, 200, 120)], passes: 2, src: true,
      body: `if(u_pass<0.5){ o=blurDir(vec2(1./u_res.x,0.),bleed*${SC}); } else { vec4 c=SRC(uv); vec3 b=S(uv).rgb; float y=luma(c.rgb); vec3 ch=b-luma(b); vec3 r=y+ch*sat/100.; o=vec4(clamp(r,0.,1.),c.a); }` },
  },
  'Light & Glow': {
    'Bloom': { params: [s('thresh', 'Threshold', 0, 100, 60), s('radius', 'Radius', 1, 100, 30), s('intensity', 'Intensity', 0, 400, 100)], passes: 3, src: true,
      body: glow3('smoothstep(thresh/100.,thresh/100.+0.15,l)', 'radius', 'o=vec4(c.rgb+g*intensity/100.,c.a);') },
    'Glow': { params: [s('thresh', 'Glow Threshold', 0, 100, 50), s('radius', 'Glow Radius', 1, 100, 20), s('intensity', 'Glow Intensity', 0, 400, 100), col('color', 'Glow Color', '#ffffff'), chk('only', 'Glow Only')], passes: 3, src: true,
      body: glow3('step(thresh/100.,l)', 'radius', 'vec3 gg=g*color*intensity/100.; o=only>0.5?vec4(gg,c.a):vec4(1.-(1.-c.rgb)*(1.-min(gg,1.)),c.a);') },
    'God Rays': { params: [ctr('center', 'Light Source'), s('thresh', 'Threshold', 0, 100, 60), s('len', 'Ray Length', 1, 100, 50), s('intensity', 'Intensity', 0, 200, 80), col('color', 'Ray Color', '#fff4dc')], src: true,
      body: `vec4 c=SRC(uv); vec2 c0=vec2(center.x,1.-center.y); vec2 d=(c0-uv)*len/100./48.; vec2 p=uv; float dec=1.; vec3 a=vec3(0.); for(int i=0;i<48;i++){ p+=d; vec3 x=SRC(p).rgb; a+=x*smoothstep(thresh/100.,thresh/100.+.1,luma(x))*dec; dec*=0.965; } o=vec4(c.rgb+a/48.*color*intensity/25.,c.a);` },
    'Light Leak': { params: [col('color', 'Leak Color', '#ff8a3d'), col('color2', 'Second Color', '#ff3d6e'), amt(60, 'Intensity'), s('speed', 'Speed', 0, 10, 1), s('scale', 'Size', 10, 400, 100), seed()],
      body: `vec4 c=S(uv); vec2 q=uv*${ASP}*100./scale; float n=fbm(q*1.2+vec2(u_time*speed*.15,seed),4.,.5); float n2=fbm(q*.8-vec2(seed,u_time*speed*.1),4.,.5); vec3 lk=color*smoothstep(.45,.9,n)+color2*smoothstep(.55,1.,n2)*.7;
        o=vec4(1.-(1.-c.rgb)*(1.-lk*amount/60.),c.a);` },
    'Anamorphic Flare': { params: [s('thresh', 'Threshold', 0, 100, 75), s('len', 'Streak Length', 1, 100, 60), s('intensity', 'Intensity', 0, 400, 120), col('color', 'Streak Color', '#4fa8ff')], passes: 2, src: true,
      body: `if(u_pass<0.5){ float R=len*12.*${SC}; vec3 a=vec3(0.); float w=0.; for(int i=-24;i<=24;i++){ float f=float(i)/24.; float k=exp(-abs(f)*3.); vec3 x=SRC(uv+vec2(f*R/u_res.x,0.)).rgb; a+=x*smoothstep(thresh/100.,thresh/100.+.08,luma(x))*k; w+=k; } o=vec4(a/w,1.); }
        else { vec4 c=SRC(uv); vec3 g=S(uv).rgb; o=vec4(c.rgb+luma(g)*color*intensity/40.+g*.2,c.a); }` },
    'Star Glow': { params: [s('thresh', 'Threshold', 0, 100, 75), s('len', 'Streak Length', 1, 100, 40), sel('points', 'Points', ['4', '6', '8']), s('angle', 'Angle', -180, 180, 45), s('intensity', 'Intensity', 0, 400, 100), col('color', 'Color', '#ffffff')], src: true,
      body: `vec4 c=SRC(uv); float n=points<0.5?4.:points<1.5?6.:8.; vec3 a=vec3(0.); for(int k=0;k<8;k++){ if(float(k)>=n) break; float an=radians(angle)+float(k)*6.2831853/n; vec2 d=vec2(cos(an),sin(an))/u_res*len*3.*${SC};
        for(int i=1;i<=12;i++){ vec3 x=SRC(uv+d*float(i)).rgb; a+=x*smoothstep(thresh/100.,thresh/100.+.08,luma(x))*(1.-float(i)/13.); } } o=vec4(c.rgb+a/(n*6.)*color*intensity/50.,c.a);` },
    'Neon Edge': { params: [col('color', 'Neon Color', '#28f0ff'), s('width', 'Edge Width', 1, 10, 2), s('intensity', 'Glow', 0, 400, 150), s('keep', 'Original Image', 0, 100, 20)],
      body: `vec2 px=width*${SC}/u_res; float gx=luma(S(uv+vec2(px.x,0.)).rgb)-luma(S(uv-vec2(px.x,0.)).rgb), gy=luma(S(uv+vec2(0.,px.y)).rgb)-luma(S(uv-vec2(0.,px.y)).rgb); float e=0.; for(int i=0;i<8;i++){ float an=float(i)*.785; vec2 q=uv+vec2(cos(an),sin(an))*px*3.;
        e+=length(vec2(luma(S(q+vec2(px.x,0.)).rgb)-luma(S(q-vec2(px.x,0.)).rgb),luma(S(q+vec2(0.,px.y)).rgb)-luma(S(q-vec2(0.,px.y)).rgb))); } float edge=length(vec2(gx,gy)); vec4 c=S(uv); o=vec4(c.rgb*keep/100.+color*(edge*4.+e*.3)*intensity/100.,c.a);` },
    'Halation': { params: [s('thresh', 'Threshold', 0, 100, 70), s('radius', 'Radius', 1, 100, 25), s('intensity', 'Intensity', 0, 400, 80), col('color', 'Halation Color', '#ff4a1c')], passes: 3, src: true,
      body: glow3('smoothstep(thresh/100.,thresh/100.+0.2,l)', 'radius', 'o=vec4(1.-(1.-c.rgb)*(1.-min(luma(g)*color*intensity/60.,1.)),c.a);') },
    'Bokeh Overlay': { params: [s('n', 'Lights', 1, 60, 25), s('size', 'Size', 1, 100, 30), col('color', 'Color', '#ffd59a'), amt(50, 'Opacity'), s('speed', 'Drift Speed', 0, 10, 1), seed()],
      body: `vec4 c=S(uv); vec2 q=uv*${ASP}; float b=0.; vec3 cc=vec3(0.); for(int i=0;i<60;i++){ if(float(i)>=n) break; vec2 h=vec2(hash(vec2(float(i),seed)),hash(vec2(seed,float(i)*1.7))); vec2 p=vec2(h.x*u_res.x/u_res.y,fract(h.y+u_time*speed*.02*(0.5+h.x)));
        float r=(0.02+0.06*hash(h*3.))*size/30.; float d=length(q-p); float disc=smoothstep(r,r*.85,d)*(0.6+0.4*smoothstep(r*.6,r,d)); b+=disc; cc+=disc*mix(color,color.gbr,hash(h*9.)*.4); } o=vec4(1.-(1.-c.rgb)*(1.-min(cc*amount/100.,1.)),c.a);` },
    'Light Sweep': { params: [s('pos', 'Position (%)', -50, 150, 50), s('angle', 'Angle', -90, 90, 30), s('width', 'Width', 1, 100, 15), s('intensity', 'Intensity', 0, 200, 80), col('color', 'Color', '#ffffff'), chk('alphaOnly', 'Only on Opaque Pixels', true)],
      body: `vec4 c=S(uv); vec2 d=vec2(cos(radians(angle)),sin(radians(angle))); float x=dot((uv-.5)*${ASP},d)/(abs(d.x)*u_res.x/u_res.y+abs(d.y))+.5; float band=exp(-pow((x-pos/100.)/(width/300.),2.))*intensity/100.; float m=alphaOnly>0.5?c.a:1.; o=vec4(min(c.rgb+color*band*m,1.),c.a);` },
  },
  ...MORE_VIDEO_FX_2,
};
