import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ISessionManager } from "../session-manager.js";
import { sessionIdField } from "../schemas.js";
import { guard, textResult } from "./result.js";

export function registerPermission(server: McpServer, sessions: ISessionManager): void {
  server.registerTool(
    "claude_resolve_permission",
    {
      title: "Approve or deny a permission prompt",
      description:
        "Resolve a pending permission prompt in a session. Use claude_status or claude_ask first to see whether a prompt is pending and what it asks.",
      inputSchema: {
        sessionId: sessionIdField,
        decision: z.enum(["approve", "deny"]).describe("Whether to approve or deny the pending prompt"),
      },
      annotations: {
        title: "Approve or deny a permission prompt",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guard("claude_resolve_permission", async (args: { sessionId: string; decision: "approve" | "deny" }) => {
      const session = sessions.resolve(args.sessionId);
      await session.resolvePermission(args.decision);
      return textResult(`${args.decision === "approve" ? "Approved" : "Denied"} the prompt in session ${session.sessionId}.`);
    }),
  );
}
