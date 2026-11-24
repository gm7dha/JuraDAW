/**
 * The tools Claude has for making music with JuraDAW: each one checks what
 * it's given (plain-English messages when something's wrong), changes the
 * session's song through the app's own pure edits (src/model/edits.ts), and
 * says what it did. While a JuraDAW tab is connected (Live with Claude) the
 * same tools work on the song open there (src/mcp/live.ts).
 */
import { FILE_EXTENSION, MOST_BEATS, isDrumKit, newSong, newTrack, readSongFile, songFileText, instrumentLabel } from "../model/document";
import { AUTO_NAMES, AUTO_PARAMS, MOST_POINTS, lineOf } from "../model/automation";
import * as edits from "../model/edits";
import { CUSTOM_INSTRUMENT, SOUND_PRESETS, SOUND_WAVES, soundOf, soundWords } from "../model/sound";
import { MOST_SECTIONS, finishOf, keyWords } from "../model/songParts";
import { STEP_CHOICES, stepsToNotes } from "../model/steps";
import { KEYS } from "../library/theory";
import { ARP_STYLES, HARMONY_STYLES, WOBBLE_RATES, arpRateWords, wobbleRateWords, clipGain, effectsOf, filterIsOn } from "../model/shaping";
import { DRUM_PITCHES, clipEnd, clipLength, drumName, pitchName, songLength, timeText, beatsToSeconds } from "../model/time";
import { MAX_BPM, MIN_BPM, MIN_LENGTH, MOST_TRACKS, type AutoPoint, type Clip, type Finish, type SongKey, type MidiClip, type Note, type Song, type Track } from "../model/types";
import { LIBRARY, cleanValues, findPattern, makePattern, patternSuitsInstrument } from "../library/catalogue";
import { songToMidi } from "../midi/midiFile";
import { InputError, bool, list, noExtras, num, object, oneOf, optionalNum, r6, text, type Obj } from "./args";
import { Cancelled, type Session } from "./session";
import { checkFree, fileNameFor, needFolder, say, writeOut, type ToolDef, type ToolResult } from "./toolKit";

export type { ToolDef, ToolResult } from "./toolKit";

/** The built-in instruments (the ids of src/audio/instruments.ts INSTRUMENTS, kept in step by tests/mcpTools). */
export const INSTRUMENT_IDS = ["piano", "felt-piano", "electric-piano", "organ", "clavinet", "accordion", "strings", "pad", "choir", "cello", "glass-pad", "guitar", "harp", "kalimba", "marimba", "flute", "brass", "vibraphone", "music-box", "steel-drum", "bass", "synth-bass", "sub-bass", "growl-bass", "bass-808", "lead", "supersaw", "wobble", "pluck", "bells", "chiptune", "sweep", "custom", "drums", "drums-808", "drums-electro"] as const;

/** How songs are described to the tools: sent to Claude with the server's instructions, and by the format_guide tool. */
export const FORMAT_GUIDE = `How JuraDAW songs work:
- A song has a tempo (beats a minute), beats in a bar (4 unless told otherwise) and tracks. Each instrument track plays one built-in instrument: ${INSTRUMENT_IDS.join(", ")}. Tracks hold clips: blocks of notes that sit on the bars of the song.
- Places in the song are given in BARS, counted from 1 ("start_bar": 5 is the start of bar 5). Lengths of clips are in bars.
- Notes inside a clip are given in BEATS from the start of that clip (0 is its first beat; in 4/4 a bar is 4 beats, a half beat is 0.5, a sixteenth note 0.25).
- A note is {"pitch", "start", "length", "velocity"}: pitch is a note name ("C4" is middle C, "F#3", "Bb2") or a MIDI number (60 = middle C); length is in beats (1 if left out); velocity is how hard it's played, 1–127 (96 if left out). Chords are simply notes with the same start.
- On a drum kit's track ("drums", "drums-808" or "drums-electro") the pitch can be a drum's name: ${DRUM_PITCHES.map((d) => `"${d.name.toLowerCase()}"`).join(", ")} (drum notes are short: length 0.25 if left out).
- Refer to a track by its name (or its number in describe_song), and to a clip by its name with "track", its number on that track (1 = the first), or its id.
- Two clips can't lie on top of each other on one track.
- Each track has its own effects, all off unless set (amounts are per cent): "drive" (warmth → grit → fuzz), "crush" (lo-fi, bit-crushed), "bass" and "treble" (−100 to 100: less or more of the low end / top end), "chop" (cuts the sound into sixteenth notes — stutters), "filter" {"kind": "low" (cuts the top: muffled) or "high" (cuts the bottom: thin), "cutoff": 0–100 (where it cuts, from the very bottom to the very top of hearing), "resonance": 0–100 (a ringing edge)}, "wobble" (a slow pitch drift that widens, like worn tape) and "pump" (the volume dips on every beat and swells back, like side-chained dance music) — besides "reverb" and "echo".
- An instrument track can have an "arpeggiator" {"style": "up" | "down" | "updown" | "random", "rate": "beats" | "eighths" | "triplets" | "sixteenths", "octaves": 1–3}: chords held in its clips are played one note at a time in that pattern (write long held chords; the clip's notes stay as written). null switches it off.
- Each clip can have its own "volume" (per cent, 100 = as played), "fade_in" and "fade_out" (beats: it swells in / dies away instead of switching on and off) and a "filter_sweep" {"from", "to"} (0–100 as the filter's cutoff): the track's filter moves from one to the other while the clip plays — low to high opens up for a build.
- More track effects (per cent, off unless set): "squeeze" (a compressor: steadier, punchier), "swirl" (a phaser: a sweeping hollow whoosh), "sway" (swings left and right once a bar), and on instrument tracks "swing" (off-beat notes come late, for a shuffle — eighths, or sixteenths when the clip has notes on them). The filter's "kind" can also be "band" (keeps only a slice around the cutoff: a telephone or small-radio sound). "filter_wobble" {"rate": 2 | 1 | 0.5 | 0.333 | 0.25 (beats for one wobble), "depth": 0–100} opens and closes the filter in time with the song — the dubstep wub (try growl-bass or supersaw with a low filter, rate 0.5 or 0.333).
- Acoustic instruments: guitar, harp, kalimba, marimba, flute, brass, vibraphone, music-box, steel-drum; also clavinet and accordion (keys), cello and glass-pad (strings and pads), chiptune (retro games-console beeps).
- "custom" is Your own sound: a simple synth shaped by "sound" {"preset", "wave", "brightness", "fade_in", "hold", "ring_on", "thickness", "bass_layer", "vibrato"} on add_track/edit_track — start from a preset and change a setting or two.
- Any track can have a "harmoniser" {"voices": "below" | "fifth" | "major" | "minor" | "wide", "volume": 0–100}: copies of its sound at other pitches, a fixed step away, sung along with it — the stacked-voice sound of Bon Iver on a recorded voice, or a big octave sound on a lead. "major" and "minor" add chords, so pick the one that matches the song's key. null switches it off.
- The song can have a key (set_song "key": "A minor"), named sections along the ruler (set_song "sections": [{"bar": 1, "name": "Intro"}, …] — name the parts of any song you write, it helps the user find their way round) and finishing touches on the whole mix ("finish": {"bass", "treble", "squeeze"} — a little squeeze, 20–40, makes a finished song sound fuller).
- Automation (set_automation): a line drawn over the song moves a track's "volume", "filter" (its cutoff) or "pan" as the song plays — for a fade-out at the end, a filter opening over a build, or a sound drifting from side to side. Unlike a clip's filter_sweep, a line can cross many clips. A clip's own sweep wins over the filter line while that clip plays.
- The "sweep" instrument is a rush of noise for builds: a note from C4 up rises and swells for as long as the note lasts (a 4-bar note = a 4-bar build; higher notes end higher); a note below C4 falls and dies away.
- Drum kits: "drums" (an ordinary kit), "drums-808" (trap and hip-hop: booming kick, snappy snare, ticking hats) and "drums-electro" (house, techno, drum and bass). "bass-808" is the long, gliding bass of trap. The library has trap, house, techno, drum-and-bass and lo-fi beats and a build-up.
- A recording's clip can be played backwards: "reverse": true in edit_clip.
- For a modern, atmospheric sound: felt-piano, choir, pad and wobble with plenty of reverb for the soft side; sub-bass under growl-bass or synth-bass, supersaw chords with pump, drive or crush on drums, and a sweep into each new section for the hard side.
- For a drum beat, add_notes "steps" is easiest: one row of letters a drum, a letter a sixteenth (x hit, X accent, o soft, . rest) — what the user sees in the app's step sequencer.
- Good habits: describe_song first; build a song a part at a time (drums, bass, chords, tune) with each part on its own track; use list_library_patterns / insert_library_pattern for ready-made beats, bass lines and chord sequences that fit together when given the same key, scale and chords; keep bass around C1–C3, chords around C3–C5 and tunes around C4–C6; vary velocity a little so it doesn't sound mechanical.
- The user hears the result in JuraDAW (https://gm7dha.github.io/JuraDAW/): live if they clicked "Connect to Claude" there (see live_status), otherwise save_song and they open the .juradaw file. Recording sound and exporting a WAV sound file are done by the user in JuraDAW; export_midi makes a standard MIDI file here.`;

// ---------------------------------------------------------------------------
// Reading what Claude gives

const NOTE_STEPS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** A pitch from a note name, a drum's name or a MIDI number. */
export function pitchOf(v: unknown, where: string, drums: boolean): number {
  if (typeof v === "number") {
    if (!Number.isInteger(v) || v < 0 || v > 127) throw new InputError(`${where}: a pitch number must be a whole number from 0 to 127 (60 is middle C); got ${v}.`);
    return v;
  }
  if (typeof v === "string" && v.trim()) {
    const t = v.trim();
    const m = /^([A-Ga-g])([#♯b♭]?)(-?\d{1,2})$/.exec(t);
    if (m) {
      const p = (Number(m[3]) + 1) * 12 + NOTE_STEPS[m[1].toLowerCase()] + (m[2] === "#" || m[2] === "♯" ? 1 : m[2] ? -1 : 0);
      if (p < 0 || p > 127) throw new InputError(`${where}: "${t}" is outside what can be played (C-1 to G9).`);
      return p;
    }
    if (/^\d{1,3}$/.test(t)) return pitchOf(Number(t), where, drums);
    const drum = DRUM_PITCHES.find((d) => d.name.toLowerCase() === t.toLowerCase() || d.name.toLowerCase().replace(/\s+/g, "") === t.toLowerCase().replace(/[\s_-]+/g, ""));
    if (drum) return drum.pitch;
    throw new InputError(`${where}: "${t}" isn't a pitch. Give a note name like "C4" (middle C), "F#3" or "Bb2", a number 0–127${drums ? `, or a drum: ${DRUM_PITCHES.map((d) => d.name.toLowerCase()).join(", ")}` : ""}.`);
  }
  throw new InputError(`${where} needs a "pitch": a note name like "C4" or a number 0–127.`);
}

/** Notes as Claude gives them → notes for a clip (not yet with ids). */
export function notesOf(v: unknown, where: string, drums: boolean, opts: { allowEmpty?: boolean } = {}): Omit<Note, "id">[] {
  const items = list(v, where, { allowEmpty: opts.allowEmpty ?? true });
  if (items.length > 5000) throw new InputError(`${where}: that's ${items.length} notes at once. Add at most 5000 in one go.`);
  return items.map((item, i) => {
    const at = `${where}[${i}]`;
    const o = object(item, at);
    noExtras(o, ["pitch", "start", "length", "velocity"], at);
    const start = num(o.start, `${at}.start (beats from the clip's start)`, { min: 0, max: MOST_BEATS });
    const length = num(o.length, `${at}.length (beats)`, { min: MIN_LENGTH, max: MOST_BEATS, fallback: drums ? 0.25 : 1 });
    const velocity = num(o.velocity, `${at}.velocity`, { min: 1, max: 127, fallback: 96 });
    return { pitch: pitchOf(o.pitch, at, drums), start: r6(start), length: r6(length), velocity: Math.round(velocity) };
  });
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A track by name, id or its number in the list. */
export function trackOf(song: Song, ref: unknown, where: string): Track {
  const names = song.tracks.map((t) => `"${t.name}"`).join(", ");
  if (!song.tracks.length) throw new InputError(`${where}: the song has no tracks yet. Add one with add_track (or insert_library_pattern, which makes its own).`);
  if (typeof ref === "number" && Number.isInteger(ref)) {
    const t = song.tracks[ref - 1];
    if (!t) throw new InputError(`${where}: there's no track number ${ref}. The tracks are: ${names}.`);
    return t;
  }
  if (typeof ref !== "string" || !ref.trim()) throw new InputError(`${where}: say which track, by name. The tracks are: ${names}.`);
  const hit = song.tracks.find((t) => t.id === ref.trim()) ?? song.tracks.find((t) => sameName(t.name, ref));
  if (!hit) throw new InputError(`${where}: there's no track called "${ref}". The tracks are: ${names}.`);
  return hit;
}

const clipsOn = (song: Song, trackId: string): Clip[] => song.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);

/** A clip by id, by name, or by its number on a track. */
export function clipOf(song: Song, a: Obj, where: string): Clip {
  const ref = a.clip;
  if (!song.clips.length) throw new InputError(`${where}: the song has no clips yet. Make one with add_clip or insert_library_pattern.`);
  const track = a.track === undefined || a.track === null ? null : trackOf(song, a.track, `${where}.track`);
  const pool = track ? clipsOn(song, track.id) : song.clips;
  const shown = (cs: Clip[]) => cs.map((c) => `"${c.name}" (${song.tracks.find((t) => t.id === c.trackId)?.name ?? "?"}, bar ${barOf(song, c.start)})`).join(", ");
  if (typeof ref === "string" && ref.trim()) {
    const byId = song.clips.find((c) => c.id === ref.trim());
    if (byId) return byId;
    const named = pool.filter((c) => sameName(c.name, ref));
    if (named.length === 1) return named[0];
    if (named.length > 1) throw new InputError(`${where}: ${named.length} clips are called "${ref}"${track ? ` on "${track.name}"` : ""}. Say which by its number on the track ("clip": 1 is the first, with "track"), or its id from describe_song.`);
    throw new InputError(`${where}: there's no clip called "${ref}"${track ? ` on "${track.name}"` : ""}. The clips are: ${shown(pool) || "none on that track"}.`);
  }
  if (typeof ref === "number" && Number.isInteger(ref)) {
    if (!track) throw new InputError(`${where}: a clip number needs "track" too (clip 1 is the first clip on that track).`);
    const c = pool[ref - 1];
    if (!c) throw new InputError(`${where}: "${track.name}" has ${pool.length} clip${pool.length === 1 ? "" : "s"}, so there's no number ${ref}.`);
    return c;
  }
  if (pool.length === 1) return pool[0];
  throw new InputError(`${where}: say which clip: its name, its number on a track ("track" + "clip": 1) or its id. The clips are: ${shown(pool)}.`);
}

function midiClipOf(song: Song, a: Obj, where: string): MidiClip {
  const c = clipOf(song, a, where);
  if (c.kind !== "midi") throw new InputError(`${where}: "${c.name}" is a recording (sound), not notes, so its notes can't be changed.`);
  return c;
}

const isDrums = (song: Song, trackId: string) => isDrumKit(song.tracks.find((t) => t.id === trackId)?.instrument);

/** The bar (from 1) a beat falls in, as a tidy number ("3", or "3.5" half-way through bar 3). */
const barOf = (song: Song, beat: number) => r6(beat / song.beatsPerBar + 1);
const beatOfBar = (song: Song, bar: number) => r6((bar - 1) * song.beatsPerBar);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function instrumentOf(v: unknown, where: string, fallback?: string): string {
  return oneOf(v, INSTRUMENT_IDS, where, fallback as (typeof INSTRUMENT_IDS)[number] | undefined);
}

/** Volume and the like as 0–100 (per cent) → 0–1. */
const share = (v: unknown, where: string) => {
  const n = optionalNum(v, `${where} (per cent)`, { min: 0, max: 100 });
  return n === undefined ? undefined : r6(n / 100);
};

/** Refuse a place that lies over another clip on the track, saying where there is room. */
function needRoom(song: Song, track: Track, start: number, length: number, where: string, except: string[] = []): void {
  if (edits.placeIsFree(song, track.id, start, length, except)) return;
  const free = edits.freePlace(song, track.id, start, length, song.beatsPerBar);
  throw new InputError(`${where}: that would lie on top of a clip already on "${track.name}". There's room from bar ${barOf(song, free)}; or put it on another track, or remove or shorten the clip in the way.`);
}

// ---------------------------------------------------------------------------
// Describing the song

function describeNotes(song: Song, clip: MidiClip, most: number): string[] {
  const drums = isDrums(song, clip.trackId);
  const notes = [...clip.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const lines = notes.slice(0, most).map((n) => `      beat ${r6(n.start)}: ${drums ? (drumName(n.pitch) ?? pitchName(n.pitch)) : pitchName(n.pitch)}, ${r6(n.length)} long, velocity ${n.velocity}`);
  if (notes.length > most) lines.push(`      … and ${notes.length - most} more (ask for this clip alone to see them all).`);
  return lines;
}

const ARP_RATE_NAMES = { beats: 1, eighths: 0.5, triplets: 1 / 3, sixteenths: 0.25 } as const;

/** A track's own effects in words (nothing when they're all off). */
function effectsWords(track: Track, bpb: number): string {
  const e = effectsOf(track);
  const words: string[] = [];
  if (e.drive > 0) words.push(`drive ${pct(e.drive)}`);
  if (e.crush > 0) words.push(`crush ${pct(e.crush)}`);
  if (filterIsOn(e.filter) || e.filter.resonance > 0) words.push(`filter ${e.filter.kind} at ${pct(e.filter.cutoff)}${e.filter.resonance > 0 ? ` (resonance ${pct(e.filter.resonance)})` : ""}`);
  if (e.chorus > 0) words.push(`wobble ${pct(e.chorus)}`);
  if (e.pump > 0) words.push(`pump ${pct(e.pump)}`);
  if (e.lows !== 0) words.push(`bass ${Math.round(e.lows * 100)}`);
  if (e.highs !== 0) words.push(`treble ${Math.round(e.highs * 100)}`);
  if (e.chop > 0) words.push(`chop ${pct(e.chop)}`);
  if (e.swirl > 0) words.push(`swirl ${pct(e.swirl)}`);
  if (e.squeeze > 0) words.push(`squeeze ${pct(e.squeeze)}`);
  if (e.sway > 0) words.push(`sway ${pct(e.sway)}`);
  if (e.swing > 0) words.push(`swing ${pct(e.swing)}`);
  if (track.filterWobble) words.push(`filter wobble ${wobbleRateWords(track.filterWobble.rate)}, depth ${pct(track.filterWobble.depth)}`);
  if (track.arp) words.push(`arpeggiator ${track.arp.style}, ${arpRateWords(track.arp.rate)}, ${plural(track.arp.octaves, "octave")}`);
  if (track.instrument === CUSTOM_INSTRUMENT) words.push(`own sound: ${soundWords(soundOf(track))}`);
  if (track.harmony) words.push(`harmoniser ${track.harmony.style} at ${pct(track.harmony.amount)}`);
  for (const p of AUTO_PARAMS) {
    const line = lineOf(track, p);
    if (!line) continue;
    const value = (v: number) => (p === "pan" ? String(Math.round(v * 200 - 100)) : String(Math.round(v * 100)));
    const shown = line.slice(0, 12).map((pt) => `bar ${r6(pt.beat / bpb) + 1} ${value(pt.value)}`);
    words.push(`${AUTO_NAMES[p].toLowerCase()} line: ${shown.join(" → ")}${line.length > 12 ? ` … (${line.length} points)` : ""}`);
  }
  return words.length ? `, ${words.join(", ")}` : "";
}

/** A clip's own volume, fades and sweep in words (nothing when it has none). */
function shapeWords(clip: Clip): string {
  const words: string[] = [];
  if (clipGain(clip) !== 1) words.push(`volume ${pct(clipGain(clip))}`);
  if (clip.fadeIn) words.push(`fades in over ${r6(clip.fadeIn)} beats`);
  if (clip.fadeOut) words.push(`fades out over ${r6(clip.fadeOut)} beats`);
  if (clip.sweep) words.push(`filter sweep ${pct(clip.sweep.from)} to ${pct(clip.sweep.to)}`);
  if (clip.kind === "audio" && clip.reverse) words.push("played backwards");
  return words.length ? `; ${words.join(", ")}` : "";
}

function describeClip(song: Song, clip: Clip, index: number): string {
  const len = clipLength(clip, song.bpm);
  const where = `bar ${barOf(song, clip.start)} to ${barOf(song, clip.start + len)}`;
  if (clip.kind === "audio") return `   clip ${index} "${clip.name}" (id ${clip.id}): a recording, ${where}${shapeWords(clip)}`;
  const pitches = clip.notes.map((n) => n.pitch);
  const range = pitches.length ? (isDrums(song, clip.trackId) ? "" : `, ${pitchName(Math.min(...pitches))} to ${pitchName(Math.max(...pitches))}`) : "";
  return `   clip ${index} "${clip.name}" (id ${clip.id}): ${where}, ${plural(clip.notes.length, "note")}${range}${shapeWords(clip)}`;
}

export function describeSong(song: Song, opts: { notes?: boolean; only?: Clip } = {}): string {
  const length = songLength(song);
  const lines = [
    `Song "${song.name}": ${r6(song.bpm)} beats a minute, ${song.beatsPerBar} beats in a bar, ${r6(length / song.beatsPerBar)} bars long (${timeText(beatsToSeconds(length, song.bpm))}). Loop ${song.loop.on ? `on, bar ${barOf(song, song.loop.start)} to ${barOf(song, song.loop.end)}` : "off"}. Master volume ${pct(song.master)}.`,
  ];
  if (song.key) lines.push(`Key: ${keyWords(song.key).replace("♭", "b").replace("♯", "#")}.`);
  if (song.sections?.length) lines.push(`Sections: ${song.sections.map((x) => `${x.name} (bar ${barOf(song, x.beat)})`).join(", ")}.`);
  if (song.finish) {
    const f = finishOf(song.finish);
    lines.push(`Finishing touches: ${[f.lows ? `bass ${Math.round(f.lows * 100)}` : "", f.highs ? `treble ${Math.round(f.highs * 100)}` : "", f.squeeze ? `squeeze ${pct(f.squeeze)}` : ""].filter(Boolean).join(", ")}.`);
  }
  if (!song.tracks.length) lines.push("No tracks yet. add_track makes one; insert_library_pattern adds a ready-made beat, bass line or chords on a track of its own.");
  song.tracks.forEach((t, i) => {
    if (opts.only && opts.only.trackId !== t.id) return;
    const pan = Math.abs(t.pan) < 0.005 ? "middle" : `${pct(Math.abs(t.pan))} ${t.pan < 0 ? "left" : "right"}`;
    lines.push(
      `${i + 1}. "${t.name}" — ${t.kind === "audio" ? "a sound track (recordings)" : `plays ${t.instrument} (${instrumentLabel(t.instrument)})`}; volume ${pct(t.volume)}, ${pan}, reverb ${pct(t.reverb)}, echo ${pct(t.echo)}${effectsWords(t, song.beatsPerBar)}${t.mute ? ", MUTED" : ""}${t.solo ? ", SOLO" : ""}`,
    );
    const clips = clipsOn(song, t.id);
    if (!clips.length) lines.push("   (no clips)");
    clips.forEach((c, j) => {
      if (opts.only && opts.only.id !== c.id) return;
      lines.push(describeClip(song, c, j + 1));
      if (c.kind === "midi" && (opts.notes || opts.only)) lines.push(...describeNotes(song, c, opts.only ? 2000 : 60));
    });
  });
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The tools

const NOTE_SCHEMA = {
  type: "array",
  description: 'Notes: [{"pitch": "C4", "start": 0, "length": 1, "velocity": 96}, …]. start and length are in beats from the clip\'s start; pitch is a note name, a MIDI number, or a drum\'s name on a drums track.',
  items: { type: "object", properties: { pitch: {}, start: { type: "number" }, length: { type: "number" }, velocity: { type: "number" } }, required: ["pitch", "start"] },
};
const FILTER_SCHEMA = {
  type: "object",
  description: 'The track\'s filter: {"kind": "low" (cuts the top), "high" (cuts the bottom) or "band" (keeps a slice), "cutoff": 0–100, "resonance": 0–100}. {"kind": "low", "cutoff": 100} is off.',
  properties: { kind: { type: "string", enum: ["low", "high", "band"] }, cutoff: { type: "number" }, resonance: { type: "number" } },
};
const SHAPE_PROPS = {
  volume: { type: "number", description: "The clip's own volume, per cent 0–200 (100 = as played)." },
  fade_in: { type: "number", description: "Beats over which the clip swells in from silence (0 = none)." },
  fade_out: { type: "number", description: "Beats over which it dies away at its end (0 = none)." },
  filter_sweep: { description: 'Move the track\'s filter while the clip plays: {"from": 20, "to": 100} (0–100 as the filter\'s cutoff), or null to take a sweep off.' },
};
const TRACK_REF = { description: "The track: its name, or its number in describe_song." };
const CLIP_REF = { description: 'The clip: its name, its number on the track (with "track"; 1 = the first), or its id.' };

function liveLine(s: Session): string {
  return s.live ? s.live.status().text : "Live: not available in this copy of the extension. save_song saves a .juradaw file to open in JuraDAW.";
}

export const TOOLS: ToolDef[] = [
  {
    name: "format_guide",
    title: "How JuraDAW songs work",
    description: "Read this first: how songs, tracks, clips and notes are described to the other tools.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    run: () => say(FORMAT_GUIDE),
  },
  {
    name: "live_status",
    title: "Is JuraDAW connected live?",
    description: "Says whether the user's open JuraDAW tab is connected (Live with Claude), so changes show and can be played there as you make them — and how to connect if not.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    run: (s) => say(liveLine(s)),
  },
  {
    name: "describe_song",
    title: "Look at the song",
    description: "The song as it is now: tempo, tracks, their clips and where they sit. With \"notes\": true every clip's notes are listed (the first 60 of each); with \"clip\" just that clip, with all its notes.",
    inputSchema: { type: "object", properties: { notes: { type: "boolean" }, clip: CLIP_REF, track: TRACK_REF } },
    readOnly: true,
    run(s, a) {
      noExtras(a, ["notes", "clip", "track"], "describe_song");
      const only = a.clip !== undefined && a.clip !== null ? clipOf(s.song, a, "describe_song") : undefined;
      return say(describeSong(s.song, { notes: bool(a.notes, "notes"), only }), s.file ? `File: ${s.file}` : "Not saved to a file yet.", liveLine(s));
    },
  },
  {
    name: "list_instruments",
    title: "The built-in instruments",
    description: "The instruments a track can play.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    run: () => say("Instruments (use the id):", ...INSTRUMENT_IDS.map((id) => `- ${id}: ${instrumentLabel(id)}${isDrumKit(id) ? ` (${DRUM_PITCHES.map((d) => d.name.toLowerCase()).join(", ")})` : ""}`)),
  },
  {
    name: "list_library_patterns",
    title: "The ready-made patterns",
    description: "JuraDAW's library of drum beats, bass lines, chord sequences and melodies, with the settings each takes (key, scale, chords, bars…). Patterns given the same key, scale and chords fit together.",
    inputSchema: { type: "object", properties: { search: { type: "string", description: "Only patterns whose name, heading or description has these words." } } },
    readOnly: true,
    run(_s, a) {
      noExtras(a, ["search"], "list_library_patterns");
      const words = typeof a.search === "string" ? a.search.toLowerCase().split(/\s+/).filter(Boolean) : [];
      const hits = LIBRARY.filter((p) => words.every((w) => `${p.name} ${p.group} ${p.description} ${p.kind}`.toLowerCase().includes(w)));
      if (!hits.length) return say(`No pattern matches "${a.search}". Call list_library_patterns without "search" to see them all.`);
      const groups = [...new Set(hits.map((p) => p.group))];
      return say(
        ...groups.flatMap((g) => [
          `${g}:`,
          ...hits
            .filter((p) => p.group === g)
            .map((p) => {
              const inputs = p.inputs.map((i) => (i.kind === "count" ? `${i.key} ${i.min}–${i.max} (${i.default})` : `${i.key}: ${(i.choices ?? []).map((c) => c.value).join(" | ")} (${i.default})`)).join("; ");
              return `- ${p.id} — ${p.name}: ${p.description} Plays on ${p.instrument}${p.beatsPerBar !== 4 ? `, ${p.beatsPerBar} beats in a bar` : ""}.${inputs ? ` Settings: ${inputs}.` : ""}`;
            }),
        ]),
      );
    },
  },
  {
    name: "new_song",
    title: "Start a new song",
    description: "Start an empty song (the one being worked on is dropped unless it was saved).",
    inputSchema: { type: "object", properties: { name: { type: "string" }, tempo: { type: "number", description: `Beats a minute, ${MIN_BPM}–${MAX_BPM} (120 if left out).` }, beats_per_bar: { type: "number", description: "2–12 (4 if left out)." } } },
    destructive: true,
    run(s, a) {
      noExtras(a, ["name", "tempo", "beats_per_bar"], "new_song");
      let song = newSong(text(a.name, "name", "Untitled song"));
      song = edits.setBpm(song, num(a.tempo, "tempo", { min: MIN_BPM, max: MAX_BPM, fallback: 120 }));
      song = edits.setBeatsPerBar(song, num(a.beats_per_bar, "beats_per_bar", { min: 2, max: 12, integer: true, fallback: 4 }));
      s.reset(song, null);
      s.sounds = {};
      return say(`Started a new song, "${song.name}": ${song.bpm} beats a minute, ${song.beatsPerBar} beats in a bar. Add tracks with add_track or insert_library_pattern.`);
    },
  },
  {
    name: "list_songs",
    title: "List saved songs",
    description: "The .juradaw songs in the JuraDAW folder.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    run(s) {
      const folder = needFolder(s);
      const files = folder.list([FILE_EXTENSION]);
      return say(files.length ? `Songs in ${folder.root}:` : `There are no songs in ${folder.root} yet.`, ...files.map((f) => `- ${f.name} (${f.modified.toISOString().slice(0, 10)})`));
    },
  },
  {
    name: "open_song",
    title: "Open a saved song",
    description: "Open a .juradaw song from the JuraDAW folder to work on (the one being worked on is dropped unless it was saved).",
    inputSchema: { type: "object", properties: { filename: { type: "string" } }, required: ["filename"] },
    destructive: true,
    run(s, a) {
      noExtras(a, ["filename"], "open_song");
      const folder = needFolder(s);
      const path = folder.pathFor(text(a.filename, "filename"), [FILE_EXTENSION], "song");
      const read = readSongFile(folder.read(path), path.split(/[\\/]/).pop());
      if (!read.ok) throw new InputError(read.error);
      let song = read.song;
      let note: string | null = null;
      if (s.live?.connected && song.audio.length) {
        // The recordings can't travel over the live link, so the tab would show clips with no sound.
        song = { ...song, clips: song.clips.filter((c) => c.kind === "midi"), audio: [] };
        note = "This song has recordings, which can't be sent to the JuraDAW tab from here: they were left out. To have them, the user opens the file in JuraDAW with Open.";
      }
      s.reset(song, path.split(/[\\/]/).pop() ?? null);
      s.sounds = note ? {} : read.sounds;
      return say(`Opened "${song.name}".`, note, describeSong(song));
    },
  },
  {
    name: "save_song",
    title: "Save the song",
    description: "Save the song as a .juradaw file in the JuraDAW folder, for the user to open in JuraDAW (Open, or drag it onto the window).",
    inputSchema: { type: "object", properties: { filename: { type: "string", description: "Left out: the song's name (or the file it was opened from)." }, overwrite: { type: "boolean" } } },
    run(s, a) {
      noExtras(a, ["filename", "overwrite"], "save_song");
      const folder = needFolder(s);
      const given = typeof a.filename === "string" && a.filename.trim() ? a.filename : null;
      const path = folder.pathFor(given ?? s.file ?? fileNameFor(s.song.name), [FILE_EXTENSION], "song");
      const name = path.split(/[\\/]/).pop() ?? "";
      // Saving again to the file it came from needs no asking.
      if (name !== s.file) checkFree(s, path, a.overwrite);
      const kept = Object.fromEntries(s.song.audio.filter((x) => s.sounds[x.id]).map((x) => [x.id, s.sounds[x.id]]));
      const missing = s.song.audio.filter((x) => !kept[x.id]).length;
      writeOut(s, path, songFileText(s.song, kept));
      s.file = name;
      return say(
        `Saved ${name} in ${folder.root}. The user can open it at https://gm7dha.github.io/JuraDAW/ with Open (or by dragging the file onto the window).`,
        missing > 0 && `Note: ${plural(missing, "recording")} in this song ${missing === 1 ? "isn't" : "aren't"} in this file — recorded sound stays in the user's JuraDAW tab. To keep everything in one file, the user clicks Save in JuraDAW.`,
      );
    },
  },
  {
    name: "export_midi",
    title: "Save a MIDI file",
    description: "Save the song's notes as a standard MIDI file (.mid) in the JuraDAW folder, for other music programs. (A WAV sound file is made by the user in JuraDAW: Export.)",
    inputSchema: { type: "object", properties: { filename: { type: "string" }, overwrite: { type: "boolean" } } },
    run(s, a) {
      noExtras(a, ["filename", "overwrite"], "export_midi");
      const folder = needFolder(s);
      if (!s.song.clips.some((c) => c.kind === "midi" && c.notes.length)) throw new InputError("There are no notes in the song yet, so there's nothing to put in a MIDI file.");
      const path = folder.pathFor(typeof a.filename === "string" && a.filename.trim() ? a.filename : fileNameFor(s.song.name), [".mid"], "MIDI file");
      checkFree(s, path, a.overwrite);
      writeOut(s, path, songToMidi(s.song));
      return say(`Saved ${path.split(/[\\/]/).pop()} in ${folder.root}.`);
    },
  },
  {
    name: "set_song",
    title: "Change the song's settings",
    description: "Change the song's name, tempo, beats in a bar, master volume, the loop (the part that repeats when the user plays), its key, its named sections (Intro, Verse, Chorus…) or its finishing touches (bass, treble and squeeze on the whole song).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        tempo: { type: "number", description: `Beats a minute, ${MIN_BPM}–${MAX_BPM}.` },
        beats_per_bar: { type: "number", description: "2–12." },
        master_volume: { type: "number", description: "Per cent, 0–100 (80 is the usual)." },
        loop: { type: "object", description: '{"on": true, "start_bar": 1, "end_bar": 5} repeats bars 1 to 4.', properties: { on: { type: "boolean" }, start_bar: { type: "number" }, end_bar: { type: "number" } } },
        key: { description: 'The song\'s key, e.g. "A minor", "Eb major", "F# minor" (the app shades notes outside it and draws chords from it), or null for none.' },
        sections: { description: 'Named parts of the song, replacing those there: [{"bar": 1, "name": "Intro"}, {"bar": 5, "name": "Verse"}, {"bar": 13, "name": "Chorus"}]; each lasts until the next. [] or null takes them away.' },
        finish: { type: "object", description: 'Finishing touches on the whole song: {"bass": −100…100, "treble": −100…100, "squeeze": 0–100 (fuller and steadier)}. 0 is off.', properties: { bass: { type: "number" }, treble: { type: "number" }, squeeze: { type: "number" } } },
      },
    },
    run(s, a) {
      noExtras(a, ["name", "tempo", "beats_per_bar", "master_volume", "loop", "key", "sections", "finish"], "set_song");
      let song = s.song;
      if (a.name !== undefined) song = edits.setSongName(song, text(a.name, "name"));
      if (a.tempo !== undefined) song = edits.setBpm(song, num(a.tempo, "tempo", { min: MIN_BPM, max: MAX_BPM }));
      if (a.beats_per_bar !== undefined) song = edits.setBeatsPerBar(song, num(a.beats_per_bar, "beats_per_bar", { min: 2, max: 12, integer: true }));
      const master = share(a.master_volume, "master_volume");
      if (master !== undefined) song = edits.setMaster(song, master);
      if (a.loop !== undefined && a.loop !== null) {
        const l = object(a.loop, "loop");
        noExtras(l, ["on", "start_bar", "end_bar"], "loop");
        const start = optionalNum(l.start_bar, "loop.start_bar", { min: 1 });
        const end = optionalNum(l.end_bar, "loop.end_bar", { min: 1 });
        const from = start === undefined ? song.loop.start : beatOfBar(song, start);
        const to = end === undefined ? song.loop.end : beatOfBar(song, end);
        if (to <= from) throw new InputError(`loop: end_bar must be after start_bar (the loop runs up to the START of end_bar, so bars 1 to 4 is start_bar 1, end_bar 5).`);
        song = edits.setLoop(song, { on: bool(l.on, "loop.on", song.loop.on), start: from, end: to });
      }
      if (a.key === null) song = edits.setKey(song, null);
      else if (a.key !== undefined) song = edits.setKey(song, keyOf(a.key));
      if (a.sections === null) song = edits.setSections(song, []);
      else if (a.sections !== undefined) {
        const given = list(a.sections, "sections", { allowEmpty: true }).map((x, i) => {
          const o = object(x, `sections[${i}]`);
          noExtras(o, ["bar", "name"], `sections[${i}]`);
          return { beat: beatOfBar(song, num(o.bar, `sections[${i}].bar`, { min: 1, max: MOST_BEATS / song.beatsPerBar })), name: text(o.name, `sections[${i}].name`) };
        });
        if (given.length > MOST_SECTIONS) throw new InputError(`A song can have at most ${MOST_SECTIONS} sections.`);
        if (new Set(given.map((g) => g.beat)).size !== given.length) throw new InputError("Two sections start at the same bar: give each its own.");
        song = edits.setSections(song, given);
      }
      if (a.finish !== undefined && a.finish !== null) {
        const f = object(a.finish, "finish");
        noExtras(f, ["bass", "treble", "squeeze"], "finish");
        const patch: Partial<Finish> = {};
        const bass = optionalNum(f.bass, "finish.bass (−100 to 100)", { min: -100, max: 100 });
        if (bass !== undefined) patch.lows = r6(bass / 100);
        const treble = optionalNum(f.treble, "finish.treble (−100 to 100)", { min: -100, max: 100 });
        if (treble !== undefined) patch.highs = r6(treble / 100);
        const squeeze = share(f.squeeze, "finish.squeeze");
        if (squeeze !== undefined) patch.squeeze = squeeze;
        song = edits.setFinish(song, patch);
      }
      if (!s.commit(song)) return say("Nothing was changed (those are the song's settings already).");
      return say(describeSong(song).split("\n").filter((line, i) => i === 0 || /^(Key|Sections|Finishing touches):/.test(line)).join("\n"));
    },
  },
  {
    name: "add_track",
    title: "Add a track",
    description: "Add an instrument track. (Sound tracks, for recording a voice or a real instrument, are added by the user in JuraDAW.)",
    inputSchema: {
      type: "object",
      properties: {
        instrument: { type: "string", enum: [...INSTRUMENT_IDS] },
        name: { type: "string", description: "Left out: named after the instrument." },
        volume: { type: "number", description: "Per cent, 0–100 (80 is the usual)." },
        pan: { type: "number", description: "−100 (left) to 100 (right); 0 is the middle." },
        reverb: { type: "number", description: "Per cent, 0–100." },
        echo: { type: "number", description: "Per cent, 0–100." },
        drive: { type: "number", description: "Per cent, 0–100: warmth, then grit, then fuzz." },
        crush: { type: "number", description: "Per cent, 0–100: lo-fi, bit-crushed." },
        filter: FILTER_SCHEMA,
        wobble: { type: "number", description: "Per cent, 0–100: a slow pitch drift that widens the sound." },
        pump: { type: "number", description: "Per cent, 0–100: the volume dips on every beat and swells back." },
        bass: { type: "number", description: "−100 to 100: less or more of the low end." },
        treble: { type: "number", description: "−100 to 100: less or more of the top end." },
        chop: { type: "number", description: "Per cent, 0–100: cuts the sound into sixteenth notes (stutters)." },
        squeeze: { type: "number", description: "Per cent, 0–100: a compressor — evens out loud and quiet, steadier and punchier." },
        sway: { type: "number", description: "Per cent, 0–100: the sound swings left and right once a bar." },
        swirl: { type: "number", description: "Per cent, 0–100: a phaser — a slow, sweeping, hollow whoosh." },
        swing: { type: "number", description: "Per cent, 0–100: off-beat notes come late (100 = a full triplet shuffle). Instrument tracks." },
        filter_wobble: { description: 'The filter opens and closes in time: {"rate": beats for one wobble — 2, 1, 0.5, 0.333 or 0.25 —, "depth": 0–100}, or null for off.' },
        sound: { description: 'For instrument "custom" (Your own sound): {"preset": "Warm pad" | "Lead" | "Pluck" | "Deep bass" | "Whistle" | "Retro beep" (a starting point), "wave": "smooth" | "soft" | "hollow" | "bright", and 0–100: "brightness", "fade_in", "hold", "ring_on", "thickness", "bass_layer", "vibrato"}; null for the usual sound.' },
        arpeggiator: { description: 'Chords played one note at a time: {"style": "up" | "down" | "updown" | "random", "rate": "beats" | "eighths" | "triplets" | "sixteenths", "octaves": 1–3}, or null for off.' },
        harmoniser: { description: 'Extra voices at other pitches along with the track: {"voices": "below" (an octave down) | "fifth" (a fifth up) | "major" (third and fifth up: bright) | "minor" (minor third and fifth up: dark) | "wide" (an octave down and up), "volume": 0–100}, or null for off.' },
      },
      required: ["instrument"],
    },
    run(s, a) {
      noExtras(a, ["instrument", "name", "volume", "pan", "reverb", "echo", "drive", "crush", "filter", "wobble", "pump", "bass", "treble", "chop", "arpeggiator", "harmoniser", "squeeze", "sway", "swirl", "swing", "filter_wobble", "sound"], "add_track");
      if (s.song.tracks.length >= MOST_TRACKS) throw new InputError(`A song can have at most ${MOST_TRACKS} tracks. Remove one first, or put this part on a track that's there.`);
      const made = newTrack("instrument", instrumentOf(a.instrument, "instrument"), s.song.tracks);
      const patch = trackPatch(a, "add_track");
      if (patch.name !== undefined && s.song.tracks.some((t) => sameName(t.name, patch.name ?? ""))) throw new InputError(`There's already a track called "${patch.name}". Give this one another name.`);
      const added = edits.updateTrack(edits.addTrack(s.song, made), made.id, patch);
      const track = added.tracks.find((t) => t.id === made.id) ?? made;
      s.commit(added);
      return say(`Added track ${s.song.tracks.length}, "${track.name}", playing ${track.instrument}. Put notes on it with add_clip.`);
    },
  },
  {
    name: "edit_track",
    title: "Change a track",
    description: "Change a track's name, instrument, volume, left–right, reverb, echo, its own effects (drive, crush, filter, wobble, pump, bass, treble, chop), arpeggiator, harmoniser, mute or solo.",
    inputSchema: {
      type: "object",
      properties: {
        track: TRACK_REF,
        name: { type: "string" },
        instrument: { type: "string", enum: [...INSTRUMENT_IDS] },
        volume: { type: "number" },
        pan: { type: "number" },
        reverb: { type: "number" },
        echo: { type: "number" },
        drive: { type: "number", description: "Per cent, 0–100: warmth, then grit, then fuzz." },
        crush: { type: "number", description: "Per cent, 0–100: lo-fi, bit-crushed." },
        filter: FILTER_SCHEMA,
        wobble: { type: "number", description: "Per cent, 0–100: a slow pitch drift that widens the sound." },
        pump: { type: "number", description: "Per cent, 0–100: the volume dips on every beat and swells back." },
        bass: { type: "number", description: "−100 to 100: less or more of the low end." },
        treble: { type: "number", description: "−100 to 100: less or more of the top end." },
        chop: { type: "number", description: "Per cent, 0–100: cuts the sound into sixteenth notes (stutters)." },
        squeeze: { type: "number", description: "Per cent, 0–100: a compressor — evens out loud and quiet, steadier and punchier." },
        sway: { type: "number", description: "Per cent, 0–100: the sound swings left and right once a bar." },
        swirl: { type: "number", description: "Per cent, 0–100: a phaser — a slow, sweeping, hollow whoosh." },
        swing: { type: "number", description: "Per cent, 0–100: off-beat notes come late (100 = a full triplet shuffle). Instrument tracks." },
        filter_wobble: { description: 'The filter opens and closes in time: {"rate": beats for one wobble — 2, 1, 0.5, 0.333 or 0.25 —, "depth": 0–100}, or null for off.' },
        sound: { description: 'For instrument "custom" (Your own sound): {"preset": "Warm pad" | "Lead" | "Pluck" | "Deep bass" | "Whistle" | "Retro beep" (a starting point), "wave": "smooth" | "soft" | "hollow" | "bright", and 0–100: "brightness", "fade_in", "hold", "ring_on", "thickness", "bass_layer", "vibrato"}; null for the usual sound.' },
        arpeggiator: { description: 'Chords played one note at a time: {"style": "up" | "down" | "updown" | "random", "rate": "beats" | "eighths" | "triplets" | "sixteenths", "octaves": 1–3}, or null for off.' },
        harmoniser: { description: 'Extra voices at other pitches along with the track: {"voices": "below" (an octave down) | "fifth" (a fifth up) | "major" (third and fifth up: bright) | "minor" (minor third and fifth up: dark) | "wide" (an octave down and up), "volume": 0–100}, or null for off.' },
        mute: { type: "boolean" },
        solo: { type: "boolean" },
      },
      required: ["track"],
    },
    run(s, a) {
      noExtras(a, ["track", "name", "instrument", "volume", "pan", "reverb", "echo", "drive", "crush", "filter", "wobble", "pump", "bass", "treble", "chop", "arpeggiator", "harmoniser", "squeeze", "sway", "swirl", "swing", "filter_wobble", "sound", "mute", "solo"], "edit_track");
      const track = trackOf(s.song, a.track, "edit_track");
      const patch: edits.TrackPatch = trackPatch(a, "edit_track");
      if (a.instrument !== undefined) {
        if (track.kind !== "instrument") throw new InputError(`"${track.name}" is a sound track (recordings), so it has no instrument to change.`);
        patch.instrument = instrumentOf(a.instrument, "instrument");
      }
      if (a.mute !== undefined) patch.mute = bool(a.mute, "mute");
      if (a.solo !== undefined) patch.solo = bool(a.solo, "solo");
      if (patch.name !== undefined && s.song.tracks.some((t) => t.id !== track.id && sameName(t.name, patch.name ?? ""))) throw new InputError(`There's already a track called "${patch.name}". Choose another name.`);
      if (!s.commit(edits.updateTrack(s.song, track.id, patch))) return say(`Nothing was changed: "${track.name}" is like that already.`);
      const now = s.song.tracks.find((t) => t.id === track.id);
      return say(`Changed "${track.name}"${now && now.name !== track.name ? ` (now "${now.name}")` : ""}.`);
    },
  },
  {
    name: "set_automation",
    title: "Draw an automation line",
    description:
      'Draw a line over the song that changes a track\'s volume, filter cutoff or left–right place as it plays (a fade-out, a filter that opens over 8 bars, a sound drifting left to right). Points are {"bar": 1–…, "value": …}; bar 1.5 is halfway through bar 1; straight lines join them, and before the first and after the last the line holds still. Values: volume 0–100 (80 = the usual), filter 0–100 (as the filter\'s cutoff; the track\'s filter kind decides what it cuts), pan −100 (left) to 100 (right). The line replaces the one already there; "points": null takes it off.',
    inputSchema: {
      type: "object",
      properties: {
        track: TRACK_REF,
        what: { type: "string", enum: ["volume", "filter", "pan"] },
        points: { description: 'A list like [{"bar": 1, "value": 0}, {"bar": 9, "value": 80}], or null to take the line off.' },
      },
      required: ["track", "what", "points"],
    },
    run(s, a) {
      noExtras(a, ["track", "what", "points"], "set_automation");
      const track = trackOf(s.song, a.track, "set_automation");
      const what = oneOf(a.what, AUTO_PARAMS, "what");
      const bpb = s.song.beatsPerBar;
      let points: AutoPoint[] | null = null;
      if (a.points !== null) {
        points = list(a.points, "points").map((p, i) => {
          const o = object(p, `points[${i}]`);
          noExtras(o, ["bar", "value"], `points[${i}]`);
          const bar = num(o.bar, `points[${i}].bar`, { min: 1, max: MOST_BEATS / bpb + 1 });
          const value = num(o.value, `points[${i}].value`, what === "pan" ? { min: -100, max: 100 } : { min: 0, max: 100 });
          return { beat: r6((bar - 1) * bpb), value: r6(what === "pan" ? (value + 100) / 200 : value / 100) };
        });
        if (points.length > MOST_POINTS) throw new InputError(`A line can have at most ${MOST_POINTS} points.`);
        if (new Set(points.map((p) => p.beat)).size !== points.length) throw new InputError("Two points are on the same place: give each point its own bar.");
      }
      const name = AUTO_NAMES[what].toLowerCase();
      if (!s.commit(edits.setAutomation(s.song, track.id, what, points))) return say(points ? `Nothing was changed: "${track.name}" has that ${name} line already.` : `"${track.name}" has no ${name} line.`);
      return say(points ? `Drew a ${name} line on "${track.name}" with ${plural(points.length, "point")}.` : `Took the ${name} line off "${track.name}": it's back to its own setting.`);
    },
  },
  {
    name: "remove_track",
    title: "Remove a track",
    description: "Remove a track and every clip on it.",
    inputSchema: { type: "object", properties: { track: TRACK_REF }, required: ["track"] },
    destructive: true,
    run(s, a) {
      noExtras(a, ["track"], "remove_track");
      const track = trackOf(s.song, a.track, "remove_track");
      const clips = clipsOn(s.song, track.id).length;
      s.commit(edits.removeTrack(s.song, track.id));
      return say(`Removed "${track.name}" and its ${plural(clips, "clip")}.`);
    },
  },
  {
    name: "add_clip",
    title: "Add a clip of notes",
    description: "Put a new clip on an instrument track, with its notes. Left out, the clip starts after the last clip on that track and is as many whole bars long as its notes need.",
    inputSchema: {
      type: "object",
      properties: {
        track: TRACK_REF,
        start_bar: { type: "number", description: "The bar it starts at, from 1." },
        bars: { type: "number", description: "How many bars long." },
        name: { type: "string" },
        notes: NOTE_SCHEMA,
        ...SHAPE_PROPS,
      },
      required: ["track"],
    },
    run(s, a) {
      noExtras(a, ["track", "start_bar", "bars", "name", "notes", "volume", "fade_in", "fade_out", "filter_sweep"], "add_clip");
      const song = s.song;
      const track = trackOf(song, a.track, "add_clip");
      if (track.kind !== "instrument") throw new InputError(`"${track.name}" is a sound track (recordings): notes go on an instrument track. Add one with add_track.`);
      const drums = isDrumKit(track.instrument);
      const notes = notesOf(a.notes, "notes", drums);
      const bpb = song.beatsPerBar;
      const last = clipsOn(song, track.id).reduce((m, c) => Math.max(m, clipEnd(c, song.bpm)), 0);
      const startBar = optionalNum(a.start_bar, "start_bar", { min: 1, max: MOST_BEATS / bpb });
      const start = startBar === undefined ? Math.ceil(last / bpb - 1e-9) * bpb : beatOfBar(song, startBar);
      const need = notes.reduce((m, n) => Math.max(m, n.start + n.length), 0);
      const bars = optionalNum(a.bars, "bars", { min: 0.25, max: 2000 });
      const length = bars === undefined ? Math.max(1, Math.ceil(need / bpb - 1e-9)) * bpb : r6(bars * bpb);
      const outside = notes.filter((n) => n.start >= length - 1e-9).length;
      if (outside) throw new InputError(`${plural(outside, "note")} start${outside === 1 ? "s" : ""} after the end of a ${r6(length / bpb)}-bar clip (${length} beats). Note starts are counted in beats from the clip's own start, not from the start of the song. Leave "bars" out to fit them all, or give more bars.`);
      needRoom(song, track, start, length, "add_clip");
      const clip: MidiClip = { ...edits.makeMidiClip(track, start, length, typeof a.name === "string" && a.name.trim() ? text(a.name, "name") : track.name), notes: edits.makeNotes(notes.map((n) => ({ ...n, length: Math.min(n.length, r6(length - n.start)) }))) };
      const next = edits.addClips(song, [clip]);
      if (next === song) throw new InputError("The song is full (too many clips). Remove some first.");
      s.commit(edits.updateClip(next, clip.id, shapePatch(a, "add_clip")));
      const now = edits.findClip(s.song, clip.id) ?? clip;
      return say(`Added clip "${clip.name}" (id ${clip.id}) to "${track.name}": bar ${barOf(song, start)} to ${barOf(song, start + length)}, ${plural(notes.length, "note")}${shapeWords(now)}.`);
    },
  },
  {
    name: "add_notes",
    title: "Add notes to a clip",
    description:
      'Add notes to a clip that\'s there — as "notes", or as "steps": rows of a step-sequencer grid, one letter a step from the clip\'s start, e.g. {"kick": "x...x...x...x...", "snare": "....x.......x...", "closed hat": "x.x.x.x.x.x.x.x."} (X accented, x normal, o soft, g a ghost note, "." a rest; each step a sixteenth unless "step" says otherwise). The clip grows by whole bars if a note runs past its end.',
    inputSchema: {
      type: "object",
      properties: {
        clip: CLIP_REF,
        track: TRACK_REF,
        notes: NOTE_SCHEMA,
        steps: { type: "object", description: 'Rows of steps by pitch or drum name: {"kick": "x...x...", "C3": "x.x....."}.' },
        step: { type: "number", description: "Beats a step: 0.25 (sixteenths, the usual), 0.5 (eighths) or 0.333 (triplets)." },
      },
    },
    run(s, a) {
      noExtras(a, ["clip", "track", "notes", "steps", "step"], "add_notes");
      const clip = midiClipOf(s.song, a, "add_notes");
      const drums = isDrums(s.song, clip.trackId);
      if (a.notes === undefined && a.steps === undefined) throw new InputError('add_notes needs "notes" or "steps".');
      const notes = a.notes === undefined ? [] : notesOf(a.notes, "notes", drums, { allowEmpty: false });
      if (a.steps !== undefined) {
        const rows = object(a.steps, "steps");
        const step = a.step === undefined ? 0.25 : STEP_CHOICES.find((c) => Math.abs(c.step - num(a.step, "step", { min: 0.2, max: 1 })) < 0.02)?.step;
        if (step === undefined) throw new InputError("step should be 0.25 (sixteenths), 0.5 (eighths) or 0.333 (triplets).");
        for (const [name, pattern] of Object.entries(rows)) {
          const pitch = pitchOf(name, `steps."${name}"`, drums);
          const made = stepsToNotes(pitch, text(pattern, `steps."${name}"`), step, drums ? Math.min(step, 0.25) : step);
          notes.push(...made);
        }
        if (!notes.length) throw new InputError('Those steps are all rests: write "x" where a note should play.');
      }
      const done = edits.addNotes(s.song, clip.id, notes);
      if (!done || !s.commit(done.song)) throw new InputError(`"${clip.name}" can't hold that many notes (a clip holds at most 20,000). Put them in another clip.`);
      const now = edits.findMidiClip(s.song, clip.id);
      const grew = now && now.length > clip.length + 1e-9;
      // Growing mustn't push the clip over the next one on its track.
      if (now && grew && !edits.placeIsFree(s.song, now.trackId, now.start, now.length, [now.id])) {
        s.undo();
        throw new InputError(`Those notes run past the end of "${clip.name}", and there's another clip straight after it on the track, so it can't grow. Keep the notes inside its ${r6(clip.length)} beats, or move or remove the next clip first.`);
      }
      return say(`Added ${plural(notes.length, "note")} to "${clip.name}" (now ${plural(now?.notes.length ?? 0, "note")}${grew && now ? `, and ${r6(now.length / s.song.beatsPerBar)} bars long` : ""}).`);
    },
  },
  {
    name: "remove_notes",
    title: "Remove notes from a clip",
    description: "Remove notes from a clip: all of them, or only those starting between two beats and/or of one pitch.",
    inputSchema: {
      type: "object",
      properties: { clip: CLIP_REF, track: TRACK_REF, from_beat: { type: "number" }, to_beat: { type: "number", description: "Notes starting before this beat." }, pitch: { description: "Only this pitch (a note name, number or drum)." } },
    },
    destructive: true,
    run(s, a) {
      noExtras(a, ["clip", "track", "from_beat", "to_beat", "pitch"], "remove_notes");
      const clip = midiClipOf(s.song, a, "remove_notes");
      const from = optionalNum(a.from_beat, "from_beat", { min: 0 }) ?? 0;
      const to = optionalNum(a.to_beat, "to_beat", { min: 0 }) ?? Infinity;
      const pitch = a.pitch === undefined || a.pitch === null ? null : pitchOf(a.pitch, "pitch", isDrums(s.song, clip.trackId));
      const ids = clip.notes.filter((n) => n.start >= from - 1e-9 && n.start < to - 1e-9 && (pitch === null || n.pitch === pitch)).map((n) => n.id);
      if (!ids.length) return say(`No notes in "${clip.name}" match, so nothing was removed.`);
      s.commit(edits.removeNotes(s.song, clip.id, ids));
      return say(`Removed ${plural(ids.length, "note")} from "${clip.name}" (${plural(clip.notes.length - ids.length, "note")} left).`);
    },
  },
  {
    name: "edit_clip",
    title: "Change a clip",
    description: "Rename a clip, move it (to another bar or track), make it longer or shorter, change all its notes at once (transpose, set every velocity, tidy the timing onto a grid), or shape it: its own volume, a fade in or out, a filter sweep.",
    inputSchema: {
      type: "object",
      properties: {
        clip: CLIP_REF,
        track: TRACK_REF,
        name: { type: "string" },
        start_bar: { type: "number" },
        bars: { type: "number" },
        to_track: { description: "Move it to this track (by name or number)." },
        transpose: { type: "number", description: "Semitones: 12 is an octave up, −12 an octave down." },
        velocity: { type: "number", description: "Every note's velocity, 1–127." },
        tidy_timing: { type: "number", description: "Move note starts onto a grid of this many beats (0.25 = sixteenth notes, 0.5 = eighths, 1 = beats)." },
        ...SHAPE_PROPS,
        reverse: { type: "boolean", description: "A recording's clip: true plays it backwards." },
      },
    },
    run(s, a) {
      noExtras(a, ["clip", "track", "name", "start_bar", "bars", "to_track", "transpose", "velocity", "tidy_timing", "volume", "fade_in", "fade_out", "filter_sweep", "reverse"], "edit_clip");
      let song = s.song;
      const clip = clipOf(song, a, "edit_clip");
      const did: string[] = [];
      const bpb = song.beatsPerBar;
      if (a.name !== undefined) {
        song = edits.updateClip(song, clip.id, { name: text(a.name, "name") });
        did.push("renamed");
      }
      const startBar = optionalNum(a.start_bar, "start_bar", { min: 1, max: MOST_BEATS / bpb });
      const bars = optionalNum(a.bars, "bars", { min: 0.25, max: 2000 });
      const toTrack = a.to_track === undefined || a.to_track === null ? null : trackOf(song, a.to_track, "to_track");
      if (startBar !== undefined || bars !== undefined || toTrack) {
        const home = toTrack ?? song.tracks.find((t) => t.id === clip.trackId);
        if (!home) throw new InputError("That clip's track is missing.");
        if (!edits.clipFitsTrack(clip, home)) throw new InputError(`"${clip.name}" ${clip.kind === "midi" ? "is notes, so it goes on an instrument track" : "is a recording, so it goes on a sound track"} — not on "${home.name}".`);
        if (bars !== undefined && clip.kind !== "midi") throw new InputError(`"${clip.name}" is a recording: its length is the length of the sound, so "bars" can't be set.`);
        const start = startBar === undefined ? clip.start : beatOfBar(song, startBar);
        const length = bars === undefined ? clipLength(clip, song.bpm) : r6(bars * bpb);
        needRoom(song, home, start, length, "edit_clip", [clip.id]);
        song = edits.updateClip(song, clip.id, { trackId: home.id, start, ...(bars !== undefined ? { length } : {}) });
        if (toTrack && toTrack.id !== clip.trackId) did.push(`moved to "${toTrack.name}"`);
        if (startBar !== undefined) did.push(`now starts at bar ${barOf(song, start)}`);
        if (bars !== undefined) did.push(`now ${r6(bars)} bars long`);
      }
      const wantsNotes = a.transpose !== undefined || a.velocity !== undefined || a.tidy_timing !== undefined;
      if (wantsNotes) {
        if (clip.kind !== "midi") throw new InputError(`"${clip.name}" is a recording (sound), not notes, so its notes can't be changed.`);
        const ids = clip.notes.map((n) => n.id);
        if (a.transpose !== undefined) {
          const semis = num(a.transpose, "transpose", { min: -60, max: 60, integer: true });
          if (isDrums(song, clip.trackId)) throw new InputError("Transposing a drum clip would swap its drums for others. Change the drum notes themselves instead (remove_notes, add_notes).");
          song = edits.transposeNotes(song, clip.id, ids, semis);
          did.push(`moved ${semis > 0 ? "up" : "down"} ${plural(Math.abs(semis), "semitone")}`);
        }
        if (a.velocity !== undefined) {
          song = edits.setNotesVelocity(song, clip.id, ids, num(a.velocity, "velocity", { min: 1, max: 127 }));
          did.push("velocities set");
        }
        if (a.tidy_timing !== undefined) {
          song = edits.quantiseNotes(song, clip.id, ids, num(a.tidy_timing, "tidy_timing (beats)", { min: MIN_LENGTH, max: 16 }));
          did.push("timing tidied");
        }
      }
      if (a.reverse !== undefined) {
        if (clip.kind !== "audio") throw new InputError(`"${clip.name}" is notes, not a recording: only recordings can be played backwards. (Write the notes in the other order instead.)`);
        song = edits.updateClip(song, clip.id, { reverse: bool(a.reverse, "reverse") });
        did.push(bool(a.reverse, "reverse") ? "now played backwards" : "now played forwards");
      }
      const shape = shapePatch(a, "edit_clip");
      if (Object.keys(shape).length) {
        song = edits.updateClip(song, clip.id, shape);
        const now = edits.findClip(song, clip.id);
        did.push(now && shapeWords(now) ? shapeWords(now).slice(2) : "its own volume, fades and sweep taken off");
      }
      if (!did.length) throw new InputError("edit_clip: say what to change: name, start_bar, bars, to_track, transpose, velocity, tidy_timing, volume, fade_in, fade_out or filter_sweep.");
      if (!s.commit(song)) return say(`Nothing was changed: "${clip.name}" is like that already.`);
      return say(`"${clip.name}": ${did.join(", ")}.`);
    },
  },
  {
    name: "repeat_clip",
    title: "Repeat a clip",
    description: "Copy a clip straight after itself, a number of times (to make a 2-bar beat last 8 bars: times 3).",
    inputSchema: { type: "object", properties: { clip: CLIP_REF, track: TRACK_REF, times: { type: "number", description: "How many more copies, 1–64." } }, required: ["times"] },
    run(s, a) {
      noExtras(a, ["clip", "track", "times"], "repeat_clip");
      const clip = clipOf(s.song, a, "repeat_clip");
      const times = num(a.times, "times", { min: 1, max: edits.MOST_REPEATS, integer: true });
      const length = clipLength(clip, s.song.bpm);
      const track = s.song.tracks.find((t) => t.id === clip.trackId);
      if (track) needRoom(s.song, track, clip.start + length, length * times, "repeat_clip", [clip.id]);
      const done = edits.repeatClips(s.song, [clip.id], times);
      if (!done || !s.commit(done.song)) throw new InputError("The song has no room for that many copies (too many clips, or it would run past the longest a song can be).");
      return say(`Repeated "${clip.name}" ${plural(done.ids.length, "more time")}: it now runs to bar ${barOf(s.song, clip.start + length * (done.ids.length + 1))}.`);
    },
  },
  {
    name: "remove_clip",
    title: "Remove a clip",
    description: "Remove a clip from the song.",
    inputSchema: { type: "object", properties: { clip: CLIP_REF, track: TRACK_REF } },
    destructive: true,
    run(s, a) {
      noExtras(a, ["clip", "track"], "remove_clip");
      const clip = clipOf(s.song, a, "remove_clip");
      s.commit(edits.removeClips(s.song, [clip.id]));
      return say(`Removed "${clip.name}".`);
    },
  },
  {
    name: "insert_library_pattern",
    title: "Put in a ready-made pattern",
    description: "Put a pattern from JuraDAW's library (see list_library_patterns) in the song as a clip. Left out, it goes on a track of its own instrument (a new one if need be), after what's already there. Give the same key, scale and chords to patterns that should fit together.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "The pattern's id." },
        settings: { type: "object", description: 'Its settings, e.g. {"key": "A", "scale": "minor", "times": 2}. Left out: its defaults.' },
        track: TRACK_REF,
        start_bar: { type: "number" },
      },
      required: ["pattern"],
    },
    run(s, a) {
      noExtras(a, ["pattern", "settings", "track", "start_bar"], "insert_library_pattern");
      const id = text(a.pattern, "pattern");
      const pattern = findPattern(id) ?? LIBRARY.find((p) => sameName(p.name, id));
      if (!pattern) throw new InputError(`There's no pattern "${id}" in the library. list_library_patterns shows them (use the id).`);
      const given = a.settings === undefined || a.settings === null ? {} : object(a.settings, "settings");
      noExtras(given, pattern.inputs.map((i) => i.key), `settings of ${pattern.id}`);
      const values = cleanValues(pattern, given);
      for (const input of pattern.inputs) {
        if (given[input.key] !== undefined && String(values[input.key]) !== String(given[input.key])) {
          throw new InputError(`settings.${input.key}: ${JSON.stringify(given[input.key])} isn't possible for "${pattern.name}". ${input.kind === "count" ? `Give a whole number from ${input.min} to ${input.max}.` : `Choose one of: ${(input.choices ?? []).map((c) => c.value).join(", ")}.`}`);
        }
      }
      const made = makePattern(pattern, values);
      let song = s.song;
      const bpb = song.beatsPerBar;
      let track: Track | null = a.track === undefined || a.track === null ? null : trackOf(song, a.track, "insert_library_pattern");
      if (track && (track.kind !== "instrument" || !patternSuitsInstrument(pattern, track.instrument))) {
        throw new InputError(`"${pattern.name}" is a ${pattern.kind === "drums" ? "drum beat, which only sounds right on a drums track" : pattern.kind === "bass" ? "bass line, which goes on a bass or synth-bass track" : "part for a tuned instrument, not the drums"} — "${track.name}" ${track.kind === "instrument" ? `plays ${track.instrument}` : "is a sound track"}. Leave "track" out and it gets a track of its own.`);
      }
      const startBar = optionalNum(a.start_bar, "start_bar", { min: 1, max: MOST_BEATS / bpb });
      const wanted = startBar === undefined ? null : beatOfBar(song, startBar);
      const fits = (t: Track) => t.kind === "instrument" && (wanted === null || edits.placeIsFree(song, t.id, wanted, made.length));
      if (!track) track = song.tracks.find((t) => fits(t) && t.instrument === pattern.instrument) ?? (pattern.kind === "drums" ? song.tracks.find((t) => fits(t) && isDrumKit(t.instrument)) : undefined) ?? null;
      let madeTrack = false;
      if (!track) {
        if (song.tracks.length >= MOST_TRACKS) throw new InputError(`A song can have at most ${MOST_TRACKS} tracks. Say which track to put it on.`);
        track = newTrack("instrument", pattern.instrument, song.tracks);
        song = edits.addTrack(song, track);
        madeTrack = true;
      }
      const end = clipsOn(song, track.id).reduce((m, c) => Math.max(m, clipEnd(c, song.bpm)), 0);
      const start = wanted ?? Math.ceil(end / bpb - 1e-9) * bpb;
      needRoom(song, track, start, made.length, "insert_library_pattern");
      const clip: MidiClip = { ...edits.makeMidiClip(track, start, made.length, pattern.name), notes: edits.makeNotes(made.notes) };
      const next = edits.addClips(song, [clip]);
      if (next === song) throw new InputError("The song is full (too many clips). Remove some first.");
      s.commit(next);
      const shown = Object.entries(values).map(([k, v]) => `${k} ${v}`).join(", ");
      return say(
        `Put "${pattern.name}"${shown ? ` (${shown})` : ""} on ${madeTrack ? "a new track, " : ""}"${track.name}": bar ${barOf(song, start)} to ${barOf(song, start + made.length)}, ${plural(made.notes.length, "note")} (clip id ${clip.id}).`,
        pattern.beatsPerBar !== bpb && `Note: this pattern is written with ${pattern.beatsPerBar} beats in a bar and the song has ${bpb} (set_song can change that).`,
      );
    },
  },
  {
    name: "undo",
    title: "Undo your last change",
    description: "Take back the last change you made to the song (one step at a time).",
    inputSchema: { type: "object", properties: {} },
    run(s) {
      if (!s.undo()) return say(s.live?.connected ? "There's nothing of yours to undo here. (The user can undo any step in JuraDAW with its Undo button.)" : "There's nothing to undo.");
      return say("Undid the last change.", describeSong(s.song));
    },
  },
];

/** A track's settings from what Claude gave (only the ones given). */
function trackPatch(a: Obj, where: string): edits.TrackPatch {
  const patch: edits.TrackPatch = {};
  if (a.name !== undefined && a.name !== null) patch.name = text(a.name, `${where}.name`).slice(0, 60);
  const volume = share(a.volume, `${where}.volume`);
  if (volume !== undefined) patch.volume = volume;
  const pan = optionalNum(a.pan, `${where}.pan`, { min: -100, max: 100 });
  if (pan !== undefined) patch.pan = r6(pan / 100);
  const reverb = share(a.reverb, `${where}.reverb`);
  if (reverb !== undefined) patch.reverb = reverb;
  const echo = share(a.echo, `${where}.echo`);
  if (echo !== undefined) patch.echo = echo;
  for (const [given, key] of [["drive", "drive"], ["crush", "crush"], ["wobble", "chorus"], ["pump", "pump"], ["chop", "chop"], ["squeeze", "squeeze"], ["sway", "sway"], ["swirl", "swirl"], ["swing", "swing"]] as const) {
    const amount = share(a[given], `${where}.${given}`);
    if (amount !== undefined) patch[key] = amount;
  }
  for (const [given, key] of [["bass", "lows"], ["treble", "highs"]] as const) {
    const amount = optionalNum(a[given], `${where}.${given} (−100 to 100)`, { min: -100, max: 100 });
    if (amount !== undefined) patch[key] = r6(amount / 100);
  }
  if (a.arpeggiator === null) patch.arp = null;
  else if (a.arpeggiator !== undefined) {
    const g = object(a.arpeggiator, `${where}.arpeggiator`);
    noExtras(g, ["style", "rate", "octaves"], `${where}.arpeggiator`);
    const arp: NonNullable<edits.TrackPatch["arp"]> = {};
    if (g.style !== undefined) arp.style = oneOf(g.style, ARP_STYLES, `${where}.arpeggiator.style`);
    if (g.rate !== undefined) arp.rate = ARP_RATE_NAMES[oneOf(g.rate, ["beats", "eighths", "triplets", "sixteenths"] as const, `${where}.arpeggiator.rate`)];
    if (g.octaves !== undefined) arp.octaves = num(g.octaves, `${where}.arpeggiator.octaves`, { min: 1, max: 3, integer: true });
    patch.arp = arp;
  }
  if (a.sound === null) patch.sound = null;
  else if (a.sound !== undefined) {
    const g = object(a.sound, `${where}.sound`);
    const names = { brightness: "brightness", fade_in: "fadeIn", hold: "hold", ring_on: "ringOn", thickness: "thickness", bass_layer: "bassLayer", vibrato: "vibrato" } as const;
    noExtras(g, ["preset", "wave", ...Object.keys(names)], `${where}.sound`);
    const sound: NonNullable<edits.TrackPatch["sound"]> = {};
    if (g.preset !== undefined) {
      const preset = SOUND_PRESETS.find((p) => p.name.toLowerCase() === String(g.preset).toLowerCase());
      if (!preset) throw new InputError(`${where}.sound.preset should be one of ${SOUND_PRESETS.map((p) => `"${p.name}"`).join(", ")}.`);
      Object.assign(sound, preset.sound);
    }
    if (g.wave !== undefined) sound.wave = oneOf(g.wave, SOUND_WAVES.map((w) => w.wave), `${where}.sound.wave`);
    for (const [given, key] of Object.entries(names) as [keyof typeof names, (typeof names)[keyof typeof names]][]) {
      const v = share(g[given], `${where}.sound.${given}`);
      if (v !== undefined) sound[key] = v;
    }
    patch.sound = sound;
  }
  if (a.filter_wobble === null) patch.filterWobble = null;
  else if (a.filter_wobble !== undefined) {
    const g = object(a.filter_wobble, `${where}.filter_wobble`);
    noExtras(g, ["rate", "depth"], `${where}.filter_wobble`);
    const wobble: NonNullable<edits.TrackPatch["filterWobble"]> = {};
    if (g.rate !== undefined) {
      const rate = num(g.rate, `${where}.filter_wobble.rate`, { min: 0.2, max: 2 });
      const match = WOBBLE_RATES.find((r) => Math.abs(r - rate) < 0.02);
      if (match === undefined) throw new InputError(`${where}.filter_wobble.rate should be 2, 1, 0.5, 0.333 or 0.25 (beats for one wobble).`);
      wobble.rate = match;
    }
    const depth = share(g.depth, `${where}.filter_wobble.depth`);
    if (depth !== undefined) wobble.depth = depth;
    patch.filterWobble = wobble;
  }
  if (a.harmoniser === null) patch.harmony = null;
  else if (a.harmoniser !== undefined) {
    const g = object(a.harmoniser, `${where}.harmoniser`);
    noExtras(g, ["voices", "volume"], `${where}.harmoniser`);
    const harmony: NonNullable<edits.TrackPatch["harmony"]> = {};
    if (g.voices !== undefined) harmony.style = oneOf(g.voices, HARMONY_STYLES.map((h) => h.style), `${where}.harmoniser.voices`);
    const amount = share(g.volume, `${where}.harmoniser.volume`);
    if (amount !== undefined) harmony.amount = amount;
    patch.harmony = harmony;
  }
  if (a.filter !== undefined && a.filter !== null) {
    const f = object(a.filter, `${where}.filter`);
    noExtras(f, ["kind", "cutoff", "resonance"], `${where}.filter`);
    const filter: NonNullable<edits.TrackPatch["filter"]> = {};
    if (f.kind !== undefined) filter.kind = oneOf(f.kind, ["low", "high", "band"] as const, `${where}.filter.kind`);
    const cutoff = share(f.cutoff, `${where}.filter.cutoff`);
    if (cutoff !== undefined) filter.cutoff = cutoff;
    const resonance = share(f.resonance, `${where}.filter.resonance`);
    if (resonance !== undefined) filter.resonance = resonance;
    patch.filter = filter;
  } else if (a.filter === null) patch.filter = { kind: "low", cutoff: 1, resonance: 0 };
  return patch;
}

/** A clip's own volume, fades and filter sweep from what Claude gave (only the ones given). */
function shapePatch(a: Obj, where: string): edits.ClipPatch {
  const patch: edits.ClipPatch = {};
  const volume = optionalNum(a.volume, `${where}.volume (per cent)`, { min: 0, max: 200 });
  if (volume !== undefined) patch.gain = r6(volume / 100);
  const fadeIn = optionalNum(a.fade_in, `${where}.fade_in (beats)`, { min: 0, max: MOST_BEATS });
  if (fadeIn !== undefined) patch.fadeIn = fadeIn;
  const fadeOut = optionalNum(a.fade_out, `${where}.fade_out (beats)`, { min: 0, max: MOST_BEATS });
  if (fadeOut !== undefined) patch.fadeOut = fadeOut;
  if (a.filter_sweep === null) patch.sweep = null;
  else if (a.filter_sweep !== undefined) {
    const w = object(a.filter_sweep, `${where}.filter_sweep`);
    noExtras(w, ["from", "to"], `${where}.filter_sweep`);
    patch.sweep = { from: num(w.from, `${where}.filter_sweep.from (per cent)`, { min: 0, max: 100 }) / 100, to: num(w.to, `${where}.filter_sweep.to (per cent)`, { min: 0, max: 100 }) / 100 };
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Running a tool

export async function callTool(s: Session, name: string, args: unknown, signal?: AbortSignal): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { content: [{ type: "text", text: `There's no tool called "${name}". The tools are: ${TOOLS.map((t) => t.name).join(", ")}.` }], isError: true };
  const run = async (): Promise<ToolResult> => {
    // Cancelled while waiting its turn: don't start.
    if (signal?.aborted) return cancelledResult();
    const snap = s.snapshot();
    const sounds = s.sounds;
    s.signal = signal ?? null;
    s.wroteFile = false;
    const back = () => {
      s.restore(snap);
      s.sounds = sounds;
    };
    try {
      const a = args === undefined || args === null ? {} : object(args, "The input");
      const result = await tool.run(s, a);
      // Cancelled at the very end: the change is taken back too (unless a file was already written).
      if (signal?.aborted && !s.wroteFile) {
        back();
        return cancelledResult();
      }
      return result;
    } catch (e) {
      back();
      if (e instanceof Cancelled || (signal?.aborted && !s.wroteFile)) return cancelledResult();
      if (e instanceof InputError) return { content: [{ type: "text", text: e.message }], isError: true };
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: `Something went wrong inside JuraDAW (${msg}). The song wasn't changed by this. Try describe_song, or a different approach.` }], isError: true };
    } finally {
      s.signal = null;
    }
  };
  // One call at a time. Live: on the song open in the user's JuraDAW tab, with any change sent back to it.
  return s.serial(() => (s.live ? s.live.call(s, name, run, signal) : run()));
}

/** What a cancelled call says (Claude has stopped waiting, so it's mostly for logs and tests). */
export function cancelledResult(): ToolResult {
  return { content: [{ type: "text", text: "Cancelled: the call was stopped before it finished, and nothing was changed." }], isError: true };
}

/** A key from words like "A minor", "Eb major", "F#" (major when the scale isn't said). */
function keyOf(v: unknown): SongKey {
  const words = text(v, "key").trim();
  const m = /^([A-Ga-g])\s*([#♯b♭]?)\s*(major|minor|maj|min|m)?$/i.exec(words);
  if (!m) throw new InputError(`key: "${words}" isn't a key — say it like "A minor", "Eb major" or "F# minor".`);
  const letter = m[1].toUpperCase();
  const base = KEYS.find((k) => k.value === letter)?.index ?? 0;
  const shift = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
  const scale = m[3] && /^(minor|min|m)$/i.test(m[3]) ? "minor" : "major";
  return { note: (base + shift + 12) % 12, scale };
}
