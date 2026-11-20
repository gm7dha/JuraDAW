/**
 * The sound engine: the one place that touches Web Audio, the microphone and
 * MIDI keyboards. The rest of JuraDAW talks to it through the `Engine`
 * interface (engineApi.ts) and gets it from `getEngine()`.
 *
 * This file ties the parts together: the mixer (mixer.ts), the transport
 * that plays the song in time (transport.ts), the instruments and drums,
 * recording (record.ts, take.ts), the song's sounds (audioStore.ts) and the
 * mixdown (render.ts). Until `unlock()` has been called from a click or key
 * press there is no sound context, and everything here quietly does nothing.
 */
import type { AudioInfo, Song, Track } from "../model/types";
import { forgetSounds, getSound, keepSound, loadSounds, newSoundId, soundPeaks, soundWav, storeSound } from "./audioStore";
import type { Engine, EngineState, RecordOptions, RecordedTake } from "./engineApi";
import { instrumentById } from "./instruments";
import { playClick } from "./metronome";
import { startMidiInput } from "./midiInput";
import { Mixer, meterLevel } from "./mixer";
import { startMicRecording, type MicRecording } from "./record";
import { renderSong, type RenderOptions } from "./render";
import { beatsToSeconds, secondsToBeats } from "./shared";
import { buildMidiTake, type PlayedNote } from "./take";
import { Transport } from "./transport";
import type { Voice } from "./voice";
import { decodeWav, encodeWav } from "./wav";

/** Play starts this far ahead of "now", so the first notes are never late. */
const START_DELAY = 0.04;
/** The most live notes (keys, previews) sounding at once; beyond it the oldest are cut. */
const MOST_LIVE_VOICES = 48;
/** A key pressed this many beats (or less) before recording starts counts as played on the first beat. */
const EARLY_NOTE_BEATS = 0.25;
/** A recording shorter than this (seconds) counts as nothing. */
const SHORTEST_RECORDING = 0.05;

const CANT_READ_SOUND = "JuraDAW couldn't read that sound file. Try a WAV, MP3, OGG or M4A file.";
const NO_SOUND_HERE = "This browser can't play sound, so JuraDAW can't either. Try a current version of Chrome, Edge, Firefox or Safari.";
const NO_TRACK = "Choose a track to record onto first.";
const NOT_KEPT = "This sound couldn't be kept in the browser, so it would be gone after a reload. Save the song to a file to keep it.";
/** A note asked for while the sound was still starting up is played if the sound starts within this long (milliseconds); later than that it would only be a surprise. */
const WAIT_FOR_SOUND_MS = 400;

const EMPTY_SONG: Song = {
  name: "",
  bpm: 120,
  beatsPerBar: 4,
  master: 0.8,
  loop: { on: false, start: 0, end: 4 },
  tracks: [],
  clips: [],
  audio: [],
};

/** A key that's down. */
interface HeldNote {
  voice: Voice;
  pitch: number;
  velocity: number;
  /** Where it started in the song, if it's being recorded. */
  recordedFrom: number | null;
}

/** A recording under way. */
type Recording =
  | { kind: "midi"; trackId: string; fromBeat: number; notes: PlayedNote[] }
  | { kind: "audio"; trackId: string; fromBeat: number; mic: MicRecording };

class WebAudioEngine implements Engine {
  private ctx: AudioContext | null = null;
  private mixer: Mixer | null = null;
  private transport: Transport | null = null;
  private song: Song = EMPTY_SONG;
  private metronomeOn = false;
  private current: EngineState = { playing: false, recording: false, countingIn: false };
  private readonly listeners = new Set<(state: EngineState) => void>();
  private readonly storageListeners = new Set<(message: string) => void>();
  /** Keys pressed while the sound was still starting up, waiting to sound (key → what was asked). */
  private readonly waiting = new Map<string, { trackId: string; pitch: number; velocity: number }>();
  /** True from Record being pressed until recording has begun (the browser may be asking about the microphone). */
  private preparingToRecord = false;
  private readonly held = new Map<string, HeldNote>();
  private readonly liveVoices = new Set<Voice>();
  private recording: Recording | null = null;
  private countInVoices: Voice[] = [];
  private countInTimer: ReturnType<typeof setTimeout> | null = null;
  /** Goes up whenever Play or Stop is asked for, so a Play that was waiting for the sound to start knows it's been overtaken. */
  private playRequest = 0;
  /** Where the playhead rests before the sound has ever started. */
  private restingAt = 0;

  // ── starting up ──

  async unlock(): Promise<void> {
    if (!this.ctx) {
      if (typeof AudioContext === "undefined" || typeof StereoPannerNode === "undefined") throw new Error(NO_SOUND_HERE);
      const ctx = new AudioContext({ latencyHint: "interactive" });
      const mixer = new Mixer(ctx, ctx.destination, true);
      mixer.sync(this.song);
      this.ctx = ctx;
      this.mixer = mixer;
      this.transport = new Transport({
        ctx,
        mixer,
        song: () => this.song,
        metronome: () => this.metronomeOn,
        sound: getSound,
        onRunOut: () => this.ranOut(),
      });
      this.transport.stop(this.restingAt);
      // Some browsers hold a hidden page's timers up: schedule well ahead as the page is hidden.
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) this.transport?.lookFarAhead();
      });
    }
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  // ── state ──

  state(): EngineState {
    return this.current;
  }

  onState(listener: (state: EngineState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(next: EngineState): void {
    const now = this.current;
    if (now.playing === next.playing && now.recording === next.recording && now.countingIn === next.countingIn) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener(next);
  }

  // ── the song and the transport ──

  setSong(song: Song): void {
    this.song = song;
    this.mixer?.sync(song);
    this.transport?.songChanged(song);
  }

  setMetronome(on: boolean): void {
    this.metronomeOn = on;
  }

  play(fromBeat: number): void {
    // Playing doesn't interrupt a recording, or one about to begin.
    if (this.recording || this.preparingToRecord) return;
    const request = ++this.playRequest;
    const from = Math.max(0, fromBeat);
    if (this.ctx?.state === "running") {
      this.startPlaying(from);
      return;
    }
    this.restingAt = from;
    this.transport?.stop(from);
    this.unlock().then(
      () => {
        if (request === this.playRequest && !this.recording && !this.preparingToRecord) this.startPlaying(from);
      },
      () => {
        // No sound in this browser: nothing plays.
      },
    );
  }

  private startPlaying(fromBeat: number): void {
    if (!this.ctx || !this.transport) return;
    this.transport.start(fromBeat, this.ctx.currentTime + START_DELAY, { loop: true, runOut: true });
    this.setState({ playing: true, recording: false, countingIn: false });
  }

  stop(): void {
    this.playRequest++;
    this.silenceLiveNotes();
    // A recording carries on until stopRecording.
    if (this.recording) return;
    this.transport?.stop();
    this.setState({ playing: false, recording: false, countingIn: false });
  }

  /** The song has run out: stop, and put the playhead back where Play started. */
  private ranOut(): void {
    if (this.recording || !this.transport) return;
    this.transport.stop(this.transport.startedAt);
    this.setState({ playing: false, recording: false, countingIn: false });
  }

  position(): number {
    return this.transport ? this.transport.position() : this.restingAt;
  }

  // ── playing live ──

  private instrumentTrack(trackId: string): Track | null {
    const track = this.song.tracks.find((t) => t.id === trackId);
    return track && track.kind === "instrument" ? track : null;
  }

  /** Start a note now on a track's instrument, through the track's mixer strip. Null if it can't sound. */
  private startLiveVoice(trackId: string, pitch: number, velocity: number): Voice | null {
    const track = this.instrumentTrack(trackId);
    const input = this.mixer?.input(trackId);
    if (!this.ctx || !track || !input || this.ctx.state !== "running") return null;
    const voice = instrumentById(track.instrument).startVoice(this.ctx, input, pitch, velocity, this.ctx.currentTime);
    this.liveVoices.add(voice);
    voice.onended = () => this.liveVoices.delete(voice);
    if (this.liveVoices.size > MOST_LIVE_VOICES) {
      const oldest = this.liveVoices.values().next().value;
      if (oldest) {
        oldest.silence(this.ctx.currentTime);
        this.liveVoices.delete(oldest);
      }
    }
    return voice;
  }

  /** Where a key pressed now belongs in the recording; null if it isn't being recorded. */
  private recordingBeat(trackId: string): number | null {
    const recording = this.recording;
    if (!recording || recording.kind !== "midi" || recording.trackId !== trackId || !this.ctx || !this.transport) return null;
    if (!this.current.countingIn) return Math.max(recording.fromBeat, this.transport.position());
    // During the count-in, a key pressed a hair early is meant for the first beat.
    const beatsToGo = secondsToBeats(this.transport.startTime + this.transport.outputLatency() - this.ctx.currentTime, this.song.bpm);
    return beatsToGo <= EARLY_NOTE_BEATS ? recording.fromBeat : null;
  }

  /**
   * The sound isn't running (it's still starting after the first click, or the browser has paused it): ask for it
   * and, if it comes back promptly, do `then`. Notes are never queued on a stopped clock, where they would pile up
   * and all sound at once later.
   */
  private whenSoundStarts(then: () => void): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const asked = performance.now();
    ctx.resume().then(
      () => {
        if (ctx.state === "running" && performance.now() - asked <= WAIT_FOR_SOUND_MS) then();
      },
      () => {
        // The browser won't start the sound: the note is dropped.
      },
    );
  }

  noteOn(trackId: string, pitch: number, velocity: number): void {
    const key = `${trackId}:${pitch}`;
    if (this.held.has(key)) this.noteOff(trackId, pitch);
    if (this.ctx && this.ctx.state !== "running") {
      // Sounds as soon as the sound has started, if the key is still down then.
      const ask = { trackId, pitch, velocity };
      this.waiting.set(key, ask);
      this.whenSoundStarts(() => {
        if (this.waiting.get(key) !== ask) return;
        this.waiting.delete(key);
        this.noteOn(trackId, pitch, velocity);
      });
      return;
    }
    const voice = this.startLiveVoice(trackId, pitch, velocity);
    if (!voice) return;
    this.held.set(key, { voice, pitch, velocity, recordedFrom: this.recordingBeat(trackId) });
  }

  noteOff(trackId: string, pitch: number): void {
    const key = `${trackId}:${pitch}`;
    this.waiting.delete(key);
    const note = this.held.get(key);
    if (!note || !this.ctx) return;
    this.held.delete(key);
    note.voice.stop(this.ctx.currentTime);
    this.finishRecordedNote(note);
  }

  /** If a key was being recorded, write down the note now that it has ended. */
  private finishRecordedNote(note: HeldNote): void {
    const recording = this.recording;
    if (note.recordedFrom === null || !recording || recording.kind !== "midi") return;
    recording.notes.push({ pitch: note.pitch, velocity: note.velocity, start: note.recordedFrom, end: Math.max(note.recordedFrom, this.position()) });
    note.recordedFrom = null;
  }

  previewNote(trackId: string, pitch: number, velocity = 100, seconds = 0.3): void {
    if (this.ctx && this.ctx.state !== "running") {
      this.whenSoundStarts(() => this.previewNote(trackId, pitch, velocity, seconds));
      return;
    }
    const voice = this.startLiveVoice(trackId, pitch, velocity);
    if (voice && this.ctx) voice.stop(this.ctx.currentTime + Math.max(0.02, seconds));
  }

  /** Cut off every live note at once (Stop). Keys being recorded are written down as ending here. */
  private silenceLiveNotes(): void {
    this.waiting.clear();
    if (!this.ctx) return;
    for (const note of this.held.values()) this.finishRecordedNote(note);
    this.held.clear();
    for (const voice of this.liveVoices) voice.silence(this.ctx.currentTime);
    this.liveVoices.clear();
  }

  level(trackId: string): number {
    const level = this.mixer?.level(trackId) ?? 0;
    const recording = this.recording;
    // While recording sound, the track's meter shows the microphone.
    if (recording?.kind === "audio" && recording.trackId === trackId) return Math.max(level, meterLevel(recording.mic.peak()));
    return level;
  }

  // ── recording ──

  async startRecording(options: RecordOptions): Promise<void> {
    await this.unlock();
    const ctx = this.ctx;
    const transport = this.transport;
    if (!ctx || !transport) throw new Error(NO_SOUND_HERE);
    if (this.recording) await this.stopRecording();
    this.playRequest++;
    transport.stop();
    this.setState({ playing: false, recording: false, countingIn: false });

    const track = this.song.tracks.find((t) => t.id === options.trackId);
    if (!track) throw new Error(NO_TRACK);
    const fromBeat = Math.max(0, options.fromBeat);
    // Asking for the microphone can take a while (the browser may ask the user), so it comes before any timing;
    // Play is held off meanwhile, or the song would be running when the answer comes.
    let mic: MicRecording | null = null;
    if (track.kind === "audio") {
      if (this.preparingToRecord) return;
      this.preparingToRecord = true;
      try {
        mic = await startMicRecording(ctx);
      } finally {
        this.preparingToRecord = false;
      }
    }
    if (this.recording) {
      // Another recording was started while the browser was asking: this one gives way.
      void mic?.stop();
      return;
    }
    this.recording = mic ? { kind: "audio", trackId: track.id, fromBeat, mic } : { kind: "midi", trackId: track.id, fromBeat, notes: [] };

    const song = this.song;
    const countBeats = Math.max(0, Math.round(options.countInBars)) * song.beatsPerBar;
    const countSeconds = beatsToSeconds(countBeats, song.bpm);
    const first = ctx.currentTime + START_DELAY * 2;
    const songStarts = first + countSeconds;
    for (let beat = 0; beat < countBeats; beat++) {
      this.countInVoices.push(playClick(ctx, this.mixer!.clickInput, first + beatsToSeconds(beat, song.bpm), beat % song.beatsPerBar === 0));
    }
    // The loop is left alone while recording, so a take is one straight run.
    transport.start(fromBeat, songStarts, { loop: false, runOut: false });
    this.setState({ playing: countBeats === 0, recording: true, countingIn: countBeats > 0 });
    if (countBeats > 0) this.waitForCountIn(songStarts);
  }

  /** Flip from "counting in" to "recording" when the song starts moving. */
  private waitForCountIn(songStarts: number): void {
    const check = () => {
      this.countInTimer = null;
      if (!this.ctx || !this.recording || !this.current.countingIn) return;
      const left = songStarts - this.ctx.currentTime;
      if (left > 0.005) this.countInTimer = setTimeout(check, Math.max(5, left * 1000));
      else this.setState({ playing: true, recording: true, countingIn: false });
    };
    check();
  }

  async stopRecording(): Promise<RecordedTake | null> {
    const recording = this.recording;
    const ctx = this.ctx;
    const transport = this.transport;
    if (!recording || !ctx || !transport) return null;

    const stillCountingIn = this.current.countingIn;
    const songStarted = transport.startTime;
    const outputLatency = transport.outputLatency();
    const bpm = this.song.bpm;
    const beatsPerBar = this.song.beatsPerBar;
    if (this.countInTimer !== null) clearTimeout(this.countInTimer);
    this.countInTimer = null;
    for (const click of this.countInVoices) click.silence(ctx.currentTime);
    this.countInVoices = [];

    // Keys still down end here; then everything stops.
    this.silenceLiveNotes();
    this.recording = null;
    this.playRequest++;
    transport.stop(stillCountingIn ? recording.fromBeat : undefined);
    this.setState({ playing: false, recording: false, countingIn: false });

    if (recording.kind === "midi") return stillCountingIn ? null : buildMidiTake(recording.trackId, recording.fromBeat, beatsPerBar, recording.notes);

    const captured = await recording.mic.stop();
    if (stillCountingIn || captured.channels.length === 0) return null;
    // Line the take up with the song: what was played at the first beat was heard a little after the
    // sound clock said so (the way out), and reached us a little later still (the way in).
    const firstBeatAt = songStarted + outputLatency + captured.inputLatency;
    const skip = Math.round((firstBeatAt - captured.startTime) * captured.sampleRate);
    const channels = skip > 0 ? captured.channels.map((samples) => samples.subarray(skip)) : captured.channels;
    if (channels[0].length < SHORTEST_RECORDING * captured.sampleRate) return null;
    // If the microphone only got going after the first beat, the take starts that much later.
    const start = recording.fromBeat + (skip < 0 ? secondsToBeats(-skip / captured.sampleRate, bpm) : 0);

    const sound = keepSound({ id: newSoundId(), name: "Recording", seconds: 0, sampleRate: captured.sampleRate, channels: channels.length }, channels, captured.sampleRate);
    await this.keepInBrowser(sound.info.id);
    return { kind: "audio", trackId: recording.trackId, start, info: sound.info };
  }

  // ── the song's sounds ──

  async importAudio(file: Blob, name: string): Promise<AudioInfo> {
    let channels: Float32Array[];
    let sampleRate: number;
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      throw new Error(CANT_READ_SOUND);
    }
    try {
      // Any context can decode; before the sound has started, a throwaway offline one does it.
      const decoder: BaseAudioContext = this.ctx ?? new OfflineAudioContext(2, 1, 44100);
      // decodeAudioData empties the bytes it's given, so it gets a copy.
      const buffer = await decoder.decodeAudioData(bytes.slice(0));
      channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c));
      sampleRate = buffer.sampleRate;
    } catch {
      // Some WAV files a browser won't decode (32-bit ones, say) we can read ourselves.
      try {
        const wav = decodeWav(new Uint8Array(bytes));
        channels = wav.channels.slice(0, 2);
        sampleRate = wav.sampleRate;
      } catch {
        throw new Error(CANT_READ_SOUND);
      }
    }
    if (!channels.length || !channels[0].length) throw new Error(CANT_READ_SOUND);
    try {
      const sound = keepSound({ id: newSoundId(), name, seconds: 0, sampleRate, channels: channels.length }, channels, sampleRate);
      await this.keepInBrowser(sound.info.id);
      return sound.info;
    } catch {
      throw new Error(CANT_READ_SOUND);
    }
  }

  /** Keep a sound in the browser's storage, and say so if that can't be done. */
  private async keepInBrowser(audioId: string): Promise<void> {
    if (await storeSound(audioId)) return;
    for (const listener of [...this.storageListeners]) listener(NOT_KEPT);
  }

  onStorageProblem(listener: (message: string) => void): () => void {
    this.storageListeners.add(listener);
    return () => {
      this.storageListeners.delete(listener);
    };
  }

  forgetAudio(keepIds: string[]): Promise<void> {
    return forgetSounds(keepIds);
  }

  loadAudio(infos: AudioInfo[]): Promise<string[]> {
    return loadSounds(infos);
  }

  peaks(audioId: string, buckets: number, fromSeconds?: number, toSeconds?: number): Float32Array | null {
    return soundPeaks(audioId, buckets, fromSeconds, toSeconds);
  }

  async audioWav(audioId: string): Promise<Blob | null> {
    const bytes = soundWav(audioId);
    // encodeWav's bytes fill their buffer exactly, so the buffer is the file.
    return bytes ? new Blob([bytes.buffer as ArrayBuffer], { type: "audio/wav" }) : null;
  }

  async putAudioWav(info: AudioInfo, wav: Blob): Promise<void> {
    const { channels, sampleRate } = decodeWav(new Uint8Array(await wav.arrayBuffer()));
    keepSound(info, channels, sampleRate);
    await storeSound(info.id);
  }

  // ── mixdown and MIDI keyboards ──

  async renderWav(song: Song, options?: RenderOptions): Promise<Blob> {
    const { channels, sampleRate } = await renderSong(song, getSound, options);
    return new Blob([encodeWav(channels, sampleRate).buffer as ArrayBuffer], { type: "audio/wav" });
  }

  startMidiInput(onNote: (pitch: number, velocity: number) => void): Promise<string[]> {
    return startMidiInput(onNote);
  }
}

let engine: Engine | null = null;

/** The sound engine (made the first time it's asked for; there is only ever one). */
export function getEngine(): Engine {
  engine ??= new WebAudioEngine();
  return engine;
}
