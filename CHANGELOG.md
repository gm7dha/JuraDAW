# JuraDAW versions

Each version is a safe point to go back to. To roll back, ask for "go back to vX.Y" — the change is made as a
pull request that undoes everything after that point (your `.juradaw` files aren't touched, but songs that use
newer things won't open in an older version until those things are back).

The point in the history for each version is the commit shown (see https://github.com/gm7dha/JuraDAW/commits/main).

## v0.8 — Recent songs

- **Recent**: a new button in the top bar lists the last 12 songs you've worked on in this browser, newest first,
  each with a little picture of its tracks. Click one to open it again; × forgets it. The song you have open is kept
  there as you work, so pressing New or opening a file never loses it — and its recordings are kept with it.
- **Loop this section**: right-click a section on the ruler to loop just that part of the song while you work on it.

## v0.7 — Sections, the song's key and chords, finishing touches

- **Sections**: name the parts of your song — Intro, Verse, Chorus, Bridge, Outro — along the bottom of the bar
  ruler. Press **+ Section** (it names the part where playing starts) or right-click the ruler; a name is offered
  in the order songs usually go, and you can type your own. Click a section to play from its start, double-click
  to rename it, right-click to delete the name.
- **The song's key**: choose it in the note editor (or in the song's settings, with nothing selected). The notes
  outside the key are shaded, so it's easy to see which notes fit.
- **Chords** in the note editor: press **Chords** and each note you add becomes a whole chord — the key's own chord
  on that note, so it always fits (a major chord when no key is chosen). Drawn with the Pencil, the whole chord
  stretches together.
- **Finishing touches** on the whole song, in the song's settings: **Song bass**, **Song treble** and **Song
  squeeze** (squeezes the whole mix together so it sounds fuller and steadier, as finished songs do).
- Claude can set the key, name the sections and add finishing touches.

## v0.6 — Acoustic instruments, more effects and swing

- **Six acoustic instruments**, under a new *Acoustic* heading: **Acoustic guitar**, **Harp**, **Kalimba** (thumb
  piano), **Marimba**, **Flute** and **Brass**. MIDI files with these instruments in them now open on them too.
- **More effects on every track**: **Squeeze** (evens out loud and quiet so a track sits steady and punchy — a
  compressor), **Swirl** (a slow, sweeping, hollow whoosh — a phaser) and **Sway** (the sound swings from left to
  right and back, once a bar — lovely in headphones).
- **Swing** on instrument tracks: notes on the off-beats come a little late, for a shuffle or a groove, right up to
  a full triplet feel. It swings in eighths, or in sixteenths when a clip has notes on them. The notes you wrote
  stay where they are.
- **The filter can keep the middle**: besides cutting the top or the bottom, it can keep just a slice of the sound,
  like a telephone or a small radio.
- **Filter wobble**: the filter opens and closes in time with the song — from a slow throb every two beats to the
  "wub-wub" of dubstep four times a beat.
- Claude can use all of it.

## v0.5 — Automation and a harmoniser

- **Automation**: a new **Automation** tab under the tracks (next to the Mixer) where you draw lines over the whole
  song that change a track's **volume**, its **filter** or where it sits between **left and right** as the song
  plays — a slow fade-out at the end, a filter that opens over eight bars into a chorus, a sound that drifts from
  one side to the other. Click to add a point, drag a point to move it, double-click one to take it away; **Clear
  line** takes the whole line off. The lines show faintly over the track in the main view, and the **Draw
  automation** button in the track's settings opens the tab. Unlike a clip's filter sweep, a line can run across
  many clips (where a clip has its own sweep, the sweep wins while it plays).
- **Harmoniser** on every track: extra voices at other pitches that sing (or play) along with it — the stacked-voice
  sound of Bon Iver on a recorded voice. Choose **Octave below**, **Fifth above**, a **Bright chord** or a **Dark
  chord** (two voices above, for songs in a major or a minor key) or **Below and above**, and how loud the voices
  are. The voices keep a fixed distance from the sound, so a chord won't suit every note of every tune.
- Claude can draw automation lines and use the harmoniser too.

## v0.4 — Drum machines, arpeggiator and more effects

- **Two new drum kits**: an **808 kit** (the booming kick, snappy snare and ticking hi-hats of trap and hip-hop) and
  an **Electronic kit** (the punchy kick and crisp hats of house and techno). Pick one like any instrument: the
  editor and the drum pads work the same.
- **808 bass**: the long, deep, sliding bass of trap, under Bass.
- **New beats in the Library**: Trap beat, House beat, Techno beat, Drum and bass, Lo-fi hip-hop, a **Build-up**
  (the snare rolls faster and louder bar by bar) — and an **808 bass** line to go with the trap beat.
- **Arpeggiator** on every instrument track: tick it and the chords on that track play one note at a time — up,
  down, up and down, or in a jumbled order — in beats, eighths, triplets or sixteenths, over one to three octaves.
  The notes you wrote stay as they are.
- **More effects on every track**: **Bass** and **Treble** (more or less of the low end and the top end) and
  **Chop** (cuts the sound into sixteenth notes, from a flutter to hard stutters).
- **Play backwards**: a recording's clip can now be played in reverse.
- Claude can use all of it.

## v0.3 — Shaping the sound

- **Effects on every track**, in the panel on the left under Reverb and Echo: **Drive** (warmth, then grit, then
  fuzz), **Crush** (the rough, lo-fi sound of an old sampler), a **Filter** that cuts the top or the bottom of the
  sound, with a **ring** (resonance) at the cut, **Wobble** (a slow drift in pitch that widens the sound, like a
  worn tape) and **Pump** (the volume dips on every beat and swells back, as dance music does). All off until you
  turn them up; double-click a slider to turn it off again.
- **Clips can swell in and die away**: every clip now has its own **volume**, a **fade in** and a **fade out**, so a
  part can arrive gradually instead of switching on.
- **Filter sweeps**: tick "Sweep the filter over this clip" and the track's filter opens up (or closes down) while
  that clip plays — the classic build.
- **Seven new instruments**: **Soft piano** (a felted upright), **Choir**, **Sub bass**, **Gritty bass**, **Big saw**
  (the huge chord sound of dance music), **Wobbly synth** (warm and slightly out of tune) and **Noise sweep** — a
  rush of noise for builds that rises for exactly as long as its note (a low note falls instead).
- Claude can use all of it: ask for "a filter sweep into the chorus", "pumping chords" or "a choir that fades in".
- Songs made before this version sound exactly as they did.

## v0.2 — Make music with Claude

- **Use JuraDAW with Claude**: a free extension for the Claude desktop app (Help › Use JuraDAW with Claude: one file
  to download and double-click). Describe some music in plain English — "a slow blues in A with drums, a walking
  bass and piano chords" — and Claude writes it a part at a time: tracks, clips and notes you can see, play and
  change. It can use every pattern in the Library, in any key, sets the tempo and the mix, and saves a `.juradaw`
  song (or a MIDI file) in your Documents › JuraDAW folder.
- **Live with Claude**: click **Connect to Claude** in the top bar and Claude works on the song you have open, while
  you watch and listen. Each of its changes is one step you can undo, and you can keep working too — if you both
  change something at the same moment, Claude's change is turned back and it tries again, so nothing is lost. It
  waits while you're recording or have the Library or Export open. The link stays on your computer; only the JuraDAW
  website can use it. Works in Chrome, Edge and Firefox, and in Safari through a small link window.
- Claude works with notes: recording a voice or an instrument, and saving a sound file, are still done in JuraDAW.

## v0.1 — The first version

- **Tracks**: as many as 32, each an instrument to play or a track for recorded sound, with its own colour, volume,
  left–right, Mute and Solo. An empty song offers three ways to begin: play an instrument, make a drum beat, or
  record sound.
- **Built-in instruments**, all made in the browser so nothing has to download: pianos, organ, strings, a soft pad,
  basses, synths, bells and a drum kit.
- **Clips** on a timeline of bars and beats: drag to move them (they snap to the grid), drag an edge to make them
  longer or shorter, split, join, repeat, rename, copy and paste. A right-click menu has the lot. Nothing is ever put
  on top of a clip that's already there: a second take, a library pattern or an imported sound goes after it or on a
  track of its own — and two clips that do overlap are drawn so both can be seen.
- **Settings on the left** for whatever is selected: a track's name, colour, instrument, volume, reverb and echo, or
  a clip's name, and where it starts and how long it is in bars and beats.
- **The note editor** (a piano roll) along the bottom: double-click a clip to see its notes, draw new ones, drag them
  about, change how long and how loud they are, **Tidy timing** to put them exactly on the grid. Drum tracks list the
  drums by name.
- **Keys**: an on-screen piano (drum pads for a drum kit) you can play with the mouse, your fingers, or the
  computer's keyboard — tick "Play with the computer keyboard" and A W S E D F T G Y H U J K become a piano (the
  toolbar shows "Notes on" while they do, as the letter shortcuts are off). A plug-in **MIDI keyboard** is connected
  with the "Connect a MIDI keyboard" button, and by itself from then on.
- **Recording**: the notes you play onto an instrument track, or the microphone onto a sound track, with a metronome
  and a count-in.
- **Loop** a part of the song while you work on it: drag across the yellow strip in the ruler; drag an end of the
  loop to stretch it, or its middle to slide it along.
- **The mixer**: every track side by side with its fader, level meter, left–right, reverb and echo, and a Master
  strip.
- **The Library**: 35 ready-made drum beats, bass lines, chords and tunes, in any key, to listen to, drop in and
  change. Each goes on a track that suits it: a drum beat on a drum kit, a bass line on a bass, chords and tunes on
  another instrument.
- **Import** sound files (WAV, MP3 and more) and MIDI files; **Export** the song, or just the looped part, as a WAV
  sound file or a MIDI file. A long export shows how far along it is and can be stopped.
- **Save and Open** `.juradaw` files, which hold the song and its recordings in one file. Your work is also kept in
  this browser as you go, and New and Open ask first when there are changes that aren't in a file yet.
- **Messages** appear above the bottom panel, never over the keys, mixer or note editor, and clicks go through them.
- **Small screens**: on a 1024-pixel laptop the toolbar's right-hand buttons become icons so everything still fits,
  and the bottom panel takes a share of the window rather than a fixed height.
- **Undo** for everything, with a History list to jump straight back to any step.
- **Install** as an app that works offline, on Windows and macOS; light and dark appearance.
