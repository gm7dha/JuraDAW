/**
 * The drum kit. Like the instruments, every hit is made on the spot: sine
 * waves that drop in pitch for the kick and toms, noise for the snare, clap
 * and shaker, and a cluster of clashing square waves for the metal of the
 * cymbals and cowbell (the way classic drum machines did it).
 */
import { Patch } from "./patch";
import { velocityBrightness, velocityGain } from "./shared";
import { makeVoice, silentVoice, type OneShotVoice, type Voice, type VoiceParts } from "./voice";

/** The drums and the keys they're on (the usual MIDI drum notes). */
export const DRUM_MAP: readonly { pitch: number; name: string }[] = [
  { pitch: 36, name: "Kick" },
  { pitch: 37, name: "Rim" },
  { pitch: 38, name: "Snare" },
  { pitch: 39, name: "Clap" },
  { pitch: 41, name: "Low tom" },
  { pitch: 42, name: "Closed hat" },
  { pitch: 45, name: "Mid tom" },
  { pitch: 46, name: "Open hat" },
  { pitch: 48, name: "High tom" },
  { pitch: 49, name: "Crash" },
  { pitch: 51, name: "Ride" },
  { pitch: 56, name: "Cowbell" },
  { pitch: 70, name: "Shaker" },
];

/** Other standard drum notes (as found in MIDI files) and the drum of ours that plays instead. */
const SAME_AS: Record<number, number> = { 35: 36, 40: 38, 43: 41, 44: 42, 47: 45, 50: 48, 52: 49, 53: 51, 54: 70, 55: 49, 57: 49, 59: 51, 69: 70, 82: 70 };

const CLOSED_HAT = 42;
const OPEN_HAT = 46;

type DrumRecipe = (p: Patch, velocity: number) => VoiceParts;

/** A one-shot's parts: it lasts `life` seconds and ignores `stop`. */
const hit = (p: Patch, output: AudioNode, life: number): VoiceParts => p.parts(output, 0.01, { life, oneShot: true });

/** The clang of metal: six square waves at pitches that don't agree with each other. */
function metal(p: Patch): GainNode {
  const mix = p.gain(1 / 6);
  for (const frequency of [205.3, 304.4, 369.6, 522.7, 540, 800]) p.osc("square", frequency).connect(mix);
  return mix;
}

/** A drum with a skin: a sine that drops quickly from a "thwack" to its note, plus a little stick noise. */
function skin(p: Patch, velocity: number, note: number, drop: number, decay: number, level: number): VoiceParts {
  const t = p.start;
  const body = p.osc("sine", note);
  body.frequency.setValueAtTime(note * drop, t);
  body.frequency.exponentialRampToValueAtTime(note, t + 0.09);
  const amp = p.envelope(1, 0.002, 0, decay);
  body.connect(amp);

  const stick = p.noise();
  stick.stop(t + 0.1);
  const stickTone = p.filter("bandpass", note * 12, 0.7);
  const stickLevel = p.envelope(0.35 * velocityBrightness(velocity), 0.001, 0, 0.008);
  stick.connect(stickTone).connect(stickLevel);

  // An octave above, short: the "knock" that lets small speakers, which can't play the boom, still play the drum.
  const knock = p.osc("triangle", note * 2);
  knock.frequency.setValueAtTime(note * 2 * drop, t);
  knock.frequency.exponentialRampToValueAtTime(note * 2, t + 0.06);
  const knockLevel = p.envelope(0.3, 0.002, 0, decay * 0.45);
  knock.connect(knockLevel);

  const out = p.gain(level * velocityGain(velocity));
  amp.connect(out);
  stickLevel.connect(out);
  knockLevel.connect(out);
  return hit(p, out, decay * 8);
}

const kick: DrumRecipe = (p, velocity) => skin(p, velocity, 50, 3.3, 0.14, LEVEL.kick);
const lowTom: DrumRecipe = (p, velocity) => skin(p, velocity, 92, 1.7, 0.17, LEVEL.tom);
const midTom: DrumRecipe = (p, velocity) => skin(p, velocity, 132, 1.7, 0.15, LEVEL.tom);
const highTom: DrumRecipe = (p, velocity) => skin(p, velocity, 185, 1.7, 0.13, LEVEL.tom);

const snare: DrumRecipe = (p, velocity) => {
  const t = p.start;
  // The drum's own note…
  const head = p.osc("triangle", 185);
  head.frequency.setValueAtTime(250, t);
  head.frequency.exponentialRampToValueAtTime(185, t + 0.04);
  const ring = p.osc("sine", 330);
  const headLevel = p.envelope(0.8, 0.001, 0, 0.055);
  head.connect(headLevel);
  ring.connect(p.gain(0.35)).connect(headLevel);
  // …and the rattle of the wires underneath.
  const wires = p.noise();
  const wiresTone = p.filter("highpass", 1400, 0.6);
  const wiresLevel = p.envelope(0.5 + 0.4 * velocityBrightness(velocity), 0.001, 0, 0.085);
  wires.connect(wiresTone).connect(p.filter("lowpass", 7500, 0.5)).connect(wiresLevel);

  const out = p.gain(LEVEL.snare * velocityGain(velocity));
  headLevel.connect(out);
  wiresLevel.connect(out);
  return hit(p, out, 0.7);
};

const rim: DrumRecipe = (p, velocity) => {
  const wood = p.osc("triangle", 480);
  const crack = p.osc("sine", 1740);
  const amp = p.envelope(1, 0.0005, 0, 0.014);
  wood.connect(amp);
  crack.connect(p.gain(0.7)).connect(amp);
  const noise = p.noise();
  const noiseLevel = p.envelope(0.5, 0.0005, 0, 0.004);
  noise.connect(p.filter("bandpass", 3200, 1)).connect(noiseLevel);
  const out = p.gain(LEVEL.rim * velocityGain(velocity));
  amp.connect(out);
  noiseLevel.connect(out);
  return hit(p, out, 0.15);
};

const clap: DrumRecipe = (p, velocity) => {
  const t = p.start;
  const hands = p.noise();
  const tone = p.filter("bandpass", 1150, 1.1);
  const thin = p.filter("highpass", 500, 0.5);
  const amp = p.gain(0);
  // Several hands never land together: three quick bursts, then the room.
  for (let i = 0; i < 3; i++) {
    const at = t + i * 0.011;
    amp.gain.setValueAtTime(1, at);
    amp.gain.exponentialRampToValueAtTime(0.12, at + 0.0105);
  }
  amp.gain.setValueAtTime(0.9, t + 0.033);
  amp.gain.setTargetAtTime(0, t + 0.033, 0.065);
  const out = p.gain(LEVEL.clap * velocityGain(velocity));
  hands.connect(tone).connect(thin).connect(amp).connect(out);
  return hit(p, out, 0.6);
};

/** A hi-hat: metal and hiss with everything low taken out; `decay` sets closed or open. */
function hat(p: Patch, velocity: number, decay: number, level: number): VoiceParts {
  const tone = p.filter("bandpass", 8500, 0.6);
  const thin = p.filter("highpass", 6000, 0.7);
  metal(p).connect(tone);
  p.noise().connect(p.gain(0.35)).connect(tone);
  const amp = p.envelope(1, 0.001, 0, decay);
  const out = p.gain(level * velocityGain(velocity));
  tone.connect(thin).connect(amp).connect(out);
  return hit(p, out, Math.max(0.2, decay * 7));
}

const closedHat: DrumRecipe = (p, velocity) => hat(p, velocity, 0.028, LEVEL.closedHat);
const openHat: DrumRecipe = (p, velocity) => hat(p, velocity, 0.2, LEVEL.openHat);

const crash: DrumRecipe = (p, velocity) => {
  const t = p.start;
  const wash = p.filter("highpass", 3200, 0.5);
  p.noise().connect(wash);
  metal(p).connect(p.gain(1.6)).connect(p.filter("bandpass", 6500, 0.5)).connect(wash);
  // The splash is brightest at first, then darkens as it fades.
  const dark = p.filter("lowpass", 13000, 0.5);
  dark.frequency.setValueAtTime(13000, t);
  dark.frequency.setTargetAtTime(5500, t, 0.8);
  const amp = p.envelope(1, 0.002, 0, 0.55);
  const out = p.gain(LEVEL.crash * velocityGain(velocity));
  wash.connect(dark).connect(amp).connect(out);
  return hit(p, out, 4);
};

const ride: DrumRecipe = (p, velocity) => {
  const shimmer = p.filter("bandpass", 5200, 0.9);
  metal(p).connect(shimmer);
  const shimmerLevel = p.envelope(1, 0.001, 0.25, 0.08);
  shimmerLevel.gain.setTargetAtTime(0, p.start + 0.15, 0.5);
  shimmer.connect(p.filter("highpass", 3000, 0.6)).connect(shimmerLevel);
  // The "ping" of the stick on the bow of the cymbal.
  const ping = p.osc("sine", 3150);
  const pingLevel = p.envelope(0.25, 0.001, 0, 0.12);
  ping.connect(pingLevel);
  const out = p.gain(LEVEL.ride * velocityGain(velocity));
  shimmerLevel.connect(out);
  pingLevel.connect(out);
  return hit(p, out, 3);
};

const cowbell: DrumRecipe = (p, velocity) => {
  const tone = p.filter("bandpass", 2640, 2);
  p.osc("square", 540).connect(p.gain(0.5)).connect(tone);
  p.osc("square", 800).connect(p.gain(0.5)).connect(tone);
  const amp = p.envelope(1, 0.001, 0.35, 0.015);
  amp.gain.setTargetAtTime(0, p.start + 0.04, 0.09);
  const out = p.gain(LEVEL.cowbell * velocityGain(velocity));
  tone.connect(amp).connect(out);
  return hit(p, out, 0.8);
};

const shaker: DrumRecipe = (p, velocity) => {
  const tone = p.filter("bandpass", 7500, 1.1);
  // A shaker swishes in rather than starting with a bang.
  const amp = p.envelope(1, 0.018, 0, 0.03);
  const out = p.gain(LEVEL.shaker * velocityGain(velocity));
  p.noise().connect(tone).connect(p.filter("highpass", 4500, 0.6)).connect(amp).connect(out);
  return hit(p, out, 0.3);
};

/** How loud each drum is made, set by measuring so the kit is balanced with itself and with the instruments. */
const LEVEL = {
  kick: 1.17,
  snare: 0.6,
  rim: 0.4,
  clap: 1.9,
  tom: 0.82,
  closedHat: 0.78,
  openHat: 0.7,
  crash: 0.32,
  ride: 0.8,
  cowbell: 0.93,
  shaker: 0.3,
};

const RECIPES: Record<number, DrumRecipe> = {
  36: kick,
  37: rim,
  38: snare,
  39: clap,
  41: lowTom,
  42: closedHat,
  45: midTom,
  46: openHat,
  48: highTom,
  49: crash,
  51: ride,
  56: cowbell,
  70: shaker,
};

/** The open hi-hats still ringing, for each place drums are played into: a closed hat cuts them short, as a real pedal does. */
const openHats = new WeakMap<AudioNode, OneShotVoice[]>();

/**
 * Play one drum hit at a time on the context's clock (now, if that's
 * passed), into `destination`. Keys with no drum on them make no sound.
 * Hits ring out by themselves: `stop` on what comes back does nothing
 * (`silence` still cuts it off).
 */
export function playDrum(ctx: BaseAudioContext, destination: AudioNode, pitch: number, velocity: number, when: number): Voice {
  const drum = RECIPES[pitch] ? pitch : SAME_AS[pitch];
  const recipe = RECIPES[drum];
  if (!recipe) return silentVoice();
  const start = Math.max(when, ctx.currentTime);
  const voice = makeVoice(ctx, destination, recipe(new Patch(ctx, start), velocity));

  if (drum === CLOSED_HAT || drum === OPEN_HAT) {
    const ringing = openHats.get(destination) ?? [];
    if (drum === CLOSED_HAT) {
      for (const open of ringing) open.choke(start);
      ringing.length = 0;
    } else {
      // Only the last few can still be heard.
      if (ringing.length >= 4) ringing.shift();
      ringing.push(voice);
    }
    openHats.set(destination, ringing);
  }
  return voice;
}
