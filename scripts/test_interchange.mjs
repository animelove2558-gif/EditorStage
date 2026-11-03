// EDL / FCPXML / FCP7 XML export -> import round trip. Run: node scripts/test_interchange.mjs
import { writeEDL, parseEDL } from '../src/Services/interchange/edl.js';
import { writeFCPXML, parseFCPXML } from '../src/Services/interchange/fcpxml.js';
import { writeXMEML, parseXMEML } from '../src/Services/interchange/xmeml.js';
import { describeSequence, quantize, pathToUrl, urlToPath } from '../src/Services/interchange/model.js';
import { framesToTC, tcToFrames } from '../src/Services/interchange/timecode.js';
import { parseXml } from '../src/Services/interchange/xml.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };

// ---- timecode ----
ok('NDF 30', framesToTC(30 * 3600 + 15, 30) === '01:00:00:15' && tcToFrames('01:00:00:15', 30) === 108015);
ok('DF 29.97 minute 1', framesToTC(1800, 29.97, true) === '00:01:00;02');
ok('DF 29.97 minute 10', framesToTC(17982, 29.97, true) === '00:10:00;00');
let dfOk = true; for (let f = 0; f < 200000; f += 37) if (tcToFrames(framesToTC(f, 29.97, true), 29.97) !== f) { dfOk = false; break; }
ok('DF round trip', dfOk);
ok('url <-> path (windows)', urlToPath(pathToUrl('C:\\Media Files\\ฉาก 1#.mp4')) === 'C:\\Media Files\\ฉาก 1#.mp4', pathToUrl('C:\\Media Files\\ฉาก 1#.mp4'));
ok('url <-> path (posix)', urlToPath(pathToUrl('/Users/a b/clip.mov', 'localhost')) === '/Users/a b/clip.mov');
ok('xml entities', parseXml('<a x="1 &amp; 2"><b>&lt;t&gt; &#3647;</b></a>').children[0].text === '<t> ฿');

// ---- fixture: an EditorStage sequence ----
const media = [
  { id: 'm1', name: 'A001.mp4', path: 'C:\\Footage\\A001.mp4', kind: 'video', duration: 60, hasAudio: true, width: 1920, height: 1080 },
  { id: 'm2', name: 'B002 & co.mov', path: 'D:\\Shoot <2>\\B002 & co.mov', kind: 'video', duration: 30, hasAudio: true, width: 1920, height: 1080 },
  { id: 'm3', name: 'music.wav', path: 'C:\\Audio\\music.wav', kind: 'audio', duration: 120, hasAudio: true },
];
const C = (id, track, start, dur, inPoint, mediaId, extra = {}) => ({ id, track, start, dur, inPoint, mediaId, speed: 1, name: media.find((m) => m.id === mediaId).name, enabled: true, effects: [], ...extra });
const seq = {
  id: 's', name: 'Round Trip', fps: 30, width: 1920, height: 1080,
  tracks: ['V3', 'V2', 'V1', 'A1', 'A2'].map((id) => ({ id, kind: id[0] === 'V' ? 'video' : 'audio' })),
  clips: [
    C('c1', 'V1', 0, 5, 10, 'm1', { linkId: 'L1', noAudio: true }), C('a1', 'A1', 0, 5, 10, 'm1', { linkId: 'L1' }),
    C('c2', 'V1', 5, 4, 2, 'm2', { linkId: 'L2', noAudio: true }), C('a2', 'A1', 5, 4, 2, 'm2', { linkId: 'L2' }),
    C('c3', 'V1', 12, 3, 30, 'm1', { linkId: 'L3', noAudio: true, speed: 2 }), C('a3', 'A1', 12, 3, 30, 'm1', { linkId: 'L3', speed: 2 }),
    C('c4', 'V2', 2, 2, 0, 'm2'),
    C('mu', 'A2', 0, 15, 5, 'm3'),
    { id: 'g1', track: 'V3', start: 1, dur: 3, name: 'Title', graphic: { text: 'x' } }, // not interchangeable -> skipped
  ],
  transitions: [
    { id: 't1', track: 'V1', kind: 'video', name: 'Cross Dissolve', at: 5, dur: 1, aId: 'c1', bId: 'c2' },
    { id: 't2', track: 'V1', kind: 'video', name: 'Cross Dissolve', at: 15, dur: 1, aId: 'c3', bId: null },
  ],
  markers: [{ id: 'k1', time: 3, name: 'Intro' }, { id: 'k2', time: 13, name: 'Speed ramp' }],
};
const desc = quantize(describeSequence(seq, media));
ok('describe skips title', desc.skipped === 1 && desc.clips.length === 8);

const pathOf = (d, id) => d.media.find((m) => m.id === id)?.path;
const norm = (d, tracks) => d.clips.filter((c) => !tracks || tracks.includes(c.track)).map((c) => `${c.track}@${c.start.toFixed(3)} dur=${c.dur.toFixed(3)} in=${c.inPoint.toFixed(3)} x${c.speed.toFixed(3)} ${pathOf(d, c.mediaId)}`).sort();
const normT = (d, tracks) => d.transitions.filter((t) => !tracks || tracks.includes(t.track)).map((t) => `${t.track}@${t.at.toFixed(3)} dur=${t.dur.toFixed(3)} ${t.aId ? 'A' : '-'}${t.bId ? 'B' : '-'}`).sort();
const same = (name, a, b) => { const ja = JSON.stringify(a), jb = JSON.stringify(b); ok(name, ja === jb, `\n  expected ${ja}\n  got      ${jb}`); };
const linkedPairs = (d) => { const g = {}; for (const c of d.clips) if (c.linkId) (g[c.linkId] = g[c.linkId] || []).push(`${c.track}@${c.start.toFixed(2)}`); return Object.values(g).map((x) => x.sort().join('+')).sort(); };

// ---- EDL (V1 + audio in one file, V2 in a second file) ----
for (const fps of [30, 29.97, 25]) {
  const d = quantize({ ...desc, fps });
  const edl = writeEDL(d, { videoTrack: 'V1' });
  const back = parseEDL(edl, fps);
  same(`EDL ${fps} clips V1/A1/A2`, norm(back), norm(d, ['V1', 'A1', 'A2']));
  same(`EDL ${fps} transitions`, normT(back), normT(d, ['V1']));
  const v2 = parseEDL(writeEDL(d, { videoTrack: 'V2', withAudio: false }), fps, { videoTrack: 'V2' });
  same(`EDL ${fps} V2 file`, norm(v2), norm(d, ['V2']));
  if (fps === 29.97) ok('EDL 29.97 is drop frame', /FCM: DROP FRAME/.test(edl) && /;\d\d/.test(edl));
}
ok('EDL title + source file comments', /TITLE: Round Trip/.test(writeEDL(desc)) && /\* SOURCE FILE: D:\\Shoot <2>\\B002 & co\.mov/.test(writeEDL(desc)));
ok('EDL record TC hour offset', norm(parseEDL(writeEDL(desc).replace(/ 00:(\d\d:\d\d:\d\d)\r?\n/g, ' 01:$1\n').replace(/(\d\d:\d\d:\d\d:\d\d) 00:(\d\d:\d\d:\d\d) 00:/g, '$1 01:$2 01:'), 30))[0] === norm(parseEDL(writeEDL(desc), 30))[0]);

// ---- FCPXML ----
{
  const x = writeFCPXML(desc); const back = parseFCPXML(x);
  ok('FCPXML version 1.9 + media-rep', /<fcpxml version="1.9">/.test(x) && /<media-rep kind="original-media" src="file:\/\/\/C:\/Footage\/A001.mp4"\/>/.test(x));
  same('FCPXML clips', norm(back), norm(desc));
  same('FCPXML transitions', normT(back), normT(desc));
  same('FCPXML markers', back.markers.map((m) => `${m.time.toFixed(3)} ${m.name}`), desc.markers.map((m) => `${m.time.toFixed(3)} ${m.name}`));
  same('FCPXML links', linkedPairs(back), ['A1@0.00+V1@0.00', 'A1@12.00+V1@12.00', 'A1@5.00+V1@5.00']);
  ok('FCPXML fps/size', back.fps === 30 && back.width === 1920 && back.height === 1080);
  const d2997 = quantize({ ...desc, fps: 29.97 }); const b2 = parseFCPXML(writeFCPXML(d2997));
  ok('FCPXML 29.97 rational time', /frameDuration="1001\/30000s"/.test(writeFCPXML(d2997)) && b2.fps === 29.97);
  same('FCPXML 29.97 clips', norm(b2), norm(d2997));
}
// ---- FCP7 XML (Premiere) ----
{
  const x = writeXMEML(desc); const back = parseXMEML(x);
  ok('xmeml header', /<xmeml version="5">/.test(x) && /<pathurl>file:\/\/localhost\/D:\/Shoot%20%3C2%3E\/B002%20%26%20co.mov<\/pathurl>/.test(x));
  same('xmeml clips', norm(back), norm(desc));
  same('xmeml transitions', normT(back), normT(desc));
  same('xmeml markers', back.markers.map((m) => `${m.time.toFixed(3)} ${m.name}`), desc.markers.map((m) => `${m.time.toFixed(3)} ${m.name}`));
  same('xmeml links', linkedPairs(back), ['A1@0.00+V1@0.00', 'A1@12.00+V1@12.00', 'A1@5.00+V1@5.00']);
  ok('xmeml one file element per media', (x.match(/<pathurl>/g) || []).length === 3);
  const sel = quantize(describeSequence(seq, media, ['c2', 'a2']));
  ok('selection export only selected', parseXMEML(writeXMEML(sel)).clips.length === 2);
  // Premiere style: -1 at edges inside transitions
  const prem = x.replace(/<start>150<\/start>/, '<start>-1</start>');
  ok('xmeml -1 start resolved from transition', norm(parseXMEML(prem)).join() === norm(back).join() && x.includes('<start>150</start>'));
}

console.log(`interchange: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
