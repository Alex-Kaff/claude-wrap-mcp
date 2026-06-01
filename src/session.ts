/**
 * Session abstraction used by every tool.
 *
 * Implementations:
 *  - InProcessSession  — wraps a headless claude-wrap `ClaudeInstance` we spawned.
 *    Full feature set (parsed state, events, ask/approve/deny, lifecycle) natively.
 *  - PipeDrivenSession — shared base for sessions driven only over the control
 *    pipe (no in-process PTY/parser). claude-wrap's out-of-process *library*
 *    surface only offers snapshot/write/wait, so snapshot/send/ask use the
 *    library while parsed ops (status, approve, deny, key presses) are delegated
 *    to the purpose-built `claude-wrap-inject` bin. This path is best-effort and
 *    Windows-first; verify against a live window.
 *      - ExternalSession — an instance someone else launched, discovered via the
 *        registry. We refuse to stop it.
 *      - WindowedSession — a *headful* session WE spawned (`openWindow`): it runs
 *        in its own visible terminal via the out-of-process wrapper, so it has no
 *        in-process PTY and must be driven over the pipe like an external one, but
 *        we own it and can stop it.
 */
import { spawn as spawnProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import {
  snapshot as pipeSnapshot,
  write as pipeWrite,
  waitIdle as pipeWaitIdle,
  listInstances,
  SUBMIT_DELAY_MS,
} from "claude-wrap";
import type { SessionState, ClaudeInstance } from "claude-wrap";
import type { SessionStateLite } from "./schemas.js";
import { logger } from "./logger.js";

const MAX_RESULT_LINES = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Type text over the pipe and submit it with a separate Enter after a short
 * gap, so the TUI commits the text before Enter fires (avoids the "typed but
 * never submitted" race). Mirrors ClaudeInstance.sendLine for the in-process
 * path.
 */
async function pipeSubmit(pipeName: string, text: string): Promise<void> {
  await pipeWrite(pipeName, text);
  await sleep(SUBMIT_DELAY_MS);
  await pipeWrite(pipeName, "\r");
}

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
  readonly origin: "in-process" | "external" | "windowed";
  readonly cwd: string;
  /** Control-pipe name; also this session's key in the shared instance registry. */
  readonly pipeName: string;
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
    effort: s.status.effort,
    permissionPrompt: s.permissionPrompt
      ? {
          title: s.permissionPrompt.title,
          question: s.permissionPrompt.question,
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
    remoteUrl: s.remoteUrl,
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

  get pipeName(): string {
    return this.inst.pipeName;
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
    if (decision === "approve") await this.inst.approve();
    else await this.inst.deny();
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

/**
 * Shared base for sessions with no in-process PTY: every interaction goes over
 * the control pipe (snapshot/send/ask via the library, parsed/keyed ops via the
 * `inject` bin). Subclasses supply identity, liveness, and stop semantics.
 */
abstract class PipeDrivenSession implements Session {
  abstract readonly origin: Session["origin"];

  constructor(
    readonly sessionId: string,
    readonly cwd: string,
    readonly label: string,
    readonly pipeName: string,
  ) {}

  abstract isAlive(): boolean;
  abstract stop(force: boolean): Promise<void>;

  isBusy(): boolean {
    // Unknown without a parse round-trip; use status() for an accurate read.
    return false;
  }

  async snapshot(opts: { viewport: boolean; clean: boolean }): Promise<string[]> {
    const snap = await pipeSnapshot(this.pipeName, { viewport: opts.viewport, clean: opts.clean });
    return tail(snap.lines);
  }

  async send(input: SendInput): Promise<void> {
    if (input.key !== undefined) {
      await runInject(this.pipeName, ["key", input.key]);
    } else if (input.line !== undefined) {
      await pipeSubmit(this.pipeName, input.line);
    } else if (input.text !== undefined) {
      await pipeWrite(this.pipeName, input.text);
    } else {
      throw new Error("send requires one of: text, line, key");
    }
  }

  async ask(prompt: string, timeoutMs: number): Promise<AskResult> {
    await pipeSubmit(this.pipeName, prompt);
    let status: "idle" | "busy" = "idle";
    try {
      await pipeWaitIdle(this.pipeName, { timeoutMs });
    } catch (err) {
      if (!isTimeout(err)) throw err;
      status = "busy";
    }
    const snap = await pipeSnapshot(this.pipeName, { clean: true });
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
      effort: null,
      permissionPrompt: null,
      todoList: null,
      toolCalls: [],
      remoteUrl: null,
    };
    try {
      const statusRaw = tryParseJson(await runInject(this.pipeName, ["parse-status"], { json: true })) as
        | { mode?: string | null; busy?: boolean; tokens?: number | null; effort?: string | null }
        | undefined;
      const permRaw = tryParseJson(await runInject(this.pipeName, ["parse-permission"], { json: true })) as
        | {
            title?: string;
            question?: string;
            body?: string[];
            options?: { key: string; label: string; selected: boolean }[];
          }
        | null
        | undefined;
      // A prompt is present if we parsed any options, even when the header
      // ("title") couldn't be identified — anchor on options, not title.
      const hasPrompt = !!permRaw && Array.isArray(permRaw.options) && permRaw.options.length > 0;
      return {
        ...empty,
        busy: statusRaw?.busy ?? false,
        mode: statusRaw?.mode ?? null,
        tokens: statusRaw?.tokens ?? null,
        effort: statusRaw?.effort ?? null,
        permissionPrompt: hasPrompt
          ? {
              title: permRaw!.title ?? "",
              question: permRaw!.question ?? "",
              body: permRaw!.body ?? [],
              options: permRaw!.options ?? [],
            }
          : null,
      };
    } catch (err) {
      logger.warn("pipe-driven status parse failed", { pipe: this.pipeName, err: String(err) });
      return empty;
    }
  }

  async resolvePermission(decision: "approve" | "deny"): Promise<void> {
    await runInject(this.pipeName, [decision]);
  }
}

export class ExternalSession extends PipeDrivenSession {
  readonly origin = "external" as const;

  isAlive(): boolean {
    // Presence in the registry implies a live pid (the registry prunes dead ones).
    return true;
  }

  async stop(_force: boolean): Promise<void> {
    throw new Error(
      "Refusing to stop an external instance this server did not spawn. Close its window manually.",
    );
  }
}

/**
 * A headful session this server spawned: it lives in its own visible terminal
 * window (the out-of-process wrapper owns the PTY), so it is driven over the
 * pipe like an external one — but we hold the spawning handle and can stop it.
 */
export class WindowedSession extends PipeDrivenSession {
  readonly origin = "windowed" as const;

  constructor(
    sessionId: string,
    cwd: string,
    label: string,
    pipeName: string,
    private readonly inst: ClaudeInstance,
  ) {
    super(sessionId, cwd, label, pipeName);
  }

  isAlive(): boolean {
    // The wrapper registers/unregisters itself; the registry is the truth source
    // (the in-process handle's `alive` flag never flips in windowed mode).
    try {
      return listInstances().some((e) => e.pipe === this.pipeName);
    } catch {
      return false;
    }
  }

  async stop(_force: boolean): Promise<void> {
    // Kill the wrapper process tree by its registered pid (this takes `claude`
    // down with it); fall back to tearing down the launcher handle. Best-effort
    // on Windows, where the detached console breaks the launcher's process tree.
    try {
      const entry = listInstances().find((e) => e.pipe === this.pipeName);
      if (entry) {
        spawnProcess("taskkill", ["/F", "/T", "/PID", String(entry.pid)], {
          stdio: "ignore",
        }).unref();
      }
    } catch {
      /* ignore — fall through to handle teardown */
    }
    try {
      this.inst.destroy();
    } catch {
      /* ignore */
    }
  }
}
