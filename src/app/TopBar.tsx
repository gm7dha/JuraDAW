/**
 * The top bar, as JuraCUT's: the song's name, whether it's saved, the version
 * (click for what's new), Install, New / Open / Import / Save, Export,
 * Settings and Help.
 */
import { useEffect, useState } from "react";

import { useStore } from "../model/store";
import { MAX_BPM, MIN_BPM } from "../model/types";
import { SHORT_VERSION } from "../version";
import { Icons } from "./icons";
import { importFromFile, newSongAsk, openFromFile, saveToFile } from "./fileActions";
import { browserKind, installApp, installSteps, isInstalledApp, useCanInstall } from "./install";
import { MidiButton } from "./Keys";
import { Modal } from "./Modal";
import { NumberBox } from "./NumberBox";
import { setThemeChoice, themeChoice, type ThemeChoice } from "./theme";
import { versionIsNew } from "./WhatsNewDialog";
import { detectPlatform, shortcut } from "./platform";

export function TopBar() {
  const songName = useStore((s) => s.history.present.name);
  const setSongName = useStore((s) => s.setName);
  /** A dot on the version until its changes have been looked at. */
  const [fresh, setFresh] = useState(versionIsNew);
  const openDialog = useStore((s) => s.openDialog);
  const hasTracks = useStore((s) => s.history.present.tracks.length > 0);
  const storageProblem = useStore((s) => s.storageProblem);
  const fileName = useStore((s) => s.fileName);
  const unsaved = useStore((s) => s.savedSong !== s.history.present && s.history.present.tracks.length > 0);
  const platform = detectPlatform();
  const canInstall = useCanInstall();
  const [installHelp, setInstallHelp] = useState(false);
  const installed = isInstalledApp();
  const [name, setName] = useState(songName);

  useEffect(() => setName(songName), [songName]);

  return (
    <header className="topbar">
      <div className="brand" title="JuraDAW">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={24} height={24} />
        <span>JuraDAW</span>
      </div>
      <input
        className="doc-name"
        value={name}
        aria-label="Song name"
        title="Click to rename"
        onChange={(e) => setName(e.target.value)}
        onBlur={() => (name.trim() ? name !== songName && setSongName(name.trim()) : setName(songName))}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setName(songName);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {storageProblem && (
        <button type="button" className="save-state storage-problem" title={storageProblem} onClick={() => useStore.getState().toast(storageProblem, "error")}>
          Not kept in this browser
        </button>
      )}
      <span
        className={`save-state${unsaved ? " unsaved" : ""}`}
        title={unsaved ? "Your work is kept in this browser, but has changes not yet saved to a file. Click Save to keep a copy on your computer." : fileName ? `Saved to ${fileName}` : ""}
      >
        {unsaved ? (fileName ? "Unsaved changes" : "Not saved to a file") : fileName ? `Saved · ${fileName}` : ""}
      </span>
      <button
        type="button"
        className={`phase-badge${fresh ? " fresh" : ""}`}
        onClick={() => {
          setFresh(false);
          openDialog("whatsNew");
        }}
        title="Your JuraDAW version — click to see what's new"
      >
        {SHORT_VERSION}
        <span className="badge-extra"> preview</span>
        {fresh && <span className="badge-dot" aria-label="(new)" />}
      </button>
      <div className="topbar-spacer" />
      {!installed && (
        <button className="text-button" onClick={() => (canInstall ? void installApp() : setInstallHelp(true))} title="Install JuraDAW as an app on this computer — it then opens in its own window and works offline">
          <Icons.Export size={18} style={{ transform: "rotate(180deg)" }} /> <span className="button-label">Install</span>
        </button>
      )}
      <button className="text-button" onClick={() => newSongAsk()} title="Start a new, empty song">
        <Icons.New size={18} /> <span className="button-label">New</span>
      </button>
      <button className="text-button" onClick={() => void openFromFile()} title={`Open a .juradaw song (${shortcut(platform, "O")}). You can also drag a file onto the window.`}>
        <Icons.Open size={18} /> <span className="button-label">Open</span>
      </button>
      <button className="text-button" onClick={() => void importFromFile()} title="Bring in sound files (WAV, MP3…) as clips, or a MIDI file (.mid: the notes of a tune from another music program) as tracks of notes">
        <Icons.Import size={18} /> <span className="button-label">Import</span>
      </button>
      <button
        className="text-button"
        onClick={() => void saveToFile()}
        title={`Save to a .juradaw file on your computer (${shortcut(platform, "S")}). ${shortcut(platform, "S", { shift: true })} saves a copy under a new name.`}
      >
        <Icons.Save size={18} /> <span className="button-label">Save</span>
      </button>
      <button className="primary-button" onClick={() => openDialog("export")} disabled={!hasTracks} title="Save the song as a sound file (WAV) to play anywhere, or as a MIDI file">
        <Icons.Speaker size={18} /> <span className="button-label">Export</span>
      </button>
      <SettingsMenu />
      <button className="icon-button" onClick={() => openDialog("help")} aria-label="Help and shortcuts" title="Help and shortcuts (?)">
        <Icons.Help />
      </button>
      {installHelp && (
        <Modal title="Install JuraDAW as an app" onClose={() => setInstallHelp(false)} width={480}>
          <p>Installed, JuraDAW opens in its own window, has its own icon, and works without an internet connection.</p>
          <ol className="install-steps">
            {installSteps(browserKind()).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Modal>
      )}
    </header>
  );
}

/** Settings: the song's tempo and time signature (saved with the song), the count-in and appearance (kept on this computer). */
function SettingsMenu() {
  const open = useStore((s) => s.dialog === "settings");
  const bpm = useStore((s) => s.history.present.bpm);
  const beatsPerBar = useStore((s) => s.history.present.beatsPerBar);
  const countIn = useStore((s) => s.countIn);
  const metronome = useStore((s) => s.metronome);
  const [choice, setChoice] = useState<ThemeChoice>(themeChoice);
  // The menu is placed on the page itself (fixed), so the top bar's edge can't cut it off.
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const s = useStore.getState;
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(".settings-menu, .settings-button")) s().closeDialog();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && s().closeDialog();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open, s]);
  return (
    <div className="settings-wrap">
      <button
        className={`icon-button settings-button${open ? " active" : ""}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
          open ? s().closeDialog() : s().openDialog("settings");
        }}
        aria-label="Settings"
        aria-expanded={open}
        title="Settings — tempo, time signature, count-in, light or dark"
      >
        <Icons.Settings />
      </button>
      {open && (
        <div className="settings-menu" role="dialog" aria-label="Settings" style={at ? { top: at.top, right: at.right } : undefined}>
          <div className="field-label">Speed and beat (this song)</div>
          <div className="field-row">
            <NumberBox label="Tempo" value={bpm} unit="bpm" min={MIN_BPM} max={MAX_BPM} step={1} onCommit={(v) => s().setBpm(v)} />
            <label className="field">
              <span>Beats in a bar</span>
              <select value={beatsPerBar} onChange={(e) => s().setBeatsPerBar(Number(e.target.value))} aria-label="Beats in a bar">
                {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                  <option key={n} value={n}>
                    {n}/4{n === 4 ? " (usual)" : n === 3 ? " (waltz)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="dialog-hint">Tempo is how fast the song goes, in beats per minute: 120 is a brisk walk. Most songs have 4 beats in a bar.</p>
          <div className="field-label settings-gap">Recording (this computer)</div>
          <div className="segmented three" role="radiogroup" aria-label="Count-in before recording">
            {(
              [
                [0, "No count-in"],
                [1, "1 bar"],
                [2, "2 bars"],
              ] as const
            ).map(([bars, label]) => (
              <button type="button" key={bars} role="radio" aria-checked={countIn === bars} className={countIn === bars ? "selected" : ""} onClick={() => s().setCountIn(bars)}>
                {label}
              </button>
            ))}
          </div>
          <p className="dialog-hint">The count-in clicks for a bar or two before recording starts, so you can come in on time.</p>
          <label className="check-row settings-gap">
            <input type="checkbox" checked={metronome} onChange={(e) => s().setMetronome(e.target.checked)} />
            Metronome: click on every beat while playing
          </label>
          <div className="field-label settings-gap">MIDI keyboard (this computer)</div>
          <MidiButton wide />
          <p className="dialog-hint">A plug-in piano keyboard plays the selected instrument track. Once connected here, it's connected by itself next time.</p>
          <div className="field-label settings-gap">Appearance (this computer)</div>
          <div className="segmented three" role="radiogroup" aria-label="Appearance">
            {(
              [
                ["light", "Light"],
                ["dark", "Dark"],
                ["system", "Automatic"],
              ] as const
            ).map(([c, label]) => (
              <button
                type="button"
                key={c}
                role="radio"
                aria-checked={choice === c}
                className={choice === c ? "selected" : ""}
                title={c === "system" ? "Follow your computer's light or dark setting" : undefined}
                onClick={() => {
                  setThemeChoice(c);
                  setChoice(c);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
