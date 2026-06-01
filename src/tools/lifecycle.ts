import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ISessionManager } from "../session-manager.js";
import { sessionIdField } from "../schemas.js";
import { guard, textResult } from "./result.js";

export function registerLifecycle(server: McpServer, sessions: ISessionManager): void {
  server.registerTool(
    "claude_stop",
    {
      title: "Stop a session",
      description:
        "Shut down an in-process session this server spawned. External instances are not stopped (close their window manually).",
      inputSchema: {
        sessionId: sessionIdField,
        force: z.boolean().default(false).describe("Kill immediately instead of graceful shutdown"),
      },
      annotations: {
        title: "Stop a session",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guard("claude_stop", async (args: { sessionId: string; force: boolean }) => {
      const session = sessions.resolve(args.sessionId);
      await session.stop(args.force);
      return textResult(`Stopped session ${session.sessionId}.`);
    }),
  );
}
