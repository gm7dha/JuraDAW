/**
 * What the Keys panel remembers while the app is open: whether the computer
 * keyboard plays notes ("Musical Typing", off to begin with so V, P, E and C
 * pick tools) and which octave it plays.
 */
import { useSyncExternalStore } from "react";

export interface KeysState {
  /** Letters play notes instead of picking tools. */
  typing: boolean;
  /** The octave of the A key's C (4 = middle C). */
  octave: number;
}

let state: KeysState = { typing: false, octave: 4 };
const listeners = new Set<() => void>();

export function keysState(): KeysState {
  return state;
}

export function setKeysState(patch: Partial<KeysState>): void {
  const octave = Math.max(0, Math.min(7, patch.octave ?? state.octave));
  state = { ...state, ...patch, octave };
  listeners.forEach((l) => l());
}

export function useKeysState(): KeysState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => state,
    () => state,
  );
}

/** The typing keyboard as a piano, as in Logic's Musical Typing: the letter and how many semitones above C it plays. */
export const TYPING_KEYS: readonly { key: string; semitone: number }[] = [
  { key: "a", semitone: 0 },
  { key: "w", semitone: 1 },
  { key: "s", semitone: 2 },
  { key: "e", semitone: 3 },
  { key: "d", semitone: 4 },
  { key: "f", semitone: 5 },
  { key: "t", semitone: 6 },
  { key: "g", semitone: 7 },
  { key: "y", semitone: 8 },
  { key: "h", semitone: 9 },
  { key: "u", semitone: 10 },
  { key: "j", semitone: 11 },
  { key: "k", semitone: 12 },
];

/** The pitch a typed letter plays in an octave, or null if it isn't a playing key. */
export function typedPitch(key: string, octave: number): number | null {
  const found = TYPING_KEYS.find((k) => k.key === key.toLowerCase());
  return found ? (octave + 1) * 12 + found.semitone : null;
}

/** The letter that plays a pitch in an octave ("" if none). */
export function letterFor(pitch: number, octave: number): string {
  const semitone = pitch - (octave + 1) * 12;
  return TYPING_KEYS.find((k) => k.semitone === semitone)?.key.toUpperCase() ?? "";
}
