import { describe, expect, it } from "vitest";
import { BAD_WAV, decodeWav, encodeWav, peaksOf } from "../src/audio/wav";
import { pluckDecay, pluckSamples } from "../src/audio/pluck";

const text = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.slice(at, at + length));

/** A WAV file put together by hand, with any chunks. */
function wavFile(chunks: { id: string; body: number[] | Uint8Array }[]): Uint8Array {
  const parts: number[] = [];
  for (const chunk of chunks) {
    const body = Array.from(chunk.body);
    parts.push(...[...chunk.id].map((c) => c.charCodeAt(0)), body.length & 255, (body.length >> 8) & 255, (body.length >> 16) & 255, (body.length >> 24) & 255, ...body);
    if (body.length % 2) parts.push(0);
  }
  const size = 4 + parts.length;
  return new Uint8Array([...[..."RIFF"].map((c) => c.charCodeAt(0)), size & 255, (size >> 8) & 255, (size >> 16) & 255, (size >> 24) & 255, ...[..."WAVE"].map((c) => c.charCodeAt(0)), ...parts]);
}
function fmt(format: number, channels: number, rate: number, bits: number, extra: number[] = []): { id: string; body: number[] } {
  const align = (channels * bits) / 8;
  const body = new DataView(new ArrayBuffer(16));
  body.setUint16(0, format, true);
  body.setUint16(2, channels, true);
  body.setUint32(4, rate, true);
  body.setUint32(8, rate * align, true);
  body.setUint16(12, align, true);
  body.setUint16(14, bits, true);
  return { id: "fmt ", body: [...new Uint8Array(body.buffer), ...extra] };
}

describe("encodeWav", () => {
  it("writes a correct 16-bit header", () => {
    const bytes = encodeWav([new Float32Array(10), new Float32Array(10)], 44100);
    const view = new DataView(bytes.buffer);
    expect(bytes.length).toBe(44 + 10 * 4);
    expect(text(bytes, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(text(bytes, 8, 8)).toBe("WAVEfmt ");
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(28, true)).toBe(44100 * 4);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(bytes, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(40);
  });
  it("interleaves the channels and clips what's too loud", () => {
    const bytes = encodeWav([new Float32Array([0, 1, -1, 2, -2]), new Float32Array([0.5, -0.5, NaN, 0, 0])], 8000);
    const view = new DataView(bytes.buffer);
    const at = (frame: number, channel: number) => view.getInt16(44 + frame * 4 + channel * 2, true);
    expect([at(0, 0), at(1, 0), at(2, 0), at(3, 0), at(4, 0)]).toEqual([0, 32767, -32768, 32767, -32768]);
    expect([at(0, 1), at(1, 1), at(2, 1)]).toEqual([16384, -16384, 0]);
  });
  it("pads a shorter channel with silence", () => {
    const bytes = encodeWav([new Float32Array([0.5, 0.5, 0.5]), new Float32Array([0.5])], 8000);
    const { channels } = decodeWav(bytes);
    expect(channels[1].length).toBe(3);
    expect(Array.from(channels[1].slice(1))).toEqual([0, 0]);
  });
  it("writes an empty file for no sound", () => {
    const bytes = encodeWav([], 44100);
    expect(bytes.length).toBe(44);
    expect(decodeWav(bytes).channels[0].length).toBe(0);
  });
});

describe("decodeWav", () => {
  it("reads back what encodeWav wrote", () => {
    const left = Float32Array.from({ length: 500 }, (_, i) => Math.sin(i / 10) * 0.8);
    const right = Float32Array.from({ length: 500 }, (_, i) => Math.cos(i / 7) * 0.3);
    const { channels, sampleRate } = decodeWav(encodeWav([left, right], 48000));
    expect(sampleRate).toBe(48000);
    expect(channels).toHaveLength(2);
    expect(channels[0].length).toBe(500);
    for (let i = 0; i < 500; i += 37) {
      expect(channels[0][i]).toBeCloseTo(left[i], 3);
      expect(channels[1][i]).toBeCloseTo(right[i], 3);
    }
  });
  it("reads 8-bit files", () => {
    const { channels, sampleRate } = decodeWav(wavFile([fmt(1, 1, 11025, 8), { id: "data", body: [128, 255, 0, 192] }]));
    expect(sampleRate).toBe(11025);
    expect(Array.from(channels[0])).toEqual([0, 127 / 128, -1, 0.5]);
  });
  it("reads 24-bit files", () => {
    const { channels } = decodeWav(wavFile([fmt(1, 1, 44100, 24), { id: "data", body: [0, 0, 0x40, 0, 0, 0xc0, 0xff, 0xff, 0x7f, 0, 0, 0x80] }]));
    expect(channels[0][0]).toBeCloseTo(0.5, 6);
    expect(channels[0][1]).toBeCloseTo(-0.5, 6);
    expect(channels[0][2]).toBeCloseTo(1, 5);
    expect(channels[0][3]).toBe(-1);
  });
  it("reads 32-bit whole-number files", () => {
    const body = new DataView(new ArrayBuffer(8));
    body.setInt32(0, 0x40000000, true);
    body.setInt32(4, -0x80000000, true);
    const { channels } = decodeWav(wavFile([fmt(1, 1, 44100, 32), { id: "data", body: new Uint8Array(body.buffer) }]));
    expect(Array.from(channels[0])).toEqual([0.5, -1]);
  });
  it("reads 32-bit float files, in stereo", () => {
    const body = new DataView(new ArrayBuffer(16));
    [0.25, -0.75, 1.5, 0].forEach((v, i) => body.setFloat32(i * 4, v, true));
    const { channels } = decodeWav(wavFile([fmt(3, 2, 96000, 32), { id: "data", body: new Uint8Array(body.buffer) }]));
    expect(Array.from(channels[0])).toEqual([0.25, 1.5]);
    expect(Array.from(channels[1])).toEqual([-0.75, 0]);
  });
  it("reads 'extensible' files", () => {
    // 22 more bytes: size, valid bits, speaker mask, then the code starting with the real format (1 = whole numbers).
    const extra = [22, 0, 16, 0, 3, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71];
    const { channels } = decodeWav(wavFile([fmt(0xfffe, 1, 44100, 16, extra), { id: "data", body: [0, 0x40, 0, 0xc0] }]));
    expect(Array.from(channels[0])).toEqual([0.5, -0.5]);
  });
  it("skips chunks it doesn't know, odd-sized ones too", () => {
    const file = wavFile([{ id: "LIST", body: [1, 2, 3] }, fmt(1, 1, 22050, 16), { id: "cue ", body: [9, 9, 9, 9, 9] }, { id: "data", body: [0, 0x40, 0, 0x20] }, { id: "junk", body: [1, 2] }]);
    const { channels, sampleRate } = decodeWav(file);
    expect(sampleRate).toBe(22050);
    expect(Array.from(channels[0])).toEqual([0.5, 0.25]);
  });
  it("copes with a data size that's zero or too big", () => {
    const file = wavFile([fmt(1, 1, 44100, 16), { id: "data", body: [0, 0x40, 0, 0x20] }]);
    const view = new DataView(file.buffer);
    view.setUint32(40, 0, true);
    expect(decodeWav(file).channels[0].length).toBe(2);
    view.setUint32(40, 0xffffffff, true);
    expect(decodeWav(file).channels[0].length).toBe(2);
  });
  it("reads from the middle of a bigger buffer", () => {
    const file = encodeWav([new Float32Array([0.5, -0.5])], 44100);
    const bigger = new Uint8Array(file.length + 10);
    bigger.set(file, 7);
    expect(Array.from(decodeWav(bigger.subarray(7, 7 + file.length)).channels[0])).toEqual([16384 / 32768, -0.5]);
  });
  it("says so when it isn't a WAV file it can read", () => {
    expect(() => decodeWav(new Uint8Array([1, 2, 3]))).toThrow(BAD_WAV);
    expect(() => decodeWav(new TextEncoder().encode("This is not a sound file at all, just words."))).toThrow(BAD_WAV);
    expect(() => decodeWav(wavFile([fmt(1, 1, 44100, 16)]))).toThrow(BAD_WAV);
    expect(() => decodeWav(wavFile([{ id: "data", body: [0, 0] }]))).toThrow(BAD_WAV);
    // Compressed formats (here ADPCM) aren't read.
    expect(() => decodeWav(wavFile([fmt(2, 1, 44100, 4), { id: "data", body: [0, 0] }]))).toThrow(BAD_WAV);
  });
});

describe("peaksOf", () => {
  const samples = new Float32Array([0, 0.1, -0.5, 0.2, 0.9, -0.3, 0, -1.5]);

  it("finds the loudest sample in each slice", () => {
    const peaks = Array.from(peaksOf(samples, 4));
    [0.1, 0.5, 0.9, 1].forEach((v, i) => expect(peaks[i]).toBeCloseTo(v, 6));
  });
  it("works on part of a sound", () => {
    const peaks = Array.from(peaksOf(samples, 2, 2, 6));
    [0.5, 0.9].forEach((v, i) => expect(peaks[i]).toBeCloseTo(v, 6));
  });
  it("still shows something with more slices than samples", () => {
    const peaks = peaksOf(samples, 16, 0, 4);
    expect(peaks.length).toBe(16);
    expect(peaks[8]).toBeCloseTo(0.5, 6);
    expect(peaks[15]).toBeCloseTo(0.2, 6);
  });
  it("is silent outside the sound and for odd requests", () => {
    expect(Array.from(peaksOf(samples, 2, 8, 16))).toEqual([0, 0]);
    expect(Array.from(peaksOf(samples, 2, -4, 0))).toEqual([0, 0]);
    expect(peaksOf(samples, 0).length).toBe(0);
    expect(Array.from(peaksOf(samples, 3, 5, 5))).toEqual([0, 0, 0]);
    expect(Array.from(peaksOf(new Float32Array(0), 2))).toEqual([0, 0]);
  });
});

describe("the plucked string", () => {
  /** The pitch of a sound, from how far apart its repeats are. */
  function pitchOf(samples: Float32Array, rate: number, near: number): number {
    const from = Math.floor(rate * 0.05);
    const size = Math.floor(rate * 0.2);
    const score = (lag: number) => {
      let sum = 0;
      for (let i = from; i < from + size; i++) sum += samples[i] * samples[i + lag];
      return sum;
    };
    // Measured across many cycles at once, so a fraction of a sample matters little even for the highest notes.
    const cycles = Math.max(1, Math.round((rate * 0.02) / (rate / near)));
    const expected = (rate / near) * cycles;
    let best = 0;
    let bestScore = -Infinity;
    for (let lag = Math.floor(expected - 0.4 * (rate / near)); lag <= Math.ceil(expected + 0.4 * (rate / near)); lag++) {
      const s = score(lag);
      if (s > bestScore) {
        bestScore = s;
        best = lag;
      }
    }
    // Look between whole samples by fitting a curve through the best three.
    const [a, b, c] = [score(best - 1), bestScore, score(best + 1)];
    return (rate * cycles) / (best + (0.5 * (a - c)) / (a - 2 * b + c));
  }
  const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

  it("is in tune", () => {
    for (const rate of [44100, 48000]) {
      for (const frequency of [41.2, 82.41, 110, 261.63, 440, 1046.5, 2093, 3135.96, 4186]) {
        const samples = pluckSamples(frequency, rate, 0.8);
        expect(Math.abs(cents(pitchOf(samples, rate, frequency), frequency)), `${frequency} Hz at ${rate}`).toBeLessThan(2);
      }
    }
  });
  it("starts at full level, dies away and ends in silence", () => {
    const samples = pluckSamples(220, 44100, 1);
    let peak = 0;
    for (const v of samples) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeCloseTo(1, 3);
    const loudness = (from: number, to: number) => {
      let sum = 0;
      for (let i = Math.floor(from * 44100); i < Math.floor(to * 44100); i++) sum += samples[i] * samples[i];
      return Math.sqrt(sum / ((to - from) * 44100));
    };
    expect(loudness(1, 1.2)).toBeLessThan(loudness(0, 0.2) * 0.5);
    expect(Math.abs(samples[samples.length - 1])).toBeLessThan(0.001);
    expect(samples.every((v) => Number.isFinite(v))).toBe(true);
  });
  it("rings longer for low notes than for high ones", () => {
    expect(pluckDecay(65)).toBeGreaterThan(pluckDecay(1000));
    expect(pluckSamples(65, 44100, 1).length).toBeGreaterThan(pluckSamples(2000, 44100, 1).length);
  });
  it("is the same every time, and duller when plucked softly", () => {
    expect(Array.from(pluckSamples(330, 44100, 0.5).slice(0, 50))).toEqual(Array.from(pluckSamples(330, 44100, 0.5).slice(0, 50)));
    const roughness = (samples: Float32Array) => {
      let sum = 0;
      for (let i = 1; i < 2000; i++) sum += Math.abs(samples[i] - samples[i - 1]);
      return sum;
    };
    expect(roughness(pluckSamples(110, 44100, 0))).toBeLessThan(roughness(pluckSamples(110, 44100, 1)));
  });
  it("copes with the extremes", () => {
    for (const frequency of [8, 27.5, 12543, 30000]) {
      const samples = pluckSamples(frequency, 44100, 1);
      expect(samples.length).toBeGreaterThan(1000);
      expect(samples.every((v) => Number.isFinite(v) && Math.abs(v) <= 1.0001)).toBe(true);
    }
  });
});
