/**
 * Recording from the microphone: asks for it (with the browser's "clean-up"
 * switched off, which spoils music), and collects the raw samples as they
 * arrive. The samples are gathered on the sound thread by a tiny
 * AudioWorklet where the browser has one, or by the older ScriptProcessor
 * where it hasn't.
 */
import { clamp } from "./shared";

export const MIC_REFUSED = "JuraDAW couldn't use the microphone. Allow it in the browser's address bar and try again.";
export const MIC_MISSING = "JuraDAW couldn't find a microphone. Plug one in and try again.";
export const MIC_FAILED = "JuraDAW couldn't start recording from the microphone. Check it's plugged in and try again.";
export const MIC_UNSUPPORTED = "This browser can't record from a microphone here. Try a current version of Chrome, Edge, Firefox or Safari.";

/** What a recording collected. */
export interface CapturedSound {
  /** One array of samples per channel (one or two). */
  channels: Float32Array[];
  sampleRate: number;
  /** When the first sample arrived, on the sound clock. */
  startTime: number;
  /** How late the microphone's sound reaches us, in seconds, as far as the browser can tell (0 if it can't). */
  inputLatency: number;
}

/** A recording under way. */
export interface MicRecording {
  /** The loudest recent sample, 0–1, for a meter. */
  peak(): number;
  /** Stop and hand over what was recorded. The microphone is let go. */
  stop(): Promise<CapturedSound>;
}

/** The code that runs on the sound thread: gathers what comes in and posts it over in pieces of about a twentieth of a second. */
const WORKLET = `
class JuraDawCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = true;
    this.blocks = [];
    this.frames = 0;
    this.time = 0;
    this.port.onmessage = () => {
      this.on = false;
      this.flush();
      this.port.postMessage({ done: true });
    };
  }
  flush() {
    if (this.blocks.length) this.port.postMessage({ time: this.time, blocks: this.blocks });
    this.blocks = [];
    this.frames = 0;
  }
  process(inputs) {
    if (!this.on) return false;
    const input = inputs[0];
    if (input && input.length && input[0].length) {
      if (!this.blocks.length) this.time = currentTime;
      this.blocks.push(input.map((channel) => channel.slice()));
      this.frames += input[0].length;
      if (this.frames >= 2048) this.flush();
    }
    return true;
  }
}
registerProcessor("juradaw-capture", JuraDawCapture);
`;

const workletReady = new WeakMap<BaseAudioContext, Promise<boolean>>();

/** Load the worklet into a context (once). False if the browser can't. */
function loadWorklet(ctx: AudioContext): Promise<boolean> {
  let ready = workletReady.get(ctx);
  if (!ready) {
    ready = (async () => {
      if (!ctx.audioWorklet || typeof AudioWorkletNode === "undefined") return false;
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      try {
        await ctx.audioWorklet.addModule(url);
        return true;
      } catch {
        return false;
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
    workletReady.set(ctx, ready);
  }
  return ready;
}

/** Ask for the microphone. Rejects with a friendly message. */
async function openMicrophone(): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new Error(MIC_UNSUPPORTED);
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    throw new Error(name === "NotFoundError" || name === "OverconstrainedError" ? MIC_MISSING : MIC_REFUSED);
  }
}

/** Join pieces of samples end to end. */
function join(pieces: Float32Array[]): Float32Array {
  const whole = new Float32Array(pieces.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const piece of pieces) {
    whole.set(piece, at);
    at += piece.length;
  }
  return whole;
}

/**
 * Start recording from the microphone into memory. Rejects with a friendly
 * message if there's no microphone or it isn't allowed. Nothing of the
 * microphone is played back out (that would howl through speakers).
 */
export async function startMicRecording(ctx: AudioContext): Promise<MicRecording> {
  const stream = await openMicrophone();
  try {
    return await recordFrom(ctx, stream);
  } catch {
    // Never leave the microphone (and the browser's "recording" light) on if setting up went wrong.
    for (const t of stream.getTracks()) t.stop();
    throw new Error(MIC_FAILED);
  }
}

/**
 * A microphone that picks up on only one side of a stereo input (a microphone or guitar in input 1 of a sound
 * card), or the same on both, is better as one channel: it then plays in the middle, not hard to one side.
 */
export function tidyChannels(channels: Float32Array[]): Float32Array[] {
  if (channels.length !== 2) return channels;
  const [left, right] = channels;
  let leftPeak = 0;
  let rightPeak = 0;
  let apart = 0;
  for (let i = 0; i < left.length; i++) {
    leftPeak = Math.max(leftPeak, Math.abs(left[i]));
    rightPeak = Math.max(rightPeak, Math.abs(right[i]));
    apart = Math.max(apart, Math.abs(left[i] - right[i]));
  }
  if (rightPeak <= leftPeak * 0.01) return [left];
  if (leftPeak <= rightPeak * 0.01) return [right];
  return apart <= Math.max(leftPeak, rightPeak) * 0.001 ? [left] : channels;
}

/** Collect what a microphone stream hears. */
async function recordFrom(ctx: AudioContext, stream: MediaStream): Promise<MicRecording> {
  const track = stream.getAudioTracks()[0];
  const settings = track?.getSettings() ?? {};
  const channelCount = clamp(settings.channelCount ?? 1, 1, 2);
  const latency = (settings as MediaTrackSettings & { latency?: number }).latency;
  const inputLatency = typeof latency === "number" && isFinite(latency) ? clamp(latency, 0, 0.5) : 0;

  const source = ctx.createMediaStreamSource(stream);
  const meter = ctx.createAnalyser();
  meter.fftSize = 1024;
  source.connect(meter);
  const meterSamples = new Float32Array(meter.fftSize);
  // The collecting node must lead somewhere to be run; this leads to the output through silence.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  mute.connect(ctx.destination);

  const pieces: Float32Array[][] = Array.from({ length: channelCount }, () => []);
  let startTime = -1;
  const take = (time: number, channels: Float32Array[]) => {
    if (startTime < 0) startTime = time;
    // A mono microphone on a stereo input fills both sides the same.
    for (let c = 0; c < channelCount; c++) pieces[c].push(channels[c] ?? channels[0]);
  };

  let collector: AudioNode;
  let finish: () => Promise<void>;
  if (await loadWorklet(ctx)) {
    const node = new AudioWorkletNode(ctx, "juradaw-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount, channelCountMode: "explicit" });
    let done: () => void = () => {};
    node.port.onmessage = (event: MessageEvent<{ done?: boolean; time?: number; blocks?: Float32Array[][] }>) => {
      const { blocks, time } = event.data;
      if (blocks && blocks.length) {
        take(time ?? ctx.currentTime, Array.from({ length: blocks[0].length }, (_, c) => join(blocks.map((b) => b[c]))));
      }
      if (event.data.done) done();
    };
    collector = node;
    finish = () =>
      new Promise<void>((resolve) => {
        done = resolve;
        node.port.postMessage("stop");
        // Never wait for ever if the sound thread has gone quiet.
        setTimeout(resolve, 500);
      });
  } else {
    const size = 4096;
    const node = ctx.createScriptProcessor(size, channelCount, 1);
    node.onaudioprocess = (event) => {
      const input = event.inputBuffer;
      // These samples were heard one buffer ago.
      take(ctx.currentTime - size / ctx.sampleRate, Array.from({ length: input.numberOfChannels }, (_, c) => input.getChannelData(c).slice()));
    };
    collector = node;
    finish = async () => {
      node.onaudioprocess = null;
    };
  }
  source.connect(collector);
  collector.connect(mute);

  let stopped: Promise<CapturedSound> | null = null;
  return {
    peak() {
      meter.getFloatTimeDomainData(meterSamples);
      let peak = 0;
      for (let i = 0; i < meterSamples.length; i++) peak = Math.max(peak, Math.abs(meterSamples[i]));
      return peak;
    },
    stop() {
      stopped ??= finish().then(() => {
        for (const node of [source, meter, collector, mute]) node.disconnect();
        for (const t of stream.getTracks()) t.stop();
        return { channels: tidyChannels(pieces.map(join)), sampleRate: ctx.sampleRate, startTime: Math.max(0, startTime), inputLatency };
      });
      return stopped;
    },
  };
}
