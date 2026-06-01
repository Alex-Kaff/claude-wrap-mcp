/**
 * Owns the in-process claude-wrap ClaudeManager, assigns session ids, resolves
 * selectors (id / label / external pipe) to a Session, and merges the external
 * instance registry into a single view.
 */
import { ClaudeManager, listInstances, findInstance } from "claude-wrap";
import type { SpawnOptions } from "claude-wrap";
import { ExternalSession, InProcessSession, type Session } from "./session.js";
import type { SessionSummary } from "./schemas.js";
import { logger } from "./logger.js";

export interface SpawnArgs {
  cwd: string;
  label?: string;
  args?: string[];
  model?: string;
}

/** Dependency surface the tools use; faked in tests. */
export interface ISessionManager {
  spawn(args: SpawnArgs): Promise<Session>;
  resolve(selector: string): Session;
  list(): SessionSummary[];
  shutdownAll(): Promise<void>;
}

export class SessionNotFoundError extends Error {
  constructor(selector: string) {
    super(`No session found for "${selector}" (not an in-process id/label nor a known external instance).`);
    this.name = "SessionNotFoundError";
  }
}

export class SessionManager implements ISessionManager {
  private readonly manager = new ClaudeManager();
  private readonly sessions = new Map<string, InProcessSession>();

  async spawn(args: SpawnArgs): Promise<Session> {
    const extra = [...(args.args ?? [])];
    if (args.model) extra.push("--model", args.model);

    const opts: SpawnOptions = { cwd: args.cwd, passthrough: false };
    if (args.label) opts.label = args.label;
    if (extra.length) opts.args = extra;

    const inst = this.manager.spawn(opts);
    const session = new InProcessSession(inst.id, args.cwd, inst);
    this.sessions.set(inst.id, session);
    inst.on("process:exit", () => this.sessions.delete(inst.id));
    logger.info("spawned session", { sessionId: inst.id, label: inst.label, cwd: args.cwd });
    return session;
  }

  resolve(selector: string): Session {
    const byId = this.sessions.get(selector);
    if (byId) return byId;

    for (const s of this.sessions.values()) {
      if (s.label === selector) return s;
    }

    try {
      const entry = findInstance(selector);
      if (entry) {
        return new ExternalSession(entry.pipe, entry.cwd, entry.label ?? entry.title ?? entry.pipe, entry.pipe);
      }
    } catch (err) {
      logger.warn("registry lookup failed", { selector, err: String(err) });
    }

    throw new SessionNotFoundError(selector);
  }

  list(): SessionSummary[] {
    const out: SessionSummary[] = [];
    for (const s of this.sessions.values()) {
      out.push({
        sessionId: s.sessionId,
        label: s.label,
        origin: "in-process",
        cwd: s.cwd,
        alive: s.isAlive(),
        busy: s.isBusy(),
      });
    }
    try {
      for (const entry of listInstances()) {
        out.push({
          sessionId: entry.pipe,
          label: entry.label ?? entry.title ?? entry.pipe,
          origin: "external",
          cwd: entry.cwd,
          alive: true,
          busy: false,
        });
      }
    } catch (err) {
      logger.warn("listInstances failed", { err: String(err) });
    }
    return out;
  }

  async shutdownAll(): Promise<void> {
    try {
      await this.manager.shutdownAll();
    } finally {
      this.sessions.clear();
    }
  }
}
