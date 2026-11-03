import React, { useState, useEffect } from 'react';
import { MENUS } from '../Core/menus';
import { run, getRecent } from '../Core/commands';
import { menuShortcut } from '../Core/shortcuts';

export function Item({ it, close }) {
  if (it === '-') return <div className="menu-sep" />;
  if (it.dynamic === 'recent') { const r = getRecent(); it = { label: it.label, children: r.length ? r.map((p) => ({ label: p, cmd: 'file.openRecent', arg: p })) : [{ label: '(No recent projects)', disabled: true }] }; }
  if (it.children) {
    return (
      <div className="menu-item has-sub">
        <span>{it.label}</span><span>▸</span>
        <div className="menu-dropdown sub">{it.children.map((c, i) => <Item key={i} it={c} close={close} />)}</div>
      </div>
    );
  }
  const off = it.disabled || (it.when ? !it.when() : false); const on = it.checked ? it.checked() : false;
  return (
    <div className={`menu-item ${off ? 'disabled' : ''}`} onClick={(e) => { if (off) { e.stopPropagation(); return; } close(); run(it.cmd, it.arg); }}>
      <span>{it.checked ? (on ? '✓ ' : ' ') : ''}{it.swatch && <i className="label-swatch" style={{ background: it.swatch }} />}{typeof it.label === 'function' ? it.label() : it.label}</span><span className="kbd">{menuShortcut(it)}</span>
    </div>
  );
}

export default function MenuBar({ title }) {
  const [open, setOpen] = useState(null);
  useEffect(() => {
    const off = () => setOpen(null);
    window.addEventListener('click', off);
    return () => window.removeEventListener('click', off);
  }, []);
  const es = window.editorstage;
  return (
    <div className="menubar">
      <div className="logo"><img src="logo.png" alt="EditorStage" title="EditorStage" draggable={false} /></div>
      {MENUS.map((m) => (
        <div key={m.label} className={`menu ${open === m.label ? 'open' : ''}`}
          onClick={(e) => { e.stopPropagation(); setOpen(open === m.label ? null : m.label); }}
          onMouseEnter={() => open && setOpen(m.label)}>
          {m.label}
          {open === m.label && <div className="menu-dropdown">{m.items.map((it, i) => <Item key={i} it={it} close={() => setOpen(null)} />)}</div>}
        </div>
      ))}
      <div className="title drag">{title}</div>
      <div className="brand drag" title="Help > About EditorStage">All rights reserved by BYS &amp; RB</div>
      <div className="winctl">
        <button onClick={() => es.windowControl('minimize')}>—</button>
        <button onClick={() => es.windowControl('maximize')}>☐</button>
        <button className="close" onClick={() => es.windowControl('close')}>✕</button>
      </div>
    </div>
  );
}
