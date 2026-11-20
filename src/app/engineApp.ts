/**
 * The glue between the song (the store) and the sound engine. Apart from the
 * meters and playheads, which read the engine every frame, this is the only
 * place the app talks to the engine: it hands it the song whenever it
 * changes, mirrors "playing / recording" back into the store, and holds the
 * transport's actions (play, record, go to start) and the notes played live
 * from the on-screen keys, the typing keyboard and a MIDI keyboard (which
 * is connected only when the owner asks: "Connect a MIDI keyboard").
 */
import { useSyncExternalStore } from "react";

import { getEngine } from "../audio/engine";
import { useStore } from "../model/store";
import type { Song, Track } from "../model/types";
import { midiWanted, setMidiWanted } from "./prefs";

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : typeof e === "string" && e ? e : fallback);

// ── small shared values the views listen to (outside the store: they aren't part of the song) ──

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

let audioVersion = 0;
/** Goes up whenever sounds have been loaded or added, so waveforms are drawn again. */
export function useAudioVersion(): number {
  return useSyncExternalStore(subscribe, () => audioVersion, () => 0);
}
/** Say that sounds have arrived (after an import, an open or a recording). */
export function soundsChanged(): void {
  audioVersion++;
  notify();
}

/** The notes held right now (pitch → the track they sound on). */
const held = new Map<number, string>();
let heldKey = "";
/** The pitches held right now, as "60,64,67" (for lighting the keys up). */
export function useHeldNotes(): string {
  return useSyncExternalStore(subscribe, () => heldKey, () => "");
}
function heldChanged() {
  heldKey = [...held.keys()].sort((a, b) => a - b).join(",");
  notify();
}

/** The track the keys play: the selected one if it's an instrument, otherwise the first instrument track. */
export function playTrack(song: Song = useStore.getState().history.present, selectedTrackId: string | null = useStore.getState().selectedTrackId): Track | null {
  const selected = song.tracks.find((t) => t.id === selectedTrackId);
  if (selected?.kind === "instrument") return selected;
  if (selected) return null;
  return song.tracks.find((t) => t.kind === "instrument") ?? null;
}

/** Start a note on the track the keys play (true if there was one to play). */
export function liveNoteOn(pitch: number, velocity = 100): boolean {
  if (pitch < 0 || pitch > 127 || held.has(pitch)) return held.has(pitch);
  const track = playTrack();
  if (!track) return false;
  unlock();
  getEngine().noteOn(track.id, pitch, velocity);
  held.set(pitch, track.id);
  heldChanged();
  return true;
}

/** Let a note go. */
export function liveNoteOff(pitch: number): void {
  const trackId = held.get(pitch);
  if (trackId === undefined) return;
  held.delete(pitch);
  getEngine().noteOff(trackId, pitch);
  heldChanged();
}

/** Let every held note go (the window lost focus, a dialog opened…). */
export function liveAllOff(): void {
  if (!held.size) return;
  for (const [pitch, trackId] of held) getEngine().noteOff(trackId, pitch);
  held.clear();
  heldChanged();
}

// ── starting sound on the first click or key; MIDI keyboards only when asked ──

let unlocked = false;

/** Start the browser's sound (it's only allowed after a click or key press). Safe to call often. */
export function unlock(): void {
  if (unlocked) return;
  unlocked = true;
  void getEngine()
    .unlock()
    .catch(() => {
      unlocked = false;
    });
  // Connected here before: connect again, quietly (the browser already has the owner's yes).
  if (midiWanted()) void connectMidi(true);
}

/** "connected" once a keyboard has been found, "asked" while the browser is being asked, otherwise "off". */
export type MidiState = "off" | "asked" | "connected";
let midiState: MidiState = "off";
let midiNames = "";

/** Whether a MIDI keyboard is connected, and its name (for the Connect button). */
export function useMidi(): { state: MidiState; names: string } {
  const state = useSyncExternalStore(subscribe, () => midiState, () => "off" as MidiState);
  const names = useSyncExternalStore(subscribe, () => midiNames, () => "");
  return { state, names };
}

/** Whether this browser can use MIDI keyboards at all (Chrome and Edge can; Safari can't). */
export function midiPossible(): boolean {
  return typeof navigator !== "undefined" && typeof (navigator as Navigator & { requestMIDIAccess?: unknown }).requestMIDIAccess === "function";
}

/**
 * Connect MIDI keyboards — only ever from the "Connect a MIDI keyboard" button (the browser may ask for permission
 * then, which would be startling out of nowhere), or `quietly` on a later visit once the owner has said yes here.
 * Says what it found: the keyboard's name, or a friendly line when there's none or the browser can't.
 */
export async function connectMidi(quietly = false): Promise<void> {
  const toast = useStore.getState().toast;
  if (!midiPossible()) {
    if (!quietly) toast("This browser can't use MIDI keyboards. Chrome and Edge can; the on-screen keys and your typing keyboard work everywhere.", "info");
    return;
  }
  if (midiState === "asked") return;
  const before = midiState;
  midiState = "asked";
  notify();
  const names = await getEngine()
    .startMidiInput((pitch, velocity) => (velocity > 0 ? liveNoteOn(pitch, velocity) : liveNoteOff(pitch)))
    .catch(() => [] as string[]);
  if (names.length) {
    const said = names.join(", ");
    if (before !== "connected" || said !== midiNames) toast(`MIDI keyboard connected: ${said}. It plays the selected instrument track.`, "success");
    midiState = "connected";
    midiNames = said;
    setMidiWanted(true);
  } else {
    midiState = "off";
    midiNames = "";
    if (!quietly) {
      // Asked for and allowed (or not): either way it's worth trying again by itself next time.
      setMidiWanted(true);
      toast("No MIDI keyboard found yet. Plug one in and it will play as soon as it's connected. (If your browser asked and you chose Block, allow MIDI devices for this page in its settings.)", "info");
    }
  }
  notify();
}

/** Wire the store and the engine together (once, from App). Returns "stop". */
export function startEngineApp(): () => void {
  const engine = getEngine();
  const first = useStore.getState();
  engine.setSong(first.history.present);
  engine.setMetronome(first.metronome);

  const stopState = engine.onState((state) => {
    if (preview) {
      // A library pattern being listened to: the song's own transport stays as it was.
      if (!state.playing) endPreview();
      return;
    }
    const s = useStore.getState();
    if (s.playing !== state.playing || s.recording !== state.recording || s.countingIn !== state.countingIn) s.setEngineState(state);
  });
  const stopStore = useStore.subscribe((state, prev) => {
    if (state.history.present !== prev.history.present && !preview) engine.setSong(state.history.present);
    if (state.metronome !== prev.metronome && !preview) engine.setMetronome(state.metronome);
    // A dialog opening lets go of any held notes.
    if (state.dialog && !prev.dialog) liveAllOff();
  });

  // A recording or imported sound the browser couldn't keep: say so (a saved file still holds it).
  const stopStorage = engine.onStorageProblem((text) => useStore.getState().toast(text, "error"));

  const gesture = () => unlock();
  window.addEventListener("pointerdown", gesture, true);
  window.addEventListener("keydown", gesture, true);
  window.addEventListener("blur", liveAllOff);

  void loadSounds(first.history.present);

  return () => {
    stopState();
    stopStore();
    stopStorage();
    window.removeEventListener("pointerdown", gesture, true);
    window.removeEventListener("keydown", gesture, true);
    window.removeEventListener("blur", liveAllOff);
  };
}

/** Fetch a song's sounds from the browser's storage; says so if some have gone. */
export async function loadSounds(song: Song): Promise<void> {
  if (!song.audio.length) return;
  try {
    const missing = await getEngine().loadAudio(song.audio);
    soundsChanged();
    if (missing.length) {
      const names = song.audio.filter((a) => missing.includes(a.id)).map((a) => a.name);
      useStore
        .getState()
        .toast(
          `${missing.length === 1 ? `The sound "${names[0]}" isn't` : `${missing.length} sounds aren't`} in this browser any more, so ${missing.length === 1 ? "its clips" : "their clips"} will be silent. Open the song's .juradaw file to get ${missing.length === 1 ? "it" : "them"} back.`,
          "error",
        );
    }
  } catch {
    useStore.getState().toast("Couldn't load this song's sounds from the browser.", "error");
  }
}

/**
 * After New or Open: let the browser forget the sounds no song here uses any more — every sound of the song as it
 * is now and of every step Undo and Redo can still reach is kept.
 */
export function forgetUnusedSounds(): void {
  const { past, present, future } = useStore.getState().history;
  const keep = new Set<string>();
  for (const song of [...past, present, ...future]) for (const a of song.audio) keep.add(a.id);
  void getEngine()
    .forgetAudio([...keep])
    .catch(() => {
      // They're only taking up room; nothing is lost.
    });
}

// ── listening to something that isn't in the song (a library pattern) ──

let preview: { done: () => void } | null = null;

function endPreview(): void {
  const p = preview;
  if (!p) return;
  preview = null;
  const engine = getEngine();
  if (engine.state().playing) engine.stop();
  const s = useStore.getState();
  engine.setSong(s.history.present);
  engine.setMetronome(s.metronome);
  p.done();
}

/**
 * Play a small song of its own (a library pattern on a track) without touching the real one: the real song is
 * handed back to the engine when it ends or `stop` (what's returned) is called. `done` is told when it's over.
 */
export function playPreview(song: Song, done: () => void): () => void {
  unlock();
  endPreview();
  const engine = getEngine();
  if (engine.state().playing) engine.stop();
  preview = { done };
  engine.setMetronome(false);
  engine.setSong(song);
  engine.play(0);
  return endPreview;
}

// ── the transport ──

/** Play from the cursor, or stop (a recording too). After stopping, Play starts from the same place again. */
export function togglePlay(): void {
  const s = useStore.getState();
  unlock();
  endPreview();
  if (s.recording || s.countingIn) {
    void stopRecording();
    return;
  }
  const engine = getEngine();
  if (s.playing) engine.stop();
  else engine.play(s.cursor);
}

/** Put the cursor somewhere (a click on the ruler); if the song is playing it carries on from there. */
export function seek(beat: number): void {
  const s = useStore.getState();
  const to = Math.max(0, beat);
  s.setCursor(to);
  if (s.playing && !s.recording && !s.countingIn) getEngine().play(to);
}

/** Back to the start of the song (playing carries on from there). */
export function goToStart(): void {
  seek(0);
}

/** When a recording last failed to start or finish (so "Nothing was recorded" isn't said on top of the reason). */
let recordFailedAt = 0;

async function stopRecording(): Promise<void> {
  const s = useStore.getState();
  try {
    const take = await getEngine().stopRecording();
    if (take) {
      useStore.getState().addTake(take);
      if (take.kind === "audio") soundsChanged();
      s.toast(take.kind === "audio" ? "Recorded. Undo takes it away again." : take.notes.length === 1 ? "Recorded 1 note. Undo takes it away again." : `Recorded ${take.notes.length} notes. Undo takes them away again.`, "success");
    } else if (Date.now() - recordFailedAt > 3000) {
      // (Not said when a message has just explained why nothing could be recorded.)
      s.toast("Nothing was recorded.", "info");
    }
  } catch (e) {
    recordFailedAt = Date.now();
    s.toast(message(e, "Couldn't finish the recording."), "error");
  }
}

/** Start recording onto the selected track (after the count-in), or stop. */
export function toggleRecord(): void {
  const s = useStore.getState();
  unlock();
  if (s.recording || s.countingIn) {
    void stopRecording();
    return;
  }
  const song = s.history.present;
  const track = song.tracks.find((t) => t.id === s.selectedTrackId);
  if (!track) {
    s.toast(song.tracks.length ? "Click the track you want to record onto first, then press Record." : "Add a track to record onto first: an instrument to play, or “Record sound” for a microphone.", "info");
    return;
  }
  const engine = getEngine();
  if (s.playing) engine.stop();
  void engine
    .unlock()
    .then(() => engine.startRecording({ trackId: track.id, fromBeat: s.cursor, countInBars: s.countIn }))
    // (What to do next is said in the Keys panel and beside the display, not in a message over the keys.)
    .catch((e) => {
      recordFailedAt = Date.now();
      s.toast(message(e, "Couldn't start recording. Is the microphone allowed for this page?"), "error");
    });
}

// ── every-frame readings (playheads and meters), never through React state ──

/** Call `frame` on every animation frame until the returned function is called. */
export function everyFrame(frame: () => void): () => void {
  let id = 0;
  const tick = () => {
    frame();
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(id);
}

/** Where the playhead should be drawn now (beats): the engine's place while playing, the cursor when stopped. */
export function playheadBeat(): number {
  const s = useStore.getState();
  return (s.playing || s.recording) && !preview ? getEngine().position() : s.cursor;
}

/** A track's (or "master"'s) loudness now, 0–1. */
export function levelOf(id: string): number {
  return getEngine().level(id);
}

/** Hear a note of a track for a moment (a click on a piano key or a note). */
export function hear(trackId: string, pitch: number, velocity = 100, seconds = 0.3): void {
  unlock();
  getEngine().previewNote(trackId, pitch, velocity, seconds);
}

/** A sound's shape for drawing, or null if it isn't loaded. */
export function peaksOf(audioId: string, buckets: number, from?: number, to?: number): Float32Array | null {
  return getEngine().peaks(audioId, buckets, from, to);
}
