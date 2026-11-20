import { describe, expect, it } from "vitest";
import { parseChangelog, changesFor, boldPieces } from "../src/model/changelog";
import { base64ToBytes, bytesToBase64, DEFAULT_NAME, MOST_BEATS, MOST_SECONDS, SAVE_TOO_BIG, freeTrackName, instrumentLabel, nameFromFileName, newId, newSong, newTrack, parseSong, readSongFile, songFileParts, songFileText } from "../src/model/document";
import { songLength } from "../src/model/time";
import { KEEP_PROBLEM, KEEP_UNAVAILABLE, STORAGE_KEY, forgetKept, keepInBrowser, keepProblem, readKept } from "../src/model/keep";
import { MOST_TRACKS, TRACK_COLOURS, type Song, type Track } from "../src/model/types";

const track = (id: string, kind: "instrument" | "audio" = "instrument"): Track => ({ ...newTrack(kind, "piano", []), id });

/** A small song with one of everything. */
function sample(): Song {
  const piano = track("t1");
  const voice = track("t2", "audio");
  return {
    ...newSong("Tune"),
    bpm: 96,
    beatsPerBar: 3,
    tracks: [piano, voice],
    clips: [
      { id: "c1", trackId: "t1", name: "Verse", start: 3, kind: "midi", length: 6, notes: [{ id: "n1", pitch: 60, start: 0, length: 1, velocity: 100 }] },
      { id: "c2", trackId: "t2", name: "Voice", start: 0, kind: "audio", audioId: "a1", offset: 0.5, duration: 2, gain: 1 },
    ],
    audio: [{ id: "a1", name: "Voice", seconds: 4, sampleRate: 48000, channels: 1 }],
  };
}

describe("new things", () => {
  it("makes ids that never repeat", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId("n")));
    expect(ids.size).toBe(500);
    expect([...ids][0]).toMatch(/^n-[a-z0-9]+$/);
  });
  it("starts a song empty at 120 bpm in 4/4", () => {
    expect(newSong()).toEqual({ name: "Untitled song", bpm: 120, beatsPerBar: 4, master: 0.8, loop: { on: false, start: 0, end: 16 }, tracks: [], clips: [], audio: [] });
    expect(DEFAULT_NAME).toBe("Untitled song");
  });
  it("names tracks after their instrument, numbering repeats", () => {
    const a = newTrack("instrument", "piano", []);
    const b = newTrack("instrument", "piano", [a]);
    const c = newTrack("instrument", "piano", [a, b]);
    expect([a.name, b.name, c.name]).toEqual(["Piano", "Piano 2", "Piano 3"]);
    expect(newTrack("instrument", "drums", [a]).name).toBe("Drums");
    expect(newTrack("instrument", "electric-piano", []).name).toBe("Electric piano");
    expect(newTrack("audio", "", []).name).toBe("Recording 1");
    expect(newTrack("audio", "", [newTrack("audio", "", [])]).name).toBe("Recording 2");
    expect(instrumentLabel("steel-drum")).toBe("Steel drum");
    expect(freeTrackName("instrument", "bass", [{ ...a, name: "bass" }])).toBe("Bass 2");
  });
  it("gives each new track the next colour and sensible levels", () => {
    const a = newTrack("instrument", "piano", []);
    const b = newTrack("audio", "", [a]);
    expect(a.colour).toBe(TRACK_COLOURS[0]);
    expect(b.colour).toBe(TRACK_COLOURS[1]);
    expect(a).toMatchObject({ kind: "instrument", instrument: "piano", volume: 0.8, pan: 0, mute: false, solo: false, reverb: 0.15, echo: 0 });
    expect(b).toMatchObject({ kind: "audio", instrument: "", reverb: 0 });
    // Round and round the colours.
    const many: Track[] = [];
    for (let i = 0; i < TRACK_COLOURS.length + 1; i++) many.push(newTrack("instrument", "piano", many));
    expect(many[TRACK_COLOURS.length].colour).toBe(TRACK_COLOURS[0]);
    expect(newTrack("instrument", "", []).instrument).toBe("piano");
  });
  it("takes a song name from a file name", () => {
    expect(nameFromFileName("My tune.juradaw")).toBe("My tune");
    expect(nameFromFileName("a.b.mid")).toBe("a.b");
  });
});

describe("reading a saved song", () => {
  it("reads back what was written, unchanged", () => {
    const song = sample();
    expect(parseSong(JSON.parse(JSON.stringify(song)))).toEqual(song);
    expect(parseSong(JSON.stringify(song))).toEqual(song);
  });
  it("never throws, whatever it's given", () => {
    const odd: unknown[] = [null, undefined, 0, 7, "", "nonsense", "{", "[]", "null", [], {}, { tracks: 3 }, { tracks: {} }, true, () => 1, { song: {} }, '{"tracks":"x"}'];
    for (const v of odd) expect(parseSong(v)).toBeNull();
    const messy = parseSong({ tracks: [null, 3, "x", {}, { kind: "tuba" }, [], { kind: "audio" }], clips: [null, 1, {}, { trackId: 4 }, { kind: "midi" }], audio: "no", loop: 7, bpm: "fast", name: 12 });
    expect(messy).not.toBeNull();
    expect(messy!.tracks.length).toBe(1);
    expect(messy!.clips).toEqual([]);
    expect(messy!.name).toBe("Untitled song");
  });
  it("puts odd values back inside their limits", () => {
    const s = parseSong({
      name: "   ",
      bpm: 9000,
      beatsPerBar: 2.6,
      master: -3,
      loop: { on: "yes", start: -4, end: -10 },
      tracks: [{ id: "t", kind: "instrument", name: "", colour: "javascript:alert(1)", volume: 7, pan: -9, mute: 1, solo: true, instrument: "NOT AN ID!", reverb: NaN, echo: Infinity }],
    })!;
    expect(s.name).toBe("Untitled song");
    expect(s.bpm).toBe(300);
    expect(s.beatsPerBar).toBe(3);
    expect(s.master).toBe(0);
    expect(s.loop).toEqual({ on: false, start: 0, end: 12 });
    expect(s.tracks[0]).toMatchObject({ id: "t", name: "Piano", colour: TRACK_COLOURS[0], volume: 1, pan: -1, mute: false, solo: true, instrument: "piano", reverb: 0.15, echo: 0 });
    expect(parseSong({ tracks: [], bpm: 1 })!.bpm).toBe(30);
    expect(parseSong({ tracks: [] })).toEqual(newSong());
  });
  it("makes ids unique", () => {
    const s = parseSong({
      tracks: [
        { id: "same", kind: "instrument" },
        { id: "same", kind: "instrument" },
        { id: "", kind: "audio" },
      ],
      clips: [
        { id: "c", trackId: "same", kind: "midi", notes: [{ id: "n", pitch: 60 }, { id: "n", pitch: 62 }, { pitch: 64 }] },
        { id: "c", trackId: "same", kind: "midi" },
      ],
    })!;
    const ids = [...s.tracks.map((t) => t.id), ...s.clips.map((c) => c.id), ...s.clips.flatMap((c) => (c.kind === "midi" ? c.notes.map((n) => n.id) : []))];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(s.tracks[0].id).toBe("same");
    // Both clips stay on the first track with that id.
    expect(s.clips.map((c) => c.trackId)).toEqual(["same", "same"]);
    expect(s.tracks.map((t) => t.name)).toEqual(["Piano", "Piano 2", "Recording 1"]);
  });
  it("drops clips with no track, on the wrong sort of track, or with no sound", () => {
    const s = parseSong({
      tracks: [
        { id: "i", kind: "instrument" },
        { id: "a", kind: "audio" },
      ],
      audio: [{ id: "s1", name: "Clap", seconds: 2, sampleRate: 44100, channels: 2 }, { id: "s1", seconds: 9 }, { id: "unused", seconds: 1 }, { id: "silent", seconds: 0 }],
      clips: [
        { id: "ok1", trackId: "i", kind: "midi", start: 4, length: 4, notes: [] },
        { id: "ok2", trackId: "a", kind: "audio", audioId: "s1", start: 1, offset: 0, duration: 2, gain: 1 },
        { id: "gone", trackId: "nowhere", kind: "midi" },
        { id: "wrong1", trackId: "a", kind: "midi" },
        { id: "wrong2", trackId: "i", kind: "audio", audioId: "s1" },
        { id: "nosound", trackId: "a", kind: "audio", audioId: "missing" },
        { id: "what", trackId: "i", kind: "video" },
      ],
    })!;
    expect(s.clips.map((c) => c.id)).toEqual(["ok1", "ok2"]);
    // The repeated sound id is read once, and sounds nothing uses are left out.
    expect(s.audio).toEqual([{ id: "s1", name: "Clap", seconds: 2, sampleRate: 44100, channels: 2 }]);
  });
  it("keeps notes and audio clips inside what's possible", () => {
    const s = parseSong({
      tracks: [
        { id: "i", kind: "instrument" },
        { id: "a", kind: "audio" },
      ],
      audio: [{ id: "s", seconds: 3 }],
      clips: [
        { id: "m", trackId: "i", kind: "midi", start: -5, length: 0, notes: [{ pitch: 200, start: -1, length: 0, velocity: 0 }, { pitch: "C" }, { pitch: 60.4, velocity: 300 }, "x"] },
        { id: "x", trackId: "a", kind: "audio", audioId: "s", offset: 2, duration: 99, gain: 9 },
        { id: "y", trackId: "a", kind: "audio", audioId: "s", offset: 99, duration: 1 },
      ],
    })!;
    const midi = s.clips[0];
    expect(midi.start).toBe(0);
    if (midi.kind !== "midi") throw new Error("expected notes");
    expect(midi.length).toBeGreaterThan(0);
    expect(midi.notes.map((n) => [n.pitch, n.start, n.velocity])).toEqual([
      [127, 0, 1],
      [60, 0, 127],
    ]);
    expect(midi.notes.every((n) => n.length > 0)).toBe(true);
    expect(s.clips[1]).toMatchObject({ id: "x", offset: 2, duration: 1, gain: 2 });
    // Starting past the end of its sound, there's nothing left to play.
    expect(s.clips.length).toBe(2);
    expect(s.audio[0]).toMatchObject({ name: "Sound", sampleRate: 44100, channels: 1 });
  });
  it("stops at the most tracks a song can have", () => {
    const s = parseSong({ tracks: Array.from({ length: 50 }, () => ({ kind: "instrument" })) })!;
    expect(s.tracks.length).toBe(MOST_TRACKS);
  });
});

describe("the .juradaw file", () => {
  it("writes the song and its sounds, and reads them back", () => {
    const song = sample();
    const text = songFileText(song, { a1: "UklGRg==", stray: "AAAA" });
    const raw = JSON.parse(text);
    expect(raw.app).toBe("JuraDAW");
    expect(raw.version).toBe(1);
    expect(Object.keys(raw.sounds)).toEqual(["a1"]);
    const read = readSongFile(text);
    if (!read.ok) throw new Error(read.error);
    expect(read.song).toEqual(song);
    expect(read.sounds).toEqual({ a1: "UklGRg==" });
    expect(read.missingSounds).toEqual([]);
    // parseSong reads a whole file too.
    expect(parseSong(text)).toEqual(song);
  });
  it("says which sounds a file is missing", () => {
    const read = readSongFile(songFileText(sample()));
    if (!read.ok) throw new Error(read.error);
    expect(read.missingSounds).toEqual(["a1"]);
  });
  it("explains kindly when a file isn't a song", () => {
    const bad = ["", "{", "[1,2]", "{}", '{"app":"JuraCUT","song":{"tracks":[]}}', '{"app":"JuraDAW"}', '{"app":"JuraDAW","song":{"tracks":7}}', "null"];
    for (const text of bad) {
      const read = readSongFile(text, "Tune.juradaw");
      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.error).toMatch(/^Tune\.juradaw isn't a JuraDAW song/);
    }
    const read = readSongFile('{"app":"JuraDAW","song":{"tracks":[]},"sounds":"none"}');
    expect(read.ok).toBe(true);
  });
});

describe("base64", () => {
  it("matches the well-known examples", () => {
    const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
    const cases: [string, string][] = [["", ""], ["f", "Zg=="], ["fo", "Zm8="], ["foo", "Zm9v"], ["foob", "Zm9vYg=="], ["fooba", "Zm9vYmE="], ["foobar", "Zm9vYmFy"]];
    for (const [plain, encoded] of cases) {
      expect(bytesToBase64(bytes(plain))).toBe(encoded);
      expect(Array.from(base64ToBytes(encoded)!)).toEqual(Array.from(bytes(plain)));
    }
  });
  it("round-trips every byte value and long data", () => {
    for (const size of [1, 2, 3, 255, 256, 12287, 12288, 12289, 50001]) {
      const data = Uint8Array.from({ length: size }, (_, i) => (i * 31 + (i >> 8)) & 255);
      const back = base64ToBytes(bytesToBase64(data))!;
      expect(back.length).toBe(size);
      expect(back.every((b, i) => b === data[i])).toBe(true);
    }
    expect(bytesToBase64(Uint8Array.from([251, 255, 254]))).toBe("+//+");
  });
  it("agrees with Node's own base64", () => {
    const data = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7919) & 255);
    expect(bytesToBase64(data)).toBe(Buffer.from(data).toString("base64"));
  });
  it("forgives line breaks, missing padding and web-safe letters, but not rubbish", () => {
    expect(Array.from(base64ToBytes("Zm9v\nYmFy\r\n")!)).toEqual([102, 111, 111, 98, 97, 114]);
    expect(Array.from(base64ToBytes("Zg")!)).toEqual([102]);
    expect(Array.from(base64ToBytes("-__-")!)).toEqual([251, 255, 254]);
    expect(base64ToBytes("Zm9v!")).toBeNull();
    expect(base64ToBytes("Z")).toBeNull();
    expect(base64ToBytes("é===")).toBeNull();
  });
});

describe("keeping the song in the browser", () => {
  const memory = () => {
    const kept = new Map<string, string>();
    return { kept, getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) };
  };
  it("keeps and brings back the song", () => {
    const storage = memory();
    expect(readKept(storage)).toBeNull();
    expect(keepInBrowser(storage, sample())).toBe(true);
    expect(storage.kept.has(STORAGE_KEY)).toBe(true);
    expect(STORAGE_KEY).toBe("juradaw.song.v1");
    expect(readKept(storage)).toEqual(sample());
    forgetKept(storage);
    expect(readKept(storage)).toBeNull();
  });
  it("fails quietly with a reason when storage is full or missing", () => {
    const full = { ...memory(), setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(keepInBrowser(full, sample())).toBe(false);
    expect(keepProblem(full, sample())).toBe(KEEP_PROBLEM);
    expect(keepProblem(null, sample())).toBe(KEEP_UNAVAILABLE);
    expect(keepProblem(memory(), sample())).toBeNull();
    const broken = { getItem: () => { throw new Error("blocked"); } };
    expect(readKept(broken)).toBeNull();
    expect(readKept(null)).toBeNull();
    const damaged = memory();
    damaged.kept.set(STORAGE_KEY, "{not json");
    expect(readKept(damaged)).toBeNull();
    forgetKept(null);
  });
});

describe("the version history", () => {
  const text = "# Changelog\n\n## v0.2 — Mixer · commit `abc1234`\n- **Echo** on every track\n- Faster\n  drawing\n\n## v0.1 — First version\n- Tracks\n";
  it("reads versions, titles and changes", () => {
    const versions = parseChangelog(text);
    expect(versions.map((v) => v.version)).toEqual(["0.2", "0.1"]);
    expect(versions[0].title).toBe("Mixer");
    expect(versions[0].changes).toEqual(["**Echo** on every track", "Faster drawing"]);
    expect(changesFor(versions, "0.1.0")!.title).toBe("First version");
    expect(changesFor(versions, "9.9")).toBeUndefined();
    expect(boldPieces("**Echo** on `x`")).toEqual([{ text: "Echo", bold: true }, { text: " on x", bold: false }]);
  });
});

describe("absurd values in a file", () => {
  it("keeps every time within what a song can be", () => {
    const s = parseSong({
      loop: { on: true, start: 1e300, end: 1e308 },
      tracks: [
        { id: "i", kind: "instrument" },
        { id: "a", kind: "audio" },
      ],
      audio: [{ id: "s", seconds: 1e200 }],
      clips: [
        { id: "m", trackId: "i", kind: "midi", start: 1e300, length: 1e308, notes: [{ pitch: 60, start: 1e15, length: 1e300 }] },
        { id: "x", trackId: "a", kind: "audio", audioId: "s", start: 1e15, offset: 0, duration: 1e199 },
      ],
    })!;
    const midi = s.clips[0];
    if (midi.kind !== "midi") throw new Error("expected notes");
    expect(midi).toMatchObject({ start: MOST_BEATS, length: MOST_BEATS });
    expect(midi.notes[0]).toMatchObject({ start: MOST_BEATS, length: MOST_BEATS });
    expect(s.audio[0].seconds).toBe(MOST_SECONDS);
    expect(s.clips[1]).toMatchObject({ start: MOST_BEATS, duration: MOST_SECONDS });
    expect(s.loop.start).toBe(MOST_BEATS);
    expect(s.loop.end).toBeLessThanOrEqual(2 * MOST_BEATS);
    // The song has an end that can be counted to.
    expect(Number.isFinite(songLength(s))).toBe(true);
    expect(songLength(s)).toBeLessThan(1e6);
  });
  it("refuses a sound called __proto__, which a file's list of sounds couldn't hold", () => {
    const text = '{"app":"JuraDAW","version":1,"song":{"tracks":[{"id":"a","kind":"audio"}],"audio":[{"id":"__proto__","seconds":2}],"clips":[{"id":"c","trackId":"a","kind":"audio","audioId":"__proto__","duration":2}]},"sounds":{"__proto__":"AAAA"}}';
    const read = readSongFile(text);
    if (!read.ok) throw new Error(read.error);
    // No sound that silently has no samples: the sound and its clip aren't read at all.
    expect(read.song.audio).toEqual([]);
    expect(read.song.clips).toEqual([]);
    expect(read.missingSounds).toEqual([]);
    expect(({} as Record<string, unknown>).seconds).toBeUndefined();
  });
});

describe("a .juradaw file in pieces", () => {
  const song = (): Song => ({
    ...newSong("Big"),
    tracks: [{ ...newTrack("audio", "", []), id: "a" }],
    clips: [
      { id: "c1", trackId: "a", name: "One", start: 0, kind: "audio", audioId: "s1", offset: 0, duration: 1, gain: 1 },
      { id: "c2", trackId: "a", name: "Two", start: 4, kind: "audio", audioId: "s2", offset: 0, duration: 1, gain: 1 },
    ],
    audio: [
      { id: "s1", name: "One", seconds: 1, sampleRate: 44100, channels: 1 },
      { id: "s2", name: 'Two "quoted"', seconds: 1, sampleRate: 44100, channels: 1 },
    ],
  });
  it("joins up to exactly the file's text, with each sound a piece of its own", () => {
    const sounds = { s1: "UklGRg==", s2: "AAAA", stray: "ZZZZ" };
    const parts = songFileParts(song(), sounds);
    expect(parts.join("")).toBe(songFileText(song(), sounds));
    expect(parts).toContain("UklGRg==");
    expect(JSON.parse(parts.join(""))).toEqual({ app: "JuraDAW", version: 1, song: song(), sounds: { s1: "UklGRg==", s2: "AAAA" } });
    const read = readSongFile(parts.join(""));
    expect(read.ok && read.sounds).toEqual({ s1: "UklGRg==", s2: "AAAA" });
    // No sounds at all is still a proper file.
    expect(JSON.parse(songFileText(song())).sounds).toEqual({});
    // Text that isn't base64 is written safely too.
    expect(JSON.parse(songFileText(song(), { s1: 'a"b\\c\n' })).sounds.s1).toBe('a"b\\c\n');
  });
  it("says kindly that the sounds are too big, rather than crashing", () => {
    const sounds = { s1: "A".repeat(600), s2: "B".repeat(600) };
    expect(() => songFileParts(song(), sounds, 1000)).toThrow(SAVE_TOO_BIG);
    expect(songFileParts(song(), sounds, 100000).length).toBeGreaterThan(4);
    expect(SAVE_TOO_BIG).toMatch(/too big to save in one file/);
  });
});

describe("base64 at speed", () => {
  it("encodes several megabytes quickly and correctly", () => {
    const data = new Uint8Array(6_000_001);
    for (let i = 0; i < data.length; i++) data[i] = (i * 2654435761) >>> 24;
    const started = Date.now();
    const text = bytesToBase64(data);
    // About 0.4 seconds when it was built letter by letter; a few hundredths now.
    expect(Date.now() - started).toBeLessThan(400);
    expect(text).toBe(Buffer.from(data).toString("base64"));
    const back = base64ToBytes(text)!;
    expect(back.length).toBe(data.length);
    expect(Buffer.from(back).equals(Buffer.from(data))).toBe(true);
  });
});
