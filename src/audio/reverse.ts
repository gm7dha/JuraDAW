/**
 * Recordings played backwards. A clip marked `reverse` plays its stretch of
 * the sound from the end to the start: it's played from a reversed copy of
 * the sound (made once per sound and context), from the mirror of where it
 * would have started.
 */
import type { AudioClip } from "../model/types";

const flipped = new WeakMap<AudioBuffer, AudioBuffer>();

/** A sound reversed (made once, then kept as long as the sound is). */
export function reversedBuffer(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBuffer {
  let made = flipped.get(buffer);
  if (made && made.sampleRate === buffer.sampleRate) return made;
  made = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const from = buffer.getChannelData(c);
    const to = made.getChannelData(c);
    for (let i = 0, n = from.length; i < n; i++) to[i] = from[n - 1 - i];
  }
  flipped.set(buffer, made);
  return made;
}

/**
 * Where a clip's sound comes from: `offset` is the place in the original sound where playing would start (as the
 * schedule gives it, part-way in when Play starts in the middle of the clip). Forwards it's the sound itself from
 * there; backwards, the reversed copy from the mirror of that place — so the clip runs from its end to its start.
 */
export function clipSource(ctx: BaseAudioContext, clip: Pick<AudioClip, "offset" | "duration" | "reverse">, buffer: AudioBuffer, offset: number): { buffer: AudioBuffer; offset: number } {
  if (!clip.reverse) return { buffer, offset };
  const played = Math.max(0, offset - clip.offset);
  return { buffer: reversedBuffer(ctx, buffer), offset: mirroredOffset(buffer.duration, clip, clip.offset + played) };
}

/** The place in the reversed copy for a place in the original clip (pure; for tests and drawing). */
export function mirroredOffset(soundSeconds: number, clip: Pick<AudioClip, "offset" | "duration">, offset: number): number {
  return Math.max(0, soundSeconds - clip.offset - clip.duration + Math.max(0, offset - clip.offset));
}
