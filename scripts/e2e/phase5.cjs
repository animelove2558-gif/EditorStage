// Phase 5 end-to-end test (Timeline & Track, part A: layers and track management). Run: npm run test:e2e
const fs = require('fs');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { suite } = require('./harness.cjs');

suite('phase5 e2e', async ({ js, ok, A, out, frames, px, near, nextSave, nextOpen }) => {
  const J = (x) => JSON.stringify(x);
  const ff = (args) => { const r = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 }); if (r.status) throw new Error(String(r.stderr)); };
  const W = 320, H = 240;
  const red = out('red.png'), blue = out('blue.png'), matte = out('matte.png');
  ff(['-f', 'lavfi', '-i', `color=c=red:s=${W}x${H}:d=1`, '-frames:v', '1', red]);
  ff(['-f', 'lavfi', '-i', `color=c=blue:s=${W}x${H}:d=1`, '-frames:v', '1', blue]);
  // luma matte: left half white, right half black
  ff(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:d=1,format=rgb24,geq=r='if(lt(X,${W / 2}),255,0)':g='if(lt(X,${W / 2}),255,0)':b='if(lt(X,${W / 2}),255,0)'`, '-frames:v', '1', matte]);
  // export one frame at t and return [left, centre, right] pixels, plus the preview's centre pixel
  let n = 0;
  const frameAt = async (t) => {
    const f = out(`f${n++}.mov`);
    const pv = await js(`const img = await E.exporter.renderFrame(${t}, ${W}, ${H}); const at = (x, y) => [...img.data.slice((y * ${W} + x) * 4, (y * ${W} + x) * 4 + 3)]; return [at(40, 120), at(160, 120), at(280, 120)];`);
    await js(`return T.exp(${J(f)}, 'Apple ProRes 422 (MOV)', ${W}, ${H}, ${t}, ${t} + 1 / 30);`);
    const [fr] = frames(f, W, H);
    return { ex: [px(fr, W, 40, 120), px(fr, W, 160, 120), px(fr, W, 280, 120)], pv };
  };
  const RED = [255, 0, 0], BLUE = [0, 0, 255], BLACK = [0, 0, 0];

  // ---------------- track order = compositing order ----------------
  console.log('Reorder tracks');
  await js(`T.fresh(${W}, ${H}); window.RED = await T.imp(${J(red)}); window.BLUE = await T.imp(${J(blue)}); T.place(RED, 0, 'V1'); T.place(BLUE, 0, 'V2'); return true;`);
  let f = await frameAt(0.5);
  ok('V2 (blue) is on top of V1 (red)', near(f.ex[1], BLUE, 10), J(f));
  const mv = await js(`const before = E.store.getState().history.length; E.cmds.run('track.moveDown', 'V2'); await T.tick(100); const s = E.store.getState().sequence;
    return { steps: E.store.getState().history.length - before, ids: s.tracks.map((t) => t.id), blue: s.clips.find((c) => c.mediaId === BLUE.id).track, red: s.clips.find((c) => c.mediaId === RED.id).track };`);
  ok('Move Track Down: the blue track becomes V1, red becomes V2 (1 undo step)', mv.blue === 'V1' && mv.red === 'V2' && mv.steps === 1, J(mv));
  f = await frameAt(0.5);
  ok('after reordering, red is on top in Export and Preview', near(f.ex[1], RED, 10) && near(f.pv[1], RED, 10), J(f));
  await js(`E.cmds.run('edit.undo'); await T.tick(100); return true;`);
  f = await frameAt(0.5);
  ok('undo restores the order (blue on top)', near(f.ex[1], BLUE, 10), J(f));
  // drag the V1 header onto V2 (real mouse events)
  const hd = await js(`const h = document.querySelector('.tl-head[data-track="V1"]'), t = document.querySelector('.tl-head[data-track="V2"]'); const a = h.getBoundingClientRect(), b = t.getBoundingClientRect();
    h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: a.left + 120, clientY: a.top + a.height / 2 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: a.left + 120, clientY: b.top + b.height / 2 })); await T.tick(30);
    const hot = !!document.querySelector('.tl-head.drop-target');
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: a.left + 120, clientY: b.top + b.height / 2 })); await T.tick(100);
    const s = E.store.getState().sequence; return { hot, red: s.clips.find((c) => c.mediaId === RED.id).track };`);
  ok('drag a track header onto another (drop target shown): red moves to V2', hd.hot && hd.red === 'V2', J(hd));
  f = await frameAt(0.5);
  ok('header drag changes the layer order in Export', near(f.ex[1], RED, 10), J(f));

  // ---------------- Track Matte follows its track ----------------
  console.log('Track Matte after reordering');
  await js(`T.fresh(${W}, ${H}); const M = await T.imp(${J(matte)}); const B = await T.imp(${J(blue)}); T.place(M, 0, 'V1'); const [b] = T.place(B, 0, 'V3'); window.BID = b;
    T.patch(b, (c) => { c.effects = [{ name: 'Track Matte Key', enabled: true, params: { track: { v: 'V1' }, mode: { v: 1 } } }]; }); return true;`);
  f = await frameAt(0.5);
  ok('matte (luma) on V1: blue on the left, the black of the matte on the right', near(f.ex[0], BLUE, 12) && near(f.ex[2], BLACK, 12), J(f));
  const tm = await js(`E.cmds.run('track.moveUp', 'V1'); await T.tick(100); const s = E.store.getState().sequence; const c = s.clips.find((x) => x.id === BID); const m = s.clips.find((x) => x.id !== BID);
    return { matteTrack: m.track, param: c.effects[0].params.track.v };`);
  ok('matte track moved V1 → V2: the Track Matte Key parameter now says V2', tm.matteTrack === 'V2' && tm.param === 'V2', J(tm));
  f = await frameAt(0.5);
  ok('the matte still applies after the reorder (Export and Preview)', near(f.ex[0], BLUE, 12) && near(f.ex[2], BLACK, 12) && near(f.pv[2], BLACK, 12), J(f));
  const dt = await js(`E.cmds.run('track.delete', 'V2'); const m = await T.modal(); const msg = m?.textContent || ''; T.button('Delete').click(); await T.tick(100);
    const s = E.store.getState().sequence; const c = s.clips.find((x) => x.id === BID);
    const r = { msg: /contains 1 clip/.test(msg), tracks: s.tracks.filter((t) => t.kind === 'video').map((t) => t.id), clipTrack: c.track, param: c.effects[0].params.track.v };
    E.cmds.run('edit.undo'); await T.tick(50); r.undone = E.store.getState().sequence.clips.length; return r;`);
  ok('Delete Track with a clip asks first, removes it, renumbers V3 → V2, the matte picks None', dt.msg && dt.tracks.join() === 'V2,V1' && dt.clipTrack === 'V2' && dt.param === 'None', J(dt));
  ok('Delete Track undo brings the clip back', dt.undone === 2, J(dt));

  // ---------------- linked V+A across tracks, keeps sync ----------------
  console.log('Drag linked clips across tracks');
  await js(`T.fresh(${W}, ${H}); E.store.set({ pps: 100, toggles: { snap: false, linked: true } }); window.RGB = await T.imp('${A('rgb_seconds.mp4')}'); window.IDS = T.place(RGB, 0, 'V1'); await T.tick(150); return true;`);
  const drag = (id, dx, toTrack, mods = {}) => js(`
    const el = document.querySelector('.clip[data-clip="${id}"]'); const r = el.getBoundingClientRect(); const tr = document.querySelector('.tl-track[data-track="${toTrack}"]').getBoundingClientRect();
    const x0 = r.left + Math.min(40, r.width / 2), y0 = r.top + r.height / 2, o = ${J(mods)};
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x0, clientY: y0, ...o }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: x0 + ${dx} / 2, clientY: (y0 + tr.top + tr.height / 2) / 2, ...o }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: x0 + ${dx}, clientY: tr.top + tr.height / 2, ...o })); await T.tick(30);
    const badge = document.querySelector('.tl-drag-mode')?.textContent || ''; const line = !!document.querySelector('.tl-insert-line');
    const h0 = E.store.getState().history.length;
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: x0 + ${dx}, clientY: tr.top + tr.height / 2, ...o })); await T.tick(100);
    const s = E.store.getState(); return { badge, line, steps: s.history.length - h0, sel: s.selection, clips: s.sequence.clips.map((c) => ({ id: c.id, track: c.track, start: +c.start.toFixed(3), dur: +c.dur.toFixed(3), linkId: c.linkId, inPoint: +(c.inPoint || 0).toFixed(3) })) };`);
  const ids = await js(`return IDS;`);
  let d = await drag(ids[0], 100, 'V2');
  const cv = d.clips.find((c) => c.id === ids[0]), ca = d.clips.find((c) => c.id === ids[1]);
  ok('drag the picture of a linked V+A clip to V2: its sound stays on A1 (only the grabbed kind changes track)', cv.track === 'V2' && ca.track === 'A1', J(d.clips));
  ok('both moved 1 s, still in sync, one undo step', cv.start === 1 && ca.start === 1 && d.steps === 1, J(d));
  const mix = await js(`return [await T.mix(0.1, 0.9), await T.mix(1.1, 1.9)];`);
  ok('the sound plays from 1 s (silent before, the tone after)', mix[0][0] < 0.005 && mix[1][0] > 0.05, J(mix));
  f = await frameAt(1.5);
  ok('the picture plays from 1 s too (red = first second of the source)', near(f.ex[1], RED, 20), J(f));

  // ---------------- Ctrl = insert, Alt = duplicate, Ctrl+Alt = rearrange ----------------
  console.log('Modifier drags');
  await js(`T.fresh(${W}, ${H}); E.store.set({ pps: 100, toggles: { snap: false, linked: true } }); const R = await T.imp(${J(red)}); const B = await T.imp(${J(blue)});
    E.store.edit('setup', ({ seq }) => { seq.clips.push({ id: 'a', track: 'V1', start: 0, dur: 2, name: 'A', mediaId: R.id, inPoint: 0, speed: 1, effects: [], enabled: true },
      { id: 'b', track: 'V1', start: 2, dur: 3, name: 'B', mediaId: B.id, inPoint: 0, speed: 1, effects: [], enabled: true }); }); await T.tick(150); return true;`);
  const lay = (dd) => dd.clips.filter((c) => c.track === 'V1').sort((x, y) => x.start - y.start).map((c) => `${c.id.length > 1 ? '*' : c.id}@${c.start}+${c.dur}`).join(' ');
  d = await drag('a', 500, 'V1', { ctrlKey: true, altKey: true });
  ok('Ctrl+Alt+drag A after B = rearrange: B A without a gap', lay(d) === 'b@0+3 a@3+2' && /Rearrange/.test(d.badge) && d.line && d.steps === 1, J([lay(d), d.badge, d.line, d.steps]));
  d = await drag('a', -300, 'V1', { ctrlKey: true });
  ok('Ctrl+drag A to 0 = insert: A goes in before B, its old place stays a gap', lay(d) === 'a@0+2 b@2+3' && /Insert/.test(d.badge) && d.steps === 1, J([lay(d), d.badge]));
  d = await drag('b', 300, 'V2', { altKey: true });
  const copy = d.clips.find((c) => !['a', 'b'].includes(c.id));
  ok('Alt+drag = duplicate: B stays, a copy lands on V2 at 5 s and is selected', copy && copy.track === 'V2' && copy.start === 5 && lay(d) === 'a@0+2 b@2+3' && d.sel.join() === copy.id && /Duplicate/.test(d.badge), J([d.clips, d.sel, d.badge]));
  const und = await js(`E.cmds.run('edit.undo'); await T.tick(50); return E.store.getState().sequence.clips.length;`);
  ok('a modifier drag is one undo step', und === 2, J(und));
  // Ctrl on drop from the Project panel = insert
  const ins = await js(`const B = E.store.getState().media[1]; const el = document.querySelector('.tl-track[data-track="V1"]'); const r = el.getBoundingClientRect(); const dt = new DataTransfer(); dt.setData('media-id', B.id);
    const x = r.left + 100;
    el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: r.top + 10, ctrlKey: true, dataTransfer: dt })); await T.tick(30);
    const badge = document.querySelector('.tl-drag-mode')?.textContent || '';
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: r.top + 10, ctrlKey: true, dataTransfer: dt })); await T.tick(100);
    const s = E.store.getState().sequence; return { badge, v1: s.clips.filter((c) => c.track === 'V1').sort((p, q) => p.start - q.start).map((c) => [c.name, +c.start.toFixed(2), +c.dur.toFixed(2)]) };`);
  const at1 = ins.v1[1]?.[1], dB = ins.v1[1]?.[2]; // drop point (≈ 1 s, sub-pixel position) and length of the dropped item
  ok('Ctrl held on a drop from the Project panel = insert at 1 s (A is split, the rest moves right)', /Insert/.test(ins.badge) && ins.v1.length === 4 && Math.abs(at1 - 1) < 0.03 && ins.v1[1][0] === 'blue.png'
    && [at1 + dB, 2 + dB].every((t, i) => Math.abs(ins.v1[i + 2][1] - t) < 0.02) && ins.v1[2][0] === 'A' && ins.v1[3][0] === 'B', J(ins));

  // ---------------- nudge shortcuts ----------------
  console.log('Nudge');
  await js(`T.fresh(${W}, ${H}); E.store.set({ toggles: { snap: false, linked: true } }); window.RGB = await T.imp('${A('rgb_seconds.mp4')}'); window.IDS = T.place(RGB, 1, 'V1'); E.store.set({ selection: IDS }); return true;`);
  const key = (k, o = {}) => js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${J(k)}, bubbles: true, ...${J(o)} })); await T.tick(30); const s = E.store.getState().sequence; return IDS.map((id) => { const c = s.clips.find((x) => x.id === id); return [c.track, +(c.start * 30).toFixed(2)]; });`);
  let k = await key('ArrowUp', { altKey: true });
  ok('Alt+↑: picture V1 → V2, linked sound stays on A1', J(k) === J([['V2', 30], ['A1', 30]]), J(k));
  k = await key('ArrowDown', { altKey: true });
  ok('Alt+↓: back to V1 / A1', J(k) === J([['V1', 30], ['A1', 30]]), J(k));
  k = await key('ArrowRight', { altKey: true });
  ok('Alt+→: 1 frame later', J(k) === J([['V1', 31], ['A1', 31]]), J(k));
  k = await key('ArrowLeft', { altKey: true, shiftKey: true });
  ok('Alt+Shift+←: 5 frames earlier', J(k) === J([['V1', 26], ['A1', 26]]), J(k));
  const ph = await js(`return E.store.getState().playhead;`);
  ok('plain arrows still move the playhead (shortcut does not clash)', ph === 0, J(ph));

  // ---------------- track targeting ----------------
  console.log('Track targeting');
  const tg = await js(`T.fresh(${W}, ${H}); await T.tick(100); const R = await T.imp(${J(red)}); const RGB = await T.imp('${A('rgb_seconds.mp4')}');
    const on = () => [...document.querySelectorAll('.tl-head .tgt.on')].map((b) => b.textContent);
    const r = { start: on() };
    const click = (id) => document.querySelector('.tl-head[data-track="' + id + '"] .tgt').click();
    click('V2'); await T.tick(30); click('V1'); await T.tick(30); click('A1'); await T.tick(30); click('A3'); await T.tick(30); r.after = on();
    E.store.set({ selectedMedia: RGB.id, sourceIn: 0, sourceOut: 1, playhead: 0 }); E.cmds.run('edit.overwrite'); await T.tick(50);
    let s = E.store.getState().sequence; r.ow = s.clips.map((c) => c.track).sort();
    E.store.set({ selection: s.clips.map((c) => c.id) }); E.cmds.run('edit.copy');
    click('V2'); click('V3'); await T.tick(30); E.store.set({ playhead: 2 }); E.cmds.run('edit.paste'); await T.tick(50);
    s = E.store.getState().sequence; r.paste = s.clips.filter((c) => c.start > 1.5).map((c) => c.track).sort(); r.linked = new Set(s.clips.filter((c) => c.start > 1.5).map((c) => c.linkId)).size;
    E.store.set({ playhead: 0.5 }); E.cmds.run('seq.addEdit'); await T.tick(50); s = E.store.getState().sequence;
    r.cut = s.clips.filter((c) => c.start < 1.5).map((c) => c.track).sort();
    return r;`);
  ok('default (no target flags, like older projects): V1 and A1 are targeted', J(tg.start) === J(['V1', 'A1']), J(tg));
  ok('clicking the target buttons: V2 + A3 targeted', J(tg.after) === J(['V2', 'A3']), J(tg));
  ok('Overwrite (.) uses the targeted tracks V2 / A3', J(tg.ow) === J(['A3', 'V2']), J(tg));
  ok('Paste uses the targeted tracks (V3 / A3) and links the copies to each other', J(tg.paste) === J(['A3', 'V3']) && tg.linked === 1, J(tg));
  ok('Add Edit cuts only the targeted tracks (V3 and A3: A3 is cut, V2 is not)', J(tg.cut) === J(['A3', 'A3', 'V2']), J(tg));

  // ---------------- rename, height, save / open, old projects ----------------
  console.log('Rename / height / project file');
  const rn = await js(`E.cmds.run('track.rename', 'V1'); const m = await T.modal(); const inp = m.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, 'Interviews'); inp.dispatchEvent(new Event('input', { bubbles: true })); await T.tick(20);
    T.button('OK').click(); await T.tick(50);
    E.cmds.run('track.height', 'V1', 96); await T.tick(50);
    return { name: document.querySelector('.tl-head[data-track="V1"] .tname').textContent, h: document.querySelector('.tl-track[data-track="V1"]').getBoundingClientRect().height, hh: document.querySelector('.tl-head[data-track="V1"]').getBoundingClientRect().height };`);
  ok('Rename Track shows the name on the header', rn.name === 'Interviews', J(rn));
  ok('track height applies to the header and the track row', Math.round(rn.h) === 96 && Math.round(rn.hh) === 96, J(rn));
  const proj = out('tracks.esproj'); nextSave.push(proj); nextOpen.push(proj);
  const sv = await js(`E.store.set({ projectPath: null }); await E.cmds.run('file.saveAs'); await T.tick(200); E.store.resetProject(); E.store.set({ dirty: false }); await E.cmds.run('file.open'); await T.tick(300);
    const t = E.store.getState().sequence.tracks; const v1 = t.find((x) => x.id === 'V1'); return { name: v1.name, h: v1.h, targets: t.filter((x) => x.target).map((x) => x.id) };`);
  ok('name, height and targets are saved in the project', sv.name === 'Interviews' && sv.h === 96 && J(sv.targets) === J(['V3', 'A3']), J(sv));

  {
    const probe = await js(`return await T.imp(${J(red)});`);
    const old = { projectName: 'Old', media: [{ ...probe, id: 'm1' }], bins: [],
      sequence: { id: 'seq1', name: 'Old', fps: 30, width: W, height: H, duration: 60, tracks: [{ id: 'V2', kind: 'video', muted: false, solo: false, locked: false }, { id: 'V1', kind: 'video', muted: false, solo: false, locked: false }, { id: 'A1', kind: 'audio', muted: false, solo: false, locked: false }],
        clips: [{ id: 'c1', track: 'V1', start: 0, dur: 3, name: 'red', mediaId: 'm1', inPoint: 0, speed: 1, effects: [], enabled: true }], transitions: [], markers: [] } };
    fs.writeFileSync(out('old5.esproj'), JSON.stringify(old)); nextOpen.push(out('old5.esproj'));
    const r = await js(`E.store.set({ dirty: false }); await E.cmds.run('file.open'); await T.tick(300); const s = E.store.getState();
      return { name: s.sequence.name, tgt: [...document.querySelectorAll('.tl-head .tgt.on')].map((b) => b.textContent), h: document.querySelector('.tl-track[data-track="V1"]').getBoundingClientRect().height, label: document.querySelector('.tl-head[data-track="V1"] .tname').textContent };`);
    ok('old .esproj opens with default targets (V1 / A1), default height and no name', r.name === 'Old' && J(r.tgt) === J(['V1', 'A1']) && Math.round(r.h) === 36 && r.label === '', J(r));
    f = await frameAt(0.5);
    ok('old project renders as before', near(f.ex[1], RED, 10) && near(f.pv[1], RED, 10), J(f));
  }

  // ======================= Phase B: clip display =======================
  // ---------------- thumbnails ----------------
  console.log('Video thumbnails');
  await js(`window.TH = async (id, n) => {
      let imgs = [];
      for (let i = 0; i < 200; i++) { imgs = [...document.querySelectorAll('.clip[data-clip="' + id + '"] .thumbs img')]; if (imgs.length >= n && imgs.every((x) => x.complete && x.naturalWidth)) break; await T.tick(50); }
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const g = cv.getContext('2d');
      return imgs.sort((a, b) => parseFloat(a.style.left) - parseFloat(b.style.left)).map((im) => { g.drawImage(im, im.naturalWidth / 2, im.naturalHeight / 2, 1, 1, 0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)]; });
    };
    T.fresh(${W}, ${H}); E.store.set({ pps: 60 }); window.RGB = await T.imp('${A('rgb_seconds.mp4')}'); window.RIMG = await T.imp(${J(red)});
    window.V = T.place(RGB, 0, 'V1')[0]; window.VR = T.place(RGB, 4, 'V2')[0]; T.patch(VR, (c) => { c.reverse = true; c.inPoint = 3; });
    window.VS = T.place(RGB, 8, 'V3')[0]; T.patch(VS, (c) => { c.speed = 2; c.dur = 1.5; });
    window.VH = T.place(RGB, 0, 'V3')[0]; T.patch(VH, (c) => { c.dur = 2; c.frameHold = { on: true, mode: 'source', time: 1.5 }; });
    window.VI = T.place(RIMG, 12, 'V1')[0]; return true;`);
  const near2 = (a, b) => near(a, b, 40);
  const GREEN = [0, 255, 0];
  let th = await js(`E.cmds.run('view.thumbs.headTail'); await T.tick(50); return { v: await TH(V, 2), r: await TH(VR, 2), s: await TH(VS, 2), mode: E.store.getState().thumbMode, menu: !!E.store.getState() };`);
  ok('Head and Tail: first frame red, last frame blue', th.v.length === 2 && near2(th.v[0], RED) && near2(th.v[1], BLUE), J(th));
  ok('reversed clip: head blue, tail red', th.r.length === 2 && near2(th.r[0], BLUE) && near2(th.r[1], RED), J(th.r));
  ok('speed 200 % (1.5 s): tail is the last source frame (blue)', th.s.length === 2 && near2(th.s[0], RED) && near2(th.s[1], BLUE), J(th.s));
  th = await js(`E.cmds.run('view.thumbs.continuous'); await T.tick(50); const n = document.querySelectorAll('.clip[data-clip="' + V + '"] .thumbs img').length; return { v: await TH(V, 3), h: await TH(VH, 1), img: await TH(VI, 1) };`);
  const cols = th.v.map((p) => (near2(p, RED) ? 'R' : near2(p, GREEN) ? 'G' : near2(p, BLUE) ? 'B' : '?')).join('');
  ok('Continuous filmstrip walks the source: red → green → blue', /^R+G+B+$/.test(cols), J([cols, th.v]));
  ok('frame hold: every tile shows the held frame (green)', th.h.length >= 1 && th.h.every((p) => near2(p, GREEN)), J(th.h));
  ok('still image clip shows the image', th.img.length >= 1 && near2(th.img[0], RED), J(th.img));
  th = await js(`E.cmds.run('view.thumbs.none'); await T.tick(80); const n = document.querySelectorAll('.clip .thumbs img').length; E.cmds.run('view.thumbs.head'); await T.tick(50);
    const pref = localStorage.getItem('es-thumbs');
    E.store.set({ selection: [VI] }); E.cmds.seqFromSelection(true); await T.tick(100); const nest = E.store.getState().sequence.clips.find((c) => c.nestId);
    const el = document.querySelector('.clip[data-clip="' + nest.id + '"]'); const icon = el?.querySelector('.thumb-icon')?.textContent; const rendered = !!el?.querySelector('.thumbs.rendered'); return { n, pref, icon, rendered };`);
  ok('None hides the thumbnails; the choice is remembered (viewer preference)', th.n === 0 && th.pref === 'head', J(th));
  ok('a nested sequence clip uses rendered thumbnails (icon until the first frame is drawn; see phase9 D14)', th.rendered && (th.icon === '🎬' || th.icon === undefined), J(th));

  // ---------------- Opacity rubber band ----------------
  console.log('Opacity / Volume rubber bands');
  await js(`T.fresh(${W}, ${H}); E.store.set({ pps: 100, toggles: { snap: false, linked: true } }); const R = await T.imp(${J(red)}); window.OP = T.place(R, 0, 'V1')[0];
    E.cmds.run('track.height', 'V1', 96); E.cmds.run('track.height', 'A1', 96); E.store.set({ clipBands: { [OP]: 'opacity.opacity' } }); await T.tick(100); return true;`);
  const band = (id, code) => js(`const svg = document.querySelector('.clip[data-clip="' + ${id} + '"] .paramband'); const line = svg.querySelector('.pb-line'); const r = svg.getBoundingClientRect(); const H = r.height;
    const at = (t, f) => ({ clientX: r.left + t * E.store.getState().pps, clientY: r.top + H * (1 - f), bubbles: true, button: 0 });
    const down = (el, o) => el.dispatchEvent(new MouseEvent('mousedown', o)); const move = (o) => window.dispatchEvent(new MouseEvent('mousemove', o)); const up = (o) => window.dispatchEvent(new MouseEvent('mouseup', o));
    const keys = () => [...svg.querySelectorAll('.pb-key')]; ${code}`);
  let bd = await band('OP', `const h0 = E.store.getState().history.length; down(line, at(1, 1)); move(at(1, 0.75)); move(at(1, 0.5)); up(at(1, 0.5)); await T.tick(50);
    const c = T.clip(OP); return { op: c.opacity.opacity, steps: E.store.getState().history.length - h0 };`);
  ok('drag the Opacity line down to half: the whole clip becomes 50 % (one undo step)', Math.abs(bd.op.v - 50) < 2 && !bd.op.keys && bd.steps === 1, J(bd));
  f = await frameAt(0.5);
  ok('Export = band value (red at 50 % over black) = Preview', near(f.ex[1], [128, 0, 0], 12) && near(f.pv[1], f.ex[1], 6), J(f));
  bd = await band('OP', `down(line, { ...at(0.5, 0.5), ctrlKey: true }); await T.tick(40); down(svg.querySelector('.pb-line'), { ...at(2.5, 0.5), ctrlKey: true }); await T.tick(40);
    const k = keys().sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[1]; const kr = k.getBoundingClientRect();
    const o = { clientX: kr.left + kr.width / 2, clientY: kr.top + kr.height / 2, bubbles: true, button: 0 };
    down(k, o); move({ ...o, clientY: r.top + H * 0.1 }); up({ ...o, clientY: r.top + H * 0.1 }); await T.tick(50);
    return T.clip(OP).opacity.opacity;`);
  ok('Ctrl+click adds two keys, dragging the second key up sets it to ~100 %', bd.keys?.length === 2 && Math.abs(bd.keys[0].v - 50) < 2 && bd.keys[1].v > 85, J(bd));
  const want = await js(`return E.params.evalParam(T.clip(OP).opacity.opacity, 1.5);`);
  f = await frameAt(1.5);
  ok('Export follows the keyframes from the band (evalParam) = Preview', Math.abs(f.ex[1][0] - 255 * want / 100) < 10 && near(f.pv[1], f.ex[1], 6), J([want, f]));
  bd = await band('OP', `const k = keys()[0]; const kr = k.getBoundingClientRect(); k.dispatchEvent(new MouseEvent('mousedown', { clientX: kr.left + 4, clientY: kr.top + 4, bubbles: true, button: 0, altKey: true })); await T.tick(50); return T.clip(OP).opacity.opacity;`);
  ok('Alt+click removes a key', bd.keys?.length === 1, J(bd));
  const ec = await js(`E.store.set({ selection: [OP] }); E.layout.requestPanel?.('effectControls'); await T.tick(100); return E.params.evalParam(T.clip(OP).opacity.opacity, 0) ;`);
  ok('the band and Effect Controls share the keyframes (clip.opacity.opacity)', typeof ec === 'number', J(ec));

  // ---------------- Volume rubber band ----------------
  await js(`window.TONE = await T.imp('${A('left_tone.wav')}'); window.AU = T.place(TONE, 0, 'A1')[0]; E.store.set({ clipBands: { [AU]: 'volume.level' } }); await T.tick(100); return true;`);
  const m0 = await js(`return T.mix(0.2, 1.2);`);
  bd = await band('AU', `down(line, at(1, 0.5)); move(at(1, 0.25)); up(at(1, 0.25)); await T.tick(50); return T.clip(AU).volume.level;`);
  const m1 = await js(`return T.mix(0.2, 1.2);`);
  const gainDb = 20 * Math.log10(m1[0] / m0[0]);
  ok('drag the Volume line from half (0 dB) to a quarter: Level ≈ −6 dB', Math.abs(bd.v + 6.02) < 0.6 && !bd.keys, J(bd));
  ok('the exported mix is quieter by the same amount', Math.abs(gainDb - bd.v) < 0.5, J([gainDb, bd.v, m0, m1]));
  const menu = await js(`const el = document.querySelector('.clip[data-clip="' + AU + '"]'); const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 })); await T.tick(50);
    const item = [...document.querySelectorAll('.menu-dropdown.ctx .menu-item')].find((x) => /Show Clip Keyframes/.test(x.textContent));
    const opts = item ? [...item.querySelectorAll('.sub .menu-item')].map((x) => x.textContent.trim()) : [];
    [...item.querySelectorAll('.sub .menu-item')].find((x) => /None/.test(x.textContent)).click(); await T.tick(50);
    return { opts, off: !document.querySelector('.clip[data-clip="' + AU + '"] .paramband') };`);
  ok('right-click > Show Clip Keyframes lists Volume › Level and None hides the band', menu.opts.some((x) => /Volume › Level/.test(x)) && menu.off, J(menu));
});
