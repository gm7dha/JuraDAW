/** The song as a whole: its key, sections and finishing touches (src/model/songParts.ts), edited, saved and read back. */
import { describe, expect, it } from "vitest";
import { newSong, parseSong, songFileText } from "../src/model/document";
import * as edits from "../src/model/edits";
import { changeLabel } from "../src/model/historyLabel";
import { ALL_KEYS, chordAt, cleanFinish, cleanKey, cleanSections, finishOf, keyWords, nextSectionName, pitchInKey, sectionAt } from "../src/model/songParts";

describe("the key", () => {
  it("is made safe and worded", () => {
    expect(cleanKey({ note: 14, scale: "minor" })).toEqual({ note: 2, scale: "minor" });
    expect(cleanKey({ note: 3, scale: "dorian" })).toEqual({ note: 3, scale: "major" });
    expect(cleanKey({ scale: "minor" })).toBeUndefined();
    expect(keyWords({ note: 3, scale: "major" })).toBe("E♭ major");
    expect(ALL_KEYS).toHaveLength(24);
  });
  it("knows its notes and its chords", () => {
    const aMinor = { note: 9, scale: "minor" as const };
    expect(pitchInKey(60, aMinor)).toBe(true);
    expect(pitchInKey(61, aMinor)).toBe(false);
    // A minor: on A, A–C–E; on B, the B diminished chord; a note outside the key takes the key note below it.
    expect(chordAt(57, aMinor)).toEqual([57, 60, 64]);
    expect(chordAt(59, aMinor)).toEqual([59, 62, 65]);
    expect(chordAt(58, aMinor)).toEqual([57, 60, 64]);
    // With no key, a major chord on the note.
    expect(chordAt(61, undefined)).toEqual([61, 65, 68]);
  });
  it("is set and taken off, a no-change returning the same song, and named in the undo list", () => {
    const song = newSong("K");
    const keyed = edits.setKey(song, { note: 7, scale: "major" });
    expect(keyed.key).toEqual({ note: 7, scale: "major" });
    expect(edits.setKey(keyed, { note: 7, scale: "major" })).toBe(keyed);
    expect(changeLabel(song, keyed)).toBe("Set the key to G major");
    const off = edits.setKey(keyed, null);
    expect("key" in off).toBe(false);
    expect(edits.setKey(song, null)).toBe(song);
  });
});

describe("sections", () => {
  it("are made safe: in order, one a beat, names tidied", () => {
    expect(cleanSections([{ beat: 16, name: "  Verse  " }, { beat: 0, name: "Intro" }, { beat: 16, name: "Chorus" }, { beat: 4, name: "" }, { beat: "x", name: "No" }])).toEqual([
      { beat: 0, name: "Intro" },
      { beat: 16, name: "Chorus" },
    ]);
    expect(cleanSections("nope")).toEqual([]);
  });
  it("are offered names in the order a song goes, never one already used", () => {
    expect(nextSectionName([], 0)).toBe("Intro");
    expect(nextSectionName([{ beat: 0, name: "Intro" }], 8)).toBe("Verse");
    expect(nextSectionName([{ beat: 0, name: "Intro" }, { beat: 8, name: "Verse" }], 16)).toBe("Chorus");
    expect(nextSectionName([{ beat: 0, name: "Verse" }], 0)).toBe("Intro");
  });
  it("tell which part of the song a beat is in", () => {
    const parts = [{ beat: 0, name: "Intro" }, { beat: 16, name: "Verse" }];
    expect(sectionAt(parts, 15)?.name).toBe("Intro");
    expect(sectionAt(parts, 16)?.name).toBe("Verse");
    expect(sectionAt([{ beat: 4, name: "Late" }], 0)).toBeNull();
  });
  it("are set and taken away, and named in the undo list", () => {
    const song = newSong("S");
    const one = edits.setSections(song, [{ beat: 0, name: "Intro" }]);
    expect(changeLabel(song, one)).toBe('Added the section "Intro"');
    expect(edits.setSections(one, [{ beat: 0, name: "Intro" }])).toBe(one);
    expect("sections" in edits.setSections(one, [])).toBe(false);
  });
});

describe("finishing touches", () => {
  it("are made safe, set a part at a time and taken away", () => {
    expect(cleanFinish({ lows: 3, highs: 0, squeeze: -1 })).toEqual({ lows: 1 });
    expect(cleanFinish({})).toBeUndefined();
    expect(finishOf(undefined)).toEqual({ lows: 0, highs: 0, squeeze: 0 });
    const song = newSong("F");
    const on = edits.setFinish(song, { squeeze: 0.4 });
    expect(on.finish).toEqual({ squeeze: 0.4 });
    expect(edits.setFinish(edits.setFinish(on, { highs: 0.2 }), { squeeze: 0 }).finish).toEqual({ highs: 0.2 });
    expect("finish" in edits.setFinish(on, { squeeze: 0 })).toBe(false);
    expect(edits.setFinish(on, { squeeze: 0.4 })).toBe(on);
  });
});

describe("in files", () => {
  it("come back as they were saved, and a song without them is untouched", () => {
    let song = edits.setKey(newSong("Saved"), { note: 9, scale: "minor" });
    song = edits.setSections(song, [{ beat: 0, name: "Intro" }, { beat: 32, name: "Chorus" }]);
    song = edits.setFinish(song, { lows: -0.3, squeeze: 0.25 });
    const read = parseSong(JSON.parse(songFileText(song)).song)!;
    expect(read.key).toEqual(song.key);
    expect(read.sections).toEqual(song.sections);
    expect(read.finish).toEqual(song.finish);
    const plain = parseSong(JSON.parse(songFileText(newSong("Plain"))).song)!;
    expect("key" in plain || "sections" in plain || "finish" in plain).toBe(false);
  });
});
