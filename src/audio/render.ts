/**
 * The mixdown: the whole song (or a stretch of it) played, far faster than
 * real time, into memory instead of the speakers. It uses exactly the same
 * instruments, drums and mixer as live playing, on the browser's "offline"
 * sound context, so the file sounds like what you heard.
 */
import type { Clip, Song, Track } from "../model/types";
import { fadeNode, shapedInput } from "./clipLevel";
import { clipSource } from "./reverse";
import type { Sound } from "./audioStore";
import { instrumentById } from "./instruments";
import { LIMITER_DELAY, Mixer, echoSeconds } from "./mixer";
import { audibleTracks, audioClipsBetween, notesBetween, songLengthBeats } from "./schedule";
import { beatsToSeconds, clamp, secondsToBeats } from "./shared";

/** The mixdown's sample rate (CD quality). */
export const RENDER_RATE = 44100;
/** Extra seconds at the end for the reverb to die away (longer when a slow echo is in use: see `renderTail`). */
export const RENDER_TAIL = 2.5;
/** The longest the tail gets, however slow the echo. */
const LONGEST_TAIL = 8;
/** How many repeats of the echo the tail leaves room for (each is about 8 dB quieter than the last). */
const ECHO_REPEATS = 6;
/**
 * Silence played into the mixer before the song starts, then cut off the result: the limiter takes a moment to
 * settle when it's first switched on, and would otherwise turn the first note down.
 */
const LEAD_IN = 0.3;
/** The very end is faded over this long so the file never stops with a click. */
const END_FADE = 0.05;
/** The song is scheduled a few seconds at a time as the mixdown goes, so long songs don't need everything in memory at once. */
const CHUNK = 5;

export const NOTHING_TO_RENDER = "There's nothing to mix down yet. Add some notes or sounds first.";
export const RENDER_FAILED = "JuraDAW couldn't make the mixdown in this browser.";

export interface RenderOptions {
  /** Start here instead of at the beginning (beats). */
  fromBeat?: number;
  /** End here instead of at the end of the last clip (beats). */
  toBeat?: number;
  /** Told how far along it is, 0–1. */
  onProgress?: (share: number) => void;
  /** Stops the mixdown part-way: it then rejects with an error named "AbortError". */
  signal?: AbortSignal;
}

/** The error a stopped mixdown rejects with (named "AbortError", as the browser's own are). */
export function stoppedError(): Error {
  const error = new Error("The mixdown was stopped.");
  error.name = "AbortError";
  return error;
}

/**
 * How many seconds the mixdown runs on after the end of the song: RENDER_TAIL, or longer when a track that can be
 * heard sends to the echo and the tempo makes its repeats far apart.
 */
export function renderTail(song: Song): number {
  const audible = audibleTracks(song);
  const echoing = song.tracks.some((t) => t.echo > 0 && audible.has(t.id));
  return echoing ? Math.min(LONGEST_TAIL, Math.max(RENDER_TAIL, echoSeconds(song.bpm) * ECHO_REPEATS)) : RENDER_TAIL;
}

/**
 * Mix a song down to stereo samples at RENDER_RATE. Muted tracks, solo,
 * volumes, left–right, reverb, echo and the master volume are all as in the
 * song. Rejects with a friendly message if there's nothing to mix.
 */
export async function renderSong(song: Song, sound: (audioId: string) => Sound | undefined, options: RenderOptions = {}): Promise<{ channels: Float32Array[]; sampleRate: number }> {
  const from = Math.max(0, options.fromBeat ?? 0);
  const to = options.toBeat ?? songLengthBeats(song);
  if (!(to > from)) throw new Error(NOTHING_TO_RENDER);
  const signal = options.signal;
  if (signal?.aborted) throw stoppedError();

  const wanted = Math.ceil((beatsToSeconds(to - from, song.bpm) + renderTail(song)) * RENDER_RATE);
  // What's cut off the front afterwards: the lead-in, and the few thousandths of a second the limiter holds sound back.
  const skipped = Math.round((LEAD_IN + LIMITER_DELAY) * RENDER_RATE);
  const seconds = (wanted + skipped) / RENDER_RATE;
  const Offline = window.OfflineAudioContext;
  if (!Offline) throw new Error(RENDER_FAILED);
  const ctx = new Offline(2, wanted + skipped, RENDER_RATE);
  const mixer = new Mixer(ctx, ctx.destination, false);
  mixer.sync(song);
  const tracks = new Map<string, Track>(song.tracks.map((t) => [t.id, t]));
  const clips = new Map<string, Clip>(song.clips.map((c) => [c.id, c]));
  const clipBeats = (clip: Clip) => (clip.kind === "midi" ? clip.length : secondsToBeats(clip.duration, song.bpm));
  const timeOf = (beat: number) => LEAD_IN + beatsToSeconds(beat - from, song.bpm);

  /** Schedule what starts between two times of the mixdown (seconds). */
  const schedule = (fromSeconds: number, toSeconds: number) => {
    const a = from + secondsToBeats(Math.max(0, fromSeconds - LEAD_IN), song.bpm);
    const b = from + secondsToBeats(Math.max(0, toSeconds - LEAD_IN), song.bpm);
    for (const note of notesBetween(song, a, b, { cutAt: to })) {
      const track = tracks.get(note.trackId);
      const input = mixer.input(note.trackId);
      if (!track || !input) continue;
      const when = timeOf(note.beat);
      const clip = clips.get(note.clipId);
      const shaped = clip && clip.kind === "midi" ? shapedInput(ctx, input, clip, clip.length, note.clipBeat, note.clipBeat + note.lengthBeats, (beat) => timeOf(clip.start + beat)) : null;
      const length = beatsToSeconds(note.lengthBeats, song.bpm);
      instrumentById(track.instrument).startVoice(ctx, shaped ?? input, note.pitch, note.velocity, when, length).stop(when + length);
    }
    // The pump's dips and the filter sweeps, in time with the song (up to where the mixdown ends: the tail is left alone).
    if (a < to) mixer.scheduleShaping(song, a, Math.min(b, to), timeOf, clipBeats);
    // Only the very first stretch picks up clips that are already under way.
    for (const event of audioClipsBetween(song, a, b, { cutAt: to, running: fromSeconds === 0 })) {
      const buffer = sound(event.audioId)?.buffer;
      const input = mixer.input(event.trackId);
      if (!buffer || !input || event.offset >= buffer.duration) continue;
      const when = timeOf(event.beat);
      const duration = Math.min(event.duration, buffer.duration - event.offset);
      const clip = clips.get(event.clipId);
      const from = clip && clip.kind === "audio" ? clipSource(ctx, clip, buffer, event.offset) : { buffer, offset: event.offset };
      const source = ctx.createBufferSource();
      source.buffer = from.buffer;
      const level = ctx.createGain();
      const gain = clamp(event.gain, 0, 2);
      const fade = Math.min(0.004, duration / 2);
      level.gain.setValueAtTime(0, when);
      level.gain.linearRampToValueAtTime(gain, when + fade);
      level.gain.setValueAtTime(gain, when + duration - fade);
      level.gain.linearRampToValueAtTime(0, when + duration);
      const sinceStart = (seconds: number) => (clip && clip.kind === "audio" ? secondsToBeats(seconds - clip.offset, song.bpm) : 0);
      const fades = clip ? fadeNode(ctx, clip, clipBeats(clip), sinceStart(event.offset), sinceStart(event.offset + duration), (beat) => when + beatsToSeconds(beat - sinceStart(event.offset), song.bpm)) : null;
      if (fades) source.connect(level).connect(fades).connect(input);
      else source.connect(level).connect(input);
      source.start(when, from.offset, duration);
    }
  };

  // Pause the mixdown every CHUNK seconds to report progress and schedule a later stretch
  // (always one whole chunk ahead of where it has got to). Where the browser can't pause, schedule it all now.
  let pausing = typeof ctx.suspend === "function";
  options.onProgress?.(0);
  schedule(0, CHUNK * 2);
  if (pausing) {
    try {
      for (let t = CHUNK; t < seconds; t += CHUNK) {
        const at = t;
        ctx
          .suspend(at)
          .then(() => {
            // Stopped: the mixdown is left paused where it is (and thrown away), so no more work is done.
            if (signal?.aborted) return;
            options.onProgress?.(at / seconds);
            if (pausing) schedule(at + CHUNK, at + CHUNK * 2);
            void ctx.resume();
          })
          .catch(() => {
            pausing = false;
          });
      }
    } catch {
      pausing = false;
    }
    // Give a refusal the chance to show itself before the mixdown starts.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!pausing) schedule(CHUNK * 2, seconds);

  let rendered: AudioBuffer;
  let stop: (() => void) | null = null;
  try {
    const stopped = new Promise<never>((_, reject) => {
      stop = () => reject(stoppedError());
      signal?.addEventListener("abort", stop);
    });
    rendered = await Promise.race([ctx.startRendering(), stopped]);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    throw new Error(RENDER_FAILED);
  } finally {
    if (stop) signal?.removeEventListener("abort", stop);
  }
  const channels = [rendered.getChannelData(0).subarray(skipped), rendered.getChannelData(1).subarray(skipped)];
  const fade = Math.floor(END_FADE * RENDER_RATE);
  for (const samples of channels) {
    for (let i = 0; i < fade && i < samples.length; i++) samples[samples.length - 1 - i] *= i / fade;
  }
  options.onProgress?.(1);
  return { channels, sampleRate: RENDER_RATE };
}
