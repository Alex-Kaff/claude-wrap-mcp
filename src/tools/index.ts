import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ISessionManager } from "../session-manager.js";
import { registerSpawn } from "./spawn.js";
import { registerAsk } from "./ask.js";
import { registerInspect } from "./inspect.js";
import { registerPermission } from "./permission.js";
import { registerLifecycle } from "./lifecycle.js";

/** Register every claude_* tool on the server. */
export function registerAllTools(server: McpServer, sessions: ISessionManager): void {
  registerSpawn(server, sessions);
  registerAsk(server, sessions);
  registerInspect(server, sessions);
  registerPermission(server, sessions);
  registerLifecycle(server, sessions);
}
