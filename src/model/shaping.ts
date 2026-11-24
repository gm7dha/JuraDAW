/**
 * Shaping the sound, pure: a track's own effects (drive, crush, filter,
 * wobble, pump) and a clip's volume, fades and filter sweep — their usual
 * values, their limits, and the sums the sound engine and the screens share.
 */
import { MIN_LENGTH, type Arp, type Clip, type FilterWobble, type Harmony, type HarmonyStyle, type MidiClip, type Note, type Song, type Sweep, type Track, type TrackFilter } from "./types";

/** A track's effects with nothing left out. */
export interface TrackEffects {
  drive: number;
  crush: number;
  filter: TrackFilter;
  chorus: number;
  pump: number;
  /** −1…1: less or more of the low end and of the top end. */
  lows: number;
  highs: number;
  chop: number;
  squeeze: number;
  sway: number;
  swirl: number;
  swing: number;
}

/** A filter that changes nothing. */
export const OPEN_FILTER: TrackFilter = { kind: "low", cutoff: 1, resonance: 0 };

const share = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

/** A filter with every value inside its limits; a missing cutoff is the place where that kind changes nothing. */
export function cleanFilter(v: Partial<TrackFilter> | undefined | null): TrackFilter {
  const kind = v?.kind === "high" ? "high" : v?.kind === "band" ? "band" : "low";
  return { kind, cutoff: share(v?.cutoff, kind === "low" ? 1 : kind === "high" ? 0 : 0.5), resonance: share(v?.resonance) };
}

/** Does this filter change the sound at all? */
export function filterIsOn(filter: TrackFilter): boolean {
  return filter.kind === "band" || (filter.kind === "low" ? filter.cutoff < 0.999 : filter.cutoff > 0.001);
}

/** A track's effects, every one filled in (off where the track doesn't say). */
export function effectsOf(track: Pick<Track, "drive" | "crush" | "filter" | "chorus" | "pump" | "lows" | "highs" | "chop" | "squeeze" | "sway" | "swirl" | "swing">): TrackEffects {
  return {
    drive: share(track.drive),
    crush: share(track.crush),
    filter: cleanFilter(track.filter),
    chorus: share(track.chorus),
    pump: share(track.pump),
    lows: tone(track.lows),
    highs: tone(track.highs),
    chop: share(track.chop),
    squeeze: share(track.squeeze),
    sway: share(track.sway),
    swirl: share(track.swirl),
    swing: share(track.swing),
  };
}

/** A tone setting, −1…1 (0 when it isn't a number). */
export function tone(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(-1, v)) : 0;
}

/** How far the tone controls reach, in decibels, and where the low and high ends begin. */
export const TONE_DB = 12;
export const LOWS_HZ = 220;
export const HIGHS_HZ = 3500;

/** A tone setting in words: "+6 dB", "−3 dB", "flat". */
export function toneWords(v: number): string {
  const db = Math.round(tone(v) * TONE_DB);
  return db === 0 ? "flat" : `${db > 0 ? "+" : "−"}${Math.abs(db)} dB`;
}

/** Chop: the share of each sixteenth note the sound is let through, and how far it's cut for the rest. */
export const CHOP_OPEN_SHARE = 0.5;
export function chopFloor(amount: number): number {
  return 1 - share(amount);
}

// ---------------------------------------------------------------------------
// The arpeggiator.

export const ARP_STYLES = ["up", "down", "updown", "random"] as const;
export const ARP_RATES = [1, 0.5, 1 / 3, 0.25] as const;
export const DEFAULT_ARP: Arp = { style: "up", rate: 0.25, octaves: 1 };

/** An arpeggiator's settings made safe; undefined if it isn't one. */
export function cleanArp(v: unknown): Arp | undefined {
  if (!v || typeof v !== "object") return undefined;
  const a = v as Partial<Arp>;
  const style = ARP_STYLES.includes(a.style as Arp["style"]) ? (a.style as Arp["style"]) : "up";
  const rate = ARP_RATES.find((r) => typeof a.rate === "number" && Math.abs(r - a.rate) < 1e-6) ?? DEFAULT_ARP.rate;
  const octaves = typeof a.octaves === "number" && Number.isFinite(a.octaves) ? Math.min(3, Math.max(1, Math.round(a.octaves))) : 1;
  return { style, rate, octaves };
}

/** An arpeggiator's rate in words. */
export function arpRateWords(rate: number): string {
  return rate === 1 ? "beats" : rate === 0.5 ? "eighth notes" : rate === 0.25 ? "sixteenth notes" : "triplets";
}

/** The same "random" every time for the same step, so a song plays the same each time. */
function stepRandom(i: number): number {
  let x = (i + 1) * 2654435761;
  x ^= x >>> 13;
  x = Math.imul(x, 1597334677);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const arped = new WeakMap<MidiClip, { arp: Arp; notes: Omit<Note, "id">[] }>();

/**
 * A clip's notes as an arpeggiator plays them: at each step (every `rate` beats from the clip's start), one note of
 * the chord held there — the notes sounding at that moment, lowest to highest, climbing `octaves` octaves — picked by
 * the style. The pattern starts again whenever the chord changes. A single held note is played on every step.
 * Remembered for the clip object, so it's only worked out once.
 */
export function arpNotes(clip: MidiClip, arp: Arp): Omit<Note, "id">[] {
  const kept = arped.get(clip);
  if (kept && kept.arp === arp) return kept.notes;
  const out: Omit<Note, "id">[] = [];
  const sorted = [...clip.notes].sort((a, b) => a.start - b.start);
  let lastSet = "";
  let count = 0;
  const most = Math.min(20000, Math.ceil(clip.length / arp.rate) + 1);
  for (let i = 0; i < most; i++) {
    const t = i * arp.rate;
    if (t >= clip.length - 1e-9) break;
    const held = sorted.filter((n) => n.start <= t + 1e-6 && n.start + n.length > t + 1e-6);
    if (!held.length) {
      lastSet = "";
      continue;
    }
    const pitches = [...new Set(held.map((n) => n.pitch))].sort((a, b) => a - b);
    const ladder: number[] = [];
    for (let o = 0; o < arp.octaves; o++) for (const p of pitches) if (p + 12 * o <= 127) ladder.push(p + 12 * o);
    const set = ladder.join(",");
    if (set !== lastSet) {
      lastSet = set;
      count = 0;
    }
    const n = ladder.length;
    let index: number;
    if (arp.style === "down") index = n - 1 - (count % n);
    else if (arp.style === "updown") {
      const period = Math.max(1, 2 * n - 2);
      const k = count % period;
      index = n === 1 ? 0 : k < n ? k : period - k;
    } else if (arp.style === "random") index = Math.floor(stepRandom(i) * n);
    else index = count % n;
    count++;
    const velocity = Math.max(...held.map((x) => x.velocity));
    out.push({ pitch: ladder[index], start: t, length: Math.min(arp.rate * 0.9, clip.length - t), velocity });
  }
  arped.set(clip, { arp, notes: out });
  return out;
}

/** Does the track have any effect of its own switched on? */
export function hasEffects(track: Track): boolean {
  const e = effectsOf(track);
  return e.drive > 0 || e.crush > 0 || e.chorus > 0 || e.pump > 0 || e.chop > 0 || e.lows !== 0 || e.highs !== 0 || filterIsOn(e.filter) || !!track.harmony || e.squeeze > 0 || e.sway > 0 || e.swirl > 0 || e.swing > 0 || !!track.filterWobble;
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

// ── The harmoniser ──

/** The harmoniser's choices: what each is called and the pitches it adds (as how many semitones from the sound). */
export const HARMONY_STYLES: readonly { style: HarmonyStyle; name: string; steps: readonly number[]; hint: string }[] = [
  { style: "below", name: "Octave below", steps: [-12], hint: "A deeper voice singing the same tune an octave down" },
  { style: "fifth", name: "Fifth above", steps: [7], hint: "An open, ringing voice five notes up (a power chord for voices)" },
  { style: "major", name: "Bright chord", steps: [4, 7], hint: "Two voices above, making a bright (major) chord: best in songs in a major key" },
  { style: "minor", name: "Dark chord", steps: [3, 7], hint: "Two voices above, making a darker (minor) chord: best in songs in a minor key" },
  { style: "wide", name: "Below and above", steps: [-12, 12], hint: "An octave down and an octave up at once: a big, stacked sound" },
];

/** How many times faster a voice the given semitones away plays. */
export const stepRatio = (semitones: number) => Math.pow(2, semitones / 12);

/** A harmoniser setting made safe, or undefined when it's off. */
export function cleanHarmony(v: unknown): Harmony | undefined {
  if (!v || typeof v !== "object") return undefined;
  const h = v as Partial<Harmony>;
  const amount = share(h.amount);
  if (amount <= 0) return undefined;
  const style = HARMONY_STYLES.some((s) => s.style === h.style) ? (h.style as HarmonyStyle) : "below";
  return { style, amount };
}

/** The pitches (semitones from the sound) a harmoniser style adds. */
export function harmonySteps(style: HarmonyStyle): readonly number[] {
  return (HARMONY_STYLES.find((s) => s.style === style) ?? HARMONY_STYLES[0]).steps;
}

/** A harmoniser style's name on screen. */
export function harmonyName(style: HarmonyStyle): string {
  return (HARMONY_STYLES.find((s) => s.style === style) ?? HARMONY_STYLES[0]).name;
}

// ── Filter wobble ──

/** How many beats one filter wobble takes, slowest first. */
export const WOBBLE_RATES = [2, 1, 0.5, 1 / 3, 0.25] as const;

/** A filter wobble's speed in words. */
export function wobbleRateWords(rate: number): string {
  if (Math.abs(rate - 2) < 1e-6) return "every 2 beats";
  if (Math.abs(rate - 1) < 1e-6) return "every beat";
  if (Math.abs(rate - 0.5) < 1e-6) return "twice a beat";
  if (Math.abs(rate - 1 / 3) < 1e-6) return "three times a beat";
  return "four times a beat";
}

/** A filter wobble made safe, or undefined when it's off. */
export function cleanFilterWobble(v: unknown): FilterWobble | undefined {
  if (!v || typeof v !== "object") return undefined;
  const w = v as Partial<FilterWobble>;
  const depth = share(w.depth);
  if (depth <= 0) return undefined;
  const rate = WOBBLE_RATES.find((r) => typeof w.rate === "number" && Math.abs(r - w.rate) < 1e-6) ?? 0.5;
  return { rate, depth };
}

/**
 * Where a wobbling filter is at a beat (0–1 as the cutoff): it starts each wobble where the track has it and moves
 * away and back — down (muffling) for a low or band filter, up (thinning) for a high one. In time with the song.
 */
export function wobbledCutoff(base: number, wobble: FilterWobble, beat: number, kind: TrackFilter["kind"]): number {
  const dip = wobble.depth * 0.8 * (0.5 - 0.5 * Math.cos((2 * Math.PI * beat) / wobble.rate));
  return kind === "high" ? Math.min(1, base + dip) : Math.max(0, base - dip);
}

// ── Swing ──

/** Do a clip's notes sit on sixteenths (some on the 2nd or 4th sixteenth of a beat)? Then they swing in sixteenths, else in eighths. */
export function swingsInSixteenths(notes: readonly { start: number }[]): boolean {
  return notes.some((n) => {
    const q = n.start * 4;
    return Math.abs(q - Math.round(q)) < 1e-3 && Math.round(q) % 2 !== 0;
  });
}

/**
 * How much later a note plays with swing (beats). Notes on the off-beat — the "and" between beats, or the 2nd and
 * 4th sixteenths — come later, up to a triplet feel at full swing; notes on the beat stay where they are.
 */
export function swingDelay(beat: number, amount: number, sixteenths: boolean): number {
  if (!(amount > 0)) return 0;
  const grid = sixteenths ? 0.25 : 0.5;
  const q = beat / grid;
  const step = Math.round(q);
  if (Math.abs(q - step) > 1e-3 || step % 2 === 0) return 0;
  return (amount * grid) / 3;
}
