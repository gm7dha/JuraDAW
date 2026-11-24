# JuraDAW — Design

JuraDAW is a free, open-source, browser-based **music studio (DAW)**: many tracks, built-in instruments played from
MIDI notes, audio recording, a mixer and export to WAV and MIDI. It is the sister program of
[JuraCAD](https://github.com/gm7dha/JuraCAD) and [JuraCUT](https://github.com/gm7dha/JuraCUT): the same stack, look,
install flow and ways of working.

**Who it's for:** a hobbyist who wants to make music without a steep learning curve. Every trade-off favours being
easy to find your way round over professional depth. Wording is plain English: "track", "clip", "notes", "tempo",
"loop" — never "region", "bus", "quantize strength", "automation lane" without explaining.

**Inspiration:** Apple's Logic Pro, for *where things are* (not its looks — the look is JuraCUT's):

- one window; a top bar, then a control bar with the transport (Go to start, Play/Stop, Record, Loop, Metronome) and
  a clear display of bar·beat, tempo and time signature in the middle;
- the settings of what's selected in a panel on the left (Logic's inspector; JuraCUT's side panel), then the track
  headers (name, instrument icon, Mute, Solo, volume) and the tracks area to their right with a bar
  ruler; a yellow **loop strip** in the ruler that you drag to set the part that repeats;
- editors open along the bottom: **Piano roll** (double-click a clip), **Mixer**, **Keys** (play with the mouse or the
  typing keyboard, as Logic's Musical Typing: A W S E D F T G Y H U J K, Z/X octave down/up);
- a **Library** of ready-made loops and patterns (drum beats, bass lines, chords) to drop in — JuraCUT's design
  library window, with search, headings and cards;
- an empty song starts with a friendly "add your first track" choice (Instrument / Drums / Record sound).

## Key decisions

| Area | Decision | Why |
| --- | --- | --- |
| Language and build | TypeScript, Vite, React 18, Zustand 5 | As JuraCAD and JuraCUT |
| Sound | Web Audio API, own code, no libraries | Works offline, nothing to license |
| Instruments | Synthesised in the browser (no samples): pianos, organ, strings, bass, leads, a drum kit | Tiny download, offline |
| Time | Beats (quarter notes) as plain numbers; audio clips in seconds | Tempo changes keep notes on the grid |
| Tracks view | DOM/SVG rows, clips as elements; playhead moved every frame from `engine.position()` | Crisp, simple, testable |
| Files | `.juradaw` JSON (sounds inside as base64 WAV), read carefully with fallbacks | One file to keep or send |
| Kept in browser | Song in localStorage, sounds in IndexedDB | A refresh never loses work; New and Open ask first when changes aren't in a file |
| Where new things go | Never on top of a clip: a pattern goes on a track that suits it (drums / bass / anything else) at the next free place, a second take on a new track like its own, an imported sound after what's there | Two clips in one place hide each other and both play |
| MIDI keyboards | Connected only from a "Connect a MIDI keyboard" button, then by themselves on later visits | The browser's permission question never appears out of nowhere |
| Messages | Above the bottom panel, clicks pass through them, the newest of each kind | Never over the keys, mixer or note editor |
| Export | WAV mixdown (OfflineAudioContext, in chunks so it shows progress and can be stopped), standard MIDI file | Plays anywhere |
| Delivery | PWA on GitHub Pages | Installs on Windows and macOS, offline, free |

## Architecture

```
src/model     types.ts (the song), storeApi.ts (the state's shape), store.ts, edits.ts (every change to a song, pure),
              document.ts (new song/track, reading songs and .juradaw files), time.ts (beats, bars, snap, note and drum
              names), clipboard.ts, historyLabel.ts, keep.ts (localStorage), changelog.ts
src/midi      midiFile.ts (pure: read and write standard MIDI files)
src/library   the pattern library, pure: theory.ts (keys, scales, chords), kit.ts (what patterns share), drums.ts,
              bass.ts, chords.ts, melodies.ts, catalogue.ts (the list, making a pattern), browse.ts (headings, search),
              patterns.ts (all of it in one place)
src/audio     engineApi.ts (the interface), engine.ts (ties the parts together), transport.ts (plays in time),
              schedule.ts (pure: what sounds when), mixer.ts (tracks → reverb and echo → master → limiter),
              instruments.ts + instrumentIcons.ts, drums.ts, patch.ts and voice.ts (building and letting go of one
              note), pluck.ts (pure: plucked string), metronome.ts, record.ts (microphone), take.ts (pure: played
              notes → a take), midiInput.ts (Web MIDI), audioStore.ts (sounds in memory and IndexedDB), wav.ts (pure),
              render.ts (mixdown), shared.ts
src/app       React: App, TopBar, Toolbar (tools, transport, display), SidePanel (on the left: the selection's
              settings), TracksView + TrackHeader + Welcome, BottomPanel with PianoRoll, Mixer and Keys, LibraryDialog,
              ExportDialog, HelpDialog, WhatsNewDialog, LiveButton (Connect to Claude; liveLink.ts wires it), HistoryMenu, ContextMenu, MenuButton, Modal, Slider, NumberBox,
              icons; and outside React: engineApp.ts (store ↔ engine glue), fileActions.ts, songUi.ts (pure: snap,
              words, songs changed by drags), zoom.ts, edgeScroll.ts, keysState.ts, addTracks.ts, prefs.ts, theme.ts,
              install.ts, platform.ts, popupGuard.ts, download.ts
src/mcp       JuraDAW for Claude, an extension for the Claude desktop app: server.ts (MCP), tools.ts (what Claude can
              do, over src/model/edits.ts), session.ts, args.ts, toolKit.ts, files.ts (its one folder), live.ts and
              websocket.ts (the extension's end of the live link)
src/live      Live with Claude, shared by the app and the extension: protocol.ts (messages and rules, pure), client.ts
              (the app's end), relayTransport.ts + relayPage.ts (Safari's link window)
tests         Vitest (pure code, and the extension with Node's own files and sockets);  scripts/smoke-test.mjs drives
              the built app in headless Chromium;  scripts/build- and check-claude-extension.mjs make and try the extension
```

Everything outside the React components of `src/app` and the Web Audio parts of `src/audio` is pure and tested. The
app keeps the song in the browser as you work (the song in localStorage, its sounds in IndexedDB) and in `.juradaw`
files when you Save.

## Roadmap

- **v0.1** — tracks, built-in instruments and drums, piano roll, audio recording and import, mixer (volume, pan, mute,
  solo, reverb, echo), loop, metronome, library of patterns, MIDI keyboard input, save/open, WAV and MIDI export,
  install, light/dark.
- **v0.2** — JuraDAW for Claude: an extension for the Claude desktop app that writes songs with the app's own code,
  and Live with Claude (Claude works on the song open in the tab), both as JuraCAD's.
- **v0.3** — shaping the sound: each track's own effects (drive, crush, a filter with resonance, wobble, pump), a
  clip's own volume, fades and filter sweep, and seven more instruments (soft piano, choir, sub and gritty basses,
  big saw, wobbly synth, noise sweep).
- **v0.4** — the 808 and electronic drum kits, an 808 bass, trap/house/techno/drum-and-bass/lo-fi beats and a
  build-up in the Library, an arpeggiator on every instrument track, Bass/Treble tone and Chop effects, recordings
  played backwards.
- **v0.5** — automation (volume, filter and left–right lines drawn over the song, in their own tab) and a
  harmoniser on every track.
- **v0.6** — acoustic instruments (guitar, harp, kalimba, marimba, flute, brass), Squeeze, Swirl and Sway, swing,
  a band filter and a filter wobble in time with the song.
- **Later** — recent songs, more effects (EQ, compressor), tempo changes, time-stretching
  audio to the tempo, sampled instruments, a link with JuraCAD/JuraCUT.
