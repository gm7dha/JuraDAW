/**
 * A slider whose whole drag is one undo step: the store is told when the drag
 * starts and ends, and handed the changed song as it goes. (Arrow keys on the
 * slider make one step each.)
 */
import { useRef } from "react";

import { useStore } from "../model/store";
import type { Song } from "../model/types";

interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  title?: string;
  className?: string;
  vertical?: boolean;
  /** The song with this slider's value changed. */
  make: (song: Song, value: number) => Song;
  /** Double-click puts this value back. */
  usual?: number;
}

export function Slider({ value, min = 0, max = 1, step = 0.01, label, title, className, vertical, make, usual }: SliderProps) {
  const base = useRef<Song | null>(null);
  const end = () => {
    if (!base.current) return;
    base.current = null;
    useStore.getState().dragEnd();
  };
  return (
    <input
      type="range"
      className={`slider${vertical ? " vertical" : ""}${className ? ` ${className}` : ""}`}
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      title={title ?? label}
      onPointerDown={() => {
        const s = useStore.getState();
        base.current = s.history.present;
        s.dragStart();
      }}
      onPointerUp={(e) => {
        end();
        // Let go of the focus, so Space plays rather than nudging the slider.
        e.currentTarget.blur();
      }}
      onPointerCancel={end}
      onBlur={end}
      onChange={(e) => {
        const v = Number(e.target.value);
        const s = useStore.getState();
        if (base.current) s.dragUpdate(make(base.current, v));
        else s.commit(make(s.history.present, v));
      }}
      onDoubleClick={() => {
        if (usual === undefined) return;
        end();
        const s = useStore.getState();
        s.commit(make(s.history.present, usual));
      }}
    />
  );
}
