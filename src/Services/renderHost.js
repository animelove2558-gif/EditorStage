// The hidden render window's side of the Export Queue (electron/renderWindow.js). The page is loaded with ?mode=render:
// it shows no UI, loads each job's project snapshot into its own store and renders it with the normal exporter, so the
// main window keeps its own media elements and Program Monitor while the queue renders.
import { loadProject } from '../Core/store';
import { exportSequence } from './exporter';

export const isRenderWindow = () => { try { return new URLSearchParams(location.search).get('mode') === 'render'; } catch { return false; } };

export function installRenderHost() {
  const bg = window.editorstage?.render; if (!bg) return;
  const cancelled = new Set();
  bg.onCancel((id) => cancelled.add(id));
  let chain = Promise.resolve();
  bg.onJob((job) => {
    chain = chain.then(async () => {
      let r;
      try {
        loadProject(job.state, job.state?.projectPath || null);
        r = await exportSequence(job.opts, (p, msg) => bg.progress(job.id, p, msg), () => cancelled.has(job.id));
      } catch (e) { r = { ok: false, error: String(e?.message || e) }; }
      cancelled.delete(job.id);
      bg.done(job.id, JSON.parse(JSON.stringify(r || { ok: false, error: 'no result' })));
    });
  });
  bg.ready();
}
