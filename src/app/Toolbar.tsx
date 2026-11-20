/**
 * The toolbar: the tools on the left, undo, then the transport (go to start,
 * play, record, loop, metronome) and the display in the middle, as in Logic's
 * control bar, then snap, Add track, the Library and what shows along the
 * bottom.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";

import { useStore } from "../model/store";
import type { BottomPanel, Tool } from "../model/storeApi";
import { MAX_BPM, MIN_BPM } from "../model/types";
import { addTrackOf, NEW_TRACKS } from "./addTracks";
import { everyFrame, goToStart, playheadBeat, togglePlay, toggleRecord } from "./engineApp";
import { HistoryMenu } from "./HistoryMenu";
import { Icons } from "./icons";
import { setKeysState, useKeysState } from "./keysState";
import { MenuButton } from "./MenuButton";
import { detectPlatform, shortcut } from "./platform";
import { barBeat, clockText, SNAP_CHOICES, snapLabel } from "./songUi";

const TOOLS: { tool: Tool; label: string; key: string; icon: (p: { size?: number }) => ReactElement; hint: string }[] = [
  { tool: "select", label: "Select", key: "V", icon: Icons.Select, hint: "Click a clip or note to select it, drag to move it, drag its edge to change its length, drag on an empty part to select several" },
  { tool: "pencil", label: "Pencil", key: "P", icon: Icons.Pencil, hint: "Drag on an instrument track to draw a new clip; click in the editor to draw notes" },
  { tool: "eraser", label: "Eraser", key: "E", icon: Icons.Eraser, hint: "Click a clip or a note to remove it" },
  { tool: "scissors", label: "Scissors", key: "C", icon: Icons.Scissors, hint: "Click a clip to split it in two there" },
];

const PANELS: { panel: Exclude<BottomPanel, null>; label: string; icon: (p: { size?: number }) => ReactElement; hint: string }[] = [
  { panel: "editor", label: "Editor", icon: Icons.Editor, hint: "The note editor (piano roll): see and change the notes of a clip. Double-clicking a clip opens it here" },
  { panel: "mixer", label: "Mixer", icon: Icons.Mixer, hint: "The mixer: every track's volume, left–right, reverb and echo side by side" },
  { panel: "keys", label: "Keys", icon: Icons.Keys, hint: "On-screen keys (or drum pads) to play the selected track, also from your typing keyboard" },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const undoable = useStore((s) => s.history.past.length > 0);
  const redoable = useStore((s) => s.history.future.length > 0);
  const bottomPanel = useStore((s) => s.bottomPanel);
  const snap = useStore((s) => s.snap);
  const platform = detectPlatform();
  const { typing } = useKeysState();
  const s = useStore.getState;

  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      <div className="tool-group">
        {TOOLS.map((t) => (
          <button key={t.tool} type="button" className={`tool-button${tool === t.tool ? " active" : ""}`} onClick={() => setTool(t.tool)} title={`${t.label}: ${t.hint} (${t.key}${typing ? " — off while the computer keyboard plays notes" : ""})`} aria-label={t.label} aria-pressed={tool === t.tool}>
            <t.icon size={20} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      {typing && (
        <button
          type="button"
          className="typing-pill"
          onClick={() => setKeysState({ typing: false })}
          aria-label="The computer keyboard is playing notes. Click to turn that off"
          title="“Play with the computer keyboard” is on, so the letter keys play notes instead of picking tools (V, P, E, C), Record (R), Loop (L), Metronome (K) and Fit (F). Click to turn it off"
        >
          <Icons.Keys size={16} />
          <span className="typing-pill-long">Letters play notes · turn off</span>
          <span className="typing-pill-short">Notes on</span>
        </button>
      )}
      <div className="tool-divider" />
      <div className="tool-group">
        <button type="button" className="tool-button icon-only" aria-label="Undo" onClick={() => s().undo()} disabled={!undoable} title={`Undo (${shortcut(platform, "Z")})`}>
          <Icons.Undo size={20} />
          <span>Undo</span>
        </button>
        <button type="button" className="tool-button icon-only" aria-label="Redo" onClick={() => s().redo()} disabled={!redoable} title={`Redo (${shortcut(platform, "Y")})`}>
          <Icons.Redo size={20} />
          <span>Redo</span>
        </button>
        <HistoryMenu />
      </div>
      <div className="toolbar-spring" />
      <Transport />
      <Display />
      <div className="toolbar-spring" />
      <div className="tool-group">
        <MenuButton
          className="tool-button"
          label={`Snap: ${snapLabel(snap)}`}
          title="Snap: what clips and notes line up with as you move them (hold Shift while dragging for no snapping)"
          width={250}
          button={
            <>
              <Icons.Snap size={20} />
              <span>Snap: {snapLabel(snap)}</span>
            </>
          }
        >
          {(close) => (
            <>
              <div className="field-label">Snap to</div>
              {SNAP_CHOICES.map((c) => (
                <button
                  key={String(c.snap)}
                  type="button"
                  className={`menu-row${snap === c.snap ? " selected" : ""}`}
                  role="menuitemradio"
                  aria-checked={snap === c.snap}
                  onClick={() => {
                    s().setSnap(c.snap);
                    close();
                  }}
                >
                  <span className="menu-row-tick">{snap === c.snap && <Icons.Tick size={14} />}</span>
                  <b>{c.name}</b>
                  <span className="muted small">{c.hint}</span>
                </button>
              ))}
            </>
          )}
        </MenuButton>
        <MenuButton
          className="tool-button"
          label="Add track"
          title="Add a track: an instrument, a drum kit, or a track for recorded sound"
          width={300}
          button={
            <>
              <Icons.AddTrack size={20} />
              <span>Add track</span>
            </>
          }
        >
          {(close) => (
            <>
              <div className="field-label">Add a track</div>
              {NEW_TRACKS.map((t) => (
                <button
                  key={t.kind}
                  type="button"
                  className="menu-choice"
                  onClick={() => {
                    addTrackOf(t.kind);
                    close();
                  }}
                >
                  <b>{t.title}</b>
                  <span className="muted small">{t.text}</span>
                </button>
              ))}
            </>
          )}
        </MenuButton>
        <button type="button" className="tool-button" onClick={() => s().openDialog("library")} title="Library: ready-made drum beats, bass lines, chords and tunes to drop into the song" aria-label="Library">
          <Icons.Library size={20} />
          <span>Library</span>
        </button>
      </div>
      <div className="tool-divider" />
      <div className="tool-group">
        {PANELS.map((p) => (
          <button
            key={p.panel}
            type="button"
            className={`tool-button${bottomPanel === p.panel ? " active" : ""}`}
            aria-label={p.label}
            aria-pressed={bottomPanel === p.panel}
            onClick={() => s().setBottomPanel(bottomPanel === p.panel ? null : p.panel)}
            title={p.hint}
          >
            <p.icon size={20} />
            <span>{p.label}</span>
          </button>
        ))}
        <button type="button" className="tool-button" onClick={() => s().requestFit()} title="Zoom so the whole song fits (F)" aria-label="Fit">
          <Icons.Fit size={20} />
          <span>Fit</span>
        </button>
      </div>
    </div>
  );
}

/** Go to start, Play / Stop, Record, Loop, Metronome. */
function Transport() {
  const playing = useStore((s) => s.playing);
  const recording = useStore((s) => s.recording);
  const countingIn = useStore((s) => s.countingIn);
  const loopOn = useStore((s) => s.history.present.loop.on);
  const metronome = useStore((s) => s.metronome);
  const s = useStore.getState;
  const busy = playing || recording || countingIn;
  return (
    <div className="transport" role="group" aria-label="Transport">
      <button type="button" className="transport-button" onClick={goToStart} aria-label="Go to start" title="Go to the start of the song (Home or Enter)">
        <Icons.ToStart size={20} />
      </button>
      <button type="button" className={`transport-button play${busy ? " on" : ""}`} onClick={togglePlay} aria-label={busy ? "Stop" : "Play"} aria-pressed={busy} title={busy ? "Stop (Space)" : "Play from the play position (Space)"}>
        {busy ? <Icons.Stop size={22} /> : <Icons.Play size={22} />}
      </button>
      <button
        type="button"
        className={`transport-button record${recording ? " on" : ""}${countingIn ? " counting" : ""}`}
        onClick={toggleRecord}
        aria-label={recording || countingIn ? "Stop recording" : "Record"}
        aria-pressed={recording || countingIn}
        title={recording || countingIn ? "Stop recording (R or Space)" : "Record onto the selected track: the notes you play on an instrument track, the microphone on a sound track (R)"}
      >
        <Icons.Record size={20} />
      </button>
      <button type="button" className={`transport-button loop${loopOn ? " on" : ""}`} onClick={() => s().setLoop({ on: !loopOn })} aria-label="Loop" aria-pressed={loopOn} title="Loop: keep repeating the part under the yellow strip in the ruler (L). Drag across the strip to choose the part">
        <Icons.Loop size={20} />
      </button>
      <button type="button" className={`transport-button${metronome ? " on" : ""}`} onClick={() => s().setMetronome(!metronome)} aria-label="Metronome" aria-pressed={metronome} title="Metronome: a click on every beat while playing and recording (K)">
        <Icons.Metronome size={20} />
      </button>
    </div>
  );
}

/** The display in the middle, as Logic's: where the playhead is (bar and beat, and time), the tempo and the time signature. */
function Display() {
  const bpm = useStore((s) => s.history.present.bpm);
  const beatsPerBar = useStore((s) => s.history.present.beatsPerBar);
  const recording = useStore((s) => s.recording);
  const countingIn = useStore((s) => s.countingIn);
  const position = useRef<HTMLSpanElement>(null);
  const time = useRef<HTMLSpanElement>(null);

  // The position and time are written straight into the page every frame (not through React).
  useEffect(() => {
    let last = "";
    return everyFrame(() => {
      const song = useStore.getState().history.present;
      const beat = playheadBeat();
      const text = barBeat(beat, song.beatsPerBar).text;
      if (text !== last && position.current) {
        last = text;
        position.current.textContent = text;
      }
      const clock = clockText((beat * 60) / song.bpm);
      if (time.current && time.current.textContent !== clock) time.current.textContent = clock;
    });
  }, []);

  return (
    <div className={`display${recording ? " recording" : ""}${countingIn ? " counting" : ""}`} role="group" aria-label="Position, tempo and time signature">
      <div className="display-cell wide" title="Where the playhead is: bar and beat. Click the ruler above the tracks to move it">
        <span className="display-value big" ref={position}>
          1.1
        </span>
        {/* While recording, how to stop is said here (beside the red display), not in a message over the keys. */}
        <span className="display-label">{countingIn ? "count-in…" : recording ? "Space stops" : "bar . beat"}</span>
      </div>
      <div className="display-cell time-cell" title="Where the playhead is, in minutes and seconds">
        <span className="display-value" ref={time}>
          0:00.0
        </span>
        <span className="display-label">time</span>
      </div>
      <Tempo bpm={bpm} />
      <SignatureBox beatsPerBar={beatsPerBar} />
    </div>
  );
}

/** The tempo: click to type a new one, or drag up and down. */
function Tempo({ bpm }: { bpm: number }) {
  const [text, setText] = useState<string | null>(null);
  const drag = useRef<{ y: number; bpm: number; moved: boolean } | null>(null);
  const fit = (v: number) => Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(v)));
  if (text !== null) {
    const done = (keep: boolean) => {
      const v = Number(text.replace(",", "."));
      if (keep && Number.isFinite(v) && v > 0) {
        if (fit(v) !== bpm) useStore.getState().setBpm(fit(v));
        // Said, rather than quietly changing what was typed.
        if (v > MAX_BPM) useStore.getState().toast(`${MAX_BPM} is the fastest a song can go, so the tempo is ${MAX_BPM}.`, "info");
        else if (v < MIN_BPM) useStore.getState().toast(`${MIN_BPM} is the slowest a song can go, so the tempo is ${MIN_BPM}.`, "info");
      }
      setText(null);
    };
    return (
      <div className="display-cell">
        <input
          className="display-input"
          autoFocus
          inputMode="decimal"
          aria-label="Tempo in beats per minute"
          value={text}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => done(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") done(true);
            if (e.key === "Escape") done(false);
          }}
        />
        <span className="display-label">tempo</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="display-cell display-button"
      aria-label={`Tempo: ${bpm} beats per minute. Click to change`}
      title="Tempo: how fast the song goes, in beats per minute. Click to type a new one, or drag up and down"
      onPointerDown={(e) => {
        drag.current = { y: e.clientY, bpm, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const by = Math.round((d.y - e.clientY) / 3);
        if (!d.moved && Math.abs(d.y - e.clientY) < 4) return;
        const s = useStore.getState();
        if (!d.moved) {
          d.moved = true;
          s.dragStart();
        }
        const song = s.history.present;
        const next = fit(d.bpm + by);
        if (next !== song.bpm) s.dragUpdate({ ...song, bpm: next });
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d?.moved) useStore.getState().dragEnd();
        else if (d) setText(String(bpm));
      }}
      onPointerCancel={() => {
        if (drag.current?.moved) useStore.getState().dragEnd();
        drag.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          setText(String(bpm));
        }
      }}
    >
      <span className="display-value">{Math.round(bpm * 10) / 10}</span>
      <span className="display-label">tempo</span>
    </button>
  );
}

/** The time signature: a small drop-down. */
function SignatureBox({ beatsPerBar }: { beatsPerBar: number }) {
  return (
    <label className="display-cell display-button" title="Time signature: how many beats are in each bar (4/4 is the usual)">
      <select className="display-select" value={beatsPerBar} aria-label="Beats in a bar" onChange={(e) => useStore.getState().setBeatsPerBar(Number(e.target.value))}>
        {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
          <option key={n} value={n}>
            {n}/4
          </option>
        ))}
      </select>
      <span className="display-label">beats</span>
    </label>
  );
}
