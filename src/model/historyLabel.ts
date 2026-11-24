/**
 * What an undo step did, in a few words (pure): worked out by comparing the
 * song before and after, so nothing has to name its own changes. Tracks,
 * clips and notes that weren't touched are the very same objects in both
 * songs (see edits.ts), so only the changed ones are looked at.
 */
import { keyWords } from "./songParts";
import { instrumentLabel } from "./document";
import type { Clip, MidiClip, Note, Song, Track } from "./types";

const quoted = (name: string) => `"${name}"`;
const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/** `the track "Piano"`, or "3 tracks". */
const tracksNamed = (tracks: readonly Track[]) => (tracks.length === 1 ? `the track ${quoted(tracks[0].name)}` : `${tracks.length} tracks`);
/** `the clip "Verse"`, or "3 clips". */
const clipsNamed = (clips: readonly Clip[]) => (clips.length === 1 ? `the clip ${quoted(clips[0].name)}` : `${clips.length} clips`);
/** "a note", or "3 notes". */
const notesCounted = (n: number) => count(n, "a note", "notes");

/** The settings of a track or clip that differ. */
function changedKeys<T extends object>(a: T, b: T): string[] {
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  return [...new Set([...Object.keys(ra), ...Object.keys(rb)])].filter((k) => ra[k] !== rb[k]);
}

function trackLabel(was: Track, now: Track): string {
  const keys = changedKeys(was, now);
  const only = (...ks: string[]) => keys.every((k) => ks.includes(k));
  const name = quoted(now.name);
  if (keys.includes("instrument")) return `Changed ${quoted(was.name)} to ${instrumentLabel(now.instrument)}`;
  if (only("name")) return `Renamed ${quoted(was.name)} to ${name}`;
  if (only("mute")) return `${now.mute ? "Muted" : "Unmuted"} ${name}`;
  if (only("solo")) return now.solo ? `Soloed ${name}` : `Took solo off ${name}`;
  if (only("volume")) return `Changed the volume of ${name}`;
  if (only("pan")) return `Moved ${name} to the ${now.pan < was.pan ? "left" : "right"}`;
  if (only("reverb")) return `Changed the reverb on ${name}`;
  if (only("echo")) return `Changed the echo on ${name}`;
  if (only("colour")) return `Changed the colour of ${name}`;
  if (only("automation")) return `Changed the automation on ${name}`;
  return `Changed the track ${name}`;
}

type NoteChange = "moved" | "up" | "down" | "length" | "velocity" | "changed";

function noteChange(was: Note, now: Note): NoteChange {
  const keys = changedKeys(was, now);
  const only = (...ks: string[]) => keys.every((k) => ks.includes(k));
  if (only("pitch")) return now.pitch > was.pitch ? "up" : "down";
  if (only("start", "pitch")) return "moved";
  if (only("length")) return "length";
  if (only("velocity")) return "velocity";
  return "changed";
}

/** What happened to the notes of clips whose notes changed (and nothing else about them that matters more). */
function notesLabel(pairs: readonly [MidiClip, MidiClip][]): string {
  let added = 0;
  let removed = 0;
  const kinds: NoteChange[] = [];
  for (const [was, now] of pairs) {
    const before = new Map(was.notes.map((n) => [n.id, n]));
    const after = new Set(now.notes.map((n) => n.id));
    for (const n of now.notes) {
      const old = before.get(n.id);
      if (!old) added++;
      else if (old !== n) kinds.push(noteChange(old, n));
    }
    removed += was.notes.filter((n) => !after.has(n.id)).length;
  }
  const changed = kinds.length;
  if (added && !removed && !changed) return `Added ${notesCounted(added)}`;
  if (removed && !added && !changed) return `Removed ${notesCounted(removed)}`;
  if (changed && !added && !removed) {
    const n = notesCounted(changed);
    const all = (k: NoteChange) => kinds.every((x) => x === k);
    if (all("up")) return `Moved ${n} up`;
    if (all("down")) return `Moved ${n} down`;
    if (kinds.every((k) => k === "moved" || k === "up" || k === "down")) return `Moved ${n}`;
    if (all("length")) return `Changed the length of ${n}`;
    if (all("velocity")) return `Changed how hard ${n} ${changed === 1 ? "is" : "are"} played`;
    return `Changed ${n}`;
  }
  return "Changed the notes";
}

type ClipChange = "moved" | "resized" | "renamed" | "gain" | "notes" | "changed";

function clipChange(was: Clip, now: Clip): ClipChange {
  const keys = changedKeys(was, now);
  const only = (...ks: string[]) => keys.every((k) => ks.includes(k));
  if (only("name")) return "renamed";
  if (only("start", "trackId")) return "moved";
  if (only("gain")) return "gain";
  // Dragging a clip's start changes where it starts, how long it is and (so they stay put in the song) its notes.
  if (keys.includes("start") || only("length") || only("duration") || only("offset", "duration")) return "resized";
  if (keys.includes("notes")) return "notes";
  return "changed";
}

const CLIP_WORDS: Record<Exclude<ClipChange, "notes" | "renamed">, string> = { moved: "Moved", resized: "Changed the length of", gain: "Changed the volume of", changed: "Changed" };

/** A few words for what changed from `before` to `after`. */
export function changeLabel(before: Song, after: Song): string {
  if (before === after) return "A small change";

  // Tracks.
  const tracksWere = new Map(before.tracks.map((t) => [t.id, t]));
  const tracksNow = new Map(after.tracks.map((t) => [t.id, t]));
  const addedTracks = after.tracks.filter((t) => !tracksWere.has(t.id));
  const removedTracks = before.tracks.filter((t) => !tracksNow.has(t.id));
  const changedTracks = after.tracks.filter((t) => tracksWere.has(t.id) && tracksWere.get(t.id) !== t);

  // Nothing of the old song left: it's another song altogether.
  const allGone = before.tracks.length > 0 && removedTracks.length === before.tracks.length;
  if (allGone && addedTracks.length) return `Opened ${quoted(after.name)}`;
  if (allGone && (removedTracks.length > 1 || before.name !== after.name)) return "Started a new song";

  if (addedTracks.length && removedTracks.length) return `Changed ${count(addedTracks.length + removedTracks.length, "a track", "tracks")}`;
  if (addedTracks.length) return `Added ${tracksNamed(addedTracks)}`;
  if (removedTracks.length) return `Removed ${tracksNamed(removedTracks)}`;

  // Clips.
  const clipsWere = new Map(before.clips.map((c) => [c.id, c]));
  const clipsNow = new Map(after.clips.map((c) => [c.id, c]));
  const addedClips = after.clips.filter((c) => !clipsWere.has(c.id));
  const removedClips = before.clips.filter((c) => !clipsNow.has(c.id));
  const changedClips = after.clips.filter((c) => clipsWere.has(c.id) && clipsWere.get(c.id) !== c);

  if (addedClips.length && removedClips.length) return `Changed ${count(addedClips.length + removedClips.length, "a clip", "clips")}`;
  if (addedClips.length) {
    // A clip that got shorter with a new one starting in the same breath: it was split.
    if (addedClips.length === 1 && changedClips.length === 1 && changedClips[0].trackId === addedClips[0].trackId && clipChange(clipsWere.get(changedClips[0].id)!, changedClips[0]) !== "moved")
      return `Split the clip ${quoted(changedClips[0].name)}`;
    return `Added ${clipsNamed(addedClips)}`;
  }
  if (removedClips.length) {
    // Clips gone and one on their track grown over them: they were joined.
    if (changedClips.length === 1 && changedClips[0].kind === "midi" && removedClips.every((c) => c.kind === "midi" && c.trackId === changedClips[0].trackId))
      return `Joined ${removedClips.length + 1} clips`;
    return `Removed ${clipsNamed(removedClips)}`;
  }
  if (changedClips.length) {
    const kinds = changedClips.map((c) => clipChange(clipsWere.get(c.id)!, c));
    const first = kinds[0];
    if (kinds.every((k) => k === first)) {
      if (first === "notes") return notesLabel(changedClips.map((c) => [clipsWere.get(c.id) as MidiClip, c as MidiClip]));
      if (first === "renamed") return changedClips.length === 1 ? `Renamed ${quoted(clipsWere.get(changedClips[0].id)!.name)} to ${quoted(changedClips[0].name)}` : `Renamed ${changedClips.length} clips`;
      return `${CLIP_WORDS[first]} ${clipsNamed(changedClips)}`;
    }
    return `Changed ${clipsNamed(changedClips)}`;
  }

  // Tracks that are still there but different, or in another order.
  if (changedTracks.length === 1) return trackLabel(tracksWere.get(changedTracks[0].id)!, changedTracks[0]);
  if (changedTracks.length > 1) {
    const labels = changedTracks.map((t) => changedKeys(tracksWere.get(t.id)!, t).join());
    if (labels.every((l) => l === "mute")) return changedTracks.every((t) => t.mute) ? `Muted ${changedTracks.length} tracks` : `Unmuted ${changedTracks.length} tracks`;
    if (labels.every((l) => l === "solo")) return "Changed which tracks are soloed";
    return `Changed ${changedTracks.length} tracks`;
  }
  if (before.tracks.some((t, i) => after.tracks[i] !== t)) return "Changed the order of the tracks";

  // The song's own settings.
  if (before.name !== after.name) return `Named the song ${quoted(after.name)}`;
  if (before.bpm !== after.bpm) return `Changed the tempo to ${Math.round(after.bpm * 100) / 100}`;
  if (before.beatsPerBar !== after.beatsPerBar) return `Changed to ${after.beatsPerBar} beats in a bar`;
  if (before.master !== after.master) return "Changed the master volume";
  if (before.key !== after.key) return after.key ? `Set the key to ${keyWords(after.key)}` : "Took the key off";
  if (before.sections !== after.sections) {
    const was = before.sections?.length ?? 0;
    const now = after.sections?.length ?? 0;
    if (now > was) return `Added the section ${quoted(after.sections!.find((s) => !before.sections?.some((b) => b.beat === s.beat))?.name ?? "")}`;
    if (now < was) return "Took a section away";
    return "Changed a section";
  }
  if (before.finish !== after.finish) return "Changed the finishing touches";
  if (before.loop.on !== after.loop.on) return after.loop.on ? "Turned the loop on" : "Turned the loop off";
  if (before.loop.start !== after.loop.start || before.loop.end !== after.loop.end) return "Changed the loop";
  if (!before.tracks.length && !after.tracks.length) return "Started a new song";
  return "A small change";
}

/** One line of the history list. */
export interface HistoryStep {
  /** How many steps away from now: negative = undo that many, positive = redo. 0 = the song as it is. */
  offset: number;
  label: string;
}

/**
 * The steps from the oldest kept to the newest, each labelled with the change that led to it. The first entry is
 * where the history starts.
 */
export function historySteps(past: readonly Song[], present: Song, future: readonly Song[]): HistoryStep[] {
  const all = [...past, present, ...future];
  const here = past.length;
  return all.map((song, i) => ({ offset: i - here, label: i === 0 ? "Where the history starts" : changeLabel(all[i - 1], song) }));
}
