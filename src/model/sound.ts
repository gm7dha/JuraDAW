/**
 * "Your own sound" (pure): the settings of the simple synth a track can play (instrument "custom"), their usual
 * values, some ready-made starting points, and how each friendly setting turns into numbers for the sound engine.
 */
import type { CustomSound } from "./types";

export const CUSTOM_INSTRUMENT = "custom";

export const SOUND_WAVES: readonly { wave: CustomSound["wave"]; name: string; hint: string }[] = [
  { wave: "smooth", name: "Smooth", hint: "A pure, round tone, like a whistle or a flute" },
  { wave: "soft", name: "Soft", hint: "A gentle tone with a little edge, like an ocarina" },
  { wave: "hollow", name: "Hollow", hint: "A hollow, reedy tone, like a clarinet or an old games console" },
  { wave: "bright", name: "Bright", hint: "A bright, buzzy tone, like brass or a classic synth" },
];

export const DEFAULT_SOUND: CustomSound = { wave: "bright", brightness: 0.55, fadeIn: 0.05, hold: 0.7, ringOn: 0.2, thickness: 0.3, bassLayer: 0, vibrato: 0 };

/** Starting points to change from. */
export const SOUND_PRESETS: readonly { name: string; sound: CustomSound }[] = [
  { name: "Warm pad", sound: { wave: "bright", brightness: 0.35, fadeIn: 0.55, hold: 0.9, ringOn: 0.55, thickness: 0.7, bassLayer: 0.2, vibrato: 0 } },
  { name: "Lead", sound: { wave: "bright", brightness: 0.7, fadeIn: 0.02, hold: 0.85, ringOn: 0.15, thickness: 0.25, bassLayer: 0, vibrato: 0.35 } },
  { name: "Pluck", sound: { wave: "hollow", brightness: 0.6, fadeIn: 0, hold: 0, ringOn: 0.25, thickness: 0.2, bassLayer: 0, vibrato: 0 } },
  { name: "Deep bass", sound: { wave: "soft", brightness: 0.3, fadeIn: 0, hold: 0.8, ringOn: 0.1, thickness: 0.1, bassLayer: 0.8, vibrato: 0 } },
  { name: "Whistle", sound: { wave: "smooth", brightness: 1, fadeIn: 0.1, hold: 1, ringOn: 0.2, thickness: 0, bassLayer: 0, vibrato: 0.45 } },
  { name: "Retro beep", sound: { wave: "hollow", brightness: 1, fadeIn: 0, hold: 0.6, ringOn: 0.05, thickness: 0, bassLayer: 0, vibrato: 0 } },
];

const share = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, Math.round(v * 1e6) / 1e6)) : fallback);

/** Settings made safe (each missing or odd one the usual value), or undefined when it isn't settings at all. */
export function cleanSound(v: unknown): CustomSound | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const wave = SOUND_WAVES.some((w) => w.wave === o.wave) ? (o.wave as CustomSound["wave"]) : DEFAULT_SOUND.wave;
  return {
    wave,
    brightness: share(o.brightness, DEFAULT_SOUND.brightness),
    fadeIn: share(o.fadeIn, DEFAULT_SOUND.fadeIn),
    hold: share(o.hold, DEFAULT_SOUND.hold),
    ringOn: share(o.ringOn, DEFAULT_SOUND.ringOn),
    thickness: share(o.thickness, DEFAULT_SOUND.thickness),
    bassLayer: share(o.bassLayer, DEFAULT_SOUND.bassLayer),
    vibrato: share(o.vibrato, DEFAULT_SOUND.vibrato),
  };
}

/** A track's own sound, or the usual one. */
export function soundOf(track: { sound?: CustomSound }): CustomSound {
  return track.sound ?? DEFAULT_SOUND;
}

/** Whether two sounds are the same. */
export function sameSound(a: CustomSound, b: CustomSound): boolean {
  return (Object.keys(DEFAULT_SOUND) as (keyof CustomSound)[]).every((k) => a[k] === b[k]);
}

/** The numbers the engine builds a note from. */
export interface SoundNumbers {
  /** Seconds to swell in. */
  attack: number;
  /** Seconds (to fall about two thirds of the way) towards the held level. */
  decay: number;
  /** The level held while the note is held, 0–1. */
  sustain: number;
  /** Seconds to die away after the note ends. */
  release: number;
  /** The filter's place as a multiple of the note's pitch (the top is let through above about 40 times). */
  cutoffTimes: number;
  /** How far apart the copies are, in cents (hundredths of a semitone); 0 = one copy. */
  detune: number;
  /** The octave below's level. */
  sub: number;
  /** How far the pitch wobbles, in cents. */
  vibrato: number;
  /** Evens out the waves' loudness (a hollow or bright wave is louder than a smooth one). */
  waveLevel: number;
}

export function soundNumbers(sound: CustomSound): SoundNumbers {
  return {
    attack: 0.003 + 2 * sound.fadeIn * sound.fadeIn,
    decay: 0.15 + 1.2 * (1 - sound.hold),
    sustain: sound.hold,
    release: 0.03 + 3 * sound.ringOn * sound.ringOn,
    cutoffTimes: 1.5 * Math.pow(30, sound.brightness),
    detune: 25 * sound.thickness,
    sub: 0.8 * sound.bassLayer,
    vibrato: 35 * sound.vibrato,
    waveLevel: { smooth: 0.49, soft: 0.6, hollow: 0.41, bright: 0.75 }[sound.wave],
  };
}

/** A sound in a few words, for describe_song. */
export function soundWords(sound: CustomSound): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return `${sound.wave} wave, brightness ${pct(sound.brightness)}, fade in ${pct(sound.fadeIn)}, hold ${pct(sound.hold)}, ring on ${pct(sound.ringOn)}, thickness ${pct(sound.thickness)}, bass layer ${pct(sound.bassLayer)}, vibrato ${pct(sound.vibrato)}`;
}
