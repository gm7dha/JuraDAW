/**
 * "Live with Claude": the messages JuraDAW (in the browser) and the JuraDAW
 * extension for Claude (on the same computer) send each other over a local
 * WebSocket, and the rules both sides follow. Pure: used by the app
 * (src/live/client.ts) and by the extension (src/mcp/live.ts).
 *
 * How it goes:
 * - The user clicks Connect to Claude. The app tries every one of LIVE_PORTS on
 *   127.0.0.1 (one extension per Claude chat) and sends each "hello" with its
 *   song (a .juradaw file's text, without its recorded sound) and a version
 *   number (1 to start). Each link counts its own versions. While connected,
 *   the app looks again every few seconds for chats started since.
 * - Each change the user makes (including undo/redo) is sent as "doc" with the
 *   next version.
 * - When Claude changes the song, the extension sends "change", based on the
 *   latest version it has. The app applies it as one undo step if it's still at
 *   that version ("applied", version + 1), or refuses it ("refused") if the
 *   user changed something in the meantime or has a dialog open. Nothing is
 *   ever merged silently: a refused change is reported to Claude, which looks
 *   again and retries.
 */

/**
 * The ports the extension listens on (the first free one). Claude starts the
 * extension once for each chat, so several may be running: the app links all of them.
 */
export const LIVE_PORTS = [47635, 47636, 47637, 47638, 47639, 47640, 47641, 47642, 47643, 47644] as const;
/** The address path and WebSocket sub-protocol both sides use (anything else is refused). */
export const LIVE_PATH = "/juradaw-live";
export const LIVE_SUBPROTOCOL = "juradaw-live.1";
/** Biggest message either side accepts (a song with a great many notes can be large). */
export const MAX_MESSAGE_BYTES = 50 * 1024 * 1024;
/** The JuraDAW website. */
export const SITE_ORIGIN = "https://gm7dha.github.io";

/**
 * May a web page from this origin connect? Only the JuraDAW site. Browsers
 * always send the page's origin and pages can't fake it, so this keeps every
 * other website out — including pages served on this computer (a local dev
 * server, or a page from some other program). Those are only let in when
 * `allowLocal` is set, which the extension does only when JURADAW_LIVE_DEV=1
 * (for JuraDAW's own tests and development).
 *
 * Note: the origin is the whole GitHub Pages site, so any other site the
 * account publishes under https://gm7dha.github.io/… shares it.
 */
export function originAllowed(origin: string | undefined | null, allowLocal = false): boolean {
  if (!origin) return false;
  if (origin === SITE_ORIGIN) return true;
  return allowLocal && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/.test(origin);
}

// ---------------------------------------------------------------------------
// Safari: the link window ("relay")
//
// Safari treats ws://127.0.0.1 from an https page as mixed content and blocks
// it (WebKit bug 171934, still open). A page that is itself http://127.0.0.1
// may open it, though. So in Safari, Connect to Claude opens a small window
// served by the extension (RELAY_PATH on one of LIVE_PORTS) and the JuraDAW
// tab talks to it with postMessage; the window opens the real WebSockets to
// every port and passes messages both ways, unchanged. The window only obeys
// the window that opened it, and only if that is the JuraDAW site.

/** The link window's page and its script, served by the extension on 127.0.0.1. */
export const RELAY_PATH = "/juradaw-relay";
export const RELAY_SCRIPT_PATH = "/juradaw-relay.js";
/** Tag on every message between the JuraDAW tab and the link window. */
export const RELAY_TAG = "juradaw-relay.1";
/**
 * The start of the link window's name. Each tab adds its own id (kept across
 * reloads of that tab), so opening it again from the same tab reuses and
 * reloads it, but never another tab's window.
 */
export const RELAY_WINDOW = "juradaw-claude-link";
/** The most WebSockets the link window keeps open at once. */
export const RELAY_MAX_SOCKETS = 40;

/** The address of the link window served on `port`. */
export function relayUrl(port: number): string {
  return `http://127.0.0.1:${port}${RELAY_PATH}`;
}

/** The origin of the link window served on `port`. */
export function relayOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/**
 * Is this the origin of the extension's own link window (http://127.0.0.1 on
 * one of LIVE_PORTS, exactly)? Only a page served on that address and port
 * has it — on those ports, that's JuraDAW's link window. Websites can't take
 * it on (DNS tricks give their own name as the origin, and the Host check
 * turns those away).
 */
export function relayOriginAllowed(origin: string | undefined | null, ports: readonly number[] = LIVE_PORTS): boolean {
  if (!origin) return false;
  const m = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(origin);
  return !!m && ports.includes(Number(m[1]));
}

/** Messages from the JuraDAW tab to the link window. */
export type RelayRequest =
  | { juradaw: typeof RELAY_TAG; kind: "ping"; session: string }
  | { juradaw: typeof RELAY_TAG; kind: "open"; session: string; id: number; port: number }
  | { juradaw: typeof RELAY_TAG; kind: "send"; session: string; id: number; data: string }
  | { juradaw: typeof RELAY_TAG; kind: "close"; session: string; id: number }
  | { juradaw: typeof RELAY_TAG; kind: "bye"; session: string };

/** Messages from the link window to the JuraDAW tab. */
export type RelayEvent =
  | { juradaw: typeof RELAY_TAG; kind: "pong"; session: string; load: string }
  | { juradaw: typeof RELAY_TAG; kind: "opened"; session: string; id: number }
  | { juradaw: typeof RELAY_TAG; kind: "message"; session: string; id: number; data: string }
  | { juradaw: typeof RELAY_TAG; kind: "error"; session: string; id: number }
  | { juradaw: typeof RELAY_TAG; kind: "closed"; session: string; id: number; code: number; reason: string };

/** Check a message from the link window (the tab's side). Null = not one of ours, or damaged. */
export function parseRelayEvent(data: unknown, session: string): RelayEvent | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.juradaw !== RELAY_TAG || d.session !== session) return null;
  const base = { juradaw: RELAY_TAG, session } as const;
  switch (d.kind) {
    case "pong":
      return isText(d.load, 100) && d.load ? { ...base, kind: "pong", load: d.load } : null;
    case "opened":
    case "error":
      return isInt(d.id) ? { ...base, kind: d.kind, id: d.id } : null;
    case "message":
      return isInt(d.id) && isText(d.data) ? { ...base, kind: "message", id: d.id, data: d.data } : null;
    case "closed":
      return isInt(d.id) && isInt(d.code) && isText(d.reason, 200) ? { ...base, kind: "closed", id: d.id, code: d.code, reason: d.reason } : null;
    default:
      return null;
  }
}

/**
 * Is the Host header one this server answers to? Only its own loopback
 * address and port: a page on another site can't get here through a DNS name
 * pointed at 127.0.0.1 ("DNS rebinding").
 */
export function hostAllowed(host: string | undefined | null, port: number): boolean {
  if (!host) return false;
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}

// ---------------------------------------------------------------------------
// Messages

/** Why the app didn't take one of Claude's changes. */
export type RefusedReason = "changed" | "busy" | "invalid";

/** From the app (browser) to the extension. */
export type AppMessage =
  | { type: "hello"; protocol: 1; app: string; version: number; file: string }
  | { type: "doc"; version: number; file: string }
  | { type: "applied"; id: number; version: number }
  | { type: "refused"; id: number; version: number; reason: RefusedReason; message: string };

/** From the extension to the app. */
export type ExtensionMessage =
  | { type: "welcome"; protocol: 1; extension: string }
  | { type: "busy"; message: string }
  | { type: "change"; id: number; base: number; file: string; label: string; replace: boolean }
  | { type: "error"; message: string };

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isText = (v: unknown, max = MAX_MESSAGE_BYTES): v is string => typeof v === "string" && v.length <= max;
const SHORT = 2000;

function parseObject(text: string): Record<string, unknown> | string {
  if (typeof text !== "string") return "not text";
  if (text.length > MAX_MESSAGE_BYTES) return "too big";
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return "not JSON";
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return "not an object";
  return data as Record<string, unknown>;
}

/** Check a message from the app. Returns the message, or why it's not acceptable. */
export function parseAppMessage(text: string): AppMessage | { error: string } {
  const d = parseObject(text);
  if (typeof d === "string") return { error: d };
  switch (d.type) {
    case "hello":
      if (d.protocol !== 1) return { error: "a different version of the live link" };
      if (!isText(d.app, 100) || !isInt(d.version) || !isText(d.file)) return { error: "a damaged hello" };
      return { type: "hello", protocol: 1, app: d.app, version: d.version, file: d.file };
    case "doc":
      if (!isInt(d.version) || !isText(d.file)) return { error: "a damaged song" };
      return { type: "doc", version: d.version, file: d.file };
    case "applied":
      if (!isInt(d.id) || !isInt(d.version)) return { error: "a damaged reply" };
      return { type: "applied", id: d.id, version: d.version };
    case "refused":
      if (!isInt(d.id) || !isInt(d.version) || !["changed", "busy", "invalid"].includes(d.reason as string) || !isText(d.message, SHORT)) return { error: "a damaged reply" };
      return { type: "refused", id: d.id, version: d.version, reason: d.reason as RefusedReason, message: d.message };
    default:
      return { error: "an unknown message" };
  }
}

/** Check a message from the extension. */
export function parseExtensionMessage(text: string): ExtensionMessage | { error: string } {
  const d = parseObject(text);
  if (typeof d === "string") return { error: d };
  switch (d.type) {
    case "welcome":
      if (d.protocol !== 1 || !isText(d.extension, 100)) return { error: "a different version of the live link" };
      return { type: "welcome", protocol: 1, extension: d.extension };
    case "busy":
    case "error":
      if (!isText(d.message, SHORT)) return { error: "a damaged message" };
      return { type: d.type, message: d.message };
    case "change":
      if (!isInt(d.id) || !isInt(d.base) || !isText(d.file) || !isText(d.label, 300) || typeof d.replace !== "boolean") return { error: "a damaged change" };
      return { type: "change", id: d.id, base: d.base, file: d.file, label: d.label, replace: d.replace };
    default:
      return { error: "an unknown message" };
  }
}

// ---------------------------------------------------------------------------
// Versions

/**
 * The app's decision on a change from Claude: apply it (and move to the next
 * version) only if it was made from exactly the song on show, and the user
 * isn't half-way through editing something.
 */
export function decideChange(current: number, base: number, busy: string | null):
  | { apply: true; version: number }
  | { apply: false; reason: RefusedReason; message: string } {
  if (busy) return { apply: false, reason: "busy", message: busy };
  if (base !== current) {
    return {
      apply: false,
      reason: "changed",
      message: "The song was changed in JuraDAW at the same moment, so Claude's change wasn't applied (nothing was lost).",
    };
  }
  return { apply: true, version: current + 1 };
}

/**
 * The extension's view of the open song: is a message about a version
 * newer than the one it has? (Messages arrive in order on one connection, but
 * a stale one is never allowed to go back in time.)
 */
export function isNewer(have: number, incoming: number): boolean {
  return incoming > have;
}
