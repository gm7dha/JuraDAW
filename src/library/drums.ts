/**
 * Drum beats for the library. Each is written as rows of a rhythm grid, one
 * row a drum (see `row` in kit.ts), so the code reads like the beat sounds.
 * Pitches are the drum kit's (DRUM_PITCHES in src/model/time.ts). Pure.
 */
import { barsInput, n, note, patternIcon, row, str, type LibraryPattern, type MadePattern, type PatternInput, type PatternNote, type Values } from "./kit";

const KICK = 36;
const RIM = 37;
const SNARE = 38;
const CLAP = 39;
const LOW_TOM = 41;
const HAT = 42;
const MID_TOM = 45;
const OPEN_HAT = 46;
const HIGH_TOM = 48;
const CRASH = 49;
const RIDE = 51;
const SHAKER = 70;

const GROUP = "Drum beats";

const cymbalInput: PatternInput = {
  key: "cymbal",
  label: "Keeping time on",
  kind: "choice",
  default: "hat",
  choices: [
    { value: "hat", label: "Hi-hat" },
    { value: "ride", label: "Ride cymbal" },
    { value: "shaker", label: "Shaker" },
  ],
};

const endingInput: PatternInput = {
  key: "ending",
  label: "Last bar",
  kind: "choice",
  default: "same",
  choices: [
    { value: "same", label: "Same as the others" },
    { value: "fill", label: "Ends with a fill" },
  ],
  help: "A fill is a short run round the drums that leads into the next part.",
};

const startInput: PatternInput = {
  key: "crash",
  label: "First beat",
  kind: "choice",
  default: "plain",
  choices: [
    { value: "plain", label: "As the rest" },
    { value: "crash", label: "Crash cymbal" },
  ],
};

/** A run round the drums over the steps of a grid: snare, then down the toms, getting louder. */
function fill(from: number, steps: number, step: number): PatternNote[] {
  return Array.from({ length: steps }, (_, i) => {
    const share = i / steps;
    const pitch = share < 0.5 ? SNARE : share < 0.75 ? MID_TOM : LOW_TOM;
    return note(pitch, from + i * step, step, Math.round(84 + 34 * (i / Math.max(1, steps - 1))));
  });
}

interface Beat {
  id: string;
  name: string;
  description: string;
  /** Beats in a bar (4 unless said). */
  beatsPerBar?: number;
  /** How long one letter of a row lasts, in beats. */
  step: number;
  /** One row a drum; each row is one bar long, or a whole number of bars (they come round in turn). */
  rows: [pitch: number, pattern: string][];
  bars?: number;
}

function beat(spec: Beat): LibraryPattern {
  const beatsPerBar = spec.beatsPerBar ?? 4;
  const stepsPerBar = Math.round(beatsPerBar / spec.step);
  const make = (v: Values): MadePattern => {
    const bars = Math.max(1, Math.round(n(v, "bars")) || 1);
    const length = bars * beatsPerBar;
    const cymbal = str(v, "cymbal");
    const keeper = cymbal === "ride" ? RIDE : cymbal === "shaker" ? SHAKER : HAT;
    let notes: PatternNote[] = [];
    for (const [pitch, pattern] of spec.rows) {
      const ownBars = Math.max(1, Math.round(pattern.length / stepsPerBar));
      for (let bar = 0; bar < bars; bar++) {
        const from = (bar % ownBars) * stepsPerBar;
        // The ride and the shaker take over from both the closed and the open hi-hat.
        const played = keeper !== HAT && (pitch === HAT || pitch === OPEN_HAT) ? keeper : pitch;
        notes.push(...row(played, pattern.slice(from, from + stepsPerBar), spec.step, bar * beatsPerBar, pitch === OPEN_HAT && played === OPEN_HAT ? spec.step * 2 : spec.step));
      }
    }
    if (str(v, "ending") === "fill") {
      // The last two beats (the last beat of a short bar) make way for the fill; the kick carries on underneath.
      const fillBeats = beatsPerBar >= 4 ? 2 : 1;
      const from = length - fillBeats;
      notes = notes.filter((x) => x.start < from - 1e-6 || x.pitch === KICK);
      notes.push(...fill(from, Math.round(fillBeats / spec.step), spec.step));
    }
    if (str(v, "crash") === "crash") {
      notes = notes.filter((x) => x.start > 1e-6 || (x.pitch !== HAT && x.pitch !== RIDE && x.pitch !== SHAKER && x.pitch !== OPEN_HAT));
      notes.push(note(CRASH, 0, 1, 108));
    }
    notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    return { length, notes };
  };
  const inputs = [barsInput(spec.bars ?? 4), cymbalInput, endingInput, startInput];
  const defaults = Object.fromEntries(inputs.map((i) => [i.key, i.default]));
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    group: GROUP,
    icon: patternIcon(make({ ...defaults, bars: 2 }), beatsPerBar, true),
    kind: "drums",
    instrument: "drums",
    beatsPerBar,
    inputs,
    make,
  };
}

const SIXTEENTH = 0.25;
const EIGHTH = 0.5;
const TRIPLET = 1 / 3;

const BEATS: LibraryPattern[] = [
  beat({
    id: "drums-rock",
    name: "Rock beat",
    description: "The beat behind a thousand songs: kick on 1 and 3, snare on 2 and 4, steady hi-hat.",
    step: SIXTEENTH,
    rows: [
      [HAT, "x.o.x.o.x.o.x.o."],
      [SNARE, "....x.......x..."],
      [KICK, "x.......x.x....."],
    ],
  }),
  beat({
    id: "drums-pop",
    name: "Pop beat",
    description: "A bouncy kick with a clap on top of the snare and an open hi-hat to finish each bar.",
    step: SIXTEENTH,
    rows: [
      [HAT, "x.o.x.o.x.o.x..."],
      [OPEN_HAT, "..............o."],
      [CLAP, "....o.......o..."],
      [SNARE, "....x.......x..."],
      [KICK, "x.....x.x......."],
    ],
  }),
  beat({
    id: "drums-dance",
    name: "Four on the floor",
    description: "Dance music's heartbeat: a kick on every beat, claps on 2 and 4, open hi-hats in between.",
    step: SIXTEENTH,
    rows: [
      [HAT, "o...o...o...o..."],
      [OPEN_HAT, "..x...x...x...x."],
      [CLAP, "....x.......x..."],
      [KICK, "X...x...x...x..."],
    ],
  }),
  beat({
    id: "drums-hiphop",
    name: "Hip-hop beat",
    description: "Laid-back boom-bap: a heavy kick that skips ahead of the beat, and a snare on 2 and 4.",
    step: SIXTEENTH,
    rows: [
      [HAT, "x.o.x.o.x.o.x.o."],
      [SNARE, "....X.......X..."],
      [KICK, "x......x..x....."],
    ],
  }),
  beat({
    id: "drums-funk",
    name: "Funk beat",
    description: "Busy and bouncy, with quiet ghost notes on the snare between the big hits.",
    step: SIXTEENTH,
    rows: [
      [HAT, "x.o.x.o.x.o.x.o."],
      [SNARE, "....X..g.g..X..g"],
      [KICK, "x.x...x...x..x.."],
    ],
  }),
  beat({
    id: "drums-shuffle",
    name: "Blues shuffle",
    description: "The swinging long-short, long-short feel of blues and rock and roll.",
    step: TRIPLET,
    rows: [
      [HAT, "x.ox.ox.ox.o"],
      [SNARE, "...x.....x.."],
      [KICK, "x.....x....."],
    ],
  }),
  beat({
    id: "drums-ballad",
    name: "Slow ballad",
    description: "A gentle rolling beat of three hi-hats to each beat, for slow songs.",
    step: TRIPLET,
    rows: [
      [HAT, "xooxooxooxoo"],
      [SNARE, "...x.....x.."],
      [KICK, "x.....x....o"],
    ],
  }),
  beat({
    id: "drums-bossa",
    name: "Bossa nova",
    description: "A soft Brazilian rhythm: a clicking rim pattern across two bars over a swaying kick.",
    step: EIGHTH,
    bars: 4,
    rows: [
      [HAT, "xoxoxoxoxoxoxoxo"],
      [RIM, "x..x..x...x..x.."],
      [KICK, "x..xx..xx..xx..x"],
    ],
  }),
  beat({
    id: "drums-waltz",
    name: "Waltz",
    description: "Three beats in a bar: oom-pah-pah. Set the song to 3 beats in a bar to go with it.",
    beatsPerBar: 3,
    step: EIGHTH,
    rows: [
      [HAT, "x.x.x."],
      [SNARE, "..o.o."],
      [KICK, "x....."],
    ],
  }),
  beat({
    id: "drums-halftime",
    name: "Half-time beat",
    description: "The snare lands only once a bar, on beat 3, so everything feels slower and heavier.",
    step: SIXTEENTH,
    rows: [
      [HAT, "x.o.x.o.x.o.x.o."],
      [SNARE, "........X......."],
      [KICK, "x.........x....."],
    ],
  }),
  beat({
    id: "drums-reggae",
    name: "Reggae one drop",
    description: "Nothing on beat 1: the kick and a rim click drop together on beat 3.",
    step: SIXTEENTH,
    rows: [
      [HAT, "x.o.x.o.x.o.x.o."],
      [RIM, "........x......."],
      [KICK, "........x......."],
    ],
  }),
];

const FILL_STYLES: Record<string, [pitch: number, pattern: string][]> = {
  toms: [
    [SNARE, "xxxx............"],
    [HIGH_TOM, "....xxxx........"],
    [MID_TOM, "........xxxx...."],
    [LOW_TOM, "............xxxX"],
    [KICK, "x...x...x...x..."],
  ],
  build: [
    [SNARE, "o...o...o.o.xxxX"],
    [KICK, "x...x...x...x..."],
  ],
  short: [
    [HAT, "x.o.x.o........."],
    [SNARE, "....x...x.xx...."],
    [HIGH_TOM, "............x..."],
    [MID_TOM, ".............x.."],
    [LOW_TOM, "..............xX"],
    [KICK, "x.......x......."],
  ],
};

const fillInputs: PatternInput[] = [
  {
    key: "style",
    label: "Kind of fill",
    kind: "choice",
    default: "toms",
    choices: [
      { value: "toms", label: "Round the toms" },
      { value: "build", label: "Snare build-up" },
      { value: "short", label: "Half a bar of beat, then a fill" },
    ],
  },
  {
    key: "crash",
    label: "After the fill",
    kind: "choice",
    default: "crash",
    choices: [
      { value: "crash", label: "A bar starting with a crash" },
      { value: "none", label: "Nothing" },
    ],
  },
];

function makeFill(v: Values): MadePattern {
  const rows = FILL_STYLES[str(v, "style")] ?? FILL_STYLES.toms;
  const notes = rows.flatMap(([pitch, pattern]) => row(pitch, pattern, SIXTEENTH));
  if (str(v, "crash") !== "crash") return { length: 4, notes: notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch) };
  // The crash the fill was leading to, on the first beat of the next bar, with the kick under it.
  notes.push(note(CRASH, 4, 2, 112), note(KICK, 4, SIXTEENTH, 110));
  return { length: 8, notes: notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch) };
}

const FILL: LibraryPattern = {
  id: "drums-fill",
  name: "Drum fill",
  description: "A one-bar run round the drums to lead from one part of a song into the next.",
  group: GROUP,
  icon: patternIcon(makeFill({ style: "toms", crash: "none" }), 2, true),
  kind: "drums",
  instrument: "drums",
  beatsPerBar: 4,
  inputs: fillInputs,
  make: makeFill,
};

export const DRUM_PATTERNS: LibraryPattern[] = [...BEATS, FILL];
