/**
 * MIDI keyboards (Web MIDI): listens to every keyboard plugged in, now or
 * later, and reports the keys pressed and let go. Where the browser has no
 * Web MIDI, or the user says no, there are simply no keyboards.
 */

type NoteListener = (pitch: number, velocity: number) => void;

let access: MIDIAccess | null = null;
let listener: NoteListener | null = null;

function onMessage(event: MIDIMessageEvent): void {
  const data = event.data;
  if (!data || data.length < 3 || !listener) return;
  const kind = data[0] & 0xf0;
  // "Note on" with velocity 0 is how many keyboards say "note off".
  if (kind === 0x90 && data[2] > 0) listener(data[1], data[2]);
  else if (kind === 0x80 || kind === 0x90) listener(data[1], 0);
}

function listenToAll(midi: MIDIAccess): string[] {
  const names: string[] = [];
  midi.inputs.forEach((input) => {
    input.onmidimessage = onMessage;
    if (input.state !== "disconnected") names.push(input.name || "MIDI keyboard");
  });
  return names;
}

/**
 * Start listening. `onNote` is told of every key (velocity 0 = let go).
 * Resolves with the names of the keyboards found: none if there aren't any,
 * the browser can't, or permission was refused. Safe to call again.
 */
export async function startMidiInput(onNote: NoteListener): Promise<string[]> {
  listener = onNote;
  if (typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function") return [];
  try {
    if (!access) {
      access = await navigator.requestMIDIAccess();
      // A keyboard plugged in later is listened to as well.
      access.onstatechange = () => {
        if (access) listenToAll(access);
      };
    }
    return listenToAll(access);
  } catch {
    return [];
  }
}
