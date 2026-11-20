/**
 * Copy and paste (pure). What's copied — clips, or notes of one clip — is
 * kept as it was, with times measured from the earliest thing copied, so it
 * can be put down anywhere. Everything pasted gets new ids, so pasting twice
 * gives two separate copies.
 */
import { addClips, addNotes, clipCopy, clipFitsTrack, findMidiClip, findTrack } from "./edits";
import { EPS, clipEnd, r6 } from "./time";
import type { AudioInfo, Clip, Note, Song } from "./types";

/** Copied clips: `start` is beats after the earliest of them, `row` how many tracks below the topmost of them. */
export interface CopiedClips {
  kind: "clips";
  clips: { clip: Clip; start: number; row: number }[];
  /** The sounds the audio clips play, in case the song has let go of them by the time they're pasted. */
  audio: AudioInfo[];
  /** From the start of the earliest to the end of the last, in beats (at the tempo when copied). */
  span: number;
}

/** Copied notes: each `start` is beats after the earliest of them. */
export interface CopiedNotes {
  kind: "notes";
  notes: Omit<Note, "id">[];
  /** Where the earliest note was in its clip (beats from the clip's start). */
  from: number;
  /** From the start of the earliest to the end of the last, in beats. */
  span: number;
}

export type Clipboard = CopiedClips | CopiedNotes;

/** The clips with these ids, ready to paste; null when there are none. */
export function copyClips(song: Song, ids: readonly string[]): CopiedClips | null {
  const wanted = new Set(ids);
  const picked = song.clips.filter((c) => wanted.has(c.id));
  if (!picked.length) return null;
  const rowOf = new Map(song.tracks.map((t, i) => [t.id, i]));
  const rows = picked.map((c) => rowOf.get(c.trackId) ?? 0);
  const top = rows.reduce((min, r) => Math.min(min, r), Infinity);
  const first = picked.reduce((min, c) => Math.min(min, c.start), Infinity);
  const used = new Set(picked.flatMap((c) => (c.kind === "audio" ? [c.audioId] : [])));
  return {
    kind: "clips",
    clips: picked.map((clip, i) => ({ clip, start: r6(clip.start - first), row: rows[i] - top })),
    audio: song.audio.filter((a) => used.has(a.id)),
    span: r6(picked.reduce((max, c) => Math.max(max, clipEnd(c, song.bpm)), 0) - first),
  };
}

/**
 * Copied clips put into the song with the earliest at `at` beats. The topmost copied clip goes onto the track
 * `ontoTrackId` when that track is the right sort for it, and the others keep their places below it; any clip that
 * can't go there (no such track, or the wrong sort) goes back on its own track if that's still there, else onto the
 * first track of its sort. Clips with nowhere to go are left out. The new clips' ids come back; null when none fitted.
 */
export function pasteClips(song: Song, copied: CopiedClips, at: number, ontoTrackId: string | null): { song: Song; ids: string[] } | null {
  const onto = song.tracks.findIndex((t) => t.id === ontoTrackId);
  const lead = copied.clips.find((c) => c.row === 0);
  const useRows = onto >= 0 && !!lead && clipFitsTrack(lead.clip, song.tracks[onto]);
  const made: Clip[] = [];
  for (const { clip, start, row } of copied.clips) {
    const wanted = useRows ? song.tracks[onto + row] : undefined;
    const own = findTrack(song, clip.trackId);
    const track = wanted && clipFitsTrack(clip, wanted) ? wanted : own && clipFitsTrack(clip, own) ? own : song.tracks.find((t) => clipFitsTrack(clip, t));
    if (!track) continue;
    made.push(clipCopy(clip, { trackId: track.id, start: Math.max(0, r6(at + start)) }));
  }
  const next = addClips(song, made, copied.audio);
  if (next === song) return null;
  const there = new Set(next.clips.map((c) => c.id));
  return { song: next, ids: made.map((c) => c.id).filter((id) => there.has(id)) };
}

/** The notes of a clip with these ids, ready to paste; null when there are none. */
export function copyNotes(song: Song, clipId: string, ids: readonly string[]): CopiedNotes | null {
  const wanted = new Set(ids);
  const picked = findMidiClip(song, clipId)?.notes.filter((n) => wanted.has(n.id)) ?? [];
  if (!picked.length) return null;
  const first = picked.reduce((min, n) => Math.min(min, n.start), Infinity);
  return {
    kind: "notes",
    notes: picked.map((n) => ({ pitch: n.pitch, start: r6(n.start - first), length: n.length, velocity: n.velocity })),
    from: first,
    span: r6(picked.reduce((max, n) => Math.max(max, n.start + n.length), 0) - first),
  };
}

/**
 * Where copied notes go when pasted into a clip with the cursor at `cursor` beats in the song: at the cursor when
 * it's inside the clip or right at its end (the clip grows for them — so pasting again and again, with the cursor
 * moved on each time, lays the copies end to end), otherwise straight after where they were copied from. Beats from
 * the clip's start.
 */
export function notesPastePlace(song: Song, clipId: string, copied: CopiedNotes, cursor: number): number {
  const clip = findMidiClip(song, clipId);
  if (!clip) return 0;
  const inside = cursor >= clip.start - EPS && cursor <= clip.start + clip.length + EPS;
  return inside ? Math.max(0, r6(cursor - clip.start)) : r6(copied.from + copied.span);
}

/** Copied notes put into a clip with the earliest `at` beats from the clip's start (the clip grows if they run past its end). */
export function pasteNotes(song: Song, clipId: string, copied: CopiedNotes, at: number): { song: Song; ids: string[] } | null {
  return addNotes(
    song,
    clipId,
    copied.notes.map((n) => ({ ...n, start: r6(Math.max(0, at) + n.start) })),
  );
}
