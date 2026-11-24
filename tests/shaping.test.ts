/**
 * Shaping the sound: a track's own effects and a clip's volume, fades and
 * filter sweep (src/model/shaping.ts), how they're edited, saved and read,
 * and the curves the mixer makes from them (src/audio/mixer.ts).
 */
import { describe, expect, it } from "vitest";
import { crushCurve, crushSteps, driveCurve, driveTrim, harmonySweep, resonanceQ, squeezeSettings } from "../src/audio/mixer";
import { INSTRUMENTS } from "../src/audio/instruments";
import { BASS_INSTRUMENTS, LIBRARY, patternSuitsInstrument } from "../src/library/catalogue";
import { instrumentLabel, isDrumKit, newSong, newTrack, parseSong, readSongFile, songFileText } from "../src/model/document";
import { mirroredOffset } from "../src/audio/reverse";
import { notesBetween } from "../src/audio/schedule";
import * as edits from "../src/model/edits";
import { CUTOFF_HIGH_HZ, CUTOFF_LOW_HZ, DEFAULT_ARP, cleanFilterWobble, swingDelay, swingsInSixteenths, wobbledCutoff, cleanHarmony, harmonySteps, stepRatio, arpNotes, chopFloor, cleanArp, toneWords, clipFades, clipGain, clipIsShaped, clipLevelAt, clipLevelPoints, cleanFilter, cutoffHz, effectsOf, filterIsOn, hasEffects, hzText, pumpFloor, sweepAt, trackHasSweeps } from "../src/model/shaping";
import type { MidiClip, Song } from "../src/model/types";

function songWith(): { song: Song; track: string; clip: string } {
  const track = newTrack("instrument", "pad", []);
  let song = edits.addTrack(newSong("Shaped"), track);
  const clip: MidiClip = { ...edits.makeMidiClip(track, 4, 8), notes: edits.makeNotes([{ pitch: 60, start: 0, length: 8, velocity: 100 }]) };
  song = edits.addClips(song, [clip]);
  return { song, track: track.id, clip: clip.id };
}
const clipOf = (song: Song, id: string) => edits.findClip(song, id)!;
const trackOf = (song: Song, id: string) => edits.findTrack(song, id)!;

describe("a track's own effects", () => {
  it("are all off on a new track, and a track that leaves them out", () => {
    const { song, track } = songWith();
    const t = trackOf(song, track);
    expect(effectsOf(t)).toEqual({ drive: 0, crush: 0, filter: { kind: "low", cutoff: 1, resonance: 0 }, chorus: 0, pump: 0, lows: 0, highs: 0, chop: 0, squeeze: 0, sway: 0, swirl: 0, swing: 0 });
    expect(hasEffects(t)).toBe(false);
    expect("drive" in t || "filter" in t).toBe(false);
  });

  it("are kept inside their limits, and left out of the track again when turned right down", () => {
    const { song, track } = songWith();
    let s = edits.updateTrack(song, track, { drive: 0.4, crush: 7, chorus: 0.25, pump: -1, filter: { cutoff: 0.5 } });
    expect(effectsOf(trackOf(s, track))).toEqual({ drive: 0.4, crush: 1, filter: { kind: "low", cutoff: 0.5, resonance: 0 }, chorus: 0.25, pump: 0, lows: 0, highs: 0, chop: 0, squeeze: 0, sway: 0, swirl: 0, swing: 0 });
    expect(hasEffects(trackOf(s, track))).toBe(true);
    // Only part of the filter changes at a time.
    s = edits.updateTrack(s, track, { filter: { resonance: 0.3 } });
    expect(trackOf(s, track).filter).toEqual({ kind: "low", cutoff: 0.5, resonance: 0.3 });
    s = edits.updateTrack(s, track, { filter: { kind: "high", cutoff: 0.2 } });
    expect(trackOf(s, track).filter).toEqual({ kind: "high", cutoff: 0.2, resonance: 0.3 });
    // The same again changes nothing: the very same song comes back.
    expect(edits.updateTrack(s, track, { filter: { kind: "high", cutoff: 0.2 }, drive: 0.4 })).toBe(s);
    s = edits.updateTrack(s, track, { drive: 0, crush: 0, chorus: 0, filter: { kind: "low", cutoff: 1, resonance: 0 } });
    const t = trackOf(s, track);
    expect("drive" in t || "crush" in t || "chorus" in t || "filter" in t).toBe(false);
    expect(hasEffects(t)).toBe(false);
  });

  it("the filter says when it changes nothing, and maps the slider onto pitch evenly", () => {
    expect(filterIsOn({ kind: "low", cutoff: 1, resonance: 0 })).toBe(false);
    expect(filterIsOn({ kind: "low", cutoff: 0.6, resonance: 0 })).toBe(true);
    expect(filterIsOn({ kind: "high", cutoff: 0, resonance: 0 })).toBe(false);
    expect(filterIsOn({ kind: "high", cutoff: 0.3, resonance: 0 })).toBe(true);
    expect(cleanFilter({ kind: "high" })).toEqual({ kind: "high", cutoff: 0, resonance: 0 });
    expect(cleanFilter(undefined)).toEqual({ kind: "low", cutoff: 1, resonance: 0 });
    expect(cutoffHz(0)).toBeCloseTo(CUTOFF_LOW_HZ, 6);
    expect(cutoffHz(1)).toBeCloseTo(CUTOFF_HIGH_HZ, 6);
    expect(cutoffHz(0.5) / cutoffHz(0.25)).toBeCloseTo(cutoffHz(0.75) / cutoffHz(0.5), 6);
    expect(hzText(850)).toBe("850 Hz");
    expect(hzText(2400)).toBe("2.4 kHz");
    expect(hzText(18000)).toBe("18 kHz");
    expect(pumpFloor(0)).toBe(1);
    expect(pumpFloor(1)).toBeCloseTo(0.1, 6);
  });
});

describe("a clip's own volume and fades", () => {
  it("a plain clip is as loud as it's played, all the way through", () => {
    const { song, clip } = songWith();
    const c = clipOf(song, clip);
    expect(clipIsShaped(c)).toBe(false);
    expect(clipGain(c)).toBe(1);
    expect(clipLevelAt(c, 8, 0)).toBe(1);
    expect(clipLevelPoints(c, 8, 0, 8)).toEqual([[0, 1], [8, 1]]);
  });

  it("swells in and dies away, with corners where the fades end and begin", () => {
    const { song, clip } = songWith();
    const s = edits.updateClip(song, clip, { gain: 0.5, fadeIn: 2, fadeOut: 4 });
    const c = clipOf(s, clip) as MidiClip;
    expect(c).toMatchObject({ gain: 0.5, fadeIn: 2, fadeOut: 4 });
    expect(clipIsShaped(c)).toBe(true);
    expect(clipLevelAt(c, 8, 0)).toBe(0);
    expect(clipLevelAt(c, 8, 1)).toBeCloseTo(0.25, 9);
    expect(clipLevelAt(c, 8, 3)).toBeCloseTo(0.5, 9);
    expect(clipLevelAt(c, 8, 6)).toBeCloseTo(0.25, 9);
    expect(clipLevelAt(c, 8, 8)).toBe(0);
    expect(clipLevelPoints(c, 8, 0, 8)).toEqual([[0, 0], [2, 0.5], [4, 0.5], [8, 0]]);
    // A note in the middle of the fade-out only gets its own stretch of it.
    expect(clipLevelPoints(c, 8, 5, 7)).toEqual([[5, 0.375], [7, 0.125]]);
    // Fades never add up to more than the clip.
    expect(clipFades({ ...c, fadeIn: 6, fadeOut: 6 }, 8)).toEqual({ fadeIn: 6, fadeOut: 2 });
    // Back to plain: the fields go from the clip altogether.
    const plain = clipOf(edits.updateClip(s, clip, { gain: 1, fadeIn: 0, fadeOut: 0 }), clip);
    expect("gain" in plain || "fadeIn" in plain || "fadeOut" in plain).toBe(false);
    expect(edits.updateClip(s, clip, { gain: 0.5, fadeIn: 2 })).toBe(s);
  });

  it("splitting keeps the swell with the first part and the dying away with the second", () => {
    const { song, clip } = songWith();
    const s = edits.updateClip(song, clip, { fadeIn: 2, fadeOut: 2, sweep: { from: 0.2, to: 1 } });
    const split = edits.splitClip(s, clip, 8)!;
    const left = clipOf(split.song, clip);
    const right = clipOf(split.song, split.id);
    expect(left.fadeIn).toBe(2);
    expect(left.fadeOut).toBeUndefined();
    expect(right.fadeIn).toBeUndefined();
    expect(right.fadeOut).toBe(2);
    expect(left.sweep).toEqual({ from: 0.2, to: 0.6 });
    expect(right.sweep).toEqual({ from: 0.6, to: 1 });
  });
});

describe("a filter sweep over a clip", () => {
  it("moves the track's filter from one place to the other while the clip plays, and only then", () => {
    const { song, track, clip } = songWith();
    expect(trackHasSweeps(song, track)).toBe(false);
    const s = edits.updateClip(song, clip, { sweep: { from: 0.2, to: 0.8 } });
    const length = (c: { kind: string }) => (c.kind === "midi" ? (c as MidiClip).length : 0);
    expect(trackHasSweeps(s, track)).toBe(true);
    expect(sweepAt(s, track, 3, length)).toBeNull();
    expect(sweepAt(s, track, 4, length)).toBeCloseTo(0.2, 9);
    expect(sweepAt(s, track, 8, length)).toBeCloseTo(0.5, 9);
    expect(sweepAt(s, track, 12, length)).toBeCloseTo(0.8, 9);
    expect(sweepAt(s, track, 12.5, length)).toBeNull();
    expect(sweepAt(s, "another track", 8, length)).toBeNull();
    const off = edits.updateClip(s, clip, { sweep: null });
    expect("sweep" in clipOf(off, clip)).toBe(false);
    expect(edits.updateClip(s, clip, { sweep: { from: 0.2, to: 0.8 } })).toBe(s);
    expect(clipOf(edits.updateClip(s, clip, { sweep: { from: -3, to: 9 } }), clip).sweep).toEqual({ from: 0, to: 1 });
  });
});

describe("in files", () => {
  it("effects, fades and sweeps come back as they were saved, and odd values are put right", () => {
    const { song, track, clip } = songWith();
    let s = edits.updateTrack(song, track, { drive: 0.3, pump: 0.6, filter: { kind: "high", cutoff: 0.25, resonance: 0.4 } });
    s = edits.updateClip(s, clip, { gain: 1.5, fadeIn: 1, fadeOut: 3, sweep: { from: 0.1, to: 0.9 } });
    const read = readSongFile(songFileText(s));
    expect(read.ok && read.song).toEqual(s);
    const odd = parseSong({ ...s, tracks: [{ ...s.tracks[0], drive: "lots", crush: 5, pump: NaN, filter: { kind: "sideways", cutoff: 4, resonance: -1 }, chorus: null }], clips: [{ ...s.clips[0], gain: 99, fadeIn: -2, fadeOut: "x", sweep: { from: "a", to: 1 } }] })!;
    expect(effectsOf(odd.tracks[0])).toEqual({ drive: 0, crush: 1, filter: { kind: "low", cutoff: 1, resonance: 0 }, chorus: 0, pump: 0, lows: 0, highs: 0, chop: 0, squeeze: 0, sway: 0, swirl: 0, swing: 0 });
    expect(odd.clips[0]).toMatchObject({ gain: 2 });
    expect(odd.clips[0].fadeIn).toBeUndefined();
    expect(odd.clips[0].fadeOut).toBeUndefined();
    expect(odd.clips[0].sweep).toBeUndefined();
    // A song from before these existed reads as before: nothing is added to it.
    const old = parseSong(JSON.parse(JSON.stringify(song)))!;
    expect(old).toEqual(song);
  });
});

describe("the mixer's curves", () => {
  it("drive: straight at nothing, harder and harder after, never past full", () => {
    const gentle = driveCurve(0.1, 1001);
    const hard = driveCurve(1, 1001);
    const at = (c: ArrayLike<number>, x: number) => c[Math.round((x + 1) * 500)];
    expect(at(gentle, 0)).toBe(0);
    expect(at(hard, 0)).toBe(0);
    expect(at(gentle, 1)).toBeCloseTo(1, 6);
    expect(at(hard, 1)).toBeCloseTo(1, 6);
    expect(at(hard, -0.2)).toBeCloseTo(-at(hard, 0.2), 6);
    // A quiet sound comes out louder the harder it's driven (that's the fuzz), and a little drive barely changes it.
    expect(at(gentle, 0.2)).toBeGreaterThan(0.2);
    expect(at(gentle, 0.2)).toBeLessThan(0.3);
    expect(at(hard, 0.2)).toBeGreaterThan(0.9);
    for (const v of hard) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    // …so it's turned down afterwards, more for more drive.
    expect(driveTrim(0)).toBeGreaterThan(0.8);
    expect(driveTrim(0)).toBeLessThanOrEqual(1);
    expect(driveTrim(1)).toBeLessThan(driveTrim(0.5));
    expect(driveTrim(1)).toBeGreaterThan(0.05);
  });

  it("crush: a staircase with fewer steps the further it's turned up", () => {
    expect(crushSteps(0)).toBeCloseTo(160, 6);
    expect(crushSteps(1)).toBeCloseTo(8, 6);
    const levels = (amount: number) => new Set(Array.from(crushCurve(amount, 4097), (v) => v.toFixed(5))).size;
    expect(levels(1)).toBe(17);
    expect(levels(0.5)).toBeGreaterThan(levels(1));
    expect(levels(0.1)).toBeGreaterThan(levels(0.5));
    expect(crushCurve(1, 4097)[2048]).toBe(0);
  });

  it("the filter rings more the higher the resonance", () => {
    expect(resonanceQ(0)).toBeCloseTo(0.7, 6);
    expect(resonanceQ(1)).toBeGreaterThan(10);
    expect(resonanceQ(0.5)).toBeLessThan(resonanceQ(1));
  });
});

describe("the new instruments", () => {
  it("each have a name, a heading and a picture, and the basses take bass lines", () => {
    for (const id of ["felt-piano", "choir", "sub-bass", "growl-bass", "supersaw", "wobble", "sweep"]) {
      const inst = INSTRUMENTS.find((i) => i.id === id)!;
      expect(inst, id).toBeDefined();
      expect(inst.name.length).toBeGreaterThan(3);
      expect(inst.icon).toMatch(/^<svg /);
      expect(instrumentLabel(id)).not.toMatch(/-/);
    }
    expect(new Set(INSTRUMENTS.map((i) => i.id)).size).toBe(INSTRUMENTS.length);
    const bassLine = LIBRARY.find((p) => p.kind === "bass")!;
    const chords = LIBRARY.find((p) => p.kind === "chords")!;
    for (const id of ["sub-bass", "growl-bass"]) {
      expect(BASS_INSTRUMENTS).toContain(id);
      expect(patternSuitsInstrument(bassLine, id)).toBe(true);
      expect(patternSuitsInstrument(chords, id)).toBe(false);
    }
    for (const id of ["choir", "wobble", "supersaw", "felt-piano"]) expect(patternSuitsInstrument(chords, id)).toBe(true);
  });
});

describe("tone and chop", () => {
  it("are kept inside their limits and left out when back at nothing", () => {
    const { song, track } = songWith();
    let s = edits.updateTrack(song, track, { lows: 0.5, highs: -3, chop: 0.7 });
    expect(effectsOf(trackOf(s, track))).toMatchObject({ lows: 0.5, highs: -1, chop: 0.7 });
    expect(hasEffects(trackOf(s, track))).toBe(true);
    expect(toneWords(0.5)).toBe("+6 dB");
    expect(toneWords(-0.25)).toBe("−3 dB");
    expect(toneWords(0)).toBe("flat");
    expect(chopFloor(0)).toBe(1);
    expect(chopFloor(1)).toBe(0);
    s = edits.updateTrack(s, track, { lows: 0, highs: 0, chop: 0 });
    const t = trackOf(s, track);
    expect("lows" in t || "highs" in t || "chop" in t).toBe(false);
  });
});

describe("the arpeggiator", () => {
  const chord = (pitches: number[], start: number, length: number) => pitches.map((pitch) => ({ id: `n${pitch}-${start}`, pitch, start, length, velocity: 90 }));
  const clip = (notes: ReturnType<typeof chord>, length = 4): MidiClip => ({ id: "c", trackId: "t", name: "c", start: 0, kind: "midi", length, notes });

  it("plays a held chord one note at a time, in each pattern", () => {
    const c = clip(chord([60, 64, 67], 0, 4));
    const pitches = (style: "up" | "down" | "updown" | "random", rate = 0.5, octaves = 1) => arpNotes(c, { style, rate, octaves }).map((n) => n.pitch);
    expect(pitches("up")).toEqual([60, 64, 67, 60, 64, 67, 60, 64]);
    expect(pitches("down")).toEqual([67, 64, 60, 67, 64, 60, 67, 64]);
    expect(pitches("updown")).toEqual([60, 64, 67, 64, 60, 64, 67, 64]);
    expect(pitches("up", 1, 2)).toEqual([60, 64, 67, 72]);
    const random = pitches("random", 0.25);
    expect(random).toHaveLength(16);
    expect(random.every((p) => [60, 64, 67].includes(p))).toBe(true);
    expect(new Set(random).size).toBeGreaterThan(1);
    // The same every time.
    expect(arpNotes(clip(chord([60, 64, 67], 0, 4)), { style: "random", rate: 0.25, octaves: 1 }).map((n) => n.pitch)).toEqual(random);
    const steps = arpNotes(c, { style: "up", rate: 0.5, octaves: 1 });
    expect(steps.map((n) => n.start)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    expect(steps.every((n) => n.length === 0.45 && n.velocity === 90)).toBe(true);
  });

  it("starts the pattern again when the chord changes, and rests where nothing is held", () => {
    const c = clip([...chord([60, 64, 67], 0, 2), ...chord([57, 60, 64], 3, 1)], 4);
    expect(arpNotes(c, { style: "up", rate: 0.5, octaves: 1 }).map((n) => [n.start, n.pitch])).toEqual([
      [0, 60], [0.5, 64], [1, 67], [1.5, 60],
      [3, 57], [3.5, 60],
    ]);
  });

  it("is switched on, changed a part at a time and off, and read carefully from a file", () => {
    const { song, track } = songWith();
    let s = edits.updateTrack(song, track, { arp: {} });
    expect(trackOf(s, track).arp).toEqual(DEFAULT_ARP);
    s = edits.updateTrack(s, track, { arp: { style: "updown", octaves: 9 } });
    expect(trackOf(s, track).arp).toEqual({ style: "updown", rate: 0.25, octaves: 3 });
    expect(edits.updateTrack(s, track, { arp: { style: "updown" } })).toBe(s);
    expect(cleanArp({ style: "sideways", rate: 0.3, octaves: "two" })).toEqual({ style: "up", rate: 0.25, octaves: 1 });
    expect(cleanArp(null)).toBeUndefined();
    const read = parseSong(JSON.parse(songFileText(s)));
    expect(read?.tracks[0].arp).toEqual({ style: "updown", rate: 0.25, octaves: 3 });
    s = edits.updateTrack(s, track, { arp: null });
    expect("arp" in trackOf(s, track)).toBe(false);
  });

  it("is what the song plays", () => {
    const { song, track } = songWith();
    const s = edits.updateTrack(song, track, { arp: { style: "up", rate: 1, octaves: 2 } });
    const played = notesBetween(s, 0, 100);
    expect(played.map((n) => [n.beat, n.pitch])).toEqual([[4, 60], [5, 72], [6, 60], [7, 72], [8, 60], [9, 72], [10, 60], [11, 72]]);
    expect(notesBetween(song, 0, 100)).toHaveLength(1);
  });
});

describe("recordings played backwards", () => {
  it("play from the mirror of where they would have started", () => {
    // A 10 s sound; the clip plays 2 s to 6 s of it.
    const clip = { offset: 2, duration: 4 };
    expect(mirroredOffset(10, clip, 2)).toBe(4);
    // Started 1 s into the clip: 1 s into the reversed stretch.
    expect(mirroredOffset(10, clip, 3)).toBe(5);
  });

  it("are switched on and off, and kept in files", () => {
    const track = newTrack("audio", "", []);
    const info = { id: "s1", name: "Voice", seconds: 3, sampleRate: 44100, channels: 1 };
    let song = edits.addTrack(newSong("r"), track);
    const clip = edits.makeAudioClip(track, 0, info);
    song = edits.addClips(song, [clip], [info]);
    const on = edits.updateClip(song, clip.id, { reverse: true });
    expect(edits.findClip(on, clip.id)).toMatchObject({ reverse: true });
    expect(edits.updateClip(on, clip.id, { reverse: true })).toBe(on);
    const read = parseSong(JSON.parse(songFileText(on)));
    expect(read?.clips[0]).toMatchObject({ reverse: true });
    const off = edits.updateClip(on, clip.id, { reverse: false });
    expect("reverse" in edits.findClip(off, clip.id)!).toBe(false);
  });
});

describe("the drum kits", () => {
  it("are three, each a drum kit to the library, the tools and MIDI files", () => {
    for (const id of ["drums", "drums-808", "drums-electro"]) {
      expect(isDrumKit(id)).toBe(true);
      expect(INSTRUMENTS.find((i) => i.id === id)?.kind).toBe("drums");
    }
    expect(isDrumKit("piano")).toBe(false);
    expect(isDrumKit(undefined)).toBe(false);
    const beat = LIBRARY.find((p) => p.kind === "drums")!;
    expect(patternSuitsInstrument(beat, "drums-808")).toBe(true);
    expect(patternSuitsInstrument(LIBRARY.find((p) => p.kind === "chords")!, "drums-electro")).toBe(false);
    for (const id of ["drums-trap", "drums-house", "drums-techno", "drums-dnb", "drums-lofi", "drums-build"]) expect(LIBRARY.some((p) => p.id === id)).toBe(true);
    expect(LIBRARY.find((p) => p.id === "drums-trap")?.instrument).toBe("drums-808");
    expect(LIBRARY.find((p) => p.id === "bass-808")?.instrument).toBe("bass-808");
    expect(patternSuitsInstrument(LIBRARY.find((p) => p.id === "bass-808")!, "bass-808")).toBe(true);
  });
});

describe("the harmoniser", () => {
  it("is off on a new track, switched on and changed a part at a time, and off again", () => {
    const { song, track } = songWith();
    expect("harmony" in trackOf(song, track)).toBe(false);
    const on = edits.updateTrack(song, track, { harmony: { style: "fifth" } });
    expect(trackOf(on, track).harmony).toEqual({ style: "fifth", amount: 0.5 });
    expect(edits.updateTrack(on, track, { harmony: { style: "fifth" } })).toBe(on);
    expect(trackOf(edits.updateTrack(on, track, { harmony: { amount: 0.8 } }), track).harmony).toEqual({ style: "fifth", amount: 0.8 });
    expect("harmony" in trackOf(edits.updateTrack(on, track, { harmony: { amount: 0 } }), track)).toBe(false);
    expect("harmony" in trackOf(edits.updateTrack(on, track, { harmony: null }), track)).toBe(false);
    expect(hasEffects(trackOf(on, track))).toBe(true);
  });
  it("has voices a fixed step from the sound", () => {
    expect(harmonySteps("below")).toEqual([-12]);
    expect(harmonySteps("major")).toEqual([4, 7]);
    expect(harmonySteps("minor")).toEqual([3, 7]);
    expect(stepRatio(12)).toBeCloseTo(2);
    expect(stepRatio(-12)).toBeCloseTo(0.5);
    expect(stepRatio(7)).toBeCloseTo(1.4983);
  });
  it("slides each voice's delay the right way and speed", () => {
    // An octave down: the delay lengthens by half a second every second.
    expect(harmonySweep(0.5, 0.1)).toEqual({ rate: 5, sign: 1 });
    // An octave up: it shortens by a second every second.
    expect(harmonySweep(2, 0.1)).toEqual({ rate: 10, sign: -1 });
  });
  it("is saved and read back carefully", () => {
    const { song, track } = songWith();
    const s = edits.updateTrack(song, track, { harmony: { style: "wide", amount: 0.7 } });
    expect(parseSong(JSON.parse(songFileText(s)).song)!.tracks[0].harmony).toEqual({ style: "wide", amount: 0.7 });
    expect(cleanHarmony({ style: "sixth", amount: 3 })).toEqual({ style: "below", amount: 1 });
    expect(cleanHarmony({ style: "fifth", amount: 0 })).toBeUndefined();
    expect(cleanHarmony("loud")).toBeUndefined();
  });
});

describe("v0.6: squeeze, sway, swirl, swing, the band filter and the filter wobble", () => {
  it("are off on a new track, turned up and right down again (gone from the track)", () => {
    const { song, track } = songWith();
    for (const key of ["squeeze", "sway", "swirl", "swing"] as const) {
      expect(effectsOf(trackOf(song, track))[key]).toBe(0);
      const on = edits.updateTrack(song, track, { [key]: 0.4 });
      expect(trackOf(on, track)[key]).toBe(0.4);
      expect(hasEffects(trackOf(on, track))).toBe(true);
      expect(key in trackOf(edits.updateTrack(on, track, { [key]: 0 }), track)).toBe(false);
    }
  });
  it("has a band filter that always changes the sound", () => {
    const band = cleanFilter({ kind: "band" });
    expect(band).toEqual({ kind: "band", cutoff: 0.5, resonance: 0 });
    expect(filterIsOn(band)).toBe(true);
    const { song, track } = songWith();
    expect(trackOf(edits.updateTrack(song, track, { filter: { kind: "band", cutoff: 0.3 } }), track).filter).toEqual({ kind: "band", cutoff: 0.3, resonance: 0 });
  });
  it("has a filter wobble in time with the song", () => {
    const { song, track } = songWith();
    const on = edits.updateTrack(song, track, { filterWobble: { rate: 1 } });
    expect(trackOf(on, track).filterWobble).toEqual({ rate: 1, depth: 0.6 });
    expect("filterWobble" in trackOf(edits.updateTrack(on, track, { filterWobble: null }), track)).toBe(false);
    expect(cleanFilterWobble({ rate: 7, depth: 2 })).toEqual({ rate: 0.5, depth: 1 });
    expect(cleanFilterWobble({ rate: 1, depth: 0 })).toBeUndefined();
    const w = { rate: 1, depth: 1 };
    // Open where the track has it on the beat, most closed half way between.
    expect(wobbledCutoff(0.9, w, 4, "low")).toBeCloseTo(0.9);
    expect(wobbledCutoff(0.9, w, 4.5, "low")).toBeCloseTo(0.1);
    expect(wobbledCutoff(0.2, w, 4.5, "high")).toBeCloseTo(1);
  });
  it("swings off-beat notes late, eighths or sixteenths", () => {
    expect(swingDelay(3, 1, false)).toBe(0);
    expect(swingDelay(3.5, 1, false)).toBeCloseTo(1 / 6);
    expect(swingDelay(3.5, 0.5, false)).toBeCloseTo(1 / 12);
    expect(swingDelay(3.25, 1, false)).toBe(0);
    expect(swingDelay(3.25, 1, true)).toBeCloseTo(1 / 12);
    expect(swingDelay(3.5, 1, true)).toBe(0);
    expect(swingsInSixteenths([{ start: 0 }, { start: 0.5 }])).toBe(false);
    expect(swingsInSixteenths([{ start: 0 }, { start: 0.75 }])).toBe(true);
    const { song, track, clip } = songWith();
    const c = clipOf(song, clip) as MidiClip;
    const eighths = edits.updateClip(song, clip, {});
    const withNotes = { ...eighths, clips: [{ ...c, notes: edits.makeNotes([0, 0.5, 1, 1.5].map((start) => ({ pitch: 60, start, length: 0.5, velocity: 90 }))) }] };
    const swung = edits.updateTrack(withNotes, track, { swing: 1 });
    expect(notesBetween(withNotes, 0, 20).map((n) => n.beat - c.start)).toEqual([0, 0.5, 1, 1.5]);
    const beats = notesBetween(swung, 0, 20).map((n) => n.beat - c.start);
    expect(beats[1]).toBeCloseTo(0.5 + 1 / 6);
    expect(beats[2]).toBe(1);
  });
  it("squeezes harder the further it's turned up", () => {
    expect(squeezeSettings(0).ratio).toBe(2);
    expect(squeezeSettings(1).threshold).toBeLessThan(squeezeSettings(0.5).threshold);
  });
  it("are saved and read back carefully", () => {
    const { song, track } = songWith();
    const s = edits.updateTrack(song, track, { squeeze: 0.3, sway: 0.4, swirl: 0.5, swing: 0.6, filter: { kind: "band", cutoff: 0.4 }, filterWobble: { rate: 0.25, depth: 0.7 } });
    const read = parseSong(JSON.parse(songFileText(s)).song)!.tracks[0];
    expect(read).toMatchObject({ squeeze: 0.3, sway: 0.4, swirl: 0.5, swing: 0.6, filter: { kind: "band", cutoff: 0.4 }, filterWobble: { rate: 0.25, depth: 0.7 } });
    const odd = parseSong({ ...JSON.parse(songFileText(s)).song, tracks: [{ ...read, squeeze: "lots", filterWobble: { rate: "x" } }] })!.tracks[0];
    expect("squeeze" in odd).toBe(false);
    expect("filterWobble" in odd).toBe(false);
  });
});
