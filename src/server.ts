/**
 * Server factory. Kept transport-agnostic and dependency-injected so tests can
 * drive it over an in-memory transport with a fake SessionManager.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ISessionManager } from "./session-manager.js";
import { registerAllTools } from "./tools/index.js";

export const SERVER_NAME = "claude-wrap";
// Keep in sync with package.json version.
export const SERVER_VERSION = "0.1.1";

export interface CreateServerDeps {
  sessions: ISessionManager;
}

export function createServer(deps: CreateServerDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Spawn and drive Claude Code sessions. Start with claude_spawn (pass headful:false for the most " +
        "reliable parsed state), then claude_ask. claude_ask and claude_status return parsed state including " +
        "a permissionPrompt when Claude is waiting for approval (also the startup 'trust this folder' dialog) — " +
        "resolve it with claude_resolve_permission. For long tasks use claude_send then poll claude_status. " +
        "To change Claude's mode (normal ↔ auto ↔ accept-edits ↔ plan) send the 'shift-tab' key. " +
        "claude_list shows all sessions.",
    },
  );
  registerAllTools(server, deps.sessions);
  return server;
}
