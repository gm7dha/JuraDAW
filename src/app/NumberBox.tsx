/**
 * A box for typing a number, as JuraCUT's: what's typed is kept as text until
 * Enter or the box is left, then checked; Escape puts the old value back.
 */
import { useEffect, useState } from "react";

export function NumberBox({ label, value, unit, min, max, step, title, onCommit }: { label: string; value: number; unit?: string; min?: number; max?: number; step?: number; title?: string; onCommit: (v: number) => void }) {
  const shown = String(Math.round(value * 1000) / 1000);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);
  const fit = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commit = () => {
    setEditing(false);
    const v = Number(text.replace(",", "."));
    if (!Number.isFinite(v)) return setText(shown);
    const clamped = fit(v);
    if (clamped !== value) onCommit(clamped);
    else setText(shown);
  };
  return (
    <label className="field" title={title}>
      <span>{label}</span>
      <span className="field-input">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          onFocus={() => setEditing(true)}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setText(shown);
              setEditing(false);
              (e.target as HTMLInputElement).blur();
            }
            // Up and down arrows step the number, as in a number box.
            if (step && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
              e.preventDefault();
              const v = Number(text.replace(",", "."));
              if (Number.isFinite(v)) setText(String(Math.round(fit(v + (e.key === "ArrowUp" ? step : -step)) * 1000) / 1000));
            }
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </span>
    </label>
  );
}
