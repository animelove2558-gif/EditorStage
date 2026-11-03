// Phase 4 end-to-end test (Long-to-Shorts, Smart B-Roll). Project Health Check is tested in phase3.cjs. Run: npm run test:e2e
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { suite } = require('./harness.cjs');

suite('phase4 e2e', async ({ js, ok, out, frames, px, near, nextSave, nextOpen }) => {
  const J = (x) => JSON.stringify(x);
  const ff = (args) => { const r = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 }); if (r.status) throw new Error(String(r.stderr)); };
  const W = 320, H = 240;

  // a 60 s "talk": speech-like tone 3.2 s on / 0.8 s off, loud from 42 to 50 s; the picture is still grey except
  // 40–55 s where it flips between two colours every second (scene changes)
  const long = out('long.mp4');
  ff(['-f', 'lavfi', '-i', `color=c=gray:s=${W}x${H}:r=10:d=60`, '-f', 'lavfi', '-i', 'aevalsrc=0.08*sin(2*PI*300*t)*lt(mod(t\\,4)\\,3.2)*(1+7*between(t\\,42\\,50)):s=48000:d=60',
    '-vf', "geq=r='if(between(T,40,55),if(lt(mod(T,2),1),230,20),128)':g='if(between(T,40,55),if(lt(mod(T,2),1),40,200),128)':b='128'", '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', long]);
  // transcript: a plain sentence in every 4 s speech burst; the ones from 8 to 20 s are full of hooks
  const plain = [' we', ' talk', ' about', ' some', ' stuff.'];
  const hooks = { 8: [' why', ' is', ' this', ' the', ' secret?'], 12: [' never', ' make', ' this', ' mistake', ' again!'], 16: [' the', ' best', ' tip', ' ever!', ' wow!'] };
  const words = []; for (let s = 0; s < 60; s += 4) (hooks[s] || plain).forEach((t, i) => words.push({ text: t, t0: s + i * 0.62, t1: s + i * 0.62 + 0.55 }));

  console.log('Long-to-Shorts');
  await js(`T.fresh(${W}, ${H}); const m = await T.imp(${J(long)}); T.place(m, 0, 'V1');
    E.store.edit('Transcribe', ({ media }) => { media.find((x) => x.id === m.id).transcript = { words: ${J(words)}, language: 'english' }; });
    window.LONG = m.id; window.AN = await E.shorts.analyzeMoments({ minLen: 10, maxLen: 16 }); return true;`);
  const an = await js(`return { n: AN.candidates.length, tr: AN.hasTranscript, cuts: AN.cuts, dur: AN.duration };`);
  ok('analyze: candidates from the transcript sentences, scene changes found by FFmpeg', an.n > 20 && an.tr && an.cuts.filter((t) => t > 39 && t < 56).length >= 8 && an.cuts.filter((t) => t < 39).length === 0, J(an));
  const top = await js(`const only = (f) => ({ speech: 0, energy: 0, loud: 0, scenes: 0, keywords: 0, [f]: 1 }); const r = {};
    for (const f of ['keywords', 'loud', 'scenes']) { const m = E.shorts.rankMoments(AN.candidates, only(f), { count: 1 })[0]; r[f] = [m.t0, m.t1, m.score]; }
    const d = E.shorts.rankMoments(AN.candidates, E.shorts.DEFAULT_WEIGHTS, { count: 3 }); r.def = d.map((m) => [m.t0, m.t1, m.score]); return r;`);
  const ov = (m, a, b) => Math.min(m[1], b) - Math.max(m[0], a);
  ok('weights: Keywords & Hooks only → the moment with the hooks (8–20 s)', ov(top.keywords, 8, 20) >= 8, J(top.keywords));
  ok('weights: Laughter / Loud only → the loud part (42–50 s)', ov(top.loud, 42, 50) >= 6, J(top.loud));
  ok('weights: Scene Changes only → the part with cuts (40–55 s)', ov(top.scenes, 40, 55) >= 9, J(top.scenes));
  ok('default ranking: 3 moments, no overlap, best first', top.def.length === 3 && top.def.every((m, i) => top.def.every((n, j) => i === j || m[1] <= n[0] || n[1] <= m[0])) && top.def[0][2] >= top.def[1][2] && top.def[1][2] >= top.def[2][2], J(top.def));

  const mk = await js(`const m = E.shorts.rankMoments(AN.candidates, { speech: 0, energy: 0, loud: 0, scenes: 0, keywords: 1 }, { count: 1 })[0];
    const before = Object.keys(E.store.allSeqs()).length; const main = E.store.getState().sequence.id;
    const r = await E.shorts.createShorts([m], { aspect: '9:16', reframe: true, captions: true, cutSilence: true, captionPreset: 'Bold Yellow Highlight' });
    const all = E.store.allSeqs(); const s = all[r[0].id]; window.SHORT = r[0].id;
    const caps = s.clips.filter((c) => c.caption); const v = s.clips.find((c) => c.mediaId && !c.asAudio && s.tracks.find((t) => t.id === c.track).kind === 'video');
    const out = { len: m.t1 - m.t0, made: r, w: s.width, h: s.height, active: E.store.getState().sequence.id === main, caps: caps.length, capEnd: Math.max(...caps.map((c) => c.start + c.dur)), firstCap: caps.sort((a, b) => a.start - b.start)[0]?.caption.text,
      style: caps[0]?.caption.style.preset, scale: v?.motion?.scale?.v, audio: s.clips.filter((c) => c.asAudio).length, count: Object.keys(all).length - before };
    await E.cmds.run('edit.undo'); out.undone = !E.store.allSeqs()[SHORT]; await E.cmds.run('edit.redo'); out.redone = !!E.store.allSeqs()[SHORT]; return out;`);
  ok('Create Shorts: a 9:16 sequence per moment, the long sequence stays active', mk.count === 1 && Math.abs(mk.w / mk.h - 9 / 16) < 0.02 && mk.active && /^Short 1 – /.test(mk.made[0].name), J(mk));
  ok('the short has its silences cut (shorter than the moment)', mk.made[0].dur < mk.len - 0.4 && mk.made[0].dur > mk.len * 0.6, J([mk.made[0].dur, mk.len]));
  ok('captions from the transcript, in the chosen style, inside the cut short', mk.caps >= 2 && mk.capEnd <= mk.made[0].dur + 0.35 && /why|never|best/.test(mk.firstCap || '') && mk.style === 'highlight', J(mk));
  ok('Auto-Reframe scales the 4:3 picture to cover 9:16', mk.scale > 150, J(mk.scale));
  ok('Create Shorts is one undo step (undo removes the sequence, redo brings it back)', mk.undone && mk.redone, J(mk));

  // Preview = Export on the short
  const pv = await js(`E.store.switchSequence(SHORT); await T.tick(200); const s = E.store.getState().sequence; const img = await E.exporter.renderFrame(0.5, s.width, s.height); return { w: s.width, h: s.height, px: [...img.data.slice(((s.height >> 1) * s.width + (s.width >> 1)) * 4, ((s.height >> 1) * s.width + (s.width >> 1)) * 4 + 3)] };`);
  const sp = out('short.mov'); await js(`return T.exp(${J(sp)}, 'Apple ProRes 422 (MOV)', ${pv.w}, ${pv.h}, 0.5, 0.5 + 1 / 30);`);
  const fr = frames(sp, pv.w, pv.h)[0];
  ok('Preview = Export on a short (centre pixel)', near(px(fr, pv.w, pv.w >> 1, pv.h >> 1), pv.px, 8), J([px(fr, pv.w, pv.w >> 1, pv.h >> 1), pv.px]));

  // ---------------- Smart B-Roll ----------------
  console.log('Smart B-Roll');
  const dog = out('dog_park.png'), coffee = out('coffee_cup.png'), car = out('city-car.mp4'), misc = out('IMG_0001.png');
  ff(['-f', 'lavfi', '-i', 'color=c=#8a5a2b:s=160x120:d=1', '-frames:v', '1', dog]);
  ff(['-f', 'lavfi', '-i', 'color=c=#3b2414:s=160x120:d=1', '-frames:v', '1', coffee]);
  ff(['-f', 'lavfi', '-i', 'color=c=#1e5aa8:s=160x120:r=10:d=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', car]);
  ff(['-f', 'lavfi', '-i', 'color=c=#777777:s=160x120:d=1', '-frames:v', '1', misc]);
  const talk = [{ text: ' my', t0: 1, t1: 1.3 }, { text: ' dog', t0: 1.4, t1: 1.8 }, { text: ' loves', t0: 1.9, t1: 2.3 }, { text: ' the', t0: 2.4, t1: 2.6 }, { text: ' park.', t0: 2.7, t1: 3.1 },
    { text: 'ฉัน', t0: 5, t1: 5.3 }, { text: 'ชอบ', t0: 5.4, t1: 5.7 }, { text: 'ดื่ม', t0: 5.8, t1: 6.1 }, { text: 'กาแฟ', t0: 6.2, t1: 6.8 },
    { text: ' we', t0: 9, t1: 9.2 }, { text: ' drove', t0: 9.3, t1: 9.7 }, { text: ' cars', t0: 9.8, t1: 10.2 }, { text: ' downtown.', t0: 10.3, t1: 11 }];
  const br = await js(`E.store.switchSequence(Object.keys(E.store.allSeqs()).find((id) => id !== SHORT)); T.fresh(${W}, ${H});
    const m = await T.imp(${J(long)}); T.place(m, 0, 'V1');
    E.store.edit('Transcribe', ({ media }) => { media.find((x) => x.id === m.id).transcript = { words: ${J(talk)}, language: 'th' }; });
    for (const p of ${J([dog, coffee, car, misc])}) await T.imp(p);
    const n = await E.broll.indexMedia({ vision: false }); const ix = Object.fromEntries(E.store.getState().media.map((x) => [x.name, (x.brollIndex?.labels || []).map((l) => l[0])]));
    window.SUG = E.broll.suggestBRoll(); return { n, ix, sug: SUG.map((g) => ({ t0: g.t0, text: g.text, c: g.candidates.map((c) => c.name) })) };`);
  ok('Index Media: file names become concepts (Thai / English synonyms of the detector classes)', br.n === 5 && br.ix['dog_park.png'].includes('dog') && br.ix['coffee_cup.png'].includes('cup') && br.ix['city-car.mp4'].includes('car'), J(br.ix));
  ok('Suggest B-Roll: "my dog loves the park" → dog_park.png', br.sug.find((g) => /dog/.test(g.text))?.c[0] === 'dog_park.png', J(br.sug));
  ok('Suggest B-Roll: Thai "ฉันชอบดื่มกาแฟ" (coffee) → coffee_cup.png', br.sug.find((g) => /กาแฟ/.test(g.text))?.c[0] === 'coffee_cup.png', J(br.sug));
  ok('Suggest B-Roll: "drove cars" (plural) → city-car.mp4; unrelated files are not suggested', br.sug.find((g) => /drove/.test(g.text))?.c[0] === 'city-car.mp4' && !br.sug.some((g) => g.c.includes('IMG_0001.png')) && !br.sug.some((g) => g.c.includes('long.mp4')), J(br.sug));
  const pl = await js(`const g = SUG.find((x) => /drove/.test(x.text)); const id = E.store.getState().media.find((x) => x.name === 'city-car.mp4').id;
    const n0 = E.store.getState().sequence.clips.length; const cid = E.broll.placeBRoll(g, id); const s = E.store.getState().sequence; const c = s.clips.find((x) => x.id === cid);
    const r = { added: s.clips.length - n0, track: c.track, start: c.start, dur: c.dur, g: [g.t0, g.t1], link: c.linkId || null, again: E.broll.suggestBRoll().find((x) => /drove/.test(x.text))?.candidates.map((x) => x.name) || [] };
    const d = E.store.getState().media.find((x) => x.name === 'dog_park.png').id; const g2 = SUG.find((x) => /dog/.test(x.text)); const c2 = E.broll.placeBRoll(g2, d); r.img = [T.clip(c2).track, T.clip(c2).dur, g2.t1 - g2.t0];
    const f = await E.exporter.renderFrame((g.t0 + g.t1) / 2, 32, 24); r.px = [...f.data.slice((12 * 32 + 16) * 4, (12 * 32 + 16) * 4 + 3)];
    await E.cmds.run('edit.undo'); await E.cmds.run('edit.undo'); r.undone = E.store.getState().sequence.clips.length - n0; return r;`);
  ok('Place B-Roll: on V2 above the talk, at the sentence, picture only (no audio clip)', pl.added === 1 && pl.track === 'V2' && Math.abs(pl.start - pl.g[0]) < 0.01 && pl.dur <= 2.001 && !pl.link, J(pl));
  ok('a still fills the whole sentence; the placed shot shows in the frame; the file is not suggested again there', Math.abs(pl.img[1] - pl.img[2]) < 0.01 && near(pl.px, [30, 90, 168], 20) && !pl.again.includes('city-car.mp4'), J(pl));
  ok('each placement is one undo step', pl.undone === 0, J(pl));
  const vx = await js(`const n = await E.broll.indexMedia({ force: true, vision: true }); return { n, done: E.store.getState().media.filter((m) => m.brollIndex?.vision).length };`);
  ok('Index Media with the object detector runs offline on every file', vx.n === 5 && vx.done === 5, J(vx));

  // UI, menu, save / reopen
  const ui = await js(`await E.cmds.run('ai.shorts'); await T.tick(300); const a = E.store.getState().createTab; const sb = [...document.querySelectorAll('.createpanel button')].map((b) => b.textContent);
    await E.cmds.run('ai.broll'); await T.tick(300); const b = E.store.getState().createTab; const bb = [...document.querySelectorAll('.createpanel button')].map((x) => x.textContent);
    return { a, b, find: sb.includes('Find Moments'), sug: bb.includes('Suggest B-Roll') };`);
  ok('Smart Tools > Long-to-Shorts / Smart B-Roll open the Create panel tabs', ui.a === 'shorts' && ui.b === 'broll' && ui.find && ui.sug, J(ui));
  const ss = out('p4.esproj'); nextSave.push(ss);
  await js(`window.SUG2 = E.broll.suggestBRoll(); E.broll.placeBRoll(SUG2[0], SUG2[0].candidates[0].mediaId); const m = E.shorts.rankMoments((await E.shorts.analyzeMoments({ minLen: 5, maxLen: 9, scenes: false })).candidates, undefined, { count: 1 });
    await E.shorts.createShorts(m, { reframe: false }); E.store.set({ projectPath: null }); await E.cmds.run('file.saveAs'); await T.tick(300); E.store.resetProject(); return true;`);
  nextOpen.push(ss);
  const ro = await js(`await E.cmds.run('file.open'); await T.tick(800); const s = E.store.getState(); const shorts = Object.values(E.store.allSeqs()).filter((q) => /^Short 1/.test(q.name));
    return { idx: s.media.filter((m) => m.brollIndex).length, shorts: shorts.map((q) => [q.width, q.height, q.clips.filter((c) => c.caption).length]), broll: s.sequence.clips.filter((c) => /B-Roll/.test(c.name)).length };`);
  ok('save / reopen keeps the media index, the short sequences and the placed B-roll', ro.idx === 5 && ro.shorts.length === 1 && ro.shorts[0][1] > ro.shorts[0][0] && ro.shorts[0][2] > 0 && ro.broll === 1, J(ro));
});
