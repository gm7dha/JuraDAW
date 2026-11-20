/**
 * One sounding note (a "voice"): the shared way every instrument and drum
 * starts, lets go of and tidies up the Web Audio nodes it's made of. Each
 * voice ends in its own "release" gain, so a note can be let go or silenced
 * at any moment without a click, whatever its own envelope is doing.
 */

/** A note that's sounding (or about to). */
export interface Voice {
  /** Let the note go at a time on the sound clock: it fades out the way the instrument does. Drum hits ignore it. */
  stop(when: number): void;
  /** Fade it out in a few thousandths of a second, whatever it is (Stop was pressed). */
  silence(when: number): void;
  /** Called once the note has finished and its nodes have been disconnected. */
  onended: (() => void) | null;
}

/** A voice with the extra handle drums need: fade out now even though `stop` is ignored (a closed hi-hat cutting an open one). */
export interface OneShotVoice extends Voice {
  choke(when: number): void;
}

export interface VoiceParts {
  /** The last node of the voice's own chain; it's connected on through the release gain. */
  output: AudioNode;
  /** Everything that makes sound or wobbles it (oscillators, buffer players), already started; all stopped together. The first one's end tidies the voice up. */
  sources: AudioScheduledSourceNode[];
  /** Every other node made for the voice, to disconnect when it's over. */
  nodes: AudioNode[];
  /** When the note starts, on the sound clock. */
  start: number;
  /** How quickly it dies away when let go: the time, in seconds, to fall to about a third. */
  release: number;
  /** For sounds that end by themselves (drums, plucks): seconds until the sources are stopped. */
  life?: number;
  /** True for drum hits: `stop` does nothing, the hit always rings out. */
  oneShot?: boolean;
}

/** How fast `silence` fades (seconds to fall to about a third). */
const SILENCE_TIME = 0.006;
/** A fade of this many time constants is 70 dB down: quiet enough to cut off. */
const FADE_LENGTHS = 8;

/** A voice that makes no sound (an unknown drum, a missing instrument). */
export function silentVoice(): OneShotVoice {
  return { stop() {}, silence() {}, choke() {}, onended: null };
}

/**
 * Connect a voice's parts to where it plays and hand back its controls.
 * When the first source ends, everything is disconnected so finished notes
 * cost nothing.
 */
export function makeVoice(ctx: BaseAudioContext, destination: AudioNode, parts: VoiceParts): OneShotVoice {
  const release = ctx.createGain();
  parts.output.connect(release);
  release.connect(destination);

  let over = false;
  let letGo = false;
  const voice: OneShotVoice = {
    stop: (when) => {
      if (!parts.oneShot) fade(when, parts.release);
    },
    choke: (when) => {
      // Only something already sounding can be cut short.
      if (when > parts.start) fade(when, 0.012);
    },
    silence: (when) => {
      if (over) return;
      letGo = true;
      const t = Math.max(when, ctx.currentTime);
      release.gain.cancelScheduledValues(t);
      release.gain.setTargetAtTime(0, t, SILENCE_TIME);
      stopSources(Math.max(t, parts.start) + SILENCE_TIME * FADE_LENGTHS);
    },
    onended: null,
  };

  function fade(when: number, timeConstant: number): void {
    if (over || letGo) return;
    letGo = true;
    const t = Math.max(when, ctx.currentTime);
    if (t <= parts.start) {
      // Let go before it began: it never sounds.
      release.gain.setValueAtTime(0, 0);
      stopSources(parts.start);
      return;
    }
    release.gain.setTargetAtTime(0, t, timeConstant);
    stopSources(t + timeConstant * FADE_LENGTHS);
  }

  function stopSources(when: number): void {
    for (const source of parts.sources) {
      try {
        source.stop(when);
      } catch {
        // Already stopped.
      }
    }
  }

  const lead = parts.sources[0];
  if (lead) {
    lead.onended = () => {
      over = true;
      lead.onended = null;
      for (const node of [...parts.sources, ...parts.nodes, release]) {
        try {
          node.disconnect();
        } catch {
          // Never connected.
        }
      }
      voice.onended?.();
    };
  }
  if (parts.life !== undefined) stopSources(parts.start + parts.life);
  return voice;
}
