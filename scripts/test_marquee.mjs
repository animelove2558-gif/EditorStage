// Timeline marquee selection (which clips a dragged box touches). Run: node scripts/test_marquee.mjs
import { clipsInBox } from '../src/Core/marquee.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const pps = 10; // 10 px per second
// rows top to bottom: new-video row (22), V2 (40), V1 (40), A1 (40), A2 (40), new-audio row (22)
const rows = [{ trackId: null, h: 22 }, { trackId: 'V2', h: 40 }, { trackId: 'V1', h: 40 }, { trackId: 'A1', h: 40 }, { trackId: 'A2', h: 40 }, { trackId: null, h: 22 }];
const y = { V2: 22, V1: 62, A1: 102, A2: 142 }; // top of each track
const seq = {
  tracks: [{ id: 'V2' }, { id: 'V1' }, { id: 'A1' }, { id: 'A2' }],
  clips: [
    { id: 'v1a', track: 'V1', start: 0, dur: 3 }, { id: 'v1b', track: 'V1', start: 5, dur: 2 },
    { id: 'v2a', track: 'V2', start: 2, dur: 2 },
    { id: 'a1a', track: 'A1', start: 0, dur: 3 }, { id: 'a2a', track: 'A2', start: 8, dur: 1 },
  ],
};
const box = (x0, y0, x1, y1) => clipsInBox(seq, rows, { x0, y0, x1, y1 }, pps);

ok('box over one clip on one track', same(box(45, y.V1 + 5, 80, y.V1 + 30), ['v1b']));
ok('partly touching a clip selects it', same(box(65, y.V1 + 5, 100, y.V1 + 10), ['v1b']));
ok('box across video and audio tracks', same(box(10, y.V1 + 5, 20, y.A1 + 5), ['v1a', 'a1a']));
ok('box dragged up-left (reversed corners)', same(box(20, y.A1 + 5, 10, y.V1 + 5), ['v1a', 'a1a']));
ok('only audio tracks', same(box(0, y.A1 + 1, 100, y.A2 + 39), ['a1a', 'a2a']));
ok('all tracks, whole time', same(box(0, 0, 200, 200), ['v1a', 'v1b', 'v2a', 'a1a', 'a2a']));
ok('empty area selects nothing', box(31, y.V1 + 5, 49, y.V1 + 30).length === 0);
ok('box touching a clip edge exactly does not select it', box(30, y.V1 + 5, 49, y.V1 + 30).length === 0);
ok('box only in the new-track rows selects nothing', box(0, 0, 200, 21).length === 0);
{
  const locked = { ...seq, tracks: seq.tracks.map((t) => (t.id === 'A1' ? { ...t, locked: true } : t)) };
  ok('clips on locked tracks are left out', same(clipsInBox(locked, rows, { x0: 0, y0: 0, x1: 200, y1: 200 }, pps), ['v1a', 'v1b', 'v2a', 'a2a']));
}

console.log(`marquee: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
