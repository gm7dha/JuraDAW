/**
 * Adding the three kinds of track a beginner thinks in — an instrument to
 * play, a drum kit, a track for sound — each opening the panel that's useful
 * next. Used by the welcome cards, the toolbar's Add track menu and the
 * tracks view's "+" row.
 */
import { useStore } from "../model/store";

export type NewTrackKind = "instrument" | "drums" | "audio";

export const NEW_TRACKS: readonly { kind: NewTrackKind; title: string; text: string }[] = [
  { kind: "instrument", title: "Play an instrument", text: "A piano, strings, bass and more. Play them with the on-screen keys, your typing keyboard or a plug-in piano keyboard (MIDI) — or draw the notes in." },
  { kind: "drums", title: "Make a drum beat", text: "A drum kit. Tap the pads, or click a beat into the grid one hit at a time." },
  { kind: "audio", title: "Record sound", text: "Record your voice or an instrument with the microphone, or bring in a sound file." },
];

/** Add a track of a kind, select it and open the panel that goes with it. Returns its id (null if the song is full). */
export function addTrackOf(kind: NewTrackKind): string | null {
  const s = useStore.getState();
  const id = kind === "audio" ? s.addTrack("audio") : s.addTrack("instrument", kind === "drums" ? "drums" : "piano");
  // (When the song is full, the store has already said so.)
  if (!id) return null;
  if (kind === "audio") {
    s.toast("Press Record (R) to record with the microphone, or use Import to bring in a sound file.", "info");
  } else {
    useStore.getState().setBottomPanel("keys");
  }
  return id;
}
