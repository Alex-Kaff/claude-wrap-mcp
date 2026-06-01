# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- CI (typecheck + build + test on PR) and automated npm publish via trusted
  publishing / provenance.
- ESLint + Prettier, `CONTRIBUTING.md`, `SECURITY.md`.

## [0.1.0] - 2026-06-01

Initial release.

### Added
- MCP server (stdio) built on `@modelcontextprotocol/sdk` v1's high-level
  `McpServer` / `registerTool` API, exposing the published `claude-wrap`
  library as tools so agents can spawn and drive Claude Code sessions.
- Eight tools: `claude_spawn`, `claude_ask`, `claude_send`, `claude_status`,
  `claude_snapshot`, `claude_list`, `claude_resolve_permission`, `claude_stop`.
  All use Zod input/output schemas and return both text and `structuredContent`.
- Two control models: an **in-process** headless fleet (`ClaudeManager` /
  `ClaudeInstance`) and **external/attach** to instances launched elsewhere
  (`listInstances` / `Client` + the `claude-wrap-inject` bin; Windows-first).
- Permissions are **surfaced** to the caller (returned in `ask`/`status`) and
  resolved via `claude_resolve_permission` — never auto-bypassed.
- stderr-only logging (stdout reserved for the JSON-RPC stream); `passthrough`
  forced off so it cannot corrupt the transport.
- ESM build via `tsup` (bin with `#!/usr/bin/env node` shebang + `.d.ts`);
  Vitest suite driving the server over an in-memory MCP client.

[Unreleased]: https://github.com/Alex-Kaff/claude-wrap-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Alex-Kaff/claude-wrap-mcp/releases/tag/v0.1.0
