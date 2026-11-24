/**
 * The whole window: top bar, toolbar, then the side panel on the left (as
 * JuraCUT's, and where Logic keeps its inspector) with the tracks beside it
 * and the bottom panel (Editor, Mixer or Keys) beneath them, plus the
 * dialogs and toasts. Also the keyboard shortcuts, keeping the song in the
 * browser, and files dropped on the window.
 */
import { useEffect } from "react";

import { browserStorage, keepProblem, readKept } from "../model/keep";
import { useStore } from "../model/store";
import { BottomPanel } from "./BottomPanel";
import { goToStart, loadSounds, startEngineApp, togglePlay, toggleRecord } from "./engineApp";
import { startRecent } from "./recentApp";
import { ExportDialog } from "./ExportDialog";
import { openFiles, openFromFile, saveToFile } from "./fileActions";
import { HelpDialog } from "./HelpDialog";
import { Icons } from "./icons";
import { useTypingKeys } from "./Keys";
import { keysState } from "./keysState";
import { LibraryDialog } from "./LibraryDialog";
import { nudgeNotes } from "./PianoRoll";
import { inPopup, inTextBox, onControl } from "./popupGuard";
import { startPrefs } from "./prefs";
import { SidePanel } from "./SidePanel";
import { toastsToShow } from "./songUi";
import { Toolbar } from "./Toolbar";
import { TopBar } from "./TopBar";
import { TracksView } from "./TracksView";
import { WhatsNewDialog } from "./WhatsNewDialog";

export function App() {
  const dialog = useStore((s) => s.dialog);
  useKeepInBrowser();
  // The count-in and metronome, as they were left on this computer (before the engine is told of them).
  useEffect(() => startPrefs(), []);
  // The typing keyboard as a piano (when it's switched on in the Keys panel): before the shortcuts, so letters play.
  useTypingKeys();
  useShortcuts();
  useFileDrop();
  // The song and the sound engine, kept in step.
  useEffect(() => startEngineApp(), []);
  // Recent songs: the song open is kept as it changes.
  useEffect(() => startRecent(), []);

  return (
    <div className="app">
      <TopBar />
      <Toolbar />
      <div className="workspace">
        <SidePanel />
        <div className="main-column">
          <TracksView />
          <BottomPanel />
        </div>
      </div>
      <ToastView />
      {dialog === "export" && <ExportDialog />}
      {dialog === "help" && <HelpDialog />}
      {dialog === "library" && <LibraryDialog />}
      {dialog === "whatsNew" && <WhatsNewDialog />}
    </div>
  );
}

/** The keyboard: the transport, tools, undo, save… (not while typing in a box or a dialog is open). */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (inTextBox(e.target)) return;
      // Save, open and undo work anywhere; the rest only on the song.
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "s") {
          e.preventDefault();
          void saveToFile(e.shiftKey);
          return;
        }
        if (k === "o") {
          e.preventDefault();
          void openFromFile();
          return;
        }
        if (k === "z") {
          e.preventDefault();
          e.shiftKey ? s.redo() : s.undo();
          return;
        }
        if (k === "y") {
          e.preventDefault();
          s.redo();
          return;
        }
      }
      if (inPopup(e.target, document)) return;
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "d") {
          e.preventDefault();
          s.duplicateSelectedClips();
        } else if (k === "a") {
          e.preventDefault();
          s.selectAll();
        } else if (k === "c") {
          e.preventDefault();
          s.copySelected();
        } else if (k === "x") {
          e.preventDefault();
          s.cutSelected();
        } else if (k === "v") {
          e.preventDefault();
          s.paste();
        }
        return;
      }
      if (e.altKey) return;
      // A slider or tick box with the focus keeps the arrows for itself, and a tick box Space and Enter too.
      // (Space does nothing on a slider, so after dragging one, Space still plays.)
      const onSlider = (e.target as HTMLInputElement | null)?.type === "range";
      if (onControl(e.target) && (((e.key === " " || e.key === "Enter") && !onSlider) || e.key.startsWith("Arrow") || e.key === "Home")) return;
      if (onSlider && e.key === " ") (e.target as HTMLElement).blur();
      // A button that has the focus shouldn't also be "clicked" by Space or Enter.
      const onButton = (e.target as HTMLElement | null)?.tagName === "BUTTON";
      switch (e.key) {
        case " ":
          e.preventDefault();
          if (onButton) (e.target as HTMLElement).blur();
          togglePlay();
          return;
        case "Home":
          e.preventDefault();
          goToStart();
          return;
        case "Enter":
          // On a toolbar or transport button Enter doesn't press it again (it was clicked a moment ago): it goes to the start, as anywhere else.
          if (onButton && !(e.target as HTMLElement).closest(".toolbar")) return;
          e.preventDefault();
          if (onButton) (e.target as HTMLElement).blur();
          goToStart();
          return;
        case "Escape":
          if (s.tool !== "select") s.setTool("select");
          else if (s.selectedNoteIds.length) s.selectNotes([]);
          else if (s.selectedClipIds.length) s.selectClips([]);
          return;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          s.removeSelected();
          return;
        case "ArrowLeft":
        case "ArrowRight":
        case "ArrowUp":
        case "ArrowDown":
          if (nudgeNotes(e.key, e.shiftKey)) e.preventDefault();
          return;
        case "?":
          s.openDialog("help");
          return;
      }
      if (e.shiftKey) return;
      const k = e.key.toLowerCase();
      // While the computer keyboard plays notes (Keys panel), single letters aren't shortcuts — as in Logic.
      if (keysState().typing) return;
      if (k === "r") toggleRecord();
      else if (k === "l") s.setLoop({ on: !s.history.present.loop.on });
      else if (k === "k") s.setMetronome(!s.metronome);
      else if (k === "v") s.setTool("select");
      else if (k === "p") s.setTool("pencil");
      else if (k === "e") s.setTool("eraser");
      else if (k === "c") s.setTool("scissors");
      else if (k === "f") s.requestFit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** The song kept in this browser: brought back on load, written after every change. */
function useKeepInBrowser() {
  useEffect(() => {
    const s = useStore.getState();
    const storage = browserStorage();
    const kept = readKept(storage);
    if (kept && (kept.tracks.length || kept.name !== s.history.present.name)) {
      // Straight in, with no undo step (there's nothing before it).
      useStore.setState({ history: { past: [], present: kept, future: [] } });
      void loadSounds(kept);
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useStore.subscribe((state, prev) => {
      if (state.history.present === prev.history.present) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        useStore.getState().setStorageProblem(keepProblem(storage, useStore.getState().history.present));
      }, 400);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);
}

/** Files dragged onto the window: .juradaw songs open, sound files and MIDI files come in as clips and tracks. */
function useFileDrop() {
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    };
    const drop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      void openFiles(files);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
}

/** How long a toast stays before it goes by itself (errors stay longer). */
const TOAST_MS = { info: 6000, success: 5000, error: 10000 } as const;

/**
 * Messages sit at the bottom of the tracks, just above the bottom panel, so they're never over the keys, the mixer
 * or the note editor; clicks go straight through them (only the ✕ takes a click). With a dialog open they're at the
 * bottom of the window, as JuraCUT's.
 */
function ToastView() {
  const toasts = useStore((s) => s.toasts);
  const dialogOpen = useStore((s) => s.dialog !== null && s.dialog !== "settings");
  const dismiss = useStore((s) => s.dismissToast);
  // Each toast goes away by itself after a while (its own timer, started when it first shows).
  useEffect(() => {
    for (const t of toasts) {
      if (toastTimers.has(t.id)) continue;
      toastTimers.add(t.id);
      setTimeout(() => {
        toastTimers.delete(t.id);
        useStore.getState().dismissToast(t.id);
      }, TOAST_MS[t.kind]);
    }
  }, [toasts]);
  const shown = toastsToShow(toasts);
  if (!shown.length) return null;
  return (
    <div className={`toasts${dialogOpen ? " over-dialog" : ""}`}>
      {shown.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
          {t.text}
          <button className="icon-button small" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <Icons.Cross size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** The toasts that already have a timer running. */
const toastTimers = new Set<number>();
