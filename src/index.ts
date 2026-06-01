/**
 * CLI entry point — stdio MCP server.
 *
 * NOTE: stdout carries the JSON-RPC stream. Do not write anything to stdout here
 * or anywhere downstream; use the stderr `logger`.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { SessionManager } from "./session-manager.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  const sessions = new SessionManager();
  const server = createServer({ sessions });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`received ${signal}, shutting down`);
    try {
      await sessions.shutdownAll();
    } catch (err) {
      logger.error("error shutting down sessions", { err: String(err) });
    }
    try {
      await server.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("claude-wrap-mcp ready on stdio");
}

main().catch((err) => {
  logger.error("fatal startup error", {
    err: err instanceof Error ? (err.stack ?? err.message) : String(err),
  });
  process.exit(1);
});
