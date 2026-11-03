// Timeline & Track editing (src/Core/editing.js): moving clips across tracks, nudge, insert / rearrange / duplicate drags,
// track reordering / deleting with id remapping, track targeting. Run: node scripts/test_tracks.mjs
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-tracks-'));
const out = path.join(tmp, 'editing.mjs');
await esbuild.build({ absWorkingDir: root, entryPoints: [path.join(root, 'src/Core/editing.js')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
const ed = await import(pathToFileURL(out).href);
fs.rmSync(tmp, { recursive: true, force: true });

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const J = JSON.stringify;
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const T = (id, kind, o = {}) => ({ id, kind, muted: false, solo: false, locked: false, sync: true, ...o });
const seq0 = (clips = [], extra = {}) => ({ fps: 30, tracks: [T('V3', 'video'), T('V2', 'video'), T('V1', 'video'), T('A1', 'audio'), T('A2', 'audio'), T('A3', 'audio')], clips, transitions: [], markers: [], ...extra });
const C = (id, track, start, dur, o = {}) => ({ id, track, start, dur, inPoint: 0, speed: 1, effects: [], enabled: true, ...o });
const get = (s, id) => s.clips.find((c) => c.id === id);
const on = (s, track) => ed.onTrack(s, track).map((c) => `${c.id}@${+c.start.toFixed(3)}+${+c.dur.toFixed(3)}`).join(' ');

// ---- A1: linked / several clips across tracks ----
{
  const s = seq0([C('v', 'V1', 2, 3, { linkId: 'L' }), C('a', 'A1', 2, 3, { linkId: 'L' })]);
  const m = ed.trackShiftMap(s, ['v', 'a'], 1, ['video']); ed.moveClips(s, ['v', 'a'], 1, m);
  ok('drag picture V1→V2: its linked sound stays on A1 (only the grabbed kind changes track)', get(s, 'v').track === 'V2' && get(s, 'a').track === 'A1', J(s.clips));
  const s2 = seq0([C('v', 'V1', 2, 3, { linkId: 'L' }), C('a', 'A1', 2, 3, { linkId: 'L' })]);
  ok('without a kind filter every kind moves', J(ed.trackShiftMap(s2, ['v', 'a'], 1)) === J({ v: 'V2', a: 'A2' }));
  ok('the pair keeps its sync (same start)', near(get(s, 'v').start, 3) && near(get(s, 'a').start, 3));
}
{
  const s = seq0([C('v', 'V2', 0, 3, { linkId: 'L' }), C('a', 'A2', 0, 3, { linkId: 'L' })]);
  ed.moveClips(s, ['v', 'a'], 0, ed.trackShiftMap(s, ['v', 'a'], -1, ['audio']));
  ok('drag sound A2→A1 (delta -1): picture stays on V2', get(s, 'v').track === 'V2' && get(s, 'a').track === 'A1', J(s.clips));
}
{
  const s = seq0([C('v', 'V3', 0, 2, { linkId: 'L' }), C('a', 'A3', 0, 2, { linkId: 'L' })]);
  const m = ed.trackShiftMap(s, ['v', 'a'], 1); ed.moveClips(s, ['v', 'a'], 0, m); // all kinds
  ok('past the last track: V4 and A4 are created', get(s, 'v').track === 'V4' && get(s, 'a').track === 'A4' && s.tracks[0].id === 'V4' && s.tracks.at(-1).id === 'A4', J(s.tracks.map((t) => t.id)));
}
{
  const s = seq0([C('x', 'V1', 0, 2), C('y', 'V2', 0, 2)]);
  ok('a group never goes below track 1', !Object.keys(ed.trackShiftMap(s, ['x', 'y'], -1)).length);
  ed.moveClips(s, ['x', 'y'], 0, ed.trackShiftMap(s, ['x', 'y'], 1));
  ok('two stacked clips move up together without piling onto one track', get(s, 'x').track === 'V2' && get(s, 'y').track === 'V3', J(s.clips));
}
{
  const s = seq0([C('x', 'V1', 0, 2)]); s.tracks.find((t) => t.id === 'V3').locked = true;
  ok('a locked track stops the clip on the last free track before it', ed.trackShiftMap(s, ['x'], 2).x === 'V2');
  s.tracks.find((t) => t.id === 'V2').locked = true;
  ok('a locked track right above: the clip stays (never lands on / jumps over it)', !ed.trackShiftMap(s, ['x'], 2).x);
}
{
  const s = seq0([C('x', 'V1', 0, 2), C('y', 'V2', 0, 2)]); s.tracks.find((t) => t.id === 'V3').locked = true;
  const m = ed.trackShiftMap(s, ['x', 'y'], 1);
  ok('locked track stops the whole kind (layout kept)', !m.x && !m.y, J(m));
}
{
  const s = seq0([C('v', 'V1', 0, 2), C('a', 'A1', 0, 2)]); s.tracks.find((t) => t.id === 'A2').locked = true;
  const m = ed.trackShiftMap(s, ['v', 'a'], 1); // all kinds
  ok('each kind is stopped on its own: picture moves, sound under a locked track stays', m.v === 'V2' && !m.a, J(m));
}
{
  const s = seq0([C('c', 'CC1', 0, 2, { caption: { text: 'hi' } }), C('v', 'V1', 0, 2)]); s.tracks.unshift(T('CC1', 'caption'));
  const m = ed.trackShiftMap(s, ['c', 'v'], 1); ed.moveClips(s, ['c', 'v'], 0, m);
  ok('a caption only moves among caption tracks (a CC2 is made)', get(s, 'c').track === 'CC2' && ed.trackKind(s, 'CC2') === 'caption' && get(s, 'v').track === 'V2', J(s.clips));
  const s2 = seq0([C('v', 'V1', 0, 2)]);
  ed.moveClips(s2, ['v'], 0, { v: 'A1' });
  ok('never across kinds (a picture clip cannot go to an audio track)', get(s2, 'v').track === 'V1');
}
{ // overwrite with several clips moving at once
  const s = seq0([C('p', 'V2', 0, 10), C('x', 'V1', 1, 2), C('y', 'V1', 5, 2)]);
  ed.moveClips(s, ['x', 'y'], 0, ed.trackShiftMap(s, ['x', 'y'], 1));
  ok('multi-clip overwrite: the clip underneath is cut around both, the moving clips keep each other', on(s, 'V2').split(' ').length === 5 && /x@1\+2/.test(on(s, 'V2')) && /y@5\+2/.test(on(s, 'V2')), on(s, 'V2'));
  const pieces = ed.onTrack(s, 'V2').filter((c) => c.id !== 'x' && c.id !== 'y');
  ok('the pieces of the overwritten clip continue the same source', near(pieces[1].inPoint, 3) && near(pieces[2].inPoint, 7), J(pieces));
  const s2 = seq0([C('x', 'V1', 0, 2), C('y', 'V1', 2, 2)]);
  ed.moveClips(s2, ['x', 'y'], 1);
  ok('adjacent moving clips on one track do not trim each other', on(s2, 'V1') === 'x@1+2 y@3+2', on(s2, 'V1'));
}
{ // groups (clip.group): the caller passes every member (expandSelection), they change track the same way
  const s = seq0([C('g1', 'V1', 0, 2, { group: 'G' }), C('g2', 'V2', 3, 2, { group: 'G' }), C('g3', 'A1', 3, 2, { group: 'G' })]);
  const ids = s.clips.filter((c) => c.group === 'G').map((c) => c.id);
  ed.moveClips(s, ids, 0.5, ed.trackShiftMap(s, ids, 1));
  ok('a group moves across tracks: V1→V2, V2→V3, A1→A2', get(s, 'g1').track === 'V2' && get(s, 'g2').track === 'V3' && get(s, 'g3').track === 'A2' && near(get(s, 'g2').start, 3.5), J(s.clips));
}
{ // transitions follow their clips
  const s = seq0([C('a', 'V1', 0, 2), C('b', 'V1', 2, 2)], { transitions: [{ id: 't', track: 'V1', aId: 'a', bId: 'b', at: 2, dur: 1 }] });
  ed.moveClips(s, ['a', 'b'], 0, ed.trackShiftMap(s, ['a', 'b'], 1));
  ok('a transition moves to the new track with both its clips', s.transitions[0]?.track === 'V2', J(s.transitions));
  ed.moveClips(s, ['b'], 0, ed.trackShiftMap(s, ['b'], 1));
  ok('a transition whose clips end up on different tracks is removed', !s.transitions.length);
}

// ---- A2: nudge ----
{
  const s = seq0([C('x', 'V1', 1, 2), C('n', 'V1', 3.1, 2)]);
  ed.moveClips(s, ['x'], 5 / 30);
  ok('nudge 5 frames right overwrites the head of the next clip', near(get(s, 'x').start, 1 + 5 / 30) && near(get(s, 'n').start, 1 + 5 / 30 + 2) && near(get(s, 'n').inPoint, 1 + 5 / 30 + 2 - 3.1), J(s.clips));
  ed.moveClips(s, ['x'], -10);
  ok('nudge left stops at 0', near(get(s, 'x').start, 0));
}

// ---- A3: insert / rearrange / duplicate drags ----
{
  const s = seq0([C('a', 'V1', 0, 2), C('b', 'V1', 2, 3), C('c', 'V1', 5, 2), C('t', 'V2', 6, 1)]);
  ed.dragClips(s, ['a'], 5, {}, 'insert');
  ok('Ctrl+drag (insert): a gap is left behind, the clip goes in at the new place and pushes later clips', on(s, 'V1') === 'b@2+3 a@5+2 c@7+2', on(s, 'V1'));
  ok('insert uses sync lock: later clips on other tracks move too', near(get(s, 't').start, 8), J(get(s, 't')));
}
{
  const s = seq0([C('a', 'V1', 0, 2), C('b', 'V1', 2, 3), C('m', 'V1', 6, 2)]);
  ed.dragClips(s, ['a'], 3, {}, 'insert');
  ok('insert in the middle of a clip splits it', on(s, 'V1') === 'b@2+1 a@3+2 m@8+2' || /b@2\+1 a@3\+2 \w+@5\+2 m@8\+2/.test(on(s, 'V1')), on(s, 'V1'));
}
{
  const s = seq0([C('a', 'V1', 0, 2, { linkId: 'L' }), C('aa', 'A1', 0, 2, { linkId: 'L' }), C('b', 'V1', 2, 3, { linkId: 'M' }), C('bb', 'A1', 2, 3, { linkId: 'M' }), C('ti', 'V2', 2, 3)]);
  ed.dragClips(s, ['a', 'aa'], 5, {}, 'rearrange');
  ok('Ctrl+Alt+drag (rearrange): A dropped after B → B A, no gap', on(s, 'V1') === 'b@0+3 a@3+2' && on(s, 'A1') === 'bb@0+3 aa@3+2', on(s, 'V1') + ' | ' + on(s, 'A1'));
  ok('rearrange keeps sync-locked tracks with their clips (title over B moves with B)', near(get(s, 'ti').start, 0), J(get(s, 'ti')));
  ed.dragClips(s, ['a', 'aa'], -3, {}, 'rearrange');
  ok('rearrange back: A before B', on(s, 'V1') === 'a@0+2 b@2+3', on(s, 'V1'));
}
{
  const s = seq0([C('a', 'V1', 0, 2), C('b', 'V1', 2, 2), C('c', 'V1', 4, 2)]);
  ed.dragClips(s, ['c'], -1.5, {}, 'rearrange');
  ok('rearrange: last clip dropped inside B → B is split at the drop point', /^a@0\+2 b@2\+0.5 c@2.5\+2 \w+@4.5\+1.5$/.test(on(s, 'V1')), on(s, 'V1'));
}
{
  const s = seq0([C('v', 'V1', 0, 2, { linkId: 'L' }), C('a', 'A1', 0, 2, { linkId: 'L' }), C('o', 'V2', 3, 4)]);
  const ids = ed.dragClips(s, ['v', 'a'], 4, ed.trackShiftMap(s, ['v', 'a'], 1), 'duplicate');
  const [dv, da] = ids.map((id) => get(s, id));
  ok('Alt+drag (duplicate): originals stay', get(s, 'v').track === 'V1' && near(get(s, 'v').start, 0) && get(s, 'a').track === 'A1');
  ok('the copies are linked to each other with a new link id', dv && da && dv.linkId === da.linkId && dv.linkId !== 'L' && dv.track === 'V2' && da.track === 'A2' && near(dv.start, 4), J([dv, da]));
  ok('a duplicate overwrites what it lands on', on(s, 'V2').startsWith('o@3+1'), on(s, 'V2'));
  const g = seq0([C('g1', 'V1', 0, 1, { group: 'G' }), C('g2', 'V2', 0, 1, { group: 'G' })]);
  const gi = ed.dragClips(g, ['g1', 'g2'], 2, {}, 'duplicate').map((id) => get(g, id));
  ok('duplicated groups get their own group id', gi[0].group === gi[1].group && gi[0].group !== 'G');
}

// ---- A4: tracks: reorder / delete / insert with id remapping ----
const matte = (track, keys) => ({ name: 'Track Matte Key', enabled: true, params: { track: keys ? { v: track, keys } : { v: track } } });
{
  const s = seq0([C('bot', 'V1', 0, 2), C('top', 'V2', 0, 2, { effects: [matte('V3', [{ t: 0, v: 'V1' }, { t: 1, v: 'V3' }])] }), C('m', 'V3', 0, 2)],
    { transitions: [{ id: 't', track: 'V2', aId: null, bId: 'top', at: 0, dur: 1 }] });
  s.tracks.find((t) => t.id === 'V2').name = 'Titles';
  const map = ed.moveTrack(s, 'V2', 1); // V2 down below V1
  ok('Move Track Down: V2 becomes V1 (ids follow position)', map.V2 === 'V1' && map.V1 === 'V2' && !map.V3 && s.tracks.map((t) => t.id).join() === 'V3,V2,V1,A1,A2,A3', J(map));
  ok('clips are remapped to their track', get(s, 'top').track === 'V1' && get(s, 'bot').track === 'V2' && get(s, 'm').track === 'V3');
  ok('the track name moves with the track', s.tracks.find((t) => t.id === 'V1').name === 'Titles');
  ok('transitions are remapped', s.transitions[0].track === 'V1');
  const p = get(s, 'top').effects[0].params.track;
  ok('Track Matte Key still points at the same track (value + keyframes)', p.v === 'V3' && p.keys[0].v === 'V2' && p.keys[1].v === 'V3', J(p));
  ok('moving past the end of its kind does nothing', ed.moveTrack(s, 'V1', 1) === null && ed.moveTrack(s, 'A1', -1) === null);
  const s2 = seq0([C('x', 'A1', 0, 1)]); ed.moveTrackTo(s2, 'A1', 'A3');
  ok('drag a header A1 onto A3: order A2 A3 A1 → renumbered', get(s2, 'x').track === 'A3' && s2.tracks.filter((t) => t.kind === 'audio').map((t) => t.id).join() === 'A1,A2,A3');
}
{
  const s = seq0([C('v', 'V2', 0, 2, { linkId: 'L', noAudio: true }), C('a', 'A1', 0, 2, { linkId: 'L' }), C('k', 'V3', 0, 2, { effects: [matte('V2')] }), C('w', 'V3', 3, 1, { effects: [matte('V1')] })],
    { transitions: [{ id: 't', track: 'V2', bId: 'v', at: 0, dur: 1 }] });
  const map = ed.deleteTracks(s, ['V2']);
  ok('Delete Track removes its clips and transitions', !get(s, 'v') && !s.transitions.length);
  ok('the linked partner is unlinked', !get(s, 'a').linkId);
  ok('tracks above are renumbered (V3 → V2)', map.V3 === 'V2' && get(s, 'k').track === 'V2' && s.tracks.filter((t) => t.kind === 'video').map((t) => t.id).join() === 'V2,V1');
  ok('Track Matte that used the deleted track picks None; one that used another track is kept', get(s, 'k').effects[0].params.track.v === 'None' && get(s, 'w').effects[0].params.track.v === 'V1');
  const s2 = seq0([C('x', 'V1', 0, 1), C('y', 'A3', 0, 1)]);
  ok('Delete Empty Tracks finds V2, V3, A1, A2', ed.emptyTracks(s2).sort().join() === 'A1,A2,V2,V3', J(ed.emptyTracks(s2)));
  ed.deleteTracks(s2, ed.emptyTracks(s2));
  ok('after deleting the empty tracks the rest is renumbered', s2.tracks.map((t) => t.id).join() === 'V1,A1' && get(s2, 'y').track === 'A1');
  ok('the last video / audio track cannot be deleted', !ed.deletableTracks(s2, ['V1', 'A1']).length && ed.deleteTracks(s2, ['V1']) === null);
  const s3 = seq0([C('x', 'V1', 0, 1), C('z', 'V2', 0, 1)]);
  const id = ed.insertTrack(s3, 'V1', 'above');
  ok('Add Track Above V1 → new V2, old V2 → V3', id === 'V2' && get(s3, 'z').track === 'V3' && get(s3, 'x').track === 'V1' && s3.tracks.filter((t) => t.kind === 'video').length === 4);
  const id2 = ed.insertTrack(s3, 'A1', 'above');
  ok('Add Track Above A1 → the new track is A1', id2 === 'A1' && s3.tracks.filter((t) => t.kind === 'audio').map((t) => t.id).join() === 'A1,A2,A3,A4');
}
{ // old projects: no name / h / target fields
  const s = seq0([C('x', 'V1', 0, 1)]);
  ok('no target flags: V1 / A1 (first unlocked) are the targets, as before', ed.targetedTracks(s, 'video').join() === 'V1' && ed.targetedTracks(s, 'audio').join() === 'A1');
  ok('no target flags: Add Edit cuts every track', ed.editTracks(s).length === s.tracks.length);
  s.tracks.find((t) => t.id === 'V1').locked = true;
  ok('locked V1: V2 is the target (old behaviour)', ed.targetedTracks(s, 'video').join() === 'V2');
  s.tracks.find((t) => t.id === 'V1').locked = false;
  ed.toggleTarget(s, 'V2');
  ok('turning on V2 writes the implicit V1 target out: V1 + V2 targeted', ed.targetedTracks(s, 'video').join() === 'V1,V2' && ed.isTargeted(s, s.tracks.find((t) => t.id === 'V1')));
  ed.toggleTarget(s, 'V1');
  ok('turn V1 off: only V2; audio untouched (still implicit A1)', ed.targetedTracks(s, 'video').join() === 'V2' && !ed.hasTargets(s, 'audio') && ed.targetedTracks(s, 'audio').join() === 'A1');
  ok('Add Edit: targeted video tracks + every audio track', ed.editTracks(s).join() === 'V2,A1,A2,A3', J(ed.editTracks(s)));
  const v2 = s.tracks.find((t) => t.id === 'V2'); ed.moveTrack(s, 'V2', 1);
  ok('the target flag moves with the track when tracks are reordered', v2.id === 'V1' && v2.target === true && ed.targetedTracks(s, 'video').join() === 'V1');
}

// ---- Phase 8 D5: a clip that grows at its end (Remix longer) pushes what follows instead of overwriting it ----
{
  const s = seq0([C('m', 'A1', 0, 10), C('n', 'A1', 10, 5), C('v', 'V1', 4, 12), C('w', 'V1', 18, 2)]);
  const moved = ed.rippleOpen(s, 'A1', 10, 4);
  ok('the next clip on the track moves by the growth', moved && near(get(s, 'n').start, 14) && near(get(s, 'n').dur, 5), J(s.clips));
  ok('the growing clip itself stays where it is', near(get(s, 'm').start, 0) && near(get(s, 'm').dur, 10));
  ok('a sync-locked track is split at the point and its later part moves too', near(get(s, 'v').dur, 6) && s.clips.some((c) => c.track === 'V1' && near(c.start, 14) && near(c.dur, 6)) && near(get(s, 'w').start, 22), J(on(s, 'V1')));
  const s2 = seq0([C('m', 'A1', 0, 10), C('k', 'A2', 12, 3)], {}); s2.tracks.find((t) => t.id === 'A2').sync = false;
  ed.rippleOpen(s2, 'A1', 10, 4);
  ok('a track without Sync Lock is not moved', near(get(s2, 'k').start, 12));
  ok('nothing after the clip: nothing moves', ed.rippleOpen(seq0([C('m', 'A1', 0, 10)]), 'A1', 10, 4) === false);
}

// ---- D4: source patching (Source V1 / A1 -> timeline tracks) ----
{
  const s = seq0();
  let p = ed.sourcePatch(s);
  ok('without a patch the source goes to the first targeted tracks (V1 / A1, as before)', p.V1.track === 'V1' && p.A1.track === 'A1' && p.V1.on && p.A1.on, J(p));
  ok('source V1 can be patched to V3, A1 to A2', ed.patchSource(s, 'V1', 'V3') && ed.patchSource(s, 'A1', 'A2') && (p = ed.sourcePatch(s)).V1.track === 'V3' && p.A1.track === 'A2', J(p));
  ok('...not across kinds', ed.patchSource(s, 'V1', 'A1') === false && ed.sourcePatch(s).V1.track === 'V3');
  ed.toggleSource(s, 'A1');
  ok('a source indicator can be switched off (sound left out) and keeps its track', ed.sourcePatch(s).A1.on === false && ed.sourcePatch(s).A1.track === 'A2');
  ed.patchSource(s, 'A1', 'A3');
  ok('patching it again switches it on', ed.sourcePatch(s).A1.on === true && ed.sourcePatch(s).A1.track === 'A3');
  s.tracks = s.tracks.filter((t) => t.id !== 'V3');
  ok('a patch to a deleted track falls back to the targeted track', ed.sourcePatch(s).V1.track === 'V1');
  const t2 = seq0(); for (const t of t2.tracks) if (t.kind === 'video') t.target = t.id === 'V2';
  ok('the default follows track targeting', ed.sourcePatch(t2).V1.track === 'V2');
}

console.log(`tracks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
