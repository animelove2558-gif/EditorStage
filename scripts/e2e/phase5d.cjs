// Phase 5 end-to-end test, part D: marquee selection on the timeline with real mouse events (drag a box from an empty
// spot with the Selection tool to select clips on video and audio tracks). Run: npm run test:e2e
const { suite } = require('./harness.cjs');

suite('phase5d e2e', async ({ js, ok, A }) => {
  const J = (x) => JSON.stringify(x);
  // rgb_seconds.mp4 (3 s, video + audio) at 0 s on V1/A1, ramp_gray.mp4 (4 s, video only) at 5 s on V1
  const ids = await js(`T.fresh(320, 240); const a = await T.imp('${A('rgb_seconds.mp4')}'); const b = await T.imp('${A('ramp_gray.mp4')}');
    T.place(a, 0, 'V1'); T.place(b, 5, 'V1'); E.store.set({ pps: 40, tool: 'selection', selection: [] }); await T.tick(150);
    document.querySelector('.tl-scroll').scrollLeft = 0; await T.tick(50);
    const c = E.store.getState().sequence.clips;
    return { v: c.find((x) => x.track === 'V1' && x.start === 0).id, a: c.find((x) => x.track.startsWith('A')).id, ramp: c.find((x) => x.start === 5).id, at: c.find((x) => x.track.startsWith('A')).track };`);
  ok('setup: video + linked audio at 0 s, a second video at 5 s', !!ids.v && !!ids.a && !!ids.ramp, J(ids));

  // drag from time t0 on track r0 to time t1 on track r1 (real mouse events on the empty track area)
  const drag = (t0, r0, t1, r1, o = {}) => js(`
    const sc = document.querySelector('.tl-scroll'), sr = sc.getBoundingClientRect(), pps = E.store.getState().pps;
    const X = (t) => sr.left - sc.scrollLeft + t * pps;
    const Y = (id) => { const r = document.querySelector('.tl-track[data-track="' + id + '"]').getBoundingClientRect(); return r.top + r.height / 2; };
    const o = ${J(o)}; const start = document.elementFromPoint(X(${t0}), Y(${J(r0)}));
    start.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: X(${t0}), clientY: Y(${J(r0)}), ...o }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: (X(${t0}) + X(${t1})) / 2, clientY: (Y(${J(r0)}) + Y(${J(r1)})) / 2, ...o })); await T.tick(30);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: X(${t1}), clientY: Y(${J(r1)}), ...o })); await T.tick(30);
    const box = !!document.querySelector('.tl-marquee');
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: X(${t1}), clientY: Y(${J(r1)}), ...o })); await T.tick(50);
    return { startOn: start.className, box, after: !!document.querySelector('.tl-marquee'), sel: [...E.store.getState().selection].sort(),
      shown: [...document.querySelectorAll('.clip.sel')].map((x) => x.dataset.clip).sort() };`);
  const S = (...x) => J([...x].sort());

  let r = await drag(3.5, 'V1', 7, 'V1');
  ok('drag starts on the empty track area (not a clip)', /tl-track/.test(r.startOn), r.startOn);
  ok('a selection box is drawn while dragging and removed on release', r.box && !r.after, J(r));
  ok('box over the clip at 5 s selects it (and only it)', J(r.sel) === S(ids.ramp) && J(r.shown) === S(ids.ramp), J(r));

  r = await drag(4, 'V1', 1, ids.at);
  ok('box from video down to audio selects the video and audio clips', J(r.sel) === S(ids.v, ids.a), J(r));

  await js(`E.store.set({ toggles: { ...E.store.getState().toggles, linked: false } }); return true;`);
  r = await drag(4, ids.at, 2, ids.at);
  ok('Linked Selection off: box on the audio track selects only the audio clip', J(r.sel) === S(ids.a), J(r));
  r = await drag(3.5, 'V1', 6, 'V1', { shiftKey: true });
  ok('Shift + drag adds to the selection', J(r.sel) === S(ids.a, ids.ramp), J(r));
  await js(`E.store.set({ toggles: { ...E.store.getState().toggles, linked: true } }); return true;`);

  r = await drag(4, 'V1', 4, 'V1');
  ok('a click on an empty spot (no drag) deselects everything, no box', r.sel.length === 0 && !r.box, J(r));

  await js(`E.store.edit('lock', ({ seq }) => { seq.tracks.find((t) => t.id === ${J(ids.at)}).locked = true; }); await T.tick(50); E.store.set({ toggles: { ...E.store.getState().toggles, linked: false } }); return true;`);
  r = await drag(4, 'V1', 1, ids.at);
  ok('clips on a locked track are not selected by the box', J(r.sel) === S(ids.v), J(r));
  await js(`E.store.set({ toggles: { ...E.store.getState().toggles, linked: true } }); return true;`);

  const other = await js(`E.store.set({ tool: 'razor', selection: [] }); await T.tick(30);
    const sc = document.querySelector('.tl-scroll'), sr = sc.getBoundingClientRect(), pps = E.store.getState().pps, tr = document.querySelector('.tl-track[data-track="V1"]').getBoundingClientRect();
    const x = sr.left - sc.scrollLeft + 3.5 * pps, y = tr.top + tr.height / 2;
    document.elementFromPoint(x, y).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x, clientY: y }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: x + 200, clientY: y })); await T.tick(30); const box = !!document.querySelector('.tl-marquee');
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: x + 200, clientY: y })); await T.tick(30); E.store.set({ tool: 'selection' });
    return { box, sel: E.store.getState().selection.length };`);
  ok('other tools (Razor) do not draw a selection box', !other.box && other.sel === 0, J(other));

  const ruler = await js(`const ru = document.querySelector('.tl-ruler').getBoundingClientRect(); const x = ru.left + 100, y = ru.top + 5;
    document.querySelector('.tl-ruler').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x, clientY: y }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: x + 150, clientY: y + 60 })); await T.tick(30); const box = !!document.querySelector('.tl-marquee');
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: x + 150, clientY: y + 60 })); await T.tick(30); return { box };`);
  ok('dragging on the ruler scrubs and draws no box', !ruler.box, J(ruler));
});
