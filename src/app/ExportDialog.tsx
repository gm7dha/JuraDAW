/**
 * Export: the song as a sound file (WAV, mixed down by the engine, with a
 * progress bar) or as a MIDI file — the whole song, or just the loop.
 */
import { useEffect, useRef, useState } from "react";

import { getEngine } from "../audio/engine";
import { renderTail } from "../audio/render";
import { songToMidi } from "../midi/midiFile";
import { useStore } from "../model/store";
import type { Song } from "../model/types";
import { downloadFile, safeFileName } from "./download";
import { Icons } from "./icons";
import { Modal } from "./Modal";
import { barBeat, clockText, lengthWords, songBeats, timeLeftWords, withoutSoundEnding } from "./songUi";

/** The notes between two places of the song, moved to start at the beginning (for a MIDI file of just the loop). */
function between(song: Song, from: number, to: number): Song {
  const clips = song.clips.flatMap((c) => {
    if (c.kind !== "midi") return [];
    const notes = c.notes
      .filter((n) => n.start < c.length && c.start + n.start >= from - 1e-6 && c.start + n.start < to - 1e-6)
      .map((n) => ({ ...n, start: c.start + n.start - from, length: Math.min(n.length, c.length - n.start, to - (c.start + n.start)) }));
    return notes.length ? [{ ...c, start: 0, length: to - from, notes }] : [];
  });
  return { ...song, clips };
}

export function ExportDialog() {
  const song = useStore((s) => s.history.present);
  const closeDialog = useStore((s) => s.closeDialog);
  const [kind, setKind] = useState<"wav" | "midi">("wav");
  const [what, setWhat] = useState<"song" | "loop">("song");
  const [name, setName] = useState(song.name);
  const [progress, setProgress] = useState<number | null>(null);
  const toast = useStore.getState().toast;

  const end = songBeats(song);
  const loop = song.loop;
  const hasNotes = song.clips.some((c) => c.kind === "midi" && c.notes.length > 0);
  const hasSound = song.clips.some((c) => c.kind === "audio");
  const empty = song.clips.length === 0 || (kind === "midi" && !hasNotes);
  const from = what === "loop" ? loop.start : 0;
  const to = what === "loop" ? loop.end : end;
  const seconds = ((to - from) * 60) / song.bpm;
  const base = safeFileName(withoutSoundEnding(name), "JuraDAW song");
  const busy = progress !== null;
  /** Stops the mixdown that's under way (the Stop button, Esc, the ✕). */
  const stopper = useRef<AbortController | null>(null);
  const startedAt = useRef(0);
  const tail = renderTail(song);
  // Closing the window any other way stops it too.
  useEffect(() => () => stopper.current?.abort(), []);

  const stop = () => stopper.current?.abort();

  const save = async () => {
    if (empty || busy || to <= from) return;
    if (kind === "midi") {
      const bytes = songToMidi(what === "loop" ? between(song, from, to) : song);
      const file = `${base}.mid`;
      downloadFile(new Blob([bytes as BlobPart], { type: "audio/midi" }), file);
      toast(`Saved ${file} to your Downloads folder. It holds the notes${hasSound ? " (recordings can't go in a MIDI file)" : ""}; other music programs can open it.`, "success");
      closeDialog();
      return;
    }
    const control = new AbortController();
    stopper.current = control;
    startedAt.current = Date.now();
    setProgress(0);
    try {
      const wav = await getEngine().renderWav(song, {
        ...(what === "loop" ? { fromBeat: from, toBeat: to } : {}),
        onProgress: (share) => !control.signal.aborted && setProgress(Math.max(0, Math.min(1, share))),
        signal: control.signal,
      });
      if (control.signal.aborted) return;
      const file = `${base}.wav`;
      downloadFile(wav, file, "audio/wav");
      toast(`Saved ${file} to your Downloads folder. It plays on any phone or computer.`, "success");
      setProgress(null);
      closeDialog();
    } catch (e) {
      stopper.current = null;
      setProgress(null);
      // Stopped on purpose: the window stays as it was, ready to try again.
      if (control.signal.aborted || (e instanceof Error && e.name === "AbortError")) {
        toast("Stopped. No sound file was made.", "info");
        return;
      }
      toast(e instanceof Error && e.message ? e.message : "Couldn't make the sound file.", "error");
    }
  };

  return (
    <Modal title="Export" onClose={() => (busy ? stop() : closeDialog())} width={520}>
      <div className="field-label" style={{ marginTop: 0 }}>
        Export as
      </div>
      <div className="segmented two" role="radiogroup" aria-label="Export as">
        <button type="button" role="radio" aria-checked={kind === "wav"} className={kind === "wav" ? "selected" : ""} disabled={busy} onClick={() => setKind("wav")}>
          <Icons.Speaker size={16} /> Sound file (WAV)
        </button>
        <button type="button" role="radio" aria-checked={kind === "midi"} className={kind === "midi" ? "selected" : ""} disabled={busy} onClick={() => setKind("midi")}>
          <Icons.Note size={16} /> MIDI file (.mid)
        </button>
      </div>
      <p className="dialog-hint export-hint">
        {kind === "wav"
          ? "Everything you hear, mixed into one sound file in your Downloads folder. It plays on any phone or computer and can be sent by e-mail or message; a three-minute song is about 30 MB."
          : "Just the notes, for opening in another music program. Each instrument track becomes a track in the file; recordings are left out."}
      </p>

      <div className="field-label">What to export</div>
      <div className="segmented two" role="radiogroup" aria-label="What to export">
        <button type="button" role="radio" aria-checked={what === "song"} className={what === "song" ? "selected" : ""} disabled={busy} onClick={() => setWhat("song")}>
          The whole song
        </button>
        <button type="button" role="radio" aria-checked={what === "loop"} className={what === "loop" ? "selected" : ""} disabled={busy} onClick={() => setWhat("loop")} title="The part under the yellow strip in the ruler">
          Just the loop
        </button>
      </div>
      <p className="dialog-hint export-hint">
        {what === "loop" ? `Bar ${barBeat(loop.start, song.beatsPerBar).text} to bar ${barBeat(loop.end, song.beatsPerBar).text}` : "From the start to the end of the last clip"}: {lengthWords(to - from, song.beatsPerBar)}, about{" "}
        {clockText(seconds)} at {song.bpm} beats a minute{kind === "wav" ? ` (plus ${Math.round(tail * 10) / 10} seconds at the end for the sound to die away)` : ""}.
      </p>

      <label className="field export-name">
        <span>File name</span>
        <span className="field-input">
          <input value={name} disabled={busy} spellCheck={false} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save()} aria-label="File name" />
          <span className="unit">{kind === "wav" ? ".wav" : ".mid"}</span>
        </span>
      </label>

      {empty && (
        <p className="dialog-hint attention">
          <Icons.Warning size={16} /> {song.clips.length === 0 ? "There's nothing in the song to export yet." : "There are no notes in the song, so a MIDI file would be empty. Export a sound file instead."}
        </p>
      )}
      {busy && (
        <div className="export-progress" role="progressbar" aria-label="Making the sound file" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress ?? 0) * 100)}>
          <div className="progress-track">
            <div className="progress-bar" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
          </div>
          <span className="muted small">
            Making the sound file… {Math.round((progress ?? 0) * 100)}% — {timeLeftWords(Date.now() - startedAt.current, progress ?? 0)}
          </span>
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="text-button" onClick={() => (busy ? stop() : closeDialog())} title={busy ? "Stop making the sound file" : undefined}>
          {busy ? "Stop" : "Cancel"}
        </button>
        <button type="button" className="primary-button" onClick={() => void save()} disabled={empty || busy || to <= from}>
          <Icons.Export size={18} /> {kind === "wav" ? "Save sound file" : "Save MIDI file"}
        </button>
      </div>
    </Modal>
  );
}
