/**
 * Standard MIDI files (.mid), read and written (pure: bytes in, bytes out).
 *
 * Reading understands format 0 (everything in one track) and format 1 (a
 * track per part), running status, note-ons with velocity 0 used as
 * note-offs, the tempo, the time signature, track names and which General
 * MIDI instrument each part asks for. Writing makes a format 1 file: a first
 * track with the song's name, tempo and time signature, then a track for each
 * instrument track (drums on channel 10, as General MIDI has it).
 *
 * Times come out in beats (quarter notes), as everywhere else in JuraDAW.
 */
import { isDrumKit } from "../model/document";
import { DEFAULT_BEATS_PER_BAR, DEFAULT_BPM, MOST_BEATS, MOST_CLIPS, MOST_NOTES, instrumentLabel, newId, newSong, newTrack } from "../model/document";
import { EPS, r6 } from "../model/time";
import { MAX_BPM, MIN_BPM, MIN_LENGTH, MOST_TRACKS } from "../model/types";
import type { MidiClip, Note, Song, Track } from "../model/types";

/** A note as a MIDI file has it: times in beats from the start of the song. */
export type MidiNote = Omit<Note, "id">;

/** One part of a MIDI file: the notes of one channel of one track. */
export interface MidiPart {
  /** The track's name in the file ("" when it has none). */
  name: string;
  /** 0–15; 9 is the drum channel ("channel 10" when counted from 1). */
  channel: number;
  /** The General MIDI instrument asked for (0–127), or null when the file doesn't say. */
  program: number | null;
  notes: MidiNote[];
}

/** What a MIDI file holds, as far as JuraDAW uses it. */
export interface MidiData {
  /** Ticks to a beat (only the fineness of the file's timing; 480 is usual). */
  ticksPerBeat: number;
  /** The tempo at the start of the file (later changes of tempo are not followed). */
  bpm: number;
  /** Beats (quarter notes) in a bar, from the time signature at the start; 4 when that doesn't come to a whole number of beats from 2 to 12. */
  beatsPerBar: number;
  /** The time signature at the start as the file has it — [7, 8] is 7/8 — or null when the file has none. */
  timeSignature: [number, number] | null;
  parts: MidiPart[];
}

export const DRUM_CHANNEL = 9;
const TICKS_PER_BEAT = 480;

// ---------------------------------------------------------------------------
// Instruments: JuraDAW's ↔ General MIDI's.

/** The General MIDI instrument written for each of JuraDAW's (numbers counted from 0). */
const PROGRAM_OF: Record<string, number> = {
  piano: 0,
  "electric-piano": 4,
  bells: 9,
  organ: 16,
  bass: 33,
  "synth-bass": 38,
  pluck: 45,
  strings: 48,
  lead: 80,
  pad: 89,
  "felt-piano": 0,
  choir: 52,
  "sub-bass": 39,
  "growl-bass": 87,
  supersaw: 81,
  wobble: 90,
  sweep: 122,
  "bass-808": 38,
  guitar: 24,
  harp: 46,
  kalimba: 108,
  marimba: 12,
  flute: 73,
  brass: 61,
};

/** The nearest of JuraDAW's instruments to a General MIDI one; a piano when nothing is near (or the file doesn't say). */
export function instrumentForProgram(program: number | null): string {
  if (program === null) return "piano";
  if (program === 4 || program === 5) return "electric-piano";
  if (program === 52 || program === 53) return "choir";
  if (program === 87) return "growl-bass";
  if (program === 122) return "sweep";
  if (program === 12 || program === 13) return "marimba";
  if (program === 108) return "kalimba";
  if (program === 46) return "harp";
  if (program >= 24 && program <= 25) return "guitar";
  if (program >= 56 && program <= 67) return "brass";
  if (program >= 68 && program <= 79) return "flute";
  if (program >= 8 && program <= 15) return "bells";
  if (program >= 16 && program <= 23) return "organ";
  if (program >= 24 && program <= 31) return "pluck";
  if (program >= 32 && program <= 37) return "bass";
  if (program === 38 || program === 39) return "synth-bass";
  if (program === 45 || program === 46) return "pluck";
  if ((program >= 40 && program <= 44) || (program >= 48 && program <= 51)) return "strings";
  if (program >= 52 && program <= 54) return "pad";
  if (program >= 80 && program <= 87) return "lead";
  if (program >= 88 && program <= 103) return "pad";
  return "piano";
}

// ---------------------------------------------------------------------------
// Reading.

/** Walks along the bytes; reading past the end gives 0 and sets `over`. */
class Reader {
  at = 0;
  over = false;
  constructor(
    readonly bytes: Uint8Array,
    readonly end: number = bytes.length,
  ) {}
  get left(): number {
    return this.end - this.at;
  }
  byte(): number {
    if (this.at >= this.end) {
      this.over = true;
      return 0;
    }
    return this.bytes[this.at++];
  }
  peek(): number {
    return this.at < this.end ? this.bytes[this.at] : 0;
  }
  u16(): number {
    return (this.byte() << 8) | this.byte();
  }
  u32(): number {
    return this.byte() * 0x1000000 + ((this.byte() << 16) | (this.byte() << 8) | this.byte());
  }
  /** A variable-length number (seven bits a byte, most significant first). */
  varLen(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.byte();
      value = value * 128 + (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return value;
  }
  tag(): string {
    return String.fromCharCode(this.byte(), this.byte(), this.byte(), this.byte());
  }
  skip(n: number): void {
    this.at += n;
    if (this.at > this.end) {
      this.at = this.end;
      this.over = true;
    }
  }
  take(n: number): Uint8Array {
    const from = this.at;
    this.skip(n);
    return this.bytes.subarray(from, this.at);
  }
}

/** A name from a file's bytes: UTF-8 where it is, otherwise byte for letter; control characters dropped. */
function textOf(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  }
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);
}

interface RawPart {
  program: number | null;
  /** Notes in ticks. */
  notes: { pitch: number; start: number; length: number; velocity: number }[];
  /** Notes held down, waiting for their note-off: start tick and velocity, oldest first, by pitch. */
  held: Map<number, { start: number; velocity: number }[]>;
}

interface RawTrack {
  name: string;
  parts: Map<number, RawPart>;
}

/**
 * Read a standard MIDI file. Null when it isn't one (or its timing is in film frames rather than beats, which
 * JuraDAW doesn't read). A file that's cut short gives the notes that are there.
 */
export function readMidiFile(bytes: Uint8Array): MidiData | null {
  const r = new Reader(bytes);
  if (r.tag() !== "MThd") return null;
  const headerLength = r.u32();
  const format = r.u16();
  r.u16(); // how many tracks: we read as many as are there
  const division = r.u16();
  if (r.over || headerLength < 6 || format > 2 || division === 0 || division & 0x8000) return null;
  r.skip(headerLength - 6);

  let tempo: { tick: number; micros: number } | null = null;
  let signature: { tick: number; count: number; unit: number } | null = null;
  const tracks: RawTrack[] = [];

  while (r.left >= 8) {
    const tag = r.tag();
    const length = r.u32();
    const t = new Reader(bytes, Math.min(bytes.length, r.at + length));
    t.at = r.at;
    r.skip(length);
    if (tag !== "MTrk") continue;

    const track: RawTrack = { name: "", parts: new Map() };
    tracks.push(track);
    const partOf = (channel: number): RawPart => {
      let part = track.parts.get(channel);
      if (!part) {
        part = { program: null, notes: [], held: new Map() };
        track.parts.set(channel, part);
      }
      return part;
    };
    const noteOff = (part: RawPart, pitch: number, tick: number) => {
      const on = part.held.get(pitch)?.shift();
      if (on) part.notes.push({ pitch, start: on.start, length: tick - on.start, velocity: on.velocity });
    };

    let tick = 0;
    let status = 0;
    while (t.left > 0 && !t.over) {
      tick += t.varLen();
      let first = t.byte();
      if (first < 0x80) {
        // Running status: the same kind of event as the last, with its status byte left out.
        if (status < 0x80) break;
      } else if (first < 0xf0) {
        status = first;
        first = t.byte();
      } else if (first === 0xff) {
        const type = t.byte();
        const data = t.take(t.varLen());
        if (type === 0x2f) break;
        if (type === 0x03 && !track.name) track.name = textOf(data);
        else if (type === 0x51 && data.length >= 3 && (!tempo || tick < tempo.tick)) tempo = { tick, micros: (data[0] << 16) | (data[1] << 8) | data[2] };
        else if (type === 0x58 && data.length >= 2 && (!signature || tick < signature.tick)) signature = { tick, count: data[0], unit: 2 ** Math.min(data[1], 7) };
        continue;
      } else {
        // System messages: skipped. (0xF0 and 0xF7 say how long they are; the rest are a fixed size.)
        if (first === 0xf0 || first === 0xf7) t.skip(t.varLen());
        else t.skip(first === 0xf2 ? 2 : first === 0xf1 || first === 0xf3 ? 1 : 0);
        continue;
      }
      const kind = status & 0xf0;
      const part = partOf(status & 0x0f);
      const second = kind === 0xc0 || kind === 0xd0 ? 0 : t.byte();
      if (t.over) break;
      const pitch = first & 0x7f;
      if (kind === 0x90 && second > 0) {
        const held = part.held.get(pitch);
        if (held) held.push({ start: tick, velocity: second & 0x7f });
        else part.held.set(pitch, [{ start: tick, velocity: second & 0x7f }]);
      } else if (kind === 0x80 || kind === 0x90) noteOff(part, pitch, tick);
      else if (kind === 0xc0 && part.program === null) part.program = first & 0x7f;
    }
    // Notes never let go end where the track does.
    for (const part of track.parts.values()) for (const pitch of part.held.keys()) while (part.held.get(pitch)!.length) noteOff(part, pitch, tick);
  }

  const bpmRaw = tempo && tempo.micros > 0 ? 60_000_000 / tempo.micros : DEFAULT_BPM;
  // 6/8 is three quarter notes a bar; 7/8 is three and a half, which a song's bars can't be: those stay at 4.
  const beats = signature ? (signature.count * 4) / signature.unit : DEFAULT_BEATS_PER_BAR;
  const parts: MidiPart[] = [];
  for (const track of tracks) {
    for (const channel of [...track.parts.keys()].sort((a, b) => a - b)) {
      const raw = track.parts.get(channel)!;
      const notes = raw.notes
        .map((n) => ({ pitch: n.pitch, start: r6(n.start / division), length: Math.min(MOST_BEATS, Math.max(MIN_LENGTH, r6(n.length / division))), velocity: Math.max(1, n.velocity) }))
        // A damaged file can put notes absurdly far away: those are left out.
        .filter((n) => n.start <= MOST_BEATS)
        .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
      if (notes.length) parts.push({ name: track.name, channel, program: raw.program, notes });
    }
  }
  return {
    ticksPerBeat: division,
    bpm: Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpmRaw * 100) / 100)),
    beatsPerBar: Number.isInteger(beats) && beats >= 2 && beats <= 12 ? beats : DEFAULT_BEATS_PER_BAR,
    timeSignature: signature ? [signature.count, signature.unit] : null,
    parts,
  };
}

/** A part of a MIDI file ready to become a track with one clip. */
export interface ImportedTrack {
  name: string;
  /** "drums" for the drum channel; otherwise the nearest of JuraDAW's instruments (a piano when the file doesn't say). */
  instrument: string;
  /** The clip's length in beats: to the end of the last note, rounded up to a whole bar. */
  length: number;
  notes: MidiNote[];
}

export interface ImportedMidi {
  bpm: number;
  beatsPerBar: number;
  tracks: ImportedTrack[];
  /** Things worth telling the person who brought the file in, in plain words (none when all went as expected). */
  remarks: string[];
}

/**
 * What to say about a file's time signature when a song can't have it — one that doesn't come to a whole number of
 * beats in a bar from 2 to 12, such as 7/8 — or null when it's fine.
 */
export function timeSignatureRemark(data: Pick<MidiData, "timeSignature" | "beatsPerBar">): string | null {
  if (!data.timeSignature) return null;
  const [count, unit] = data.timeSignature;
  if ((count * 4) / unit === data.beatsPerBar) return null;
  return `This file is in ${count}/${unit} time, which JuraDAW can't show: its notes are all here and play as written, but the bar lines are drawn every ${data.beatsPerBar} beats.`;
}

/**
 * The parts of a MIDI file as tracks to add to a song — each with an instrument, a name and one clip's worth of notes
 * starting at the beginning — with the file's tempo and beats in a bar. Null when it isn't a MIDI file.
 */
export function midiTracks(bytes: Uint8Array): ImportedMidi | null {
  const data = readMidiFile(bytes);
  if (!data) return null;
  const tracks = data.parts.map((part): ImportedTrack => {
    const instrument = part.channel === DRUM_CHANNEL ? "drums" : instrumentForProgram(part.program);
    const end = part.notes.reduce((max, n) => Math.max(max, n.start + n.length), 0);
    const bars = Math.max(1, Math.ceil(end / data.beatsPerBar - EPS));
    return { name: part.name || instrumentLabel(instrument), instrument, length: bars * data.beatsPerBar, notes: part.notes };
  });
  const remark = timeSignatureRemark(data);
  return { bpm: data.bpm, beatsPerBar: data.beatsPerBar, tracks, remarks: remark ? [remark] : [] };
}

/**
 * A new song from a MIDI file: a track for each part (up to the most a song can have) with one clip each, the file's
 * tempo and beats in a bar. Null when it isn't a MIDI file. A part with more notes than one clip holds (MOST_NOTES)
 * gets several clips, one over another, so no note is lost. (`midiTracks(bytes).remarks` has anything worth telling
 * the person, such as a time signature a song can't have.)
 */
export function midiToSong(bytes: Uint8Array, name: string): Song | null {
  const midi = midiTracks(bytes);
  if (!midi) return null;
  const song = newSong(name.trim() || undefined);
  const tracks: Track[] = [];
  const clips: MidiClip[] = [];
  for (const part of midi.tracks.slice(0, MOST_TRACKS)) {
    const made = newTrack("instrument", part.instrument, tracks);
    // The file's own name for the part, unless a track already has it (then "Piano 2" and so on).
    const taken = tracks.some((t) => t.name.toLowerCase() === part.name.toLowerCase());
    const track = taken ? made : { ...made, name: part.name };
    tracks.push(track);
    for (let from = 0; from < Math.max(1, part.notes.length) && clips.length < MOST_CLIPS; from += MOST_NOTES) {
      const notes = part.notes.slice(from, from + MOST_NOTES).map((n) => ({ ...n, id: newId("n") }));
      clips.push({ id: newId("c"), trackId: track.id, name: track.name, start: 0, kind: "midi", length: part.length, notes });
    }
  }
  return { ...song, bpm: midi.bpm, beatsPerBar: midi.beatsPerBar, loop: { on: false, start: 0, end: 4 * midi.beatsPerBar }, tracks, clips };
}

// ---------------------------------------------------------------------------
// Writing.

/** Bytes gathered one after another. (Never spread into a call: a long track is far more bytes than a function can take as arguments.) */
class Writer {
  private bytes: number[] = [];
  get length(): number {
    return this.bytes.length;
  }
  add(...few: number[]): this {
    for (const b of few) this.bytes.push(b & 255);
    return this;
  }
  all(many: ArrayLike<number>): this {
    for (let i = 0; i < many.length; i++) this.bytes.push(many[i] & 255);
    return this;
  }
  u32(v: number): this {
    return this.add(v >>> 24, v >>> 16, v >>> 8, v);
  }
  tag(tag: string): this {
    for (let i = 0; i < tag.length; i++) this.bytes.push(tag.charCodeAt(i));
    return this;
  }
  /** A variable-length number (seven bits a byte, most significant first). */
  varLen(value: number): this {
    let v = Math.max(0, Math.min(0x0fffffff, Math.round(value)));
    const out = [v & 0x7f];
    while ((v = Math.floor(v / 128)) > 0) out.unshift((v & 0x7f) | 0x80);
    return this.all(out);
  }
  /** A meta event (with its delta time of 0 in front). */
  meta(type: number, data: ArrayLike<number>): this {
    return this.add(0x00, 0xff, type).varLen(data.length).all(data);
  }
  name(name: string): this {
    return name ? this.meta(0x03, new TextEncoder().encode(name.slice(0, 80))) : this;
  }
  /** A chunk: its tag, how long its body is, its body. */
  chunk(tag: string, body: Writer): this {
    return this.tag(tag).u32(body.length).all(body.bytes);
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/**
 * Write a standard MIDI file (format 1): a first track with `name`, the tempo and the time signature, then one track
 * for each part.
 */
export function writeMidiFile(data: Pick<MidiData, "bpm" | "beatsPerBar" | "parts">, name = ""): Uint8Array {
  const micros = Math.round(60_000_000 / Math.min(MAX_BPM, Math.max(MIN_BPM, data.bpm)));
  const tracks = data.parts.length + 1;
  const out = new Writer().chunk("MThd", new Writer().add(0, 1, tracks >> 8, tracks, TICKS_PER_BEAT >> 8, TICKS_PER_BEAT));
  const first = new Writer()
    .name(name)
    // Beats in a bar, each a quarter note (2 = 2 to the power 2 = 4); a metronome click every beat.
    .meta(0x58, [Math.min(255, Math.max(1, Math.round(data.beatsPerBar))), 2, 24, 8])
    .meta(0x51, [micros >> 16, micros >> 8, micros])
    .meta(0x2f, []);
  out.chunk("MTrk", first);
  for (const part of data.parts) {
    const channel = part.channel & 0x0f;
    const body = new Writer().name(part.name);
    if (part.program !== null && channel !== DRUM_CHANNEL) body.add(0x00, 0xc0 | channel, part.program & 0x7f);
    // Each note's start and end, in order of time; at the same tick, notes are let go before new ones start.
    const events: { tick: number; on: boolean; pitch: number; velocity: number }[] = [];
    for (const n of part.notes) {
      const on = Math.max(0, Math.round(n.start * TICKS_PER_BEAT));
      const off = Math.max(on + 1, Math.round((n.start + n.length) * TICKS_PER_BEAT));
      const pitch = Math.min(127, Math.max(0, Math.round(n.pitch)));
      events.push({ tick: on, on: true, pitch, velocity: Math.min(127, Math.max(1, Math.round(n.velocity))) });
      events.push({ tick: off, on: false, pitch, velocity: 0 });
    }
    events.sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on));
    let tick = 0;
    for (const e of events) {
      body.varLen(e.tick - tick).add((e.on ? 0x90 : 0x80) | channel, e.pitch, e.velocity);
      tick = e.tick;
    }
    out.chunk("MTrk", body.meta(0x2f, []));
  }
  return out.done();
}

/** The channels given to instrument tracks that aren't drums, in turn (every channel but the drum one). */
const TUNED_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

/**
 * The song's notes as the parts of a MIDI file: one for each instrument track, in order, with the notes of all its
 * clips as they're heard (notes past the end of their clip are left out, one crossing the end is cut there). Drum
 * tracks go on the drum channel; audio tracks have no notes and are left out. Muted tracks are written too.
 *
 * A MIDI file has 15 channels for tuned instruments, and a channel plays one instrument. The first 15 tuned tracks
 * get a channel each; any after that share the channel of an earlier track playing the same instrument (so each
 * still sounds right) — or, only if there's no such track, take the channels in turn again.
 */
export function songParts(song: Song): MidiPart[] {
  let tuned = 0;
  const channelOf = new Map<string, number>();
  return song.tracks
    .filter((t) => t.kind === "instrument")
    .map((track): MidiPart => {
      const drums = isDrumKit(track.instrument);
      const notes: MidiNote[] = [];
      for (const clip of song.clips) {
        if (clip.kind !== "midi" || clip.trackId !== track.id) continue;
        for (const n of clip.notes) {
          if (n.start < 0 || n.start >= clip.length - EPS) continue;
          const length = Math.min(n.length, clip.length - n.start);
          notes.push({ pitch: n.pitch, start: r6(clip.start + n.start), length: r6(length), velocity: n.velocity });
        }
      }
      notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
      let channel = DRUM_CHANNEL;
      if (!drums) {
        const shared = channelOf.get(track.instrument);
        channel = tuned < TUNED_CHANNELS.length || shared === undefined ? TUNED_CHANNELS[tuned % TUNED_CHANNELS.length] : shared;
        tuned++;
        if (shared === undefined) channelOf.set(track.instrument, channel);
      }
      return { name: track.name, channel, program: drums ? null : (PROGRAM_OF[track.instrument] ?? 0), notes };
    });
}

/** The song as a standard MIDI file: its name, tempo and beats in a bar, and a track for each instrument track. */
export function songToMidi(song: Song): Uint8Array {
  return writeMidiFile({ bpm: song.bpm, beatsPerBar: song.beatsPerBar, parts: songParts(song) }, song.name);
}
