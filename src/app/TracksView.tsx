/**
 * The tracks view (Logic's "tracks area"): track headers down the left and,
 * to their right, the timeline — a bar ruler with the yellow loop strip along
 * its top, a grid of bars and beats, and the clips as rounded blocks in their
 * track's colour. The playhead is moved every animation frame straight from
 * the engine, never through React state.
 *
 * Everything scrolls in one box: the headers stick to the left edge and the
 * ruler to the top, so they always line up with the lanes.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { useStore } from "../model/store";
import type { Clip, Song, Track } from "../model/types";
import { addTrackOf, NEW_TRACKS } from "./addTracks";
import { ContextMenu, type MenuEntry } from "./ContextMenu";
import { useEdgeScroll, type PointerPlace } from "./edgeScroll";
import { everyFrame, peaksOf, playheadBeat, seek, useAudioVersion } from "./engineApp";
import { Icons } from "./icons";
import { MenuButton } from "./MenuButton";
import { barBeat, clipBeats, clipsOverOthers, loopDragged, loopGrab, roomFor, snapped, snapStep, songBeats, uid, withClipEnd, withClipsMoved, withClipStart, type LoopGrab } from "./songUi";
import { TrackHeader } from "./TrackHeader";
import { Welcome } from "./Welcome";
import { gridFor, useZoom, visibleBeats } from "./zoom";

/** Width of the track headers, height of the ruler and of a track's row, in pixels. */
export const HEADER_W = 212;
const RULER_H = 40;
const LOOP_H = 18;
const ROW_H = 72;
const MIN_PPB = 2;
const MAX_PPB = 240;

type Menu = { x: number; y: number; entries: MenuEntry[] } | null;

type Drag =
  | { kind: "move"; id: string; ids: string[]; base: Song; beat0: number; row0: number; x0: number; y0: number; anchor: number; moved: boolean; copies: Map<string, string> | null; wasSelected: boolean; toggle: boolean }
  | { kind: "end"; id: string; base: Song; beat0: number; length0: number; x0: number; moved: boolean; maxSeconds?: number }
  | { kind: "start"; id: string; base: Song; beat0: number; x0: number; moved: boolean }
  | { kind: "band"; x0: number; y0: number; keep: string[]; moved: boolean; row: number }
  | { kind: "draw"; trackId: string; row: number; beat0: number; moved: boolean; x0: number }
  | { kind: "loop"; grab: LoopGrab; loop0: { start: number; end: number }; beat0: number; x0: number; moved: boolean }
  | { kind: "seek" };

/** The tracks, or the welcome while the song has none. */
export function TracksView() {
  const empty = useStore((s) => s.history.present.tracks.length === 0);
  return empty ? <Welcome /> : <Timeline />;
}

function Timeline() {
  const song = useStore((s) => s.history.present);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const selectedClipIds = useStore((s) => s.selectedClipIds);
  const editingClipId = useStore((s) => s.editingClipId);
  const tool = useStore((s) => s.tool);
  const fitRequest = useStore((s) => s.fitRequest);
  const recording = useStore((s) => s.recording);
  const audioVersion = useAudioVersion();

  const scroll = useRef<HTMLDivElement>(null);
  const lanes = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const playheadTop = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const [ppb, setPpb] = useState(24);
  const [viewW, setViewW] = useState(1000);
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [ghost, setGhost] = useState<{ row: number; start: number; length: number } | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** The clip whose name is being typed on the clip itself (from its right-click menu). */
  const [renamingClip, setRenamingClip] = useState<string | null>(null);

  const zoomBy = useZoom({ scroll, ppb, setPpb, left: HEADER_W, min: MIN_PPB, max: MAX_PPB });
  const ppbRef = useRef(ppb);
  ppbRef.current = ppb;

  const beatsPerBar = song.beatsPerBar;
  const end = songBeats(song);
  // Room to grow: a good stretch past the last clip, and never less than the window.
  const totalBeats = Math.ceil(Math.max(end + 16 * beatsPerBar, 32 * beatsPerBar, song.loop.end + 4 * beatsPerBar, (viewW - HEADER_W) / ppb + beatsPerBar) / beatsPerBar) * beatsPerBar;
  const width = totalBeats * ppb;
  const grid = gridFor(ppb, beatsPerBar);
  const anySolo = song.tracks.some((t) => t.solo);
  const rowOf = useMemo(() => new Map(song.tracks.map((t, i) => [t.id, i])), [song.tracks]);
  const selectedSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);

  // Only the clips near what's showing are drawn (a long song has thousands): the stretch is worked out again as the view scrolls.
  const [scrolled, setScrolled] = useState(0);
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setScrolled(el.scrollLeft);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  const shown = visibleBeats(scrolled, viewW, ppb, HEADER_W);
  const showFrom = shown.from;
  const showTo = shown.to;
  const visible = useMemo(
    () => song.clips.filter((c) => (c.start < showTo && c.start + clipBeats(c, song.bpm) > showFrom) || selectedSet.has(c.id)),
    [song.clips, song.bpm, showFrom, showTo, selectedSet],
  );
  /** Clips lying over an earlier clip of their track: drawn a little lower, so the one underneath can still be seen and picked. */
  const stacked = useMemo(() => clipsOverOthers(song), [song.clips, song.bpm]); // eslint-disable-line react-hooks/exhaustive-deps

  // The view's width, to know how much timeline fills it.
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const measure = () => setViewW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit: zoom so the whole song shows.
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el || fitRequest === 0) return;
    const s = useStore.getState().history.present;
    const beats = Math.max(songBeats(s), 4 * s.beatsPerBar) + s.beatsPerBar;
    setPpb(Math.max(MIN_PPB, Math.min(MAX_PPB, (el.clientWidth - HEADER_W - 24) / beats)));
    el.scrollLeft = 0;
  }, [fitRequest]);

  // The playhead: moved every frame; the view follows it while the song plays.
  useEffect(() => {
    let last = -1;
    return everyFrame(() => {
      const beat = playheadBeat();
      const x = beat * ppbRef.current;
      if (x !== last) {
        last = x;
        if (playhead.current) playhead.current.style.transform = `translateX(${x}px)`;
        if (playheadTop.current) playheadTop.current.style.transform = `translateX(${x}px)`;
      }
      const s = useStore.getState();
      const el = scroll.current;
      if (el && (s.playing || s.recording) && !drag.current) {
        const left = el.scrollLeft;
        const room = el.clientWidth - HEADER_W;
        if (x < left || x > left + room - 24) el.scrollLeft = Math.max(0, x - 48);
      }
    });
  }, []);

  /** The pointer's place over the lanes: beat, row and pixels. */
  const place = useCallback((e: { clientX: number; clientY: number }) => {
    const r = lanes.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return { x, y, beat: Math.max(0, x / ppbRef.current), row: Math.floor(y / ROW_H) };
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  // A drag carried to the edge of what's showing scrolls the view along (the drag catches up through its own move handler).
  const follow = useEdgeScroll({
    scroll,
    left: HEADER_W,
    top: RULER_H,
    dragging: () => {
      const d = drag.current;
      return !!d && d.kind !== "seek" && d.moved;
    },
    sideways: () => drag.current?.kind === "loop",
    moved: (p) => (drag.current?.kind === "loop" ? rulerMove(p) : lanesMove(p)),
  });

  /** The clip under the pointer. (Not from the event's target: while a press is captured, the lanes are the target of the clicks that follow.) */
  const clipAt = (e: { clientX: number; clientY: number }, song: Song): Clip | undefined => {
    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-clip]");
    return el ? song.clips.find((c) => c.id === el.dataset.clip) : undefined;
  };

  // ── the ruler: the loop strip along the top, the play position below ──

  const rulerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const beat = Math.max(0, (e.clientX - r.left) / ppb);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.clientY - r.top < LOOP_H) {
      // While the loop is on (lit): an end of it is stretched, its middle slides it along. Anywhere else — or while it's off — a new one is drawn.
      const loop = useStore.getState().history.present.loop;
      drag.current = { kind: "loop", grab: loop.on ? loopGrab(e.clientX - r.left, loop, ppb) : "new", loop0: { start: loop.start, end: loop.end }, beat0: beat, x0: e.clientX, moved: false };
    } else {
      drag.current = { kind: "seek" };
      seek(snapped(beat, useStore.getState().snap, beatsPerBar, { free: e.shiftKey }));
    }
  };
  const rulerMove = (e: PointerPlace) => {
    const d = drag.current;
    if (!d || !ruler.current || (d.kind !== "loop" && d.kind !== "seek")) return;
    const r = ruler.current.getBoundingClientRect();
    const beat = Math.max(0, (e.clientX - r.left) / ppb);
    const s = useStore.getState();
    if (d.kind === "seek") {
      seek(snapped(beat, s.snap, beatsPerBar, { free: e.shiftKey }));
      return;
    }
    if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
    d.moved = true;
    // The loop takes whole bars, so it repeats in time (Shift: the snap grid instead, at least a beat).
    const loopSnap = !e.shiftKey ? "bar" : s.snap === 0 || s.snap === "bar" ? 1 : s.snap;
    s.setLoop({ ...loopDragged(d.grab, d.loop0, d.beat0, beat, Math.max(1, snapStep(loopSnap, beatsPerBar))), on: true });
  };
  const rulerUp = () => {
    const d = drag.current;
    drag.current = null;
    follow(null);
    if (d?.kind === "loop" && !d.moved) {
      const s = useStore.getState();
      s.setLoop({ on: !s.history.present.loop.on });
    }
  };

  // ── the lanes: clips, drawing, the rubber band ──

  const lanesDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const s = useStore.getState();
    const now = s.history.present;
    const p = place(e);
    const track: Track | undefined = now.tracks[p.row];
    const target = e.target as HTMLElement;
    const clipEl = target.closest<HTMLElement>("[data-clip]");
    const clip = clipEl ? now.clips.find((c) => c.id === clipEl.dataset.clip) : undefined;
    setMenu(null);

    if (clip) {
      s.selectTrack(clip.trackId);
      if (s.tool === "eraser") {
        s.removeClips([clip.id]);
        return;
      }
      if (s.tool === "scissors") {
        const at = snapped(p.beat, s.snap, now.beatsPerBar, { free: e.shiftKey });
        const length = clipBeats(clip, now.bpm);
        if (at > clip.start + 1e-6 && at < clip.start + length - 1e-6) s.splitClip(clip.id, at);
        else s.toast("Click inside the clip, away from its ends, to split it there.", "info");
        return;
      }
      const wasSelected = s.selectedClipIds.includes(clip.id);
      const toggle = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!wasSelected) s.selectClips(toggle ? [...s.selectedClipIds, clip.id] : [clip.id]);
      const ids = wasSelected ? s.selectedClipIds : toggle ? [...s.selectedClipIds, clip.id] : [clip.id];
      e.currentTarget.setPointerCapture(e.pointerId);
      const edge = target.dataset.edge;
      if (edge === "end") {
        const info = clip.kind === "audio" ? now.audio.find((a) => a.id === clip.audioId) : undefined;
        drag.current = { kind: "end", id: clip.id, base: now, beat0: p.beat, length0: clipBeats(clip, now.bpm), x0: e.clientX, moved: false, maxSeconds: info?.seconds };
      } else if (edge === "start") {
        drag.current = { kind: "start", id: clip.id, base: now, beat0: p.beat, x0: e.clientX, moved: false };
      } else {
        drag.current = { kind: "move", id: clip.id, ids, base: now, beat0: p.beat, row0: p.row, x0: e.clientX, y0: e.clientY, anchor: clip.start, moved: false, copies: e.altKey ? new Map() : null, wasSelected, toggle };
      }
      return;
    }

    // An empty part of a lane.
    if (track) s.selectTrack(track.id);
    if (e.pointerType === "touch") {
      // A finger on empty space scrolls; a tap clears the selection.
      if (s.selectedClipIds.length) s.selectClips([]);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (s.tool === "pencil" && track) {
      if (track.kind !== "instrument") {
        s.toast("Sound tracks hold recordings: press Record (R), or use Import to bring in a sound file.", "info");
        return;
      }
      drag.current = { kind: "draw", trackId: track.id, row: p.row, beat0: snapped(p.beat, s.snap, now.beatsPerBar, { free: e.shiftKey, down: true }), moved: false, x0: e.clientX };
      return;
    }
    const keep = e.shiftKey || e.ctrlKey || e.metaKey ? s.selectedClipIds : [];
    drag.current = { kind: "band", x0: p.x, y0: p.y, keep, moved: false, row: p.row };
  };

  const lanesMove = (e: PointerPlace) => {
    const d = drag.current;
    if (!d) return;
    const s = useStore.getState();
    const p = place(e);
    const free = e.shiftKey;
    if (d.kind === "move") {
      if (!d.moved) {
        if (Math.abs(e.clientX - d.x0) < 4 && Math.abs(e.clientY - d.y0) < 4) return;
        d.moved = true;
        s.dragStart();
        if (d.copies) for (const id of d.ids) d.copies.set(id, uid("c"));
      }
      const to = snapped(d.anchor + (p.beat - d.beat0), s.snap, d.base.beatsPerBar, { free });
      const rows = Math.max(0, Math.min(d.base.tracks.length - 1, p.row)) - d.row0;
      s.dragUpdate(withClipsMoved(d.base, d.ids, to - d.anchor, rows, d.copies ?? undefined));
    } else if (d.kind === "end") {
      if (!d.moved) {
        if (Math.abs(e.clientX - d.x0) < 3) return;
        d.moved = true;
        s.dragStart();
      }
      const clip = d.base.clips.find((c) => c.id === d.id);
      if (!clip) return;
      const endAt = snapped(clip.start + d.length0 + (p.beat - d.beat0), s.snap, d.base.beatsPerBar, { free });
      const least = snapStep(s.snap, d.base.beatsPerBar) || 0.25;
      s.dragUpdate(withClipEnd(d.base, d.id, Math.max(free ? 0.0625 : Math.min(least, d.length0), endAt - clip.start), d.maxSeconds));
    } else if (d.kind === "start") {
      if (!d.moved) {
        if (Math.abs(e.clientX - d.x0) < 3) return;
        d.moved = true;
        s.dragStart();
      }
      const clip = d.base.clips.find((c) => c.id === d.id);
      if (!clip) return;
      const startAt = snapped(clip.start + (p.beat - d.beat0), s.snap, d.base.beatsPerBar, { free });
      s.dragUpdate(withClipStart(d.base, d.id, startAt - clip.start));
    } else if (d.kind === "band") {
      if (!d.moved && Math.abs(p.x - d.x0) < 4 && Math.abs(p.y - d.y0) < 4) return;
      d.moved = true;
      const box = { x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) };
      setBand(box);
      const now = s.history.present;
      const inside = now.clips
        .filter((c) => {
          const row = now.tracks.findIndex((t) => t.id === c.trackId);
          const x1 = c.start * ppbRef.current;
          const x2 = x1 + clipBeats(c, now.bpm) * ppbRef.current;
          return x2 > box.x && x1 < box.x + box.w && (row + 1) * ROW_H > box.y && row * ROW_H < box.y + box.h;
        })
        .map((c) => c.id);
      const ids = [...new Set([...d.keep, ...inside])];
      if (ids.join() !== s.selectedClipIds.join()) s.selectClips(ids);
    } else if (d.kind === "draw") {
      if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
      d.moved = true;
      const now = s.history.present;
      const step = snapStep(s.snap, now.beatsPerBar) || 0.25;
      const to = Math.max(d.beat0 + step, snapped(p.beat, s.snap, now.beatsPerBar, { free }));
      setGhost({ row: d.row, start: d.beat0, length: to - d.beat0 });
    }
  };

  const lanesUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    follow(null);
    if (!d) return;
    const s = useStore.getState();
    if (d.kind === "move") {
      if (d.moved) {
        s.dragEnd();
        // The copies are what's selected after an Alt-drag.
        if (d.copies) s.selectClips([...d.copies.values()]);
        const moved = s.history.present.clips.find((c) => c.id === (d.copies?.get(d.id) ?? d.id));
        if (moved) s.selectTrack(moved.trackId);
        // Dropped on a track that can't take it: it stayed on its own, so say why.
        const onto = s.history.present.tracks[place(e).row];
        if (moved && onto && onto.id !== moved.trackId && (onto.kind === "instrument") !== (moved.kind === "midi"))
          s.toast(moved.kind === "midi" ? "Clips of notes can't go on a sound track, so it stayed on its own track." : "Recordings can't go on an instrument track, so it stayed on its own track.", "info");
      } else if (d.toggle && d.wasSelected) {
        s.selectClips(s.selectedClipIds.filter((id) => id !== d.id));
      } else if (!d.toggle && s.selectedClipIds.length > 1) {
        s.selectClips([d.id]);
      }
    } else if (d.kind === "end" || d.kind === "start") {
      if (d.moved) s.dragEnd();
    } else if (d.kind === "band") {
      setBand(null);
      if (!d.moved && !d.keep.length && s.selectedClipIds.length) s.selectClips([]);
    } else if (d.kind === "draw") {
      const g = ghost;
      setGhost(null);
      const now = s.history.present;
      if (d.moved && g) s.addMidiClip(d.trackId, g.start, g.length);
      else if (!e.shiftKey) s.addMidiClip(d.trackId, snapped(d.beat0, "bar", now.beatsPerBar, { down: true }), roomFor(now, d.trackId, snapped(d.beat0, "bar", now.beatsPerBar, { down: true }), 4 * now.beatsPerBar, now.beatsPerBar));
    }
  };

  const lanesCancel = () => {
    const d = drag.current;
    drag.current = null;
    follow(null);
    setBand(null);
    setGhost(null);
    if (d && "moved" in d && d.moved && (d.kind === "move" || d.kind === "end" || d.kind === "start")) useStore.getState().dragEnd();
  };

  const lanesDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const s = useStore.getState();
    if (s.tool === "eraser" || s.tool === "scissors") return;
    const now = s.history.present;
    const clip = clipAt(e, now);
    if (clip) {
      if (clip.kind === "midi") s.editClip(clip.id);
      else s.toast("Recordings can't be opened as notes. Drag the clip's edges to trim it, or use its settings in the panel on the left.", "info");
      return;
    }
    if (s.tool === "pencil") return; // the Pencil already made one on the click
    const p = place(e);
    const track = now.tracks[p.row];
    if (!track) return;
    if (track.kind !== "instrument") {
      s.toast("Sound tracks hold recordings: press Record (R), or use Import to bring in a sound file.", "info");
      return;
    }
    const start = snapped(p.beat, "bar", now.beatsPerBar, { down: true });
    s.addMidiClip(track.id, start, roomFor(now, track.id, start, 4 * now.beatsPerBar, now.beatsPerBar));
  };

  const lanesMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const s = useStore.getState();
    const now = s.history.present;
    const p = place(e);
    const clip = clipAt(e, now);
    const track = now.tracks[p.row];
    if (track) s.selectTrack(track.id);
    if (clip) {
      if (!s.selectedClipIds.includes(clip.id)) s.selectClips([clip.id]);
      setMenu({ x: e.clientX, y: e.clientY, entries: clipMenu(clip, () => setRenamingClip(clip.id)) });
      return;
    }
    const start = snapped(p.beat, "bar", now.beatsPerBar, { down: true });
    setMenu({
      x: e.clientX,
      y: e.clientY,
      entries: [
        { label: "New clip of notes here", act: () => s.addMidiClip(track!.id, start, roomFor(now, track!.id, start, 4 * now.beatsPerBar, now.beatsPerBar)), off: !track || track.kind !== "instrument" },
        { label: "Paste at the play position", hint: "Mod+V", act: () => useStore.getState().paste() },
        { label: "Select all", hint: "Mod+A", act: () => useStore.getState().selectAll(), off: !now.clips.length },
        "line",
        { label: "Put the play position here", act: () => seek(snapped(p.beat, s.snap, now.beatsPerBar)) },
        { label: "Fit the whole song", hint: "F", act: () => useStore.getState().requestFit() },
      ],
    });
  };

  const trackMenu = useCallback((trackId: string, x: number, y: number) => {
    const s = useStore.getState;
    const tracks = s().history.present.tracks;
    const index = tracks.findIndex((t) => t.id === trackId);
    setMenu({
      x,
      y,
      entries: [
        { label: "Rename", act: () => setRenaming(trackId) },
        { label: "Duplicate track", act: () => s().duplicateTrack(trackId) },
        "line",
        { label: "Move up", act: () => s().moveTrack(trackId, -1), off: index <= 0 },
        { label: "Move down", act: () => s().moveTrack(trackId, 1), off: index >= tracks.length - 1 },
        "line",
        { label: "Delete track", act: () => s().removeTrack(trackId) },
      ],
    });
  }, []);

  // ── what's drawn ──

  const bars = useMemo(() => {
    const out: { bar: number; x: number }[] = [];
    const count = Math.ceil(totalBeats / beatsPerBar);
    for (let b = 0; b < count; b += grid.labelEvery) out.push({ bar: b + 1, x: b * beatsPerBar * ppb });
    return out;
  }, [totalBeats, beatsPerBar, ppb, grid.labelEvery]);

  const gridStyle = {
    width,
    ["--fine" as string]: `${grid.fine * ppb}px`,
    ["--strong" as string]: `${grid.strong * ppb}px`,
    // Clips place themselves from this (pixels a beat), so zooming moves them without each one being drawn again.
    ["--ppb" as string]: ppb,
  };
  // Pictures in clips (their notes or waveform) are left out while clips are slivers, and while a great many show at once.
  const pictureFrom = visible.length > 400 ? 72 : 24;

  return (
    <div className={`tracks-view tool-${tool}`} ref={scroll} onContextMenu={(e) => e.preventDefault()}>
      <div className="tracks-content" style={{ width: HEADER_W + width }}>
        <div className="ruler-row" style={{ height: RULER_H }}>
          <div className="ruler-corner" style={{ width: HEADER_W }}>
            <span className="ruler-corner-label">
              Tracks <span className="count">{song.tracks.length}</span>
            </span>
            <button type="button" className="icon-button small" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out" title="Zoom out (Ctrl/⌘ + scroll wheel, or pinch)">
              <span className="zoom-sign">−</span>
            </button>
            <button type="button" className="icon-button small" onClick={() => zoomBy(1.4)} aria-label="Zoom in" title="Zoom in (Ctrl/⌘ + scroll wheel, or pinch)">
              <span className="zoom-sign">+</span>
            </button>
          </div>
          <div
            className="ruler"
            ref={ruler}
            style={{ width }}
            onPointerDown={rulerDown}
            onPointerMove={(e) => {
              rulerMove(e);
              if (drag.current?.kind === "loop") follow(e);
            }}
            onPointerUp={rulerUp}
            onPointerCancel={rulerUp}
            aria-label="Bar ruler: click to choose where playing starts"
          >
            <div className="loop-lane" style={{ height: LOOP_H }} title="Drag across here to choose the bars that repeat; click to turn the loop on or off (L)" />
            <div
              className={`loop-strip${song.loop.on ? " on" : ""}`}
              style={{ left: song.loop.start * ppb, width: Math.max(2, (song.loop.end - song.loop.start) * ppb), height: LOOP_H }}
              title={`Loop: bar ${barBeat(song.loop.start, beatsPerBar).text} to ${barBeat(song.loop.end, beatsPerBar).text} — ${song.loop.on ? "on" : "off"}. Click to turn it ${song.loop.on ? "off" : "on"}; ${song.loop.on ? "drag an end to stretch it, the middle to slide it along, or drag elsewhere on this strip to choose another part" : "drag across this strip to choose another part"}`}
            >
              {song.loop.on && (
                <>
                  <span className="loop-end start" />
                  <span className="loop-end end" />
                </>
              )}
            </div>
            {bars.map((b) => (
              <span key={b.bar} className="ruler-bar" style={{ left: b.x }}>
                {b.bar}
              </span>
            ))}
            <div className={`playhead-top${recording ? " recording" : ""}`} ref={playheadTop} />
          </div>
        </div>
        <div className="tracks-body">
          <div className="track-headers" style={{ width: HEADER_W }} role="rowgroup" aria-label="Tracks">
            {song.tracks.map((t) => (
              <div key={t.id} style={{ height: ROW_H }}>
                <TrackHeader track={t} selected={t.id === selectedTrackId} silenced={anySolo && !t.solo} renaming={renaming === t.id} setRenaming={setRenaming} onMenu={trackMenu} />
              </div>
            ))}
            <div className="track-add">
              <MenuButton
                className="text-button small-button"
                label="Add track"
                title="Add a track: an instrument, a drum kit, or a track for recorded sound"
                width={300}
                button={
                  <>
                    <Icons.Plus size={16} /> Add track
                  </>
                }
              >
                {(close) => (
                  <>
                    <div className="field-label">Add a track</div>
                    {NEW_TRACKS.map((t) => (
                      <button
                        key={t.kind}
                        type="button"
                        className="menu-choice"
                        onClick={() => {
                          addTrackOf(t.kind);
                          close();
                        }}
                      >
                        <b>{t.title}</b>
                        <span className="muted small">{t.text}</span>
                      </button>
                    ))}
                  </>
                )}
              </MenuButton>
            </div>
          </div>
          <div
            className="lanes"
            ref={lanes}
            style={gridStyle}
            onPointerDown={lanesDown}
            onPointerMove={(e) => {
              lanesMove(e);
              if (drag.current) follow(e);
            }}
            onPointerUp={lanesUp}
            onPointerCancel={lanesCancel}
            onDoubleClick={lanesDoubleClick}
            onContextMenu={lanesMenu}
          >
            {song.tracks.map((t, i) => (
              <div key={t.id} className={`lane${t.id === selectedTrackId ? " selected" : ""}`} style={{ top: i * ROW_H, height: ROW_H }} />
            ))}
            {visible.map((c) => {
              const row = rowOf.get(c.trackId);
              const track = row === undefined ? undefined : song.tracks[row];
              if (row === undefined || !track) return null;
              return (
                <ClipBlock
                  key={c.id}
                  clip={c}
                  colour={track.colour}
                  top={row * ROW_H}
                  start={c.start}
                  length={clipBeats(c, song.bpm)}
                  roomy={clipBeats(c, song.bpm) * ppb >= pictureFrom}
                  edges={clipBeats(c, song.bpm) * ppb > 18}
                  width={c.kind === "audio" ? clipBeats(c, song.bpm) * ppb : 0}
                  selected={selectedSet.has(c.id)}
                  over={stacked.has(c.id)}
                  editing={c.id === editingClipId}
                  quiet={track.mute || (anySolo && !track.solo)}
                  audioVersion={c.kind === "audio" ? audioVersion : 0}
                  renaming={c.id === renamingClip}
                  setRenaming={setRenamingClip}
                />
              );
            })}
            {ghost && <div className="clip ghost" style={{ top: ghost.row * ROW_H + 4, height: ROW_H - 9, left: ghost.start * ppb, width: ghost.length * ppb }} />}
            {band && <div className="rubber-band" style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />}
            <div className={`playhead${recording ? " recording" : ""}`} ref={playhead} />
          </div>
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={closeMenu} />}
    </div>
  );
}

/** How far down (pixels) a clip that lies over another is drawn. */
const OVER_BY = 17;

/** The right-click menu for the selected clips (the one clicked is among them). `rename` starts typing a new name on the clip itself. */
function clipMenu(clip: Clip, rename: () => void): MenuEntry[] {
  const s = useStore.getState;
  const selected = () => s().history.present.clips.filter((c) => s().selectedClipIds.includes(c.id));
  const picked = selected();
  const midi = picked.filter((c) => c.kind === "midi");
  const joinable = midi.length >= 2 && midi.length === picked.length && midi.every((c) => c.trackId === midi[0].trackId);
  const at = s().playing ? playheadBeat() : s().cursor;
  const song = s().history.present;
  const splittable = picked.some((c) => at > c.start + 1e-6 && at < c.start + clipBeats(c, song.bpm) - 1e-6);
  return [
    ...(clip.kind === "midi" ? [{ label: "Edit notes", act: () => s().editClip(clip.id) } as MenuEntry] : []),
    { label: "Cut", hint: "Mod+X", act: () => s().cutSelected() },
    { label: "Copy", hint: "Mod+C", act: () => s().copySelected() },
    { label: "Paste", hint: "Mod+V", act: () => s().paste() },
    { label: "Duplicate", hint: "Mod+D", act: () => s().duplicateSelectedClips() },
    "line",
    { label: "Repeat ×2", act: () => s().repeatSelectedClips(1) },
    { label: "Repeat ×4", act: () => s().repeatSelectedClips(3) },
    "line",
    {
      label: "Split at the play position",
      act: () => {
        for (const c of selected()) s().splitClip(c.id, at);
      },
      off: !splittable,
    },
    { label: "Join", act: () => s().joinSelectedClips(), off: !joinable },
    { label: "Rename", act: rename },
    "line",
    { label: "Delete", hint: "Del", act: () => s().removeClips(s().selectedClipIds) },
  ];
}

interface ClipBlockProps {
  clip: Clip;
  colour: string;
  top: number;
  /** Where it starts and how long it is, in beats (drawn through the lanes' --ppb, pixels a beat). */
  start: number;
  length: number;
  /** Wide enough to show its notes or waveform. */
  roomy: boolean;
  /** Wide enough for its ends to be grabbed. */
  edges: boolean;
  /** Its width in pixels — only given for a sound clip, whose waveform is drawn to fit. */
  width: number;
  selected: boolean;
  editing: boolean;
  quiet: boolean;
  audioVersion: number;
  /** Its name is a text box just now (Rename in the right-click menu). */
  /** It lies over another clip of its track. */
  over: boolean;
  renaming: boolean;
  setRenaming: (id: string | null) => void;
}

/** A clip's name as a text box on the clip: Enter or clicking away keeps the new name, Esc leaves the old one. */
function ClipNameBox({ clip, done }: { clip: Clip; done: () => void }) {
  const [text, setText] = useState(clip.name);
  const finish = (keep: boolean) => {
    done();
    const name = text.trim();
    if (keep && name && name !== clip.name) useStore.getState().updateClip(clip.id, { name });
  };
  return (
    <input
      className="clip-name-box"
      autoFocus
      aria-label="Clip name"
      value={text}
      maxLength={60}
      spellCheck={false}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      // The clip underneath mustn't be dragged, opened or given its menu by what's done in the box.
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
    />
  );
}

/** A clip: a rounded block in its track's colour, with its name and a miniature of its notes or its waveform. */
const ClipBlock = memo(function ClipBlock({ clip, colour, top, start, length, roomy, edges, width, selected, editing, quiet, audioVersion, over, renaming, setRenaming }: ClipBlockProps) {
  return (
    <div
      className={`clip ${clip.kind}${selected ? " selected" : ""}${editing ? " editing" : ""}${quiet ? " quiet" : ""}${renaming ? " renaming" : ""}${over ? " over" : ""}`}
      data-clip={clip.id}
      style={{ top: top + 4 + (over ? OVER_BY : 0), height: ROW_H - 9 - (over ? OVER_BY : 0), left: `calc(var(--ppb) * ${start}px)`, width: `max(3px, calc(var(--ppb) * ${length}px))`, ["--track" as string]: colour }}
      title={`${clip.kind === "midi" ? `${clip.name} — double-click to edit its notes` : `${clip.name} — a recording; drag its edges to trim it`}${over ? ". It lies over another clip (both play): drag one of them aside" : ""}`}
    >
      {renaming ? <ClipNameBox clip={clip} done={() => setRenaming(null)} /> : <span className="clip-name">{clip.name}</span>}
      {roomy && <div className="clip-picture">{clip.kind === "midi" ? <NotesPicture clip={clip} /> : <WavePicture audioId={clip.audioId} offset={clip.offset} duration={clip.duration} reverse={!!clip.reverse} width={width} version={audioVersion} />}</div>}
      {edges && (
        <>
          <span className="clip-edge start" data-edge="start" />
          <span className="clip-edge end" data-edge="end" />
        </>
      )}
    </div>
  );
});

/** A midi clip's notes in miniature (drawn again only when the clip itself changes, not when it's moved or the view zooms). */
const NotesPicture = memo(function NotesPicture({ clip }: { clip: Extract<Clip, { kind: "midi" }> }) {
  const view = useMemo(() => {
    if (!clip.notes.length) return null;
    let lo = 127;
    let hi = 0;
    for (const n of clip.notes) {
      lo = Math.min(lo, n.pitch);
      hi = Math.max(hi, n.pitch);
    }
    // At least an octave, so a single note isn't a fat bar.
    const pad = Math.max(0, 12 - (hi - lo)) / 2;
    return { lo: lo - pad - 1, span: hi - lo + 2 * pad + 3 };
  }, [clip.notes]);
  // One path for all the notes (a little bar each), rather than an element a note: far less for the page to hold.
  const d = useMemo(() => {
    if (!view) return "";
    const least = clip.length / 400;
    let out = "";
    for (const n of clip.notes) {
      if (n.start >= clip.length) continue;
      const w = Math.max(least, Math.min(n.length, clip.length - n.start) * 0.94);
      out += `M${+n.start.toFixed(3)} ${view.span - (n.pitch - view.lo) - 1}h${+w.toFixed(3)}v1h${-+w.toFixed(3)}z`;
    }
    return out;
  }, [clip.notes, clip.length, view]);
  if (!view) return null;
  return (
    <svg className="clip-notes" viewBox={`0 0 ${clip.length} ${view.span}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} />
    </svg>
  );
});

/** An audio clip's waveform, from the engine's peaks (blank until the sound is loaded). */
function WavePicture({ audioId, offset, duration, reverse, width, version }: { audioId: string; offset: number; duration: number; reverse: boolean; width: number; version: number }) {
  const buckets = Math.max(8, Math.min(1200, Math.round(width / 2)));
  const path = useMemo(() => {
    const found = peaksOf(audioId, buckets, offset, offset + duration);
    if (!found) return null;
    // A clip played backwards is drawn backwards.
    const peaks = reverse ? found.slice().reverse() : found;
    let top = "";
    let bottom = "";
    for (let i = 0; i < peaks.length; i++) {
      const v = Math.max(0.01, Math.min(1, peaks[i]));
      top += `${i === 0 ? "M" : "L"}${i} ${(1 - v).toFixed(3)}`;
      bottom = `L${i} ${(1 + v).toFixed(3)}${bottom}`;
    }
    return `${top}${bottom}Z`;
    // `version` is here so the picture is drawn again once the sound has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioId, buckets, offset, duration, reverse, version]);
  if (!path) return <span className="clip-loading muted small">…</span>;
  return (
    <svg className="clip-wave" viewBox={`0 0 ${buckets - 1} 2`} preserveAspectRatio="none" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
