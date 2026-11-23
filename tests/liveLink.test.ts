/**
 * Live with Claude, end to end in Node: the extension's real WebSocket server
 * and bridge (src/mcp/websocket.ts, live.ts), the app's real live client
 * (src/live/client.ts) over Node's own WebSocket, a stand-in for the app's
 * store (a song and its undo list), and Claude's tools.
 */
import { request, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { newSong, newTrack, readSongFile, songFileText } from "../src/model/document";
import * as edits from "../src/model/edits";
import type { Song } from "../src/model/types";
import { LiveClient, type LiveHost, type SocketLike } from "../src/live/client";
import { LIVE_PATH, LIVE_SUBPROTOCOL } from "../src/live/protocol";
import { SongFolder } from "../src/mcp/files";
import { LiveBridge } from "../src/mcp/live";
import { Session } from "../src/mcp/session";
import { callTool, type ToolResult } from "../src/mcp/tools";
import { startLiveServer } from "../src/mcp/websocket";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).reverse().forEach((f) => f());
});

const textOf = (r: ToolResult) => r.content.map((c) => c.text).join("\n");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, ms = 30_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await wait(10);
  }
}

/** The app, as far as the live link sees it: a song with undo, and something that may be in the way. */
class FakeApp implements LiveHost {
  appVersion = "test";
  browser = "chrome" as const;
  past: Song[] = [];
  song: Song;
  inTheWay: string | null = null;
  applied: { label: string; replace: boolean }[] = [];
  private listeners = new Set<() => void>();
  constructor(song: Song) {
    this.song = song;
  }
  current() {
    const song = this.song;
    return { key: song, file: () => songFileText(song) };
  }
  busy() {
    return this.inTheWay;
  }
  apply(file: string, label: string, replace: boolean) {
    const r = readSongFile(file);
    if (!r.ok) return r.error;
    this.past.push(this.song);
    this.song = r.song;
    this.applied.push({ label, replace });
    // Like the real store, which tells its listeners (the live link among them) straight away.
    this.listeners.forEach((f) => f());
    return null;
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  /** The user changes the song (and the app tells the link, unless `quietly`). */
  edit(fn: (s: Song) => Song, quietly = false) {
    this.past.push(this.song);
    this.song = fn(this.song);
    if (!quietly) this.listeners.forEach((f) => f());
  }
  undo() {
    const before = this.past.pop();
    if (before) this.song = before;
    this.listeners.forEach((f) => f());
  }
}

const SITE = "https://gm7dha.github.io";
const socketFrom = (origin: string) => (url: string, protocol: string) => new WebSocket(url, { protocols: [protocol], headers: { origin } } as unknown as string[]) as unknown as SocketLike;

async function chat(opts: { allowLocalOrigins?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "juradaw-live-"));
  const bridge = new LiveBridge("test-ext", () => {}, 20_000);
  const started = await startLiveServer({ ports: [0], accept: (c) => bridge.connect(c), allowLocalOrigins: opts.allowLocalOrigins });
  if (!started) throw new Error("no port");
  const session = new Session(new SongFolder(join(dir, "JuraDAW")));
  session.live = bridge;
  cleanups.push(() => {
    bridge.close();
    (started.server as Server).close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { bridge, port: started.port, session };
}

async function setup(song: Song = newSong("Demo")) {
  const c = await chat();
  const app = new FakeApp(song);
  const client = new LiveClient(app, socketFrom(SITE), [c.port]);
  cleanups.push(() => client.disconnect());
  return { ...c, app, client };
}

async function ok(s: Session, name: string, args: unknown = {}) {
  const r = await callTool(s, name, args);
  if (r.isError) throw new Error(`${name} failed: ${textOf(r)}`);
  return textOf(r);
}

/** Try a raw WebSocket handshake; resolves with the HTTP status. */
function handshake(port: number, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: "127.0.0.1",
      port,
      path: LIVE_PATH,
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Protocol": LIVE_SUBPROTOCOL, ...headers },
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on("response", (res) => resolve(res.statusCode ?? 0));
    req.on("error", reject);
    req.end();
  });
}

describe("Live with Claude", () => {
  it("only lets the JuraDAW site in", async () => {
    const { port, bridge } = await setup();
    expect(await handshake(port, { Origin: "https://evil.example" })).toBe(403);
    expect(await handshake(port, {})).toBe(403);
    expect(await handshake(port, { Origin: SITE, Host: `evil.example:${port}` })).toBe(403);
    expect(await handshake(port, { Origin: SITE, "Sec-WebSocket-Protocol": "juracad-live.1" })).toBe(400);
    for (const origin of ["http://localhost:9999", "http://127.0.0.1:1234", "https://localhost"]) expect(await handshake(port, { Origin: origin })).toBe(403);
    const stranger = new LiveClient(new FakeApp(newSong("x")), socketFrom("https://evil.example"), [port]);
    expect((await stranger.connect()).kind).toBe("failed");
    expect(bridge.connected).toBe(false);
    expect(await handshake(port, { Origin: SITE })).toBe(101);
    const dev = await chat({ allowLocalOrigins: true });
    expect(await handshake(dev.port, { Origin: "http://localhost:4173" })).toBe(101);
  });

  it("works on the song open in the tab, one undo step for each change", async () => {
    const { app, client, bridge, session } = await setup(newSong("Open in the tab"));
    expect(await ok(session, "live_status")).toMatch(/Live: not connected/);
    expect((await client.connect()).kind).toBe("connected");
    await until(() => bridge.connected, "the tab");
    expect(await ok(session, "live_status")).toMatch(/Live: connected.*Song "Open in the tab"/);
    expect(await ok(session, "describe_song")).toMatch(/Song "Open in the tab"/);
    const said = await ok(session, "add_track", { instrument: "piano" });
    expect(said).toMatch(/Live: this now shows in the user's open JuraDAW tab/);
    expect(app.song.tracks.map((t) => t.instrument)).toEqual(["piano"]);
    expect(app.applied).toEqual([{ label: expect_label(app.applied[0].label), replace: false }]);
    await ok(session, "add_clip", { track: "Piano", notes: [{ pitch: "C4", start: 0 }] });
    expect(app.song.clips).toHaveLength(1);
    expect(app.past).toHaveLength(2);
    // Looking changes nothing and sends nothing.
    await ok(session, "describe_song", { notes: true });
    expect(app.applied).toHaveLength(2);
    // The user undoes Claude's last step and adds a track of their own: Claude sees the song as it is now.
    app.undo();
    app.edit((s) => edits.addTrack(s, newTrack("instrument", "drums", s.tracks)));
    await until(() => bridge.doc?.tracks.length === 2, "the user's change to arrive");
    const look = await ok(session, "describe_song");
    expect(look).toMatch(/"Drums" — plays drums/);
    expect(look).toMatch(/"Piano"[^\n]*\n {3}\(no clips\)/);
    // A whole new song from Claude replaces the one on show (as one step).
    await ok(session, "new_song", { name: "From Claude", tempo: 90 });
    expect(app.song.name).toBe("From Claude");
    expect(app.applied[app.applied.length - 1]).toEqual({ label: 'Claude: started a new song, "From Claude"', replace: true });
  });

  it("refuses a change made from an older song or while the user is busy, and loses nothing", async () => {
    const { app, client, bridge, session } = await setup();
    await client.connect();
    await until(() => bridge.connected, "the tab");
    await ok(session, "add_track", { instrument: "bass" });
    // The user changes the song at the same moment (the news hasn't reached the extension yet).
    app.edit((s) => edits.setBpm(s, 140), true);
    const r = await callTool(session, "add_track", { instrument: "organ" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/changed the song in JuraDAW at the same moment.*NOT applied/);
    expect(app.song.tracks).toHaveLength(1);
    expect(app.song.bpm).toBe(140);
    // Claude looks again and retries: now it goes in, on top of the user's change.
    app.edit((s) => s);
    await until(() => bridge.doc?.bpm === 140, "the user's change to arrive");
    await ok(session, "add_track", { instrument: "organ" });
    expect(app.song.tracks.map((t) => t.instrument)).toEqual(["bass", "organ"]);
    expect(app.song.bpm).toBe(140);
    app.inTheWay = "The user is recording in JuraDAW.";
    const busy = await callTool(session, "set_song", { tempo: 100 });
    expect(textOf(busy)).toMatch(/didn't take this change: The user is recording/);
    expect(app.song.bpm).toBe(140);
    expect(session.song.bpm).toBe(140);
    app.inTheWay = null;
    await ok(session, "set_song", { tempo: 100 });
    expect(app.song.bpm).toBe(100);
  });

  it("goes back to Claude's own copy when the tab disconnects, and takes the next tab's song afresh", async () => {
    const { app, client, bridge, session, port } = await setup(newSong("First"));
    await client.connect();
    await until(() => bridge.connected, "the tab");
    await ok(session, "add_track", { instrument: "piano" });
    client.disconnect();
    await until(() => !bridge.connected, "the tab to go");
    await ok(session, "add_track", { instrument: "bass" });
    expect(app.song.tracks).toHaveLength(1);
    expect(session.song.tracks).toHaveLength(2);
    const second = new FakeApp(newSong("Second"));
    const secondClient = new LiveClient(second, socketFrom(SITE), [port]);
    cleanups.push(() => secondClient.disconnect());
    await secondClient.connect();
    await until(() => bridge.connected, "the second tab");
    expect(bridge.version).toBe(1);
    expect(await ok(session, "describe_song")).toMatch(/Song "Second"/);
    // Only one tab at a time for a chat: a third is told why.
    const third = new LiveClient(new FakeApp(newSong("Third")), socketFrom(SITE), [port]);
    cleanups.push(() => third.disconnect());
    expect((await third.connect()).kind).toBe("failed");
  });

  it("links every Claude chat, and passes one chat's change on to the others", async () => {
    const a = await chat();
    const b = await chat();
    const app = new FakeApp(newSong("Shared"));
    const client = new LiveClient(app, socketFrom(SITE), [a.port, b.port]);
    cleanups.push(() => client.disconnect());
    const state = await client.connect();
    expect(state.kind === "connected" && state.chats).toBe(2);
    await until(() => a.bridge.connected && b.bridge.connected, "both chats");
    await ok(a.session, "add_track", { instrument: "strings" });
    await until(() => b.bridge.doc?.tracks.length === 1, "the other chat to hear of it");
    expect(await ok(b.session, "describe_song")).toMatch(/plays strings/);
    await ok(b.session, "add_track", { instrument: "bells" });
    expect(app.song.tracks.map((t) => t.instrument)).toEqual(["strings", "bells"]);
  });
});

/** The label of a change: "Claude: " and a few words. */
function expect_label(label: string): string {
  expect(label).toMatch(/^Claude: [a-z]/);
  return label;
}
