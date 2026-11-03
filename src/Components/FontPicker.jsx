import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BASE_FONTS, loadFontList, isFontInstalled, supportsThai } from '../Services/fonts';

const SAMPLE = 'Aa กขค สวัสดี';
/** Searchable font menu shared by Titles, Essential Graphics (MOGRT), Captions and Replace Fonts. Every entry previews in its own face. */
export default function FontPicker({ value, onChange, placeholder = '(choose a font)', width = 200 }) {
  const [list, setList] = useState(BASE_FONTS);
  const [open, setOpen] = useState(false); const [q, setQ] = useState(''); const [thai, setThai] = useState(false); const [hi, setHi] = useState(0);
  const root = useRef(null);
  useEffect(() => { let alive = true; loadFontList().then((l) => alive && setList(l)); return () => { alive = false; }; }, []);
  useEffect(() => { if (!open) return; const off = (e) => { if (!root.current?.contains(e.target)) setOpen(false); }; window.addEventListener('mousedown', off); return () => window.removeEventListener('mousedown', off); }, [open]);
  const shown = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return list.filter((f) => (!qq || f.toLowerCase().includes(qq)) && (!thai || supportsThai(f))).slice(0, 400);
  }, [list, q, thai]);
  const missing = value && !isFontInstalled(value);
  // load first so a cached canvas is not painted with the fallback font
  const pick = (fam) => { setOpen(false); setQ(''); Promise.resolve().then(() => document.fonts.load(`40px "${fam}"`)).catch(() => {}).finally(() => onChange(fam)); };
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(shown.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter' && shown[hi]) pick(shown[hi]);
    else if (e.key === 'Escape') setOpen(false);
  };
  return (
    <div className="fontpicker" ref={root} style={{ width }}>
      <button className={`fp-btn ${missing ? 'missing' : ''}`} title={missing ? `"${value}" is not installed on this computer - a fallback font is used` : value || placeholder} onClick={() => { setOpen(!open); setHi(0); }}>
        <span style={{ fontFamily: value ? `"${value}"` : undefined }}>{missing ? '⚠ ' : ''}{value || placeholder}</span><span className="dim">▾</span>
      </button>
      {open && (
        <div className="fp-pop">
          <div className="fp-search">
            <input autoFocus placeholder="Search fonts…" value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} onKeyDown={key} />
            <label title="Only fonts that contain Thai glyphs"><input type="checkbox" checked={thai} onChange={(e) => { setThai(e.target.checked); setHi(0); }} />ไทย</label>
          </div>
          <div className="fp-list">
            {shown.map((f, i) => (
              <div key={f} className={`fp-item ${f === value ? 'sel' : ''} ${i === hi ? 'hi' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => pick(f)} title={f}>
                <span className="fp-name">{f}</span><span className="fp-sample" style={{ fontFamily: `"${f}", sans-serif` }}>{SAMPLE}</span>
              </div>
            ))}
            {!shown.length && <div className="dim fp-item">No matching fonts</div>}
          </div>
          <div className="dim fp-foot">{list.length} fonts installed</div>
        </div>
      )}
    </div>
  );
}
