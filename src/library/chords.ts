/**
 * Chord sequences for the library: the ones most songs are built on. Chords
 * are made from the chosen scale (every other note above each chord's root —
 * with the blues' and jazz's own notes where those styles need them, see
 * `chordStep` in theory.ts), gathered close together around middle C so one
 * chord flows into the next, with the root underneath in the left hand. Pure.
 *
 * Names and descriptions count chords as steps of the scale (1–5–6–4), which
 * holds in major and minor alike; the chord names given are for C major.
 */
import { barDegrees, keyInput, keyOf, note, patternIcon, scaleInput, str, timesInput, type LibraryPattern, type MadePattern, type PatternInput, type PatternNote, type Values } from "./kit";
import { degreeRoot, progression, sequenceChord, voiced, type ScaleName } from "./theory";

const GROUP = "Chords";
/** Chords are gathered into the octave from this pitch up (the G below middle C). */
const CHORD_LOW = 55;
/** The left hand's root is in the octave from this pitch up (C2). */
const BASS_LOW = 36;

const styleInput: PatternInput = {
  key: "style",
  label: "Played as",
  kind: "choice",
  default: "held",
  choices: [
    { value: "held", label: "Held chords" },
    { value: "beats", label: "A chord on every beat" },
    { value: "rhythm", label: "Pop rhythm" },
    { value: "arpeggio", label: "Broken chords (arpeggio)" },
  ],
};

const typeInput = (def: "plain" | "sevenths"): PatternInput => ({
  key: "type",
  label: "Chords",
  kind: "choice",
  default: def,
  choices: [
    { value: "plain", label: "Plain (three notes)" },
    { value: "sevenths", label: "Sevenths (four notes, jazzier)" },
  ],
});

const lowInput: PatternInput = {
  key: "low",
  label: "Low note under each chord",
  kind: "choice",
  default: "yes",
  choices: [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No (leave room for a bass line)" },
  ],
};

/** The same chord's notes at once. */
const together = (chord: readonly number[], start: number, length: number, velocity: number): PatternNote[] => chord.map((p) => note(p, start, length, velocity));

/** One bar of a chord in a style (starts counted from the bar's first beat). */
function barOf(chord: number[], style: string): PatternNote[] {
  switch (style) {
    case "beats":
      return [0, 1, 2, 3].flatMap((beat) => together(chord, beat, 0.9, beat === 0 ? 96 : 80));
    case "rhythm":
      // On 1, then pushed ahead of beats 3 and 4, and once more to lead round.
      return [...together(chord, 0, 1.4, 98), ...together(chord, 1.5, 0.9, 84), ...together(chord, 2.5, 0.9, 90), ...together(chord, 3.5, 0.45, 80)];
    case "arpeggio": {
      // Up and back down, a note at a time.
      const order = chord.length >= 4 ? [0, 1, 2, 3, 2, 1, 2, 3] : [0, 1, 2, 1, 0, 1, 2, 1];
      return order.map((i, at) => note(chord[i], at * 0.5, 0.5, at % 4 === 0 ? 96 : 82));
    }
    default:
      return together(chord, 0, 4, 90);
  }
}

interface Sequence {
  id: string;
  name: string;
  description: string;
  /** The id of its chords in theory.ts PROGRESSIONS. */
  chords: string;
  /** The scale it starts on (major unless said). */
  scale?: ScaleName;
  type?: "plain" | "sevenths";
  instrument?: string;
}

function sequence(spec: Sequence): LibraryPattern {
  // A sequence that only comes in one scale doesn't offer the choice.
  const fixed = progression(spec.chords).scale;
  const inputs = [keyInput(), ...(fixed ? [] : [scaleInput(spec.scale ?? "major")]), styleInput, typeInput(spec.type ?? "plain"), lowInput, timesInput(1, 4)];
  const make = (v: Values): MadePattern => {
    const { key, scale } = keyOf(v, spec.chords);
    const degrees = barDegrees(v, spec.chords);
    const size = str(v, "type") === "sevenths" ? 4 : 3;
    const notes = degrees.flatMap((degree, bar) => {
      const chord = voiced(sequenceChord(spec.chords, degree, degreeRoot(key, scale, degree, CHORD_LOW), key, scale, size), CHORD_LOW);
      const low = str(v, "low") === "no" ? [] : [note(degreeRoot(key, scale, degree, BASS_LOW), 0, 4, 92)];
      return [...low, ...barOf(chord, str(v, "style"))].map((x) => ({ ...x, start: x.start + 4 * bar }));
    });
    return { length: 4 * degrees.length, notes };
  };
  const defaults = Object.fromEntries(inputs.map((i) => [i.key, i.default]));
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    group: GROUP,
    icon: patternIcon(make({ ...defaults, low: "no" }), 8, false),
    kind: "chords",
    instrument: spec.instrument ?? "piano",
    beatsPerBar: 4,
    inputs,
    make,
  };
}

export const CHORD_PATTERNS: LibraryPattern[] = [
  sequence({
    id: "chords-pop",
    name: "Pop chords (1–5–6–4)",
    description: "The four chords behind hundreds of hit songs. In C major: C, G, A minor, F.",
    chords: "pop",
  }),
  sequence({
    id: "chords-sad",
    name: "Bittersweet chords (6–4–1–5)",
    description: "The same four chords starting from the sad one, for a more wistful song. In C major: A minor, F, C, G.",
    chords: "sad",
  }),
  sequence({
    id: "chords-fifties",
    name: "Fifties chords (1–6–4–5)",
    description: "The doo-wop sound of old love songs. In C major: C, A minor, F, G.",
    chords: "fifties",
  }),
  sequence({
    id: "chords-rock",
    name: "Three-chord rock (1–4–5–4)",
    description: "Three chords are all you need for rock and roll. In C major: C, F, G, F.",
    chords: "rock",
    instrument: "organ",
  }),
  sequence({
    id: "chords-blues",
    name: "12-bar blues",
    description: "The twelve bars that blues, rock and roll and jazz all grew from. In C major: four of C, two of F, two of C, then G, F, C, G. Choose sevenths for the real blues sound (C7, F7, G7).",
    chords: "blues",
    instrument: "electric-piano",
  }),
  sequence({
    id: "chords-jazz",
    name: "Jazz turnaround (2–5–1)",
    description: "The most common move in jazz, with rich four-note chords. In C major: D minor 7, G7, C major 7.",
    chords: "jazz",
    type: "sevenths",
    instrument: "electric-piano",
  }),
  sequence({
    id: "chords-canon",
    name: "Canon chords",
    description: "The eight chords of Pachelbel's Canon, heard at weddings and in many pop songs. In C major: C, G, A minor, E minor, F, C, F, G.",
    chords: "canon",
    instrument: "strings",
  }),
  sequence({
    id: "chords-epic",
    name: "Epic minor chords (1–6–3–7)",
    description: "Dark and dramatic: film music and big choruses. Always in a minor key. In A minor: A minor, F, C, G.",
    chords: "epic",
    instrument: "pad",
  }),
];
