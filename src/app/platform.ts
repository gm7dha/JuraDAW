/**
 * Which kind of computer JuraDAW is running on, so shortcuts can be shown
 * the way that computer's keyboard labels them (⌘ Cmd on a Mac, Ctrl on Windows).
 */
export type Platform = "mac" | "windows";

interface NavigatorLike {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

/** Mac (including iPad) or Windows-style (Windows, Linux, ChromeOS…). */
export function detectPlatform(nav: NavigatorLike | undefined = globalThis.navigator as NavigatorLike | undefined): Platform {
  if (!nav) return "windows";
  const hint = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(hint) ? "mac" : "windows";
}

export interface KeyNames {
  /** The main shortcut key: "⌘ Cmd" or "Ctrl". */
  mod: string;
  shift: string;
  /** The key that deletes things. */
  del: string;
  alt: string;
}

export function keyNames(p: Platform): KeyNames {
  return p === "mac" ? { mod: "⌘ Cmd", shift: "⇧ Shift", del: "Delete ⌫", alt: "⌥ Option" } : { mod: "Ctrl", shift: "Shift", del: "Delete", alt: "Alt" };
}

/** Short label for tooltips, e.g. "⌘Z" or "Ctrl+Z". */
export function shortcut(p: Platform, key: string, opts: { shift?: boolean } = {}): string {
  if (p === "mac") return `${opts.shift ? "⇧" : ""}⌘${key}`;
  return `Ctrl+${opts.shift ? "Shift+" : ""}${key}`;
}

/** Mouse and keyboard help rows for the Help dialog, worded for this kind of computer. */
export function helpRows(p: Platform) {
  const k = keyNames(p);
  const mac = p === "mac";
  const mouse: [string, string][] = [
    ["Choose where Play starts", "Click the numbered bar ruler above the tracks"],
    ["Set the part that repeats", "Drag across the yellow strip at the top of the ruler; click the strip to turn the loop on or off"],
    ["Change the part that repeats", "While the loop is on: drag an end of the yellow strip to stretch it, or its middle to slide it along"],
    ["Select a clip", `Click it (${k.shift}-click adds more; drag on an empty part to select several)`],
    ["Move a clip", `Drag it, also up or down to another track of the same kind (it snaps to the grid; ${k.shift}: no snapping)`],
    ["Make a clip longer or shorter", "Drag its left or right edge"],
    ["Copy a clip", `Hold ${k.alt} and drag it`],
    ["New clip of notes", "Double-click an empty part of an instrument track, or drag with the Pencil"],
    ["Edit a clip's notes", "Double-click the clip: it opens along the bottom"],
    ["Add a note", "Double-click in the editor's grid, or click with the Pencil; drag a note to move it, its right end to change its length"],
    ["Remove a note", "Double-click it, click it with the Eraser, or select it and press Delete"],
    ["Change a track's instrument", "Click the track, then pick an instrument card in the panel on the left"],
    ["Delete a track", mac ? "Click it, then Delete in the panel on the left (or right-click its name)" : "Click it, then Delete in the panel on the left (or right-click its name)"],
    ["Menu", mac ? "Right-click (or Control-click) a clip or a track" : "Right-click a clip or a track"],
    ["Scroll", `Scroll wheel (${k.shift} + wheel: sideways)`],
    ["Zoom (towards the pointer)", mac ? "⌘ Cmd + scroll wheel, or pinch on a trackpad" : "Ctrl + scroll wheel, or pinch"],
    ["Touch screen", "One finger scrolls and drags clips, two fingers pinch to zoom"],
  ];
  const keys: [string, string][] = [
    ["Space", "Play or stop"],
    ["R", "Record onto the selected track (press again, or Space, to stop)"],
    ["Home  or  Enter", "Go back to the start"],
    ["L", "Loop on or off"],
    ["K", "Metronome (click) on or off"],
    ["V", "Select tool"],
    ["P", "Pencil: draw clips and notes"],
    ["E", "Eraser: click a clip or note to remove it"],
    ["C", "Scissors: click a clip to split it there"],
    ["Esc", "Back to the Select tool, then clear the selection"],
    ["F", "Zoom to fit the whole song"],
    ["Arrow keys", `In the editor: nudge the selected notes (up or down one key on the piano — a semitone; with ${k.shift} twelve keys — an octave; left and right one grid step)`],
    [k.del, "Delete the selected notes or clips"],
    [`${k.mod} + C / X / V`, "Copy, cut and paste clips or notes (paste goes in at the play position)"],
    [`${k.mod} + D`, "Duplicate the selected clips"],
    [`${k.mod} + A`, "Select everything"],
    [`${k.mod} + Z`, "Undo"],
    [mac ? `${k.mod} + ${k.shift} + Z  or  ${k.mod} + Y` : `${k.mod} + Y  or  ${k.mod} + ${k.shift} + Z`, "Redo"],
    [`${k.mod} + S`, "Save to a .juradaw file"],
    [`${k.mod} + ${k.shift} + S`, "Save a copy under a new name"],
    [`${k.mod} + O`, "Open a .juradaw song (or drag one onto the window)"],
    ["A W S E D F T G Y H U J K", "Play notes, when “Play with the computer keyboard” is on in the Keys panel (Z and X: an octave down and up). While it's on, the single-letter shortcuts above are off"],
    ["?", "Show this help"],
  ];
  return { mouse, keys };
}
