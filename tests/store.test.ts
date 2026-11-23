import { beforeEach, describe, expect, it } from "vitest";
import { findPattern, makePattern } from "../src/library/patterns";
import { MOST_CLIPS, MOST_NOTES, newSong } from "../src/model/document";
import * as edits from "../src/model/edits";
import { changeLabel } from "../src/model/historyLabel";
import { EMPTY_CLIPS, EMPTY_IDS, MAX_UNDO, canRedo, canUndo, clipOf, clipsOfTrack, editingClipOf, hasUnsavedChanges, selectedTrackOf, songOf, trackOf, useStore } from "../src/model/store";
import type { State } from "../src/model/storeApi";
import { MOST_TRACKS, type MidiClip, type Song } from "../src/model/types";

const st = (): State => useStore.getState();
const song = (): Song => st().history.present;
const midiClip = (id: string): MidiClip => edits.findMidiClip(song(), id)!;
const NOTE = { pitch: 60, start: 0, length: 1, velocity: 100 };
const SOUND = { id: "sound-1", name: "Guitar", seconds: 4, sampleRate: 44100, channels: 2 };

/** A fresh, empty app before each test. */
beforeEach(() => {
  st().loadSong(newSong(), null);
  useStore.setState({ tool: "select", dialog: null, bottomPanel: null, snap: 0.25, toasts: [], storageProblem: null, cursor: 0, metronome: false, countIn: 1, playing: false, recording: false, countingIn: false });
});

/** Piano with two clips, drums, an audio track with a sound. Returns their ids. */
function setUp() {
  const piano = st().addTrack("instrument", "piano")!;
  const drums = st().addTrack("instrument", "drums")!;
  const voice = st().addTrack("audio")!;
  const verse = st().addMidiClip(piano, 0, 4);
  st().addNote(verse, NOTE);
  st().addNote(verse, { ...NOTE, pitch: 64, start: 1 });
  st().addNote(verse, { ...NOTE, pitch: 67, start: 2 });
  const chorus = st().addMidiClip(piano, 4, 4);
  const take = st().addAudioClip(voice, 2, SOUND);
  return { piano, drums, voice, verse, chorus, take };
}

describe("undo and redo", () => {
  it("starts with an empty song and nothing to undo", () => {
    expect(song()).toEqual(newSong());
    expect(canUndo(st())).toBe(false);
    expect(canRedo(st())).toBe(false);
    expect(st().selectedClipIds).toBe(EMPTY_IDS);
  });
  it("records a step for each commit, and none when nothing changed", () => {
    st().setBpm(100);
    st().setBpm(100);
    st().commit(song());
    expect(st().history.past.length).toBe(1);
    st().setBpm(140);
    st().undo();
    expect(song().bpm).toBe(100);
    st().undo();
    expect(song().bpm).toBe(120);
    st().undo();
    expect(song().bpm).toBe(120);
    st().redo();
    st().redo();
    expect(song().bpm).toBe(140);
    st().redo();
    expect(st().history.future.length).toBe(0);
  });
  it("forgets what could be redone once something new is done", () => {
    st().setBpm(100);
    st().setBpm(110);
    st().undo();
    expect(canRedo(st())).toBe(true);
    st().setBpm(90);
    expect(canRedo(st())).toBe(false);
    expect(st().history.past.map((s) => s.bpm)).toEqual([120, 100]);
  });
  it("keeps at most 100 steps", () => {
    for (let i = 0; i < MAX_UNDO + 30; i++) st().setBpm(60 + i);
    expect(st().history.past.length).toBe(MAX_UNDO);
    expect(MAX_UNDO).toBe(100);
    expect(st().history.past[0].bpm).toBe(60 + 29);
  });
  it("jumps several steps at once, stopping at the ends", () => {
    for (const bpm of [70, 80, 90, 100]) st().setBpm(bpm);
    st().jumpHistory(-3);
    expect(song().bpm).toBe(70);
    expect(st().history.future.length).toBe(3);
    st().jumpHistory(2);
    expect(song().bpm).toBe(90);
    st().jumpHistory(-1000);
    expect(song().bpm).toBe(120);
    expect(canUndo(st())).toBe(false);
    st().jumpHistory(1000);
    expect(song().bpm).toBe(100);
    const before = st().history;
    st().jumpHistory(0);
    expect(st().history).toBe(before);
  });
  it("makes a whole drag one step", () => {
    const { verse } = setUp();
    const steps = st().history.past.length;
    const start = song();
    st().dragStart();
    for (const beat of [1, 2, 3]) st().dragUpdate(edits.moveClips(start, [verse], beat, 0));
    expect(st().history.past.length).toBe(steps);
    expect(midiClip(verse).start).toBe(3);
    st().dragEnd();
    expect(st().history.past.length).toBe(steps + 1);
    st().undo();
    expect(song()).toBe(start);
    st().redo();
    expect(midiClip(verse).start).toBe(3);
  });
  it("records nothing for a drag that ends where it began, or never began", () => {
    const { verse } = setUp();
    const steps = st().history.past.length;
    const start = song();
    st().dragStart();
    st().dragUpdate(edits.moveClips(start, [verse], 2, 0));
    st().dragUpdate(start);
    st().dragEnd();
    expect(st().history.past.length).toBe(steps);
    st().dragStart();
    st().dragEnd();
    st().dragEnd();
    expect(st().history.past.length).toBe(steps);
    // An update without a start still makes one step.
    st().dragUpdate(edits.moveClips(start, [verse], 2, 0));
    st().dragEnd();
    expect(st().history.past.length).toBe(steps + 1);
    expect(st().history.past[steps]).toBe(start);
  });
  it("clears what could be redone when a drag ends", () => {
    st().setBpm(100);
    st().undo();
    st().dragStart();
    st().dragUpdate(edits.setBpm(song(), 77));
    st().dragEnd();
    expect(canRedo(st())).toBe(false);
  });
});

describe("the whole song", () => {
  it("changes name, tempo, bar and volume as undo steps", () => {
    st().setName("  My tune ");
    st().setBpm(999);
    st().setBeatsPerBar(3);
    st().setMaster(0.5);
    expect(song()).toMatchObject({ name: "My tune", bpm: 300, beatsPerBar: 3, master: 0.5 });
    expect(st().history.past.length).toBe(4);
    st().setName("");
    expect(st().history.past.length).toBe(4);
  });
  it("changes the loop without an undo step, and keeps it through undo and redo", () => {
    st().setBpm(100);
    st().setLoop({ on: true, start: 4, end: 12 });
    expect(song().loop).toEqual({ on: true, start: 4, end: 12 });
    expect(st().history.past.length).toBe(1);
    st().undo();
    expect(song().bpm).toBe(120);
    expect(song().loop).toEqual({ on: true, start: 4, end: 12 });
    st().redo();
    expect(song()).toMatchObject({ bpm: 100, loop: { on: true, start: 4, end: 12 } });
    st().setLoop({ end: 2 });
    expect(song().loop.end).toBe(4.25);
    const before = st().history;
    st().setLoop({ on: true });
    expect(st().history).toBe(before);
  });
  it("starts a new song as an undo step, clearing what was picked", () => {
    const { verse } = setUp();
    st().markSaved("tune.juradaw");
    st().setCursor(8);
    st().newSong();
    expect(song()).toEqual(newSong());
    expect(st()).toMatchObject({ selectedTrackId: null, editingClipId: null, fileName: null, savedSong: null, cursor: 0 });
    expect(st().selectedClipIds).toBe(EMPTY_IDS);
    st().undo();
    expect(clipOf(st(), verse)).toBeDefined();
  });
  it("loads a song: no undo, nothing picked but its first track", () => {
    setUp();
    const loaded: Song = { ...newSong("Loaded"), tracks: song().tracks.slice(0, 2) };
    const fit = st().fitRequest;
    st().loadSong(loaded, "loaded.juradaw");
    expect(song()).toBe(loaded);
    expect(st().history).toEqual({ past: [], present: loaded, future: [] });
    expect(st()).toMatchObject({ selectedTrackId: loaded.tracks[0].id, editingClipId: null, fileName: "loaded.juradaw", savedSong: loaded });
    expect(st().fitRequest).toBe(fit + 1);
    expect(hasUnsavedChanges(st())).toBe(false);
    st().loadSong(loaded, null);
    expect(st().savedSong).toBeNull();
  });
  it("knows when there are unsaved changes", () => {
    expect(hasUnsavedChanges(st())).toBe(false);
    st().addTrack("instrument");
    expect(hasUnsavedChanges(st())).toBe(true);
    st().markSaved("a.juradaw");
    expect(st().fileName).toBe("a.juradaw");
    expect(hasUnsavedChanges(st())).toBe(false);
    st().setBpm(90);
    expect(hasUnsavedChanges(st())).toBe(true);
    st().undo();
    expect(hasUnsavedChanges(st())).toBe(false);
    st().markSaved();
    expect(st().fileName).toBe("a.juradaw");
  });
});

describe("tracks", () => {
  it("adds a track after the selected one, selects it and returns its id", () => {
    const a = st().addTrack("instrument")!;
    const b = st().addTrack("instrument", "drums")!;
    st().selectTrack(a);
    const c = st().addTrack("audio")!;
    expect(song().tracks.map((t) => t.id)).toEqual([a, c, b]);
    expect(song().tracks.map((t) => [t.name, t.kind, t.instrument])).toEqual([["Piano", "instrument", "piano"], ["Recording 1", "audio", ""], ["Drums", "instrument", "drums"]]);
    expect(st().selectedTrackId).toBe(c);
    expect(selectedTrackOf(st())!.id).toBe(c);
    expect(new Set(song().tracks.map((t) => t.colour)).size).toBe(3);
  });
  it("stops at the most tracks, with a message", () => {
    for (let i = 0; i < MOST_TRACKS; i++) expect(st().addTrack("instrument")).not.toBeNull();
    expect(st().addTrack("instrument")).toBeNull();
    expect(song().tracks.length).toBe(MOST_TRACKS);
    expect(st().toasts[st().toasts.length - 1]).toMatchObject({ kind: "error" });
    const toasts = st().toasts.length;
    st().duplicateTrack(song().tracks[0].id);
    expect(song().tracks.length).toBe(MOST_TRACKS);
    expect(st().toasts.length).toBe(Math.min(4, toasts + 1));
  });
  it("removes a track with its clips, and picks the one below", () => {
    const { piano, drums, voice, verse, take } = setUp();
    st().selectTrack(piano);
    st().selectClips([verse, take]);
    st().editClip(verse);
    st().removeTrack(piano);
    expect(song().tracks.map((t) => t.id)).toEqual([drums, voice]);
    expect(song().clips.map((c) => c.id)).toEqual([take]);
    expect(st().selectedTrackId).toBe(drums);
    expect(st().editingClipId).toBeNull();
    expect(st().selectedClipIds).toEqual([]);
    st().selectTrack(voice);
    st().removeTrack(voice);
    expect(st().selectedTrackId).toBe(drums);
    expect(song().audio).toEqual([]);
    st().removeTrack(drums);
    expect(st().selectedTrackId).toBeNull();
    // Undo brings the track, its clip and its sound back.
    st().undo();
    st().undo();
    expect(song().audio).toEqual([SOUND]);
    expect(clipOf(st(), take)).toBeDefined();
  });
  it("leaves the selection alone when another track is removed", () => {
    const { piano, drums } = setUp();
    st().selectTrack(piano);
    st().removeTrack(drums);
    expect(st().selectedTrackId).toBe(piano);
    st().removeTrack("no-such-track");
    expect(song().tracks.length).toBe(2);
  });
  it("duplicates a track with its clips and selects the copy", () => {
    const { piano } = setUp();
    st().duplicateTrack(piano);
    const copy = song().tracks[1];
    expect(copy.name).toBe("Piano copy");
    expect(st().selectedTrackId).toBe(copy.id);
    expect(clipsOfTrack(st(), copy.id).length).toBe(2);
    st().undo();
    expect(st().selectedTrackId).toBeNull();
  });
  it("updates and moves tracks", () => {
    const { piano, drums } = setUp();
    st().updateTrack(piano, { volume: 0.4, mute: true });
    expect(trackOf(st(), piano)).toMatchObject({ volume: 0.4, mute: true });
    st().updateTrack(piano, { instrument: "organ" });
    expect(trackOf(st(), piano)).toMatchObject({ instrument: "organ", name: "Organ" });
    const steps = st().history.past.length;
    st().updateTrack(piano, { volume: 0.4 });
    expect(st().history.past.length).toBe(steps);
    st().moveTrack(piano, 1);
    expect(song().tracks.map((t) => t.id).slice(0, 2)).toEqual([drums, piano]);
    st().moveTrack(drums, -1);
    expect(st().history.past.length).toBe(steps + 1);
  });
  it("selects only tracks that exist", () => {
    const { piano } = setUp();
    st().selectTrack("nope");
    expect(st().selectedTrackId).toBeNull();
    st().selectTrack(piano);
    expect(st().selectedTrackId).toBe(piano);
    st().selectTrack(null);
    expect(st().selectedTrackId).toBeNull();
  });
});

describe("clips", () => {
  it("adds an empty clip of notes, selected and open in the editor", () => {
    const piano = st().addTrack("instrument")!;
    const id = st().addMidiClip(piano, 8, 4);
    expect(midiClip(id)).toMatchObject({ trackId: piano, start: 8, length: 4, name: "Piano", notes: [] });
    expect(st()).toMatchObject({ selectedClipIds: [id], editingClipId: id, bottomPanel: "editor", selectedTrackId: piano });
    expect(editingClipOf(st())!.id).toBe(id);
  });
  it("won't put notes on an audio track or a sound on an instrument track", () => {
    const { piano, voice } = setUp();
    const steps = st().history.past.length;
    expect(st().addMidiClip(voice, 0, 4)).toBe("");
    expect(st().addMidiClip("nope", 0, 4)).toBe("");
    expect(st().addAudioClip(piano, 0, SOUND)).toBe("");
    expect(st().history.past.length).toBe(steps);
  });
  it("adds a sound as a clip and lists it in the song once", () => {
    const voice = st().addTrack("audio")!;
    const a = st().addAudioClip(voice, 0, SOUND);
    const b = st().addAudioClip(voice, 8, SOUND);
    expect(clipOf(st(), a)).toMatchObject({ kind: "audio", audioId: "sound-1", offset: 0, duration: 4, gain: 1, name: "Guitar" });
    expect(song().audio).toEqual([SOUND]);
    expect(st().selectedClipIds).toEqual([b]);
  });
  it("keeps a recorded take as a new, selected clip", () => {
    const { piano, voice } = setUp();
    st().setBottomPanel("keys");
    st().addTake({ kind: "midi", trackId: piano, start: 8, length: 4, notes: [NOTE, { ...NOTE, pitch: 62, start: 3.5, length: 2 }] });
    const taken = midiClip(st().selectedClipIds[0]);
    expect(taken).toMatchObject({ trackId: piano, start: 8, length: 5.5 });
    expect(taken.notes.map((n) => n.pitch)).toEqual([60, 62]);
    expect(taken.notes.every((n) => n.id.length > 0)).toBe(true);
    expect(st().bottomPanel).toBe("keys");
    const info = { ...SOUND, id: "take-2", name: "Take 2" };
    st().addTake({ kind: "audio", trackId: voice, start: 12, info });
    expect(clipOf(st(), st().selectedClipIds[0])).toMatchObject({ kind: "audio", audioId: "take-2", start: 12, trackId: voice });
    expect(song().audio.map((a) => a.id)).toEqual(["sound-1", "take-2"]);
  });
  it("puts a take that would lie on a clip onto a new track like its own, at the same time", () => {
    const { piano, voice } = setUp();
    st().updateTrack(piano, { volume: 0.5, reverb: 0.4 });
    st().addTake({ kind: "midi", trackId: piano, start: 40, length: 4, notes: [NOTE] });
    const first = st().selectedClipIds[0];
    const tracks = song().tracks.length;
    const steps = st().history.past.length;
    useStore.setState({ toasts: [] });
    // A second take from the same place: one undo step, a new track straight after, the first take untouched.
    st().addTake({ kind: "midi", trackId: piano, start: 40, length: 4, notes: [{ ...NOTE, pitch: 64 }] });
    expect(st().history.past.length).toBe(steps + 1);
    expect(song().tracks.length).toBe(tracks + 1);
    const second = midiClip(st().selectedClipIds[0]);
    const onto = trackOf(st(), second.trackId)!;
    expect(second.start).toBe(40);
    expect(onto.id).not.toBe(piano);
    expect(onto).toMatchObject({ kind: "instrument", instrument: "piano", volume: 0.5, reverb: 0.4 });
    expect(song().tracks.indexOf(onto)).toBe(song().tracks.findIndex((t) => t.id === piano) + 1);
    expect(clipOf(st(), first)!.trackId).toBe(piano);
    expect(st().selectedTrackId).toBe(onto.id);
    expect(st().toasts[0]).toMatchObject({ kind: "info" });
    expect(st().toasts[0].text).toMatch(/new track/);
    // The same for a recording of sound.
    st().addTake({ kind: "audio", trackId: voice, start: 60, info: { ...SOUND, id: "take-a" } });
    st().addTake({ kind: "audio", trackId: voice, start: 61, info: { ...SOUND, id: "take-b" } });
    const b = clipOf(st(), st().selectedClipIds[0])!;
    expect(b.start).toBe(61);
    expect(b.trackId).not.toBe(voice);
    expect(trackOf(st(), b.trackId)!.kind).toBe("audio");
    // A take beside a clip (not on it) stays on its own track.
    st().addTake({ kind: "midi", trackId: piano, start: 44, length: 4, notes: [NOTE] });
    expect(midiClip(st().selectedClipIds[0]).trackId).toBe(piano);
  });
  it("ignores an empty take, and says so when a take has nowhere to go", () => {
    const { piano, voice } = setUp();
    const steps = st().history.past.length;
    st().addTake({ kind: "midi", trackId: piano, start: 0, length: 4, notes: [] });
    st().addTake({ kind: "midi", trackId: voice, start: 0, length: 4, notes: [NOTE] });
    st().addTake({ kind: "audio", trackId: "gone", start: 0, info: SOUND });
    expect(st().history.past.length).toBe(steps);
    expect(st().toasts.filter((t) => t.kind === "error").length).toBe(2);
  });
  it("updates a clip", () => {
    const { verse, piano, drums, voice } = setUp();
    st().updateClip(verse, { start: 16, name: "Intro", trackId: drums });
    expect(midiClip(verse)).toMatchObject({ start: 16, name: "Intro", trackId: drums });
    st().updateClip(verse, { trackId: voice });
    expect(midiClip(verse).trackId).toBe(drums);
    st().updateClip(verse, { trackId: piano, start: -3 });
    expect(midiClip(verse)).toMatchObject({ start: 0, trackId: piano });
  });
  it("moves the selected clips in time and between tracks of their own sort", () => {
    const { verse, chorus, take, drums, voice } = setUp();
    st().selectClips([verse, chorus]);
    st().moveSelectedClips(2, 1);
    expect([midiClip(verse), midiClip(chorus)].map((c) => [c.start, c.trackId])).toEqual([[2, drums], [6, drums]]);
    st().moveSelectedClips(-99, 1);
    // Back to the start; the next track down is audio, so they stay on the drums.
    expect([midiClip(verse), midiClip(chorus)].map((c) => [c.start, c.trackId])).toEqual([[0, drums], [4, drums]]);
    st().selectClips([take]);
    st().moveSelectedClips(0, -1);
    expect(clipOf(st(), take)!.trackId).toBe(voice);
    st().selectClips([]);
    const steps = st().history.past.length;
    st().moveSelectedClips(4, 0);
    expect(st().history.past.length).toBe(steps);
  });
  it("splits a clip, and does nothing outside it", () => {
    const { verse } = setUp();
    const steps = st().history.past.length;
    st().splitClip(verse, 9);
    st().splitClip(verse, 0);
    expect(st().history.past.length).toBe(steps);
    st().splitClip(verse, 1.5);
    expect(st().history.past.length).toBe(steps + 1);
    const parts = clipsOfTrack(st(), midiClip(verse).trackId) as MidiClip[];
    expect(parts.map((c) => [c.start, c.length, c.notes.length])).toEqual([[0, 1.5, 2], [1.5, 2.5, 2], [4, 4, 0]]);
    expect(changeLabel(st().history.past[steps], song())).toBe('Split the clip "Piano"');
  });
  it("joins the selected clips into one, selected", () => {
    const { verse, chorus, take } = setUp();
    st().selectClips([verse, take]);
    st().joinSelectedClips();
    expect(song().clips.length).toBe(3);
    expect(st().toasts.length).toBe(1);
    st().selectClips([chorus, verse]);
    st().joinSelectedClips();
    expect(song().clips.length).toBe(2);
    expect(midiClip(verse)).toMatchObject({ start: 0, length: 8 });
    expect(st().selectedClipIds).toEqual([verse]);
  });
  it("duplicates and repeats the selected clips, selecting the copies", () => {
    const { verse, chorus } = setUp();
    st().selectClips([verse]);
    st().duplicateSelectedClips();
    const copy = st().selectedClipIds;
    expect(copy.length).toBe(1);
    expect(copy[0]).not.toBe(verse);
    expect(midiClip(copy[0])).toMatchObject({ start: 4, length: 4 });
    expect(midiClip(copy[0]).notes.length).toBe(3);
    st().selectClips([chorus]);
    st().repeatSelectedClips(3);
    expect(st().selectedClipIds.map((id) => midiClip(id).start)).toEqual([8, 12, 16]);
    const steps = st().history.past.length;
    st().repeatSelectedClips(0);
    st().selectClips([]);
    st().duplicateSelectedClips();
    expect(st().history.past.length).toBe(steps);
    st().undo();
    expect(st().selectedClipIds).toEqual([]);
  });
  it("removes clips and tidies what was picked", () => {
    const { verse, chorus, take } = setUp();
    st().addNote(verse, NOTE);
    st().editClip(verse);
    st().selectClips([verse, chorus, take]);
    st().removeClips([verse, take]);
    expect(song().clips.map((c) => c.id)).toEqual([chorus]);
    expect(st().selectedClipIds).toEqual([chorus]);
    expect(st().editingClipId).toBeNull();
    expect(st().selectedNoteIds).toBe(EMPTY_IDS);
    expect(song().audio).toEqual([]);
  });
  it("selects only clips that exist, and their track with them", () => {
    const { verse, take, piano, voice } = setUp();
    st().selectTrack(piano);
    st().selectClips([take, "nope", take]);
    expect(st().selectedClipIds).toEqual([take]);
    expect(st().selectedTrackId).toBe(voice);
    // A clip on the selected track is among them: the track stays.
    st().selectClips([verse, take]);
    expect(st().selectedTrackId).toBe(voice);
    const same = st().selectedClipIds;
    st().selectClips([verse, take]);
    expect(st().selectedClipIds).toBe(same);
    st().selectClips([]);
    expect(st().selectedClipIds).toBe(EMPTY_IDS);
    expect(st().selectedTrackId).toBe(voice);
  });
  it("opens a clip of notes in the editor and closes it again", () => {
    const { verse, chorus, take, piano } = setUp();
    st().setBottomPanel("mixer");
    st().editClip(take);
    expect(st().bottomPanel).toBe("mixer");
    st().editClip(verse);
    expect(st()).toMatchObject({ editingClipId: verse, bottomPanel: "editor", selectedClipIds: [verse], selectedTrackId: piano });
    st().selectNotes(midiClip(verse).notes.map((n) => n.id));
    st().editClip(verse);
    expect(st().selectedNoteIds.length).toBe(3);
    st().editClip(chorus);
    expect(st().selectedNoteIds).toBe(EMPTY_IDS);
    st().editClip(null);
    expect(st()).toMatchObject({ editingClipId: null, bottomPanel: null });
    st().setBottomPanel("mixer");
    st().editClip(null);
    expect(st().bottomPanel).toBe("mixer");
  });
});

describe("notes", () => {
  it("adds a note, selected, growing the clip if need be", () => {
    const { verse, chorus } = setUp();
    st().editClip(verse);
    const id = st().addNote(verse, { pitch: 72, start: 3.5, length: 1, velocity: 80 });
    expect(midiClip(verse).notes.find((n) => n.id === id)).toMatchObject({ pitch: 72, start: 3.5 });
    expect(midiClip(verse).length).toBe(8);
    expect(st().selectedNoteIds).toEqual([id]);
    expect(st().addNote("nope", NOTE)).toBe("");
    // A note added to a clip that isn't the one open can't be among the editor's picked notes.
    st().addNote(chorus, NOTE);
    expect(st().selectedNoteIds).toEqual([id]);
  });
  it("updates and removes notes, tidying the picked ones", () => {
    const { verse } = setUp();
    st().editClip(verse);
    const [a, b, c] = midiClip(verse).notes.map((n) => n.id);
    st().selectNotes([a, b, "nope"]);
    expect(st().selectedNoteIds).toEqual([a, b]);
    st().updateNotes(verse, [{ id: a, patch: { pitch: 59 } }]);
    expect(midiClip(verse).notes[0].pitch).toBe(59);
    st().removeNotes(verse, [a, c]);
    expect(midiClip(verse).notes.map((n) => n.id)).toEqual([b]);
    expect(st().selectedNoteIds).toEqual([b]);
    st().undo();
    expect(midiClip(verse).notes.length).toBe(3);
    expect(st().selectedNoteIds).toEqual([b]);
  });
  it("quantises, transposes and sets velocity on the picked notes, or all when none are picked", () => {
    const { verse } = setUp();
    st().editClip(verse);
    const [a, b, c] = midiClip(verse).notes.map((n) => n.id);
    st().updateNotes(verse, [{ id: a, patch: { start: 0.2 } }, { id: b, patch: { start: 1.3 } }, { id: c, patch: { start: 2.2 } }]);
    st().selectNotes([b]);
    st().quantise(0.5);
    expect(midiClip(verse).notes.map((n) => n.start)).toEqual([0.2, 1.5, 2.2]);
    st().transpose(12);
    expect(midiClip(verse).notes.map((n) => n.pitch)).toEqual([60, 76, 67]);
    st().setVelocity(30);
    expect(midiClip(verse).notes.map((n) => n.velocity)).toEqual([100, 30, 100]);
    st().selectNotes([]);
    st().quantise(1);
    expect(midiClip(verse).notes.map((n) => n.start)).toEqual([0, 2, 2]);
    st().transpose(-1);
    expect(midiClip(verse).notes.map((n) => n.pitch)).toEqual([59, 75, 66]);
    st().setVelocity(500);
    expect(midiClip(verse).notes.map((n) => n.velocity)).toEqual([127, 127, 127]);
  });
  it("changes the notes of the selected clips when no clip is open, as one step", () => {
    const { verse, chorus, take } = setUp();
    st().addNote(chorus, { ...NOTE, pitch: 48 });
    st().editClip(null);
    st().selectClips([verse, chorus, take]);
    const steps = st().history.past.length;
    st().transpose(2);
    expect(midiClip(verse).notes.map((n) => n.pitch)).toEqual([62, 66, 69]);
    expect(midiClip(chorus).notes.map((n) => n.pitch)).toEqual([50]);
    expect(st().history.past.length).toBe(steps + 1);
    st().selectClips([]);
    st().transpose(2);
    expect(st().history.past.length).toBe(steps + 1);
  });
});

describe("what's selected", () => {
  it("deletes the picked notes if there are any, else the picked clips", () => {
    const { verse, chorus } = setUp();
    st().editClip(verse);
    const [a] = midiClip(verse).notes.map((n) => n.id);
    st().selectNotes([a]);
    st().removeSelected();
    expect(midiClip(verse).notes.length).toBe(2);
    expect(song().clips.length).toBe(3);
    st().removeSelected();
    expect(clipOf(st(), verse)).toBeUndefined();
    st().removeSelected();
    expect(song().clips.length).toBe(2);
    expect(clipOf(st(), chorus)).toBeDefined();
  });
  it("never deletes notes picked in an editor that's been left", () => {
    const { verse, chorus } = setUp();
    st().editClip(verse);
    st().selectNotes(midiClip(verse).notes.map((n) => n.id));
    // Clicking a clip in the tracks view lets go of the notes: Delete now means that clip.
    st().selectClips([chorus]);
    expect(st().selectedNoteIds).toBe(EMPTY_IDS);
    st().removeSelected();
    expect(midiClip(verse).notes.length).toBe(3);
    expect(clipOf(st(), chorus)).toBeUndefined();
    // So does closing the editor panel.
    st().editClip(verse);
    st().selectNotes(midiClip(verse).notes.map((n) => n.id));
    st().setBottomPanel("mixer");
    expect(st().selectedNoteIds).toBe(EMPTY_IDS);
    expect(st().editingClipId).toBe(verse);
  });
  it("selects all the notes with the editor open, else all the clips", () => {
    const { verse } = setUp();
    st().editClip(null);
    st().selectAll();
    expect(st().selectedClipIds.length).toBe(3);
    st().editClip(verse);
    st().selectAll();
    expect(st().selectedNoteIds.length).toBe(3);
    expect(st().selectedClipIds).toEqual([verse]);
    const same = st().selectedNoteIds;
    st().selectAll();
    expect(st().selectedNoteIds).toBe(same);
  });
  it("copies and pastes clips at the cursor onto the selected track, moving the cursor on", () => {
    const { verse, drums, piano } = setUp();
    st().selectClips([verse]);
    st().copySelected();
    st().selectTrack(drums);
    st().setCursor(8);
    st().paste();
    const pasted = midiClip(st().selectedClipIds[0]);
    expect(pasted).toMatchObject({ trackId: drums, start: 8, length: 4 });
    expect(pasted.notes.length).toBe(3);
    expect(pasted.id).not.toBe(verse);
    expect(st().cursor).toBe(12);
    // Again: straight after, a separate copy.
    st().paste();
    expect(midiClip(st().selectedClipIds[0]).start).toBe(12);
    expect(st().cursor).toBe(16);
    expect(clipsOfTrack(st(), drums).length).toBe(2);
    expect(clipsOfTrack(st(), piano).length).toBe(2);
  });
  it("cuts clips as one step and pastes them back", () => {
    const { take, voice } = setUp();
    st().selectClips([take]);
    const steps = st().history.past.length;
    st().cutSelected();
    expect(st().history.past.length).toBe(steps + 1);
    expect(clipOf(st(), take)).toBeUndefined();
    expect(song().audio).toEqual([]);
    st().cutSelected();
    expect(st().history.past.length).toBe(steps + 1);
    st().selectTrack(voice);
    st().setCursor(4);
    st().paste();
    expect(clipOf(st(), st().selectedClipIds[0])).toMatchObject({ kind: "audio", start: 4, trackId: voice });
    expect(song().audio).toEqual([SOUND]);
    // A second or so of sound at 120 bpm: 4 seconds is 8 beats.
    expect(st().cursor).toBe(12);
  });
  it("copies and pastes notes into the clip being edited", () => {
    const { verse, chorus } = setUp();
    st().editClip(verse);
    const ids = midiClip(verse).notes.map((n) => n.id);
    st().selectNotes(ids.slice(1));
    st().copySelected();
    st().editClip(chorus);
    st().setCursor(5);
    st().paste();
    expect(midiClip(chorus).notes.map((n) => [n.pitch, n.start])).toEqual([[64, 1], [67, 2]]);
    expect(st().selectedNoteIds).toEqual(midiClip(chorus).notes.map((n) => n.id));
    expect(st().cursor).toBe(7);
    // Cut takes them out of the clip.
    st().cutSelected();
    expect(midiClip(chorus).notes).toEqual([]);
    // With no clip open, there's nowhere for notes to go.
    st().editClip(null);
    const steps = st().history.past.length;
    st().paste();
    expect(st().history.past.length).toBe(steps);
    expect(st().toasts[st().toasts.length - 1].text).toMatch(/open a clip/);
  });
});

describe("the library", () => {
  it("puts a drum beat on a new drum track when none is selected", () => {
    st().addFromLibrary("drums-rock");
    expect(song().tracks.map((t) => [t.name, t.instrument])).toEqual([["Drums", "drums"]]);
    const clip = midiClip(st().selectedClipIds[0]);
    expect(clip).toMatchObject({ name: "Rock beat", start: 0, length: 16, trackId: song().tracks[0].id });
    expect(clip.notes.length).toBe(makePattern(findPattern("drums-rock")!).notes.length);
    expect(new Set(clip.notes.map((n) => n.id)).size).toBe(clip.notes.length);
    expect(st().selectedTrackId).toBe(song().tracks[0].id);
    // Track and clip are one undo step.
    expect(st().history.past.length).toBe(1);
    st().undo();
    expect(song()).toEqual(newSong());
  });
  it("uses the selected track when its instrument suits, at the cursor snapped to a bar", () => {
    const { piano, drums, voice } = setUp();
    st().selectTrack(drums);
    st().setCursor(9.2);
    st().addFromLibrary("drums-dance", { bars: 2 });
    expect(midiClip(st().selectedClipIds[0])).toMatchObject({ trackId: drums, start: 8, length: 8, name: "Four on the floor" });
    expect(song().tracks.length).toBe(3);
    // Chords don't go on drums: a new track with the suggested instrument, after the selected one.
    st().addFromLibrary("chords-epic");
    expect(song().tracks.length).toBe(4);
    expect(song().tracks[2]).toMatchObject({ instrument: "pad", name: "Pad" });
    expect(st().selectedTrackId).toBe(song().tracks[2].id);
    // A bass line doesn't go on a piano: it gets a bass track of its own, beside it.
    st().selectTrack(piano);
    st().addFromLibrary("bass-walking", { key: "G" });
    const bass = trackOf(st(), midiClip(st().selectedClipIds[0]).trackId)!;
    expect(bass).toMatchObject({ kind: "instrument", instrument: "bass" });
    expect(song().tracks.indexOf(bass)).toBe(song().tracks.findIndex((t) => t.id === piano) + 1);
    // …and the next bass line goes on that bass track (it's the one selected now), after the first.
    st().addFromLibrary("bass-roots");
    expect(midiClip(st().selectedClipIds[0]).trackId).toBe(bass.id);
    // A drum beat doesn't go on a bass, and nothing goes on an audio track.
    st().addFromLibrary("drums-waltz");
    expect(trackOf(st(), midiClip(st().selectedClipIds[0]).trackId)!.instrument).toBe("drums");
    st().selectTrack(voice);
    st().addFromLibrary("melody-scale");
    expect(trackOf(st(), midiClip(st().selectedClipIds[0]).trackId)).toMatchObject({ kind: "instrument", instrument: "piano" });
  });
  it("never puts a pattern on top of a clip: after it on the selected track, or on a track of its own", () => {
    // The obvious order: a beat, chords, a bass line — three tracks, nothing hidden under anything.
    st().addFromLibrary("drums-rock");
    st().addFromLibrary("chords-pop");
    st().addFromLibrary("bass-roots");
    expect(song().tracks.map((t) => t.instrument)).toEqual(["drums", findPattern("chords-pop")!.instrument, "bass"]);
    for (const t of song().tracks) expect(song().clips.filter((c) => c.trackId === t.id).length).toBe(1);
    // The same beat again with the drums selected: it follows the first, on the bar line, and says so.
    const drums = song().tracks[0].id;
    st().selectTrack(drums);
    useStore.setState({ toasts: [] });
    st().addFromLibrary("drums-rock");
    expect(midiClip(st().selectedClipIds[0])).toMatchObject({ trackId: drums, start: 16 });
    expect(st().toasts[0].text).toMatch(/bar 5/);
    // With another track selected, a pattern finds the track already playing its instrument — if the place is free there…
    st().selectTrack(song().tracks[2].id);
    st().setCursor(32);
    st().addFromLibrary("drums-dance");
    expect(midiClip(st().selectedClipIds[0])).toMatchObject({ trackId: drums, start: 32 });
    // …and gets a new track when it isn't.
    st().selectTrack(song().tracks[2].id);
    st().setCursor(0);
    st().addFromLibrary("drums-dance");
    const onto = trackOf(st(), midiClip(st().selectedClipIds[0]).trackId)!;
    expect(onto.id).not.toBe(drums);
    expect(onto).toMatchObject({ instrument: "drums", name: "Drums 2" });
    // No two clips of a track overlap anywhere.
    for (const t of song().tracks) {
      const mine = song().clips.filter((c) => c.trackId === t.id);
      for (const c of mine) expect(edits.placeIsFree(song(), t.id, c.start, (c as MidiClip).length, [c.id])).toBe(true);
    }
  });
  it("makes the pattern with the options given, cleaned", () => {
    st().addFromLibrary("chords-pop", { key: "G", times: 2, style: "nonsense", low: "no" });
    const clip = midiClip(st().selectedClipIds[0]);
    expect(clip.length).toBe(32);
    expect(clip.notes.slice(0, 3).map((n) => n.pitch % 12).sort((a, b) => a - b)).toEqual([2, 7, 11]);
  });
  it("mentions it when a pattern's bar doesn't fit the song's", () => {
    st().addFromLibrary("drums-waltz", { bars: 2 });
    expect(st().toasts.length).toBe(1);
    expect(st().toasts[0].text).toMatch(/3 beats in a bar/);
    st().loadSong({ ...newSong(), beatsPerBar: 3 }, null);
    useStore.setState({ toasts: [] });
    st().addFromLibrary("drums-waltz");
    expect(st().toasts).toEqual([]);
  });
  it("says so when there's no such pattern or no room for a track", () => {
    st().addFromLibrary("no-such-pattern");
    expect(st().toasts[0].kind).toBe("error");
    expect(song().tracks).toEqual([]);
    for (let i = 0; i < MOST_TRACKS; i++) st().addTrack("audio");
    const steps = st().history.past.length;
    st().addFromLibrary("drums-rock");
    expect(st().history.past.length).toBe(steps);
  });
});

describe("the app", () => {
  it("sets tools, windows, panels, snap and the cursor without undo steps", () => {
    st().setTool("scissors");
    st().openDialog("library");
    st().setBottomPanel("mixer");
    st().setSnap("bar");
    st().setCursor(6.5);
    st().setMetronome(true);
    st().setCountIn(2);
    st().setTheme("dark");
    st().setStorageProblem("Full");
    expect(st()).toMatchObject({ tool: "scissors", dialog: "library", bottomPanel: "mixer", snap: "bar", cursor: 6.5, metronome: true, countIn: 2, theme: "dark", storageProblem: "Full" });
    st().closeDialog();
    expect(st().dialog).toBeNull();
    st().setCursor(-4);
    expect(st().cursor).toBe(0);
    st().setCursor(NaN);
    expect(st().cursor).toBe(0);
    st().setCountIn(9);
    expect(st().countIn).toBe(2);
    st().setCountIn(-1);
    expect(st().countIn).toBe(0);
    expect(canUndo(st())).toBe(false);
    st().setTheme("light");
  });
  it("mirrors the engine, and asks for a fit", () => {
    st().setEngineState({ playing: true, recording: false, countingIn: true });
    expect(st()).toMatchObject({ playing: true, recording: false, countingIn: true });
    const fit = st().fitRequest;
    st().requestFit();
    expect(st().fitRequest).toBe(fit + 1);
  });
  it("doesn't wake anyone when nothing changed", () => {
    let calls = 0;
    const stop = useStore.subscribe(() => calls++);
    st().setTool("select");
    st().closeDialog();
    st().setSnap(0.25);
    st().setCursor(0);
    st().setEngineState({ playing: false, recording: false, countingIn: false });
    st().setStorageProblem(null);
    st().selectTrack(null);
    st().selectClips([]);
    st().selectNotes([]);
    st().dismissToast(999);
    st().setBpm(120);
    st().undo();
    st().redo();
    stop();
    expect(calls).toBe(0);
  });
  it("shows messages with ids of their own, a few at a time", () => {
    st().toast("One");
    st().toast("Two", "success");
    const [one, two] = st().toasts;
    expect(one).toMatchObject({ text: "One", kind: "info" });
    expect(two).toMatchObject({ text: "Two", kind: "success" });
    expect(one.id).not.toBe(two.id);
    st().dismissToast(one.id);
    expect(st().toasts).toEqual([two]);
    for (let i = 0; i < 10; i++) st().toast(`More ${i}`);
    expect(st().toasts.length).toBe(4);
    expect(st().toasts[3].text).toBe("More 9");
    expect(new Set(st().toasts.map((t) => t.id)).size).toBe(4);
  });
});

describe("selectors", () => {
  it("read from the state or from a song", () => {
    const { piano, verse } = setUp();
    expect(songOf(st())).toBe(song());
    expect(songOf(song())).toBe(song());
    expect(trackOf(st(), piano)).toBe(song().tracks[0]);
    expect(trackOf(song(), piano)).toBe(song().tracks[0]);
    expect(trackOf(st(), null)).toBeUndefined();
    expect(clipOf(st(), verse)!.id).toBe(verse);
    expect(clipOf(song(), "nope")).toBeUndefined();
  });
  it("give a track's clips in order, the same array until the song changes", () => {
    const { piano, drums, verse, chorus } = setUp();
    st().updateClip(verse, { start: 20 });
    const first = clipsOfTrack(st(), piano);
    expect(first.map((c) => c.id)).toEqual([chorus, verse]);
    expect(clipsOfTrack(st(), piano)).toBe(first);
    expect(clipsOfTrack(song(), piano)).toBe(first);
    expect(clipsOfTrack(st(), drums)).toBe(EMPTY_CLIPS);
    expect(clipsOfTrack(st(), "nope")).toBe(EMPTY_CLIPS);
    // The cursor moving isn't a change to the song.
    st().setCursor(3);
    expect(clipsOfTrack(st(), piano)).toBe(first);
    st().setBpm(90);
    expect(clipsOfTrack(st(), piano)).not.toBe(first);
    expect(clipsOfTrack(st(), piano)).toEqual(first);
  });
});

describe("found in review", () => {
  it("keeps the undo list in order when something else changes the song in the middle of a drag", () => {
    const piano = st().addTrack("instrument")!;
    const clip = st().addMidiClip(piano, 0, 4);
    const start = song();
    st().dragStart();
    st().dragUpdate(edits.moveClips(start, [clip], 4, 0));
    // A key pressed (or a recording arriving) while the mouse is still down.
    const drums = st().addTrack("instrument", "drums")!;
    st().dragUpdate(edits.moveClips(song(), [clip], 4, 0));
    st().dragEnd();
    expect(midiClip(clip).start).toBe(8);
    // Undo goes back through what happened, latest first: the rest of the drag, the new track, the first part of the drag.
    st().undo();
    expect([midiClip(clip).start, song().tracks.length]).toEqual([4, 2]);
    st().undo();
    expect([midiClip(clip).start, song().tracks.length]).toEqual([4, 1]);
    st().undo();
    expect([midiClip(clip).start, song().tracks.length]).toEqual([0, 1]);
    expect(song()).toBe(start);
    expect(trackOf(st(), drums)).toBeUndefined();
  });
  it("lays repeated pastes of notes end to end, never on top of each other", () => {
    const piano = st().addTrack("instrument")!;
    const clip = st().addMidiClip(piano, 0, 4);
    const a = st().addNote(clip, NOTE);
    const b = st().addNote(clip, { ...NOTE, pitch: 62, start: 1 });
    st().selectNotes([a, b]);
    st().copySelected();
    st().setCursor(2);
    for (let i = 0; i < 4; i++) st().paste();
    const starts = midiClip(clip).notes.map((n) => `${n.pitch}@${n.start}`);
    expect(starts).toEqual(["60@0", "62@1", "60@2", "62@3", "60@4", "62@5", "60@6", "62@7", "60@8", "62@9"]);
    expect(new Set(starts).size).toBe(starts.length);
    expect(st().cursor).toBe(10);
    expect(midiClip(clip).length).toBe(12);
  });
  it("leaves a clip alone once its editor is closed: note actions and Paste go to what can be seen", () => {
    const piano = st().addTrack("instrument")!;
    const a = st().addMidiClip(piano, 0, 4);
    const noteA = st().addNote(a, NOTE);
    const b = st().addMidiClip(piano, 4, 4);
    st().addNote(b, NOTE);
    st().editClip(a);
    st().selectNotes([noteA]);
    st().copySelected();
    st().setBottomPanel(null);
    st().selectClips([b]);
    expect(st().editingClipId).toBe(a);
    // Transpose means the selected clip, not the one remembered from the editor.
    st().transpose(12);
    expect([midiClip(a).notes[0].pitch, midiClip(b).notes[0].pitch]).toEqual([60, 72]);
    st().setVelocity(50);
    expect([midiClip(a).notes[0].velocity, midiClip(b).notes[0].velocity]).toEqual([100, 50]);
    // Notes aren't pasted into a clip that isn't open.
    st().setCursor(5);
    const steps = st().history.past.length;
    st().paste();
    expect(st().history.past.length).toBe(steps);
    expect([midiClip(a).notes.length, midiClip(b).notes.length]).toEqual([1, 1]);
    expect(st().toasts[st().toasts.length - 1].text).toMatch(/open a clip/);
    // The mixer showing is no editor either; with the clip open again, they are.
    st().setBottomPanel("mixer");
    st().paste();
    expect(midiClip(a).notes.length).toBe(1);
    st().editClip(b);
    st().paste();
    expect(midiClip(b).notes.map((n) => n.start)).toEqual([0, 1]);
  });
  it("brings a song back from before New with its file, its saved state and its loop", () => {
    const piano = st().addTrack("instrument")!;
    st().setLoop({ on: true, start: 4, end: 12 });
    st().markSaved("tune.juradaw");
    const saved = song();
    st().newSong();
    expect(st()).toMatchObject({ fileName: null, savedSong: null });
    expect(song().loop).toEqual({ on: false, start: 0, end: 16 });
    st().undo();
    expect(song()).toBe(saved);
    expect(st()).toMatchObject({ fileName: "tune.juradaw", savedSong: saved });
    expect(hasUnsavedChanges(st())).toBe(false);
    expect(song().loop).toEqual({ on: true, start: 4, end: 12 });
    expect(trackOf(st(), piano)).toBeDefined();
    // And forward again: the new song has no file, and its own loop.
    st().redo();
    expect(st()).toMatchObject({ fileName: null, savedSong: null });
    expect(song().loop).toEqual({ on: false, start: 0, end: 16 });
    // The new song saved under its own name keeps that name on its side of the New.
    st().addTrack("audio");
    st().markSaved("other.juradaw");
    st().jumpHistory(-2);
    expect(st().fileName).toBe("tune.juradaw");
    st().jumpHistory(2);
    expect(st().fileName).toBe("other.juradaw");
    expect(hasUnsavedChanges(st())).toBe(false);
    // Ordinary undo and redo, not crossing a New, leave the file alone and carry the loop.
    st().setBpm(90);
    st().setLoop({ on: true });
    st().undo();
    expect(st().fileName).toBe("other.juradaw");
    expect(song().loop.on).toBe(true);
  });
  it("stays quick when thousands of notes are selected and dragged", () => {
    const piano = st().addTrack("instrument")!;
    const clip = st().addMidiClip(piano, 0, 4);
    const many = Array.from({ length: MOST_NOTES }, (_, i) => ({ pitch: 40 + (i % 40), start: i * 0.25, length: 0.25, velocity: 100 }));
    st().commit(edits.addNotes(song(), clip, many)!.song);
    st().editClip(clip);
    st().selectAll();
    expect(st().selectedNoteIds.length).toBe(MOST_NOTES);
    const picked = st().selectedNoteIds;
    const start = song();
    const notes = midiClip(clip).notes;
    const started = Date.now();
    st().dragStart();
    for (let step = 1; step <= 10; step++) st().dragUpdate(edits.updateNotes(start, clip, notes.map((n) => ({ id: n.id, patch: { start: n.start + step * 0.25 } }))));
    st().dragEnd();
    st().transpose(1);
    // The selection was the very same list all through (nothing re-rendered for it).
    expect(st().selectedNoteIds).toBe(picked);
    st().removeSelected();
    // Ten moves of the mouse took over ten seconds, and the transpose and delete two more; now a fraction of one.
    expect(Date.now() - started).toBeLessThan(2500);
    expect(midiClip(clip).notes.length).toBe(0);
    expect(st().selectedNoteIds).toBe(EMPTY_IDS);
  });
  it("says so when a clip or the song is full, instead of losing things later", () => {
    const piano = st().addTrack("instrument")!;
    const clip = st().addMidiClip(piano, 0, 4);
    const many = Array.from({ length: MOST_NOTES }, (_, i) => ({ pitch: 60, start: i * 0.25, length: 0.25, velocity: 100 }));
    st().commit(edits.addNotes(song(), clip, many)!.song);
    const steps = st().history.past.length;
    expect(st().addNote(clip, NOTE)).toBe("");
    expect(st().history.past.length).toBe(steps);
    expect(st().toasts[st().toasts.length - 1]).toMatchObject({ kind: "error" });
    expect(st().toasts[st().toasts.length - 1].text).toMatch(/notes/);
    // A song full of clips: Repeat makes what fits and says why it stopped; a new clip is refused.
    const filler = Array.from({ length: MOST_CLIPS - 2 }, (_, i) => ({ ...edits.makeMidiClip(trackOf(st(), piano)!, i, 1), id: `filler-${i}` }));
    st().loadSong({ ...newSong(), tracks: song().tracks, clips: filler }, null);
    useStore.setState({ toasts: [] });
    st().selectClips(["filler-0"]);
    st().repeatSelectedClips(5);
    expect(song().clips.length).toBe(MOST_CLIPS);
    expect(st().selectedClipIds.length).toBe(2);
    expect(st().toasts.length).toBe(1);
    expect(st().toasts[0].text).toMatch(/clips/);
    expect(st().addMidiClip(piano, 0, 4)).toBe("");
    st().duplicateSelectedClips();
    st().splitClip("filler-0", 0.5);
    expect(song().clips.length).toBe(MOST_CLIPS);
    expect(st().toasts.every((t) => t.kind === "error")).toBe(true);
  });
  it("never puts a time that isn't a number into the song", () => {
    const piano = st().addTrack("instrument")!;
    const id = st().addMidiClip(piano, NaN, NaN);
    expect(midiClip(id)).toMatchObject({ start: 0, length: 4 });
    st().addTake({ kind: "midi", trackId: piano, start: NaN, length: NaN, notes: [NOTE] });
    expect(midiClip(st().selectedClipIds[0])).toMatchObject({ start: 0, length: 1 });
    expect(JSON.stringify(song())).not.toMatch(/null/);
  });
});

describe("changes from Claude (the live link)", () => {
  it("are one undo step each, with a message, and show the track Claude added", () => {
    const piano = st().addTrack("instrument", "piano")!;
    const before = song();
    const bass = { ...before.tracks[0], id: "claude-bass", name: "Bass", instrument: "bass" };
    expect(st().applyClaudeChange(edits.addTrack(before, bass), "Claude: added a track", false)).toBeNull();
    expect(song().tracks.map((t) => t.name)).toEqual(["Piano", "Bass"]);
    expect(st().selectedTrackId).toBe("claude-bass");
    expect(st().toasts[st().toasts.length - 1]).toMatchObject({ text: "Claude: added a track", kind: "info" });
    st().undo();
    expect(song()).toBe(before);
    expect(song().tracks.map((t) => t.id)).toEqual([piano]);
  });

  it("a whole new song lets go of the selection and the file name, and Undo brings both back", () => {
    const piano = st().addTrack("instrument", "piano")!;
    const clip = st().addMidiClip(piano, 0, 4);
    st().markSaved("mine.juradaw");
    const mine = song();
    const fresh = edits.setBpm(newSong("From Claude"), 90);
    expect(st().applyClaudeChange(fresh, 'Claude: started a new song, "From Claude"', true)).toBeNull();
    expect(song().name).toBe("From Claude");
    expect(st().fileName).toBeNull();
    expect(st().selectedClipIds).toEqual([]);
    expect(st().editingClipId).toBeNull();
    st().undo();
    expect(song()).toBe(mine);
    expect(st().fileName).toBe("mine.juradaw");
    expect(edits.findClip(song(), clip)).toBeDefined();
  });

  it("is refused in the middle of a drag", () => {
    st().addTrack("instrument", "piano");
    st().dragStart();
    expect(st().applyClaudeChange(edits.setBpm(song(), 99), "Claude: changed the tempo", false)).toMatch(/dragging/);
    expect(song().bpm).toBe(120);
    st().dragEnd();
  });
});
