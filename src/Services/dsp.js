// Client for dist/dsp.worker.js: runDsp(op, args, { onProgress, transfer }) -> Promise(result). A job can be cancelled with
// the returned promise's cancel() (the worker is restarted, so a long job really stops).
let worker = null, nextId = 0; const jobs = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('dsp.worker.js', document.baseURI).href);
  worker.onmessage = ({ data }) => {
    const j = jobs.get(data.id); if (!j) return;
    if (data.progress != null) { j.onProgress?.(data.progress); return; }
    jobs.delete(data.id); if (data.ok) j.resolve(data.result); else j.reject(new Error(data.error));
  };
  worker.onerror = (e) => { for (const j of jobs.values()) j.reject(new Error(e.message || 'dsp worker failed')); jobs.clear(); worker = null; };
  return worker;
}
export function runDsp(op, args, { onProgress, transfer = [] } = {}) {
  const id = ++nextId; const w = getWorker();
  let rejectFn;
  const p = new Promise((resolve, reject) => { rejectFn = reject; jobs.set(id, { resolve, reject, onProgress }); w.postMessage({ id, op, args }, transfer); });
  p.cancel = () => { if (!jobs.has(id)) return; jobs.delete(id); rejectFn(new Error('Cancelled')); for (const j of jobs.values()) j.reject(new Error('Cancelled')); jobs.clear(); worker?.terminate(); worker = null; };
  return p;
}
