/**
 * Automation, pure: lines drawn over a song that move a track's volume, its
 * filter or its place between left and right as the song plays. A line is
 * points (a place in beats, a value 0–1) joined by straight lines; before
 * its first point it holds the first point's value, after its last the
 * last's. A track with no line for something keeps its own setting.
 *
 * Values, all 0–1:
 *   volume — the same scale as the track's volume slider (0.8 = as made);
 *   filter — where the track's filter cuts (as TrackFilter.cutoff);
 *   pan    — left (0) to right (1), 0.5 the middle.
 */
import { MOST_BEATS } from "./document";
import type { AutoParam, AutoPoint, Automation, Track } from "./types";

export const AUTO_PARAMS: readonly AutoParam[] = ["volume", "filter", "pan"];

/** The most points a line may have. */
export const MOST_POINTS = 500;

/** What each line is called on screen. */
export const AUTO_NAMES: Record<AutoParam, string> = { volume: "Volume", filter: "Filter", pan: "Left–right" };

/** A track's own setting as a line's value (what a line starts from when the first point is drawn). */
export function restingValue(track: Pick<Track, "volume" | "pan" | "filter">, param: AutoParam): number {
  if (param === "volume") return clamp01(track.volume);
  if (param === "pan") return clamp01((track.pan + 1) / 2);
  return clamp01(track.filter?.cutoff ?? (track.filter?.kind === "high" ? 0 : 1));
}

/** A line's value in words: "80%", "cuts at 2.4 kHz" is left to the caller; "left 40%", "middle". */
export function panValueWords(value: number): string {
  const pan = value * 2 - 1;
  if (Math.abs(pan) < 0.02) return "middle";
  return `${Math.round(Math.abs(pan) * 100)}% ${pan < 0 ? "left" : "right"}`;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Points made safe: numbers in range, in order of beat, no two on one beat (the later wins), at most MOST_POINTS. */
export function cleanPoints(v: unknown): AutoPoint[] {
  if (!Array.isArray(v)) return [];
  const byBeat = new Map<number, number>();
  for (const p of v.slice(0, MOST_POINTS * 4)) {
    if (!p || typeof p !== "object") continue;
    const { beat, value } = p as Partial<AutoPoint>;
    if (typeof beat !== "number" || typeof value !== "number" || !Number.isFinite(beat) || !Number.isFinite(value)) continue;
    byBeat.set(r6(Math.min(MOST_BEATS, Math.max(0, beat))), r6(clamp01(value)));
  }
  return [...byBeat.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, MOST_POINTS)
    .map(([beat, value]) => ({ beat, value }));
}

/** A track's lines read from a file (left out when there are none). */
export function cleanAutomation(v: unknown): Automation | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: Automation = {};
  for (const param of AUTO_PARAMS) {
    const points = cleanPoints((v as Record<string, unknown>)[param]);
    if (points.length) out[param] = points;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The line for something on a track, or null when it has none. */
export function lineOf(track: Pick<Track, "automation">, param: AutoParam): AutoPoint[] | null {
  const points = track.automation?.[param];
  return points && points.length ? points : null;
}

/** A line's value at a beat. */
export function valueAt(points: readonly AutoPoint[], beat: number): number {
  if (!points.length) return 0;
  if (beat <= points[0].beat) return points[0].value;
  const last = points[points.length - 1];
  if (beat >= last.beat) return last.value;
  // The two points either side (the line is short, so a simple search is quick enough).
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].beat <= beat) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const t = b.beat > a.beat ? (beat - a.beat) / (b.beat - a.beat) : 1;
  return a.value + (b.value - a.value) * t;
}

/** The corners of a line between two beats, both ends included, in order: straight lines between them are the whole shape. */
export function lineBetween(points: readonly AutoPoint[], from: number, to: number): AutoPoint[] {
  const out: AutoPoint[] = [{ beat: from, value: valueAt(points, from) }];
  for (const p of points) if (p.beat > from && p.beat < to) out.push(p);
  if (to > from) out.push({ beat: to, value: valueAt(points, to) });
  return out;
}

/** A line with a point added (or moved, if one is already on that beat). */
export function withPoint(points: readonly AutoPoint[], point: AutoPoint): AutoPoint[] {
  return cleanPoints([...points.filter((p) => Math.abs(p.beat - point.beat) > 1e-6), point]);
}

/** A line without the point at `index`. */
export function withoutPoint(points: readonly AutoPoint[], index: number): AutoPoint[] {
  return points.filter((_, i) => i !== index);
}

/** A line with the point at `index` moved — never past the points either side. */
export function withPointMoved(points: readonly AutoPoint[], index: number, to: AutoPoint): AutoPoint[] {
  if (!points[index]) return [...points];
  const low = index > 0 ? points[index - 1].beat + 1e-3 : 0;
  const high = index < points.length - 1 ? points[index + 1].beat - 1e-3 : MOST_BEATS;
  const beat = r6(Math.min(high, Math.max(low, to.beat)));
  return points.map((p, i) => (i === index ? { beat, value: r6(clamp01(to.value)) } : p));
}

/** The gain a volume value gives (the same curve as the volume slider: 0.8 = as made). */
export function volumeValueGain(value: number): number {
  const share = clamp01(value) / 0.8;
  return share * share;
}
