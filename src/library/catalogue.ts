/**
 * The pattern library's list: ready-made drum beats, bass lines, chords and
 * tunes to drop into a song and then change like any other clip. Each pattern
 * lists its inputs (key, scale, how many bars…) with defaults and limits, and
 * makes plain notes. Pure.
 *
 * Patterns that share a key, scale and chord sequence fit together: a bass
 * line and an arpeggio "following" the pop chords go with "Pop chords".
 */
import { BASS_PATTERNS } from "./bass";
import { CHORD_PATTERNS } from "./chords";
import { DRUM_PATTERNS } from "./drums";
import type { LibraryPattern, MadePattern, Values } from "./kit";
import { MELODY_PATTERNS } from "./melodies";

/** Every pattern, in the order the library window shows them under their headings. */
export const LIBRARY: LibraryPattern[] = [...DRUM_PATTERNS, ...BASS_PATTERNS, ...CHORD_PATTERNS, ...MELODY_PATTERNS];

/** A pattern by its id. */
export function findPattern(id: string): LibraryPattern | undefined {
  return LIBRARY.find((p) => p.id === id);
}

/** A pattern's inputs at their defaults. */
export function defaultValues(pattern: LibraryPattern): Values {
  return Object.fromEntries(pattern.inputs.map((i) => [i.key, i.default]));
}

/**
 * Values made safe for a pattern: counts are whole numbers inside their limits, choices are one of the choices,
 * anything missing or odd is the default, anything the pattern doesn't ask for is dropped.
 */
export function cleanValues(pattern: LibraryPattern, values: Readonly<Record<string, unknown>> = {}): Values {
  const out: Values = {};
  for (const input of pattern.inputs) {
    const raw = values[input.key];
    if (input.kind === "count") {
      let x = typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "") ? Number(raw) : NaN;
      if (!Number.isFinite(x)) x = Number(input.default);
      if (input.min !== undefined) x = Math.max(input.min, x);
      if (input.max !== undefined) x = Math.min(input.max, x);
      out[input.key] = Math.round(x);
    } else out[input.key] = input.choices?.some((c) => c.value === raw) ? (raw as string) : String(input.default);
  }
  return out;
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Make a pattern with these values (cleaned first; none = its defaults). What comes back is ready to be a clip:
 * notes in order, whole pitches and velocities in range, none starting outside the pattern or running past its end.
 */
export function makePattern(pattern: LibraryPattern, values: Readonly<Record<string, unknown>> = {}): MadePattern {
  const made = pattern.make(cleanValues(pattern, values));
  const length = r6(made.length);
  const notes = made.notes
    .filter((x) => x.start >= 0 && x.start < length - 1e-6 && x.length > 0)
    .map((x) => ({
      pitch: Math.min(127, Math.max(0, Math.round(x.pitch))),
      start: r6(x.start),
      length: r6(Math.min(x.length, length - x.start)),
      velocity: Math.min(127, Math.max(1, Math.round(x.velocity))),
    }))
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return { length, notes };
}

/** The instruments that play bass lines (a bass line on a piano or strings sounds wrong, and the other way round). */
export const BASS_INSTRUMENTS: readonly string[] = ["bass", "synth-bass"];

/**
 * Whether a pattern suits a track playing this instrument: drum beats only go on a drum kit, bass lines only on a
 * bass, and chords and tunes on anything else (never the other way round: their notes would be the wrong sounds).
 */
export function patternSuitsInstrument(pattern: Pick<LibraryPattern, "kind">, instrument: string): boolean {
  if (pattern.kind === "drums" || instrument === "drums") return pattern.kind === "drums" && instrument === "drums";
  return (pattern.kind === "bass") === BASS_INSTRUMENTS.includes(instrument);
}
