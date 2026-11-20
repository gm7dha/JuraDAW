/**
 * Turning what was played during a recording into a take (pure): the notes'
 * places are worked out from where the playhead was when each key went down
 * and came up.
 */
import { MIN_LENGTH } from "../model/types";
import type { RecordedTake } from "./engineApi";
import { barEnd, barStart } from "./schedule";
import { clamp } from "./shared";

/** A note as it was played: where it started and ended, in beats from the start of the song. */
export interface PlayedNote {
  pitch: number;
  velocity: number;
  start: number;
  end: number;
}

/**
 * The take for a recording of notes that began at `fromBeat`: it starts on
 * the bar line at or before `fromBeat`, and is a whole number of bars long
 * (at least one). Null if nothing was played.
 */
export function buildMidiTake(trackId: string, fromBeat: number, beatsPerBar: number, played: PlayedNote[]): RecordedTake | null {
  if (played.length === 0) return null;
  const start = barStart(Math.max(0, fromBeat), beatsPerBar);
  let lastEnd = start;
  const notes = played
    .map((note) => {
      const noteStart = Math.max(0, note.start - start);
      const length = Math.max(MIN_LENGTH, note.end - note.start);
      lastEnd = Math.max(lastEnd, start + noteStart + length);
      return { pitch: clamp(Math.round(note.pitch), 0, 127), start: noteStart, length, velocity: clamp(Math.round(note.velocity), 1, 127) };
    })
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  // A hair is taken off so a note ending exactly on a bar line doesn't add an empty bar.
  const length = Math.max(beatsPerBar, barEnd(lastEnd - start - 1e-6, beatsPerBar));
  return { kind: "midi", trackId, start, length, notes };
}
