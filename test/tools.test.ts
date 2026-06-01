import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { FakeSessionManager } from "./fakes.js";

async function connect(sessions: FakeSessionManager) {
  const server = createServer({ sessions });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server, sessions };
}

describe("claude-wrap-mcp tools", () => {
  it("registers every claude_ tool", async () => {
    const { client } = await connect(new FakeSessionManager());
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "claude_ask",
        "claude_list",
        "claude_resolve_permission",
        "claude_send",
        "claude_snapshot",
        "claude_spawn",
        "claude_status",
        "claude_stop",
      ].sort(),
    );
  });

  it("claude_spawn forwards args and returns a sessionId", async () => {
    const { client, sessions } = await connect(new FakeSessionManager());
    const res = await client.callTool({
      name: "claude_spawn",
      arguments: { cwd: "/abs/project", label: "demo", model: "claude-opus-4-8" },
    });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ label: "demo", cwd: "/abs/project" });
    expect(sessions.spawnCalls[0]).toMatchObject({ cwd: "/abs/project", label: "demo", model: "claude-opus-4-8" });
  });

  it("claude_spawn rejects a relative cwd", async () => {
    const { client } = await connect(new FakeSessionManager());
    // The SDK surfaces input-schema validation failures as a resolved result
    // with isError:true (not a thrown rejection).
    const res = await client.callTool({
      name: "claude_spawn",
      arguments: { cwd: "relative/path" },
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("absolute");
  });

  it("claude_ask sends the prompt and returns transcript + state", async () => {
    const sessions = new FakeSessionManager();
    const { client } = await connect(sessions);
    await client.callTool({ name: "claude_spawn", arguments: { cwd: "/abs/p" } });

    const res = await client.callTool({
      name: "claude_ask",
      arguments: { sessionId: "fake-1", prompt: "list files" },
    });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ status: "idle" });
    expect(sessions.sessions.get("fake-1")!.sent).toContainEqual({ line: "list files" });
  });

  it("claude_send requires exactly one of text/line/key", async () => {
    const sessions = new FakeSessionManager();
    const { client } = await connect(sessions);
    await client.callTool({ name: "claude_spawn", arguments: { cwd: "/abs/p" } });

    const bad = await client.callTool({
      name: "claude_send",
      arguments: { sessionId: "fake-1", text: "a", line: "b" },
    });
    expect(bad.isError).toBe(true);

    const good = await client.callTool({
      name: "claude_send",
      arguments: { sessionId: "fake-1", key: "enter" },
    });
    expect(good.isError).toBeFalsy();
    expect(sessions.sessions.get("fake-1")!.sent).toContainEqual({ key: "enter" });
  });

  it("claude_resolve_permission approves/denies", async () => {
    const sessions = new FakeSessionManager();
    const { client } = await connect(sessions);
    await client.callTool({ name: "claude_spawn", arguments: { cwd: "/abs/p" } });

    await client.callTool({
      name: "claude_resolve_permission",
      arguments: { sessionId: "fake-1", decision: "approve" },
    });
    expect(sessions.sessions.get("fake-1")!.resolved).toEqual(["approve"]);
  });

  it("claude_status returns parsed state", async () => {
    const sessions = new FakeSessionManager();
    const { client } = await connect(sessions);
    await client.callTool({ name: "claude_spawn", arguments: { cwd: "/abs/p" } });

    const res = await client.callTool({ name: "claude_status", arguments: { sessionId: "fake-1" } });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ busy: false, toolCalls: [] });
  });

  it("claude_list merges in-process and external sessions", async () => {
    const sessions = new FakeSessionManager();
    sessions.externalSummaries.push({
      sessionId: "claude-wrap",
      label: "win",
      origin: "external",
      cwd: "C:/x",
      alive: true,
      busy: false,
    });
    const { client } = await connect(sessions);
    await client.callTool({ name: "claude_spawn", arguments: { cwd: "/abs/p" } });

    const res = await client.callTool({ name: "claude_list", arguments: {} });
    const listed = (res.structuredContent as { sessions: Array<{ origin: string }> }).sessions;
    expect(listed.map((s) => s.origin).sort()).toEqual(["external", "in-process"]);
  });

  it("claude_stop stops the session", async () => {
    const sessions = new FakeSessionManager();
    const { client } = await connect(sessions);
    await client.callTool({ name: "claude_spawn", arguments: { cwd: "/abs/p" } });

    await client.callTool({ name: "claude_stop", arguments: { sessionId: "fake-1" } });
    expect(sessions.sessions.get("fake-1")!.stopped).toBe(true);
  });
});
