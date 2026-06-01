import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ISessionManager } from "../session-manager.js";
import { sessionIdField, sessionStateSchema } from "../schemas.js";
import { errorResult, guard, textResult } from "./result.js";

const DEFAULT_ASK_TIMEOUT_MS = 120_000;

export function registerAsk(server: McpServer, sessions: ISessionManager): void {
  server.registerTool(
    "claude_ask",
    {
      title: "Send a prompt and wait for the reply",
      description:
        "Send a prompt to a session and wait until Claude goes idle. Returns the rendered transcript tail plus parsed state. If the timeout elapses while Claude is still working, returns status \"busy\" (not an error) — poll with claude_status or read claude_snapshot. The result may include a pending permissionPrompt; resolve it with claude_resolve_permission.",
      inputSchema: {
        sessionId: sessionIdField,
        prompt: z.string().min(1).describe("The prompt text to send"),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(`Max wait for idle (default ${DEFAULT_ASK_TIMEOUT_MS}ms)`),
      },
      outputSchema: {
        status: z.enum(["idle", "busy"]),
        lines: z.array(z.string()),
        state: sessionStateSchema.nullable(),
      },
      annotations: {
        title: "Send a prompt and wait for the reply",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guard("claude_ask", async (args: { sessionId: string; prompt: string; timeoutMs?: number }) => {
      const session = sessions.resolve(args.sessionId);
      const result = await session.ask(args.prompt, args.timeoutMs ?? DEFAULT_ASK_TIMEOUT_MS);
      const structured = { status: result.status, lines: result.lines, state: result.state };
      const header =
        result.status === "busy"
          ? `Session ${session.sessionId} is still busy (timeout reached).`
          : `Session ${session.sessionId} is idle.` +
            (result.state?.permissionPrompt ? " A permission prompt is pending." : "");
      return textResult(`${header}\n\n${result.lines.join("\n")}`, structured);
    }),
  );

  server.registerTool(
    "claude_send",
    {
      title: "Send raw input without waiting",
      description:
        "Send raw input to a session and return immediately (do not wait for idle). Provide exactly one of: text (raw, no newline), line (text + Enter), or key (a named key such as enter, esc, up, down, tab, ctrl-c). Use this for long-running tasks, then poll with claude_status.",
      inputSchema: {
        sessionId: sessionIdField,
        text: z.string().optional().describe("Raw text, sent verbatim (no newline)"),
        line: z.string().optional().describe("Text followed by Enter"),
        key: z.string().optional().describe("Named key, e.g. enter, esc, tab, up, down, ctrl-c"),
      },
      annotations: {
        title: "Send raw input without waiting",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guard("claude_send", async (args: { sessionId: string; text?: string; line?: string; key?: string }) => {
      const provided = [args.text, args.line, args.key].filter((v) => v !== undefined);
      if (provided.length !== 1) {
        return errorResult("Provide exactly one of: text, line, key.");
      }
      const session = sessions.resolve(args.sessionId);
      const input: { text?: string; line?: string; key?: string } = {};
      if (args.text !== undefined) input.text = args.text;
      if (args.line !== undefined) input.line = args.line;
      if (args.key !== undefined) input.key = args.key;
      await session.send(input);
      return textResult(`Sent input to session ${session.sessionId}.`);
    }),
  );
}
