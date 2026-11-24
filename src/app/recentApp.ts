/**
 * Recent songs in this browser (IndexedDB "juradaw-recent", apart from the sounds' own "juradaw"): the song open is
 * kept under its own id a couple of seconds after each change; starting a new song or opening another one starts a
 * new id, after keeping the old one. The sounds a kept song uses stay in the browser while it's in the list. If the
 * browser has no IndexedDB (or it's blocked), they're kept for this visit only. (As JuraCUT's recentApp.ts.)
 */
import { getEngine } from "../audio/engine";
import { keepRecent, memoryStore, openRecent, recentList, recentSoundIds, type RecentMeta, type RecentStore } from "../model/recent";
import { useStore } from "../model/store";
import { loadSounds, soundsChanged } from "./engineApp";

const DB = "juradaw-recent";
const ID_KEY = "juradaw.recentId";

function idbStore(): RecentStore | null {
  if (typeof indexedDB === "undefined") return null;
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("recentMeta", { keyPath: "id" });
        req.result.createObjectStore("recentSongs");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  let db: Promise<IDBDatabase> | null = null;
  const tx = async <T>(stores: string[], mode: IDBTransactionMode, run: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> => {
    db ??= open();
    const t = (await db).transaction(stores, mode);
    const req = run(t);
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    list: async () => ((await tx(["recentMeta"], "readonly", (t) => t.objectStore("recentMeta").getAll())) as RecentMeta[]) ?? [],
    put: async (meta, text) => {
      await tx(["recentMeta", "recentSongs"], "readwrite", (t) => {
        t.objectStore("recentMeta").put(meta);
        t.objectStore("recentSongs").put(text, meta.id);
      });
    },
    get: async (id) => ((await tx(["recentSongs"], "readonly", (t) => t.objectStore("recentSongs").get(id))) as string | undefined) ?? null,
    remove: async (id) => {
      await tx(["recentMeta", "recentSongs"], "readwrite", (t) => {
        t.objectStore("recentMeta").delete(id);
        t.objectStore("recentSongs").delete(id);
      });
    },
  };
}

let store: RecentStore = idbStore() ?? memoryStore();
const fresh = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let currentId = (() => {
  try {
    return localStorage.getItem(ID_KEY) || fresh();
  } catch {
    return fresh();
  }
})();
const rememberId = () => {
  try {
    localStorage.setItem(ID_KEY, currentId);
  } catch {
    // Kept for this visit only.
  }
};

let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

/** Keep the song that's open now (under its id). */
export async function keepNow(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  try {
    await keepRecent(store, currentId, useStore.getState().history.present);
  } catch {
    // The browser said no (full, or private browsing): keep them for this visit instead.
    store = memoryStore();
    await keepRecent(store, currentId, useStore.getState().history.present).catch(() => {});
  }
  changed();
}

/** Start keeping the song as it changes (call once, after the kept song is back). */
export function startRecent(): () => void {
  rememberId();
  return useStore.subscribe((s, prev) => {
    if (s.history.present === prev.history.present) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void keepNow(), 2000);
  });
}

/** The song open is about to be replaced by another (New, Open): keep it, then start a new id. */
export async function beforeOtherSong(): Promise<void> {
  await keepNow();
  currentId = fresh();
  rememberId();
}

export const listRecent = () => recentList(store);
/** Every sound a kept song uses (the browser keeps them while the song is in the list). */
export const soundsOfRecent = () => recentSoundIds(store).catch(() => [] as string[]);
export const forgetRecent = async (id: string) => {
  await store.remove(id);
  changed();
};
export function onRecentChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Open a kept song (the one open is kept first). */
export async function openRecentSong(id: string): Promise<boolean> {
  if (id === currentId) return true;
  const song = await openRecent(store, id);
  if (!song) {
    useStore.getState().toast("That song couldn't be read back.", "error");
    return false;
  }
  await keepNow();
  currentId = id;
  rememberId();
  if (getEngine().state().playing || useStore.getState().recording) getEngine().stop();
  // A fresh start (no undo back into the other song, which would then be kept under this one's name).
  useStore.getState().loadSong(song, null);
  await loadSounds(song);
  soundsChanged();
  useStore.getState().toast(`Opened "${song.name}".`, "success");
  return true;
}

export const isCurrent = (id: string) => id === currentId;
