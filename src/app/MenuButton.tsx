/**
 * A toolbar button that opens a small menu under itself (the same popup as
 * Settings and History). It closes on a click elsewhere, Esc, or a choice.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

interface MenuButtonProps {
  className: string;
  label: string;
  title: string;
  /** What the button shows. */
  button: ReactNode;
  /** The menu's contents; call `close` after a choice. */
  children: (close: () => void) => ReactNode;
  width?: number;
  disabled?: boolean;
}

export function MenuButton({ className, label, title, button, children, width = 260, disabled }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${className}${open ? " active" : ""}`}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
        disabled={disabled}
        title={title}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) });
          setOpen(!open);
        }}
      >
        {button}
      </button>
      {open && (
        <div ref={ref} className="settings-menu" role="dialog" aria-label={label} style={at ? { top: at.top, left: at.left, right: "auto", width } : { width }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </>
  );
}
