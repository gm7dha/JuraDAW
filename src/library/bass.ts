/**
 * Bass lines for the library. Each follows a chosen sequence of chords, a bar
 * a chord, and is written as "what to play in one bar" from the chord's
 * lowest note — so every line works in every key, major or minor, and fits
 * the Chords patterns that use the same sequence. Pure.
 */
import { barDegrees, chordsInput, keyInput, keyOf, note, patternIcon, scaleInput, str, timesInput, type LibraryPattern, type MadePattern, type PatternInput, type PatternNote, type Values } from "./kit";
import { chordStep, degreeRoot, scaleStep } from "./theory";

const GROUP = "Bass lines";
/** Chord roots are put in the octave from this pitch up (C2), low enough to sit under chords and tunes. */
const LOW = 36;

/** What a bar's writer is handed. */
interface Bar {
  /** The chord's root, in the bass octave. */
  root: number;
  /** The root of the next bar's chord (the first bar's again after the last, since patterns are made to go round). */
  next: number;
  /** A note of the chord's scale counted up from the root: 2 is the chord's third, 4 its fifth, 7 the octave (see `chordStep` in theory.ts). */
  up: (steps: number) => number;
  /** A note of the scale counted from any pitch on it. */
  step: (pitch: number, steps: number) => number;
  /** Which bar this is, from 0. */
  index: number;
  values: Values;
}

interface Line {
  id: string;
  name: string;
  description: string;
  instrument: string;
  extra?: PatternInput[];
  /** One bar's notes, with starts counted from the bar's first beat. */
  bar: (b: Bar) => PatternNote[];
}

function line(spec: Line): LibraryPattern {
  const inputs = [keyInput(), scaleInput(), chordsInput(), ...(spec.extra ?? []), timesInput()];
  const make = (v: Values): MadePattern => {
    const { key, scale } = keyOf(v);
    const degrees = barDegrees(v);
    const roots = degrees.map((d) => degreeRoot(key, scale, d, LOW));
    const notes = roots.flatMap((root, index) =>
      spec
        .bar({ root, next: roots[(index + 1) % roots.length], up: (s) => chordStep(v.chords, degrees[index], root, s, key, scale), step: (p, s) => scaleStep(p, s, key, scale), index, values: v })
        .map((x) => ({ ...x, start: x.start + 4 * index })),
    );
    return { length: 4 * degrees.length, notes };
  };
  const defaults = Object.fromEntries(inputs.map((i) => [i.key, i.default]));
  return { id: spec.id, name: spec.name, description: spec.description, group: GROUP, icon: patternIcon(make(defaults), 4, false), kind: "bass", instrument: spec.instrument, beatsPerBar: 4, inputs, make };
}

export const BASS_PATTERNS: LibraryPattern[] = [
  line({
    id: "bass-roots",
    name: "Root notes",
    description: "The simplest bass line there is: the name-note of each chord, held or played on every beat.",
    instrument: "bass",
    extra: [
      {
        key: "style",
        label: "Play",
        kind: "choice",
        default: "long",
        choices: [
          { value: "long", label: "One long note a bar" },
          { value: "beats", label: "A note on every beat" },
        ],
      },
    ],
    bar: ({ root, values }) => (str(values, "style") === "beats" ? [0, 1, 2, 3].map((beat) => note(root, beat, 0.9, beat === 0 ? 104 : 90)) : [note(root, 0, 4, 100)]),
  }),
  line({
    id: "bass-root-fifth",
    name: "Root and fifth",
    description: "Two notes a bar, swapping between the chord's root and its fifth. The sound of country and folk.",
    instrument: "bass",
    bar: ({ root, up }) => [note(root, 0, 1.75, 102), note(up(4), 2, 1.75, 92)],
  }),
  line({
    id: "bass-octaves",
    name: "Octave bounce",
    description: "Low note, high note, low note, high note. Bouncy disco and dance bass.",
    instrument: "synth-bass",
    bar: ({ root }) => Array.from({ length: 8 }, (_, i) => note(root + (i % 2 ? 12 : 0), i * 0.5, 0.4, i % 2 ? 84 : 102)),
  }),
  line({
    id: "bass-eighths",
    name: "Driving eighths",
    description: "The same note eight times a bar, pushing the song along. Pop, rock and punk.",
    instrument: "bass",
    bar: ({ root }) => Array.from({ length: 8 }, (_, i) => note(root, i * 0.5, 0.45, i % 2 ? 84 : i === 0 ? 106 : 96)),
  }),
  line({
    id: "bass-walking",
    name: "Walking bass",
    description: "A note on every beat, stepping up through each chord and leading into the next. Jazz and blues.",
    instrument: "bass",
    bar: ({ root, next, up, step }) => {
      // Up the chord, then a note right next to where the next bar starts, coming from whichever side is nearer.
      const fifth = up(4);
      const from = next > fifth ? -1 : 1;
      const lead = step(next, from) === fifth ? step(next, -from) : step(next, from);
      return [note(root, 0, 0.95, 104), note(up(2), 1, 0.95, 92), note(fifth, 2, 0.95, 96), note(lead, 3, 0.95, 90)];
    },
  }),
  line({
    id: "bass-boogie",
    name: "Boogie shuffle",
    description: "Swinging up the chord and back down again, long-short, long-short. Rock and roll and boogie-woogie.",
    instrument: "bass",
    bar: ({ up }) => [0, 2, 4, 5, 7, 5, 4, 2].map((s, i) => note(up(s), Math.floor(i / 2) + (i % 2 ? 2 / 3 : 0), i % 2 ? 0.3 : 0.6, i % 2 ? 82 : 100)),
  }),
  line({
    id: "bass-reggae",
    name: "Reggae bass",
    description: "Leaves the first beat empty, then answers with a few fat, lazy notes.",
    instrument: "bass",
    bar: ({ root, up }) => [note(root, 1, 0.45, 104), note(root, 1.5, 0.75, 96), note(up(4), 2.5, 0.45, 92), note(up(2), 3, 0.45, 92), note(root, 3.5, 0.45, 98)],
  }),
  line({
    id: "bass-funk",
    name: "Funky bass",
    description: "Short, snappy notes that dodge the beat, jumping up an octave and back.",
    instrument: "synth-bass",
    bar: ({ root, up }) => [note(root, 0, 0.5, 108), note(root, 0.75, 0.2, 88), note(root + 12, 1.5, 0.2, 96), note(root, 2.5, 0.25, 100), note(up(4), 3, 0.25, 92), note(up(6), 3.5, 0.25, 96)],
  }),
];
