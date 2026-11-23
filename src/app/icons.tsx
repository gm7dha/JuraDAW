/**
 * JuraDAW's icons: small line drawings in the same style as JuraCUT's
 * (24 × 24, 1.7 px strokes, the colour of the text round them).
 */
import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Icons = {
  Import: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3v10M8 9.5l4 4 4-4" />
      <path d="M4 14.5v4A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-4" />
    </Svg>
  ),
  Undo: (p: IconProps) => (
    <Svg {...p}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Svg>
  ),
  Redo: (p: IconProps) => (
    <Svg {...p}>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </Svg>
  ),
  History: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </Svg>
  ),
  Export: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 17v3h16v-3" />
    </Svg>
  ),
  Help: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01" />
    </Svg>
  ),
  Duplicate: (p: IconProps) => (
    <Svg {...p}>
      <rect x="8" y="8" width="12" height="12" rx="1.5" />
      <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
      <path d="M14 11.5v5M11.5 14h5" />
    </Svg>
  ),
  Warning: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3 2 20h20z" />
      <path d="M12 10v4M12 17h.01" />
    </Svg>
  ),
  Tick: (p: IconProps) => (
    <Svg {...p}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  ),
  Cross: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  ),
  Plus: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  Settings: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </Svg>
  ),
  Fit: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </Svg>
  ),
  Select: (p: IconProps) => (
    <Svg {...p}>
      <path d="M5 3l14 8-6 1.5L10 19z" />
    </Svg>
  ),
  Trash: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </Svg>
  ),
  Open: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 6h6l2 2h10v11H3z" />
      <path d="M3 10h18" />
    </Svg>
  ),
  Save: (p: IconProps) => (
    <Svg {...p}>
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8 3v5h7V3M8 21v-7h8v7" />
    </Svg>
  ),
  New: (p: IconProps) => (
    <Svg {...p}>
      <path d="M14 3H6v18h12V7z" />
      <path d="M14 3v4h4M12 11v6M9 14h6" />
    </Svg>
  ),
  Up: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </Svg>
  ),
  Down: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 5v14M5 12l7 7 7-7" />
    </Svg>
  ),
  Library: (p: IconProps) => (
    <Svg {...p}>
      <rect x="4" y="4" width="6" height="16" rx="1" />
      <rect x="11" y="4" width="5" height="16" rx="1" />
      <path d="m17 5 3.5 14.5" />
    </Svg>
  ),

  // ── JuraDAW's own ──
  Pencil: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 20l1-4.5L16.5 4a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5L8.5 19z" />
      <path d="M14.5 6l3.5 3.5" />
    </Svg>
  ),
  Eraser: (p: IconProps) => (
    <Svg {...p}>
      <path d="M8.5 19 4 14.5a1.5 1.5 0 0 1 0-2.1l8.4-8.4a1.5 1.5 0 0 1 2.1 0l5.5 5.5a1.5 1.5 0 0 1 0 2.1L12.5 19z" />
      <path d="M8 9.5l6.5 6.5M6 19h14" />
    </Svg>
  ),
  Scissors: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="6" cy="6.5" r="2.5" />
      <circle cx="6" cy="17.5" r="2.5" />
      <path d="M8 8l12 9.5M8 16 20 6.5" />
    </Svg>
  ),
  ToStart: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6 5v14" />
      <path d="M19 5.5v13L9 12z" fill="currentColor" />
    </Svg>
  ),
  Play: (p: IconProps) => (
    <Svg {...p}>
      <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
    </Svg>
  ),
  Stop: (p: IconProps) => (
    <Svg {...p}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
    </Svg>
  ),
  Record: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="6.5" fill="currentColor" />
    </Svg>
  ),
  Loop: (p: IconProps) => (
    <Svg {...p}>
      <path d="M17 3l3 3-3 3" />
      <path d="M20 6H8a4 4 0 0 0-4 4v1" />
      <path d="M7 21l-3-3 3-3" />
      <path d="M4 18h12a4 4 0 0 0 4-4v-1" />
    </Svg>
  ),
  Metronome: (p: IconProps) => (
    <Svg {...p}>
      <path d="M9 3h6l4 18H5z" />
      <path d="M12 16 18 6M7 16h10" />
    </Svg>
  ),
  Snap: (p: IconProps) => (
    <Svg {...p}>
      <path d="M5 4v8a7 7 0 0 0 14 0V4h-4v8a3 3 0 0 1-6 0V4z" />
      <path d="M5 8h4M15 8h4" />
    </Svg>
  ),
  AddTrack: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 6h12M3 11h9M3 16h7" />
      <path d="M18 12v8M14 16h8" />
    </Svg>
  ),
  /** The piano roll: notes as bars. */
  Editor: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M6 9h5M10 12.5h6M7 16h4" strokeWidth={2.4} />
    </Svg>
  ),
  /** The mixer: three faders. */
  Mixer: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6 4v16M12 4v16M18 4v16" />
      <path d="M4 9h4M10 15h4M16 7.5h4" strokeWidth={2.6} />
    </Svg>
  ),
  /** Automation: a line with points on it. */
  Automation: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 17l5-8 6 5 7-9" />
      <circle cx="8" cy="9" r="1.6" fill="currentColor" />
      <circle cx="14" cy="14" r="1.6" fill="currentColor" />
    </Svg>
  ),
  /** The on-screen keys. */
  Keys: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M9 12v7M15 12v7" />
      <path d="M9 5v7M15 5v7" strokeWidth={3} />
    </Svg>
  ),
  Note: (p: IconProps) => (
    <Svg {...p}>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </Svg>
  ),
  Drum: (p: IconProps) => (
    <Svg {...p}>
      <ellipse cx="12" cy="9" rx="8" ry="3.5" />
      <path d="M4 9v7c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5V9" />
      <path d="M15 3l-5 5M9 3l5 5" />
    </Svg>
  ),
  Mic: (p: IconProps) => (
    <Svg {...p}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
    </Svg>
  ),
  Wave: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 12h2M7 8v8M11 4v16M15 7v10M19 10v4M21 12h0" />
    </Svg>
  ),
  ChevronDown: (p: IconProps) => (
    <Svg {...p}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  ),
  Speaker: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
      <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
    </Svg>
  ),
  Repeat: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3" y="8" width="7" height="8" rx="1.5" />
      <rect x="14" y="8" width="7" height="8" rx="1.5" strokeDasharray="2.2 2.2" />
    </Svg>
  ),
  Tidy: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 4v16M10 4v16M16 4v16" strokeWidth={1} />
      <path d="M4 8h5M10 12h6M16 16h4" strokeWidth={2.6} />
    </Svg>
  ),
};

/** A library pattern's or an instrument's small drawing (fixed markup written in the code, never user data). */
export function MarkupIcon({ markup, size = 44 }: { markup: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
