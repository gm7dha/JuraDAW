/**
 * The instruments' pictures: 48×48 line drawings as SVG markup, drawn in the
 * current text colour so they suit the light and dark themes.
 */

const svg = (inside: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inside}</svg>`;

/** A solid shape in the text colour. */
const solid = (d: string) => `<path d="${d}" fill="currentColor" stroke="none"/>`;

export const ICONS = {
  /** Piano keys. */
  piano: svg(
    `<rect x="6" y="10" width="36" height="28" rx="3"/><path d="M15 26v12M24 26v12M33 26v12"/>` +
      solid("M12.5 10h5v15a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1zM21.5 10h5v15a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1zM30.5 10h5v15a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1z"),
  ),
  /** A keyboard on a stand, with a spark. */
  "electric-piano": svg(
    `<rect x="5" y="17" width="38" height="13" rx="2.5"/><path d="M12 24v6M18 24v6M24 24v6M30 24v6M36 24v6"/><path d="M14 30 10 42M34 30l4 12M12.5 37h23"/>` +
      solid("M26.5 4l-6 7h4l-2 5.5 6.5-7.5h-4z"),
  ),
  /** Organ pipes. */
  organ: svg(
    `<path d="M9 40V18l3-4 3 4v22M19 40V11l3-4 3 4v29M29 40V15l3-4 3 4v25M39 40V22"/><path d="M5 40h38"/><path d="M10.5 30h3M20.5 30h3M30.5 30h3"/>`,
  ),
  /** A violin. */
  strings: svg(
    `<path d="M30 6 21.5 17"/><path d="M27 4.5l4.5 3.5"/><path d="M21.5 16c-3-2-7.5-.5-9 3-1 2.5.5 4-1.5 6.5-3 3-5.5 6-3.5 10.5 2 4.5 8 6.5 12.5 4 3.5-2 4-5.5 6.5-7 3-1.5 6-1 7.5-4.5 1.5-3.5-.5-7.5-4-8.5"/><path d="M17 27l6 4.5"/><path d="M40 12 16 42"/>`,
  ),
  /** Soft layers of sound. */
  pad: svg(
    `<path d="M6 17c4-5 8-5 12 0s8 5 12 0 8-5 12 0"/><path d="M6 26c4-5 8-5 12 0s8 5 12 0 8-5 12 0" opacity="0.7"/><path d="M6 35c4-5 8-5 12 0s8 5 12 0 8-5 12 0" opacity="0.4"/>`,
  ),
  /** A bass guitar. */
  bass: svg(
    `<path d="M41 5 23.5 24.5"/><path d="M36.5 4.5l7 7"/><path d="M23 22.5c-3-3-8-2.5-10 1-1.5 2.5-.5 4.5-3 6.5-4 3-5.5 7-2.5 10.5 3.5 4 9.5 3 12-1 1.5-2.5.5-4.5 3.5-6 3.5-1.5 5-6 2.5-9"/><circle cx="15" cy="33" r="2.2"/>`,
  ),
  /** A square wave: the sound of a synth bass. */
  "synth-bass": svg(`<rect x="5" y="8" width="38" height="32" rx="4"/><path d="M10 31h7V17h8v14h8V17h5"/>`),
  /** A sawtooth wave: the sound of a synth lead. */
  lead: svg(`<rect x="5" y="8" width="38" height="32" rx="4"/><path d="M10 31 19 17v14l9-14v14l9-14"/>`),
  /** A plectrum over strings. */
  pluck: svg(
    `<path d="M6 12h36M6 36h36" opacity="0.5"/><path d="M6 24h7M35 24h7"/><path d="M24 37c-2 0-9-11-9-17a9 9 0 0 1 18 0c0 6-7 17-9 17z"/>`,
  ),
  /** A bell. */
  bells: svg(
    `<path d="M24 6v3"/><path d="M11 34c3-3 4-7 4-13a9 9 0 0 1 18 0c0 6 1 10 4 13z"/><path d="M20.5 39a3.6 3.6 0 0 0 7 0"/><path d="M40 12c1.5 2 2.5 4.5 2.5 7M8 12c-1.5 2-2.5 4.5-2.5 7"/>`,
  ),
  /** An upright piano, seen from the front. */
  "felt-piano": svg(`<rect x="8" y="8" width="32" height="32" rx="3"/><path d="M8 25h32M8 31h32"/><path d="M14 25v6M20 25v6M26 25v6M32 25v6"/><path d="M13 40v3M35 40v3"/><path d="M19 16h10" opacity="0.6"/>`),
  /** Three singers. */
  choir: svg(
    `<circle cx="12" cy="16" r="4.5"/><circle cx="24" cy="13" r="4.5"/><circle cx="36" cy="16" r="4.5"/><path d="M4 40c0-9 3.5-14 8-14s8 5 8 14M16 40c0-10 3.5-17 8-17s8 7 8 17M28 40c0-9 3.5-14 8-14s8 5 8 14"/>`,
  ),
  /** A slow, deep sine wave. */
  "sub-bass": svg(`<rect x="5" y="8" width="38" height="32" rx="4"/><path d="M10 24c4.5-13 9.5-13 14 0s9.5 13 14 0"/>`),
  /** A jagged, torn wave. */
  "growl-bass": svg(`<rect x="5" y="8" width="38" height="32" rx="4"/><path d="M10 30l4-12 3 9 3-13 4 15 3-9 3 10 4-14 4 12"/>`),
  /** Sawtooth waves stacked up. */
  supersaw: svg(`<path d="M5 20 14 8v12l9-12v12l9-12v12l9-12"/><path d="M5 31 14 19v12l9-12v12l9-12v12l9-12" opacity="0.65"/><path d="M5 42 14 30v12l9-12v12l9-12v12l9-12" opacity="0.35"/>`),
  /** A tape reel. */
  wobble: svg(`<circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="3"/><circle cx="24" cy="13.5" r="3.2"/><circle cx="14.9" cy="29.3" r="3.2"/><circle cx="33.1" cy="29.3" r="3.2"/>`),
  /** A rush of noise getting bigger. */
  sweep: svg(`<path d="M5 38c10-1 22-6 37-27"/><path d="M34 11h8v8"/><path d="M8 30v2M14 26v4M20 21v6M26 16v7" opacity="0.6"/>`),
  /** A drum and sticks. */
  drums: svg(
    `<ellipse cx="24" cy="23" rx="15" ry="5.5"/><path d="M9 23v12c0 3 6.7 5.5 15 5.5s15-2.5 15-5.5V23"/><path d="M15 28v11M24 29v11.5M33 28v11"/><path d="M6 6l14 13M42 6 28 19"/>`,
  ),
};
