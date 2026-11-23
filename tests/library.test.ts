import { describe, expect, it } from "vitest";
import { GROUP_ORDER, groupPatterns, searchPatterns } from "../src/library/browse";
import { LIBRARY, cleanValues, defaultValues, findPattern, makePattern, patternSuitsInstrument } from "../src/library/catalogue";
import * as front from "../src/library/patterns";
import type { LibraryPattern, Values } from "../src/library/kit";
import { KEYS, PENTATONIC, PROGRESSIONS, SCALES, chordFrom, chordStep, degreeRoot, foldInto, inScale, keyIndex, scaleFor, scalePitch, scaleStep, sequenceChord, voiced, type ScaleName } from "../src/library/theory";
import { DRUM_PITCHES, pitchName } from "../src/model/time";

import { INSTRUMENTS as BUILT_IN } from "../src/audio/instruments";
import { isDrumKit } from "../src/model/document";
const INSTRUMENTS = BUILT_IN.map((i) => i.id);
const DRUMS = new Set(DRUM_PITCHES.map((d) => d.pitch));
const names = (pitches: number[]) => pitches.map(pitchName).join(" ");

/** Every mix of a pattern's choices worth trying: each choice input through all its values, counts at both ends. */
function variations(p: LibraryPattern): Values[] {
  const base = defaultValues(p);
  const out: Values[] = [base];
  for (const input of p.inputs) {
    if (input.key === "key" || input.key === "scale") continue;
    const tries = input.kind === "choice" ? input.choices!.map((c) => c.value) : [input.min!, input.max!];
    for (const value of tries) out.push({ ...base, [input.key]: value });
  }
  return out;
}

describe("music theory", () => {
  it("knows the major and minor scales", () => {
    expect(names(Array.from({ length: 8 }, (_, i) => scalePitch(60, "major", i)))).toBe("C4 D4 E4 F4 G4 A4 B4 C5");
    expect(names(Array.from({ length: 8 }, (_, i) => scalePitch(57, "minor", i)))).toBe("A3 B3 C4 D4 E4 F4 G4 A4");
    expect(scalePitch(60, "major", -1)).toBe(59);
    expect(scalePitch(60, "major", 14)).toBe(84);
    expect(SCALES.major.length).toBe(7);
    expect(KEYS.map((k) => k.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(keyIndex("Eb")).toBe(3);
    expect(keyIndex("H")).toBe(0);
  });
  it("steps along a scale from any of its notes", () => {
    // G major: G A B C D E F#.
    expect(names([0, 1, 2, 6, 7, -1, -7].map((s) => scaleStep(67, s, 7, "major")))).toBe("G4 A4 B4 F#5 G5 F#4 G3");
    // From E in C major, a third up is G, a fifth up is B.
    expect(names([2, 4].map((s) => scaleStep(64, s, 0, "major")))).toBe("G4 B4");
    expect(inScale(66, 7, "major")).toBe(true);
    expect(inScale(65, 7, "major")).toBe(false);
  });
  it("builds the right chord on each degree of the scale", () => {
    const triad = (key: number, scale: "major" | "minor", degree: number) => names(chordFrom(degreeRoot(key, scale, degree, 60), key, scale));
    // C major: C, Dm, Em, F, G, Am, B diminished.
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => triad(0, "major", d))).toEqual(["C4 E4 G4", "D4 F4 A4", "E4 G4 B4", "F4 A4 C5", "G4 B4 D5", "A4 C5 E5", "B4 D5 F5"]);
    // A minor: Am, B diminished, C, Dm, Em, F, G.
    expect([1, 3, 6, 7].map((d) => triad(9, "minor", d))).toEqual(["A4 C5 E5", "C4 E4 G4", "F4 A4 C5", "G4 B4 D5"]);
    // Sevenths in C: Dm7, G7 (the only one with a major third and a flat seventh), Cmaj7.
    expect(names(chordFrom(62, 0, "major", 4))).toBe("D4 F4 A4 C5");
    expect(names(chordFrom(67, 0, "major", 4))).toBe("G4 B4 D5 F5");
    expect(names(chordFrom(60, 0, "major", 4))).toBe("C4 E4 G4 B4");
    // D major's chord on its fifth degree is A major (with C#).
    expect(triad(2, "major", 5)).toBe("A4 C#5 E5");
  });
  it("gathers chords into one octave so they sit close together", () => {
    expect(foldInto(84, 55)).toBe(60);
    expect(foldInto(54, 55)).toBe(66);
    expect(names(voiced([65, 69, 72], 55))).toBe("A3 C4 F4");
    expect(names(voiced([67, 71, 74], 55))).toBe("G3 B3 D4");
    expect(voiced([60, 72, 64], 55)).toEqual([60, 64]);
  });
  it("has the five-note scales and the chord sequences", () => {
    expect(names(PENTATONIC.major.map((s) => scalePitch(60, "major", s)))).toBe("C4 D4 E4 G4 A4");
    expect(names(PENTATONIC.minor.map((s) => scalePitch(57, "minor", s)))).toBe("A3 C4 D4 E4 G4");
    expect(PROGRESSIONS.find((p) => p.id === "blues")!.degrees.length).toBe(12);
    expect(PROGRESSIONS.every((p) => p.degrees.every((d) => d >= 1 && d <= 7))).toBe(true);
  });
});

describe("the library", () => {
  it("has plenty of patterns under each heading, each one described", () => {
    expect(LIBRARY.length).toBeGreaterThanOrEqual(24);
    expect(new Set(LIBRARY.map((p) => p.id)).size).toBe(LIBRARY.length);
    expect(new Set(LIBRARY.map((p) => p.name)).size).toBe(LIBRARY.length);
    const count = (group: string) => LIBRARY.filter((p) => p.group === group).length;
    expect(count("Drum beats")).toBeGreaterThanOrEqual(10);
    expect(count("Bass lines")).toBeGreaterThanOrEqual(5);
    expect(count("Chords")).toBeGreaterThanOrEqual(7);
    expect(count("Melodies and arps")).toBeGreaterThanOrEqual(5);
    for (const p of LIBRARY) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      expect(p.name.length).toBeGreaterThan(2);
      expect(p.description.length).toBeGreaterThan(20);
      expect(GROUP_ORDER).toContain(p.group);
      expect(INSTRUMENTS).toContain(p.instrument);
      expect((p.kind === "drums") === isDrumKit(p.instrument)).toBe(true);
      expect(p.beatsPerBar === 4 || p.beatsPerBar === 3).toBe(true);
    }
  });
  it("draws every pattern a picture in currentColor, with nothing that could run", () => {
    for (const p of LIBRARY) {
      expect(p.icon).toMatch(/^<g fill="currentColor" stroke="none">(<rect [^<>]*\/>)+<\/g>$/);
      expect(p.icon).not.toMatch(/script|href|on\w+=|#[0-9a-f]{3}/i);
      // Everything inside the 48 × 48 box.
      for (const m of p.icon.matchAll(/x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
        const [x, y, w, h] = m.slice(1).map(Number);
        expect(x >= 0 && y >= 0 && x + w <= 48 && y + h <= 48, `${p.id}: ${m[0]}`).toBe(true);
      }
    }
  });
  it("gives every input a label, a usable default and limits", () => {
    for (const p of LIBRARY) {
      expect(new Set(p.inputs.map((i) => i.key)).size).toBe(p.inputs.length);
      for (const input of p.inputs) {
        expect(input.label.length).toBeGreaterThan(1);
        if (input.kind === "choice") {
          expect(input.choices!.length).toBeGreaterThanOrEqual(2);
          expect(input.choices!.map((c) => c.value)).toContain(input.default);
        } else {
          expect(typeof input.default).toBe("number");
          expect(input.min! <= (input.default as number) && (input.default as number) <= input.max!).toBe(true);
        }
      }
    }
  });
  it("makes notes inside the pattern, in range, in every variation", () => {
    for (const p of LIBRARY) {
      for (const values of variations(p)) {
        const made = makePattern(p, values);
        const what = `${p.id} ${JSON.stringify(values)}`;
        expect(made.notes.length, what).toBeGreaterThan(0);
        expect(made.length, what).toBeGreaterThan(0);
        // Whole bars.
        expect(Math.abs(made.length / p.beatsPerBar - Math.round(made.length / p.beatsPerBar)), what).toBeLessThan(1e-6);
        for (const n of made.notes) {
          expect(n.start >= 0 && n.start < made.length, `${what} start ${n.start}`).toBe(true);
          expect(n.length > 0 && n.start + n.length <= made.length + 1e-6, `${what} end ${n.start + n.length}`).toBe(true);
          expect(Number.isInteger(n.pitch) && n.pitch >= 0 && n.pitch <= 127, `${what} pitch ${n.pitch}`).toBe(true);
          expect(Number.isInteger(n.velocity) && n.velocity >= 1 && n.velocity <= 127, `${what} velocity ${n.velocity}`).toBe(true);
        }
        // In order, and never the same note twice at the same moment.
        const seen = new Set<string>();
        made.notes.forEach((n, i) => {
          if (i) expect(n.start >= made.notes[i - 1].start, what).toBe(true);
          const at = `${n.pitch}@${n.start}`;
          expect(seen.has(at), `${what} doubled ${at}`).toBe(false);
          seen.add(at);
        });
      }
    }
  });
  it("uses only the drum kit's sounds in drum patterns", () => {
    for (const p of LIBRARY.filter((x) => x.kind === "drums")) {
      for (const values of variations(p)) for (const n of makePattern(p, values).notes) expect(DRUMS.has(n.pitch), `${p.id} pitch ${n.pitch}`).toBe(true);
    }
  });
  it("keeps every tuned pattern on the scale, in every key, major and minor, in every variation", () => {
    /** The chords a pattern is playing: its own if it's a chord sequence, else the ones chosen to follow. */
    const chordsOf = (p: LibraryPattern, values: Values) => (p.kind === "chords" ? p.id.replace("chords-", "") : String(values.chords ?? ""));
    /** The only notes from outside the scale there may be: the blues' flattened sevenths in major, jazz's raised seventh in minor. */
    const outside = (chords: string, key: number, scale: ScaleName) =>
      chords === "blues" && scale === "major" ? [(key + 10) % 12, (key + 3) % 12] : chords === "jazz" && scale === "minor" ? [(key + 11) % 12] : [];
    let outsideNotes = 0;
    for (const p of LIBRARY.filter((x) => x.kind !== "drums")) {
      expect(p.inputs.map((i) => i.key)).toContain("key");
      for (const key of KEYS) {
        for (const chosen of ["major", "minor"] as const) {
          for (const values of variations(p)) {
            const chords = chordsOf(p, values);
            const scale = scaleFor(chords, chosen);
            const allowed = outside(chords, key.index, scale);
            for (const n of makePattern(p, { ...values, key: key.value, scale: chosen }).notes) {
              const fits = inScale(n.pitch, key.index, scale);
              if (!fits) outsideNotes++;
              expect(fits || allowed.includes(n.pitch % 12), `${p.id} ${JSON.stringify(values)} in ${key.value} ${scale}: ${pitchName(n.pitch)}`).toBe(true);
            }
          }
        }
      }
    }
    expect(outsideNotes).toBeGreaterThan(0);
  });
  it("moves a pattern up exactly with its key", () => {
    for (const p of LIBRARY.filter((x) => x.kind !== "drums")) {
      const inC = makePattern(p, { key: "C" }).notes;
      const inD = makePattern(p, { key: "D" }).notes;
      expect(inD.length).toBe(inC.length);
      // The same tune, give or take whole octaves (notes are kept in a comfortable range).
      const classes = (notes: typeof inC, shift: number) => notes.map((n) => `${n.start}:${(n.pitch + shift) % 12}`).sort().join(" ");
      expect(classes(inD, 0)).toBe(classes(inC, 2));
    }
  });
  it("keeps instruments in a comfortable range", () => {
    for (const p of LIBRARY.filter((x) => x.kind !== "drums")) {
      for (const key of KEYS) {
        const pitches = makePattern(p, { key: key.value }).notes.map((n) => n.pitch);
        const [low, high] = p.kind === "bass" ? [28, 67] : [36, 100];
        expect(Math.min(...pitches) >= low && Math.max(...pitches) <= high, `${p.id} in ${key.value}: ${Math.min(...pitches)}–${Math.max(...pitches)}`).toBe(true);
      }
    }
  });
});

describe("particular patterns", () => {
  const hits = (id: string, pitch: number, values: Values = {}) =>
    makePattern(findPattern(id)!, { bars: 1, ...values })
      .notes.filter((n) => n.pitch === pitch)
      .map((n) => n.start);
  it("plays a rock beat: kick on 1 and 3, snare on 2 and 4, hi-hat in eighths", () => {
    expect(hits("drums-rock", 38)).toEqual([1, 3]);
    expect(hits("drums-rock", 36)).toEqual([0, 2, 2.5]);
    expect(hits("drums-rock", 42)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  });
  it("plays four on the floor", () => {
    expect(hits("drums-dance", 36)).toEqual([0, 1, 2, 3]);
    expect(hits("drums-dance", 46)).toEqual([0.5, 1.5, 2.5, 3.5]);
  });
  it("plays the half-time snare on 3 only, and the one drop on 3", () => {
    expect(hits("drums-halftime", 38)).toEqual([2]);
    expect(hits("drums-reggae", 36)).toEqual([2]);
  });
  it("swings the shuffle in thirds of a beat", () => {
    const hat = hits("drums-shuffle", 42);
    expect(hat.length).toBe(8);
    expect(hat[1]).toBeCloseTo(2 / 3, 5);
    expect(hits("drums-shuffle", 38)).toEqual([1, 3]);
  });
  it("plays a waltz in three, and bossa nova's rim pattern over two bars", () => {
    const waltz = makePattern(findPattern("drums-waltz")!, { bars: 2 });
    expect(waltz.length).toBe(6);
    expect(waltz.notes.filter((n) => n.pitch === 36).map((n) => n.start)).toEqual([0, 3]);
    expect(findPattern("drums-waltz")!.beatsPerBar).toBe(3);
    expect(hits("drums-bossa", 37, { bars: 2 })).toEqual([0, 1.5, 3, 5, 6.5]);
  });
  it("makes as many bars as asked, 1 to 8", () => {
    const rock = findPattern("drums-rock")!;
    expect(makePattern(rock, { bars: 1 }).length).toBe(4);
    expect(makePattern(rock, { bars: 8 }).length).toBe(32);
    expect(makePattern(rock, { bars: 99 }).length).toBe(32);
    expect(makePattern(rock, { bars: 0 }).length).toBe(4);
    expect(makePattern(rock).length).toBe(16);
  });
  it("swaps the hi-hat for the ride, ends with a fill, starts with a crash", () => {
    expect(hits("drums-rock", 51, { cymbal: "ride" }).length).toBe(8);
    expect(hits("drums-rock", 42, { cymbal: "ride" })).toEqual([]);
    expect(hits("drums-pop", 46, { cymbal: "shaker" })).toEqual([]);
    const fill = makePattern(findPattern("drums-rock")!, { bars: 2, ending: "fill" }).notes;
    // The last two beats are the fill: no hi-hat, toms at the end, the first bar untouched.
    expect(fill.filter((n) => n.start >= 6 && n.pitch === 42)).toEqual([]);
    expect(fill.filter((n) => n.start >= 6 && (n.pitch === 38 || n.pitch === 45 || n.pitch === 41)).length).toBe(8);
    expect(fill.filter((n) => n.start < 4).length).toBe(13);
    expect(fill[fill.length - 1].pitch).toBe(41);
    expect(hits("drums-rock", 49, { crash: "crash" })).toEqual([0]);
    expect(hits("drums-rock", 42, { crash: "crash" })[0]).toBe(0.5);
  });
  it("runs the drum fill round the toms from high to low", () => {
    const fill = makePattern(findPattern("drums-fill")!, { crash: "none" });
    expect(fill.length).toBe(4);
    const toms = fill.notes.filter((n) => [48, 45, 41].includes(n.pitch)).map((n) => n.pitch);
    expect(toms).toEqual([48, 48, 48, 48, 45, 45, 45, 45, 41, 41, 41, 41]);
    const withCrash = makePattern(findPattern("drums-fill")!);
    expect(withCrash.length).toBe(8);
    expect(withCrash.notes.filter((n) => n.pitch === 49).map((n) => n.start)).toEqual([4]);
  });
  it("plays the pop chords: C, G, A minor, F", () => {
    const made = makePattern(findPattern("chords-pop")!, { low: "no" });
    expect(made.length).toBe(16);
    const bar = (i: number) => names(made.notes.filter((n) => n.start === i * 4).map((n) => n.pitch));
    expect([0, 1, 2, 3].map(bar)).toEqual(["G3 C4 E4", "G3 B3 D4", "A3 C4 E4", "A3 C4 F4"]);
    const low = makePattern(findPattern("chords-pop")!).notes.filter((n) => n.pitch < 48);
    expect(names(low.map((n) => n.pitch))).toBe("C2 G2 A2 F2");
  });
  it("plays the other sequences' chords by their roots", () => {
    const roots = (id: string, values: Values = {}) => names(makePattern(findPattern(id)!, values).notes.filter((n) => n.pitch < 48).map((n) => n.pitch)).replace(/\d/g, "");
    expect(roots("chords-sad")).toBe("A F C G");
    expect(roots("chords-fifties")).toBe("C A F G");
    expect(roots("chords-rock")).toBe("C F G F");
    expect(roots("chords-jazz")).toBe("D G C C");
    expect(roots("chords-canon")).toBe("C G A E F C F G");
    expect(roots("chords-blues")).toBe("C C C C F F C C G F C G");
    // The epic one is always minor: in A minor, A minor, F, C, G.
    expect(roots("chords-epic", { key: "A" })).toBe("A F C G");
    expect(roots("chords-pop", { key: "G" })).toBe("G D E C");
    expect(makePattern(findPattern("chords-blues")!).length).toBe(48);
    expect(makePattern(findPattern("chords-pop")!, { times: 3 }).length).toBe(48);
  });
  it("plays jazz chords as sevenths, and arpeggios a note at a time", () => {
    const jazz = makePattern(findPattern("chords-jazz")!, { low: "no" });
    expect(names(jazz.notes.filter((n) => n.start === 0).map((n) => n.pitch))).toBe("A3 C4 D4 F4");
    expect(names(jazz.notes.filter((n) => n.start === 4).map((n) => n.pitch))).toBe("G3 B3 D4 F4");
    const arp = makePattern(findPattern("chords-pop")!, { low: "no", style: "arpeggio" });
    expect(arp.notes.length).toBe(32);
    expect(arp.notes.every((n, i) => n.start === i * 0.5 && n.length === 0.5)).toBe(true);
    expect(makePattern(findPattern("chords-pop")!, { low: "no", style: "beats" }).notes.length).toBe(48);
  });
  it("plays bass lines that follow the chosen chords", () => {
    const bass = (id: string, values: Values = {}) => makePattern(findPattern(id)!, values).notes;
    expect(names(bass("bass-roots").map((n) => n.pitch))).toBe("C2 G2 A2 F2");
    expect(names(bass("bass-roots", { chords: "sad", key: "A", scale: "minor" }).map((n) => n.pitch))).toBe("F2 D2 A2 E2");
    expect(bass("bass-roots", { style: "beats" }).length).toBe(16);
    expect(names(bass("bass-root-fifth").slice(0, 4).map((n) => n.pitch))).toBe("C2 G2 G2 D3");
    expect(names(bass("bass-octaves").slice(0, 4).map((n) => n.pitch))).toBe("C2 C3 C2 C3");
    // Walking: up the chord, then a step away from the next bar's first note.
    expect(names(bass("bass-walking").slice(0, 8).map((n) => n.pitch))).toBe("C2 E2 G2 A2 G2 B2 D3 B2");
    expect(names(bass("bass-boogie").slice(0, 8).map((n) => n.pitch))).toBe("C2 E2 G2 A2 C3 A2 G2 E2");
    expect(bass("bass-reggae")[0].start).toBe(1);
    expect(makePattern(findPattern("bass-roots")!, { chords: "one", times: 8 }).length).toBe(32);
    expect(makePattern(findPattern("bass-roots")!, { chords: "blues" }).length).toBe(48);
  });
  it("never repeats a note going into the next bar of a walking bass", () => {
    const walking = findPattern("bass-walking")!;
    for (const chords of PROGRESSIONS.filter((p) => p.id !== "one")) {
      const notes = makePattern(walking, { chords: chords.id }).notes;
      for (let i = 3; i < notes.length; i += 4) {
        const next = notes[(i + 1) % notes.length];
        expect(notes[i].pitch !== next.pitch && notes[i].pitch !== notes[i - 1].pitch, `${chords.id} bar ${(i + 1) / 4}`).toBe(true);
      }
    }
  });
  it("plays the scale up and down, and arpeggios at two speeds", () => {
    const scale = makePattern(findPattern("melody-scale")!, { key: "G" });
    expect(names(scale.notes.map((n) => n.pitch))).toBe("G4 A4 B4 C5 D5 E5 F#5 G5 F#5 E5 D5 C5 B4 A4 G4");
    expect(scale.length).toBe(8);
    expect(makePattern(findPattern("melody-scale")!, { octaves: 2 }).notes.length).toBe(29);
    expect(names(makePattern(findPattern("melody-scale")!, { key: "A", scale: "minor" }).notes.slice(0, 8).map((n) => n.pitch))).toBe("A4 B4 C5 D5 E5 F5 G5 A5");
    const up = makePattern(findPattern("melody-arp-up")!);
    expect(names(up.notes.slice(0, 4).map((n) => n.pitch))).toBe("C4 E4 G4 C5");
    expect(names(up.notes.slice(8, 12).map((n) => n.pitch))).toBe("G4 B4 D5 G5");
    expect(makePattern(findPattern("melody-arp-up")!, { speed: "sixteenths" }).notes.length).toBe(64);
    const riff = makePattern(findPattern("melody-riff")!, { key: "A", times: 1 });
    expect(new Set(riff.notes.map((n) => pitchName(n.pitch).replace(/\d/, ""))).size).toBeLessThanOrEqual(5);
  });
});

describe("chords that sound right", () => {
  /** The notes of each bar's chord, as names without octaves, lowest first. */
  const bars = (id: string, values: Values = {}) => {
    const made = makePattern(findPattern(id)!, { low: "no", ...values });
    return Array.from({ length: made.length / 4 }, (_, i) => made.notes.filter((n) => n.start === i * 4).map((n) => pitchName(n.pitch).replace(/-?\d+$/, "")).join(" "));
  };
  /** The same, as a set, so the order the notes are stacked in doesn't matter. */
  const chord = (text: string) => text.split(" ").sort().join(" ");
  it("keeps the epic chords minor, whatever scale is asked for: no sour diminished chord to end on", () => {
    const epic = findPattern("chords-epic")!;
    expect(epic.inputs.map((i) => i.key)).not.toContain("scale");
    // C minor: C minor, A flat, E flat, B flat — never B diminished (B D F).
    expect(bars("chords-epic").map(chord)).toEqual(["C D# G", "C D# G#", "A# D# G", "A# D F"]);
    expect(bars("chords-epic", { scale: "major" })).toEqual(bars("chords-epic"));
    // A bass line or tune following them is in minor too, so they fit.
    const followed = makePattern(findPattern("bass-roots")!, { chords: "epic", scale: "major" }).notes.map((n) => pitchName(n.pitch).replace(/\d/, ""));
    expect(followed).toEqual(["C", "G#", "D#", "A#"]);
    expect(scaleFor("epic", "major")).toBe("minor");
    expect(scaleFor("pop", "major")).toBe("major");
  });
  it("plays blues sevenths as the blues has them: C7, F7 and G7 in C", () => {
    const blues = bars("chords-blues", { type: "sevenths" }).map(chord);
    expect(blues[0]).toBe(chord("C E G A#"));
    expect(blues[4]).toBe(chord("F A C D#"));
    expect(blues[8]).toBe(chord("G B D F"));
    expect(blues.some((b) => b.split(" ").includes("B") && b.split(" ").includes("C"))).toBe(false);
    // Plain chords are plain C, F and G; and a minor blues keeps to its scale.
    expect(bars("chords-blues").map(chord).slice(0, 5)).toEqual([chord("C E G"), chord("C E G"), chord("C E G"), chord("C E G"), chord("F A C")]);
    expect(bars("chords-blues", { type: "sevenths", scale: "minor" }).map(chord)[0]).toBe(chord("C D# G A#"));
  });
  it("gives the minor jazz turnaround a chord 5 that pulls home", () => {
    // C minor: D half-diminished, G7 (with B natural, not B flat), C minor 7.
    const minor = bars("chords-jazz", { scale: "minor" }).map(chord);
    expect(minor[0]).toBe(chord("D F G# C"));
    expect(minor[1]).toBe(chord("G B D F"));
    expect(minor[2]).toBe(chord("C D# G A#"));
    expect(bars("chords-jazz", { scale: "minor", type: "plain" }).map(chord)[1]).toBe(chord("G B D"));
    // In major nothing changes: D minor 7, G7, C major 7.
    expect(bars("chords-jazz").map(chord).slice(0, 3)).toEqual([chord("D F A C"), chord("G B D F"), chord("C E G B")]);
    // A bass line walking up chord 5 plays the same B natural.
    const walk = makePattern(findPattern("bass-walking")!, { chords: "jazz", scale: "minor" }).notes.slice(4, 7).map((n) => pitchName(n.pitch).replace(/\d/, ""));
    expect(walk).toEqual(["G", "B", "D"]);
  });
  it("alters only those notes", () => {
    expect(chordStep("pop", 5, 67, 2, 0, "minor")).toBe(scaleStep(67, 2, 0, "minor"));
    expect(chordStep("jazz", 5, 67, 2, 0, "minor")).toBe(71);
    expect(chordStep("jazz", 5, 67, 9, 0, "minor")).toBe(83);
    expect(chordStep("jazz", 2, 62, 2, 0, "minor")).toBe(65);
    expect(chordStep("jazz", 5, 67, 2, 0, "major")).toBe(71);
    expect(chordStep("blues", 1, 60, 6, 0, "major")).toBe(70);
    expect(chordStep("blues", 5, 67, 6, 0, "major")).toBe(77);
    expect(chordStep("blues", 1, 60, 6, 0, "minor")).toBe(70);
    expect(sequenceChord("blues", 4, 65, 0, "major", 4)).toEqual([65, 69, 72, 75]);
    expect(sequenceChord("pop", 4, 65, 0, "major", 4)).toEqual([65, 69, 72, 76]);
  });
  it("names chord sequences by steps of the scale, which is true in minor as well as major", () => {
    for (const p of LIBRARY.filter((x) => x.kind === "chords")) {
      // No roman numerals (I–V–vi–IV says which chords are major and minor, and is wrong once Minor is chosen).
      expect(p.name, p.id).not.toMatch(/\b[IViv]+[–-][IViv]+/);
      expect(p.description, p.id).toMatch(/In (C major|A minor):/);
    }
    expect(findPattern("chords-pop")!.name).toBe("Pop chords (1–5–6–4)");
    // The same steps in C minor: C minor, G minor, A flat, F minor.
    expect(bars("chords-pop", { scale: "minor" }).map(chord)).toEqual([chord("C D# G"), chord("G A# D"), chord("G# C D#"), chord("F G# C")]);
  });
});

describe("values", () => {
  const rock = () => findPattern("drums-rock")!;
  const pop = () => findPattern("chords-pop")!;
  it("gives defaults for anything missing or odd, and drops what isn't asked for", () => {
    expect(cleanValues(rock())).toEqual(defaultValues(rock()));
    expect(cleanValues(rock(), { bars: "lots", cymbal: "gong", ending: 7, extra: "x" })).toEqual(defaultValues(rock()));
    expect(cleanValues(pop(), { key: "H", scale: "blue" })).toMatchObject({ key: "C", scale: "major" });
  });
  it("keeps counts whole and inside their limits", () => {
    expect(cleanValues(rock(), { bars: 2.6 }).bars).toBe(3);
    expect(cleanValues(rock(), { bars: -4 }).bars).toBe(1);
    expect(cleanValues(rock(), { bars: 1e9 }).bars).toBe(8);
    expect(cleanValues(rock(), { bars: "6" }).bars).toBe(6);
    expect(cleanValues(rock(), { bars: NaN }).bars).toBe(4);
    expect(cleanValues(rock(), { bars: "" }).bars).toBe(4);
    expect(cleanValues(rock(), { bars: null }).bars).toBe(4);
  });
  it("makes the same pattern from the same values every time", () => {
    for (const p of LIBRARY) expect(makePattern(p)).toEqual(makePattern(p, defaultValues(p)));
  });
  it("knows which instruments a pattern suits", () => {
    expect(patternSuitsInstrument(rock(), "drums")).toBe(true);
    expect(patternSuitsInstrument(rock(), "piano")).toBe(false);
    expect(patternSuitsInstrument(pop(), "organ")).toBe(true);
    expect(patternSuitsInstrument(pop(), "drums")).toBe(false);
    // Bass lines go on a bass and nothing else does; chords and tunes go on anything that's neither a bass nor drums.
    const bass = findPattern("bass-roots")!;
    expect(bass.kind).toBe("bass");
    expect(patternSuitsInstrument(bass, "bass")).toBe(true);
    expect(patternSuitsInstrument(bass, "synth-bass")).toBe(true);
    expect(patternSuitsInstrument(bass, "piano")).toBe(false);
    expect(patternSuitsInstrument(bass, "drums")).toBe(false);
    expect(patternSuitsInstrument(pop(), "bass")).toBe(false);
    for (const p of LIBRARY) expect(patternSuitsInstrument(p, p.instrument)).toBe(true);
    expect(findPattern("nope")).toBeUndefined();
  });
});

describe("browsing", () => {
  it("groups patterns under the headings, in order", () => {
    const groups = groupPatterns();
    expect(groups.map((g) => g.group)).toEqual(["Drum beats", "Bass lines", "Chords", "Melodies and arps"]);
    expect(groups.reduce((sum, g) => sum + g.patterns.length, 0)).toBe(LIBRARY.length);
    expect(groups[0].patterns[0].id).toBe("drums-rock");
    const odd = { ...LIBRARY[0], id: "x", group: "Odds and ends" };
    expect(groupPatterns([odd, LIBRARY[0]]).map((g) => g.group)).toEqual(["Drum beats", "Odds and ends"]);
    expect(groupPatterns([])).toEqual([]);
  });
  it("searches names, headings, descriptions and choices by the start of words", () => {
    expect(searchPatterns("rock")[0].id).toBe("drums-rock");
    expect(searchPatterns("rock").map((p) => p.id)).toContain("chords-rock");
    expect(searchPatterns("BLUES").map((p) => p.id).slice(0, 2).sort()).toEqual(["chords-blues", "drums-shuffle"]);
    expect(searchPatterns("walk").map((p) => p.id)).toEqual(["bass-walking"]);
    expect(searchPatterns("bass").length).toBeGreaterThanOrEqual(8);
    expect(searchPatterns("drum fill")[0].id).toBe("drums-fill");
    expect(searchPatterns("waltz").map((p) => p.id)).toEqual(["drums-waltz"]);
    // In a choice: the ride cymbal is offered by every beat.
    expect(searchPatterns("ride").length).toBeGreaterThanOrEqual(10);
    // Every word must match; the middle of a word doesn't.
    expect(searchPatterns("rock zebra")).toEqual([]);
    expect(searchPatterns("ock")).toEqual([]);
    expect(searchPatterns("")).toEqual([]);
    expect(searchPatterns("   ")).toEqual([]);
    expect(searchPatterns("rock", [])).toEqual([]);
  });
  it("offers everything through one front door", () => {
    expect(front.LIBRARY).toBe(LIBRARY);
    expect(front.groupPatterns).toBe(groupPatterns);
    expect(front.searchPatterns).toBe(searchPatterns);
    expect(front.makePattern).toBe(makePattern);
    expect(front.cleanValues).toBe(cleanValues);
  });
});
