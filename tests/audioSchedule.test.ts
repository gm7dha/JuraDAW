import { describe, expect, it } from "vitest";
import type { AudioClip, MidiClip, Note, Song, Track } from "../src/model/types";
import {
  audibleTracks,
  audioClipsBetween,
  barEnd,
  barStart,
  loopIsUsable,
  nextLoopWindow,
  notesBetween,
  playEndBeat,
  songLengthBeats,
} from "../src/audio/schedule";
import { beatsToSeconds, midiToHz, secondsToBeats, seededRandom, velocityGain } from "../src/audio/shared";
import { buildMidiTake } from "../src/audio/take";
import { ceiling, ceilingCurve, echoSeconds, meterLevel, volumeToGain } from "../src/audio/mixer";
import { tidyChannels } from "../src/audio/record";
import { RENDER_TAIL, renderTail } from "../src/audio/render";

function track(id: string, patch: Partial<Track> = {}): Track {
  return { id, kind: "instrument", name: id, colour: "#1f6fd1", volume: 0.8, pan: 0, mute: false, solo: false, instrument: "piano", reverb: 0, echo: 0, ...patch };
}
function note(pitch: number, start: number, length = 1, velocity = 100): Note {
  return { id: `n${pitch}-${start}`, pitch, start, length, velocity };
}
function midi(id: string, trackId: string, start: number, length: number, notes: Note[]): MidiClip {
  return { id, trackId, name: id, start, kind: "midi", length, notes };
}
function audio(id: string, trackId: string, start: number, duration: number, patch: Partial<AudioClip> = {}): AudioClip {
  return { id, trackId, name: id, start, kind: "audio", audioId: `sound-${id}`, offset: 0, duration, gain: 1, ...patch };
}
function song(patch: Partial<Song> = {}): Song {
  return { name: "Test", bpm: 120, beatsPerBar: 4, master: 0.8, loop: { on: false, start: 0, end: 4 }, tracks: [], clips: [], audio: [], ...patch };
}

describe("beats and seconds", () => {
  it("converts both ways at a tempo", () => {
    expect(beatsToSeconds(4, 120)).toBe(2);
    expect(secondsToBeats(2, 120)).toBe(4);
    expect(beatsToSeconds(1, 60)).toBe(1);
    expect(secondsToBeats(beatsToSeconds(3.25, 97), 97)).toBeCloseTo(3.25, 10);
  });
  it("knows the pitch of notes", () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(60)).toBeCloseTo(261.626, 2);
    expect(midiToHz(81)).toBeCloseTo(880, 6);
  });
  it("makes soft notes softer and never louder than full", () => {
    expect(velocityGain(127)).toBe(1);
    expect(velocityGain(64)).toBeLessThan(velocityGain(100));
    expect(velocityGain(1)).toBeGreaterThan(0);
    expect(velocityGain(500)).toBe(1);
  });
  it("gives the same random numbers for the same seed", () => {
    const a = seededRandom(5);
    const b = seededRandom(5);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    for (const v of first) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(seededRandom(6)()).not.toBe(first[0]);
  });
});

describe("audibleTracks", () => {
  it("is every track that isn't muted", () => {
    const s = song({ tracks: [track("a"), track("b", { mute: true }), track("c")] });
    expect([...audibleTracks(s)]).toEqual(["a", "c"]);
  });
  it("is only the soloed tracks when any is soloed, even muted ones", () => {
    const s = song({ tracks: [track("a"), track("b", { solo: true }), track("c", { solo: true, mute: true })] });
    expect([...audibleTracks(s)]).toEqual(["b", "c"]);
  });
  it("is empty for an empty song", () => {
    expect(audibleTracks(song()).size).toBe(0);
  });
});

describe("notesBetween", () => {
  const base = song({
    tracks: [track("a"), track("b")],
    clips: [midi("c1", "a", 4, 4, [note(60, 0), note(64, 1, 2), note(67, 3.5, 2)]), midi("c2", "b", 0, 8, [note(36, 0, 0.5), note(36, 4, 0.5)])],
  });

  it("lists notes by their place in the song, earliest first", () => {
    const events = notesBetween(base, 0, 100);
    expect(events.map((e) => [e.trackId, e.pitch, e.beat])).toEqual([
      ["b", 36, 0],
      ["b", 36, 4],
      ["a", 60, 4],
      ["a", 64, 5],
      ["a", 67, 7.5],
    ]);
  });
  it("includes the start of the window and leaves out its end", () => {
    expect(notesBetween(base, 4, 5).map((e) => e.pitch)).toEqual([36, 60]);
    expect(notesBetween(base, 5, 7.5).map((e) => e.pitch)).toEqual([64]);
    expect(notesBetween(base, 4.01, 5)).toHaveLength(0);
  });
  it("cuts notes at the end of their clip", () => {
    const last = notesBetween(base, 7, 8)[0];
    expect(last.pitch).toBe(67);
    expect(last.lengthBeats).toBeCloseTo(0.5, 10);
    expect(notesBetween(base, 5, 6)[0].lengthBeats).toBe(2);
  });
  it("doesn't play notes that start outside their clip", () => {
    const s = song({ tracks: [track("a")], clips: [midi("c", "a", 0, 2, [note(60, 2), note(61, 5), note(62, -1), note(63, 1.5)])] });
    expect(notesBetween(s, 0, 100).map((e) => e.pitch)).toEqual([63]);
  });
  it("leaves out muted tracks, and honours solo", () => {
    const muted = { ...base, tracks: [track("a", { mute: true }), track("b")] };
    expect(new Set(notesBetween(muted, 0, 100).map((e) => e.trackId))).toEqual(new Set(["b"]));
    const solo = { ...base, tracks: [track("a", { solo: true }), track("b")] };
    expect(new Set(notesBetween(solo, 0, 100).map((e) => e.trackId))).toEqual(new Set(["a"]));
  });
  it("can list every track for the live player", () => {
    const muted = { ...base, tracks: [track("a", { mute: true }), track("b")] };
    expect(notesBetween(muted, 0, 100, { everyTrack: true })).toHaveLength(5);
  });
  it("cuts notes at cutAt and starts none there", () => {
    const events = notesBetween(base, 0, 100, { cutAt: 6 });
    expect(events.map((e) => e.pitch)).toEqual([36, 36, 60, 64]);
    expect(events[3].lengthBeats).toBe(1);
    expect(events[2].lengthBeats).toBe(1);
  });
  it("ignores clips of tracks that have gone, and sound clips", () => {
    const s = song({ tracks: [track("a"), track("s", { kind: "audio", instrument: "" })], clips: [midi("c", "gone", 0, 4, [note(60, 0)]), audio("x", "s", 0, 2)] });
    expect(notesBetween(s, 0, 100)).toHaveLength(0);
  });
  it("carries the velocity", () => {
    const s = song({ tracks: [track("a")], clips: [midi("c", "a", 0, 4, [note(60, 0, 1, 37)])] });
    expect(notesBetween(s, 0, 1)[0]).toEqual({ trackId: "a", pitch: 60, velocity: 37, beat: 0, lengthBeats: 1 });
  });
});

describe("audioClipsBetween", () => {
  const sounds = track("s", { kind: "audio", instrument: "" });
  // At 120 bpm one second is two beats: this clip covers beats 4–12.
  const base = song({ tracks: [sounds], clips: [audio("x", "s", 4, 4, { offset: 0.5, gain: 0.7 })] });

  it("starts a clip in the window it begins in", () => {
    expect(audioClipsBetween(base, 0, 4)).toHaveLength(0);
    expect(audioClipsBetween(base, 4, 4.5)).toEqual([{ trackId: "s", clipId: "x", audioId: "sound-x", beat: 4, offset: 0.5, duration: 4, gain: 0.7 }]);
    expect(audioClipsBetween(base, 4.5, 5)).toHaveLength(0);
  });
  it("picks up a clip already under way when asked", () => {
    const [event] = audioClipsBetween(base, 6, 6.5, { running: true });
    expect(event.beat).toBe(6);
    expect(event.offset).toBeCloseTo(1.5, 10);
    expect(event.duration).toBeCloseTo(3, 10);
    expect(audioClipsBetween(base, 12, 13, { running: true })).toHaveLength(0);
    expect(audioClipsBetween(base, 11.9999999, 13, { running: true })).toHaveLength(0);
  });
  it("cuts a clip at cutAt", () => {
    const [event] = audioClipsBetween(base, 4, 5, { cutAt: 8 });
    expect(event.duration).toBeCloseTo(2, 10);
    expect(audioClipsBetween(base, 4, 5, { cutAt: 4 })).toHaveLength(0);
  });
  it("measures clips at the song's tempo", () => {
    const slow = { ...base, bpm: 60 };
    // At 60 bpm the clip covers beats 4–8.
    expect(audioClipsBetween(slow, 7, 8, { running: true })[0].duration).toBeCloseTo(1, 10);
    expect(audioClipsBetween(slow, 8, 9, { running: true })).toHaveLength(0);
  });
  it("leaves out muted tracks unless every track is wanted", () => {
    const muted = { ...base, tracks: [{ ...sounds, mute: true }] };
    expect(audioClipsBetween(muted, 4, 5)).toHaveLength(0);
    expect(audioClipsBetween(muted, 4, 5, { everyTrack: true })).toHaveLength(1);
  });
});

describe("the length of a song", () => {
  it("is where the last clip ends", () => {
    expect(songLengthBeats(song())).toBe(0);
    const s = song({ tracks: [track("a")], clips: [midi("c", "a", 2, 4, []), audio("x", "s", 4, 3)] });
    // The sound clip: 3 seconds at 120 bpm = 6 beats, from beat 4.
    expect(songLengthBeats(s)).toBe(10);
    expect(songLengthBeats({ ...s, bpm: 60 })).toBe(7);
  });
  it("stops a bar after the bar the song ends in", () => {
    expect(playEndBeat(song())).toBeNull();
    expect(playEndBeat(song({ clips: [midi("c", "a", 0, 4, [])] }))).toBe(8);
    expect(playEndBeat(song({ clips: [midi("c", "a", 0, 5, [])] }))).toBe(12);
    expect(playEndBeat(song({ beatsPerBar: 3, clips: [midi("c", "a", 0, 5, [])] }))).toBe(9);
  });
  it("finds bar lines", () => {
    expect(barStart(5.5, 4)).toBe(4);
    expect(barStart(4, 4)).toBe(4);
    expect(barEnd(4, 4)).toBe(4);
    expect(barEnd(4.1, 4)).toBe(8);
    expect(barStart(7, 3)).toBe(6);
  });
});

describe("nextLoopWindow", () => {
  const loop = { on: true, start: 4, end: 8 };

  it("runs straight on when the loop is off", () => {
    expect(nextLoopWindow({ ...loop, on: false }, 7.5, 2)).toEqual({ from: 7.5, to: 9.5, next: 9.5, wrapped: false });
  });
  it("runs straight on inside the loop", () => {
    expect(nextLoopWindow(loop, 5, 1)).toEqual({ from: 5, to: 6, next: 6, wrapped: false });
  });
  it("stops at the end of the loop and jumps back to its start", () => {
    expect(nextLoopWindow(loop, 7.5, 2)).toEqual({ from: 7.5, to: 8, next: 4, wrapped: true });
    expect(nextLoopWindow(loop, 7, 1)).toEqual({ from: 7, to: 8, next: 4, wrapped: true });
  });
  it("plays into the loop from before it", () => {
    expect(nextLoopWindow(loop, 0, 2)).toEqual({ from: 0, to: 2, next: 2, wrapped: false });
    expect(nextLoopWindow(loop, 3, 10)).toEqual({ from: 3, to: 8, next: 4, wrapped: true });
  });
  it("carries on when playing starts after the loop", () => {
    expect(nextLoopWindow(loop, 8, 1)).toEqual({ from: 8, to: 9, next: 9, wrapped: false });
    expect(nextLoopWindow(loop, 20, 1).wrapped).toBe(false);
  });
  it("covers a long span by going round several times", () => {
    let beat = 6;
    let left = 10;
    const played: [number, number][] = [];
    for (let i = 0; left > 1e-9 && i < 20; i++) {
      const w = nextLoopWindow(loop, beat, left);
      played.push([w.from, w.to]);
      left -= w.to - w.from;
      beat = w.next;
    }
    expect(played).toEqual([
      [6, 8],
      [4, 8],
      [4, 8],
    ]);
    expect(beat).toBe(4);
  });
  it("ignores a loop with no length", () => {
    expect(loopIsUsable({ on: true, start: 4, end: 4 })).toBe(false);
    expect(loopIsUsable({ on: true, start: 4, end: 3 })).toBe(false);
    expect(loopIsUsable(loop)).toBe(true);
    expect(loopIsUsable({ ...loop, on: false })).toBe(false);
    expect(nextLoopWindow({ on: true, start: 4, end: 4 }, 3, 2).wrapped).toBe(false);
  });
});

describe("buildMidiTake", () => {
  it("is null when nothing was played", () => {
    expect(buildMidiTake("a", 4, 4, [])).toBeNull();
  });
  it("starts on the bar line and is whole bars long", () => {
    const take = buildMidiTake("a", 5, 4, [
      { pitch: 64, velocity: 90, start: 6, end: 7 },
      { pitch: 60, velocity: 100, start: 5.5, end: 6 },
    ]);
    expect(take).toEqual({
      kind: "midi",
      trackId: "a",
      start: 4,
      length: 4,
      notes: [
        { pitch: 60, start: 1.5, length: 0.5, velocity: 100 },
        { pitch: 64, start: 2, length: 1, velocity: 90 },
      ],
    });
  });
  it("grows by whole bars to hold the last note", () => {
    const take = buildMidiTake("a", 0, 4, [{ pitch: 60, velocity: 100, start: 3, end: 9.2 }]);
    expect(take?.kind === "midi" && take.length).toBe(12);
    const exact = buildMidiTake("a", 0, 4, [{ pitch: 60, velocity: 100, start: 3, end: 8 }]);
    expect(exact?.kind === "midi" && exact.length).toBe(8);
    const waltz = buildMidiTake("a", 4, 3, [{ pitch: 60, velocity: 100, start: 4, end: 4.5 }]);
    expect(waltz?.kind === "midi" && [waltz.start, waltz.length]).toEqual([3, 3]);
  });
  it("gives every note some length and a proper velocity", () => {
    const take = buildMidiTake("a", 0, 4, [{ pitch: 60.4, velocity: 300, start: 1, end: 1 }]);
    if (take?.kind !== "midi") throw new Error("expected a midi take");
    expect(take.notes[0].length).toBeGreaterThan(0);
    expect(take.notes[0].velocity).toBe(127);
    expect(take.notes[0].pitch).toBe(60);
  });
});

describe("mixer sums", () => {
  it("leaves a sound as made at the usual volume", () => {
    expect(volumeToGain(0.8)).toBeCloseTo(1, 10);
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBeGreaterThan(1);
    expect(volumeToGain(0.4)).toBeCloseTo(0.25, 10);
    expect(volumeToGain(7)).toBe(volumeToGain(1));
  });
  it("times the echo to the tempo", () => {
    expect(echoSeconds(120)).toBeCloseTo(0.375, 10);
    expect(echoSeconds(60)).toBeCloseTo(0.75, 10);
    expect(echoSeconds(30)).toBeCloseTo(1.5, 10);
    // Too slow to fit: halved.
    expect(echoSeconds(20)).toBeCloseTo(1.125, 10);
  });
  it("turns a peak into a meter reading", () => {
    expect(meterLevel(0)).toBe(0);
    expect(meterLevel(1)).toBe(1);
    expect(meterLevel(4)).toBe(1);
    expect(meterLevel(0.001)).toBeLessThan(0.01);
    expect(meterLevel(0.25)).toBeGreaterThan(0.7);
    expect(meterLevel(NaN)).toBe(0);
  });
});

describe("the ceiling", () => {
  it("leaves ordinary levels exactly as they are", () => {
    for (const v of [0, 0.001, -0.3, 0.5, 0.75, -0.75]) expect(ceiling(v)).toBe(v);
  });
  it("bends louder sound over smoothly and never reaches full scale", () => {
    let last = 0.75;
    for (let v = 0.76; v < 50; v *= 1.1) {
      const out = ceiling(v);
      expect(out).toBeGreaterThanOrEqual(last);
      expect(out).toBeLessThanOrEqual(0.98);
      expect(out).toBeLessThan(v);
      last = out;
    }
    expect(ceiling(0.76)).toBeCloseTo(0.76, 3);
    expect(ceiling(-3)).toBeCloseTo(-ceiling(3), 10);
    expect(ceiling(1000)).toBeLessThanOrEqual(0.98);
  });
  it("makes a table with silence in the middle and the same on both sides", () => {
    const curve = ceilingCurve(1025);
    expect(curve[512]).toBe(0);
    expect(curve[0]).toBeCloseTo(-curve[1024], 6);
    expect(Math.max(...curve)).toBeLessThan(0.9801);
    // The table covers ±4, so the point for an input of 0.5 holds 0.5.
    expect(curve[512 + 64]).toBeCloseTo(0.5, 6);
  });
});

describe("the mixdown's tail", () => {
  it("is the usual length without echo, and longer for a slow echo that can be heard", () => {
    expect(renderTail(song({ tracks: [track("a")] }))).toBe(RENDER_TAIL);
    expect(renderTail(song({ bpm: 120, tracks: [track("a", { echo: 0.5 })] }))).toBe(RENDER_TAIL);
    expect(renderTail(song({ bpm: 40, tracks: [track("a", { echo: 0.5 })] }))).toBeCloseTo(6.75, 6);
    expect(renderTail(song({ bpm: 40, tracks: [track("a", { echo: 0.5, mute: true })] }))).toBe(RENDER_TAIL);
    expect(renderTail(song({ bpm: 30, tracks: [track("a", { echo: 1 })] }))).toBe(8);
  });
});

describe("tidyChannels", () => {
  const tone = Float32Array.from({ length: 200 }, (_, i) => Math.sin(i / 7));
  const other = Float32Array.from({ length: 200 }, (_, i) => Math.sin(i / 11));
  it("makes one channel of a recording with a silent side, keeping the side with sound", () => {
    expect(tidyChannels([tone, new Float32Array(200)])).toEqual([tone]);
    expect(tidyChannels([new Float32Array(200), tone])).toEqual([tone]);
  });
  it("makes one channel when both sides are the same, and leaves real stereo and mono alone", () => {
    expect(tidyChannels([tone, tone.slice()])).toHaveLength(1);
    expect(tidyChannels([tone, other])).toHaveLength(2);
    expect(tidyChannels([tone])).toHaveLength(1);
    expect(tidyChannels([new Float32Array(10), new Float32Array(10)])).toHaveLength(1);
  });
});
