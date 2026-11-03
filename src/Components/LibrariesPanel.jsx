import React, { useState } from 'react';
import { useStore, getState } from '../Core/store';
import { importPaths, mediaById } from '../Services/media';
import { addMediaToTimeline } from '../Core/commands';
import { addGraphic } from '../Services/graphics';

// Libraries (offline): a personal collection shared by every project on this computer - media files, titles/shapes
// and colours. Stored in the app's local storage; nothing leaves the machine.
const KEY = 'es-library';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const save = (items) => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage unavailable */ } };
const uid = () => Math.random().toString(36).slice(2, 9);
const ICON = { media: '🎞', graphic: '🅣', color: '■' };

export default function LibrariesPanel() {
  const [items, setItems] = useState(load);
  const [q, setQ] = useState(''); const [msg, setMsg] = useState('');
  const sel = useStore((s) => s.selection); const selMedia = useStore((s) => s.selectedMedia); const seq = useStore((s) => s.sequence);
  const put = (next) => { setItems(next); save(next); };
  const addItems = (list) => { const known = new Set(items.map((x) => x.key)); const fresh = list.filter((x) => !known.has(x.key)); put([...items, ...fresh]); setMsg(fresh.length ? `Added ${fresh.length} item(s)` : 'Already in the library'); };
  const addProjectItem = () => { const m = mediaById(selMedia); if (!m || !m.path) return setMsg('Select a media item in the Project panel'); addItems([{ id: uid(), type: 'media', key: `media:${m.path.toLowerCase()}`, name: m.name, path: m.path, kind: m.kind }]); };
  const addGraphics = () => { const gs = seq.clips.filter((c) => sel.includes(c.id) && c.graphic); if (!gs.length) return setMsg('Select a title or shape clip in the Timeline'); addItems(gs.map((c) => ({ id: uid(), type: 'graphic', key: `graphic:${JSON.stringify(c.graphic)}`, name: c.graphic.text ? `${c.graphic.text}`.slice(0, 40) : c.name, graphic: c.graphic }))); };
  const addColor = (hex) => addItems([{ id: uid(), type: 'color', key: `color:${hex}`, name: hex, color: hex }]);
  const use = async (it) => {
    const s = getState();
    if (it.type === 'graphic') { addGraphic(it.graphic.type, s.playhead, it.graphic); return setMsg(`Added "${it.name}" at the playhead`); }
    if (it.type === 'color') { try { await navigator.clipboard.writeText(it.color); setMsg(`${it.color} copied`); } catch { setMsg(it.color); } return; }
    let m = s.media.find((x) => !x.subclip && x.path && x.path.toLowerCase() === it.path.toLowerCase());
    if (!m) { if (!(await window.editorstage.exists(it.path))) return setMsg(`File not found: ${it.path}`); [m] = await importPaths([it.path]); }
    if (m) { addMediaToTimeline(mediaById(m.id), getState().playhead); setMsg(`Added ${m.name} at the playhead`); }
  };
  const shown = items.filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="panel-pad">
      <div className="param">
        <input placeholder="Search library" value={q} onChange={(e) => setQ(e.target.value)} />
        <button title="Add the selected Project item" onClick={addProjectItem}>+ Media</button>
        <button title="Add the selected title / shape clips" onClick={addGraphics}>+ Graphic</button>
        <label title="Add a colour swatch" className="lib-color">+ <input type="color" onChange={(e) => addColor(e.target.value)} /></label>
      </div>
      {msg && <div className="dim note">{msg}</div>}
      {!items.length && <div className="dim">Your library is empty. Save media, titles and colours here to reuse them in any project. Double-click an item to use it.</div>}
      <ul className="list">
        {shown.map((it) => (
          <li key={it.id} title={it.path || it.name} onDoubleClick={() => use(it)}>
            <span style={it.type === 'color' ? { color: it.color } : undefined}>{ICON[it.type]}</span> {it.name} <span className="dim">{it.type === 'media' ? it.kind : it.type}</span>
            <button className="lib-del" title="Remove from library" onClick={(e) => { e.stopPropagation(); put(items.filter((x) => x.id !== it.id)); }}>✕</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
