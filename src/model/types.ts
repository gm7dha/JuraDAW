/**
 * The song: what JuraDAW saves in a .juradaw file and keeps in the browser.
 * Everything in time is in BEATS (quarter notes) from the start of the song,
 * as plain numbers (fractions allowed), unless a field says seconds.
 * Pitches are MIDI note numbers (60 = middle C, C4). Velocity is 1–127.
 */

/** An instrument track plays notes with a built-in instrument; an audio track plays recordings and sound files. */
export type TrackKind = "instrument" | "audio";

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  /** One of TRACK_COLOURS (a CSS colour). */
  colour: string;
  /** 0–1 (0.8 = the usual level). */
  volume: number;
  /** −1 (left) … 1 (right). */
  pan: number;
  mute: boolean;
  solo: boolean;
  /** Instrument tracks: an id from src/audio/instruments.ts INSTRUMENTS (e.g. "piano", "drums"). "" on audio tracks. */
  instrument: string;
  /** How much of this track goes to the shared reverb, 0–1. */
  reverb: number;
  /** How much goes to the shared echo, 0–1. */
  echo: number;
  // The track's own effects, in the order the sound goes through them. Left out = off (see src/model/shaping.ts).
  /** Drive: warmth, then grit, then fuzz. 0–1. */
  drive?: number;
  /** Crush: the rough, lo-fi sound of an old sampler or games console. 0–1. */
  crush?: number;
  /** The filter: takes away the top of the sound (kind "low") or the bottom ("high"). */
  filter?: TrackFilter;
  /** Wobble: a slow drift in pitch that widens and thickens the sound, like a worn tape. 0–1. */
  chorus?: number;
  /** Pump: dips the volume on every beat and lets it swell back, as dance music does. 0–1. */
  pump?: number;
}

export interface TrackFilter {
  /** "low" lets the low part through (a low-pass: muffles); "high" lets the high part through (a high-pass: thins). */
  kind: "low" | "high";
  /** Where it cuts, 0 (the very bottom) – 1 (the very top). A "low" filter at 1, or a "high" one at 0, changes nothing. */
  cutoff: number;
  /** A ringing emphasis at the cut, 0–1. */
  resonance: number;
}

/** A filter sweep over a clip: the track's filter moves from one place to another while the clip plays. */
export interface Sweep {
  /** Cutoff at the clip's start and at its end, 0–1 (as TrackFilter.cutoff). */
  from: number;
  to: number;
}

export interface Note {
  id: string;
  pitch: number;
  /** Beats from the start of its clip. */
  start: number;
  /** Beats, > 0. */
  length: number;
  velocity: number;
}

interface ClipBase {
  id: string;
  trackId: string;
  name: string;
  /** Beats from the start of the song, ≥ 0. */
  start: number;
  /** Beats over which the clip swells in from silence at its start (left out = none). */
  fadeIn?: number;
  /** Beats over which it dies away to silence at its end (left out = none). */
  fadeOut?: number;
  /** Moves the track's filter while the clip plays (left out = the filter stays where the track has it). */
  sweep?: Sweep;
}

/** A block of notes on an instrument track. */
export interface MidiClip extends ClipBase {
  kind: "midi";
  /** Beats, > 0. Notes past the end aren't played. */
  length: number;
  notes: Note[];
  /** 0–2, 1 = as played (left out = 1). */
  gain?: number;
}

/** A stretch of a recording or sound file on an audio track. It plays at its own speed whatever the tempo. */
export interface AudioClip extends ClipBase {
  kind: "audio";
  /** Which sound (Song.audio[].id). */
  audioId: string;
  /** Seconds into the sound where the clip starts playing. */
  offset: number;
  /** Seconds played. */
  duration: number;
  /** 0–2, 1 = as recorded. */
  gain: number;
}

export type Clip = MidiClip | AudioClip;

/** A sound the song uses. The samples themselves live outside the song (see src/audio/engineApi.ts). */
export interface AudioInfo {
  id: string;
  name: string;
  seconds: number;
  sampleRate: number;
  channels: number;
}

export interface Loop {
  on: boolean;
  /** Beats; end > start. */
  start: number;
  end: number;
}

export interface Song {
  name: string;
  /** Beats per minute, 30–300. */
  bpm: number;
  /** Beats in a bar: 2–12 (4 = 4/4). A beat is always a quarter note. */
  beatsPerBar: number;
  /** 0–1. */
  master: number;
  loop: Loop;
  tracks: Track[];
  /** Every clip of every track, in no particular order. */
  clips: Clip[];
  audio: AudioInfo[];
}

export const MIN_BPM = 30;
export const MAX_BPM = 300;
export const MOST_TRACKS = 32;
/** The shortest note or clip, in beats (a 64th note). */
export const MIN_LENGTH = 1 / 16;

/** Track colours, in the order new tracks take them. */
export const TRACK_COLOURS = ["#1f6fd1", "#2e9d57", "#d9822b", "#8f56c9", "#d1495b", "#1a9aa8", "#b8860b", "#5b6b7a"] as const;
