/**
 * Recent songs (pure, over an async store passed in — JuraCUT's recent designs, for songs): the songs worked on in
 * this browser, each kept as it changes, so starting a new one or opening a file never loses the last. The newest
 * `MOST_RECENT` are kept; older ones go. Each has a small picture of its tracks and clips for the list, and lists
 * the sounds it uses, so they're kept in the browser while the song is in the list.
 */
import { parseSong } from "./document";
import { clipEnd, songLength } from "./time";
import type { Song } from "./types";

export const MOST_RECENT = 12;

export interface RecentMeta {
  id: string;
  name: string;
  /** When it was last changed (ms since 1970). */
  at: number;
  tracks: number;
  /** How many bars long. */
  bars: number;
  /** The recordings and sound files it uses (Song.audio ids), kept in the browser for it. */
  soundIds: string[];
  /** A small SVG of its tracks and clips ("" when there's nothing to draw). */
  thumb: string;
}

/** Where recent songs are kept (IndexedDB in the browser; a Map in tests). */
export interface RecentStore {
  list(): Promise<RecentMeta[]>;
  put(meta: RecentMeta, text: string): Promise<void>;
  get(id: string): Promise<string | null>;
  remove(id: string): Promise<void>;
}

/** A small picture of a song: a row for each track (at most 8), its clips as blocks in the track's colour. */
export function thumbnail(song: Song): string {
  const tracks = song.tracks.slice(0, 8);
  const length = Math.max(songLength(song), song.beatsPerBar * 4);
  if (!tracks.length) return "";
  const W = 96;
  const rowH = 36 / tracks.length;
  let out = "";
  tracks.forEach((t, i) => {
    for (const c of song.clips) {
      if (c.trackId !== t.id) continue;
      const x = (c.start / length) * W;
      const w = Math.max(1, ((clipEnd(c, song.bpm) - c.start) / length) * W);
      out += `<rect x="${x.toFixed(1)}" y="${(i * rowH + rowH * 0.15).toFixed(1)}" width="${w.toFixed(1)}" height="${(rowH * 0.7).toFixed(1)}" rx="1" fill="${t.colour}"/>`;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 36" preserveAspectRatio="none">${out}</svg>`;
}

/** What's kept of a song: the song itself, without its sounds (they stay in the browser's own store). */
export function recentText(song: Song): string {
  return JSON.stringify(song);
}

/** Keep a song under its id (newest first; the oldest past `MOST_RECENT` go). Songs with no tracks aren't kept. */
export async function keepRecent(store: RecentStore, id: string, song: Song, now = Date.now()): Promise<void> {
  if (!song.tracks.length) return;
  const meta: RecentMeta = {
    id,
    name: song.name,
    at: now,
    tracks: song.tracks.length,
    bars: Math.max(1, Math.ceil(songLength(song) / song.beatsPerBar - 1e-9)),
    soundIds: song.audio.map((a) => a.id),
    thumb: thumbnail(song),
  };
  await store.put(meta, recentText(song));
  const all = (await store.list()).sort((a, b) => b.at - a.at);
  for (const old of all.slice(MOST_RECENT)) await store.remove(old.id);
}

/** The songs kept, newest first. */
export async function recentList(store: RecentStore): Promise<RecentMeta[]> {
  return (await store.list()).sort((a, b) => b.at - a.at);
}

/** Every sound the kept songs use (so the browser keeps them). */
export async function recentSoundIds(store: RecentStore): Promise<string[]> {
  return [...new Set((await store.list()).flatMap((m) => (Array.isArray(m.soundIds) ? m.soundIds : [])))];
}

/** A kept song, read back carefully (null if it's gone or damaged). */
export async function openRecent(store: RecentStore, id: string): Promise<Song | null> {
  const text = await store.get(id);
  if (!text) return null;
  try {
    return parseSong(JSON.parse(text));
  } catch {
    return null;
  }
}

/** A Map-backed store (tests, and when the browser has no IndexedDB). */
export function memoryStore(): RecentStore {
  const meta = new Map<string, RecentMeta>();
  const texts = new Map<string, string>();
  return {
    list: async () => [...meta.values()],
    put: async (m, t) => {
      meta.set(m.id, m);
      texts.set(m.id, t);
    },
    get: async (id) => texts.get(id) ?? null,
    remove: async (id) => {
      meta.delete(id);
      texts.delete(id);
    },
  };
}
