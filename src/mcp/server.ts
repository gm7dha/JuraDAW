/**
 * JuraDAW for Claude: an MCP server (run by the Claude desktop app from the
 * JuraDAW extension) that lets Claude write music — tracks, clips and notes —
 * and save it as .juradaw songs and MIDI files.
 *
 * Started as: node server/index.mjs <folder for songs>
 * Talks MCP over stdin/stdout, so nothing else may be printed to stdout:
 * all logging goes to stderr.
 *
 * It also listens on 127.0.0.1 (this computer only) for "Live with Claude":
 * when the user clicks Connect to Claude in JuraDAW, the tools work on the
 * song open in that tab (src/mcp/live.ts, src/live/protocol.ts).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { SongFolder } from "./files";
import { LiveBridge } from "./live";
import { startLiveServer } from "./websocket";
import { LIVE_PORTS } from "../live/protocol";
import { Session } from "./session";
import { callTool, FORMAT_GUIDE, TOOLS } from "./tools";

/** Set when the extension is bundled (scripts/build-claude-extension.mjs). */
declare const __JURADAW_VERSION__: string | undefined;
const VERSION = typeof __JURADAW_VERSION__ === "string" ? __JURADAW_VERSION__ : "0.0.0";

// stdout carries the conversation with Claude: anything else printed there would break it.
const log = (...args: unknown[]) => process.stderr.write(`[juradaw] ${args.map(String).join(" ")}\n`);
console.log = log;
console.info = log;
console.warn = log;

/** The folder chosen when the extension was installed (or Documents/JuraDAW). */
function folderPath(): string {
  const given = process.argv[2] || process.env.JURADAW_FOLDER;
  // An unfilled setting arrives as the literal placeholder: fall back to the default.
  if (given && !given.includes("${")) return given;
  return join(homedir(), "Documents", "JuraDAW");
}

async function main() {
  const folder = new SongFolder(folderPath());
  log(`JuraDAW ${VERSION}: songs folder ${folder.root}`);
  let session: Session | null = null;

  // Live with Claude: wait (on this computer only) for a JuraDAW tab to connect.
  const live = new LiveBridge(VERSION, log);
  if (process.env.JURADAW_LIVE !== "off") {
    const ports = process.env.JURADAW_LIVE_PORT ? [Number(process.env.JURADAW_LIVE_PORT)] : [...LIVE_PORTS];
    // JURADAW_LIVE_DEV=1 also lets in JuraDAW served on this computer (its own tests and development only).
    const allowLocalOrigins = process.env.JURADAW_LIVE_DEV === "1";
    startLiveServer({ ports, accept: (conn) => live.connect(conn), log, allowLocalOrigins })
      .then((started) => {
        if (started) {
          live.port = started.port;
          started.server.unref();
          log(`Live link ready on 127.0.0.1:${started.port}.`);
        } else {
          live.startProblem = `ports ${ports.join(", ")} on this computer are all in use (JuraDAW may already be running for many other Claude chats). Close some other Claude chats or windows, or restart Claude.`;
          log(`Live link: ${live.startProblem}`);
        }
      })
      .catch((e) => {
        live.startProblem = `the link couldn't start (${e instanceof Error ? e.message : String(e)}).`;
        log(`Live link: ${live.startProblem}`);
      });
  } else live.startProblem = "it's switched off for this copy of the extension.";

  const server = new Server(
    { name: "juradaw", version: VERSION },
    {
      capabilities: { tools: {} },
      instructions: `JuraDAW writes music for the user, a part at a time — drums, bass, chords and tunes on tracks, as notes they can see and change; the result is a .juradaw song they open (or watch being made, live) at https://gm7dha.github.io/JuraDAW/ and play there.\n${FORMAT_GUIDE}`,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: { title: t.title, readOnlyHint: !!t.readOnly, destructiveHint: !!t.destructive, openWorldHint: false },
    })),
  }));

  // A call Claude cancels (notifications/cancelled) aborts `extra.signal`: the tool's change is taken back,
  // and the SDK sends no reply for it.
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (!session) {
      session = new Session(folder);
      session.live = live;
    }
    const result = await callTool(session, request.params.name, request.params.arguments ?? {}, extra.signal);
    return { content: result.content, ...(result.isError ? { isError: true } : {}) };
  });

  // When Claude stops the extension (closes our input), stop too, so the live link's port is freed.
  const stop = () => {
    live.close();
    setTimeout(() => process.exit(0), 50);
  };
  server.onclose = stop;
  process.stdin.on("end", stop);
  process.stdin.on("close", stop);
  await server.connect(new StdioServerTransport());
  log("ready");
}

main().catch((e) => {
  log("Failed to start:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
