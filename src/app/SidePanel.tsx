/**
 * The side panel, as JuraCUT's: the settings of what's selected. A clip's
 * settings when clips are selected (name, start, length, gain; Repeat, Split,
 * Delete), then the selected track's (name, colour, instrument, volume, left
 * or right, reverb, echo); with nothing selected, the song's own settings and
 * a tip.
 */
import { useEffect, useMemo, useState } from "react";

import { INSTRUMENTS, instrumentById } from "../audio/instruments";
import { useStore } from "../model/store";
import { MAX_BPM, MIN_BPM, MIN_LENGTH, TRACK_COLOURS, type Clip, type Song, type Track } from "../model/types";
import { hear, playheadBeat } from "./engineApp";
import { Icons, MarkupIcon } from "./icons";
import { panWords } from "./Mixer";
import { NumberBox } from "./NumberBox";
import { Slider } from "./Slider";
import { barBeat, barsAndBeats, clipBeats, lengthWords, withTrack } from "./songUi";
import { TrackIcon } from "./TrackHeader";

const percent = (v: number) => `${Math.round(v * 100)}%`;

export function SidePanel() {
  const song = useStore((s) => s.history.present);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const selectedClipIds = useStore((s) => s.selectedClipIds);
  const track = song.tracks.find((t) => t.id === selectedTrackId);
  const clips = useMemo(() => song.clips.filter((c) => selectedClipIds.includes(c.id)), [song.clips, selectedClipIds]);

  return (
    <aside className="side-panel" aria-label="Settings of what's selected">
      <section className="panel-section properties">
        {clips.length > 0 && <ClipSettings song={song} clips={clips} />}
        {track && <TrackSettings song={song} track={track} />}
        {!track && clips.length === 0 && <SongSettings song={song} />}
      </section>
    </aside>
  );
}

/** A name in a box that's saved on Enter or when the box is left. */
function NameBox({ value, label, onRename }: { value: string; label: string; onRename: (name: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="name-box"
      value={text}
      aria-label={label}
      title="Click to rename"
      maxLength={60}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => (text.trim() && text.trim() !== value ? onRename(text.trim()) : setText(value))}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** A labelled slider row with its value in words. */
function SliderRow({ label, value, words, ...rest }: { label: string; value: number; words: string } & Omit<Parameters<typeof Slider>[0], "label" | "value">) {
  return (
    <label className="slider-row">
      <span className="slider-row-label">
        {label} <span className="muted">{words}</span>
      </span>
      <Slider label={label} value={value} {...rest} />
    </label>
  );
}

function ClipSettings({ song, clips }: { song: Song; clips: Clip[] }) {
  const s = useStore.getState;
  const one = clips.length === 1 ? clips[0] : null;
  const bpb = song.beatsPerBar;
  const at = playheadBeat();
  const splittable = clips.some((c) => at > c.start + 1e-6 && at < c.start + clipBeats(c, song.bpm) - 1e-6);
  const midi = clips.filter((c) => c.kind === "midi");
  const joinable = midi.length >= 2 && midi.length === clips.length && midi.every((c) => c.trackId === midi[0].trackId);
  const startAt = barsAndBeats(one?.start ?? 0, bpb);
  const lengthOf = barsAndBeats(one?.kind === "midi" ? one.length : 0, bpb);
  return (
    <>
      <h3>{one ? "Clip" : `${clips.length} clips`}</h3>
      {one ? (
        <>
          <NameBox value={one.name} label="Clip name" onRename={(name) => s().updateClip(one.id, { name })} />
          {/* Whole numbers, as the ruler counts them: bar and beat (never "bar 1.667"). */}
          <div className="field-label">Starts at</div>
          <div className="field-row">
            <NumberBox label="Bar" value={startAt.bars + 1} min={1} step={1} title="Which bar the clip starts in, as the ruler counts them" onCommit={(v) => s().updateClip(one.id, { start: Math.max(0, (Math.round(v) - 1) * bpb + startAt.beats) })} />
            <NumberBox label="Beat" value={startAt.beats + 1} min={1} max={bpb + 0.999} step={1} title="Which beat of that bar (1 is the bar line; 2.5 is halfway between beats 2 and 3)" onCommit={(v) => s().updateClip(one.id, { start: Math.max(0, startAt.bars * bpb + (v - 1)) })} />
          </div>
          <div className="field-label">Length</div>
          {one.kind === "midi" ? (
            <div className="field-row">
              <NumberBox label="Bars" value={lengthOf.bars} min={0} step={1} title="How many whole bars long the clip is" onCommit={(v) => s().updateClip(one.id, { length: Math.max(MIN_LENGTH, Math.round(v) * bpb + lengthOf.beats) })} />
              <NumberBox label="Beats" value={lengthOf.beats} min={0} max={bpb - 0.001} step={1} title="…and how many beats more" onCommit={(v) => s().updateClip(one.id, { length: Math.max(MIN_LENGTH, lengthOf.bars * bpb + v) })} />
            </div>
          ) : (
            <div className="field-row">
              <NumberBox
                label="Seconds"
                value={one.duration}
                unit="s"
                min={0.05}
                max={Math.max(0.05, (song.audio.find((a) => a.id === one.audioId)?.seconds ?? one.offset + one.duration) - one.offset)}
                step={1}
                title="How much of the recording plays, in seconds"
                onCommit={(v) => s().updateClip(one.id, { duration: v })}
              />
            </div>
          )}
          <p className="panel-hint">
            Bar {barBeat(one.start, bpb).text}, {lengthWords(clipBeats(one, song.bpm), bpb)} long{one.kind === "midi" ? ` · ${one.notes.length} ${one.notes.length === 1 ? "note" : "notes"}` : " · a recording (it plays at its own speed whatever the tempo)"}.
          </p>
          {one.kind === "audio" && (
            <SliderRow
              label="Clip volume"
              words={percent(one.gain)}
              value={one.gain}
              min={0}
              max={2}
              step={0.01}
              usual={1}
              title="How loud this clip is: 100% is as recorded (double-click to go back to it)"
              make={(sg, v) => ({ ...sg, clips: sg.clips.map((c) => (c.id === one.id && c.kind === "audio" ? { ...c, gain: v } : c)) })}
            />
          )}
          {one.kind === "midi" && (
            <button type="button" className="text-button wide-button" onClick={() => s().editClip(one.id)} title="Open this clip's notes in the editor along the bottom (or double-click the clip)">
              <Icons.Editor size={18} /> Edit notes
            </button>
          )}
        </>
      ) : (
        <p className="panel-hint">Drag them to move them together. The buttons below act on all of them.</p>
      )}
      <div className="icon-row">
        <button type="button" className="text-button small-button" onClick={() => s().repeatSelectedClips(1)} title="Repeat: put a copy straight after (so it plays twice)">
          <Icons.Repeat size={16} /> Repeat
        </button>
        <button type="button" className="text-button small-button" onClick={() => s().repeatSelectedClips(3)} title="Repeat three more times (so it plays four times)">
          ×4
        </button>
        <button
          type="button"
          className="text-button small-button"
          disabled={!splittable}
          onClick={() => {
            for (const c of clips) s().splitClip(c.id, playheadBeat());
          }}
          title={splittable ? "Split in two at the play position" : "Put the play position inside the clip first (click the ruler above it)"}
        >
          <Icons.Scissors size={16} /> Split
        </button>
        {joinable && (
          <button type="button" className="text-button small-button" onClick={() => s().joinSelectedClips()} title="Join these clips into one">
            Join
          </button>
        )}
        <button type="button" className="text-button small-button" onClick={() => s().removeClips(clips.map((c) => c.id))} title="Delete (Delete key)" aria-label="Delete the selected clips">
          <Icons.Trash size={16} /> Delete
        </button>
      </div>
    </>
  );
}

function TrackSettings({ song, track }: { song: Song; track: Track }) {
  const s = useStore.getState;
  const index = song.tracks.findIndex((t) => t.id === track.id);
  const groups = useMemo(() => {
    const out: { group: string; instruments: typeof INSTRUMENTS }[] = [];
    for (const i of INSTRUMENTS) {
      const g = out.find((x) => x.group === i.group);
      if (g) g.instruments.push(i);
      else out.push({ group: i.group, instruments: [i] });
    }
    return out;
  }, []);
  return (
    <>
      <h3>
        Track <span className="count">{index + 1} of {song.tracks.length}</span>
      </h3>
      <div className="track-title">
        <span className="track-icon" style={{ color: track.colour }}>
          <TrackIcon track={track} size={24} />
        </span>
        <NameBox value={track.name} label="Track name" onRename={(name) => s().updateTrack(track.id, { name })} />
      </div>
      <div className="swatches" role="radiogroup" aria-label="Track colour">
        {TRACK_COLOURS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={track.colour === c} aria-label={`Colour ${TRACK_COLOURS.indexOf(c) + 1}`} title="Track colour" className={`swatch${track.colour === c ? " selected" : ""}`} style={{ background: c }} onClick={() => s().updateTrack(track.id, { colour: c })} />
        ))}
      </div>

      <SliderRow label="Volume" words={percent(track.volume)} value={track.volume} usual={0.8} title="How loud this track is (double-click for the usual 80%)" make={(sg, v) => withTrack(sg, track.id, { volume: v })} />
      <SliderRow label="Left or right" words={panWords(track.pan)} value={track.pan} min={-1} max={1} step={0.02} usual={0} title="Where the track sits between the left and right speakers (double-click for the middle)" make={(sg, v) => withTrack(sg, track.id, { pan: Math.abs(v) < 0.04 ? 0 : v })} />
      <SliderRow label="Reverb" words={percent(track.reverb)} value={track.reverb} usual={0} title="The sound of a room round this track" make={(sg, v) => withTrack(sg, track.id, { reverb: v })} />
      <SliderRow label="Echo" words={percent(track.echo)} value={track.echo} usual={0} title="Repeats that fade away" make={(sg, v) => withTrack(sg, track.id, { echo: v })} />

      {track.kind === "instrument" ? (
        <>
          <div className="field-label">
            Instrument <span className="muted">— {instrumentById(track.instrument).name}. Click one to hear it.</span>
          </div>
          {groups.map((g) => (
            <div key={g.group}>
              <h4 className="library-group">{g.group}</h4>
              <div className="instrument-grid">
                {g.instruments.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    className={`instrument-card${track.instrument === i.id ? " selected" : ""}`}
                    aria-pressed={track.instrument === i.id}
                    title={`${i.name} — click to use it and hear a note`}
                    onClick={() => {
                      if (track.instrument !== i.id) s().updateTrack(track.id, { instrument: i.id });
                      // Hear it once the engine has the change.
                      window.setTimeout(() => hear(track.id, i.kind === "drums" ? 36 : i.group === "Bass" ? 36 : 60, 100, 0.6), 30);
                    }}
                  >
                    <MarkupIcon markup={i.icon} size={26} />
                    <span>{i.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      ) : (
        <p className="panel-hint">A sound track holds recordings and sound files. Press Record (R) to record onto it with the microphone, or use Import in the top bar.</p>
      )}

      <div className="field-label">This track</div>
      <div className="icon-row">
        <button type="button" className="text-button small-button" onClick={() => s().duplicateTrack(track.id)} title="Make a copy of this track and its clips">
          <Icons.Duplicate size={16} /> Duplicate
        </button>
        <button type="button" className="icon-button" onClick={() => s().moveTrack(track.id, -1)} disabled={index <= 0} title="Move this track up" aria-label="Move track up">
          <Icons.Up size={16} />
        </button>
        <button type="button" className="icon-button" onClick={() => s().moveTrack(track.id, 1)} disabled={index >= song.tracks.length - 1} title="Move this track down" aria-label="Move track down">
          <Icons.Down size={16} />
        </button>
        <button type="button" className="text-button small-button" onClick={() => s().removeTrack(track.id)} title="Delete this track and its clips (Undo brings it back)">
          <Icons.Trash size={16} /> Delete
        </button>
      </div>
    </>
  );
}

function SongSettings({ song }: { song: Song }) {
  const s = useStore.getState;
  return (
    <>
      <h3>Song</h3>
      <div className="field-row">
        <NumberBox label="Tempo" value={song.bpm} unit="bpm" min={MIN_BPM} max={MAX_BPM} step={1} title="How fast the song goes, in beats per minute" onCommit={(v) => s().setBpm(v)} />
        <label className="field">
          <span>Beats in a bar</span>
          <select value={song.beatsPerBar} aria-label="Beats in a bar" onChange={(e) => s().setBeatsPerBar(Number(e.target.value))}>
            {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
              <option key={n} value={n}>
                {n}/4
              </option>
            ))}
          </select>
        </label>
      </div>
      <SliderRow label="Master volume" words={percent(song.master)} value={song.master} usual={0.8} title="The volume of the whole song (double-click for the usual 80%)" make={(sg, v) => ({ ...sg, master: v })} />
      {song.tracks.length === 0 ? (
        <p className="panel-hint">
          Pick a card to begin. The <b>Library</b> has ready-made drum beats, bass lines and chords.
        </p>
      ) : (
        <>
          <p className="panel-hint">Click a track to see its settings here — its instrument, volume, reverb and echo. Click a clip to see the clip's.</p>
          <h3>Tip</h3>
          <p className="panel-hint">
            Press <kbd>Space</kbd> to play and stop. Click the numbered ruler to choose where playing starts, and drag across the yellow strip above it to repeat a part while you work on it.
          </p>
          <p className="panel-hint">
            The <b>Library</b> has ready-made drum beats, bass lines and chords to build on.
          </p>
        </>
      )}
    </>
  );
}
