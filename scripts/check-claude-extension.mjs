/**
 * Checks the Claude extension the way Claude's desktop app would use it:
 *   node scripts/check-claude-extension.mjs dist/juradaw-claude.mcpb
 * Unpacks the .mcpb (a zip), checks its manifest, starts its server with Node
 * and talks MCP to it over stdin/stdout: lists the tools, writes a short song
 * (a drum beat and a bass line from the library, chords of its own), looks at
 * it, saves a .juradaw file and a MIDI file — then checks those files — and
 * cancels a call (nothing may change). Then it connects to the live link
 * (Live with Claude) as the JuraDAW tab would, writes over it, and checks the
 * extension stops when Claude closes it.
 * Fails (exit code 1, with GitHub annotations in CI) if anything is wrong.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";

const inCI = process.env.GITHUB_ACTIONS === "true";
const fail = (msg) => {
  if (inCI) console.log(`::error title=Claude extension check failed::${String(msg).replace(/%/g, "%25").replace(/\r?\n/g, "%0A")}`);
  console.error(`FAILED: ${msg}`);
  process.exit(1);
};
const check = (cond, msg) => cond || fail(msg);

/** Unpack a zip file (stored or deflated entries) into a folder. */
function unzip(file, into) {
  const zip = readFileSync(file);
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  check(end >= 0, `${file} isn't a zip file.`);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    check(zip.readUInt32LE(at) === 0x02014b50, "The zip's directory is damaged.");
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    check(!name.includes("..") && !name.startsWith("/"), `Unsafe path in the zip: ${name}`);
    names.push(name);
    if (name.endsWith("/")) continue;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + size);
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : fail(`Unsupported zip method ${method} for ${name}`);
    mkdirSync(dirname(join(into, name)), { recursive: true });
    writeFileSync(join(into, name), data);
  }
  return names;
}

const target = process.argv[2] ?? "dist/juradaw-claude.mcpb";
check(existsSync(target), `${target} doesn't exist — the extension wasn't built.`);
const work = mkdtempSync(join(tmpdir(), "juradaw-ext-"));
let dir = target;
if (statSync(target).isFile()) {
  dir = join(work, "unpacked");
  const names = unzip(target, dir);
  console.log(`${target}: ${(statSync(target).size / 1e6).toFixed(1)} MB, ${names.length} entries`);
  check(!names.some((n) => n.startsWith("node_modules/")), "The bundle shouldn't need node_modules.");
}

// The manifest.
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
check(typeof manifest.manifest_version === "string", "manifest_version is missing.");
check(manifest.name === "juradaw", "The manifest's name should be juradaw.");
check(manifest.version === pkg.version, `The manifest's version (${manifest.version}) should be the app's (${pkg.version}).`);
check(manifest.author?.name && manifest.description, "The manifest needs an author and a description.");
check(manifest.server?.type === "node" && existsSync(join(dir, manifest.server.entry_point)), "The server's entry point is missing.");
check(existsSync(join(dir, manifest.icon)), "The icon is missing.");
for (const f of ["LICENSE", "THIRD-PARTY-NOTICES.txt"]) check(existsSync(join(dir, f)), `${f} is missing.`);
check(!manifest.compatibility?.platforms?.includes("linux"), "Claude's desktop app runs on macOS and Windows only.");
check(manifest.user_config?.song_folder?.type === "directory", "The song folder setting should be a directory.");
check(manifest.server.mcp_config.args.includes("${user_config.song_folder}"), "The server should be given the song folder.");
check(Array.isArray(manifest.tools) && manifest.tools.length >= 10, "The manifest should list the tools.");

// Start the server and talk to it.
const songs = join(work, "My songs");
const child = spawn(process.execPath, [join(dir, manifest.server.entry_point), songs], { stdio: ["pipe", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (d) => (stderr += d));
const waiting = new Map();
let buffer = "";
child.stdout.on("data", (d) => {
  buffer += d;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      fail(`The server printed something that isn't MCP on stdout: ${line.slice(0, 200)}`);
    }
    if (msg.id !== undefined && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    }
  }
});
child.on("exit", (code) => waiting.size && fail(`The server stopped (code ${code}).\n${stderr.slice(-2000)}`));
let nextId = 1;
const send = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
const timer = setTimeout(() => fail(`Timed out talking to the server.\n${stderr.slice(-2000)}`), 120_000);

const init = await send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "juradaw-check", version: "1" } });
check(init.result?.serverInfo?.name === "juradaw", `initialize failed: ${JSON.stringify(init).slice(0, 500)}`);
check(/Notes inside a clip are given in BEATS/.test(init.result?.instructions ?? ""), "The server's instructions should explain how songs are described.");
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
const listed = await send("tools/list", {});
const tools = listed.result?.tools ?? [];
check(tools.length === manifest.tools.length, `The server has ${tools.length} tools; the manifest lists ${manifest.tools.length}.`);
for (const t of manifest.tools) check(tools.some((x) => x.name === t.name), `The manifest's tool ${t.name} isn't on the server.`);

const call = async (name, args) => {
  const r = await send("tools/call", { name, arguments: args });
  check(!r.error && !r.result?.isError, `${name} failed: ${JSON.stringify(r.error ?? r.result).slice(0, 800)}`);
  return r.result.content;
};
const text = (content) => content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

// A short song: a beat and a bass line from the library, and chords written note by note.
await call("new_song", { name: "CI song", tempo: 100 });
const patterns = text(await call("list_library_patterns", {}));
const firstOf = (heading) => new RegExp(`${heading}:\\n- ([a-z0-9-]+) —`).exec(patterns)?.[1];
const beat = firstOf("Drum beats");
const bassLine = firstOf("Bass lines");
check(beat && bassLine, `The library's drum beats and bass lines aren't listed:\n${patterns.slice(0, 600)}`);
await call("insert_library_pattern", { pattern: beat });
await call("insert_library_pattern", { pattern: bassLine, settings: { key: "A", scale: "minor" } });
await call("add_track", { instrument: "piano", name: "Chords", volume: 70 });
const chord = (names, start) => names.map((pitch) => ({ pitch, start, length: 4, velocity: 80 }));
const added = text(await call("add_clip", { track: "Chords", notes: [...chord(["A3", "C4", "E4"], 0), ...chord(["F3", "A3", "C4"], 4), ...chord(["C4", "E4", "G4"], 8), ...chord(["G3", "B3", "D4"], 12)] }));
check(/bar 1 to 5, 12 notes/.test(added), `The chords clip isn't as expected:\n${added}`);
await call("repeat_clip", { track: "Chords", clip: 1, times: 1 });
// The track's own effects and a clip's shape.
await call("edit_track", { track: "Chords", drive: 25, pump: 50, filter: { kind: "low", cutoff: 80, resonance: 20 } });
await call("edit_clip", { track: "Chords", clip: 1, fade_in: 4, filter_sweep: { from: 30, to: 100 } });
const described = text(await call("describe_song", { notes: true }));
check(/Song "CI song": 100 beats a minute, 4 beats in a bar/.test(described), `describe_song doesn't show the song:\n${described}`);
check(/plays drums/.test(described) && /"Chords" — plays piano/.test(described) && /beat 0: A3, 4 long, velocity 80/.test(described), `describe_song doesn't show the tracks and notes:\n${described}`);
// Nothing outside the chosen folder, and a clip never on top of another.
const escape = await send("tools/call", { name: "save_song", arguments: { filename: "../outside" } });
check(escape.result?.isError, "Saving outside the folder should be refused.");
const over = await send("tools/call", { name: "add_clip", arguments: { track: "Chords", start_bar: 2, notes: [{ pitch: "C4", start: 0 }] } });
check(over.result?.isError && /on top of a clip/.test(text(over.result.content)), "A clip on top of another should be refused.");
await call("save_song", {});
const saved = join(songs, "CI song.juradaw");
check(existsSync(saved), `No song was saved at ${saved}.`);
const file = JSON.parse(readFileSync(saved, "utf8"));
const chords = file.song?.tracks?.find((t) => t.name === "Chords");
check(chords?.drive === 0.25 && chords.pump === 0.5 && chords.filter?.cutoff === 0.8 && file.song.clips.some((c) => c.fadeIn === 4 && c.sweep?.from === 0.3), "The saved song should keep the track's effects and the clip's fade and sweep.");
check(file.app === "JuraDAW" && file.song?.tracks?.length === 3 && file.song.clips.length === 4 && file.song.bpm === 100, "The saved song isn't a JuraDAW file with 3 tracks and 4 clips at 100 bpm.");
await call("export_midi", {});
const mid = readFileSync(join(songs, "CI song.mid"));
check(mid.subarray(0, 4).toString("latin1") === "MThd" && mid.readUInt16BE(10) === 4, "The MIDI file should have a header and four tracks (the song's settings and its three instruments).");

// Cancelling a call (as Claude does when the user stops it): no reply, and nothing changed.
const cancelId = nextId++;
let cancelledReply = null;
waiting.set(cancelId, (msg) => (cancelledReply = msg));
child.stdin.write(
  JSON.stringify({ jsonrpc: "2.0", id: cancelId, method: "tools/call", params: { name: "add_track", arguments: { instrument: "organ", name: "Cancelled" } } }) +
    "\n" +
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: cancelId, reason: "The user stopped it." } }) +
    "\n",
);
const afterCancel = text(await call("describe_song", {}));
await new Promise((resolve) => setTimeout(resolve, 1000));
check(cancelledReply === null, `A cancelled call was still answered: ${JSON.stringify(cancelledReply).slice(0, 300)}`);
waiting.delete(cancelId);
check(!/Cancelled/.test(afterCancel) && /"Chords"/.test(afterCancel), `A cancelled call still changed the song:\n${afterCancel}`);

// Live with Claude: the extension listens on 127.0.0.1 for the JuraDAW tab. Talk to it the way the app does
// (src/live/protocol.ts), from the JuraDAW site's origin, using Node's own WebSocket.
const LIVE_PORTS = Array.from({ length: 10 }, (_, i) => 47635 + i);
const openSocket = (port, origin) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/juradaw-live`, { protocols: ["juradaw-live.1"], headers: { origin } });
    ws.onopen = () => resolve(ws);
    ws.onerror = () => resolve(null);
  });
check(!(await openSocket(LIVE_PORTS[0], "https://evil.example")), "A page from another website could open the live link.");
// Pages served on this computer (a dev server, another program) are kept out too, unless JURADAW_LIVE_DEV=1.
for (const origin of ["http://localhost:5173", "http://127.0.0.1:1234", "https://localhost"]) {
  check(!(await openSocket(LIVE_PORTS[0], origin)), `A page from ${origin} could open the live link.`);
}
let ws = null;
let livePort = 0;
for (const port of LIVE_PORTS) if ((ws = await openSocket(port, "https://gm7dha.github.io"))) {
  livePort = port;
  break;
}
check(ws, `The live link isn't listening on 127.0.0.1 (ports ${LIVE_PORTS.join(", ")}).\n${stderr.slice(-2000)}`);
const fromExtension = [];
let answer = null;
const nextMessage = () => new Promise((resolve) => (answer = resolve));
ws.onmessage = (e) => {
  const msg = JSON.parse(String(e.data));
  fromExtension.push(msg);
  if (msg.type === "change") ws.send(JSON.stringify({ type: "applied", id: msg.id, version: msg.base + 1 }));
  answer?.(msg);
};
const liveFile = (song) => JSON.stringify({ app: "JuraDAW", version: 1, song, sounds: {} });
const liveSong = { name: "Live check", bpm: 120, beatsPerBar: 4, master: 0.8, loop: { on: false, start: 0, end: 16 }, tracks: [], clips: [], audio: [] };
const welcome = nextMessage();
ws.send(JSON.stringify({ type: "hello", protocol: 1, app: pkg.version, version: 1, file: liveFile(liveSong) }));
check((await welcome).type === "welcome", `The live link didn't welcome JuraDAW: ${JSON.stringify(fromExtension)}`);
check(/Live: connected/.test(text(await call("live_status", {}))), "live_status doesn't say it's connected.");
const live = text(await call("add_track", { instrument: "strings" }));
check(/Live: this now shows in the user's open JuraDAW tab/.test(live), `A live change didn't say it was shown:\n${live}`);
let changes = fromExtension.filter((m) => m.type === "change");
check(changes.length === 1 && changes[0].base === 1 && /^Claude: [a-z]/.test(changes[0].label), `Expected one change based on version 1: ${JSON.stringify(changes).slice(0, 500)}`);
const liveDoc = JSON.parse(changes[0].file).song;
check(liveDoc.name === "Live check" && liveDoc.tracks.length === 1 && liveDoc.tracks[0].instrument === "strings", "The live change isn't the open song plus a strings track.");
// The user changes the song in the app (version 3): Claude's next change is made on top of it.
ws.send(JSON.stringify({ type: "doc", version: 3, file: liveFile({ ...liveDoc, name: "Renamed in the app" }) }));
await call("add_clip", { track: "Strings", notes: [{ pitch: "C4", start: 0, length: 4 }] });
changes = fromExtension.filter((m) => m.type === "change");
const second = JSON.parse(changes[1]?.file ?? "{}").song;
check(changes.length === 2 && changes[1].base === 3 && second?.name === "Renamed in the app" && second.clips?.length === 1, "Claude's second live change wasn't made on the user's latest song.");
ws.close();

// Safari's link window: served over plain http on 127.0.0.1 (only under that name), and its origin may open the live link.
const relayPage = await fetch(`http://127.0.0.1:${livePort}/juradaw-relay`);
const relayHtml = await relayPage.text();
check(relayPage.status === 200 && relayHtml.includes('<script src="/juradaw-relay.js"></script>'), `The link window page isn't served: ${relayPage.status} ${relayHtml.slice(0, 200)}`);
check(/frame-ancestors 'none'/.test(relayPage.headers.get("content-security-policy") ?? "") && relayPage.headers.get("x-frame-options") === "DENY", "The link window page may be framed.");
const relayJs = await fetch(`http://127.0.0.1:${livePort}/juradaw-relay.js`);
const relaySource = await relayJs.text();
check(relayJs.status === 200 && /javascript/.test(relayJs.headers.get("content-type") ?? ""), `The link window script isn't served: ${relayJs.status}`);
// Other sites can't load them to find out whether the extension is running.
for (const r of [relayPage, relayJs]) check(r.headers.get("cross-origin-resource-policy") === "same-origin", `The link window's ${r.url} may be loaded by other sites.`);
try {
  new Function(relaySource);
} catch (e) {
  check(false, `The link window script doesn't parse: ${e}`);
}
check(relaySource.includes('"site":"https://gm7dha.github.io"') && relaySource.includes('"allowLocal":false'), "The shipped link window script must obey only the JuraDAW site.");
const relaySocket = await openSocket(livePort, `http://127.0.0.1:${livePort}`);
check(relaySocket, "The link window's origin couldn't open the live link.");
relaySocket?.close();
check(!(await openSocket(livePort, `http://localhost:${livePort}`)), "A page on http://localhost could open the live link.");

clearTimeout(timer);
// When Claude closes the extension (its input), it must stop, freeing the live link's port.
const stopped = new Promise((resolve) => child.once("exit", () => resolve(true)));
child.stdin.end();
const exited = await Promise.race([stopped, new Promise((resolve) => setTimeout(() => resolve(false), 5000))]);
if (!exited) child.kill();
check(exited, "The extension kept running after Claude closed it (it would keep the live link's port busy).");
rmSync(work, { recursive: true, force: true });
console.log(`The Claude extension works: ${tools.length} tools; wrote a song (a beat and a bass line from the library, chords of its own), saved it and its MIDI file; a cancelled call changed nothing; wrote live over the local link (${changes.length} changes, each applied once); served Safari's link window.`);
