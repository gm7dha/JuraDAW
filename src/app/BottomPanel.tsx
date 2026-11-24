/**
 * What opens along the bottom, as in Logic: the note Editor, the Mixer, the
 * Automation lines or the Keys, under a row of tabs. Drag its top edge to make it taller or shorter;
 * the ✕ closes it.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";

import { useStore } from "../model/store";
import type { BottomPanel as Panel } from "../model/storeApi";
import { AutomationPanel } from "./AutomationPanel";
import { Icons } from "./icons";
import { Keys } from "./Keys";
import { Mixer } from "./Mixer";
import { PianoRoll } from "./PianoRoll";
import { panelHeight } from "./songUi";

const TABS: { panel: Exclude<Panel, null>; label: string; icon: (p: { size?: number }) => ReactElement; hint: string }[] = [
  { panel: "editor", label: "Editor", icon: Icons.Editor, hint: "See and change the notes of a clip — as notes, or as a grid of steps" },
  { panel: "mixer", label: "Mixer", icon: Icons.Mixer, hint: "Every track's volume, left–right, reverb and echo" },
  { panel: "automation", label: "Automation", icon: Icons.Automation, hint: "Draw lines that change a track's volume, filter or left–right as the song plays" },
  { panel: "keys", label: "Keys", icon: Icons.Keys, hint: "Play the selected track with on-screen keys or your typing keyboard" },
];

const HEIGHT_KEY = "juradaw.panelHeight";

/** The height the owner dragged the panel to, or null if they never have. */
function keptHeight(): number | null {
  try {
    const v = Number(localStorage.getItem(HEIGHT_KEY));
    if (Number.isFinite(v) && v >= 140) return v;
  } catch {
    // Private browsing: the usual height.
  }
  return null;
}

export function BottomPanel() {
  const panel = useStore((s) => s.bottomPanel);
  const empty = useStore((s) => s.history.present.tracks.length === 0);
  const [dragged, setDragged] = useState(keptHeight);
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight);
  const drag = useRef<{ y: number; height: number } | null>(null);
  useEffect(() => {
    const resized = () => setWindowHeight(window.innerHeight);
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);
  // An empty song shows only the welcome: there's nothing for the panel to show.
  const open = !!panel && !empty;
  const height = panelHeight(windowHeight, dragged);
  // Messages sit just above the panel (styles.css `.toasts`), so they need to know how tall it is.
  useEffect(() => {
    document.documentElement.style.setProperty("--panel-height", `${open ? height : 0}px`);
  }, [open, height]);
  if (!open) return null;
  const s = useStore.getState;
  return (
    <section className="bottom-panel" style={{ height }} aria-label="Bottom panel">
      <div
        className="panel-grip"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to change the panel's height"
        title="Drag to make this panel taller or shorter"
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, height };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current) setDragged(panelHeight(windowHeight, drag.current.height + drag.current.y - e.clientY));
        }}
        onPointerUp={() => {
          const moved = drag.current !== null && dragged !== null;
          drag.current = null;
          if (!moved) return;
          try {
            localStorage.setItem(HEIGHT_KEY, String(height));
          } catch {
            // Not kept for next time.
          }
        }}
        onPointerCancel={() => (drag.current = null)}
      />
      <div className="panel-tabs" role="tablist" aria-label="Bottom panel">
        {TABS.map((t) => (
          <button key={t.panel} type="button" role="tab" aria-selected={panel === t.panel} className={`panel-tab${panel === t.panel ? " selected" : ""}`} onClick={() => s().setBottomPanel(t.panel)} title={t.hint}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
        <span className="roll-spring" />
        <button type="button" className="icon-button small" onClick={() => s().setBottomPanel(null)} aria-label="Close the panel" title="Close this panel (the Editor, Mixer and Keys buttons in the toolbar bring it back)">
          <Icons.Cross size={16} />
        </button>
      </div>
      <div className="panel-body" role="tabpanel">
        {panel === "editor" && <PianoRoll />}
        {panel === "mixer" && <Mixer />}
        {panel === "automation" && <AutomationPanel />}
        {panel === "keys" && <Keys />}
      </div>
    </section>
  );
}
