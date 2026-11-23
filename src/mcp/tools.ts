/**
 * The tools Claude has for making music with JuraDAW: each one checks what
 * it's given (plain-English messages when something's wrong), changes the
 * session's song through the app's own pure edits (src/model/edits.ts), and
 * says what it did. While a JuraDAW tab is connected (Live with Claude) the
 * same tools work on the song open there (src/mcp/live.ts).
 */
import { FILE_EXTENSION, MOST_BEATS, newSong, newTrack, readSongFile, songFileText, instrumentLabel } from "../model/document";
import * as edits from "../model/edits";
import { DRUM_PITCHES, clipEnd, clipLength, drumName, pitchName, songLength, timeText, beatsToSeconds } from "../model/time";
import { MAX_BPM, MIN_BPM, MIN_LENGTH, MOST_TRACKS, type Clip, type MidiClip, type Note, type Song, type Track } from "../model/types";
import { LIBRARY, cleanValues, findPattern, makePattern, patternSuitsInstrument } from "../library/catalogue";
import { songToMidi } from "../midi/midiFile";
import { InputError, bool, list, noExtras, num, object, oneOf, optionalNum, r6, text, type Obj } from "./args";
import { Cancelled, type Session } from "./session";
import { checkFree, fileNameFor, needFolder, say, writeOut, type ToolDef, type ToolResult } from "./toolKit";

export type { ToolDef, ToolResult } from "./toolKit";

/** The built-in instruments (the ids of src/audio/instruments.ts INSTRUMENTS, kept in step by tests/mcpTools). */
export const INSTRUMENT_IDS = ["piano", "electric-piano", "organ", "strings", "pad", "bass", "synth-bass", "lead", "pluck", "bells", "drums"] as const;

/** How songs are described to the tools: sent to Claude with the server's instructions, and by the format_guide tool. */
export const FORMAT_GUIDE = `How JuraDAW songs work:
- A song has a tempo (beats a minute), beats in a bar (4 unless told otherwise) and tracks. Each instrument track plays one built-in instrument: ${INSTRUMENT_IDS.join(", ")}. Tracks hold clips: blocks of notes that sit on the bars of the song.
- Places in the song are given in BARS, counted from 1 ("start_bar": 5 is the start of bar 5). Lengths of clips are in bars.
- Notes inside a clip are given in BEATS from the start of that clip (0 is its first beat; in 4/4 a bar is 4 beats, a half beat is 0.5, a sixteenth note 0.25).
- A note is {"pitch", "start", "length", "velocity"}: pitch is a note name ("C4" is middle C, "F#3", "Bb2") or a MIDI number (60 = middle C); length is in beats (1 if left out); velocity is how hard it's played, 1–127 (96 if left out). Chords are simply notes with the same start.
- On a "drums" track the pitch can be a drum's name: ${DRUM_PITCHES.map((d) => `"${d.name.toLowerCase()}"`).join(", ")} (drum notes are short: length 0.25 if left out).
- Refer to a track by its name (or its number in describe_song), and to a clip by its name with "track", its number on that track (1 = the first), or its id.
- Two clips can't lie on top of each other on one track.
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

const isDrums = (song: Song, trackId: string) => song.tracks.find((t) => t.id === trackId)?.instrument === "drums";

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

function describeClip(song: Song, clip: Clip, index: number): string {
  const len = clipLength(clip, song.bpm);
  const where = `bar ${barOf(song, clip.start)} to ${barOf(song, clip.start + len)}`;
  if (clip.kind === "audio") return `   clip ${index} "${clip.name}" (id ${clip.id}): a recording, ${where}`;
  const pitches = clip.notes.map((n) => n.pitch);
  const range = pitches.length ? (isDrums(song, clip.trackId) ? "" : `, ${pitchName(Math.min(...pitches))} to ${pitchName(Math.max(...pitches))}`) : "";
  return `   clip ${index} "${clip.name}" (id ${clip.id}): ${where}, ${plural(clip.notes.length, "note")}${range}`;
}

export function describeSong(song: Song, opts: { notes?: boolean; only?: Clip } = {}): string {
  const length = songLength(song);
  const lines = [
    `Song "${song.name}": ${r6(song.bpm)} beats a minute, ${song.beatsPerBar} beats in a bar, ${r6(length / song.beatsPerBar)} bars long (${timeText(beatsToSeconds(length, song.bpm))}). Loop ${song.loop.on ? `on, bar ${barOf(song, song.loop.start)} to ${barOf(song, song.loop.end)}` : "off"}. Master volume ${pct(song.master)}.`,
  ];
  if (!song.tracks.length) lines.push("No tracks yet. add_track makes one; insert_library_pattern adds a ready-made beat, bass line or chords on a track of its own.");
  song.tracks.forEach((t, i) => {
    if (opts.only && opts.only.trackId !== t.id) return;
    const pan = Math.abs(t.pan) < 0.005 ? "middle" : `${pct(Math.abs(t.pan))} ${t.pan < 0 ? "left" : "right"}`;
    lines.push(
      `${i + 1}. "${t.name}" — ${t.kind === "audio" ? "a sound track (recordings)" : `plays ${t.instrument} (${instrumentLabel(t.instrument)})`}; volume ${pct(t.volume)}, ${pan}, reverb ${pct(t.reverb)}, echo ${pct(t.echo)}${t.mute ? ", MUTED" : ""}${t.solo ? ", SOLO" : ""}`,
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
    run: () => say("Instruments (use the id):", ...INSTRUMENT_IDS.map((id) => `- ${id}: ${instrumentLabel(id)}${id === "drums" ? ` (${DRUM_PITCHES.map((d) => d.name.toLowerCase()).join(", ")})` : ""}`)),
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
    description: "Change the song's name, tempo, beats in a bar, master volume or the loop (the part that repeats when the user plays).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        tempo: { type: "number", description: `Beats a minute, ${MIN_BPM}–${MAX_BPM}.` },
        beats_per_bar: { type: "number", description: "2–12." },
        master_volume: { type: "number", description: "Per cent, 0–100 (80 is the usual)." },
        loop: { type: "object", description: '{"on": true, "start_bar": 1, "end_bar": 5} repeats bars 1 to 4.', properties: { on: { type: "boolean" }, start_bar: { type: "number" }, end_bar: { type: "number" } } },
      },
    },
    run(s, a) {
      noExtras(a, ["name", "tempo", "beats_per_bar", "master_volume", "loop"], "set_song");
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
      if (!s.commit(song)) return say("Nothing was changed (those are the song's settings already).");
      return say(describeSong(song).split("\n")[0]);
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
      },
      required: ["instrument"],
    },
    run(s, a) {
      noExtras(a, ["instrument", "name", "volume", "pan", "reverb", "echo"], "add_track");
      if (s.song.tracks.length >= MOST_TRACKS) throw new InputError(`A song can have at most ${MOST_TRACKS} tracks. Remove one first, or put this part on a track that's there.`);
      const made = newTrack("instrument", instrumentOf(a.instrument, "instrument"), s.song.tracks);
      const track: Track = { ...made, ...trackPatch(a, "add_track") };
      if (s.song.tracks.some((t) => sameName(t.name, track.name))) throw new InputError(`There's already a track called "${track.name}". Give this one another name.`);
      s.commit(edits.addTrack(s.song, track));
      return say(`Added track ${s.song.tracks.length}, "${track.name}", playing ${track.instrument}. Put notes on it with add_clip.`);
    },
  },
  {
    name: "edit_track",
    title: "Change a track",
    description: "Change a track's name, instrument, volume, left–right, reverb, echo, mute or solo.",
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
        mute: { type: "boolean" },
        solo: { type: "boolean" },
      },
      required: ["track"],
    },
    run(s, a) {
      noExtras(a, ["track", "name", "instrument", "volume", "pan", "reverb", "echo", "mute", "solo"], "edit_track");
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
      },
      required: ["track"],
    },
    run(s, a) {
      noExtras(a, ["track", "start_bar", "bars", "name", "notes"], "add_clip");
      const song = s.song;
      const track = trackOf(song, a.track, "add_clip");
      if (track.kind !== "instrument") throw new InputError(`"${track.name}" is a sound track (recordings): notes go on an instrument track. Add one with add_track.`);
      const drums = track.instrument === "drums";
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
      if (!s.commit(next)) throw new InputError("The song is full (too many clips). Remove some first.");
      return say(`Added clip "${clip.name}" (id ${clip.id}) to "${track.name}": bar ${barOf(song, start)} to ${barOf(song, start + length)}, ${plural(notes.length, "note")}.`);
    },
  },
  {
    name: "add_notes",
    title: "Add notes to a clip",
    description: "Add notes to a clip that's there. The clip grows by whole bars if a note runs past its end.",
    inputSchema: { type: "object", properties: { clip: CLIP_REF, track: TRACK_REF, notes: NOTE_SCHEMA }, required: ["notes"] },
    run(s, a) {
      noExtras(a, ["clip", "track", "notes"], "add_notes");
      const clip = midiClipOf(s.song, a, "add_notes");
      const notes = notesOf(a.notes, "notes", isDrums(s.song, clip.trackId), { allowEmpty: false });
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
    description: "Rename a clip, move it (to another bar or track), make it longer or shorter, or change all its notes at once: transpose (semitones up or down), set every velocity, or tidy the timing onto a grid.",
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
      },
    },
    run(s, a) {
      noExtras(a, ["clip", "track", "name", "start_bar", "bars", "to_track", "transpose", "velocity", "tidy_timing"], "edit_clip");
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
      if (!did.length) throw new InputError("edit_clip: say what to change: name, start_bar, bars, to_track, transpose, velocity or tidy_timing.");
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
      if (!track) track = song.tracks.find((t) => t.kind === "instrument" && t.instrument === pattern.instrument && (wanted === null || edits.placeIsFree(song, t.id, wanted, made.length))) ?? null;
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
