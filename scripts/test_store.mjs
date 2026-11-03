// Undo / redo / saved state of the store (src/Core/store.js): Phase 8 audit items E1 (undo marks the project unsaved,
// Premiere-style saved index), E2 (no coalescing across undo), E3 (History panel after a sequence switch) and
// E4 (edits made while a Save is being written stay unsaved). Run: node scripts/test_store.mjs
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-store-'));
const out = path.join(tmp, 'store.mjs');
await esbuild.build({ absWorkingDir: root, entryPoints: [path.join(root, 'src/Core/store.js')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
const S = await import(pathToFileURL(out).href);
fs.rmSync(tmp, { recursive: true, force: true });

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const st = () => S.getState();
const opacity = () => st().sequence.opacity ?? 0;
const setOpacity = (v) => S.edit('Opacity', ({ seq }) => { seq.opacity = v; }, { coalesce: 'opacity' });
const fresh = () => { S.loadProject({ sequence: { ...st().sequence, opacity: 0 } }, 'C:/p.esproj'); };

// ---- E1: undo / redo change the saved state ----
fresh();
ok('a loaded project is clean', st().dirty === false);
S.edit('Move', ({ seq }) => { seq.x = 1; });
ok('an edit makes it dirty', st().dirty === true);
S.markSaved();
ok('Save makes it clean', st().dirty === false);
S.undo();
ok('Undo after Save: dirty again (the file still has the undone edit)', st().dirty === true);
S.redo();
ok('Redo back to the saved step: clean again', st().dirty === false);
S.undo(); S.markSaved(); S.redo();
ok('saved at the earlier step, redo: dirty', st().dirty === true);
S.undo();
ok('undo back to the saved step: clean', st().dirty === false);
S.edit('A', ({ seq }) => { seq.a = 1; });
ok('a new edit after undo: dirty (the redo branch is gone)', st().dirty === true);
S.undo();
ok('undo to the saved step again: clean', st().dirty === false);
S.edit('B', ({ seq }) => { seq.b = 1; }); S.markSaved(); S.edit('C', ({ seq }) => { seq.c = 1; });
S.deleteHistoryFrom(st().historyIndex);
ok('History > Delete back to the saved step: clean', st().dirty === false, JSON.stringify({ i: st().historyIndex }));
S.markDirty();
ok('a non-undoable project change (markDirty) makes it dirty', st().dirty === true);
S.undo();
ok('...and undo does not hide it', st().dirty === true);
S.markSaved();
ok('Save clears it', st().dirty === false);
S.addSequence({ id: 'sq2', name: 'Two', tracks: [], clips: [], transitions: [], markers: [] });
ok('adding a sequence makes the project dirty', st().dirty === true);
S.resetProject();
ok('New Project is clean', st().dirty === false);

// ---- E2: a slider drag right after Undo is a new step ----
fresh();
setOpacity(10);
S.undo();
ok('undo the drag: back to 0', opacity() === 0);
setOpacity(50);
ok('drag again right after undo: 50', opacity() === 50);
ok('the new drag is its own History step', st().history.length === 2 && st().historyIndex === 1, JSON.stringify(st().history));
S.redo();
ok('Redo has nothing to bring back (the new drag cleared it)', opacity() === 50);
S.undo();
ok('Undo after the new drag goes to 0', opacity() === 0);
S.redo(); setOpacity(60); setOpacity(70);
ok('rapid drag steps still coalesce into one step', st().history.length === 3, JSON.stringify(st().history));
S.undo();
ok('one undo reverts the whole coalesced drag', opacity() === 50);
fresh(); setOpacity(10);
S.commitSeq('Gesture', st().sequence, { ...st().sequence, opacity: 20 });
setOpacity(30);
ok('a gesture commit breaks coalescing', st().history.length === 4, JSON.stringify(st().history));

// ---- E3: History panel after switching sequences ----
fresh();
S.addSequence({ id: 'sq2', name: 'Second', tracks: [], clips: [], transitions: [], markers: [] });
S.edit('A', ({ seq }) => { seq.a = 1; }); S.edit('B', ({ seq }) => { seq.b = 1; });
S.switchSequence('sq2');
ok('after a switch the History panel has a single step', st().history.length === 1 && st().historyIndex === 0, JSON.stringify(st().history));
ok('...named after the opened sequence', /Second/.test(st().history[0].label));
const before = st().sequence;
S.undo();
ok('Undo after the switch changes nothing', st().sequence === before);
S.edit('C', ({ seq }) => { seq.c = 1; });
ok('a new edit in the opened sequence is step 1', st().history.length === 2 && st().historyIndex === 1);

// ---- E4: an edit made during Save stays unsaved ----
fresh();
S.edit('A', ({ seq }) => { seq.a = 1; });
const tok = S.saveToken(); // Save starts: the token belongs to the content being written
S.edit('B', ({ seq }) => { seq.b = 1; }); // the user edits while the file is written
S.markSaved(tok); // the write finished
ok('an edit made while saving keeps the project dirty', st().dirty === true);
S.undo();
ok('undo back to the content that was written: clean', st().dirty === false);
const tok2 = S.saveToken(); S.markDirty(); S.markSaved(tok2);
ok('a non-undoable change made while saving keeps it dirty', st().dirty === true);

// ---- saved fields changed without an undo step (bins, name, In / Out) ----
fresh();
S.set({ playhead: 3, selection: [] });
ok('UI state (playhead, selection) does not make the project unsaved', st().dirty === false);
S.set((s) => ({ bins: [...s.bins, { id: 'b', name: 'Bin 1' }] }));
ok('a new bin makes it unsaved', st().dirty === true);
S.markSaved(); S.set({ inPoint: 1 });
ok('setting In makes it unsaved (In / Out are saved)', st().dirty === true);
S.markSaved(); S.set({ projectName: 'Renamed' });
ok('renaming the project makes it unsaved', st().dirty === true);
S.set({ dirty: false });
ok('set({ dirty: false }) treats the current content as saved', st().dirty === false);
S.set({ dirty: true });
ok('set({ dirty: true }) marks the project unsaved', st().dirty === true);

console.log(`store: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
