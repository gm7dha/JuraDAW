/**
 * The song's sounds (recordings and imported sound files). The samples are
 * held in memory, ready to play, and a copy of each is kept in the browser's
 * IndexedDB as a WAV file so they're still there after a reload. If the
 * browser won't let us use IndexedDB (private windows, storage full),
 * everything still works until the page is closed.
 */
import type { AudioInfo } from "../model/types";
import { decodeWav, encodeWav, peaksOf } from "./wav";

const DB_NAME = "juradaw";
const STORE = "sounds";
/** The overview keeps the loudest sample of every this-many, so long sounds draw quickly. */
const OVERVIEW_STEP = 256;

/** A sound ready to play. */
export interface Sound {
  info: AudioInfo;
  buffer: AudioBuffer;
  /** The loudest sample (of any channel) in each OVERVIEW_STEP samples. */
  overview: Float32Array;
}

/** What's kept in IndexedDB for each sound. */
interface StoredSound {
  id: string;
  info: AudioInfo;
  wav: ArrayBuffer;
}

const sounds = new Map<string, Sound>();

/** An id for a new sound. */
export function newSoundId(): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `sound-${random}`;
}

/** The sound with an id, if it's loaded. */
export function getSound(id: string): Sound | undefined {
  return sounds.get(id);
}

function channelsOf(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
}

function overviewOf(channels: Float32Array[]): Float32Array {
  const frames = channels[0]?.length ?? 0;
  const overview = new Float32Array(Math.ceil(frames / OVERVIEW_STEP));
  for (const samples of channels) {
    for (let i = 0; i < samples.length; i++) {
      const v = Math.abs(samples[i]);
      const at = (i / OVERVIEW_STEP) | 0;
      if (v > overview[at]) overview[at] = v;
    }
  }
  return overview;
}

/**
 * Hold a sound in memory, ready to play (not yet kept in the browser: see
 * `storeSound`). The info's length, rate and channel count are corrected to
 * what the samples really are.
 */
export function keepSound(info: AudioInfo, channels: Float32Array[], sampleRate: number): Sound {
  const frames = Math.max(1, channels[0]?.length ?? 0);
  const buffer = new AudioBuffer({ length: frames, numberOfChannels: Math.max(1, channels.length), sampleRate });
  channels.forEach((samples, c) => buffer.getChannelData(c).set(samples));
  const sound: Sound = {
    info: { ...info, seconds: frames / sampleRate, sampleRate, channels: buffer.numberOfChannels },
    buffer,
    overview: overviewOf(channels),
  };
  sounds.set(info.id, sound);
  return sound;
}

/** A loaded sound as a WAV file's bytes; null if it isn't loaded. */
export function soundWav(id: string): Uint8Array | null {
  const sound = sounds.get(id);
  return sound ? encodeWav(channelsOf(sound.buffer), sound.buffer.sampleRate) : null;
}

/**
 * A sound's shape for drawing: `buckets` values 0–1 between two times in
 * seconds (the whole sound by default); null if it isn't loaded.
 */
export function soundPeaks(id: string, buckets: number, fromSeconds = 0, toSeconds?: number): Float32Array | null {
  const sound = sounds.get(id);
  if (!sound) return null;
  const rate = sound.buffer.sampleRate;
  const from = fromSeconds * rate;
  const to = (toSeconds ?? sound.buffer.duration) * rate;
  // Zoomed out, the overview is plenty and far quicker than every sample.
  if (buckets > 0 && (to - from) / buckets >= OVERVIEW_STEP * 2) return peaksOf(sound.overview, buckets, from / OVERVIEW_STEP, to / OVERVIEW_STEP);
  let peaks: Float32Array | null = null;
  for (const samples of channelsOf(sound.buffer)) {
    const mine = peaksOf(samples, buckets, from, to);
    if (!peaks) peaks = mine;
    else for (let i = 0; i < mine.length; i++) if (mine[i] > peaks[i]) peaks[i] = mine[i];
  }
  return peaks;
}

// ── IndexedDB ──

let opening: Promise<IDBDatabase | null> | null = null;

/** The database, or null when the browser won't give us one. */
function database(): Promise<IDBDatabase | null> {
  opening ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

/** Do one thing in the store; `fallback` if anything goes wrong. */
async function inStore<T, F>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>, fallback: F): Promise<T | F> {
  const db = await database();
  if (!db) return fallback;
  return new Promise<T | F>((resolve) => {
    try {
      const transaction = db.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => resolve(fallback);
      transaction.onabort = () => resolve(fallback);
    } catch {
      resolve(fallback);
    }
  });
}

/** Keep a loaded sound in the browser. True if it was kept. */
export async function storeSound(id: string): Promise<boolean> {
  const sound = sounds.get(id);
  const wav = soundWav(id);
  if (!sound || !wav) return false;
  const record: StoredSound = { id, info: sound.info, wav: wav.buffer as ArrayBuffer };
  const key = await inStore("readwrite", (store) => store.put(record), null);
  return key !== null;
}

/**
 * Make sure a song's sounds are in memory, fetching from the browser's
 * storage those that aren't. Resolves with the ids that couldn't be found.
 */
export async function loadSounds(infos: AudioInfo[]): Promise<string[]> {
  const missing: string[] = [];
  for (const info of infos) {
    if (sounds.has(info.id)) continue;
    const record = await inStore("readonly", (store) => store.get(info.id) as IDBRequest<StoredSound | undefined>, undefined);
    try {
      if (!record) throw new Error("not kept");
      const { channels, sampleRate } = decodeWav(new Uint8Array(record.wav));
      keepSound(info, channels, sampleRate);
    } catch {
      missing.push(info.id);
    }
  }
  return missing;
}

/**
 * Forget the sounds that aren't in `keepIds`, in memory and in the browser's
 * storage, so old recordings don't pile up.
 */
export async function forgetSounds(keepIds: string[]): Promise<void> {
  const keep = new Set(keepIds);
  for (const id of [...sounds.keys()]) if (!keep.has(id)) sounds.delete(id);
  const keys = await inStore("readonly", (store) => store.getAllKeys(), [] as IDBValidKey[]);
  for (const key of keys) {
    if (typeof key === "string" && !keep.has(key)) await inStore("readwrite", (store) => store.delete(key), undefined);
  }
}
