/**
 * Owns the in-process claude-wrap ClaudeManager, assigns session ids, resolves
 * selectors (id / label / external pipe) to a Session, and merges the external
 * instance registry into a single view.
 */
import { ClaudeManager, listInstances, findInstance } from "claude-wrap";
import type { SpawnOptions } from "claude-wrap";
import { ExternalSession, InProcessSession, WindowedSession, type Session } from "./session.js";
import type { SessionSummary } from "./schemas.js";
import { logger } from "./logger.js";

export interface SpawnArgs {
  cwd: string;
  label?: string;
  args?: string[];
  model?: string;
  /**
   * Open in a visible terminal window. Defaults to true. When false the session
   * runs headless in-process (more reliable parsed state). Either way the
   * session is registered in the shared instance registry for discovery.
   */
  headful?: boolean;
}

/** How long to wait for a freshly-launched headful window to register its pipe. */
const REGISTRATION_TIMEOUT_MS = 15_000;
const REGISTRATION_POLL_MS = 150;

/**
 * Block until a headful window's wrapper has registered `pipe` (so its control
 * pipe is listening and the first ask/send won't race the bridge coming up).
 * Resolves true once seen, false on timeout.
 */
async function waitForRegistration(pipe: string, timeoutMs = REGISTRATION_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (listInstances().some((e) => e.pipe === pipe)) return true;
    } catch {
      /* registry read raced a concurrent write; retry */
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, REGISTRATION_POLL_MS));
  }
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
  /** Sessions this server owns (headless in-process or headful windowed). */
  private readonly sessions = new Map<string, InProcessSession | WindowedSession>();

  async spawn(args: SpawnArgs): Promise<Session> {
    const extra = [...(args.args ?? [])];
    if (args.model) extra.push("--model", args.model);

    const opts: SpawnOptions = { cwd: args.cwd, passthrough: false };
    if (args.label) opts.label = args.label;
    if (extra.length) opts.args = extra;

    // Headful by default: visible window the user can watch + interact with.
    // openWindow only works on Windows (ConPTY + cmd.exe); elsewhere we fall
    // back to the headless+bridge path so the session is still registered and
    // drivable rather than silently unwired.
    const wantHeadful = args.headful ?? true;
    const headful = wantHeadful && process.platform === "win32";
    if (wantHeadful && !headful) {
      logger.warn("headful sessions require Windows; using headless + bridge instead", {
        platform: process.platform,
      });
    }

    if (headful) {
      // Windowed: the out-of-process wrapper owns the PTY and registers itself.
      opts.openWindow = true;
      const inst = this.manager.spawn(opts);
      const registered = await waitForRegistration(inst.pipeName);
      if (!registered) {
        logger.warn("headful session not yet registered (window still booting?)", {
          sessionId: inst.id,
          pipe: inst.pipeName,
        });
      }
      const session = new WindowedSession(inst.id, args.cwd, inst.label, inst.pipeName, inst);
      this.sessions.set(inst.id, session);
      logger.info("spawned headful session", {
        sessionId: inst.id,
        label: inst.label,
        cwd: args.cwd,
        registered,
      });
      return session;
    }

    // Headless: keep the PTY in-process (native parsing/driving) but expose the
    // control pipe + HTTP bridge so it registers and other tools can drive it.
    opts.enablePipe = true;
    opts.enableHttp = true;
    const inst = this.manager.spawn(opts);
    const session = new InProcessSession(inst.id, args.cwd, inst);
    this.sessions.set(inst.id, session);
    inst.on("process:exit", () => this.sessions.delete(inst.id));
    logger.info("spawned headless session", { sessionId: inst.id, label: inst.label, cwd: args.cwd });
    return session;
  }

  resolve(selector: string): Session {
    const byId = this.sessions.get(selector);
    if (byId) return byId;

    // Match owned sessions by label or pipe name before falling back to the
    // registry — a windowed session selected by its registry pipe should resolve
    // to the handle we can actually stop, not a refuse-to-stop external view.
    for (const s of this.sessions.values()) {
      if (s.label === selector || s.pipeName === selector) return s;
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
    // Read the registry once and reuse it for liveness, pruning, and dedup.
    let registry: ReturnType<typeof listInstances> = [];
    try {
      registry = listInstances();
    } catch (err) {
      logger.warn("listInstances failed", { err: String(err) });
    }
    const livePipes = new Set(registry.map((e) => e.pipe));

    // Drop windowed sessions whose window has closed (the wrapper unregisters on
    // exit). In-process sessions self-remove via their process:exit listener.
    for (const [id, s] of [...this.sessions]) {
      if (s.origin === "windowed" && !livePipes.has(s.pipeName)) this.sessions.delete(id);
    }

    const out: SessionSummary[] = [];
    const ownPipes = new Set<string>();
    for (const s of this.sessions.values()) {
      ownPipes.add(s.pipeName);
      out.push({
        sessionId: s.sessionId,
        label: s.label,
        origin: s.origin,
        cwd: s.cwd,
        alive: s.isAlive(),
        busy: s.isBusy(),
      });
    }

    // Registry rows for instances we don't own. Sessions we spawned now also
    // register, so skip any whose pipe matches one we already listed above.
    for (const entry of registry) {
      if (ownPipes.has(entry.pipe)) continue;
      out.push({
        sessionId: entry.pipe,
        label: entry.label ?? entry.title ?? entry.pipe,
        origin: "external",
        cwd: entry.cwd,
        alive: true,
        busy: false,
      });
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
