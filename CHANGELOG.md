# JuraDAW versions

Each version is a safe point to go back to. To roll back, ask for "go back to vX.Y" — the change is made as a
pull request that undoes everything after that point (your `.juradaw` files aren't touched, but songs that use
newer things won't open in an older version until those things are back).

The point in the history for each version is the commit shown (see https://github.com/gm7dha/JuraDAW/commits/main).

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
