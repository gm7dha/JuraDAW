/**
 * The step sequencer (pure): a clip seen as a grid — a row for each drum (or each note of the key), a box for each
 * step across. A box is on when a note of that row starts inside it. Clicking boxes adds and takes away short notes,
 * so the clip's notes stay the one truth that the note editor, the sound and Claude all share.
 */
import * as edits from "./edits";
import { pitchInKey } from "./songParts";
import { DRUM_PITCHES, pitchName } from "./time";
import type { MidiClip, Note, Song, SongKey } from "./types";

/** How long a step is, in beats: a sixteenth note, an eighth note or a triplet eighth. */
export const STEP_CHOICES: readonly { step: number; name: string }[] = [
  { step: 0.25, name: "Sixteenths" },
  { step: 0.5, name: "Eighths" },
  { step: 1 / 3, name: "Triplets" },
];

/** How hard a step is played: soft, normal or accented — and the letters a row of steps is written in. */
export const STRENGTHS = { soft: 70, normal: 100, accent: 120 } as const;
export type Strength = keyof typeof STRENGTHS;
const LETTERS: Record<string, number> = { X: STRENGTHS.accent, x: STRENGTHS.normal, o: STRENGTHS.soft, g: 46 };

/** The strength a velocity is shown as. */
export function strengthOf(velocity: number): Strength {
  return velocity >= 112 ? "accent" : velocity <= 84 ? "soft" : "normal";
}

/** The next strength when a box is clicked again with Shift: normal → accent → soft → normal. */
export function nextStrength(s: Strength): Strength {
  return s === "normal" ? "accent" : s === "accent" ? "soft" : "normal";
}

export interface StepRow {
  pitch: number;
  name: string;
}

/**
 * The grid's rows, from the top. On a drum kit, its drums by name. Otherwise the notes of the song's key (C major when
 * none is chosen) over two octaves from the C below middle C, highest first — plus any other pitch the clip holds, so
 * nothing in it is hidden.
 */
export function stepRows(clip: MidiClip, drums: boolean, key: SongKey | undefined): StepRow[] {
  const held = [...new Set(clip.notes.map((n) => n.pitch))];
  if (drums) {
    const extra = held.filter((p) => !DRUM_PITCHES.some((d) => d.pitch === p)).sort((a, b) => b - a);
    return [...DRUM_PITCHES.map((d) => ({ pitch: d.pitch, name: d.name })), ...extra.map((p) => ({ pitch: p, name: pitchName(p) }))];
  }
  const k = key ?? { note: 0, scale: "major" as const };
  const pitches = new Set<number>();
  for (let p = 48; p <= 72; p++) if (pitchInKey(p, k)) pitches.add(p);
  for (const p of held) pitches.add(p);
  return [...pitches].sort((a, b) => b - a).map((p) => ({ pitch: p, name: pitchName(p) }));
}

/** How many steps fit in a clip. */
export function stepCount(clip: MidiClip, step: number): number {
  return Math.max(1, Math.round(clip.length / step - 1e-6));
}

/** The notes of a row that start inside a step's box. */
export function notesInStep(clip: MidiClip, pitch: number, index: number, step: number): Note[] {
  const from = index * step - 1e-6;
  const to = (index + 1) * step - 1e-6;
  return clip.notes.filter((n) => n.pitch === pitch && n.start >= from && n.start < to);
}

/** Turn a box on (a note a step long, at the strength given) or off (every note starting in it). */
export function setStep(song: Song, clipId: string, pitch: number, index: number, step: number, on: boolean, strength: Strength = "normal", length = step): Song {
  const clip = edits.findMidiClip(song, clipId);
  if (!clip) return song;
  const there = notesInStep(clip, pitch, index, step);
  if (!on) return there.length ? edits.removeNotes(song, clipId, there.map((n) => n.id)) : song;
  if (there.length) return song;
  return edits.addNotes(song, clipId, [{ pitch, start: Math.round(index * step * 1e6) / 1e6, length, velocity: STRENGTHS[strength] }])?.song ?? song;
}

/** A box's notes played at another strength. */
export function setStepStrength(song: Song, clipId: string, pitch: number, index: number, step: number, strength: Strength): Song {
  const clip = edits.findMidiClip(song, clipId);
  if (!clip) return song;
  const there = notesInStep(clip, pitch, index, step);
  if (!there.length) return song;
  return edits.updateNotes(song, clipId, there.map((n) => ({ id: n.id, patch: { velocity: STRENGTHS[strength] } })));
}

/**
 * Notes from a row written as letters, one a step — "x...x...X..o..." — as the library writes its drum rows:
 * X accented, x normal, o soft, g a ghost note, "." (or anything else) a rest.
 */
export function stepsToNotes(pitch: number, pattern: string, step: number, length = step): Omit<Note, "id">[] {
  const out: Omit<Note, "id">[] = [];
  [...pattern.replace(/\s+/g, "")].forEach((ch, i) => {
    const velocity = LETTERS[ch];
    if (velocity) out.push({ pitch, start: Math.round(i * step * 1e6) / 1e6, length, velocity });
  });
  return out;
}

/** A row of a clip written as letters (the other way round), for describing it. */
export function rowLetters(clip: MidiClip, pitch: number, step: number): string {
  let out = "";
  for (let i = 0; i < stepCount(clip, step); i++) {
    const there = notesInStep(clip, pitch, i, step);
    out += !there.length ? "." : { accent: "X", normal: "x", soft: "o" }[strengthOf(Math.max(...there.map((n) => n.velocity)))];
  }
  return out;
}
