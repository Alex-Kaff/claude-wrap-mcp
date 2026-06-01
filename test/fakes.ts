import type { ISessionManager, SpawnArgs } from "../src/session-manager.js";
import type { AskResult, SendInput, Session } from "../src/session.js";
import type { SessionStateLite, SessionSummary } from "../src/schemas.js";

const emptyState: SessionStateLite = {
  busy: false,
  mode: null,
  tokens: null,
  permissionPrompt: null,
  todoList: null,
  toolCalls: [],
};

export class FakeSession implements Session {
  readonly origin = "in-process" as const;
  sent: SendInput[] = [];
  resolved: Array<"approve" | "deny"> = [];
  stopped = false;
  state: SessionStateLite;
  lines: string[];

  constructor(
    readonly sessionId: string,
    readonly label: string,
    readonly cwd: string,
    opts?: { state?: SessionStateLite; lines?: string[] },
  ) {
    this.state = opts?.state ?? emptyState;
    this.lines = opts?.lines ?? [`hello from ${sessionId}`];
  }

  isAlive(): boolean {
    return !this.stopped;
  }
  isBusy(): boolean {
    return this.state.busy;
  }
  async ask(prompt: string): Promise<AskResult> {
    this.sent.push({ line: prompt });
    return { status: this.state.busy ? "busy" : "idle", lines: this.lines, state: this.state };
  }
  async send(input: SendInput): Promise<void> {
    this.sent.push(input);
  }
  async status(): Promise<SessionStateLite> {
    return this.state;
  }
  async snapshot(): Promise<string[]> {
    return this.lines;
  }
  async resolvePermission(decision: "approve" | "deny"): Promise<void> {
    this.resolved.push(decision);
  }
  async stop(): Promise<void> {
    this.stopped = true;
  }
}

export class FakeSessionManager implements ISessionManager {
  sessions = new Map<string, FakeSession>();
  spawnCalls: SpawnArgs[] = [];
  externalSummaries: SessionSummary[] = [];

  async spawn(args: SpawnArgs): Promise<Session> {
    this.spawnCalls.push(args);
    const id = `fake-${this.sessions.size + 1}`;
    const session = new FakeSession(id, args.label ?? id, args.cwd);
    this.sessions.set(id, session);
    return session;
  }

  resolve(selector: string): Session {
    const byId = this.sessions.get(selector);
    if (byId) return byId;
    for (const s of this.sessions.values()) if (s.label === selector) return s;
    throw new Error(`not found: ${selector}`);
  }

  list(): SessionSummary[] {
    const inProc: SessionSummary[] = [...this.sessions.values()].map((s) => ({
      sessionId: s.sessionId,
      label: s.label,
      origin: "in-process",
      cwd: s.cwd,
      alive: s.isAlive(),
      busy: s.isBusy(),
    }));
    return [...inProc, ...this.externalSummaries];
  }

  async shutdownAll(): Promise<void> {
    for (const s of this.sessions.values()) await s.stop();
  }
}
