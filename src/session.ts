/**
 * Session abstraction used by every tool.
 *
 * Two implementations:
 *  - InProcessSession  — wraps a claude-wrap `ClaudeInstance` we spawned. Full
 *    feature set (parsed state, events, ask/approve/deny, lifecycle) natively.
 *  - ExternalSession   — drives an instance someone else launched (a visible
 *    window) discovered via the registry. claude-wrap's out-of-process *library*
 *    surface only offers snapshot/write/wait, so snapshot/send/ask use the
 *    library while parsed ops (status, approve, deny, key presses) are delegated
 *    to the purpose-built `claude-wrap-inject` bin. The external path is
 *    best-effort and Windows-first; verify against a live window.
 */
import { spawn as spawnProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import {
  snapshot as pipeSnapshot,
  write as pipeWrite,
  waitIdle as pipeWaitIdle,
} from "claude-wrap";
import type { SessionState, ClaudeInstance } from "claude-wrap";
import type { SessionStateLite } from "./schemas.js";
import { logger } from "./logger.js";

const MAX_RESULT_LINES = 400;

export interface AskResult {
  /** "idle" = Claude finished; "busy" = still working when the timeout elapsed. */
  status: "idle" | "busy";
  /** Rendered transcript lines (clean), capped to the tail. */
  lines: string[];
  /** Parsed state, when available (always for in-process). */
  state: SessionStateLite | null;
}

export interface SendInput {
  text?: string;
  line?: string;
  key?: string;
}

export interface Session {
  readonly sessionId: string;
  readonly label: string;
  readonly origin: "in-process" | "external";
  readonly cwd: string;
  isAlive(): boolean;
  /** Cheap best-effort busy flag for list rows (may be false for external). */
  isBusy(): boolean;
  ask(prompt: string, timeoutMs: number): Promise<AskResult>;
  send(input: SendInput): Promise<void>;
  status(): Promise<SessionStateLite>;
  snapshot(opts: { viewport: boolean; clean: boolean }): Promise<string[]>;
  resolvePermission(decision: "approve" | "deny"): Promise<void>;
  stop(force: boolean): Promise<void>;
}

/** Map claude-wrap's SessionState onto the compact, serializable lite form. */
export function toStateLite(s: SessionState): SessionStateLite {
  return {
    busy: s.status.busy,
    mode: s.status.mode,
    tokens: s.status.tokens,
    permissionPrompt: s.permissionPrompt
      ? {
          title: s.permissionPrompt.title,
          body: s.permissionPrompt.body,
          options: s.permissionPrompt.options.map((o) => ({
            key: o.key,
            label: o.label,
            selected: o.selected,
          })),
        }
      : null,
    todoList: s.todoList
      ? {
          total: s.todoList.total,
          done: s.todoList.done,
          open: s.todoList.open,
          tasks: s.todoList.tasks.map((t) => ({ status: t.status, text: t.text })),
        }
      : null,
    toolCalls: s.toolCalls.map((t) => ({ tool: t.tool, args: t.args, result: t.result })),
  };
}

function tail(lines: string[]): string[] {
  return lines.length > MAX_RESULT_LINES ? lines.slice(-MAX_RESULT_LINES) : lines;
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || /timeout/i.test(err.message));
}

// ---------------------------------------------------------------------------
// In-process
// ---------------------------------------------------------------------------

export class InProcessSession implements Session {
  readonly origin = "in-process" as const;

  constructor(
    readonly sessionId: string,
    readonly cwd: string,
    private readonly inst: ClaudeInstance,
  ) {}

  get label(): string {
    return this.inst.label;
  }

  isAlive(): boolean {
    return this.inst.alive;
  }

  isBusy(): boolean {
    try {
      return this.inst.state.status.busy;
    } catch {
      return false;
    }
  }

  private cleanLines(): string[] {
    return tail(this.inst.snapshot({ clean: true }).lines);
  }

  async ask(prompt: string, timeoutMs: number): Promise<AskResult> {
    try {
      const state = await this.inst.ask(prompt, { timeoutMs });
      return { status: "idle", lines: this.cleanLines(), state: toStateLite(state) };
    } catch (err) {
      if (isTimeout(err)) {
        return { status: "busy", lines: this.cleanLines(), state: toStateLite(this.inst.state) };
      }
      throw err;
    }
  }

  async send(input: SendInput): Promise<void> {
    if (input.key !== undefined) this.inst.sendKey(input.key);
    else if (input.line !== undefined) this.inst.sendLine(input.line);
    else if (input.text !== undefined) this.inst.send(input.text);
    else throw new Error("send requires one of: text, line, key");
  }

  async status(): Promise<SessionStateLite> {
    return toStateLite(this.inst.state);
  }

  async snapshot(opts: { viewport: boolean; clean: boolean }): Promise<string[]> {
    return tail(this.inst.snapshot(opts).lines);
  }

  async resolvePermission(decision: "approve" | "deny"): Promise<void> {
    if (decision === "approve") this.inst.approve();
    else this.inst.deny();
  }

  async stop(force: boolean): Promise<void> {
    if (force) this.inst.destroy();
    else await this.inst.shutdown();
  }
}

// ---------------------------------------------------------------------------
// External (out-of-process, via pipe + claude-wrap-inject bin)
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);

/** Absolute path to the installed claude-wrap `inject` entry. */
function injectScript(): string {
  const pkgJson = require.resolve("claude-wrap/package.json");
  return path.join(path.dirname(pkgJson), "dist", "inject.js");
}

function runInject(
  pipe: string,
  args: string[],
  opts: { json?: boolean; timeoutMs?: number } = {},
): Promise<string> {
  const { json = false, timeoutMs = 30_000 } = opts;
  return new Promise((resolve, reject) => {
    const argv = [injectScript(), "--pipe", pipe, ...(json ? ["--json"] : []), ...args];
    const child = spawnProcess(process.execPath, argv, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let errOut = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`inject ${args.join(" ")} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (errOut += String(d)));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`inject ${args.join(" ")} failed (exit ${code}): ${errOut || out}`));
    });
  });
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export class ExternalSession implements Session {
  readonly origin = "external" as const;

  constructor(
    readonly sessionId: string,
    readonly cwd: string,
    readonly label: string,
    private readonly pipe: string,
  ) {}

  isAlive(): boolean {
    // Presence in the registry implies a live pid (the registry prunes dead ones).
    return true;
  }

  isBusy(): boolean {
    // Unknown without a parse round-trip; use status() for an accurate read.
    return false;
  }

  async snapshot(opts: { viewport: boolean; clean: boolean }): Promise<string[]> {
    const snap = await pipeSnapshot(this.pipe, { viewport: opts.viewport, clean: opts.clean });
    return tail(snap.lines);
  }

  async send(input: SendInput): Promise<void> {
    if (input.key !== undefined) {
      await runInject(this.pipe, ["key", input.key]);
    } else if (input.line !== undefined) {
      await pipeWrite(this.pipe, input.line + "\r");
    } else if (input.text !== undefined) {
      await pipeWrite(this.pipe, input.text);
    } else {
      throw new Error("send requires one of: text, line, key");
    }
  }

  async ask(prompt: string, timeoutMs: number): Promise<AskResult> {
    await pipeWrite(this.pipe, prompt + "\r");
    let status: "idle" | "busy" = "idle";
    try {
      await pipeWaitIdle(this.pipe, { timeoutMs });
    } catch (err) {
      if (!isTimeout(err)) throw err;
      status = "busy";
    }
    const snap = await pipeSnapshot(this.pipe, { clean: true });
    // Out-of-process ask cannot reliably detect permission prompts; callers
    // should follow up with claude_status when status === "busy".
    return { status, lines: tail(snap.lines), state: null };
  }

  async status(): Promise<SessionStateLite> {
    // Best-effort: shell out to inject's parsers. Shapes are parsed defensively
    // so a format drift degrades to nulls instead of throwing.
    const empty: SessionStateLite = {
      busy: false,
      mode: null,
      tokens: null,
      permissionPrompt: null,
      todoList: null,
      toolCalls: [],
    };
    try {
      const statusRaw = tryParseJson(await runInject(this.pipe, ["parse-status"], { json: true })) as
        | { mode?: string | null; busy?: boolean; tokens?: number | null }
        | undefined;
      const permRaw = tryParseJson(await runInject(this.pipe, ["parse-permission"], { json: true })) as
        | { title?: string; body?: string[]; options?: { key: string; label: string; selected: boolean }[] }
        | null
        | undefined;
      return {
        ...empty,
        busy: statusRaw?.busy ?? false,
        mode: statusRaw?.mode ?? null,
        tokens: statusRaw?.tokens ?? null,
        permissionPrompt:
          permRaw && permRaw.title
            ? { title: permRaw.title, body: permRaw.body ?? [], options: permRaw.options ?? [] }
            : null,
      };
    } catch (err) {
      logger.warn("external status parse failed", { pipe: this.pipe, err: String(err) });
      return empty;
    }
  }

  async resolvePermission(decision: "approve" | "deny"): Promise<void> {
    await runInject(this.pipe, [decision]);
  }

  async stop(_force: boolean): Promise<void> {
    throw new Error(
      "Refusing to stop an external instance this server did not spawn. Close its window manually.",
    );
  }
}
