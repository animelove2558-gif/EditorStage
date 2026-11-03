// Generates the small media files used by the end-to-end tests into test-assets/e2e/. Run: node scripts/e2e/make_assets.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-assets/e2e');
fs.mkdirSync(out, { recursive: true });
const run = (name, args) => {
  const dst = path.join(out, name); if (fs.existsSync(dst)) return;
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args, dst], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${name}`);
  console.log('created', name);
};
// 3 s: 1 s red, 1 s green, 1 s blue (frame hold / speed tests), stereo audio: 440 Hz left, silence right
run('rgb_seconds.mp4', ['-f', 'lavfi', '-i', 'color=c=red:s=320x240:r=30:d=1', '-f', 'lavfi', '-i', 'color=c=lime:s=320x240:r=30:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=30:d=1',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:d=3',
  '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v];[3:a][4:a]join=inputs=2:channel_layout=stereo[a]', '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-t', '3']);
// interlace pattern (lossless PNG): even lines (from the top) blue, odd lines red
run('fields.png', ['-f', 'lavfi', '-i', "color=c=black:s=320x240,format=rgb24,geq=r='if(mod(Y\,2)\,255\,0)':g=0:b='if(mod(Y\,2)\,0\,255)'", '-frames:v', '1']);
// stereo tone file for channel mapping: 440 Hz left only
run('left_tone.wav', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:d=2', '-filter_complex', '[0:a][1:a]join=inputs=2:channel_layout=stereo[a]', '-map', '[a]', '-c:a', 'pcm_s16le']);
// Phase 2: frame-numbered video (gray level = 2 x frame number, 4 s at 30 fps, no audio) for speed / reverse / ramp checks
run('ramp_gray.mp4', ['-f', 'lavfi', '-i', "color=c=black:s=160x120:r=30:d=4,format=gray,geq=lum='2*N'", '-c:v', 'libx264', '-crf', '1', '-pix_fmt', 'yuv420p', '-g', '1']);
// alternating black / white frames (frame blending: half-way between two frames is mid gray)
run('blink.mp4', ['-f', 'lavfi', '-i', "color=c=black:s=160x120:r=30:d=2,format=gray,geq=lum='255*mod(N,2)'", '-c:v', 'libx264', '-crf', '1', '-pix_fmt', 'yuv420p', '-g', '1']);
// 440 Hz tone, both channels, amplitude rising linearly over 4 s (reverse audio check)
run('ramp_tone.wav', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4', '-af', "volume='t/4':eval=frame,aformat=channel_layouts=stereo", '-c:a', 'pcm_s16le']);
// textured 60x60 box moving over a dark background: centre (70 + 40 t, 90 + 10 t) px, 4 s at 30 fps (mask tracking / point tracker)
run('moving_box.mp4', ['-f', 'lavfi', '-i', 'color=c=0x202020:s=320x180:r=30:d=4', '-f', 'lavfi', '-i', "color=c=black:s=60x60:r=30:d=4,format=gray,geq=lum='128+110*sin(X*0.7+Y*0.2)*cos(Y*0.9-X*0.3)'",
  '-filter_complex', "[1:v]format=yuv420p[b];[0:v][b]overlay=x='40+40*t':y='60+10*t':shortest=1,format=yuv420p[v]", '-map', '[v]', '-c:v', 'libx264', '-crf', '4', '-g', '1']);
// color tests (lossless PNG, 160x120): a gray ramp with a blue cast, a flat low-contrast ramp, a neutral ramp with a skin patch and a darker warm version of it
const ramp = (r, g, b) => ['-f', 'lavfi', '-i', `color=c=black:s=160x120,format=rgb24,geq=r='${r}':g='${g}':b='${b}'`, '-frames:v', '1'];
run('cast.png', ramp('20+X*0.9', '25+X*1.0', 'min(255,50+X*1.2)'));
run('flat.png', ramp('90+X*0.4', '90+X*0.4', '90+X*0.4'));
const skin = (v, s) => `if(between(X,100,140)*between(Y,30,90),${s},${v})`;
run('neutral.png', ramp(skin('20+X*1.3', '217'), skin('20+X*1.3', '158'), skin('20+X*1.3', '128')));
run('warm.png', ramp(skin('min(255,30+X*1.0)', '190'), skin('14+X*0.8', '110'), skin('8+X*0.6', '70')));
console.log('assets ready in', out);
// Remix (Phase 7C): 60 s of music at 120 BPM (kick on every beat, off-beat hats, a chord change every bar of 2 s, 4-bar loop)
// and 12 s of beat-less filtered noise (a "whoosh": must be refused)
run('beat_music.wav', ['-f', 'lavfi', '-i', "aevalsrc='0.7*sin(2*PI*60*t)*exp(-15*mod(t,0.5))+0.12*(sin(2*PI*F*t)+sin(2*PI*F*1.25*t)+sin(2*PI*F*1.5*t))+0.08*(2*random(0)-1)*exp(-60*mod(t+0.25,0.5))'".replace(/F/g, '(220*if(lt(mod(t,8),2),1,if(lt(mod(t,8),4),0.8909,if(lt(mod(t,8),6),0.7492,0.8409))))') + ':s=44100:d=60', '-ac', '2', '-c:a', 'pcm_s16le']);
run('whoosh.wav', ['-f', 'lavfi', '-i', 'anoisesrc=d=12:c=pink:r=44100:a=0.5', '-af', "volume='sin(PI*t/12)':eval=frame,lowpass=f=1500", '-ac', '2', '-c:a', 'pcm_s16le']);
