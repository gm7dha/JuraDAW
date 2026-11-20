/**
 * The choices that belong to this computer rather than to a song, kept in the
 * browser between visits: the count-in before recording, whether the
 * metronome clicks, and whether MIDI keyboards are connected without asking. (Light or dark is kept by theme.ts.)
 */
import { useStore } from "../model/store";

export const PREFS_KEY = "juradaw.prefs.v1";

export interface Prefs {
  /** Bars counted in before recording: 0, 1 or 2. */
  countIn: number;
  metronome: boolean;
  /** The owner has pressed "Connect a MIDI keyboard" here before, so it's connected again without asking. */
  midi?: boolean;
}

/** Whether MIDI keyboards are to be connected by themselves (kept beside the other choices; not part of the store). */
let midi = false;

/** The choices as kept text. */
export function prefsText(prefs: Prefs): string {
  return JSON.stringify({ countIn: prefs.countIn, metronome: prefs.metronome, ...(prefs.midi ? { midi: true } : {}) });
}

/** The kept choices read back, each one checked: anything missing or odd is left out (so the usual value stays). */
export function readPrefs(text: string | null | undefined): Partial<Prefs> {
  if (!text) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: Partial<Prefs> = {};
  if (o.countIn === 0 || o.countIn === 1 || o.countIn === 2) out.countIn = o.countIn;
  if (typeof o.metronome === "boolean") out.metronome = o.metronome;
  if (o.midi === true) out.midi = true;
  return out;
}

/** Bring the kept choices back (once, from App) and keep them whenever they change. Returns "stop". */
export function startPrefs(): () => void {
  const s = useStore.getState();
  try {
    const kept = readPrefs(localStorage.getItem(PREFS_KEY));
    if (kept.countIn !== undefined) s.setCountIn(kept.countIn);
    if (kept.metronome !== undefined) s.setMetronome(kept.metronome);
    midi = kept.midi === true;
  } catch {
    // Private browsing: the usual choices.
  }
  return useStore.subscribe((state, prev) => {
    if (state.countIn === prev.countIn && state.metronome === prev.metronome) return;
    try {
      localStorage.setItem(PREFS_KEY, prefsText({ countIn: state.countIn, metronome: state.metronome, midi }));
    } catch {
      // Not kept for next time.
    }
  });
}

/** Whether the owner has connected a MIDI keyboard here before (so it's connected again on the first click, without asking). */
export function midiWanted(): boolean {
  return midi;
}

/** Remember (or forget) that MIDI keyboards are to be connected by themselves on this computer. */
export function setMidiWanted(on: boolean): void {
  midi = on;
  const s = useStore.getState();
  try {
    localStorage.setItem(PREFS_KEY, prefsText({ countIn: s.countIn, metronome: s.metronome, midi }));
  } catch {
    // Not kept for next time.
  }
}
