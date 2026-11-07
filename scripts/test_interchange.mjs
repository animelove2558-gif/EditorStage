// EDL / FCPXML / FCP7 XML export -> import round trip. Run: node scripts/test_interchange.mjs
import { writeEDL, parseEDL } from '../src/Services/interchange/edl.js';
import { writeFCPXML, parseFCPXML } from '../src/Services/interchange/fcpxml.js';
import { writeXMEML, parseXMEML } from '../src/Services/interchange/xmeml.js';
import { writeOTIO, parseOTIO } from '../src/Services/interchange/otio.js';
import { describeSequence, quantize, pathToUrl, urlToPath } from '../src/Services/interchange/model.js';
import { framesToTC, tcToFrames } from '../src/Services/interchange/timecode.js';
import { parseXml } from '../src/Services/interchange/xml.js';
import { parseAscSop, parseAscSat } from '../src/Services/interchange/fxImport.js';

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

// ---- Phase 9 D11: effects, color and keyframes come in with the edit ----
{
  const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;
  const edl = `TITLE: Graded
FCM: NON-DROP FRAME

001  A001     V     C        01:00:10:00 01:00:12:00 01:00:00:00 01:00:02:00
* FROM CLIP NAME: A001.mp4
* ASC_SOP (1.2 1.0 0.8)(0.05 0.0 -0.05)(1.0 1.1 0.9)
* ASC_SAT 0.75
002  B002     V     C        01:00:00:00 01:00:01:00 01:00:02:00 01:00:03:00
* FROM CLIP NAME: B002.mov
003  C003     B     C        01:00:00:00 01:00:01:00 01:00:03:00 01:00:04:00
* FROM CLIP NAME: C003.mov
* ASC_SAT 0
`;
  const d = parseEDL(edl, 30);
  const v1 = d.clips.filter((c) => c.track === 'V1');
  const cdl = v1[0].effects?.[0];
  ok('EDL: ASC_SOP / ASC_SAT become an ASC CDL effect on the event', cdl?.name === 'ASC CDL' && cdl.params.sr.v === 1.2 && cdl.params.sb.v === 0.8 && cdl.params.or.v === 0.05 && cdl.params.ob.v === -0.05 && cdl.params.pg.v === 1.1 && cdl.params.sat.v === 0.75, JSON.stringify(cdl));
  ok('EDL: an event without CDL has no effect', !v1[1].effects);
  const c3 = d.clips.filter((c) => c.name === 'C003.mov');
  ok('EDL: ASC_SAT alone -> CDL with neutral slope/offset/power, on the video only (not the audio of a B event)', c3.length === 2 && c3.find((c) => c.track === 'V1').effects[0].params.sat.v === 0 && c3.find((c) => c.track === 'V1').effects[0].params.sr.v === 1 && !c3.find((c) => c.track === 'A1').effects, JSON.stringify(c3));
  ok('EDL: parseAscSop rejects a malformed line', parseAscSop('* ASC_SOP (1 1)(0 0 0)(1 1 1)') === null && parseAscSat('* ASC_SAT x') === null);

  const fx = `<?xml version="1.0" encoding="UTF-8"?>
<fcpxml version="1.9">
  <resources>
    <format id="r1" frameDuration="1/25s" width="1920" height="1080"/>
    <asset id="r2" name="A001" start="0s" duration="60s" hasVideo="1" hasAudio="1"><media-rep kind="original-media" src="file:///C:/Footage/A001.mp4"/></asset>
    <effect id="r3" name="Gaussian Blur" uid="FFGaussianBlur"/>
    <effect id="r4" name="Color Board" uid="FFColorBoard"/>
  </resources>
  <library><event name="E"><project name="FX"><sequence format="r1" duration="10s"><spine>
    <asset-clip ref="r2" offset="0s" start="10s" duration="4s" name="A001">
      <adjust-transform position="10 -5" scale="1.5 1.5" rotation="90">
        <param name="position"><keyframeAnimation><keyframe time="10s" value="0 0"/><keyframe time="12s" value="10 -5"/></keyframeAnimation></param>
      </adjust-transform>
      <adjust-blend amount="0.5"/>
      <adjust-crop mode="trim"><trim-rect left="9" right="0" top="5" bottom="0"/></adjust-crop>
      <adjust-volume amount="-6dB"><param name="amount"><keyframeAnimation><keyframe time="10s" value="0dB"/><keyframe time="11s" value="-12dB"/></keyframeAnimation></param></adjust-volume>
      <filter-video ref="r3" name="Gaussian Blur"><param name="Amount" key="1" value="20"/></filter-video>
      <filter-video ref="r4" name="Color Board"/>
    </asset-clip>
  </spine></sequence></project></event></library>
</fcpxml>`;
  const f = parseFCPXML(fx);
  const fv = f.clips.find((c) => c.track === 'V1'), fa = f.clips.find((c) => c.track === 'A1');
  ok('FCPXML: position (percent of frame height, y up) -> frame fraction (y down)', near(fv.motion.position.v[0], 0.5 + (10 * 1080) / 100 / 1920) && near(fv.motion.position.v[1], 0.55), JSON.stringify(fv.motion.position));
  ok('FCPXML: position keyframes at clip-local times (start 10 s -> 0 s, 12 s -> 2 s)', fv.motion.position.keys.length === 2 && fv.motion.position.keys[0].t === 0 && fv.motion.position.keys[1].t === 2 && near(fv.motion.position.keys[0].v[0], 0.5), JSON.stringify(fv.motion.position.keys));
  ok('FCPXML: scale 1.5 -> 150 %, rotation 90 (counter-clockwise) -> -90', fv.motion.scale.v === 150 && fv.motion.rotation.v === -90);
  ok('FCPXML: blend amount 0.5 -> Opacity 50 %', fv.opacity.opacity.v === 50);
  const crop = fv.effects.find((e) => e.name === 'Crop'); const blur = fv.effects.find((e) => e.name === 'Gaussian Blur');
  ok('FCPXML: trim-rect -> Crop (left 9 % of height = 5.0625 % of width, top 5 %)', crop && near(crop.params.l.v, 5.0625) && crop.params.t.v === 5, JSON.stringify(crop));
  ok('FCPXML: Gaussian Blur filter -> Gaussian Blur (Amount 20)', blur && blur.params.blurriness.v === 20);
  ok('FCPXML: volume -6 dB with keyframes on the audio clip (not the video)', fa.volume.level.v === -6 && fa.volume.level.keys.map((k) => [k.t, k.v]).join() === '0,0,1,-12' && !fv.volume && !fa.motion);
  ok('FCPXML: filters it cannot carry are reported (Color Board)', (f.unknownFx || []).includes('Color Board'), JSON.stringify(f.unknownFx));

  const xm = `<?xml version="1.0" encoding="UTF-8"?>
<xmeml version="5"><sequence id="s1"><name>P</name><rate><timebase>25</timebase><ntsc>FALSE</ntsc></rate>
<media><video><format><samplecharacteristics><width>1920</width><height>1080</height></samplecharacteristics></format>
<track><clipitem id="c1"><name>A001</name><start>0</start><end>100</end><in>50</in><out>150</out>
  <file id="f1"><name>A001.mp4</name><pathurl>file:///C:/Footage/A001.mp4</pathurl><duration>1500</duration><media><video/><audio/></media></file>
  <filter><effect><name>Basic Motion</name><effectid>basic</effectid><parameter><parameterid>scale</parameterid><value>100</value><keyframe><when>50</when><value>100</value></keyframe><keyframe><when>100</when><value>200</value></keyframe></parameter>
    <parameter><parameterid>rotation</parameterid><value>45</value></parameter><parameter><parameterid>center</parameterid><value><horiz>0.1</horiz><vert>-0.2</vert></value></parameter></effect></filter>
  <filter><effect><name>Opacity</name><effectid>opacity</effectid><parameter><parameterid>opacity</parameterid><value>80</value></parameter></effect></filter>
  <filter><effect><name>Crop</name><effectid>crop</effectid><parameter><parameterid>left</parameterid><value>10</value></parameter><parameter><parameterid>top</parameterid><value>0</value></parameter></effect></filter>
  <filter><effect><name>Three-Way Color Corrector</name><effectid>Color Corrector 3-way</effectid></effect></filter>
</clipitem></track></video>
<audio><track><clipitem id="c2"><name>A001</name><start>0</start><end>100</end><in>50</in><out>150</out><file id="f1"/>
  <filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><parameter><parameterid>level</parameterid><value>0.5</value><keyframe><when>50</when><value>1</value></keyframe><keyframe><when>75</when><value>0.5</value></keyframe></parameter></effect></filter>
</clipitem></track></audio></media></sequence></xmeml>`;
  const x = parseXMEML(xm);
  const xv = x.clips.find((c) => c.track === 'V1'), xa = x.clips.find((c) => c.track === 'A1');
  ok('XML: Basic Motion scale keyframes (when = source frames from the in point) -> 0 s 100 %, 2 s 200 %', xv.motion.scale.keys.map((k) => [k.t, k.v]).join() === '0,100,2,200', JSON.stringify(xv.motion.scale));
  ok('XML: rotation 45, centre offset (0.1, -0.2) -> position (0.6, 0.3)', xv.motion.rotation.v === 45 && near(xv.motion.position.v[0], 0.6) && near(xv.motion.position.v[1], 0.3), JSON.stringify(xv.motion));
  ok('XML: Opacity 80, Crop left 10', xv.opacity.opacity.v === 80 && xv.effects.find((e) => e.name === 'Crop').params.l.v === 10);
  ok('XML: Audio Levels (linear gain) -> Volume dB keyframes 0 / -6 dB', near(xa.volume.level.v, -6.0206) && xa.volume.level.keys.length === 2 && xa.volume.level.keys[0].v === 0 && near(xa.volume.level.keys[1].v, -6.0206) && xa.volume.level.keys[1].t === 1, JSON.stringify(xa.volume));
  ok('XML: effects it cannot carry are reported', (x.unknownFx || []).includes('Three-Way Color Corrector'), JSON.stringify(x.unknownFx));
  ok('a clip without effects stays plain (round trip of an EditorStage export)', (() => { const rt = parseFCPXML(writeFCPXML(quantize(describeSequence(seq, media)))); return rt.clips.every((c) => !c.motion && !c.opacity && !c.volume && !c.effects); })());
}

// ---- OpenTimelineIO (G-02) ----
for (const fps of [30, 29.97, 25]) {
  const d = quantize({ ...desc, fps }); const text = writeOTIO(d); const back = parseOTIO(text);
  ok(`otio ${fps}: Timeline with Stack and Tracks`, JSON.parse(text).OTIO_SCHEMA === 'Timeline.1' && JSON.parse(text).tracks.OTIO_SCHEMA === 'Stack.1');
  same(`otio ${fps} clips`, norm(back), norm(d));
  same(`otio ${fps} transitions`, normT(back), normT(d));
  same(`otio ${fps} markers`, back.markers.map((m) => `${m.time.toFixed(3)} ${m.name}`), d.markers.map((m) => `${m.time.toFixed(3)} ${m.name}`));
  same(`otio ${fps} links`, linkedPairs(back), linkedPairs(d));
  ok(`otio ${fps} media paths survive (spaces and &)`, back.media.length === d.media.length && back.media.some((m) => m.path === 'D:\\Shoot <2>\\B002 & co.mov'));
}
ok('otio: a file that is not OTIO is refused', (() => { try { parseOTIO('{"a":1}'); return false; } catch (e) { return /OpenTimelineIO/.test(e.message); } })() && (() => { try { parseOTIO('nope'); return false; } catch { return true; } })());
{
  const R = (v, rate = 24) => ({ value: v, rate });
  const foreign = JSON.stringify({ OTIO_SCHEMA: 'Timeline.1', name: 'Other tool', tracks: { OTIO_SCHEMA: 'Stack.1', children: [{ OTIO_SCHEMA: 'Track.1', kind: 'Video', children: [
    { OTIO_SCHEMA: 'Gap.1', source_range: { start_time: R(0), duration: R(12) } },
    { OTIO_SCHEMA: 'Clip.2', name: 'a', source_range: { start_time: R(24), duration: R(48) }, media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: 'ExternalReference.1', target_url: 'file:///C:/x/a.mov', available_range: { start_time: R(0), duration: R(240) } } }, active_media_reference_key: 'DEFAULT_MEDIA', effects: [{ OTIO_SCHEMA: 'Effect.1', effect_name: 'Blur' }] },
    { OTIO_SCHEMA: 'Clip.2', name: 'gen', media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: 'GeneratorReference.1' } }, active_media_reference_key: 'DEFAULT_MEDIA', source_range: { start_time: R(0), duration: R(24) } }] }] } });
  const d = parseOTIO(foreign);
  ok('otio from another tool: gap, clip at 24 fps, generator skipped', d.fps === 24 && d.clips.length === 1 && d.clips[0].start === 0.5 && d.clips[0].inPoint === 1 && d.clips[0].dur === 2 && d.skipped === 1 && d.media[0].path === 'C:\\x\\a.mov' && d.unknownFx.includes('Blur'));
}

// ---- Markers as CSV (G-05) ----
{
  const { markersToCsv } = await import('../src/Services/markersCsv.js');
  const csv = markersToCsv([{ time: 10, dur: 2, name: 'ฉาก, "หนึ่ง"', comment: 'line1\nline2', color: '#e53935', type: 'chapter' }, { time: 1, name: 'First' }], 30);
  const lines = csv.split('\r\n');
  ok('csv: BOM, header and rows sorted by time', csv.charCodeAt(0) === 0xfeff && lines[0].endsWith('Name,Color,Type,In,Out,Duration,In (seconds),Comment') && lines[1].startsWith('First,Green,comment,00:00:01:00'));
  ok('csv: Thai, commas, quotes and line breaks are quoted', csv.includes('"ฉาก, ""หนึ่ง""",Red,chapter,00:00:10:00,00:00:12:00,00:00:02:00,10.000,"line1\nline2"'));
}

console.log(`interchange: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
