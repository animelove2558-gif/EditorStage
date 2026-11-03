import React, { useRef, useState } from 'react';

// Number field (drop-in for <input type="number">). While it has focus the text the user types is kept as typed: an
// empty field (to type a new value), "-" (on the way to a negative value) or "1." never reach onChange, so a value never
// jumps to 0 halfway through typing (and no keyframe at 0 is made with the stopwatch on). A complete number is passed on
// at once, as before. Enter applies the value and leaves the field; Esc puts the value from before back; Shift+Up/Down
// step by 10 x step.
const complete = (v) => String(v).trim() !== '' && Number.isFinite(+v);

export default function NumInput({ value, onChange, onKeyDown, onFocus, onBlur, step, ...rest }) {
  const [text, setText] = useState(null); const orig = useRef(null); // value when the field got focus (Esc)
  const shown = text ?? (value == null || Number.isNaN(value) ? '' : value);
  const emit = (el, v) => onChange?.({ target: { value: String(v), valueAsNumber: +v, dataset: el.dataset, checked: el.checked }, currentTarget: el });
  return (
    <input
      type="number"
      {...rest}
      step={step}
      value={shown}
      onFocus={(e) => { orig.current = value; setText(String(value ?? '')); onFocus?.(e); }}
      onChange={(e) => { const v = e.target.value; setText(v); if (complete(v) && !e.target.validity?.badInput) onChange?.(e); }}
      onBlur={(e) => { setText(null); onBlur?.(e); }}
      onKeyDown={(e) => {
        const el = e.currentTarget;
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const o = orig.current ?? value ?? 0; setText(String(o)); if (o !== value) emit(el, o); el.blur(); }
        else if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          const k = (+step || 1) * 10 * (e.key === 'ArrowUp' ? 1 : -1);
          let n = (complete(el.value) ? +el.value : +value || 0) + k;
          if (rest.min != null && rest.min !== '') n = Math.max(+rest.min, n);
          if (rest.max != null && rest.max !== '') n = Math.min(+rest.max, n);
          n = Math.round(n * 1e6) / 1e6; setText(String(n)); emit(el, n);
        }
        onKeyDown?.(e);
      }}
    />
  );
}
