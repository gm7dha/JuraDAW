/**
 * The song Claude is working on in one chat: the song itself, its own undo
 * list, the file it was opened from or saved to, and the live link with the
 * user's JuraDAW tab (when there is one). Pure but for the folder.
 */
import { newSong, type SoundsBase64 } from "../model/document";
import type { Song } from "../model/types";
import type { SongFolder } from "./files";
import type { ToolResult } from "./toolKit";

/** What the live link with the user's JuraDAW tab says about itself (see live.ts). */
export interface LiveStatus {
  connected: boolean;
  text: string;
}

/**
 * The live link with a JuraDAW tab (src/mcp/live.ts). While it's connected,
 * tools run on the song open in that tab and their changes are sent to it.
 */
export interface LiveLink {
  readonly connected: boolean;
  status(): LiveStatus;
  call(s: Session, tool: string, run: () => Promise<ToolResult>, signal?: AbortSignal): Promise<ToolResult>;
}

export interface SessionSnapshot {
  song: Song;
  past: Song[];
  file: string | null;
  generation: number;
}

/** Thrown when Claude has cancelled the call (MCP's notifications/cancelled). */
export class Cancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

const MOST_UNDO = 50;

export class Session {
  song: Song = newSong();
  /** Earlier states, newest last (Claude's own undo). */
  past: Song[] = [];
  /** The file name (in the folder) the song was opened from or last saved to. */
  file: string | null = null;
  /** The recorded sound of a song opened from a file (base64 WAV by id), so saving it again keeps it. */
  sounds: SoundsBase64 = {};
  /** Goes up whenever the whole song is replaced (new_song, open_song). */
  generation = 0;
  live: LiveLink | null = null;
  /** The call being run: its cancel signal, and whether it has written a file. */
  signal: AbortSignal | null = null;
  wroteFile = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly folder: SongFolder | null) {}

  /** Calls run one at a time (Claude may send several at once). */
  serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run);
    this.queue = next.catch(() => {});
    return next;
  }

  get cancelled(): boolean {
    return !!this.signal?.aborted;
  }

  throwIfCancelled(): void {
    if (this.cancelled) throw new Cancelled();
  }

  /** Take a changed song as the next step (nothing happens if it's the very same song). */
  commit(next: Song): boolean {
    if (next === this.song) return false;
    this.past = [...this.past.slice(-(MOST_UNDO - 1)), this.song];
    this.song = next;
    return true;
  }

  /** Go back one of Claude's own steps. False when there is none. */
  undo(): boolean {
    const before = this.past[this.past.length - 1];
    if (!before) return false;
    this.past = this.past.slice(0, -1);
    this.song = before;
    return true;
  }

  /** Start again with another song (new_song, open_song). */
  reset(song: Song, file: string | null): void {
    this.song = song;
    this.past = [];
    this.file = file;
    this.generation++;
  }

  /** Take the song open in the user's JuraDAW tab as the one being worked on (its undo list is the tab's). */
  adopt(song: Song): void {
    this.song = song;
    this.past = [];
    // The tab keeps its own recordings; none travel over the link.
    this.sounds = {};
  }

  snapshot(): SessionSnapshot {
    return { song: this.song, past: this.past, file: this.file, generation: this.generation };
  }

  restore(snap: SessionSnapshot): void {
    this.song = snap.song;
    this.past = snap.past;
    this.file = snap.file;
    this.generation = snap.generation;
  }
}
