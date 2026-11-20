/**
 * A right-click menu (Control-click on a Mac), as JuraCUT's bed menu: it
 * closes on a click elsewhere, Esc, scrolling, or after a choice.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuEntry = { label: string; hint?: string; act: () => void; off?: boolean } | "line";

export function ContextMenu({ x, y, entries, onClose }: { x: number; y: number; entries: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<[number, number]>([x, y]);

  // Kept inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAt([Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), Math.max(4, Math.min(y, window.innerHeight - r.height - 4))]);
  }, [x, y]);

  useEffect(() => {
    const away = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("wheel", away, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("wheel", away, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  return (
    <div ref={ref} className="bed-menu" role="menu" style={{ left: at[0], top: at[1] }} onContextMenu={(e) => e.preventDefault()}>
      {entries.map((e, i) =>
        e === "line" ? (
          <div key={i} className="bed-menu-line" role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={e.off}
            onClick={() => {
              onClose();
              e.act();
            }}
          >
            <span>{e.label}</span>
            {e.hint && <span className="bed-menu-hint">{e.hint.replace("Mod+", mod)}</span>}
          </button>
        ),
      )}
    </div>
  );
}
