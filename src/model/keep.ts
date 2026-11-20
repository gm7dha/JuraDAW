/**
 * Keeping the song in the browser (localStorage), so a refresh brings it
 * back. Pure: the storage is passed in, so it's tested without a browser.
 * (The sounds themselves are kept elsewhere — see src/audio.)
 */
import { parseSong } from "./document";
import type { Song } from "./types";

export const STORAGE_KEY = "juradaw.song.v1";

export interface KeepStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What to tell someone when the browser has no room left for the song. */
export const KEEP_PROBLEM = "This song is too big for the browser to keep, so your latest changes would be lost if the page is closed or reloaded. Use Save to keep it as a file.";
/** What to tell someone when the browser won't keep anything at all (private browsing, storage switched off). */
export const KEEP_UNAVAILABLE = "This browser isn't letting JuraDAW keep your song, so it would be lost if the page is closed or reloaded. Use Save to keep it as a file.";

/** The browser's storage, or null when there is none or it's blocked (asking for it can throw). */
export function browserStorage(): KeepStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Keep the song. Never throws: null when it's kept, otherwise why it couldn't be, in words to show
 * (KEEP_UNAVAILABLE when there's no storage to use, KEEP_PROBLEM when the browser refused — nearly always because it's full).
 */
export function keepProblem(storage: Pick<KeepStorage, "setItem"> | null | undefined, song: Song): string | null {
  if (!storage) return KEEP_UNAVAILABLE;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(song));
    return null;
  } catch {
    return KEEP_PROBLEM;
  }
}

/** Keep the song. Returns false when the browser won't (full, or storage blocked) — `keepProblem` also says why. */
export function keepInBrowser(storage: Pick<KeepStorage, "setItem"> | null | undefined, song: Song): boolean {
  return keepProblem(storage, song) === null;
}

/** The song kept in the browser, or null when there's none (or it's damaged). */
export function readKept(storage: Pick<KeepStorage, "getItem"> | null | undefined): Song | null {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return text ? parseSong(text) : null;
  } catch {
    return null;
  }
}

/** Forget the kept song. */
export function forgetKept(storage: Pick<KeepStorage, "removeItem"> | null | undefined): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to forget, then.
  }
}
