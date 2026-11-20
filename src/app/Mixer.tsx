/**
 * The mixer: one strip per track — name, left–right, a fader beside a level
 * meter, Mute and Solo, and how much reverb and echo — plus the Master strip
 * for the whole song.
 */
import { useStore } from "../model/store";
import type { Track } from "../model/types";
import { Icons } from "./icons";
import { Slider } from "./Slider";
import { withTrack } from "./songUi";
import { Meter, pickTrack, TrackIcon } from "./TrackHeader";

const percent = (v: number) => `${Math.round(v * 100)}%`;
/** Left–right in words: "middle", "30% left"… */
export const panWords = (pan: number) => (Math.abs(pan) < 0.02 ? "middle" : `${Math.round(Math.abs(pan) * 100)}% ${pan < 0 ? "left" : "right"}`);

export function Mixer() {
  const tracks = useStore((s) => s.history.present.tracks);
  const master = useStore((s) => s.history.present.master);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const anySolo = tracks.some((t) => t.solo);
  if (!tracks.length) {
    return (
      <div className="panel-empty">
        <Icons.Mixer size={30} />
        <p>
          <b>The mixer balances your tracks.</b>
        </p>
        <p className="muted small">Add a track and it gets a strip here: volume, left or right, reverb and echo.</p>
      </div>
    );
  }
  return (
    <div className="mixer" role="group" aria-label="Mixer">
      {tracks.map((t) => (
        <Strip key={t.id} track={t} selected={t.id === selectedTrackId} silenced={anySolo && !t.solo} />
      ))}
      <div className="mixer-strip master" aria-label="Master">
        <div className="strip-name" title="Master: the volume of the whole song">
          <span className="track-icon">
            <Icons.Speaker size={18} />
          </span>
          <span className="strip-name-text">Master</span>
        </div>
        <div className="strip-gap muted small">Whole song</div>
        <div className="strip-fader">
          <Slider vertical className="fader" value={master} label="Master volume" title={`Master volume: ${percent(master)} (double-click for the usual 80%)`} usual={0.8} make={(song, v) => ({ ...song, master: v })} />
          <Meter id="master" className="wide" />
        </div>
        <div className="strip-value">{percent(master)}</div>
      </div>
    </div>
  );
}

function Strip({ track, selected, silenced }: { track: Track; selected: boolean; silenced: boolean }) {
  const s = useStore.getState;
  return (
    <div className={`mixer-strip${selected ? " selected" : ""}${track.mute || silenced ? " silent" : ""}`} style={{ ["--track" as string]: track.colour }} onPointerDown={() => pickTrack(track.id)} aria-label={`Track ${track.name}`}>
      <div className="strip-name" title={track.name}>
        <span className="track-icon">
          <TrackIcon track={track} size={18} />
        </span>
        <span className="strip-name-text">{track.name}</span>
      </div>
      <label className="strip-knob" title={`Left or right: ${panWords(track.pan)} (double-click for the middle)`}>
        <span>L</span>
        <Slider className="pan" min={-1} max={1} step={0.02} value={track.pan} label={`Left or right for ${track.name}`} title={`Left or right: ${panWords(track.pan)} (double-click for the middle)`} usual={0} make={(song, v) => withTrack(song, track.id, { pan: Math.abs(v) < 0.04 ? 0 : v })} />
        <span>R</span>
      </label>
      <div className="strip-fader">
        <Slider vertical className="fader" value={track.volume} label={`Volume of ${track.name}`} title={`Volume: ${percent(track.volume)} (double-click for the usual 80%)`} usual={0.8} make={(song, v) => withTrack(song, track.id, { volume: v })} />
        <Meter id={track.id} className="wide" />
      </div>
      <div className="strip-value">{percent(track.volume)}</div>
      <div className="strip-buttons">
        <button type="button" className={`ms-button mute${track.mute ? " on" : ""}`} aria-pressed={track.mute} aria-label={`Mute ${track.name}`} title="Mute: silence this track" onClick={() => s().updateTrack(track.id, { mute: !track.mute })}>
          M
        </button>
        <button type="button" className={`ms-button solo${track.solo ? " on" : ""}`} aria-pressed={track.solo} aria-label={`Solo ${track.name}`} title="Solo: hear only this track (and any others that are soloed)" onClick={() => s().updateTrack(track.id, { solo: !track.solo })}>
          S
        </button>
      </div>
      <label className="strip-send" title={`Reverb: the sound of a room round this track — ${percent(track.reverb)}`}>
        <span>Reverb</span>
        <Slider value={track.reverb} label={`Reverb for ${track.name}`} title={`Reverb: the sound of a room round this track — ${percent(track.reverb)}`} usual={0} make={(song, v) => withTrack(song, track.id, { reverb: v })} />
      </label>
      <label className="strip-send" title={`Echo: repeats that fade away — ${percent(track.echo)}`}>
        <span>Echo</span>
        <Slider value={track.echo} label={`Echo for ${track.name}`} title={`Echo: repeats that fade away — ${percent(track.echo)}`} usual={0} make={(song, v) => withTrack(song, track.id, { echo: v })} />
      </label>
    </div>
  );
}
