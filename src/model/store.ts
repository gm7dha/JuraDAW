/**
 * The app's state: the song (with undo and redo), what's selected, the active
 * tool, open windows and passing messages. Every change to the song goes
 * through `commit`, which records an undo step (up to 100); drags use
 * `dragStart`/`dragUpdate`/`dragEnd` so a whole drag is one step. The changes
 * themselves are the pure functions of edits.ts.
 *
 * A rule for anything that reads this with a selector — `useStore((s) => …)`:
 * the selector must give back the very same value until the state changes.
 * Never build an array or object inside one (no `.filter`, `.map`, `[]` or
 * `{}`), or React re-renders for ever. Read what's already in the state (or
 * use `clipsOfTrack`, which remembers its answers), and use the shared
 * EMPTY_* constants below for "nothing".
 */
import { create } from "zustand";

import { findPattern, makePattern, patternSuitsInstrument } from "../library/patterns";
import { copyClips, copyNotes, notesPastePlace, pasteClips, pasteNotes, type Clipboard } from "./clipboard";
import { DEFAULT_INSTRUMENT, MOST_CLIPS, MOST_NOTES, newSong, newTrack } from "./document";
import * as edits from "./edits";
import { EPS, barIndex, clipEnd, r6, secondsToBeats, snapBeat } from "./time";
import type { State, Toast } from "./storeApi";
import { MOST_TRACKS, type Clip, type MidiClip, type Note, type Song, type Track } from "./types";

export type { BottomPanel, DialogName, History, Snap, State, Toast, Tool } from "./storeApi";

/** How many steps Undo can go back. */
export const MAX_UNDO = 100;
/** The most messages shown at once (older ones make way). */
export const MOST_TOASTS = 4;

/** Shared "nothing" values, so selectors and the state hand out the same empty list every time. */
export const EMPTY_IDS: string[] = [];
export const EMPTY_CLIPS: Clip[] = [];
export const EMPTY_NOTES: Note[] = [];
export const EMPTY_TRACKS: Track[] = [];

const TOO_MANY_TRACKS = `A song can have up to ${MOST_TRACKS} tracks. Remove one you don't need first.`;
const TOO_MANY_CLIPS = `A song can have up to ${MOST_CLIPS.toLocaleString("en-GB")} clips. Join or remove some first.`;
const TOO_MANY_NOTES = `A clip can hold up to ${MOST_NOTES.toLocaleString("en-GB")} notes. Put the rest in another clip.`;

/** The song as it was when a drag began (null when nothing is being dragged). */
let dragBase: Song | null = null;
let toastId = 0;
/** What was last copied or cut (kept only while the page is open). */
let clipboard: Clipboard | null = null;

type Picked = Pick<State, "selectedTrackId" | "selectedClipIds" | "editingClipId" | "selectedNoteIds">;

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** A list of ids as the state keeps it: the list it already has when nothing changed, the shared empty list when empty. */
function idList(next: string[], current: string[]): string[] {
  if (!next.length) return EMPTY_IDS;
  return sameIds(next, current) ? current : next;
}

const clipIdSets = new WeakMap<readonly Clip[], Set<string>>();
const noteIdSets = new WeakMap<readonly Note[], Set<string>>();

/** The ids in a song's clips (or a clip's notes) as a set, made once for each array and remembered — so checking a big selection against a big clip is quick, drag after drag. */
function idsOf<T extends { id: string }>(items: readonly T[], sets: WeakMap<readonly T[], Set<string>>): Set<string> {
  let set = sets.get(items);
  if (!set) {
    set = new Set(items.map((x) => x.id));
    sets.set(items, set);
  }
  return set;
}

/** The ids of `picked` that are in `items`: the very same list when they all are. */
function existing<T extends { id: string }>(picked: string[], items: readonly T[], sets: WeakMap<readonly T[], Set<string>>): string[] {
  if (!picked.length) return EMPTY_IDS;
  const there = idsOf(items, sets);
  return picked.every((id) => there.has(id)) ? picked : idList(picked.filter((id) => there.has(id)), picked);
}

/**
 * What's selected, tidied to fit a song: clips, notes and the track picked that are no longer there are let go (the
 * editor closes its clip if it's gone). Lists that didn't change stay the very same arrays.
 */
function tidied(picked: Picked, song: Song): Picked {
  const selectedTrackId = picked.selectedTrackId && song.tracks.some((t) => t.id === picked.selectedTrackId) ? picked.selectedTrackId : null;
  const selectedClipIds = existing(picked.selectedClipIds, song.clips, clipIdSets);
  const editing = edits.findMidiClip(song, picked.editingClipId);
  const selectedNoteIds = editing ? existing(picked.selectedNoteIds, editing.notes, noteIdSets) : EMPTY_IDS;
  return { selectedTrackId, selectedClipIds, editingClipId: editing ? editing.id : null, selectedNoteIds };
}

/** A song from the undo list brought back with today's loop (the loop isn't part of undo: see `setLoop`). */
function withLoopOf(song: Song, now: Song): Song {
  const a = song.loop;
  const b = now.loop;
  return a.on === b.on && a.start === b.start && a.end === b.end ? song : { ...song, loop: b };
}

/** Which file a song is saved in, and the song as last saved there. */
type FileInfo = Pick<State, "fileName" | "savedSong">;

/**
 * Where New was pressed, by the empty song it made: the file the song before it belonged to, and the file (if any)
 * the new song has been saved to since. Undo and redo across a New put the right one back, so Save after undoing a
 * New goes to the old song's file again.
 */
const newSongs = new WeakMap<Song, { before: FileInfo; after: FileInfo }>();

export const useStore = create<State>()((set, get) => {
  /** The song as it is now. */
  const song = () => get().history.present;

  /** Commit a change and say whether there was one. */
  const change = (next: Song): boolean => {
    if (next === song()) return false;
    get().commit(next);
    return true;
  };

  /** Move to another place in the undo list: `at` counts along [...past, present, future] as it is now. */
  const travel = (at: number) => {
    dragBase = null;
    const { history } = get();
    const all = [...history.past, history.present, ...history.future];
    const here = history.past.length;
    if (at === here || at < 0 || at >= all.length) return;
    // A New between here and there? Then it's another song: it keeps its own loop, and gets its own file back.
    const marks = all.map((s) => newSongs.get(s));
    const crossed = marks.slice(Math.min(at, here) + 1, Math.max(at, here) + 1).some(Boolean);
    const present = crossed ? all[at] : withLoopOf(all[at], history.present);
    let file: FileInfo | null = null;
    if (crossed) {
      const before = marks.slice(0, at + 1).reverse().find(Boolean);
      const after = marks.slice(at + 1).find(Boolean);
      file = before ? before.after : after ? after.before : null;
    }
    set({ history: { past: all.slice(0, at), present, future: all.slice(at + 1) }, ...tidied(get(), present), ...(file ?? {}) });
  };

  /** The clip of notes open in the editor — only while the editor is showing. A clip remembered from before isn't one to act on unseen. */
  const openClip = (): MidiClip | undefined => (get().bottomPanel === "editor" ? edits.findMidiClip(song(), get().editingClipId) : undefined);

  /** The notes an action on "the notes" means: the selected ones in the clip open in the editor, or all of it; with the editor closed, every note of the selected clips. */
  const noteTargets = (): { clipId: string; ids: string[] }[] => {
    const s = get();
    const editing = openClip();
    if (editing) return [{ clipId: editing.id, ids: s.selectedNoteIds.length ? s.selectedNoteIds : editing.notes.map((n) => n.id) }];
    return song()
      .clips.filter((c): c is MidiClip => c.kind === "midi" && s.selectedClipIds.includes(c.id))
      .map((c) => ({ clipId: c.id, ids: c.notes.map((n) => n.id) }));
  };

  /** One change made to each of `noteTargets`, as a single undo step. */
  const changeNotes = (each: (song: Song, clipId: string, ids: string[]) => Song) => {
    let next = song();
    for (const t of noteTargets()) next = each(next, t.clipId, t.ids);
    change(next);
  };

  return {
    history: { past: [], present: newSong(), future: [] },
    selectedTrackId: null,
    selectedClipIds: EMPTY_IDS,
    editingClipId: null,
    selectedNoteIds: EMPTY_IDS,
    tool: "select",
    dialog: null,
    bottomPanel: null,
    snap: 0.25,
    toasts: [],
    theme: "light",
    fileName: null,
    savedSong: null,
    storageProblem: null,
    playing: false,
    recording: false,
    countingIn: false,
    cursor: 0,
    metronome: false,
    countIn: 1,
    fitRequest: 0,

    // ── history ──
    commit(next) {
      if (next === get().history.present) return;
      // Something else changing the song in the middle of a drag (a key pressed, a recording arriving): the drag so
      // far is closed as a step of its own first, so the undo list stays in the order things happened.
      if (dragBase) get().dragEnd();
      const { history } = get();
      set({ history: { past: [...history.past.slice(-(MAX_UNDO - 1)), history.present], present: next, future: [] }, ...tidied(get(), next) });
    },
    undo() {
      travel(get().history.past.length - 1);
    },
    redo() {
      travel(get().history.past.length + 1);
    },
    jumpHistory(offset) {
      const { history } = get();
      const last = history.past.length + history.future.length;
      travel(Math.max(0, Math.min(last, history.past.length + (Number.isFinite(offset) ? Math.round(offset) : 0))));
    },
    dragStart() {
      dragBase = song();
    },
    dragUpdate(next) {
      if (!dragBase) dragBase = song();
      if (next === song()) return;
      set({ history: { ...get().history, present: next }, ...tidied(get(), next) });
    },
    dragEnd() {
      const base = dragBase;
      dragBase = null;
      if (!base) return;
      const { history } = get();
      if (history.present === base) return;
      set({ history: { past: [...history.past.slice(-(MAX_UNDO - 1)), base], present: history.present, future: [] } });
    },

    // ── the whole song ──
    newSong() {
      // An undo step like any other, so a New pressed by mistake can be taken back — with the file it was saved in.
      const fresh = newSong();
      newSongs.set(fresh, { before: { fileName: get().fileName, savedSong: get().savedSong }, after: { fileName: null, savedSong: null } });
      get().commit(fresh);
      set({ selectedTrackId: null, selectedClipIds: EMPTY_IDS, editingClipId: null, selectedNoteIds: EMPTY_IDS, fileName: null, savedSong: null, tool: "select", cursor: 0 });
    },
    loadSong(loaded, fileName) {
      dragBase = null;
      set({
        history: { past: [], present: loaded, future: [] },
        selectedTrackId: loaded.tracks[0]?.id ?? null,
        selectedClipIds: EMPTY_IDS,
        editingClipId: null,
        selectedNoteIds: EMPTY_IDS,
        fileName,
        savedSong: fileName ? loaded : null,
        tool: "select",
        cursor: 0,
        fitRequest: get().fitRequest + 1,
      });
    },
    markSaved(fileName) {
      set({ savedSong: song(), ...(fileName ? { fileName } : {}) });
      // Remembered on whichever side of a New this is, for undo and redo across it.
      const { history } = get();
      const file: FileInfo = { fileName: get().fileName, savedSong: get().savedSong };
      const before = [...history.past, history.present].reverse().find((s) => newSongs.has(s));
      const after = history.future.find((s) => newSongs.has(s));
      if (before) newSongs.get(before)!.after = file;
      else if (after) newSongs.get(after)!.before = file;
    },
    setName(name) {
      change(edits.setSongName(song(), name));
    },
    setBpm(bpm) {
      change(edits.setBpm(song(), bpm));
    },
    setBeatsPerBar(beats) {
      change(edits.setBeatsPerBar(song(), beats));
    },
    setMaster(volume) {
      change(edits.setMaster(song(), volume));
    },
    setLoop(loop) {
      // Not an undo step: the song is swapped where it stands. (Undo and redo carry the loop along: see `withLoopOf`.)
      const next = edits.setLoop(song(), loop);
      if (next !== song()) set({ history: { ...get().history, present: next } });
    },

    // ── tracks ──
    addTrack(kind, instrument) {
      const before = song();
      if (before.tracks.length >= MOST_TRACKS) {
        get().toast(TOO_MANY_TRACKS, "error");
        return null;
      }
      const track = newTrack(kind, kind === "instrument" ? instrument || DEFAULT_INSTRUMENT : "", before.tracks);
      get().commit(edits.addTrack(before, track, get().selectedTrackId));
      set({ selectedTrackId: track.id });
      return track.id;
    },
    removeTrack(id) {
      const before = song();
      const at = before.tracks.findIndex((t) => t.id === id);
      if (at < 0) return;
      // The track below takes its place as the one selected (the one above, when it was the last).
      const neighbour = before.tracks[at + 1] ?? before.tracks[at - 1] ?? null;
      const wasSelected = get().selectedTrackId === id;
      get().commit(edits.removeTrack(before, id));
      if (wasSelected) set({ selectedTrackId: neighbour ? neighbour.id : null });
    },
    duplicateTrack(id) {
      if (song().tracks.length >= MOST_TRACKS) {
        get().toast(TOO_MANY_TRACKS, "error");
        return;
      }
      const made = edits.duplicateTrack(song(), id);
      if (!made) {
        if (edits.findTrack(song(), id)) get().toast(TOO_MANY_CLIPS, "error");
        return;
      }
      get().commit(made.song);
      set({ selectedTrackId: made.id });
    },
    updateTrack(id, patch) {
      change(edits.updateTrack(song(), id, patch));
    },
    moveTrack(id, by) {
      change(edits.moveTrack(song(), id, by));
    },
    selectTrack(id) {
      const next = id && song().tracks.some((t) => t.id === id) ? id : null;
      if (next !== get().selectedTrackId) set({ selectedTrackId: next });
    },

    // ── clips ──
    addMidiClip(trackId, start, length) {
      const track = edits.findTrack(song(), trackId);
      if (!track || track.kind !== "instrument") return "";
      const clip = edits.makeMidiClip(track, start, length);
      if (!change(edits.addClips(song(), [clip]))) {
        get().toast(TOO_MANY_CLIPS, "error");
        return "";
      }
      set({ selectedTrackId: track.id, selectedClipIds: [clip.id], editingClipId: clip.id, selectedNoteIds: EMPTY_IDS, bottomPanel: "editor" });
      return clip.id;
    },
    addAudioClip(trackId, start, info) {
      const track = edits.findTrack(song(), trackId);
      if (!track || track.kind !== "audio") return "";
      const clip = edits.makeAudioClip(track, start, info);
      if (!change(edits.addClips(song(), [clip], [info]))) {
        get().toast(TOO_MANY_CLIPS, "error");
        return "";
      }
      set({ selectedTrackId: track.id, selectedClipIds: [clip.id] });
      return clip.id;
    },
    addTake(take) {
      const track = edits.findTrack(song(), take.trackId);
      const fits = track && (take.kind === "midi") === (track.kind === "instrument");
      if (!track || !fits) {
        get().toast("That recording couldn't be kept: the track it was for has gone.", "error");
        return;
      }
      let clip: Clip;
      if (take.kind === "audio") {
        clip = edits.makeAudioClip(track, take.start, take.info);
      } else {
        const notes = edits.makeNotes(take.notes);
        if (!notes.length) return;
        const last = notes.reduce((max, n) => Math.max(max, n.start + n.length), 0);
        clip = { ...edits.makeMidiClip(track, take.start, Math.max(Number.isFinite(take.length) ? take.length : 0, last)), notes };
      }
      let next = song();
      let onto = track;
      // Never on top of a clip that's already there (it would hide it, and both would play): the take keeps its
      // place in time and goes on a new track like this one instead.
      const length = clip.kind === "midi" ? clip.length : secondsToBeats(clip.duration, next.bpm);
      if (!edits.placeIsFree(next, track.id, clip.start, length) && next.tracks.length < MOST_TRACKS) {
        const fresh = newTrack(track.kind, track.instrument, next.tracks);
        onto = { ...fresh, volume: track.volume, pan: track.pan, reverb: track.reverb, echo: track.echo };
        next = edits.addTrack(next, onto, track.id);
        clip = { ...clip, trackId: onto.id, name: clip.kind === "midi" ? onto.name : clip.name };
      }
      if (!change(edits.addClips(next, [clip], take.kind === "audio" ? [take.info] : []))) {
        get().toast(TOO_MANY_CLIPS, "error");
        return;
      }
      set({ selectedTrackId: onto.id, selectedClipIds: [clip.id] });
      if (onto !== track) get().toast(`There was already a clip there, so this take is on a new track, “${onto.name}”, beside “${track.name}”.`, "info");
    },
    updateClip(id, patch) {
      change(edits.updateClip(song(), id, patch));
    },
    moveSelectedClips(byBeats, byTracks) {
      change(edits.moveClips(song(), get().selectedClipIds, byBeats, byTracks));
    },
    splitClip(id, at) {
      const made = edits.splitClip(song(), id, at);
      if (made) get().commit(made.song);
      else if (song().clips.length >= MOST_CLIPS) get().toast(TOO_MANY_CLIPS, "error");
    },
    joinSelectedClips() {
      const made = edits.joinClips(song(), get().selectedClipIds);
      if (!made) {
        if (edits.canJoin(song(), get().selectedClipIds)) get().toast(TOO_MANY_NOTES, "error");
        else get().toast("To join clips, select two or more clips of notes on the same track.", "info");
        return;
      }
      get().commit(made.song);
      set({ selectedClipIds: [made.id] });
    },
    duplicateSelectedClips() {
      get().repeatSelectedClips(1);
    },
    repeatSelectedClips(times) {
      const picked = get().selectedClipIds.length;
      const asked = Number.isFinite(times) ? Math.min(edits.MOST_REPEATS, Math.round(times)) : 0;
      const made = edits.repeatClips(song(), get().selectedClipIds, times);
      // Fewer copies than asked for (or none) because the song is full: say so rather than quietly doing less.
      if (picked && asked >= 1 && edits.possibleRepeats(song(), picked, times) < asked) get().toast(TOO_MANY_CLIPS, "error");
      if (!made) return;
      get().commit(made.song);
      set({ selectedClipIds: made.ids });
    },
    removeClips(ids) {
      change(edits.removeClips(song(), ids));
    },
    selectClips(ids) {
      const s = get();
      const now = song();
      const there = idsOf(now.clips, clipIdSets);
      const next = idList(
        [...new Set(ids)].filter((id) => there.has(id)),
        s.selectedClipIds,
      );
      // Picking clips picks the track of the first of them too (unless a picked clip is already on the selected track).
      const wanted = new Set(next);
      const picked = now.clips.filter((c) => wanted.has(c.id));
      const selectedTrackId = picked.length && !picked.some((c) => c.trackId === s.selectedTrackId) ? (edits.findClip(now, next[0])?.trackId ?? s.selectedTrackId) : s.selectedTrackId;
      // Picked notes are let go, so Delete and Copy now mean these clips and not notes picked earlier in the editor.
      if (next !== s.selectedClipIds || selectedTrackId !== s.selectedTrackId || s.selectedNoteIds.length) set({ selectedClipIds: next, selectedTrackId, selectedNoteIds: EMPTY_IDS });
    },
    editClip(id) {
      const s = get();
      if (id === null) {
        if (s.editingClipId !== null || s.bottomPanel === "editor") set({ editingClipId: null, selectedNoteIds: EMPTY_IDS, bottomPanel: s.bottomPanel === "editor" ? null : s.bottomPanel });
        return;
      }
      const clip = edits.findMidiClip(song(), id);
      if (!clip) return;
      set({
        editingClipId: clip.id,
        selectedNoteIds: clip.id === s.editingClipId ? s.selectedNoteIds : EMPTY_IDS,
        selectedClipIds: sameIds(s.selectedClipIds, [clip.id]) ? s.selectedClipIds : [clip.id],
        selectedTrackId: clip.trackId,
        bottomPanel: "editor",
      });
    },

    // ── notes ──
    addNote(clipId, note) {
      const made = edits.addNote(song(), clipId, note);
      if (!made) {
        if (edits.clipIsFull(song(), clipId)) get().toast(TOO_MANY_NOTES, "error");
        return "";
      }
      get().commit(made.song);
      if (get().editingClipId === clipId) set({ selectedNoteIds: [made.id] });
      return made.id;
    },
    updateNotes(clipId, patches) {
      change(edits.updateNotes(song(), clipId, patches));
    },
    removeNotes(clipId, ids) {
      change(edits.removeNotes(song(), clipId, ids));
    },
    selectNotes(ids) {
      const s = get();
      const editing = edits.findMidiClip(song(), s.editingClipId);
      const there = editing ? idsOf(editing.notes, noteIdSets) : null;
      const next = idList(there ? [...new Set(ids)].filter((id) => there.has(id)) : [], s.selectedNoteIds);
      if (next !== s.selectedNoteIds) set({ selectedNoteIds: next });
    },
    quantise(grid) {
      changeNotes((s, clipId, ids) => edits.quantiseNotes(s, clipId, ids, grid));
    },
    transpose(semitones) {
      changeNotes((s, clipId, ids) => edits.transposeNotes(s, clipId, ids, semitones));
    },
    setVelocity(velocity) {
      changeNotes((s, clipId, ids) => edits.setNotesVelocity(s, clipId, ids, velocity));
    },

    // ── what's selected ──
    removeSelected() {
      const s = get();
      const open = openClip();
      if (open && s.selectedNoteIds.length) change(edits.removeNotes(song(), open.id, s.selectedNoteIds));
      else if (s.selectedClipIds.length) change(edits.removeClips(song(), s.selectedClipIds));
    },
    selectAll() {
      const s = get();
      const editing = openClip();
      // With the editor open, "all" is all the notes of its clip; otherwise every clip in the song.
      if (editing) set({ selectedNoteIds: idList(editing.notes.map((n) => n.id), s.selectedNoteIds) });
      else set({ selectedClipIds: idList(song().clips.map((c) => c.id), s.selectedClipIds) });
    },
    copySelected() {
      const s = get();
      const open = openClip();
      const copied = open && s.selectedNoteIds.length ? copyNotes(song(), open.id, s.selectedNoteIds) : copyClips(song(), s.selectedClipIds);
      if (copied) clipboard = copied;
    },
    cutSelected() {
      const s = get();
      if (!(openClip() && s.selectedNoteIds.length) && !s.selectedClipIds.length) return;
      get().copySelected();
      get().removeSelected();
    },
    paste() {
      const s = get();
      if (!clipboard) return;
      if (clipboard.kind === "notes") {
        // Only into a clip that's open in the editor, where the notes can be seen arriving.
        const clip = openClip();
        if (!clip) {
          get().toast("To paste notes, open a clip first (double-click it).", "info");
          return;
        }
        const at = notesPastePlace(song(), clip.id, clipboard, s.cursor);
        const made = pasteNotes(song(), clip.id, clipboard, at);
        if (!made) {
          if (edits.clipIsFull(song(), clip.id, clipboard.notes.length)) get().toast(TOO_MANY_NOTES, "error");
          return;
        }
        get().commit(made.song);
        // The cursor moves to the end of what was pasted, so pasting again carries on from there.
        set({ selectedNoteIds: made.ids, cursor: r6(clip.start + at + clipboard.span) });
        return;
      }
      const made = pasteClips(song(), clipboard, s.cursor, s.selectedTrackId);
      if (!made) {
        if (song().clips.length >= MOST_CLIPS) get().toast(TOO_MANY_CLIPS, "error");
        else get().toast("There's no track those clips can go on. Add a track of the same kind first.", "info");
        return;
      }
      get().commit(made.song);
      const pasted = new Set(made.ids);
      const end = made.song.clips.reduce((max, c) => (pasted.has(c.id) ? Math.max(max, clipEnd(c, made.song.bpm)) : max), s.cursor);
      set({ selectedClipIds: made.ids, cursor: r6(end) });
    },

    // ── library ──
    addFromLibrary(id, options) {
      const pattern = findPattern(id);
      if (!pattern) {
        get().toast("That pattern isn't in the library any more.", "error");
        return;
      }
      const made = makePattern(pattern, options ?? {});
      let next = song();
      const wanted = snapBeat(get().cursor, "bar", next.beatsPerBar);
      // Where it goes, never on top of a clip that's already there:
      //  – the selected track, when its instrument suits the pattern (a drum beat on a drum kit, a bass line on a
      //    bass, chords and tunes on anything else) — after whatever is in the way there;
      //  – else a track already playing the pattern's own instrument, if it's free at that place;
      //  – else a new track with the pattern's instrument.
      const selected = edits.findTrack(next, get().selectedTrackId);
      let track: Track | null = selected && selected.kind === "instrument" && patternSuitsInstrument(pattern, selected.instrument) ? selected : null;
      let start = wanted;
      if (track) start = edits.freePlace(next, track.id, wanted, made.length, next.beatsPerBar);
      else track = next.tracks.find((t) => t.kind === "instrument" && t.instrument === pattern.instrument && edits.placeIsFree(next, t.id, wanted, made.length)) ?? null;
      if (!track) {
        if (next.tracks.length >= MOST_TRACKS) {
          get().toast(TOO_MANY_TRACKS, "error");
          return;
        }
        track = newTrack("instrument", pattern.instrument, next.tracks);
        next = edits.addTrack(next, track, get().selectedTrackId);
      }
      const clip: MidiClip = { ...edits.makeMidiClip(track, start, made.length, pattern.name), notes: edits.makeNotes(made.notes) };
      const added = edits.addClips(next, [clip]);
      if (added === next) {
        get().toast(TOO_MANY_CLIPS, "error");
        return;
      }
      get().commit(added);
      set({ selectedTrackId: track.id, selectedClipIds: [clip.id] });
      if (start !== wanted) get().toast(`“${pattern.name}” went in at bar ${barIndex(start, next.beatsPerBar) + 1}, after what was already on “${track.name}”.`, "info");
      if (pattern.beatsPerBar !== next.beatsPerBar && Math.abs(made.length / next.beatsPerBar - Math.round(made.length / next.beatsPerBar)) > EPS)
        get().toast(`"${pattern.name}" is written with ${pattern.beatsPerBar} beats in a bar; this song has ${next.beatsPerBar}. You can change the song's beats in a bar next to the tempo.`, "info");
    },

    // ── app ──
    setTool(tool) {
      if (tool !== get().tool) set({ tool });
    },
    openDialog(dialog) {
      if (dialog !== get().dialog) set({ dialog });
    },
    closeDialog() {
      if (get().dialog !== null) set({ dialog: null });
    },
    setBottomPanel(panel) {
      // Leaving the editor lets go of its picked notes (Delete mustn't remove notes you can no longer see); its clip is remembered.
      if (panel !== get().bottomPanel) set({ bottomPanel: panel, ...(panel === "editor" ? {} : { selectedNoteIds: EMPTY_IDS }) });
    },
    setSnap(snap) {
      if (snap !== get().snap) set({ snap });
    },
    setCursor(beat) {
      const cursor = Number.isFinite(beat) ? Math.max(0, beat) : 0;
      if (cursor !== get().cursor) set({ cursor });
    },
    setMetronome(on) {
      if (on !== get().metronome) set({ metronome: on });
    },
    setCountIn(bars) {
      const countIn = Number.isFinite(bars) ? Math.max(0, Math.min(2, Math.round(bars))) : 0;
      if (countIn !== get().countIn) set({ countIn });
    },
    setEngineState(state) {
      const s = get();
      if (state.playing !== s.playing || state.recording !== s.recording || state.countingIn !== s.countingIn)
        set({ playing: state.playing, recording: state.recording, countingIn: state.countingIn });
    },
    setTheme(theme) {
      if (theme !== get().theme) set({ theme });
    },
    setStorageProblem(problem) {
      if (problem !== get().storageProblem) set({ storageProblem: problem });
    },
    requestFit() {
      set({ fitRequest: get().fitRequest + 1 });
    },
    toast(text, kind = "info") {
      const toast: Toast = { id: ++toastId, text, kind };
      set({ toasts: [...get().toasts, toast].slice(-MOST_TOASTS) });
    },
    dismissToast(id) {
      const { toasts } = get();
      if (toasts.some((t) => t.id === id)) set({ toasts: toasts.filter((t) => t.id !== id) });
    },
  };
});

// ---------------------------------------------------------------------------
// Selectors. Each gives the same value back until the song changes, so all are
// safe inside `useStore(…)`.

/** The song, from the state (or from a song, as it is — so helpers can be handed either). */
export function songOf(from: State | Song): Song {
  return "history" in from ? from.history.present : from;
}

/** A track by its id, from the state or a song. */
export function trackOf(from: State | Song, id: string | null | undefined): Track | undefined {
  return edits.findTrack(songOf(from), id);
}

/** A clip by its id, from the state or a song. */
export function clipOf(from: State | Song, id: string | null | undefined): Clip | undefined {
  return edits.findClip(songOf(from), id);
}

const clipsByTrack = new WeakMap<Song, Map<string, Clip[]>>();

/**
 * A track's clips, earliest first. The answer is remembered for each song, so asking again gives the very same array
 * (safe in a selector); a track with no clips gives EMPTY_CLIPS.
 */
export function clipsOfTrack(from: State | Song, trackId: string): Clip[] {
  const song = songOf(from);
  let byTrack = clipsByTrack.get(song);
  if (!byTrack) {
    byTrack = new Map();
    for (const clip of song.clips) {
      const list = byTrack.get(clip.trackId);
      if (list) list.push(clip);
      else byTrack.set(clip.trackId, [clip]);
    }
    for (const list of byTrack.values()) list.sort((a, b) => a.start - b.start);
    clipsByTrack.set(song, byTrack);
  }
  return byTrack.get(trackId) ?? EMPTY_CLIPS;
}

/** The track that's selected, if any. */
export const selectedTrackOf = (s: State): Track | undefined => edits.findTrack(s.history.present, s.selectedTrackId);
/** The clip of notes open in the editor, if any. */
export const editingClipOf = (s: State): MidiClip | undefined => edits.findMidiClip(s.history.present, s.editingClipId);
export const canUndo = (s: State): boolean => s.history.past.length > 0;
export const canRedo = (s: State): boolean => s.history.future.length > 0;
/** Whether the song has changes not yet saved to a file (an empty song has nothing to save). */
export const hasUnsavedChanges = (s: State): boolean => s.savedSong !== s.history.present && s.history.present.tracks.length > 0;
/** Whether there's something to paste. */
export const canPaste = (): boolean => clipboard !== null;

/** The song, in a component. */
export const useSong = (): Song => useStore((s) => s.history.present);
