import { describe, expect, it } from "vitest";
import { newSong, newTrack } from "../src/model/document";
import { DRUM_PITCHES, barIndex, barStart, beatsToSeconds, clipEnd, clipLength, drumName, isBlackKey, pitchName, positionText, secondsToBeats, snapBeat, snapBeatDown, snapStep, songLength, timeText } from "../src/model/time";
import type { AudioClip, MidiClip, Song } from "../src/model/types";

const midi = (start: number, length: number): MidiClip => ({ id: `m${start}`, trackId: "t", name: "Clip", start, kind: "midi", length, notes: [] });
const audio = (start: number, duration: number): AudioClip => ({ id: `a${start}`, trackId: "a", name: "Sound", start, kind: "audio", audioId: "s", offset: 0, duration, gain: 1 });

describe("beats and seconds", () => {
  it("converts both ways at a tempo", () => {
    expect(beatsToSeconds(4, 120)).toBe(2);
    expect(beatsToSeconds(1, 60)).toBe(1);
    expect(secondsToBeats(2, 120)).toBe(4);
    expect(secondsToBeats(beatsToSeconds(7.25, 93), 93)).toBeCloseTo(7.25, 9);
  });
});

describe("where you are", () => {
  it("writes bar.beat.sixteenth, counted from 1", () => {
    expect(positionText(0, 4)).toBe("1.1.1");
    expect(positionText(9.5, 4)).toBe("3.2.3");
    expect(positionText(3.75, 4)).toBe("1.4.4");
    expect(positionText(4, 4)).toBe("2.1.1");
    expect(positionText(3, 3)).toBe("2.1.1");
    expect(positionText(7.25, 3)).toBe("3.2.2");
    expect(positionText(-2, 4)).toBe("1.1.1");
  });
  it("doesn't slip back a step for a hair's breadth of rounding", () => {
    expect(positionText(0.1 + 0.2 + 0.7 - 1e-12, 4)).toBe("1.2.1");
    expect(positionText(3 * (1 / 3) * 4, 4)).toBe("2.1.1");
  });
  it("writes time as minutes, seconds and tenths", () => {
    expect(timeText(0)).toBe("0:00.0");
    expect(timeText(65.32)).toBe("1:05.3");
    expect(timeText(59.99)).toBe("0:59.9");
    expect(timeText(600)).toBe("10:00.0");
    expect(timeText(-3)).toBe("0:00.0");
    expect(timeText(NaN)).toBe("0:00.0");
  });
  it("knows which bar a beat is in", () => {
    expect(barIndex(0, 4)).toBe(0);
    expect(barIndex(3.99, 4)).toBe(0);
    expect(barIndex(4, 4)).toBe(1);
    expect(barIndex(7, 3)).toBe(2);
    expect(barStart(2, 3)).toBe(6);
  });
});

describe("snapping", () => {
  it("moves a beat to the nearest grid line", () => {
    expect(snapBeat(1.3, 1, 4)).toBe(1);
    expect(snapBeat(1.6, 1, 4)).toBe(2);
    expect(snapBeat(1.3, 0.5, 4)).toBe(1.5);
    expect(snapBeat(1.3, 0.25, 4)).toBe(1.25);
    expect(snapBeat(1.07, 0.125, 4)).toBe(1.125);
    expect(snapBeat(5, "bar", 4)).toBe(4);
    expect(snapBeat(6, "bar", 4)).toBe(8);
    expect(snapBeat(5, "bar", 3)).toBe(6);
  });
  it("leaves it alone when snapping is off, but never before the start", () => {
    expect(snapBeat(1.2345, 0, 4)).toBe(1.2345);
    expect(snapBeat(-3, 0, 4)).toBe(0);
    expect(snapBeat(-0.2, 1, 4)).toBe(0);
    expect(snapBeat(-9, "bar", 4)).toBe(0);
  });
  it("can snap back to the start of the grid square", () => {
    expect(snapBeatDown(1.9, 1, 4)).toBe(1);
    expect(snapBeatDown(7.9, "bar", 4)).toBe(4);
    expect(snapBeatDown(2, 0.5, 4)).toBe(2);
    expect(snapBeatDown(0.3 + 0.6, 0.1 * 3, 4)).toBeCloseTo(0.9, 6);
    expect(snapBeatDown(1.9, 0, 4)).toBe(1.9);
  });
  it("gives the grid's step", () => {
    expect(snapStep("bar", 3)).toBe(3);
    expect(snapStep(0.25, 4)).toBe(0.25);
    expect(snapStep(0, 4)).toBe(0);
  });
});

describe("how long things are", () => {
  it("measures clips in beats", () => {
    expect(clipLength(midi(2, 6), 120)).toBe(6);
    expect(clipEnd(midi(2, 6), 120)).toBe(8);
    // Three seconds is six beats at 120 and three at 60.
    expect(clipLength(audio(0, 3), 120)).toBe(6);
    expect(clipLength(audio(0, 3), 60)).toBe(3);
    expect(clipEnd(audio(4, 3), 120)).toBe(10);
  });
  it("measures the song to the end of its last clip, in whole bars, at least four", () => {
    const base: Song = { ...newSong(), tracks: [{ ...newTrack("instrument", "piano", []), id: "t" }] };
    expect(songLength(base)).toBe(16);
    expect(songLength({ ...base, beatsPerBar: 3 })).toBe(12);
    expect(songLength({ ...base, clips: [midi(0, 8)] })).toBe(16);
    expect(songLength({ ...base, clips: [midi(0, 16)] })).toBe(16);
    expect(songLength({ ...base, clips: [midi(0, 16.5)] })).toBe(20);
    expect(songLength({ ...base, clips: [midi(30, 3), midi(0, 4)] })).toBe(36);
    expect(songLength({ ...base, clips: [audio(16, 0.75)] })).toBe(20);
    // Thirds that add up to a whole bar don't tip it into the next.
    expect(songLength({ ...base, clips: [midi(16, 1 / 3 + 1 / 3 + 1 / 3 + 3)] })).toBe(20);
  });
});

describe("pitches", () => {
  it("names notes with their octave", () => {
    expect(pitchName(60)).toBe("C4");
    expect(pitchName(61)).toBe("C#4");
    expect(pitchName(69)).toBe("A4");
    expect(pitchName(21)).toBe("A0");
    expect(pitchName(0)).toBe("C-1");
    expect(pitchName(127)).toBe("G9");
  });
  it("knows the black keys", () => {
    const black = Array.from({ length: 12 }, (_, i) => isBlackKey(60 + i));
    expect(black).toEqual([false, true, false, true, false, false, true, false, true, false, true, false]);
    expect(isBlackKey(1)).toBe(true);
  });
  it("lists the drum kit", () => {
    expect(DRUM_PITCHES.length).toBe(13);
    expect(new Set(DRUM_PITCHES.map((d) => d.pitch)).size).toBe(13);
    const byPitch = Object.fromEntries(DRUM_PITCHES.map((d) => [d.pitch, d.name]));
    expect(byPitch).toEqual({ 36: "Kick", 37: "Rim", 38: "Snare", 39: "Clap", 41: "Low tom", 42: "Closed hat", 45: "Mid tom", 46: "Open hat", 48: "High tom", 49: "Crash", 51: "Ride", 56: "Cowbell", 70: "Shaker" });
    expect(drumName(36)).toBe("Kick");
    expect(drumName(60)).toBeNull();
  });
});
