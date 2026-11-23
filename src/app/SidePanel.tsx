/**
 * The side panel, as JuraCUT's: the settings of what's selected. A clip's
 * settings when clips are selected (name, start, length, its own volume,
 * fades and filter sweep; Repeat, Split, Delete), then the selected track's
 * (name, colour, volume, left or right, reverb, echo, its own effects —
 * drive, crush, filter, wobble, pump — and the instrument); with nothing
 * selected, the song's own settings and a tip.
 */
import { useEffect, useMemo, useState } from "react";

import { INSTRUMENTS, instrumentById } from "../audio/instruments";
import { AUTO_NAMES, AUTO_PARAMS, lineOf } from "../model/automation";
import * as edits from "../model/edits";
import { ARP_RATES, ARP_STYLES, DEFAULT_ARP, HARMONY_STYLES, arpRateWords, clipFades, clipGain, cutoffHz, effectsOf, filterIsOn, hzText, toneWords } from "../model/shaping";
import { useStore } from "../model/store";
import { MAX_BPM, MIN_BPM, MIN_LENGTH, TRACK_COLOURS, type Clip, type HarmonyStyle, type Song, type Track } from "../model/types";
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
          <ClipShape song={song} clip={one} />
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

/** A clip's own loudness — its volume, a swell in, a dying away — and its filter sweep. */
function ClipShape({ song, clip }: { song: Song; clip: Clip }) {
  const length = clipBeats(clip, song.bpm);
  const fades = clipFades(clip, length);
  const beatsWords = (beats: number) => (beats > 0 ? lengthWords(beats, song.beatsPerBar) : "none");
  const sweep = clip.sweep;
  const track = song.tracks.find((t) => t.id === clip.trackId);
  const rest = track ? effectsOf(track).filter.cutoff : 1;
  const place = (v: number) => hzText(cutoffHz(v));
  return (
    <>
      <SliderRow
        label="Clip volume"
        words={percent(clipGain(clip))}
        value={clipGain(clip)}
        min={0}
        max={2}
        step={0.01}
        usual={1}
        title={`How loud this clip is: 100% is as ${clip.kind === "audio" ? "recorded" : "played"} (double-click to go back to it)`}
        make={(sg, v) => edits.updateClip(sg, clip.id, { gain: v })}
      />
      <SliderRow
        label="Fade in"
        words={beatsWords(fades.fadeIn)}
        value={fades.fadeIn}
        min={0}
        max={length}
        step={0.25}
        usual={0}
        title="Swell in from silence over this long at the clip's start, rather than switching on (double-click for none)"
        make={(sg, v) => edits.updateClip(sg, clip.id, { fadeIn: v, fadeOut: Math.min(fades.fadeOut, length - v) })}
      />
      <SliderRow
        label="Fade out"
        words={beatsWords(fades.fadeOut)}
        value={fades.fadeOut}
        min={0}
        max={length}
        step={0.25}
        usual={0}
        title="Die away to silence over this long at the clip's end (double-click for none)"
        make={(sg, v) => edits.updateClip(sg, clip.id, { fadeOut: v, fadeIn: Math.min(fades.fadeIn, length - v) })}
      />
      {clip.kind === "audio" && (
        <label className="check-row" title="Play this clip backwards">
          <input
            type="checkbox"
            checked={!!clip.reverse}
            onChange={(e) => {
              useStore.getState().updateClip(clip.id, { reverse: e.target.checked });
              e.currentTarget.blur();
            }}
          />
          Play backwards
        </label>
      )}
      <label className="check-row" title="Move the track's filter from one place to another while this clip plays: opening up for a build, or closing down">
        <input
          type="checkbox"
          checked={!!sweep}
          onChange={(e) => {
            useStore.getState().updateClip(clip.id, { sweep: e.target.checked ? { from: 0.3, to: Math.max(rest, 0.9) } : null });
            // Let go of the focus, so Space plays rather than unticking the box.
            e.currentTarget.blur();
          }}
        />
        Sweep the filter over this clip
      </label>
      {sweep && (
        <>
          <SliderRow label="From" words={place(sweep.from)} value={sweep.from} title="Where the filter is when the clip starts (low = muffled, high = open)" make={(sg, v) => edits.updateClip(sg, clip.id, { sweep: { from: v, to: sweep.to } })} />
          <SliderRow label="To" words={place(sweep.to)} value={sweep.to} title="Where the filter has got to when the clip ends" make={(sg, v) => edits.updateClip(sg, clip.id, { sweep: { from: sweep.from, to: v } })} />
        </>
      )}
    </>
  );
}

/** The track's own effects, in the order the sound goes through them. */
function TrackEffects({ track }: { track: Track }) {
  const e = effectsOf(track);
  const off = e.filter.kind === "low" ? 1 : 0;
  const amount = (v: number) => (v > 0 ? percent(v) : "off");
  return (
    <>
      <div className="field-label">
        Effects <span className="muted">— this track's own</span>
      </div>
      <SliderRow label="Drive" words={amount(e.drive)} value={e.drive} usual={0} title="Warmth, then grit, then fuzz (double-click for off)" make={(sg, v) => edits.updateTrack(sg, track.id, { drive: v })} />
      <SliderRow label="Crush" words={amount(e.crush)} value={e.crush} usual={0} title="The rough, lo-fi sound of an old sampler or games console (double-click for off)" make={(sg, v) => edits.updateTrack(sg, track.id, { crush: v })} />
      <SliderRow label="Bass" words={toneWords(e.lows)} value={e.lows} min={-1} max={1} step={0.05} usual={0} title="More or less of the low end: boom and warmth (double-click for no change)" make={(sg, v) => edits.updateTrack(sg, track.id, { lows: Math.abs(v) < 0.03 ? 0 : v })} />
      <SliderRow label="Treble" words={toneWords(e.highs)} value={e.highs} min={-1} max={1} step={0.05} usual={0} title="More or less of the top end: brightness and air (double-click for no change)" make={(sg, v) => edits.updateTrack(sg, track.id, { highs: Math.abs(v) < 0.03 ? 0 : v })} />
      <div className="segmented two filter-kind" role="radiogroup" aria-label="What the filter takes away">
        {(["low", "high"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={e.filter.kind === kind}
            className={e.filter.kind === kind ? "selected" : ""}
            title={kind === "low" ? "The filter takes away the top of the sound: muffled, underwater (a low-pass filter)" : "The filter takes away the bottom of the sound: thin, like a small radio (a high-pass filter)"}
            onClick={() => useStore.getState().updateTrack(track.id, { filter: { kind, cutoff: kind === "low" ? 1 : 0 } })}
          >
            {kind === "low" ? "Cut the top" : "Cut the bottom"}
          </button>
        ))}
      </div>
      <SliderRow
        label="Filter"
        words={filterIsOn(e.filter) ? `cuts ${e.filter.kind === "low" ? "above" : "below"} ${hzText(cutoffHz(e.filter.cutoff))}` : "off"}
        value={e.filter.cutoff}
        usual={off}
        title={`Where the filter cuts: slide ${e.filter.kind === "low" ? "down" : "up"} to take more away (double-click for off)`}
        make={(sg, v) => edits.updateTrack(sg, track.id, { filter: { cutoff: v } })}
      />
      <SliderRow label="Filter ring" words={amount(e.filter.resonance)} value={e.filter.resonance} usual={0} title="A ringing edge where the filter cuts (resonance): a little adds bite, a lot whistles" make={(sg, v) => edits.updateTrack(sg, track.id, { filter: { resonance: v } })} />
      <SliderRow label="Wobble" words={amount(e.chorus)} value={e.chorus} usual={0} title="A slow drift in pitch that widens and thickens the sound, like a worn tape (double-click for off)" make={(sg, v) => edits.updateTrack(sg, track.id, { chorus: v })} />
      <SliderRow label="Pump" words={amount(e.pump)} value={e.pump} usual={0} title="Dips the volume on every beat and lets it swell back, as dance music does (double-click for off)" make={(sg, v) => edits.updateTrack(sg, track.id, { pump: v })} />
      <SliderRow label="Chop" words={amount(e.chop)} value={e.chop} usual={0} title="Cuts the sound into sixteenth notes: a gentle flutter, or hard stutters when turned right up (double-click for off)" make={(sg, v) => edits.updateTrack(sg, track.id, { chop: v })} />
      {track.kind === "instrument" && <ArpSettings track={track} />}
    </>
  );
}

/** The arpeggiator: chords held on the track played one note at a time. */
function ArpSettings({ track }: { track: Track }) {
  const s = useStore.getState;
  const arp = track.arp;
  return (
    <>
      <label className="check-row" title="Play the chords on this track one note at a time, in a pattern, instead of all together">
        <input
          type="checkbox"
          checked={!!arp}
          onChange={(e) => {
            s().updateTrack(track.id, { arp: e.target.checked ? DEFAULT_ARP : null });
            e.currentTarget.blur();
          }}
        />
        Arpeggiator <span className="muted">— chords one note at a time</span>
      </label>
      {arp && (
        <>
          <div className="segmented four arp-style" role="radiogroup" aria-label="Arpeggiator pattern">
            {ARP_STYLES.map((style) => (
              <button key={style} type="button" role="radio" aria-checked={arp.style === style} className={arp.style === style ? "selected" : ""} onClick={() => s().updateTrack(track.id, { arp: { style } })} title={ARP_STYLE_HINTS[style]}>
                {ARP_STYLE_WORDS[style]}
              </button>
            ))}
          </div>
          <div className="field-row">
            <label className="field">
              <span className="field-label">Speed</span>
              <select value={String(arp.rate)} onChange={(e) => s().updateTrack(track.id, { arp: { rate: Number(e.target.value) } })} aria-label="Arpeggiator speed">
                {ARP_RATES.map((rate) => (
                  <option key={rate} value={String(rate)}>
                    {arpRateWords(rate)[0].toUpperCase() + arpRateWords(rate).slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Octaves</span>
              <select value={String(arp.octaves)} onChange={(e) => s().updateTrack(track.id, { arp: { octaves: Number(e.target.value) } })} aria-label="Arpeggiator octaves">
                {[1, 2, 3].map((o) => (
                  <option key={o} value={String(o)}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="panel-hint">Hold chords in a clip: they play as a running pattern. The notes you see stay as you wrote them.</p>
        </>
      )}
    </>
  );
}

function HarmonySettings({ track }: { track: Track }) {
  const s = useStore.getState;
  const harmony = track.harmony;
  return (
    <>
      <label className="check-row" title="Add voices at other pitches that sing (or play) along with this track — lovely on a recorded voice">
        <input
          type="checkbox"
          checked={!!harmony}
          onChange={(e) => {
            s().updateTrack(track.id, { harmony: e.target.checked ? { style: "below", amount: 0.6 } : null });
            e.currentTarget.blur();
          }}
        />
        Harmoniser <span className="muted">— extra voices along with it</span>
      </label>
      {harmony && (
        <>
          <label className="field">
            <span className="field-label">Voices</span>
            <select value={harmony.style} onChange={(e) => s().updateTrack(track.id, { harmony: { style: e.target.value as HarmonyStyle } })} aria-label="Which voices the harmoniser adds" title={HARMONY_STYLES.find((h) => h.style === harmony.style)?.hint}>
              {HARMONY_STYLES.map((h) => (
                <option key={h.style} value={h.style} title={h.hint}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <SliderRow label="Voices' volume" words={percent(harmony.amount)} value={harmony.amount} min={0.05} usual={0.6} title="How loud the added voices are (double-click for the usual 60%)" make={(sg, v) => edits.updateTrack(sg, track.id, { harmony: { amount: v } })} />
          <p className="panel-hint">{HARMONY_STYLES.find((h) => h.style === harmony.style)?.hint}. The voices keep a fixed distance from the sound, so a chord may not suit every note of a tune.</p>
        </>
      )}
    </>
  );
}

const ARP_STYLE_WORDS: Record<(typeof ARP_STYLES)[number], string> = { up: "Up", down: "Down", updown: "Up & down", random: "Random" };
const ARP_STYLE_HINTS: Record<(typeof ARP_STYLES)[number], string> = {
  up: "From the lowest note of the chord to the highest, round and round",
  down: "From the highest note to the lowest",
  updown: "Up, then back down again",
  random: "The chord's notes in a jumbled order (the same jumble every time it plays)",
};

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
      <TrackEffects track={track} />
      <HarmonySettings track={track} />
      <div className="field-label">Automation</div>
      <p className="panel-hint">
        {(() => {
          const drawn = AUTO_PARAMS.filter((p) => lineOf(track, p)).map((p) => AUTO_NAMES[p].toLowerCase());
          return drawn.length ? `This track has a line for its ${drawn.join(" and ")}: it changes as the song plays.` : "Draw lines over the song that change this track's volume, filter or left–right as it plays.";
        })()}
      </p>
      <button type="button" className="text-button small-button" onClick={() => s().setBottomPanel("automation")} title="Open the Automation tab under the tracks to draw lines for this track">
        <Icons.Automation size={16} /> Draw automation
      </button>

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
