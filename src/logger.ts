/**
 * stderr-only logger.
 *
 * CRITICAL: an MCP stdio server uses **stdout** for the JSON-RPC message stream.
 * Anything written to stdout that is not a framed JSON-RPC message corrupts the
 * protocol and the client drops the connection. Therefore ALL diagnostic output
 * must go to stderr. Never use `console.log` in this package.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// LOG_LEVEL env var (default "info"); set CLAUDE_WRAP_MCP_LOG=debug for verbose.
const threshold = LEVELS[(process.env.CLAUDE_WRAP_MCP_LOG as Level) ?? "info"] ?? LEVELS.info;

function emit(level: Level, msg: string, meta?: unknown): void {
  if (LEVELS[level] < threshold) return;
  const line =
    meta === undefined
      ? `[claude-wrap-mcp] ${level} ${msg}`
      : `[claude-wrap-mcp] ${level} ${msg} ${safeJson(meta)}`;
  process.stderr.write(line + "\n");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const logger = {
  debug: (msg: string, meta?: unknown) => emit("debug", msg, meta),
  info: (msg: string, meta?: unknown) => emit("info", msg, meta),
  warn: (msg: string, meta?: unknown) => emit("warn", msg, meta),
  error: (msg: string, meta?: unknown) => emit("error", msg, meta),
};
