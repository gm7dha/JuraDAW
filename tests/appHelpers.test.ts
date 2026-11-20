import { beforeEach, describe, expect, it } from "vitest";
import { edgeSpeed, EDGE_MOST, EDGE_ZONE } from "../src/app/edgeScroll";
import { keysState, letterFor, setKeysState, typedPitch, TYPING_KEYS } from "../src/app/keysState";
import { inPopup, inTextBox, MODAL_SELECTOR, onControl, POPUP_SELECTOR } from "../src/app/popupGuard";
import { prefsText, readPrefs } from "../src/app/prefs";
import {
  barBeat,
  barsAndBeats,
  clipBeats,
  clipsOverOthers,
  loopDragged,
  loopGrab,
  panelHeight,
  timeLeftWords,
  toastsToShow,
  withoutSoundEnding,
  lengthWords,
  midiClip,
  noteStep,
  roomFor,
  SNAP_CHOICES,
  snapLabel,
  snapped,
  songBeats,
  uid,
  withClipEnd,
  withClipsMoved,
  withClipStart,
  withNotes,
  withTrack,
} from "../src/app/songUi";
import { gridFor, visibleBeats } from "../src/app/zoom";
import { newSong, newTrack } from "../src/model/document";
import { MIN_LENGTH, type AudioClip, type MidiClip, type Note, type Song } from "../src/model/types";

const note = (id: string, start: number, length = 1, pitch = 60): Note => ({ id, pitch, start, length, velocity: 100 });
const midi = (id: string, trackId: string, start: number, length: number, notes: Note[] = []): MidiClip => ({ id, trackId, name: id, kind: "midi", start, length, notes });
const audio = (id: string, trackId: string, start: number, offset: number, duration: number): AudioClip => ({ id, trackId, name: id, kind: "audio", start, audioId: "snd", offset, duration, gain: 1 });

/** Piano, drums and a sound track at 120 bpm (so a beat is half a second), with a clip or two on each. */
function song(): Song {
  const base = newSong();
  const piano = { ...newTrack("instrument", "piano", []), id: "p" };
  const drums = { ...newTrack("instrument", "drums", [piano]), id: "d" };
  const sound = { ...newTrack("audio", "", [piano, drums]), id: "a" };
  return {
    ...base,
    bpm: 120,
    beatsPerBar: 4,
    tracks: [piano, drums, sound],
    clips: [midi("m1", "p", 4, 8, [note("n1", 0), note("n2", 2), note("n3", 6, 2)]), midi("m2", "p", 16, 4), midi("m3", "d", 0, 4), audio("au", "a", 8, 1, 4)],
    audio: [{ id: "snd", name: "Take", seconds: 10, sampleRate: 44100, channels: 1 }],
  };
}
const clipOf = (s: Song, id: string) => s.clips.find((c) => c.id === id)!;
const midiOf = (s: Song, id: string) => clipOf(s, id) as MidiClip;
const audioOf = (s: Song, id: string) => clipOf(s, id) as AudioClip;

describe("the snap grid", () => {
  it("moves a place onto the nearest line, or the line before it", () => {
    expect(snapped(1.13, 0.25, 4)).toBe(1.25);
    expect(snapped(1.13, 0.25, 4, { down: true })).toBe(1);
    expect(snapped(5.9, "bar", 4)).toBe(4);
    expect(snapped(6.1, "bar", 4)).toBe(8);
    expect(snapped(7, "bar", 3)).toBe(6);
    expect(snapped(7.6, "bar", 3)).toBe(9);
    expect(snapped(2.4, 1, 4)).toBe(2);
  });

  it("leaves a place alone when snapping is off or Shift is held", () => {
    expect(snapped(1.13, 0, 4)).toBe(1.13);
    expect(snapped(1.13, 0.25, 4, { free: true })).toBe(1.13);
  });

  it("counts a place a hair short of a line as on it when going down", () => {
    expect(snapped(2 - 1e-12, 1, 4, { down: true })).toBe(2);
  });

  it("makes notes in sixteenths when snap is off or whole bars", () => {
    expect(noteStep("bar")).toBe(0.25);
    expect(noteStep(0)).toBe(0.25);
    expect(noteStep(0.5)).toBe(0.5);
    expect(noteStep(0.125)).toBe(0.125);
  });

  it("names every choice", () => {
    expect(SNAP_CHOICES.map((c) => c.snap)).toEqual(["bar", 1, 0.5, 0.25, 0.125, 0]);
    expect(snapLabel("bar")).toBe("Bars");
    expect(snapLabel(0.25)).toBe("¼ beat");
    // Plain words for a beginner; the note names are only in the hints.
    expect(SNAP_CHOICES.map((c) => c.name)).toEqual(["Whole bars", "Beats", "Half beats", "Quarter beats", "Eighth beats", "Off"]);
    expect(SNAP_CHOICES.some((c) => /\d\/\d/.test(c.label) || /\d\/\d/.test(c.name))).toBe(false);
    expect(snapLabel(0)).toBe("Off");
  });
});

describe("positions and lengths in words", () => {
  it("says a beat as bar and beat, counted from 1", () => {
    expect(barBeat(0, 4)).toEqual({ bar: 1, beat: 1, text: "1.1" });
    expect(barBeat(5, 4)).toEqual({ bar: 2, beat: 2, text: "2.2" });
    expect(barBeat(7.99, 4).text).toBe("2.4");
    expect(barBeat(6, 3).text).toBe("3.1");
    expect(barBeat(-3, 4).text).toBe("1.1");
  });

  it("says a length in bars and beats", () => {
    expect(lengthWords(8, 4)).toBe("2 bars");
    expect(lengthWords(4, 4)).toBe("1 bar");
    expect(lengthWords(5, 4)).toBe("1 bar 1 beat");
    expect(lengthWords(6, 4)).toBe("1 bar 2 beats");
    expect(lengthWords(0.5, 4)).toBe("0.5 beats");
    expect(lengthWords(0, 4)).toBe("0 beats");
    expect(lengthWords(3, 3)).toBe("1 bar");
  });

  it("measures clips and the song in beats", () => {
    const s = song();
    expect(clipBeats(clipOf(s, "m1"), s.bpm)).toBe(8);
    // Four seconds of sound at 120 bpm is eight beats.
    expect(clipBeats(clipOf(s, "au"), s.bpm)).toBe(8);
    expect(songBeats(s)).toBe(20);
    expect(songBeats(newSong())).toBe(0);
  });

  it("makes ids that differ", () => {
    const a = uid("c");
    const b = uid("c");
    expect(a).not.toBe(b);
    expect(a.startsWith("c")).toBe(true);
  });
});

describe("songs changed by a drag", () => {
  it("moves clips by beats, never before the start", () => {
    const s = song();
    const moved = withClipsMoved(s, ["m1", "m2"], 2, 0);
    expect(clipOf(moved, "m1").start).toBe(6);
    expect(clipOf(moved, "m2").start).toBe(18);
    expect(clipOf(moved, "m3")).toBe(clipOf(s, "m3"));
    // The earliest one stops at the start, and the others keep their distance from it.
    const back = withClipsMoved(s, ["m1", "m2"], -10, 0);
    expect(clipOf(back, "m1").start).toBe(0);
    expect(clipOf(back, "m2").start).toBe(12);
  });

  it("gives the same song back when nothing moves", () => {
    const s = song();
    expect(withClipsMoved(s, ["m1"], 0, 0)).toBe(s);
    expect(withClipsMoved(s, ["nothing"], 4, 1)).toBe(s);
  });

  it("moves clips to another track only of their own kind", () => {
    const s = song();
    expect(clipOf(withClipsMoved(s, ["m1"], 0, 1), "m1").trackId).toBe("d");
    // Notes can't go onto the sound track, nor sound onto an instrument's: they stay where they were.
    expect(clipOf(withClipsMoved(s, ["m1"], 0, 2), "m1").trackId).toBe("p");
    expect(clipOf(withClipsMoved(s, ["au"], 0, -1), "au").trackId).toBe("a");
    // Past the last row is the last row.
    expect(clipOf(withClipsMoved(s, ["m3"], 0, -5), "m3").trackId).toBe("p");
  });

  it("leaves the originals and adds copies for an Alt-drag", () => {
    const s = song();
    const copied = withClipsMoved(s, ["m1"], 8, 0, new Map([["m1", "copy"]]));
    expect(copied.clips).toHaveLength(s.clips.length + 1);
    expect(clipOf(copied, "m1")).toBe(clipOf(s, "m1"));
    const copy = midiOf(copied, "copy");
    expect(copy.start).toBe(12);
    expect(copy.notes.map((n) => [n.start, n.pitch])).toEqual([
      [0, 60],
      [2, 60],
      [6, 60],
    ]);
    // The copy's notes are its own.
    expect(copy.notes.some((n) => ["n1", "n2", "n3"].includes(n.id))).toBe(false);
    // Even a copy dropped where it began is a copy.
    expect(withClipsMoved(s, ["m1"], 0, 0, new Map([["m1", "again"]])).clips).toHaveLength(s.clips.length + 1);
  });

  it("drags the end of a clip of notes", () => {
    const s = song();
    expect(midiOf(withClipEnd(s, "m1", 12), "m1").length).toBe(12);
    expect(midiOf(withClipEnd(s, "m1", -3), "m1").length).toBe(MIN_LENGTH);
    expect(midiOf(withClipEnd(s, "m1", 12), "m1").notes).toBe(midiOf(s, "m1").notes);
  });

  it("drags the end of a recording no further than the sound goes", () => {
    const s = song();
    // Six beats at 120 bpm is three seconds.
    expect(audioOf(withClipEnd(s, "au", 6, 10), "au").duration).toBe(3);
    // The sound is 10 s long and the clip starts 1 s into it: nine seconds at most.
    expect(audioOf(withClipEnd(s, "au", 100, 10), "au").duration).toBe(9);
    expect(audioOf(withClipEnd(s, "au", 0, 10), "au").duration).toBe(0.05);
  });

  it("drags the start of a clip of notes, its notes staying where they are in the song", () => {
    const s = song();
    const later = midiOf(withClipStart(s, "m1", 1), "m1");
    expect(later).toMatchObject({ start: 5, length: 7 });
    // n1 (one beat long, at the old start) is cut off; the others are a beat nearer the clip's start.
    expect(later.notes.map((n) => [n.id, n.start, n.length])).toEqual([
      ["n2", 1, 1],
      ["n3", 5, 2],
    ]);
    const half = midiOf(withClipStart(s, "m1", 0.5), "m1");
    expect(half.notes[0]).toMatchObject({ id: "n1", start: 0, length: 0.5 });
    const earlier = midiOf(withClipStart(s, "m1", -2), "m1");
    expect(earlier).toMatchObject({ start: 2, length: 10 });
    expect(earlier.notes[0].start).toBe(2);
  });

  it("keeps a dragged start inside the song and the clip", () => {
    const s = song();
    expect(midiOf(withClipStart(s, "m1", -100), "m1")).toMatchObject({ start: 0, length: 12 });
    const most = midiOf(withClipStart(s, "m1", 100), "m1");
    expect(most.length).toBe(MIN_LENGTH);
    expect(most.start).toBe(12 - MIN_LENGTH);
    expect(clipOf(withClipStart(s, "m1", 0), "m1")).toBe(clipOf(s, "m1"));
  });

  it("drags the start of a recording through its sound", () => {
    const s = song();
    // Two beats later is one second further into the sound.
    expect(audioOf(withClipStart(s, "au", 2), "au")).toMatchObject({ start: 10, offset: 2, duration: 3 });
    // Earlier only as far as the sound's own start (1 s = 2 beats before).
    expect(audioOf(withClipStart(s, "au", -6), "au")).toMatchObject({ start: 6, offset: 0, duration: 5 });
    const most = audioOf(withClipStart(s, "au", 100), "au");
    expect(most.duration).toBeCloseTo(0.05, 9);
    expect(most.offset + most.duration).toBeCloseTo(5, 9);
  });

  it("changes a clip's notes, the clip growing to hold them", () => {
    const s = song();
    const grown = midiOf(
      withNotes(s, "m2", (notes) => [...notes, note("x", 3, 3)]),
      "m2",
    );
    expect(grown.notes).toHaveLength(1);
    expect(grown.length).toBe(6);
    const same = midiOf(
      withNotes(s, "m1", (notes) => notes.slice(0, 1)),
      "m1",
    );
    expect(same.length).toBe(8);
    // A recording has no notes to change.
    expect(clipOf(withNotes(s, "au", () => [note("x", 0)]), "au")).toBe(clipOf(s, "au"));
  });

  it("changes one track", () => {
    const s = song();
    const quiet = withTrack(s, "d", { volume: 0.3, mute: true });
    expect(quiet.tracks[1]).toMatchObject({ id: "d", volume: 0.3, mute: true });
    expect(quiet.tracks[0]).toBe(s.tracks[0]);
  });

  it("finds a clip of notes by id", () => {
    const s = song();
    expect(midiClip(s, "m1")?.id).toBe("m1");
    expect(midiClip(s, "au")).toBeNull();
    expect(midiClip(s, "nothing")).toBeNull();
    expect(midiClip(s, null)).toBeNull();
  });

  it("finds room for a new clip before the next one on its track", () => {
    const s = song();
    // m1 starts at beat 4 on the piano track.
    expect(roomFor(s, "p", 0, 16, 4)).toBe(4);
    expect(roomFor(s, "p", 2, 16, 1)).toBe(2);
    // Never less than the least asked for, even if that overlaps.
    expect(roomFor(s, "p", 2, 16, 4)).toBe(4);
    // Nothing after it: all that was wanted.
    expect(roomFor(s, "p", 20, 16, 4)).toBe(16);
    expect(roomFor(s, "d", 4, 16, 4)).toBe(16);
  });
});

describe("the grid lines at a zoom", () => {
  it("draws beats at the usual zoom, with every bar numbered", () => {
    expect(gridFor(24, 4)).toEqual({ fine: 1, strong: 4, labelEvery: 1 });
  });

  it("draws finer lines zoomed in", () => {
    expect(gridFor(36, 4).fine).toBe(0.5);
    expect(gridFor(72, 4).fine).toBe(0.25);
    expect(gridFor(240, 4)).toEqual({ fine: 0.25, strong: 4, labelEvery: 1 });
  });

  it("drops the beat lines and numbers fewer bars zoomed out", () => {
    expect(gridFor(8, 4)).toEqual({ fine: 4, strong: 4, labelEvery: 2 });
    expect(gridFor(2, 4)).toEqual({ fine: 8, strong: 8, labelEvery: 8 });
  });

  it("follows the beats in a bar", () => {
    expect(gridFor(24, 3)).toEqual({ fine: 1, strong: 3, labelEvery: 1 });
    expect(gridFor(4, 3)).toEqual({ fine: 6, strong: 6, labelEvery: 4 });
  });

  it("never lets lines or bar numbers crowd, at any zoom", () => {
    for (const beats of [2, 3, 4, 5, 7, 12]) {
      for (let ppb = 2; ppb <= 240; ppb += 1.5) {
        const g = gridFor(ppb, beats);
        expect(g.strong * ppb).toBeGreaterThanOrEqual(14);
        expect(g.labelEvery * beats * ppb).toBeGreaterThanOrEqual(34);
        expect(g.fine).toBeLessThanOrEqual(g.strong);
        expect(g.fine).toBeGreaterThan(0);
      }
    }
  });
});

describe("scrolling at the edge during a drag", () => {
  it("stays still away from the edges", () => {
    expect(edgeSpeed(500, 200, 1000)).toBe(0);
    expect(edgeSpeed(200 + EDGE_ZONE, 200, 1000)).toBe(0);
    expect(edgeSpeed(1000 - EDGE_ZONE, 200, 1000)).toBe(0);
  });

  it("goes back near the low edge and on near the high one, faster the further out", () => {
    const slow = edgeSpeed(1000 - EDGE_ZONE + 4, 200, 1000);
    const fast = edgeSpeed(1000 + 10, 200, 1000);
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow);
    expect(edgeSpeed(200 + EDGE_ZONE - 4, 200, 1000)).toBe(-slow);
    expect(edgeSpeed(150, 200, 1000)).toBeLessThan(-slow);
  });

  it("never goes faster than the most", () => {
    expect(edgeSpeed(5000, 200, 1000)).toBe(EDGE_MOST);
    expect(edgeSpeed(-5000, 200, 1000)).toBe(-EDGE_MOST);
    expect(edgeSpeed(1100, 0, 1000, 20, 8)).toBe(8);
  });

  it("leaves a view too small to have a middle alone", () => {
    expect(edgeSpeed(10, 0, 60)).toBe(0);
    expect(edgeSpeed(10, 0, Number.NaN)).toBe(0);
  });
});

describe("the typing keyboard as a piano", () => {
  beforeEach(() => setKeysState({ typing: false, octave: 4 }));

  it("plays middle C on A, and an octave of keys up to K", () => {
    expect(typedPitch("a", 4)).toBe(60);
    expect(typedPitch("w", 4)).toBe(61);
    expect(typedPitch("k", 4)).toBe(72);
    expect(typedPitch("A", 4)).toBe(60);
    expect(typedPitch("a", 3)).toBe(48);
    expect(TYPING_KEYS.map((k) => k.semitone)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("knows which keys don't play", () => {
    expect(typedPitch("q", 4)).toBeNull();
    expect(typedPitch("z", 4)).toBeNull();
    expect(typedPitch(" ", 4)).toBeNull();
    expect(typedPitch("Enter", 4)).toBeNull();
  });

  it("says which letter plays a pitch", () => {
    expect(letterFor(60, 4)).toBe("A");
    expect(letterFor(61, 4)).toBe("W");
    expect(letterFor(72, 4)).toBe("K");
    expect(letterFor(72, 5)).toBe("A");
    expect(letterFor(59, 4)).toBe("");
    expect(letterFor(73, 4)).toBe("");
    for (const k of TYPING_KEYS) expect(letterFor(typedPitch(k.key, 2)!, 2)).toBe(k.key.toUpperCase());
  });

  it("remembers typing and the octave, kept between 0 and 7", () => {
    expect(keysState()).toEqual({ typing: false, octave: 4 });
    setKeysState({ typing: true });
    expect(keysState()).toEqual({ typing: true, octave: 4 });
    setKeysState({ octave: 9 });
    expect(keysState().octave).toBe(7);
    setKeysState({ octave: -2 });
    expect(keysState()).toEqual({ typing: true, octave: 0 });
  });
});

describe("keys that belong to a popup or a text box", () => {
  /** Something like an element: its tag, its type, and the selectors an ancestor of it matches. */
  const el = (tagName: string, type?: string, inside: string[] = []) => ({ tagName, type, closest: (selector: string) => (inside.includes(selector) ? {} : null) });
  const page = (modalOpen: boolean) => ({ querySelector: (selector: string) => (modalOpen && selector === MODAL_SELECTOR ? {} : null) });

  it("counts everything as in a popup while a dialog box is open", () => {
    expect(inPopup(el("DIV"), page(true))).toBe(true);
    expect(inPopup(null, page(true))).toBe(true);
    expect(inPopup(el("DIV"), page(false))).toBe(false);
  });

  it("counts a key pressed inside a small popup", () => {
    expect(inPopup(el("BUTTON", undefined, [POPUP_SELECTOR]), page(false))).toBe(true);
    expect(inPopup(el("BUTTON"), page(false))).toBe(false);
    expect(inPopup(null, page(false))).toBe(false);
    expect(inPopup({}, undefined)).toBe(false);
  });

  it("knows what takes typing", () => {
    expect(inTextBox(el("INPUT", "text"))).toBe(true);
    expect(inTextBox(el("INPUT"))).toBe(true);
    expect(inTextBox(el("input", "search"))).toBe(true);
    expect(inTextBox(el("INPUT", "number"))).toBe(true);
    expect(inTextBox(el("TEXTAREA"))).toBe(true);
    expect(inTextBox(el("SELECT"))).toBe(true);
    expect(inTextBox({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("lets shortcuts through from sliders, tick boxes and everything else", () => {
    expect(inTextBox(el("INPUT", "range"))).toBe(false);
    expect(inTextBox(el("INPUT", "checkbox"))).toBe(false);
    expect(inTextBox(el("INPUT", "RADIO"))).toBe(false);
    expect(inTextBox(el("BUTTON"))).toBe(false);
    expect(inTextBox(el("DIV"))).toBe(false);
    expect(inTextBox(null)).toBe(false);
  });

  it("knows a slider or tick box, which keeps Space and the arrows", () => {
    expect(onControl(el("INPUT", "range"))).toBe(true);
    expect(onControl(el("INPUT", "checkbox"))).toBe(true);
    expect(onControl(el("INPUT", "text"))).toBe(false);
    expect(onControl(el("BUTTON"))).toBe(false);
    expect(onControl(null)).toBe(false);
  });
});

describe("choices kept on this computer", () => {
  it("come back as they were written", () => {
    expect(readPrefs(prefsText({ countIn: 0, metronome: true }))).toEqual({ countIn: 0, metronome: true });
    expect(readPrefs(prefsText({ countIn: 2, metronome: false }))).toEqual({ countIn: 2, metronome: false });
    // "Connect MIDI keyboards without asking" is only ever kept as a yes.
    expect(readPrefs(prefsText({ countIn: 1, metronome: false, midi: true }))).toEqual({ countIn: 1, metronome: false, midi: true });
    expect(readPrefs(prefsText({ countIn: 1, metronome: false, midi: false }))).toEqual({ countIn: 1, metronome: false });
    expect(readPrefs('{"midi": "yes"}')).toEqual({});
  });

  it("leave out anything missing or odd, so the usual value stays", () => {
    expect(readPrefs(null)).toEqual({});
    expect(readPrefs("")).toEqual({});
    expect(readPrefs("not json {")).toEqual({});
    expect(readPrefs("[1, 2]")).toEqual({});
    expect(readPrefs('"words"')).toEqual({});
    expect(readPrefs('{"countIn": 7, "metronome": "yes"}')).toEqual({});
    expect(readPrefs('{"countIn": 1.5}')).toEqual({});
    expect(readPrefs('{"countIn": 2}')).toEqual({ countIn: 2 });
    expect(readPrefs('{"metronome": true, "other": 1}')).toEqual({ metronome: true });
  });
});

describe("a clip's place and length as whole numbers", () => {
  it("splits beats into bars and the beats left over", () => {
    expect(barsAndBeats(10, 4)).toEqual({ bars: 2, beats: 2 });
    expect(barsAndBeats(8, 4)).toEqual({ bars: 2, beats: 0 });
    expect(barsAndBeats(0, 4)).toEqual({ bars: 0, beats: 0 });
    expect(barsAndBeats(2.5, 4)).toEqual({ bars: 0, beats: 2.5 });
    // The reviewer's case: a clip at beat 4, eight beats long, after the bar became six beats — never "bar 1.667".
    expect(barsAndBeats(4, 6)).toEqual({ bars: 0, beats: 4 });
    expect(barsAndBeats(8, 6)).toEqual({ bars: 1, beats: 2 });
    // The shortest clip there is: a sixteenth of a beat, not "0.063 bars".
    expect(barsAndBeats(0.0625, 4)).toEqual({ bars: 0, beats: 0.063 });
    // Rounding never leaves "1 bar 4 beats" in a four-beat bar.
    expect(barsAndBeats(7.99999, 4)).toEqual({ bars: 2, beats: 0 });
    expect(barsAndBeats(-3, 4)).toEqual({ bars: 0, beats: 0 });
  });
});

describe("the loop strip", () => {
  const loop = { start: 8, end: 16 };
  it("takes hold of an end near it, the whole loop inside it, and nothing outside it", () => {
    // 24 pixels a beat: the loop runs from 192 to 384.
    expect(loopGrab(194, loop, 24)).toBe("start");
    expect(loopGrab(186, loop, 24)).toBe("start");
    expect(loopGrab(380, loop, 24)).toBe("end");
    expect(loopGrab(390, loop, 24)).toBe("end");
    expect(loopGrab(300, loop, 24)).toBe("move");
    expect(loopGrab(100, loop, 24)).toBe("new");
    expect(loopGrab(500, loop, 24)).toBe("new");
    // A loop a few pixels wide: whichever end is nearer.
    expect(loopGrab(193, { start: 8, end: 8.25 }, 24)).toBe("start");
    expect(loopGrab(197, { start: 8, end: 8.25 }, 24)).toBe("end");
  });
  it("stretches an end and leaves the other where it was", () => {
    expect(loopDragged("end", loop, 16, 23.6, 4)).toEqual({ start: 8, end: 24 });
    expect(loopDragged("start", loop, 8, 4.3, 4)).toEqual({ start: 4, end: 16 });
    // The ends never cross: at least a step apart, and never before the start of the song.
    expect(loopDragged("end", loop, 16, 2, 4)).toEqual({ start: 8, end: 12 });
    expect(loopDragged("start", loop, 8, 40, 4)).toEqual({ start: 12, end: 16 });
    expect(loopDragged("start", loop, 8, -9, 4)).toEqual({ start: 0, end: 16 });
  });
  it("slides the whole loop along, keeping its length", () => {
    expect(loopDragged("move", loop, 12, 16.4, 4)).toEqual({ start: 12, end: 20 });
    expect(loopDragged("move", loop, 12, 12.9, 4)).toEqual({ start: 8, end: 16 });
    expect(loopDragged("move", loop, 12, -50, 4)).toEqual({ start: 0, end: 8 });
  });
  it("draws a new one between where the drag began and where it is, either way round", () => {
    expect(loopDragged("new", loop, 0.2, 3.6, 4)).toEqual({ start: 0, end: 4 });
    expect(loopDragged("new", loop, 21, 33, 4)).toEqual({ start: 20, end: 32 });
    expect(loopDragged("new", loop, 33, 21, 4)).toEqual({ start: 20, end: 32 });
    expect(loopDragged("new", loop, 5, 5.1, 4)).toEqual({ start: 4, end: 8 });
    expect(loopDragged("new", loop, 1.2, 2.6, 1)).toEqual({ start: 1, end: 3 });
  });
});

describe("the bottom panel's height", () => {
  it("is 45% of the room under the toolbar until it's dragged, between 240 px and 60%", () => {
    // 800 high: 694 px of room.
    expect(panelHeight(800, null)).toBe(312);
    // A small laptop: 594 px of room; 45% would be 267.
    expect(panelHeight(700, null)).toBe(267);
    // A tall screen gets more than the old fixed 320.
    expect(panelHeight(1100, null)).toBe(447);
    // A very short window: never more than 60% of the room, so the tracks keep some.
    expect(panelHeight(420, null)).toBe(188);
    expect(panelHeight(420, null)).toBeLessThan(240);
  });
  it("keeps to what was dragged, inside the same limits", () => {
    expect(panelHeight(800, 200)).toBe(200);
    expect(panelHeight(800, 50)).toBe(140);
    expect(panelHeight(800, 2000)).toBe(416);
  });
});

describe("messages", () => {
  const t = (id: number, kind: "info" | "success" | "error") => ({ id, kind, text: `t${id}` });
  it("show the newest of each kind and the last two errors, in the order they came", () => {
    const all = [t(1, "success"), t(2, "success"), t(3, "info"), t(4, "error"), t(5, "error"), t(6, "error"), t(7, "success")];
    expect(toastsToShow(all).map((x) => x.id)).toEqual([3, 5, 6, 7]);
    expect(toastsToShow([t(1, "info")]).map((x) => x.id)).toEqual([1]);
    expect(toastsToShow([])).toEqual([]);
  });
});

describe("exporting", () => {
  it("takes off a .wav or .mid someone typed themselves", () => {
    expect(withoutSoundEnding("tune.wav")).toBe("tune");
    expect(withoutSoundEnding("tune.MID ")).toBe("tune");
    expect(withoutSoundEnding("My tune.midi")).toBe("My tune");
    expect(withoutSoundEnding("tune.v2")).toBe("tune.v2");
    expect(withoutSoundEnding("wav")).toBe("wav");
  });
  it("says how long is left in words", () => {
    expect(timeLeftWords(500, 0.5)).toMatch(/working out/);
    expect(timeLeftWords(5000, 0.01)).toMatch(/working out/);
    expect(timeLeftWords(10_000, 0.8)).toBe("a few seconds left");
    expect(timeLeftWords(10_000, 0.25)).toBe("about 30 seconds left");
    expect(timeLeftWords(30_000, 0.33)).toBe("about a minute left");
    expect(timeLeftWords(60_000, 0.2)).toBe("about 4 minutes left");
    expect(timeLeftWords(60_000, 1)).toBe("a few seconds left");
  });
});

describe("clips on top of each other", () => {
  it("marks the later clip of a pair that overlap on one track", () => {
    const s: Song = { ...song(), clips: [midi("a", "p", 0, 4), midi("b", "p", 4, 4), midi("c", "p", 2, 4), midi("d", "d", 0, 4), midi("e", "p", 20, 4), midi("f", "p", 20, 4)] };
    expect([...clipsOverOthers(s)].sort()).toEqual(["c", "f"]);
    expect(clipsOverOthers(song()).size).toBe(0);
    // A sound clip's length depends on the tempo: two seconds at 120 bpm reaches beat 4, at 60 only beat 2.
    const sounds: Song = { ...song(), clips: [audio("x", "a", 0, 0, 2), audio("y", "a", 3, 0, 1)] };
    expect([...clipsOverOthers(sounds)]).toEqual(["y"]);
    expect(clipsOverOthers({ ...sounds, bpm: 60 }).size).toBe(0);
  });
});

describe("drawing only the clips that show", () => {
  it("gives what's in view and half a view either side, in steps", () => {
    // 1000 px wide with a 200 px column, 20 px a beat: 40 beats across, steps of 20.
    expect(visibleBeats(0, 1000, 20, 200)).toEqual({ from: 0, to: 60 });
    expect(visibleBeats(100, 1000, 20, 200)).toEqual({ from: 0, to: 80 });
    expect(visibleBeats(399, 1000, 20, 200)).toEqual({ from: 0, to: 80 });
    expect(visibleBeats(2000, 1000, 20, 200)).toEqual({ from: 80, to: 160 });
    // Always covers what's showing.
    for (const left of [0, 37, 800, 12345]) {
      const { from, to } = visibleBeats(left, 1000, 20, 200);
      expect(from).toBeLessThanOrEqual(left / 20);
      expect(to).toBeGreaterThanOrEqual(left / 20 + 40);
    }
  });
});
