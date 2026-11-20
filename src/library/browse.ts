/**
 * Finding patterns in the library window: grouped under headings, and a
 * search. As JuraCUT's browse.ts: every word typed must start a word of the
 * pattern's name, heading, description or one of its choices; matches in the
 * name come first. Pure.
 */
import type { LibraryPattern } from "./kit";
import { LIBRARY } from "./catalogue";

/** The order headings are shown in (any others follow, in the library's order). */
export const GROUP_ORDER = ["Drum beats", "Bass lines", "Chords", "Melodies and arps"];

export interface PatternGroup {
  group: string;
  patterns: LibraryPattern[];
}

export function groupPatterns(patterns: readonly LibraryPattern[] = LIBRARY): PatternGroup[] {
  const names = [...GROUP_ORDER, ...patterns.map((p) => p.group).filter((g) => !GROUP_ORDER.includes(g))];
  return [...new Set(names)].map((group) => ({ group, patterns: patterns.filter((p) => p.group === group) })).filter((g) => g.patterns.length);
}

const words = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9.]+/)
    .filter(Boolean);

export function searchPatterns(query: string, patterns: readonly LibraryPattern[] = LIBRARY): LibraryPattern[] {
  const wanted = words(query);
  if (!wanted.length) return [];
  const scored = patterns.flatMap((p) => {
    const name = words(p.name);
    const choices = p.inputs.flatMap((i) => (i.choices ?? []).flatMap((c) => words(c.label)));
    const all = [...name, ...words(p.group), ...words(p.kind), ...words(p.description), ...choices];
    if (!wanted.every((w) => all.some((x) => x.startsWith(w)))) return [];
    return [{ p, inName: wanted.filter((w) => name.some((x) => x.startsWith(w))).length }];
  });
  return scored.sort((a, b) => b.inName - a.inName).map((s) => s.p);
}
