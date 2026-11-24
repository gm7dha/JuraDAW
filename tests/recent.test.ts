/** Recent songs (src/model/recent.ts, as JuraCUT's recent designs), over a store in memory. */
import { describe, expect, it } from "vitest";
import { newSong, newTrack } from "../src/model/document";
import * as edits from "../src/model/edits";
import { keepRecent, memoryStore, MOST_RECENT, openRecent, recentList, recentSoundIds, thumbnail } from "../src/model/recent";
import { sectionEnd } from "../src/model/songParts";
import type { Song } from "../src/model/types";

function songNamed(name: string, bars = 2): Song {
  const track = newTrack("instrument", "piano", []);
  const song = edits.addTrack({ ...newSong(name) }, track);
  return edits.addClips(song, [edits.makeMidiClip(track, 0, bars * 4)]);
}

describe("recent songs", () => {
  it("keeps songs newest first, drops the oldest past the limit, and opens them again", async () => {
    const store = memoryStore();
    for (let i = 0; i < MOST_RECENT + 3; i++) await keepRecent(store, `s${i}`, songNamed(`Song ${i}`, i + 1), 1000 + i);
    const list = await recentList(store);
    expect(list.length).toBe(MOST_RECENT);
    expect(list[0].name).toBe(`Song ${MOST_RECENT + 2}`);
    expect(list[0].bars).toBe(MOST_RECENT + 3);
    expect(list.some((m) => m.id === "s0")).toBe(false);
    const back = await openRecent(store, list[0].id);
    expect(back!.name).toBe(`Song ${MOST_RECENT + 2}`);
    expect(back!.clips).toHaveLength(1);
  });
  it("updates a song kept under the same id, and skips songs with no tracks", async () => {
    const store = memoryStore();
    await keepRecent(store, "a", songNamed("One"), 1);
    const two = edits.addTrack(songNamed("One"), newTrack("instrument", "bass", songNamed("One").tracks));
    await keepRecent(store, "a", two, 2);
    await keepRecent(store, "b", newSong("Empty"), 3);
    const list = await recentList(store);
    expect(list.length).toBe(1);
    expect(list[0].tracks).toBe(2);
  });
  it("remembers the sounds each song uses, so the browser keeps them", async () => {
    const store = memoryStore();
    const audio = newTrack("audio", "", []);
    let song = edits.addTrack(newSong("Voice"), audio);
    const info = { id: "snd1", name: "Take 1", seconds: 2, sampleRate: 44100, channels: 1 };
    song = edits.addClips(song, [edits.makeAudioClip(audio, 0, info)], [info]);
    await keepRecent(store, "v", song, 5);
    await keepRecent(store, "p", songNamed("Plain"), 6);
    expect(await recentSoundIds(store)).toEqual(["snd1"]);
  });
  it("reads back nothing for a damaged or missing song", async () => {
    const store = memoryStore();
    await store.put({ id: "x", name: "X", at: 1, tracks: 1, bars: 1, soundIds: [], thumb: "" }, "{not json");
    expect(await openRecent(store, "x")).toBeNull();
    expect(await openRecent(store, "nobody")).toBeNull();
  });
  it("draws a small picture of the tracks and clips", () => {
    const t = thumbnail(songNamed("Picture"));
    expect(t.startsWith("<svg") && t.includes("<rect")).toBe(true);
    expect(thumbnail(newSong("Nothing"))).toBe("");
  });
});

describe("a section's end", () => {
  it("is the next section's start, else the end of the song's last bar", () => {
    const song = { ...songNamed("Parts", 6), sections: [{ beat: 0, name: "Intro" }, { beat: 8, name: "Verse" }] };
    expect(sectionEnd(song, 0)).toBe(8);
    expect(sectionEnd(song, 8)).toBe(24);
    expect(sectionEnd(song, 30)).toBe(34);
  });
});
