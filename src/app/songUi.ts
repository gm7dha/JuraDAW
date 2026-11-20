/**
 * Small pure helpers the views share: the snap grid, how positions are
 * written ("3.2", "0:07.5"), and the changed songs that drags hand to the
 * store (a whole drag is one undo step: dragStart, dragUpdate(song)…, dragEnd).
 */
import { newId } from "../model/document";
import type { Snap } from "../model/storeApi";
import { clipLength, snapStep, timeText } from "../model/time";
import { MIN_LENGTH, type Clip, type MidiClip, type Note, type Song, type Track } from "../model/types";

export { snapStep };

/** A new id for something a drag makes (a copied clip). */
export function uid(prefix: string): string {
  return newId(prefix);
}

/** A place moved onto the grid (the nearest line; `down` = the line before it). */
export function snapped(beat: number, snap: Snap, beatsPerBar: number, opts: { free?: boolean; down?: boolean } = {}): number {
  const step = snapStep(snap, beatsPerBar);
  if (!step || opts.free) return beat;
  const n = beat / step;
  return (opts.down ? Math.floor(n + 1e-9) : Math.round(n)) * step;
}

/** The step used for making and nudging notes when snapping is off or set to bars: a sixteenth. */
export function noteStep(snap: Snap): number {
  return snap === "bar" || snap === 0 ? 0.25 : snap;
}

/** The snap choices in plain words: `label` on the toolbar button ("Snap: ¼ beat"), `name` in the menu, `hint` for those who know the note names. */
export const SNAP_CHOICES: readonly { snap: Snap; label: string; name: string; hint: string }[] = [
  { snap: "bar", label: "Bars", name: "Whole bars", hint: "Things line up with the bar lines" },
  { snap: 1, label: "Beats", name: "Beats", hint: "Each beat (1/4 notes)" },
  { snap: 0.5, label: "½ beat", name: "Half beats", hint: "Two to a beat (1/8 notes)" },
  { snap: 0.25, label: "¼ beat", name: "Quarter beats", hint: "Four to a beat (1/16 notes)" },
  { snap: 0.125, label: "⅛ beat", name: "Eighth beats", hint: "Eight to a beat (1/32 notes)" },
  { snap: 0, label: "Off", name: "Off", hint: "Things go exactly where you put them" },
];

export function snapLabel(snap: Snap): string {
  return SNAP_CHOICES.find((c) => c.snap === snap)?.label ?? "Beats";
}

/** A place in the song as bar and beat, counted from 1: beat 5 in 4/4 is bar 2, beat 2. */
export function barBeat(beat: number, beatsPerBar: number): { bar: number; beat: number; text: string } {
  const b = Math.max(0, beat) + 1e-6;
  const bar = Math.floor(b / beatsPerBar) + 1;
  const inBar = Math.floor(b % beatsPerBar) + 1;
  return { bar, beat: inBar, text: `${bar}.${inBar}` };
}

/** Seconds as a clock: 67.52 → "1:07.5". */
export const clockText = timeText;

/**
 * Beats as whole bars and the beats left over, for the side panel's number boxes: 10 beats in 4/4 is 2 bars and
 * 2 beats. The beats are rounded to a thousandth and never show as a whole bar ("1 bar 4 beats" is 2 bars).
 */
export function barsAndBeats(beats: number, beatsPerBar: number): { bars: number; beats: number } {
  const total = Math.max(0, Math.round(beats * 1000) / 1000);
  const bars = Math.floor(total / beatsPerBar + 1e-9);
  return { bars, beats: Math.max(0, Math.round((total - bars * beatsPerBar) * 1000) / 1000) };
}

/** A length in beats said in bars and beats: "2 bars", "1 bar 2 beats", "½ beat". */
export function lengthWords(beats: number, beatsPerBar: number): string {
  const bars = Math.floor(beats / beatsPerBar + 1e-6);
  const rest = Math.round((beats - bars * beatsPerBar) * 100) / 100;
  const parts: string[] = [];
  if (bars) parts.push(`${bars} ${bars === 1 ? "bar" : "bars"}`);
  if (rest || !bars) parts.push(`${rest} ${rest === 1 ? "beat" : "beats"}`);
  return parts.join(" ");
}

/** How long a clip lasts, in beats (an audio clip plays at its own speed, so it depends on the tempo). */
export const clipBeats = clipLength;

/** Where the last clip ends, in beats. */
export function songBeats(song: Song): number {
  let end = 0;
  for (const c of song.clips) end = Math.max(end, c.start + clipBeats(c, song.bpm));
  return end;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ── changed songs for drags ──

/** The song with some clips moved by beats and by rows (kept on tracks of their own kind and at 0 or later); `copies` leaves the originals and moves new copies instead. */
export function withClipsMoved(song: Song, ids: readonly string[], byBeats: number, byRows: number, copies?: ReadonlyMap<string, string>): Song {
  const picked = song.clips.filter((c) => ids.includes(c.id));
  if (!picked.length) return song;
  // Don't let the earliest one go before the start.
  const earliest = Math.min(...picked.map((c) => c.start));
  const beats = Math.max(byBeats, -earliest);
  const rowOf = (id: string) => song.tracks.findIndex((t) => t.id === id);
  const target = (clip: Clip): string => {
    if (!byRows) return clip.trackId;
    const from = rowOf(clip.trackId);
    const to = song.tracks[clamp(from + byRows, 0, song.tracks.length - 1)];
    const want = clip.kind === "midi" ? "instrument" : "audio";
    return to && to.kind === want ? to.id : clip.trackId;
  };
  if (!beats && !byRows && !copies) return song;
  const moved = (c: Clip): Clip => ({ ...c, start: c.start + beats, trackId: target(c) });
  if (copies) {
    const extra = picked.map((c) => {
      const copy = moved(c);
      const id = copies.get(c.id) ?? uid("c");
      return copy.kind === "midi" ? { ...copy, id, notes: copy.notes.map((n) => ({ ...n, id: uid("n") })) } : { ...copy, id };
    });
    return { ...song, clips: [...song.clips, ...extra] };
  }
  return { ...song, clips: song.clips.map((c) => (ids.includes(c.id) ? moved(c) : c)) };
}

/** The song with a clip's end dragged to a new length (beats). */
export function withClipEnd(song: Song, id: string, lengthBeats: number, maxAudioSeconds?: number): Song {
  return {
    ...song,
    clips: song.clips.map((c) => {
      if (c.id !== id) return c;
      if (c.kind === "midi") return { ...c, length: Math.max(MIN_LENGTH, lengthBeats) };
      const seconds = (Math.max(MIN_LENGTH, lengthBeats) * 60) / song.bpm;
      const most = maxAudioSeconds !== undefined ? Math.max(0.05, maxAudioSeconds - c.offset) : seconds;
      return { ...c, duration: clamp(seconds, 0.05, most) };
    }),
  };
}

/** The song with a clip's start dragged by some beats (its end stays where it was; what's inside doesn't move in the song). */
export function withClipStart(song: Song, id: string, byBeats: number): Song {
  return {
    ...song,
    clips: song.clips.map((c) => {
      if (c.id !== id) return c;
      if (c.kind === "midi") {
        const by = clamp(byBeats, -c.start, c.length - MIN_LENGTH);
        if (!by) return c;
        const notes = c.notes.map((n) => ({ ...n, start: n.start - by })).filter((n) => n.start + n.length > 0);
        return { ...c, start: c.start + by, length: c.length - by, notes: notes.map((n) => (n.start < 0 ? { ...n, length: n.length + n.start, start: 0 } : n)) };
      }
      const perBeat = 60 / song.bpm;
      const by = clamp(byBeats, Math.max(-c.start, -c.offset / perBeat), (c.duration - 0.05) / perBeat);
      if (!by) return c;
      return { ...c, start: c.start + by, offset: c.offset + by * perBeat, duration: c.duration - by * perBeat };
    }),
  };
}

/** The song with a midi clip's notes changed (the clip grows if a note runs past its end). */
export function withNotes(song: Song, clipId: string, change: (notes: Note[]) => Note[]): Song {
  return {
    ...song,
    clips: song.clips.map((c) => {
      if (c.id !== clipId || c.kind !== "midi") return c;
      const notes = change(c.notes);
      const end = notes.reduce((m, n) => Math.max(m, n.start + n.length), 0);
      return { ...c, notes, length: Math.max(c.length, end) };
    }),
  };
}

/** The song with one track changed. */
export function withTrack(song: Song, id: string, patch: Partial<Omit<Track, "id" | "kind">>): Song {
  return { ...song, tracks: song.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

export function midiClip(song: Song, id: string | null): MidiClip | null {
  const c = id ? song.clips.find((x) => x.id === id) : undefined;
  return c && c.kind === "midi" ? c : null;
}

/** Where a new clip of `want` beats can go on a track from `start` without running into the next clip there (at least `least` beats). */
export function roomFor(song: Song, trackId: string, start: number, want: number, least: number): number {
  let room = want;
  for (const c of song.clips) {
    if (c.trackId !== trackId || c.start <= start + 1e-6) continue;
    room = Math.min(room, c.start - start);
  }
  return Math.max(least, room);
}

// ── the loop strip ──

/** What a press on the loop strip takes hold of: one of the loop's ends, the whole loop, or nothing (a new loop is drawn). */
export type LoopGrab = "start" | "end" | "move" | "new";

/**
 * What a press at `x` pixels along the ruler takes hold of: within `edge` pixels of an end of the loop, that end
 * (the nearer one on a short loop); inside it, the whole loop; anywhere else a new loop is drawn.
 */
export function loopGrab(x: number, loop: { start: number; end: number }, ppb: number, edge = 8): LoopGrab {
  const a = loop.start * ppb;
  const b = loop.end * ppb;
  const nearStart = Math.abs(x - a) <= edge;
  const nearEnd = Math.abs(x - b) <= edge;
  if (nearStart && nearEnd) return Math.abs(x - a) < Math.abs(x - b) ? "start" : "end";
  if (nearEnd) return "end";
  if (nearStart) return "start";
  return x > a && x < b ? "move" : "new";
}

/**
 * The loop after a drag from `beat0` to `beat`: an end stretched (the other end stays, and they never cross: at
 * least `step` apart), the whole loop slid along (never before the start of the song), or a new one drawn between
 * the two places. Everything lands on lines `step` beats apart (a whole bar, so the loop repeats in time).
 */
export function loopDragged(grab: LoopGrab, loop: { start: number; end: number }, beat0: number, beat: number, step: number): { start: number; end: number } {
  const least = Math.max(step, 1e-3);
  const snap = (v: number, down = false) => (step > 0 ? (down ? Math.floor(v / step + 1e-9) : Math.round(v / step)) * step : v);
  if (grab === "start") return { start: Math.max(0, Math.min(snap(beat), loop.end - least)), end: loop.end };
  if (grab === "end") return { start: loop.start, end: Math.max(snap(beat), loop.start + least) };
  if (grab === "move") {
    const start = Math.max(0, snap(loop.start + (beat - beat0)));
    return { start, end: start + (loop.end - loop.start) };
  }
  const start = Math.max(0, snap(Math.min(beat0, beat), true));
  return { start, end: Math.max(start + least, snap(Math.max(beat0, beat))) };
}

// ── Export ──

/** A file name as typed, without a ".wav" or ".mid" someone added themselves (the right ending is put on for them). */
export function withoutSoundEnding(name: string): string {
  return name.replace(/\.(wav|wave|mid|midi)\s*$/i, "").trim();
}

/** How long a job has left, in words, from how long it has taken so far and how far along it is (0–1). */
export function timeLeftWords(elapsedMs: number, share: number): string {
  if (!(share > 0.03) || elapsedMs < 1500) return "working out how long it will take…";
  const seconds = (elapsedMs * (1 - Math.min(1, share))) / share / 1000;
  if (seconds < 8) return "a few seconds left";
  if (seconds < 50) return `about ${Math.round(seconds / 10) * 10} seconds left`;
  const minutes = Math.round(seconds / 60);
  return minutes <= 1 ? "about a minute left" : `about ${minutes} minutes left`;
}

// ── layout and messages ──

/** The top bar and toolbar above the tracks, in pixels (near enough: it only sets the usual share). */
const ABOVE = 106;

/**
 * The panel's height in a window this tall: what the owner dragged it to, or — until they do — 45% of the room under
 * the toolbar. Either way no less than 240 px (140 when dragged) and no more than 60% of that room, so there's always
 * a good piece of both the tracks and the panel on a small laptop and on a tall screen.
 */
export function panelHeight(windowHeight: number, dragged: number | null): number {
  const room = Math.max(0, windowHeight - ABOVE);
  const most = Math.max(140, room * 0.6);
  if (dragged !== null) return Math.round(Math.max(140, Math.min(most, dragged)));
  return Math.round(Math.max(Math.min(240, most), Math.min(most, room * 0.45)));
}

/**
 * The toasts to show: the newest of each kind (a new "Put … in the song" takes the place of the last one, rather
 * than piling up), and the last two errors.
 */
export function toastsToShow<T extends { kind: "info" | "success" | "error" }>(toasts: readonly T[]): T[] {
  const lastOf = (kind: T["kind"], most: number) => toasts.filter((t) => t.kind === kind).slice(-most);
  const shown = new Set([...lastOf("success", 1), ...lastOf("info", 1), ...lastOf("error", 2)]);
  return toasts.filter((t) => shown.has(t));
}

// ── clips on top of each other ──

/** The ids of clips that lie over an earlier clip of the same track (earlier in the song's list, so drawn underneath). */
export function clipsOverOthers(song: Song): Set<string> {
  const over = new Set<string>();
  const byTrack = new Map<string, { id: string; start: number; end: number }[]>();
  for (const c of song.clips) {
    const end = c.start + clipBeats(c, song.bpm);
    const before = byTrack.get(c.trackId);
    if (!before) {
      byTrack.set(c.trackId, [{ id: c.id, start: c.start, end }]);
      continue;
    }
    if (before.some((b) => b.start < end - 1e-6 && b.end > c.start + 1e-6)) over.add(c.id);
    before.push({ id: c.id, start: c.start, end });
  }
  return over;
}

