import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ISessionManager } from "../session-manager.js";
import { sessionIdField, sessionStateShape, sessionSummarySchema } from "../schemas.js";
import { guard, textResult } from "./result.js";

export function registerInspect(server: McpServer, sessions: ISessionManager): void {
  server.registerTool(
    "claude_status",
    {
      title: "Get parsed session state",
      description:
        "Return the parsed state of a session: busy flag, mode (normal/auto/accept-edits/plan), token count, " +
        "reasoning effort, any pending permission prompt (with its title, question, body and options — this also " +
        "covers the startup 'trust this folder' dialog), todo list, visible tool calls, and the remote-control URL " +
        "if active.",
      inputSchema: { sessionId: sessionIdField },
      outputSchema: sessionStateShape,
      annotations: { title: "Get parsed session state", readOnlyHint: true, openWorldHint: false },
    },
    guard("claude_status", async (args: { sessionId: string }) => {
      const session = sessions.resolve(args.sessionId);
      const state = await session.status();
      const summary = `Session ${session.sessionId}: ${state.busy ? "busy" : "idle"}${
        state.mode ? ` (${state.mode})` : ""
      }${state.permissionPrompt ? " — permission pending" : ""}.`;
      return textResult(summary, state as unknown as Record<string, unknown>);
    }),
  );

  server.registerTool(
    "claude_snapshot",
    {
      title: "Read the rendered screen",
      description: "Return the rendered transcript lines for a session (the tail, cleaned of trailing blanks).",
      inputSchema: {
        sessionId: sessionIdField,
        viewport: z.boolean().default(false).describe("Only the visible viewport instead of full scrollback"),
        clean: z.boolean().default(true).describe("Trim trailing blank lines"),
      },
      outputSchema: { lines: z.array(z.string()) },
      annotations: { title: "Read the rendered screen", readOnlyHint: true, openWorldHint: false },
    },
    guard("claude_snapshot", async (args: { sessionId: string; viewport: boolean; clean: boolean }) => {
      const session = sessions.resolve(args.sessionId);
      const lines = await session.snapshot({ viewport: args.viewport, clean: args.clean });
      return textResult(lines.join("\n"), { lines });
    }),
  );

  server.registerTool(
    "claude_list",
    {
      title: "List sessions",
      description:
        "List all sessions: in-process ones this server spawned and external instances discovered in the registry.",
      inputSchema: {},
      outputSchema: { sessions: z.array(sessionSummarySchema) },
      annotations: { title: "List sessions", readOnlyHint: true, openWorldHint: false },
    },
    guard("claude_list", async () => {
      const list = sessions.list();
      const text =
        list.length === 0
          ? "No sessions."
          : list
              .map((s) => `${s.sessionId} [${s.origin}] "${s.label}" ${s.busy ? "busy" : "idle"} — ${s.cwd}`)
              .join("\n");
      return textResult(text, { sessions: list });
    }),
  );
}
