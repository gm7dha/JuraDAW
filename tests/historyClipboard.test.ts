import { describe, expect, it } from "vitest";
import { copyClips, copyNotes, notesPastePlace, pasteClips, pasteNotes } from "../src/model/clipboard";
import { newSong, newTrack } from "../src/model/document";
import * as edits from "../src/model/edits";
import { changeLabel, historySteps } from "../src/model/historyLabel";
import type { AudioClip, MidiClip, Note, Song, Track } from "../src/model/types";

const track = (id: string, kind: "instrument" | "audio" = "instrument", instrument = "piano"): Track => ({ ...newTrack(kind, instrument, []), id });
const note = (id: string, pitch: number, start: number, length = 1, velocity = 100): Note => ({ id, pitch, start, length, velocity });
const midi = (id: string, trackId: string, start: number, length: number, notes: Note[] = []): MidiClip => ({ id, trackId, name: id, start, kind: "midi", length, notes });
const audio = (id: string, trackId: string, start: number, duration: number): AudioClip => ({ id, trackId, name: id, start, kind: "audio", audioId: "s", offset: 0, duration, gain: 1 });
const SOUND = { id: "s", name: "Sound", seconds: 8, sampleRate: 44100, channels: 1 };

function song(): Song {
  return {
    ...newSong(),
    tracks: [track("p"), { ...track("d", "instrument", "drums"), name: "Drums" }, { ...track("a", "audio"), name: "Voice" }, { ...track("b", "instrument", "bass"), name: "Bass" }],
    clips: [midi("Verse", "p", 0, 4, [note("n1", 60, 0), note("n2", 64, 1), note("n3", 67, 2)]), midi("Chorus", "p", 4, 4, [note("n4", 72, 0)]), audio("Take", "a", 2, 4)],
    audio: [SOUND],
  };
}

describe("what each undo step did", () => {
  const base = song();
  it("names changes to tracks", () => {
    const added = edits.addTrack(base, { ...track("x", "instrument", "organ"), name: "Organ" });
    expect(changeLabel(base, added)).toBe('Added the track "Organ"');
    expect(changeLabel(added, base)).toBe('Removed the track "Organ"');
    expect(changeLabel(base, edits.removeTrack(edits.removeTrack(base, "d"), "b"))).toBe("Removed 2 tracks");
    expect(changeLabel(base, edits.duplicateTrack(base, "p")!.song)).toBe('Added the track "Piano copy"');
    expect(changeLabel(base, edits.moveTrack(base, "p", 1))).toBe("Changed the order of the tracks");
    expect(changeLabel(base, edits.updateTrack(base, "p", { name: "Keys" }))).toBe('Renamed "Piano" to "Keys"');
    expect(changeLabel(base, edits.updateTrack(base, "p", { mute: true }))).toBe('Muted "Piano"');
    expect(changeLabel(edits.updateTrack(base, "p", { mute: true }), base)).toBe('Unmuted "Piano"');
    expect(changeLabel(base, edits.updateTrack(base, "p", { solo: true }))).toBe('Soloed "Piano"');
    expect(changeLabel(base, edits.updateTrack(base, "p", { volume: 0.3 }))).toBe('Changed the volume of "Piano"');
    expect(changeLabel(base, edits.updateTrack(base, "p", { pan: -0.5 }))).toBe('Moved "Piano" to the left');
    expect(changeLabel(base, edits.updateTrack(base, "p", { reverb: 0.6 }))).toBe('Changed the reverb on "Piano"');
    expect(changeLabel(base, edits.updateTrack(base, "p", { echo: 0.6 }))).toBe('Changed the echo on "Piano"');
    expect(changeLabel(base, edits.updateTrack(base, "p", { instrument: "organ" }))).toBe('Changed "Piano" to Organ');
    expect(changeLabel(base, edits.updateTrack(base, "p", { volume: 0.3, pan: 1 }))).toBe('Changed the track "Piano"');
    const both = edits.updateTrack(edits.updateTrack(base, "p", { mute: true }), "d", { mute: true });
    expect(changeLabel(base, both)).toBe("Muted 2 tracks");
  });
  it("names changes to clips", () => {
    const added = edits.addClips(base, [midi("Bridge", "b", 8, 4)]);
    expect(changeLabel(base, added)).toBe('Added the clip "Bridge"');
    expect(changeLabel(added, base)).toBe('Removed the clip "Bridge"');
    expect(changeLabel(base, edits.removeClips(base, ["Verse", "Take"]))).toBe("Removed 2 clips");
    expect(changeLabel(base, edits.moveClips(base, ["Verse"], 8, 0))).toBe('Moved the clip "Verse"');
    expect(changeLabel(base, edits.moveClips(base, ["Verse"], 0, 1))).toBe('Moved the clip "Verse"');
    expect(changeLabel(base, edits.moveClips(base, ["Verse", "Chorus"], 1, 0))).toBe("Moved 2 clips");
    expect(changeLabel(base, edits.resizeClip(base, "Verse", "end", 2))).toBe('Changed the length of the clip "Verse"');
    expect(changeLabel(base, edits.resizeClip(base, "Verse", "start", 1.5))).toBe('Changed the length of the clip "Verse"');
    expect(changeLabel(base, edits.resizeClip(base, "Take", "end", 4))).toBe('Changed the length of the clip "Take"');
    expect(changeLabel(base, edits.resizeClip(base, "Take", "start", 3))).toBe('Changed the length of the clip "Take"');
    expect(changeLabel(base, edits.updateClip(base, "Verse", { name: "Intro" }))).toBe('Renamed "Verse" to "Intro"');
    expect(changeLabel(base, edits.updateClip(base, "Take", { gain: 0.5 }))).toBe('Changed the volume of the clip "Take"');
    expect(changeLabel(base, edits.splitClip(base, "Verse", 2)!.song)).toBe('Split the clip "Verse"');
    expect(changeLabel(base, edits.splitClip(base, "Take", 4)!.song)).toBe('Split the clip "Take"');
    expect(changeLabel(base, edits.joinClips(base, ["Verse", "Chorus"])!.song)).toBe("Joined 2 clips");
    expect(changeLabel(base, edits.repeatClips(base, ["Verse"], 3)!.song)).toBe("Added 3 clips");
    expect(changeLabel(base, edits.duplicateClips(base, ["Verse"])!.song)).toBe('Added the clip "Verse"');
  });
  it("names changes to notes", () => {
    const added = edits.addNote(base, "Verse", { pitch: 62, start: 3, length: 1, velocity: 90 })!.song;
    expect(changeLabel(base, added)).toBe("Added a note");
    // Even when the clip had to grow for it.
    expect(changeLabel(base, edits.addNote(base, "Verse", { pitch: 62, start: 3.5, length: 2, velocity: 90 })!.song)).toBe("Added a note");
    expect(changeLabel(base, edits.addNotes(base, "Verse", [{ pitch: 1, start: 0, length: 1, velocity: 9 }, { pitch: 2, start: 0, length: 1, velocity: 9 }])!.song)).toBe("Added 2 notes");
    expect(changeLabel(base, edits.removeNotes(base, "Verse", ["n1"]))).toBe("Removed a note");
    expect(changeLabel(base, edits.removeNotes(base, "Verse", ["n1", "n2", "n3"]))).toBe("Removed 3 notes");
    const moved = edits.updateNotes(base, "Verse", [{ id: "n1", patch: { start: 0.5 } }, { id: "n2", patch: { start: 1.5, pitch: 65 } }, { id: "n3", patch: { pitch: 60 } }]);
    expect(changeLabel(base, moved)).toBe("Moved 3 notes");
    expect(changeLabel(base, edits.transposeNotes(base, "Verse", ["n1", "n2"], 12))).toBe("Moved 2 notes up");
    expect(changeLabel(base, edits.transposeNotes(base, "Verse", ["n1"], -1))).toBe("Moved a note down");
    expect(changeLabel(base, edits.updateNotes(base, "Verse", [{ id: "n1", patch: { length: 0.5 } }]))).toBe("Changed the length of a note");
    expect(changeLabel(base, edits.setNotesVelocity(base, "Verse", ["n1", "n2"], 40))).toBe("Changed how hard 2 notes are played");
    expect(changeLabel(base, edits.setNotesVelocity(base, "Verse", ["n1"], 40))).toBe("Changed how hard a note is played");
    const off = edits.updateNotes(base, "Verse", [{ id: "n2", patch: { start: 1.1 } }]);
    expect(changeLabel(off, edits.quantiseNotes(off, "Verse", ["n1", "n2", "n3"], 1))).toBe("Moved a note");
    expect(changeLabel(base, edits.updateNotes(base, "Verse", [{ id: "n1", patch: { length: 2, velocity: 3 } }]))).toBe("Changed a note");
    // Notes in two clips at once (transposing two selected clips).
    const two = edits.transposeNotes(edits.transposeNotes(base, "Verse", ["n1", "n2", "n3"], 2), "Chorus", ["n4"], 2);
    expect(changeLabel(base, two)).toBe("Moved 4 notes up");
  });
  it("names changes to the song itself", () => {
    expect(changeLabel(base, edits.setBpm(base, 140))).toBe("Changed the tempo to 140");
    expect(changeLabel(base, edits.setBeatsPerBar(base, 3))).toBe("Changed to 3 beats in a bar");
    expect(changeLabel(base, edits.setMaster(base, 0.5))).toBe("Changed the master volume");
    expect(changeLabel(base, edits.setSongName(base, "Tune"))).toBe('Named the song "Tune"');
    expect(changeLabel(base, edits.setLoop(base, { on: true }))).toBe("Turned the loop on");
    expect(changeLabel(base, edits.setLoop(base, { end: 8 }))).toBe("Changed the loop");
    expect(changeLabel(base, base)).toBe("A small change");
    expect(changeLabel(base, { ...base })).toBe("A small change");
  });
  it("knows a new song and an opened one from an ordinary change", () => {
    expect(changeLabel(base, newSong())).toBe("Started a new song");
    expect(changeLabel(newSong(), newSong())).toBe("Started a new song");
    const other: Song = { ...newSong("Other"), tracks: [track("z")] };
    expect(changeLabel(base, other)).toBe('Opened "Other"');
    const one: Song = { ...newSong(), tracks: [track("p")] };
    expect(changeLabel(one, newSong())).toBe('Removed the track "Piano"');
    expect(changeLabel(newSong(), one)).toBe('Added the track "Piano"');
  });
  it("lists every step, oldest first, with where you are", () => {
    const a = newSong();
    const b = edits.addTrack(a, track("p"));
    const c = edits.setBpm(b, 90);
    const d = edits.updateTrack(c, "p", { mute: true });
    const steps = historySteps([a, b], c, [d]);
    expect(steps.map((s) => s.offset)).toEqual([-2, -1, 0, 1]);
    expect(steps.map((s) => s.label)).toEqual(["Where the history starts", 'Added the track "Piano"', "Changed the tempo to 90", 'Muted "Piano"']);
    expect(historySteps([], a, [])).toEqual([{ offset: 0, label: "Where the history starts" }]);
  });
});

describe("copying and pasting clips", () => {
  it("copies clips with their places relative to the first and topmost", () => {
    const copied = copyClips(song(), ["Chorus", "Take"])!;
    expect(copied.kind).toBe("clips");
    // The sound starts at 2 on the third track, the chorus at 4 on the first.
    expect(copied.clips.map((c) => [c.clip.id, c.start, c.row])).toEqual([["Chorus", 2, 0], ["Take", 0, 2]]);
    expect(copied.span).toBe(8);
    expect(copied.audio).toEqual([SOUND]);
    expect(copyClips(song(), [])).toBeNull();
    expect(copyClips(song(), ["nope"])).toBeNull();
  });
  it("pastes copies with new ids at a place, on the chosen track", () => {
    const before = song();
    const copied = copyClips(before, ["Verse"])!;
    const made = pasteClips(before, copied, 16, "b")!;
    expect(made.ids.length).toBe(1);
    const pasted = edits.findMidiClip(made.song, made.ids[0])!;
    expect(pasted).toMatchObject({ trackId: "b", start: 16, length: 4, name: "Verse" });
    expect(pasted.notes.map((n) => [n.pitch, n.start])).toEqual([[60, 0], [64, 1], [67, 2]]);
    expect(pasted.notes.some((n) => ["n1", "n2", "n3"].includes(n.id))).toBe(false);
    expect(made.song.clips.slice(0, 3)).toEqual(before.clips);
    // Twice gives two separate copies.
    const again = pasteClips(made.song, copied, 20, "b")!;
    expect(again.ids[0]).not.toBe(made.ids[0]);
    expect(again.song.clips.length).toBe(5);
  });
  it("puts a clip back on its own track when the chosen one is the wrong sort", () => {
    const before = song();
    const notes = copyClips(before, ["Verse"])!;
    const onAudio = pasteClips(before, notes, 8, "a")!;
    expect(edits.findClip(onAudio.song, onAudio.ids[0])!.trackId).toBe("p");
    const none = pasteClips(before, notes, 8, null)!;
    expect(edits.findClip(none.song, none.ids[0])!.trackId).toBe("p");
    const sound = copyClips(before, ["Take"])!;
    const onPiano = pasteClips(before, sound, 12, "p")!;
    expect(edits.findClip(onPiano.song, onPiano.ids[0])).toMatchObject({ trackId: "a", start: 12 });
  });
  it("keeps several clips in their rows when they fit, and finds each a home when they don't", () => {
    const before = song();
    const copied = copyClips(before, ["Verse", "Take"])!;
    // Onto the drums: the notes go there, but two rows down is the bass — no good for a sound, which stays on its own track.
    const made = pasteClips(before, copied, 10, "d")!;
    const pasted = made.ids.map((id) => edits.findClip(made.song, id)!);
    expect(pasted.map((c) => [c.trackId, c.start])).toEqual([["d", 10], ["a", 12]]);
    // With its own track gone, a clip goes to the first track of its sort; with none, it's left out.
    const noPiano = edits.removeTrack(before, "p");
    const moved = pasteClips(noPiano, copyClips(before, ["Verse"])!, 0, null)!;
    expect(edits.findClip(moved.song, moved.ids[0])!.trackId).toBe("d");
    const noAudio = edits.removeTrack(before, "a");
    expect(pasteClips(noAudio, copyClips(before, ["Take"])!, 0, null)).toBeNull();
    expect(pasteClips(noAudio, copied, 0, null)!.ids.length).toBe(1);
  });
  it("brings a sound back into the song when its clip was cut", () => {
    const before = song();
    const copied = copyClips(before, ["Take"])!;
    const cut = edits.removeClips(before, ["Take"]);
    expect(cut.audio).toEqual([]);
    const made = pasteClips(cut, copied, 0, "a")!;
    expect(made.song.audio).toEqual([SOUND]);
    expect(edits.findClip(made.song, made.ids[0])).toMatchObject({ kind: "audio", audioId: "s", start: 0 });
  });
  it("never pastes before the start of the song", () => {
    const made = pasteClips(song(), copyClips(song(), ["Verse"])!, -6, "p")!;
    expect(edits.findClip(made.song, made.ids[0])!.start).toBe(0);
  });
});

describe("copying and pasting notes", () => {
  it("copies notes measured from the first of them", () => {
    const copied = copyNotes(song(), "Verse", ["n2", "n3"])!;
    expect(copied).toEqual({ kind: "notes", notes: [{ pitch: 64, start: 0, length: 1, velocity: 100 }, { pitch: 67, start: 1, length: 1, velocity: 100 }], from: 1, span: 2 });
    expect(copyNotes(song(), "Verse", [])).toBeNull();
    expect(copyNotes(song(), "Take", ["n1"])).toBeNull();
  });
  it("pastes them into a clip with new ids, growing it if they run past the end", () => {
    const before = song();
    const copied = copyNotes(before, "Verse", ["n2", "n3"])!;
    const made = pasteNotes(before, "Chorus", copied, 1)!;
    const clip = edits.findMidiClip(made.song, "Chorus")!;
    expect(clip.notes.map((n) => [n.pitch, n.start])).toEqual([[72, 0], [64, 1], [67, 2]]);
    expect(made.ids).toEqual(clip.notes.slice(1).map((n) => n.id));
    expect(clip.length).toBe(4);
    expect(edits.findMidiClip(pasteNotes(before, "Chorus", copied, 3)!.song, "Chorus")!.length).toBe(8);
    expect(pasteNotes(before, "Take", copied, 0)).toBeNull();
  });
  it("pastes at the cursor when it's inside the clip, else straight after where they came from", () => {
    const before = song();
    const copied = copyNotes(before, "Verse", ["n2", "n3"])!;
    // The chorus runs from beat 4 to 8.
    expect(notesPastePlace(before, "Chorus", copied, 5.5)).toBe(1.5);
    expect(notesPastePlace(before, "Chorus", copied, 4)).toBe(0);
    // Right at the clip's end counts as inside (the clip grows for the notes): that's where repeated pasting carries on.
    expect(notesPastePlace(before, "Chorus", copied, 8)).toBe(4);
    expect(notesPastePlace(before, "Chorus", copied, 8.5)).toBe(3);
    expect(notesPastePlace(before, "Chorus", copied, 0)).toBe(3);
  });
});
