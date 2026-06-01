/**
 * Shared Zod schemas.
 *
 * The MCP SDK's `registerTool` expects `inputSchema` / `outputSchema` as a RAW
 * Zod shape (a plain object whose values are Zod types), NOT a `z.object(...)`.
 * We therefore export the shapes as plain objects and build `z.object(...)`
 * wrappers where we need a parser/type.
 */
import { z } from "zod";

/** Selector accepted by every per-session tool: the spawn id or the label. */
export const sessionIdField = z
  .string()
  .min(1)
  .describe("Session id (returned by claude_spawn) or its label");

/** Compact, JSON-serializable form of claude-wrap's SessionState. */
export const sessionStateShape = {
  busy: z.boolean().describe("True while Claude is actively working"),
  mode: z.string().nullable().describe('Current mode, e.g. "plan mode", or null'),
  tokens: z.number().nullable().describe("Token count shown in the status line, if any"),
  permissionPrompt: z
    .object({
      title: z.string(),
      body: z.array(z.string()),
      options: z.array(z.object({ key: z.string(), label: z.string(), selected: z.boolean() })),
    })
    .nullable()
    .describe("Pending permission prompt awaiting approve/deny, or null"),
  todoList: z
    .object({
      total: z.number(),
      done: z.number(),
      open: z.number(),
      tasks: z.array(z.object({ status: z.string(), text: z.string() })),
    })
    .nullable(),
  toolCalls: z
    .array(z.object({ tool: z.string(), args: z.string(), result: z.string() }))
    .describe("Tool invocations visible on screen"),
} as const;

export const sessionStateSchema = z.object(sessionStateShape);
export type SessionStateLite = z.infer<typeof sessionStateSchema>;

/** One row in claude_list. */
export const sessionSummaryShape = {
  sessionId: z.string(),
  label: z.string(),
  origin: z.enum(["in-process", "external"]),
  cwd: z.string(),
  alive: z.boolean(),
  busy: z.boolean(),
} as const;

export const sessionSummarySchema = z.object(sessionSummaryShape);
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
