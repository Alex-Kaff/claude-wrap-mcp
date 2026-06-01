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
        "Start a new Claude Code session in a working directory. Returns a sessionId used by the other claude_* tools. The `claude` CLI must be on PATH. " +
        "By default the session opens headful — in its own visible terminal window — and is registered in the shared claude-wrap instance registry so other tools on this machine can discover and drive it. " +
        "Headful sessions are driven over the control pipe; parsed state (status/permission) is best-effort. " +
        "Pass headful:false for a headless in-process session: it is still registered, but parsed state, busy/idle and permission handling are more reliable.",
      inputSchema: {
        cwd: z
          .string()
          .min(1)
          .refine(isAbsolute, "cwd must be an absolute path")
          .describe("Absolute working directory for the session"),
        label: z.string().optional().describe("Human-friendly label (also usable as a selector)"),
        args: z.array(z.string()).optional().describe("Extra CLI args passed to `claude`"),
        model: z.string().optional().describe("Model id, forwarded as `--model <id>`"),
        headful: z
          .boolean()
          .optional()
          .describe(
            "Open in a visible terminal window (default true). Set false for a headless in-process session with more reliable parsed-state/permission handling. Either way the session is registered for discovery.",
          ),
      },
      outputSchema: {
        sessionId: z.string(),
        label: z.string(),
        cwd: z.string(),
        origin: z.enum(["in-process", "windowed"]),
      },
      annotations: {
        title: "Spawn a Claude Code session",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guard(
      "claude_spawn",
      async (args: { cwd: string; label?: string; args?: string[]; model?: string; headful?: boolean }) => {
        const spawnArgs: {
          cwd: string;
          label?: string;
          args?: string[];
          model?: string;
          headful?: boolean;
        } = { cwd: args.cwd };
        if (args.label !== undefined) spawnArgs.label = args.label;
        if (args.args !== undefined) spawnArgs.args = args.args;
        if (args.model !== undefined) spawnArgs.model = args.model;
        if (args.headful !== undefined) spawnArgs.headful = args.headful;

        const session = await sessions.spawn(spawnArgs);
        const origin = session.origin === "windowed" ? "windowed" : "in-process";
        const structured = {
          sessionId: session.sessionId,
          label: session.label,
          cwd: session.cwd,
          origin,
        };
        const where = origin === "windowed" ? "in a visible window" : "headless";
        return textResult(
          `Spawned ${where} session ${session.sessionId} (label "${session.label}") in ${session.cwd}.`,
          structured,
        );
      },
    ),
  );
}
