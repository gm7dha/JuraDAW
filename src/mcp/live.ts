/**
 * "Live with Claude", the extension's side: keeps the song open in the
 * user's JuraDAW tab (sent by the tab over the local link, see
 * src/live/protocol.ts), runs Claude's tools on it, and sends each change
 * back for the tab to apply as one undo step.
 *
 * Nothing here touches files: the tab only ever sends a song (checked like
 * a .juradaw file) and replies; files are still only written by save_song
 * and export_midi, inside the chosen folder.
 */
import { readSongFile, songFileText } from "../model/document";
import { changeLabel } from "../model/historyLabel";
import type { Song } from "../model/types";
import { isNewer, parseAppMessage, type AppMessage, type ExtensionMessage } from "../live/protocol";
import type { LiveLink, LiveStatus, Session } from "./session";
import type { ToolResult } from "./toolKit";

/** What the bridge needs from a connection (a WebSocketConnection, or a stand-in in tests). */
export interface LiveConnection {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  onMessage: (text: string) => void;
  onClose: (code: number, reason: string) => void;
}

type Reply = Extract<AppMessage, { type: "applied" | "refused" }> | { type: "timeout" } | { type: "disconnected" };

interface Pending {
  full: Song;
  base: number;
  resolve: ((r: Reply) => void) | null;
}

/** How long to wait for the tab to apply a change. */
const REPLY_TIMEOUT_MS = 30_000;
/** How long a late reply to a change is still listened for, after giving up waiting. */
const LATE_REPLY_MS = 5 * 60_000;
/** A tab must say hello this soon after connecting, or it's let go (so it can't hold the one place). */
const HELLO_TIMEOUT_MS = 10_000;

/**
 * A short description of what a tool changed, for the undo step in the app
 * ("Claude: added a track"). Pure.
 */
export function describeChange(tool: string, before: Song, after: Song, replaced: boolean): string {
  const say = (t: string) => `Claude: ${t.length > 110 ? `${t.slice(0, 107)}…` : t}`;
  if (replaced) return say(tool === "open_song" ? `opened "${after.name}"` : `started a new song, "${after.name}"`);
  if (tool === "undo") return say("undid its last change");
  const label = changeLabel(before, after);
  return say(label ? label[0].toLowerCase() + label.slice(1) : "changed the song");
}

export class LiveBridge implements LiveLink {
  private conn: LiveConnection | null = null;
  /** Has the connected tab said hello (so it's the one in use)? */
  private ready = false;
  private app = "";
  /** The song open in the tab (without its recorded sound, which stays in the tab), and its version. */
  doc: Song | null = null;
  version = 0;
  /** Counts the tabs that have connected (said hello): versions start again at 1 with each. */
  private link = 0;
  /** Which tab and version the session last took the song from ("link:version"), or null. */
  private adopted: string | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private queue: Promise<unknown> = Promise.resolve();
  /** The port listened on, or why the link couldn't start. */
  port: number | null = null;
  startProblem: string | null = null;

  constructor(
    readonly extensionVersion: string,
    private readonly log: (msg: string) => void = () => {},
    private readonly replyTimeout = REPLY_TIMEOUT_MS,
    private readonly helloTimeout = HELLO_TIMEOUT_MS,
  ) {}

  /** The open song as the session should have it now. */
  private get current(): string {
    return `${this.link}:${this.version}`;
  }

  get connected(): boolean {
    return !!this.conn && this.ready;
  }

  private send(conn: LiveConnection, msg: ExtensionMessage): void {
    conn.send(JSON.stringify(msg));
  }

  /** A JuraDAW tab has opened the link. Only one tab at a time: a second is turned away, with the reason. */
  connect(conn: LiveConnection): void {
    if (this.conn && !this.ready) {
      // The tab holding the place never said hello: let the new one have it.
      this.log("Live link: a connection that never said hello was replaced by a new one.");
      const old = this.conn;
      this.disconnected(old);
      old.close(1008, "no hello");
    }
    if (this.conn) {
      this.send(conn, {
        type: "busy",
        message: "Another JuraDAW tab is already connected to Claude. Disconnect that one first (or close it), then click Connect to Claude here.",
      });
      conn.close(1008, "another tab is connected");
      return;
    }
    this.conn = conn;
    this.ready = false;
    conn.onMessage = (text) => this.receive(conn, text);
    conn.onClose = () => this.disconnected(conn);
    const timer = setTimeout(() => {
      if (conn === this.conn && !this.ready) this.refuse(conn, "JuraDAW didn't say hello in time. Click Connect to Claude again.");
    }, this.helloTimeout);
    (timer as { unref?: () => void }).unref?.();
  }

  private refuse(conn: LiveConnection, message: string): void {
    this.log(`Live link: ${message}`);
    this.send(conn, { type: "error", message });
    conn.close(1008, "bad message");
  }

  private readDesign(file: string): Song | null {
    const r = readSongFile(file, "The song from JuraDAW");
    return r.ok ? r.song : null;
  }

  private receive(conn: LiveConnection, text: string): void {
    if (conn !== this.conn) return;
    const msg = parseAppMessage(text);
    if ("error" in msg) return this.refuse(conn, `JuraDAW sent ${msg.error}. Reload the JuraDAW page and connect again.`);
    if (!this.ready && msg.type !== "hello") return this.refuse(conn, "JuraDAW didn't say hello first. Reload the JuraDAW page and connect again.");
    switch (msg.type) {
      case "hello": {
        if (this.ready) return this.refuse(conn, "JuraDAW said hello twice.");
        const doc = this.readDesign(msg.file);
        if (!doc) return this.refuse(conn, "The song open in JuraDAW couldn't be read by the extension. Save it to a file and reload the page, or update the extension (Help › Use JuraDAW with Claude).");
        this.ready = true;
        this.link++;
        this.adopted = null;
        this.app = msg.app;
        this.setDesign(doc, msg.version);
        this.send(conn, { type: "welcome", protocol: 1, extension: this.extensionVersion });
        this.log(`Live link: connected to JuraDAW ${msg.app} ("${doc.name}").`);
        return;
      }
      case "doc": {
        if (!isNewer(this.version, msg.version)) return;
        const doc = this.readDesign(msg.file);
        if (!doc) return this.refuse(conn, "A change from JuraDAW couldn't be read. Reload the JuraDAW page and connect again.");
        this.setDesign(doc, msg.version);
        return;
      }
      case "applied":
      case "refused": {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.type === "applied") {
          if (msg.version !== p.base + 1 || !isNewer(this.version, msg.version)) {
            // Shouldn't happen; if it does, start again cleanly rather than guess (the tool says so).
            p.resolve?.({ type: "disconnected" });
            return this.refuse(conn, "JuraDAW and the extension lost track of the song's versions. Click Connect to Claude again.");
          }
          this.doc = p.full;
          this.version = msg.version;
        }
        // (No one waiting: a late reply after giving up; the session takes the song afresh next time.)
        p.resolve?.(msg);
        return;
      }
    }
  }

  private setDesign(doc: Song, version: number): void {
    this.doc = doc;
    this.version = version;
  }

  private disconnected(conn: LiveConnection): void {
    if (conn !== this.conn) return;
    this.conn = null;
    this.ready = false;
    // Whichever tab connects next, the session takes its song afresh.
    this.adopted = null;
    for (const p of this.pending.values()) p.resolve?.({ type: "disconnected" });
    this.pending.clear();
    this.log("Live link: JuraDAW disconnected.");
  }

  /** Close the link (the extension is stopping). */
  close(): void {
    this.conn?.close(1001, "Claude's JuraDAW extension stopped");
  }

  status(): LiveStatus {
    if (this.connected && this.doc) {
      const tracks = this.doc.tracks.length;
      return {
        connected: true,
        text: `Live: connected to the user's open JuraDAW tab (JuraDAW ${this.app}). Song "${this.doc.name}" (${tracks} track${tracks === 1 ? "" : "s"}). Every tool works on it, and each change you make appears there straight away as one step in its undo list — the user can press Play to hear it. The user can keep editing and undoing there too; if they change something at the same moment, your change is refused (nothing lost) and you just look again and retry. save_song still saves a .juradaw file (without any recorded sound: for that the user uses Save in JuraDAW).`,
      };
    }
    const where = this.port ? `on this computer (port ${this.port})` : null;
    return {
      connected: false,
      text: this.startProblem
        ? `Live: not available — ${this.startProblem} The tools work on Claude's own copy of the song; save_song saves it as a .juradaw file to open in JuraDAW.`
        : `Live: not connected. The tools work on Claude's own copy of the song (save_song saves it as a .juradaw file). To work live in the user's open JuraDAW instead, ask them to open https://gm7dha.github.io/JuraDAW/ (Chrome, Edge, Firefox or Safari) and click "Connect to Claude" in the top bar (the extension is ready ${where ?? "for it"}). If the user says JuraDAW already shows a green "Live with Claude" badge, this chat started after the tab connected: the tab links new chats by itself within a few seconds, so wait a moment and call live_status again; if it still isn't connected, ask them to click the badge, Disconnect, then Connect to Claude again. In Safari, Connect to Claude opens a small "JuraDAW ↔ Claude" window that must stay open (Safari may ask to allow the pop-up); if the user closed it, ask them to click Connect to Claude again. If live doesn't work for them, use save_song and Open.`,
    };
  }

  /** Run one tool: on the open JuraDAW song when connected, one at a time, sending any change back. */
  call(s: Session, tool: string, run: () => Promise<ToolResult>, signal?: AbortSignal): Promise<ToolResult> {
    const next = this.queue.then(() => this.callNow(s, tool, run, signal));
    this.queue = next.catch(() => {});
    return next;
  }

  private async callNow(s: Session, tool: string, run: () => Promise<ToolResult>, signal?: AbortSignal): Promise<ToolResult> {
    if (!this.connected || !this.doc) return run();
    if (this.adopted !== this.current) {
      s.adopt(this.doc);
      this.adopted = this.current;
    }
    // The version this change is made from (more may arrive from the tab while the tool runs).
    const base = this.version;
    const snap = s.snapshot();
    const result = await run();
    const replaced = s.generation !== snap.generation;
    if (result.isError || (s.song === snap.song && !replaced)) return result;
    // Cancelled by Claude before the change went to the tab: it's simply not made.
    if (signal?.aborted) {
      s.restore(snap);
      return this.notApplied(
        s.wroteFile
          ? "Cancelled: the call was stopped before its change was sent to JuraDAW, so the song wasn't changed — but the file it had already saved in the JuraDAW folder stays."
          : "Cancelled: the call was stopped before its change was sent to JuraDAW, so nothing was changed.",
      );
    }
    const conn = this.conn;
    if (!conn || !this.ready || !this.doc) {
      s.restore(snap);
      return this.notApplied("The JuraDAW tab disconnected before this change could be sent, so it wasn't made. Nothing was changed. Ask the user to click Connect to Claude again (or work on your own copy and save_song).");
    }
    const id = this.nextId++;
    let full: Song;
    let label: string;
    let reply: Reply;
    try {
      full = s.song;
      label = describeChange(tool, snap.song, s.song, replaced);
      const message = { type: "change", id, base, file: songFileText(full), label, replace: replaced } as const;
      reply = await new Promise<Reply>((resolve) => {
        const p: Pending = { full, base, resolve };
        this.pending.set(id, p);
        const timer = setTimeout(() => {
          // Keep listening for a while: if it's applied later, the bridge still learns the new version.
          p.resolve = null;
          resolve({ type: "timeout" });
          const forget = setTimeout(() => this.pending.get(id) === p && this.pending.delete(id), LATE_REPLY_MS);
          (forget as { unref?: () => void }).unref?.();
        }, this.replyTimeout);
        timer.unref?.();
        p.resolve = (r) => {
          clearTimeout(timer);
          p.resolve = null;
          resolve(r);
        };
        // Once sent, a cancellation from Claude can't take the change back: the tab's reply still decides it, so the session stays in step.
        this.send(conn, message);
      });
    } catch (e) {
      this.pending.delete(id);
      s.restore(snap);
      this.adopted = null;
      return this.notApplied(`This change couldn't be sent to JuraDAW (${e instanceof Error ? e.message : String(e)}). Nothing was changed.`);
    }
    if (reply.type === "applied") {
      this.adopted = this.current;
      return { ...result, content: [...result.content, { type: "text", text: `Live: this now shows in the user's open JuraDAW tab, as one step in its undo list ("${label}").` }] };
    }
    s.restore(snap);
    // Take the tab's song afresh next time.
    this.adopted = null;
    if (reply.type === "refused") {
      return this.notApplied(
        reply.reason === "changed"
          ? "The user changed the song in JuraDAW at the same moment, so this change was NOT applied (nothing was lost or changed). Look at the song again (describe_song) and make the change again."
          : reply.reason === "busy"
            ? `JuraDAW didn't take this change: ${reply.message} Nothing was changed. Ask the user to finish what they're doing, then try again.`
            : `JuraDAW couldn't use this change (${reply.message}). Nothing was changed.`,
      );
    }
    if (reply.type === "disconnected") {
      return this.notApplied("The JuraDAW tab disconnected before it confirmed this change, so it may not have arrived. Nothing was changed here. Ask the user to click Connect to Claude again, then check with describe_song.");
    }
    return this.notApplied("The JuraDAW tab didn't confirm this change in time so it may still appear there. Don't repeat it yet: run describe_song (it shows the song as the tab has it) and only redo the change if it's missing.");
  }

  private notApplied(why: string): ToolResult {
    return { content: [{ type: "text", text: why }], isError: true };
  }
}
