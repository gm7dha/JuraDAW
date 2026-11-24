/**
 * Claude's tools (src/mcp/tools.ts), on a session of their own: making a song
 * a part at a time, the checks on what's given, saving and opening files.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { INSTRUMENTS } from "../src/audio/instruments";
import { LIBRARY } from "../src/library/catalogue";
import { readMidiFile } from "../src/midi/midiFile";
import { readSongFile, songFileText } from "../src/model/document";
import type { MidiClip } from "../src/model/types";
import { SongFolder } from "../src/mcp/files";
import { Session } from "../src/mcp/session";
import { callTool, FORMAT_GUIDE, INSTRUMENT_IDS, notesOf, pitchOf, TOOLS, type ToolResult } from "../src/mcp/tools";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));

function session() {
  const dir = mkdtempSync(join(tmpdir(), "juradaw-mcp-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return { dir: join(dir, "JuraDAW"), s: new Session(new SongFolder(join(dir, "JuraDAW"))) };
}
const textOf = (r: ToolResult) => r.content.map((c) => c.text).join("\n");
async function ok(s: Session, name: string, args: unknown = {}) {
  const r = await callTool(s, name, args);
  if (r.isError) throw new Error(`${name} failed: ${textOf(r)}`);
  return textOf(r);
}
async function bad(s: Session, name: string, args: unknown = {}) {
  const before = s.song;
  const r = await callTool(s, name, args);
  expect(r.isError, `${name} should be refused`).toBe(true);
  expect(s.song, `${name}: a refused call changes nothing`).toBe(before);
  return textOf(r);
}
const midi = (s: Session) => s.song.clips.filter((c): c is MidiClip => c.kind === "midi");

describe("the tool list", () => {
  it("has a name, title, description and schema for each, and names the app's own instruments", () => {
    expect(TOOLS.length).toBeGreaterThan(15);
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema.type).toBe("object");
      for (const key of t.inputSchema.required ?? []) expect(Object.keys(t.inputSchema.properties)).toContain(key);
    }
    expect([...INSTRUMENT_IDS]).toEqual(INSTRUMENTS.map((i) => i.id));
    for (const id of INSTRUMENT_IDS) expect(FORMAT_GUIDE).toContain(id);
  });
});

describe("pitches and notes", () => {
  it("reads note names, numbers and drums", () => {
    expect(pitchOf("C4", "p", false)).toBe(60);
    expect(pitchOf("c4", "p", false)).toBe(60);
    expect(pitchOf("F#3", "p", false)).toBe(54);
    expect(pitchOf("Bb2", "p", false)).toBe(46);
    expect(pitchOf("C-1", "p", false)).toBe(0);
    expect(pitchOf("G9", "p", false)).toBe(127);
    expect(pitchOf(72, "p", false)).toBe(72);
    expect(pitchOf("kick", "p", true)).toBe(36);
    expect(pitchOf("Closed Hat", "p", true)).toBe(42);
    expect(pitchOf("closed_hat", "p", true)).toBe(42);
    for (const wrong of ["H4", "C", "A10", 128, -1, 60.5, "", null, {}]) expect(() => pitchOf(wrong, "p", false)).toThrow();
  });
  it("fills in length and velocity, and refuses odd notes", () => {
    expect(notesOf([{ pitch: "E4", start: 1.5 }], "notes", false)).toEqual([{ pitch: 64, start: 1.5, length: 1, velocity: 96 }]);
    expect(notesOf([{ pitch: "snare", start: 1 }], "notes", true)[0].length).toBe(0.25);
    expect(() => notesOf([{ pitch: "E4", start: -1 }], "notes", false)).toThrow();
    expect(() => notesOf([{ pitch: "E4", start: 0, length: 0 }], "notes", false)).toThrow();
    expect(() => notesOf([{ pitch: "E4", start: 0, velocity: 200 }], "notes", false)).toThrow();
    expect(() => notesOf([{ pitch: "E4", start: 0, lenght: 2 }], "notes", false)).toThrow("lenght");
  });
});

describe("making a song", () => {
  it("builds tracks, clips and notes, a part at a time", async () => {
    const { s } = session();
    await ok(s, "new_song", { name: "Blues in A", tempo: 96 });
    expect(s.song.bpm).toBe(96);
    await ok(s, "add_track", { instrument: "piano", name: "Chords", volume: 70, pan: -20 });
    expect(s.song.tracks[0]).toMatchObject({ name: "Chords", instrument: "piano", volume: 0.7, pan: -0.2 });
    const said = await ok(s, "add_clip", { track: "Chords", notes: [{ pitch: "A3", start: 0, length: 4 }, { pitch: "C#4", start: 0, length: 4 }, { pitch: "E4", start: 0, length: 4 }, { pitch: "D4", start: 4, length: 4 }] });
    expect(said).toMatch(/bar 1 to 3, 4 notes/);
    const clip = midi(s)[0];
    expect(clip).toMatchObject({ start: 0, length: 8 });
    expect(clip.notes.map((n) => n.pitch)).toEqual([57, 61, 64, 62]);
    // The next clip goes after it by itself; a clip may not lie on another.
    await ok(s, "add_clip", { track: 1, notes: [{ pitch: 60, start: 0 }] });
    expect(midi(s).map((c) => c.start)).toEqual([0, 8]);
    expect(await bad(s, "add_clip", { track: "Chords", start_bar: 2, notes: [{ pitch: 60, start: 0 }] })).toMatch(/on top of a clip.*room from bar 4/);
    // Notes are counted from the clip's start.
    expect(await bad(s, "add_clip", { track: "Chords", start_bar: 9, bars: 1, notes: [{ pitch: 60, start: 32 }] })).toMatch(/from the clip's own start/);
    await ok(s, "add_notes", { track: "Chords", clip: 2, notes: [{ pitch: "G4", start: 2, length: 2, velocity: 80 }] });
    expect(midi(s)[1].notes).toHaveLength(2);
    await ok(s, "remove_notes", { track: "Chords", clip: 2, pitch: "C4" });
    expect(midi(s)[1].notes.map((n) => n.pitch)).toEqual([67]);
    await ok(s, "edit_clip", { clip: clip.id, transpose: 12, velocity: 70, name: "Intro" });
    expect(midi(s)[0].notes.map((n) => n.pitch)).toEqual([69, 73, 76, 74]);
    expect(midi(s)[0].notes.every((n) => n.velocity === 70)).toBe(true);
    await ok(s, "remove_clip", { track: "Chords", clip: 2 });
    await ok(s, "repeat_clip", { clip: "Intro", times: 2 });
    expect(midi(s).map((c) => c.start)).toEqual([0, 8, 16]);
    const look = await ok(s, "describe_song", { notes: true });
    expect(look).toMatch(/Song "Blues in A": 96 beats a minute/);
    expect(look).toMatch(/"Chords" — plays piano/);
    expect(look).toMatch(/beat 0: A4, 4 long, velocity 70/);
    await ok(s, "undo");
    expect(midi(s)).toHaveLength(1);
    await ok(s, "set_song", { tempo: 120, beats_per_bar: 3, loop: { on: true, start_bar: 1, end_bar: 3 } });
    expect(s.song).toMatchObject({ bpm: 120, beatsPerBar: 3, loop: { on: true, start: 0, end: 6 } });
    expect(await bad(s, "set_song", { tempo: 1000 })).toMatch(/tempo/);
    expect(await bad(s, "set_song", { loop: { start_bar: 4, end_bar: 2 } })).toMatch(/end_bar must be after/);
    await ok(s, "edit_track", { track: "Chords", instrument: "organ", mute: true });
    expect(s.song.tracks[0]).toMatchObject({ instrument: "organ", mute: true });
    await ok(s, "remove_track", { track: "Chords" });
    expect(s.song.tracks).toHaveLength(0);
    expect(s.song.clips).toHaveLength(0);
  });

  it("says what's wrong in words, and changes nothing", async () => {
    const { s } = session();
    expect(await bad(s, "add_clip", { track: "Piano", notes: [] })).toMatch(/no tracks yet/);
    await ok(s, "add_track", { instrument: "drums" });
    expect(await bad(s, "add_track", { instrument: "kazoo" })).toMatch(/"piano"/);
    expect(await bad(s, "add_track", { instrument: "drums", name: "Drums" })).toMatch(/already a track called/);
    expect(await bad(s, "add_clip", { track: "Bass", notes: [] })).toMatch(/no track called "Bass".*"Drums"/);
    expect(await bad(s, "add_clip", { track: "Drums", notes: [{ pitch: "tambourine", start: 0 }] })).toMatch(/kick/);
    expect(await bad(s, "add_clip", { track: "Drums", noets: [] })).toMatch(/"noets" isn't a setting/);
    expect(await bad(s, "edit_clip", { clip: "x" })).toMatch(/no clips yet/);
    await ok(s, "add_clip", { track: "Drums", bars: 1, notes: [{ pitch: "kick", start: 0 }, { pitch: "snare", start: 1 }] });
    expect(midi(s)[0].notes.map((n) => [n.pitch, n.length])).toEqual([[36, 0.25], [38, 0.25]]);
    expect(await bad(s, "edit_clip", { clip: 1, track: "Drums", transpose: 2 })).toMatch(/drum/);
    expect(await bad(s, "edit_clip", { clip: 1, track: "Drums" })).toMatch(/say what to change/);
    expect(await bad(s, "no_such_tool")).toMatch(/no tool called/);
    expect(await bad(s, "insert_library_pattern", { pattern: "nope" })).toMatch(/list_library_patterns/);
  });
});

describe("shaping the sound", () => {
  it("uses the v0.6 effects, the band filter, the filter wobble and the acoustic instruments", async () => {
    const { s } = session();
    await ok(s, "add_track", { instrument: "growl-bass", name: "Wub", squeeze: 40, filter: { kind: "low", cutoff: 60 }, filter_wobble: { rate: 0.333, depth: 80 } });
    expect(s.song.tracks[0]).toMatchObject({ squeeze: 0.4, filterWobble: { rate: 1 / 3, depth: 0.8 } });
    await ok(s, "add_track", { instrument: "marimba", name: "Mallets", swing: 50, sway: 30, swirl: 20, filter: { kind: "band", cutoff: 50 } });
    expect(s.song.tracks[1]).toMatchObject({ instrument: "marimba", swing: 0.5, sway: 0.3, swirl: 0.2, filter: { kind: "band" } });
    const look = await ok(s, "describe_song");
    expect(look).toMatch(/filter wobble three times a beat, depth 80%/);
    expect(look).toMatch(/swirl 20%, sway 30%, swing 50%/);
    expect(await bad(s, "edit_track", { track: "Wub", filter_wobble: { rate: 3 } })).toMatch(/rate/);
    await ok(s, "edit_track", { track: "Wub", filter_wobble: null });
    expect("filterWobble" in s.song.tracks[0]).toBe(false);
    for (const id of ["guitar", "harp", "kalimba", "flute", "brass"]) await ok(s, "add_track", { instrument: id });
  });
  it("switches the harmoniser on, changes it and takes it off", async () => {
    const { s } = session();
    await ok(s, "add_track", { instrument: "choir", name: "Voices", harmoniser: { voices: "minor", volume: 50 } });
    expect(s.song.tracks[0].harmony).toEqual({ style: "minor", amount: 0.5 });
    await ok(s, "edit_track", { track: "Voices", harmoniser: { voices: "wide" } });
    expect(s.song.tracks[0].harmony).toEqual({ style: "wide", amount: 0.5 });
    expect(await ok(s, "describe_song")).toMatch(/harmoniser wide at 50%/);
    expect(await bad(s, "edit_track", { track: "Voices", harmoniser: { voices: "sixth" } })).toMatch(/voices/);
    await ok(s, "edit_track", { track: "Voices", harmoniser: null });
    expect("harmony" in s.song.tracks[0]).toBe(false);
  });
  it("draws, describes and takes off automation lines", async () => {
    const { s } = session();
    await ok(s, "add_track", { instrument: "pad", name: "Pad" });
    expect(await ok(s, "set_automation", { track: "Pad", what: "volume", points: [{ bar: 1, value: 0 }, { bar: 5, value: 80 }] })).toMatch(/volume line on "Pad" with 2 points/);
    expect(s.song.tracks[0].automation).toEqual({ volume: [{ beat: 0, value: 0 }, { beat: 16, value: 0.8 }] });
    await ok(s, "set_automation", { track: "Pad", what: "pan", points: [{ bar: 1.5, value: -100 }, { bar: 3, value: 100 }] });
    expect(s.song.tracks[0].automation?.pan).toEqual([{ beat: 2, value: 0 }, { beat: 8, value: 1 }]);
    const look = await ok(s, "describe_song");
    expect(look).toMatch(/volume line: bar 1 0 → bar 5 80/);
    expect(look).toMatch(/left–right line: bar 1.5 -100 → bar 3 100/);
    expect(await bad(s, "set_automation", { track: "Pad", what: "filter", points: [{ bar: 1, value: 120 }] })).toMatch(/value/);
    expect(await bad(s, "set_automation", { track: "Pad", what: "filter", points: [{ bar: 2, value: 1 }, { bar: 2, value: 5 }] })).toMatch(/same place/);
    expect(await bad(s, "set_automation", { track: "Pad", what: "loudness", points: null })).toMatch(/what/);
    await ok(s, "set_automation", { track: "Pad", what: "volume", points: null });
    await ok(s, "set_automation", { track: "Pad", what: "pan", points: null });
    expect("automation" in s.song.tracks[0]).toBe(false);
  });
  it("sets a track's own effects and a clip's volume, fades and filter sweep", async () => {
    const { s } = session();
    await ok(s, "add_track", { instrument: "supersaw", name: "Chords", pump: 60, drive: 20, filter: { kind: "low", cutoff: 70, resonance: 30 } });
    expect(s.song.tracks[0]).toMatchObject({ instrument: "supersaw", pump: 0.6, drive: 0.2, filter: { kind: "low", cutoff: 0.7, resonance: 0.3 } });
    await ok(s, "edit_track", { track: "Chords", crush: 40, wobble: 25, filter: { cutoff: 50 }, pump: 0 });
    expect(s.song.tracks[0]).toMatchObject({ crush: 0.4, chorus: 0.25, filter: { kind: "low", cutoff: 0.5, resonance: 0.3 } });
    expect("pump" in s.song.tracks[0]).toBe(false);
    const said = await ok(s, "add_clip", { track: "Chords", bars: 4, notes: [{ pitch: "C4", start: 0, length: 16 }], volume: 80, fade_in: 8, filter_sweep: { from: 20, to: 100 } });
    expect(said).toMatch(/volume 80%, fades in over 8 beats, filter sweep 20% to 100%/);
    expect(midi(s)[0]).toMatchObject({ gain: 0.8, fadeIn: 8, sweep: { from: 0.2, to: 1 } });
    await ok(s, "edit_clip", { clip: 1, track: "Chords", fade_out: 4, filter_sweep: null, volume: 100 });
    const clip = midi(s)[0];
    expect(clip).toMatchObject({ fadeIn: 8, fadeOut: 4 });
    expect("sweep" in clip || "gain" in clip).toBe(false);
    const look = await ok(s, "describe_song");
    expect(look).toMatch(/drive 20%, crush 40%, filter low at 50% \(resonance 30%\), wobble 25%/);
    expect(look).toMatch(/fades in over 8 beats, fades out over 4 beats/);
    await ok(s, "edit_track", { track: "Chords", filter: null });
    expect("filter" in s.song.tracks[0]).toBe(false);
    expect(await bad(s, "edit_track", { track: "Chords", drive: 140 })).toMatch(/drive/);
    expect(await bad(s, "edit_track", { track: "Chords", filter: { kind: "notch" } })).toMatch(/"low", "high", "band"/);
    expect(await bad(s, "edit_clip", { clip: 1, track: "Chords", filter_sweep: { from: 10 } })).toMatch(/filter_sweep\.to/);
    // A build: a noise sweep that lasts as long as its note.
    await ok(s, "add_track", { instrument: "sweep" });
    await ok(s, "add_clip", { track: "Noise sweep", start_bar: 1, notes: [{ pitch: "C5", start: 0, length: 16 }] });
    expect(midi(s).find((c) => c.name === "Noise sweep")?.length).toBe(16);
  });
});

describe("kits, tone, chop and the arpeggiator", () => {
  it("are all within Claude's reach", async () => {
    const { s } = session();
    await ok(s, "add_track", { instrument: "drums-808", name: "Beat" });
    await ok(s, "add_clip", { track: "Beat", bars: 1, notes: [{ pitch: "kick", start: 0 }, { pitch: "clap", start: 2 }] });
    expect(midi(s)[0].notes.map((n) => n.pitch)).toEqual([36, 39]);
    // A drum beat from the library goes on the 808 kit that's there, after its clip.
    await ok(s, "insert_library_pattern", { pattern: "drums-house" });
    expect(s.song.tracks).toHaveLength(1);
    await ok(s, "add_track", { instrument: "pluck", name: "Arp", bass: -30, treble: 50, chop: 40, arpeggiator: { style: "updown", rate: "sixteenths", octaves: 2 } });
    expect(s.song.tracks[1]).toMatchObject({ lows: -0.3, highs: 0.5, chop: 0.4, arp: { style: "updown", rate: 0.25, octaves: 2 } });
    expect(await ok(s, "describe_song")).toMatch(/bass -30, treble 50, chop 40%, arpeggiator updown, sixteenth notes, 2 octaves/);
    await ok(s, "edit_track", { track: "Arp", arpeggiator: { rate: "triplets" } });
    expect(s.song.tracks[1].arp).toEqual({ style: "updown", rate: 1 / 3, octaves: 2 });
    await ok(s, "edit_track", { track: "Arp", arpeggiator: null, chop: 0 });
    expect("arp" in s.song.tracks[1] || "chop" in s.song.tracks[1]).toBe(false);
    expect(await bad(s, "edit_track", { track: "Arp", arpeggiator: { rate: "fast" } })).toMatch(/"sixteenths"/);
    expect(await bad(s, "edit_track", { track: "Arp", bass: 300 })).toMatch(/bass/);
    await ok(s, "add_clip", { track: "Arp", notes: [{ pitch: "C4", start: 0, length: 4 }] });
    expect(await bad(s, "edit_clip", { track: "Arp", clip: 1, reverse: true })).toMatch(/only recordings/);
    await ok(s, "insert_library_pattern", { pattern: "bass-808", settings: { key: "F", scale: "minor" } });
    expect(s.song.tracks.map((t) => t.instrument)).toContain("bass-808");
  });
});

describe("the library", () => {
  it("lists every pattern and puts each in on a track of its own kind", async () => {
    const { s } = session();
    const listed = await ok(s, "list_library_patterns");
    for (const p of LIBRARY) expect(listed).toContain(`- ${p.id} —`);
    expect(await ok(s, "list_library_patterns", { search: "drum rock" })).toMatch(/rock/i);
    const drums = LIBRARY.find((p) => p.kind === "drums" && p.beatsPerBar === 4)!;
    const bass = LIBRARY.find((p) => p.kind === "bass")!;
    const chords = LIBRARY.find((p) => p.kind === "chords")!;
    await ok(s, "insert_library_pattern", { pattern: drums.id });
    await ok(s, "insert_library_pattern", { pattern: bass.id, settings: { key: "A", scale: "minor" } });
    await ok(s, "insert_library_pattern", { pattern: chords.id, settings: { key: "A", scale: "minor" } });
    expect(s.song.tracks.map((t) => t.instrument)).toEqual([drums.instrument, bass.instrument, chords.instrument]);
    expect(s.song.clips.every((c) => c.start === 0)).toBe(true);
    // A second one of the same kind follows the first on its track.
    await ok(s, "insert_library_pattern", { pattern: drums.id });
    expect(s.song.tracks).toHaveLength(3);
    const onDrums = s.song.clips.filter((c) => c.trackId === s.song.tracks[0].id).sort((a, b) => a.start - b.start);
    expect(onDrums[1].start).toBe((onDrums[0] as MidiClip).length);
    expect(await bad(s, "insert_library_pattern", { pattern: bass.id, track: s.song.tracks[0].name })).toMatch(/bass line/);
    expect(await bad(s, "insert_library_pattern", { pattern: bass.id, settings: { key: "H" } })).toMatch(/Choose one of/);
    expect(await bad(s, "insert_library_pattern", { pattern: drums.id, track: s.song.tracks[0].name, start_bar: 1 })).toMatch(/on top of a clip/);
  });
});

describe("files", () => {
  it("saves, lists, opens and exports — only inside its folder", async () => {
    const { s, dir } = session();
    await ok(s, "new_song", { name: "My: song" });
    await ok(s, "add_track", { instrument: "piano" });
    await ok(s, "add_clip", { track: "Piano", notes: [{ pitch: "C4", start: 0 }, { pitch: "E4", start: 1 }] });
    expect(await ok(s, "save_song")).toMatch(/Saved My- song\.juradaw/);
    const saved = readSongFile(readFileSync(join(dir, "My- song.juradaw"), "utf8"));
    expect(saved.ok && saved.song.clips[0].kind === "midi" && saved.song.clips[0].notes.length).toBe(2);
    // Saving again to its own file needs no asking; another song's file is not replaced unasked.
    await ok(s, "save_song");
    expect(await bad(s, "save_song", { filename: "../escape" })).toMatch(/plain file name/);
    expect(await bad(s, "save_song", { filename: "C:\\\\x" })).toMatch(/plain file name/);
    writeFileSync(join(dir, "other.juradaw"), "x");
    expect(await bad(s, "save_song", { filename: "other" })).toMatch(/already a file/);
    await ok(s, "save_song", { filename: "other", overwrite: true });
    await ok(s, "export_midi", { filename: "tune" });
    const data = readMidiFile(new Uint8Array(readFileSync(join(dir, "tune.mid"))));
    expect(data?.parts.flatMap((p) => p.notes).length).toBe(2);
    expect(await ok(s, "list_songs")).toMatch(/My- song\.juradaw/);
    await ok(s, "new_song", { name: "Empty" });
    expect(await bad(s, "export_midi")).toMatch(/no notes/);
    expect(await ok(s, "open_song", { filename: "My- song" })).toMatch(/Opened "My: song"/);
    expect(s.song.tracks).toHaveLength(1);
    expect(await bad(s, "open_song", { filename: "missing" })).toMatch(/no file called/);
    writeFileSync(join(dir, "broken.juradaw"), "{ not a song");
    await bad(s, "open_song", { filename: "broken" });
    try {
      symlinkSync(join(dir, "..", "outside.juradaw"), join(dir, "link.juradaw"));
      writeFileSync(join(dir, "..", "outside.juradaw"), "x");
      expect(await bad(s, "open_song", { filename: "link" })).toMatch(/shortcut/);
    } catch (e) {
      // (No links on this file system: nothing to check.)
      if (!(e instanceof Error) || !/EPERM|ENOSYS/.test(e.message)) throw e;
    }
    expect(readdirSync(dir).some((n) => n.endsWith(".saving"))).toBe(false);
  });

  it("keeps a song's recorded sound when it's opened and saved again", async () => {
    const { s, dir } = session();
    await ok(s, "new_song", { name: "With sound" });
    const song = { ...s.song, tracks: [{ id: "t1", kind: "audio" as const, name: "Voice", colour: "#1f6fd1", volume: 0.8, pan: 0, mute: false, solo: false, instrument: "", reverb: 0, echo: 0 }], clips: [{ kind: "audio" as const, id: "c1", trackId: "t1", name: "Take", start: 0, audioId: "a1", offset: 0, duration: 1, gain: 1 }], audio: [{ id: "a1", name: "Take", seconds: 1, sampleRate: 44100, channels: 1 }] };
    writeFileSync(join(dir, "sound.juradaw"), songFileText(song, { a1: "UklGRg==" }));
    await ok(s, "open_song", { filename: "sound" });
    await ok(s, "set_song", { tempo: 100 });
    expect(await ok(s, "save_song")).not.toMatch(/Note:/);
    const again = readSongFile(readFileSync(join(dir, "sound.juradaw"), "utf8"));
    expect(again.ok && again.sounds.a1).toBe("UklGRg==");
    expect(again.ok && again.song.bpm).toBe(100);
  });

  it("takes back a cancelled call", async () => {
    const { s } = session();
    await ok(s, "add_track", { instrument: "piano" });
    const before = s.song;
    const stop = new AbortController();
    stop.abort();
    const r = await callTool(s, "add_track", { instrument: "bass" }, stop.signal);
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/Cancelled/);
    expect(s.song).toBe(before);
  });
});

describe("the song's key, sections and finishing touches", () => {
  it("are set, described and taken off", async () => {
    const { s } = session();
    const said = await ok(s, "set_song", { key: "Eb minor", sections: [{ bar: 1, name: "Intro" }, { bar: 5, name: "Verse" }], finish: { bass: 20, squeeze: 30 } });
    expect(s.song.key).toEqual({ note: 3, scale: "minor" });
    expect(s.song.sections).toEqual([{ beat: 0, name: "Intro" }, { beat: 16, name: "Verse" }]);
    expect(s.song.finish).toEqual({ lows: 0.2, squeeze: 0.3 });
    expect(said).toMatch(/Key: Eb minor/);
    expect(said).toMatch(/Sections: Intro \(bar 1\), Verse \(bar 5\)/);
    expect(said).toMatch(/Finishing touches: bass 20, squeeze 30%/);
    await ok(s, "set_song", { key: "F#" });
    expect(s.song.key).toEqual({ note: 6, scale: "major" });
    expect(await bad(s, "set_song", { key: "H major" })).toMatch(/isn't a key/);
    expect(await bad(s, "set_song", { sections: [{ bar: 2, name: "A" }, { bar: 2, name: "B" }] })).toMatch(/same bar/);
    await ok(s, "set_song", { key: null, sections: null, finish: { bass: 0, squeeze: 0 } });
    expect("key" in s.song || "sections" in s.song || "finish" in s.song).toBe(false);
  });
});
