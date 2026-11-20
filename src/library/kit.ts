/**
 * What every pattern in the library shares: the input and pattern types, the
 * inputs most of them ask for (key, scale, chords, how many times), and small
 * helpers for writing notes. Pure.
 */
import type { Note } from "../model/types";
import { KEYS, PROGRESSIONS, keyIndex, progression, scaleFor, scaleName, type ScaleName } from "./theory";

/** What a pattern is for — and so which tracks it suits: drum patterns go on drum tracks, the rest on any other instrument. */
export type PatternKind = "drums" | "bass" | "chords" | "melody";

/** A "choice" is one of `choices`; a "count" is a whole number from `min` to `max`. */
export type InputKind = "choice" | "count";

export interface PatternInput {
  key: string;
  label: string;
  kind: InputKind;
  default: number | string;
  min?: number;
  max?: number;
  choices?: { value: string; label: string }[];
  help?: string;
}

export type Values = Record<string, number | string>;

/** A note of a pattern: beats from the pattern's start. It gets its id when it's put in a song. */
export type PatternNote = Omit<Note, "id">;

export interface MadePattern {
  /** Beats: always whole bars of the pattern's own `beatsPerBar`. */
  length: number;
  notes: PatternNote[];
}

export interface LibraryPattern {
  id: string;
  name: string;
  description: string;
  /** The heading it's listed under in the library window. */
  group: string;
  /** A small picture for its card: fixed SVG markup in a 48 × 48 box, drawn in currentColor (made in the code, never user data). */
  icon: string;
  kind: PatternKind;
  /** The instrument suggested for it (an id from src/audio/instruments.ts), used when it's put on a new track. */
  instrument: string;
  /** The beats in a bar it's written for: 4, or 3 for a waltz. */
  beatsPerBar: number;
  inputs: PatternInput[];
  /** The notes, from values already made safe (see `cleanValues` in patterns.ts). */
  make: (values: Values) => MadePattern;
}

// ---------------------------------------------------------------------------
// Inputs many patterns share.

export const keyInput = (): PatternInput => ({ key: "key", label: "Key", kind: "choice", default: "C", choices: KEYS.map(({ value, label }) => ({ value, label })) });

export const scaleInput = (def: ScaleName = "major"): PatternInput => ({
  key: "scale",
  label: "Scale",
  kind: "choice",
  default: def,
  choices: [
    { value: "major", label: "Major (bright)" },
    { value: "minor", label: "Minor (sad)" },
  ],
});

export const chordsInput = (def = "pop"): PatternInput => ({
  key: "chords",
  label: "Chords to follow",
  kind: "choice",
  default: def,
  choices: PROGRESSIONS.map((p) => ({ value: p.id, label: p.label })),
  help: "Pick the same chords, key and scale as your other tracks and they'll fit together. (The Epic chords are always minor.)",
});

export const timesInput = (def = 1, max = 8): PatternInput => ({ key: "times", label: "Times through", kind: "count", default: def, min: 1, max });

export const barsInput = (def = 4): PatternInput => ({ key: "bars", label: "Bars", kind: "count", default: def, min: 1, max: 8 });

export const n = (v: Values, k: string) => Number(v[k]);
export const str = (v: Values, k: string) => String(v[k] ?? "");

/** The key (0 = C … 11 = B) and scale to play in: those chosen — but a sequence of chords that only comes in one scale (`chords`, or the one chosen to follow) is played in that. */
export const keyOf = (v: Values, chords: unknown = v.chords): { key: number; scale: ScaleName } => ({ key: keyIndex(v.key), scale: scaleFor(chords, scaleName(v.scale)) });

/** The chord for each bar: the chosen chords, gone through the chosen number of times. */
export function barDegrees(v: Values, chords: unknown = v.chords): number[] {
  const once = progression(chords).degrees;
  const times = Math.max(1, Math.round(n(v, "times")) || 1);
  return Array.from({ length: once.length * times }, (_, i) => once[i % once.length]);
}

// ---------------------------------------------------------------------------
// Writing notes.

/** Rounded to 6 places (thirds of a beat add up without 0.9999999 creeping in). */
export const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

export const note = (pitch: number, start: number, length: number, velocity = 96): PatternNote => ({ pitch, start: r6(start), length: r6(length), velocity });

/** How hard each letter of a rhythm row is played: X an accent, x a normal hit, o softer, g a ghost note you barely hear. */
const HIT: Record<string, number> = { X: 118, x: 100, o: 76, g: 46 };

/**
 * Notes from a row of a rhythm grid: one letter a step, "." a rest — "x...x...x...x..." is four on the floor when a
 * step is a quarter of a beat. Each note lasts `length` beats (a step when not given).
 */
export function row(pitch: number, pattern: string, step: number, from = 0, length = step): PatternNote[] {
  const out: PatternNote[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const velocity = HIT[pattern[i]];
    if (velocity) out.push(note(pitch, from + i * step, length, velocity));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pictures.

/**
 * A pattern's picture for its card: its first couple of bars drawn as a tiny piano roll — time across, higher notes
 * higher up, drums one row a sound.
 */
export function patternIcon(made: MadePattern, beatsPerBar: number, drums: boolean): string {
  const shown = Math.min(made.length, beatsPerBar * 2);
  const notes = made.notes.filter((x) => x.start < shown);
  if (!notes.length) return `<rect x="6" y="22" width="36" height="4" rx="2" fill="currentColor" stroke="none" opacity="0.4"/>`;
  const pitches = [...new Set(notes.map((x) => x.pitch))].sort((a, b) => a - b);
  // Drums: a row for each sound. Tunes: a row for each semitone, squeezed if the tune ranges wide.
  const rows = drums ? pitches.length : pitches[pitches.length - 1] - pitches[0] + 1;
  const rowOf = (pitch: number) => (drums ? pitches.indexOf(pitch) : pitch - pitches[0]);
  const [left, top, width, height] = [5, 6, 38, 36];
  const rowHeight = Math.min(6, height / rows);
  const used = rowHeight * rows;
  const bottom = top + (height + used) / 2;
  const bar = Math.max(1, Math.min(rowHeight * 0.8, 4.5));
  const f = (v: number) => String(Math.round(v * 100) / 100);
  const rects = notes
    .map((x) => {
      const x0 = left + (x.start / shown) * width;
      const w = Math.max(1.6, (Math.min(drums ? 0.2 : x.length, shown - x.start) / shown) * width - 0.6);
      const y = bottom - (rowOf(x.pitch) + 0.5) * rowHeight - bar / 2;
      return `<rect x="${f(x0)}" y="${f(y)}" width="${f(w)}" height="${f(bar)}" rx="${f(Math.min(1, bar / 2))}"/>`;
    })
    .join("");
  return `<g fill="currentColor" stroke="none">${rects}</g>`;
}
