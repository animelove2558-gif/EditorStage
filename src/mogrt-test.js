import { createEvaluator } from './Services/mogrt/evaluator';
import { createPainter, paintWithMotionBlur } from './Services/mogrt/painter';
import { measureText, registerTemplateFonts } from './Services/mogrt/text';
import { decodeFootageFile, videoFrame, seekVideos } from './Services/mogrt/footage';
import { parseAep } from './Services/mogrt/aep/index.js';

// Dev harness: evaluate + paint a template scene and return PNG data.
//   load(dir)            sample folder (scene.oracle.json or project.aep, definition.json, footage/)
//   loadScene(scene, files)  an in-memory scene (synthetic tests); files: { name: Uint8Array }
window.__mt = {
  async load(dir, useAep = false) {
    const read = (p) => window.editorstage.readText(p);
    const scene = useAep ? parseAep(new Uint8Array(await window.editorstage.readFile(`${dir}\\project.aep`))) : JSON.parse((await read(`${dir}\\scene.oracle.json`)).replace(/^﻿/, ''));
    const files = {};
    for (const f of scene.footage) {
      if (f.kind !== 'file') continue; const name = String(f.path || f.name).split(/[\\/]/).pop();
      try { files[name] = new Uint8Array(await window.editorstage.readFile(`${dir}\\footage\\${name}`)); } catch { /* missing */ }
    }
    const def = JSON.parse((await read(`${dir}\\definition.json`)).replace(/^﻿/, ''));
    const meta = Object.values(def.sourceInfoLocalized)[0];
    return this.loadScene(scene, files, meta.name);
  },
  /** a scene whose footage files live in `${dir}\footage\` */
  async loadSceneDir(scene, dir) {
    const files = {};
    for (const f of scene.footage) { if (f.kind !== 'file') continue; const name = String(f.path || f.name).split(/[\\/]/).pop(); try { files[name] = new Uint8Array(await window.editorstage.readFile(`${dir}\\footage\\${name}`)); } catch { /* missing */ } }
    return this.loadScene(scene, files);
  },
  async loadScene(scene, files = {}, compName) {
    const sources = new Map(); const failed = [];
    for (const f of scene.footage) {
      if (f.kind !== 'file') continue; const name = String(f.path || f.name).split(/[\\/]/).pop();
      if (!files[name]) { failed.push(name + ' (missing)'); continue; }
      const s = await decodeFootageFile({ name, data: files[name] }, f); if (s && s.kind !== 'error') sources.set(f.id, s); else failed.push(name);
    }
    const used = new Set(scene.comps.flatMap((c) => c.layers.map((l) => (l.sourceKind === 'comp' ? l.sourceId : null))));
    const comp = scene.comps.find((c) => c.name === compName) || scene.comps.find((c) => !used.has(c.id)) || scene.comps[0];
    const missingFonts = await registerTemplateFonts(scene.usedFonts, []);
    const getImage = (id, t) => { const s = sources.get(id); return !s ? null : s.kind === 'image' ? s.image : s.kind === 'video' ? videoFrame(s, t || 0, comp.frameRate || 30) : null; };
    const painter = createPainter({ getImage });
    const mctx = document.createElement('canvas').getContext('2d');
    const ev = createEvaluator(scene, { measureText: (doc) => measureText(mctx, doc), onExpressionError: (e) => this.errors.push(String(e.message || e)) });
    this.errors = [];
    this.state = { scene, comp, painter, ev, sources };
    return { comp: comp.name, w: comp.width, h: comp.height, dur: comp.duration, layers: comp.layers.length, controls: (comp.essentialControllers || []).length, images: sources.size, failed, missingFonts };
  },
  /** end-to-end through the app modules: .mogrt file -> package.js -> render.js (libId = file path) */
  async e2e(libPath, times, outW = 640) {
    const { prepareMogrt, renderMogrt, templateWarnings } = await import('./Services/mogrt/render');
    const inst = await prepareMogrt(libPath); const out = [];
    for (const t of times) {
      const c = renderMogrt(inst, 'e2e', {}, t, t, outW);
      const cv = document.getElementById('c'); cv.width = c.width; cv.height = c.height; const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.drawImage(c, 0, 0);
      out.push(cv.toDataURL('image/png').slice(22));
    }
    return { pngs: out, warnings: templateWarnings(inst), controls: inst.entry.controls.list.map((c) => c.type), audio: inst.lastAudio.get('e2e') };
  },
  videos() { return [...this.state.sources.entries()].filter(([, s]) => s.kind === 'video').map(([id, s]) => ({ id, url: s.url, t: s.video.currentTime, d: s.video.duration, rs: s.video.readyState, err: s.video.error && s.video.error.message })); },
  async paint(t, controls, outW = 960, bg = '#707070') {
    const { comp, painter, ev, sources } = this.state; const s = outW / comp.width;
    const t0 = performance.now(); let frame = ev.evaluateComp(comp.id, t, controls || {});
    const vids = []; const walk = (f) => { for (const l of f.layers) { if (l.kind === 'footage' && l.source) { const x = sources.get(l.source.footageId); if (x && x.kind === 'video') vids.push({ src: x, time: l.source.time }); } if (l.precomp) walk(l.precomp.frame); } }; walk(frame);
    if (vids.length) { await seekVideos(vids); frame = ev.evaluateComp(comp.id, t, controls || {}); }
    const t1 = performance.now();
    const c = paintWithMotionBlur(painter, frame, s, (tk) => ev.evaluateComp(comp.id, tk, controls || {}), comp.frameRate || 30, 16); const t2 = performance.now();
    const cv = document.getElementById('c'); cv.width = c.width; cv.height = c.height; const g = cv.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); g.drawImage(c, 0, 0); painter.release(c);
    return { png: cv.toDataURL('image/png').slice(22), evalMs: +(t1 - t0).toFixed(1), paintMs: +(t2 - t1).toFixed(1), unsupported: [...painter.stats.unsupportedEffects], errors: [...new Set(this.errors)].slice(0, 5) };
  },
};
