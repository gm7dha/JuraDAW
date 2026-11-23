/**
 * Shaping the sound: a track's own effects and a clip's volume, fades and
 * filter sweep (src/model/shaping.ts), how they're edited, saved and read,
 * and the curves the mixer makes from them (src/audio/mixer.ts).
 */
import { describe, expect, it } from "vitest";
import { crushCurve, crushSteps, driveCurve, driveTrim, resonanceQ } from "../src/audio/mixer";
import { INSTRUMENTS } from "../src/audio/instruments";
import { BASS_INSTRUMENTS, LIBRARY, patternSuitsInstrument } from "../src/library/catalogue";
import { instrumentLabel, newSong, newTrack, parseSong, readSongFile, songFileText } from "../src/model/document";
import * as edits from "../src/model/edits";
import { CUTOFF_HIGH_HZ, CUTOFF_LOW_HZ, clipFades, clipGain, clipIsShaped, clipLevelAt, clipLevelPoints, cleanFilter, cutoffHz, effectsOf, filterIsOn, hasEffects, hzText, pumpFloor, sweepAt, trackHasSweeps } from "../src/model/shaping";
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
    expect(effectsOf(t)).toEqual({ drive: 0, crush: 0, filter: { kind: "low", cutoff: 1, resonance: 0 }, chorus: 0, pump: 0 });
    expect(hasEffects(t)).toBe(false);
    expect("drive" in t || "filter" in t).toBe(false);
  });

  it("are kept inside their limits, and left out of the track again when turned right down", () => {
    const { song, track } = songWith();
    let s = edits.updateTrack(song, track, { drive: 0.4, crush: 7, chorus: 0.25, pump: -1, filter: { cutoff: 0.5 } });
    expect(effectsOf(trackOf(s, track))).toEqual({ drive: 0.4, crush: 1, filter: { kind: "low", cutoff: 0.5, resonance: 0 }, chorus: 0.25, pump: 0 });
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
    expect(effectsOf(odd.tracks[0])).toEqual({ drive: 0, crush: 1, filter: { kind: "low", cutoff: 1, resonance: 0 }, chorus: 0, pump: 0 });
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
