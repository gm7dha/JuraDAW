/**
 * Help: getting started in six short steps, then the mouse and keyboard
 * tables. Written for someone who has never used a music program.
 */
import { useRef, useState } from "react";

import { useStore } from "../model/store";
import { Modal } from "./Modal";
import { eggClick } from "./easterEgg";
import { detectPlatform, helpRows, type Platform } from "./platform";

export function HelpDialog() {
  const closeDialog = useStore((s) => s.closeDialog);
  const [platform, setPlatform] = useState<Platform>(() => detectPlatform());
  const rows = helpRows(platform);
  // A little surprise (as JuraCAD's): the Windows / Mac buttons clicked 10 times within 5 seconds.
  const clicks = useRef<number[]>([]);
  const [egg, setEgg] = useState(false);
  const choose = (p: Platform) => {
    setPlatform(p);
    const r = eggClick(clicks.current, performance.now());
    clicks.current = r.recent;
    if (r.found) setEgg(true);
  };
  return (
    <Modal title="Help and shortcuts" onClose={closeDialog} width={640}>
      <p>
        JuraDAW is a music studio in your browser. A song is made of <strong>tracks</strong> (one for each instrument or recording), and each track holds <strong>clips</strong>: blocks of notes, or
        stretches of recorded sound, laid out along the bars of the song.
      </p>
      <h3 className="help-heading">Getting started</h3>
      <ol className="help-steps">
        <li>
          <strong>Add a track</strong> with <em>Add track</em> in the toolbar: an instrument to play, a drum kit, or a track for recording sound.
        </li>
        <li>
          <strong>Play it.</strong> Open <em>Keys</em> and click the on-screen keys — or tick “Play with the computer keyboard” and use the letter keys. To change the sound, click the track and pick another
          instrument from the cards in the panel on the left.
        </li>
        <li>
          <strong>Put something in the song.</strong> Press <em>Record</em> (the red button) and play; or double-click an empty part of the track to make a clip and draw its notes in the editor; or drop in
          a ready-made beat from the <em>Library</em>.
        </li>
        <li>
          <strong>Listen.</strong> Press <kbd>Space</kbd> to play and stop. Playing starts at the <em>play position</em> (the blue line): click the numbered ruler to move it. Drag across the yellow strip
          above the ruler to repeat a part.
        </li>
        <li>
          <strong>Build it up.</strong> Add more tracks, drag clips about, repeat them, and balance the tracks in the <em>Mixer</em>. Undo takes back anything — even a deleted track.
        </li>
        <li>
          <strong>Keep it.</strong> <em>Save</em> makes a <code>.juradaw</code> file you can open again later (only JuraDAW opens it). <em>Export</em> makes a sound file (WAV) in your Downloads folder: it
          plays on any phone or computer and can be sent by e-mail or message. A three-minute song is about 30 MB.
        </li>
      </ol>
      <h3 className="help-heading">A plug-in piano keyboard (MIDI)</h3>
      <p>
        Plug it in, then press <em>Connect a MIDI keyboard</em> (in the Keys panel, or in Settings). The first time, your browser may ask to use MIDI devices: choose Allow. Then click the instrument track
        you want to play — its sound comes out as you press the keys, and Record records what you play. (Chrome and Edge can do this; Safari can't.)
      </p>
      <h3 className="help-heading">Recording your voice or an instrument</h3>
      <p>
        Add a track with <em>Record sound</em>, click it, and press <em>Record</em> (the red button). The first time, your browser asks to use the microphone: choose Allow. You hear a count-in of one bar,
        then it records until you press <kbd>Space</kbd>. Wear headphones, or the microphone will also pick up the rest of the song. The count-in can be changed (or turned off) in Settings.
      </p>
      <h3 className="help-heading">Words you'll see</h3>
      <ul className="help-list">
        <li>
          <strong>1.1</strong> (the numbers in the middle of the toolbar) — where you are in the song: bar 1, beat 1, with the time beside it. Click the tempo there to change how fast the song goes.
        </li>
        <li>
          <strong>Tempo</strong> — how fast the song goes, in beats per minute. <strong>Bar</strong> — a group of beats (usually four); the ruler counts bars.
        </li>
        <li>
          <strong>Play position</strong> — the blue line: where playing starts, and where things you paste, import or take from the Library go in.
        </li>
        <li>
          <strong>Snap</strong> — what clips and notes line up with as you drag them, so things stay in time. Hold Shift while dragging to place something freely.
        </li>
        <li>
          <strong>Loop</strong> — a part of the song that plays round and round. <strong>Metronome</strong> — a click on every beat to play along to.
        </li>
        <li>
          <strong>Mute</strong> (M) silences a track; <strong>Solo</strong> (S) lets you hear just that one. <strong>Reverb</strong> is the sound of a room; <strong>Echo</strong> is repeats that fade away.
        </li>
        <li>
          <strong>Semitone</strong> — up or down one key on the piano, black keys included (the −1 and +1 buttons). <strong>Octave</strong> — twelve keys up or down: the same note, higher or lower (−12 and
          +12).
        </li>
        <li>
          <strong>Loudness</strong> — the strip of bars under the notes in the editor: how hard each note is played. Drag a bar up or down. <strong>Tidy timing</strong> moves notes exactly onto the grid, so
          playing that was a little early or late is put right.
        </li>
        <li>
          <strong>MIDI</strong> — the way keyboards and music programs pass notes to each other. A MIDI file holds notes, not sound.
        </li>
      </ul>
      <div className="platform-row">
        <span className="muted small">Shortcuts shown for</span>
        <div className="segmented two" role="radiogroup" aria-label="Keyboard type">
          {(["windows", "mac"] as const).map((p) => (
            <button type="button" key={p} role="radio" aria-checked={platform === p} className={platform === p ? "selected" : ""} onClick={() => choose(p)}>
              {p === "mac" ? "Mac" : "Windows"}
            </button>
          ))}
        </div>
      </div>
      <h3 className="help-heading">Mouse and touch</h3>
      <table className="help-table">
        <tbody>
          {rows.mouse.map(([a, b]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="help-heading">Keys</h3>
      <table className="help-table">
        <tbody>
          {rows.keys.map(([a, b]) => (
            <tr key={a}>
              <td>
                <kbd>{a}</kbd>
              </td>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="help-heading">Shaping the sound</h3>
      <ul className="small help-steps">
        <li>
          <strong>A track's own effects</strong> are in the panel on the left, under Reverb and Echo: <em>Drive</em> (warmth, then grit, then fuzz), <em>Crush</em> (rough and lo-fi), a{" "}
          <em>Filter</em> that cuts the top or the bottom of the sound, <em>Wobble</em> (a slow drift that widens it) and <em>Pump</em> (the volume dips on every beat). Double-click a slider to turn it
          off.
        </li>
        <li>
          <strong>A clip's own shape</strong>: click a clip for its volume, <em>Fade in</em> and <em>Fade out</em> — so a part swells in rather than switching on — and <em>Sweep the filter over this
          clip</em>, which opens the track's filter up (or closes it down) while the clip plays.
        </li>
        <li>
          <strong>For a build</strong>, add a track playing <em>Noise sweep</em> and draw one long note: it rises for as long as the note lasts (a note below middle C falls instead). The Library's{" "}
          <em>Build-up</em> rolls a snare faster and faster under it.
        </li>
        <li>
          <strong>Arpeggiator</strong>: tick it under a track's effects and the chords on that track play one note at a time, in a pattern. Write long, held chords and let it do the rest.
        </li>
        <li>
          <strong>Sections</strong>: press <em>+ Section</em> by the ruler (or right-click the ruler) to name a part of the song — Intro, Verse, Chorus. Click a section to play from it,
          double-click to rename it.
        </li>
        <li>
          <strong>Key and chords</strong>: choose the song's <em>Key</em> in the note editor and the notes outside it are shaded. Press <em>Chords</em> and each note you add becomes a whole
          chord that fits. The song's settings (click an empty spot so nothing is selected) also have <em>finishing touches</em> for the whole song.
        </li>
        <li>
          <strong>More effects</strong>: <em>Squeeze</em> evens out loud and quiet, <em>Swirl</em> adds a sweeping whoosh, <em>Sway</em> swings the sound left and right, and <em>Swing</em> makes
          the off-beat notes come a little late for a groove. The filter can also <em>Keep middle</em> (a telephone sound), and <em>Filter wobble</em> opens and closes it in time with the
          song.
        </li>
        <li>
          <strong>Automation</strong>: open the <em>Automation</em> tab under the tracks (or press <em>Draw automation</em> in a track's settings) and draw a line for the selected track's{" "}
          <em>Volume</em>, <em>Filter</em> or <em>Left–right</em>: click to add a point, drag to move it, double-click to take it away. The track follows the line as the song plays — a
          fade-out at the end, a filter opening into the chorus.
        </li>
        <li>
          <strong>Harmoniser</strong>: tick it under a track's effects for extra voices that sing along — an octave below, a fifth above, a bright or dark chord, or below and above at once.
          Lovely on a recorded voice.
        </li>
        <li>
          <strong>Drum machines</strong>: the <em>808 kit</em> (trap and hip-hop) and the <em>Electronic kit</em> (house and techno) are with the instruments. A recording's clip can be played
          backwards: tick <em>Play backwards</em>.
        </li>
      </ul>
      <h3 className="help-heading">Use JuraDAW with Claude</h3>
      <p className="small">
        Describe some music in plain English — say, "a slow blues in A with drums, a walking bass and piano chords" — and Claude writes it a part at a time, as tracks, clips and notes you
        can see, play and change. It can use everything in the Library, and saves a .juradaw song (or a MIDI file). Open that file here with Open.
      </p>
      <ol className="small help-steps">
        <li>
          <a href={`${import.meta.env.BASE_URL}juradaw-claude.mcpb`} download="juradaw-claude.mcpb">
            Download the JuraDAW extension for Claude
          </a>{" "}
          (one file).
        </li>
        <li>Double-click the downloaded file (or drag it onto the Claude desktop app's window). Claude shows the install screen: click Install.</li>
        <li>Start a new chat in Claude and ask for a song. Your songs are saved in Documents › JuraDAW (you can choose another folder in the extension's settings).</li>
      </ol>
      <h3 className="help-heading">Live with Claude</h3>
      <p className="small">
        Let Claude work on the song you have open here, while you watch and listen. With the extension installed and the Claude app open, click <b>Connect to Claude</b> in the top bar (nothing
        connects until you do). The first time, your browser may ask whether JuraDAW can reach apps on this device: click Allow. A green <b>Live with Claude</b> badge shows while you're
        connected; click it to disconnect.
      </p>
      <ul className="small help-steps">
        <li>It works with every Claude chat that has JuraDAW, including chats you start after connecting (they're found within a few seconds).</li>
        <li>Ask Claude for changes in the Claude app, e.g. "add a bass line under the chords" or "make the drums busier in bars 5 to 8". Its tracks, clips and notes appear here as it works; press Play to hear them.</li>
        <li>
          Each of Claude's changes is one step you can undo ({platform === "mac" ? "⌘Z" : "Ctrl+Z"}). You can keep working too: if you both change something at the same moment, Claude's change is
          turned back and it tries again, so nothing is lost. Claude waits while you're recording or have the Library or Export open.
        </li>
        <li>Claude works with notes. Recording a voice or an instrument, and saving a sound file (Export), are done here in JuraDAW.</li>
        <li>
          Works in Chrome, Edge and Firefox. In Safari, Connect to Claude opens a small <b>JuraDAW ↔ Claude</b> window that passes messages along: allow the pop-up if Safari asks, and keep that window
          open while you work. If connecting doesn't work, ask Claude to save the song and open the .juradaw file with Open.
        </li>
        <li>The link stays on this computer: only the JuraDAW website can use it, and Claude only saves files in your JuraDAW folder.</li>
      </ul>
      <p className="muted small">
        Your song is kept in this browser as you work, and saved to a <code>.juradaw</code> file with Save. JuraDAW is free and open source (MIT):{" "}
        <a href="https://github.com/gm7dha/JuraDAW" target="_blank" rel="noreferrer">
          github.com/gm7dha/JuraDAW
        </a>
        . Its sister programs are{" "}
        <a href="https://gm7dha.github.io/JuraCAD/" target="_blank" rel="noreferrer">
          JuraCAD
        </a>{" "}
        for 3D parts and{" "}
        <a href="https://gm7dha.github.io/JuraCUT/" target="_blank" rel="noreferrer">
          JuraCUT
        </a>{" "}
        for laser cutting.
      </p>
      {egg && (
        <div className="easter-egg" role="dialog" aria-label="Surprise!" onClick={() => setEgg(false)} title="Click to close">
          <img src={`${import.meta.env.BASE_URL}easter-egg.jpg`} alt="A happy spaniel in a teal harness, standing on a carved log" />
        </div>
      )}
    </Modal>
  );
}
