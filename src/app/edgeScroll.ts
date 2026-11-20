/**
 * Scrolling a timeline by itself while something is dragged to its edge: a
 * clip or note carried past what's showing, or a rubber band stretched out of
 * view. Shared by the tracks view and the note editor.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";

/** Where the pointer is, and whether Shift is held (what the drag handlers read from an event). */
export interface PointerPlace {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
}

/** How close to an edge (pixels) the pointer has to be for the view to start moving. */
export const EDGE_ZONE = 28;
/** The fastest it scrolls, in pixels per frame (at 60 frames a second). */
export const EDGE_MOST = 22;

/**
 * How fast to scroll for a pointer at `at` in a view from `lo` to `hi` (all in pixels along one direction):
 * negative towards `lo`, positive towards `hi`, 0 away from the edges. It speeds up the nearer the edge the
 * pointer is, and on past it, up to `most`. A view too small to have a middle doesn't scroll.
 */
export function edgeSpeed(at: number, lo: number, hi: number, zone = EDGE_ZONE, most = EDGE_MOST): number {
  if (!(hi - lo >= zone * 3)) return 0;
  const share = (depth: number) => most * Math.min(1, depth / (zone * 2));
  if (at < lo + zone) return -share(lo + zone - at);
  if (at > hi - zone) return share(at - (hi - zone));
  return 0;
}

interface EdgeScrollOptions {
  /** The scrolling element. */
  scroll: RefObject<HTMLElement | null>;
  /** What sticks to the view's left, top and bottom (track headers, the ruler…), which the edges are measured inside of. */
  left: number;
  top: number;
  bottom?: number;
  /** True while a drag is really under way (the pointer has moved, not just pressed). */
  dragging: () => boolean;
  /** True for a drag that only goes sideways (the loop strip in the ruler), so the view isn't scrolled up or down. */
  sideways?: () => boolean;
  /** Called after the view scrolled, with the pointer where it still is, so the drag catches up. */
  moved: (pointer: PointerPlace) => void;
}

/**
 * Returns `follow`: call it with every pointer move of a drag, and with null when the drag ends. While the
 * pointer rests near an edge the view scrolls on each frame and `moved` is told.
 */
export function useEdgeScroll({ scroll, left, top, bottom = 0, dragging, sideways, moved }: EdgeScrollOptions): (pointer: PointerPlace | null) => void {
  const pointer = useRef<PointerPlace | null>(null);
  const frame = useRef(0);
  // The latest of what the caller passed, without starting the frames again.
  const latest = useRef({ left, top, bottom, dragging, sideways, moved });
  latest.current = { left, top, bottom, dragging, sideways, moved };

  const stop = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
  }, []);

  const follow = useCallback(
    (next: PointerPlace | null) => {
      // A plain copy: the event itself isn't kept.
      pointer.current = next ? { clientX: next.clientX, clientY: next.clientY, shiftKey: next.shiftKey } : null;
      if (!next) {
        stop();
        return;
      }
      if (frame.current) return;
      let before = performance.now();
      const tick = (now: number) => {
        const p = pointer.current;
        const el = scroll.current;
        const o = latest.current;
        if (!p || !el) {
          frame.current = 0;
          return;
        }
        frame.current = requestAnimationFrame(tick);
        // Frames come at the screen's own rate; the speed is per sixtieth of a second.
        const frames = Math.max(0.25, Math.min(3, (now - before) / (1000 / 60)));
        before = now;
        if (!o.dragging()) return;
        const r = el.getBoundingClientRect();
        // At least a whole pixel, or a slow scroll would be rounded away to nothing.
        const whole = (v: number) => (v ? Math.sign(v) * Math.max(1, Math.abs(v)) : 0);
        const dx = whole(edgeSpeed(p.clientX, r.left + o.left, r.right) * frames);
        const dy = o.sideways?.() ? 0 : whole(edgeSpeed(p.clientY, r.top + o.top, r.bottom - o.bottom) * frames);
        if (!dx && !dy) return;
        const x0 = el.scrollLeft;
        const y0 = el.scrollTop;
        if (dx) el.scrollLeft = x0 + dx;
        if (dy) el.scrollTop = y0 + dy;
        if (el.scrollLeft !== x0 || el.scrollTop !== y0) o.moved(p);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [scroll, stop],
  );

  useEffect(() => stop, [stop]);
  return follow;
}
