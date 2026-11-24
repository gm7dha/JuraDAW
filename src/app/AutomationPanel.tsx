/**
 * The Automation tab: lines drawn over the whole song that move the selected
 * track's volume, filter or left–right place as it plays — a fade-out at the
 * end, a filter that opens over eight bars, a sound that drifts from left to
 * right. Click to add a point, drag one to move it, double-click one to take
 * it away. A track with no line keeps its own setting.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { AUTO_NAMES, AUTO_PARAMS, lineOf, panValueWords, restingValue, withPoint, withPointMoved, withoutPoint } from "../model/automation";
import * as edits from "../model/edits";
import { cutoffHz, effectsOf, hzText } from "../model/shaping";
import { useStore } from "../model/store";
import { clipEnd, songLength } from "../model/time";
import type { AutoParam, AutoPoint, Song, Track } from "../model/types";
import { everyFrame, playheadBeat } from "./engineApp";
import { Icons } from "./icons";
import { barBeat, snapped } from "./songUi";

/** Room above and below the line's top and bottom, so points there can still be grabbed (px). */
const PAD = 14;
/** How near a point the pointer must be to grab it (px). */
const GRAB = 9;
/** The ruler's height (px). */
const RULER = 20;
/** Room at the left, so a point at the very start can be seen and grabbed whole (px). */
const LEFT = 8;

/** The line being looked at, kept while the tab is closed and opened again. */
let lastParam: AutoParam = "volume";

/** A line's value in words, as the track's own sliders say it. */
export function valueWords(track: Track, param: AutoParam, value: number): string {
  if (param === "volume") return `${Math.round(value * 100)}%`;
  if (param === "pan") return panValueWords(value);
  const kind = effectsOf(track).filter.kind;
  if (kind === "band") return `keeps around ${hzText(cutoffHz(value))}`;
  if (kind === "low" && value >= 0.999) return "open";
  if (kind === "high" && value <= 0.001) return "open";
  return `cuts ${kind === "low" ? "above" : "below"} ${hzText(cutoffHz(value))}`;
}

const HINTS: Record<AutoParam, string> = {
  volume: "Draw how loud this track is as the song plays — to fade it in or out, or to bring it up for a chorus.",
  filter: "Draw where the filter cuts as the song plays: low muffles the sound, high lets it all through. Lovely for a slow build.",
  pan: "Draw where the sound sits as the song plays: up is left, down is right, the middle line is the centre.",
};

export function AutomationPanel() {
  const song = useStore((s) => s.history.present);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const track = song.tracks.find((t) => t.id === selectedTrackId) ?? song.tracks[0];
  if (!track) return null;
  return <Lines song={song} track={track} />;
}

function Lines({ song, track }: { song: Song; track: Track }) {
  const [param, setParamState] = useState<AutoParam>(lastParam);
  const setParam = (p: AutoParam) => {
    lastParam = p;
    setParamState(p);
  };
  const snap = useStore((s) => s.snap);
  const box = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 160 });
  const [hover, setHover] = useState<{ beat: number; value: number } | null>(null);
  const drag = useRef<{ base: Song; index: number } | null>(null);
  /** The point a click has just made, so the second click of a double-click doesn't take it straight away again. */
  const added = useRef<{ beat: number; time: number } | null>(null);

  const points = lineOf(track, param) ?? [];
  const bpb = song.beatsPerBar;
  const lastBeat = points.length ? points[points.length - 1].beat : 0;
  const bars = Math.max(8, Math.ceil(Math.max(songLength(song), lastBeat) / bpb) + 2);
  const beats = bars * bpb;
  const ppb = Math.max(6, (size.w - LEFT - 8) / beats);
  const width = LEFT + beats * ppb + 8;
  const graphH = Math.max(60, size.h - RULER);
  const xOf = (beat: number) => LEFT + beat * ppb;
  const yOf = (value: number) => RULER + PAD + (1 - value) * (graphH - 2 * PAD);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const seen = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    seen();
    const watch = new ResizeObserver(seen);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  // The playhead, moved every frame.
  const ppbRef = useRef(ppb);
  ppbRef.current = ppb;
  useEffect(() => {
    let last = NaN;
    return everyFrame(() => {
      const x = LEFT + playheadBeat() * ppbRef.current;
      if (x === last || !playhead.current) return;
      last = x;
      playhead.current.style.transform = `translateX(${x}px)`;
    });
  }, []);

  /** Where the pointer is, as a beat and a value. */
  const place = (e: { clientX: number; clientY: number; shiftKey: boolean }) => {
    const r = box.current!.querySelector("svg")!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const beat = Math.max(0, snapped((x - LEFT) / ppb, snap, bpb, { free: e.shiftKey }));
    const value = Math.round(Math.min(1, Math.max(0, 1 - (y - RULER - PAD) / (graphH - 2 * PAD))) * 100) / 100;
    return { x, y, beat, value };
  };
  const pointAt = (x: number, y: number) => {
    let best = -1;
    let bestD = GRAB;
    points.forEach((p, i) => {
      const d = Math.hypot(xOf(p.beat) - x, yOf(p.value) - y);
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  };
  const s = useStore.getState;
  const withLine = (base: Song, line: AutoPoint[]) => edits.setAutomation(base, track.id, param, line);

  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const at = place(e);
    let index = pointAt(at.x, at.y);
    const base = s().history.present;
    s().dragStart();
    let made = false;
    if (index < 0) {
      // A new point. The first one starts the line from the track's own setting at the beginning.
      const start = points.length ? points : at.beat > 0 ? [{ beat: 0, value: restingValue(track, param) }] : [];
      const line = withPoint(start, { beat: at.beat, value: at.value });
      index = line.findIndex((p) => p.beat === at.beat);
      made = true;
      added.current = { beat: at.beat, time: Date.now() };
      s().dragUpdate(withLine(base, line));
    }
    drag.current = { base: made ? s().history.present : base, index };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const at = place(e);
    setHover({ beat: at.beat, value: at.value });
    const d = drag.current;
    if (!d) return;
    const line = lineOf(edits.findTrack(d.base, track.id) ?? track, param) ?? [];
    s().dragUpdate(withLine(d.base, withPointMoved(line, d.index, at)));
  };
  const up = () => {
    if (!drag.current) return;
    drag.current = null;
    s().dragEnd();
  };
  const doubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const at = place({ ...e, shiftKey: true });
    const index = pointAt(at.x, at.y);
    if (index < 0) return;
    const just = added.current;
    if (just && Math.abs(points[index].beat - just.beat) < 1e-9 && Date.now() - just.time < 600) return;
    s().commit(withLine(s().history.present, withoutPoint(points, index)));
  };

  // The line: flat from the first point to the start, and from the last to the end.
  const shown = points.length ? [{ beat: 0, value: points[0].value }, ...points, { beat: beats, value: points[points.length - 1].value }] : [];
  const path = shown.map((p, i) => `${i ? "L" : "M"}${xOf(p.beat).toFixed(1)},${yOf(p.value).toFixed(1)}`).join("");
  const resting = restingValue(track, param);
  const barStep = ppb * bpb < 28 ? (ppb * bpb < 10 ? 8 : 4) : 1;

  return (
    <div className="auto">
      <div className="roll-bar">
        <span className="roll-title" title={`The lines on ${track.name}`}>
          <span className="track-dot" style={{ background: track.colour }} />
          <b>{track.name}</b>
        </span>
        <div className="segmented three auto-what" role="radiogroup" aria-label="What the line moves">
          {AUTO_PARAMS.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={param === p} className={param === p ? "selected" : ""} onClick={() => setParam(p)} title={HINTS[p]}>
              {AUTO_NAMES[p]}
              {lineOf(track, p) ? <span className="auto-has" aria-label=" (has a line)" /> : null}
            </button>
          ))}
        </div>
        <span className="roll-spring" />
        <span className="muted small roll-hint">
          {hover ? `Bar ${barBeat(hover.beat, bpb).text} · ${valueWords(track, param, hover.value)}` : points.length ? "Click to add a point · drag to move · double-click to take away" : "Click to start a line"}
        </span>
        <button type="button" className="text-button small-button" disabled={!points.length} onClick={() => s().commit(edits.setAutomation(s().history.present, track.id, param, null))} title={`Take the ${AUTO_NAMES[param].toLowerCase()} line off this track: it goes back to its own setting`}>
          <Icons.Cross size={14} /> Clear line
        </button>
      </div>
      <div className="auto-scroll" ref={box}>
        <div className="auto-sheet" style={{ width, height: size.h, ["--track" as string]: track.colour }}>
          <svg width={width} height={size.h} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => setHover(null)} onDoubleClick={doubleClick} role="img" aria-label={`${AUTO_NAMES[param]} line for ${track.name}${points.length ? `, ${points.length} points` : ", none yet"}`}>
            {song.clips
              .filter((c) => c.trackId === track.id)
              .map((c) => (
                <rect key={c.id} className="auto-clip" x={xOf(c.start)} y={RULER} width={Math.max(2, xOf(clipEnd(c, song.bpm)) - xOf(c.start))} height={graphH} />
              ))}
            {Array.from({ length: bars + 1 }, (_, b) =>
              b % barStep ? null : (
                <g key={b}>
                  <line className="auto-bar" x1={xOf(b * bpb)} x2={xOf(b * bpb)} y1={RULER - 6} y2={size.h} />
                  {b < bars && (
                    <text className="auto-bar-number" x={xOf(b * bpb) + 3} y={RULER - 7}>
                      {b + 1}
                    </text>
                  )}
                </g>
              ),
            )}
            <line className="auto-middle" x1={LEFT} x2={width} y1={yOf(0.5)} y2={yOf(0.5)} />
            {!points.length && <line className="auto-resting" x1={LEFT} x2={width} y1={yOf(resting)} y2={yOf(resting)} />}
            {path && <path className="auto-line" d={path} />}
            {points.map((p, i) => (
              <circle key={i} className="auto-point" cx={xOf(p.beat)} cy={yOf(p.value)} r={5} />
            ))}
          </svg>
          <div className="auto-playhead" ref={playhead} style={{ top: RULER }} />
        </div>
      </div>
      <p className="auto-help muted small">{HINTS[param]}</p>
    </div>
  );
}
