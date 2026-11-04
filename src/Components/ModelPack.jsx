// Download button / status of an optional AI model pack (src/Services/ai/modelPacks.js).
import React, { useEffect, useState } from 'react';
import { subscribe, packInfo, downloadPack, cancelDownload, mb } from '../Services/ai/modelPacks';

export default function ModelPack({ id, onReady }) {
  const [p, setP] = useState(() => packInfo(id));
  useEffect(() => { setP(packInfo(id)); return subscribe(() => setP(packInfo(id))); }, [id]);
  if (!id) return null;
  if (!p) return <span className="modelpack muted">checking model…</span>;
  if (p.installed) return <span className="modelpack ok" title={`${p.label} — ${p.license}, ${p.repo}`}>Model installed ✓</span>;
  if (p.downloading) {
    const pct = p.bytes ? Math.floor((100 * p.got) / p.bytes) : 0;
    return <span className="modelpack">Downloading {pct}% of {mb(p.bytes)} <button onClick={() => cancelDownload(id)}>Cancel</button></span>;
  }
  const go = () => downloadPack(id).then(() => onReady?.(), () => {});
  return (
    <span className="modelpack">
      <button className="primary" onClick={go} title={`Downloads ${p.label} (${p.license}) once from huggingface.co/${p.repo}; it then works offline`}>Download model ({mb(p.bytes)})</button>
      {p.error && <span className="err"> {p.error}</span>}
    </span>
  );
}
