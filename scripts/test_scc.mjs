// SCC (CEA-608) caption writer / reader (src/Services/sccCaptions.js, audit G-07). Run: node scripts/test_scc.mjs
import { writeSCC, parseSCC, wrapCaption } from '../src/Services/sccCaptions.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };

const caps = [{ start: 2, dur: 3, text: 'Hello world' }, { start: 8, dur: 2, text: 'Second caption that is long enough to need two lines here' }, { start: 20.5, dur: 1, text: 'Café ñ' }];
for (const fps of [29.97, 30, 25, 24]) {
  const r = writeSCC(caps, fps); const t = r.text;
  ok(`scc ${fps}: header and control words with odd parity`, t.startsWith('Scenarist_SCC V1.0') && t.includes('9420 9420 94ae 94ae') && t.includes('942f 942f') && t.includes('942c 942c'));
  const back = parseSCC(t, fps);
  ok(`scc ${fps}: three captions come back`, back.length === 3, JSON.stringify(back));
  ok(`scc ${fps}: texts`, back[0].text === 'Hello world' && back[2].text === 'Café ñ' && back[1].text.split('\n').length === 2, JSON.stringify(back));
  ok(`scc ${fps}: start times within one frame`, caps.every((c, i) => Math.abs(back[i].start - c.start) <= 1.5 / fps + 0.001) , JSON.stringify(back.map((b) => b.start)));
  ok(`scc ${fps}: durations within a few frames`, Math.abs(back[0].dur - 3) < 0.15 && Math.abs(back[2].dur - 1) < 0.15, JSON.stringify(back.map((b) => b.dur)));
}
ok('scc: 29.97 uses drop-frame timecode', /\d\d:\d\d:\d\d;\d\d\t/.test(writeSCC(caps, 29.97).text) && /\d\d:\d\d:\d\d:\d\d\t/.test(writeSCC(caps, 25).text));
const thai = writeSCC([{ start: 1, dur: 1, text: 'สวัสดี ok' }], 30);
ok('scc: characters outside CEA-608 are replaced and counted', thai.replaced === 6 && parseSCC(thai.text, 30)[0].text === '?????? ok', JSON.stringify([thai.replaced, parseSCC(thai.text, 30)]));
ok('scc: ASCII that means another letter in 608 is not sent raw', writeSCC([{ start: 1, dur: 1, text: 'a*b' }], 30).replaced === 1);
const w = wrapCaption('x '.repeat(80));
ok('scc: more than 2 lines of 32 characters is cut and reported', w.lines.length === 2 && w.lines.every((l) => l.length <= 32) && w.cut === true && writeSCC([{ start: 1, dur: 1, text: 'x '.repeat(80) }], 30).cut === 1);
ok('scc: a word longer than a line is split', wrapCaption('y'.repeat(40)).lines.join('') === 'y'.repeat(40));
ok('scc: overlapping captions keep increasing timecodes', (() => { const t = writeSCC([{ start: 1, dur: 5, text: 'a' }, { start: 1.2, dur: 1, text: 'b' }], 30).text; const tcs = [...t.matchAll(/^(\d+):(\d+):(\d+):(\d+)\t/gm)].map((m) => ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 30 + +m[4]); return tcs.length >= 2 && tcs.every((x, i) => i === 0 || x >= tcs[i - 1]); })());
{ // a caption that follows too soon for its data to be sent is delayed only as far as the 2 bytes per frame data rate requires
  const r = parseSCC(writeSCC([{ start: 2, dur: 1, text: 'one' }, { start: 3, dur: 1, text: 'Second caption that is long enough to need two lines here' }], 30).text, 30);
  ok('scc: a start that the data rate cannot meet is delayed a little, never earlier', r.length === 2 && r[1].start >= 3 && r[1].start < 3.5 && r[0].dur >= 1, JSON.stringify(r));
}
ok('scc: not an SCC file is refused', (() => { try { parseSCC('WEBVTT'); return false; } catch (e) { return /SCC/.test(e.message); } })());
ok('scc: an empty list gives a valid header-only file', parseSCC(writeSCC([], 30).text, 30).length === 0);

// image sequence detection (G-04)
{
  const { findSequences, sequenceArgs, sequencePattern } = await import('../src/Services/imageSequence.js');
  const names = ['shot_0001.png', 'shot_0002.png', 'shot_0003.png', 'shot_0007.png', 'shot_0008.png', 'other10.jpg', 'other11.jpg', 'other12.jpg', 'other13.jpg', 'notes.txt', 'single_01.png', 'clip.mp4'];
  const r = findSequences(names);
  ok('sequences: the longest numbered run comes first, gaps split runs', r.length === 2 && r[0].prefix === 'other' && r[0].count === 4 && r[1].prefix === 'shot_' && r[1].count === 3 && r[1].missing === 2, JSON.stringify(r));
  ok('sequences: padding and first number are kept', r[1].pad === 4 && r[1].first === 1 && r[1].last === 3 && r[0].first === 10 && r[0].pad === 2);
  ok('sequences: a single numbered file or other types are not a sequence', findSequences(['a_01.png', 'b.png', 'c_02.txt', 'd_03.mov']).length === 0);
  ok('sequences: ffmpeg pattern for a Windows folder with spaces', sequencePattern('D:\\My Frames', r[1]) === 'D:\\My Frames\\shot_%04d.png');
  const a = sequenceArgs('/f', r[1], 24, '/o.mp4', false);
  ok('sequences: arguments name rate, start number and frame count', a.join(' ').includes('-framerate 24 -start_number 1 -i /f/shot_%04d.png -frames:v 3') && a.includes('libx264') && sequenceArgs('/f', r[1], 24, '/o.webm', true).includes('yuva420p'));
}

console.log(`scc: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
