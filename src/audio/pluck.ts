/**
 * The plucked-string sound (pure): the Karplus–Strong method. A burst of
 * noise goes round and round a delay as long as one cycle of the note,
 * gently smoothed each time round, and comes out sounding like a string
 * that's been plucked. The samples are worked out here and played as a
 * recording, because Web Audio's own delay can't make a loop that short.
 */
import { clamp, seededRandom } from "./shared";

/** Where along the string it's plucked (0–0.5): nearer the end is brighter. */
const PLUCK_PLACE = 0.2;

/** How much of the note's fading is done by smoothing the wave (which dulls it) rather than just turning it down. */
const SMOOTHING_SHARE = 0.4;

/** How long the note takes to die away (seconds to fall to about a third): long for low strings, short for high. */
export function pluckDecay(frequency: number): number {
  return clamp(1.6 * Math.pow(65 / frequency, 0.45), 0.25, 2.5);
}

/**
 * A plucked note: mono samples, loudest about 1. `brightness` 0–1 is how hard
 * it was plucked (harder = more top).
 */
export function pluckSamples(frequency: number, sampleRate: number, brightness: number): Float32Array {
  const f = clamp(frequency, 20, sampleRate * 0.4);
  const tau = pluckDecay(f);
  const length = Math.floor(Math.min(4, tau * 7) * sampleRate);
  const out = new Float32Array(length);

  // Each time round, the wave is smoothed by mixing in a little of the sample before:
  // out = (1 − s)·x + s·previous. More smoothing (s up to ½) = a faster fade, most of all at the top.
  const omega = (2 * Math.PI * f) / sampleRate;
  const perCycle = Math.exp(-1 / (f * tau));
  // Near the fundamental the smoothing loses about s(1 − s)·ω²/2 each time round. Only part of the fade is
  // left to the smoothing, or high notes would lose all their brightness at once.
  const wanted = (SMOOTHING_SHARE * 2 * (1 - perCycle)) / (omega * omega);
  const s = wanted >= 0.25 ? 0.5 : (1 - Math.sqrt(1 - 4 * wanted)) / 2;
  const smoothGain = Math.sqrt((1 - s) * (1 - s) + s * s + 2 * s * (1 - s) * Math.cos(omega));
  // The rest of the fade is a plain turn-down.
  const turnDown = Math.min(1, perCycle / smoothGain);
  // The smoothing also delays the wave a little; the loop is made that much shorter to stay in tune.
  const smoothDelay = Math.atan2(s * Math.sin(omega), 1 - s + s * Math.cos(omega)) / omega;

  // The loop must be exactly one cycle long: a whole number of samples plus a fraction, which an "all-pass" step supplies.
  const period = sampleRate / f;
  let whole = Math.floor(period - smoothDelay);
  let fraction = period - smoothDelay - whole;
  if (fraction < 0.1 && whole > 1) {
    whole -= 1;
    fraction += 1;
  }
  whole = Math.max(1, whole);
  // The all-pass setting that delays the note's own frequency by exactly that fraction (the usual short cut,
  // (1 − d)/(1 + d), is only right for low notes and leaves high ones several cents out).
  const allPass = Math.sin(((1 - fraction) * omega) / 2) / Math.sin(((1 + fraction) * omega) / 2);

  // The pluck itself: the string pulled into a triangle a fifth of the way along (which gives every note the same
  // clear, even tone), roughened with a little noise — more of it the harder the pluck, for a brighter sound.
  const random = seededRandom(Math.round(f * 100) + 7);
  const line = new Float32Array(whole);
  const hard = clamp(brightness, 0, 1);
  const pulled = Math.max(1, whole * PLUCK_PLACE);
  let rough = 0;
  let mean = 0;
  for (let i = 0; i < whole; i++) {
    const shape = i < pulled ? i / pulled : (whole - i) / (whole - pulled);
    rough += (0.2 + 0.5 * hard) * (random() * 2 - 1 - rough);
    line[i] = shape * 2 - 1 + rough * (0.25 + 0.75 * hard);
    mean += line[i];
  }
  mean /= whole;
  for (let i = 0; i < whole; i++) line[i] -= mean;

  let at = 0;
  let previous = 0;
  let allPassIn = 0;
  let allPassOut = 0;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const x = line[at];
    out[i] = x;
    if (Math.abs(x) > peak) peak = Math.abs(x);
    const smoothed = (1 - s) * x + s * previous;
    previous = x;
    const tuned = allPass * smoothed + allPassIn - allPass * allPassOut;
    allPassIn = smoothed;
    allPassOut = tuned;
    line[at] = tuned * turnDown;
    at = at + 1 === whole ? 0 : at + 1;
  }

  // Even out the level, and fade the very end so it never stops with a click.
  const scale = peak > 0 ? 1 / peak : 0;
  const fade = Math.min(length, Math.floor(sampleRate * 0.03));
  for (let i = 0; i < length; i++) {
    const tail = length - i;
    out[i] *= tail < fade ? (scale * tail) / fade : scale;
  }
  return out;
}

/** How many plucked notes are kept ready. */
const MOST_KEPT = 32;
const kept = new Map<string, AudioBuffer>();

/**
 * A plucked note as a buffer ready to play. Notes are kept (the most
 * recently used few) so a repeated note costs nothing the second time.
 */
export function pluckBuffer(ctx: BaseAudioContext, pitch: number, frequency: number, brightness: number): AudioBuffer {
  const step = Math.round(clamp(brightness, 0, 1) * 3);
  const key = `${ctx.sampleRate}:${pitch}:${step}`;
  let buffer = kept.get(key);
  if (buffer) {
    // Move it to the back of the queue: it's the most recently used.
    kept.delete(key);
  } else {
    const samples = pluckSamples(frequency, ctx.sampleRate, step / 3);
    buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    if (kept.size >= MOST_KEPT) kept.delete(kept.keys().next().value as string);
  }
  kept.set(key, buffer);
  return buffer;
}
