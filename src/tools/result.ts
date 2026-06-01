import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../logger.js";

export function textResult(
  text: string,
  structuredContent?: Record<string, unknown>,
): CallToolResult {
  const result: CallToolResult = { content: [{ type: "text", text }] };
  if (structuredContent) result.structuredContent = structuredContent;
  return result;
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Wrap a tool handler so thrown errors become an `isError` result (the v1.x
 * convention) instead of crashing the JSON-RPC connection.
 */
export function guard<A>(
  name: string,
  fn: (args: A) => Promise<CallToolResult>,
): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`tool ${name} failed`, { err: msg });
      return errorResult(`${name} failed: ${msg}`);
    }
  };
}
