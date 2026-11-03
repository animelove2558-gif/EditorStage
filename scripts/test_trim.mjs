// Trim Mode (src/Core/editing.js trimEdits / editsAt / editTime): regular, ripple and rolling trims of one or several edit
// points, media handles, minimum length, neighbours, locked tracks, sync lock, transitions. Run: node scripts/test_trim.mjs
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-trim-'));
const out = path.join(tmp, 'editing.mjs');
await esbuild.build({ absWorkingDir: root, entryPoints: [path.join(root, 'src/Core/editing.js')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
const ed = await import(pathToFileURL(out).href);
fs.rmSync(tmp, { recursive: true, force: true });

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const J = JSON.stringify;
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const T = (id, kind, o = {}) => ({ id, kind, muted: false, solo: false, locked: false, sync: true, ...o });
const seq0 = (clips = [], extra = {}) => ({ fps: 10, tracks: [T('V2', 'video'), T('V1', 'video'), T('A1', 'audio'), T('A2', 'audio')], clips, transitions: [], markers: [], ...extra });
// media 10 s long; a clip uses [inPoint, inPoint + dur]
const C = (id, track, start, dur, inPoint = 2, o = {}) => ({ id, track, start, dur, inPoint, speed: 1, effects: [], enabled: true, mediaId: 'm', ...o });
const mdur = () => 10;
const get = (s, id) => s.clips.find((c) => c.id === id);
const f = (n) => n / 10; // frames -> seconds (10 fps)

// ---- edit point lookup ----
{
  const s = seq0([C('a', 'V1', 0, 3), C('b', 'V1', 3, 2), C('x', 'A1', 0, 3), C('y', 'A1', 3, 2), C('g', 'V2', 4, 1)]);
  const e = ed.editsAt(s, 3, ['V1', 'A1', 'V2']);
  ok('editsAt: one edit per track with outgoing / incoming clip', J(e) === J([{ track: 'V1', aId: 'a', bId: 'b' }, { track: 'A1', aId: 'x', bId: 'y' }]), J(e));
  ok('editsAt: an edit against a gap has only one side', J(ed.editsAt(s, 4, ['V2'])) === J([{ track: 'V2', aId: null, bId: 'g' }]));
  s.tracks.find((t) => t.id === 'A1').locked = true;
  ok('editsAt: locked tracks are left out', ed.editsAt(s, 3, ['V1', 'A1']).length === 1);
  ok('editTime: the cut', ed.editTime(s, { aId: 'a', bId: 'b' }) === 3 && ed.editTime(s, { aId: null, bId: 'g' }) === 4 && ed.editTime(s, { aId: 'zz' }) === null);
}

// ---- rolling ----
{
  const s = seq0([C('a', 'V1', 0, 3), C('b', 'V1', 3, 2)]); const E = [{ track: 'V1', aId: 'a', bId: 'b' }];
  const d = ed.trimEdits(s, mdur, E, 'roll', 'a', f(5));
  ok('roll +5: cut moves, sequence length kept', near(d, 0.5) && near(get(s, 'a').dur, 3.5) && near(get(s, 'b').start, 3.5) && near(get(s, 'b').dur, 1.5) && near(get(s, 'b').inPoint, 2.5), J(s.clips));
  const d2 = ed.trimEdits(s, mdur, E, 'roll', 'a', -100);
  ok('roll is limited by the incoming head handle (inPoint 2.5 s)', near(d2, -2.5) && near(get(s, 'b').inPoint, 0) && near(get(s, 'a').dur, 1), J({ d2, c: s.clips }));
  const d3 = ed.trimEdits(s, mdur, E, 'roll', 'a', 100);
  ok('roll is limited by the one-frame minimum of the incoming clip', near(get(s, 'b').dur, f(1)) && near(get(s, 'a').dur + get(s, 'b').dur, 5), J({ d3, c: s.clips }));
}
{
  const s = seq0([C('a', 'V1', 0, 3, 6), C('b', 'V1', 3, 2)]);
  const d = ed.trimEdits(s, mdur, [{ track: 'V1', aId: 'a', bId: 'b' }], 'roll', 'a', 5);
  ok('roll is limited by the outgoing tail handle (media 10 s, in 6 + 3 → 1 s left)', near(d, 1) && near(get(s, 'a').dur, 4), J({ d, c: s.clips }));
}
{
  const s = seq0([C('a', 'V1', 0, 3), C('b', 'V1', 3, 2)], { transitions: [{ id: 't', track: 'V1', aId: 'a', bId: 'b', at: 3, dur: 0.5, kind: 'video' }] });
  ed.trimEdits(s, mdur, [{ track: 'V1', aId: 'a', bId: 'b' }], 'roll', 'a', f(3));
  ok('roll moves the transition on the cut', near(s.transitions[0].at, 3.3));
}

// ---- regular ----
{
  const s = seq0([C('a', 'V1', 0, 3), C('b', 'V1', 3, 2)]); const E = [{ track: 'V1', aId: 'a', bId: 'b' }];
  const d = ed.trimEdits(s, mdur, E, 'regular', 'a', f(-4));
  ok('regular outgoing -4: tail shortened, a gap opens, incoming stays', near(d, -0.4) && near(get(s, 'a').dur, 2.6) && near(get(s, 'b').start, 3), J(s.clips));
  const d2 = ed.trimEdits(s, mdur, E, 'regular', 'a', 5);
  ok('regular outgoing cannot overwrite the next clip', near(d2, 0.4) && near(get(s, 'a').dur, 3), J({ d2, c: s.clips }));
  const d3 = ed.trimEdits(s, mdur, E, 'regular', 'b', f(5));
  ok('regular incoming +5: head trimmed, start moves later', near(d3, 0.5) && near(get(s, 'b').start, 3.5) && near(get(s, 'b').inPoint, 2.5) && near(get(s, 'b').dur, 1.5), J(s.clips));
  const d4 = ed.trimEdits(s, mdur, E, 'regular', 'b', -5);
  ok('regular incoming cannot extend over the previous clip', near(d4, -0.5) && near(get(s, 'b').start, 3), J({ d4, c: s.clips }));
}

// ---- ripple ----
{
  const s = seq0([C('a', 'V1', 0, 3), C('b', 'V1', 3, 2), C('c', 'V1', 5, 1), C('x', 'A1', 0, 3), C('y', 'A1', 3, 3), C('z', 'A2', 4, 1)]);
  const E = [{ track: 'V1', aId: 'a', bId: 'b' }, { track: 'A1', aId: 'x', bId: 'y' }];
  const d = ed.trimEdits(s, mdur, E, 'ripple', 'a', f(5));
  ok('ripple outgoing +5 on V1 + A1: tails longer, later clips move by +0.5 on every track', near(d, 0.5) && near(get(s, 'a').dur, 3.5) && near(get(s, 'x').dur, 3.5) && near(get(s, 'b').start, 3.5) && near(get(s, 'c').start, 5.5) && near(get(s, 'y').start, 3.5), J(s.clips));
  ok('ripple: a sync-locked track without an edit moves what starts after the edit', near(get(s, 'z').start, 4.5), J(get(s, 'z')));
  const d2 = ed.trimEdits(s, mdur, E, 'ripple', 'b', f(5));
  ok('ripple incoming +5: heads trimmed, starts kept, later material pulled back', near(d2, 0.5) && near(get(s, 'b').start, 3.5) && near(get(s, 'b').dur, 1.5) && near(get(s, 'b').inPoint, 2.5) && near(get(s, 'c').start, 5) && near(get(s, 'y').dur, 2.5), J(s.clips));
}
{
  // A2 has a clip spanning the edit: pulling back is limited to the free room in front of the next A2 clip
  const s = seq0([C('a', 'V1', 0, 3), C('b', 'V1', 3, 2), C('p', 'A2', 0, 3.2), C('q', 'A2', 3.4, 1)]);
  const d = ed.trimEdits(s, mdur, [{ track: 'V1', aId: 'a', bId: 'b' }], 'ripple', 'a', -1);
  ok('ripple pull-back is limited by the room on other sync-locked tracks', near(d, -0.2) && near(get(s, 'q').start, 3.2) && near(get(s, 'b').start, 2.8), J({ d, c: s.clips }));
  s.tracks.find((t) => t.id === 'A2').sync = false;
  const d2 = ed.trimEdits(s, mdur, [{ track: 'V1', aId: 'a', bId: 'b' }], 'ripple', 'a', -1);
  ok('sync lock off: that track is not limited and does not move', near(d2, -1) && near(get(s, 'q').start, 3.2), J({ d2, c: s.clips }));
}
{
  const s = seq0([C('a', 'V1', 0, 3), C('b', 'V1', 3, 2), C('x', 'A1', 0, 3), C('y', 'A1', 3, 2)]);
  s.tracks.find((t) => t.id === 'A1').locked = true;
  const d = ed.trimEdits(s, mdur, [{ track: 'V1', aId: 'a', bId: 'b' }, { track: 'A1', aId: 'x', bId: 'y' }], 'ripple', 'a', f(3));
  ok('locked track: its edit is skipped and its clips never move', near(d, 0.3) && near(get(s, 'x').dur, 3) && near(get(s, 'y').start, 3) && near(get(s, 'b').start, 3.3), J(s.clips));
}
{
  const s = seq0([C('a', 'V1', 0, 3), C('b', 'V1', 3, 2), C('x', 'A1', 0, 3, 6.5), C('y', 'A1', 3, 2)]);
  const d = ed.trimEdits(s, mdur, [{ track: 'V1', aId: 'a', bId: 'b' }, { track: 'A1', aId: 'x', bId: 'y' }], 'ripple', 'a', 1);
  ok('several edits trim by the same (most limited) amount', near(d, 0.5) && near(get(s, 'a').dur, 3.5) && near(get(s, 'x').dur, 3.5), J({ d, c: s.clips }));
  const s2 = seq0([C('a', 'V1', 0, 3, 7.5), C('b', 'V1', 3, 2)]);
  ok('a clip already past its media end is never trimmed the other way', ed.trimEdits(s2, mdur, [{ track: 'V1', aId: 'a', bId: 'b' }], 'ripple', 'a', 1) === 0 && get(s2, 'a').dur === 3);
}
{
  const s = seq0([C('a', 'V1', 0, 3), C('b', 'V1', 3, 2)]);
  ok('nothing to trim → 0 and no change', ed.trimEdits(s, mdur, [{ track: 'V1', aId: 'a', bId: null }], 'regular', 'b', 0.5) === 0 && ed.trimEdits(s, mdur, [], 'roll', 'a', 1) === 0 && J(s.clips) === J(seq0([C('a', 'V1', 0, 3), C('b', 'V1', 3, 2)]).clips));
}
{
  const s = seq0([C('a', 'V1', 0, 3), C('b', 'V1', 3, 2), C('c', 'V1', 5, 1)], { transitions: [{ id: 't', track: 'V1', aId: 'b', bId: 'c', at: 5, dur: 0.4, kind: 'video' }] });
  ed.trimEdits(s, mdur, [{ track: 'V1', aId: 'a', bId: 'b' }], 'ripple', 'a', f(2));
  ok('ripple moves transitions after the edit', near(s.transitions[0].at, 5.2));
}

console.log(`trim: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
