# JuraDAW

**A free, open-source music studio in your browser — many tracks, built-in instruments, MIDI and recording, made to be easy to find your way round.** Sister program to [JuraCAD](https://github.com/gm7dha/JuraCAD) and [JuraCUT](https://github.com/gm7dha/JuraCUT).

▶ **Use it:** https://gm7dha.github.io/JuraDAW/ (Chrome or Edge recommended)

JuraDAW runs entirely in your browser. Your songs and recordings never leave your computer, there's no account, and
it's free.

> **Status: v0.3 preview.** Add tracks, play the built-in instruments, draw or record notes, record sound, mix, and
> export the song as a sound file — or ask Claude to write the music with you. See the [roadmap](docs/DESIGN.md#roadmap).

## What you can do today

- **Tracks**: up to 32, each an instrument to play or a track for recorded sound, with its own colour, volume,
  left–right, Mute and Solo. An empty song offers three ways to begin: play an instrument, make a drum beat, or record
  sound.
- **Built-in instruments**, made in the browser so nothing has to download: piano, electric piano, organ, strings, a
  soft pad, bass guitar, synth bass, synth lead, pluck, bells, and a drum kit of thirteen drums and cymbals.
- **Clips** on a timeline of bars and beats: drag to move them (they snap to the grid; hold Shift not to), drag an
  edge to make them longer or shorter, split with the Scissors, join, repeat, duplicate, copy and paste, rename. A
  **right-click menu** has the lot. Drag something to the edge of the view and the view scrolls along. Nothing is put
  on top of a clip that's already there: a second take, a pattern or an imported sound goes after it or on a track of
  its own.
- **The note editor** (a piano roll) along the bottom: double-click a clip to see its notes, draw new ones, drag them
  about, change how long and how hard each is played, move them up or down an octave, and **Tidy timing** to put them
  exactly on the grid. Drum tracks list the drums by name.
- **Keys**: an on-screen piano (drum pads for a drum kit) to play with the mouse, your fingers, or the computer's
  keyboard — tick *Play with the computer keyboard* and A W S E D F T G Y H U J K become a piano. A plug-in
  **MIDI keyboard** (Chrome, Edge and other browsers with Web MIDI) is connected with *Connect a MIDI keyboard*, in
  the Keys panel or Settings, and by itself from then on.
- **Record**: the notes you play onto an instrument track, or the microphone onto a sound track, with a metronome and
  a count-in.
- **Loop** a part of the song while you work on it: drag across the yellow strip in the ruler, then drag its ends to
  stretch it or its middle to slide it along.
- **The mixer**: every track side by side with its fader, level meter, left–right, **reverb** and **echo**, and a
  Master strip.
- **The Library**: 35 ready-made drum beats, bass lines, chord sequences and tunes, in any key, to drop in and change
  like any other clip. Listen before you choose. Each goes on a track that suits it (a bass line gets a bass).
- **Import** sound files (WAV, MP3 and whatever else your browser plays) as clips, and MIDI files as tracks of notes.
- **Export** the song — or just the looped part — as a **WAV** sound file that plays anywhere, or as a **MIDI** file
  for other music programs. A long export shows how long is left and can be stopped.
- **Undo** for everything, with a **History** list to jump straight back to any of the last 100 steps.
- **Save** to a `.juradaw` file, which holds the song and its recordings in one file, and open it later (or drag it
  onto the window). Your latest work is also kept in the browser. **Install it as an app** (Chrome/Edge) so it opens
  in its own window and works offline. Light and dark.

## Make music with Claude

JuraDAW comes with a free extension for the [Claude desktop app](https://claude.ai/download). Describe some music in
plain English — "a slow blues in A with drums, a walking bass and piano chords" — and Claude writes it a part at a
time, as tracks, clips and notes you can see, play and change.

1. In JuraDAW, open **Help › Use JuraDAW with Claude** and download the extension (one file, `juradaw-claude.mcpb`).
2. Double-click it (or drag it onto Claude's window) and click Install.
3. Start a new chat in Claude and ask for a song. Songs are saved in Documents › JuraDAW; open them here with Open.

**Live with Claude**: click **Connect to Claude** in JuraDAW's top bar and Claude works on the song you have open,
while you watch and listen. Each of its changes is one step you can undo. The link stays on your computer and only
the JuraDAW website can use it. Claude works with notes; recording sound and saving a sound file are done in JuraDAW.

## Finding your way round

The layout follows Apple's Logic Pro, so it will feel familiar if you've seen that — and is explained in **Help** (the
**?** button) if you haven't.

1. **Top bar**: the song's name, New / Open / Import / Save, and Export.
2. **Toolbar**: the tools (Select, Pencil, Eraser, Scissors), Undo, then Play, Record, Loop and the metronome with the
   position, tempo and beats in a bar in the middle; Snap, Add track, the Library, and what shows along the bottom.
3. **On the left**: the settings of whatever is selected — a track's instrument, volume, reverb and echo, or a clip's
   name and length.
4. **The tracks**: each track's name, Mute and Solo down the left, its clips along the bars to the right.
5. **Along the bottom**: the note **Editor**, the **Mixer** or the **Keys**.

## How it's built

- **TypeScript + React + Vite**, state in **Zustand** — the same as JuraCAD and JuraCUT. All sound is made with the
  browser's Web Audio, in JuraDAW's own code: the instruments and drums are built from oscillators, noise and filters
  rather than recordings, so the whole app is small and works offline. Reading and writing WAV and MIDI files is its
  own code too.
- Every change runs automated tests and a browser smoke test on GitHub Actions and, once merged to `main`, publishes
  to GitHub Pages.

See [docs/DESIGN.md](docs/DESIGN.md) for the design, decisions and roadmap.

### Developing

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests
npm run build      # production build into dist/
npm run smoke      # drives the build in headless Chromium
```

## Licence

JuraDAW is MIT licensed (see [LICENSE](LICENSE)). It uses [React](https://react.dev) (MIT) and
[Zustand](https://github.com/pmndrs/zustand) (MIT), and ships no sound samples or fonts of anyone else's. The
extension for Claude also bundles the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk)
(MIT) and what it needs; their licences are in the extension's THIRD-PARTY-NOTICES.txt.
