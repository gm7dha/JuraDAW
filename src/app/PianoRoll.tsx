/**
 * The note editor (a piano roll) for the clip being edited: piano keys down
 * the left (click to hear them), a grid, and the notes as bars in the track's
 * colour — the louder a note, the more solid its bar. For a drum track the
 * rows are the kit's drums by name instead of a piano. Along the bottom, a
 * strip of bars sets how hard each note is played.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { instrumentById } from "../audio/instruments";
import { useStore } from "../model/store";
import { DRUM_PITCHES, isBlackKey, pitchName } from "../model/time";
import { MIN_LENGTH, type MidiClip, type Note, type Song, type Track } from "../model/types";
import { ContextMenu, type MenuEntry } from "./ContextMenu";
import { useEdgeScroll, type PointerPlace } from "./edgeScroll";
import { everyFrame, hear, playheadBeat } from "./engineApp";
import { Icons } from "./icons";
import { barBeat, lengthWords, midiClip, noteStep, withNotes } from "./songUi";
import { gridFor, useZoom } from "./zoom";

const PIANO_KEYS_W = 64;
const DRUM_KEYS_W = 112;
const RULER_H = 22;
const VELOCITY_H = 52;
const PIANO_ROW = 16;
const DRUM_ROW = 24;
/** The piano's range: C1 to B7. */
const LOW = 24;
const HIGH = 107;
const MIN_PPB = 8;
const MAX_PPB = 400;
const EDGE = 6;

type Drag =
  | { kind: "move"; id: string; ids: string[]; base: Song; beat0: number; row0: number; x0: number; y0: number; anchor: number; moved: boolean; wasSelected: boolean; toggle: boolean; lastPitch: number }
  | { kind: "length"; ids: string[]; base: Song; beat0: number; x0: number; moved: boolean }
  | { kind: "band"; x0: number; y0: number; keep: string[]; moved: boolean }
  | { kind: "velocity"; base: Song; moved: boolean }
  | { kind: "erase" };

/** The length the next drawn note gets: the last one changed, to begin with one snap step. */
let lastLength: number | null = null;

export function PianoRoll() {
  const song = useStore((s) => s.history.present);
  const editingClipId = useStore((s) => s.editingClipId);
  const selectedNoteIds = useStore((s) => s.selectedNoteIds);
  const tool = useStore((s) => s.tool);
  const snap = useStore((s) => s.snap);
  const clip = midiClip(song, editingClipId);
  const track = clip ? song.tracks.find((t) => t.id === clip.trackId) : undefined;

  if (!clip || !track) {
    return (
      <div className="panel-empty">
        <Icons.Editor size={30} />
        <p>
          <b>Double-click a clip to edit its notes.</b>
        </p>
        <p className="muted small">No clip yet? Double-click an empty part of an instrument track to make one, or pick a ready-made pattern from the Library.</p>
      </div>
    );
  }
  return <Roll key={clip.id} song={song} clip={clip} track={track} selectedNoteIds={selectedNoteIds} tool={tool} snap={snap} />;
}

interface RollProps {
  song: Song;
  clip: MidiClip;
  track: Track;
  selectedNoteIds: string[];
  tool: ReturnType<typeof useStore.getState>["tool"];
  snap: ReturnType<typeof useStore.getState>["snap"];
}

function Roll({ song, clip, track, selectedNoteIds, tool, snap }: RollProps) {
  const drums = instrumentById(track.instrument).kind === "drums";
  /** The rows from the top down: each is a pitch. */
  const rows = useMemo(() => {
    if (!drums) return Array.from({ length: HIGH - LOW + 1 }, (_, i) => ({ pitch: HIGH - i, name: pitchName(HIGH - i) }));
    // The kit's drums by name, plus any other pitches the clip happens to hold (from a MIDI file).
    const known = DRUM_PITCHES.map((d) => ({ pitch: d.pitch, name: d.name }));
    const extra = [...new Set(clip.notes.map((n) => n.pitch))].filter((p) => !known.some((k) => k.pitch === p)).sort((a, b) => b - a);
    return [...known, ...extra.map((p) => ({ pitch: p, name: pitchName(p) }))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drums, drums ? clip.notes.map((n) => n.pitch).join() : ""]);
  const rowH = drums ? DRUM_ROW : PIANO_ROW;
  const keysW = drums ? DRUM_KEYS_W : PIANO_KEYS_W;
  const rowOfPitch = useMemo(() => new Map(rows.map((r, i) => [r.pitch, i])), [rows]);

  const scroll = useRef<HTMLDivElement>(null);
  const gridEl = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [ppb, setPpb] = useState(48);
  const [viewW, setViewW] = useState(900);
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const ppbRef = useRef(ppb);
  ppbRef.current = ppb;
  const clipRef = useRef(clip);
  clipRef.current = clip;
  const zoomBy = useZoom({ scroll, ppb, setPpb, left: keysW, min: MIN_PPB, max: MAX_PPB });

  const beatsPerBar = song.beatsPerBar;
  // Room to write past the clip's end (the clip grows to hold what's added).
  const totalBeats = Math.ceil(Math.max(clip.length + 2 * beatsPerBar, (viewW - keysW) / ppb) / beatsPerBar + 0.001) * beatsPerBar;
  const width = totalBeats * ppb;
  const grid = gridFor(ppb, beatsPerBar);
  // Bars are counted in the song, so the lines sit where the song's bars are even if the clip starts mid-bar.
  const barOffset = clip.start % beatsPerBar;
  const s = useStore.getState;

  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const measure = () => setViewW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Open on the notes (or round middle C for a new clip).
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const c = clipRef.current;
    const pitches = c.notes.map((n) => n.pitch).sort((a, b) => a - b);
    const middle = pitches.length ? pitches[Math.floor(pitches.length / 2)] : 62;
    const row = rowOfPitch.get(middle) ?? rowOfPitch.get(60) ?? 0;
    el.scrollTop = Math.max(0, row * rowH - (el.clientHeight - RULER_H - VELOCITY_H) / 2);
    // Fit the clip across the view to begin with.
    setPpb(Math.max(MIN_PPB, Math.min(96, (el.clientWidth - keysW - 16) / Math.max(c.length, beatsPerBar))));
    // Only when the roll opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The playhead, moved every frame.
  useEffect(() => {
    let last = NaN;
    return everyFrame(() => {
      const x = (playheadBeat() - clipRef.current.start) * ppbRef.current;
      if (x === last || !playhead.current) return;
      last = x;
      playhead.current.style.transform = `translateX(${x}px)`;
      playhead.current.style.visibility = x < 0 ? "hidden" : "visible";
    });
  }, []);

  const place = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const r = gridEl.current!.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const row = Math.max(0, Math.min(rows.length - 1, Math.floor(y / rowH)));
      return { x, y, beat: Math.max(0, x / ppbRef.current), row, pitch: rows[row].pitch };
    },
    [rows, rowH],
  );

  const step = noteStep(snap);
  /** A place moved onto the note grid (the snap step; sixteenths when snap is off or whole bars). */
  const snapNote = (beat: number, free: boolean, down = false) => (free ? Math.max(0, beat) : Math.max(0, (down ? Math.floor(beat / step + 1e-9) : Math.round(beat / step)) * step));

  /** Add a note where the pointer is and carry on dragging its length. */
  const draw = (e: ReactPointerEvent<HTMLDivElement>, p: ReturnType<typeof place>) => {
    const start = snapNote(p.beat, e.shiftKey, true);
    const length = drums ? step : (lastLength ?? step);
    const id = s().addNote(clip.id, { pitch: p.pitch, start, length, velocity: 100 });
    hear(track.id, p.pitch, 100);
    if (drums) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind: "length", ids: [id], base: s().history.present, beat0: p.beat, x0: e.clientX, moved: false };
  };

  const gridDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setMenu(null);
    const p = place(e);
    const target = e.target as HTMLElement;
    const noteEl = target.closest<HTMLElement>("[data-note]");
    const note = noteEl ? clip.notes.find((n) => n.id === noteEl.dataset.note) : undefined;
    const st = s();
    if (note) {
      if (st.tool === "eraser") {
        st.removeNotes(clip.id, [note.id]);
        drag.current = { kind: "erase" };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      const wasSelected = st.selectedNoteIds.includes(note.id);
      const toggle = e.shiftKey || e.ctrlKey || e.metaKey;
      const ids = wasSelected ? st.selectedNoteIds : toggle ? [...st.selectedNoteIds, note.id] : [note.id];
      if (!wasSelected) st.selectNotes(ids);
      hear(track.id, note.pitch, note.velocity);
      e.currentTarget.setPointerCapture(e.pointerId);
      if (target.dataset.edge === "end" && !drums) drag.current = { kind: "length", ids, base: st.history.present, beat0: p.beat, x0: e.clientX, moved: false };
      else drag.current = { kind: "move", id: note.id, ids, base: st.history.present, beat0: p.beat, row0: p.row, x0: e.clientX, y0: e.clientY, anchor: note.start, moved: false, wasSelected, toggle, lastPitch: note.pitch };
      return;
    }
    if (st.tool === "eraser") {
      drag.current = { kind: "erase" };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (st.tool === "pencil") {
      draw(e, p);
      return;
    }
    if (e.pointerType === "touch") {
      if (st.selectedNoteIds.length) st.selectNotes([]);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind: "band", x0: p.x, y0: p.y, keep: e.shiftKey || e.ctrlKey || e.metaKey ? st.selectedNoteIds : [], moved: false };
  };

  const gridMove = (e: PointerPlace) => {
    const d = drag.current;
    if (!d) return;
    const st = s();
    const p = place(e);
    const free = e.shiftKey;
    if (d.kind === "erase") {
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-note]");
      if (el?.dataset.note) st.removeNotes(clip.id, [el.dataset.note]);
    } else if (d.kind === "move") {
      if (!d.moved) {
        if (Math.abs(e.clientX - d.x0) < 3 && Math.abs(e.clientY - d.y0) < 3) return;
        d.moved = true;
        st.dragStart();
      }
      const to = snapNote(d.anchor + (p.beat - d.beat0), free);
      const base = midiClip(d.base, clip.id);
      if (!base) return;
      const picked = base.notes.filter((n) => d.ids.includes(n.id));
      const byBeats = Math.max(to - d.anchor, -Math.min(...picked.map((n) => n.start)));
      // Rows moved, turned into pitches through the row list (so it works for drums' rows too).
      const byRows = p.row - d.row0;
      const pitchAfter = (n: Note) => {
        const row = rowOfPitch.get(n.pitch);
        if (row === undefined) return n.pitch;
        return rows[Math.max(0, Math.min(rows.length - 1, row + byRows))].pitch;
      };
      st.dragUpdate(withNotes(d.base, clip.id, (notes) => notes.map((n) => (d.ids.includes(n.id) ? { ...n, start: n.start + byBeats, pitch: pitchAfter(n) } : n))));
      const grabbed = picked.find((n) => n.id === d.id);
      if (grabbed) {
        const now = pitchAfter(grabbed);
        if (now !== d.lastPitch) {
          d.lastPitch = now;
          hear(track.id, now, grabbed.velocity, 0.2);
        }
      }
    } else if (d.kind === "length") {
      if (!d.moved) {
        if (Math.abs(e.clientX - d.x0) < 3) return;
        d.moved = true;
        st.dragStart();
      }
      const by = p.beat - d.beat0;
      st.dragUpdate(
        withNotes(d.base, clip.id, (notes) =>
          notes.map((n) => {
            if (!d.ids.includes(n.id)) return n;
            const end = snapNote(n.start + n.length + by, free);
            return { ...n, length: Math.max(free ? MIN_LENGTH : Math.min(step, n.length), end - n.start) };
          }),
        ),
      );
    } else if (d.kind === "band") {
      if (!d.moved && Math.abs(p.x - d.x0) < 4 && Math.abs(p.y - d.y0) < 4) return;
      d.moved = true;
      const box = { x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) };
      setBand(box);
      const inside = clip.notes
        .filter((n) => {
          const row = rowOfPitch.get(n.pitch);
          if (row === undefined) return false;
          const x1 = n.start * ppbRef.current;
          const x2 = x1 + n.length * ppbRef.current;
          return x2 > box.x && x1 < box.x + box.w && (row + 1) * rowH > box.y && row * rowH < box.y + box.h;
        })
        .map((n) => n.id);
      const ids = [...new Set([...d.keep, ...inside])];
      if (ids.join() !== st.selectedNoteIds.join()) st.selectNotes(ids);
    }
  };

  // A note or rubber band dragged to the edge of what's showing scrolls the view along.
  const follow = useEdgeScroll({
    scroll,
    left: keysW,
    top: RULER_H,
    bottom: VELOCITY_H,
    dragging: () => {
      const d = drag.current;
      return !!d && (d.kind === "move" || d.kind === "length" || d.kind === "band") && d.moved;
    },
    moved: (p) => gridMove(p),
  });

  const gridUp = () => {
    const d = drag.current;
    drag.current = null;
    follow(null);
    if (!d) return;
    const st = s();
    if (d.kind === "move") {
      if (d.moved) st.dragEnd();
      else if (d.toggle && d.wasSelected) st.selectNotes(st.selectedNoteIds.filter((id) => id !== d.id));
      else if (!d.toggle && st.selectedNoteIds.length > 1) st.selectNotes([d.id]);
    } else if (d.kind === "length") {
      if (d.moved) {
        st.dragEnd();
        const note = midiClip(st.history.present, clip.id)?.notes.find((n) => n.id === d.ids[0]);
        if (note) lastLength = note.length;
      }
    } else if (d.kind === "band") {
      setBand(null);
      if (!d.moved && !d.keep.length && st.selectedNoteIds.length) st.selectNotes([]);
    }
  };

  const gridDouble = (e: React.MouseEvent<HTMLDivElement>) => {
    const st = s();
    if (st.tool !== "select") return;
    // Not from the event's target: while a press is captured, the grid is the target of the clicks that follow.
    const noteEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-note]");
    if (noteEl?.dataset.note) {
      // Double-clicking a note takes it away again (as adding one is a double-click).
      st.removeNotes(clip.id, [noteEl.dataset.note]);
      return;
    }
    const p = place(e);
    const start = snapNote(p.beat, e.shiftKey, true);
    st.addNote(clip.id, { pitch: p.pitch, start, length: drums ? step : (lastLength ?? step), velocity: 100 });
    hear(track.id, p.pitch, 100);
  };

  const gridMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const st = s();
    const noteEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-note]");
    const id = noteEl?.dataset.note;
    if (id && !st.selectedNoteIds.includes(id)) st.selectNotes([id]);
    const any = !!id || st.selectedNoteIds.length > 0;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      entries: [
        { label: "Cut", hint: "Mod+X", act: () => s().cutSelected(), off: !any },
        { label: "Copy", hint: "Mod+C", act: () => s().copySelected(), off: !any },
        { label: "Paste at the play position", hint: "Mod+V", act: () => s().paste() },
        { label: "Delete", hint: "Del", act: () => s().removeNotes(clip.id, s().selectedNoteIds), off: !any },
        "line",
        { label: "Select all notes", hint: "Mod+A", act: () => s().selectNotes(clip.notes.map((n) => n.id)), off: !clip.notes.length },
        { label: "Tidy timing (onto the grid)", act: () => s().quantise(step), off: !clip.notes.length },
        ...(drums
          ? []
          : ([
              { label: "Up an octave", act: () => s().transpose(12), off: !clip.notes.length },
              { label: "Down an octave", act: () => s().transpose(-12), off: !clip.notes.length },
            ] as MenuEntry[])),
      ],
    });
  };

  // The velocity strip: drag across the bars to set how hard notes are played.
  const velocityAt = (e: ReactPointerEvent<HTMLDivElement>, base: Song) => {
    const r = e.currentTarget.getBoundingClientRect();
    const beat = (e.clientX - r.left) / ppbRef.current;
    const velocity = Math.max(1, Math.min(127, Math.round(((r.bottom - 4 - e.clientY) / (VELOCITY_H - 10)) * 127)));
    const st = s();
    const picked = st.selectedNoteIds;
    // The notes under the pointer (those selected only, if some are).
    const under = clipRef.current.notes.filter((n) => beat >= n.start - 2 / ppbRef.current && beat <= n.start + Math.max(n.length, 8 / ppbRef.current)).filter((n) => !picked.length || picked.includes(n.id));
    if (!under.length) return;
    const ids = under.map((n) => n.id);
    const now = midiClip(st.history.present, clip.id);
    st.dragUpdate(withNotes({ ...base, clips: base.clips.map((c) => (c.id === clip.id && now ? now : c)) }, clip.id, (notes) => notes.map((n) => (ids.includes(n.id) ? { ...n, velocity } : n))));
  };

  const bars = useMemo(() => {
    const out: { bar: number; x: number }[] = [];
    const first = Math.ceil(clip.start / beatsPerBar - 1e-6);
    for (let b = first; b * beatsPerBar - clip.start < totalBeats; b += grid.labelEvery) out.push({ bar: b + 1, x: (b * beatsPerBar - clip.start) * ppb });
    return out;
  }, [clip.start, beatsPerBar, totalBeats, ppb, grid.labelEvery]);

  const selectedCount = selectedNoteIds.length;
  const height = rows.length * rowH;
  const gridStyle = {
    width,
    height,
    ["--fine" as string]: `${grid.fine * ppb}px`,
    ["--strong" as string]: `${grid.strong * ppb}px`,
    ["--row" as string]: `${rowH}px`,
    ["--grid-shift" as string]: `${-barOffset * ppb}px`,
    ["--track" as string]: track.colour,
  };

  return (
    <div className="roll">
      <div className="roll-bar">
        <span className="roll-title" title={`Editing "${clip.name}" on ${track.name}`}>
          <span className="track-dot" style={{ background: track.colour }} />
          <b>{clip.name}</b>
          <span className="muted small">
            {" "}
            {/* (The track's name only when the clip isn't simply named after it.) */}
            {clip.name === track.name ? "" : `· ${track.name} `}· bar {barBeat(clip.start, beatsPerBar).text}, {lengthWords(clip.length, beatsPerBar)} · {clip.notes.length} {clip.notes.length === 1 ? "note" : "notes"}
            {selectedCount ? ` (${selectedCount} selected)` : ""}
          </span>
        </span>
        <span className="roll-spring" />
        <span className="muted small roll-hint">{tool === "pencil" ? "Click to add a note" : "Double-click to add a note"}</span>
        <button type="button" className="text-button small-button" onClick={() => s().quantise(step)} disabled={!clip.notes.length} title="Tidy timing: move the selected notes (or all of them) onto the snap grid, so they're exactly in time">
          <Icons.Tidy size={16} /> Tidy timing
        </button>
        {!drums && (
          <span className="button-run" role="group" aria-label="Move notes up or down">
            <button type="button" className="text-button small-button" onClick={() => s().transpose(-12)} disabled={!clip.notes.length} title="Move the selected notes (or all of them) down an octave" aria-label="Down an octave">
              −12
            </button>
            <button type="button" className="text-button small-button" onClick={() => s().transpose(-1)} disabled={!clip.notes.length} title="Down one step (a semitone)" aria-label="Down a semitone">
              −1
            </button>
            <button type="button" className="text-button small-button" onClick={() => s().transpose(1)} disabled={!clip.notes.length} title="Up one step (a semitone)" aria-label="Up a semitone">
              +1
            </button>
            <button type="button" className="text-button small-button" onClick={() => s().transpose(12)} disabled={!clip.notes.length} title="Move the selected notes (or all of them) up an octave" aria-label="Up an octave">
              +12
            </button>
          </span>
        )}
        <span className="button-run">
          <button type="button" className="icon-button small" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out" title="Zoom out (Ctrl/⌘ + scroll wheel, or pinch)">
            <span className="zoom-sign">−</span>
          </button>
          <button type="button" className="icon-button small" onClick={() => zoomBy(1.4)} aria-label="Zoom in" title="Zoom in (Ctrl/⌘ + scroll wheel, or pinch)">
            <span className="zoom-sign">+</span>
          </button>
        </span>
      </div>
      <div className={`roll-scroll tool-${tool}${drums ? " drums" : ""}`} ref={scroll} onContextMenu={(e) => e.preventDefault()}>
        <div className="roll-content" style={{ width: keysW + width }}>
          <div className="roll-ruler-row" style={{ height: RULER_H }}>
            <div className="roll-corner" style={{ width: keysW }} />
            <div className="roll-ruler" style={{ width }}>
              {bars.map((b) => (
                <span key={b.bar} className="ruler-bar" style={{ left: b.x }}>
                  {b.bar}
                </span>
              ))}
              <div className="roll-clip-end" style={{ left: clip.length * ppb }} title="The clip ends here (notes past it make it longer)" />
            </div>
          </div>
          <div className="roll-body">
            <div className="roll-keys" style={{ width: keysW }} aria-label={drums ? "Drums" : "Piano keys"}>
              {rows.map((r) => (
                <button
                  key={r.pitch}
                  type="button"
                  className={`roll-key${drums ? " drum" : isBlackKey(r.pitch) ? " black" : " white"}${!drums && r.pitch % 12 === 0 ? " c" : ""}`}
                  style={{ height: rowH }}
                  onPointerDown={() => hear(track.id, r.pitch, 100, 0.5)}
                  title={`${r.name} — click to hear it`}
                  aria-label={r.name}
                  tabIndex={-1}
                >
                  {drums ? r.name : r.pitch % 12 === 0 ? r.name : ""}
                </button>
              ))}
            </div>
            <div
              className="roll-grid"
              ref={gridEl}
              style={gridStyle}
              onPointerDown={gridDown}
              onPointerMove={(e) => {
                gridMove(e);
                if (drag.current) follow(e);
              }}
              onPointerUp={gridUp}
              onPointerCancel={gridUp}
              onDoubleClick={gridDouble}
              onContextMenu={gridMenu}
            >
              {!drums && <div className="roll-rows" />}
              <div className="roll-lines" />
              <div className="roll-past" style={{ left: clip.length * ppb }} />
              {clip.notes.map((n) => {
                const row = rowOfPitch.get(n.pitch);
                if (row === undefined) return null;
                const w = Math.max(4, n.length * ppb - 1);
                return (
                  <div
                    key={n.id}
                    data-note={n.id}
                    className={`note${selectedNoteIds.includes(n.id) ? " selected" : ""}${n.start >= clip.length ? " past" : ""}`}
                    style={{ left: n.start * ppb, top: row * rowH + 1, width: w, height: rowH - 2, ["--strength" as string]: `${Math.round(35 + (n.velocity / 127) * 65)}%` }}
                    title={`${drums ? rows[row].name : pitchName(n.pitch)} · loudness ${n.velocity}`}
                  >
                    {!drums && w > 2 * EDGE + 4 && <span className="note-edge" data-edge="end" />}
                  </div>
                );
              })}
              {band && <div className="rubber-band" style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />}
              <div className="playhead" ref={playhead} />
            </div>
          </div>
          <div className="velocity-row" style={{ height: VELOCITY_H }}>
            <div className="velocity-label" style={{ width: keysW }} title="How hard each note is played. Drag the bars up and down">
              Loudness
            </div>
            <div
              className="velocity-strip"
              style={{ width, ["--track" as string]: track.colour }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                const base = s().history.present;
                drag.current = { kind: "velocity", base, moved: true };
                s().dragStart();
                velocityAt(e, base);
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (d?.kind === "velocity") velocityAt(e, d.base);
              }}
              onPointerUp={() => {
                if (drag.current?.kind === "velocity") s().dragEnd();
                drag.current = null;
              }}
              onPointerCancel={() => {
                if (drag.current?.kind === "velocity") s().dragEnd();
                drag.current = null;
              }}
            >
              {clip.notes.map((n) => (
                <span key={n.id} className={`velocity-bar${selectedNoteIds.includes(n.id) ? " selected" : ""}`} style={{ left: n.start * ppb, height: 4 + (n.velocity / 127) * (VELOCITY_H - 10) }} />
              ))}
            </div>
          </div>
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Arrow keys in the editor: nudge the selected notes. Returns true if it did something. */
export function nudgeNotes(key: string, shift: boolean): boolean {
  const s = useStore.getState();
  const clip = midiClip(s.history.present, s.editingClipId);
  if (!clip || !s.selectedNoteIds.length || s.bottomPanel !== "editor") return false;
  const ids = s.selectedNoteIds;
  if (key === "ArrowUp" || key === "ArrowDown") {
    s.transpose((key === "ArrowUp" ? 1 : -1) * (shift ? 12 : 1));
    return true;
  }
  const step = noteStep(s.snap) * (key === "ArrowLeft" ? -1 : 1);
  const picked = clip.notes.filter((n) => ids.includes(n.id));
  const by = Math.max(step, -Math.min(...picked.map((n) => n.start)));
  if (!by) return true;
  s.updateNotes(
    clip.id,
    picked.map((n) => ({ id: n.id, patch: { start: n.start + by } })),
  );
  return true;
}
