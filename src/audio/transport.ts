/**
 * The transport: plays the song in time. A timer wakes every few
 * hundredths of a second and schedules, on the sound card's own very exact
 * clock, everything that should start in the next tenth of a second or so
 * (the usual "look-ahead" way of keeping steady time in a browser). Because
 * it asks the song afresh each time, edits and tempo changes are heard
 * while it plays, and a loop goes round without a gap.
 */
import type { AudioClip, Song, Track } from "../model/types";
import type { Sound } from "./audioStore";
import { instrumentById } from "./instruments";
import { playClick } from "./metronome";
import type { Mixer } from "./mixer";
import { audioClipsBetween, loopIsUsable, nextLoopWindow, notesBetween, playEndBeat, type AudioEvent } from "./schedule";
import { beatsToSeconds, clamp, secondsToBeats } from "./shared";
import type { Voice } from "./voice";

/** How often the timer wakes, in milliseconds. */
const TICK_MS = 25;
/** How far ahead things are scheduled, in seconds. */
const LOOK_AHEAD = 0.12;
/** If the timer is held up (a busy page, a hidden tab), look ahead further, up to this. */
const LONGEST_LOOK_AHEAD = 2.5;
/** Things this late are skipped rather than played out of time. */
const TOO_LATE = 0.05;
/** The most notes sounding at once from the song; beyond it the oldest are cut. */
const MOST_VOICES = 128;
/** Sound clips fade in and out over this long, so they never start or end with a click. */
const CLIP_FADE = 0.004;
/** The most stretches scheduled in one go (a guard against a broken loop spinning for ever). */
const MOST_WINDOWS = 4000;

/** What the transport needs from the engine. */
export interface TransportHost {
  ctx: AudioContext;
  mixer: Mixer;
  song(): Song;
  metronome(): boolean;
  sound(audioId: string): Sound | undefined;
  /** Called when the song has run out and playing should stop by itself. */
  onRunOut(): void;
}

export interface StartOptions {
  /** Go round the loop when the song's loop is on (not while recording). */
  loop: boolean;
  /** Stop by itself a bar after the end of the song (not while recording). */
  runOut: boolean;
}

/** From `time` on the sound clock, the playhead is at `beat` and moving at `bpm`. */
interface Segment {
  time: number;
  beat: number;
  bpm: number;
}

/**
 * A sound clip that has been started on this lap of the loop. It's remembered after it has finished too, until the
 * next lap, Stop, or a change to the clip, so a clip is only ever started once a lap however the tempo changes.
 */
interface PlayingClip {
  signature: string;
  /** Which time round the loop it was started on. */
  lap: number;
  endTime: number;
  source: AudioBufferSourceNode;
  level: GainNode;
  gain: number;
}

/** What makes a clip the same clip for playing purposes: if any of this changes, it's started afresh. */
function signatureOf(clip: AudioClip): string {
  return `${clip.trackId}|${clip.audioId}|${clip.start}|${clip.offset}|${clip.duration}`;
}

export class Transport {
  private timer: ReturnType<typeof setInterval> | null = null;
  private options: StartOptions = { loop: true, runOut: true };
  private segments: Segment[] = [];
  /** Everything before this beat has been scheduled; it falls at `nextTime` on the sound clock. */
  private nextBeat = 0;
  private nextTime = 0;
  private bpm = 120;
  private startBeat = 0;
  private startedTime = 0;
  private lastTick = 0;
  private stoppedAt = 0;
  /** How many times playing has gone back to the start of the loop. */
  private lap = 0;
  private readonly voices = new Set<Voice>();
  private readonly clips = new Map<string, PlayingClip>();

  constructor(private readonly host: TransportHost) {}

  get playing(): boolean {
    return this.timer !== null;
  }

  /** Start playing from a beat, at a time on the sound clock (a little ahead of now, or later for a count-in). */
  start(fromBeat: number, atTime: number, options: StartOptions): void {
    this.stop();
    const song = this.host.song();
    this.options = options;
    this.bpm = song.bpm;
    this.startBeat = fromBeat;
    this.startedTime = atTime;
    this.lap = 0;
    this.nextBeat = fromBeat;
    this.nextTime = atTime;
    this.segments = [{ time: atTime, beat: fromBeat, bpm: song.bpm }];
    this.lastTick = this.host.ctx.currentTime;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  /** Stop, silencing everything the song was playing. The playhead stays where it was (or goes to `leaveAt`). */
  stop(leaveAt?: number): void {
    if (this.timer === null) {
      if (leaveAt !== undefined) this.stoppedAt = leaveAt;
      return;
    }
    this.stoppedAt = leaveAt ?? this.position();
    clearInterval(this.timer);
    this.timer = null;
    const now = this.host.ctx.currentTime;
    for (const voice of this.voices) voice.silence(now);
    this.voices.clear();
    for (const clip of this.clips.values()) this.endClip(clip, now);
    this.clips.clear();
    this.segments = [];
  }

  /** Where Play last started from. */
  get startedAt(): number {
    return this.startBeat;
  }

  /** When the song starts (or started) moving, on the sound clock: later than "now" during a count-in. */
  get startTime(): number {
    return this.startedTime;
  }

  /** How long sound takes to get from the sound clock to the ears, as far as the browser can tell. */
  outputLatency(): number {
    const ctx = this.host.ctx;
    const latency = ctx.outputLatency || ctx.baseLatency || 0;
    return isFinite(latency) ? clamp(latency, 0, 0.25) : 0;
  }

  /** Where the playhead is, in beats: what's being heard right now while playing, the last place when stopped. */
  position(): number {
    if (this.timer === null) return this.stoppedAt;
    const heard = this.host.ctx.currentTime - this.outputLatency();
    let at: Segment | null = null;
    for (const segment of this.segments) {
      if (segment.time <= heard) at = segment;
      else break;
    }
    if (!at) return this.startBeat;
    const beat = at.beat + secondsToBeats(heard - at.time, at.bpm);
    // If the timer has been held up, don't run on past what's been scheduled.
    return at === this.segments[this.segments.length - 1] && heard > this.nextTime ? Math.min(beat, this.nextBeat) : beat;
  }

  /** The song has changed: stop sound clips that were removed or moved, and follow changes to their loudness. */
  songChanged(song: Song): void {
    if (this.timer === null || this.clips.size === 0) return;
    const now = this.host.ctx.currentTime;
    for (const [clipId, playing] of this.clips) {
      const clip = song.clips.find((c) => c.id === clipId);
      if (!clip || clip.kind !== "audio" || signatureOf(clip) !== playing.signature) {
        this.endClip(playing, now);
        this.clips.delete(clipId);
      } else if (clip.gain !== playing.gain && playing.endTime - now > 0.1) {
        // Ease to the new loudness, and book the fade-out at the clip's end again (cancelling dropped it).
        const gain = clamp(clip.gain, 0, 2);
        playing.gain = clip.gain;
        playing.level.gain.cancelScheduledValues(now);
        playing.level.gain.setTargetAtTime(gain, now, 0.015);
        playing.level.gain.setValueAtTime(gain, playing.endTime - CLIP_FADE);
        playing.level.gain.linearRampToValueAtTime(0, playing.endTime);
      }
    }
  }

  private endClip(clip: PlayingClip, now: number): void {
    clip.level.gain.cancelScheduledValues(now);
    clip.level.gain.setTargetAtTime(0, now, CLIP_FADE);
    try {
      clip.source.stop(now + CLIP_FADE * 8);
    } catch {
      // Already over.
    }
  }

  /**
   * Schedule as far ahead as is ever allowed, at once: called when the page is hidden, because some browsers then
   * hold the timer up for a second or more at a time.
   */
  lookFarAhead(): void {
    if (this.timer !== null) this.tick(LONGEST_LOOK_AHEAD);
  }

  /** One wake-up of the timer: schedule everything up to the look-ahead (or `atLeast` seconds ahead). */
  private tick(atLeast = 0): void {
    const { ctx } = this.host;
    const song = this.host.song();
    const now = ctx.currentTime;
    // The later the timer was this time, the further ahead we look, so a slow page doesn't leave holes.
    const late = now - this.lastTick;
    this.lastTick = now;
    const horizon = now + clamp(Math.max(atLeast, late * 1.5 + 0.05), LOOK_AHEAD, LONGEST_LOOK_AHEAD);

    // A new tempo takes over from the first beat not yet scheduled, so the playhead doesn't jump.
    if (song.bpm !== this.bpm) {
      this.bpm = song.bpm;
      this.segments.push({ time: this.nextTime, beat: this.nextBeat, bpm: song.bpm });
    }

    const looping = this.options.loop && loopIsUsable(song.loop);
    const end = this.options.runOut ? playEndBeat(song) : null;
    for (let i = 0; this.nextTime < horizon && i < MOST_WINDOWS; i++) {
      const span = secondsToBeats(horizon - this.nextTime, this.bpm);
      const inLoop = looping && this.nextBeat < song.loop.end;
      const window = inLoop ? nextLoopWindow(song.loop, this.nextBeat, span) : { from: this.nextBeat, to: this.nextBeat + span, next: this.nextBeat + span, wrapped: false };
      this.scheduleWindow(song, window.from, window.to, this.nextTime, inLoop ? song.loop.end : undefined, now);
      this.nextTime += beatsToSeconds(window.to - window.from, this.bpm);
      this.nextBeat = window.next;
      if (window.wrapped) {
        this.lap++;
        this.segments.push({ time: this.nextTime, beat: this.nextBeat, bpm: this.bpm });
      }
    }

    // Forget the stretches long past (keeping the one the playhead is in).
    while (this.segments.length > 1 && this.segments[1].time < now - 1) this.segments.shift();

    if (end !== null && !(looping && this.position() < song.loop.end) && this.startBeat < end && this.position() >= end) this.host.onRunOut();
  }

  /** Schedule what starts between two beats; `time` is when `from` falls on the sound clock. */
  private scheduleWindow(song: Song, from: number, to: number, time: number, cutAt: number | undefined, now: number): void {
    const { ctx, mixer } = this.host;
    const timeOf = (beat: number) => time + beatsToSeconds(beat - from, this.bpm);
    const tracks = new Map<string, Track>(song.tracks.map((t) => [t.id, t]));

    for (const note of notesBetween(song, from, to, { cutAt, everyTrack: true })) {
      const when = timeOf(note.beat);
      const track = tracks.get(note.trackId);
      const input = mixer.input(note.trackId);
      if (!track || !input || when < now - TOO_LATE) continue;
      const voice = instrumentById(track.instrument).startVoice(ctx, input, note.pitch, note.velocity, when);
      voice.stop(Math.max(when, now) + beatsToSeconds(note.lengthBeats, this.bpm));
      this.track(voice);
    }

    for (const event of audioClipsBetween(song, from, to, { running: true, cutAt, everyTrack: true })) {
      this.startClip(event, timeOf(event.beat), now);
    }

    if (this.host.metronome()) {
      for (let beat = Math.ceil(from); beat < to; beat++) {
        const when = timeOf(beat);
        if (when < now - TOO_LATE) continue;
        this.track(playClick(ctx, mixer.clickInput, when, beat % song.beatsPerBar === 0));
      }
    }
  }

  /** Remember a voice until it ends, so Stop can silence it; too many at once and the oldest go. */
  private track(voice: Voice): void {
    this.voices.add(voice);
    voice.onended = () => this.voices.delete(voice);
    if (this.voices.size > MOST_VOICES) {
      const oldest = this.voices.values().next().value;
      if (oldest) {
        oldest.silence(this.host.ctx.currentTime);
        this.voices.delete(oldest);
      }
    }
  }

  /** Start a stretch of a sound clip, unless that clip is already playing as it should be. */
  private startClip(event: AudioEvent, when: number, now: number): void {
    const { ctx, mixer } = this.host;
    const clip = this.host.song().clips.find((c) => c.id === event.clipId);
    const sound = this.host.sound(event.audioId);
    const input = mixer.input(event.trackId);
    if (!clip || clip.kind !== "audio" || !sound || !input) return;

    const signature = signatureOf(clip);
    const playing = this.clips.get(event.clipId);
    // Already started on this lap (whether it's still sounding or has finished): leave it be.
    if (playing && playing.signature === signature && playing.lap === this.lap) return;

    // If we're late, start further into the sound rather than out of time.
    const start = Math.max(when, now);
    const offset = event.offset + (start - when);
    const duration = Math.min(event.duration - (start - when), sound.buffer.duration - offset);
    if (!(duration > CLIP_FADE * 2)) return;
    // An earlier lap's sound that would carry on is faded out; one ending here anyway has its own fade-out booked.
    if (playing && playing.endTime > start + CLIP_FADE) this.endClip(playing, start);

    const source = ctx.createBufferSource();
    source.buffer = sound.buffer;
    const level = ctx.createGain();
    const gain = clamp(event.gain, 0, 2);
    level.gain.setValueAtTime(0, start);
    level.gain.linearRampToValueAtTime(gain, start + CLIP_FADE);
    level.gain.setValueAtTime(gain, start + duration - CLIP_FADE);
    level.gain.linearRampToValueAtTime(0, start + duration);
    source.connect(level).connect(input);
    source.start(start, offset, duration);

    const entry: PlayingClip = { signature, lap: this.lap, endTime: start + duration, source, level, gain: event.gain };
    this.clips.set(event.clipId, entry);
    source.onended = () => {
      source.disconnect();
      level.disconnect();
    };
  }
}
