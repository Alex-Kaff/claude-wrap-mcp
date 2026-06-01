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
  mode: z
    .string()
    .nullable()
    .describe('Current mode: "normal", "auto mode on", "accept edits on", "plan mode on", or null'),
  tokens: z.number().nullable().describe("Token count shown in the status line, if any"),
  effort: z
    .string()
    .nullable()
    .describe('Reasoning-effort level shown in the status bar (e.g. "xhigh"), or null'),
  permissionPrompt: z
    .object({
      title: z.string().describe('Box header, e.g. "Create file", "Bash command", "Trust folder"'),
      question: z
        .string()
        .describe('The question asked, e.g. "Do you want to create note.txt?" ("" if unrecognized)'),
      body: z.array(z.string()).describe("Detail lines: the command, diff, or fetch target"),
      options: z.array(z.object({ key: z.string(), label: z.string(), selected: z.boolean() })),
    })
    .nullable()
    .describe("Pending permission/confirmation prompt awaiting approve/deny, or null"),
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
  remoteUrl: z
    .string()
    .nullable()
    .describe("Remote-control session URL when /remote-control is active, else null"),
} as const;

export const sessionStateSchema = z.object(sessionStateShape);
export type SessionStateLite = z.infer<typeof sessionStateSchema>;

/** One row in claude_list. */
export const sessionSummaryShape = {
  sessionId: z.string(),
  label: z.string(),
  origin: z
    .enum(["in-process", "external", "windowed"])
    .describe(
      'How the session is driven: "in-process" (headless, native), "windowed" (headful session we spawned, driven over the pipe), "external" (discovered, launched elsewhere)',
    ),
  cwd: z.string(),
  alive: z.boolean(),
  busy: z.boolean(),
} as const;

export const sessionSummarySchema = z.object(sessionSummaryShape);
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
