/**
 * What an empty song shows where the tracks will be: three big cards to add
 * the first track, and two smaller ways in (the library, opening a song).
 */
import type { ReactElement } from "react";

import { useStore } from "../model/store";
import { addTrackOf, NEW_TRACKS, type NewTrackKind } from "./addTracks";
import { openFromFile } from "./fileActions";
import { Icons } from "./icons";

const CARD_ICONS: Record<NewTrackKind, (p: { size?: number }) => ReactElement> = { instrument: Icons.Keys, drums: Icons.Drum, audio: Icons.Mic };

export function Welcome() {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <h2>Let's make some music</h2>
        <p className="muted">A song is made of tracks, one for each instrument or recording. What would you like to start with?</p>
        <div className="welcome-cards">
          {NEW_TRACKS.map((t) => {
            const Icon = CARD_ICONS[t.kind];
            return (
              <button key={t.kind} type="button" className="welcome-card" onClick={() => addTrackOf(t.kind)}>
                <span className="welcome-icon">
                  <Icon size={34} />
                </span>
                <b>{t.title}</b>
                <span className="muted small">{t.text}</span>
              </button>
            );
          })}
        </div>
        <div className="welcome-more">
          <button type="button" className="text-button" onClick={() => useStore.getState().openDialog("library")}>
            <Icons.Library size={18} /> Browse the library
          </button>
          <button type="button" className="text-button" onClick={() => void openFromFile()}>
            <Icons.Open size={18} /> Open a song
          </button>
        </div>
        <p className="muted small">You can also drag a song, a sound file or a MIDI file onto this window. Everything you do is kept in this browser as you go.</p>
      </div>
    </div>
  );
}
