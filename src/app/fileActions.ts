/**
 * Saving and opening .juradaw files on the user's computer, and bringing
 * sound files and MIDI files in.
 *
 * In Chrome and Edge this uses the browser's real Save / Open windows, and
 * after the first save, Save writes straight back to the same file. Other
 * browsers (Safari, Firefox) save by downloading and open with the normal
 * file picker.
 *
 * A .juradaw file holds the song and its sounds (recordings and imported
 * sound files, as WAV), so one file is all there is to keep or send.
 */
import { getEngine } from "../audio/engine";
import { midiToSong, midiTracks } from "../midi/midiFile";
import { base64ToBytes, bytesToBase64, FILE_EXTENSION, FILE_MIME, nameFromFileName, newId, nextTrackColour, readSongFile, SAVE_TOO_BIG, songFileParts, type SoundsBase64 } from "../model/document";
import { freePlace } from "../model/edits";
import { hasUnsavedChanges, useStore } from "../model/store";
import { MOST_TRACKS, type Song, type Track } from "../model/types";
import { downloadFile, safeFileName } from "./download";
import { forgetUnusedSounds, soundsChanged } from "./engineApp";

// The File System Access API isn't in TypeScript's built-in types yet.
interface WritableFile {
  write(data: Blob | string): Promise<void>;
  close(): Promise<void>;
}
interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableFile>;
}
interface PickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
  excludeAcceptAllOption?: boolean;
  multiple?: boolean;
}
type PickerWindow = Window & {
  showSaveFilePicker?: (o: PickerOptions) => Promise<FileHandle>;
  showOpenFilePicker?: (o: PickerOptions) => Promise<FileHandle[]>;
};

const SOUND_EXTENSIONS = [".wav", ".mp3", ".ogg", ".oga", ".m4a", ".aac", ".flac", ".opus", ".webm", ".aif", ".aiff"];
const MIDI_EXTENSIONS = [".mid", ".midi"];
const IMPORT_ACCEPT = [...SOUND_EXTENSIONS, ...MIDI_EXTENSIONS].join(",");

const FILE_TYPES = [{ description: "JuraDAW song", accept: { [FILE_MIME]: [FILE_EXTENSION], "application/json": [FILE_EXTENSION] } }];
const IMPORT_TYPES = [{ description: "Sound file or MIDI file", accept: { "audio/*": SOUND_EXTENSIONS, "audio/midi": MIDI_EXTENSIONS } }];
const OPEN_TYPES = [{ description: "JuraDAW song, or a sound or MIDI file to bring in", accept: { [FILE_MIME]: [FILE_EXTENSION], "application/json": [FILE_EXTENSION], "audio/*": SOUND_EXTENSIONS, "audio/midi": MIDI_EXTENSIONS } }];

const extensionOf = (name: string) => (/\.[^.]+$/.exec(name)?.[0] ?? "").toLowerCase();
export const isMidiFile = (name: string) => MIDI_EXTENSIONS.includes(extensionOf(name));
export const isSoundFile = (file: { name: string; type?: string }) => SOUND_EXTENSIONS.includes(extensionOf(file.name)) || (!!file.type && file.type.startsWith("audio/") && !isMidiFile(file.name));
const isImportFile = (file: { name: string; type?: string }) => isMidiFile(file.name) || isSoundFile(file);

/** The file the song was last saved to or opened from (Chrome/Edge only). */
let currentHandle: FileHandle | null = null;

const isCancel = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
const said = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The song's sounds as base64 WAV, for putting inside the file; and the names of any that couldn't be found. */
async function soundsOf(song: Song): Promise<{ sounds: SoundsBase64; missing: string[] }> {
  const engine = getEngine();
  const sounds: SoundsBase64 = {};
  const missing: string[] = [];
  for (const info of song.audio) {
    const wav = await engine.audioWav(info.id).catch(() => null);
    if (!wav) {
      missing.push(info.name);
      continue;
    }
    sounds[info.id] = bytesToBase64(new Uint8Array(await wav.arrayBuffer()));
  }
  return { sounds, missing };
}

/** Save the song. `saveAs` always asks where; otherwise the same file is reused when possible. */
export async function saveToFile(saveAs = false): Promise<void> {
  const song = useStore.getState().history.present;
  const suggested = `${safeFileName(song.name, "JuraDAW song")}${FILE_EXTENSION}`;
  const w = window as PickerWindow;
  const toast = (text: string, kind: "success" | "error" | "info") => useStore.getState().toast(text, kind);
  try {
    // Ask where first (the browser only lets us within the click), then gather the sounds.
    if (w.showSaveFilePicker && (!currentHandle || saveAs)) currentHandle = await w.showSaveFilePicker({ suggestedName: suggested, types: FILE_TYPES });
    const { sounds, missing } = await soundsOf(song);
    // In pieces, so a song with long recordings is never held as one giant piece of text.
    const file = new Blob(songFileParts(song, sounds), { type: FILE_MIME });
    const lost = missing.length ? ` (${missing.length === 1 ? `the sound "${missing[0]}" wasn't` : `${missing.length} sounds weren't`} in this browser, so couldn't be put in the file)` : "";
    if (w.showSaveFilePicker && currentHandle) {
      const out = await currentHandle.createWritable();
      await out.write(file);
      await out.close();
      useStore.getState().markSaved(currentHandle.name);
      toast(`Saved ${currentHandle.name}${lost}`, missing.length ? "info" : "success");
      return;
    }
    downloadFile(file, suggested);
    useStore.getState().markSaved(suggested);
    toast(`Saved ${suggested} to your Downloads folder${lost}`, missing.length ? "info" : "success");
  } catch (e) {
    if (isCancel(e)) return;
    // Too much sound for one file: nothing is wrong with the place it was being saved to, and the words say what to do.
    if (said(e) === SAVE_TOO_BIG) {
      toast(SAVE_TOO_BIG, "error");
      return;
    }
    currentHandle = null;
    toast(`Couldn't save: ${said(e)}`, "error");
  }
}

function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.className = "file-input";
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      resolve(files);
    };
    document.body.appendChild(input);
    input.click();
  });
}

/** Open a song file chosen by the user (a sound or MIDI file chosen there is brought in instead). */
export async function openFromFile(): Promise<void> {
  const w = window as PickerWindow;
  try {
    if (w.showOpenFilePicker) {
      const [handle] = await w.showOpenFilePicker({ types: OPEN_TYPES });
      if (!handle) return;
      const file = await handle.getFile();
      if ((await openFile(file)) && !isImportFile(file)) currentHandle = handle;
      return;
    }
  } catch (e) {
    if (isCancel(e)) return;
    useStore.getState().toast(`Couldn't open: ${said(e)}`, "error");
    return;
  }
  // Other browsers: the ordinary file picker.
  for (const file of await pickFiles(`${FILE_EXTENSION},application/json,${IMPORT_ACCEPT}`, false)) await openFile(file);
}

/** Bring sound files and MIDI files in, chosen by the user. */
export async function importFromFile(): Promise<void> {
  const w = window as PickerWindow;
  try {
    if (w.showOpenFilePicker) {
      const handles = await w.showOpenFilePicker({ types: IMPORT_TYPES, multiple: true });
      const files: File[] = [];
      for (const handle of handles) files.push(await handle.getFile());
      await openFiles(files);
      return;
    }
  } catch (e) {
    if (isCancel(e)) return;
    useStore.getState().toast(`Couldn't open: ${said(e)}`, "error");
    return;
  }
  await openFiles(await pickFiles(IMPORT_ACCEPT, true));
}

/** Several files at once (dropped on the window, or picked): sounds go one after another on the same track. */
export async function openFiles(files: File[]): Promise<void> {
  const sounds = files.filter((f) => isSoundFile(f));
  for (const f of files) if (!sounds.includes(f)) await openFile(f);
  if (sounds.length) await importSounds(sounds);
}

/** Open a file (from a picker, or dropped on the window). Returns true if it worked. */
export async function openFile(file: File): Promise<boolean> {
  if (isMidiFile(file.name)) return importMidi(file);
  if (isSoundFile(file)) return importSounds([file]);
  const s = useStore.getState();
  let text: string;
  try {
    text = await file.text();
  } catch (e) {
    s.toast(`Couldn't read ${file.name}: ${said(e)}`, "error");
    return false;
  }
  const result = readSongFile(text, file.name);
  if (!result.ok) {
    s.toast(result.error, "error");
    return false;
  }
  // The song that's open has changes that are in no file: ask before it's replaced (Undo can't bring it back).
  if (hasUnsavedChanges(useStore.getState()) && !window.confirm(`Open ${file.name}? The song you have open has changes that aren't saved to a file yet — they'd be lost.`)) return false;
  const song = result.song.name === "Untitled song" ? { ...result.song, name: nameFromFileName(file.name) || result.song.name } : result.song;
  // The sounds first, so the song plays as soon as it's in.
  const engine = getEngine();
  let lost = result.missingSounds.length;
  for (const info of song.audio) {
    const base64 = result.sounds[info.id];
    const bytes = base64 ? base64ToBytes(base64) : null;
    if (!bytes) continue;
    try {
      await engine.putAudioWav(info, new Blob([bytes as BlobPart], { type: "audio/wav" }));
    } catch {
      lost++;
    }
  }
  if (getEngine().state().playing) getEngine().stop();
  s.loadSong(song, file.name);
  currentHandle = null;
  soundsChanged();
  forgetUnusedSounds();
  useStore.getState().requestFit();
  useStore.getState().toast(lost ? `Opened ${file.name}, but ${lost === 1 ? "one of its sounds is" : `${lost} of its sounds are`} missing from the file, so some clips will be silent.` : `Opened ${file.name}.`, lost ? "info" : "success");
  return true;
}

/**
 * Sound files as clips: on the selected track if it's a sound track (otherwise a new one), one after another from
 * the play position — or from the first free place after it, never on top of a clip that's already there.
 */
export async function importSounds(files: File[]): Promise<boolean> {
  const engine = getEngine();
  let any = false;
  let at: number | null = null;
  let trackId: string | null = null;
  for (const file of files) {
    const s = useStore.getState();
    if (file.size > 300 * 1024 * 1024) {
      s.toast(`${file.name} is too big to bring in (over 300 MB).`, "error");
      continue;
    }
    try {
      const info = await engine.importAudio(file, nameFromFileName(file.name) || file.name);
      const now = useStore.getState();
      const song = now.history.present;
      if (trackId === null) {
        const selected = song.tracks.find((t) => t.id === now.selectedTrackId);
        trackId = selected?.kind === "audio" ? selected.id : now.addTrack("audio");
        if (!trackId) {
          now.toast(`A song can have ${MOST_TRACKS} tracks at most, so there's no room for ${file.name}. Select a sound track and import again.`, "error");
          return any;
        }
      }
      const beats = (info.seconds * song.bpm) / 60;
      const wanted: number = at ?? now.cursor;
      const start: number = freePlace(useStore.getState().history.present, trackId, wanted, beats);
      useStore.getState().addAudioClip(trackId, start, info);
      at = start + beats;
      any = true;
      soundsChanged();
      useStore.getState().toast(`Brought in ${file.name} as a clip${start > wanted + 1e-6 ? ", after what was already on the track" : ""}. Undo takes it away again.`, "success");
    } catch (e) {
      s.toast(e instanceof Error && e.message ? e.message : `Couldn't read ${file.name} as sound.`, "error");
    }
  }
  if (any) useStore.getState().requestFit();
  return any;
}

/** A MIDI file: it becomes the song if the song is empty, otherwise its tracks are added to this one. */
export async function importMidi(file: File): Promise<boolean> {
  const s = useStore.getState();
  let incoming: Song | null = null;
  /** Things worth telling about the file (a time signature a song can't have…), said after the news that it came in. */
  let remarks = "";
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    incoming = midiToSong(bytes, nameFromFileName(file.name) || "MIDI file");
    remarks = (midiTracks(bytes)?.remarks ?? []).join(" ");
  } catch (e) {
    s.toast(e instanceof Error && e.message ? e.message : `Couldn't read ${file.name} as a MIDI file.`, "error");
    return false;
  }
  if (!incoming) {
    s.toast(`${file.name} isn't a MIDI file JuraDAW can read.`, "error");
    return false;
  }
  if (!incoming.tracks.length) {
    s.toast(`${file.name} has no notes in it.`, "error");
    return false;
  }
  const song = s.history.present;
  if (!song.tracks.length) {
    // Into the empty song (its tempo and name come along); Undo goes back to empty.
    s.commit({ ...incoming, audio: [], loop: incoming.loop ?? song.loop });
    useStore.getState().selectTrack(incoming.tracks[0].id);
    useStore.getState().requestFit();
    useStore.getState().toast(`Brought in ${file.name}: ${incoming.tracks.length} ${incoming.tracks.length === 1 ? "track" : "tracks"}.`, "success");
    if (remarks) useStore.getState().toast(remarks, "info");
    return true;
  }
  const room = MOST_TRACKS - song.tracks.length;
  if (room <= 0) {
    s.toast(`A song can have ${MOST_TRACKS} tracks at most, so there's no room for ${file.name}.`, "error");
    return false;
  }
  // Added to this song with fresh ids, so nothing clashes; this song's tempo stays.
  const tracks = incoming.tracks.slice(0, room);
  const trackIds = new Map(tracks.map((t) => [t.id, newId("t")]));
  // Each takes the next colour after this song's tracks, as a track added by hand would.
  const added: Track[] = [];
  for (const t of tracks) added.push({ ...t, id: trackIds.get(t.id)!, colour: nextTrackColour([...song.tracks, ...added]) });
  const clips = incoming.clips
    .filter((c) => trackIds.has(c.trackId) && c.kind === "midi")
    .map((c) => ({ ...c, id: newId("c"), trackId: trackIds.get(c.trackId)! }));
  s.commit({ ...song, tracks: [...song.tracks, ...added], clips: [...song.clips, ...clips] });
  useStore.getState().selectTrack(added[0].id);
  useStore.getState().requestFit();
  const left = incoming.tracks.length - tracks.length;
  useStore
    .getState()
    .toast(`Added ${added.length} ${added.length === 1 ? "track" : "tracks"} from ${file.name}${left > 0 ? ` (${left} more didn't fit)` : ""}. This song keeps its own tempo (${song.bpm}); the file's was ${incoming.bpm}.`, "success");
  if (remarks) useStore.getState().toast(remarks, "info");
  return true;
}

/** New: an empty song. Asks first only if there are changes not yet saved to a file. */
export function newSongAsk(): void {
  const s = useStore.getState();
  if (hasUnsavedChanges(s) && !window.confirm("Start a new, empty song? This one has changes that aren't saved to a file yet — they'd be lost.")) return;
  if (getEngine().state().playing || s.recording) getEngine().stop();
  s.newSong();
  currentHandle = null;
  // (New can be undone, so the sounds of the song it replaced are still kept; older ones can go.)
  forgetUnusedSounds();
}

/** Forget the file (after New), so the next Save asks where to save. */
export function forgetFile(): void {
  currentHandle = null;
}
