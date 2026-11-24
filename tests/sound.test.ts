/** "Your own sound" (src/model/sound.ts): its settings, presets, sums, edits and files. */
import { describe, expect, it } from "vitest";
import { INSTRUMENTS, instrumentFor, instrumentById } from "../src/audio/instruments";
import { newSong, newTrack, parseSong, songFileText } from "../src/model/document";
import * as edits from "../src/model/edits";
import { DEFAULT_SOUND, SOUND_PRESETS, cleanSound, sameSound, soundNumbers, soundOf } from "../src/model/sound";

function customTrack() {
  const track = newTrack("instrument", "custom", []);
  return { song: edits.addTrack(newSong("Own"), track), id: track.id };
}

describe("your own sound", () => {
  it("is an instrument like the others, with the usual settings until one is changed", () => {
    expect(INSTRUMENTS.some((i) => i.id === "custom" && i.name === "Your own sound")).toBe(true);
    const { song, id } = customTrack();
    const track = edits.findTrack(song, id)!;
    expect("sound" in track).toBe(false);
    expect(soundOf(track)).toBe(DEFAULT_SOUND);
    expect(instrumentFor(track)).toBe(instrumentById("custom"));
  });
  it("is changed a setting at a time, the same again changing nothing", () => {
    const { song, id } = customTrack();
    const brighter = edits.updateTrack(song, id, { sound: { brightness: 0.9 } });
    expect(edits.findTrack(brighter, id)!.sound).toEqual({ ...DEFAULT_SOUND, brightness: 0.9 });
    expect(edits.updateTrack(brighter, id, { sound: { brightness: 0.9 } })).toBe(brighter);
    expect(edits.updateTrack(song, id, { sound: DEFAULT_SOUND })).toBe(song);
    expect("sound" in edits.findTrack(edits.updateTrack(brighter, id, { sound: null }), id)!).toBe(false);
    const track = edits.findTrack(brighter, id)!;
    // Its own instrument, made once for those settings.
    expect(instrumentFor(track)).toBe(instrumentFor(track));
    expect(instrumentFor(track)).not.toBe(instrumentById("custom"));
  });
  it("has presets that are all different, and settings made safe", () => {
    expect(new Set(SOUND_PRESETS.map((p) => p.name)).size).toBe(SOUND_PRESETS.length);
    for (const p of SOUND_PRESETS) expect(cleanSound(p.sound)).toEqual(p.sound);
    expect(cleanSound({ wave: "spiky", brightness: 4, hold: "x" })).toEqual({ ...DEFAULT_SOUND, brightness: 1 });
    expect(cleanSound("loud")).toBeUndefined();
    expect(sameSound(DEFAULT_SOUND, { ...DEFAULT_SOUND })).toBe(true);
  });
  it("turns its settings into sensible numbers", () => {
    const slow = soundNumbers({ ...DEFAULT_SOUND, fadeIn: 1, ringOn: 1, hold: 0, thickness: 0 });
    expect(slow.attack).toBeGreaterThan(1.9);
    expect(slow.release).toBeGreaterThan(2.9);
    expect(slow.sustain).toBe(0);
    expect(slow.detune).toBe(0);
    const quick = soundNumbers({ ...DEFAULT_SOUND, fadeIn: 0, ringOn: 0 });
    expect(quick.attack).toBeLessThan(0.01);
    expect(soundNumbers({ ...DEFAULT_SOUND, brightness: 1 }).cutoffTimes).toBeGreaterThan(soundNumbers({ ...DEFAULT_SOUND, brightness: 0 }).cutoffTimes * 20);
  });
  it("is saved and read back carefully, only on instrument tracks", () => {
    const { song, id } = customTrack();
    const s = edits.updateTrack(song, id, { sound: SOUND_PRESETS[0].sound });
    expect(parseSong(JSON.parse(songFileText(s)).song)!.tracks[0].sound).toEqual(SOUND_PRESETS[0].sound);
    const odd = parseSong({ ...JSON.parse(songFileText(s)).song, tracks: [{ ...s.tracks[0], kind: "audio" }] })!;
    expect("sound" in odd.tracks[0]).toBe(false);
  });
});
