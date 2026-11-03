import React, { useEffect, useState } from 'react';
import { useStore, set } from '../Core/store';
import { unusedMedia, archiveMedia, searchArchives, restoreItem } from '../Services/archive';
import { listHistory, commitRevision, restoreRevision, createBranch, switchBranch } from '../Services/versions';

const notify = (msg) => set((s) => ({ log: [...s.log.slice(-49), msg] }));
const mb = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);

// ---------------------------------------------------------------- Cold Archive Manager
export function ArchivePanel() {
  const media = useStore((s) => s.media); useStore((s) => s.sequence);
  const [tab, setTab] = useState('archive'); const unused = unusedMedia();
  const [pick, setPick] = useState({}); const [dest, setDest] = useState(() => { try { return localStorage.getItem('es-archive-dest') || ''; } catch { return ''; } });
  const [o, setO] = useState({ compress: true, removeOriginals: false, removeFromProject: false, note: '' });
  const [prog, setProg] = useState(null); const [sizes, setSizes] = useState({});
  const [q, setQ] = useState(''); const [found, setFound] = useState([]);
  useEffect(() => { (async () => { const s = {}; for (const m of unused) { const st = await window.editorstage.stat(m.path); if (st) s[m.id] = st.size; } setSizes(s); })(); }, [media.length]);
  useEffect(() => { if (tab === 'search') searchArchives(q).then(setFound); }, [tab, q]);
  const chosen = unused.filter((m) => pick[m.id] ?? true);
  const run = async () => {
    if (!dest) return notify('Choose the archive drive/folder first');
    if (!(await window.editorstage.exists(dest))) return notify('Archive destination is not connected');
    setProg({ i: 0, n: chosen.length });
    try { const rec = await archiveMedia(chosen, { dest, ...o }, setProg); const bad = rec.items.filter((x) => x.error); notify(`Archived ${rec.items.length - bad.length} files to ${rec.dest}${bad.length ? ` (${bad.length} failed: ${bad[0].error})` : ''}`); }
    catch (e) { notify('Archive failed: ' + e.message); }
    setProg(null);
  };
  const total = chosen.reduce((s, m) => s + (sizes[m.id] || 0), 0);
  return (
    <div className="smarttools">
      <div className="tabs"><button className={tab === 'archive' ? 'active' : ''} onClick={() => setTab('archive')}>Archive unused media</button><button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>Search archives</button></div>
      <div className="panel-pad">
        {tab === 'archive' ? <>
          <p className="st-help">Media in the project that no sequence uses ({unused.length} files). They are compressed (gzip, lossless) and copied to external storage, verified by SHA-1, and indexed so you can search them without the drive connected.</p>
          <ul className="list st-list">{unused.map((m) => <li key={m.id}><label><input type="checkbox" checked={pick[m.id] ?? true} onChange={(e) => setPick({ ...pick, [m.id]: e.target.checked })} /> {m.name}</label> <span className="dim">{m.kind} · {sizes[m.id] ? mb(sizes[m.id]) : '?'}{m.archived ? ' · archived' : ''}</span></li>)}{!unused.length && <li className="dim">Every media item is used on a timeline.</li>}</ul>
          <div className="st-row"><label>Destination</label><div className="st-ctl"><input value={dest} readOnly placeholder="External HDD / SSD folder" /><button onClick={async () => { const d = await window.editorstage.pickFolder(); if (d) { setDest(d); try { localStorage.setItem('es-archive-dest', d); } catch { /* */ } } }}>Browse…</button></div></div>
          <div className="st-row"><label>Options</label><div className="st-ctl">
            <label><input type="checkbox" checked={o.compress} onChange={(e) => setO({ ...o, compress: e.target.checked })} /> compress</label>
            <label><input type="checkbox" checked={o.removeOriginals} onChange={(e) => setO({ ...o, removeOriginals: e.target.checked })} /> delete originals after verifying</label>
            <label><input type="checkbox" checked={o.removeFromProject} onChange={(e) => setO({ ...o, removeFromProject: e.target.checked })} /> remove from project</label></div></div>
          <div className="st-row"><label>Note</label><div className="st-ctl"><input value={o.note} onChange={(e) => setO({ ...o, note: e.target.value })} placeholder="searchable note (client, shoot date…)" /></div></div>
          <div className="st-actions"><button className="primary" disabled={!chosen.length || !!prog} onClick={run}>Archive {chosen.length} files ({mb(total)})</button></div>
          {prog && <div className="st-prog"><div style={{ width: `${(prog.i / Math.max(1, prog.n)) * 100}%` }} /><span>{prog.i}/{prog.n} {prog.name || ''}</span></div>}
        </> : <>
          <div className="st-row"><label>Search</label><div className="st-ctl"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="file name, project, note, kind…" /><button onClick={async () => { const d = await window.editorstage.pickFolder(); if (d) { try { await window.editorstage.archive.importIndex(d); notify('Archive index added'); setFound(await searchArchives(q)); } catch (e) { notify('Not an EditorStage archive folder: ' + e.message); } } }}>Add archive folder…</button></div></div>
          <ul className="list st-list">{found.map((it) => <li key={it.archiveId + it.hash}>
            <b>{it.name}</b> <span className="dim">{it.project} · {new Date(it.created).toLocaleDateString()} · {mb(it.size)} → {mb(it.archivedSize)} · drive {it.volume} {it.online ? '● connected' : '○ offline'}</span>
            <button disabled={!it.online} title={it.online ? 'Restore to the original location' : 'Connect the archive drive to restore'} onClick={async () => { const r = await restoreItem(it); notify(r.ok ? 'Restored ' + r.path : r.error); }}>Restore</button>
          </li>)}{!found.length && <li className="dim">No archived files match.</li>}</ul>
        </>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Version History
export function VersionsPanel() {
  const tick = useStore((s) => s.versionsRev); const path = useStore((s) => s.projectPath); const dirty = useStore((s) => s.dirty);
  const [h, setH] = useState(null); const [label, setLabel] = useState(''); const [branch, setBranch] = useState('');
  const refresh = () => listHistory().then(setH).catch((e) => notify('History: ' + e.message));
  useEffect(() => { refresh(); }, [tick, path]);
  if (!h) return <div className="panel-pad dim">Loading history…</div>;
  // revisions of the current branch first (walk parents), then the rest
  const revs = Object.values(h.revisions).sort((a, b) => b.time - a.time);
  const onBranch = new Set(); for (let id = h.branches[h.current]; id; id = h.revisions[id]?.parent) onBranch.add(id);
  const totalKB = revs.reduce((s, r) => s + (r.newBytes || 0), 0) / 1024;
  return (
    <div className="panel-pad versions">
      <p className="st-help">Revisions are stored in <code>{h.dir}</code>. Only changed parts of the project are written (content-addressed), so many revisions cost very little disk space ({totalKB.toFixed(0)} KB so far).{!path && ' Save the project to keep history next to it (until then it lives in the app data folder).'}</p>
      <div className="st-row"><label>Branch</label><div className="st-ctl"><select value={h.current} onChange={(e) => switchBranch(e.target.value).then(refresh).catch((er) => notify(er.message))}>{Object.keys(h.branches).map((b) => <option key={b}>{b}</option>)}</select>
        <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="new branch name" /><button disabled={!branch.trim()} onClick={() => createBranch(branch).then(() => { setBranch(''); refresh(); notify('Branch created'); }).catch((e) => notify(e.message))}>New branch</button></div></div>
      <div className="st-row"><label>Save revision</label><div className="st-ctl"><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={dirty ? 'describe this version…' : 'no unsaved changes'} /><button onClick={() => commitRevision(label || 'Manual revision').then((r) => { setLabel(''); notify(r ? `Saved revision (${r.newObjects} new objects)` : 'Nothing changed since the last revision'); refresh(); })}>Save revision</button></div></div>
      <ul className="list st-list">{revs.map((r) => <li key={r.id} className={onBranch.has(r.id) ? '' : 'dim'}>
        <span className="rev-dot" style={{ background: r.auto ? '#666' : '#4fd1a5' }} /> <b>{r.label}</b> <span className="dim">{new Date(r.time).toLocaleString()} · {r.branch} · {r.clips} clips · +{(r.newBytes / 1024).toFixed(1)} KB</span>
        {h.branches[r.branch] === r.id && <span className="badge">{r.branch} HEAD</span>}
        <button onClick={() => restoreRevision(r.id).then(() => notify(`Restored “${r.label}” — save to keep working from it`)).catch((e) => notify(e.message))}>Open</button>
        <button title="Start a new branch from this revision" onClick={() => { const n = `branch-${Object.keys(h.branches).length + 1}`; createBranch(n, r.id).then(refresh).catch((e) => notify(e.message)); }}>Branch</button>
      </li>)}{!revs.length && <li className="dim">No revisions yet — Save (Ctrl+S) or “Save revision”. Auto-save runs every few minutes while there are changes.</li>}</ul>
    </div>
  );
}
