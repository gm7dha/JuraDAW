/**
 * Small helpers the sound code shares: beats and seconds, note numbers and
 * frequencies, how hard a note was played, and the one buffer of noise each
 * sound context keeps (drums, the piano's hammer and the reverb all use noise).
 */

/** Keep a number between two others. */
export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** How long a number of beats lasts at a tempo, in seconds. */
export function beatsToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm;
}

/** How many beats go by in a number of seconds at a tempo. */
export function secondsToBeats(seconds: number, bpm: number): number {
  return (seconds * bpm) / 60;
}

/** The frequency of a MIDI note in hertz (69 = the A above middle C = 440 Hz). */
export function midiToHz(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

/** Velocity (1–127) as a share, 0–1. */
export function velocityShare(velocity: number): number {
  return clamp(velocity, 1, 127) / 127;
}

/** How loud a note of a velocity is: soft notes are clearly softer, without disappearing. */
export function velocityGain(velocity: number): number {
  return Math.pow(velocityShare(velocity), 1.5);
}

/** How bright a note of a velocity is, 0.4 (soft) … 1 (hard): instruments open their filters with it. */
export function velocityBrightness(velocity: number): number {
  return 0.4 + 0.6 * velocityShare(velocity);
}

/**
 * Random numbers 0–1 that come out the same every time for the same seed
 * (mulberry32), so the same song always sounds the same, live and mixed down.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Two seconds of white noise, made once for each sound context and shared by everything that needs noise. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    const length = Math.floor(ctx.sampleRate * 2);
    buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const random = seededRandom(20240607);
    for (let i = 0; i < length; i++) data[i] = random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}
