import React, { useState, useEffect } from 'react';
import { TOOL_GROUPS, selectTool } from '../Core/tools';
import { useStore } from '../Core/store';

/** Vertical Tools panel docked at the left edge of the Timeline. Right-click / click ▸ corner opens the group flyout. */
export default function VerticalTools() {
  const tool = useStore((s) => s.tool);
  const groupTool = useStore((s) => s.groupTool);
  const [fly, setFly] = useState(null);
  useEffect(() => {
    const off = () => setFly(null);
    window.addEventListener('click', off);
    return () => window.removeEventListener('click', off);
  }, []);

  return (
    <div className="vtools">
      {TOOL_GROUPS.map((g) => {
        const cur = g.tools.find((t) => t.id === (groupTool[g.id] || g.tools[0].id));
        const multi = g.tools.length > 1;
        return (
          <div key={g.id} className="vtool-wrap">
            <button className={tool === cur.id ? 'active' : ''} title={`${cur.label}${cur.key ? ` (${cur.shift ? 'Shift+' : ''}${cur.key.toUpperCase()})` : ''}`}
              onClick={() => selectTool(cur.id)}
              onContextMenu={(e) => { e.preventDefault(); multi && setFly(g.id); }}>
              {cur.icon}{multi && <i className="corner" onClick={(e) => { e.stopPropagation(); setFly(fly === g.id ? null : g.id); }} />}
            </button>
            {fly === g.id && (
              <div className="flyout" onClick={(e) => e.stopPropagation()}>
                {g.tools.map((t) => (
                  <div key={t.id} className={`fly-item ${tool === t.id ? 'sel' : ''}`} onClick={() => { selectTool(t.id); setFly(null); }}>
                    <span>{t.icon}</span><span>{t.label}</span><span className="kbd">{t.key ? `${t.shift ? 'Shift+' : ''}${t.key.toUpperCase()}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
