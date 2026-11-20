/**
 * The metronome's click: a short, clear beep, higher on the first beat of
 * the bar. Also used to count in before a recording.
 */
import { Patch } from "./patch";
import { makeVoice, type Voice } from "./voice";

/** Play one click at a time on the sound clock. `accent` = the first beat of a bar. */
export function playClick(ctx: BaseAudioContext, destination: AudioNode, when: number, accent: boolean): Voice {
  const p = new Patch(ctx, Math.max(when, ctx.currentTime));
  const beep = p.osc("sine", accent ? 1760 : 1175);
  const amp = p.envelope(accent ? 0.4 : 0.28, 0.001, 0, 0.014);
  beep.connect(amp);
  return makeVoice(ctx, destination, p.parts(amp, 0.01, { life: 0.12, oneShot: true }));
}
