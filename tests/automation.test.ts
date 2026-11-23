/**
 * Automation: lines drawn over the song that move a track's volume, filter
 * or left–right place (src/model/automation.ts), how they're edited, saved
 * and read.
 */
import { describe, expect, it } from "vitest";
import { MOST_POINTS, cleanAutomation, cleanPoints, lineBetween, lineOf, panValueWords, restingValue, valueAt, volumeValueGain, withPoint, withPointMoved, withoutPoint } from "../src/model/automation";
import { newSong, newTrack, parseSong, songFileText } from "../src/model/document";
import * as edits from "../src/model/edits";
import { changeLabel } from "../src/model/historyLabel";
import type { Song } from "../src/model/types";

function songWith(): { song: Song; track: string } {
  const track = newTrack("instrument", "pad", []);
  return { song: edits.addTrack(newSong("Moving"), track), track: track.id };
}
const pts = (...p: [number, number][]) => p.map(([beat, value]) => ({ beat, value }));

describe("a line's value", () => {
  const line = pts([4, 0.2], [8, 0.6], [12, 0.6], [16, 0]);
  it("holds the first value before the line starts and the last after it ends", () => {
    expect(valueAt(line, 0)).toBe(0.2);
    expect(valueAt(line, 100)).toBe(0);
  });
  it("goes in a straight line between points", () => {
    expect(valueAt(line, 6)).toBeCloseTo(0.4);
    expect(valueAt(line, 10)).toBeCloseTo(0.6);
    expect(valueAt(line, 14)).toBeCloseTo(0.3);
    expect(valueAt(line, 8)).toBeCloseTo(0.6);
  });
  it("gives the corners between two beats, ends included", () => {
    const corners = lineBetween(line, 6, 13);
    expect(corners.map((c) => c.beat)).toEqual([6, 8, 12, 13]);
    expect(corners[0].value).toBeCloseTo(0.4);
    expect(corners[3].value).toBeCloseTo(0.45);
    expect(lineBetween(line, 20, 24)).toEqual(pts([20, 0], [24, 0]));
  });
});

describe("points", () => {
  it("are kept in range and in order, one a beat", () => {
    expect(cleanPoints([{ beat: 8, value: 2 }, { beat: -1, value: 0.5 }, { beat: 4, value: "x" }, { beat: 8, value: 0.3 }, null])).toEqual(pts([0, 0.5], [8, 0.3]));
    expect(cleanPoints("nonsense")).toEqual([]);
    expect(cleanPoints(Array.from({ length: MOST_POINTS + 50 }, (_, i) => ({ beat: i, value: 0.5 })))).toHaveLength(MOST_POINTS);
  });
  it("are added, moved (never past their neighbours) and taken away", () => {
    let line = withPoint([], { beat: 8, value: 0.5 });
    line = withPoint(line, { beat: 2, value: 0.1 });
    line = withPoint(line, { beat: 8, value: 0.9 });
    expect(line).toEqual(pts([2, 0.1], [8, 0.9]));
    expect(withPointMoved(line, 0, { beat: 20, value: 1.5 })[0]).toEqual({ beat: 7.999, value: 1 });
    expect(withoutPoint(line, 0)).toEqual(pts([8, 0.9]));
  });
  it("start from where the track has things", () => {
    const t = { volume: 0.8, pan: -0.5, filter: undefined };
    expect(restingValue(t, "volume")).toBe(0.8);
    expect(restingValue(t, "pan")).toBe(0.25);
    expect(restingValue(t, "filter")).toBe(1);
    expect(restingValue({ ...t, filter: { kind: "high", cutoff: 0.3, resonance: 0 } }, "filter")).toBe(0.3);
  });
  it("are worded and turned into sound", () => {
    expect(panValueWords(0.5)).toBe("middle");
    expect(panValueWords(0.2)).toBe("60% left");
    expect(volumeValueGain(0.8)).toBe(1);
    expect(volumeValueGain(0)).toBe(0);
    expect(volumeValueGain(1)).toBeCloseTo(1.5625);
  });
});

describe("a track's lines in the song", () => {
  it("are set, changed and taken off, the field going when the last goes", () => {
    const { song, track } = songWith();
    const one = edits.setAutomation(song, track, "volume", pts([0, 0.8], [16, 0]));
    expect(lineOf(edits.findTrack(one, track)!, "volume")).toEqual(pts([0, 0.8], [16, 0]));
    expect(edits.setAutomation(one, track, "volume", pts([0, 0.8], [16, 0]))).toBe(one);
    const two = edits.setAutomation(one, track, "pan", pts([0, 0]));
    expect(Object.keys(edits.findTrack(two, track)!.automation!)).toEqual(["volume", "pan"]);
    const off = edits.setAutomation(edits.setAutomation(two, track, "volume", null), track, "pan", []);
    expect("automation" in edits.findTrack(off, track)!).toBe(false);
    expect(edits.setAutomation(song, track, "filter", null)).toBe(song);
    expect(edits.setAutomation(song, "nobody", "filter", pts([0, 1]))).toBe(song);
  });
  it("leave the other tracks the very same objects, and are named in the undo list", () => {
    const { song, track } = songWith();
    const other = newTrack("instrument", "piano", song.tracks);
    const both = edits.addTrack(song, other);
    const next = edits.setAutomation(both, track, "filter", pts([0, 0.2], [8, 1]));
    expect(next.tracks.find((t) => t.id === other.id)).toBe(both.tracks.find((t) => t.id === other.id));
    expect(changeLabel(both, next)).toMatch(/automation|line/i);
  });
  it("are saved in the file and read back carefully", () => {
    const { song, track } = songWith();
    const s = edits.setAutomation(song, track, "filter", pts([0, 0.2], [8, 1]));
    const read = parseSong(JSON.parse(songFileText(s)).song)!;
    expect(read.tracks[0].automation).toEqual({ filter: pts([0, 0.2], [8, 1]) });
    expect(cleanAutomation({ volume: "loud", pan: [{ beat: 1, value: 0.5 }], wobble: [{ beat: 0, value: 1 }] })).toEqual({ pan: pts([1, 0.5]) });
    expect(cleanAutomation({ volume: [] })).toBeUndefined();
    const plain = parseSong(JSON.parse(songFileText(song)).song)!;
    expect("automation" in plain.tracks[0]).toBe(false);
  });
});
