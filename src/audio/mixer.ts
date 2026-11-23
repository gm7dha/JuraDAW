/**
 * The mixer: the path every sound takes on its way out, the same for live
 * playing and for the mixdown.
 *
 *   each track:  input → its own effects (drive → crush → tone → [harmony voices] → filter → wobble → pump → chop) → its volume line
 *                      → volume (and mute/solo) → left–right → the mix
 *                                         ├→ its share to the reverb
 *                                         └→ its share to the echo
 *   the mix (with what the reverb and echo give back), turned down for
 *   headroom → master volume → a gentle limiter (so a loud moment is
 *   squeezed rather than crackling) → a ceiling nothing can pass → out
 *
 * There is one reverb (a room, made from a burst of fading noise) and one
 * echo (repeats in time with the tempo) shared by all the tracks. Changes
 * are eased in over a few thousandths of a second so nothing clicks.
 */
import { CHOP_OPEN_SHARE, HARMONY_STYLES, HIGHS_HZ, LOWS_HZ, PUMP_DIP_SECONDS, PUMP_SWELL_SHARE, TONE_DB, chopFloor, cutoffHz, effectsOf, filterIsOn, harmonySteps, stepRatio, pumpFloor, sweepAt, trackHasSweeps, type TrackEffects } from "../model/shaping";
import { lineBetween, lineOf, valueAt, volumeValueGain } from "../model/automation";
import type { AutoPoint, Clip, Harmony, Song, Track } from "../model/types";
import { audibleTracks } from "./schedule";
import { beatsToSeconds, clamp, seededRandom } from "./shared";

/** Seconds for a changed setting to get about two thirds of the way to its new value. */
const SMOOTH = 0.012;
/** The volume setting that leaves a sound exactly as loud as it was made. */
const USUAL_VOLUME = 0.8;
/**
 * Everything is turned down by this much on its way into the mix, to leave
 * room for several tracks playing together before the limiter has to act.
 */
const HEADROOM = 0.5;
/** How long the reverb rings, in seconds. */
const REVERB_SECONDS = 2.2;
/** How loud the reverb and the echo come back into the mix. */
const REVERB_RETURN = 2.1;
const ECHO_RETURN = 0.7;
/** How much of each echo goes round again. */
const ECHO_FEEDBACK = 0.4;
/** The longest echo the delay can hold, in seconds. */
const LONGEST_ECHO = 1.5;

/**
 * The limiter: it only acts on moments louder than about three quarters of
 * full, squeezing them hard. Browsers turn a compressor's output up by an
 * amount fixed by its settings ("make-up gain", ×1.148 for these);
 * LIMITER_TRIM turns it back down by the same, so anything quieter passes
 * through the limiter exactly as it was. (devkit/audio-check.mjs measures this.)
 */
const LIMITER = { threshold: -3, knee: 3, ratio: 20, attack: 0.003, release: 0.15 };
const LIMITER_TRIM = 1 / 1.148;

/**
 * The ceiling, after the limiter: the limiter needs a few thousandths of a
 * second to react, so a sudden peak can slip past it. The ceiling bends
 * anything above CEILING_KNEE smoothly over so the output can never reach
 * full scale (and a mixdown can never clip), and leaves everything below
 * untouched. It works on sound up to CEILING_RANGE times full scale.
 */
const CEILING_KNEE = 0.75;
const CEILING_TOP = 0.98;
const CEILING_RANGE = 4;

/** The limiter delays the sound by this long (its look-ahead), measured; the mixdown takes it off again. */
export const LIMITER_DELAY = 0.006;

/** What the ceiling does to one sample: unchanged up to the knee, then bent over towards CEILING_TOP, never reaching it. */
export function ceiling(sample: number): number {
  const size = Math.abs(sample);
  if (!(size > CEILING_KNEE)) return sample;
  const room = CEILING_TOP - CEILING_KNEE;
  return Math.sign(sample) * (CEILING_KNEE + room * Math.tanh((size - CEILING_KNEE) / room));
}

/** The ceiling as the table a WaveShaper wants: `points` values for inputs from −CEILING_RANGE to +CEILING_RANGE. */
export function ceilingCurve(points: number) {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) curve[i] = ceiling(((2 * i) / (points - 1) - 1) * CEILING_RANGE);
  return curve;
}

/** The quietest level a meter shows, in decibels below full. */
const METER_FLOOR_DB = 54;

/** How hard the drive pushes at its strongest (the steepness of its curve). */
const MOST_DRIVE = 28;
/** The wobble's two delays (seconds), how fast each drifts (times a second) and how far (seconds at full). */
const WOBBLE: [delay: number, rate: number, depth: number, pan: number][] = [
  [0.011, 0.37, 0.0035, -0.7],
  [0.017, 0.53, 0.0045, 0.7],
];

/** The drive's curve: gentle warmth at low settings, hard fuzz at high ones; full-scale in gives full-scale out. */
export function driveCurve(amount: number, points = 2049) {
  const k = 1 + MOST_DRIVE * amount * amount;
  const top = Math.tanh(k);
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) curve[i] = Math.tanh(k * ((2 * i) / (points - 1) - 1)) / top;
  return curve;
}

/** How much the drive is turned down afterwards, so more drive is more grit rather than simply louder. */
export function driveTrim(amount: number): number {
  const k = 1 + MOST_DRIVE * amount * amount;
  return Math.pow(Math.tanh(k) / k, 0.5);
}

/**
 * How many steps the crush leaves between silence and full scale, for an amount 0–1: from 160 (a slight grain)
 * down to 8. (A track's sound is usually well under full scale, so at 8 an ordinary note has only two or three
 * levels to sit on, and its quiet tail drops away to nothing.)
 */
export function crushSteps(amount: number): number {
  return 160 * Math.pow(8 / 160, clamp(amount, 0, 1));
}

/** The crush's curve: a staircase, so the smooth wave becomes a blocky one. */
export function crushCurve(amount: number, points = 8193) {
  const steps = crushSteps(amount);
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) curve[i] = Math.round(((2 * i) / (points - 1) - 1) * steps) / steps;
  return curve;
}

/** The filter's sharpness (Q) for a resonance setting 0–1. */
export function resonanceQ(resonance: number): number {
  return 0.7 + 15 * clamp(resonance, 0, 1) * clamp(resonance, 0, 1);
}

interface Wobble {
  wet: GainNode;
  depths: GainNode[];
  nodes: AudioNode[];
}

/** The harmoniser: a voice at each pitch any style uses, each with its own level. */
interface Harmoniser {
  voices: Map<number, GainNode>;
  nodes: AudioNode[];
}

/** How long a stretch each harmony voice repeats or skips at a time (seconds): longer is smoother, shorter is quicker to follow. */
export const HARMONY_WINDOW = 0.08;
/** Every pitch (semitones from the sound) any harmoniser style adds. */
const HARMONY_PITCHES = [...new Set(HARMONY_STYLES.flatMap((s) => s.steps))];

/**
 * How a harmony voice's delay moves (pure, for tests): to play `ratio` times faster, a delay that shortens by
 * (ratio − 1) seconds every second (or lengthens, for lower voices), jumping back by the whole window when it runs out.
 * `rate` is how many times a second it jumps; `sign` is +1 when the delay lengthens (a lower voice).
 */
export function harmonySweep(ratio: number, window = HARMONY_WINDOW): { rate: number; sign: 1 | -1 } {
  return { rate: Math.abs(1 - ratio) / window, sign: ratio < 1 ? 1 : -1 };
}

interface Strip {
  input: GainNode;
  /** The track's own effects, in order. */
  drive: WaveShaperNode;
  driveOut: GainNode;
  crush: WaveShaperNode;
  lows: BiquadFilterNode;
  highs: BiquadFilterNode;
  filter: BiquadFilterNode;
  pump: GainNode;
  chop: GainNode;
  /** The volume line, while the song plays (1 otherwise). */
  auto: GainNode;
  /** Made the first time the track's wobble is turned up. */
  wobble: Wobble | null;
  /** Made the first time the track's harmoniser is turned on. */
  harmony: Harmoniser | null;
  /** The settings last put into the two curves (making a curve is work, so only when they change). */
  driveNow: number;
  crushNow: number;
  fader: GainNode;
  pan: StereoPannerNode;
  reverbSend: GainNode;
  echoSend: GainNode;
  meter: AnalyserNode | null;
}

/** A volume setting (0–1, 0.8 = as made) as the gain to apply: a gentle curve, so the lower half of the slider is still useful. */
export function volumeToGain(volume: number): number {
  const share = clamp(volume, 0, 1) / USUAL_VOLUME;
  return share * share;
}

/** A reverb or echo setting (0–1) as a gain: a curve, so small settings give just a touch. */
function sendToGain(send: number): number {
  return Math.pow(clamp(send, 0, 1), 1.5);
}

/** The echo's delay for a tempo: a dotted eighth note (three quarters of a beat), halved if the tempo is so slow it wouldn't fit. */
export function echoSeconds(bpm: number): number {
  let seconds = beatsToSeconds(0.75, bpm);
  while (seconds > LONGEST_ECHO) seconds /= 2;
  return seconds;
}

/** The reverb's "impulse": what a clap would sound like in the room. Noise that fades and gets duller, different in each ear. */
function reverbImpulse(ctx: BaseAudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * REVERB_SECONDS);
  const buffer = ctx.createBuffer(2, length, rate);
  // A short gap before the room answers keeps the dry sound clear.
  const gap = Math.floor(rate * 0.012);
  const swell = Math.floor(rate * 0.006);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    const random = seededRandom(channel === 0 ? 1961 : 2087);
    let smooth = 0;
    for (let i = gap; i < length; i++) {
      const t = (i - gap) / rate;
      // The top of the sound dies away first, as in a real room.
      const openness = 0.12 + 0.6 * Math.exp(-t / 0.5);
      smooth += openness * (random() * 2 - 1 - smooth);
      const fadeIn = Math.min(1, (i - gap) / swell);
      // Falls by 60 dB over the length of the impulse.
      data[i] = smooth * fadeIn * Math.exp((-6.9 * t) / REVERB_SECONDS);
    }
  }
  return buffer;
}

/** A level 0–1 for a meter from the loudest recent sample: 0 dB = 1, METER_FLOOR_DB below = 0. */
export function meterLevel(peak: number): number {
  if (!(peak > 0)) return 0;
  return clamp(1 + (20 * Math.log10(peak)) / METER_FLOOR_DB, 0, 1);
}

export class Mixer {
  private readonly strips = new Map<string, Strip>();
  private readonly mix: GainNode;
  private readonly master: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly trim: GainNode;
  private readonly reverbIn: GainNode;
  private readonly echoIn: GainNode;
  private readonly echoDelay: DelayNode;
  private readonly masterMeter: AnalyserNode | null;
  /** Where a meter's recent samples are read into. */
  private readonly samples = new Float32Array(1024);
  private bpm = 0;
  /** True while the song is playing and the mixer is moving filters and pumping volumes in time with it. */
  private shaping = false;

  /** Where the metronome's clicks go: straight out, untouched by the master volume. */
  readonly clickInput: GainNode;

  /** `meters` adds the level meters (not needed for a mixdown). */
  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
    private readonly meters: boolean,
  ) {
    this.mix = ctx.createGain();
    this.mix.gain.value = HEADROOM;
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = LIMITER.threshold;
    this.limiter.knee.value = LIMITER.knee;
    this.limiter.ratio.value = LIMITER.ratio;
    this.limiter.attack.value = LIMITER.attack;
    this.limiter.release.value = LIMITER.release;
    this.trim = ctx.createGain();
    this.trim.gain.value = LIMITER_TRIM;
    // The ceiling: a WaveShaper reads its table for inputs −1…1, so the sound is scaled down into it.
    const intoCeiling = ctx.createGain();
    intoCeiling.gain.value = 1 / CEILING_RANGE;
    const top = ctx.createWaveShaper();
    // An odd number of points puts silence exactly on a point; the straight part of the table is exact in between.
    top.curve = ceilingCurve(16385);
    this.mix.connect(this.master).connect(this.limiter).connect(this.trim).connect(intoCeiling).connect(top).connect(destination);

    this.clickInput = ctx.createGain();
    this.clickInput.connect(destination);

    // The reverb.
    this.reverbIn = ctx.createGain();
    const reverb = ctx.createConvolver();
    reverb.buffer = reverbImpulse(ctx);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = REVERB_RETURN;
    this.reverbIn.connect(reverb).connect(reverbReturn).connect(this.mix);

    // The echo: a delay whose output goes round again, a little quieter and duller each time.
    this.echoIn = ctx.createGain();
    this.echoDelay = ctx.createDelay(LONGEST_ECHO + 0.1);
    const feedback = ctx.createGain();
    feedback.gain.value = ECHO_FEEDBACK;
    const duller = ctx.createBiquadFilter();
    duller.type = "lowpass";
    duller.frequency.value = 3000;
    const thinner = ctx.createBiquadFilter();
    thinner.type = "highpass";
    thinner.frequency.value = 180;
    const echoReturn = ctx.createGain();
    echoReturn.gain.value = ECHO_RETURN;
    this.echoIn.connect(this.echoDelay);
    this.echoDelay.connect(duller).connect(thinner).connect(feedback).connect(this.echoDelay);
    this.echoDelay.connect(echoReturn).connect(this.mix);

    this.masterMeter = meters ? this.makeMeter(top) : null;
  }

  private makeMeter(from: AudioNode): AnalyserNode {
    const meter = this.ctx.createAnalyser();
    meter.fftSize = 1024;
    from.connect(meter);
    return meter;
  }

  private makeStrip(): Strip {
    const ctx = this.ctx;
    const strip: Strip = {
      input: ctx.createGain(),
      drive: ctx.createWaveShaper(),
      driveOut: ctx.createGain(),
      crush: ctx.createWaveShaper(),
      lows: ctx.createBiquadFilter(),
      highs: ctx.createBiquadFilter(),
      filter: ctx.createBiquadFilter(),
      pump: ctx.createGain(),
      chop: ctx.createGain(),
      auto: ctx.createGain(),
      wobble: null,
      harmony: null,
      driveNow: 0,
      crushNow: 0,
      fader: ctx.createGain(),
      pan: ctx.createStereoPanner(),
      reverbSend: ctx.createGain(),
      echoSend: ctx.createGain(),
      meter: null,
    };
    // With no curve a WaveShaper passes sound through untouched, and an "allpass" filter leaves it sounding the same.
    strip.drive.oversample = "2x";
    strip.filter.type = "allpass";
    // The tone controls: shelves that lift or cut the low and the top end (0 dB = no change at all).
    strip.lows.type = "lowshelf";
    strip.lows.frequency.value = LOWS_HZ;
    strip.lows.gain.value = 0;
    strip.highs.type = "highshelf";
    strip.highs.frequency.value = HIGHS_HZ;
    strip.highs.gain.value = 0;
    strip.input.connect(strip.drive).connect(strip.driveOut).connect(strip.crush).connect(strip.lows).connect(strip.highs).connect(strip.filter).connect(strip.pump);
    strip.pump.connect(strip.chop).connect(strip.auto).connect(strip.fader).connect(strip.pan).connect(this.mix);
    strip.pan.connect(strip.reverbSend).connect(this.reverbIn);
    strip.pan.connect(strip.echoSend).connect(this.echoIn);
    if (this.meters) strip.meter = this.makeMeter(strip.pan);
    return strip;
  }

  /** Set a value: at once for something new, eased for a change while it may be sounding. */
  private set(param: AudioParam, value: number, atOnce: boolean): void {
    if (atOnce) param.value = value;
    else param.setTargetAtTime(value, this.ctx.currentTime, SMOOTH);
  }

  /** The wobble: two copies of the sound, each a few thousandths of a second late and drifting slowly in pitch, one to each side. */
  private makeWobble(strip: Strip): Wobble {
    const ctx = this.ctx;
    const wet = ctx.createGain();
    wet.gain.value = 0;
    const wobble: Wobble = { wet, depths: [], nodes: [wet] };
    for (const [seconds, rate, , pan] of WOBBLE) {
      const delay = ctx.createDelay(0.05);
      delay.delayTime.value = seconds;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const depth = ctx.createGain();
      depth.gain.value = 0;
      lfo.connect(depth).connect(delay.delayTime);
      lfo.start();
      const side = ctx.createStereoPanner();
      side.pan.value = pan;
      strip.filter.connect(delay).connect(side).connect(wet);
      wobble.depths.push(depth);
      wobble.nodes.push(delay, lfo, depth, side);
    }
    wet.connect(strip.pump);
    return wobble;
  }

  /**
   * The harmoniser: for each pitch, two copies of the sound read through delays that slide steadily, so they play
   * faster (higher) or slower (lower). When a delay runs out of room it jumps back, and the two take turns — each
   * fades out as it jumps and in as the other does — so the voice runs on smoothly.
   */
  private makeHarmoniser(strip: Strip): Harmoniser {
    const ctx = this.ctx;
    const harmony: Harmoniser = { voices: new Map(), nodes: [] };
    const saw = ctx.createPeriodicWave(new Float32Array(33), Float32Array.from({ length: 33 }, (_, n) => (n === 0 ? 0 : (2 / (Math.PI * n)) * (n % 2 ? 1 : -1))), { disableNormalization: true });
    const cos = ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]), { disableNormalization: true });
    const now = ctx.currentTime;
    for (const step of HARMONY_PITCHES) {
      const { rate, sign } = harmonySweep(stepRatio(step));
      const level = ctx.createGain();
      level.gain.value = 0;
      for (const half of [0, 0.5]) {
        // The delay slides from one end of the window to the other (a sawtooth: −1 → 1, its jump at half way).
        const delay = ctx.createDelay(HARMONY_WINDOW * 2 + 0.01);
        delay.delayTime.value = HARMONY_WINDOW / 2 + 0.002;
        const slide = ctx.createOscillator();
        slide.setPeriodicWave(saw);
        slide.frequency.value = rate;
        const reach = ctx.createGain();
        reach.gain.value = (sign * HARMONY_WINDOW) / 2;
        slide.connect(reach).connect(delay.delayTime);
        // Its loudness: silent at the jump (half way round), full a half turn from it.
        const fade = ctx.createGain();
        fade.gain.value = 0.5;
        const swell = ctx.createOscillator();
        swell.setPeriodicWave(cos);
        swell.frequency.value = rate;
        const swellDepth = ctx.createGain();
        swellDepth.gain.value = 0.5;
        swell.connect(swellDepth).connect(fade.gain);
        // The second copy half a turn behind the first, so one is always full while the other jumps.
        const start = now + half / rate;
        slide.start(start);
        swell.start(start);
        strip.highs.connect(delay).connect(fade).connect(level);
        harmony.nodes.push(delay, slide, reach, fade, swell, swellDepth);
      }
      level.connect(strip.filter);
      harmony.voices.set(step, level);
      harmony.nodes.push(level);
    }
    return harmony;
  }

  /** A track's own effects, as it has them now. */
  private applyEffects(strip: Strip, e: TrackEffects, harmony: Harmony | undefined, sweeps: boolean, atOnce: boolean): void {
    if (e.drive !== strip.driveNow) {
      strip.driveNow = e.drive;
      strip.drive.curve = e.drive > 0 ? driveCurve(e.drive) : null;
      this.set(strip.driveOut.gain, e.drive > 0 ? driveTrim(e.drive) : 1, atOnce);
    }
    if (e.crush !== strip.crushNow) {
      strip.crushNow = e.crush;
      strip.crush.curve = e.crush > 0 ? crushCurve(e.crush) : null;
    }
    // The filter is in use if the track has it on, or a clip on the track sweeps it.
    const on = filterIsOn(e.filter) || sweeps;
    const type: BiquadFilterType = !on ? "allpass" : e.filter.kind === "high" ? "highpass" : "lowpass";
    if (strip.filter.type !== type) strip.filter.type = type;
    this.set(strip.filter.Q, on ? resonanceQ(e.filter.resonance) : 0.7, atOnce);
    // While the song plays and a clip sweeps this filter, its place is set in time with the song (scheduleShaping).
    if (!(sweeps && this.shaping)) this.set(strip.filter.frequency, this.hz(e.filter.cutoff), atOnce);
    this.set(strip.lows.gain, e.lows * TONE_DB, atOnce);
    this.set(strip.highs.gain, e.highs * TONE_DB, atOnce);
    if (harmony && !strip.harmony) strip.harmony = this.makeHarmoniser(strip);
    if (strip.harmony) {
      const steps = harmony ? harmonySteps(harmony.style) : [];
      // Each added voice a little quieter when there are two, so the whole stays about as loud.
      const each = harmony ? (0.9 * harmony.amount) / Math.sqrt(steps.length) : 0;
      for (const [step, level] of strip.harmony.voices) this.set(level.gain, steps.includes(step) ? each : 0, atOnce);
    }
    if (e.chorus > 0 && !strip.wobble) strip.wobble = this.makeWobble(strip);
    if (strip.wobble) {
      this.set(strip.wobble.wet.gain, 0.45 * e.chorus, atOnce);
      strip.wobble.depths.forEach((depth, i) => this.set(depth.gain, WOBBLE[i][2] * (0.25 + 0.75 * e.chorus), atOnce));
    }
  }

  /** A cutoff setting as a frequency this context can make. */
  private hz(cutoff: number): number {
    return Math.min(cutoffHz(cutoff), this.ctx.sampleRate * 0.45);
  }

  /**
   * In time with the song, for the stretch between two beats (`timeOf` says when a beat falls on the sound clock):
   * the pump's dip on each beat, and the filter's place wherever a clip sweeps it. Call for every stretch played,
   * in order; `clipBeats` gives a clip's length in beats.
   */
  scheduleShaping(song: Song, from: number, to: number, timeOf: (beat: number) => number, clipBeats: (clip: Clip) => number): void {
    if (!(to > from)) return;
    this.shaping = true;
    const now = this.ctx.currentTime;
    for (const track of song.tracks) {
      const strip = this.strips.get(track.id);
      if (!strip) continue;
      const e = effectsOf(track);
      if (e.pump > 0) {
        const floor = pumpFloor(e.pump);
        const beatSeconds = beatsToSeconds(1, song.bpm);
        for (let beat = Math.ceil(from - 1e-9); beat < to - 1e-9; beat++) {
          const t = timeOf(beat);
          if (t < now) continue;
          strip.pump.gain.setValueAtTime(1, t);
          strip.pump.gain.linearRampToValueAtTime(floor, t + Math.min(PUMP_DIP_SECONDS, beatSeconds * 0.1));
          strip.pump.gain.linearRampToValueAtTime(1, t + beatSeconds * PUMP_SWELL_SHARE);
        }
      }
      if (e.chop > 0) {
        // Each sixteenth note: open for the first half, then cut down; the edges eased by a few thousandths of a second.
        const floor = chopFloor(e.chop);
        const step = beatsToSeconds(0.25, song.bpm);
        const edge = Math.min(0.004, step * 0.1);
        for (let k = Math.ceil(from * 4 - 1e-9); k < to * 4 - 1e-9; k++) {
          const t = timeOf(k / 4);
          if (t < now) continue;
          strip.chop.gain.setValueAtTime(floor, t);
          strip.chop.gain.linearRampToValueAtTime(1, t + edge);
          strip.chop.gain.setValueAtTime(1, t + step * CHOP_OPEN_SHARE);
          strip.chop.gain.linearRampToValueAtTime(floor, t + step * CHOP_OPEN_SHARE + edge);
        }
      }
      const start = Math.max(timeOf(from), now);
      const end = Math.max(timeOf(to), start + 0.001);
      /** Book a line's corners between the two beats on a setting: straight (or, for pitch-like settings, even-in-pitch) lines between them. */
      const follow = (param: AudioParam, corners: AutoPoint[], map: (value: number) => number, exponential = false) => {
        param.setValueAtTime(map(corners[0].value), start);
        for (const c of corners.slice(1)) {
          const t = Math.max(timeOf(c.beat), start + 0.001);
          if (exponential) param.exponentialRampToValueAtTime(map(c.value), Math.min(t, end));
          else param.linearRampToValueAtTime(map(c.value), Math.min(t, end));
        }
      };
      // The volume line takes the place of the track's own volume while it plays.
      const volume = lineOf(track, "volume");
      if (volume) {
        const own = Math.max(volumeToGain(track.volume), 1e-4);
        follow(strip.auto.gain, lineBetween(volume, from, to), (v) => Math.min(16, volumeValueGain(v) / own));
      }
      const pan = lineOf(track, "pan");
      if (pan) follow(strip.pan.pan, lineBetween(pan, from, to), (v) => v * 2 - 1);
      // The filter: a clip's sweep where there is one, else the filter line, else where the track has it.
      const filterLine = lineOf(track, "filter");
      if (filterLine || trackHasSweeps(song, track.id)) {
        const corners = new Set<number>([from, to]);
        if (filterLine) for (const p of lineBetween(filterLine, from, to)) corners.add(p.beat);
        for (const c of song.clips) {
          if (c.trackId !== track.id || !c.sweep) continue;
          for (const b of [c.start, c.start + clipBeats(c)]) if (b > from && b < to) corners.add(b);
        }
        const at = (beat: number) => sweepAt(song, track.id, beat, clipBeats) ?? (filterLine ? valueAt(filterLine, beat) : e.filter.cutoff);
        const beats = [...corners].sort((x, y) => x - y);
        follow(strip.filter.frequency, beats.map((beat, i) => ({ beat, value: at(i === beats.length - 1 ? beat - 1e-6 : beat) })), (v) => this.hz(v), true);
      }
    }
  }

  /** The song has stopped: let go of everything booked in time with it, and put the filters back where the tracks have them. */
  releaseShaping(song: Song): void {
    if (!this.shaping) return;
    this.shaping = false;
    const now = this.ctx.currentTime;
    for (const track of song.tracks) {
      const strip = this.strips.get(track.id);
      if (!strip) continue;
      strip.pump.gain.cancelScheduledValues(now);
      strip.pump.gain.setTargetAtTime(1, now, SMOOTH);
      strip.chop.gain.cancelScheduledValues(now);
      strip.chop.gain.setTargetAtTime(1, now, SMOOTH);
      strip.filter.frequency.cancelScheduledValues(now);
      strip.filter.frequency.setTargetAtTime(this.hz(effectsOf(track).filter.cutoff), now, SMOOTH);
      strip.auto.gain.cancelScheduledValues(now);
      strip.auto.gain.setTargetAtTime(1, now, SMOOTH);
      strip.pan.pan.cancelScheduledValues(now);
      strip.pan.pan.setTargetAtTime(clamp(track.pan, -1, 1), now, SMOOTH);
    }
  }

  private applyTrack(strip: Strip, track: Track, audible: boolean, atOnce: boolean): void {
    this.set(strip.fader.gain, audible ? volumeToGain(track.volume) : 0, atOnce);
    // While the song plays, a left–right line moves it (scheduleShaping), so the track's own place mustn't fight it.
    if (!(this.shaping && lineOf(track, "pan"))) this.set(strip.pan.pan, clamp(track.pan, -1, 1), atOnce);
    this.set(strip.reverbSend.gain, sendToGain(track.reverb), atOnce);
    this.set(strip.echoSend.gain, sendToGain(track.echo), atOnce);
  }

  /**
   * Make the mixer match the song: a strip for each track with its volume,
   * left–right, mute/solo and effect shares, the master volume, and the
   * echo's timing for the tempo. Call whenever the song changes.
   */
  sync(song: Song): void {
    const audible = audibleTracks(song);
    for (const track of song.tracks) {
      let strip = this.strips.get(track.id);
      const isNew = !strip;
      if (!strip) this.strips.set(track.id, (strip = this.makeStrip()));
      this.applyTrack(strip, track, audible.has(track.id), isNew);
      this.applyEffects(strip, effectsOf(track), track.harmony, trackHasSweeps(song, track.id) || !!lineOf(track, "filter"), isNew);
    }
    for (const [id, strip] of this.strips) {
      if (song.tracks.some((t) => t.id === id)) continue;
      this.strips.delete(id);
      // Fade it out, then take it apart a moment later, so a track removed while sounding doesn't click.
      strip.fader.gain.setTargetAtTime(0, this.ctx.currentTime, SMOOTH);
      const takeApart = () => {
        for (const node of [strip.input, strip.drive, strip.driveOut, strip.crush, strip.lows, strip.highs, strip.filter, strip.pump, strip.chop, strip.auto, strip.fader, strip.pan, strip.reverbSend, strip.echoSend, ...(strip.wobble?.nodes ?? []), ...(strip.harmony?.nodes ?? [])]) node.disconnect();
      };
      if (this.meters) setTimeout(takeApart, 150);
      else takeApart();
    }
    const first = this.bpm === 0;
    this.set(this.master.gain, volumeToGain(song.master), first);
    if (song.bpm !== this.bpm) {
      this.bpm = song.bpm;
      // Eased a little more slowly: a delay that jumps makes a zip noise.
      if (first) this.echoDelay.delayTime.value = echoSeconds(song.bpm);
      else this.echoDelay.delayTime.setTargetAtTime(echoSeconds(song.bpm), this.ctx.currentTime, 0.05);
    }
  }

  /** Where a track's notes and sounds are played into; null if the song has no such track. */
  input(trackId: string): AudioNode | null {
    return this.strips.get(trackId)?.input ?? null;
  }

  /** Loudness right now for a meter, 0–1, of a track (after its volume) or of "master". */
  level(id: string): number {
    const meter = id === "master" ? this.masterMeter : this.strips.get(id)?.meter;
    if (!meter) return 0;
    meter.getFloatTimeDomainData(this.samples);
    let peak = 0;
    for (let i = 0; i < this.samples.length; i++) {
      const v = Math.abs(this.samples[i]);
      if (v > peak) peak = v;
    }
    return meterLevel(peak);
  }

}
