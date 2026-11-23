# Notes for Claude working on JuraDAW

- The owner is a hobbyist with no coding background who directs the work. Explain changes in plain English
  in pull requests, and keep the app's wording friendly and jargon-free ("track", "clip", "notes", "tempo", "loop" —
  never "region", "bus" or "quantize" without saying what it means). The owner's words for this app: "extremely user
  friendly and easy to navigate", "I don't want a steep learning curve". Every trade-off favours being easy to find
  your way round over professional depth.
- The owner has said to merge PRs without asking once CI passes (squash merge), then tell them what changed so
  they can try it on the live site.
- JuraDAW is the sister app of JuraCAD (github.com/gm7dha/JuraCAD) and JuraCUT (github.com/gm7dha/JuraCUT): the same
  stack, look, install flow and ways of working. When something exists in JuraCUT (a dialog, a helper, a test
  pattern), copy how it's done there: `styles.css`, `Modal`, `TopBar`, the Library window, `popupGuard.ts`, `theme.ts`,
  `install.ts`, `download.ts`, `fileActions.ts`, `historyLabel.ts`, `changelog.ts` and the smoke test all began as
  JuraCUT's. Design and roadmap: `docs/DESIGN.md`. *Where things are* follows Apple's Logic Pro; the *look* is JuraCUT's.
- Stack: TypeScript (strict, no unused locals or parameters), React 18, Vite 5, Zustand 5. No other runtime
  dependencies, no sound library, no samples, fonts, CDNs or other outside files: everything is made in the browser
  and works offline.
- Time: everything is in **beats** (quarter notes) from the start of the song, as plain numbers, unless a field says
  seconds; a bar is `beatsPerBar` beats (2–12, always quarter-note beats). Pitches are MIDI note numbers (60 = middle C,
  shown as C4), velocity 1–127. Audio clips are in seconds and play at their own speed whatever the tempo, so their
  length in beats depends on the tempo (`clipLength(clip, bpm)` in time.ts).
- The song (`src/model/types.ts`, a contract file — change it only on purpose): `Song` = name, `bpm` (30–300),
  `beatsPerBar`, `master`, `loop` {on, start, end}, `tracks`, `clips` (every clip of every track, in no order), `audio`
  (an `AudioInfo` per sound: id, name, seconds, sampleRate, channels — the samples live outside the song). A `Track` is
  `instrument` (plays notes with a built-in instrument, `instrument` = an id from `INSTRUMENTS`) or `audio` (recordings
  and sound files), with colour (one of `TRACK_COLOURS`), volume, pan, mute, solo, reverb, echo. A `Clip` is `midi`
  (start, length, `notes` with start/length from the clip's start) or `audio` (audioId, `offset` and `duration` in
  seconds, gain). `MOST_TRACKS` 32, `MIN_LENGTH` 1/16 beat.
- State (`src/model/storeApi.ts` — the other model contract — implemented by `src/model/store.ts`, `useStore`): the
  song with undo (`history` past/present/future, `MAX_UNDO` 100), what's selected (`selectedTrackId`,
  `selectedClipIds`, `editingClipId` — the clip in the note editor —, `selectedNoteIds`), `tool`
  (select/pencil/eraser/scissors), `dialog`, `bottomPanel` (editor/mixer/keys/null), `snap`, toasts, mirrors of the
  engine (`playing`, `recording`, `countingIn`), `cursor` (where Play starts), `metronome`, `countIn`, `fitRequest`.
  Every change goes through `commit` (one undo step); drags use `dragStart`/`dragUpdate(song)`/`dragEnd` so a whole
  drag is one step. `setLoop` is *not* an undo step (undo and redo carry today's loop along, `withLoopOf`).
  `tidied` lets go of selected things that are no longer in the song. **Selectors must hand back the very same value
  until the state changes**: never build an array or object inside `useStore((s) => …)`; use what's in the state and
  the shared `EMPTY_*` lists.
- The changes themselves: `src/model/edits.ts` (pure: a song in, a new song out; whatever a change doesn't touch stays
  the very same object, and a change that does nothing returns the very same song — the undo list and its labels rely
  on both). Tracks (add after the selected one, remove with its clips, duplicate, update — a new instrument renames a
  track still called after the old one —, move), clips (`makeMidiClip`, `makeAudioClip`, `updateClip`, `moveClips`
  — clips only go onto tracks of their own kind, `possibleTrackMove` —, `resizeClip`, `splitClip`, `joinClips`/`canJoin`,
  `repeatClips` up to `MOST_REPEATS` (`possibleRepeats`: how many the song really has room for), `duplicateClips`,
  `removeClips`; `placeIsFree` and `freePlace` — the first place at or after a beat where a length fits on a track
  without lying over a clip, on to the next bar line when a step is given), notes (`addNote(s)`, `updateNotes`,
  `removeNotes`, `quantiseNotes` = "Tidy timing", `transposeNotes`, `setNotesVelocity`; `clipIsFull` — a clip holds
  `MOST_NOTES`. A clip grows only for the notes a change added or moved, to the end of their bar — never because of
  notes that were already past its end, so a clip made shorter stays shorter), the whole song (`setBpm`,
  `setBeatsPerBar`, `setMaster`, `setLoop` with `MIN_LOOP`, `setSongName`). Nothing may start further in, or last
  longer, than `MOST_BEATS` (document.ts).
- **Nothing is ever put on top of a clip that's already there** (two clips in one place hide each other and both
  play). The store keeps to it wherever it places something itself: `addFromLibrary` (below), `addTake` (a take that
  would lie on a clip keeps its place in time and goes on a new track like its own — same instrument and settings —
  straight after it, in one undo step, with a message), and `importSounds` in fileActions.ts (`freePlace`: after what's
  on the track). Dragging, pasting and old files can still overlap clips: `clipsOverOthers` (songUi.ts) finds the
  later one of each pair and TracksView draws it lower with a dashed top (`.clip.over`), so both can be seen.
  `src/model/time.ts` (pure: beats ↔ seconds, `positionText`, `timeText`, `snapStep`/`snapBeat`/`snapBeatDown`,
  `clipLength`/`clipEnd`/`songLength`, `pitchName`, `isBlackKey`, `DRUM_PITCHES` — the kit's thirteen sounds on their
  General MIDI numbers, in the order the drum editor lists them). `src/model/clipboard.ts` (pure: `copyClips`/
  `pasteClips` at the cursor, onto the selected track when its kind fits; `copyNotes`/`pasteNotes` into the clip being
  edited; everything pasted gets new ids; kept only while the page is open). `src/model/historyLabel.ts`
  (`changeLabel(before, after)` by diffing — unchanged things being the same objects —, `historySteps` with `offset`s)
  → `src/app/HistoryMenu.tsx` → store `jumpHistory(offset)`.
- Files: `src/model/document.ts` (pure, works in Node): `newSong`, `newTrack` (`freeTrackName`, `nextTrackColour`),
  `parseSong` (every value checked, odd ones fall back, so a damaged or hand-edited file can't break the app; at most
  `MOST_CLIPS`/`MOST_NOTES`), and the `.juradaw` file — JSON `{ app: "JuraDAW", version: 1, song, sounds }` where
  `sounds` is each sound as a base64 WAV by its id (`songFileParts` — the file as pieces for `new Blob(parts)`, so a
  song with long recordings is never one giant string; it throws an Error saying `SAVE_TOO_BIG`, words to show as they
  are, past about 300 MB of sound —, `songFileText`, `readSongFile` → song, sounds, `missingSounds`; own
  `bytesToBase64`/`base64ToBytes` so Node and every browser agree). `src/model/keep.ts` keeps the song in localStorage
  (`juradaw.song.v1`; `keepProblem` says why when the browser won't). The sounds are kept apart, in IndexedDB (below).
  Other keys on this computer: `juradaw.theme`, `juradaw.prefs.v1` (count-in, metronome and "connect MIDI keyboards
  without asking", `src/app/prefs.ts`),
  `juradaw.panelHeight`, `juradaw.seenVersion`.
- MIDI files: `src/midi/midiFile.ts` (pure: bytes in, bytes out). Reads format 0 and 1 (running status, note-on with
  velocity 0 as note-off, tempo, time signature, track names, General MIDI programs → `instrumentForProgram`, channel
  10 = drums): `readMidiFile` → `MidiData`, `midiTracks`, `midiToSong`. Writes format 1 (`writeMidiFile`, `songParts`,
  `songToMidi`: a first track with name, tempo and time signature, then one per instrument track; audio clips are left
  out). Importing one into an empty song takes its tempo and name; into a song with tracks it adds tracks with new
  ids and the song keeps its own tempo (`importMidi` in fileActions.ts).
- The pattern library (`src/library/`, pure — the DAW's twin of JuraCUT's design library): `theory.ts` (keys, major
  and minor scales, chords stacked from the scale, `PROGRESSIONS`), `kit.ts` (`LibraryPattern`: id, name, description,
  `group` heading, `kind` drums/bass/chords/melody, `instrument`, `beatsPerBar`, `inputs`, `make(values)` → plain
  notes and a length; shared inputs `keyInput`, `scaleInput`, `chordsInput`, `timesInput`, `barsInput`; `row(pitch,
  "x...x...", step)` writes a drum row the way it sounds; `patternIcon`), `drums.ts` (eleven beats and a fill; X accent, x hit, o softer, g ghost),
  `bass.ts`, `chords.ts`, `melodies.ts`, `catalogue.ts` (`LIBRARY` — 35 patterns —, `defaultValues`, `cleanValues`
  — values kept inside their limits —, `makePattern`, `findPattern`, `patternSuitsInstrument`), `browse.ts`
  (`groupPatterns` under `GROUP_ORDER`: Drum beats, Bass lines, Chords, Melodies and arps; `searchPatterns` as
  JuraCUT's), `patterns.ts` (all of it from one place). Patterns that share a key, scale and chord sequence fit
  together. `theory.ts` also has `scaleFor` (the scale a chord sequence is played in), `chordStep` and
  `sequenceChord` (the notes of a sequence's chord, with the blues' and jazz's own alterations). Store
  `addFromLibrary(id, values)`, at the cursor snapped to a bar: on the selected track when its instrument suits the
  pattern — `patternSuitsInstrument`: drum beats only on a drum kit, bass lines only on a bass (`BASS_INSTRUMENTS`),
  chords and tunes on anything else — after any clip in the way there (`freePlace`, with a message saying which bar);
  else on a track already playing the pattern's own instrument, if that's free at the place; else on a new track with
  that instrument. So a beat, chords and a bass line added one after another make three tracks, never one pile. UI `src/app/LibraryDialog.tsx`, laid out as JuraCUT's (search + cards under headings,
  then a pattern's inputs beside a preview of its notes; Listen plays it through `playPreview` without touching the
  song; Put in the song). Library styles are JuraCUT's `.library-*` rules.
- Sound (`src/audio/`): `engineApi.ts` is the third contract file — the `Engine` interface is all the rest of the app
  may use, got from `getEngine()` (`engine.ts`), the only code that touches Web Audio, the microphone and Web MIDI.
  Until `unlock()` has been called from a click or key press there is no sound context and the engine quietly does
  nothing. `engine.ts` ties together: `mixer.ts` (each track: volume and mute/solo → left–right → the mix, with its
  share to one shared reverb — a burst of fading noise — and one echo in time with the tempo; then headroom (half, so
  several tracks fit before the limiter acts — everything is about 3 dB quieter than a single note would need) →
  master → a gentle limiter → a soft ceiling nothing can pass → out; changes eased so nothing clicks; `level(id)` for
  meters, already on a decibel scale 0–1 (`meterLevel`), so the meters draw it as it comes), `transport.ts` (a 25 ms timer
  schedules the next tenth of a second on the sound clock from `schedule.ts`, asking the song afresh each time, so
  edits and tempo changes are heard while it plays and a loop goes round without a gap; stops by itself when the song
  runs out), `schedule.ts` (pure: `notesBetween`, `audioClipsBetween`, `audibleTracks` — mute and solo —,
  `nextLoopWindow`, `playEndBeat`), `instruments.ts` (`INSTRUMENTS`: piano, electric-piano, organ, strings, pad, bass,
  synth-bass, lead, pluck, bells — each a recipe that builds one note from oscillators, noise and filters, levels
  matched by measuring — and drums; `instrumentById` falls back to the piano), `drums.ts` (the kit, every hit made on
  the spot), `patch.ts` + `voice.ts` (building one note, and letting go of it without a click), `pluck.ts` (pure
  Karplus–Strong), `metronome.ts` (the click, also the count-in), `record.ts` (the microphone with the browser's
  "clean-up" off; an AudioWorklet from a Blob URL, else ScriptProcessor), `take.ts` (pure `buildMidiTake`: a take
  starts on the bar line at or before where recording began and is whole bars long), `midiInput.ts` (Web MIDI, every
  keyboard, now or plugged in later), `audioStore.ts` (the song's sounds in memory, with a WAV copy of each in
  IndexedDB "juradaw" › `sounds`; still works for the session if IndexedDB is refused), `wav.ts` (pure `encodeWav` —
  16-bit —, `decodeWav`, `peaksOf` for drawing), `render.ts` (the mixdown on an OfflineAudioContext with the same
  instruments and mixer: 44.1 kHz stereo, the song or between two beats, plus `renderTail(song)` for the sound to die away —
  `RENDER_TAIL` 2.5 s, longer when a track that can be heard sends to the echo —, in chunks so progress can show and
  `options.signal` (an AbortSignal) can stop it: it then rejects with an error named "AbortError"), `shared.ts`, `instrumentIcons.ts` (48×48 SVG markup in the text colour).
- The glue, `src/app/engineApp.ts` — apart from meters and playheads, which read the engine every frame
  (`everyFrame`, `playheadBeat`, `levelOf`, never through React state), the only place the app talks to the engine:
  `startEngineApp` (App) hands the engine the song on every change and mirrors playing/recording back
  (`setEngineState`); `unlock` on the first click or key (sound only — **MIDI keyboards are never asked for
  out of nowhere**: `connectMidi()` runs from the "Connect a MIDI keyboard" button in the Keys panel and Settings,
  toasts the keyboard's name or a friendly line when there's none or the browser can't, and remembers the yes in
  prefs so later visits connect quietly on the first click; `useMidi` for the button); `engine.onStorageProblem` → an
  error toast (a recording or import the browser couldn't keep); `forgetUnusedSounds` after New and Open
  (`engine.forgetAudio` with every sound id in the song and its undo list); `togglePlay` (from `cursor`),
  `seek`, `goToStart`, `toggleRecord` (onto the selected track: notes on an instrument track, the microphone on a
  sound track; `addTake` makes the clip; what to do while recording is said in the Keys panel and under the display — "Space
  stops" — never in a toast over the keys); live notes `liveNoteOn`/`liveNoteOff`/`liveAllOff` on `playTrack()` (the
  selected instrument track, else the first one) — `useHeldNotes` lights the keys; `playPreview` (a library pattern as
  a little song of its own, the real one handed back after); `loadSounds`, `soundsChanged`/`useAudioVersion` (waveforms
  draw again once a sound has loaded), `peaksOf`, `hear` (a short note for a click).
- UI (`src/app/`): `App.tsx` (the layout below, shortcuts via `popupGuard.ts`, keeping the song in the browser 400 ms
  after a change, files dropped on the window, toasts — **messages sit above the bottom panel**, `--panel-height`
  set by BottomPanel, never over the keys, mixer or editor; clicks go through them and only the ✕ takes one; the
  newest of each kind shows, `toastsToShow`; with a dialog open they're at the bottom of the window as JuraCUT's;
  each goes by itself after 5–10 s), `TopBar.tsx` (name, save state, version badge → What's new,
  Install, New/Open/Import/Save, Export, the Settings menu — tempo, beats in a bar, count-in, metronome, Connect a MIDI keyboard,
  light/dark —,
  Help), `Toolbar.tsx` (tools; Undo, Redo, History; the transport — Go to start, Play/Stop, Record, Loop, Metronome —
  and the display: bar.beat and time written every frame, tempo to click or drag, beats in a bar, "Space stops" under the position
  while recording; Snap — worded "¼ beat", "Whole bars"…, the note names only in the hints —, Add track, Library;
  Editor/Mixer/Keys; Fit; and, while the computer keyboard plays notes, a lit "Notes on" button that turns it off —
  the letter shortcuts don't work meanwhile, and that must always be visible), `SidePanel.tsx` (**on the left**, as JuraCUT's and as Logic's inspector: the
  selected clips' settings, then the selected track's — name, colour, volume, left–right, reverb, echo, the
  instruments as cards, duplicate/move/delete — or the song's with nothing selected; a clip's start is two boxes,
  Bar and Beat, and its length Bars and Beats — `barsAndBeats` —, whole numbers as the ruler counts them, never "bar
  1.667"; `pickTrack` in TrackHeader.tsx — a click on a track's header or mixer strip — lets go of clips selected on
  other tracks, so the panel never shows one track's clip above another track's settings), `TracksView.tsx` (the welcome
  cards while there are no tracks — `Welcome.tsx`, `addTracks.ts` —; otherwise one scrolling box: `TrackHeader`s
  stuck to its left, the bar ruler with the yellow loop strip stuck to its top, lanes with clips as DOM blocks —
  `NotesPicture`, `WavePicture` —, the playhead moved every frame; `ROW_H` 72, `HEADER_W` 212; drags are a `Drag`
  union in a ref: move — Alt copies, up/down to another track —, start/end resize, rubber band, Pencil draw, loop
  (`loopGrab`/`loopDragged`: while the loop is on, an end stretches it and its middle slides it; elsewhere, or while
  it's off, a new one is drawn; whole bars unless Shift), seek; a clip's name becomes a box on the clip for Rename.
  **Kept quick for long songs**: only the clips near what shows are in the page (`visibleBeats` in zoom.ts, worked out
  again as the view scrolls); clips place themselves with CSS from the lanes' `--ppb` (pixels a beat), so zooming
  doesn't draw each one again; a clip's notes are one SVG path, memo'd on the clip; pictures are left out of slivers
  and while hundreds of clips show; wheel turns are added up and applied once a frame), `BottomPanel.tsx` (tabs, drag its top edge; `panelHeight`: 45% of the room
  under the toolbar, between 240 px and 60%, until it's dragged; not shown for an empty song) holding
  `PianoRoll.tsx` (rows are pitches — or the kit's drums by name on a drum track —, notes as blocks, double-click
  adds or removes, drag to move/lengthen, rubber band, the velocity strip under the grid, Tidy timing, octave and
  semitone buttons; `nudgeNotes` for the arrow keys), `Mixer.tsx` (a strip per track and the Master) and `Keys.tsx`
  (piano or drum pads; `useTypingKeys` — while "Play with the computer keyboard" is on, letters play notes instead of
  picking tools, Z/X change the octave; `keysState.ts`), `LibraryDialog.tsx`, `ExportDialog.tsx` (WAV or MIDI, the
  whole song or just the loop; progress with how long is left — `timeLeftWords` — and a Stop button, Esc and ✕ that
  abort the mixdown; a typed ".wav"/".mid" is taken off the name), `HelpDialog.tsx` (rows from `platform.ts`, worded for Mac or Windows),
  `WhatsNewDialog.tsx` (reads CHANGELOG.md with `?raw` through `src/model/changelog.ts`), `HistoryMenu.tsx`,
  `ContextMenu.tsx` (right-click menus; `.bed-menu` styles are JuraCUT's), `MenuButton.tsx`, `Modal.tsx`,
  `Slider.tsx` (one undo step per drag, double-click for the usual value), `NumberBox.tsx`, `icons.tsx`. Not React:
  `fileActions.ts` (Save/Open with the browser's real file windows in Chrome/Edge, download and file picker
  elsewhere; `openFiles` — .juradaw opens, sound files become clips one after another on a sound track, .mid adds
  tracks (and `midiTracks(...).remarks`, such as `timeSignatureRemark`, are shown as an info toast) —; **New and Open
  both ask first when there are changes that aren't in a file** (`hasUnsavedChanges`; Open's replaced song can't be
  undone); Save writes `new Blob(songFileParts(...))`), `songUi.ts` (pure: `snapped`, `barBeat`, `barsAndBeats`, `lengthWords`,
  `SNAP_CHOICES`, `loopGrab`/`loopDragged`, `panelHeight`, `toastsToShow`, `clipsOverOthers`, `timeLeftWords`, and
  the songs drags hand to `dragUpdate` — `withClipsMoved`, `withClipEnd`, `withClipStart`, `withNotes`, `withTrack`,
  `roomFor`), `zoom.ts` (`useZoom`: Ctrl/⌘ + wheel or pinch towards the pointer; pure `gridFor` — which grid lines
  and bar numbers to draw at a zoom — and `visibleBeats`), `edgeScroll.ts` (`useEdgeScroll`: a drag held at the view's edge scrolls it and
  the drag catches up through its own move handler; pure `edgeSpeed`), `prefs.ts`, `theme.ts`, `install.ts` (also
  opens a double-clicked .juradaw once installed), `platform.ts`, `download.ts`.
- JuraDAW for Claude (`src/mcp/`, as JuraCAD's — copy how it's done there; the link code in `src/live/`,
  `src/mcp/websocket.ts` and `files.ts` IS JuraCAD's with the names changed, so a fix in one belongs in the other):
  an extension for the Claude desktop app (an .mcpb bundle; `claude-extension/manifest.json`) whose MCP server
  (`server.ts`, the only file using `@modelcontextprotocol/sdk`; stdout is MCP, so it logs to stderr) lets Claude write
  songs with the app's own pure code — no sound in it at all. `tools.ts`: `TOOLS` (format_guide, live_status,
  describe_song, list_instruments, list_library_patterns, new_song, list_songs, open_song, save_song, export_midi,
  set_song, add_track, edit_track, remove_track, add_clip, add_notes, remove_notes, edit_clip, repeat_clip,
  remove_clip, insert_library_pattern, undo), `FORMAT_GUIDE` (how songs are described: places in BARS from 1, notes
  in BEATS from their clip's start, pitches as names — C4 is middle C —, numbers or a drum's name; sent as the
  server's instructions too), `callTool` (one call at a time; a refused or cancelled call puts the song back),
  `describeSong`, `pitchOf`, `notesOf`, `trackOf`, `clipOf` (a clip by id, name, or its number on a track);
  `INSTRUMENT_IDS` must match `INSTRUMENTS` (tests/mcpTools checks). Every tool changes the song through
  `src/model/edits.ts` and **never puts a clip on top of another** (`needRoom` says where there's room).
  `session.ts` (the song, Claude's own undo list, the file, the sounds of an opened file so saving keeps them),
  `args.ts` (checks with plain-English messages — `InputError` is shown to Claude as it is), `toolKit.ts`, `files.ts`
  (`SongFolder`: the one folder it may read and write, Documents/JuraDAW unless chosen; plain names only, no links).
  CI: `scripts/build-claude-extension.mjs` bundles it with esbuild, `mcpb validate`/`pack` (pinned devDependencies)
  make `dist/juradaw-claude.mcpb` (downloaded from Help), and `scripts/check-claude-extension.mjs` unpacks it, starts
  it and writes a song over MCP, cancels a call, and talks to the live link as a tab would. Locally, with esbuild and
  a stand-in SDK, both scripts run too (`node scripts/check-claude-extension.mjs build/claude-extension`).
- Live with Claude (Claude works on the song open in the user's tab): the extension also listens on 127.0.0.1 only,
  on the first free port of `LIVE_PORTS` **47635–47644** (JuraCAD's are 47615–47624: both extensions may be running,
  and both sites are pages of gm7dha.github.io, the one origin the link lets in — localhost only with
  `JURADAW_LIVE_DEV=1`, which the smoke test sets), path `/juradaw-live`, sub-protocol `juradaw-live.1`.
  `src/live/protocol.ts` (pure, shared: the messages — hello/doc/applied/refused from the tab, welcome/busy/change/
  error from the extension — and the rules), `src/live/client.ts` (`LiveClient`: connects only when "Connect to
  Claude" is clicked, links EVERY chat's extension and looks for new ones), `relayTransport.ts` + `relayPage.ts`
  (Safari can't open ws://127.0.0.1 from https, so there the link goes through a small window the extension serves;
  `?liveRelay` forces that way), `src/mcp/live.ts` (`LiveBridge`: the extension's side; `describeChange` words the
  undo step from `changeLabel`). The tab sends the song as .juradaw text **without its sounds** (recordings stay in
  the tab; `open_song` over the link leaves audio clips out and says so) with a version number on connect and after
  every change; Claude's change comes back based on version N and the tab takes it — `store.applyClaudeChange(song,
  label, replace)`: ONE undo step, a "Claude: …" message, a new track selected — only if it's still at N and the
  user isn't recording or in the Library or Export window (`busy` in `src/app/liveLink.ts`), else it's refused,
  rolled back in the session and Claude is told to look again: nothing is merged silently. `src/app/LiveButton.tsx`
  is the top-bar control ("Claude" under 1440 px). Tests: liveProtocol, liveRelay (with tests/support/relaySim.ts),
  liveLink (the real server, the real client over Node's WebSocket, the real tools), mcpTools; the smoke test starts
  the built extension and lets it write into the open song.
- Help's surprise (the same in JuraCAD, JuraCUT and JuraDAW — keep them alike, and don't list it in CHANGELOG.md or
  the README: it's a secret): the Windows / Mac buttons clicked 10 times within 5 seconds show `public/easter-egg.jpg`
  (`src/app/easterEgg.ts` pure `eggClick`, tests/easterEgg; `.easter-egg` in styles.css; a smoke-test step).
- Styles: `src/app/styles.css` is JuraCUT's with the DAW's parts added. Colours only through its CSS variables (light
  and dark themes) — never fixed colours in components; a track's colour reaches its header, clips and strip as
  `--track`. Under 1440 px the toolbar's buttons close up; under 1100 px (a 1024 px laptop) the right-hand buttons are icons
  only, the display drops its clock and the save state goes; the smoke test checks the toolbar and top bar fit at 1280
  and 1024 px — at 1280 also with the "Notes on" button showing.
- Tests (`tests/*.test.ts`, Vitest, pure code only — each file stands alone): time, edits, document (also keep and
  the changelog reader), historyClipboard, store, midiFile, library, audioSchedule (schedule, loop windows, takes,
  mixer sums), audioWav (WAV and the plucked string), appHelpers (songUi — snap words, bars and beats, the loop strip, the panel's height,
  which toasts show, clips over others, export words —, `gridFor`, `visibleBeats`, `edgeSpeed`, keysState, popupGuard,
  prefs), easterEgg, and the Claude extension's (liveProtocol, liveRelay, liveLink, mcpTools — these use Node's
  files, http and WebSocket). Pure logic lives outside React and gets a test; the sound itself is checked by the
  smoke test.
- Every change: `npm run typecheck && npm test && npm run build && npm run smoke`. CI runs the same (and builds,
  packs and checks the Claude extension before the smoke test) and publishes
  `main` to GitHub Pages (https://gm7dha.github.io/JuraDAW/). The site's path comes from the repository's name
  (`BASE_PATH` in the workflow, read by vite.config.ts and the smoke test).
- `npm run smoke` (`scripts/smoke-test.mjs`) drives the built app in headless Chromium (`?smoke` exposes
  `window.juradawStore` and `window.juradawEngine`; the browser's own file windows are switched off so Save downloads
  and Open uses the ordinary picker). It makes a song the way a person would: a track from the welcome card, a clip
  and notes drawn in the editor, play (the position advancing), loop (going round; then its end stretched and its
  middle slid along), a drum beat from the Library, a bass line that must get a bass track of its own — and a second
  one that must go after the first, with no clip lying over another and the messages above the bottom panel —, mute
  and solo in the mixer, three notes recorded with the typing keyboard (the "Notes on" button showing, P not picking
  the Pencil, no message over the keys, the toolbar still fitting), a WAV export (a real RIFF file, as long as the
  song plus its 2.5 s tail, not silent), an export stopped part-way (no file saved), a MIDI export (MThd, a track
  each), Save → New → Open (the same song back), Open and a dropped file asking first when there are unsaved changes
  (no: the song stays; yes: it opens), a WAV it makes itself imported as a clip (waveform drawn, and inside the saved
  file), a clip renamed on the clip, undo/redo/History, a clip dragged to the edge (the view scrolls), a reload (the
  song, its sound and the count-in kept in the browser), a pretend MIDI keyboard that the page must not ask the
  browser for until "Connect a MIDI keyboard" is pressed (and must reconnect by itself after a reload), dark mode,
  Help, What's new, and the bars fitting at 1024 and 1280 px. It fails on any console
  error. It never waits a fixed time: every step waits for what it expects (`until`, `playedPast`), and messages are
  closed with their ✕ (`closeToasts`) so they aren't in the way of the next click. When you add something a person
  can do, add a step for it. `SMOKE_DIST` points it at a build somewhere else; `SMOKE_SCREENSHOT=1` saves smoke.png.
- If the npm registry is unreachable from your environment: the pure code can be typechecked and tested with
  whatever TypeScript is around (a few lines standing in for `vitest`'s describe/it/expect and for `zustand`'s
  typings are enough), the app can be bundled with a local esbuild standing in for Vite (define `import.meta.env.*`
  and `__APP_VERSION__`, and load `CHANGELOG.md?raw` as text) and smoke-tested with a local Playwright + Chromium
  (`SMOKE_DIST=<that bundle> node scripts/smoke-test.mjs`) — then push to a branch with an open PR and let CI do the
  real `npm install`, Vite build and Vitest run. Say in the PR what was and wasn't run for real.
- Versions: bump `version` in package.json and add a CHANGELOG.md entry (with the merge commit) at the end of each
  phase. `## vX.Y — Title · commit \`abc1234\`` then bullets is the shape the What's new window reads. This session
  type can't create GitHub releases or push tags, so CHANGELOG.md is the record.
