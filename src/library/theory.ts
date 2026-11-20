/**
 * The music theory the pattern library is built on (pure): keys, major and
 * minor scales, chords made by stacking every other note of the scale, and
 * the well-known chord sequences. Pitches are MIDI note numbers (60 = middle C).
 */

export type ScaleName = "major" | "minor";

/** The twelve keys, as the note the scale starts on (0 = C … 11 = B). */
export const KEYS: { value: string; label: string; index: number }[] = [
  { value: "C", label: "C", index: 0 },
  { value: "C#", label: "C♯ / D♭", index: 1 },
  { value: "D", label: "D", index: 2 },
  { value: "Eb", label: "E♭ / D♯", index: 3 },
  { value: "E", label: "E", index: 4 },
  { value: "F", label: "F", index: 5 },
  { value: "F#", label: "F♯ / G♭", index: 6 },
  { value: "G", label: "G", index: 7 },
  { value: "Ab", label: "A♭ / G♯", index: 8 },
  { value: "A", label: "A", index: 9 },
  { value: "Bb", label: "B♭ / A♯", index: 10 },
  { value: "B", label: "B", index: 11 },
];

/** Semitones above the key note of each of a scale's seven notes (minor is the natural minor). */
export const SCALES: Record<ScaleName, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

/** A key's number (0 = C … 11 = B) from its name; C when the name isn't a key. */
export function keyIndex(key: unknown): number {
  return KEYS.find((k) => k.value === key)?.index ?? 0;
}

export function scaleName(scale: unknown): ScaleName {
  return scale === "minor" ? "minor" : "major";
}

const mod12 = (n: number) => ((n % 12) + 12) % 12;

/** Whether a pitch is one of the notes of a key's scale. */
export function inScale(pitch: number, key: number, scale: ScaleName): boolean {
  return SCALES[scale].includes(mod12(pitch - key));
}

/** A note of the scale by number, counted from 0 at `keyPitch` (a pitch of the key note): 7 is an octave up, −1 the note below. */
export function scalePitch(keyPitch: number, scale: ScaleName, index: number): number {
  const octave = Math.floor(index / 7);
  return keyPitch + 12 * octave + SCALES[scale][index - 7 * octave];
}

/** The pitch `steps` notes of the scale above (below, when negative) a pitch that is itself on the scale. */
export function scaleStep(pitch: number, steps: number, key: number, scale: ScaleName): number {
  const octave = Math.floor((pitch - key) / 12);
  const at = SCALES[scale].indexOf(mod12(pitch - key));
  // A pitch off the scale is taken as the scale note just below it.
  const from = at >= 0 ? at : SCALES[scale].filter((s) => s < mod12(pitch - key)).length - 1;
  return scalePitch(key + 12 * octave, scale, from + steps);
}

/** A pitch moved by whole octaves into the twelve semitones starting at `low`. */
export function foldInto(pitch: number, low: number): number {
  return low + mod12(pitch - low);
}

/** The pitch of a degree of the scale (1 = the key note … 7) within the octave starting at `low`. */
export function degreeRoot(key: number, scale: ScaleName, degree: number, low: number): number {
  return foldInto(key + SCALES[scale][(((degree - 1) % 7) + 7) % 7], low);
}

/**
 * The chord built on a note of the scale by taking every other scale note above it: three notes (a triad) or four
 * (a seventh chord). In C major, from C: C E G (B); from D: D F A (C). Rising from `root`.
 */
export function chordFrom(root: number, key: number, scale: ScaleName, size: 3 | 4 = 3): number[] {
  return Array.from({ length: size }, (_, i) => scaleStep(root, 2 * i, key, scale));
}

/** A chord's notes gathered into the octave starting at `low`, lowest first — which keeps one chord close to the next. */
export function voiced(chord: readonly number[], low: number): number[] {
  return [...new Set(chord.map((p) => foldInto(p, low)))].sort((a, b) => a - b);
}

/** The five-note (pentatonic) scale inside a scale, as scale note numbers: it leaves out the two notes that clash most. */
export const PENTATONIC: Record<ScaleName, readonly number[]> = {
  major: [0, 1, 2, 4, 5],
  minor: [0, 2, 3, 4, 6],
};

/** A well-known sequence of chords, a bar each, as degrees of the scale (1 = the chord on the key note). */
export interface Progression {
  id: string;
  /** For a choice: "Pop: 1–5–6–4". */
  label: string;
  degrees: readonly number[];
  /** Set when the sequence only makes sense in one scale: it's then played in that scale whatever is chosen. */
  scale?: ScaleName;
}

export const PROGRESSIONS: readonly Progression[] = [
  { id: "pop", label: "Pop: 1–5–6–4", degrees: [1, 5, 6, 4] },
  { id: "sad", label: "Bittersweet: 6–4–1–5", degrees: [6, 4, 1, 5] },
  { id: "fifties", label: "Fifties: 1–6–4–5", degrees: [1, 6, 4, 5] },
  { id: "rock", label: "Three chords: 1–4–5–4", degrees: [1, 4, 5, 4] },
  { id: "blues", label: "12-bar blues", degrees: [1, 1, 1, 1, 4, 4, 1, 1, 5, 4, 1, 5] },
  { id: "jazz", label: "Jazz: 2–5–1", degrees: [2, 5, 1, 1] },
  { id: "canon", label: "Canon: 1–5–6–3–4–1–4–5", degrees: [1, 5, 6, 3, 4, 1, 4, 5] },
  { id: "epic", label: "Epic (always minor): 1–6–3–7", degrees: [1, 6, 3, 7], scale: "minor" },
  { id: "one", label: "Stay on one chord", degrees: [1] },
];

/** A progression by its id (the first one when there's none by that name). */
export function progression(id: unknown): Progression {
  return PROGRESSIONS.find((p) => p.id === id) ?? PROGRESSIONS[0];
}

/** The scale a sequence of chords is played in: the one chosen, unless the sequence only comes in one. */
export function scaleFor(chords: unknown, chosen: ScaleName): ScaleName {
  return progression(chords).scale ?? chosen;
}

/**
 * A note of a chord in a sequence: `steps` notes of the scale above the chord's `root` (2 is its third, 4 its fifth,
 * 6 its seventh), as `scaleStep` — but for the two places where the style calls for a note from outside the scale:
 *
 * - the 12-bar blues in a major key: the sevenths of chords 1 and 4 are flattened (C7 and F7 in C, not C major 7),
 *   the sound that makes it the blues;
 * - the jazz 2–5–1 in a minor key: chord 5's third is raised (G or G7 in C minor, not G minor), so it pulls home to
 *   chord 1 as jazz expects.
 */
export function chordStep(chords: unknown, degree: number, root: number, steps: number, key: number, scale: ScaleName): number {
  const pitch = scaleStep(root, steps, key, scale);
  const place = ((steps % 7) + 7) % 7;
  if (chords === "blues" && scale === "major" && (degree === 1 || degree === 4) && place === 6) return pitch - 1;
  if (chords === "jazz" && scale === "minor" && degree === 5 && place === 2) return pitch + 1;
  return pitch;
}

/** The chord for a bar of a sequence, rising from `root`: three notes, or four with its seventh (see `chordStep`). */
export function sequenceChord(chords: unknown, degree: number, root: number, key: number, scale: ScaleName, size: 3 | 4 = 3): number[] {
  return Array.from({ length: size }, (_, i) => chordStep(chords, degree, root, 2 * i, key, scale));
}
