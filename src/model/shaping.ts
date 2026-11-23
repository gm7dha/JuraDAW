/**
 * Shaping the sound, pure: a track's own effects (drive, crush, filter,
 * wobble, pump) and a clip's volume, fades and filter sweep — their usual
 * values, their limits, and the sums the sound engine and the screens share.
 */
import { MIN_LENGTH, type Clip, type Song, type Sweep, type Track, type TrackFilter } from "./types";

/** A track's effects with nothing left out. */
export interface TrackEffects {
  drive: number;
  crush: number;
  filter: TrackFilter;
  chorus: number;
  pump: number;
}

/** A filter that changes nothing. */
export const OPEN_FILTER: TrackFilter = { kind: "low", cutoff: 1, resonance: 0 };

const share = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

/** A filter with every value inside its limits; a missing cutoff is the place where that kind changes nothing. */
export function cleanFilter(v: Partial<TrackFilter> | undefined | null): TrackFilter {
  const kind = v?.kind === "high" ? "high" : "low";
  return { kind, cutoff: share(v?.cutoff, kind === "low" ? 1 : 0), resonance: share(v?.resonance) };
}

/** Does this filter change the sound at all? */
export function filterIsOn(filter: TrackFilter): boolean {
  return filter.kind === "low" ? filter.cutoff < 0.999 : filter.cutoff > 0.001;
}

/** A track's effects, every one filled in (off where the track doesn't say). */
export function effectsOf(track: Pick<Track, "drive" | "crush" | "filter" | "chorus" | "pump">): TrackEffects {
  return { drive: share(track.drive), crush: share(track.crush), filter: cleanFilter(track.filter), chorus: share(track.chorus), pump: share(track.pump) };
}

/** Does the track have any effect of its own switched on? */
export function hasEffects(track: Track): boolean {
  const e = effectsOf(track);
  return e.drive > 0 || e.crush > 0 || e.chorus > 0 || e.pump > 0 || filterIsOn(e.filter);
}

/** The lowest and highest places the filter can cut, in hertz. */
export const CUTOFF_LOW_HZ = 40;
export const CUTOFF_HIGH_HZ = 18000;

/** A cutoff setting (0–1) as a frequency: each equal step of the slider is an equal musical step. */
export function cutoffHz(cutoff: number): number {
  return CUTOFF_LOW_HZ * Math.pow(CUTOFF_HIGH_HZ / CUTOFF_LOW_HZ, share(cutoff));
}

/** A frequency in words for the screen: "850 Hz", "2.4 kHz". */
export function hzText(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz / 10) * 10} Hz`;
}

/** A sweep with both ends inside their limits, or undefined if it isn't one. */
export function cleanSweep(v: unknown): Sweep | undefined {
  if (!v || typeof v !== "object") return undefined;
  const s = v as Partial<Sweep>;
  if (typeof s.from !== "number" || typeof s.to !== "number" || !Number.isFinite(s.from) || !Number.isFinite(s.to)) return undefined;
  return { from: share(s.from), to: share(s.to) };
}

/** A clip's own volume: 1 unless it says otherwise. */
export function clipGain(clip: Clip): number {
  const g = clip.gain;
  return typeof g === "number" && Number.isFinite(g) ? Math.min(2, Math.max(0, g)) : 1;
}

/** A clip's fades in beats, never longer between them than the clip itself. */
export function clipFades(clip: Clip, lengthBeats: number): { fadeIn: number; fadeOut: number } {
  const length = Math.max(0, lengthBeats);
  const fadeIn = Math.min(length, Math.max(0, clip.fadeIn ?? 0));
  const fadeOut = Math.min(length - fadeIn, Math.max(0, clip.fadeOut ?? 0));
  return { fadeIn: fadeIn >= MIN_LENGTH ? fadeIn : 0, fadeOut: fadeOut >= MIN_LENGTH ? fadeOut : 0 };
}

/** Does the clip change its own loudness (so its notes need a volume of their own)? */
export function clipIsShaped(clip: Clip): boolean {
  return clipGain(clip) !== 1 || (clip.fadeIn ?? 0) >= MIN_LENGTH || (clip.fadeOut ?? 0) >= MIN_LENGTH;
}

/** How loud a clip is `at` beats after its start (its volume, less whatever a fade takes off). */
export function clipLevelAt(clip: Clip, lengthBeats: number, at: number): number {
  const { fadeIn, fadeOut } = clipFades(clip, lengthBeats);
  let level = clipGain(clip);
  if (fadeIn > 0 && at < fadeIn) level *= Math.max(0, at) / fadeIn;
  if (fadeOut > 0 && at > lengthBeats - fadeOut) level *= Math.max(0, lengthBeats - at) / fadeOut;
  return level;
}

/**
 * The places where a clip's loudness turns a corner between two moments of it (beats from its start), as
 * [beat, level] pairs in order, including both ends: straight lines between them are the whole shape.
 */
export function clipLevelPoints(clip: Clip, lengthBeats: number, from: number, to: number): [number, number][] {
  const { fadeIn, fadeOut } = clipFades(clip, lengthBeats);
  const corners = [from, fadeIn, lengthBeats - fadeOut, to].filter((b) => b >= from && b <= to).sort((a, b) => a - b);
  const points: [number, number][] = [];
  for (const beat of corners) {
    if (points.length && beat - points[points.length - 1][0] < 1e-9) continue;
    points.push([beat, clipLevelAt(clip, lengthBeats, beat)]);
  }
  return points;
}

/**
 * Where a track's filter should be at a beat of the song: inside a clip with a sweep, the place between its two
 * ends; otherwise null (where the track itself has it). The latest-starting such clip wins.
 */
export function sweepAt(song: Song, trackId: string, beat: number, lengthOf: (clip: Clip) => number): number | null {
  let best: Clip | null = null;
  for (const clip of song.clips) {
    if (clip.trackId !== trackId || !clip.sweep) continue;
    if (beat < clip.start || beat > clip.start + lengthOf(clip)) continue;
    if (!best || clip.start > best.start) best = clip;
  }
  if (!best || !best.sweep) return null;
  const length = lengthOf(best);
  const t = length > 0 ? Math.min(1, Math.max(0, (beat - best.start) / length)) : 1;
  return best.sweep.from + (best.sweep.to - best.sweep.from) * t;
}

/** Does any clip on the track sweep its filter? */
export function trackHasSweeps(song: Song, trackId: string): boolean {
  return song.clips.some((c) => c.trackId === trackId && !!c.sweep);
}

/** How long the pump takes to dip, in seconds, and what share of a beat it takes to swell back. */
export const PUMP_DIP_SECONDS = 0.012;
export const PUMP_SWELL_SHARE = 0.9;

/** The lowest the pump takes the volume, for an amount 0–1 (1 = right down to a tenth). */
export function pumpFloor(amount: number): number {
  return 1 - 0.9 * share(amount);
}
