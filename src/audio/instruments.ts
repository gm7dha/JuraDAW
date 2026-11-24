/**
 * The built-in instruments. Nothing is recorded or downloaded: every note is
 * made on the spot from oscillators, noise and filters, so JuraDAW stays
 * small and works offline. The same code plays live and makes the mixdown.
 *
 * Each instrument is a recipe that builds one note (a "voice") and hands
 * back the way to let it go. The LEVEL numbers were set by measuring, so the
 * instruments are about as loud as each other at the same velocity.
 */
import { playDrum, playKitDrum } from "./drums";
import { ICONS } from "./instrumentIcons";
import { Patch } from "./patch";
import { pluckBuffer } from "./pluck";
import { clamp, midiToHz, velocityBrightness, velocityGain } from "./shared";
import { makeVoice, type Voice, type VoiceParts } from "./voice";

/** "keys" instruments play pitches; "drums" plays a different drum on each key. */
export type InstrumentKind = "keys" | "drums";

export interface Instrument {
  /** What a track's `instrument` holds. */
  id: string;
  /** What the user sees. */
  name: string;
  /** The heading it's listed under. */
  group: string;
  /** A 48×48 picture as SVG markup, drawn in the text colour. */
  icon: string;
  kind: InstrumentKind;
  /**
   * Start a note at a time on the context's clock (now, if that's passed),
   * playing into `destination`. Call `stop` on what comes back to let it go.
   * `seconds` is how long the note will last, when that's known (the song's own notes; not a key held down live):
   * the noise sweep uses it to reach its top just as the note ends.
   */
  startVoice(ctx: BaseAudioContext, destination: AudioNode, pitch: number, velocity: number, when: number, seconds?: number): Voice;
}

type Recipe = (p: Patch, pitch: number, velocity: number, seconds?: number) => VoiceParts;

// ── the recipes ──

/** Strengths of a piano string's harmonics: falling away, with every 7th weak (where the hammer strikes). */
const PIANO_WAVE = Array.from({ length: 32 }, (_, i) => {
  const n = i + 1;
  return (n % 7 === 0 ? 0.3 : 1) / Math.pow(n, 1.25);
});

/** Piano: three strings a touch out of tune with each other, bright at the hammer blow and mellowing as they ring. */
const piano: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const bright = velocityBrightness(velocity);
  const t = p.start;
  // Low strings ring for a long time, high ones die quickly.
  const decay = clamp(3.2 * Math.pow(2, -(pitch - 36) / 22), 0.3, 5);

  const tone = p.filter("lowpass", 1000, 0.5);
  const top = Math.min(f * (2.5 + 10 * bright * bright), 15000);
  tone.frequency.setValueAtTime(top, t);
  tone.frequency.setTargetAtTime(Math.min(f * 3.5 + 300, top), t, 0.12 + decay * 0.25);

  const wave = p.wave("piano", PIANO_WAVE);
  // Unequal strengths, so the slow beating between the strings never cancels the note out.
  p.osc(wave, f, 0.3).connect(p.gain(0.42)).connect(tone);
  p.osc(wave, f, -1.9).connect(p.gain(0.34)).connect(tone);
  p.osc(wave, f, 2.3).connect(p.gain(0.24)).connect(tone);

  // The knock of the hammer: a tiny burst of noise.
  const noise = p.noise();
  noise.stop(t + 0.25);
  const knock = p.filter("bandpass", clamp(f * 3, 400, 4000), 0.8);
  const knockLevel = p.envelope(0.5 * bright, 0.001, 0, 0.012);
  noise.connect(knock).connect(knockLevel).connect(tone);

  const amp = p.envelope(1, 0.003, 0, decay);
  const level = p.gain(LEVEL.piano * velocityGain(velocity));
  tone.connect(amp).connect(level);
  return p.parts(level, 0.07);
};

/** Electric piano: two sines, one wobbling the other (FM), with a bell-like "tine" at the start and a gentle sway from side to side. */
const electricPiano: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const bright = velocityBrightness(velocity);
  const t = p.start;
  const decay = clamp(1.8 * Math.pow(2, -(pitch - 48) / 30), 0.5, 2.5);

  // The body: a carrier with a modulator at the same pitch, growling when hit hard and mellowing quickly.
  const body = p.osc("sine", f);
  const bodyMod = p.osc("sine", f);
  const bodyDepth = p.gain(0);
  bodyDepth.gain.setValueAtTime(f * 1.9 * bright * bright, t);
  bodyDepth.gain.setTargetAtTime(f * 0.45, t, 0.4);
  bodyMod.connect(bodyDepth).connect(body.frequency);

  // The tine: a high, quickly fading modulator gives the chime of the attack. Left out at the very top, where it would only whistle.
  const tineShare = clamp(1 - (pitch - 72) / 18, 0, 1);
  const tine = p.osc("sine", f, 3);
  const tineMod = p.osc("sine", f * 14);
  const tineDepth = p.gain(0);
  tineDepth.gain.setValueAtTime(f * 14 * 0.7 * bright * tineShare, t);
  tineDepth.gain.setTargetAtTime(0, t, 0.07);
  tineMod.connect(tineDepth).connect(tine.frequency);
  const tineLevel = p.envelope(0.45, 0.002, 0.12, 0.25);

  const amp = p.envelope(1, 0.004, 0, decay);
  body.connect(amp);
  tine.connect(tineLevel).connect(amp);

  // The sway of a suitcase piano's speakers.
  const sway = p.pan(0);
  const swayLfo = p.osc("sine", 4.3);
  const swayDepth = p.gain(0.3);
  swayLfo.connect(swayDepth).connect(sway.pan);

  // This kind of FM leaves a slow offset in the wave; the filter takes it out.
  const steady = p.filter("highpass", 25, 0.7);
  const level = p.gain(LEVEL["electric-piano"] * velocityGain(velocity));
  amp.connect(steady).connect(sway).connect(level);
  return p.parts(level, 0.09);
};

/**
 * Organ drawbars as harmonics of a note an octave below the key:
 * 16′, 8′, 5⅓′, 4′, 2⅔′, 2′ and a little 1′.
 */
const ORGAN_WAVE = [0.7, 1, 0.55, 0.5, 0, 0.25, 0, 0.22, 0, 0, 0, 0.06, 0, 0, 0, 0.1];

/** Organ: drawbar tones that hold for as long as the key is down, with a slow shimmer and a little key click. */
const organ: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const wave = p.wave("organ", ORGAN_WAVE);
  const pipes = p.gain(1);
  const main = p.osc(wave, f / 2);
  const chorus = p.osc(wave, f / 2, 5);
  const chorusLevel = p.gain(0.5);
  main.connect(pipes);
  chorus.connect(chorusLevel).connect(pipes);

  // Vibrato, as an organ's scanner makes.
  const vibrato = p.osc("sine", 6.3);
  const vibratoDepth = p.gain(4);
  vibrato.connect(vibratoDepth);
  vibratoDepth.connect(main.detune);
  vibratoDepth.connect(chorus.detune);

  // The click of the key contact.
  const click = p.osc("sine", f * 4);
  const clickLevel = p.envelope(0.25, 0.001, 0, 0.012);
  click.connect(clickLevel).connect(pipes);

  const tone = p.filter("lowpass", 5500, 0.5);
  const amp = p.envelope(1, 0.006, 1, 0.1);
  // An organ is hardly touch-sensitive: velocity makes only a small difference.
  const level = p.gain(LEVEL.organ * (0.6 + 0.4 * velocityGain(velocity)));
  pipes.connect(tone).connect(amp).connect(level);
  return p.parts(level, 0.025);
};

/** A slow vibrato that grows in after the note starts, wired to oscillators' tuning. */
function delayedVibrato(p: Patch, rate: number, cents: number, after: number, oscillators: OscillatorNode[]): void {
  const lfo = p.osc("sine", rate);
  const depth = p.gain(0);
  depth.gain.setValueAtTime(0, p.start + after);
  depth.gain.setTargetAtTime(cents, p.start + after, 0.25);
  lfo.connect(depth);
  for (const osc of oscillators) depth.connect(osc.detune);
}

/** Strings: a section of slightly out-of-tune sawtooth "players" spread from left to right, easing in and out. */
const strings: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const bright = velocityBrightness(velocity);
  const t = p.start;
  const tone = p.filter("lowpass", Math.min(900 + f * 3.5 * bright, 9000), 0.4);
  const players: OscillatorNode[] = [];
  const section: [detune: number, pan: number, share: number, octave: number][] = [
    [-9, -0.7, 0.45, 1],
    [8, 0.7, 0.4, 1],
    [0, 0, 0.5, 1],
    [3, 0.2, 0.14, 2],
  ];
  for (const [detune, pan, share, octave] of section) {
    const osc = p.osc("sawtooth", f * octave, detune);
    players.push(osc);
    osc.connect(p.gain(share)).connect(p.pan(pan)).connect(tone);
  }
  delayedVibrato(p, 5.3, 7, 0.25, players);

  // Take the boom out from below the note.
  const body = p.filter("highpass", f * 0.6, 0.5);
  const amp = p.gain(0);
  amp.gain.setValueAtTime(0, t);
  amp.gain.setTargetAtTime(1, t, 0.07 + 0.08 * (1 - bright));
  const level = p.gain(LEVEL.strings * velocityGain(velocity));
  tone.connect(body).connect(amp).connect(level);
  return p.parts(level, 0.16);
};

/** Pad: a soft, wide, slowly opening wash for long chords. */
const pad: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const bright = velocityBrightness(velocity);
  const t = p.start;
  const tone = p.filter("lowpass", 300, 1.2);
  const open = Math.min(500 + f * 2.5 * bright, 6000);
  tone.frequency.setValueAtTime(Math.min(200 + f, open), t);
  tone.frequency.setTargetAtTime(open, t, 0.7);
  // The filter drifts gently so held chords stay alive.
  const drift = p.osc("sine", 0.23);
  const driftDepth = p.gain(open * 0.18);
  drift.connect(driftDepth).connect(tone.frequency);

  p.osc("sawtooth", f, -11).connect(p.gain(0.5)).connect(p.pan(-0.8)).connect(tone);
  p.osc("sawtooth", f, 11).connect(p.gain(0.5)).connect(p.pan(0.8)).connect(tone);
  p.osc("triangle", f).connect(p.gain(0.4)).connect(tone);
  p.osc("triangle", f / 2).connect(p.gain(0.25)).connect(tone);
  // A glassy octave on top, past the filter.
  const glass = p.gain(0.07);
  p.osc("sine", f * 2, 4).connect(glass);

  const amp = p.gain(0);
  amp.gain.setValueAtTime(0, t);
  amp.gain.setTargetAtTime(1, t, 0.2);
  const level = p.gain(LEVEL.pad * velocityGain(velocity));
  tone.connect(amp);
  glass.connect(amp);
  amp.connect(level);
  return p.parts(level, 0.45);
};

/** Bass: a round, plucked electric-bass note — a sawtooth for the growl over a triangle for the weight. */
const bass: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const bright = velocityBrightness(velocity);
  const t = p.start;
  const tone = p.filter("lowpass", 1000, 1.2);
  const top = Math.min(f * (4 + 9 * bright), 7000);
  tone.frequency.setValueAtTime(top, t);
  // The filter rests high enough to leave some of the note's upper harmonics: small speakers can't play the
  // bottom of a bass note, and it's those harmonics that let the ear still hear which note it is.
  tone.frequency.setTargetAtTime(Math.min(f * 5 + 300, top), t, 0.1);
  p.osc("sawtooth", f).connect(p.gain(0.85)).connect(tone);
  p.osc("triangle", f).connect(p.gain(0.55)).connect(tone);
  const amp = p.envelope(1, 0.004, 0.55, 0.35);
  // A held note slowly fades, as a string does.
  amp.gain.setTargetAtTime(0, t + 0.8, 3);
  const level = p.gain(LEVEL.bass * velocityGain(velocity));
  tone.connect(amp).connect(level);
  return p.parts(level, 0.05);
};

/** Synth bass: a square and a sawtooth through a filter that snaps shut — the squelchy, punchy kind. */
const synthBass: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const bright = velocityBrightness(velocity);
  const t = p.start;
  const tone = p.filter("lowpass", 1000, 5);
  const top = Math.min(f * (6 + 14 * bright), 9000);
  tone.frequency.setValueAtTime(top, t);
  tone.frequency.setTargetAtTime(Math.min(f * 4 + 250, top), t, 0.08);
  p.osc("square", f).connect(p.gain(0.45)).connect(tone);
  p.osc("sawtooth", f, 9).connect(p.gain(0.45)).connect(tone);
  p.osc("sine", f).connect(p.gain(0.25)).connect(tone);
  const amp = p.envelope(1, 0.003, 0.75, 0.2);
  const level = p.gain(LEVEL["synth-bass"] * velocityGain(velocity));
  tone.connect(amp).connect(level);
  return p.parts(level, 0.04);
};

/** Lead: a singing, bright synth for tunes, with vibrato that comes in on held notes. */
const lead: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const bright = velocityBrightness(velocity);
  const t = p.start;
  const tone = p.filter("lowpass", 1000, 2);
  const top = Math.min(1200 + f * 5 * bright, 11000);
  tone.frequency.setValueAtTime(top, t);
  tone.frequency.setTargetAtTime(Math.min(900 + f * 3 * bright, top), t, 0.2);
  const voices: OscillatorNode[] = [];
  const mix: [type: OscillatorType, octave: number, detune: number, share: number][] = [
    ["sawtooth", 1, 0, 0.42],
    ["sawtooth", 1, -7, 0.3],
    ["sawtooth", 1, 8, 0.3],
    ["square", 0.5, 0, 0.16],
  ];
  for (const [type, octave, detune, share] of mix) {
    const osc = p.osc(type, f * octave, detune);
    voices.push(osc);
    osc.connect(p.gain(share)).connect(tone);
  }
  delayedVibrato(p, 5.8, 12, 0.18, voices);
  const amp = p.envelope(1, 0.008, 0.85, 0.15);
  const level = p.gain(LEVEL.lead * velocityGain(velocity));
  tone.connect(amp).connect(level);
  return p.parts(level, 0.06);
};

/** Pluck: a plucked string (see pluck.ts), like a harp or a nylon guitar. */
const pluck: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const player = p.player(pluckBuffer(p.ctx, pitch, f, velocityBrightness(velocity)));
  // Soften the first instant so it never clicks.
  const amp = p.envelope(1, 0.002, 1, 0.1);
  const level = p.gain(LEVEL.pluck * velocityGain(velocity));
  player.connect(amp).connect(level);
  return p.parts(level, 0.1);
};

/** Bells: sines wobbling each other at "wrong" ratios, which is what makes a bell sound like metal. They ring on after the key is let go. */
const bells: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const bright = velocityBrightness(velocity);
  const t = p.start;
  const decay = clamp(2.2 * Math.pow(2, -(pitch - 60) / 24), 0.6, 4);
  // High bells get less wobble, or they'd turn harsh.
  const depthShare = Math.min(1, 900 / f);

  const main = p.osc("sine", f);
  const mod = p.osc("sine", f * 3.5);
  const depth = p.gain(0);
  depth.gain.setValueAtTime(f * 3.5 * 1.3 * bright * depthShare, t);
  depth.gain.setTargetAtTime(f * 3.5 * 0.12 * depthShare, t, decay * 0.4);
  mod.connect(depth).connect(main.frequency);

  // The strike: a short high partial.
  const strike = p.osc("sine", f * 5.4);
  const strikeLevel = p.envelope(0.22 * bright * depthShare, 0.001, 0, 0.18);
  // A hum a little below, as real bells have.
  const hum = p.osc("sine", f * 0.5, 4);
  const humLevel = p.envelope(0.18, 0.02, 0, decay * 1.3);

  const amp = p.envelope(1, 0.002, 0, decay);
  main.connect(amp);
  const level = p.gain(LEVEL.bells * velocityGain(velocity));
  amp.connect(level);
  strike.connect(strikeLevel).connect(level);
  hum.connect(humLevel).connect(level);
  return p.parts(level, 0.45);
};

/** Strengths of a soft, rounded string: only a few harmonics, falling away fast. */
const FELT_WAVE = Array.from({ length: 12 }, (_, i) => 1 / Math.pow(i + 1, 2.1));

/** Soft piano: an upright with felt over the strings — close, muffled and gentle, with the thump of the hammer. */
const feltPiano: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const bright = velocityBrightness(velocity);
  const t = p.start;
  const decay = clamp(2.6 * Math.pow(2, -(pitch - 36) / 24), 0.4, 4);
  const tone = p.filter("lowpass", 800, 0.5);
  const top = Math.min(f * (1.6 + 3.2 * bright) + 250, 5000);
  tone.frequency.setValueAtTime(top, t);
  tone.frequency.setTargetAtTime(Math.min(f * 1.6 + 250, top), t, 0.25);
  const wave = p.wave("felt", FELT_WAVE);
  p.osc(wave, f, 1.2).connect(p.gain(0.55)).connect(tone);
  p.osc(wave, f, -2.4).connect(p.gain(0.45)).connect(tone);
  // The felt and the wooden action: a low, soft thump.
  const noise = p.noise();
  noise.stop(t + 0.3);
  const thump = p.filter("lowpass", clamp(f * 1.5, 150, 700), 0.7);
  noise.connect(thump).connect(p.envelope(0.55, 0.004, 0, 0.03)).connect(tone);
  const amp = p.envelope(1, 0.012, 0, decay);
  const level = p.gain(LEVEL["felt-piano"] * velocityGain(velocity));
  tone.connect(amp).connect(level);
  return p.parts(level, 0.12);
};

/** Choir: voices singing "aah" — a buzz shaped by the three resonances of an open mouth, with breath and a slow vibrato. */
const choir: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const bright = velocityBrightness(velocity);
  const t = p.start;
  const singers: OscillatorNode[] = [];
  const buzz = p.gain(1);
  for (const [detune, share] of [[-8, 0.5], [0, 0.6], [9, 0.5]] as const) {
    const osc = p.osc("sawtooth", f, detune);
    singers.push(osc);
    osc.connect(p.gain(share)).connect(buzz);
  }
  delayedVibrato(p, 5.1, 14, 0.3, singers);
  // Breath: a little noise through the same mouth.
  const breath = p.noise();
  breath.connect(p.gain(0.05)).connect(buzz);
  // "Aah": higher voices have a slightly smaller mouth, so the resonances move up a little.
  const lift = 1 + clamp((pitch - 55) / 48, 0, 0.25);
  const voice = p.gain(1);
  for (const [hz, q, share] of [[760, 7, 1], [1180, 9, 0.5], [2750, 11, 0.16 + 0.2 * bright]] as const) {
    buzz.connect(p.filter("bandpass", hz * lift, q)).connect(p.gain(share)).connect(voice);
  }
  // The note itself, so low notes keep their body.
  buzz.connect(p.filter("lowpass", Math.min(f * 2, 900), 0.6)).connect(p.gain(0.22)).connect(voice);
  const amp = p.gain(0);
  amp.gain.setValueAtTime(0, t);
  amp.gain.setTargetAtTime(1, t, 0.11);
  const level = p.gain(LEVEL.choir * velocityGain(velocity));
  voice.connect(p.pan(0)).connect(amp).connect(level);
  return p.parts(level, 0.4);
};

/** Sub bass: almost pure and very low — felt more than heard — with a trace of the octave above so small speakers still find the note. */
const subBass: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const tone = p.filter("lowpass", Math.min(f * 4 + 120, 900), 0.6);
  p.osc("sine", f).connect(p.gain(1)).connect(tone);
  p.osc("triangle", f * 2).connect(p.gain(0.13)).connect(tone);
  const amp = p.envelope(1, 0.012, 0.92, 0.3);
  const level = p.gain(LEVEL["sub-bass"] * velocityGain(velocity));
  tone.connect(amp).connect(level);
  return p.parts(level, 0.07);
};

/** The gritty bass's bend: pushes the wave hard into a soft wall, which is where the snarl comes from. */
const GRIT_CURVE = (() => {
  const curve = new Float32Array(1025);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(4.5 * ((2 * i) / (curve.length - 1) - 1));
  return curve;
})();

/** Gritty bass: two sawtooths a little apart, overdriven, through a ringing filter that snarls shut — the harsh, growling kind. */
const growlBass: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const bright = velocityBrightness(velocity);
  const t = p.start;
  const raw = p.gain(0.5);
  p.osc("sawtooth", f, -14).connect(raw);
  p.osc("sawtooth", f, 13).connect(raw);
  p.osc("square", f / 2).connect(p.gain(0.5)).connect(raw);
  const grit = p.shaper(GRIT_CURVE);
  const tone = p.filter("lowpass", 1000, 7);
  const top = Math.min(f * (9 + 16 * bright), 9000);
  tone.frequency.setValueAtTime(top, t);
  tone.frequency.setTargetAtTime(Math.min(f * 3.5 + 200, top), t, 0.16);
  // The growl: the filter trembles a few times a second.
  const growl = p.osc("sine", 5.5);
  growl.connect(p.gain(f * 1.2)).connect(tone.frequency);
  const amp = p.envelope(1, 0.004, 0.85, 0.25);
  const level = p.gain(LEVEL["growl-bass"] * velocityGain(velocity));
  raw.connect(grit).connect(tone).connect(amp).connect(level);
  return p.parts(level, 0.05);
};

/** Big saw: seven sawtooths spread out of tune and from side to side — the huge, bright chord sound of dance music. */
const supersaw: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const bright = velocityBrightness(velocity);
  const tone = p.filter("lowpass", Math.min(1500 + f * 6 * bright, 12000), 0.6);
  const spread = [-26, -17, -8, 0, 9, 16, 25];
  spread.forEach((detune, i) => {
    p.osc("sawtooth", f, detune)
      .connect(p.gain(detune === 0 ? 0.42 : 0.3))
      .connect(p.pan((i / (spread.length - 1)) * 1.6 - 0.8))
      .connect(tone);
  });
  const body = p.filter("highpass", f * 0.7, 0.5);
  const amp = p.envelope(1, 0.012, 0.9, 0.2);
  const level = p.gain(LEVEL.supersaw * velocityGain(velocity));
  tone.connect(body).connect(amp).connect(level);
  return p.parts(level, 0.22);
};

/** Wobbly synth: a warm, slightly out-of-tune keyboard that drifts in pitch like a worn tape. */
const wobble: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const bright = velocityBrightness(velocity);
  const t = p.start;
  const tone = p.filter("lowpass", 1000, 1.4);
  const open = Math.min(600 + f * 3.2 * bright, 5500);
  tone.frequency.setValueAtTime(Math.min(open * 1.5, 7000), t);
  tone.frequency.setTargetAtTime(open, t, 0.3);
  const oscs = [p.osc("sawtooth", f, -13), p.osc("sawtooth", f, 12), p.osc("triangle", f / 2, 3)];
  oscs[0].connect(p.gain(0.42)).connect(p.pan(-0.5)).connect(tone);
  oscs[1].connect(p.gain(0.42)).connect(p.pan(0.5)).connect(tone);
  oscs[2].connect(p.gain(0.4)).connect(tone);
  // Two slow drifts that never line up, so the pitch wanders rather than swings.
  for (const [rate, cents] of [[0.61, 16], [0.23, 11]] as const) {
    const drift = p.osc("sine", rate);
    const depth = p.gain(cents);
    drift.connect(depth);
    for (const osc of oscs) depth.connect(osc.detune);
  }
  const amp = p.envelope(1, 0.03, 0.8, 0.5);
  const level = p.gain(LEVEL.wobble * velocityGain(velocity));
  tone.connect(amp).connect(level);
  return p.parts(level, 0.35);
};

/**
 * Noise sweep: a rush of noise for a build. Notes from middle C up rise (the higher the note, the higher it ends)
 * and get louder until the note stops; notes below middle C fall and die away. The sweep takes as long as the note
 * (four seconds for a key held down live).
 */
const noiseSweep: Recipe = (p, pitch, velocity, seconds) => {
  const t = p.start;
  const length = clamp(seconds ?? 4, 0.25, 60);
  const rising = pitch >= 60;
  const high = clamp(midiToHz(pitch + (rising ? 48 : 60)), 3000, 15000);
  const low = 220;
  const band = p.filter("bandpass", low, 1.6);
  band.frequency.setValueAtTime(rising ? low : high, t);
  band.frequency.exponentialRampToValueAtTime(rising ? high : low, t + length);
  const amp = p.gain(0);
  amp.gain.setValueAtTime(0, t);
  if (rising) {
    amp.gain.linearRampToValueAtTime(0.12, t + Math.min(0.05, length / 4));
    amp.gain.exponentialRampToValueAtTime(1, t + length);
  } else {
    amp.gain.linearRampToValueAtTime(1, t + Math.min(0.02, length / 4));
    amp.gain.exponentialRampToValueAtTime(0.02, t + length);
  }
  const level = p.gain(LEVEL.sweep * velocityGain(velocity));
  p.noise().connect(band).connect(p.filter("highpass", 150, 0.5)).connect(amp).connect(level);
  return p.parts(level, rising ? 0.03 : 0.15);
};

/** The 808 bass: a long, deep sine that slides down onto its note and growls when pushed — the bass of trap. */
const bass808: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const t = p.start;
  const body = p.osc("sine", f);
  body.frequency.setValueAtTime(f * 1.5, t);
  body.frequency.exponentialRampToValueAtTime(f, t + 0.05);
  const upper = p.osc("triangle", f * 2);
  upper.frequency.setValueAtTime(f * 3, t);
  upper.frequency.exponentialRampToValueAtTime(f * 2, t + 0.05);
  const mix = p.gain(1);
  body.connect(mix);
  upper.connect(p.gain(0.16)).connect(mix);
  // Pushed into a soft wall: the higher the velocity, the more it growls.
  const push = p.gain(1 + 2 * velocityBrightness(velocity));
  const grit = p.shaper(SOFT_WALL);
  const amp = p.envelope(1, 0.003, 0.7, 0.6);
  amp.gain.setTargetAtTime(0, t + 0.6, 1.4);
  const level = p.gain(LEVEL["bass-808"] * velocityGain(velocity));
  mix.connect(push).connect(grit).connect(p.filter("lowpass", Math.min(f * 8 + 200, 2500), 0.6)).connect(amp).connect(level);
  return p.parts(level, 0.06);
};

/** A soft wall: sound pushed into it is rounded off rather than cut. */
const SOFT_WALL = (() => {
  const curve = new Float32Array(1025);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(1.6 * ((2 * i) / (curve.length - 1) - 1));
  return curve;
})();

/**
 * How loud each recipe is made, set by measuring (devkit/audio-check.mjs
 * prints the figures) so the instruments match at velocity 100.
 */
// ── acoustic: guitar, harp, kalimba, marimba, flute, brass ──

/** Acoustic guitar: a plucked string through a wooden body (two low resonances) and a soft top. */
const guitar: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const bright = velocityBrightness(velocity);
  const player = p.player(pluckBuffer(p.ctx, pitch, f, 0.25 + 0.45 * bright));
  const body = p.filter("peaking", 110, 1.2);
  body.gain.value = 6;
  const air = p.filter("peaking", 230, 1.4);
  air.gain.value = 3;
  const top = p.filter("lowpass", Math.min(f * 7 + 1800, 7000), 0.6);
  const amp = p.envelope(1, 0.002, 1, 0.1);
  const level = p.gain(LEVEL.guitar * velocityGain(velocity));
  player.connect(body).connect(air).connect(top).connect(amp).connect(level);
  return p.parts(level, 0.12);
};

/** Harp: a gentler, rounder pluck that rings on after the string is let go. */
const harp: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const bright = velocityBrightness(velocity);
  const player = p.player(pluckBuffer(p.ctx, pitch, f, 0.15 + 0.3 * bright));
  const soft = p.filter("lowpass", Math.min(f * 5 + 900, 9000), 0.5);
  const amp = p.envelope(1, 0.006, 1, 0.1);
  // A pure tone under it, so the note stays round as the pluck fades.
  const round = p.osc("sine", f);
  const roundLevel = p.envelope(0.35, 0.01, 0, clamp(2.4 * Math.pow(2, -(pitch - 48) / 24), 0.4, 3));
  round.connect(roundLevel).connect(amp);
  const level = p.gain(LEVEL.harp * velocityGain(velocity));
  player.connect(soft).connect(amp).connect(level);
  return p.parts(level, 0.7);
};

/** Kalimba (thumb piano): a metal tine — a pure note, a bright ping high above it that dies at once, and a tap on the wood. */
const kalimba: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const bright = velocityBrightness(velocity);
  const decay = clamp(1.1 * Math.pow(2, -(pitch - 60) / 24), 0.25, 2);
  const tone = p.osc("sine", f);
  const toneLevel = p.envelope(1, 0.002, 0, decay);
  const ping = p.osc("sine", f * 5.92);
  const pingLevel = p.envelope(0.32 * bright * Math.min(1, 1200 / f), 0.001, 0, 0.05);
  const tap = p.noise();
  tap.stop(p.start + 0.05);
  const tapTone = p.filter("bandpass", clamp(f * 2, 300, 3000), 1.5);
  const tapLevel = p.envelope(0.18 * bright, 0.001, 0, 0.008);
  const mix = p.gain(1);
  tone.connect(toneLevel).connect(mix);
  ping.connect(pingLevel).connect(mix);
  tap.connect(tapTone).connect(tapLevel).connect(mix);
  const level = p.gain(LEVEL.kalimba * velocityGain(velocity));
  mix.connect(level);
  return p.parts(level, 0.25);
};

/** Marimba: a wooden bar — its note, a ring two octaves up (as marimba bars are tuned) and the soft knock of the mallet. */
const marimba: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const bright = velocityBrightness(velocity);
  const decay = clamp(0.8 * Math.pow(2, -(pitch - 48) / 22), 0.12, 1.4);
  const tone = p.osc("sine", f);
  const toneLevel = p.envelope(1, 0.003, 0, decay);
  const ring = p.osc("sine", f * 4);
  const ringLevel = p.envelope(0.3 * bright * Math.min(1, 1500 / f), 0.002, 0, decay * 0.2);
  const knock = p.noise();
  knock.stop(p.start + 0.06);
  const knockTone = p.filter("lowpass", clamp(f * 3, 400, 2500), 0.7);
  const knockLevel = p.envelope(0.22 * bright, 0.001, 0, 0.01);
  const mix = p.gain(1);
  tone.connect(toneLevel).connect(mix);
  ring.connect(ringLevel).connect(mix);
  knock.connect(knockTone).connect(knockLevel).connect(mix);
  const level = p.gain(LEVEL.marimba * velocityGain(velocity));
  mix.connect(level);
  return p.parts(level, 0.15);
};

/** Flute: a nearly pure tone with breath in it, that sways a little (vibrato) once the note has settled. */
const flute: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const bright = velocityBrightness(velocity);
  const t = p.start;
  const tone = p.osc("sine", f);
  const second = p.osc("sine", f * 2);
  const vibrato = p.osc("sine", 5.2);
  const vibratoDepth = p.gain(0);
  vibratoDepth.gain.setValueAtTime(0, t);
  vibratoDepth.gain.linearRampToValueAtTime(0, t + 0.25);
  vibratoDepth.gain.linearRampToValueAtTime(7, t + 0.7);
  vibrato.connect(vibratoDepth);
  vibratoDepth.connect(tone.detune);
  vibratoDepth.connect(second.detune);
  const breath = p.noise();
  const breathTone = p.filter("bandpass", Math.min(f * 2, 8000), 1.8);
  const breathLevel = p.gain(0.06 + 0.06 * bright);
  const mix = p.gain(1);
  tone.connect(mix);
  second.connect(p.gain(0.12 + 0.12 * bright)).connect(mix);
  breath.connect(breathTone).connect(breathLevel).connect(mix);
  // A soft start (the breath first), then held.
  const amp = p.envelope(1, 0.07, 0.85, 0.2);
  const level = p.gain(LEVEL.flute * velocityGain(velocity));
  mix.connect(amp).connect(level);
  return p.parts(level, 0.12);
};

/** Brass: buzzing (sawtooth) lips, bright as the note is blown and settling warmer, the pitch rising into place. */
const brass: Recipe = (p, pitch, velocity) => {
  const f = midiToHz(pitch);
  const bright = velocityBrightness(velocity);
  const t = p.start;
  const a = p.osc("sawtooth", f, -4);
  const b = p.osc("sawtooth", f, 4);
  for (const o of [a, b]) {
    o.detune.setValueAtTime(o.detune.value - 35, t);
    o.detune.linearRampToValueAtTime(o.detune.value + 35, t + 0.05);
  }
  const tone = p.filter("lowpass", f * 1.5, 1.1);
  const top = Math.min(f * (3 + 6 * bright), 12000);
  tone.frequency.setValueAtTime(f * 1.2, t);
  tone.frequency.linearRampToValueAtTime(top, t + 0.06);
  tone.frequency.setTargetAtTime(Math.min(f * (2.2 + 3 * bright), 9000), t + 0.06, 0.25);
  const mix = p.gain(0.5);
  a.connect(mix);
  b.connect(mix);
  const amp = p.envelope(1, 0.035, 0.8, 0.3);
  const level = p.gain(LEVEL.brass * velocityGain(velocity));
  mix.connect(tone).connect(amp).connect(level);
  return p.parts(level, 0.1);
};

const LEVEL = {
  piano: 0.42,
  "electric-piano": 0.32,
  organ: 0.2,
  strings: 0.32,
  pad: 0.33,
  bass: 0.52,
  "synth-bass": 0.47,
  lead: 0.48,
  pluck: 0.55,
  bells: 0.31,
  "felt-piano": 0.38,
  choir: 1.23,
  "sub-bass": 0.43,
  "growl-bass": 0.34,
  supersaw: 0.31,
  wobble: 0.35,
  sweep: 1,
  "bass-808": 0.5,
  guitar: 0.41,
  harp: 0.38,
  kalimba: 0.4,
  marimba: 0.4,
  flute: 0.22,
  brass: 0.44,
};

// ── the list ──

function keyed(id: keyof typeof LEVEL, name: string, group: string, recipe: Recipe): Instrument {
  return {
    id,
    name,
    group,
    icon: ICONS[id],
    kind: "keys",
    startVoice(ctx, destination, pitch, velocity, when, seconds) {
      const patch = new Patch(ctx, Math.max(when, ctx.currentTime));
      return makeVoice(ctx, destination, recipe(patch, pitch, velocity, seconds));
    },
  };
}

/** Every built-in instrument, in the order they're offered. */
export const INSTRUMENTS: Instrument[] = [
  keyed("piano", "Piano", "Keys", piano),
  keyed("felt-piano", "Soft piano", "Keys", feltPiano),
  keyed("electric-piano", "Electric piano", "Keys", electricPiano),
  keyed("organ", "Organ", "Keys", organ),
  keyed("strings", "Strings", "Strings and pads", strings),
  keyed("pad", "Soft pad", "Strings and pads", pad),
  keyed("choir", "Choir", "Strings and pads", choir),
  keyed("guitar", "Acoustic guitar", "Acoustic", guitar),
  keyed("harp", "Harp", "Acoustic", harp),
  keyed("kalimba", "Kalimba", "Acoustic", kalimba),
  keyed("marimba", "Marimba", "Acoustic", marimba),
  keyed("flute", "Flute", "Acoustic", flute),
  keyed("brass", "Brass", "Acoustic", brass),
  keyed("bass", "Bass guitar", "Bass", bass),
  keyed("synth-bass", "Synth bass", "Bass", synthBass),
  keyed("sub-bass", "Sub bass", "Bass", subBass),
  keyed("growl-bass", "Gritty bass", "Bass", growlBass),
  keyed("bass-808", "808 bass", "Bass", bass808),
  keyed("lead", "Synth lead", "Synths", lead),
  keyed("supersaw", "Big saw", "Synths", supersaw),
  keyed("wobble", "Wobbly synth", "Synths", wobble),
  keyed("pluck", "Pluck", "Synths", pluck),
  keyed("bells", "Bells", "Synths", bells),
  keyed("sweep", "Noise sweep", "Synths", noiseSweep),
  {
    id: "drums",
    name: "Drum kit",
    group: "Drums",
    icon: ICONS.drums,
    kind: "drums",
    startVoice: playDrum,
  },
  {
    id: "drums-808",
    name: "808 kit",
    group: "Drums",
    icon: ICONS["drums-808"],
    kind: "drums",
    startVoice: (ctx, destination, pitch, velocity, when) => playKitDrum("drums-808", ctx, destination, pitch, velocity, when),
  },
  {
    id: "drums-electro",
    name: "Electronic kit",
    group: "Drums",
    icon: ICONS["drums-electro"],
    kind: "drums",
    startVoice: (ctx, destination, pitch, velocity, when) => playKitDrum("drums-electro", ctx, destination, pitch, velocity, when),
  },
];

/** The instrument with an id; the piano if there's no such instrument (an older or newer file). */
export function instrumentById(id: string): Instrument {
  return INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS[0];
}
