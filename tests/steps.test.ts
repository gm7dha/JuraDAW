/** The step sequencer's model (src/model/steps.ts): rows, boxes, turning steps on and off, strengths and letters. */
import { describe, expect, it } from "vitest";
import { newSong, newTrack } from "../src/model/document";
import * as edits from "../src/model/edits";
import { STRENGTHS, nextStrength, notesInStep, rowLetters, setStep, setStepStrength, stepCount, stepRows, stepsToNotes, strengthOf } from "../src/model/steps";
import type { MidiClip, Song } from "../src/model/types";

function drumSong(): { song: Song; clip: string } {
  const track = newTrack("instrument", "drums", []);
  const song = edits.addTrack(newSong("Beat"), track);
  const clip = edits.makeMidiClip(track, 0, 4);
  return { song: edits.addClips(song, [clip]), clip: clip.id };
}
const clipOf = (song: Song, id: string) => edits.findMidiClip(song, id) as MidiClip;

describe("the grid", () => {
  it("has the kit's drums as rows on a drum track, and the key's notes otherwise", () => {
    const { song, clip } = drumSong();
    const rows = stepRows(clipOf(song, clip), true, undefined);
    expect(rows[0]).toEqual({ pitch: 36, name: "Kick" });
    expect(rows.length).toBe(13);
    const keys = stepRows(clipOf(song, clip), false, { note: 9, scale: "minor" });
    // A minor from C3 to C5: every white key, highest first.
    expect(keys[0].pitch).toBe(72);
    expect(keys.every((r) => [0, 2, 4, 5, 7, 9, 11].includes(r.pitch % 12))).toBe(true);
    expect(keys.length).toBe(15);
  });
  it("shows a pitch the clip holds even when it isn't a row of its own", () => {
    const { song, clip } = drumSong();
    const odd = edits.addNotes(song, clip, [{ pitch: 61, start: 0, length: 0.25, velocity: 100 }])!.song;
    expect(stepRows(clipOf(odd, clip), true, undefined).some((r) => r.pitch === 61)).toBe(true);
    expect(stepRows(clipOf(odd, clip), false, undefined).some((r) => r.pitch === 61)).toBe(true);
  });
  it("has as many steps as fit in the clip", () => {
    const { song, clip } = drumSong();
    expect(stepCount(clipOf(song, clip), 0.25)).toBe(16);
    expect(stepCount(clipOf(song, clip), 0.5)).toBe(8);
    expect(stepCount(clipOf(song, clip), 1 / 3)).toBe(12);
  });
});

describe("boxes", () => {
  it("turn on (a note a step long) and off, the same again changing nothing", () => {
    const { song, clip } = drumSong();
    const on = setStep(song, clip, 36, 4, 0.25, true);
    expect(clipOf(on, clip).notes.map(({ pitch, start, length, velocity }) => ({ pitch, start, length, velocity }))).toEqual([{ pitch: 36, start: 1, length: 0.25, velocity: STRENGTHS.normal }]);
    expect(setStep(on, clip, 36, 4, 0.25, true)).toBe(on);
    const off = setStep(on, clip, 36, 4, 0.25, false);
    expect(clipOf(off, clip).notes).toEqual([]);
    expect(setStep(off, clip, 36, 4, 0.25, false)).toBe(off);
  });
  it("count a note that starts anywhere inside them, and take it away with the box", () => {
    const { song, clip } = drumSong();
    const nudged = edits.addNotes(song, clip, [{ pitch: 38, start: 1.1, length: 0.25, velocity: 90 }])!.song;
    expect(notesInStep(clipOf(nudged, clip), 38, 4, 0.25)).toHaveLength(1);
    expect(clipOf(setStep(nudged, clip, 38, 4, 0.25, false), clip).notes).toHaveLength(0);
  });
  it("are played soft, normal or accented", () => {
    const { song, clip } = drumSong();
    const on = setStep(song, clip, 42, 0, 0.25, true);
    const loud = setStepStrength(on, clip, 42, 0, 0.25, "accent");
    expect(clipOf(loud, clip).notes[0].velocity).toBe(STRENGTHS.accent);
    expect(strengthOf(120)).toBe("accent");
    expect(strengthOf(70)).toBe("soft");
    expect(strengthOf(96)).toBe("normal");
    expect(nextStrength("normal")).toBe("accent");
    expect(nextStrength("accent")).toBe("soft");
    expect(nextStrength("soft")).toBe("normal");
  });
});

describe("rows written as letters", () => {
  it("make notes, and a clip's rows read back the same way", () => {
    const notes = stepsToNotes(36, "X...x...o...g...", 0.25);
    expect(notes.map((n) => [n.start, n.velocity])).toEqual([[0, 120], [1, 100], [2, 70], [3, 46]]);
    const { song, clip } = drumSong();
    const made = edits.addNotes(song, clip, stepsToNotes(36, "x...X...o.......", 0.25))!.song;
    expect(rowLetters(clipOf(made, clip), 36, 0.25)).toBe("x...X...o.......");
  });
});
