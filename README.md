# claude-wrap-mcp

[![npm version](https://img.shields.io/npm/v/claude-wrap-mcp.svg)](https://www.npmjs.com/package/claude-wrap-mcp)
[![license](https://img.shields.io/npm/l/claude-wrap-mcp.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/claude-wrap-mcp.svg)](https://nodejs.org)

An [MCP](https://modelcontextprotocol.io) server that lets any MCP-capable agent
(Claude Code, Claude Desktop, Cursor, …) **spawn and drive Claude Code sessions**
— effectively turning Claude Code into an orchestratable sub-agent fleet. Built
on the [`claude-wrap`](https://www.npmjs.com/package/claude-wrap) library.

## Requirements

- **Node ≥ 18**
- The **`claude` CLI on your `PATH`** (the sessions run real Claude Code).
- `claude-wrap` pulls the native [`node-pty`](https://github.com/microsoft/node-pty)
  addon, so a prebuilt binary or a C/C++ toolchain is needed at install time.
- Spawning headless sessions works cross-platform; **attaching to visible
  windows is Windows-first**.

## Install & register

```sh
npm install -g claude-wrap-mcp
# then, in Claude Code:
claude mcp add claude-wrap -- claude-wrap-mcp
```

Or via JSON config (`.mcp.json` / `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "claude-wrap": { "command": "npx", "args": ["-y", "claude-wrap-mcp"] }
  }
}
```

Once published, it's also discoverable in the [MCP Registry](https://registry.modelcontextprotocol.io) as `io.github.Alex-Kaff/claude-wrap-mcp`.

## Tools

| Tool | What it does |
|---|---|
| `claude_spawn` | Start a headless session in an **absolute** `cwd`. Returns a `sessionId`. |
| `claude_ask` | Send a prompt, wait for idle, return transcript tail + parsed state. Returns `status:"busy"` on timeout (not an error). |
| `claude_send` | Send raw input (`text` / `line` / `key`) without waiting — for long tasks; then poll. |
| `claude_status` | Parsed state: busy, mode, tokens, pending permission prompt, todos, tool calls. |
| `claude_snapshot` | The rendered transcript lines. |
| `claude_list` | All sessions — in-process (spawned here) and external (discovered windows). |
| `claude_resolve_permission` | `approve` / `deny` a pending permission prompt. |
| `claude_stop` | Shut down an in-process session. |

Permission prompts are **surfaced, not auto-bypassed**: when `claude_ask` /
`claude_status` report a pending `permissionPrompt`, resolve it with
`claude_resolve_permission`.

## Control models

- **In-process (primary):** the server owns a `claude-wrap` `ClaudeManager` and
  drives headless sessions directly — full parsed state and lifecycle.
- **External (Windows-first):** sessions launched elsewhere (visible windows)
  are discovered via the registry and driven over their pipe; parsed operations
  are delegated to the `claude-wrap-inject` bin. Best-effort; `claude_stop` is
  declined for instances this server did not spawn.

## Develop

```sh
pnpm install
pnpm --filter claude-wrap-mcp build      # tsup -> dist/ (ESM + .d.ts, shebang on the bin)
pnpm --filter claude-wrap-mcp test       # vitest, in-memory MCP client against fakes
pnpm --filter claude-wrap-mcp inspect    # @modelcontextprotocol/inspector on the built server
```

## License

[MIT](./LICENSE) © Alex Kaffetzakis
