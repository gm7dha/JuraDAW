/**
 * The shape of the app's state (`useStore` in src/model/store.ts implements
 * `State`). As in JuraCUT: every change to the song goes through `commit`,
 * which records one undo step (up to 100); drags use dragStart / dragUpdate /
 * dragEnd so a whole drag is one step. Zustand selectors must not return a
 * fresh array or object each call.
 */
import type { RecordedTake } from "../audio/engineApi";
import type { Arp, AudioInfo, FilterWobble, Harmony, Clip, Loop, Note, Song, Sweep, Track, TrackFilter, TrackKind } from "./types";

/** Select = pick, move, resize. Pencil = draw clips and notes. Eraser = click to remove. Scissors = split a clip. */
export type Tool = "select" | "pencil" | "eraser" | "scissors";
export type DialogName = "export" | "help" | "whatsNew" | "library" | "settings" | null;
/** What's open along the bottom (as in Logic): the piano roll / clip editor, the mixer, the on-screen keys, or nothing. */
export type BottomPanel = "editor" | "mixer" | "automation" | "keys" | null;
/** Snap grid in beats: 1 = beat, 0.5 = 1/8 note, 0.25 = 1/16, 0.125 = 1/32, 0 = off, "bar" = whole bars. */
export type Snap = "bar" | 1 | 0.5 | 0.25 | 0.125 | 0;

/** What may be changed on a clip: any field of either kind of clip but its id and kind (fields of the other kind are ignored; `sweep: null` takes a filter sweep off). */
export type ClipPatch = Clip extends infer C ? (C extends Clip ? Partial<Omit<C, "id" | "kind" | "sweep" | "reverse">> & { sweep?: Sweep | null; reverse?: boolean } : never) : never;

/** What may be changed on a track (for the filter, just the parts that change). */
export type TrackPatch = Partial<Omit<Track, "id" | "kind" | "filter" | "arp" | "harmony" | "filterWobble">> & { filter?: Partial<TrackFilter>; arp?: Partial<Arp> | null; harmony?: Partial<Harmony> | null; filterWobble?: Partial<FilterWobble> | null };

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "success" | "error";
}

export interface History {
  past: Song[];
  present: Song;
  future: Song[];
}

export interface State {
  history: History;
  /** The track whose settings show and that the keys play / Record records to. */
  selectedTrackId: string | null;
  selectedClipIds: string[];
  /** The midi clip open in the editor (piano roll), if any. */
  editingClipId: string | null;
  /** Notes picked in the clip being edited. */
  selectedNoteIds: string[];
  tool: Tool;
  dialog: DialogName;
  bottomPanel: BottomPanel;
  snap: Snap;
  toasts: Toast[];
  theme: "light" | "dark";
  fileName: string | null;
  /** The song as last saved to a file (to show "unsaved changes"). */
  savedSong: Song | null;
  /** Why the song isn't being kept in the browser (null = it is). */
  storageProblem: string | null;

  /** Mirrors of the engine's state, set by the app's glue (src/app/engineApp.ts). */
  playing: boolean;
  recording: boolean;
  countingIn: boolean;
  /** Where Play starts from: the place last clicked on the ruler (beats). */
  cursor: number;
  metronome: boolean;
  /** Bars counted in before recording (0–2). */
  countIn: number;
  /** Bumped to ask the tracks view to zoom so the whole song fits. */
  fitRequest: number;

  // ── history ──
  commit: (song: Song) => void;
  undo: () => void;
  redo: () => void;
  /** Negative = that many steps back, positive = forward. */
  jumpHistory: (offset: number) => void;
  dragStart: () => void;
  dragUpdate: (song: Song) => void;
  dragEnd: () => void;

  // ── the whole song ──
  newSong: () => void;
  /** Replace the song (Open, a recent song): clears undo and the selection. */
  loadSong: (song: Song, fileName: string | null) => void;
  markSaved: (fileName?: string) => void;
  setName: (name: string) => void;
  setBpm: (bpm: number) => void;
  setBeatsPerBar: (beats: number) => void;
  setMaster: (volume: number) => void;
  /** Not an undo step. */
  setLoop: (loop: Partial<Loop>) => void;

  // ── tracks ──
  /** Adds a track (after the selected one), selects it, returns its id; null at MOST_TRACKS. */
  addTrack: (kind: TrackKind, instrument?: string) => string | null;
  removeTrack: (id: string) => void;
  duplicateTrack: (id: string) => void;
  updateTrack: (id: string, patch: TrackPatch) => void;
  /** −1 = up, 1 = down. */
  moveTrack: (id: string, by: number) => void;
  selectTrack: (id: string | null) => void;

  // ── clips ──
  /** A new empty midi clip (snapped by the caller), selected and opened in the editor; its id. */
  addMidiClip: (trackId: string, start: number, length: number) => string;
  /** Put a sound on a track as a clip (adds `info` to song.audio if new); its id. */
  addAudioClip: (trackId: string, start: number, info: AudioInfo) => string;
  /** What a recording made: a new clip on its track, selected. */
  addTake: (take: RecordedTake) => void;
  updateClip: (id: string, patch: ClipPatch) => void;
  /** Move the selected clips by beats and by a number of tracks (kept on tracks of their own kind and at ≥ 0). */
  moveSelectedClips: (byBeats: number, byTracks: number) => void;
  /** Split a clip in two at a place in the song (beats); nothing if outside it. */
  splitClip: (id: string, at: number) => void;
  /** Join the selected midi clips of one track into one. */
  joinSelectedClips: () => void;
  duplicateSelectedClips: () => void;
  /** Repeat the selected clips `times` more times straight after themselves. */
  repeatSelectedClips: (times: number) => void;
  removeClips: (ids: string[]) => void;
  selectClips: (ids: string[]) => void;
  /** Open a midi clip in the editor (bottom panel "editor"); null closes it. */
  editClip: (id: string | null) => void;

  // ── notes of the clip being edited ──
  /** Add a note to a clip (selected); its id. The clip grows if the note runs past its end. */
  addNote: (clipId: string, note: Omit<Note, "id">) => string;
  updateNotes: (clipId: string, patches: { id: string; patch: Partial<Omit<Note, "id">> }[]) => void;
  removeNotes: (clipId: string, ids: string[]) => void;
  selectNotes: (ids: string[]) => void;
  /** Selected notes (or all of the clip if none are): starts moved onto the grid (beats). */
  quantise: (grid: number) => void;
  transpose: (semitones: number) => void;
  setVelocity: (velocity: number) => void;

  // ── things that act on "what's selected" ──
  /** Delete: the selected notes if any, else the selected clips. */
  removeSelected: () => void;
  selectAll: () => void;
  copySelected: () => void;
  cutSelected: () => void;
  /** Paste at the cursor (clips, onto the selected track when its kind fits) or into the clip being edited (notes). */
  paste: () => void;

  // ── library ──
  /** Put a ready-made pattern (src/library) in the song at the cursor: on the selected track if it suits, else a new track. */
  addFromLibrary: (id: string, options?: Record<string, number | string>) => void;

  // ── Live with Claude ──
  /**
   * Take a change Claude made through the live link as ONE undo step (with a message saying what it was).
   * `replace` = a whole new song (Claude started or opened one): the selection and the file name are let go.
   * Returns what's wrong in words, or null when it's done.
   */
  applyClaudeChange: (song: Song, label: string, replace: boolean) => string | null;

  // ── app ──
  setTool: (tool: Tool) => void;
  openDialog: (dialog: DialogName) => void;
  closeDialog: () => void;
  setBottomPanel: (panel: BottomPanel) => void;
  setSnap: (snap: Snap) => void;
  setCursor: (beat: number) => void;
  setMetronome: (on: boolean) => void;
  setCountIn: (bars: number) => void;
  setEngineState: (state: { playing: boolean; recording: boolean; countingIn: boolean }) => void;
  setTheme: (theme: "light" | "dark") => void;
  setStorageProblem: (problem: string | null) => void;
  requestFit: () => void;
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
}
