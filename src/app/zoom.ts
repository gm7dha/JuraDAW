/**
 * Zooming a scrolling timeline towards the pointer: Ctrl/⌘ + wheel (which is
 * also what a trackpad pinch sends) and two-finger pinch on a touch screen.
 * Shared by the tracks view and the note editor.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

interface ZoomOptions {
  /** The scrolling element. */
  scroll: RefObject<HTMLElement | null>;
  /** Pixels per beat now. */
  ppb: number;
  setPpb: (ppb: number) => void;
  /** Width of the fixed column on the left (track headers, piano keys). */
  left: number;
  min: number;
  max: number;
}

/** Wires the zoom gestures up; returns `zoomBy` for buttons (zooms about the middle of the view). */
export function useZoom({ scroll, ppb, setPpb, left, min, max }: ZoomOptions): (factor: number) => void {
  const now = useRef(ppb);
  now.current = ppb;
  /** After the zoom is drawn, scroll so this beat is back under the pointer. */
  const pending = useRef<{ beat: number; px: number } | null>(null);

  const zoomAt = useCallback(
    (factor: number, clientX: number | null) => {
      const el = scroll.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const px = clientX === null ? left + (rect.width - left) / 2 : clientX - rect.left;
      const next = Math.max(min, Math.min(max, now.current * factor));
      if (next === now.current) return;
      pending.current = { beat: (el.scrollLeft + px - left) / now.current, px: px - left };
      now.current = next;
      setPpb(next);
    },
    [scroll, setPpb, left, min, max],
  );

  useLayoutEffect(() => {
    const p = pending.current;
    const el = scroll.current;
    if (!p || !el) return;
    pending.current = null;
    el.scrollLeft = Math.max(0, p.beat * ppb - p.px);
  }, [ppb, scroll]);

  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    // Wheel turns arrive faster than the screen is drawn: they're added up and the view zoomed once a frame.
    let turned = 0;
    let at = 0;
    let frame = 0;
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      turned += e.deltaY;
      at = e.clientX;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const factor = Math.exp(-turned * 0.004);
        turned = 0;
        zoomAt(factor, at);
      });
    };
    let pinch: { distance: number } | null = null;
    const spread = (e: TouchEvent) => Math.abs(e.touches[0].clientX - e.touches[1].clientX) + 1;
    const touchStart = (e: TouchEvent) => {
      pinch = e.touches.length === 2 ? { distance: spread(e) } : null;
    };
    const touchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const d = spread(e);
      zoomAt(d / pinch.distance, (e.touches[0].clientX + e.touches[1].clientX) / 2);
      pinch.distance = d;
    };
    const touchEnd = () => {
      pinch = null;
    };
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("touchstart", touchStart, { passive: true });
    el.addEventListener("touchmove", touchMove, { passive: false });
    el.addEventListener("touchend", touchEnd);
    el.addEventListener("touchcancel", touchEnd);
    return () => {
      el.removeEventListener("wheel", wheel);
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("touchstart", touchStart);
      el.removeEventListener("touchmove", touchMove);
      el.removeEventListener("touchend", touchEnd);
      el.removeEventListener("touchcancel", touchEnd);
    };
  }, [scroll, zoomAt]);

  return useCallback((factor: number) => zoomAt(factor, null), [zoomAt]);
}

/** The grid lines worth drawing at a zoom: how many beats apart the faint lines and the strong lines are, and which bars get a number. */
export function gridFor(ppb: number, beatsPerBar: number): { fine: number; strong: number; labelEvery: number } {
  const bar = ppb * beatsPerBar;
  // Bars to skip so numbers don't run into each other.
  let labelEvery = 1;
  while (bar * labelEvery < 34) labelEvery *= 2;
  let strong = beatsPerBar;
  while (strong * ppb < 14) strong *= 2;
  let fine = strong;
  if (bar >= 14) {
    fine = 1;
    if (ppb < 9) fine = beatsPerBar;
    else if (ppb >= 72) fine = 0.25;
    else if (ppb >= 36) fine = 0.5;
  }
  return { fine, strong, labelEvery };
}

/**
 * The stretch of the timeline worth drawing clips for: what shows in a view scrolled to `scrollLeft` (`viewWidth`
 * pixels wide, `left` of them taken by the fixed column), with half a view to spare each side — in steps of half a
 * view, so it only changes now and then while scrolling, not on every pixel.
 */
export function visibleBeats(scrollLeft: number, viewWidth: number, ppb: number, left: number): { from: number; to: number } {
  const across = Math.max(1, viewWidth - left) / ppb;
  const step = Math.max(across / 2, 1e-6);
  const first = Math.max(0, scrollLeft) / ppb;
  return { from: Math.max(0, (Math.floor(first / step) - 1) * step), to: (Math.ceil((first + across) / step) + 1) * step };
}
