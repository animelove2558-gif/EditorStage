// Video effects added in round 2, part 2 (folders Retro & Film, Artistic, Blur & Sharpen, Motion, Color Correction, Stylize,
// Keying). Written for EditorStage (source 'own'); same shape as VIDEO_FX entries, see moreVideoFx.js.
import { s, sel, chk, pt, col, SC } from './fxParams';

const amt = (def = 50, label = 'Amount', max = 100) => s('amount', label, 0, max, def);
const seed = () => s('seed', 'Random Seed', 0, 100, 1);
const ASP = 'vec2(u_res.x/u_res.y,1.)';
const SOBEL = `float sob(vec2 p, vec2 px){ float tl=luma(S(p+vec2(-px.x,px.y)).rgb), t=luma(S(p+vec2(0.,px.y)).rgb), tr=luma(S(p+px).rgb), l=luma(S(p-vec2(px.x,0.)).rgb), r=luma(S(p+vec2(px.x,0.)).rgb), bl=luma(S(p-px).rgb), b=luma(S(p-vec2(0.,px.y)).rgb), br=luma(S(p+vec2(px.x,-px.y)).rgb);
  float gx=tr+2.*r+br-tl-2.*l-bl, gy=tl+2.*t+tr-bl-2.*b-br; return sqrt(gx*gx+gy*gy); }`;
const VORONOI = `vec3 vor(vec2 p){ vec2 g=floor(p), f=fract(p); float d1=8., d2=8.; vec2 best=vec2(0.); for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 o=vec2(float(x),float(y)); vec2 h=vec2(hash(g+o),hash(g+o+17.3)); vec2 r=o+h-f; float d=dot(r,r); if(d<d1){ d2=d1; d1=d; best=g+o+h; } else if(d<d2) d2=d; } return vec3(best, sqrt(d2)-sqrt(d1)); }`;
const GRADIENTS = ['Sunset', 'Ocean', 'Fire', 'Purple Haze', 'Gold', 'Ice', 'Forest', 'Neon'];
const HUE6 = ['Reds', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Magentas'];
const hueW = 'float hw(float h, float c){ float d=abs(fract(h-c+.5)-.5)*6.; return clamp(1.-d,0.,1.); }';

export const MORE_VIDEO_FX_2 = {
  'Retro & Film': {
    'Film Grain': { params: [amt(30, 'Intensity'), s('size', 'Grain Size', 1, 8, 1.5, 0.1), chk('color', 'Color Grain'), s('resp', 'Shadow / Highlight Response', 0, 100, 60), s('fps', 'Grain Rate (fps)', 1, 60, 24)],
      body: `vec4 c=S(uv); float f=floor(u_time*fps); vec2 g=floor(uv*u_res/(size*${SC}))+f*vec2(17.31,9.73); float n=hash(g)+hash(g+.5)-1.; vec3 nn=color>0.5?vec3(n,hash(g*1.3)+hash(g*1.7)-1.,hash(g*2.1)+hash(g*2.9)-1.):vec3(n);
        float l=luma(c.rgb); float w=mix(1.,4.*l*(1.-l),resp/100.); o=vec4(clamp(c.rgb+nn*amount/150.*w,0.,1.),c.a);` },
    'Film Damage': { params: [s('scratch', 'Scratches', 0, 100, 40), s('dust', 'Dust', 0, 100, 40), s('flicker', 'Flicker', 0, 100, 30), s('fps', 'Frame Rate', 1, 60, 18), seed()],
      body: `vec4 c=S(uv); float f=floor(u_time*fps)+seed; float sx=floor(uv.x*u_res.x/(2.*${SC})); float sc=step(1.-scratch/2000.,hash(vec2(sx,floor(f/3.))))*(0.5+0.5*noise2(vec2(uv.y*40.,f)));
        vec2 dg=floor(uv*u_res/(3.*${SC})); float ds=step(1.-dust/3000.,hash(dg+f*7.1)); float fl=1.+(hash(vec2(f,3.))-.5)*flicker/150.; vec3 r=c.rgb*fl+sc*.5-ds*.7; o=vec4(clamp(r,0.,1.),c.a);` },
    'Old Film': { params: [amt(70, 'Age'), s('grain', 'Grain', 0, 100, 40), s('vig', 'Vignette', 0, 100, 60), s('jitter', 'Jitter', 0, 100, 30)],
      body: `float f=floor(u_time*18.); vec2 j=(vec2(hash(vec2(f,1.)),hash(vec2(f,2.)))-.5)*jitter*0.00015*vec2(.3,1.); vec4 c=S(uv+j); float l=luma(c.rgb); vec3 sp=vec3(l*1.07+.04,l*.94+.02,l*.76); vec3 r=mix(c.rgb,sp,amount/100.);
        r*=1.+(hash(vec2(f,5.))-.5)*amount/400.; r+=(hash(floor(uv*u_res)+f)-.5)*grain/250.; float d=length((uv-.5)*vec2(1.2,1.)); r*=1.-smoothstep(.35,.85,d)*vig/100.;
        r+=step(.998,hash(vec2(floor(uv.x*u_res.x/2.),floor(f/4.))))*amount/200.; o=vec4(clamp(r,0.,1.),c.a);` },
    'Super 8': { params: [amt(70, 'Look'), s('grain', 'Grain', 0, 100, 60), s('weave', 'Gate Weave', 0, 100, 40), chk('frame', 'Show Frame Edge', true)],
      body: `float f=floor(u_time*18.); vec2 j=vec2(noise2(vec2(f*.3,1.))-.5,noise2(vec2(f*.3,7.))-.5)*weave*0.0003; vec2 p=uv+j; vec4 c=(S(p)*2.+S(p+vec2(1.5,0.)/u_res)+S(p-vec2(1.5,0.)/u_res)+S(p+vec2(0.,1.5)/u_res)+S(p-vec2(0.,1.5)/u_res))/6.;
        vec3 r=c.rgb; r=mix(r,pow(r,vec3(.9,1.,1.2))*vec3(1.08,1.,.85)+vec3(.04,.02,0.),amount/100.); r+=(hash(floor(uv*u_res/2.)+f)-.5)*grain/150.; float d=length((uv-.5)*vec2(1.1,1.)); r*=1.-smoothstep(.3,.8,d)*.6*amount/100.;
        if(frame>0.5){ vec2 e=abs(p-.5); float rr=smoothstep(.49,.5,max(e.x*1.02,e.y*1.04)); r=mix(r,vec3(0.02),rr); } o=vec4(clamp(r,0.,1.),c.a);` },
    'Gate Weave': { params: [s('amp', 'Amount', 0, 100, 30), s('fps', 'Frame Rate', 1, 60, 24), s('rot', 'Rotation Wobble', 0, 100, 10), seed()],
      body: `float f=floor(u_time*fps)+seed; vec2 j=vec2(noise2(vec2(f*.37,1.))-.5,noise2(vec2(f*.29,4.))-.5)*amp*0.0004*vec2(.5,1.); float a=(noise2(vec2(f*.2,9.))-.5)*rot*0.0008; vec2 q=(uv-.5)*${ASP}; q=vec2(q.x*cos(a)-q.y*sin(a),q.x*sin(a)+q.y*cos(a)); o=S(q/${ASP}+.5+j);` },
    'Sepia': { params: [amt(100), s('warmth', 'Warmth', 0, 100, 50)],
      body: `vec4 c=S(uv); vec3 sp=vec3(dot(c.rgb,vec3(.393,.769,.189)),dot(c.rgb,vec3(.349,.686,.168)),dot(c.rgb,vec3(.272,.534,.131))); sp=mix(vec3(luma(sp)),sp,warmth/50.); o=vec4(mix(c.rgb,clamp(sp,0.,1.),amount/100.),c.a);` },
    'Cross Process': { params: [amt(80)],
      body: `vec4 c=S(uv); vec3 x=c.rgb; vec3 r=vec3(smoothstep(.05,.95,x.r), x.g*1.1-.03+0.08*sin(x.g*3.14), x.b*.7+.18); o=vec4(mix(c.rgb,clamp(r,0.,1.),amount/100.),c.a);` },
    'Bleach Bypass': { params: [amt(70)],
      body: `vec4 c=S(uv); float l=luma(c.rgb); vec3 bl=vec3(l); vec3 ov=mix(2.*c.rgb*bl,1.-2.*(1.-c.rgb)*(1.-bl),step(.5,bl)); o=vec4(mix(c.rgb,ov,amount/100.),c.a);` },
    'Dye Transfer Color': { params: [sel('mode', 'Process', ['2-Strip', '3-Strip']), amt(80)],
      body: `vec4 c=S(uv); vec3 x=c.rgb; vec3 r; if(mode<0.5){ float cy=(x.g+x.b)*.5; r=vec3(x.r, cy, cy*1.05); r=vec3(r.r*1.05, r.g*.95+r.r*.05, r.b); } else { vec3 neg=1.-x; r=x*vec3(1.-neg.g*.5-neg.b*.5+neg.r*.5,1.-neg.r*.5-neg.b*.5+neg.g*.5,1.-neg.r*.5-neg.g*.5+neg.b*.5); r=mix(vec3(luma(r)),r,1.3); }
        o=vec4(mix(c.rgb,clamp(r,0.,1.),amount/100.),c.a);` },
    'Halftone': { params: [s('size', 'Dot Size', 2, 100, 8), s('angle', 'Angle', -90, 90, 45), col('ink', 'Ink Color', '#111111'), col('paper', 'Paper Color', '#f4f1e8'), s('blend', 'Original Color', 0, 100, 0)],
      body: `float a=radians(angle); mat2 m=mat2(cos(a),-sin(a),sin(a),cos(a)); vec2 px=uv*u_res/(size*${SC}); vec2 q=m*px; vec2 cell=floor(q)+.5; vec2 cp=transpose(m)*cell*(size*${SC})/u_res; vec4 c=S(cp); float l=luma(c.rgb); float r=sqrt(1.-l)*.72;
        float d=distance(q,cell); float dot0=1.-smoothstep(r-.06,r+.06,d); vec3 ht=mix(paper,ink,dot0); o=vec4(mix(ht,S(uv).rgb*mix(vec3(1.),ink,dot0),blend/100.),S(uv).a);` },
    'Color Halftone': { params: [s('size', 'Dot Size', 2, 100, 7), s('angle', 'Angle Offset', -90, 90, 0)],
      fns: `float ht(vec2 p, float ang, float ch){ float a=radians(ang); mat2 m=mat2(cos(a),-sin(a),sin(a),cos(a)); vec2 q=m*(p*u_res/(size*${SC})); vec2 cell=floor(q)+.5; vec2 cp=transpose(m)*cell*(size*${SC})/u_res; vec3 c=S(cp).rgb; float k=1.-max(max(c.r,c.g),c.b);
        float v=ch<0.5?(1.-c.r-k)/(1.-k+1e-4):ch<1.5?(1.-c.g-k)/(1.-k+1e-4):ch<2.5?(1.-c.b-k)/(1.-k+1e-4):k; float r=sqrt(clamp(v,0.,1.))*.7; return 1.-smoothstep(r-.07,r+.07,distance(q,cell)); }`,
      body: `float cc=ht(uv,15.+angle,0.), mm=ht(uv,75.+angle,1.), yy=ht(uv,0.+angle,2.), kk=ht(uv,45.+angle,3.); vec3 r=vec3(1.)*(1.-cc*vec3(1.,0.,0.))*(1.-mm*vec3(0.,1.,0.))*(1.-yy*vec3(0.,0.,1.))*(1.-kk); o=vec4(r,S(uv).a);` },
    'CRT': { params: [s('curve', 'Curvature', 0, 100, 30), s('scan', 'Scanlines', 0, 100, 50), s('mask', 'Shadow Mask', 0, 100, 40), s('glow', 'Glow', 0, 100, 30), s('vig', 'Vignette', 0, 100, 50)],
      body: `vec2 q=uv-.5; float k=curve/400.; q*=1.+k*dot(q,q)*4.; vec2 p=q+.5; if(p.x<0.||p.x>1.||p.y<0.||p.y>1.){ o=vec4(0.,0.,0.,1.); return; } vec4 c=S(p); vec3 b=(S(p+vec2(2.,0.)/u_res).rgb+S(p-vec2(2.,0.)/u_res).rgb+S(p+vec2(0.,2.)/u_res).rgb+S(p-vec2(0.,2.)/u_res).rgb)*.25;
        vec3 r=c.rgb+b*glow/150.; float sl=.5+.5*sin(p.y*u_res.y*3.1415927); r*=mix(1.,sl*.6+.4,scan/100.); float m=mod(floor(uv.x*u_res.x),3.); vec3 mk=m<0.5?vec3(1.,.7,.7):m<1.5?vec3(.7,1.,.7):vec3(.7,.7,1.); r*=mix(vec3(1.),mk,mask/100.);
        r*=1.-smoothstep(.3,.75,length(q))*vig/100.; o=vec4(clamp(r,0.,1.),c.a);` },
    'Pocket Console': { params: [s('pixel', 'Pixel Size', 1, 20, 4), col('c0', 'Darkest', '#0f380f'), col('c1', 'Dark', '#306230'), col('c2', 'Light', '#8bac0f'), col('c3', 'Lightest', '#9bbc0f'), s('dither', 'Dither', 0, 100, 50)],
      body: `vec2 ps=pixel*${SC}/u_res; vec2 cell=floor(uv/ps); vec4 c=S((cell+.5)*ps); vec2 b=mod(cell,4.); float bay=(b.x<0.5?(b.y<0.5?0.:b.y<1.5?12.:b.y<2.5?3.:15.):b.x<1.5?(b.y<0.5?8.:b.y<1.5?4.:b.y<2.5?11.:7.):b.x<2.5?(b.y<0.5?2.:b.y<1.5?14.:b.y<2.5?1.:13.):(b.y<0.5?10.:b.y<1.5?6.:b.y<2.5?9.:5.))/16.;
        float l=clamp(luma(c.rgb)+(bay-.5)*dither/150.,0.,.999)*4.; vec3 r=l<1.?c0:l<2.?c1:l<3.?c2:c3; o=vec4(r,c.a);` },
    'Ordered Dither': { params: [s('levels', 'Color Levels', 2, 32, 4), s('pixel', 'Pixel Size', 1, 20, 1), chk('mono', 'Monochrome'), s('strength', 'Dither Strength', 0, 100, 100)],
      body: `vec2 ps=pixel*${SC}/u_res; vec2 cell=floor(uv/ps); vec4 c=S((cell+.5)*ps); vec2 b=mod(cell,4.); float bay=(b.x<0.5?(b.y<0.5?0.:b.y<1.5?12.:b.y<2.5?3.:15.):b.x<1.5?(b.y<0.5?8.:b.y<1.5?4.:b.y<2.5?11.:7.):b.x<2.5?(b.y<0.5?2.:b.y<1.5?14.:b.y<2.5?1.:13.):(b.y<0.5?10.:b.y<1.5?6.:b.y<2.5?9.:5.))/16.-.5;
        vec3 x=mono>0.5?vec3(luma(c.rgb)):c.rgb; float L=levels-1.; vec3 r=floor(x*L+.5+bay*strength/100.)/L; o=vec4(clamp(r,0.,1.),c.a);` },
    'Vintage Fade': { params: [amt(60), s('lift', 'Lifted Blacks', 0, 100, 40), s('warm', 'Warm Highlights', 0, 100, 40), s('desat', 'Desaturate', 0, 100, 30)],
      body: `vec4 c=S(uv); vec3 r=c.rgb; r=mix(vec3(luma(r)),r,1.-desat/100.); r=lift/400.+r*(1.-lift/400.-.05); float l=luma(r); r+=vec3(.06,.02,-.04)*smoothstep(.4,1.,l)*warm/50.+vec3(-.02,.0,.04)*(1.-smoothstep(0.,.4,l))*warm/100.; o=vec4(mix(c.rgb,clamp(r,0.,1.),amount/100.),c.a);` },
  },
  'Artistic': {
    'Oil Paint': { params: [s('radius', 'Brush Size', 1, 6, 4, 1)],
      body: `vec2 px=${SC}/u_res; int R=int(radius); vec3 m[4]; vec3 s2[4]; for(int k=0;k<4;k++){ m[k]=vec3(0.); s2[k]=vec3(0.); } float n=float((R+1)*(R+1));
        for(int j=-6;j<=6;j++) for(int i=-6;i<=6;i++){ if(abs(i)>R||abs(j)>R) continue; vec3 c=S(uv+vec2(float(i),float(j))*px).rgb; if(i<=0&&j<=0){ m[0]+=c; s2[0]+=c*c; } if(i>=0&&j<=0){ m[1]+=c; s2[1]+=c*c; } if(i<=0&&j>=0){ m[2]+=c; s2[2]+=c*c; } if(i>=0&&j>=0){ m[3]+=c; s2[3]+=c*c; } }
        float best=1e9; vec3 res=vec3(0.); for(int k=0;k<4;k++){ vec3 mu=m[k]/n; vec3 v=abs(s2[k]/n-mu*mu); float sg=v.r+v.g+v.b; if(sg<best){ best=sg; res=mu; } } o=vec4(res,S(uv).a);` },
    'Watercolor': { params: [s('bleed', 'Bleed', 0, 100, 40), s('edge', 'Edge Darkening', 0, 100, 50), s('paper', 'Paper Texture', 0, 100, 40), s('levels', 'Pigment Levels', 2, 32, 10)],
      fns: SOBEL,
      body: `vec2 px=${SC}/u_res; vec2 w=vec2(noise2(uv*u_res*.02),noise2(uv*u_res*.02+5.))-.5; vec2 p=uv+w*bleed*px*8.; vec4 c=(S(p)+S(p+vec2(px.x*3.,0.))+S(p-vec2(px.x*3.,0.))+S(p+vec2(0.,px.y*3.))+S(p-vec2(0.,px.y*3.)))/5.;
        vec3 r=floor(c.rgb*levels+.5)/levels; float e=sob(p,px*2.); r*=1.-clamp(e*edge/40.,0.,.6); float pp=fbm(uv*u_res*.01,4.,.5); r*=1.-(pp-.5)*paper/150.; r=mix(r,vec3(1.),.08*paper/100.); o=vec4(clamp(r,0.,1.),c.a);` },
    'Pencil Sketch': { params: [s('strength', 'Line Strength', 0, 200, 100), s('shade', 'Shading', 0, 100, 50), s('hatch', 'Hatch Lines', 0, 100, 40), col('paper', 'Paper Color', '#f5f1e6')],
      fns: SOBEL,
      body: `vec2 px=${SC}/u_res; float e=sob(uv,px); float l=luma(S(uv).rgb); float line=1.-clamp(e*strength/60.,0.,1.); float h1=step(.5,fract((uv.x+uv.y)*u_res.y/(6.*${SC}))), h2=step(.5,fract((uv.x-uv.y)*u_res.y/(6.*${SC})));
        float hs=1.-(1.-l)*shade/100.*(l<.5?mix(1.,h1*h2,hatch/100.):mix(1.,h1,hatch/100.)); o=vec4(paper*line*hs,S(uv).a);` },
    'Cartoon': { params: [s('levels', 'Color Levels', 2, 16, 6), s('edge', 'Edge Strength', 0, 200, 100), s('thick', 'Edge Width', 1, 5, 1.5, 0.1), s('sat', 'Saturation', 0, 200, 120)],
      fns: SOBEL,
      body: `vec2 px=${SC}/u_res; vec4 c=(S(uv)*4.+S(uv+vec2(px.x,0.)*2.)+S(uv-vec2(px.x,0.)*2.)+S(uv+vec2(0.,px.y)*2.)+S(uv-vec2(0.,px.y)*2.))/8.; vec3 h=rgb2hsv(c.rgb); h.y=clamp(h.y*sat/100.,0.,1.); h.z=floor(h.z*levels+.5)/levels; vec3 r=hsv2rgb(h);
        float e=sob(uv,px*thick); r*=1.-smoothstep(.2,.5,e*edge/100.); o=vec4(r,c.a);` },
    'Ink': { params: [s('thresh', 'Ink Threshold', 0, 100, 45), s('edge', 'Edge Detail', 0, 200, 100), col('ink', 'Ink', '#121212'), col('paper', 'Paper', '#f7f3ea')],
      fns: SOBEL,
      body: `vec2 px=${SC}/u_res; float e=sob(uv,px); float l=luma(S(uv).rgb); float k=max(1.-smoothstep(thresh/100.-.03,thresh/100.+.03,l),smoothstep(.25,.6,e*edge/100.)); float grain=noise2(uv*u_res*.5)*.15; o=vec4(mix(paper,ink,clamp(k-grain*k,0.,1.)),S(uv).a);` },
    'Comic': { params: [s('levels', 'Color Levels', 2, 12, 4), s('dots', 'Dot Size', 2, 40, 6), s('edge', 'Outline', 0, 200, 120), s('sat', 'Saturation', 0, 200, 150)],
      fns: SOBEL,
      body: `vec2 px=${SC}/u_res; vec4 c=S(uv); vec3 h=rgb2hsv(c.rgb); h.y=clamp(h.y*sat/100.,0.,1.); h.z=floor(h.z*levels+.5)/levels; vec3 r=hsv2rgb(h); vec2 q=uv*u_res/(dots*${SC}); float d=distance(fract(q),vec2(.5));
        float sh=1.-luma(c.rgb); r*=1.-step(d,sh*.55)*.35; float e=sob(uv,px*1.5); r*=1.-smoothstep(.25,.5,e*edge/100.); o=vec4(r,c.a);` },
    'Mosaic Tiles': { params: [s('size', 'Tile Size', 4, 200, 24), s('grout', 'Grout Width', 0, 30, 2), col('groutColor', 'Grout Color', '#2b2b2b'), s('bevel', 'Bevel', 0, 100, 40), s('jitter', 'Color Variation', 0, 100, 15)],
      body: `vec2 t=uv*u_res/(size*${SC}); vec2 g=floor(t), f=fract(t); vec4 c=S((g+.5)*size*${SC}/u_res); vec3 r=c.rgb*(1.+(hash(g)-.5)*jitter/150.); float gw=grout/(size); float edgeD=min(min(f.x,f.y),min(1.-f.x,1.-f.y));
        r*=1.+(f.x-f.y)*bevel/300.*smoothstep(.0,.2,edgeD); r=mix(groutColor,r,step(gw,edgeD)); o=vec4(clamp(r,0.,1.),c.a);` },
    'Hexagon Pixelate': { params: [s('size', 'Cell Size', 2, 200, 20)],
      fns: `vec2 hexC(vec2 p){ vec2 r=vec2(1.,1.7320508); vec2 h=r*.5; vec2 a=mod(p,r)-h, b=mod(p-h,r)-h; return dot(a,a)<dot(b,b)?p-a:p-b; }`,
      body: `vec2 sc=u_res/(size*${SC}); vec2 c=hexC(uv*sc); o=S(c/sc);` },
    'Triangle Pixelate': { params: [s('size', 'Cell Size', 2, 200, 24)],
      body: `vec2 sc=u_res/(size*${SC}); vec2 p=uv*sc; p.x+=p.y*.57735; vec2 g=floor(p), f=fract(p); float up=step(f.x,f.y); vec2 cc=g+(up>0.5?vec2(1./3.,2./3.):vec2(2./3.,1./3.)); cc.x-=cc.y*.57735; o=S(cc/sc);` },
    'Voronoi Glass': { params: [s('size', 'Cell Size', 4, 300, 40), s('refract', 'Refraction', 0, 100, 40), s('lines', 'Cell Edges', 0, 100, 20)],
      fns: VORONOI,
      body: `vec2 sc=u_res/(size*${SC}); vec3 v=vor(uv*sc); vec2 cc=v.xy/sc; vec2 p=mix(uv,cc,refract/100.)+ (uv-cc)*refract/200.; vec4 c=S(p); o=vec4(c.rgb*(1.-(1.-smoothstep(0.,.06,v.z))*lines/100.),c.a);` },
    'Stained Glass': { params: [s('size', 'Cell Size', 4, 300, 36), s('lead', 'Lead Width', 0, 30, 6), col('leadColor', 'Lead Color', '#151515'), s('glow', 'Glass Glow', 0, 100, 30)],
      fns: VORONOI,
      body: `vec2 sc=u_res/(size*${SC}); vec3 v=vor(uv*sc); vec4 c=S(v.xy/sc); vec3 r=c.rgb*(1.+glow/100.*(1.-v.z*2.)); r=mix(leadColor,r,smoothstep(lead/100.,lead/100.+.03,v.z)); o=vec4(clamp(r,0.,1.),S(uv).a);` },
    'ASCII': { params: [s('size', 'Character Size', 4, 64, 10), chk('color', 'Use Image Color', true), col('fg', 'Text Color', '#38ff6a'), col('bgc', 'Background', '#000000')],
      fns: `float glyph(float n, vec2 p){ p=floor(p*vec2(5.,5.)); if(p.x<0.||p.x>4.||p.y<0.||p.y>4.) return 0.; float i=p.x+p.y*5.; return mod(floor(n/exp2(i)),2.); }`,
      body: `vec2 cell=size*${SC}/u_res; vec2 g=floor(uv/cell); vec4 c=S((g+.5)*cell); float l=luma(c.rgb); vec2 f=fract(uv/cell); float n=l<.1?0.:l<.2?4096.:l<.3?65600.:l<.4?163153.:l<.5?15255086.:l<.6?13121101.:l<.7?15252014.:l<.8?13195790.:l<.9?11512810.:16777215.;
        float on=glyph(n,f); vec3 fgc=color>0.5?c.rgb:fg; o=vec4(mix(bgc,fgc,on),c.a);` },
  },
  'Blur & Sharpen': {
    'Tilt Shift': { params: [s('pos', 'Focus Position (%)', 0, 100, 50), s('width', 'Focus Width (%)', 0, 100, 20), s('blur', 'Blurriness', 0, 100, 40), s('angle', 'Angle', -90, 90, 0), s('sat', 'Saturation Boost', 0, 100, 20)], passes: 2,
      body: `vec2 d=vec2(cos(radians(angle)),sin(radians(angle))); float y=dot(uv-.5,vec2(-d.y,d.x))+.5; float k=smoothstep(width/200.,width/200.+.25,abs(y-pos/100.)); vec2 dir=u_pass<0.5?vec2(1./u_res.x,0.):vec2(0.,1./u_res.y); vec4 c=blurDir(dir,blur*0.5*${SC}*k);
        if(u_pass>0.5){ vec3 h=rgb2hsv(c.rgb); h.y=clamp(h.y*(1.+sat/100.),0.,1.); c.rgb=hsv2rgb(h); } o=c;` },
    'Lens Blur': { params: [s('radius', 'Iris Radius', 0, 100, 20), sel('shape', 'Iris Shape', ['Circle', 'Hexagon', 'Pentagon']), s('bright', 'Specular Brightness', 0, 100, 40), s('thresh', 'Specular Threshold', 0, 100, 75)],
      body: `float R=radius*0.6*${SC}; vec3 a=vec3(0.); float w=0.; for(int i=0;i<64;i++){ float f=(float(i)+.5)/64.; float an=float(i)*2.39996; float r=sqrt(f); vec2 dd=vec2(cos(an),sin(an))*r;
        if(shape>0.5){ float nn=shape<1.5?6.:5.; float seg=6.2831853/nn; float aa=mod(an,seg)-seg*.5; float lim=cos(seg*.5)/cos(aa); if(r>lim) continue; } vec3 x=S(uv+dd*R/u_res).rgb; float k=1.+smoothstep(thresh/100.,1.,luma(x))*bright/10.; a+=x*k; w+=k; } o=vec4(a/max(w,1.),S(uv).a);` },
    'Bilateral Blur': { params: [s('radius', 'Radius', 1, 20, 5), s('tol', 'Edge Tolerance', 1, 100, 15), amt(100, 'Amount')],
      body: `vec4 c=S(uv); vec3 a=vec3(0.); float w=0.; float R=radius*${SC}; for(int j=-4;j<=4;j++) for(int i=-4;i<=4;i++){ vec2 o2=vec2(float(i),float(j))/4.*R/u_res; vec3 x=S(uv+o2).rgb; float ws=exp(-float(i*i+j*j)/16.); float wr=exp(-dot(x-c.rgb,x-c.rgb)/(2.*pow(tol/200.,2.)+1e-5)); a+=x*ws*wr; w+=ws*wr; }
        o=vec4(mix(c.rgb,a/w,amount/100.),c.a);` },
    'Smart Blur': { params: [s('radius', 'Radius', 1, 30, 6), s('thresh', 'Threshold', 0, 100, 20), sel('mode', 'Mode', ['Normal', 'Edge Only', 'Overlay Edge'])],
      body: `vec4 c=S(uv); vec3 a=vec3(0.); float w=0.; float R=radius*${SC}; float ed=0.; for(int j=-3;j<=3;j++) for(int i=-3;i<=3;i++){ vec3 x=S(uv+vec2(float(i),float(j))/3.*R/u_res).rgb; float d=length(x-c.rgb); float k=step(d,thresh/100.); a+=x*k; w+=k; ed+=1.-k; }
        vec3 b=a/max(w,1.); float e=ed/49.; o=mode<0.5?vec4(b,c.a):mode<1.5?vec4(vec3(step(.1,e)),c.a):vec4(mix(b,vec3(1.),step(.1,e)),c.a);` },
    'Box Blur': { params: [s('radius', 'Blur Radius', 0, 100, 10)], passes: 2,
      body: `vec2 d=u_pass<0.5?vec2(1./u_res.x,0.):vec2(0.,1./u_res.y); float R=radius*${SC}; vec4 a=vec4(0.); for(int i=-16;i<=16;i++) a+=S(uv+d*float(i)/16.*R); o=a/33.;` },
    'Frosted Glass': { params: [s('amount', 'Frost', 0, 100, 40), s('grain', 'Grain Size', 1, 20, 2)],
      body: `vec2 g=floor(uv*u_res/(grain*${SC})); vec2 o2=(vec2(hash(g),hash(g+7.1))-.5)*amount*0.0005*${SC}*4.; vec4 c=(S(uv+o2)+S(uv+o2.yx*vec2(-1.,1.)))*.5; o=c;` },
    'Vignette Blur': { params: [s('blur', 'Blurriness', 0, 100, 40), s('size', 'Clear Area (%)', 0, 100, 45), s('feather', 'Feather', 1, 100, 40), s('roundness', 'Roundness', 0, 100, 50)], passes: 2,
      body: `vec2 q=(uv-.5)*mix(vec2(1.),${ASP},roundness/100.); float d=length(q)*1.414; float k=smoothstep(size/100.,size/100.+feather/100.,d); vec2 dir=u_pass<0.5?vec2(1./u_res.x,0.):vec2(0.,1./u_res.y); o=blurDir(dir,blur*0.5*${SC}*k);` },
  },
  'Motion': {
    'Camera Shake': { params: [s('amp', 'Amplitude', 0, 100, 20), s('freq', 'Frequency', 0.1, 30, 8, 0.1), s('rot', 'Rotation', 0, 100, 20), s('zoom', 'Zoom to Hide Edges', 100, 150, 108), seed()],
      body: `float t=u_time*freq; vec2 off=vec2(noise2(vec2(t,seed))-.5,noise2(vec2(seed+3.,t))-.5)*amp*0.002; float a=(noise2(vec2(t*.7,seed+9.))-.5)*rot*0.004; vec2 q=(uv-.5)*${ASP}; q=vec2(q.x*cos(a)-q.y*sin(a),q.x*sin(a)+q.y*cos(a)); o=SZ(q/${ASP}/(zoom/100.)+.5+off);` },
    'Handheld Wobble': { params: [s('amp', 'Amount', 0, 100, 25), s('speed', 'Speed', 0.05, 5, 0.6, 0.05), s('zoom', 'Zoom to Hide Edges', 100, 140, 105), seed()],
      body: `float t=u_time*speed; vec2 off=vec2(fbm(vec2(t,seed),3.,.5)-.5,fbm(vec2(seed+5.,t*1.1),3.,.5)-.5)*amp*0.0016; float a=(fbm(vec2(t*.8,seed+11.),3.,.5)-.5)*amp*0.0006; vec2 q=(uv-.5)*${ASP}; q=vec2(q.x*cos(a)-q.y*sin(a),q.x*sin(a)+q.y*cos(a)); o=SZ(q/${ASP}/(zoom/100.)+.5+off);` },
    'Earthquake': { params: [s('amp', 'Strength', 0, 100, 40), s('freq', 'Frequency', 1, 60, 24), s('blur', 'Motion Blur', 0, 100, 40), s('zoom', 'Zoom to Hide Edges', 100, 150, 112)],
      body: `float t=floor(u_time*freq); vec2 off=vec2((hash(vec2(t,1.))-.5)*.4,hash(vec2(t,2.))-.5)*amp*0.003; vec2 dv=vec2(0.,(hash(vec2(t,3.))-.5)*blur*0.0008); vec4 a=vec4(0.); for(int i=0;i<8;i++){ vec2 p=(uv-.5)/(zoom/100.)+.5+off+dv*(float(i)/7.-.5); a+=SZ(p); } o=a/8.;` },
    'Zoom Punch': { params: [s('bpm', 'Beats Per Minute', 20, 240, 120), s('amount', 'Punch (%)', 0, 50, 8), s('decay', 'Decay', 1, 20, 6), s('blur', 'Zoom Blur', 0, 100, 30), s('phase', 'Offset (beats)', 0, 1, 0, 0.01)],
      body: `float ph=fract(u_time*bpm/60.+phase); float z=1.+amount/100.*exp(-ph*decay); vec2 c0=vec2(.5); vec4 a=vec4(0.); float bk=blur/100.*(z-1.)*.5; for(int i=0;i<8;i++){ a+=S(c0+(uv-c0)/(z*(1.+bk*float(i)/7.))); } o=a/8.;` },
    'Whip Blur': { params: [s('angle', 'Direction', -180, 180, 0), s('amount', 'Blur Length', 0, 100, 40), s('shift', 'Offset (%)', -100, 100, 0)],
      body: `float a=radians(angle); vec2 d=vec2(cos(a),sin(a)); vec2 p=uv-d*shift/100.; vec4 c=vec4(0.); for(int i=0;i<24;i++){ c+=S(fract(p+d*amount*0.004*(float(i)/23.-.5))); } o=c/24.;` },
    'Auto Ken Burns': { params: [s('dur', 'Duration (s)', 0.5, 60, 5, 0.1), s('s0', 'Start Scale (%)', 100, 200, 100), s('s1', 'End Scale (%)', 100, 200, 120), sel('pan', 'Pan', ['None', 'Left', 'Right', 'Up', 'Down', 'Up Left', 'Up Right', 'Down Left', 'Down Right']), chk('ease', 'Ease In / Out', true)],
      body: `float t=clamp(u_time/dur,0.,1.); if(ease>0.5) t=t*t*(3.-2.*t); float z=mix(s0,s1,t)/100.; vec2 dd=pan<0.5?vec2(0.):pan<1.5?vec2(-1.,0.):pan<2.5?vec2(1.,0.):pan<3.5?vec2(0.,1.):pan<4.5?vec2(0.,-1.):pan<5.5?vec2(-1.,1.):pan<6.5?vec2(1.,1.):pan<7.5?vec2(-1.,-1.):vec2(1.,-1.);
        float room=.5-.5/max(min(s0,s1)/100.,1.0001); vec2 c0=.5+dd*room*(t*2.-1.); o=S(c0+(uv-.5)/z);` },
    'Bounce': { params: [s('height', 'Height (%)', 0, 100, 10), s('freq', 'Bounces / s', 0.1, 10, 2, 0.1), s('squash', 'Squash', 0, 100, 30)],
      body: `float ph=fract(u_time*freq); float y=4.*ph*(1.-ph)*height/100.; float sq=1.-squash/400.*(1.-smoothstep(0.,.15,min(ph,1.-ph))); vec2 p=vec2(.5+(uv.x-.5)/(2.-sq), (uv.y-y)/sq); o=SZ(p);` },
    'Swing': { params: [s('angle', 'Swing Angle', 0, 90, 10), s('freq', 'Swings / s', 0.05, 5, 0.5, 0.05), pt('pivot', 'Pivot', 0.5, 0), s('damp', 'Damping', 0, 100, 0)],
      body: `float a=radians(angle)*sin(u_time*freq*6.2831853)*exp(-u_time*damp/50.); vec2 pv=vec2(pivot.x,1.-pivot.y); vec2 q=(uv-pv)*${ASP}; q=vec2(q.x*cos(a)-q.y*sin(a),q.x*sin(a)+q.y*cos(a)); o=SZ(q/${ASP}+pv);` },
  },
  'Color Correction': {
    'Duotone': { params: [col('dark', 'Shadow Color', '#1d2b64'), col('light', 'Highlight Color', '#f8cdda'), amt(100), s('contrast', 'Contrast', -100, 100, 0)],
      body: `vec4 c=S(uv); float l=clamp((luma(c.rgb)-.5)*(1.+contrast/100.)+.5,0.,1.); o=vec4(mix(c.rgb,mix(dark,light,l),amount/100.),c.a);` },
    'Tritone': { params: [col('dark', 'Shadows', '#14213d'), col('mid', 'Midtones', '#c75b7a'), col('light', 'Highlights', '#ffe8a3'), amt(100)],
      body: `vec4 c=S(uv); float l=luma(c.rgb); vec3 t=l<.5?mix(dark,mid,l*2.):mix(mid,light,l*2.-1.); o=vec4(mix(c.rgb,t,amount/100.),c.a);` },
    'Gradient Map': { params: [sel('grad', 'Gradient', GRADIENTS), amt(100), chk('rev', 'Reverse')],
      fns: `vec3 gm(float g, float t){ vec3 a,b,c; if(g<0.5){a=vec3(.1,.0,.2);b=vec3(.9,.3,.2);c=vec3(1.,.9,.5);} else if(g<1.5){a=vec3(0.,.05,.2);b=vec3(0.,.45,.6);c=vec3(.7,1.,.95);} else if(g<2.5){a=vec3(.05,0.,0.);b=vec3(.9,.25,0.);c=vec3(1.,.95,.6);} else if(g<3.5){a=vec3(.1,0.,.25);b=vec3(.6,.2,.7);c=vec3(1.,.8,.9);}
        else if(g<4.5){a=vec3(.15,.08,0.);b=vec3(.75,.55,.15);c=vec3(1.,.95,.75);} else if(g<5.5){a=vec3(.02,.05,.15);b=vec3(.45,.7,.9);c=vec3(.95,1.,1.);} else if(g<6.5){a=vec3(0.,.08,.03);b=vec3(.25,.5,.2);c=vec3(.9,.95,.7);} else {a=vec3(.05,0.,.15);b=vec3(1.,.1,.6);c=vec3(.2,1.,.9);} return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.); }`,
      body: `vec4 c=S(uv); float l=luma(c.rgb); if(rev>0.5) l=1.-l; o=vec4(mix(c.rgb,gm(grad,l),amount/100.),c.a);` },
    'Split Toning': { params: [s('hHue', 'Highlight Hue', 0, 360, 40), s('hSat', 'Highlight Saturation', 0, 100, 30), s('sHue', 'Shadow Hue', 0, 360, 210), s('sSat', 'Shadow Saturation', 0, 100, 30), s('balance', 'Balance', -100, 100, 0)],
      body: `vec4 c=S(uv); float l=luma(c.rgb); float b=.5+balance/200.; vec3 ht=hsv2rgb(vec3(hHue/360.,1.,1.))-.5, st=hsv2rgb(vec3(sHue/360.,1.,1.))-.5; vec3 r=c.rgb+ht*hSat/250.*smoothstep(b-.2,1.,l)+st*sSat/250.*(1.-smoothstep(0.,b+.2,l)); o=vec4(clamp(r,0.,1.),c.a);` },
    'Selective Color': { params: HUE6.flatMap((h, i) => [s(`c${i}`, `${h}: Cyan`, -100, 100, 0), s(`m${i}`, `${h}: Magenta`, -100, 100, 0), s(`y${i}`, `${h}: Yellow`, -100, 100, 0), s(`k${i}`, `${h}: Black`, -100, 100, 0)]),
      fns: hueW,
      body: `vec4 c=S(uv); vec3 hv=rgb2hsv(c.rgb); float w0=hw(hv.x,0.)*hv.y, w1=hw(hv.x,1./6.)*hv.y, w2=hw(hv.x,2./6.)*hv.y, w3=hw(hv.x,3./6.)*hv.y, w4=hw(hv.x,4./6.)*hv.y, w5=hw(hv.x,5./6.)*hv.y;
        vec4 adj=(vec4(c0,m0,y0,k0)*w0+vec4(c1,m1,y1,k1)*w1+vec4(c2,m2,y2,k2)*w2+vec4(c3,m3,y3,k3)*w3+vec4(c4,m4,y4,k4)*w4+vec4(c5,m5,y5,k5)*w5)/100.; vec3 r=c.rgb-adj.xyz*.5*c.rgb-adj.w*.5*c.rgb; o=vec4(clamp(r,0.,1.),c.a);` },
    'Hue Cycle': { params: [s('speed', 'Speed (deg/s)', -720, 720, 90), s('offset', 'Hue Offset', -180, 180, 0), amt(100)],
      body: `vec4 c=S(uv); vec3 h=rgb2hsv(c.rgb); h.x=fract(h.x+(offset+u_time*speed)/360.); o=vec4(mix(c.rgb,hsv2rgb(h),amount/100.),c.a);` },
    'Day for Night': { params: [amt(80), s('dark', 'Darkness', 0, 100, 60), col('tint', 'Night Tint', '#3a5a9a'), s('moon', 'Highlight Moonlight', 0, 100, 30)],
      body: `vec4 c=S(uv); float l=luma(c.rgb); vec3 r=mix(c.rgb,vec3(l),.6)*tint*1.6; r*=1.-dark/130.; r+=smoothstep(.7,1.,l)*moon/250.*vec3(.8,.9,1.); r=(r-.02)*1.1; o=vec4(mix(c.rgb,clamp(r,0.,1.),amount/100.),c.a);` },
    'Infrared': { params: [amt(100), s('foliage', 'Foliage Glow', 0, 200, 100), sel('mode', 'Look', ['False Color', 'Black & White IR'])],
      body: `vec4 c=S(uv); vec3 x=c.rgb; float ir=clamp(x.g*1.4*foliage/100.+x.r*.3-x.b*.2,0.,1.); vec3 r=mode<0.5?vec3(ir,x.r*.8,x.b*.9+.05):vec3(ir*1.05); o=vec4(mix(c.rgb,clamp(r,0.,1.),amount/100.),c.a);` },
    'Thermal': { params: [amt(100), s('contrast', 'Contrast', 0, 300, 100)],
      body: `vec4 c=S(uv); float l=clamp((luma(c.rgb)-.5)*contrast/100.+.5,0.,1.); vec3 t=l<.25?mix(vec3(0.,0.,.2),vec3(.4,0.,.6),l*4.):l<.5?mix(vec3(.4,0.,.6),vec3(.9,.1,.1),(l-.25)*4.):l<.75?mix(vec3(.9,.1,.1),vec3(1.,.7,0.),(l-.5)*4.):mix(vec3(1.,.7,0.),vec3(1.,1.,.9),(l-.75)*4.); o=vec4(mix(c.rgb,t,amount/100.),c.a);` },
    'Vibrance': { params: [s('vib', 'Vibrance', -100, 100, 30), s('sat', 'Saturation', -100, 100, 0), chk('skin', 'Protect Skin Tones', true)],
      body: `vec4 c=S(uv); vec3 h=rgb2hsv(c.rgb); float skinW=skin>0.5?exp(-pow((h.x-.06)/.05,2.)):0.; float v=vib/100.*(1.-h.y)*(1.-skinW*.7); h.y=clamp(h.y*(1.+sat/100.)*(1.+v),0.,1.); o=vec4(hsv2rgb(h),c.a);` },
    'Black & White Mixer': { params: [...HUE6.map((h, i) => s(`w${i}`, h, -200, 300, [40, 60, 40, 60, 20, 80][i])), chk('tintOn', 'Tint'), col('tint', 'Tint Color', '#e0c8a0')],
      fns: hueW,
      body: `vec4 c=S(uv); vec3 hv=rgb2hsv(c.rgb); float l=luma(c.rgb); float ws=(w0*hw(hv.x,0.)+w1*hw(hv.x,1./6.)+w2*hw(hv.x,2./6.)+w3*hw(hv.x,3./6.)+w4*hw(hv.x,4./6.)+w5*hw(hv.x,5./6.))/100.; float g=clamp(l*(1.+(ws-.5)*hv.y*1.2),0.,1.); vec3 r=vec3(g); if(tintOn>0.5) r=mix(r,r*tint*1.3,.6); o=vec4(clamp(r,0.,1.),c.a);` },
    'Temperature & Tint': { params: [s('temp', 'Temperature', -100, 100, 0), s('tintv', 'Tint', -100, 100, 0), chk('preserve', 'Preserve Luminosity', true)],
      body: `vec4 c=S(uv); vec3 w=vec3(1.+temp/250.,1.-tintv/300.,1.-temp/250.)*vec3(1.,1.,1.)+vec3(tintv/600.,0.,tintv/600.); vec3 r=c.rgb*w; if(preserve>0.5) r*=luma(c.rgb)/max(luma(r),1e-4); o=vec4(clamp(r,0.,1.),c.a);` },
  },
  'Stylize': {
    'Outline': { params: [s('width', 'Stroke Width', 0, 50, 6), col('color', 'Stroke Color', '#ffffff'), sel('where', 'Position', ['Outside', 'Inside', 'Center']), s('soft', 'Softness', 0, 100, 10)],
      body: `vec4 c=S(uv); float w=width*${SC}; float mx=0., mn=1.; for(int i=0;i<24;i++){ float an=float(i)*.2618; for(int k=1;k<=3;k++){ float a2=SZ(uv+vec2(cos(an),sin(an))*w*float(k)/3./u_res).a; mx=max(mx,a2); mn=min(mn,a2); } }
        float st=where<0.5?mx*(1.-c.a):where<1.5?c.a*(1.-mn):max(mx*(1.-c.a),c.a*(1.-mn)); st=smoothstep(0.,1.-soft/110.,st); vec3 r=mix(c.rgb,color,where<0.5?0.:st); o=where<0.5?vec4(mix(color,c.rgb,c.a),max(c.a,st)):vec4(r,c.a);` },
    'Long Shadow': { params: [s('angle', 'Angle', -180, 180, -45), s('len', 'Length', 0, 500, 120), col('color', 'Shadow Color', '#000000'), s('opacity', 'Opacity', 0, 100, 60), chk('fade', 'Fade Out', true)],
      body: `vec4 c=S(uv); vec2 d=vec2(cos(radians(angle)),sin(radians(angle)))/u_res*${SC}; float sh=0.; for(int i=1;i<=64;i++){ float f=float(i)/64.; float a2=SZ(uv-d*len*f).a; sh=max(sh,a2*(fade>0.5?1.-f:1.)); } float sa=sh*opacity/100.*(1.-c.a); o=vec4(mix(color,c.rgb,c.a/(c.a+sa+1e-5)),c.a+sa);` },
    'Vignette': { params: [s('amount', 'Amount', -100, 100, -40), s('mid', 'Midpoint', 0, 100, 50), s('roundness', 'Roundness', -100, 100, 0), s('feather', 'Feather', 0, 100, 50), col('color', 'Color', '#000000')],
      body: `vec4 c=S(uv); vec2 q=(uv-.5)*mix(vec2(1.),${ASP},clamp(.5+roundness/200.,0.,1.)); float d=length(q)*1.414; float v=smoothstep(mid/100.*.9,mid/100.*.9+feather/100.+.01,d); vec3 tgt=amount<0.?color:vec3(1.); o=vec4(mix(c.rgb,tgt,v*abs(amount)/100.),c.a);` },
    'Frame Border': { params: [s('width', 'Border Width', 0, 200, 30), col('color', 'Color', '#ffffff'), s('radius', 'Inner Corner Radius', 0, 200, 0), sel('style', 'Style', ['Solid', 'Double Line', 'Film Strip', 'Instant Photo'])],
      body: `vec4 c=S(uv); vec2 px=uv*u_res; float w=width*${SC}; vec2 dd=min(px,u_res-px); float bw=style>2.5?w*3.:w; float edge=min(dd.x,dd.y-(style>2.5&&px.y<u_res.y*.5?w*2.:0.)); vec2 inner=max(vec2(radius*${SC})-dd+vec2(w),0.); float rr=length(inner)-radius*${SC};
        float m=step(edge,w); if(radius>0.&&dd.x<w+radius*${SC}&&dd.y<w+radius*${SC}) m=max(m,step(0.,rr)); if(style>0.5&&style<1.5) m=max(m*(1.-step(w*.35,edge)*step(edge,w*.65)),0.);
        vec3 fc=color; if(style>1.5&&style<2.5){ fc=vec3(.05); float hole=step(fract(px.x/(w*1.4)),.55)*step(w*.25,min(dd.y,9999.))*step(dd.y,w*.75); fc=mix(fc,vec3(.95),hole*step(dd.y,w)); } o=vec4(mix(c.rgb,fc,m),max(c.a,m));` },
    'Letterbox': { params: [sel('ratio', 'Aspect Ratio', ['2.39:1', '2.35:1', '2:1', '1.85:1', '16:9', '4:3', '1:1', '9:16']), col('color', 'Bar Color', '#000000'), s('offset', 'Offset (%)', -50, 50, 0), s('opacity', 'Opacity', 0, 100, 100)],
      body: `vec4 c=S(uv); float r=ratio<0.5?2.39:ratio<1.5?2.35:ratio<2.5?2.:ratio<3.5?1.85:ratio<4.5?1.7778:ratio<5.5?1.3333:ratio<6.5?1.:.5625; float fr=u_res.x/u_res.y; float m=0.;
        if(r>fr){ float h=fr/r; float y=uv.y-.5-offset/100.; m=step(h*.5,abs(y)); } else { float w=r/fr; float x=uv.x-.5-offset/100.; m=step(w*.5,abs(x)); } m*=opacity/100.; o=vec4(mix(c.rgb,color,m),max(c.a,m));` },
    'Rounded Corners': { params: [s('radius', 'Radius', 0, 500, 60), s('soft', 'Edge Softness', 0, 10, 1, 0.1)],
      body: `vec4 c=S(uv); vec2 px=uv*u_res; float R=radius*${SC}; vec2 q=abs(px-u_res*.5)-(u_res*.5-R); float d=length(max(q,0.))-R; o=vec4(c.rgb,c.a*(1.-smoothstep(-soft*${SC}-.5,soft*${SC}+.5,d)));` },
    'Split Screen': { params: [sel('arrange', 'Layout', ['2 Side by Side', '2 Stacked', '3 Columns', '3 Rows', '4 Grid', '9 Grid']), s('gap', 'Gap', 0, 100, 8), col('gapColor', 'Gap Color', '#000000'), chk('fill', 'Fill Each Cell', true)],
      body: `vec2 n=arrange<0.5?vec2(2.,1.):arrange<1.5?vec2(1.,2.):arrange<2.5?vec2(3.,1.):arrange<3.5?vec2(1.,3.):arrange<4.5?vec2(2.,2.):vec2(3.,3.); vec2 f=fract(uv*n); vec2 gp=gap*${SC}/u_res*n*.5; float inG=step(gp.x,f.x)*step(f.x,1.-gp.x)*step(gp.y,f.y)*step(f.y,1.-gp.y);
        vec2 cs=vec2(1.)/n; float ca=(cs.x*u_res.x)/(cs.y*u_res.y), fa=u_res.x/u_res.y; vec2 p=f; if(fill>0.5){ p=ca<fa?vec2(.5+(f.x-.5)*ca/fa,f.y):vec2(f.x,.5+(f.y-.5)*fa/ca); } vec4 c=S(p); o=inG>0.5?c:vec4(gapColor,1.);` },
    'Grid Repeat': { params: [s('cols', 'Columns', 1, 20, 3), s('rows', 'Rows', 1, 20, 3), chk('mirror', 'Mirror Alternate'), s('gap', 'Gap', 0, 50, 0), col('gapColor', 'Gap Color', '#000000')],
      body: `vec2 n=vec2(cols,rows); vec2 g=floor(uv*n), f=fract(uv*n); if(mirror>0.5){ vec2 m=mod(g,2.); f=mix(f,1.-f,m); } vec2 gp=gap*${SC}/u_res*n*.5; float inG=step(gp.x,f.x)*step(f.x,1.-gp.x)*step(gp.y,f.y)*step(f.y,1.-gp.y); o=inG>0.5?S(f):vec4(gapColor,1.);` },
  },
  'Keying': {
    'Spill Suppressor': { params: [col('key', 'Color To Suppress', '#00ff00'), s('amount', 'Suppression', 0, 100, 80), s('desat', 'Desaturate Spill', 0, 100, 20)],
      body: `vec4 c=S(uv); vec3 k=normalize(key+1e-4); float spill=max(0.,dot(c.rgb,k)-max(max(c.r*(1.-k.r),c.g*(1.-k.g)),c.b*(1.-k.b))*1.4); vec3 r=c.rgb-k*spill*amount/100.; r=mix(r,vec3(luma(r)),min(spill*2.,1.)*desat/100.); o=vec4(clamp(r,0.,1.),c.a);` },
    'Chroma Key 3D': { params: [col('key', 'Key Color', '#00ff00'), s('tol', 'Tolerance', 0, 100, 25), s('soft', 'Edge Softness', 0, 100, 15), sel('space', 'Color Space', ['YCbCr', 'RGB']), chk('show', 'Show Matte')],
      body: `vec4 c=S(uv); float d; if(space<0.5){ mat3 m=mat3(.299,-.1687,.5,.587,-.3313,-.4187,.114,.5,-.0813); vec3 a=m*c.rgb, b=m*key; d=length((a.yz-b.yz)*2.)+abs(a.x-b.x)*.15; } else d=length(c.rgb-key); float al=smoothstep(tol/100.*.6,tol/100.*.6+soft/100.*.4+.001,d);
        o=show>0.5?vec4(vec3(al),1.):vec4(c.rgb,c.a*al);` },
    'Matte Choker': { params: [s('choke', 'Choke', -100, 100, 20), s('soft', 'Gray Level Softness', 0, 100, 20), s('radius', 'Radius', 1, 20, 3)],
      body: `vec4 c=S(uv); float mx=c.a, mn=c.a; float R=radius*${SC}; for(int i=0;i<16;i++){ float an=float(i)*.3927; float a2=SZ(uv+vec2(cos(an),sin(an))*R/u_res).a; mx=max(mx,a2); mn=min(mn,a2); } float a=choke>0.?mix(c.a,mn,choke/100.):mix(c.a,mx,-choke/100.); a=smoothstep(.5-soft/200.-.001,.5+soft/200.+.001,a); o=vec4(c.rgb,a);` },
    'Alpha Refine': { params: [s('smooth2', 'Smooth', 0, 100, 30), s('contrast', 'Contrast', 0, 100, 30), s('shift', 'Shift Edge', -100, 100, 0), s('feather', 'Feather', 0, 100, 0)],
      body: `vec4 c=S(uv); float a=0.; float w=0.; float R=(1.+smooth2/10.+feather/10.)*${SC}; for(int j=-2;j<=2;j++) for(int i=-2;i<=2;i++){ float k=exp(-float(i*i+j*j)/4.); a+=SZ(uv+vec2(float(i),float(j))*R/u_res).a*k; w+=k; } a/=w; a=clamp((a-.5-shift/200.)*(1.+contrast/20.)+.5,0.,1.); o=vec4(c.rgb,mix(c.a,a,max(smooth2,feather)/100.+contrast/200.));` },
  },
};
