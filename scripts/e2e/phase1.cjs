// Phase 1 end-to-end test (Title sharpness, keyframe easing, Frame Hold, Field Options, Audio Channels, interchange,
// workspaces, dialogs, old projects). Run: npm run test:e2e
const fs = require('fs');
const { suite } = require('./harness.cjs');

suite('phase1 e2e', async ({ js, ok, A, out, frames, px, near, wavRms, nextSave, nextOpen }) => {
    // ---- 1. Titles are sharp at 4K export (graphicCanvas used to be capped at 1280 px) ----
    console.log('Title at 3840x2160');
    await js(`T.fresh(3840, 2160); E.gfx.addGraphic('text', 0, { text: 'Sharp Title', size: 220, shadow: false, color: '#ffffff', y: 0.5, font: 'Arial' }); return T.exp(${JSON.stringify(out('title4k.mov'))}, 'Apple ProRes 422 (MOV)', 3840, 2160, 0, 1 / 30);`);
    {
      const [f] = frames(out('title4k.mov'), 3840, 2160); let hard = 0, maxd = 0;
      for (let y = 900; y < 1260; y++) for (let x = 1; x < 3840; x++) { const d = Math.abs(f[(y * 3840 + x) * 3] - f[(y * 3840 + x - 1) * 3]); if (d > maxd) maxd = d; if (d >= 170) hard++; }
      ok('title has hard edges at 4K (no upscaling blur)', maxd >= 200 && hard > 400, `max step ${maxd}, hard edges ${hard}`);
    }

    // ---- 2. Keyframe interpolation: Export renders exactly evalParam ----
    console.log('Keyframe interpolation in export');
    for (const interp of ['easeInOut', 'hold', 'bezier']) {
      const file = out(`ease_${interp}.mov`);
      const exp = await js(`
        T.fresh(320, 180); const id = E.gfx.addGraphic('rect', 0, { x: 0.5, y: 0.5, w: 1.2, h: 1.2, color: '#ffffff', stroke: false });
        let p = { v: 0, keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] };
        p = '${interp}' === 'bezier' ? E.params.setKeyInterp(E.params.setKeyInterp(p, 0, 'bezier'), 1, 'bezier') : E.params.setKeyInterp(p, 0, '${interp}');
        T.patch(id, (c) => { c.opacity = { opacity: p }; });
        await T.exp(${JSON.stringify(file)}, 'Apple ProRes 422 (MOV)', 320, 180, 0, 31 / 30);
        return [0, 4, 8, 15, 22, 26, 30].map((i) => [i, E.params.evalParam(T.clip(id).opacity.opacity, i / 30)]);`);
      const fr = frames(file, 320, 180); let worst = 0;
      for (const [i, v] of exp) worst = Math.max(worst, Math.abs(px(fr[i], 320, 160, 90)[0] - (v / 100) * 255));
      const lin = Math.abs(exp[2][1] - (8 / 30) * 100) > 5; // the curve really differs from linear
      ok(`${interp}: exported opacity = evalParam (max error ${worst.toFixed(1)}/255)`, worst <= 6 && lin, JSON.stringify(exp));
    }

    // ---- 3. Frame Hold ----
    console.log('Frame Hold');
    await js(`T.fresh(320, 240); const m = await T.imp('${A('rgb_seconds.mp4')}'); window.V = T.place(m, 0)[0]; return true;`);
    const holdCase = async (name, hold, t, rgb) => {
      const file = out(`hold_${name}.mov`);
      await js(`T.patch(V, (c) => { c.frameHold = ${JSON.stringify(hold)}; }); return T.exp(${JSON.stringify(file)}, 'Apple ProRes 422 (MOV)', 320, 240, ${t}, ${t} + 2 / 30);`);
      const f = frames(file, 320, 240); ok(`frame hold ${name}: ${JSON.stringify(rgb)} at t=${t}`, f.length && f.every((x) => near(px(x, 320, 160, 120), rgb, 40)), JSON.stringify(f.map((x) => px(x, 320, 160, 120))));
    };
    await holdCase('off (control)', null, 1.5, [0, 255, 0]);
    await holdCase('source 0.5s', { on: true, mode: 'source', time: 0.5 }, 2.5, [255, 0, 0]);
    await holdCase('out point', { on: true, mode: 'out' }, 0.5, [0, 0, 255]);
    await holdCase('in point', { on: true, mode: 'in' }, 2.5, [255, 0, 0]);

    // ---- 4. Field Options (fields.png: even rows blue, odd rows red) ----
    console.log('Field Options');
    await js(`T.fresh(320, 240); const m = await T.imp('${A('fields.png')}'); window.F = T.place(m, 0)[0]; return true;`);
    const fieldCase = async (name, fo, check) => {
      const file = out(`field_${name}.mov`);
      await js(`T.patch(F, (c) => { c.fieldOptions = ${JSON.stringify(fo)}; }); return T.exp(${JSON.stringify(file)}, 'Apple ProRes 422 (MOV)', 320, 240, 0, 1 / 30);`);
      const [f] = frames(file, 320, 240); const rows = [10, 11, 120, 121].map((y) => px(f, 320, 160, y)); ok(`field options ${name}`, check(rows), JSON.stringify(rows));
    };
    const B = [0, 0, 255], R = [255, 0, 0];
    await fieldCase('none', null, (r) => near(r[0], B, 50) && near(r[1], R, 50) && near(r[2], B, 50) && near(r[3], R, 50));
    await fieldCase('reverse dominance', { reverse: true }, (r) => near(r[0], R, 50) && near(r[1], B, 50) && near(r[2], R, 50));
    await fieldCase('deinterlace', { deinterlace: true }, (r) => r.every((x) => near(x, B, 50)));
    await fieldCase('reduce flicker', { flicker: true }, (r) => r.every((x) => near(x, [128, 0, 128], 45)));

    // ---- 5. Audio Channels + linked audio not doubled ----
    console.log('Audio Channels');
    const mixes = await js(`
      T.fresh(320, 240); const m = await T.imp('${A('left_tone.wav')}'); const [a] = T.place(m, 0); const r = {};
      for (const mode of ['stereo', 'swap', 'mono', 'left', 'right']) { T.patch(a, (c) => { c.audio = { ...(c.audio || {}), channels: mode === 'stereo' ? undefined : mode }; }); r[mode] = await T.mix(0.2, 1.2); }
      T.patch(a, (c) => { c.audio.channels = 'swap'; });
      await E.exporter.exportSequence({ path: ${JSON.stringify(out('swap.wav'))}, preset: 'WAV (audio only)', start: 0, end: 1.5, audio: true }, () => {}, () => false);
      return r;`);
    {
      const ref = mixes.stereo[0]; const z = (v) => v < ref * 0.02; const eq = (v, k) => Math.abs(v - ref * k) < ref * 0.08;
      ok('stereo: tone left only', ref > 0.01 && z(mixes.stereo[1]), JSON.stringify(mixes.stereo));
      ok('swap: tone right only', z(mixes.swap[0]) && eq(mixes.swap[1], 1), JSON.stringify(mixes.swap));
      ok('mono: (L+R)/2 on both', eq(mixes.mono[0], 0.5) && eq(mixes.mono[1], 0.5), JSON.stringify(mixes.mono));
      ok('left only: L on both', eq(mixes.left[0], 1) && eq(mixes.left[1], 1), JSON.stringify(mixes.left));
      ok('right only: silent (R is silent)', z(mixes.right[0]) && z(mixes.right[1]), JSON.stringify(mixes.right));
      const w = wavRms(out('swap.wav')); ok('WAV export applies channel mapping', w[0] < ref * 0.02 && Math.abs(w[1] - ref) < ref * 0.1, JSON.stringify(w));
    }
    const dbl = await js(`
      T.fresh(320, 240); const m = await T.imp('${A('rgb_seconds.mp4')}'); const [v, a] = T.place(m, 0);
      const both = await T.mix(0.2, 1.2); E.store.edit('rm', ({ seq }) => { seq.clips = seq.clips.filter((c) => c.id !== v); }); const audioOnly = await T.mix(0.2, 1.2);
      return { both, audioOnly };`);
    ok('linked video+audio exports the audio once (not doubled)', dbl.audioOnly[0] > 0.01 && Math.abs(dbl.both[0] - dbl.audioOnly[0]) < dbl.audioOnly[0] * 0.05, JSON.stringify(dbl));

    // ---- 6. Interchange: export -> import round trip through the app ----
    console.log('Interchange (EDL / FCPXML / Premiere XML)');
    await js(`T.fresh(1920, 1080); const m = await T.imp('${A('rgb_seconds.mp4')}'); const w = await T.imp('${A('left_tone.wav')}');
      E.store.edit('place', ({ seq }) => { E.cmds.placeMedia(seq, m, 0); E.cmds.placeMedia(seq, m, 3); E.cmds.placeMedia(seq, w, 1, 'A2'); }); return true;`);
    const sig = `const s = E.store.getState().sequence; return s.clips.map((c) => c.track + '@' + c.start.toFixed(2) + '+' + c.dur.toFixed(2) + ' ' + E.media.mediaById(c.mediaId).name).sort();`;
    const before = await js(sig);
    await js(`window.SEQ0 = E.store.getState().sequence.id; return true;`);
    for (const [fmt, ext] of [['fcpxml', 'fcpxml'], ['xmeml', 'xml'], ['edl', 'edl']]) {
      const file = out(`rt.${ext}`); nextSave.push(file);
      const r = await js(`const r = await E.interchange.exportInterchangeFile('${fmt}'); const back = await E.interchange.importInterchange(r.files[0]); const after = (() => { ${sig} })(); E.store.switchSequence(SEQ0); return { back, after };`);
      ok(`${fmt}: same clips after export + import`, JSON.stringify(r.after) === JSON.stringify(before) && r.back.offline === 0, `\n    before ${JSON.stringify(before)}\n    after  ${JSON.stringify(r.after)}`);
    }
    {
      fs.writeFileSync(out('missing.xml'), fs.readFileSync(out('rt.xml'), 'utf8').replace(/rgb_seconds\.mp4/g, 'gone_file.mp4'));
      const r = await js(`const r = await E.interchange.importInterchange(${JSON.stringify(out('missing.xml'))}); return { r, st: E.store.getState().media.filter((m) => m.status === 'offline').map((m) => m.name) };`);
      ok('missing media is created offline', r.r.offline === 1 && r.st.includes('gone_file.mp4'), JSON.stringify(r));
      nextOpen.push(out('rt.fcpxml'));
      const n = await js(`const k = Object.keys(E.store.allSeqs()).length; await E.cmds.run('file.importSequence'); await T.tick(300); return Object.keys(E.store.allSeqs()).length - k;`);
      ok('File > Import Sequence menu command imports a sequence', n === 1, `new sequences: ${n}`);
    }

    // ---- 7. Workspaces ----
    console.log('Workspaces');
    const ws = await js(`
      const names = Object.keys(E.layout.WORKSPACE_CONFIGS); const res = {};
      const comps = () => { const out = new Set(); const walk = (n) => { if (n.type === 'tab') out.add(n.component); (n.children || []).forEach(walk); }; const j = E.layout.getModel().toJson(); walk(j.layout); (j.borders || []).forEach(walk); return [...out]; };
      for (const n of names) { E.layout.loadWorkspace(n); await T.tick(150); res[n] = { comps: comps(), dom: !!document.querySelector('.flexlayout__layout') }; }
      const visible = E.layout.PANELS.filter((p) => !p.hidden).map((p) => p.id);
      E.layout.loadWorkspace('editing'); await T.tick(100); return { res, visible };`);
    for (const [n, r] of Object.entries(ws.res)) ok(`workspace ${n} loads`, r.dom && r.comps.length > 0);
    ok('All Panels contains every panel', ws.res.allPanels && ws.visible.every((id) => ws.res.allPanels.comps.includes(id)), JSON.stringify(ws.visible.filter((id) => !ws.res.allPanels?.comps.includes(id))));
    ok('Essential Graphics + Learning workspaces exist', !!ws.res.essentialGraphics && ws.res.essentialGraphics.comps.includes('essentialGraphics') && !!ws.res.learning && ws.res.learning.comps.includes('learn'));

    // ---- 8. Dialogs through the UI + Undo / Redo ----
    console.log('Dialogs (DOM) + Undo/Redo');
    const dlg = await js(`
      T.fresh(320, 240); const m = await T.imp('${A('rgb_seconds.mp4')}'); const [v, a] = T.place(m, 0); const r = {};
      E.store.set({ selection: [v], playhead: 0.5 }); await E.cmds.run('clip.frameHold'); await T.modal(); T.button('OK').click(); await T.tick();
      r.hold = T.clip(v).frameHold; E.store.undo(); r.undone = T.clip(v).frameHold ?? null; E.store.redo(); r.redone = T.clip(v).frameHold;
      E.store.set({ selection: [a] }); await E.cmds.run('clip.audioChannels'); await T.modal(); document.querySelectorAll('.modal input[type=radio]')[2].click(); await T.tick(); T.button('OK').click(); await T.tick();
      r.ch = T.clip(a).audio.channels;
      E.store.set({ selection: [v] }); await E.cmds.run('clip.fieldOptions'); await T.modal(); const rad = [...document.querySelectorAll('.modal input')]; rad[0].click(); await T.tick(); T.button('OK').click(); await T.tick();
      r.fo = T.clip(v).fieldOptions; E.store.undo(); r.foUndone = T.clip(v).fieldOptions ?? null;
      E.store.set({ selectedMedia: m.id, sourceIn: 1, sourceOut: 2 }); await E.cmds.run('clip.makeSubclip'); await T.modal(); T.button('OK').click(); await T.tick();
      r.sub = E.store.getState().media.filter((x) => x.subclip).map((x) => x.subclip);
      r.open = !!document.querySelector('.modal'); return r;`);
    ok('Frame Hold dialog sets hold at the playhead (0.5 s)', dlg.hold?.on && Math.abs(dlg.hold.time - 0.5) < 0.02, JSON.stringify(dlg.hold));
    ok('Frame Hold undo / redo', dlg.undone === null && dlg.redone?.on);
    ok('Audio Channels dialog (Swap)', dlg.ch === 'swap', String(dlg.ch));
    ok('Field Options dialog + undo', !!dlg.fo && dlg.foUndone === null, JSON.stringify([dlg.fo, dlg.foUndone]));
    ok('Make Subclip dialog creates a subclip from In/Out', dlg.sub.length === 1 && Math.abs(dlg.sub[0].in - 1) < 0.05 && Math.abs(dlg.sub[0].out - 2) < 0.05, JSON.stringify(dlg.sub));
    ok('dialogs closed', !dlg.open);

    // ---- 9. A project saved before Phase 1 still opens and renders ----
    console.log('Old project');
    {
      const probe = await js(`const m = await T.imp('${A('rgb_seconds.mp4')}'); return m;`);
      const old = { projectName: 'Old', media: [{ ...probe, id: 'm1' }], bins: [],
        sequence: { id: 'seq1', name: 'Old', fps: 30, width: 320, height: 240, duration: 60, tracks: [{ id: 'V1', kind: 'video', muted: false, solo: false, locked: false }, { id: 'A1', kind: 'audio', muted: false, solo: false, locked: false }],
          clips: [{ id: 'c1', track: 'V1', start: 0, dur: 3, name: 'rgb', mediaId: 'm1', inPoint: 0, speed: 1, effects: [], enabled: true, opacity: { opacity: { v: 100, keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] } } },
            { id: 'c2', track: 'A1', start: 0, dur: 3, name: 'rgb', mediaId: 'm1', inPoint: 0, speed: 1, effects: [], enabled: true, asAudio: true }], transitions: [], markers: [] } };
      fs.writeFileSync(out('old.esproj'), JSON.stringify(old)); nextOpen.push(out('old.esproj'));
      const r = await js(`E.store.set({ dirty: false }); await E.cmds.run('file.open'); await T.tick(300); const s = E.store.getState();
        await T.exp(${JSON.stringify(out('old.mov'))}, 'Apple ProRes 422 (MOV)', 320, 240, 0.5, 0.5 + 1 / 30, false); const mix = await T.mix(0.2, 1.2);
        return { name: s.sequence.name, clips: s.sequence.clips.length, mix };`);
      const [f] = frames(out('old.mov'), 320, 240);
      ok('old .esproj opens', r.name === 'Old' && r.clips === 2, JSON.stringify(r));
      ok('old keyframes (no interp field) stay linear', near(px(f, 320, 160, 120), [128, 0, 0], 12), JSON.stringify(px(f, 320, 160, 120)));
      ok('old project audio mixes', r.mix[0] > 0.01, JSON.stringify(r.mix));
    }

});
