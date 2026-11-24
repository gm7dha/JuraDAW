/**
 * Songs: a new one, a new track, reading a saved song (checking every value,
 * so a damaged or hand-edited file can't break the app), and the .juradaw
 * file — the song plus its sounds as base64 WAV. Pure: works in Node and in
 * the browser.
 */
import { cleanAutomation } from "./automation";
import { cleanArp, cleanFilterWobble, cleanHarmony, cleanFilter, cleanSweep, filterIsOn, tone } from "./shaping";
import { MAX_BPM, MIN_BPM, MIN_LENGTH, MOST_TRACKS, TRACK_COLOURS } from "./types";
import type { AudioClip, AudioInfo, Clip, Loop, MidiClip, Note, Song, Track, TrackKind } from "./types";

export const FILE_EXTENSION = ".juradaw";
export const FILE_MIME = "application/x-juradaw+json";
export const DEFAULT_NAME = "Untitled song";
/** The `app` and `version` written at the top of a .juradaw file. */
export const FILE_APP = "JuraDAW";
export const FILE_VERSION = 1;

export const DEFAULT_BPM = 120;
export const DEFAULT_BEATS_PER_BAR = 4;
export const DEFAULT_VOLUME = 0.8;
/** The reverb a new instrument track starts with. */
export const DEFAULT_REVERB = 0.15;
/** The instrument a new instrument track gets when none is asked for. */
export const DEFAULT_INSTRUMENT = "piano";
/** The most notes one clip holds, and clips one song holds — kept to wherever they're made (edits.ts) as well as when a song is read, so nothing is lost on the way back in. */
export const MOST_NOTES = 20_000;
export const MOST_CLIPS = 5_000;
/** The furthest into a song anything may be, and the longest a clip, a note or the loop may be, in beats (over nine hours at 180 bpm). */
export const MOST_BEATS = 100_000;
/** The longest sound, in seconds (a day). */
export const MOST_SECONDS = 86_400;
/** The shortest stretch of sound an audio clip may play, in seconds. */
export const MIN_SECONDS = 0.01;

let idCount = 0;

/**
 * A new id such as "t-k3x9q2a" (`prefix` says what it's for: "t" track, "c" clip, "n" note, "a" sound).
 * Random, with a running count on the end so two made in one session never clash.
 */
export function newId(prefix: string): string {
  idCount += 1;
  return `${prefix}-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}${idCount.toString(36)}`;
}

/** An empty song: 120 bpm, four beats in a bar, no tracks. */
export function newSong(name = DEFAULT_NAME): Song {
  return {
    name,
    bpm: DEFAULT_BPM,
    beatsPerBar: DEFAULT_BEATS_PER_BAR,
    master: DEFAULT_VOLUME,
    loop: { on: false, start: 0, end: 16 },
    tracks: [],
    clips: [],
    audio: [],
  };
}

/** The names shown for the built-in instruments (ids as in src/audio/instruments.ts). */
const INSTRUMENT_LABELS: Record<string, string> = {
  piano: "Piano",
  "felt-piano": "Soft piano",
  "electric-piano": "Electric piano",
  organ: "Organ",
  strings: "Strings",
  pad: "Pad",
  choir: "Choir",
  bass: "Bass",
  "synth-bass": "Synth bass",
  "sub-bass": "Sub bass",
  "growl-bass": "Gritty bass",
  lead: "Lead",
  supersaw: "Big saw",
  wobble: "Wobbly synth",
  pluck: "Pluck",
  bells: "Bells",
  sweep: "Noise sweep",
  drums: "Drums",
  "drums-808": "808 kit",
  "drums-electro": "Electronic kit",
  "bass-808": "808 bass",
  guitar: "Acoustic guitar",
  harp: "Harp",
  kalimba: "Kalimba",
  marimba: "Marimba",
  flute: "Flute",
  brass: "Brass",
};

/** The instruments that are drum kits (each key a different drum, as DRUM_PITCHES in time.ts). */
export const DRUM_KITS: readonly string[] = ["drums", "drums-808", "drums-electro"];

/** Is this instrument one of the drum kits? */
export function isDrumKit(instrument: string | null | undefined): boolean {
  return !!instrument && DRUM_KITS.includes(instrument);
}

/** A friendly name for an instrument id ("electric-piano" → "Electric piano"); unknown ids are tidied up the same way. */
export function instrumentLabel(instrument: string): string {
  const known = INSTRUMENT_LABELS[instrument];
  if (known) return known;
  const words = instrument.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Instrument";
}

/** The name a new track of this sort starts with: "Piano", then "Piano 2"…; sound tracks are "Recording 1", "Recording 2"… (the app calls them sound tracks; "audio" is only the word in the code and in files) */
export function freeTrackName(kind: TrackKind, instrument: string, existingTracks: readonly Track[]): string {
  const taken = new Set(existingTracks.map((t) => t.name.trim().toLowerCase()));
  if (kind === "audio") {
    for (let i = 1; ; i++) if (!taken.has(`recording ${i}`)) return `Recording ${i}`;
  }
  const base = instrumentLabel(instrument);
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base.toLowerCase()} ${i}`)) return `${base} ${i}`;
}

/** The colour the next track takes: the one after the last track's, round and round TRACK_COLOURS. */
export function nextTrackColour(existingTracks: readonly Track[]): string {
  if (!existingTracks.length) return TRACK_COLOURS[0];
  const last = TRACK_COLOURS.indexOf(existingTracks[existingTracks.length - 1].colour as (typeof TRACK_COLOURS)[number]);
  return TRACK_COLOURS[(last < 0 ? existingTracks.length : last + 1) % TRACK_COLOURS.length];
}

/**
 * A new track with a friendly name not already used ("Piano", "Piano 2", "Drums", "Recording 1"), the next colour,
 * the usual volume, in the middle, a touch of reverb on instruments.
 */
export function newTrack(kind: TrackKind, instrument: string, existingTracks: readonly Track[]): Track {
  const inst = kind === "instrument" ? instrument || DEFAULT_INSTRUMENT : "";
  return {
    id: newId("t"),
    kind,
    name: freeTrackName(kind, inst, existingTracks),
    colour: nextTrackColour(existingTracks),
    volume: DEFAULT_VOLUME,
    pan: 0,
    mute: false,
    solo: false,
    instrument: inst,
    reverb: kind === "instrument" ? DEFAULT_REVERB : 0,
    echo: 0,
  };
}

/** A song name from a file name ("My tune.juradaw" → "My tune"). */
export function nameFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim();
}

// ---------------------------------------------------------------------------
// Reading, carefully.

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const within = (v: unknown, min: number, max: number, fallback: number): number => Math.min(max, Math.max(min, num(v, fallback)));
const text = (v: unknown, fallback: string, most = 200): string => (typeof v === "string" && v.trim() ? v.trim().slice(0, most) : fallback);

/** An id from a file if it's usable and not already taken, else a new one. Recorded as taken. */
function idOf(v: unknown, prefix: string, taken: Set<string>): string {
  let id = typeof v === "string" && v && v.length <= 80 && !taken.has(v) ? v : newId(prefix);
  while (taken.has(id)) id = newId(prefix);
  taken.add(id);
  return id;
}

const isColour = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v);
const isInstrumentId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(v);

function parseTrack(v: unknown, taken: Set<string>, before: readonly Track[]): Track | null {
  if (!isObject(v)) return null;
  if (v.kind !== "instrument" && v.kind !== "audio") return null;
  const kind: TrackKind = v.kind;
  const instrument = kind === "instrument" ? (isInstrumentId(v.instrument) ? v.instrument : DEFAULT_INSTRUMENT) : "";
  return {
    id: idOf(v.id, "t", taken),
    kind,
    name: text(v.name, freeTrackName(kind, instrument, before), 80),
    colour: isColour(v.colour) ? v.colour : nextTrackColour(before),
    volume: within(v.volume, 0, 1, DEFAULT_VOLUME),
    pan: within(v.pan, -1, 1, 0),
    mute: v.mute === true,
    solo: v.solo === true,
    instrument,
    reverb: within(v.reverb, 0, 1, kind === "instrument" ? DEFAULT_REVERB : 0),
    echo: within(v.echo, 0, 1, 0),
    ...parseEffects(v),
  };
}

/** A track's own effects from a file: only the ones that are switched on are kept. */
type Extras = "drive" | "crush" | "filter" | "chorus" | "pump" | "lows" | "highs" | "chop" | "arp" | "automation" | "harmony" | "squeeze" | "sway" | "swirl" | "swing" | "filterWobble";
function parseEffects(v: Record<string, unknown>): Pick<Track, Extras> {
  const out: Pick<Track, Extras> = {};
  for (const key of ["lows", "highs"] as const) {
    const amount = tone(v[key]);
    if (amount !== 0) out[key] = amount;
  }
  if (v.kind === "instrument") {
    const arp = cleanArp(v.arp);
    if (arp) out.arp = arp;
  }
  const harmony = cleanHarmony(v.harmony);
  if (harmony) out.harmony = harmony;
  const automation = cleanAutomation(v.automation);
  if (automation) out.automation = automation;
  const filterWobble = cleanFilterWobble(v.filterWobble);
  if (filterWobble) out.filterWobble = filterWobble;
  for (const key of ["drive", "crush", "chorus", "pump", "chop", "squeeze", "sway", "swirl", "swing"] as const) {
    const amount = within(v[key], 0, 1, 0);
    if (amount > 0) out[key] = amount;
  }
  if (isObject(v.filter)) {
    const filter = cleanFilter(v.filter as Partial<Track["filter"] & object>);
    if (filterIsOn(filter) || filter.resonance > 0) out.filter = filter;
  }
  return out;
}

/** A clip's fades and filter sweep from a file (left out when there are none). */
function parseShape(v: Record<string, unknown>): Pick<Clip, "fadeIn" | "fadeOut" | "sweep"> {
  const out: Pick<Clip, "fadeIn" | "fadeOut" | "sweep"> = {};
  const fadeIn = within(v.fadeIn, 0, MOST_BEATS, 0);
  const fadeOut = within(v.fadeOut, 0, MOST_BEATS, 0);
  if (fadeIn >= MIN_LENGTH) out.fadeIn = fadeIn;
  if (fadeOut >= MIN_LENGTH) out.fadeOut = fadeOut;
  const sweep = cleanSweep(v.sweep);
  if (sweep) out.sweep = sweep;
  return out;
}

function parseAudioInfo(v: unknown, taken: Set<string>): AudioInfo | null {
  if (!isObject(v)) return null;
  // A sound's id is what its clips and the kept samples know it by, so it can't be swapped for a new one.
  // "__proto__" is refused: sounds are looked up by id in plain objects (the file's `sounds`), where that name is no ordinary key.
  if (typeof v.id !== "string" || !v.id || v.id.length > 80 || v.id === "__proto__" || taken.has(v.id)) return null;
  const seconds = Math.min(MOST_SECONDS, num(v.seconds, 0));
  if (!(seconds > 0)) return null;
  taken.add(v.id);
  return {
    id: v.id,
    name: text(v.name, "Sound", 120),
    seconds,
    sampleRate: Math.round(within(v.sampleRate, 3000, 768000, 44100)),
    channels: Math.round(within(v.channels, 1, 2, 1)),
  };
}

function parseNote(v: unknown, taken: Set<string>): Note | null {
  if (!isObject(v)) return null;
  if (typeof v.pitch !== "number" || !Number.isFinite(v.pitch)) return null;
  return {
    id: idOf(v.id, "n", taken),
    pitch: Math.round(within(v.pitch, 0, 127, 60)),
    start: within(v.start, 0, MOST_BEATS, 0),
    length: within(v.length, MIN_LENGTH, MOST_BEATS, 1),
    velocity: Math.round(within(v.velocity, 1, 127, 100)),
  };
}

function parseClip(v: unknown, taken: Set<string>, tracks: ReadonlyMap<string, Track>, sounds: ReadonlyMap<string, AudioInfo>): Clip | null {
  if (!isObject(v)) return null;
  const track = typeof v.trackId === "string" ? tracks.get(v.trackId) : undefined;
  if (!track) return null;
  const start = within(v.start, 0, MOST_BEATS, 0);
  if (v.kind === "midi") {
    if (track.kind !== "instrument") return null;
    const id = idOf(v.id, "c", taken);
    const notes = Array.isArray(v.notes)
      ? v.notes
          .slice(0, MOST_NOTES)
          .map((n) => parseNote(n, taken))
          .filter((n): n is Note => !!n)
      : [];
    const clip: MidiClip = { id, trackId: track.id, name: text(v.name, track.name, 80), start, kind: "midi", length: within(v.length, MIN_LENGTH, MOST_BEATS, 4), notes, ...parseShape(v) };
    const gain = within(v.gain, 0, 2, 1);
    if (gain !== 1) clip.gain = gain;
    return clip;
  }
  if (v.kind === "audio") {
    if (track.kind !== "audio") return null;
    const info = typeof v.audioId === "string" ? sounds.get(v.audioId) : undefined;
    if (!info) return null;
    const offset = within(v.offset, 0, info.seconds, 0);
    const duration = Math.min(num(v.duration, info.seconds), info.seconds - offset);
    if (!(duration >= MIN_SECONDS)) return null;
    const clip: AudioClip = {
      id: idOf(v.id, "c", taken),
      trackId: track.id,
      name: text(v.name, info.name, 80),
      start,
      kind: "audio",
      audioId: info.id,
      offset,
      duration,
      gain: within(v.gain, 0, 2, 1),
      ...parseShape(v),
      ...(v.reverse === true ? { reverse: true as const } : {}),
    };
    return clip;
  }
  return null;
}

function parseLoop(v: unknown, beatsPerBar: number): Loop {
  const l = isObject(v) ? v : {};
  const start = within(l.start, 0, MOST_BEATS, 0);
  const end = Math.min(num(l.end, 0), start + MOST_BEATS);
  return { on: l.on === true, start, end: end > start ? end : start + 4 * beatsPerBar };
}

/**
 * A song from a saved one — its JSON text, or the parsed value — or null when it isn't a song at all. Never throws.
 * Every value is checked and odd ones fall back to something sensible (times no further or longer than MOST_BEATS); clips on tracks that aren't there (or of the
 * wrong sort for their track) and audio clips whose sound isn't listed are dropped; ids are made unique; sounds no
 * clip uses are left out. A whole .juradaw file ({ app, version, song, sounds }) is read too, for its song.
 */
export function parseSong(raw: unknown): Song | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!isObject(value)) return null;
  if (value.app === FILE_APP && isObject(value.song)) value = value.song;
  const s = value as Record<string, unknown>;
  if (!Array.isArray(s.tracks)) return null;

  const taken = new Set<string>();
  const tracks: Track[] = [];
  for (const t of s.tracks) {
    if (tracks.length >= MOST_TRACKS) break;
    const track = parseTrack(t, taken, tracks);
    if (track) tracks.push(track);
  }
  const soundIds = new Set<string>();
  const audio = Array.isArray(s.audio) ? s.audio.map((a) => parseAudioInfo(a, soundIds)).filter((a): a is AudioInfo => !!a) : [];
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const soundById = new Map(audio.map((a) => [a.id, a]));
  const clips = Array.isArray(s.clips)
    ? s.clips
        .slice(0, MOST_CLIPS)
        .map((c) => parseClip(c, taken, trackById, soundById))
        .filter((c): c is Clip => !!c)
    : [];
  const used = new Set(clips.flatMap((c) => (c.kind === "audio" ? [c.audioId] : [])));
  const beatsPerBar = Math.round(within(s.beatsPerBar, 2, 12, DEFAULT_BEATS_PER_BAR));
  return {
    name: text(s.name, DEFAULT_NAME),
    bpm: within(s.bpm, MIN_BPM, MAX_BPM, DEFAULT_BPM),
    beatsPerBar,
    master: within(s.master, 0, 1, DEFAULT_VOLUME),
    loop: parseLoop(s.loop, beatsPerBar),
    tracks,
    clips,
    audio: audio.filter((a) => used.has(a.id)),
  };
}

// ---------------------------------------------------------------------------
// The .juradaw file.

/** Sounds by their id (Song.audio[].id), each a WAV file as base64 text. */
export type SoundsBase64 = Record<string, string>;

/** The most characters a .juradaw file is written with: comfortably under the longest text a browser can hold in one piece (about 400 MB of sound). */
export const MOST_FILE_CHARS = 400_000_000;
/** What to tell someone whose song's sounds are too big to save in one file. */
export const SAVE_TOO_BIG = "This song's recordings and sound files are too big to save in one file (the limit is about 300 MB of sound). Remove or shorten some audio clips, then save again.";

/**
 * A .juradaw file as pieces of text to be joined end to end — hand them to `new Blob(parts)` and a big song is never
 * held as one giant string. The song, and its sounds as base64 WAV (only those the song lists are written). Throws an
 * Error saying SAVE_TOO_BIG when it would come to more than `mostChars` characters.
 */
export function songFileParts(song: Song, sounds: SoundsBase64 = {}, mostChars = MOST_FILE_CHARS): string[] {
  const parts = [`{"app":${JSON.stringify(FILE_APP)},"version":${FILE_VERSION},"song":${JSON.stringify(song)},"sounds":{`];
  let first = true;
  for (const info of song.audio) {
    const wav = Object.prototype.hasOwnProperty.call(sounds, info.id) ? sounds[info.id] : undefined;
    if (typeof wav !== "string") continue;
    // Base64 needs no escaping, so it goes in as it is (no second copy of a long recording); anything else is written as JSON text.
    if (/^[A-Za-z0-9+/=_-]*$/.test(wav)) parts.push(`${first ? "" : ","}${JSON.stringify(info.id)}:"`, wav, '"');
    else parts.push(`${first ? "" : ","}${JSON.stringify(info.id)}:${JSON.stringify(wav)}`);
    first = false;
  }
  parts.push("}}");
  if (parts.reduce((sum, p) => sum + p.length, 0) > mostChars) throw new Error(SAVE_TOO_BIG);
  return parts;
}

/**
 * The text of a .juradaw file: the song, and its sounds as base64 WAV (only those the song lists are written).
 * Throws an Error saying SAVE_TOO_BIG (words to show as they are) when the sounds are too big for one file.
 */
export function songFileText(song: Song, sounds: SoundsBase64 = {}): string {
  const parts = songFileParts(song, sounds);
  try {
    return parts.join("");
  } catch {
    // The browser's own limit on one piece of text came first.
    throw new Error(SAVE_TOO_BIG);
  }
}

export type ReadResult = { ok: true; song: Song; sounds: SoundsBase64; missingSounds: string[] } | { ok: false; error: string };

/**
 * Read a .juradaw file's text: the song (checked by `parseSong`), its sounds as base64 WAV, and the ids of sounds the
 * song uses that the file doesn't hold. A friendly `error` when it isn't a JuraDAW song.
 */
export function readSongFile(fileText: string, fileName = "the file"): ReadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(fileText);
  } catch {
    return { ok: false, error: `${fileName} isn't a JuraDAW song (it isn't valid JSON).` };
  }
  const notOurs = `${fileName} isn't a JuraDAW song. Choose a .juradaw file, or import a MIDI or sound file.`;
  if (!isObject(raw) || raw.app !== FILE_APP) return { ok: false, error: notOurs };
  const song = parseSong(raw.song);
  if (!song) return { ok: false, error: notOurs };
  const given = isObject(raw.sounds) ? raw.sounds : {};
  const sounds: SoundsBase64 = {};
  const missingSounds: string[] = [];
  for (const info of song.audio) {
    const wav = given[info.id];
    if (typeof wav === "string" && wav) sounds[info.id] = wav;
    else missingSounds.push(info.id);
  }
  return { ok: true, song, sounds, missingSounds };
}

// ---------------------------------------------------------------------------
// Base64, written out here so it's the same in Node and every browser.

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_VALUE = new Int16Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_VALUE[B64.charCodeAt(i)] = i;
// The web-safe letters too.
B64_VALUE["-".charCodeAt(0)] = 62;
B64_VALUE["_".charCodeAt(0)] = 63;

const B64_CODE = Uint8Array.from(B64, (c) => c.charCodeAt(0));
const PAD = "=".charCodeAt(0);

/** Bytes as base64 text. */
export function bytesToBase64(bytes: Uint8Array): string {
  // Written as letter codes into a buffer and turned into text a chunk at a time: many times quicker for long recordings than adding letter to letter.
  const CHUNK = 3 * 16384;
  const decoder = new TextDecoder("latin1");
  const codes = new Uint8Array((CHUNK / 3) * 4);
  const parts: string[] = [];
  for (let from = 0; from < bytes.length; from += CHUNK) {
    const to = Math.min(bytes.length, from + CHUNK);
    let at = 0;
    let i = from;
    for (; i + 2 < to; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      codes[at++] = B64_CODE[n >> 18];
      codes[at++] = B64_CODE[(n >> 12) & 63];
      codes[at++] = B64_CODE[(n >> 6) & 63];
      codes[at++] = B64_CODE[n & 63];
    }
    if (i < to) {
      const n = (bytes[i] << 16) | (i + 1 < to ? bytes[i + 1] << 8 : 0);
      codes[at++] = B64_CODE[n >> 18];
      codes[at++] = B64_CODE[(n >> 12) & 63];
      codes[at++] = i + 1 < to ? B64_CODE[(n >> 6) & 63] : PAD;
      codes[at++] = PAD;
    }
    parts.push(decoder.decode(codes.subarray(0, at)));
  }
  return parts.join("");
}

/** Base64 text back as bytes (spaces and line breaks ignored), or null when it isn't base64. */
export function base64ToBytes(base64: string): Uint8Array | null {
  let end = base64.length;
  while (end > 0 && (base64[end - 1] === "=" || base64.charCodeAt(end - 1) <= 32)) end--;
  const out = new Uint8Array(Math.floor((end * 3) / 4));
  let bits = 0;
  let have = 0;
  let at = 0;
  for (let i = 0; i < end; i++) {
    const code = base64.charCodeAt(i);
    if (code <= 32) continue;
    const value = code < 128 ? B64_VALUE[code] : -1;
    if (value < 0) return null;
    bits = (bits << 6) | value;
    have += 6;
    if (have >= 8) {
      have -= 8;
      out[at++] = (bits >> have) & 255;
    }
  }
  // Six left-over bits can't be a byte: the text was cut short.
  if (have >= 6) return null;
  return at === out.length ? out : out.slice(0, at);
}
