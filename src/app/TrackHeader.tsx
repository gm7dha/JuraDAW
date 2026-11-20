/**
 * A track's header at the left of the tracks view: colour stripe, the
 * instrument's icon, the name (double-click to rename), Mute and Solo, a
 * small volume slider and a level meter.
 */
import { memo, useEffect, useRef, useState } from "react";

import { INSTRUMENTS } from "../audio/instruments";
import { useStore } from "../model/store";
import type { Track } from "../model/types";
import { everyFrame, levelOf } from "./engineApp";
import { Icons, MarkupIcon } from "./icons";
import { Slider } from "./Slider";
import { withTrack } from "./songUi";

/** The picture for a track: its instrument's drawing, or a waveform for a sound track. */
export function TrackIcon({ track, size = 22 }: { track: Track; size?: number }) {
  if (track.kind === "audio") return <Icons.Mic size={size} />;
  const instrument = INSTRUMENTS.find((i) => i.id === track.instrument);
  return instrument ? <MarkupIcon markup={instrument.icon} size={size} /> : <Icons.Note size={size} />;
}

/** A level meter: its bar is moved every frame straight from the engine. */
export function Meter({ id, vertical = true, className = "" }: { id: string; vertical?: boolean; className?: string }) {
  const bar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let shown = 0;
    return everyFrame(() => {
      // Falls back gently, so short peaks can be seen.
      const level = Math.min(1, Math.max(0, levelOf(id)));
      const next = level >= shown ? level : Math.max(level, shown - 0.03);
      if (Math.abs(next - shown) < 0.002 && !(next === 0 && shown !== 0)) return;
      shown = next;
      // The engine's level is already on a decibel scale (quiet sounds show too), so it's drawn as it comes.
      if (bar.current) bar.current.style.transform = vertical ? `scaleY(${shown})` : `scaleX(${shown})`;
    });
  }, [id, vertical]);
  return (
    <span className={`meter${vertical ? " vertical" : ""} ${className}`} aria-hidden="true">
      <span className="meter-bar" ref={bar} style={{ transform: vertical ? "scaleY(0)" : "scaleX(0)" }} />
    </span>
  );
}

/** A name that turns into a text box on double-click (or when asked from a menu). */
export function EditableName({ value, onRename, editing, setEditing, label }: { value: string; onRename: (name: string) => void; editing: boolean; setEditing: (on: boolean) => void; label: string }) {
  const [text, setText] = useState(value);
  useEffect(() => {
    if (editing) setText(value);
  }, [editing, value]);
  if (!editing) {
    return (
      <span className="track-name" title={`${value} — double-click to rename`} onDoubleClick={() => setEditing(true)}>
        {value}
      </span>
    );
  }
  const done = (keep: boolean) => {
    setEditing(false);
    const name = text.trim();
    if (keep && name && name !== value) onRename(name);
  };
  return (
    <input
      className="track-name-box"
      autoFocus
      aria-label={label}
      value={text}
      maxLength={60}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => done(true)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") done(true);
        if (e.key === "Escape") done(false);
      }}
    />
  );
}

/**
 * Pick a track by its header or its mixer strip: it becomes the selected track, and clips selected on *other*
 * tracks are let go — so the panel never shows a clip from one track above the settings of another.
 */
export function pickTrack(id: string): void {
  const s = useStore.getState();
  s.selectTrack(id);
  const song = s.history.present;
  const mine = s.selectedClipIds.filter((clipId) => song.clips.some((c) => c.id === clipId && c.trackId === id));
  if (mine.length !== s.selectedClipIds.length) s.selectClips(mine);
}

interface TrackHeaderProps {
  track: Track;
  selected: boolean;
  /** Another track is soloed, so this one is silent. */
  silenced: boolean;
  renaming: boolean;
  setRenaming: (id: string | null) => void;
  onMenu: (trackId: string, x: number, y: number) => void;
}

export const TrackHeader = memo(function TrackHeader({ track, selected, silenced, renaming, setRenaming, onMenu }: TrackHeaderProps) {
  const s = useStore.getState;
  return (
    <div
      className={`track-header${selected ? " selected" : ""}${track.mute || silenced ? " silent" : ""}`}
      style={{ ["--track" as string]: track.colour }}
      role="row"
      aria-selected={selected}
      aria-label={`Track ${track.name}`}
      onPointerDown={() => pickTrack(track.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        pickTrack(track.id);
        onMenu(track.id, e.clientX, e.clientY);
      }}
    >
      <span className="track-stripe" />
      <span className="track-icon">
        <TrackIcon track={track} />
      </span>
      <div className="track-main">
        <EditableName value={track.name} label="Track name" editing={renaming} setEditing={(on) => setRenaming(on ? track.id : null)} onRename={(name) => s().updateTrack(track.id, { name })} />
        <div className="track-controls">
          <button
            type="button"
            className={`ms-button mute${track.mute ? " on" : ""}`}
            aria-pressed={track.mute}
            aria-label={`Mute ${track.name}`}
            title="Mute: silence this track"
            onClick={() => s().updateTrack(track.id, { mute: !track.mute })}
          >
            M
          </button>
          <button
            type="button"
            className={`ms-button solo${track.solo ? " on" : ""}`}
            aria-pressed={track.solo}
            aria-label={`Solo ${track.name}`}
            title="Solo: hear only this track (and any others that are soloed)"
            onClick={() => s().updateTrack(track.id, { solo: !track.solo })}
          >
            S
          </button>
          <Slider className="track-volume" value={track.volume} label={`Volume of ${track.name}`} title={`Volume: ${Math.round(track.volume * 100)}% (double-click for the usual 80%)`} usual={0.8} make={(song, v) => withTrack(song, track.id, { volume: v })} />
        </div>
      </div>
      <Meter id={track.id} />
    </div>
  );
});
