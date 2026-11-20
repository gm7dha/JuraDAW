import { describe, expect, it } from "vitest";
import { MOST_CLIPS, MOST_NOTES, newSong, newTrack } from "../src/model/document";
import * as edits from "../src/model/edits";
import { MIN_LENGTH, MOST_TRACKS, type AudioClip, type MidiClip, type Note, type Song, type Track } from "../src/model/types";

const track = (id: string, kind: "instrument" | "audio" = "instrument", instrument = "piano"): Track => ({ ...newTrack(kind, instrument, []), id });
const note = (id: string, pitch: number, start: number, length = 1, velocity = 100): Note => ({ id, pitch, start, length, velocity });
const midi = (id: string, trackId: string, start: number, length: number, notes: Note[] = []): MidiClip => ({ id, trackId, name: id, start, kind: "midi", length, notes });
const audio = (id: string, trackId: string, start: number, duration: number, offset = 0): AudioClip => ({ id, trackId, name: id, start, kind: "audio", audioId: "s", offset, duration, gain: 1 });
const SOUND = { id: "s", name: "Sound", seconds: 8, sampleRate: 44100, channels: 1 };

/** Piano, drums, two audio tracks, a bass — at 120 bpm, so a second is two beats. */
function song(): Song {
  return {
    ...newSong(),
    tracks: [track("p"), track("d", "instrument", "drums"), track("a1", "audio"), track("a2", "audio"), track("b", "instrument", "bass")],
    clips: [midi("m1", "p", 0, 4, [note("n1", 60, 0), note("n2", 64, 1.5, 1), note("n3", 67, 3, 1)]), midi("m2", "p", 4, 4, [note("n4", 72, 0, 2)]), audio("au", "a1", 2, 4)],
    audio: [SOUND],
  };
}
const midiOf = (s: Song, id: string) => edits.findMidiClip(s, id)!;
const audioOf = (s: Song, id: string) => edits.findClip(s, id) as AudioClip;

describe("the whole song", () => {
  it("keeps the tempo, bar and volume inside their limits", () => {
    const s = song();
    expect(edits.setBpm(s, 500).bpm).toBe(300);
    expect(edits.setBpm(s, 2).bpm).toBe(30);
    expect(edits.setBpm(s, 93.456).bpm).toBe(93.46);
    expect(edits.setBeatsPerBar(s, 3.2).beatsPerBar).toBe(3);
    expect(edits.setBeatsPerBar(s, 40).beatsPerBar).toBe(12);
    expect(edits.setMaster(s, 4).master).toBe(1);
    expect(edits.setSongName(s, "  Tune  ").name).toBe("Tune");
  });
  it("returns the very same song when nothing changes", () => {
    const s = song();
    expect(edits.setBpm(s, 120)).toBe(s);
    expect(edits.setBpm(s, NaN)).toBe(s);
    expect(edits.setBeatsPerBar(s, 4)).toBe(s);
    expect(edits.setMaster(s, 0.8)).toBe(s);
    expect(edits.setSongName(s, "   ")).toBe(s);
    expect(edits.setSongName(s, s.name)).toBe(s);
    expect(edits.setLoop(s, {})).toBe(s);
    expect(edits.updateTrack(s, "p", { volume: 0.8 })).toBe(s);
    expect(edits.updateTrack(s, "nope", { volume: 0.1 })).toBe(s);
    expect(edits.updateClip(s, "m1", { start: 0 })).toBe(s);
    expect(edits.moveClips(s, ["m1"], 0, 0)).toBe(s);
    expect(edits.moveClips(s, [], 4, 1)).toBe(s);
    expect(edits.moveTrack(s, "p", -1)).toBe(s);
    expect(edits.removeClips(s, ["nope"])).toBe(s);
    expect(edits.removeTrack(s, "nope")).toBe(s);
    expect(edits.removeNotes(s, "m1", ["nope"])).toBe(s);
    expect(edits.updateNotes(s, "m1", [{ id: "n1", patch: { pitch: 60 } }])).toBe(s);
    expect(edits.quantiseNotes(s, "m1", ["n1", "n3"], 1)).toBe(s);
    expect(edits.transposeNotes(s, "m1", ["n1"], 0)).toBe(s);
    expect(edits.setNotesVelocity(s, "m1", ["n1"], 100)).toBe(s);
    expect(edits.resizeClip(s, "m1", "end", 4)).toBe(s);
  });
  it("sets the loop, never shorter than a quarter of a beat or before the start", () => {
    const s = song();
    expect(edits.setLoop(s, { on: true }).loop).toEqual({ on: true, start: 0, end: 16 });
    expect(edits.setLoop(s, { start: 8, end: 4 }).loop).toEqual({ on: false, start: 8, end: 8.25 });
    expect(edits.setLoop(s, { start: -4 }).loop.start).toBe(0);
    expect(edits.setLoop(s, { start: 20 }).loop).toEqual({ on: false, start: 20, end: 20.25 });
  });
});

describe("tracks", () => {
  it("adds after a given track, or at the bottom", () => {
    const s = song();
    const t = track("new");
    expect(edits.addTrack(s, t, "p").tracks.map((x) => x.id)).toEqual(["p", "new", "d", "a1", "a2", "b"]);
    expect(edits.addTrack(s, t).tracks.map((x) => x.id)).toEqual(["p", "d", "a1", "a2", "b", "new"]);
    expect(edits.addTrack(s, t, "missing").tracks[5].id).toBe("new");
    expect(edits.addTrack(s, s.tracks[0])).toBe(s);
  });
  it("stops at the most tracks", () => {
    let s = newSong();
    for (let i = 0; i < MOST_TRACKS + 5; i++) s = edits.addTrack(s, track(`t${i}`));
    expect(s.tracks.length).toBe(MOST_TRACKS);
    expect(edits.duplicateTrack(s, "t0")).toBeNull();
  });
  it("removes a track with its clips, and sounds nothing uses any more", () => {
    const s = edits.removeTrack(song(), "a1");
    expect(s.tracks.map((t) => t.id)).toEqual(["p", "d", "a2", "b"]);
    expect(s.clips.map((c) => c.id)).toEqual(["m1", "m2"]);
    expect(s.audio).toEqual([]);
    const s2 = edits.removeTrack(song(), "p");
    expect(s2.clips.map((c) => c.id)).toEqual(["au"]);
    expect(s2.audio.length).toBe(1);
  });
  it("duplicates a track and its clips with new ids, straight after it", () => {
    const before = song();
    const made = edits.duplicateTrack(before, "p")!;
    expect(made.song.tracks.map((t) => t.id)).toEqual(["p", made.id, "d", "a1", "a2", "b"]);
    const copy = edits.findTrack(made.song, made.id)!;
    expect(copy.name).toBe("Piano copy");
    expect(copy.colour).not.toBe(before.tracks[0].colour);
    const copies = made.song.clips.filter((c) => c.trackId === made.id) as MidiClip[];
    expect(copies.map((c) => [c.start, c.length, c.notes.length])).toEqual([[0, 4, 3], [4, 4, 1]]);
    const ids = made.song.clips.flatMap((c) => [c.id, ...(c.kind === "midi" ? c.notes.map((n) => n.id) : [])]);
    expect(new Set(ids).size).toBe(ids.length);
    // The originals are untouched.
    expect(made.song.clips.slice(0, 3)).toEqual(before.clips);
    expect(made.song.clips[0]).toBe(before.clips[0]);
    expect(edits.duplicateTrack(made.song, "p")!.song.tracks[1].name).toBe("Piano copy 2");
    expect(edits.copyName("Piano copy 2")).toBe("Piano copy 3");
  });
  it("changes a track's settings within limits, leaving the other tracks as they were", () => {
    const before = song();
    const s = edits.updateTrack(before, "p", { volume: 3, pan: -7, reverb: 2, echo: -1, mute: true, name: "  Keys ", colour: "#123456" });
    expect(s.tracks[0]).toMatchObject({ volume: 1, pan: -1, reverb: 1, echo: 0, mute: true, name: "Keys", colour: "#123456" });
    expect(s.tracks[1]).toBe(before.tracks[1]);
    expect(s.clips).toBe(before.clips);
    expect(edits.updateTrack(before, "p", { name: "   " })).toBe(before);
    expect(edits.updateTrack(before, "p", { volume: NaN })).toBe(before);
  });
  it("renames a track with its instrument, unless it has a name of its own", () => {
    const before = song();
    expect(edits.updateTrack(before, "p", { instrument: "organ" }).tracks[0]).toMatchObject({ instrument: "organ", name: "Organ" });
    // Already a Bass track: the next is "Bass 2".
    const withBass = { ...before, tracks: before.tracks.map((t) => (t.id === "b" ? { ...t, name: "Bass" } : t)) };
    expect(edits.updateTrack(withBass, "p", { instrument: "bass" }).tracks[0].name).toBe("Bass 2");
    const named = edits.updateTrack(before, "p", { name: "My tune" });
    expect(edits.updateTrack(named, "p", { instrument: "organ" }).tracks[0]).toMatchObject({ instrument: "organ", name: "My tune" });
    expect(edits.updateTrack(before, "p", { instrument: "organ", name: "Church" }).tracks[0].name).toBe("Church");
    // Audio tracks have no instrument.
    expect(edits.updateTrack(before, "a1", { instrument: "organ" })).toBe(before);
  });
  it("moves a track up and down, stopping at the ends", () => {
    const s = song();
    expect(edits.moveTrack(s, "p", 1).tracks.map((t) => t.id)).toEqual(["d", "p", "a1", "a2", "b"]);
    expect(edits.moveTrack(s, "b", -2).tracks.map((t) => t.id)).toEqual(["p", "d", "b", "a1", "a2"]);
    expect(edits.moveTrack(s, "d", 99).tracks.map((t) => t.id)).toEqual(["p", "a1", "a2", "b", "d"]);
    expect(edits.moveTrack(s, "b", 1)).toBe(s);
  });
});

describe("clips", () => {
  it("adds clips only to tracks of their own sort, listing a new sound", () => {
    const s = { ...song(), audio: [] as Song["audio"], clips: [] as Song["clips"] };
    const info = { ...SOUND, id: "new" };
    const made = edits.makeAudioClip(s.tracks[2], 3, info);
    expect(made).toMatchObject({ trackId: "a1", start: 3, audioId: "new", offset: 0, duration: 8, gain: 1, name: "Sound" });
    const added = edits.addClips(s, [made], [info]);
    expect(added.clips).toEqual([made]);
    expect(added.audio).toEqual([info]);
    // No sound to play, the wrong sort of track, no such track: left out.
    expect(edits.addClips(s, [made])).toBe(s);
    expect(edits.addClips(s, [{ ...made, trackId: "p" }], [info])).toBe(s);
    expect(edits.addClips(s, [midi("x", "a1", 0, 4)])).toBe(s);
    expect(edits.addClips(s, [midi("x", "gone", 0, 4)])).toBe(s);
    expect(edits.addClips(s, [midi("x", "p", -3, 4)]).clips[0].start).toBe(0);
    const empty = edits.makeMidiClip(s.tracks[0], -2, 0);
    expect(empty).toMatchObject({ trackId: "p", start: 0, length: MIN_LENGTH, name: "Piano", notes: [] });
  });
  it("changes a clip but keeps it sensible", () => {
    const s = song();
    expect(edits.updateClip(s, "m1", { start: -5 }).clips[0].start).toBe(0);
    expect(midiOf(edits.updateClip(s, "m1", { length: 0 }), "m1").length).toBe(MIN_LENGTH);
    expect(edits.updateClip(s, "m1", { name: " Intro " }).clips[0].name).toBe("Intro");
    expect(edits.updateClip(s, "m1", { trackId: "b" }).clips[0].trackId).toBe("b");
    // Notes can't go on an audio track, nor a sound on an instrument track.
    expect(edits.updateClip(s, "m1", { trackId: "a1" })).toBe(s);
    expect(edits.updateClip(s, "au", { trackId: "p" })).toBe(s);
    expect(edits.updateClip(s, "au", { trackId: "a2" }).clips[2].trackId).toBe("a2");
    // The sound is 8 seconds long: from 6 seconds in, at most 2 can play.
    expect(audioOf(edits.updateClip(s, "au", { offset: 6 }), "au")).toMatchObject({ offset: 6, duration: 2 });
    expect(audioOf(edits.updateClip(s, "au", { duration: 99 }), "au").duration).toBe(8);
    expect(audioOf(edits.updateClip(s, "au", { gain: 5 }), "au").gain).toBe(2);
    const changed = edits.updateClip(s, "m1", { start: 8 });
    expect(changed.clips[1]).toBe(s.clips[1]);
    expect(changed.tracks).toBe(s.tracks);
  });
  it("moves clips together in time, stopping the earliest at the start", () => {
    const s = edits.moveClips(song(), ["m1", "m2"], 2, 0);
    expect(s.clips.map((c) => c.start)).toEqual([2, 6, 2]);
    const back = edits.moveClips(song(), ["m2", "au"], -10, 0);
    // m2 is at 4 and the sound at 2: they can only go back 2 together.
    expect(back.clips.map((c) => c.start)).toEqual([0, 2, 0]);
    expect(edits.moveClips(song(), ["m1"], -3, 0)).toEqual(song());
  });
  it("moves clips between tracks only onto tracks of their own sort", () => {
    const s = song();
    // Piano → drums is one down: fine (both play notes).
    expect(edits.moveClips(s, ["m1"], 0, 1).clips[0].trackId).toBe("d");
    // Two down is an audio track: it goes as far as it can.
    expect(edits.possibleTrackMove(s, [s.clips[0]], 2)).toBe(1);
    expect(edits.moveClips(s, ["m1"], 0, 2).clips[0].trackId).toBe("d");
    // Four down is the bass: fine.
    expect(edits.moveClips(s, ["m1"], 0, 4).clips[0].trackId).toBe("b");
    expect(edits.possibleTrackMove(s, [s.clips[0]], 9)).toBe(4);
    expect(edits.possibleTrackMove(s, [s.clips[0]], -1)).toBe(0);
    // The sound can go down one audio track, but not up onto the drums.
    expect(edits.moveClips(s, ["au"], 0, 1).clips[2].trackId).toBe("a2");
    expect(edits.moveClips(s, ["au"], 0, -1)).toBe(s);
    // Notes and a sound picked together move only when each lands on a track of its own sort.
    expect(edits.moveClips(s, ["m1", "au"], 0, -1)).toBe(s);
    expect(edits.possibleTrackMove(s, [s.clips[0], s.clips[2]], 3)).toBe(1);
    expect(edits.moveClips(s, ["m1", "au"], 1, 1).clips.map((c) => [c.trackId, c.start])).toEqual([["d", 1], ["p", 4], ["a2", 3]]);
  });
  it("resizes a clip of notes from either end", () => {
    const s = song();
    const longer = midiOf(edits.resizeClip(s, "m1", "end", 6), "m1");
    expect(longer.length).toBe(6);
    expect(longer.notes).toBe(midiOf(s, "m1").notes);
    // Shorter keeps the notes past the end (unheard), so making it longer again brings them back.
    expect(midiOf(edits.resizeClip(s, "m1", "end", 1), "m1").notes.length).toBe(3);
    expect(midiOf(edits.resizeClip(s, "m1", "end", -9), "m1").length).toBe(MIN_LENGTH);
    // The start dragged in by 2 beats: the first note goes, the second is cut, the third stays where it is in the song.
    const later = midiOf(edits.resizeClip(s, "m1", "start", 2), "m1");
    expect(later).toMatchObject({ start: 2, length: 2 });
    expect(later.notes.map((n) => [n.id, n.start, n.length])).toEqual([["n2", 0, 0.5], ["n3", 1, 1]]);
    // Dragged out to the left: notes keep their place in the song.
    const earlier = midiOf(edits.resizeClip(s, "m2", "start", 1), "m2");
    expect(earlier).toMatchObject({ start: 1, length: 7 });
    expect(earlier.notes[0].start).toBe(3);
    expect(midiOf(edits.resizeClip(s, "m2", "start", -9), "m2")).toMatchObject({ start: 0, length: 8 });
    expect(midiOf(edits.resizeClip(s, "m2", "start", 99), "m2")).toMatchObject({ start: 8 - MIN_LENGTH, length: MIN_LENGTH });
  });
  it("resizes an audio clip within its sound", () => {
    const s = song();
    // The clip is at beat 2, playing seconds 0–4 of an 8 second sound (two beats a second).
    expect(audioOf(edits.resizeClip(s, "au", "end", 6), "au").duration).toBe(2);
    expect(audioOf(edits.resizeClip(s, "au", "end", 999), "au").duration).toBe(8);
    expect(audioOf(edits.resizeClip(s, "au", "start", 4), "au")).toMatchObject({ start: 4, offset: 1, duration: 3 });
    // Its start can't be dragged before the start of the sound.
    expect(edits.resizeClip(s, "au", "start", 0)).toBe(s);
    const trimmed = edits.resizeClip(s, "au", "start", 6);
    expect(audioOf(edits.resizeClip(trimmed, "au", "start", 0), "au")).toMatchObject({ start: 2, offset: 0, duration: 4 });
  });
});

describe("finding a free place on a track", () => {
  it("knows whether a stretch of a track is free", () => {
    const s = song();
    expect(edits.placeIsFree(s, "p", 8, 4)).toBe(true);
    expect(edits.placeIsFree(s, "p", 7.5, 4)).toBe(false);
    expect(edits.placeIsFree(s, "p", 0, 4)).toBe(false);
    // Touching ends don't count as lying over each other, and a clip can be left out (itself, when it's being moved).
    expect(edits.placeIsFree({ ...s, clips: s.clips.filter((c) => c.id !== "m2") }, "p", 4, 4)).toBe(true);
    expect(edits.placeIsFree(s, "p", 4, 4, ["m2"])).toBe(true);
    expect(edits.placeIsFree(s, "d", 0, 100)).toBe(true);
    // A sound clip's length is in seconds: 4 s at 120 bpm is 8 beats, from beat 2 to beat 10.
    expect(edits.placeIsFree(s, "a1", 9.5, 1)).toBe(false);
    expect(edits.placeIsFree(s, "a1", 10, 1)).toBe(true);
    expect(edits.placeIsFree(edits.setBpm(s, 60), "a1", 5.5, 1)).toBe(false);
    expect(edits.placeIsFree(edits.setBpm(s, 60), "a1", 6, 1)).toBe(true);
  });
  it("gives the place asked for when it's free, otherwise the first one after what's in the way", () => {
    const s = song();
    expect(edits.freePlace(s, "d", 3, 4)).toBe(3);
    expect(edits.freePlace(s, "p", 8, 4)).toBe(8);
    expect(edits.freePlace(s, "p", 0, 4)).toBe(8);
    expect(edits.freePlace(s, "p", 2, 1)).toBe(8);
    expect(edits.freePlace(s, "a1", 0, 4)).toBe(10);
    // On to the next bar line when a step is given.
    expect(edits.freePlace(s, "a1", 0, 4, 4)).toBe(12);
    expect(edits.freePlace(s, "p", 0, 4, 4)).toBe(8);
    // A gap that's too small is passed over; one that's big enough is used.
    const gaps = { ...s, clips: [midi("x", "p", 0, 4), midi("y", "p", 6, 4), midi("z", "p", 20, 4)] };
    expect(edits.freePlace(gaps, "p", 0, 4)).toBe(10);
    expect(edits.freePlace(gaps, "p", 0, 2)).toBe(4);
    expect(edits.freePlace(gaps, "p", 0, 12)).toBe(24);
    expect(edits.freePlace(gaps, "p", NaN, 2)).toBe(4);
    for (const length of [1, 2, 4, 12]) expect(edits.placeIsFree(gaps, "p", edits.freePlace(gaps, "p", 0, length), length)).toBe(true);
  });
});

describe("splitting", () => {
  it("shares a clip's notes between the two halves, cutting one that crosses", () => {
    const before = song();
    const made = edits.splitClip(before, "m1", 2)!;
    const left = midiOf(made.song, "m1");
    const right = midiOf(made.song, made.id);
    expect(made.song.clips.map((c) => c.id)).toEqual(["m1", made.id, "m2", "au"]);
    expect(left).toMatchObject({ start: 0, length: 2 });
    expect(right).toMatchObject({ start: 2, length: 2, trackId: "p", name: "m1" });
    // n2 (1.5–2.5) crosses the cut: its head stays, its tail starts the second half.
    expect(left.notes.map((n) => [n.id, n.pitch, n.start, n.length])).toEqual([["n1", 60, 0, 1], ["n2", 64, 1.5, 0.5]]);
    expect(right.notes.map((n) => [n.pitch, n.start, n.length])).toEqual([[64, 0, 0.5], [67, 1, 1]]);
    // The untouched note is the very same object; new notes have new ids.
    expect(left.notes[0]).toBe(midiOf(before, "m1").notes[0]);
    expect(right.notes.every((n) => !["n1", "n2", "n3"].includes(n.id))).toBe(true);
    expect(made.song.clips[2]).toBe(before.clips[1]);
  });
  it("puts a note that starts exactly on the cut in the second half", () => {
    const made = edits.splitClip(song(), "m1", 3)!;
    expect(midiOf(made.song, "m1").notes.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(midiOf(made.song, made.id).notes.map((n) => [n.pitch, n.start])).toEqual([[67, 0]]);
  });
  it("does nothing outside the clip or on its edges", () => {
    const s = song();
    for (const at of [0, 4, -1, 9, NaN, 1e-12, 4 - 1e-12]) expect(edits.splitClip(s, "m1", at)).toBeNull();
    expect(edits.splitClip(s, "nope", 2)).toBeNull();
  });
  it("splits a sound by adjusting where each half starts in it", () => {
    const made = edits.splitClip(song(), "au", 5)!;
    // Three beats in is a second and a half.
    expect(audioOf(made.song, "au")).toMatchObject({ start: 2, offset: 0, duration: 1.5 });
    expect(audioOf(made.song, made.id)).toMatchObject({ start: 5, offset: 1.5, duration: 2.5, audioId: "s" });
    expect(made.song.audio.length).toBe(1);
  });
  it("splits and joins back to the same sound", () => {
    const before = song();
    const made = edits.splitClip(before, "m1", 2.25)!;
    const joined = edits.joinClips(made.song, ["m1", made.id])!;
    const clip = midiOf(joined.song, "m1");
    expect(clip).toMatchObject({ start: 0, length: 4 });
    expect(joined.song.clips.map((c) => c.id)).toEqual(["m1", "m2", "au"]);
    // n2 is in two pieces now, but every beat that sounded still sounds.
    const sounding = clip.notes.map((n) => [n.pitch, n.start, n.start + n.length]).sort((a, b) => a[1] - b[1]);
    expect(sounding).toEqual([[60, 0, 1], [64, 1.5, 2.25], [64, 2.25, 2.5], [67, 3, 4]]);
  });
});

describe("joining", () => {
  it("joins clips of notes on one track, keeping the earliest one's id", () => {
    const made = edits.joinClips(song(), ["m2", "m1"])!;
    expect(made.id).toBe("m1");
    const clip = midiOf(made.song, "m1");
    expect(clip).toMatchObject({ start: 0, length: 8 });
    expect(clip.notes.map((n) => [n.id, n.start])).toEqual([["n1", 0], ["n2", 1.5], ["n3", 3], ["n4", 4]]);
    expect(made.song.clips.map((c) => c.id)).toEqual(["m1", "au"]);
  });
  it("covers a gap between them, and leaves out notes that were past their clip's end", () => {
    let s = song();
    s = edits.updateClip(s, "m2", { start: 10 });
    s = edits.resizeClip(s, "m1", "end", 2);
    const clip = midiOf(edits.joinClips(s, ["m1", "m2"])!.song, "m1");
    expect(clip.length).toBe(14);
    // n2 was cut off by the clip's end at 2; n3 (at 3) wasn't heard at all.
    expect(clip.notes.map((n) => [n.id, n.start, n.length])).toEqual([["n1", 0, 1], ["n2", 1.5, 0.5], ["n4", 10, 2]]);
  });
  it("won't join one clip, sounds, or clips on different tracks", () => {
    const s = song();
    expect(edits.joinClips(s, ["m1"])).toBeNull();
    expect(edits.joinClips(s, ["m1", "au"])).toBeNull();
    expect(edits.joinClips(s, [])).toBeNull();
    const apart = edits.updateClip(s, "m2", { trackId: "b" });
    expect(edits.canJoin(apart, ["m1", "m2"])).toBe(false);
    expect(edits.canJoin(s, ["m1", "m2"])).toBe(true);
  });
});

describe("repeating and removing", () => {
  it("repeats clips straight after themselves", () => {
    const made = edits.repeatClips(song(), ["m1"], 3)!;
    const copies = made.ids.map((id) => midiOf(made.song, id));
    expect(copies.map((c) => c.start)).toEqual([4, 8, 12]);
    expect(copies.every((c) => c.notes.length === 3 && c.trackId === "p")).toBe(true);
    const ids = made.song.clips.flatMap((c) => [c.id, ...(c.kind === "midi" ? c.notes.map((n) => n.id) : [])]);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("repeats a set of clips as one block", () => {
    // m1 (0–4) and the sound (2–10): the block is 10 beats long.
    const made = edits.repeatClips(song(), ["m1", "au"], 2)!;
    expect(made.ids.map((id) => edits.findClip(made.song, id)!.start)).toEqual([10, 12, 20, 22]);
    const twice = edits.duplicateClips(song(), ["m1", "m2"])!;
    expect(twice.ids.map((id) => edits.findClip(twice.song, id)!.start)).toEqual([8, 12]);
  });
  it("has nothing to repeat without clips or times", () => {
    expect(edits.repeatClips(song(), [], 2)).toBeNull();
    expect(edits.repeatClips(song(), ["m1"], 0)).toBeNull();
    expect(edits.repeatClips(song(), ["m1"], NaN)).toBeNull();
    expect(edits.repeatClips(song(), ["m1"], 9999)!.ids.length).toBe(edits.MOST_REPEATS);
  });
  it("removes clips and lets go of sounds nothing uses", () => {
    const s = edits.removeClips(song(), ["m1", "au"]);
    expect(s.clips.map((c) => c.id)).toEqual(["m2"]);
    expect(s.audio).toEqual([]);
    expect(edits.removeClips(song(), ["m1"]).audio.length).toBe(1);
  });
});

describe("notes", () => {
  it("adds a note, made safe, with an id", () => {
    const made = edits.addNote(song(), "m1", { pitch: 200.4, start: -1, length: 0, velocity: 500 })!;
    const added = midiOf(made.song, "m1").notes.find((n) => n.id === made.id)!;
    expect(added).toMatchObject({ pitch: 127, start: 0, length: MIN_LENGTH, velocity: 127 });
    expect(edits.addNote(song(), "au", { pitch: 60, start: 0, length: 1, velocity: 100 })).toBeNull();
    expect(edits.addNote(song(), "nope", { pitch: 60, start: 0, length: 1, velocity: 100 })).toBeNull();
    expect(edits.addNote(song(), "m1", { pitch: NaN, start: 0, length: 1, velocity: 100 })).toBeNull();
  });
  it("grows the clip to the end of the bar when a note runs past its end", () => {
    const made = edits.addNote(song(), "m1", { pitch: 60, start: 3.5, length: 1, velocity: 100 })!;
    expect(midiOf(made.song, "m1").length).toBe(8);
    const far = edits.addNote(song(), "m1", { pitch: 60, start: 9, length: 0.5, velocity: 100 })!;
    expect(midiOf(far.song, "m1").length).toBe(12);
    // A clip that starts off the bar grows to the bar line of the song, not of the clip.
    const off = edits.updateClip(song(), "m1", { start: 1 });
    expect(midiOf(edits.addNote(off, "m1", { pitch: 60, start: 3.5, length: 1, velocity: 100 })!.song, "m1").length).toBe(7);
    // Exactly reaching the end is not past it.
    expect(midiOf(edits.addNote(song(), "m1", { pitch: 60, start: 2, length: 2, velocity: 100 })!.song, "m1").length).toBe(4);
  });
  it("changes notes, leaving the others the same objects", () => {
    const before = song();
    const s = edits.updateNotes(before, "m1", [
      { id: "n1", patch: { pitch: 62, start: 0.5 } },
      { id: "n3", patch: { length: 3, velocity: 0 } },
      { id: "missing", patch: { pitch: 1 } },
    ]);
    const clip = midiOf(s, "m1");
    expect(clip.notes[0]).toMatchObject({ pitch: 62, start: 0.5, length: 1 });
    expect(clip.notes[1]).toBe(midiOf(before, "m1").notes[1]);
    expect(clip.notes[2]).toMatchObject({ length: 3, velocity: 1 });
    // n3 now runs from 3 to 6: the clip grows to the bar line.
    expect(clip.length).toBe(8);
    expect(s.clips[1]).toBe(before.clips[1]);
    expect(edits.updateNotes(before, "m1", [{ id: "n1", patch: { pitch: -40 } }]).clips[0]).toMatchObject({ notes: [{ pitch: 0 }, {}, {}] });
  });
  it("removes notes", () => {
    expect(midiOf(edits.removeNotes(song(), "m1", ["n1", "n3"]), "m1").notes.map((n) => n.id)).toEqual(["n2"]);
  });
  it("quantises starts to the grid, keeping lengths", () => {
    let s = song();
    s = edits.updateNotes(s, "m1", [
      { id: "n1", patch: { start: 0.1 } },
      { id: "n2", patch: { start: 1.4 } },
      { id: "n3", patch: { start: 2.76 } },
    ]);
    const q = midiOf(edits.quantiseNotes(s, "m1", ["n1", "n2", "n3"], 0.5), "m1");
    expect(q.notes.map((n) => [n.start, n.length])).toEqual([[0, 1], [1.5, 1], [3, 1]]);
    // Only the notes asked for.
    expect(midiOf(edits.quantiseNotes(s, "m1", ["n2"], 1), "m1").notes.map((n) => n.start)).toEqual([0.1, 1, 2.76]);
    // No grid, no change.
    expect(edits.quantiseNotes(s, "m1", ["n1"], 0)).toBe(s);
    expect(edits.quantiseNotes(s, "m1", ["n1"], -1)).toBe(s);
    expect(edits.quantiseNotes(s, "au", ["n1"], 1)).toBe(s);
  });
  it("quantises to the song's grid when the clip starts off it", () => {
    // The clip starts at 0.3; a note 0.1 into it is at 0.4 in the song, nearest grid line 0.5 → 0.2 into the clip.
    let s = edits.updateClip(song(), "m1", { start: 0.3 });
    s = edits.updateNotes(s, "m1", [{ id: "n1", patch: { start: 0.1 } }]);
    const q = midiOf(edits.quantiseNotes(s, "m1", ["n1"], 0.5), "m1");
    expect(q.notes[0].start).toBeCloseTo(0.2, 6);
  });
  it("takes the first grid line inside the clip when the nearest is before it", () => {
    // The clip starts at 0.3. A note 0.05 in is at 0.35 in the song: the nearest beat is 0, before the clip, so it goes to beat 1.
    let s = edits.updateClip(song(), "m1", { start: 0.3 });
    s = edits.updateNotes(s, "m1", [{ id: "n1", patch: { start: 0.05 } }]);
    const q = midiOf(edits.quantiseNotes(s, "m1", ["n1"], 1), "m1");
    expect(q.start + q.notes[0].start).toBeCloseTo(1, 6);
    // Whole bars: the only bar line in the clip (0.3 to 4.3) is beat 4.
    const bar = midiOf(edits.quantiseNotes(s, "m1", ["n1"], 4), "m1");
    expect(bar.start + bar.notes[0].start).toBeCloseTo(4, 6);
    // A grid with no line inside the clip at all leaves the note where it is.
    expect(edits.quantiseNotes(s, "m1", ["n1"], 16)).toBe(s);
  });
  it("quantises thirds of a beat (triplets) cleanly", () => {
    let s = edits.updateNotes(song(), "m1", [{ id: "n2", patch: { start: 0.69 } }]);
    s = edits.quantiseNotes(s, "m1", ["n2"], 1 / 3);
    expect(midiOf(s, "m1").notes[1].start).toBeCloseTo(2 / 3, 6);
    // Doing it again changes nothing at all.
    expect(edits.quantiseNotes(s, "m1", ["n2"], 1 / 3)).toBe(s);
  });
  it("never makes the clip longer, and keeps a note near the end inside it", () => {
    // A note at 3.9 in a 4-beat clip: the nearest beat is the clip's end, so it takes the last beat inside.
    const late = edits.updateNotes(song(), "m1", [{ id: "n3", patch: { start: 3.9, length: 0.1 } }]);
    const q = midiOf(edits.quantiseNotes(late, "m1", ["n3"], 1), "m1");
    expect(q.notes[2].start).toBe(3);
    expect(q.length).toBe(4);
    // A long note moved later still doesn't stretch the clip (it's cut off at the end, as it was before).
    const long = edits.resizeClip(edits.updateNotes(song(), "m1", [{ id: "n3", patch: { start: 2.6, length: 3 } }]), "m1", "end", 4);
    const moved = midiOf(edits.quantiseNotes(long, "m1", ["n3"], 1), "m1");
    expect([moved.notes[2].start, moved.length]).toEqual([3, 4]);
    // A note already past the end (unheard) just goes to its nearest line.
    const hidden = edits.resizeClip(edits.updateNotes(song(), "m1", [{ id: "n3", patch: { start: 6.2 } }]), "m1", "end", 4);
    expect(midiOf(edits.quantiseNotes(hidden, "m1", ["n3"], 1), "m1").notes[2].start).toBe(6);
  });
  it("transposes within the keyboard, keeping the tune's shape", () => {
    const s = song();
    expect(midiOf(edits.transposeNotes(s, "m1", ["n1", "n2", "n3"], 12), "m1").notes.map((n) => n.pitch)).toEqual([72, 76, 79]);
    expect(midiOf(edits.transposeNotes(s, "m1", ["n2"], -1), "m1").notes.map((n) => n.pitch)).toEqual([60, 63, 67]);
    // Up 100 would take the top note past 127: they all go up only 60.
    expect(midiOf(edits.transposeNotes(s, "m1", ["n1", "n2", "n3"], 100), "m1").notes.map((n) => n.pitch)).toEqual([120, 124, 127]);
    expect(midiOf(edits.transposeNotes(s, "m1", ["n1", "n2", "n3"], -100), "m1").notes.map((n) => n.pitch)).toEqual([0, 4, 7]);
    const top = edits.updateNotes(s, "m1", [{ id: "n1", patch: { pitch: 127 } }]);
    expect(edits.transposeNotes(top, "m1", ["n1"], 1)).toBe(top);
    expect(edits.transposeNotes(s, "m1", [], 5)).toBe(s);
  });
  it("sets how hard notes are played, from 1 to 127", () => {
    const s = song();
    expect(midiOf(edits.setNotesVelocity(s, "m1", ["n1", "n2"], 64), "m1").notes.map((n) => n.velocity)).toEqual([64, 64, 100]);
    expect(midiOf(edits.setNotesVelocity(s, "m1", ["n1"], 0), "m1").notes[0].velocity).toBe(1);
    expect(midiOf(edits.setNotesVelocity(s, "m1", ["n1"], 900), "m1").notes[0].velocity).toBe(127);
    expect(edits.setNotesVelocity(s, "m1", ["n1"], NaN)).toBe(s);
  });
  it("never alters the song it was given", () => {
    const before = song();
    const frozen = JSON.stringify(before);
    edits.splitClip(before, "m1", 2);
    edits.joinClips(before, ["m1", "m2"]);
    edits.moveClips(before, ["m1", "au"], 3, 1);
    edits.resizeClip(before, "m1", "start", 2);
    edits.quantiseNotes(before, "m1", ["n2"], 1);
    edits.transposeNotes(before, "m1", ["n1"], 3);
    edits.removeTrack(before, "p");
    edits.duplicateTrack(before, "p");
    edits.repeatClips(before, ["m1"], 2);
    expect(JSON.stringify(before)).toBe(frozen);
  });
});

describe("a clip made shorter stays shorter", () => {
  /** An 8-beat clip with notes at 0 and 6, its end dragged in to 4: the note at 6 is past the end, unheard. */
  function shortened(): Song {
    const base: Song = { ...newSong(), tracks: [track("p")], clips: [midi("c", "p", 0, 8, [note("a", 60, 0), note("b", 62, 6)])] };
    return edits.resizeClip(base, "c", "end", 4);
  }
  it("whatever is done to its other notes", () => {
    const s = shortened();
    expect(midiOf(s, "c").length).toBe(4);
    expect(midiOf(edits.setNotesVelocity(s, "c", ["a"], 50), "c").length).toBe(4);
    expect(midiOf(edits.transposeNotes(s, "c", ["a", "b"], 12), "c").length).toBe(4);
    expect(midiOf(edits.quantiseNotes(edits.updateNotes(s, "c", [{ id: "a", patch: { start: 0.2 } }]), "c", ["a", "b"], 1), "c").length).toBe(4);
    expect(midiOf(edits.updateNotes(s, "c", [{ id: "a", patch: { start: 1, pitch: 65 } }]), "c").length).toBe(4);
    expect(midiOf(edits.addNote(s, "c", { pitch: 64, start: 1, length: 1, velocity: 90 })!.song, "c").length).toBe(4);
    const without = midiOf(edits.removeNotes(s, "c", ["a"]), "c");
    expect([without.length, without.notes.length]).toEqual([4, 1]);
    // The hidden note is still there, and comes back when the clip is made longer again.
    expect(midiOf(edits.resizeClip(edits.setNotesVelocity(s, "c", ["a"], 50), "c", "end", 8), "c").notes.map((n) => n.start)).toEqual([0, 6]);
  });
  it("but still grows for a note that's added or moved past its end", () => {
    const s = shortened();
    expect(midiOf(edits.addNote(s, "c", { pitch: 64, start: 3.5, length: 1, velocity: 90 })!.song, "c").length).toBe(8);
    expect(midiOf(edits.updateNotes(s, "c", [{ id: "a", patch: { start: 9 } }]), "c").length).toBe(12);
    expect(midiOf(edits.updateNotes(s, "c", [{ id: "b", patch: { velocity: 3 } }]), "c").length).toBe(8);
  });
});

describe("splitting close to a note", () => {
  it("never leaves a note sticking out past the first half", () => {
    // A note starting 0.03 before the cut: too little would be left of it on the left, so the whole of it goes right.
    const base: Song = { ...newSong(), tracks: [track("p")], clips: [midi("c", "p", 0, 4, [note("a", 60, 0, 1), note("b", 62, 1.97, 1)])] };
    const made = edits.splitClip(base, "c", 2)!;
    const left = midiOf(made.song, "c");
    const right = midiOf(made.song, made.id);
    expect(left.notes.every((n) => n.start + n.length <= left.length + 1e-9)).toBe(true);
    expect(left.notes.map((n) => n.id)).toEqual(["a"]);
    expect(right.notes.map((n) => [n.pitch, n.start, n.length])).toEqual([[62, 0, 0.97]]);
    // So the next note edit doesn't make the left half grow.
    expect(midiOf(edits.setNotesVelocity(made.song, "c", ["a"], 40), "c").length).toBe(2);
    // A tiny note straddling the cut isn't lost either.
    const tiny: Song = { ...base, clips: [midi("c", "p", 0, 4, [note("t", 70, 1.97, 0.0625)])] };
    const split = edits.splitClip(tiny, "c", 2)!;
    expect([midiOf(split.song, "c").notes.length, midiOf(split.song, split.id).notes.length]).toEqual([0, 1]);
  });
});

describe("clips never start or last a time that isn't a number", () => {
  it("falls back to the start of the song and four beats", () => {
    const t = track("p");
    expect(edits.makeMidiClip(t, NaN, NaN)).toMatchObject({ start: 0, length: 4 });
    expect(edits.makeMidiClip(t, Infinity, -Infinity)).toMatchObject({ start: 0, length: 4 });
    expect(edits.makeAudioClip(track("a", "audio"), NaN, SOUND).start).toBe(0);
    const s: Song = { ...newSong(), tracks: [t] };
    expect(edits.addClips(s, [{ ...midi("x", "p", 0, 4), start: NaN }])).toBe(s);
  });
});

describe("limits, kept where things are made", () => {
  const many = (count: number, from = 0) => Array.from({ length: count }, (_, i) => ({ pitch: 60 + (i % 12), start: (from + i) * 0.25, length: 0.25, velocity: 100 }));
  it("a clip holds no more notes than a saved song reads back", () => {
    const base: Song = { ...newSong(), tracks: [track("p")], clips: [midi("c", "p", 0, 4), midi("d", "p", 8, 4)] };
    const full = edits.addNotes(base, "c", many(MOST_NOTES))!.song;
    expect(midiOf(full, "c").notes.length).toBe(MOST_NOTES);
    expect(edits.clipIsFull(full, "c")).toBe(true);
    expect(edits.clipIsFull(full, "d")).toBe(false);
    expect(edits.addNote(full, "c", { pitch: 60, start: 0, length: 1, velocity: 100 })).toBeNull();
    expect(edits.makeNotes(many(MOST_NOTES + 5)).length).toBe(MOST_NOTES);
    // Joining two clips that are too much for one is refused.
    const two = edits.addNotes(full, "d", many(10))!.song;
    expect(edits.canJoin(two, ["c", "d"])).toBe(true);
    expect(edits.joinClips(two, ["c", "d"])).toBeNull();
  });
  it("a song holds no more clips than a saved song reads back", () => {
    const clips = Array.from({ length: MOST_CLIPS - 3 }, (_, i) => midi(`c${i}`, "p", i, 1));
    const s: Song = { ...newSong(), tracks: [track("p")], clips };
    // Room for three more: two whole copies of one clip asked for sixty-four times is three.
    expect(edits.possibleRepeats(s, 1, 64)).toBe(3);
    expect(edits.repeatClips(s, ["c0"], 64)!.ids.length).toBe(3);
    expect(edits.possibleRepeats(s, 2, 5)).toBe(1);
    const full = edits.repeatClips(s, ["c0"], 64)!.song;
    expect(full.clips.length).toBe(MOST_CLIPS);
    expect(edits.repeatClips(full, ["c0"], 1)).toBeNull();
    expect(edits.splitClip(full, "c0", 0.5)).toBeNull();
    expect(edits.duplicateTrack(full, "p")).toBeNull();
    expect(edits.addClips(full, [midi("extra", "p", 0, 1)])).toBe(full);
    expect(edits.addClips(s, [midi("x1", "p", 0, 1), midi("x2", "p", 0, 1), midi("x3", "p", 0, 1), midi("x4", "p", 0, 1)]).clips.length).toBe(MOST_CLIPS);
  });
  it("stays quick with a clip as full as it can be", () => {
    const base: Song = { ...newSong(), tracks: [track("p")], clips: [midi("c", "p", 0, 4)] };
    const full = edits.addNotes(base, "c", many(MOST_NOTES))!;
    const started = Date.now();
    let s = edits.transposeNotes(full.song, "c", full.ids, 3);
    s = edits.setNotesVelocity(s, "c", full.ids, 64);
    s = edits.quantiseNotes(s, "c", full.ids, 1);
    s = edits.removeNotes(s, "c", full.ids.slice(0, MOST_NOTES / 2));
    expect(midiOf(s, "c").notes.length).toBe(MOST_NOTES / 2);
    // Each of these took a second or more when ids were looked up one by one; together they now take a few hundredths.
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
