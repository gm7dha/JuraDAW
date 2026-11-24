import { describe, expect, it } from "vitest";
import { DRUM_CHANNEL, instrumentForProgram, midiToSong, midiTracks, readMidiFile, songParts, songToMidi, timeSignatureRemark, writeMidiFile, type MidiNote } from "../src/midi/midiFile";
import { MOST_NOTES, newSong, newTrack, parseSong } from "../src/model/document";
import type { MidiClip, Note, Song, Track } from "../src/model/types";

const track = (id: string, instrument: string, name: string, kind: "instrument" | "audio" = "instrument"): Track => ({ ...newTrack(kind, instrument, []), id, name });
const note = (pitch: number, start: number, length = 1, velocity = 100): Note => ({ id: `n${pitch}-${start}`, pitch, start, length, velocity });
const clip = (id: string, trackId: string, start: number, length: number, notes: Note[]): MidiClip => ({ id, trackId, name: id, start, kind: "midi", length, notes });
const plain = (notes: readonly MidiNote[]) => notes.map((n) => [n.pitch, n.start, n.length, n.velocity]);

function song(): Song {
  return {
    ...newSong("Round trip"),
    bpm: 96,
    beatsPerBar: 3,
    tracks: [track("p", "piano", "Keys"), track("d", "drums", "Kit"), track("a", "", "Voice", "audio"), track("b", "synth-bass", "Low end")],
    clips: [
      clip("c1", "p", 0, 6, [note(60, 0, 1, 90), note(64, 0, 1, 80), note(67, 1.5, 0.25, 127), note(72, 2 + 1 / 3, 1 / 3, 1)]),
      clip("c2", "p", 9, 3, [note(48, 0, 3, 64)]),
      clip("c3", "d", 0, 3, [note(36, 0, 0.25), note(38, 1, 0.25), note(42, 0.5, 0.125, 70)]),
      clip("c4", "b", 3, 3, [note(36, 0, 1.5), note(36, 1.5, 1.5)]),
    ],
  };
}

type Part = number | string | number[];

/** Bytes written out by hand: numbers as they are, text as its letters. */
function bytes(...parts: Part[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? Array.from(p, (c) => c.charCodeAt(0)) : p)));
}
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const header = (format: number, tracks: number, division: number): Part[] => ["MThd", u32(6), [0, format, 0, tracks, division >> 8, division & 255]];
const trk = (body: number[]): Part[] => ["MTrk", u32(body.length), body];
const END = [0x00, 0xff, 0x2f, 0x00];

describe("writing and reading back", () => {
  it("gives the same notes, tempo and beats in a bar", () => {
    const before = song();
    const data = readMidiFile(songToMidi(before))!;
    expect(data.bpm).toBe(96);
    expect(data.beatsPerBar).toBe(3);
    expect(data.ticksPerBeat).toBe(480);
    expect(data.parts.map((p) => p.name)).toEqual(["Keys", "Kit", "Low end"]);
    const written = songParts(before);
    for (let i = 0; i < written.length; i++) {
      expect(data.parts[i].channel).toBe(written[i].channel);
      expect(data.parts[i].notes.length).toBe(written[i].notes.length);
      data.parts[i].notes.forEach((n, k) => {
        const w = written[i].notes[k];
        expect(n.pitch).toBe(w.pitch);
        expect(n.velocity).toBe(w.velocity);
        // To within a tick (1/480 of a beat).
        expect(Math.abs(n.start - w.start)).toBeLessThan(1 / 400);
        expect(Math.abs(n.length - w.length)).toBeLessThan(1 / 200);
      });
    }
  });
  it("puts notes where their clips are, and drums on channel 10", () => {
    const parts = songParts(song());
    expect(parts.map((p) => p.channel)).toEqual([0, DRUM_CHANNEL, 1]);
    expect(plain(parts[0].notes)[4]).toEqual([48, 9, 3, 64]);
    expect(plain(parts[2].notes)).toEqual([[36, 3, 1.5, 100], [36, 4.5, 1.5, 100]]);
    expect(parts[1].program).toBeNull();
  });
  it("comes back as a song with the same tracks", () => {
    const before = song();
    const back = midiToSong(songToMidi(before), "Round trip")!;
    expect(back.name).toBe("Round trip");
    expect(back.bpm).toBe(96);
    expect(back.beatsPerBar).toBe(3);
    expect(back.tracks.map((t) => [t.name, t.kind, t.instrument])).toEqual([["Keys", "instrument", "piano"], ["Kit", "instrument", "drums"], ["Low end", "instrument", "synth-bass"]]);
    expect(back.clips.length).toBe(3);
    const keys = back.clips[0] as MidiClip;
    expect(keys).toMatchObject({ trackId: back.tracks[0].id, start: 0, length: 12, name: "Keys" });
    expect(keys.notes.map((n) => n.pitch)).toEqual([60, 64, 67, 72, 48]);
    expect((back.clips[1] as MidiClip).length).toBe(3);
    const ids = back.clips.flatMap((c) => [c.id, ...(c.kind === "midi" ? c.notes.map((n) => n.id) : [])]);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("round-trips every built-in instrument", () => {
    const ids = ["piano", "electric-piano", "organ", "strings", "pad", "bass", "synth-bass", "lead", "pluck", "bells", "drums"];
    const s: Song = { ...newSong(), tracks: ids.map((id) => track(id, id, id)), clips: ids.map((id) => clip(`c-${id}`, id, 0, 4, [note(60, 0)])) };
    expect(midiToSong(songToMidi(s), "x")!.tracks.map((t) => t.instrument)).toEqual(ids);
  });
  it("leaves out notes that aren't heard, and cuts one at its clip's end", () => {
    const s: Song = { ...newSong(), tracks: [track("p", "piano", "Keys")], clips: [clip("c", "p", 4, 2, [note(60, 0, 1), note(62, 1.5, 4), note(64, 2, 1), note(65, 7, 1)])] };
    expect(plain(songParts(s)[0].notes)).toEqual([[60, 4, 1, 100], [62, 5.5, 0.5, 100]]);
  });
  it("writes an empty song as a file that reads back empty", () => {
    const data = readMidiFile(songToMidi(newSong()))!;
    expect(data.parts).toEqual([]);
    expect(data.bpm).toBe(120);
    expect(data.beatsPerBar).toBe(4);
    expect(midiToSong(songToMidi(newSong()), "Empty")!.tracks).toEqual([]);
  });
  it("lets go of a note before the same note starts again", () => {
    const data = readMidiFile(writeMidiFile({ bpm: 120, beatsPerBar: 4, parts: [{ name: "", channel: 0, program: null, notes: [{ pitch: 60, start: 0, length: 1, velocity: 100 }, { pitch: 60, start: 1, length: 1, velocity: 90 }] }] }))!;
    expect(plain(data.parts[0].notes)).toEqual([[60, 0, 1, 100], [60, 1, 1, 90]]);
  });
  it("keeps odd tempos to within a hundredth", () => {
    for (const bpm of [30, 61.5, 93, 133.33, 200, 300]) {
      expect(Math.abs(readMidiFile(writeMidiFile({ bpm, beatsPerBar: 4, parts: [] }))!.bpm - bpm)).toBeLessThanOrEqual(0.01);
    }
  });
});

describe("reading files written by hand", () => {
  it("reads a format 0 file with running status and note-ons at velocity 0", () => {
    const file = bytes(
      ...header(0, 1, 96),
      ...trk([
        ...[0x00, 0xff, 0x03, 0x04], ...[0x4c, 0x65, 0x61, 0x64], // track name "Lead"
        ...[0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20], // 500000 µs a beat = 120 bpm
        ...[0x00, 0xff, 0x58, 0x04, 0x03, 0x02, 0x18, 0x08], // 3/4
        ...[0x00, 0xc0, 0x50], // a synth lead
        ...[0x00, 0x90, 0x3c, 0x64], // C4 on
        ...[0x60, 0x3c, 0x00], // running status: C4 "on" at velocity 0 = off, a beat later
        ...[0x00, 0x3e, 0x50], // running status: D4 on
        ...[0x30, 0x3e, 0x00], // D4 off half a beat later
        ...[0x00, 0x99, 0x24, 0x7f], // a kick on the drum channel
        ...[0x18, 0x89, 0x24, 0x40], // a real note-off
        ...END,
      ]),
    );
    const data = readMidiFile(file)!;
    expect(data.bpm).toBe(120);
    expect(data.beatsPerBar).toBe(3);
    expect(data.parts.length).toBe(2);
    expect(data.parts[0]).toMatchObject({ name: "Lead", channel: 0, program: 0x50 });
    expect(plain(data.parts[0].notes)).toEqual([[60, 0, 1, 100], [62, 1, 0.5, 80]]);
    expect(data.parts[1]).toMatchObject({ channel: 9, program: null });
    expect(plain(data.parts[1].notes)).toEqual([[36, 1.5, 0.25, 127]]);
    const tracks = midiTracks(file)!.tracks;
    expect(tracks.map((t) => [t.name, t.instrument, t.length])).toEqual([["Lead", "lead", 3], ["Lead", "drums", 3]]);
    const s = midiToSong(file, "Tune")!;
    expect(s.tracks.map((t) => [t.name, t.instrument])).toEqual([["Lead", "lead"], ["Drums", "drums"]]);
  });
  it("reads a format 1 file: tempo in the first track, long gaps, running status across notes", () => {
    const file = bytes(
      ...header(1, 3, 480),
      ...trk([...[0x00, 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40], ...END]), // 1000000 µs = 60 bpm
      ...trk([
        ...[0x00, 0x91, 0x40, 0x60],
        ...[0x83, 0x60, 0x40, 0x00], // 480 ticks later (two-byte gap), off by running status
        ...[0x87, 0x40, 0x45, 0x30], // 960 ticks later: A on (still running status)
        ...[0x81, 0x70, 0x81, 0x45, 0x00], // 240 ticks later, a proper off
        ...END,
      ]),
      ...trk([...[0x00, 0xff, 0x03, 0x00], ...END]), // an empty, nameless track
    );
    const data = readMidiFile(file)!;
    expect(data.bpm).toBe(60);
    expect(data.beatsPerBar).toBe(4);
    expect(data.parts.length).toBe(1);
    expect(data.parts[0].channel).toBe(1);
    expect(plain(data.parts[0].notes)).toEqual([[64, 0, 1, 96], [69, 3, 0.5, 48]]);
    expect(midiTracks(file)!.tracks[0]).toMatchObject({ name: "Piano", instrument: "piano", length: 4 });
  });
  it("skips what it doesn't use: other chunks, sysex, controllers, pitch bend, unknown meta", () => {
    const file = bytes(
      ...header(1, 1, 96),
      "XFIH", u32(3), [1, 2, 3],
      ...trk([
        ...[0x00, 0xf0, 0x03, 0x7e, 0x7f, 0xf7], // sysex
        ...[0x00, 0xff, 0x7f, 0x02, 0x00, 0x01], // a maker's own meta
        ...[0x00, 0xb0, 0x07, 0x64], // volume
        ...[0x00, 0x0a, 0x40], // pan, by running status
        ...[0x00, 0xe0, 0x00, 0x40], // pitch bend
        ...[0x00, 0xd0, 0x10], // pressure
        ...[0x00, 0xa0, 0x3c, 0x10], // key pressure
        ...[0x00, 0x90, 0x3c, 0x64],
        ...[0x60, 0x80, 0x3c, 0x00],
        ...END,
      ]),
    );
    expect(plain(readMidiFile(file)!.parts[0].notes)).toEqual([[60, 0, 1, 100]]);
  });
  it("pairs repeated notes first in, first out, and ends held notes with the track", () => {
    const file = bytes(
      ...header(0, 1, 96),
      ...trk([
        ...[0x00, 0x90, 0x3c, 0x64],
        ...[0x30, 0x90, 0x3c, 0x50], // the same note again before the first is let go
        ...[0x30, 0x80, 0x3c, 0x00], // ends the first
        ...[0x30, 0x80, 0x3c, 0x00], // ends the second
        ...[0x00, 0x90, 0x40, 0x64], // never let go…
        ...[0x60, 0xff, 0x2f, 0x00], // …until the track ends a beat later
      ]),
    );
    expect(plain(readMidiFile(file)!.parts[0].notes)).toEqual([[60, 0, 1, 100], [60, 0.5, 1, 80], [64, 1.5, 1, 100]]);
  });
  it("takes compound time as beats of a quarter note", () => {
    const withSig = (nn: number, dd: number) => bytes(...header(0, 1, 96), ...trk([0x00, 0xff, 0x58, 0x04, nn, dd, 0x18, 0x08, ...END]));
    expect(readMidiFile(withSig(6, 3))!.beatsPerBar).toBe(3);
    expect(readMidiFile(withSig(2, 1))!.beatsPerBar).toBe(4);
    expect(readMidiFile(withSig(5, 2))!.beatsPerBar).toBe(5);
    expect(readMidiFile(withSig(12, 3))!.beatsPerBar).toBe(6);
    expect(readMidiFile(withSig(6, 3))!.timeSignature).toEqual([6, 8]);
    expect(midiTracks(withSig(6, 3))!.remarks).toEqual([]);
    expect(midiTracks(withSig(4, 2))!.remarks).toEqual([]);
    expect(readMidiFile(bytes(...header(0, 1, 96), ...trk(END)))!.timeSignature).toBeNull();
  });
  it("keeps 4 beats in a bar, and says so, for a time signature a song can't have", () => {
    const withSig = (nn: number, dd: number) => bytes(...header(0, 1, 96), ...trk([0x00, 0xff, 0x58, 0x04, nn, dd, 0x18, 0x08, ...END]));
    // 7/8 is three and a half beats, 9/8 four and a half, 5/8 two and a half: never rounded to a bar that's wrong all the way through.
    for (const [nn, dd, name] of [[7, 3, "7/8"], [9, 3, "9/8"], [5, 3, "5/8"], [1, 2, "1/4"], [15, 2, "15/4"]] as const) {
      const data = readMidiFile(withSig(nn, dd))!;
      expect(data.beatsPerBar, name).toBe(4);
      expect(timeSignatureRemark(data)).toMatch(new RegExp(`^This file is in ${name} time`));
      expect(midiTracks(withSig(nn, dd))!.remarks.length).toBe(1);
    }
  });
  it("keeps the tempo inside what a song allows", () => {
    const withTempo = (micros: number) => bytes(...header(0, 1, 96), ...trk([0x00, 0xff, 0x51, 0x03, (micros >> 16) & 255, (micros >> 8) & 255, micros & 255, ...END]));
    expect(readMidiFile(withTempo(100000))!.bpm).toBe(300);
    expect(readMidiFile(withTempo(0xffffff))!.bpm).toBe(30);
    expect(readMidiFile(withTempo(0))!.bpm).toBe(120);
  });
  it("says no to what isn't a MIDI file, without throwing", () => {
    expect(readMidiFile(new Uint8Array(0))).toBeNull();
    expect(readMidiFile(bytes("RIFF", u32(4), "WAVE"))).toBeNull();
    expect(readMidiFile(bytes("MThd"))).toBeNull();
    expect(readMidiFile(bytes("MThd", u32(6), [0, 1, 0, 1, 0xe7, 0x28]))).toBeNull(); // timed in film frames
    expect(readMidiFile(bytes("MThd", u32(6), [0, 1, 0, 1, 0, 0]))).toBeNull();
    expect(midiToSong(bytes("hello"), "x")).toBeNull();
    expect(midiTracks(bytes("hello"))).toBeNull();
  });
  it("reads what it can of a file that's cut short or scrambled", () => {
    const whole = songToMidi(song());
    for (let cut = 14; cut < whole.length; cut += 7) {
      const data = readMidiFile(whole.subarray(0, cut));
      expect(data).not.toBeNull();
    }
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let round = 0; round < 200; round++) {
      const junk = whole.slice();
      for (let i = 0; i < 12; i++) junk[14 + Math.floor(random() * (junk.length - 14))] = Math.floor(random() * 256);
      const data = readMidiFile(junk);
      if (data) for (const part of data.parts) for (const n of part.notes) expect(n.length > 0 && n.start >= 0 && n.pitch >= 0 && n.pitch <= 127 && n.velocity >= 1 && n.velocity <= 127).toBe(true);
    }
  });
});

describe("General MIDI instruments", () => {
  it("picks the nearest built-in instrument", () => {
    expect(instrumentForProgram(null)).toBe("piano");
    expect(instrumentForProgram(0)).toBe("piano");
    expect(instrumentForProgram(4)).toBe("electric-piano");
    expect(instrumentForProgram(19)).toBe("organ");
    expect(instrumentForProgram(33)).toBe("bass");
    expect(instrumentForProgram(39)).toBe("synth-bass");
    expect(instrumentForProgram(48)).toBe("strings");
    expect(instrumentForProgram(81)).toBe("lead");
    expect(instrumentForProgram(90)).toBe("pad");
    expect(instrumentForProgram(11)).toBe("bells");
    expect(instrumentForProgram(25)).toBe("guitar");
    expect(instrumentForProgram(27)).toBe("pluck");
    expect(instrumentForProgram(12)).toBe("marimba");
    expect(instrumentForProgram(46)).toBe("harp");
    expect(instrumentForProgram(60)).toBe("brass");
    expect(instrumentForProgram(73)).toBe("flute");
    expect(instrumentForProgram(108)).toBe("kalimba");
    expect(instrumentForProgram(110)).toBe("piano");
  });
});

describe("big songs", () => {
  it("writes a track of tens of thousands of notes", () => {
    // Used to throw "Maximum call stack size exceeded" from about 16,000 notes.
    const notes = Array.from({ length: 60000 }, (_, i) => ({ pitch: 36 + (i % 60), start: i * 0.25, length: 0.25, velocity: 1 + (i % 127) }));
    const file = writeMidiFile({ bpm: 120, beatsPerBar: 4, parts: [{ name: "Long", channel: 0, program: 0, notes }] }, "Long song");
    const back = readMidiFile(file)!;
    expect(back.parts[0].notes.length).toBe(60000);
    expect(plain(back.parts[0].notes.slice(-1))).toEqual([[36 + (59999 % 60), 59999 * 0.25, 0.25, 1 + (59999 % 127)]]);
    expect(back.parts[0].name).toBe("Long");
  });
  it("brings in a part with more notes than a clip holds as several clips, losing none", () => {
    const notes = Array.from({ length: MOST_NOTES + 500 }, (_, i) => ({ pitch: 60, start: i * 0.25, length: 0.25, velocity: 100 }));
    const s = midiToSong(writeMidiFile({ bpm: 120, beatsPerBar: 4, parts: [{ name: "Busy", channel: 0, program: 0, notes }] }), "Busy")!;
    expect(s.tracks.length).toBe(1);
    expect(s.clips.map((c) => (c.kind === "midi" ? c.notes.length : -1))).toEqual([MOST_NOTES, 500]);
    expect(s.clips.every((c) => c.start === 0 && c.trackId === s.tracks[0].id)).toBe(true);
    // Kept in the browser and read back, every note is still there.
    const kept = parseSong(JSON.stringify(s))!;
    expect(kept.clips.reduce((sum, c) => sum + (c.kind === "midi" ? c.notes.length : 0), 0)).toBe(MOST_NOTES + 500);
  });
  it("gives more than 15 tuned tracks channels that play the right instrument", () => {
    const instruments = ["piano", "organ", "bass", "strings"];
    const tracks = Array.from({ length: 20 }, (_, i) => track(`t${i}`, instruments[i % 4], `Track ${i}`));
    const s: Song = { ...newSong(), tracks: [...tracks, track("d", "drums", "Kit")], clips: tracks.map((t) => clip(`c-${t.id}`, t.id, 0, 4, [note(60, 0)])) };
    const parts = songParts(s);
    // The first fifteen have a channel each.
    expect(new Set(parts.slice(0, 15).map((p) => p.channel)).size).toBe(15);
    expect(parts.every((p, i) => (p.channel === DRUM_CHANNEL) === (i === 20))).toBe(true);
    // Each later one shares a channel only with tracks of its own instrument.
    const programOn = new Map<number, number | null>();
    for (const p of parts) {
      if (programOn.has(p.channel)) expect(programOn.get(p.channel)).toBe(p.program);
      programOn.set(p.channel, p.program);
    }
    expect(midiToSong(songToMidi(s), "x")!.tracks.map((t) => t.instrument)).toEqual([...tracks.map((t) => t.instrument)]);
  });
});
