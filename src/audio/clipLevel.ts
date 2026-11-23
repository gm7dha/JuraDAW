/**
 * A clip's own loudness — its volume, a swell in at its start, a dying away
 * at its end (src/model/shaping.ts) — put into sound: a volume of its own
 * for each note or stretch of a recording, moved in time with the song. The
 * same for live playing and the mixdown.
 */
import { clipGain, clipIsShaped, clipLevelPoints } from "../model/shaping";
import type { Clip } from "../model/types";

/**
 * Where a note of a shaped clip should be played into: a volume that follows the clip's shape from the note's
 * start to its end (and stays there while the note dies away), feeding `destination`. Null when the clip is plain,
 * so the note goes straight to `destination`.
 * `fromBeat`/`toBeat` are beats from the clip's start; `timeOf` says when such a beat falls on the sound clock.
 */
export function shapedInput(ctx: BaseAudioContext, destination: AudioNode, clip: Clip, lengthBeats: number, fromBeat: number, toBeat: number, timeOf: (clipBeat: number) => number): GainNode | null {
  if (!clipIsShaped(clip)) return null;
  const node = ctx.createGain();
  const points = clipLevelPoints(clip, lengthBeats, fromBeat, Math.max(fromBeat, toBeat));
  const first = points[0] ?? [fromBeat, clipGain(clip)];
  node.gain.value = first[1];
  const start = Math.max(timeOf(first[0]), ctx.currentTime);
  node.gain.setValueAtTime(first[1], start);
  for (const [beat, level] of points.slice(1)) {
    const t = timeOf(beat);
    if (t > start) node.gain.linearRampToValueAtTime(level, t);
  }
  node.connect(destination);
  return node;
}

/**
 * The fades of a stretch of a recording, as a second volume after its own (which already holds the clip's
 * volume): 1 where there's no fade. Null when the clip has no fades.
 */
export function fadeNode(ctx: BaseAudioContext, clip: Clip, lengthBeats: number, fromBeat: number, toBeat: number, timeOf: (clipBeat: number) => number): GainNode | null {
  if (!((clip.fadeIn ?? 0) > 0 || (clip.fadeOut ?? 0) > 0)) return null;
  const plain = { ...clip, gain: 1 } as Clip;
  const points = clipLevelPoints(plain, lengthBeats, fromBeat, Math.max(fromBeat, toBeat));
  if (points.every(([, level]) => level === 1)) return null;
  const node = ctx.createGain();
  node.gain.value = points[0][1];
  const start = Math.max(timeOf(points[0][0]), ctx.currentTime);
  node.gain.setValueAtTime(points[0][1], start);
  for (const [beat, level] of points.slice(1)) {
    const t = timeOf(beat);
    if (t > start) node.gain.linearRampToValueAtTime(level, t);
  }
  return node;
}
