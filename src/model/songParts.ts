/**
 * The song as a whole, pure: its key (which the note editor shades and draws
 * chords from), its named sections (Intro, Verse, Chorus… along the ruler)
 * and its finishing touches (bass, treble and a squeeze on the whole mix).
 */
import { KEYS, chordFrom, inScale } from "../library/theory";
import { MOST_BEATS } from "./document";
import { songLength } from "./time";
import type { Finish, Section, Song, SongKey } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

// ── the key ──

/** A key made safe, or undefined when it isn't one. */
export function cleanKey(v: unknown): SongKey | undefined {
  if (!v || typeof v !== "object") return undefined;
  const k = v as Partial<SongKey>;
  if (typeof k.note !== "number" || !Number.isFinite(k.note)) return undefined;
  return { note: ((Math.round(k.note) % 12) + 12) % 12, scale: k.scale === "minor" ? "minor" : "major" };
}

/** "A minor", "E♭ major". */
export function keyWords(key: SongKey): string {
  const name = KEYS.find((k) => k.index === key.note)?.label.split(" / ")[0] ?? "C";
  return `${name} ${key.scale}`;
}

/** Every key, for a menu: C major, C minor, C♯ major… */
export const ALL_KEYS: readonly SongKey[] = KEYS.flatMap((k) => (["major", "minor"] as const).map((scale) => ({ note: k.index, scale })));

/** Whether a pitch is one of the key's notes. */
export function pitchInKey(pitch: number, key: SongKey): boolean {
  return inScale(pitch, key.note, key.scale);
}

/**
 * The chord to draw from a clicked pitch: with a key, the key's own chord on that note (a note outside the key is
 * taken as the key note just below it); without one, a major chord. Three notes, lowest first.
 */
export function chordAt(pitch: number, key: SongKey | undefined): number[] {
  if (!key) return [pitch, pitch + 4, pitch + 7];
  let root = pitch;
  while (!pitchInKey(root, key)) root--;
  return chordFrom(root, key.note, key.scale);
}

// ── sections ──

/** The most sections a song may have. */
export const MOST_SECTIONS = 64;

/** Names offered for a new section, in the order a song usually goes. */
export const SECTION_NAMES = ["Intro", "Verse", "Chorus", "Verse 2", "Chorus 2", "Bridge", "Chorus 3", "Outro"] as const;

/** Sections made safe: names tidied, beats in range, in order, one per beat, at most MOST_SECTIONS. */
export function cleanSections(v: unknown): Section[] {
  if (!Array.isArray(v)) return [];
  const byBeat = new Map<number, string>();
  for (const s of v.slice(0, MOST_SECTIONS * 4)) {
    if (!s || typeof s !== "object") continue;
    const { beat, name } = s as Partial<Section>;
    if (typeof beat !== "number" || !Number.isFinite(beat) || typeof name !== "string") continue;
    const clean = name.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!clean) continue;
    byBeat.set(r6(clamp(beat, 0, MOST_BEATS)), clean);
  }
  return [...byBeat.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, MOST_SECTIONS)
    .map(([beat, name]) => ({ beat, name }));
}

/** The name to offer for a section added at a beat: the next of SECTION_NAMES after those before it, not one already used. */
export function nextSectionName(sections: readonly Section[], beat: number): string {
  const used = new Set(sections.map((s) => s.name));
  const before = sections.filter((s) => s.beat < beat).length;
  for (let i = before; i < SECTION_NAMES.length; i++) if (!used.has(SECTION_NAMES[i])) return SECTION_NAMES[i];
  for (const name of SECTION_NAMES) if (!used.has(name)) return name;
  let n = sections.length + 1;
  while (used.has(`Part ${n}`)) n++;
  return `Part ${n}`;
}

/** Where the section starting at a beat ends: the next section's start, else the end of the song's last bar (at least a bar on). */
export function sectionEnd(song: Pick<Song, "sections" | "beatsPerBar" | "tracks" | "clips" | "bpm">, beat: number): number {
  const next = (song.sections ?? []).find((s) => s.beat > beat + 1e-9);
  if (next) return next.beat;
  const bpb = song.beatsPerBar;
  return Math.max(beat + bpb, Math.ceil(songLength(song as Song) / bpb - 1e-9) * bpb);
}

/** The section playing at a beat, or null before the first. */
export function sectionAt(sections: readonly Section[], beat: number): Section | null {
  let found: Section | null = null;
  for (const s of sections) if (s.beat <= beat + 1e-9) found = s;
  return found;
}

// ── finishing touches ──

/** Finishing touches made safe (each left out when it changes nothing), or undefined when there are none. */
export function cleanFinish(v: unknown): Finish | undefined {
  if (!v || typeof v !== "object") return undefined;
  const f = v as Record<string, unknown>;
  const out: Finish = {};
  for (const key of ["lows", "highs"] as const) {
    const n = f[key];
    if (typeof n === "number" && Number.isFinite(n) && Math.abs(n) >= 0.005) out[key] = r6(clamp(n, -1, 1));
  }
  const squeeze = f.squeeze;
  if (typeof squeeze === "number" && Number.isFinite(squeeze) && squeeze >= 0.005) out.squeeze = r6(clamp(squeeze, 0, 1));
  return Object.keys(out).length ? out : undefined;
}

/** The finishing touches, every one filled in (0 when the song leaves it out). */
export function finishOf(finish: Finish | undefined): Required<Finish> {
  return { lows: finish?.lows ?? 0, highs: finish?.highs ?? 0, squeeze: finish?.squeeze ?? 0 };
}
