/**
 * A little workbench for building one note out of Web Audio nodes: it makes
 * the oscillators, filters and gains, starts the ones that make sound, and
 * remembers them all so the voice can be tidied away when the note is over.
 * Used by the instruments and the drum kit.
 */
import { noiseBuffer } from "./shared";
import type { VoiceParts } from "./voice";

const waves = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();

export class Patch {
  readonly sources: AudioScheduledSourceNode[] = [];
  readonly nodes: AudioNode[] = [];

  /** `start` is when the note begins, on the sound clock: every source made here starts then. */
  constructor(
    readonly ctx: BaseAudioContext,
    readonly start: number,
  ) {}

  /** An oscillator, started. `detune` is in cents (hundredths of a semitone). */
  osc(type: OscillatorType | PeriodicWave, frequency: number, detune = 0): OscillatorNode {
    const osc = this.ctx.createOscillator();
    if (typeof type === "string") osc.type = type as OscillatorType;
    else osc.setPeriodicWave(type);
    // Oscillators can't go above half the sample rate.
    osc.frequency.value = Math.min(frequency, this.ctx.sampleRate * 0.45);
    osc.detune.value = detune;
    osc.start(this.start);
    this.sources.push(osc);
    return osc;
  }

  /** White noise, started (from the context's shared buffer, going round and round). */
  noise(): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    source.buffer = noiseBuffer(this.ctx);
    source.loop = true;
    source.start(this.start);
    this.sources.push(source);
    return source;
  }

  /** A recording played once from its beginning, started. */
  player(buffer: AudioBuffer): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.start(this.start);
    this.sources.push(source);
    return source;
  }

  gain(value: number): GainNode {
    const gain = this.ctx.createGain();
    gain.gain.value = value;
    this.nodes.push(gain);
    return gain;
  }

  filter(type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = Math.min(frequency, this.ctx.sampleRate * 0.45);
    filter.Q.value = q;
    this.nodes.push(filter);
    return filter;
  }

  /** Left (−1) to right (1). */
  pan(value: number): StereoPannerNode {
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = value;
    this.nodes.push(pan);
    return pan;
  }

  /** A wave shape made from the strengths of its harmonics (first = the fundamental); made once per context and name. */
  wave(name: string, harmonics: readonly number[]): PeriodicWave {
    let made = waves.get(this.ctx);
    if (!made) waves.set(this.ctx, (made = new Map()));
    let wave = made.get(name);
    if (!wave) {
      const real = new Float32Array(harmonics.length + 1);
      const imag = new Float32Array(harmonics.length + 1);
      harmonics.forEach((strength, i) => (imag[i + 1] = strength));
      wave = this.ctx.createPeriodicWave(real, imag);
      made.set(name, wave);
    }
    return wave;
  }

  /**
   * A gain that shapes loudness over the note: silent, up to `peak` in
   * `attack` seconds, then settling towards `sustain` (`decay` = seconds to
   * cover about two thirds of the way).
   */
  envelope(peak: number, attack: number, sustain: number, decay: number): GainNode {
    const gain = this.gain(0);
    const t = this.start;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.setTargetAtTime(sustain, t + attack, decay);
    return gain;
  }

  /** The finished parts, for `makeVoice`. */
  parts(output: AudioNode, release: number, extra: Pick<VoiceParts, "life" | "oneShot"> = {}): VoiceParts {
    return { output, sources: this.sources, nodes: this.nodes, start: this.start, release, ...extra };
  }
}
