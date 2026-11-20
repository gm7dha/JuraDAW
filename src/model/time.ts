/**
 * Time and pitch helpers (pure): beats and seconds, where you are as
 * bar.beat.sixteenth, the snap grid, how long clips and the song are, note
 * names and the drum kit's sounds.
 */
import type { Snap } from "./storeApi";
import type { Clip, Song } from "./types";

/** Differences smaller than this (in beats) are rounding, not music. */
export const EPS = 1e-9;

/** Rounded to 6 places, so sums of thirds and sixteenths don't leave 0.30000000000000004 in a song. */
export const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

export function beatsToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm;
}

export function secondsToBeats(seconds: number, bpm: number): number {
  return (seconds * bpm) / 60;
}

/** Which bar a beat is in, counting from 0. */
export function barIndex(beat: number, beatsPerBar: number): number {
  return Math.floor((Math.max(0, beat) + EPS) / beatsPerBar);
}

/** The beat a bar starts on (bars counted from 0). */
export function barStart(bar: number, beatsPerBar: number): number {
  return bar * beatsPerBar;
}

/** A place in the song as "bar.beat.sixteenth", each counted from 1: beat 0 is "1.1.1", beat 9.5 in 4/4 is "3.2.3". */
export function positionText(beat: number, beatsPerBar: number): string {
  // Counted in whole sixteenths, so a hair under a beat doesn't show as the beat before.
  const sixteenths = Math.floor(Math.max(0, beat) * 4 + 1e-6);
  const perBar = Math.max(1, Math.round(beatsPerBar)) * 4;
  const bar = Math.floor(sixteenths / perBar);
  const inBar = sixteenths - bar * perBar;
  return `${bar + 1}.${Math.floor(inBar / 4) + 1}.${(inBar % 4) + 1}`;
}

/** Seconds as minutes:seconds.tenths — 65.32 is "1:05.3". */
export function timeText(seconds: number): string {
  const tenths = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 10 + 1e-6);
  const minutes = Math.floor(tenths / 600);
  const rest = tenths - minutes * 600;
  return `${minutes}:${String(Math.floor(rest / 10)).padStart(2, "0")}.${rest % 10}`;
}

/** The snap grid's step in beats (a whole bar for "bar"); 0 when snapping is off. Any other number of beats is taken as a grid of its own. */
export function snapStep(snap: Snap | number, beatsPerBar: number): number {
  return snap === "bar" ? beatsPerBar : Number.isFinite(snap) && snap > 0 ? snap : 0;
}

/** A beat moved onto the nearest line of the snap grid (as it is when snapping is off). Never before the start. */
export function snapBeat(beat: number, snap: Snap | number, beatsPerBar: number): number {
  const step = snapStep(snap, beatsPerBar);
  const b = Math.max(0, beat);
  return step > 0 ? r6(Math.round(b / step) * step) : b;
}

/** A beat moved back to the grid line at or before it — the start of the grid square it's in. */
export function snapBeatDown(beat: number, snap: Snap | number, beatsPerBar: number): number {
  const step = snapStep(snap, beatsPerBar);
  const b = Math.max(0, beat);
  return step > 0 ? r6(Math.floor(b / step + EPS) * step) : b;
}

/** How long a clip is in beats (an audio clip plays for seconds, so its length in beats depends on the tempo). */
export function clipLength(clip: Clip, bpm: number): number {
  return clip.kind === "midi" ? clip.length : secondsToBeats(clip.duration, bpm);
}

/** The beat where a clip ends. */
export function clipEnd(clip: Clip, bpm: number): number {
  return clip.start + clipLength(clip, bpm);
}

/** How long the song is in beats: to the end of its last clip, rounded up to a whole bar, and at least 4 bars. */
export function songLength(song: Song): number {
  const end = song.clips.reduce((max, c) => Math.max(max, clipEnd(c, song.bpm)), 0);
  const bars = Math.max(4, Math.ceil(end / song.beatsPerBar - EPS));
  return bars * song.beatsPerBar;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** A pitch's name with its octave: 60 is "C4" (middle C), 61 "C#4", 21 "A0". */
export function pitchName(pitch: number): string {
  const p = Math.round(pitch);
  return `${NOTE_NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`;
}

/** Whether a pitch is one of the piano's black keys. */
export function isBlackKey(pitch: number): boolean {
  const pc = ((Math.round(pitch) % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

/** The drum kit's sounds and the pitches that play them (General MIDI numbers), in the order the drum editor lists them. */
export const DRUM_PITCHES: { pitch: number; name: string }[] = [
  { pitch: 36, name: "Kick" },
  { pitch: 38, name: "Snare" },
  { pitch: 42, name: "Closed hat" },
  { pitch: 46, name: "Open hat" },
  { pitch: 39, name: "Clap" },
  { pitch: 41, name: "Low tom" },
  { pitch: 45, name: "Mid tom" },
  { pitch: 48, name: "High tom" },
  { pitch: 49, name: "Crash" },
  { pitch: 51, name: "Ride" },
  { pitch: 37, name: "Rim" },
  { pitch: 56, name: "Cowbell" },
  { pitch: 70, name: "Shaker" },
];

/** The drum a pitch plays ("Kick"), or null when the kit has no sound there. */
export function drumName(pitch: number): string | null {
  return DRUM_PITCHES.find((d) => d.pitch === pitch)?.name ?? null;
}
