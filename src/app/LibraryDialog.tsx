/**
 * The library window, laid out like JuraCUT's design library: a search box
 * and the patterns as cards (a small picture, name and description) under
 * headings; pick one to see its choices beside a preview of its notes, listen
 * to it, then put it in the song.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { instrumentById } from "../audio/instruments";
import type { LibraryPattern, MadePattern, PatternInput, Values } from "../library";
import { cleanValues, defaultValues, groupPatterns, LIBRARY, makePattern, patternSuitsInstrument, searchPatterns } from "../library";
import { useStore } from "../model/store";
import { DRUM_PITCHES } from "../model/time";
import type { Song } from "../model/types";
import { playPreview } from "./engineApp";
import { Icons, MarkupIcon } from "./icons";
import { Modal } from "./Modal";
import { lengthWords } from "./songUi";

function PatternCard({ pattern, onPick }: { pattern: LibraryPattern; onPick: (p: LibraryPattern) => void }) {
  return (
    <button type="button" className="library-card" onClick={() => onPick(pattern)} aria-label={`${pattern.name}: ${pattern.description}`}>
      <MarkupIcon markup={pattern.icon} />
      <span className="library-card-text">
        <b>{pattern.name}</b>
        <span className="muted small">{pattern.description}</span>
      </span>
    </button>
  );
}

/** The pattern's notes drawn as a small piano roll (drums: a row for each drum, by name). */
function Preview({ made, pattern }: { made: MadePattern | null; pattern: LibraryPattern }) {
  if (!made || !made.notes.length) return <div className="library-preview empty muted small">Nothing to show yet.</div>;
  const drums = pattern.kind === "drums";
  const pitches = [...new Set(made.notes.map((n) => n.pitch))].sort((a, b) => b - a);
  const hi = pitches[0];
  const lo = pitches[pitches.length - 1];
  const rows = drums ? pitches.length : Math.max(12, hi - lo + 3);
  const rowOf = (pitch: number) => (drums ? pitches.indexOf(pitch) : hi + 1 - pitch + Math.floor((rows - (hi - lo + 3)) / 2));
  const labelW = drums ? 64 : 0;
  const W = 400;
  const H = 300;
  const rowH = Math.min(drums ? 34 : 22, (H - 24) / rows);
  const top = (H - rowH * rows) / 2;
  const perBeat = (W - labelW - 12) / made.length;
  const beats = Math.round(made.length);
  return (
    <svg className="library-preview pattern-preview" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`The notes of ${pattern.name}`}>
      {Array.from({ length: beats + 1 }, (_, b) => (
        <line key={b} className={b % pattern.beatsPerBar === 0 ? "preview-bar" : "preview-beat"} x1={labelW + 6 + b * perBeat} x2={labelW + 6 + b * perBeat} y1={top - 4} y2={top + rowH * rows + 4} />
      ))}
      {drums &&
        pitches.map((p, i) => (
          <text key={p} className="preview-label" x={labelW} y={top + i * rowH + rowH / 2 + 3.5} textAnchor="end">
            {DRUM_PITCHES.find((d) => d.pitch === p)?.name ?? p}
          </text>
        ))}
      {made.notes.map((n, i) => (
        <rect
          key={i}
          className="preview-note"
          x={labelW + 6 + n.start * perBeat}
          y={top + rowOf(n.pitch) * rowH + 1}
          width={Math.max(3, (drums ? Math.min(n.length, 0.25) : n.length) * perBeat - 1)}
          height={Math.max(2, rowH - 2)}
          rx={Math.min(3, rowH / 4)}
          opacity={0.4 + (n.velocity / 127) * 0.6}
        />
      ))}
    </svg>
  );
}

function InputRow({ input, value, onChange }: { input: PatternInput; value: Values[string]; onChange: (v: Values[string]) => void }) {
  const id = `lib-${input.key}`;
  return (
    <div className="library-input">
      <label htmlFor={id}>{input.label}</label>
      {input.kind === "choice" ? (
        <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {input.choices?.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      ) : (
        <span className="library-number">
          <input id={id} type="number" inputMode="numeric" min={input.min} max={input.max} step={1} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
          {input.min !== undefined && input.max !== undefined && (
            <span className="muted small">
              {input.min} to {input.max}
            </span>
          )}
        </span>
      )}
      {input.help && <p className="muted small">{input.help}</p>}
    </div>
  );
}

/** One line saying where "Put in the song" will put it. */
function whereItGoes(pattern: LibraryPattern, selectedTrackName: string | null): string {
  if (selectedTrackName) return `It goes on “${selectedTrackName}”, at the play position (after any clip that's already there).`;
  const what = pattern.kind === "drums" ? "a drum track" : `${/^[aeiou]/i.test(instrumentById(pattern.instrument).name) ? "an" : "a"} ${instrumentById(pattern.instrument).name.toLowerCase()} track`;
  return `It goes on ${what} of its own, starting at the play position.`;
}

export function LibraryDialog() {
  const closeDialog = useStore((s) => s.closeDialog);
  const [search, setSearch] = useState("");
  const [pattern, setPattern] = useState<LibraryPattern | null>(null);
  const [values, setValues] = useState<Values>({});
  const [listening, setListening] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  const found = useMemo(() => searchPatterns(search), [search]);
  const groups = useMemo(() => groupPatterns(LIBRARY), []);
  const made = useMemo(() => (pattern ? makePattern(pattern, cleanValues(pattern, values)) : null), [pattern, values]);

  const stopListening = () => {
    stop.current?.();
    stop.current = null;
  };
  // Leaving the window (or going back) stops the sound.
  useEffect(() => stopListening, []);

  const pick = (p: LibraryPattern) => {
    setPattern(p);
    setValues(defaultValues(p));
  };
  const listen = () => {
    if (listening) return stopListening();
    if (!pattern || !made) return;
    const song = useStore.getState().history.present;
    const one: Song = {
      name: pattern.name,
      bpm: song.bpm,
      beatsPerBar: pattern.beatsPerBar,
      master: song.master,
      loop: { on: false, start: 0, end: made.length },
      tracks: [{ id: "library-preview", kind: "instrument", name: pattern.name, colour: "", volume: 0.8, pan: 0, mute: false, solo: false, instrument: pattern.instrument, reverb: 0.15, echo: 0 }],
      clips: [{ id: "library-preview-clip", kind: "midi", trackId: "library-preview", name: pattern.name, start: 0, length: made.length, notes: made.notes.map((n, i) => ({ ...n, id: `p${i}` })) }],
      audio: [],
    };
    setListening(true);
    stop.current = playPreview(one, () => setListening(false));
  };
  const insert = () => {
    if (!pattern || !made) return;
    stopListening();
    const s = useStore.getState();
    s.addFromLibrary(pattern.id, cleanValues(pattern, values));
    s.closeDialog();
    s.requestFit();
    const now = useStore.getState();
    const onto = now.history.present.tracks.find((t) => t.id === now.selectedTrackId);
    s.toast(`Put “${pattern.name}” in the song${onto ? ` on “${onto.name}”` : ""}. Double-click the clip to change its notes.`, "success");
  };

  // Whether the selected track is one this pattern goes onto (the store decides the same way).
  const selected = useStore((st) => st.history.present.tracks.find((t) => t.id === st.selectedTrackId));
  const suits = !!pattern && !!selected && selected.kind === "instrument" && patternSuitsInstrument(pattern, selected.instrument) ? selected.name : null;

  if (!pattern) {
    return (
      <Modal title="Library" onClose={closeDialog} width={720}>
        <p className="small">Ready-made drum beats, bass lines, chords and tunes. Each is put in the song as an ordinary clip of notes, so you can move it, repeat it or change its notes like anything you'd played yourself.</p>
        <input className="library-search" type="search" placeholder="Search the library (rock, waltz, bass…)" aria-label="Search the library" value={search} spellCheck={false} onChange={(e) => setSearch(e.target.value)} />
        {search.trim() ? (
          <section aria-live="polite">
            <h3 className="library-heading">{found.length === 0 ? "Nothing found" : `Found ${found.length} pattern${found.length > 1 ? "s" : ""}`}</h3>
            {found.length === 0 ? (
              <p className="muted small">Try another word, or clear the search to see every pattern.</p>
            ) : (
              <div className="library-grid">
                {found.map((p) => (
                  <PatternCard key={p.id} pattern={p} onPick={pick} />
                ))}
              </div>
            )}
          </section>
        ) : (
          groups.map((g) => (
            <div key={g.group}>
              <h4 className="library-group">{g.group}</h4>
              <div className="library-grid">
                {g.patterns.map((p) => (
                  <PatternCard key={p.id} pattern={p} onPick={pick} />
                ))}
              </div>
            </div>
          ))
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title={pattern.name}
      onClose={closeDialog}
      width={760}
      footer={
        <>
          <button type="button" className="text-button" onClick={() => setValues(defaultValues(pattern))} style={{ marginRight: "auto" }}>
            Usual choices
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              stopListening();
              setPattern(null);
            }}
          >
            Back
          </button>
          <button type="button" className="primary-button" onClick={insert} disabled={!made || !made.notes.length}>
            Put in the song
          </button>
        </>
      }
    >
      <p className="small">{pattern.description}</p>
      <div className="library-form">
        <div className="library-inputs">
          {pattern.inputs.length === 0 && <p className="muted small">Nothing to choose for this one: it's ready to go.</p>}
          {pattern.inputs.map((i) => (
            <InputRow key={`${pattern.id}-${i.key}`} input={i} value={values[i.key]} onChange={(v) => setValues({ ...values, [i.key]: v })} />
          ))}
        </div>
        <div className="library-side">
          <Preview made={made} pattern={pattern} />
          <div className="library-listen">
            <button type="button" className={`text-button${listening ? " active" : ""}`} onClick={listen} disabled={!made || !made.notes.length} aria-pressed={listening} title="Hear the pattern at the song's tempo before putting it in">
              {listening ? <Icons.Stop size={16} /> : <Icons.Play size={16} />} {listening ? "Stop" : "Listen"}
            </button>
            {made && (
              <span className="muted small">
                {lengthWords(made.length, pattern.beatsPerBar)} · {made.notes.length} notes · played by {instrumentById(pattern.instrument).name.toLowerCase()}
              </span>
            )}
          </div>
          <p className="muted small">{whereItGoes(pattern, suits)}</p>
        </div>
      </div>
    </Modal>
  );
}
