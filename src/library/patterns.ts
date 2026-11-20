/**
 * The pattern library in one place (the DAW's twin of JuraCUT's design
 * library): `LIBRARY`, browsing it (`groupPatterns`, `searchPatterns`) and
 * making its patterns (`cleanValues`, `makePattern`). The list itself is in
 * catalogue.ts, the patterns in drums.ts, bass.ts, chords.ts and melodies.ts.
 */
export { GROUP_ORDER, groupPatterns, searchPatterns, type PatternGroup } from "./browse";
export { BASS_INSTRUMENTS, LIBRARY, cleanValues, defaultValues, findPattern, makePattern, patternSuitsInstrument } from "./catalogue";
export type { InputKind, LibraryPattern, MadePattern, PatternInput, PatternKind, PatternNote, Values } from "./kit";
export { KEYS, PROGRESSIONS, SCALES, type ScaleName } from "./theory";
