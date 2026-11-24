/**
 * Browser smoke test: serves the production build, opens it in headless
 * Chromium and does what a person would: add an instrument track from the
 * welcome card → draw a clip and its notes → play, loop and stop → put a drum
 * beat in from the Library → mute and solo in the mixer → record notes with
 * the typing keyboard → export a WAV and a MIDI file (and stop an export
 * part-way) → save a .juradaw file, start a new song and open it again (Open
 * asking first when there are unsaved changes) → import a sound file → undo,
 * redo and the History list → a MIDI keyboard connected only when asked →
 * dark mode, Help and What's new → the bars fitting at 1024 and 1280 px. Fails on any console
 * error. Run after `npm run build`.
 *
 * In GitHub Actions, problems are reported as annotations. SMOKE_SCREENSHOT=1
 * also saves smoke.png beside the build. SMOKE_DIST points it at a build
 * somewhere else.
 *
 * Nothing here waits a fixed time: every step waits for what it expects to
 * see (the playhead past a place, a clip in the song, a file downloaded).
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { chromium } from "playwright";

const inCI = process.env.GITHUB_ACTIONS === "true";
const annotate = (level, title, message) => {
  if (inCI) console.log(`::${level} title=${title}::${String(message).replace(/%/g, "%25").replace(/\r?\n/g, "%0A")}`);
  else console.log(`[${level}] ${title}: ${message}`);
};

// The site's base path, as vite.config.ts builds it (CI passes BASE_PATH; default /JuraDAW/).
const wanted = process.env.BASE_PATH || "/JuraDAW/";
const basePath = `/${wanted.replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");
const dist = process.env.SMOKE_DIST || "dist";
if (!existsSync(join(dist, "index.html"))) {
  annotate("error", "Smoke test", `No build at ${dist}/index.html — run npm run build first.`);
  process.exit(1);
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.startsWith(basePath)) path = path.slice(basePath.length - 1);
  if (path === "/" || path === "") path = "/index.html";
  try {
    const data = await readFile(join(dist, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(4173, "127.0.0.1", r));

/** A small sound file made here, for Import: one second of a 440 Hz tone that fades away (16-bit mono WAV). */
function testWav(seconds = 1, rate = 22050) {
  const n = Math.round(seconds * rate);
  const out = Buffer.alloc(44 + n * 2);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + n * 2, 4);
  out.write("WAVEfmt ", 8, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // plain samples (PCM)
  out.writeUInt16LE(1, 22); // one channel
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) out.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 20000 * (1 - i / n)), 44 + i * 2);
  return out;
}

/** What a WAV file says about itself, and how loud it gets (read here, not by the app). */
function readWav(bytes) {
  const tag = (at) => bytes.toString("ascii", at, at + 4);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  const info = { riffSize: bytes.readUInt32LE(4), fileSize: bytes.length };
  for (let at = 12; at + 8 <= bytes.length; ) {
    const size = bytes.readUInt32LE(at + 4);
    if (tag(at) === "fmt ") {
      info.format = bytes.readUInt16LE(at + 8);
      info.channels = bytes.readUInt16LE(at + 10);
      info.rate = bytes.readUInt32LE(at + 12);
      info.bits = bytes.readUInt16LE(at + 22);
    } else if (tag(at) === "data") {
      info.dataSize = size;
      info.dataEnd = at + 8 + size;
      if (info.bits === 16 && info.channels) {
        const frames = Math.floor(size / (2 * info.channels));
        let peak = 0;
        let sum = 0;
        for (let i = 0; i < frames * info.channels; i++) {
          const v = bytes.readInt16LE(at + 8 + i * 2) / 32768;
          peak = Math.max(peak, Math.abs(v));
          sum += v * v;
        }
        info.frames = frames;
        info.seconds = frames / info.rate;
        info.peak = peak;
        info.rms = Math.sqrt(sum / Math.max(1, frames * info.channels));
      }
    }
    at += 8 + size + (size % 2);
  }
  return info;
}

const started = Date.now();
let step = "starting";
/** Name the step that's beginning (said if it fails, and listed as the test goes). */
const begin = (name) => {
  step = name;
  console.log(`  ${((Date.now() - started) / 1000).toFixed(1).padStart(5)} s  ${name}`);
};

// Sound may start without waiting for a click, as it may once a person has used the page.
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
const errors = [];
// While connecting to Claude the page tries each of the live link's ports; the browser logs every one nobody is listening on.
const liveProbeRefused = (e) => /^WebSocket connection to 'ws:\/\/127\.0\.0\.1:476(3[5-9]|4[0-4])\/juradaw-live' failed: .*net::ERR_CONNECTION_REFUSED/.test(e);
page.on("console", (m) => m.type() === "error" && !liveProbeRefused(m.text()) && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const expect = (ok, what) => {
  if (!ok) throw new Error(`Expected ${what}`);
};
/** Read something from the app's state: `get("s.history.present.tracks.length")`. */
const get = (expression) => page.evaluate((e) => new Function("s", "engine", `return ${e}`)(window.juradawStore.getState(), window.juradawEngine), expression);
/** Wait until something about the app's state is true. */
const until = (expression, what) =>
  page
    .waitForFunction((e) => new Function("s", "engine", `return ${e}`)(window.juradawStore.getState(), window.juradawEngine), expression, { polling: "raf" })
    .catch(() => {
      throw new Error(`Waited for ${what}, but it didn't happen`);
    });
const song = () => get("s.history.present");
/** Wait for the playhead to pass a place in the song (beats). */
const playedPast = (beat) => until(`engine.position() > ${beat}`, `the playhead to pass beat ${beat}`);

/** The tracks view scrolled back to its start (as the scroll bars would). */
const scrollHome = () => page.evaluate(() => document.querySelector(".tracks-view")?.scrollTo(0, 0));
/** A place over the lanes on the screen: a beat along, and a track's row from the top. */
const lanePoint = async (beat, row) =>
  page.evaluate(
    ([b, r]) => {
      const lanes = document.querySelector(".lanes");
      const box = lanes.getBoundingClientRect();
      // The strong grid lines are a bar apart at these zooms, which says how wide a beat is drawn.
      const perBeat = parseFloat(lanes.style.getPropertyValue("--strong")) / window.juradawStore.getState().history.present.beatsPerBar;
      const rowHeight = lanes.querySelector(".lane").getBoundingClientRect().height;
      return [box.left + b * perBeat, box.top + (r + 0.5) * rowHeight];
    },
    [beat, row],
  );
/** A place in the bar ruler: `loop` for the yellow strip along its top, otherwise the numbers under it. */
const rulerPoint = async (beat, loop = false) => {
  const [x] = await lanePoint(beat, 0);
  const box = await page.locator(".ruler").boundingBox();
  return [x, box.y + (loop ? 5 : 26)];
};
const dragMouse = async (from, to) => {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
};
/** Click something that saves a file; the file's name and bytes. */
const download = async (click) => {
  const [file] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), click()]);
  return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) };
};
/** Click something that asks for a file, and give it one made here. */
const choose = async (click, file) => {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), click()]);
  await chooser.setFiles(file);
};
/** Close the messages at the bottom of the window (their ✕), so they aren't in the way of what's clicked next. */
const closeToasts = async () => {
  while ((await page.locator(".toast button").count()) > 0) await page.locator(".toast button").first().click();
};
/** The same data, whatever order each object's fields are in. */
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const sameData = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const toolbarButton = (label) => page.locator(`.toolbar [aria-label="${label}"]`);
const topButton = (label) => page.locator(`.topbar button:has-text("${label}")`);

try {
  begin("open the app");
  await page.goto(`http://127.0.0.1:4173${basePath}?smoke`);
  await page.waitForFunction(() => !!window.juradawStore && !!window.juradawEngine);
  await page.evaluate(() => localStorage.clear());
  // The browser's own Save / Open windows can't be driven from a test: the ordinary download and file picker are used instead.
  // A pretend MIDI keyboard, and a count of how often the page asks the browser for MIDI: it must only ask when the
  // owner presses "Connect a MIDI keyboard" (or, on a later visit, after they have said yes here).
  await page.addInitScript(() => {
    window.showOpenFilePicker = undefined;
    window.showSaveFilePicker = undefined;
    window.midiAsked = 0;
    navigator.requestMIDIAccess = async () => {
      window.midiAsked++;
      return { inputs: new Map([["k", { name: "Test Keys", state: "connected", onmidimessage: null }]]), onstatechange: null };
    };
  });
  await page.reload();
  await page.waitForFunction(() => !!window.juradawStore && !!window.juradawEngine);
  await page.waitForSelector(".welcome");
  expect((await page.locator(".welcome-card").count()) === 3, "three ways to begin on the welcome");
  expect((await get("s.history.present.tracks.length")) === 0, "an empty song to start with");

  begin("add an instrument track from the welcome card");
  await page.click(".welcome-card:has-text('Play an instrument')");
  await page.waitForSelector(".track-header");
  let now = await song();
  expect(now.tracks.length === 1 && now.tracks[0].kind === "instrument" && now.tracks[0].instrument === "piano", "a piano track");
  expect((await get("s.bottomPanel")) === "keys", "the Keys open, ready to play");
  await page.waitForSelector(".piano-key");
  const pianoId = now.tracks[0].id;

  begin("name the song");
  await page.fill(".doc-name", "Smoke tune");
  await page.keyboard.press("Enter");
  expect((await get("s.history.present.name")) === "Smoke tune", "the song renamed in the top bar");

  begin("draw a clip and its notes");
  await page.mouse.dblclick(...(await lanePoint(1.5, 0)));
  await page.waitForSelector(".roll-grid");
  now = await song();
  expect(now.clips.length === 1 && now.clips[0].kind === "midi" && now.clips[0].start === 0 && now.clips[0].length === 16, "a four-bar clip at the start of the track");
  expect((await get("s.bottomPanel")) === "editor" && (await get("s.editingClipId")) === now.clips[0].id, "the clip open in the note editor");
  const firstClipId = now.clips[0].id;
  {
    // Four notes going down and along: a double-click each, in the part of the grid that's showing.
    const view = await page.locator(".roll-scroll").boundingBox();
    const grid = await page.locator(".roll-grid").boundingBox();
    for (let i = 0; i < 4; i++) await page.mouse.dblclick(grid.x + 20 + i * 90, view.y + 50 + i * 24);
    let notes = await get(`s.history.present.clips[0].notes`);
    expect(notes.length === 4, `four notes drawn (${notes.length})`);
    expect(notes.every((n, i) => i === 0 || (n.start > notes[i - 1].start && n.pitch < notes[i - 1].pitch)), "each note later and lower than the one before");
    expect(notes.every((n) => n.start >= 0 && n.start + n.length <= 16 && n.velocity > 0), "the notes inside the clip");
    // The Pencil adds one with a single click.
    await page.keyboard.press("p");
    expect((await get("s.tool")) === "pencil", "P picks the Pencil");
    await page.mouse.click(grid.x + 20 + 4 * 90, view.y + 50);
    notes = await get(`s.history.present.clips[0].notes`);
    expect(notes.length === 5, "the Pencil added a fifth note");
    await page.keyboard.press("v");
    expect((await get("s.tool")) === "select", "V goes back to Select");
    expect((await page.locator(".roll-grid .note").count()) === 5, "five notes showing in the editor");
    expect((await page.locator(".clip .clip-notes path").evaluate((el) => (el.getAttribute("d").match(/M/g) ?? []).length)) === 5, "and in miniature on the clip");
  }

  begin("play, and see the position advance");
  expect((await get("engine.position()")) === 0 && !(await get("s.playing")), "stopped at the start");
  const playheadWas = await page.locator(".tracks-view .playhead").evaluate((el) => el.style.transform);
  await page.click(".transport-button.play");
  await until("s.playing", "playing to start");
  await playedPast(1);
  expect((await page.locator(".tracks-view .playhead").evaluate((el) => el.style.transform)) !== playheadWas, "the playhead moving across the tracks");
  expect((await page.locator(".display-value.big").textContent()) !== "", "the position showing in the display");
  await until("engine.level('master') > 0", "the master meter to show some sound");
  await page.click(".transport-button.play");
  await until("!s.playing", "playing to stop");
  const restedAt = await get("engine.position()");
  expect(restedAt > 1 && restedAt === (await get("engine.position()")), "the playhead resting where it stopped");

  begin("loop a bar, and see it go round");
  await scrollHome();
  await dragMouse(await rulerPoint(0.2, true), await rulerPoint(3.6, true));
  let loop = await get("s.history.present.loop");
  expect(loop.on && loop.start === 0 && loop.end === 4, `the first bar looped by dragging across the strip (${JSON.stringify(loop)})`);
  expect((await page.locator(".loop-strip.on").count()) === 1, "the loop strip lit");
  await page.keyboard.press("Space");
  await until("s.playing", "Space to start playing");
  await playedPast(2);
  // Round the loop: the position, having passed beat 2, is back before it.
  await until("engine.position() < 1.5", "the playhead to go back to the start of the loop");
  expect((await get("s.playing")) && (await get("engine.position()")) < 4, "still playing, inside the loop");
  await playedPast(2);
  await page.keyboard.press("Space");
  await until("!s.playing", "Space to stop");
  // The lit loop can be changed without starting again: an end stretches it, its middle slides it along.
  await dragMouse(await rulerPoint(4, true), await rulerPoint(11.7, true));
  loop = await get("s.history.present.loop");
  expect(loop.start === 0 && loop.end === 12, `the loop's end dragged out to three bars (${JSON.stringify(loop)})`);
  await dragMouse(await rulerPoint(6, true), await rulerPoint(10.2, true));
  loop = await get("s.history.present.loop");
  expect(loop.start === 4 && loop.end === 16, `the loop slid along a bar by its middle (${JSON.stringify(loop)})`);
  await dragMouse(await rulerPoint(4, true), await rulerPoint(0.3, true));
  await dragMouse(await rulerPoint(16, true), await rulerPoint(4.2, true));
  loop = await get("s.history.present.loop");
  expect(loop.on && loop.start === 0 && loop.end === 4, `both ends dragged back to the first bar (${JSON.stringify(loop)})`);
  await page.click(".transport-button.loop");
  expect((await get("s.history.present.loop.on")) === false, "the Loop button turning the loop off");

  begin("add a drum beat from the Library");
  await toolbarButton("Library").click();
  await page.waitForSelector(".library-card");
  expect((await page.locator(".library-card").count()) >= 12, "a library of patterns");
  await page.fill(".library-search", "rock");
  await page.click(".library-card:has-text('Rock beat')");
  await page.waitForSelector(".library-preview .preview-note");
  await page.click(".modal button:has-text('Put in the song')");
  await until("s.history.present.tracks.length === 2", "the drum beat's own track");
  now = await song();
  const drumTrack = now.tracks[1];
  const drumClip = now.clips.find((c) => c.trackId === drumTrack.id);
  expect(drumTrack.instrument === "drums", "a drum kit track for the beat");
  expect(drumClip && drumClip.kind === "midi" && drumClip.notes.length >= 8 && drumClip.start === 0, "the beat as a clip of drum hits at the start");
  expect((await get("s.dialog")) === null, "the Library closed");
  expect((await page.locator(".toast.success:has-text('Rock beat')").count()) === 1, "a message saying what was put in");
  await closeToasts();
  expect((await page.locator(".toast").count()) === 0, "the message closed with its ✕");
  await page.locator(`[data-clip="${drumClip.id}"]`).dblclick();
  // A drum clip opens as a grid of steps (the step sequencer), its drums listed by name.
  await page.waitForSelector(".steps-grid");
  expect((await page.locator(".steps-name").count()) >= 8, "the drums listed by name in the step sequencer");
  {
    const notesOf = async () => (await song()).clips.find((c) => c.id === drumClip.id).notes;
    const before = await notesOf();
    expect((await page.locator(".step.on").count()) === new Set(before.map((n) => `${n.pitch}:${Math.floor(n.start * 4 + 1e-6)}`)).size, "a lit box for every step that has a drum hit");
    // The cowbell row is empty in a rock beat: click a box, and a cowbell plays on that step.
    const box = (pitch, i) => page.locator(`.step[data-step="${pitch}:${i}"]`);
    await box(56, 2).click();
    await until(`s.history.present.clips.find((c) => c.id === "${drumClip.id}").notes.some((n) => n.pitch === 56 && n.start === 0.5)`, "a click on a box adding a cowbell on that step");
    expect((await box(56, 2).getAttribute("class")).includes("on"), "the box lit");
    await box(56, 2).click({ modifiers: ["Shift"] });
    await until(`s.history.present.clips.find((c) => c.id === "${drumClip.id}").notes.find((n) => n.pitch === 56 && n.start === 0.5)?.velocity === 120`, "Shift-click making the step accented");
    await box(56, 2).click();
    await until(`!s.history.present.clips.find((c) => c.id === "${drumClip.id}").notes.some((n) => n.pitch === 56)`, "a second click taking it away");
    // Drag along the row: four boxes filled in one undo step.
    const steps = await get("s.history.past.length");
    const a = await box(56, 4).boundingBox();
    const b = await box(56, 7).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await page.mouse.up();
    await until(`s.history.present.clips.find((c) => c.id === "${drumClip.id}").notes.filter((n) => n.pitch === 56).length === 4`, "a drag along the row filling four boxes");
    expect((await get("s.history.past.length")) === steps + 1, "the drag one undo step");
    await page.keyboard.press("Control+z");
    await until(`!s.history.present.clips.find((c) => c.id === "${drumClip.id}").notes.some((n) => n.pitch === 56)`, "undo taking them away again");
    expect((await notesOf()).length === before.length, "the beat as it was");
    // The same clip as notes, and back.
    await page.click('.view-switch button:has-text("Notes")');
    await page.waitForSelector(".roll-key.drum");
    expect((await page.locator(".roll-key.drum").count()) >= 8, "the drums by name in the note editor too");
    await page.click('.view-switch button:has-text("Steps")');
    await page.waitForSelector(".steps-grid");
  }

  begin("a bass line from the Library gets a bass track of its own");
  // The piano is selected: a bass line mustn't go onto it (played by a piano, on top of the piano's clip).
  await page.locator(".track-header").nth(0).click();
  await toolbarButton("Library").click();
  await page.fill(".library-search", "root notes");
  await page.click(".library-card:has-text('Root notes')");
  await page.waitForSelector(".library-preview .preview-note");
  expect((await page.locator(".library-side:has-text('bass')").count()) === 1 && (await page.locator(".library-side:has-text('track of its own')").count()) === 1, "the Library saying it will get a bass track of its own");
  await page.click(".modal button:has-text('Put in the song')");
  await until("s.history.present.tracks.length === 3", "the bass line's own track");
  now = await song();
  const bassTrack = now.tracks.find((t) => t.instrument === "bass");
  expect(bassTrack && now.clips.filter((c) => c.trackId === bassTrack.id).length === 1, "the bass line on a bass guitar track");
  expect(now.clips.filter((c) => c.trackId === pianoId).length === 1, "the piano's own clip left alone, with nothing on top of it");
  expect((await page.locator(".clip.over").count()) === 0, "no clip lying over another");
  // The same pattern again, with its track selected, goes after the first rather than on top of it.
  await toolbarButton("Library").click();
  await page.fill(".library-search", "root notes");
  await page.click(".library-card:has-text('Root notes')");
  await page.click(".modal button:has-text('Put in the song')");
  await until(`s.history.present.clips.filter((c) => c.trackId === "${bassTrack.id}").length === 2`, "the second bass line");
  now = await song();
  const bassClips = now.clips.filter((c) => c.trackId === bassTrack.id).sort((a, b) => a.start - b.start);
  expect(bassClips[1].start >= bassClips[0].start + bassClips[0].length, `the second bass line after the first (${bassClips.map((c) => c.start)})`);
  expect((await page.locator(".clip.over").count()) === 0, "still no clip lying over another");
  // Messages sit above the bottom panel, never over it, and don't take clicks meant for what's under them.
  const toastBox = await page.locator(".toast").first().boundingBox();
  const panelBox = await page.locator(".bottom-panel").boundingBox();
  expect(toastBox && panelBox && toastBox.y + toastBox.height <= panelBox.y, "messages above the bottom panel, not over it");
  expect((await page.locator(".toast").first().evaluate((el) => getComputedStyle(el).pointerEvents)) === "none", "clicks going through a message");
  await closeToasts();
  // Take the bass lines away again (two steps back), so the rest goes on with the piano and the drums.
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await until("s.history.present.tracks.length === 2", "the bass track undone");

  begin("mixer: mute and solo");
  await toolbarButton("Mixer").click();
  await page.waitForSelector(".mixer-strip");
  expect((await page.locator(".mixer-strip").count()) === 3, "a strip for each track and the Master");
  await page.locator(".mixer-strip .ms-button.mute").nth(1).click();
  expect((await get("s.history.present.tracks[1].mute")) === true, "the drums muted");
  expect((await page.locator(`[data-clip="${drumClip.id}"].quiet`).count()) === 1, "a muted track's clip greyed");
  await page.locator(".mixer-strip .ms-button.mute").nth(1).click();
  await page.locator(".mixer-strip .ms-button.solo").nth(0).click();
  now = await song();
  expect(now.tracks[0].solo && !now.tracks[1].mute, "the piano soloed, the drums unmuted");
  expect((await page.locator(".track-header.silent").count()) === 1, "the other track shown as silent");
  await page.locator(".track-header .ms-button.solo").nth(0).click();
  expect((await get("s.history.present.tracks[0].solo")) === false, "the track header's S button taking the solo off");

  begin("automation: a volume line drawn, moved, a point taken away, cleared; the harmoniser");
  await page.locator(".track-header").nth(0).click();
  await page.locator('.panel-tab:has-text("Automation")').click();
  await page.waitForSelector(".auto-sheet svg");
  {
    const box = await page.locator(".auto-sheet svg").boundingBox();
    const stepsBefore = await get("s.history.past.length");
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.35);
    await until("s.history.present.tracks[0].automation?.volume?.length === 2", "a volume line: from the start, to the point clicked");
    expect((await get("s.history.past.length")) === stepsBefore + 1, "the click one undo step");
    expect((await page.locator(".lane-lines").count()) === 1, "the line drawn faintly over the track's lane");
    const before = await get("s.history.present.tracks[0].automation.volume[1]");
    const point = await page.locator(".auto-point").nth(1).boundingBox();
    await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
    await page.mouse.down();
    await page.mouse.move(point.x + 40, point.y + 30, { steps: 4 });
    await page.mouse.move(point.x + 60, point.y + 50, { steps: 4 });
    await page.mouse.up();
    const after = await get("s.history.present.tracks[0].automation.volume[1]");
    expect(after.beat > before.beat && after.value < before.value, `the point dragged later and lower (${JSON.stringify(before)} → ${JSON.stringify(after)})`);
    expect((await get("s.history.past.length")) === stepsBefore + 2, "the drag one undo step");
    const moved = await page.locator(".auto-point").nth(1).boundingBox();
    await page.mouse.dblclick(moved.x + moved.width / 2, moved.y + moved.height / 2);
    await until("s.history.present.tracks[0].automation?.volume?.length === 1", "a double-click taking the point away");
    await page.click('.auto button:has-text("Clear line")');
    await until("!s.history.present.tracks[0].automation", "Clear line taking the line off");
    expect((await page.locator(".lane-lines").count()) === 0, "no line over the lane");
  }
  await page.locator('.check-row:has-text("Harmoniser") input').click();
  await until('s.history.present.tracks[0].harmony?.style === "below"', "the harmoniser on (an octave below)");
  await page.selectOption('select[aria-label="Which voices the harmoniser adds"]', "fifth");
  await until('s.history.present.tracks[0].harmony?.style === "fifth"', "the harmoniser's voices changed to a fifth above");
  await page.locator('.check-row:has-text("Harmoniser") input').click();
  await until("!s.history.present.tracks[0].harmony", "the harmoniser off again");

  begin("sections on the ruler, the song's key and chords in the editor, finishing touches");
  await closeToasts();
  await scrollHome();
  await page.click(".section-add");
  await page.waitForSelector(".section-name-box");
  await page.keyboard.type("Opening");
  await page.keyboard.press("Enter");
  await until('s.history.present.sections?.length === 1 && s.history.present.sections[0].name === "Opening"', "a section named on the ruler");
  {
    const [x, y] = await rulerPoint(16.5);
    await page.mouse.click(x, y, { button: "right" });
    await page.click(".bed-menu button:has-text('Name a part of the song from bar 5')");
    await page.waitForSelector(".section-name-box");
    await page.keyboard.press("Enter");
    await until('s.history.present.sections?.length === 2 && s.history.present.sections[1].beat === 16 && s.history.present.sections[1].name === "Verse"', "a second section from bar 5, offered the name Verse");
    await page.click('.section-flag:has-text("Verse")');
    await until("s.cursor === 16", "a click on a section playing from its start");
    await page.locator('.section-flag:has-text("Opening")').click({ button: "right" });
    await page.click(".bed-menu button:has-text('Loop this section')");
    await until("s.history.present.loop.on && s.history.present.loop.start === 0 && s.history.present.loop.end === 16", "a section looped, up to the next one");
    await page.evaluate(() => window.juradawStore.getState().setLoop({ on: false }));
    await page.locator('.section-flag:has-text("Verse")').click({ button: "right" });
    await page.click(".bed-menu button:has-text('Delete the name')");
    await until("s.history.present.sections?.length === 1", "a section's name taken away");
  }
  {
    const clipId = await get(`s.history.present.clips.find((c) => c.trackId === "${pianoId}" && c.kind === "midi").id`);
    await page.evaluate((id) => window.juradawStore.getState().editClip(id), clipId);
    await page.waitForSelector('.roll-bar select[aria-label="The song\'s key"]');
    await page.selectOption('.roll-bar select[aria-label="The song\'s key"]', "9-minor");
    await until('s.history.present.key?.note === 9 && s.history.present.key?.scale === "minor"', "the song's key set to A minor");
    expect((await page.locator(".roll-off-key").count()) > 20, "the notes outside the key shaded in the editor");
    const before = (await song()).clips.find((c) => c.id === clipId).notes.length;
    const steps = await get("s.history.past.length");
    await page.click('.roll-bar button:has-text("Chords")');
    const grid = await page.locator(".roll-grid").boundingBox();
    const view = await page.locator(".roll-scroll").boundingBox();
    await page.mouse.dblclick(grid.x + 30, view.y + view.height * 0.5);
    await until(`s.history.present.clips.find((c) => c.id === "${clipId}").notes.length === ${before + 3}`, "a double-click adding a whole chord");
    const notes = (await song()).clips.find((c) => c.id === clipId).notes.slice(-3);
    const inKey = (p) => [0, 2, 3, 5, 7, 8, 10].includes((((p - 9) % 12) + 12) % 12);
    expect(notes.every((n) => n.start === notes[0].start && inKey(n.pitch)), `the chord's three notes together and in A minor (${notes.map((n) => n.pitch)})`);
    expect((await get("s.history.past.length")) === steps + 1, "the chord one undo step");
    await page.keyboard.press("Control+z");
    await until(`s.history.present.clips.find((c) => c.id === "${clipId}").notes.length === ${before}`, "undo taking the chord away");
    await page.click('.roll-bar button:has-text("Chords")');
  }
  await page.evaluate(() => {
    const s = window.juradawStore.getState();
    s.selectClips([]);
    s.selectTrack(null);
  });
  await page.locator('.side-panel input[aria-label="Song squeeze"]').fill("0.3");
  await until("s.history.present.finish?.squeeze === 0.3", "the song's squeeze turned up in the song's settings");
  await page.locator('.side-panel input[aria-label="Song squeeze"]').fill("0");
  await until("!s.history.present.finish", "and off again");
  expect((await page.locator('.side-panel select[aria-label="The song\'s key"]').inputValue()) === "9-minor", "the key shown in the song's settings");

  begin("record notes with the typing keyboard");
  await closeToasts();
  await scrollHome();
  await page.locator(".track-header").nth(0).click();
  expect((await get("s.selectedTrackId")) === pianoId, "the piano track selected");
  // Record from bar 5, after what's there, and without a count-in.
  await page.mouse.click(...(await rulerPoint(16.02)));
  expect((await get("s.cursor")) === 16, "a click on the ruler putting the play position at bar 5");
  await page.click(".settings-button");
  await page.click(".settings-menu button:has-text('No count-in')");
  expect((await get("s.countIn")) === 0, "no count-in");
  await page.keyboard.press("Escape");
  await toolbarButton("Keys").click();
  await page.locator(".typing-toggle input").check();
  // While letters play notes the toolbar says so (the letter shortcuts are off), and P doesn't pick the Pencil.
  await page.waitForSelector(".typing-pill");
  await page.keyboard.press("p");
  expect((await get("s.tool")) === "select", "P not picking the Pencil while the keyboard plays notes");
  const clipsBefore = (await song()).clips.length;
  await page.click('.transport [aria-label="Record"]');
  await until("s.recording && s.playing", "recording to start");
  // What to do is said in the Keys panel and beside the display — not in a message lying over the keys.
  expect((await page.locator(".recording-now").count()) === 1 && (await page.locator(".display.recording .display-label:has-text('Space stops')").count()) === 1, "the Keys panel and the display saying it's recording and how to stop");
  // With the "letters play notes" sign showing, the toolbar still fits.
  const [toolbarNeeds, toolbarHas] = await page.locator(".toolbar").evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(toolbarNeeds <= toolbarHas + 1, `the toolbar fitting at 1280 px with the "letters play notes" sign (needs ${toolbarNeeds} px, has ${toolbarHas})`);
  expect((await page.locator(".toast").count()) === 0, "no message over the keys while recording");
  for (const key of ["a", "d", "g"]) {
    // Each key held for a little of the song, with a gap before the next.
    const from = await get("engine.position()");
    await page.keyboard.down(key);
    await page.waitForSelector(".piano-key.down");
    await playedPast(from + 0.4);
    await page.keyboard.up(key);
    await page.waitForSelector(".piano-key.down", { state: "detached" });
    await playedPast(from + 0.6);
  }
  await page.keyboard.press("Space");
  await until("!s.recording && !s.playing", "Space to stop the recording");
  await until(`s.history.present.clips.length === ${clipsBefore + 1}`, "the take to become a clip");
  now = await song();
  const take = now.clips.find((c) => c.id !== firstClipId && c.id !== drumClip.id);
  expect(take && take.kind === "midi" && take.trackId === pianoId && take.start >= 16, "the take on the piano track, from bar 5");
  expect(take.notes.length === 3 && take.notes.map((n) => n.pitch).join() === "60,64,67", `the three notes played: C, E and G (${take.notes.map((n) => n.pitch).join()})`);
  expect(take.notes.every((n, i) => n.length > 0.1 && (i === 0 || n.start > take.notes[i - 1].start)), "each with its length, one after another");
  await page.locator(".typing-toggle input").uncheck();
  await closeToasts();
  await page.keyboard.press("Home");
  expect((await get("s.cursor")) === 0, "Home going back to the start");

  begin("export a WAV sound file");
  const songSeconds = await get("Math.max(...s.history.present.clips.map((c) => c.start + c.length)) * 60 / s.history.present.bpm");
  await topButton("Export").click();
  await page.waitForSelector(".modal:has-text('Export as')");
  const wavFile = await download(() => page.click(".modal button:has-text('Save sound file')"));
  expect(wavFile.name === "Smoke tune.wav", `a file named after the song (${wavFile.name})`);
  const wav = readWav(wavFile.bytes);
  expect(wav, "a real WAV file (RIFF … WAVE)");
  expect(wav.riffSize === wav.fileSize - 8 && wav.dataEnd === wav.fileSize && wav.dataSize > 0, "its sizes adding up");
  expect(wav.format === 1 && wav.channels === 2 && wav.bits === 16 && wav.rate >= 44100, `16-bit stereo (${wav.channels} channels, ${wav.bits} bits, ${wav.rate} Hz)`);
  // As long as the song plus its tail: 2.5 seconds for the sound to die away (longer only when a track has echo, and none here does).
  expect(Math.abs(wav.seconds - (songSeconds + 2.5)) < 0.1, `the WAV as long as the song (${songSeconds.toFixed(2)} s) plus a 2.5 s tail (${wav.seconds.toFixed(2)} s)`);
  if (process.env.SMOKE_DEBUG) console.log(wav, songSeconds);
  expect(wav.peak > 0.05 && wav.peak <= 1 && wav.rms > 0.003, `sound in it, not silence (peak ${wav.peak.toFixed(3)}, average ${wav.rms.toFixed(4)})`);
  await until("s.dialog === null", "the Export window to close");

  begin("an export can be stopped part-way");
  // A song made very long for a moment (so the mixdown can't finish first), then put back.
  const longClip = (await song()).clips[0].id;
  await page.evaluate((id) => window.juradawStore.getState().updateClip(id, { length: 1200 }), longClip);
  let stoppedDownload = false;
  const noteDownload = () => (stoppedDownload = true);
  page.on("download", noteDownload);
  await topButton("Export").click();
  await page.click(".modal button:has-text('Save sound file')");
  await page.waitForSelector(".export-progress");
  expect((await page.locator(".modal button:has-text('Stop')").count()) === 1, "a Stop button while the sound file is being made");
  await page.click(".modal button:has-text('Stop')");
  await page.waitForSelector(".export-progress", { state: "detached" });
  await page.waitForSelector(".toast:has-text('Stopped')");
  expect((await get("s.dialog")) === "export", "the Export window still open after stopping, ready to try again");
  await page.keyboard.press("Escape");
  await until("s.dialog === null", "Esc to close the Export window");
  await closeToasts();
  expect(!stoppedDownload, "no file saved by an export that was stopped");
  page.off("download", noteDownload);
  await page.keyboard.press("Control+z");
  await until(`s.history.present.clips.find((c) => c.id === "${longClip}").length < 100`, "the clip back to its length");

  begin("export a MIDI file");
  await topButton("Export").click();
  await page.click(".modal [role='radio']:has-text('MIDI file')");
  const midiFile = await download(() => page.click(".modal button:has-text('Save MIDI file')"));
  expect(midiFile.name === "Smoke tune.mid", `a .mid file (${midiFile.name})`);
  expect(midiFile.bytes.toString("ascii", 0, 4) === "MThd" && midiFile.bytes.readUInt32BE(4) === 6, "a real MIDI file (MThd)");
  const midiTracks = midiFile.bytes.readUInt16BE(10);
  expect(midiFile.bytes.readUInt16BE(8) === 1 && midiTracks >= 2, `a track in it for each instrument (${midiTracks})`);
  expect(midiFile.bytes.toString("latin1").split("MTrk").length - 1 === midiTracks, "every track present");

  begin("save a .juradaw file");
  const before = await song();
  const saved = await download(() => page.keyboard.press("Control+s"));
  expect(saved.name === "Smoke tune.juradaw", `saved as Smoke tune.juradaw (${saved.name})`);
  const savedText = saved.bytes.toString("utf8");
  expect(JSON.parse(savedText).app === "JuraDAW", "a JuraDAW file");
  await until("s.fileName === 'Smoke tune.juradaw' && s.savedSong === s.history.present", "the song to be marked as saved");

  begin("New, then open the file again");
  page.once("dialog", (d) => d.accept());
  await topButton("New").click();
  await page.waitForSelector(".welcome");
  now = await song();
  expect(now.tracks.length === 0 && now.clips.length === 0 && now.name !== "Smoke tune", "New emptying the song");
  await choose(() => topButton("Open").click(), { name: "Smoke tune.juradaw", mimeType: "application/json", buffer: Buffer.from(savedText) });
  await until("s.history.present.tracks.length === 2", "the song to open");
  const after = await song();

  // Open asks before throwing away changes that are in no file — and leaves the song alone when the answer is no.
  await page.evaluate(() => window.juradawStore.getState().setBpm(97));
  // (New didn't ask above — the song had just been saved — so its "yes" isn't left waiting for this question.)
  page.removeAllListeners("dialog");
  const question = page.waitForEvent("dialog");
  await choose(() => topButton("Open").click(), { name: "Smoke tune.juradaw", mimeType: "application/json", buffer: Buffer.from(savedText) });
  const dialog = await question;
  const asked = dialog.message();
  await dialog.dismiss();
  expect(/aren't saved/.test(asked), `Open asking about the unsaved changes first ("${asked}")`);
  expect((await get("s.history.present.bpm")) === 97 && (await get("s.history.past.length")) === 1, "the song left as it was when the answer is no");
  // The same for a file dropped on the window; this time the answer is yes.
  const again = page.waitForEvent("dialog");
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.items.add(new File([text], "Smoke tune.juradaw", { type: "application/json" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  }, savedText);
  await (await again).accept();
  await until("s.history.present.bpm !== 97 && s.history.past.length === 0", "the dropped song to open after a yes");
  await closeToasts();
  expect(sameData(after, before), "the opened song the same as the one saved");
  expect((await get("s.fileName")) === "Smoke tune.juradaw" && (await get("s.history.past.length")) === 0, "its file name kept, and a fresh undo history");

  begin("import a sound file as a clip");
  await choose(() => topButton("Import").click(), { name: "Beep.wav", mimeType: "audio/wav", buffer: testWav() });
  await until("s.history.present.clips.some((c) => c.kind === 'audio')", "the sound to come in as a clip");
  now = await song();
  const soundClip = now.clips.find((c) => c.kind === "audio");
  const soundTrack = now.tracks.find((t) => t.id === soundClip.trackId);
  const info = now.audio.find((a) => a.id === soundClip.audioId);
  expect(now.tracks.length === 3 && soundTrack.kind === "audio", "a sound track made for it");
  expect(info && info.name === "Beep" && Math.abs(info.seconds - 1) < 0.01 && Math.abs(soundClip.duration - 1) < 0.01, `a one-second sound called Beep (${info?.seconds} s)`);
  await page.waitForSelector(`[data-clip="${soundClip.id}"] .clip-wave path`);
  const waveLength = await page.locator(`[data-clip="${soundClip.id}"] .clip-wave path`).evaluate((el) => el.getAttribute("d").length);
  expect(waveLength > 100, "its waveform drawn on the clip");
  const peaks = await get(`Array.from(engine.peaks(${JSON.stringify(info.id)}, 8) ?? [])`);
  expect(peaks.length === 8 && peaks[0] > 0.4 && peaks[7] < peaks[0], `the engine holding the sound: loud at first, fading (${peaks.map((p) => p.toFixed(2)).join(" ")})`);
  // A saved file carries the sound inside it.
  const withSound = await download(() => topButton("Save").click());
  const soundInFile = JSON.parse(withSound.bytes.toString("utf8")).sounds?.[info.id];
  expect(typeof soundInFile === "string" && Buffer.from(soundInFile, "base64").toString("ascii", 0, 4) === "RIFF", "the sound inside the saved file, as a WAV");

  begin("rename a clip from its right-click menu");
  await closeToasts();
  await scrollHome();
  await page.locator(`[data-clip="${firstClipId}"]`).click({ button: "right", position: { x: 30, y: 30 } });
  await page.click(".bed-menu button:has-text('Rename')");
  await page.waitForSelector(".clip-name-box");
  await page.keyboard.type("Intro");
  await page.keyboard.press("Enter");
  await until(`s.history.present.clips.find((c) => c.id === ${JSON.stringify(firstClipId)}).name === "Intro"`, "the clip to be renamed");
  expect((await page.locator(".clip-name-box").count()) === 0 && (await page.locator(".clip-name:text-is('Intro')").count()) === 1, "the new name on the clip");

  begin("undo, redo and the History list");
  const stepsBefore = await get("s.history.past.length");
  const renamed = await song();
  await page.keyboard.press("Control+z");
  expect((await get(`s.history.present.clips.find((c) => c.id === ${JSON.stringify(firstClipId)}).name`)) !== "Intro", "undo taking the new name away");
  await page.keyboard.press("Control+y");
  expect((await get(`s.history.present.clips.find((c) => c.id === ${JSON.stringify(firstClipId)}).name`)) === "Intro", "redo putting it back");
  await toolbarButton("History").click();
  await page.waitForSelector(".history-list");
  expect((await page.locator(".history-list li").count()) === stepsBefore + 1, "every step listed in History");
  expect((await page.locator(".history-list li.current").count()) === 1, "with where we are now marked");
  // Two steps back from the top (the newest is first).
  await page.locator(".history-list li").nth(2).locator("button").click();
  expect((await get("s.history.future.length")) === 2 && (await get("s.history.past.length")) === stepsBefore - 2, "History going two steps back at once");
  await toolbarButton("History").click();
  await page.locator(".history-list li").nth(0).locator("button").click();
  expect((await get("s.history.future.length")) === 0 && JSON.stringify(await song()) === JSON.stringify(renamed), "and forward again to where we were");

  begin("drag a clip to the edge and the view scrolls along");
  {
    const view = await page.locator(".tracks-view").boundingBox();
    const clip = await page.locator(`[data-clip="${soundClip.id}"]`).boundingBox();
    const startWas = soundClip.start;
    await page.mouse.move(clip.x + clip.width / 2, clip.y + clip.height / 2);
    await page.mouse.down();
    await page.mouse.move(view.x + view.width - 60, clip.y + clip.height / 2, { steps: 6 });
    await page.mouse.move(view.x + view.width - 6, clip.y + clip.height / 2, { steps: 3 });
    // Held at the edge: the view moves by itself and the clip goes with it.
    await page.waitForFunction(() => document.querySelector(".tracks-view").scrollLeft > 150, null, { polling: "raf" });
    await page.mouse.up();
    const moved = await get(`s.history.present.clips.find((c) => c.id === ${JSON.stringify(soundClip.id)}).start`);
    const perBeat = (await lanePoint(1, 0))[0] - (await lanePoint(0, 0))[0];
    expect(moved > startWas + 150 / perBeat, `the clip carried along past what was showing (bar ${startWas / 4 + 1} → ${(moved / 4 + 1).toFixed(1)})`);
    expect((await get("s.history.past.length")) === stepsBefore + 1, "the whole drag one undo step");
    await page.keyboard.press("Control+z");
    expect((await get(`s.history.present.clips.find((c) => c.id === ${JSON.stringify(soundClip.id)}).start`)) === startWas, "and undone in one");
    await page.keyboard.press("f");
    await scrollHome();
  }

  begin("the song is kept in the browser");
  await page.waitForFunction(
    (clips) => {
      const kept = JSON.parse(localStorage.getItem("juradaw.song.v1") ?? "null");
      return !!kept && kept.clips.length === clips && kept.clips.some((c) => c.name === "Intro");
    },
    now.clips.length,
  );
  await page.reload();
  await page.waitForFunction(() => !!window.juradawStore && !!window.juradawEngine);
  await page.waitForSelector(".track-header");
  const kept = await song();
  expect(kept.tracks.length === 3 && kept.clips.length === now.clips.length && kept.name === "Smoke tune", "the song back after a reload");
  expect((await get("s.countIn")) === 0, "the count-in choice kept on this computer too");

  begin("a MIDI keyboard is connected only when asked");
  // All this while — clicks, keys, recording, a reload — the browser hasn't been asked for MIDI once.
  await page.locator(".track-header").nth(0).click();
  expect((await page.evaluate(() => window.midiAsked)) === 0, "the browser never asked for MIDI before the owner asks");
  await toolbarButton("Keys").click();
  await page.click(".keys-bar .midi-button");
  await page.waitForSelector(".toast.success:has-text('Test Keys')");
  expect((await page.evaluate(() => window.midiAsked)) === 1, "one request, from the Connect button");
  expect((await page.locator(".midi-button.active:has-text('Test Keys')").count()) === 1, "the button naming the keyboard");
  await closeToasts();
  // Next visit: connected again by itself on the first click, without the button.
  await page.reload();
  await page.waitForFunction(() => !!window.juradawStore && !!window.juradawEngine);
  await page.waitForSelector(".track-header");
  expect((await page.evaluate(() => window.midiAsked)) === 0, "nothing asked before the first click of the next visit");
  await page.locator(".track-header").nth(0).click();
  await page.waitForFunction(() => window.midiAsked === 1);
  await page.waitForSelector(".toast.success:has-text('Test Keys')");
  await closeToasts();
  // The sound comes back from the browser's own storage, and is drawn again.
  await page.waitForSelector(`[data-clip="${soundClip.id}"] .clip-wave path`);

  begin("Recent: New keeps the song, and Recent opens it again with its recording");
  {
    const was = await song();
    const asked = [];
    const answer = (d) => {
      asked.push(d.message());
      void d.accept();
    };
    page.on("dialog", answer);
    await topButton("New").click();
    await until("s.history.present.tracks.length === 0", "a new, empty song");
    page.off("dialog", answer);
    expect(asked.every((m) => /kept in Recent/.test(m)), `New saying the song is kept in Recent (${asked.join(" | ")})`);
    await page.click(".recent-button");
    await page.waitForSelector(`.recent-list li:has-text("${was.name}") .recent-thumb rect`);
    await page.click(`.recent-open:has-text("${was.name}")`);
    await until(`s.history.present.name === ${JSON.stringify(was.name)} && s.history.present.tracks.length === ${was.tracks.length} && s.history.present.clips.length === ${was.clips.length}`, "the song back from Recent");
    expect((await get("s.history.past.length")) === 0, "opened afresh, with nothing to undo into the other song");
    await page.waitForSelector(`[data-clip="${soundClip.id}"] .clip-wave path`);
    await closeToasts();
  }

  begin("dark mode, Help and What's new");
  await closeToasts();
  await page.click(".settings-button");
  await page.click(".settings-menu button:has-text('Dark')");
  expect((await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "dark mode");
  await page.keyboard.press("Escape");
  expect((await get("s.dialog")) === null, "Esc closing Settings");
  await page.keyboard.type("?");
  await page.waitForSelector(".modal:has-text('Help and shortcuts')");
  expect((await page.locator(".help-table tr").count()) >= 12, "the mouse and keyboard tables in Help");
  // The Help screen's surprise (as JuraCAD's): the Windows / Mac buttons clicked 10 times within 5 seconds.
  {
    const win = page.getByRole("radio", { name: "Windows" });
    for (let i = 0; i < 10; i++) await win.click();
    await page.locator(".easter-egg img").waitFor({ timeout: 5_000 });
    // The picture itself arrives (it isn't just an empty frame).
    await page.waitForFunction(() => {
      const img = document.querySelector(".easter-egg img");
      return img && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 10_000 });
    await page.locator(".easter-egg").click();
    await page.locator(".easter-egg").waitFor({ state: "detached", timeout: 5_000 });
  }
  await page.keyboard.press("Escape");
  await page.click(".phase-badge");
  await page.waitForSelector(".modal:has-text(\"What's new in JuraDAW\")");
  expect((await page.locator(".whats-new-list li").count()) >= 5, "this version's changes read from CHANGELOG.md");
  await page.keyboard.press("Escape");
  expect((await page.locator(".modal").count()) === 0, "the windows closed");

  begin("the toolbar fits on a small laptop (1024 px)");
  await page.setViewportSize({ width: 1024, height: 700 });
  for (const bar of [".toolbar", ".topbar"]) {
    await page.waitForFunction((b) => document.querySelector(b).scrollWidth <= document.querySelector(b).clientWidth + 1, bar).catch(() => {});
    const [inside, room] = await page.locator(bar).evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(inside <= room + 1, `the ${bar === ".toolbar" ? "toolbar" : "top bar"} fitting at 1024 px (needs ${inside} px, has ${room})`);
  }
  for (const label of ["Editor", "Mixer", "Keys", "Fit"]) expect(await toolbarButton(label).isVisible(), `the ${label} button on screen at 1024 px`);
  await page.setViewportSize({ width: 1280, height: 800 });

  begin("the toolbar fits at 1280 px");
  for (const bar of [".toolbar", ".topbar"]) {
    const [inside, room] = await page.locator(bar).evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(inside <= room + 1, `the ${bar === ".toolbar" ? "toolbar" : "top bar"} fitting at 1280 px (needs ${inside} px, has ${room})`);
  }
  expect(
    await page.evaluate(() => {
      const bar = document.querySelector(".toolbar").getBoundingClientRect();
      return [...document.querySelectorAll(".toolbar button")].every((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.left >= bar.left - 1 && r.right <= bar.right + 1;
      });
    }),
    "every toolbar button inside the toolbar",
  );

  begin("shape the sound: a track's effects, a clip's fade and sweep, and the new instruments");
  await page.setViewportSize({ width: 1440, height: 900 });
  await closeToasts();
  {
    const shaped = await page.evaluate(() => {
      const s = window.juradawStore.getState();
      const id = s.addTrack("instrument", "choir");
      const clip = window.juradawStore.getState().addMidiClip(id, 0, 8);
      window.juradawStore.getState().addNote(clip, { pitch: 60, start: 0, length: 8, velocity: 100 });
      window.juradawStore.getState().selectClips([clip]);
      return { id, clip };
    });
    await page.waitForSelector(".track-header:has-text('Choir')");
    // The side panel has the track's own effects and the clip's shape; a slider changes the song.
    for (const label of ["Drive", "Crush", "Bass", "Treble", "Filter", "Filter ring", "Wobble", "Pump", "Chop", "Clip volume", "Fade in", "Fade out"]) {
      expect((await page.locator(`.side-panel input[type=range][aria-label="${label}"]`).count()) === 1, `a "${label}" slider in the side panel`);
    }
    const trackNow = (field) => get(`s.history.present.tracks.find((t) => t.id === "${shaped.id}").${field}`);
    const clipNow = (field) => get(`s.history.present.clips.find((c) => c.id === "${shaped.clip}").${field}`);
    await page.locator('.side-panel input[aria-label="Drive"]').fill("0.4");
    expect((await trackNow("drive")) === 0.4, "the Drive slider setting the track's drive");
    await page.locator('.side-panel input[aria-label="Pump"]').fill("0.8");
    await page.click(".side-panel button:has-text('Cut bottom')");
    await page.locator('.side-panel input[aria-label="Filter"]').fill("0.3");
    expect((await trackNow("filter.kind")) === "high" && (await trackNow("filter.cutoff")) === 0.3, "the filter cutting the bottom at the place chosen");
    await page.click(".side-panel button:has-text('Cut top')");
    expect((await trackNow("filter")) === undefined, "the filter being off again after choosing the other kind");
    await page.locator('.side-panel input[aria-label="Fade in"]').fill("4");
    expect((await clipNow("fadeIn")) === 4, "the Fade in slider giving the clip a four-beat swell");
    await page.getByLabel("Sweep the filter over this clip").check();
    expect((await clipNow("sweep.from")) === 0.3, "the sweep box giving the clip a filter sweep");
    expect((await page.locator('.side-panel input[aria-label="From"]').count()) === 1, "the sweep's From and To sliders");
    // It plays: the pump, the sweep and the fade are booked in time with the song, and Stop lets go of them.
    await page.evaluate((id) => {
      const s = window.juradawStore.getState();
      for (const t of s.history.present.tracks) if (t.id !== id && !t.mute) s.updateTrack(t.id, { mute: true });
      s.setLoop({ on: false });
      s.setCursor(0);
    }, shaped.id);
    await page.keyboard.press("Space");
    await until("s.playing", "Space starting the song (not unticking the box just ticked)");
    expect((await clipNow("sweep.from")) === 0.3, "the sweep still being there");
    await playedPast(1.5);
    await until(`engine.level("${shaped.id}") > 0.05`, "the choir being heard through its effects");
    await page.keyboard.press("Space");
    await until("!s.playing", "playing to stop");
    // The arpeggiator: on, then a pattern picked.
    await page.getByLabel("Arpeggiator — chords one note at a time").check();
    expect((await trackNow("arp.style")) === "up", "the arpeggiator switched on, going up");
    await page.click('.side-panel [aria-label="Arpeggiator pattern"] button:has-text("Down")');
    await page.selectOption('.side-panel select[aria-label="Arpeggiator speed"]', String(1 / 3));
    expect((await trackNow("arp.style")) === "down" && Math.abs((await trackNow("arp.rate")) - 1 / 3) < 1e-9, "the arpeggiator going down in triplets");
    await page.locator('.side-panel input[aria-label="Bass"]').fill("0.5");
    expect((await trackNow("lows")) === 0.5, "the Bass slider lifting the low end");
    // Every new instrument and kit is offered, and picking one changes the track.
    for (const name of ["Soft piano", "Choir", "Sub bass", "Gritty bass", "808 bass", "Big saw", "Wobbly synth", "Noise sweep", "808 kit", "Electronic kit"]) {
      expect((await page.locator(`.side-panel button:has-text("${name}")`).count()) >= 1, `"${name}" among the instruments`);
    }
    await page.locator('.side-panel button:has-text("Wobbly synth")').first().click();
    expect((await trackNow("instrument")) === "wobble", "picking the wobbly synth");
    // v0.6: the acoustic instruments, Squeeze, Sway, Swirl, Swing, the band filter and the filter wobble.
    for (const name of ["Acoustic guitar", "Harp", "Kalimba", "Marimba", "Flute", "Brass"]) {
      expect((await page.locator(`.side-panel button:has-text("${name}")`).count()) >= 1, `"${name}" among the instruments`);
    }
    await page.locator('.side-panel button:has-text("Marimba")').first().click();
    expect((await trackNow("instrument")) === "marimba", "picking the marimba");
    for (const [label, field] of [["Squeeze", "squeeze"], ["Sway", "sway"], ["Swirl", "swirl"], ["Swing", "swing"]]) {
      await page.locator(`.side-panel input[aria-label="${label}"]`).fill("0.5");
      expect((await trackNow(field)) === 0.5, `the ${label} slider setting the track's ${field}`);
    }
    await page.click(".side-panel button:has-text('Keep middle')");
    expect((await trackNow("filter.kind")) === "band", "the filter keeping only the middle");
    await page.getByLabel("Filter wobble — opens and closes in time").check();
    await page.selectOption('.side-panel select[aria-label="How often the filter wobbles"]', "0.25");
    expect((await trackNow("filterWobble.rate")) === 0.25 && (await trackNow("filterWobble.depth")) === 0.6, "the filter wobbling four times a beat");
    await page.keyboard.press("Space");
    await until("s.playing", "playing with every new effect on");
    await playedPast(1.5);
    await until(`engine.level("${shaped.id}") > 0.02`, "the marimba heard through its new effects");
    await page.keyboard.press("Space");
    await until("!s.playing", "playing to stop");
    // v0.9: the newest instruments, and Your own sound shaped from a starting point.
    for (const name of ["Vibraphone", "Music box", "Steel drum", "Clavinet", "Accordion", "Cello", "Glass pad", "Chiptune", "Your own sound"]) {
      expect((await page.locator(`.side-panel button:has-text("${name}")`).count()) >= 1, `"${name}" among the instruments`);
    }
    await page.locator('.side-panel .instrument-card:has-text("Your own sound")').click();
    expect((await trackNow("instrument")) === "custom", "picking Your own sound");
    await page.waitForSelector(".side-panel .custom-sound");
    await page.click('.custom-sound .preset-row button:has-text("Warm pad")');
    expect((await trackNow("sound.fadeIn")) === 0.55 && (await trackNow("sound.wave")) === "bright", "the Warm pad starting point");
    await page.click('.custom-sound [aria-label="The wave the sound is made from"] button:has-text("Smooth")');
    await page.locator('.custom-sound input[aria-label="Brightness"]').fill("0.8");
    expect((await trackNow("sound.wave")) === "smooth" && (await trackNow("sound.brightness")) === 0.8, "the wave and brightness changed");
    await page.keyboard.press("Space");
    await until("s.playing", "playing Your own sound");
    await playedPast(1.5);
    await until(`engine.level("${shaped.id}") > 0.02`, "Your own sound heard");
    await page.keyboard.press("Space");
    await until("!s.playing", "playing to stop");
    // Take it all back, so the rest of the test finds the song as it was.
    const steps = (await get("s.history.past.length")) - 0;
    void steps;
    await page.evaluate((id) => window.juradawStore.getState().removeTrack(id), shaped.id);
    await page.evaluate(() => {
      const s = window.juradawStore.getState();
      for (const t of s.history.present.tracks) if (t.mute) s.updateTrack(t.id, { mute: false });
    });
    await closeToasts();
  }

  begin("Connect to Claude with no extension running says what to do");
  await page.setViewportSize({ width: 1440, height: 900 });
  await closeToasts();
  await page.getByRole("button", { name: "Connect to Claude" }).click();
  await page.waitForSelector(".modal:has-text(\"Claude isn't connected\")", { timeout: 60_000 });
  expect((await page.locator(".modal .help-steps li").count()) >= 3, "advice on what to do when Claude isn't there");
  await page.keyboard.press("Escape");

  // With the extension built (CI builds it before this test): start it the way Claude does, connect, and let
  // "Claude" (this test, talking MCP to it) write some music, which must appear in the open song.
  const extensionServer = "build/claude-extension/server/index.mjs";
  let liveReport = "the Claude extension wasn't built, so the live link wasn't tried";
  if (existsSync(extensionServer)) {
    begin("Live with Claude: Claude writes into the open song");
    const songs = mkdtempSync(join(tmpdir(), "juradaw-smoke-live-"));
    // JURADAW_LIVE_DEV=1: this test serves JuraDAW from 127.0.0.1, which the shipped extension otherwise turns away.
    const ext = spawn(process.execPath, [extensionServer, songs], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, JURADAW_LIVE_DEV: "1" } });
    let extLog = "";
    ext.stderr.on("data", (d) => (extLog += d));
    const replies = new Map();
    let pending = "";
    ext.stdout.on("data", (d) => {
      pending += d;
      let nl;
      while ((nl = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, nl).trim();
        pending = pending.slice(nl + 1);
        if (line) {
          const msg = JSON.parse(line);
          replies.get(msg.id)?.(msg);
        }
      }
    });
    let nextId = 1;
    const mcp = (method, params) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => reject(new Error(`The extension didn't answer ${method}\n${extLog.slice(-1500)}`)), 60_000);
        replies.set(id, (m) => {
          clearTimeout(timer);
          resolve(m);
        });
        ext.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    const tool = async (name, args = {}) => {
      const r = await mcp("tools/call", { name, arguments: args });
      const text = (r.result?.content ?? []).map((c) => c.text).join("\n");
      return { text, failed: !!(r.error || r.result?.isError) };
    };
    const done = async (name, args) => {
      const r = await tool(name, args);
      if (r.failed) throw new Error(`${name} failed: ${r.text}`);
      return r.text;
    };
    try {
      await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
      ext.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      for (let i = 0; i < 100 && !/Live link ready/.test(extLog); i++) await new Promise((r) => setTimeout(r, 100));
      expect(/Live link ready/.test(extLog), `the extension's live link starting:\n${extLog.slice(-1500)}`);
      await page.getByRole("button", { name: "Connect to Claude" }).click();
      await page.locator(".live-badge").waitFor({ timeout: 30_000 });
      const tracksBefore = await get("s.history.present.tracks.length");
      const stepsBefore = await get("s.history.past.length");
      const songName = await get("s.history.present.name");
      expect((await done("describe_song")).includes(`Song "${songName}"`), "Claude seeing the song that's open in the tab");
      const said = await done("add_track", { instrument: "bells", name: "From Claude" });
      expect(/Live: this now shows in the user's open JuraDAW tab/.test(said), `Claude being told its change is on show:\n${said}`);
      await until(`s.history.present.tracks.length === ${tracksBefore + 1}`, "Claude's track appearing in the song");
      await page.waitForSelector(".track-header:has-text('From Claude')");
      await done("add_clip", { track: "From Claude", notes: [{ pitch: "C5", start: 0 }, { pitch: "E5", start: 1 }, { pitch: "G5", start: 2, length: 2 }] });
      await until("s.history.present.clips.some((c) => c.name === 'From Claude' && c.notes.length === 3)", "Claude's clip and its three notes");
      expect((await get("s.history.past.length")) === stepsBefore + 2, "each of Claude's changes being one undo step");
      await page.waitForSelector(".toast:has-text('Claude:')");
      await closeToasts();
      // The user undoes Claude's clip; Claude sees the song as it now is, and its next change goes on top.
      await page.keyboard.press("Control+z");
      await until("!s.history.present.clips.some((c) => c.name === 'From Claude')", "undo taking Claude's clip away");
      for (let i = 0; i < 50 && !/"From Claude"[^\n]*\n {3}\(no clips\)/.test(await done("describe_song")); i++) await new Promise((r) => setTimeout(r, 100));
      expect(/"From Claude"[^\n]*\n {3}\(no clips\)/.test(await done("describe_song")), "Claude seeing that its clip was undone");
      // With the Library open Claude waits: its change is turned back and nothing is lost.
      await toolbarButton("Library").click();
      await page.waitForSelector(".modal");
      const refused = await tool("set_song", { tempo: 97 });
      expect(refused.failed && /Library open/.test(refused.text), `Claude's change being turned back while the Library is open:\n${refused.text}`);
      await page.keyboard.press("Escape");
      await until("s.dialog === null", "the Library closing");
      await done("set_song", { tempo: 97 });
      await until("s.history.present.bpm === 97", "Claude's tempo");
      await closeToasts();
      // Disconnect from the badge.
      await page.locator(".live-badge").click();
      await page.click(".modal button:has-text('Disconnect')");
      await page.getByRole("button", { name: "Connect to Claude" }).waitFor();
      for (let i = 0; i < 50 && !/Live: not connected/.test(await done("live_status")); i++) await new Promise((r) => setTimeout(r, 100));
      expect(/Live: not connected/.test(await done("live_status")), "the extension knowing the tab has gone");
      liveReport = "Claude (the real extension over the local link) added a track and notes to the open song, saw an undo, waited while the Library was open, and was disconnected";
    } finally {
      ext.kill();
      rmSync(songs, { recursive: true, force: true });
    }
  }

  if (process.env.SMOKE_SCREENSHOT === "1") await page.screenshot({ path: join(dist, "smoke.png") });
  if (errors.length) throw new Error(`Console errors:\n${errors.join("\n")}`);
  annotate("notice", "Smoke test", "Made a song with notes, a drum beat and a recording; played and looped it; exported WAV and MIDI; saved, opened, imported, undid: all fine. Live with Claude: " + liveReport + ".");
} catch (e) {
  annotate("error", `Smoke test failed at "${step}"`, `${e instanceof Error ? e.message : e}${errors.length ? `\nConsole errors:\n${errors.join("\n")}` : ""}`);
  await page.screenshot({ path: join(dist, "smoke-failure.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
