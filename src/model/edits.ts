/**
 * Every change the app makes to a song, as pure functions: a song in, a new
 * song out (the one given is never altered). Tracks, clips and notes that a
 * change doesn't touch stay the very same objects, and a change that does
 * nothing returns the very same song — the undo list and its labels
 * (historyLabel.ts) rely on both.
 *
 * Functions that make something new return it beside the song
 * (`{ song, id }` or `{ song, ids }`), or null when there was nothing to do.
 */
import { MIN_SECONDS, MOST_CLIPS, MOST_NOTES, freeTrackName, newId, nextTrackColour } from "./document";
import { EPS, beatsToSeconds, clipEnd, r6, secondsToBeats } from "./time";
import { MAX_BPM, MIN_BPM, MIN_LENGTH, MOST_TRACKS } from "./types";
import type { AudioClip, AudioInfo, Clip, MidiClip, Note, Song, Track } from "./types";

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The most copies Repeat makes in one go. */
export const MOST_REPEATS = 64;

// ---------------------------------------------------------------------------
// Looking things up.

export function findTrack(song: Song, id: string | null | undefined): Track | undefined {
  return id ? song.tracks.find((t) => t.id === id) : undefined;
}

export function findClip(song: Song, id: string | null | undefined): Clip | undefined {
  return id ? song.clips.find((c) => c.id === id) : undefined;
}

/** A clip of notes by its id (undefined for an audio clip). */
export function findMidiClip(song: Song, id: string | null | undefined): MidiClip | undefined {
  const clip = findClip(song, id);
  return clip && clip.kind === "midi" ? clip : undefined;
}

/** Whether a clip may sit on a track: notes on instrument tracks, sounds on audio tracks. */
export function clipFitsTrack(clip: Pick<Clip, "kind">, track: Pick<Track, "kind">): boolean {
  return (clip.kind === "midi") === (track.kind === "instrument");
}

/** "Piano" → "Piano copy", "Piano copy" → "Piano copy 2". */
export function copyName(name: string): string {
  const m = /^(.*?) copy(?: (\d+))?$/.exec(name);
  if (!m) return `${name} copy`;
  return `${m[1]} copy ${(Number(m[2]) || 1) + 1}`;
}

/** The song without the sounds no clip uses any more. */
function tidyAudio(song: Song): Song {
  if (!song.audio.length) return song;
  const used = new Set(song.clips.flatMap((c) => (c.kind === "audio" ? [c.audioId] : [])));
  return song.audio.every((a) => used.has(a.id)) ? song : { ...song, audio: song.audio.filter((a) => used.has(a.id)) };
}

/** A copy of a clip with new ids (its own and its notes'), changed by `patch`. */
export function clipCopy(clip: Clip, patch: { trackId?: string; start?: number } = {}): Clip {
  const id = newId("c");
  if (clip.kind === "midi") return { ...clip, ...patch, id, notes: clip.notes.map((n) => ({ ...n, id: newId("n") })) };
  return { ...clip, ...patch, id };
}

// ---------------------------------------------------------------------------
// The whole song.

/** The song renamed (blank names are ignored). */
export function setSongName(song: Song, name: string): Song {
  const trimmed = name.trim().slice(0, 200);
  return trimmed && trimmed !== song.name ? { ...song, name: trimmed } : song;
}

/** The tempo, kept between MIN_BPM and MAX_BPM. Notes keep their beats; sounds keep their seconds. */
export function setBpm(song: Song, bpm: number): Song {
  if (!finite(bpm)) return song;
  const next = clamp(Math.round(bpm * 100) / 100, MIN_BPM, MAX_BPM);
  return next === song.bpm ? song : { ...song, bpm: next };
}

/** How many beats in a bar (2–12). */
export function setBeatsPerBar(song: Song, beats: number): Song {
  if (!finite(beats)) return song;
  const next = clamp(Math.round(beats), 2, 12);
  return next === song.beatsPerBar ? song : { ...song, beatsPerBar: next };
}

/** The main volume (0–1). */
export function setMaster(song: Song, volume: number): Song {
  if (!finite(volume)) return song;
  const next = clamp(volume, 0, 1);
  return next === song.master ? song : { ...song, master: next };
}

/** The shortest loop, in beats. */
export const MIN_LOOP = 0.25;

/** The loop changed: it starts at or after the beginning and is never shorter than MIN_LOOP. */
export function setLoop(song: Song, patch: Partial<Song["loop"]>): Song {
  const on = typeof patch.on === "boolean" ? patch.on : song.loop.on;
  const start = Math.max(0, finite(patch.start) ? patch.start : song.loop.start);
  const wanted = finite(patch.end) ? patch.end : song.loop.end;
  const end = wanted - start < MIN_LOOP ? start + MIN_LOOP : wanted;
  if (on === song.loop.on && start === song.loop.start && end === song.loop.end) return song;
  return { ...song, loop: { on, start, end } };
}

// ---------------------------------------------------------------------------
// Tracks.

/** The song with a track put in after the track `afterId` (at the bottom when there's no such track). Unchanged at MOST_TRACKS. */
export function addTrack(song: Song, track: Track, afterId: string | null = null): Song {
  if (song.tracks.length >= MOST_TRACKS || song.tracks.some((t) => t.id === track.id)) return song;
  const at = afterId ? song.tracks.findIndex((t) => t.id === afterId) : -1;
  const tracks = [...song.tracks];
  tracks.splice(at < 0 ? tracks.length : at + 1, 0, track);
  return { ...song, tracks };
}

/** The song without a track and its clips. */
export function removeTrack(song: Song, id: string): Song {
  if (!song.tracks.some((t) => t.id === id)) return song;
  return tidyAudio({ ...song, tracks: song.tracks.filter((t) => t.id !== id), clips: song.clips.filter((c) => c.trackId !== id) });
}

/** A copy of a track ("Piano copy", the next colour, not soloed) with copies of its clips, put straight after it. Null at MOST_TRACKS. */
export function duplicateTrack(song: Song, id: string): { song: Song; id: string } | null {
  const at = song.tracks.findIndex((t) => t.id === id);
  if (at < 0 || song.tracks.length >= MOST_TRACKS) return null;
  if (song.clips.length + song.clips.filter((c) => c.trackId === id).length > MOST_CLIPS) return null;
  const from = song.tracks[at];
  const taken = new Set(song.tracks.map((t) => t.name));
  let name = copyName(from.name);
  while (taken.has(name)) name = copyName(name);
  const copy: Track = { ...from, id: newId("t"), name, colour: nextTrackColour([from]), solo: false };
  const tracks = [...song.tracks];
  tracks.splice(at + 1, 0, copy);
  const clips = song.clips.filter((c) => c.trackId === id).map((c) => clipCopy(c, { trackId: copy.id }));
  return { song: { ...song, tracks, clips: [...song.clips, ...clips] }, id: copy.id };
}

export type TrackPatch = Partial<Omit<Track, "id" | "kind">>;

/**
 * A track's settings changed, each kept inside its limits (blank names and unusable values are ignored; audio
 * tracks have no instrument). A track still wearing its instrument's name ("Piano", "Piano 2") is renamed when its
 * instrument changes, unless the change names it itself.
 */
export function updateTrack(song: Song, id: string, patch: TrackPatch): Song {
  const track = findTrack(song, id);
  if (!track) return song;
  const next: Track = { ...track };
  if (typeof patch.name === "string" && patch.name.trim()) next.name = patch.name.trim().slice(0, 80);
  if (typeof patch.colour === "string" && patch.colour) next.colour = patch.colour;
  if (finite(patch.volume)) next.volume = clamp(patch.volume, 0, 1);
  if (finite(patch.pan)) next.pan = clamp(patch.pan, -1, 1);
  if (typeof patch.mute === "boolean") next.mute = patch.mute;
  if (typeof patch.solo === "boolean") next.solo = patch.solo;
  if (finite(patch.reverb)) next.reverb = clamp(patch.reverb, 0, 1);
  if (finite(patch.echo)) next.echo = clamp(patch.echo, 0, 1);
  if (track.kind === "instrument" && typeof patch.instrument === "string" && patch.instrument && patch.instrument !== track.instrument) {
    next.instrument = patch.instrument;
    const others = song.tracks.filter((t) => t.id !== id);
    if (patch.name === undefined && hasInstrumentName(track)) next.name = freeTrackName("instrument", next.instrument, others);
  }
  const keys = Object.keys(next) as (keyof Track)[];
  if (keys.every((k) => next[k] === track[k])) return song;
  return { ...song, tracks: song.tracks.map((t) => (t === track ? next : t)) };
}

/** Whether a track is still called what `freeTrackName` called it for its instrument ("Piano", "Piano 3"). */
function hasInstrumentName(track: Track): boolean {
  const base = freeTrackName("instrument", track.instrument, []);
  return track.name === base || (track.name.startsWith(`${base} `) && /^\d+$/.test(track.name.slice(base.length + 1)));
}

/** A track moved up (negative) or down the list by a number of places, stopping at the ends. */
export function moveTrack(song: Song, id: string, by: number): Song {
  const from = song.tracks.findIndex((t) => t.id === id);
  if (from < 0 || !finite(by)) return song;
  const to = clamp(from + Math.round(by), 0, song.tracks.length - 1);
  if (to === from) return song;
  const tracks = [...song.tracks];
  const [track] = tracks.splice(from, 1);
  tracks.splice(to, 0, track);
  return { ...song, tracks };
}

// ---------------------------------------------------------------------------
// Clips.

/** A place in the song for a clip to start: not before the beginning, and the beginning when it isn't a number at all. */
const safeStart = (start: number): number => (finite(start) ? Math.max(0, r6(start)) : 0);

/** A new, empty clip of notes for an instrument track (4 beats long when the length given isn't a number). */
export function makeMidiClip(track: Track, start: number, length: number, name = track.name): MidiClip {
  return { id: newId("c"), trackId: track.id, name, start: safeStart(start), kind: "midi", length: finite(length) ? Math.max(MIN_LENGTH, r6(length)) : 4, notes: [] };
}

/** A new clip playing the whole of a sound, for an audio track. */
export function makeAudioClip(track: Track, start: number, info: AudioInfo): AudioClip {
  return { id: newId("c"), trackId: track.id, name: info.name, start: safeStart(start), kind: "audio", audioId: info.id, offset: 0, duration: info.seconds, gain: 1 };
}

/** Notes given ids and made safe (pitch 0–127, velocity 1–127, not before the clip, not shorter than MIN_LENGTH); at most MOST_NOTES of them. */
export function makeNotes(notes: readonly Omit<Note, "id">[]): Note[] {
  return notes
    .filter((n) => finite(n.pitch) && finite(n.start) && finite(n.length))
    .slice(0, MOST_NOTES)
    .map((n) => safeNote({ ...n, id: newId("n") }));
}

/** Whether a stretch of a track has no clip on any part of it (clips in `except` don't count). */
export function placeIsFree(song: Song, trackId: string, start: number, length: number, except: readonly string[] = []): boolean {
  const end = start + length;
  return !song.clips.some((c) => c.trackId === trackId && !except.includes(c.id) && c.start < end - EPS && clipEnd(c, song.bpm) > start + EPS);
}

/**
 * The first place at or after `start` where `length` beats fit on a track without lying over a clip that's already
 * there — `start` itself when that's free, otherwise just after whatever is in the way, moved on to the next line of
 * `step` beats when a step is given (a whole bar, so what's put there stays on the bar lines).
 */
export function freePlace(song: Song, trackId: string, start: number, length: number, step = 0): number {
  const mine = song.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
  let at = Math.max(0, finite(start) ? start : 0);
  // Each clip in the way pushes the place on past its end; a song has a limited number of clips, so this ends.
  for (let moved = true; moved; ) {
    moved = false;
    for (const c of mine) {
      const end = clipEnd(c, song.bpm);
      if (c.start < at + length - EPS && end > at + EPS) {
        at = step > 0 ? r6(Math.ceil(end / step - EPS) * step) : r6(end);
        moved = true;
      }
    }
  }
  return at;
}

/**
 * The song with clips added. A clip is left out when its track isn't there or is the wrong sort for it; an audio
 * clip's sound is listed in the song when `sounds` has it (and the clip is left out when it's listed nowhere). A song
 * holds at most MOST_CLIPS clips: any past that are left out.
 */
export function addClips(song: Song, clips: readonly Clip[], sounds: readonly AudioInfo[] = []): Song {
  let audio = song.audio;
  const added: Clip[] = [];
  const taken = new Set(song.clips.map((c) => c.id));
  for (const clip of clips) {
    if (song.clips.length + added.length >= MOST_CLIPS) break;
    const track = findTrack(song, clip.trackId);
    if (!track || !clipFitsTrack(clip, track) || taken.has(clip.id) || !finite(clip.start)) continue;
    taken.add(clip.id);
    if (clip.kind === "audio" && !audio.some((a) => a.id === clip.audioId)) {
      const info = sounds.find((a) => a.id === clip.audioId);
      if (!info) continue;
      audio = [...audio, info];
    }
    added.push(clip.start >= 0 ? clip : { ...clip, start: 0 });
  }
  if (!added.length) return song;
  return { ...song, clips: [...song.clips, ...added], audio };
}

/** Everything about a clip that may be changed (which fields apply depends on the clip's sort). */
export type ClipPatch = Partial<{ trackId: string; name: string; start: number; length: number; notes: Note[]; offset: number; duration: number; gain: number }>;

/**
 * A clip changed, kept sensible: it starts at or after the beginning, moves only to a track of its own sort, a clip of
 * notes is never shorter than MIN_LENGTH, and an audio clip plays only what its sound holds.
 */
export function updateClip(song: Song, id: string, patch: ClipPatch): Song {
  const clip = findClip(song, id);
  if (!clip) return song;
  const base = { ...clip };
  if (typeof patch.name === "string" && patch.name.trim()) base.name = patch.name.trim().slice(0, 80);
  if (finite(patch.start)) base.start = Math.max(0, patch.start);
  if (typeof patch.trackId === "string" && patch.trackId !== clip.trackId) {
    const track = findTrack(song, patch.trackId);
    if (track && clipFitsTrack(clip, track)) base.trackId = track.id;
  }
  let next: Clip;
  if (base.kind === "midi") {
    if (finite(patch.length)) base.length = Math.max(MIN_LENGTH, patch.length);
    if (Array.isArray(patch.notes)) base.notes = patch.notes;
    next = base;
  } else {
    const seconds = song.audio.find((a) => a.id === base.audioId)?.seconds ?? base.offset + base.duration;
    if (finite(patch.offset)) base.offset = clamp(patch.offset, 0, Math.max(0, seconds - MIN_SECONDS));
    const most = Math.max(MIN_SECONDS, seconds - base.offset);
    base.duration = clamp(finite(patch.duration) ? patch.duration : base.duration, MIN_SECONDS, most);
    if (finite(patch.gain)) base.gain = clamp(patch.gain, 0, 2);
    next = base;
  }
  const a = clip as unknown as Record<string, unknown>;
  const b = next as unknown as Record<string, unknown>;
  if (Object.keys(b).every((k) => a[k] === b[k])) return song;
  return { ...song, clips: song.clips.map((c) => (c === clip ? next : c)) };
}

/**
 * How many tracks up or down a set of clips can really go when asked to move `byTracks`: the nearest number to that
 * (towards staying put) where every clip lands on a track of its own sort.
 */
export function possibleTrackMove(song: Song, clips: readonly Clip[], byTracks: number): number {
  const wanted = finite(byTracks) ? Math.round(byTracks) : 0;
  const rows = new Map(song.tracks.map((t, i) => [t.id, i]));
  const step = wanted > 0 ? -1 : 1;
  for (let by = wanted; by !== 0; by += step) {
    const fits = clips.every((c) => {
      const row = rows.get(c.trackId);
      const to = row === undefined ? undefined : song.tracks[row + by];
      return !!to && clipFitsTrack(c, to);
    });
    if (fits) return by;
  }
  return 0;
}

/**
 * Clips moved together by beats and by a number of tracks. They keep their places relative to each other: the
 * earliest stops at the start of the song, and they only change track when all of them land on tracks of their own sort.
 */
export function moveClips(song: Song, ids: readonly string[], byBeats: number, byTracks: number): Song {
  const wanted = new Set(ids);
  const picked = song.clips.filter((c) => wanted.has(c.id));
  if (!picked.length) return song;
  const earliest = picked.reduce((min, c) => Math.min(min, c.start), Infinity);
  const beats = Math.max(finite(byBeats) ? byBeats : 0, -earliest);
  const rows = possibleTrackMove(song, picked, byTracks);
  if (Math.abs(beats) < EPS && rows === 0) return song;
  const rowOf = new Map(song.tracks.map((t, i) => [t.id, i]));
  return {
    ...song,
    clips: song.clips.map((c) => {
      if (!wanted.has(c.id)) return c;
      const trackId = rows === 0 ? c.trackId : song.tracks[rowOf.get(c.trackId)! + rows].id;
      return { ...c, start: Math.max(0, r6(c.start + beats)), trackId };
    }),
  };
}

/**
 * The notes of a clip as they are heard after its first `cut` beats are taken away: earlier ones dropped, one
 * crossing the cut keeps its tail. A crossing note that starts less than the shortest note (MIN_LENGTH) before the cut
 * can't leave a piece behind (see `notesBefore`), so it's never dropped here: its tail is kept, made MIN_LENGTH long
 * if it's shorter.
 */
function notesAfter(notes: readonly Note[], cut: number, freshIds: boolean): Note[] {
  const out: Note[] = [];
  for (const n of notes) {
    const end = n.start + n.length;
    if (end <= cut + EPS) continue;
    const id = freshIds ? newId("n") : n.id;
    if (n.start >= cut - EPS) out.push({ ...n, id, start: Math.max(0, r6(n.start - cut)) });
    else if (end - cut >= MIN_LENGTH - EPS) out.push({ ...n, id, start: 0, length: r6(end - cut) });
    else if (cut - n.start < MIN_LENGTH - EPS) out.push({ ...n, id, start: 0, length: MIN_LENGTH });
  }
  return out;
}

/**
 * The notes of a clip as they are heard before `cut` beats: later ones dropped, one crossing the cut is cut short
 * there. A note that starts so close to the cut that what's left would be shorter than the shortest note
 * (MIN_LENGTH) is left out — nothing ever sticks out past the cut.
 */
function notesBefore(notes: readonly Note[], cut: number): Note[] {
  const out: Note[] = [];
  for (const n of notes) {
    if (n.start >= cut - EPS) continue;
    if (n.start + n.length <= cut + EPS) out.push(n);
    else if (cut - n.start >= MIN_LENGTH - EPS) out.push({ ...n, length: r6(cut - n.start) });
  }
  return out;
}

/**
 * A clip's start or end dragged to a place in the song (beats). Dragging the end of a clip of notes only changes its
 * length (notes past the end stay, unheard, and come back if it's made longer). Dragging its start keeps the notes
 * where they are in the song; notes left before the new start are taken away. An audio clip shows more or less of
 * its sound, never more than there is.
 */
export function resizeClip(song: Song, id: string, edge: "start" | "end", to: number): Song {
  const clip = findClip(song, id);
  if (!clip || !finite(to)) return song;
  let next: Clip;
  if (clip.kind === "midi") {
    if (edge === "end") next = { ...clip, length: Math.max(MIN_LENGTH, r6(to - clip.start)) };
    else {
      const end = clip.start + clip.length;
      const start = clamp(r6(to), 0, end - MIN_LENGTH);
      const by = start - clip.start;
      const notes = by > EPS ? notesAfter(clip.notes, by, false) : clip.notes.map((n) => ({ ...n, start: r6(n.start - by) }));
      next = { ...clip, start, length: r6(end - start), notes };
    }
    if (next.start === clip.start && (next as MidiClip).length === clip.length) return song;
  } else {
    const seconds = song.audio.find((a) => a.id === clip.audioId)?.seconds ?? clip.offset + clip.duration;
    if (edge === "end") {
      const duration = clamp(beatsToSeconds(to - clip.start, song.bpm), MIN_SECONDS, Math.max(MIN_SECONDS, seconds - clip.offset));
      next = { ...clip, duration };
    } else {
      // Not before the start of the song, not before the start of the sound, not past the clip's end.
      const earliest = -Math.min(clip.offset, beatsToSeconds(clip.start, song.bpm));
      const by = clamp(beatsToSeconds(to - clip.start, song.bpm), earliest, clip.duration - MIN_SECONDS);
      next = { ...clip, start: Math.max(0, r6(clip.start + secondsToBeats(by, song.bpm))), offset: Math.max(0, clip.offset + by), duration: clip.duration - by };
    }
    if (next.start === clip.start && (next as AudioClip).duration === clip.duration) return song;
  }
  return { ...song, clips: song.clips.map((c) => (c === clip ? next : c)) };
}

/**
 * A clip split in two at a place in the song (beats); null when that place isn't inside the clip. The first part
 * keeps the clip's id. Notes are shared out by where they start, and a note crossing the split is cut in two there.
 */
export function splitClip(song: Song, id: string, at: number): { song: Song; id: string } | null {
  const clip = findClip(song, id);
  if (!clip || !finite(at) || song.clips.length >= MOST_CLIPS) return null;
  const end = clipEnd(clip, song.bpm);
  if (at <= clip.start + EPS || at >= end - EPS) return null;
  const cut = at - clip.start;
  let left: Clip;
  let right: Clip;
  if (clip.kind === "midi") {
    if (cut < MIN_LENGTH - EPS || clip.length - cut < MIN_LENGTH - EPS) return null;
    left = { ...clip, length: r6(cut), notes: notesBefore(clip.notes, cut) };
    right = { ...clip, id: newId("c"), start: r6(at), length: r6(clip.length - cut), notes: notesAfter(clip.notes, cut, true) };
  } else {
    const seconds = beatsToSeconds(cut, song.bpm);
    if (seconds < MIN_SECONDS || clip.duration - seconds < MIN_SECONDS) return null;
    left = { ...clip, duration: seconds };
    right = { ...clip, id: newId("c"), start: r6(at), offset: clip.offset + seconds, duration: clip.duration - seconds };
  }
  const clips = song.clips.flatMap((c) => (c === clip ? [left, right] : [c]));
  return { song: { ...song, clips }, id: right.id };
}

/** Whether these clips can be joined: two or more clips of notes, all on one track. */
export function canJoin(song: Song, ids: readonly string[]): boolean {
  const wanted = new Set(ids);
  const picked = song.clips.filter((c) => wanted.has(c.id));
  return picked.length >= 2 && picked.every((c) => c.kind === "midi" && c.trackId === picked[0].trackId);
}

/**
 * Clips of notes on one track joined into one, from the start of the earliest to the end of the last. It sounds the
 * same as before: notes that were past the end of their clip (unheard) are left out. The earliest clip's id and name
 * are kept. Null when they can't be joined (see `canJoin`), or would make a clip of more than MOST_NOTES notes.
 */
export function joinClips(song: Song, ids: readonly string[]): { song: Song; id: string } | null {
  if (!canJoin(song, ids)) return null;
  const wanted = new Set(ids);
  const picked = (song.clips.filter((c) => wanted.has(c.id)) as MidiClip[]).sort((a, b) => a.start - b.start);
  const first = picked[0];
  const end = picked.reduce((max, c) => Math.max(max, c.start + c.length), 0);
  const notes = picked.flatMap((c) => notesBefore(c.notes, c.length).map((n) => (c === first ? n : { ...n, start: r6(n.start + c.start - first.start) })));
  if (notes.length > MOST_NOTES) return null;
  const joined: MidiClip = { ...first, length: r6(end - first.start), notes };
  const clips = song.clips.filter((c) => c === first || !wanted.has(c.id)).map((c) => (c === first ? joined : c));
  return { song: { ...song, clips }, id: joined.id };
}

/** How many whole copies of `picked` clips Repeat can really make when asked for `times`: up to MOST_REPEATS, and no more than the song has room for. */
export function possibleRepeats(song: Song, picked: number, times: number): number {
  const asked = finite(times) ? clamp(Math.round(times), 0, MOST_REPEATS) : 0;
  return picked > 0 ? Math.min(asked, Math.floor((MOST_CLIPS - song.clips.length) / picked)) : 0;
}

/**
 * Clips repeated `times` more times straight after themselves: each copy of the set starts where the one before
 * ended. The new clips' ids come back in order. Null when there's nothing to repeat. A song holds at most MOST_CLIPS
 * clips: when there's room for fewer whole copies than asked for, that many are made (see `possibleRepeats`).
 */
export function repeatClips(song: Song, ids: readonly string[], times: number): { song: Song; ids: string[] } | null {
  const wanted = new Set(ids);
  const picked = song.clips.filter((c) => wanted.has(c.id));
  const count = possibleRepeats(song, picked.length, times);
  if (!picked.length || count < 1) return null;
  const start = picked.reduce((min, c) => Math.min(min, c.start), Infinity);
  const span = picked.reduce((max, c) => Math.max(max, clipEnd(c, song.bpm)), 0) - start;
  const copies: Clip[] = [];
  for (let i = 1; i <= count; i++) for (const c of picked) copies.push(clipCopy(c, { start: r6(c.start + span * i) }));
  return { song: { ...song, clips: [...song.clips, ...copies] }, ids: copies.map((c) => c.id) };
}

/** A copy of each clip straight after the set (the same as repeating once). */
export function duplicateClips(song: Song, ids: readonly string[]): { song: Song; ids: string[] } | null {
  return repeatClips(song, ids, 1);
}

/** The song without these clips (and without sounds nothing uses any more). */
export function removeClips(song: Song, ids: readonly string[]): Song {
  const gone = new Set(ids);
  if (!song.clips.some((c) => gone.has(c.id))) return song;
  return tidyAudio({ ...song, clips: song.clips.filter((c) => !gone.has(c.id)) });
}

// ---------------------------------------------------------------------------
// Notes.

/** A note made safe: a whole pitch 0–127, a whole velocity 1–127, not before its clip's start, not shorter than MIN_LENGTH. */
function safeNote(n: Note): Note {
  return {
    id: n.id,
    pitch: clamp(Math.round(n.pitch), 0, 127),
    start: Math.max(0, r6(n.start)),
    length: Math.max(MIN_LENGTH, r6(n.length)),
    velocity: clamp(Math.round(finite(n.velocity) ? n.velocity : 100), 1, 127),
  };
}

const sameNote = (a: Note, b: Note) => a.pitch === b.pitch && a.start === b.start && a.length === b.length && a.velocity === b.velocity;

/**
 * A clip made long enough for the notes a change added or altered: when one of those runs past the end, the clip
 * grows to the end of that bar. Notes the change didn't touch are never a reason to grow — a clip that was made
 * shorter keeps the notes past its end unheard, whatever is done to its other notes.
 */
function grown(clip: MidiClip, before: readonly Note[], beatsPerBar: number): MidiClip {
  const old = new Set(before);
  let last = 0;
  for (const n of clip.notes) if (!old.has(n)) last = Math.max(last, n.start + n.length);
  if (last <= clip.length + EPS) return clip;
  const bars = Math.ceil((clip.start + last) / beatsPerBar - EPS);
  return { ...clip, length: Math.max(r6(last), r6(bars * beatsPerBar - clip.start)) };
}

/** One clip of notes changed by `change` (which returns the same notes array to change nothing). The clip grows for the changed notes unless `grow` is false. */
function withNotes(song: Song, clipId: string, change: (notes: Note[], clip: MidiClip) => Note[], grow = true): Song {
  const clip = findMidiClip(song, clipId);
  if (!clip) return song;
  const notes = change(clip.notes, clip);
  if (notes === clip.notes) return song;
  const next = grow ? grown({ ...clip, notes }, clip.notes, song.beatsPerBar) : { ...clip, notes };
  return { ...song, clips: song.clips.map((c) => (c === clip ? next : c)) };
}

/** Notes mapped one by one; the same array comes back when none of them changed. */
function mapNotes(notes: Note[], change: (n: Note) => Note): Note[] {
  let changed = false;
  const out = notes.map((n) => {
    const next = change(n);
    if (next === n || sameNote(next, n)) return n;
    changed = true;
    return next;
  });
  return changed ? out : notes;
}

/** A note added to a clip (the clip grows if the note runs past its end). Null when there's no such clip of notes. */
export function addNote(song: Song, clipId: string, note: Omit<Note, "id">): { song: Song; id: string } | null {
  const added = addNotes(song, clipId, [note]);
  return added ? { song: added.song, id: added.ids[0] } : null;
}

/** Whether a clip has no room for `adding` more notes (a clip holds at most MOST_NOTES). */
export function clipIsFull(song: Song, clipId: string, adding = 1): boolean {
  const clip = findMidiClip(song, clipId);
  return !!clip && clip.notes.length + adding > MOST_NOTES;
}

/** Several notes added to a clip at once. Null when there's no such clip of notes, nothing usable to add, or no room for them all (`clipIsFull`). */
export function addNotes(song: Song, clipId: string, notes: readonly Omit<Note, "id">[]): { song: Song; ids: string[] } | null {
  if (!findMidiClip(song, clipId)) return null;
  const made = makeNotes(notes);
  if (!made.length || clipIsFull(song, clipId, made.length)) return null;
  return { song: withNotes(song, clipId, (old) => [...old, ...made]), ids: made.map((n) => n.id) };
}

export type NotePatch = { id: string; patch: Partial<Omit<Note, "id">> };

/** Notes of a clip changed (moved, made longer, louder…), each kept safe; the clip grows if one now runs past its end. */
export function updateNotes(song: Song, clipId: string, patches: readonly NotePatch[]): Song {
  if (!patches.length) return song;
  const byId = new Map(patches.map((p) => [p.id, p.patch]));
  return withNotes(song, clipId, (notes) =>
    mapNotes(notes, (n) => {
      const p = byId.get(n.id);
      if (!p) return n;
      return safeNote({
        id: n.id,
        pitch: finite(p.pitch) ? p.pitch : n.pitch,
        start: finite(p.start) ? p.start : n.start,
        length: finite(p.length) ? p.length : n.length,
        velocity: finite(p.velocity) ? p.velocity : n.velocity,
      });
    }),
  );
}

export function removeNotes(song: Song, clipId: string, ids: readonly string[]): Song {
  const gone = new Set(ids);
  return withNotes(song, clipId, (notes) => (notes.some((n) => gone.has(n.id)) ? notes.filter((n) => !gone.has(n.id)) : notes));
}

/**
 * Notes' starts moved onto the nearest line of a grid (`grid` beats apart, measured from the start of the song, so a
 * clip that starts off the grid still ends up in time with everything else). Lengths are kept, and so is the clip's:
 * a note stays inside its clip, taking the first grid line in the clip when the nearest is before it, and the last
 * one when the nearest is at or past its end. A note with no grid line to go to inside the clip is left where it is.
 */
export function quantiseNotes(song: Song, clipId: string, ids: readonly string[], grid: number): Song {
  if (!finite(grid) || grid <= 0) return song;
  const picked = new Set(ids);
  return withNotes(
    song,
    clipId,
    (notes, clip) =>
      mapNotes(notes, (n) => {
        if (!picked.has(n.id)) return n;
        let line = Math.round((clip.start + n.start) / grid);
        // Kept inside the clip (a note already past the clip's end is unheard, and simply goes to its nearest line).
        if (line * grid < clip.start - 1e-7) line = Math.ceil(clip.start / grid - 1e-7);
        if (n.start < clip.length - EPS) while (line * grid - clip.start >= clip.length - 1e-7 && line * grid - clip.start > n.start) line--;
        const start = r6(line * grid - clip.start);
        if (start < -1e-7 || (n.start < clip.length - EPS && start >= clip.length - 1e-7)) return n;
        return Math.abs(start - n.start) < 1e-7 ? n : { ...n, start: Math.max(0, start) };
      }),
    false,
  );
}

/**
 * Notes moved up or down by semitones. The tune keeps its shape: if any note would go off the keyboard (0–127), they
 * all move only as far as they can.
 */
export function transposeNotes(song: Song, clipId: string, ids: readonly string[], semitones: number): Song {
  if (!finite(semitones) || Math.round(semitones) === 0) return song;
  const wanted = new Set(ids);
  return withNotes(
    song,
    clipId,
    (notes) => {
      let lowest = 127;
      let highest = 0;
      let any = false;
      for (const n of notes) {
        if (!wanted.has(n.id)) continue;
        any = true;
        lowest = Math.min(lowest, n.pitch);
        highest = Math.max(highest, n.pitch);
      }
      if (!any) return notes;
      const by = clamp(Math.round(semitones), -lowest, 127 - highest);
      return by === 0 ? notes : mapNotes(notes, (n) => (wanted.has(n.id) ? { ...n, pitch: n.pitch + by } : n));
    },
    false,
  );
}

/** How hard notes are played, set to one value (1–127). */
export function setNotesVelocity(song: Song, clipId: string, ids: readonly string[], velocity: number): Song {
  if (!finite(velocity)) return song;
  const v = clamp(Math.round(velocity), 1, 127);
  const wanted = new Set(ids);
  return withNotes(song, clipId, (notes) => mapNotes(notes, (n) => (wanted.has(n.id) && n.velocity !== v ? { ...n, velocity: v } : n)), false);
}
