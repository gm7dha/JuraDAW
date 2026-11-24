/**
 * What sounds when (pure, no Web Audio): given a song and a stretch of it in
 * beats, the notes that start there and the sound clips to start, plus the
 * helpers for looping and for knowing where the song ends. Both the live
 * player and the mixdown ask these the same questions.
 */
import { arpNotes, swingDelay, swingsInSixteenths } from "../model/shaping";
import type { Arp, Loop, Song } from "../model/types";
import { MIN_LENGTH } from "../model/types";
import { beatsToSeconds, secondsToBeats } from "./shared";

/** A note to play. `beat` is from the start of the song; `lengthBeats` is already cut at the end of its clip. */
export interface NoteEvent {
  trackId: string;
  pitch: number;
  velocity: number;
  beat: number;
  lengthBeats: number;
  /** The clip the note is in, and how many beats after the clip's start the note begins. */
  clipId: string;
  clipBeat: number;
}

/** A stretch of a sound to start. `beat` is when (from the start of the song); `offset` and `duration` are seconds of the sound. */
export interface AudioEvent {
  trackId: string;
  clipId: string;
  audioId: string;
  beat: number;
  offset: number;
  duration: number;
  gain: number;
}

export interface NotesOptions {
  /** Notes are cut short here and none start at or after it (the end of the loop, or of what's being mixed down). */
  cutAt?: number;
  /** Include muted tracks too (the live player does: the mixer silences them, so un-muting is heard at once). */
  everyTrack?: boolean;
}

export interface AudioClipsOptions extends NotesOptions {
  /** Also list clips that began before `fromBeat` and are still sounding there, starting part-way in. */
  running?: boolean;
}

/** The shortest stretch of sound worth starting, in seconds. */
const SHORTEST_SOUND = 0.001;

/**
 * The ids of the tracks that can be heard: if any track is soloed, only the
 * soloed ones; otherwise every track that isn't muted.
 */
export function audibleTracks(song: Song): Set<string> {
  const anySolo = song.tracks.some((t) => t.solo);
  const ids = new Set<string>();
  for (const track of song.tracks) {
    if (anySolo ? track.solo : !track.mute) ids.add(track.id);
  }
  return ids;
}

/** Which tracks to list things for, by kind. */
function tracksToPlay(song: Song, kind: "instrument" | "audio", everyTrack: boolean | undefined): Set<string> {
  const audible = everyTrack ? null : audibleTracks(song);
  const ids = new Set<string>();
  for (const track of song.tracks) {
    if (track.kind === kind && (!audible || audible.has(track.id))) ids.add(track.id);
  }
  return ids;
}

/**
 * The notes that start at or after `fromBeat` and before `toBeat`, earliest
 * first. Notes are cut at the end of their clip (and at `cutAt`); notes that
 * start outside their clip aren't played; tracks that can't be heard are
 * left out unless `everyTrack` is set.
 */
export function notesBetween(song: Song, fromBeat: number, toBeat: number, options: NotesOptions = {}): NoteEvent[] {
  const cutAt = options.cutAt ?? Infinity;
  const until = Math.min(toBeat, cutAt);
  const tracks = tracksToPlay(song, "instrument", options.everyTrack);
  const arps = new Map(song.tracks.filter((t) => t.arp).map((t) => [t.id, t.arp as Arp]));
  const swings = new Map(song.tracks.filter((t) => (t.swing ?? 0) > 0).map((t) => [t.id, t.swing as number]));
  const events: NoteEvent[] = [];
  for (const clip of song.clips) {
    if (clip.kind !== "midi" || !tracks.has(clip.trackId)) continue;
    const clipEnd = clip.start + clip.length;
    if (clipEnd <= fromBeat || clip.start >= until) continue;
    // On a track with an arpeggiator, held chords become notes one at a time.
    const arp = arps.get(clip.trackId);
    const notes = arp ? arpNotes(clip, arp) : clip.notes;
    // Swing: off-beat notes a little late (in sixteenths when the clip has notes on them, else in eighths).
    const swing = swings.get(clip.trackId) ?? 0;
    const sixteenths = swing > 0 && swingsInSixteenths(notes);
    for (const note of notes) {
      if (note.start < 0 || note.start >= clip.length) continue;
      const written = clip.start + note.start;
      if (written < fromBeat || written >= until) continue;
      const late = swing > 0 ? swingDelay(written, swing, sixteenths) : 0;
      const beat = written + late;
      const lengthBeats = Math.min(note.length, clipEnd - beat, cutAt - beat);
      if (!(lengthBeats > 0)) continue;
      events.push({ trackId: clip.trackId, pitch: note.pitch, velocity: note.velocity, beat, lengthBeats, clipId: clip.id, clipBeat: note.start + late });
    }
  }
  return events.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch);
}

/**
 * The sound clips to start at or after `fromBeat` and before `toBeat`,
 * earliest first. With `running`, clips already under way at `fromBeat` are
 * listed too, starting from the right place inside the sound (Play pressed
 * in the middle of a clip). Sound clips play at their own speed, so their
 * length in beats depends on the tempo.
 */
export function audioClipsBetween(song: Song, fromBeat: number, toBeat: number, options: AudioClipsOptions = {}): AudioEvent[] {
  const cutAt = options.cutAt ?? Infinity;
  const until = Math.min(toBeat, cutAt);
  const tracks = tracksToPlay(song, "audio", options.everyTrack);
  const events: AudioEvent[] = [];
  for (const clip of song.clips) {
    if (clip.kind !== "audio" || !tracks.has(clip.trackId)) continue;
    let beat = clip.start;
    let offset = Math.max(0, clip.offset);
    let duration = clip.duration;
    if (beat < fromBeat) {
      if (!options.running) continue;
      const skipped = beatsToSeconds(fromBeat - beat, song.bpm);
      beat = fromBeat;
      offset += skipped;
      duration -= skipped;
    }
    if (beat >= until) continue;
    if (cutAt !== Infinity) duration = Math.min(duration, beatsToSeconds(cutAt - beat, song.bpm));
    if (!(duration >= SHORTEST_SOUND)) continue;
    events.push({ trackId: clip.trackId, clipId: clip.id, audioId: clip.audioId, beat, offset, duration, gain: clip.gain });
  }
  return events.sort((a, b) => a.beat - b.beat);
}

/** Where the last clip ends, in beats (0 for an empty song). Sound clips are measured at the song's tempo. */
export function songLengthBeats(song: Song): number {
  let end = 0;
  for (const clip of song.clips) {
    const clipEnd = clip.kind === "midi" ? clip.start + clip.length : clip.start + secondsToBeats(clip.duration, song.bpm);
    if (clipEnd > end) end = clipEnd;
  }
  return end;
}

/** The start of the bar a beat is in. */
export function barStart(beat: number, beatsPerBar: number): number {
  return Math.floor(beat / beatsPerBar) * beatsPerBar;
}

/** The next bar line at or after a beat. */
export function barEnd(beat: number, beatsPerBar: number): number {
  return Math.ceil(beat / beatsPerBar) * beatsPerBar;
}

/**
 * Where playing stops by itself when it isn't looping: one bar after the bar
 * the song ends in. Null for an empty song, which plays until stopped (so
 * you can play along to the metronome).
 */
export function playEndBeat(song: Song): number | null {
  const length = songLengthBeats(song);
  if (length <= 0) return null;
  return barEnd(length, song.beatsPerBar) + song.beatsPerBar;
}

/** True if the loop is switched on and long enough to go round. */
export function loopIsUsable(loop: Loop): boolean {
  return loop.on && loop.end - loop.start >= MIN_LENGTH;
}

/** One stretch of the song to schedule, and where to carry on afterwards. */
export interface LoopWindow {
  from: number;
  /** The stretch ends here (never past the end of the loop). */
  to: number;
  /** Where the next stretch starts: `to`, or the start of the loop after a wrap. */
  next: number;
  /** True if this stretch reached the end of the loop, so playing jumps back. */
  wrapped: boolean;
}

/**
 * The next stretch to schedule, `spanBeats` long at most, stopping at the end
 * of the loop when it's on. Call again from `next` for the rest of the span.
 * Playing that starts after the loop's end just carries on.
 */
export function nextLoopWindow(loop: Loop, fromBeat: number, spanBeats: number): LoopWindow {
  const straight = fromBeat + Math.max(0, spanBeats);
  if (!loopIsUsable(loop) || fromBeat >= loop.end || straight < loop.end) {
    return { from: fromBeat, to: straight, next: straight, wrapped: false };
  }
  return { from: fromBeat, to: loop.end, next: loop.start, wrapped: true };
}
