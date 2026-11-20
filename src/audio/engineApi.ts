/**
 * What the app may ask of the sound engine. The engine (src/audio/engine.ts,
 * `getEngine()`) is the only code that touches Web Audio, the microphone and
 * Web MIDI; the rest of the app talks to it through this interface, so the
 * smoke test and unit tests can do without sound.
 */
import type { AudioInfo, Note, Song } from "../model/types";

/** What came out of a recording. Times are beats from the start of the song. */
export type RecordedTake =
  | { kind: "midi"; trackId: string; start: number; length: number; notes: Omit<Note, "id">[] }
  | { kind: "audio"; trackId: string; start: number; info: AudioInfo };

/** During a count-in: `{ playing: false, recording: true, countingIn: true }`; once the song moves: playing and recording both true. */
export interface EngineState {
  playing: boolean;
  recording: boolean;
  /** Counting in before a recording starts. */
  countingIn: boolean;
}

export interface RecordOptions {
  trackId: string;
  /** Where in the song recording starts (beats). */
  fromBeat: number;
  /** Bars of metronome before it starts (0 = none). */
  countInBars: number;
}

export interface Engine {
  /** Start the browser's sound (must be called from a click or key press; safe to call again). */
  unlock(): Promise<void>;
  /** The song to play. Call on every change of the song; playing carries on with the new one. */
  setSong(song: Song): void;
  /** Play from a place in the song (beats). Loops if song.loop.on. */
  play(fromBeat: number): void;
  /** Stop playing (and any notes held). Does not stop a recording — use stopRecording. */
  stop(): void;
  /** Where the playhead is now, in beats (read every frame while playing; the last place when stopped). */
  position(): number;
  state(): EngineState;
  /** Told whenever state() changes (also when the song runs out and playing stops by itself). Returns "stop listening". */
  onState(listener: (state: EngineState) => void): () => void;
  setMetronome(on: boolean): void;

  /** Play a track's instrument live (on-screen keys, typing keyboard, a MIDI keyboard). Recorded while recording that track. */
  noteOn(trackId: string, pitch: number, velocity: number): void;
  noteOff(trackId: string, pitch: number): void;
  /** A short note to hear what you clicked (not recorded). */
  previewNote(trackId: string, pitch: number, velocity?: number, seconds?: number): void;
  /** Loudness right now for a meter, 0–1; trackId or "master". 0 when silent or not started. */
  level(trackId: string): number;

  /** Start recording: notes played on an instrument track, the microphone on an audio track. Plays the song along. Rejects (with a friendly message) if the microphone isn't allowed. */
  startRecording(options: RecordOptions): Promise<void>;
  /** Stop recording and playing; what was recorded (null if nothing). An audio take's sound is already kept. */
  stopRecording(): Promise<RecordedTake | null>;

  /** Read a sound file (WAV, MP3, OGG, M4A… whatever the browser can) and keep it. Rejects with a friendly message if it can't be read. */
  importAudio(file: Blob, name: string): Promise<AudioInfo>;
  /** Fetch the song's sounds from the browser's storage; the ids that couldn't be found. */
  loadAudio(infos: AudioInfo[]): Promise<string[]>;
  /** A sound's shape for drawing: `buckets` values 0–1 (loudest sample in each slice) between two times in seconds; null if the sound isn't loaded. */
  peaks(audioId: string, buckets: number, fromSeconds?: number, toSeconds?: number): Float32Array | null;
  /** A sound as a WAV file (to put inside a saved .juradaw); null if it isn't there. */
  audioWav(audioId: string): Promise<Blob | null>;
  /** Put a sound back from a saved file. */
  putAudioWav(info: AudioInfo, wav: Blob): Promise<void>;
  /**
   * Told, with a friendly sentence, whenever a recording or an imported sound couldn't be kept in the browser's
   * storage (so it would be gone after a reload; saving the song to a file still keeps it). Returns "stop listening".
   */
  onStorageProblem(listener: (message: string) => void): () => void;
  /** Forget every stored sound except these ids (the sounds the song, and its undo list, still use), in the browser's storage and in memory. */
  forgetAudio(keepIds: string[]): Promise<void>;

  /**
   * The whole song (or between two beats) mixed down to a stereo 16-bit WAV file. `signal` stops it part-way (Export's
   * Stop button): the promise then rejects with an error named "AbortError".
   */
  renderWav(song: Song, options?: { fromBeat?: number; toBeat?: number; onProgress?: (share: number) => void; signal?: AbortSignal }): Promise<Blob>;

  /** Listen to MIDI keyboards (Web MIDI). The names of the keyboards found (empty if none or not supported). `onNote` is told of every key: velocity 0 = let go. */
  startMidiInput(onNote: (pitch: number, velocity: number) => void): Promise<string[]>;
}
