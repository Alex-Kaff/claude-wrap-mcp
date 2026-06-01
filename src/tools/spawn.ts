import { isAbsolute } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ISessionManager } from "../session-manager.js";
import { guard, textResult } from "./result.js";

export function registerSpawn(server: McpServer, sessions: ISessionManager): void {
  server.registerTool(
    "claude_spawn",
    {
      title: "Spawn a Claude Code session",
      description:
        "Start a new headless Claude Code session in a working directory. Returns a sessionId used by the other claude_* tools. The `claude` CLI must be on PATH.",
      inputSchema: {
        cwd: z
          .string()
          .min(1)
          .refine(isAbsolute, "cwd must be an absolute path")
          .describe("Absolute working directory for the session"),
        label: z.string().optional().describe("Human-friendly label (also usable as a selector)"),
        args: z.array(z.string()).optional().describe("Extra CLI args passed to `claude`"),
        model: z.string().optional().describe("Model id, forwarded as `--model <id>`"),
      },
      outputSchema: {
        sessionId: z.string(),
        label: z.string(),
        cwd: z.string(),
      },
      annotations: {
        title: "Spawn a Claude Code session",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guard("claude_spawn", async (args: { cwd: string; label?: string; args?: string[]; model?: string }) => {
      const spawnArgs: { cwd: string; label?: string; args?: string[]; model?: string } = { cwd: args.cwd };
      if (args.label !== undefined) spawnArgs.label = args.label;
      if (args.args !== undefined) spawnArgs.args = args.args;
      if (args.model !== undefined) spawnArgs.model = args.model;

      const session = await sessions.spawn(spawnArgs);
      const structured = { sessionId: session.sessionId, label: session.label, cwd: session.cwd };
      return textResult(
        `Spawned session ${session.sessionId} (label "${session.label}") in ${session.cwd}.`,
        structured,
      );
    }),
  );
}
