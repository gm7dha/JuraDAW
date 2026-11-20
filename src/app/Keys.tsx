/**
 * The Keys panel: an on-screen piano (or drum pads for a drum track) that
 * plays the selected instrument track — with the mouse, several fingers on a
 * touch screen (slide across the keys for a glissando), or the computer's
 * keyboard as in Logic's Musical Typing (A W S E D F T G Y H U J K, with Z
 * and X for the octave) once "Play with the computer keyboard" is on.
 */
import { useEffect, useMemo, useRef } from "react";

import { instrumentById } from "../audio/instruments";
import { useStore } from "../model/store";
import { DRUM_PITCHES, isBlackKey, pitchName } from "../model/time";
import { connectMidi, liveNoteOff, liveNoteOn, playTrack, useHeldNotes, useMidi } from "./engineApp";
import { Icons } from "./icons";
import { inPopup, inTextBox } from "./popupGuard";
import { keysState, letterFor, setKeysState, typedPitch, useKeysState } from "./keysState";

/** The drum pads' letters when the typing keyboard plays: the same keys as the piano's, in the kit's order. */
const PAD_LETTERS = ["a", "s", "d", "f", "g", "h", "j", "k", "w", "e", "t", "y", "u", "o", "p", "l"];

/** The pitch a typed key plays on the track the keys play (drum pads have their own letters). */
function pitchForKey(key: string): number | null {
  const track = playTrack();
  if (!track) return typedPitch(key, keysState().octave);
  if (instrumentById(track.instrument).kind === "drums") {
    const i = PAD_LETTERS.indexOf(key.toLowerCase());
    return i >= 0 && i < DRUM_PITCHES.length ? DRUM_PITCHES[i].pitch : null;
  }
  return typedPitch(key, keysState().octave);
}

/**
 * The typing keyboard as an instrument, whether or not the Keys panel is open:
 * call once from App. While "Play with the computer keyboard" is on, the
 * letters play notes (and so don't pick tools); Z and X change the octave.
 */
export function useTypingKeys(): void {
  useEffect(() => {
    /** The pitch each held key started (so the right note stops even if the octave changed meanwhile). */
    const down = new Map<string, number>();
    const onDown = (e: KeyboardEvent) => {
      if (!keysState().typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (inTextBox(e.target) || inPopup(e.target, document)) return;
      const key = e.key.toLowerCase();
      if (key === "z" || key === "x") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) setKeysState({ octave: keysState().octave + (key === "x" ? 1 : -1) });
        return;
      }
      const pitch = pitchForKey(key);
      if (pitch === null) return;
      // The letter is a note now, not a shortcut.
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat || down.has(key)) return;
      if (liveNoteOn(pitch, 100)) down.set(key, pitch);
      else useStore.getState().toast("Select an instrument track (or add one) to play it with the keyboard.", "info");
    };
    const onUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const pitch = down.get(key);
      if (pitch === undefined) return;
      down.delete(key);
      liveNoteOff(pitch);
    };
    const allUp = () => {
      for (const pitch of down.values()) liveNoteOff(pitch);
      down.clear();
    };
    // Capture, so these come before the app's tool shortcuts.
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", allUp);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", allUp);
      allUp();
    };
  }, []);
}

/** Plays whatever key or pad is under each pointer: press, slide across (glissando), several fingers at once. */
function usePointerNotes() {
  /** pointer id → the pitch it's holding. */
  const pointers = useRef(new Map<number, number>());
  const pitchAt = (x: number, y: number): number | null => {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-pitch]");
    return el ? Number(el.dataset.pitch) : null;
  };
  const release = (id: number) => {
    const pitch = pointers.current.get(id);
    if (pitch === undefined) return;
    pointers.current.delete(id);
    if (![...pointers.current.values()].includes(pitch)) liveNoteOff(pitch);
  };
  useEffect(() => {
    const held = pointers.current;
    return () => {
      for (const pitch of held.values()) liveNoteOff(pitch);
      held.clear();
    };
  }, []);
  return {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const pitch = pitchAt(e.clientX, e.clientY);
      if (pitch === null) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      // Lower on the key is louder, as on a real one.
      const r = (e.target as HTMLElement).getBoundingClientRect();
      const velocity = Math.round(70 + 50 * Math.max(0, Math.min(1, (e.clientY - r.top) / Math.max(1, r.height))));
      if (liveNoteOn(pitch, velocity)) pointers.current.set(e.pointerId, pitch);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const was = pointers.current.get(e.pointerId);
      if (was === undefined) return;
      const pitch = pitchAt(e.clientX, e.clientY);
      if (pitch === null || pitch === was) return;
      release(e.pointerId);
      if (liveNoteOn(pitch, 95)) pointers.current.set(e.pointerId, pitch);
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => release(e.pointerId),
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => release(e.pointerId),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}

/** "Connect a MIDI keyboard": asked for with a button, so the browser's permission question never comes out of nowhere. */
export function MidiButton({ wide = false }: { wide?: boolean }) {
  const { state, names } = useMidi();
  const connected = state === "connected";
  return (
    <button
      type="button"
      className={`text-button small-button midi-button${connected ? " active" : ""}${wide ? " wide-button" : ""}`}
      onClick={() => void connectMidi()}
      disabled={state === "asked"}
      title={
        connected
          ? `Connected: ${names}. It plays the selected instrument track. Click to look for keyboards again`
          : "A plug-in piano keyboard (MIDI): plug it in, then click here. Your browser may ask to use MIDI devices: choose Allow. It then plays the selected instrument track. (Chrome and Edge can do this; Safari can't.)"
      }
    >
      <Icons.Keys size={16} /> {connected ? `MIDI keyboard: ${names}` : state === "asked" ? "Looking for a MIDI keyboard…" : "Connect a MIDI keyboard"}
    </button>
  );
}

export function Keys() {
  const song = useStore((s) => s.history.present);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const recording = useStore((s) => s.recording);
  const { typing, octave } = useKeysState();
  const heldKey = useHeldNotes();
  const held = useMemo(() => new Set(heldKey ? heldKey.split(",").map(Number) : []), [heldKey]);
  const track = playTrack(song, selectedTrackId);
  const handlers = usePointerNotes();
  const drums = !!track && instrumentById(track.instrument).kind === "drums";

  // Three octaves from the one below the typing octave (so the lettered keys sit in the middle), plus the top C.
  const low = Math.max(0, Math.min(8 * 12, (octave + 1) * 12 - 12));
  const pitches = useMemo(() => Array.from({ length: 37 }, (_, i) => low + i).filter((p) => p <= 127), [low]);
  const whites = pitches.filter((p) => !isBlackKey(p));

  if (!track) {
    return (
      <div className="panel-empty">
        <Icons.Keys size={30} />
        <p>
          <b>{song.tracks.length ? "Select an instrument track to play it here." : "Add an instrument and play it here."}</b>
        </p>
        <p className="muted small">{song.tracks.length ? "Sound tracks are for recordings; the keys play instrument and drum tracks." : "Use Add track in the toolbar: a piano, strings, a bass, a drum kit…"}</p>
      </div>
    );
  }

  return (
    <div className="keys-panel" style={{ ["--track" as string]: track.colour }}>
      <div className="keys-bar">
        <span className="roll-title">
          <span className="track-dot" style={{ background: track.colour }} />
          <b>{track.name}</b>
          <span className="muted small"> · {instrumentById(track.instrument).name}</span>
          {recording && <span className="recording-now"> · Recording: play the keys. Press Space to stop.</span>}
        </span>
        <span className="roll-spring" />
        {!recording && <MidiButton />}
        <label className={`typing-toggle${typing ? " on" : ""}`} title="On: the letter keys play notes (A W S E D F T G Y H U J K; Z and X change the octave). Off: V, P, E and C pick tools">
          <input
            type="checkbox"
            checked={typing}
            onChange={(e) => {
              setKeysState({ typing: e.target.checked });
              // So the letters go to the keys straight away, not to the tick box.
              e.target.blur();
            }}
          />
          Play with the computer keyboard
        </label>
        {!drums && (
          <span className="button-run" role="group" aria-label="Octave">
            <button type="button" className="text-button small-button" onClick={() => setKeysState({ octave: octave - 1 })} disabled={octave <= 0} title="Lower: an octave down (Z when playing with the computer keyboard)" aria-label="Octave down">
              − Octave
            </button>
            <span className="octave-now" title="The octave the lettered keys play (C4 is middle C)">
              C{octave}
            </span>
            <button type="button" className="text-button small-button" onClick={() => setKeysState({ octave: octave + 1 })} disabled={octave >= 7} title="Higher: an octave up (X when playing with the computer keyboard)" aria-label="Octave up">
              Octave +
            </button>
          </span>
        )}
      </div>
      {drums ? (
        <div className="pads" {...handlers} role="group" aria-label="Drum pads">
          {DRUM_PITCHES.map((d, i) => (
            <div key={d.pitch} role="button" aria-label={d.name} className={`pad${held.has(d.pitch) ? " down" : ""}`} data-pitch={d.pitch}>
              <span className="pad-name">{d.name}</span>
              {typing && PAD_LETTERS[i] && <kbd>{PAD_LETTERS[i].toUpperCase()}</kbd>}
            </div>
          ))}
        </div>
      ) : (
        <div className="piano-wrap">
          <div className="piano" {...handlers} role="group" aria-label="Piano keys" style={{ ["--whites" as string]: whites.length }}>
            {whites.map((p) => (
              <div key={p} role="button" aria-label={pitchName(p)} className={`piano-key white${held.has(p) ? " down" : ""}`} data-pitch={p}>
                {typing && letterFor(p, octave) && <kbd>{letterFor(p, octave)}</kbd>}
                {p % 12 === 0 && <span className="piano-c">{pitchName(p)}</span>}
              </div>
            ))}
            {pitches
              .filter((p) => isBlackKey(p))
              .map((p) => {
                // A black key sits over the join after the white key below it.
                const before = whites.filter((w) => w < p).length;
                return (
                  <div key={p} role="button" aria-label={pitchName(p)} className={`piano-key black${held.has(p) ? " down" : ""}`} data-pitch={p} style={{ left: `calc(${before} * (100% / var(--whites)) - (100% / var(--whites)) * 0.31)` }}>
                    {typing && letterFor(p, octave) && <kbd>{letterFor(p, octave)}</kbd>}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
