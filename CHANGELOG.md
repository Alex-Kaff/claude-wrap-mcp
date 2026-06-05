# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- CI (typecheck + build + test on PR) and automated npm publish via trusted
  publishing / provenance.
- ESLint + Prettier, `CONTRIBUTING.md`, `SECURITY.md`.

## [0.1.2] - 2026-06-05

Repairs headful / external session driving against Claude Code v2.1.165. Bumps
the `claude-wrap` dependency to `^0.1.2` (clean child environment so spawned
windows no longer hijack the launching agent's IDE). Backward compatible.

### Fixed
- **Headful / external sessions are drivable again.** `injectScript()` resolved
  the `claude-wrap-inject` bin via `require.resolve("claude-wrap/package.json")`,
  which throws `ERR_PACKAGE_PATH_NOT_EXPORTED` on Node's modern resolver because
  claude-wrap's `exports` map doesn't expose `./package.json`. That exception
  bubbled through every `runInject` call, so on **windowed** and **external**
  sessions `claude_status` silently returned all-nulls (no mode/tokens/permission),
  `claude_resolve_permission` failed, and `claude_send {key}` (e.g. `shift-tab`)
  was a no-op — the bulk of "headful mode is junky". Now resolved via the
  package's main entry (always exported) and its sibling `inject.js`. Verified
  end-to-end against Claude Code v2.1.165 (spawn → status → key → permission →
  approve → stop).

## [0.1.1] - 2026-06-01

Depends on `claude-wrap@^0.1.1`, which repairs parsed-state detection against
Claude Code v2.1.159. Backward-compatible: existing tool calls behave the same,
with the fixes flowing through the underlying library plus a headful spawn mode
and a few additive fields.

### Fixed
- **Permission prompts are detected again.** `claude_status.permissionPrompt` and
  `claude_ask`'s returned state now surface tool/file approval prompts (Bash,
  Write, Edit, WebFetch) and the startup "trust this folder" dialog, and
  `claude_resolve_permission` resolves them. Previously the matcher targeted an
  older prompt layout and always returned `null` / "no permission prompt on
  screen".
- **`claude_ask` reliably submits the prompt.** The prompt text and Enter are now
  sent as separate writes (with a brief settle and a one-shot retry), fixing the
  intermittent "typed but never submitted" race. Same fix applies to
  `claude_send {line}` and the pipe-driven path.
- **`busy` / mode / tokens reporting.** Busy is keyed off the status bar's
  "esc to interrupt" hint instead of animated spinner glyphs (which varied per
  frame and lingered after completion); mode now recognizes "auto mode on" and
  reports normal/default mode, and token parsing no longer depends on the mode
  matching.
- **`claude_resolve_permission` deny** reliably selects the "No" option rather
  than racing the highlighted default.

### Added
- **Headful spawn mode.** `claude_spawn` now opens a visible terminal window by
  default (Windows) — a `WindowedSession` driven over the control pipe — and
  registers it for discovery; pass `headful:false` for the headless in-process
  session with the most reliable parsed state. `claude_list` reports the
  `windowed` origin alongside `in-process` and `external`.
- `claude_send` accepts `shift-tab` (cycles Claude's mode: normal → auto →
  accept-edits → plan) plus `home`/`end`/`page{up,down}`/`delete`/`space` and
  more control chords; `unknown key` errors now list the valid keys.
- New parsed fields surfaced in `claude_status` / `claude_ask` state:
  `permissionPrompt.question`, `mode`'s normal/auto values, `effort`
  (reasoning-effort level), and a top-level `remoteUrl` (the `/remote-control`
  session link).
- Tool descriptions and server instructions updated to match the above.

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

[Unreleased]: https://github.com/Alex-Kaff/claude-wrap-mcp/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/Alex-Kaff/claude-wrap-mcp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Alex-Kaff/claude-wrap-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Alex-Kaff/claude-wrap-mcp/releases/tag/v0.1.0
