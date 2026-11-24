/**
 * The top bar's Recent button (JuraCUT's): the songs worked on in this browser, newest first, each with a small
 * picture of its tracks — click one to open it (the one open is kept first), × to forget it.
 */
import { useEffect, useRef, useState } from "react";

import type { RecentMeta } from "../model/recent";
import { Icons } from "./icons";
import { forgetRecent, isCurrent, keepNow, listRecent, onRecentChange, openRecentSong } from "./recentApp";

function ago(at: number): string {
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return d < 14 ? `${d} day${d === 1 ? "" : "s"} ago` : new Date(at).toLocaleDateString();
}

export function RecentMenu() {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<RecentMeta[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const load = () => void listRecent().then(setList).catch(() => setList([]));
    void keepNow().then(load);
    const off = onRecentChange(load);
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.(".recent-button")) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      off();
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <>
      <button className={`text-button recent-button${open ? " active" : ""}`} aria-expanded={open} aria-label="Recent songs" onClick={() => setOpen(!open)} title="The songs you've worked on in this browser: open one again">
        <Icons.Recent size={18} /> <span className="button-label">Recent</span>
      </button>
      {open && (
        <div ref={ref} className="settings-menu recent-menu" role="dialog" aria-label="Recent songs">
          <div className="field-label" style={{ marginTop: 0 }}>
            Recent songs
          </div>
          {list.length === 0 ? (
            <p className="dialog-hint">Nothing yet. Songs you work on are kept here (in this browser), so starting a new one never loses the last.</p>
          ) : (
            <ul className="recent-list">
              {list.map((m) => (
                <li key={m.id} className={isCurrent(m.id) ? "current" : ""}>
                  <button
                    type="button"
                    className="recent-open"
                    onClick={() => {
                      setOpen(false);
                      void openRecentSong(m.id);
                    }}
                    title={isCurrent(m.id) ? "The song open now" : `Open "${m.name}"`}
                  >
                    <span className="recent-thumb" dangerouslySetInnerHTML={{ __html: m.thumb }} />
                    <span className="recent-text">
                      <strong>{m.name}</strong>
                      <span className="muted small">
                        {isCurrent(m.id) ? "Open now" : ago(m.at)} · {m.tracks} {m.tracks === 1 ? "track" : "tracks"} · {m.bars} {m.bars === 1 ? "bar" : "bars"}
                      </span>
                    </span>
                  </button>
                  {!isCurrent(m.id) && (
                    <button type="button" className="icon-button small" aria-label={`Forget "${m.name}"`} title="Forget this one" onClick={() => void forgetRecent(m.id)}>
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="dialog-hint">Kept in this browser only. Use Save to keep a song (and its recordings) as a file.</p>
        </div>
      )}
    </>
  );
}
