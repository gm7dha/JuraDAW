/**
 * The step sequencer: the clip being edited as a grid of boxes — a row for each drum (or each note of the song's
 * key), a box for each step across. Click a box to play that sound on that step; click it again to take it away;
 * drag along a row to fill (or empty) several; Shift-click to make a step louder or softer. Another way of seeing
 * the very same notes as the note editor, switched with Notes / Steps.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useStore } from "../model/store";
import { STEP_CHOICES, nextStrength, notesInStep, setStep, setStepStrength, stepCount, stepRows, strengthOf, type Strength } from "../model/steps";
import type { MidiClip, Song, Track } from "../model/types";
import { everyFrame, hear, playheadBeat } from "./engineApp";
import { barBeat, lengthWords } from "./songUi";

/** The step length chosen (kept while the page is open). */
let lastStep = 0.25;

const CELL_W = 26;
const ROW_H = 26;
const NAMES_W = 104;

export function StepGrid({ song, clip, track, drums, switcher }: { song: Song; clip: MidiClip; track: Track; drums: boolean; switcher: ReactNode }) {
  const [step, setStepLength] = useState(lastStep);
  const rows = useMemo(() => stepRows(clip, drums, song.key), [clip, drums, song.key]);
  const count = stepCount(clip, step);
  const perBeat = Math.round(1 / step);
  const perBar = perBeat * song.beatsPerBar;
  const grid = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const paint = useRef<{ on: boolean; done: Set<string>; strength: Strength } | null>(null);
  const s = useStore.getState;

  // The playhead, moved every frame.
  const clipRef = useRef(clip);
  clipRef.current = clip;
  useEffect(() => {
    let last = NaN;
    return everyFrame(() => {
      const beat = playheadBeat() - clipRef.current.start;
      const x = (beat / stepRef.current) * CELL_W;
      if (x === last || !playhead.current) return;
      last = x;
      playhead.current.style.transform = `translateX(${x}px)`;
      playhead.current.style.visibility = beat < 0 || beat > clipRef.current.length ? "hidden" : "visible";
    });
  }, []);
  const stepRef = useRef(step);
  stepRef.current = step;

  /** The box under the pointer (the grid has the pointer while a drag goes on, so it's found by place, not by target). */
  const boxAt = (e: { clientX: number; clientY: number }) => {
    const r = grid.current!.getBoundingClientRect();
    const index = Math.floor((e.clientX - r.left) / CELL_W);
    const row = Math.floor((e.clientY - r.top) / ROW_H);
    if (index < 0 || index >= count || row < 0 || row >= rows.length) return null;
    return { index, pitch: rows[row].pitch };
  };
  const apply = (box: { index: number; pitch: number }) => {
    const p = paint.current;
    if (!p) return;
    const id = `${box.pitch}:${box.index}`;
    if (p.done.has(id)) return;
    p.done.add(id);
    const before = s().history.present;
    const after = setStep(before, clip.id, box.pitch, box.index, step, p.on, p.strength);
    if (after === before) return;
    s().dragUpdate(after);
    if (p.on) hear(track.id, box.pitch, 100, 0.3);
  };

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const box = boxAt(e);
    if (!box) return;
    const there = notesInStep(clip, box.pitch, box.index, step);
    if (e.shiftKey) {
      // Louder or softer: normal → accented → soft → normal (a box that's off comes on accented).
      const now = there.length ? strengthOf(Math.max(...there.map((n) => n.velocity))) : "normal";
      const next = nextStrength(now);
      const song0 = s().history.present;
      s().commit(there.length ? setStepStrength(song0, clip.id, box.pitch, box.index, step, next) : setStep(song0, clip.id, box.pitch, box.index, step, true, next));
      hear(track.id, box.pitch, next === "accent" ? 120 : next === "soft" ? 70 : 100, 0.3);
      return;
    }
    s().dragStart();
    paint.current = { on: there.length === 0, done: new Set(), strength: "normal" };
    e.currentTarget.setPointerCapture(e.pointerId);
    apply(box);
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!paint.current) return;
    const box = boxAt(e);
    if (box) apply(box);
  };
  const up = () => {
    if (!paint.current) return;
    paint.current = null;
    s().dragEnd();
  };

  // Which boxes are on, and how strongly: row × step.
  const on = useMemo(() => {
    const map = new Map<string, Strength>();
    for (const n of clip.notes) {
      const index = Math.floor(n.start / step + 1e-6);
      if (index < 0 || index >= count) continue;
      const id = `${n.pitch}:${index}`;
      const strength = strengthOf(n.velocity);
      const was = map.get(id);
      if (!was || STRENGTH_ORDER[strength] > STRENGTH_ORDER[was]) map.set(id, strength);
    }
    return map;
  }, [clip.notes, step, count]);

  const width = count * CELL_W;
  return (
    <div className="steps" style={{ ["--track" as string]: track.colour }}>
      <div className="roll-bar">
        <span className="roll-title" title={`Editing "${clip.name}" on ${track.name}`}>
          <span className="track-dot" style={{ background: track.colour }} />
          <b>{clip.name}</b>
          <span className="muted small">
            {" "}
            · bar {barBeat(clip.start, song.beatsPerBar).text}, {lengthWords(clip.length, song.beatsPerBar)}
          </span>
        </span>
        {switcher}
        <span className="roll-spring" />
        <span className="muted small roll-hint">Click a box to play it · drag along a row · Shift-click for louder or softer</span>
        <select
          value={String(step)}
          aria-label="How long a step is"
          title="How long each box is: sixteenths for busy beats, eighths for simpler ones, triplets for a shuffle"
          onChange={(e) => {
            lastStep = Number(e.target.value);
            setStepLength(lastStep);
          }}
        >
          {STEP_CHOICES.map((c) => (
            <option key={c.name} value={String(c.step)}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="steps-scroll">
        <div className="steps-content" style={{ width: NAMES_W + width }}>
          <div className="steps-names" style={{ width: NAMES_W }}>
            {rows.map((r) => (
              <button key={r.pitch} type="button" className="steps-name" style={{ height: ROW_H }} onPointerDown={() => hear(track.id, r.pitch, 100, 0.4)} title={`${r.name} — click to hear it`} tabIndex={-1}>
                {r.name}
              </button>
            ))}
          </div>
          <div
            className="steps-grid"
            ref={grid}
            style={{ width, height: rows.length * ROW_H, ["--cell" as string]: `${CELL_W}px`, ["--row" as string]: `${ROW_H}px` }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onContextMenu={(e) => e.preventDefault()}
            role="grid"
            aria-label={`Steps of ${clip.name}`}
          >
            {rows.map((r, row) =>
              Array.from({ length: count }, (_, i) => {
                const strength = on.get(`${r.pitch}:${i}`);
                const edge = i % perBar === 0 ? " bar" : i % perBeat === 0 ? " beat" : "";
                const shade = Math.floor(i / perBeat) % 2 === 1 ? " odd" : "";
                return <div key={`${row}:${i}`} className={`step${edge}${shade}${strength ? ` on ${strength}` : ""}`} data-step={`${r.pitch}:${i}`} style={{ left: i * CELL_W, top: row * ROW_H }} />;
              }),
            )}
            <div className="steps-playhead" ref={playhead} />
          </div>
        </div>
      </div>
    </div>
  );
}

const STRENGTH_ORDER: Record<Strength, number> = { soft: 0, normal: 1, accent: 2 };
