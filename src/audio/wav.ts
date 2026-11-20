/**
 * WAV files, read and written by hand (pure, no browser needed): the mixdown
 * is written with `encodeWav`, sounds are kept in the browser and inside
 * .juradaw files as WAV, and `peaksOf` finds a sound's shape for drawing.
 */

const WAV_PCM = 1;
const WAV_FLOAT = 3;
const WAV_EXTENSIBLE = 0xfffe;

/** What can't be read is reported with this message. */
export const BAD_WAV = "This isn't a WAV file JuraDAW can read.";

function writeText(view: DataView, at: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
}

function readText(view: DataView, at: number, length: number): string {
  let text = "";
  for (let i = 0; i < length; i++) text += String.fromCharCode(view.getUint8(at + i));
  return text;
}

/**
 * A 16-bit WAV file from samples (one Float32Array per channel, values −1…1).
 * Anything louder is clipped; channels shorter than the longest are padded with silence.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const channelCount = Math.max(1, channels.length);
  const frames = channels.reduce((most, c) => Math.max(most, c.length), 0);
  const blockAlign = channelCount * 2;
  const dataBytes = frames * blockAlign;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);

  writeText(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(view, 8, "WAVE");
  writeText(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, WAV_PCM, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, Math.round(sampleRate), true);
  view.setUint32(28, Math.round(sampleRate) * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeText(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  for (let c = 0; c < channelCount; c++) {
    const samples = channels[c];
    if (!samples) continue;
    let at = 44 + c * 2;
    for (let i = 0; i < samples.length; i++, at += blockAlign) {
      const s = samples[i];
      // NaN fails both comparisons and is written as silence.
      const clipped = s >= 1 ? 1 : s <= -1 ? -1 : s > -1 ? s : 0;
      view.setInt16(at, Math.round(clipped < 0 ? clipped * 32768 : clipped * 32767), true);
    }
  }
  return bytes;
}

/**
 * The samples in a WAV file: 8, 16, 24 or 32-bit whole numbers or 32/64-bit
 * floating point, any number of channels. Chunks it doesn't know are skipped.
 * Throws an Error with a friendly message if the file can't be read.
 */
export function decodeWav(bytes: Uint8Array): { channels: Float32Array[]; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || readText(view, 0, 4) !== "RIFF" || readText(view, 8, 4) !== "WAVE") throw new Error(BAD_WAV);

  let format = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let bits = 0;
  let blockAlign = 0;
  let dataAt = -1;
  let dataBytes = 0;

  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const id = readText(view, at, 4);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= bytes.byteLength) {
      format = view.getUint16(body, true);
      channelCount = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      blockAlign = view.getUint16(body + 12, true);
      bits = view.getUint16(body + 14, true);
      // "Extensible" files say what they really are in the first two bytes of a longer code.
      if (format === WAV_EXTENSIBLE && size >= 26 && body + 26 <= bytes.byteLength) format = view.getUint16(body + 24, true);
    } else if (id === "data") {
      dataAt = body;
      // Some programs leave the size as 0 or far too big when they stream a file out: use what's there.
      dataBytes = size === 0 || body + size > bytes.byteLength ? bytes.byteLength - body : size;
      break;
    }
    // Chunks are padded to an even number of bytes.
    at = body + size + (size % 2);
  }

  const bytesPerSample = bits / 8;
  const supported =
    (format === WAV_PCM && (bits === 8 || bits === 16 || bits === 24 || bits === 32)) || (format === WAV_FLOAT && (bits === 32 || bits === 64));
  if (dataAt < 0 || !supported || channelCount < 1 || sampleRate < 1) throw new Error(BAD_WAV);
  if (blockAlign < channelCount * bytesPerSample) blockAlign = channelCount * bytesPerSample;

  const frames = Math.floor(dataBytes / blockAlign);
  const channels: Float32Array[] = [];
  for (let c = 0; c < channelCount; c++) {
    const samples = new Float32Array(frames);
    let p = dataAt + c * bytesPerSample;
    for (let i = 0; i < frames; i++, p += blockAlign) {
      if (format === WAV_FLOAT) samples[i] = bits === 32 ? view.getFloat32(p, true) : view.getFloat64(p, true);
      else if (bits === 16) samples[i] = view.getInt16(p, true) / 32768;
      else if (bits === 24) samples[i] = ((view.getInt8(p + 2) << 16) | (view.getUint8(p + 1) << 8) | view.getUint8(p)) / 8388608;
      else if (bits === 32) samples[i] = view.getInt32(p, true) / 2147483648;
      else samples[i] = (view.getUint8(p) - 128) / 128;
    }
    channels.push(samples);
  }
  return { channels, sampleRate };
}

/**
 * A sound's shape for drawing: `buckets` values 0–1, each the loudest sample
 * in its slice of `samples` between two sample positions (the whole sound by
 * default). Slices outside the sound are 0.
 */
export function peaksOf(samples: Float32Array, buckets: number, from = 0, to = samples.length): Float32Array {
  const count = Math.max(0, Math.floor(buckets));
  const peaks = new Float32Array(count);
  const span = to - from;
  if (count === 0 || !(span > 0)) return peaks;
  for (let b = 0; b < count; b++) {
    const start = Math.floor(from + (b * span) / count);
    // Each slice holds at least one sample, so zooming far in still draws a line.
    const end = Math.max(start + 1, Math.floor(from + ((b + 1) * span) / count));
    let peak = 0;
    for (let i = Math.max(0, start); i < end && i < samples.length; i++) {
      const v = Math.abs(samples[i]);
      if (v > peak) peak = v;
    }
    peaks[b] = peak > 1 ? 1 : peak;
  }
  return peaks;
}
