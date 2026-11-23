/**
 * The drum kit. Like the instruments, every hit is made on the spot: sine
 * waves that drop in pitch for the kick and toms, noise for the snare, clap
 * and shaker, and a cluster of clashing square waves for the metal of the
 * cymbals and cowbell (the way classic drum machines did it).
 *
 * There are three kits on the same keys: the ordinary kit, an 808 kit (the
 * long, booming kick, snappy snare and ticking hats of trap and hip-hop) and
 * an electronic kit (the punchy kick and crisp hats of house and techno).
 * A drum a kit doesn't have of its own is played by the ordinary kit.
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
  kick808: 1.15,
  snare808: 0.62,
  clap808: 1.75,
  tom808: 0.95,
  hat808: 1.9,
  openHat808: 1.6,
  kickElectro: 1.25,
  snareElectro: 0.55,
  hatElectro: 0.25,
  openHatElectro: 0.25,
  rideElectro: 0.6,
};

// ── the 808 kit ──

/** The 808's kick: a sine that drops a long way and booms on for most of a second, with a touch of grit. */
const kick808: DrumRecipe = (p, velocity) => {
  const t = p.start;
  const body = p.osc("sine", 44);
  body.frequency.setValueAtTime(150, t);
  body.frequency.exponentialRampToValueAtTime(44, t + 0.07);
  const amp = p.envelope(1, 0.002, 0, 0.45);
  const grit = p.shaper(GRIT);
  body.connect(amp).connect(grit);
  // The click at the front, so it cuts through on small speakers.
  const click = p.osc("triangle", 880);
  click.frequency.setValueAtTime(1800, t);
  click.frequency.exponentialRampToValueAtTime(300, t + 0.015);
  const clickLevel = p.envelope(0.3 * velocityBrightness(velocity), 0.0005, 0, 0.006);
  click.connect(clickLevel);
  // An octave above, fading sooner: the note small speakers can play.
  const upper = p.osc("triangle", 88);
  upper.frequency.setValueAtTime(300, t);
  upper.frequency.exponentialRampToValueAtTime(88, t + 0.06);
  const upperLevel = p.envelope(0.22, 0.002, 0, 0.12);
  upper.connect(upperLevel);
  const out = p.gain(LEVEL.kick808 * velocityGain(velocity));
  grit.connect(out);
  clickLevel.connect(out);
  upperLevel.connect(out);
  return hit(p, out, 3.5);
};

/** The 808's snare: two tuned tones and a short, bright snap of noise. */
const snare808: DrumRecipe = (p, velocity) => {
  const tones = p.envelope(0.7, 0.001, 0, 0.06);
  p.osc("sine", 238).connect(tones);
  p.osc("sine", 476).connect(p.gain(0.55)).connect(tones);
  const snap = p.envelope(0.8 + 0.3 * velocityBrightness(velocity), 0.001, 0, 0.11);
  p.noise().connect(p.filter("highpass", 2200, 0.7)).connect(snap);
  const out = p.gain(LEVEL.snare808 * velocityGain(velocity));
  tones.connect(out);
  snap.connect(out);
  return hit(p, out, 0.9);
};

/** The 808's clap: four quick bursts and a long, reverberant tail. */
const clap808: DrumRecipe = (p, velocity) => {
  const t = p.start;
  const amp = p.gain(0);
  for (let i = 0; i < 4; i++) {
    const at = t + i * 0.009;
    amp.gain.setValueAtTime(1, at);
    amp.gain.exponentialRampToValueAtTime(0.1, at + 0.0085);
  }
  amp.gain.setValueAtTime(0.8, t + 0.036);
  amp.gain.setTargetAtTime(0, t + 0.036, 0.11);
  const out = p.gain(LEVEL.clap808 * velocityGain(velocity));
  p.noise().connect(p.filter("bandpass", 1000, 1.3)).connect(p.filter("highpass", 650, 0.5)).connect(amp).connect(out);
  return hit(p, out, 0.9);
};

/** The 808's hi-hat: the clashing squares, very bright and very short. */
function hat808(p: Patch, velocity: number, decay: number, level: number): VoiceParts {
  const tone = p.filter("bandpass", 10000, 0.8);
  metal(p).connect(p.gain(1.4)).connect(tone);
  const amp = p.envelope(1, 0.0008, 0, decay);
  const out = p.gain(level * velocityGain(velocity));
  tone.connect(p.filter("highpass", 7000, 0.7)).connect(amp).connect(out);
  return hit(p, out, Math.max(0.15, decay * 7));
}

/** The 808's tom: a slow, singing sine glide (the "pew" of old drum machines). */
const tom808 = (note: number): DrumRecipe => (p, velocity) => {
  const t = p.start;
  const body = p.osc("sine", note);
  body.frequency.setValueAtTime(note * 1.35, t);
  body.frequency.exponentialRampToValueAtTime(note, t + 0.25);
  const amp = p.envelope(1, 0.002, 0, 0.22);
  const out = p.gain(LEVEL.tom808 * velocityGain(velocity));
  body.connect(amp).connect(out);
  const knock = p.osc("triangle", note * 2);
  knock.connect(p.envelope(0.2, 0.002, 0, 0.05)).connect(out);
  return hit(p, out, 1.8);
};

/** The 808's rim shot: a short, wooden knock. */
const rim808: DrumRecipe = (p, velocity) => {
  const amp = p.envelope(1, 0.0005, 0, 0.01);
  p.osc("triangle", 1700).connect(amp);
  p.osc("triangle", 460).connect(p.gain(0.6)).connect(amp);
  const out = p.gain(LEVEL.rim * velocityGain(velocity));
  amp.connect(p.filter("highpass", 300, 0.6)).connect(out);
  return hit(p, out, 0.12);
};

// ── the electronic kit ──

/** A punchy club kick: a fast, short drop with a hard click. */
const kickElectro: DrumRecipe = (p, velocity) => {
  const t = p.start;
  const body = p.osc("sine", 52);
  body.frequency.setValueAtTime(230, t);
  body.frequency.exponentialRampToValueAtTime(52, t + 0.045);
  const amp = p.envelope(1, 0.001, 0, 0.16);
  body.connect(amp);
  const click = p.noise();
  click.stop(t + 0.05);
  const clickLevel = p.envelope(0.45 * velocityBrightness(velocity), 0.0005, 0, 0.004);
  click.connect(p.filter("bandpass", 3500, 0.8)).connect(clickLevel);
  const knock = p.osc("triangle", 104);
  knock.frequency.setValueAtTime(400, t);
  knock.frequency.exponentialRampToValueAtTime(104, t + 0.04);
  const knockLevel = p.envelope(0.3, 0.001, 0, 0.06);
  knock.connect(knockLevel);
  const out = p.gain(LEVEL.kickElectro * velocityGain(velocity));
  amp.connect(out);
  clickLevel.connect(out);
  knockLevel.connect(out);
  return hit(p, out, 1.3);
};

/** A crisp, noisy club snare. */
const snareElectro: DrumRecipe = (p, velocity) => {
  const t = p.start;
  const head = p.osc("triangle", 200);
  head.frequency.setValueAtTime(320, t);
  head.frequency.exponentialRampToValueAtTime(200, t + 0.03);
  const headLevel = p.envelope(0.55, 0.001, 0, 0.045);
  head.connect(headLevel);
  const noise = p.envelope(0.9 + 0.2 * velocityBrightness(velocity), 0.001, 0, 0.13);
  p.noise().connect(p.filter("bandpass", 4500, 0.5)).connect(noise);
  const out = p.gain(LEVEL.snareElectro * velocityGain(velocity));
  headLevel.connect(out);
  noise.connect(out);
  return hit(p, out, 1);
};

/** Club hi-hats: mostly noise, sizzling and bright. */
function hatElectro(p: Patch, velocity: number, decay: number, level: number): VoiceParts {
  const tone = p.filter("highpass", 7500, 0.8);
  p.noise().connect(tone);
  metal(p).connect(p.gain(0.4)).connect(tone);
  const amp = p.envelope(1, 0.0006, 0, decay);
  const out = p.gain(level * velocityGain(velocity));
  tone.connect(p.filter("peaking", 11000, 1)).connect(amp).connect(out);
  return hit(p, out, Math.max(0.15, decay * 7));
}

/** A club ride: a long, washy sizzle. */
const rideElectro: DrumRecipe = (p, velocity) => {
  const amp = p.envelope(1, 0.001, 0.3, 0.05);
  amp.gain.setTargetAtTime(0, p.start + 0.1, 0.35);
  p.noise().connect(p.filter("bandpass", 9000, 1.4)).connect(amp);
  metal(p).connect(p.gain(0.6)).connect(p.filter("highpass", 5000, 0.7)).connect(amp);
  const out = p.gain(LEVEL.rideElectro * velocityGain(velocity));
  amp.connect(out);
  return hit(p, out, 2.5);
};

/** The grit of the 808 kick: a soft bend, so it growls a little when played hard. */
const GRIT = (() => {
  const curve = new Float32Array(1025);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(1.8 * ((2 * i) / (curve.length - 1) - 1)) / Math.tanh(1.8);
  return curve;
})();

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

/** The 808 kit: its own drums, the ordinary kit's for the rest. */
const RECIPES_808: Record<number, DrumRecipe> = {
  ...RECIPES,
  36: kick808,
  37: rim808,
  38: snare808,
  39: clap808,
  41: tom808(80),
  42: (p, velocity) => hat808(p, velocity, 0.022, LEVEL.hat808),
  45: tom808(120),
  46: (p, velocity) => hat808(p, velocity, 0.24, LEVEL.openHat808),
  48: tom808(165),
};

/** The electronic kit: its own drums, the ordinary kit's for the rest. */
const RECIPES_ELECTRO: Record<number, DrumRecipe> = {
  ...RECIPES,
  36: kickElectro,
  38: snareElectro,
  42: (p, velocity) => hatElectro(p, velocity, 0.03, LEVEL.hatElectro),
  46: (p, velocity) => hatElectro(p, velocity, 0.28, LEVEL.openHatElectro),
  51: rideElectro,
};

/** The kits, by the instrument id that plays them. */
const KITS: Record<string, Record<number, DrumRecipe>> = { drums: RECIPES, "drums-808": RECIPES_808, "drums-electro": RECIPES_ELECTRO };

/** The open hi-hats still ringing, for each place drums are played into: a closed hat cuts them short, as a real pedal does. */
const openHats = new WeakMap<AudioNode, OneShotVoice[]>();

/**
 * Play one drum hit at a time on the context's clock (now, if that's
 * passed), into `destination`. Keys with no drum on them make no sound.
 * Hits ring out by themselves: `stop` on what comes back does nothing
 * (`silence` still cuts it off).
 */
export function playDrum(ctx: BaseAudioContext, destination: AudioNode, pitch: number, velocity: number, when: number): Voice {
  return playKitDrum("drums", ctx, destination, pitch, velocity, when);
}

/** As `playDrum`, on one of the kits ("drums", "drums-808", "drums-electro"; the ordinary kit for any other id). */
export function playKitDrum(kit: string, ctx: BaseAudioContext, destination: AudioNode, pitch: number, velocity: number, when: number): Voice {
  const recipes = KITS[kit] ?? RECIPES;
  const drum = recipes[pitch] ? pitch : SAME_AS[pitch];
  const recipe = recipes[drum];
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
