/**
 * Melodies and arpeggios for the library: broken chords that follow a chosen
 * sequence of chords, scales to play along to, and short tunes. Everything is
 * counted in notes of the chosen scale, so it stays in key. Pure.
 */
import { barDegrees, chordsInput, keyInput, keyOf, n, note, patternIcon, scaleInput, str, timesInput, type LibraryPattern, type MadePattern, type PatternInput, type PatternNote, type Values } from "./kit";
import { PENTATONIC, chordStep, degreeRoot, foldInto, scalePitch } from "./theory";

const GROUP = "Melodies and arps";

const speedInput: PatternInput = {
  key: "speed",
  label: "Speed",
  kind: "choice",
  default: "eighths",
  choices: [
    { value: "eighths", label: "Steady (two notes a beat)" },
    { value: "sixteenths", label: "Fast (four notes a beat)" },
  ],
};

interface Follower {
  id: string;
  name: string;
  description: string;
  instrument: string;
  /** Chord roots are put in the octave from this pitch up. */
  low: number;
  extra?: PatternInput[];
  /** One bar's notes (starts from the bar's first beat); `up(steps)` is a note counted up the scale from the chord's root (see `chordStep` in theory.ts). */
  bar: (up: (steps: number) => number, index: number, values: Values) => PatternNote[];
}

/** A pattern that follows the chosen chords, a bar a chord. */
function follower(spec: Follower): LibraryPattern {
  const inputs = [keyInput(), scaleInput(), chordsInput(), ...(spec.extra ?? []), timesInput()];
  const make = (v: Values): MadePattern => {
    const { key, scale } = keyOf(v);
    const degrees = barDegrees(v);
    const notes = degrees.flatMap((degree, index) => {
      const root = degreeRoot(key, scale, degree, spec.low);
      return spec.bar((s) => chordStep(v.chords, degree, root, s, key, scale), index, v).map((x) => ({ ...x, start: x.start + 4 * index }));
    });
    return { length: 4 * degrees.length, notes };
  };
  const defaults = Object.fromEntries(inputs.map((i) => [i.key, i.default]));
  return { id: spec.id, name: spec.name, description: spec.description, group: GROUP, icon: patternIcon(make(defaults), 4, false), kind: "melody", instrument: spec.instrument, beatsPerBar: 4, inputs, make };
}

/** Scale steps played one after another, evenly, filling a bar: eight notes, or sixteen (the steps twice) when fast. */
function run(up: (steps: number) => number, steps: readonly number[], values: Values): PatternNote[] {
  const fast = str(values, "speed") === "sixteenths";
  const each = fast ? 0.25 : 0.5;
  return Array.from({ length: fast ? 16 : 8 }, (_, i) => note(up(steps[i % steps.length]), i * each, each, i % (fast ? 4 : 2) === 0 ? 98 : 82));
}

const FOLLOWERS: LibraryPattern[] = [
  follower({
    id: "melody-arp-up",
    name: "Rising arpeggio",
    description: "Each chord's notes one at a time, climbing: root, third, fifth, octave, and round again.",
    instrument: "pluck",
    low: 60,
    extra: [speedInput],
    bar: (up, _index, values) => run(up, [0, 2, 4, 7], values),
  }),
  follower({
    id: "melody-arp-wave",
    name: "Up and down arpeggio",
    description: "Each chord's notes rippling up past the octave and back down again.",
    instrument: "electric-piano",
    low: 55,
    extra: [speedInput],
    bar: (up, _index, values) => run(up, [0, 2, 4, 7, 9, 7, 4, 2], values),
  }),
  follower({
    id: "melody-rocking",
    name: "Rocking chords",
    description: "Low, high, middle, high: the gently rocking left hand of classical piano (an Alberti bass).",
    instrument: "piano",
    low: 48,
    bar: (up, _index, values) => run(up, [0, 4, 2, 4], values),
  }),
  follower({
    id: "melody-music-box",
    name: "Music box",
    description: "High, twinkling notes that dance round each chord.",
    instrument: "bells",
    low: 72,
    bar: (up, _index, values) => run(up, [7, 4, 2, 4, 9, 4, 7, 4], values),
  }),
  follower({
    id: "melody-call-answer",
    name: "Call and answer tune",
    description: "A little tune in two halves: a bar that asks a question, then a bar that answers it.",
    instrument: "lead",
    low: 60,
    bar: (up, index) =>
      index % 2 === 0
        ? [note(up(2), 0, 1, 100), note(up(4), 1, 0.5, 92), note(up(3), 1.5, 0.5, 86), note(up(2), 2, 1.5, 96)]
        : [note(up(4), 0, 1, 100), note(up(2), 1, 0.5, 90), note(up(1), 1.5, 0.5, 86), note(up(0), 2, 2, 98)],
  }),
];

function makeScale(v: Values): MadePattern {
  const { key, scale } = keyOf(v);
  const octaves = Math.max(1, Math.min(2, Math.round(n(v, "octaves")) || 1));
  const each = str(v, "speed") === "sixteenths" ? 0.25 : str(v, "speed") === "beats" ? 1 : 0.5;
  // From the key note in the octave from middle C up — a little lower when going up two octaves.
  const from = foldInto(key, octaves === 2 ? 48 : 60);
  const top = 7 * octaves;
  const steps = [...Array.from({ length: top + 1 }, (_, i) => i), ...Array.from({ length: top }, (_, i) => top - 1 - i)];
  const notes = steps.map((s, i) => note(scalePitch(from, scale, s), i * each, i === steps.length - 1 ? Math.max(each, 1) : each, s % 7 === 0 ? 100 : 86));
  const end = (steps.length - 1) * each + Math.max(each, 1);
  return { length: Math.ceil(end / 4 - 1e-9) * 4, notes };
}

const SCALE_RUN: LibraryPattern = {
  id: "melody-scale",
  name: "Scale up and down",
  description: "The notes of the key in order, up and back down. Handy for hearing what a key sounds like, and for practising.",
  group: GROUP,
  icon: patternIcon(makeScale({ key: "C", scale: "major", octaves: 1, speed: "eighths" }), 4, false),
  kind: "melody",
  instrument: "piano",
  beatsPerBar: 4,
  inputs: [
    keyInput(),
    scaleInput(),
    { key: "octaves", label: "Octaves", kind: "count", default: 1, min: 1, max: 2 },
    {
      key: "speed",
      label: "Speed",
      kind: "choice",
      default: "eighths",
      choices: [
        { value: "beats", label: "Slow (a note a beat)" },
        { value: "eighths", label: "Steady (two notes a beat)" },
        { value: "sixteenths", label: "Fast (four notes a beat)" },
      ],
    },
  ],
  make: makeScale,
};

/** A two-bar riff as [place in the five-note scale, start beat, length, velocity]; 5 is the key note an octave up. */
const RIFF: readonly [number, number, number, number][] = [
  [0, 0, 0.5, 104],
  [2, 0.5, 0.5, 90],
  [3, 1, 0.75, 98],
  [2, 1.75, 0.25, 84],
  [3, 2, 0.5, 94],
  [4, 2.5, 0.5, 96],
  [5, 3, 1, 104],
  [5, 4, 0.5, 100],
  [4, 4.5, 0.5, 90],
  [3, 5, 0.75, 96],
  [2, 5.75, 0.25, 84],
  [1, 6, 0.5, 90],
  [2, 6.5, 0.5, 92],
  [0, 7, 1, 102],
];

function makeRiff(v: Values): MadePattern {
  const { key, scale } = keyOf(v);
  const times = Math.max(1, Math.round(n(v, "times")) || 1);
  const from = foldInto(key, 60);
  const five = PENTATONIC[scale];
  const pitchAt = (place: number) => scalePitch(from, scale, five[place % 5] + 7 * Math.floor(place / 5));
  const notes = Array.from({ length: times }, (_, t) => RIFF.map(([place, start, length, velocity]) => note(pitchAt(place), start + 8 * t, length, velocity))).flat();
  return { length: 8 * times, notes };
}

const RIFF_PATTERN: LibraryPattern = {
  id: "melody-riff",
  name: "Five-note riff",
  description: "A catchy two-bar riff using only the five notes of the key that always sound good together (the pentatonic scale).",
  group: GROUP,
  icon: patternIcon(makeRiff({ key: "C", scale: "major", times: 1 }), 4, false),
  kind: "melody",
  instrument: "lead",
  beatsPerBar: 4,
  inputs: [keyInput(), scaleInput("minor"), timesInput(2, 8)],
  make: makeRiff,
};

export const MELODY_PATTERNS: LibraryPattern[] = [...FOLLOWERS, SCALE_RUN, RIFF_PATTERN];
