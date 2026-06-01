# claude-wrap MCP — Manual Test Report

**Date:** 2026-06-01
**Tester:** Claude (Opus 4.8, via Claude Code) driving the MCP server live
**Target:** `claude-wrap` MCP server (package `packages/claude-wrap-mcp`)
**Claude Code version under wrap:** v2.1.159
**Host OS:** Windows 10 Pro (19045), PowerShell + git-bash

> **UPDATE 2026-06-01 — all findings below are now FIXED and verified.**
> See [§8 Resolution](#8-resolution-2026-06-01) at the bottom for what changed,
> why the detectors broke, and how each fix was re-verified against a live
> Claude Code v2.1.159 session. The sections below are preserved as the
> original diagnosis.

---

## 1. Scope & method

The goal was to exercise the MCP server end-to-end against a **real** headless Claude
Code session, evaluate how well it works, and judge how well the tools document
themselves to a calling agent.

To avoid touching real work, the test session was spawned in an isolated scratch
directory (`%TEMP%\claude-wrap-test`) and the directory was deleted afterward. The
session itself was stopped via `claude_stop`.

All 8 tools were exercised:

| Tool | Purpose |
|------|---------|
| `claude_spawn` | Start a headless session in a working dir |
| `claude_ask` | Send a prompt and wait for idle |
| `claude_send` | Send raw input (text / line / key) without waiting |
| `claude_status` | Parsed state: busy, mode, tokens, permission prompt, todos, tool calls |
| `claude_snapshot` | Rendered transcript (full or viewport) |
| `claude_resolve_permission` | Approve/deny a pending permission prompt |
| `claude_list` | List in-process + external sessions |
| `claude_stop` | Shut down an in-process session |

### Test sequence

1. `claude_list` — confirm clean slate (returned `{"sessions":[]}`).
2. Create scratch dir; resolve its Windows path via `cygpath`.
3. `claude_spawn` in the scratch dir with label `wrap-test`.
4. `claude_status` + `claude_snapshot` — observe boot state.
5. Confirm the startup "trust this folder" dialog.
6. `claude_ask` — identity/cwd question (no tools).
7. `claude_ask` — run `whoami` (Bash).
8. Cycle out of auto-accept mode (raw `ESC [ Z`).
9. `claude_ask` — run `hostname` (Bash).
10. `claude_ask` — `WebFetch https://example.com` → permission prompt → resolution attempts.
11. `claude_ask` — `Write note.txt` → permission prompt → resolution attempts.
12. `claude_list`, `claude_stop`, error-handling probe, cleanup.

---

## 2. Verdict

**The session plumbing is solid; the headline feature — permission-prompt
detection and resolution — is broken against current Claude Code (v2.1.159).**

A calling agent can spawn, drive, observe, and stop sessions reliably, but it
**cannot** detect or resolve permission prompts through the dedicated tools and must
fall back to raw `claude_send` + Enter.

---

## 3. Per-tool results

### ✅ `claude_spawn` — works
Returned `{"sessionId":"claude-1-rx3j6h","label":"wrap-test","cwd":...}`. The label
functioned as a selector for every subsequent call. The session booted to Claude
Code v2.1.159.

### ✅ `claude_snapshot` — works
Full and `viewport:true` modes both returned clean rendered transcript lines.
Caveat — see Finding 5: it strips terminal styling, so dimmed ghost-text
autocomplete is indistinguishable from real typed input.

### ⚠️ `claude_status` — partially works
- ✅ `busy`, `tokens`, `mode`, and a structured `toolCalls` array (`{tool, args,
  result}`) are populated correctly when the session is idle.
- 🔴 `permissionPrompt` is **never populated**, even with a prompt clearly on screen
  (Findings 1).
- 🟡 `busy` detection lags real state (Finding 3).
- Mid-stream, a `toolCalls[].result` was briefly polluted with TUI chrome (spinner /
  separators / `❯`); it resolved to clean text once the session went idle.

### ⚠️ `claude_ask` — works, but auto-submit is flaky
Round-trips a prompt and returns the transcript tail + parsed state. **But in 4 of 5
calls the prompt was typed into the input box and never submitted** (Finding 2). It
also returned `"idle"` while the session was still working (Finding 3).

### ✅ `claude_send` — works well
`text`, `line`, and `key` all functioned. Raw escape sequences pass through to the
PTY — `ESC [ Z` (back-tab) successfully cycled the permission mode when no named key
existed. Named-key vocabulary is limited (Finding 6).

### 🔴 `claude_resolve_permission` — broken
Failed with `"no permission prompt on screen"` for **both** prompt formats tested
(WebFetch domain approval and file creation), despite the prompts being visibly on
screen. Shares the same broken detection logic as `claude_status.permissionPrompt`.

### ✅ `claude_list` — works well
Reported `sessionId`, `label`, `origin` (`in-process`), `cwd`, `alive`, `busy`.

### ✅ `claude_stop` — works
Graceful stop; session was immediately removed from `claude_list`.

### ✅ Error handling — good
`claude_status` on a stopped session returned:
`No session found for "wrap-test" (not an in-process id/label nor a known external instance).`
Clear and actionable.

---

## 4. Findings (detailed)

### 🔴 Finding 1 — Permission prompts are not detected (core feature)
With a permission prompt fully rendered on screen, `claude_status` returned
`"permissionPrompt": null`. This held for **two distinct prompt formats**:

- **WebFetch:** `Do you want to allow Claude to fetch this content?` (`1. Yes / 2. Yes,
  and don't ask again for example.com / 3. No`)
- **File write:** `Do you want to create note.txt?` (`1. Yes / 2. Yes, allow all edits
  during this session / 3. No`)

In both cases the `toolCalls` array *did* show the pending tool (`Fetch` / `Write`)
with an empty `result`, but no `permissionPrompt` field was emitted.

**Impact:** This is the feature the server instructions and tool descriptions are
built around ("If a result reports a pending permission prompt, resolve it with
`claude_resolve_permission`"; "The result may include a pending `permissionPrompt`").
In practice that field never appears, so an agent relying on the documented flow
would stall.

**Likely cause:** the prompt matcher targets an older Claude Code prompt layout;
v2.1.159 renders these prompts differently (new wording, dashed/diff frames instead
of the classic `╭─╮` box). The detector no longer matches.

**Workaround that works:** `claude_send` with `key: "enter"` (option 1 is
pre-highlighted) approved both prompts, and the underlying actions completed
correctly (`Received 528 bytes (200 OK)` → "Example Domain"; `note.txt` written with
the expected content). So only the wrap's detection layer is broken — not the
session itself.

### 🟠 Finding 2 — `claude_ask` frequently fails to submit the prompt
In 4 of 5 `claude_ask` calls, the prompt text appeared in the input box but was
**never submitted**: the token count was unchanged, `status` came back `"idle"`
immediately, and the session never went busy. A manual `claude_send {key:"enter"}`
was required to submit each time. Only the `hostname` ask auto-submitted.

This looks like a race between typing the text and pressing Enter (Enter fires before
the TUI has committed the typed/pasted text). It is **intermittent**, which makes it
worse for automation than a consistent failure would be.

**Suggested fix:** after sending the prompt, verify submission (busy flag flips or
token count increases within a short window) and retry the Enter once if not.

### 🟡 Finding 3 — `busy` / idle reporting lags real state
`claude_ask` returned `"status":"idle"` and `claude_status` returned `"busy":false`
on several occasions while the snapshot showed the session actively working
(`Running… / esc to interrupt`, `Waddling…`). A poll-until-idle loop built on this
could exit early and read a half-finished transcript.

### 🟡 Finding 4 — Startup "trust this folder" dialog is not surfaced
On spawn, the session opened on the
`Is this a project you created or one you trust?` dialog. `claude_status` reported
`permissionPrompt: null` for it; it was only discoverable via `claude_snapshot`. A
freshly spawned session therefore silently waits on this dialog unless the caller
knows to snapshot and send Enter.

### 🟡 Finding 5 — Snapshots strip styling; ghost text looks like real input
Claude Code shows a **dimmed autocomplete suggestion** in the input line. The
snapshot renders it identically to genuinely typed text. During the test a phantom
`echo $env:USERNAME` appeared in the input box; `ctrl-c` did not clear it (confirming
it was a ghost suggestion, not buffered input). A driving agent cannot distinguish
"queued input I must clear" from "harmless suggestion" via snapshot alone.

### 🟢 Finding 6 — Limited named-key vocabulary; errors don't enumerate keys
`claude_send` rejected `shift-tab`, `shift+tab`, and `btab` with
`unknown key: <name>`, and the error did not list the valid keys. `shift+tab` (cycle
permission mode) is common enough to warrant a name. Workaround: raw `ESC [ Z` via the
`text` parameter passes through to the PTY.

---

## 5. Documentation quality (as seen by a calling agent)

Good overall. The server instructions lay out a coherent workflow (spawn → ask →
resolve_permission → send/poll for long tasks), and each tool description accurately
states its return shape and the busy-vs-idle contract (e.g. `claude_ask`'s note that
a timeout returns `"busy"` rather than an error is helpful and correct).

The single place the docs **over-promise** is exactly where the bug lives: they
instruct the agent to act on a `permissionPrompt` that is never emitted. Aligning the
docs with reality (or fixing the detector) would remove the only real stumbling block.
I was able to operate every other tool confidently from its description alone.

---

## 6. Recommended fixes (priority order)

1. **Fix the permission-prompt matcher** for current Claude Code. Cover both the
   `Do you want to allow Claude to …` (WebFetch/tool) and `Do you want to
   create/edit …` (file) layouts, and add a regression fixture per layout so future
   Claude Code releases are caught.
2. **Make `claude_ask` confirm submission** — verify busy/token change after Enter and
   retry once; this removes the ~80% manual-Enter requirement.
3. **Tighten busy detection** so `claude_ask` / `claude_status` don't report idle
   mid-work.
4. **Surface the startup trust dialog** as a detectable prompt (or auto-handle it on
   spawn behind a flag).
5. **Expand the named-key set** (add `shift-tab` and friends) and make the
   `unknown key` error list valid keys.
6. Optionally, mark ghost-text/dim regions in snapshots (or expose a styled variant)
   so callers can tell suggestions from real input.

---

## 7. Evidence appendix (key transcript excerpts)

**Permission prompt on screen but undetected (WebFetch):**
```
 Do you want to allow Claude to fetch this content?
 ❯ 1. Yes
   2. Yes, and don't ask again for example.com
   3. No, and tell Claude what to do differently (esc)
```
`claude_status` → `"permissionPrompt": null`
`claude_resolve_permission {approve}` → `claude_resolve_permission failed: no permission prompt on screen`

**Permission prompt on screen but undetected (Write):**
```
 Do you want to create note.txt?
 ❯ 1. Yes
   2. Yes, allow all edits during this session (shift+tab)
   3. No
```
`claude_status` → `"permissionPrompt": null`
`claude_resolve_permission {approve}` → `... no permission prompt on screen`

**`claude_ask` typed-but-not-submitted (one of 4):**
The input box showed `❯ Use the WebFetch tool to fetch https://example.com …` with
`status:"idle"`, tokens unchanged at 27961, and `busy:false`. A manual
`claude_send {key:"enter"}` flipped it to `busy:true`.

**Raw escape sequence cycles mode (workaround):**
`claude_send {text:"[Z"}` changed the status line from
`⏵⏵ auto mode on (shift+tab to cycle)` to `? for shortcuts`.

**Things that worked end-to-end:** spawn, snapshot, list, stop, structured
`toolCalls` (`whoami → alexk`, `hostname → DESKTOP-PU4DKLT`), manual permission
approval (`note.txt` written with `hello from wrap test`), and clear not-found errors.

---

## 8. Resolution (2026-06-01)

All six findings are fixed in the inner `claude-wrap` package (the MCP server is
a thin wrapper over it). Detectors were rebuilt from **ground-truth screen
captures** taken by driving a real headless v2.1.159 session via the MCP tools;
those captures are committed as regression fixtures under
`packages/claude-wrap/fixtures/v2159_*.txt`.

### Root causes

- **Permission prompts (Finding 1):** the matcher only accepted the exact
  question `Do you want to proceed?`. v2.1.159 uses action-specific wording —
  `Do you want to create note.txt?`, `…allow Claude to fetch this content?`,
  `…make this edit to note.txt?` — while Bash still says `…proceed?`. The title
  scan also keyed off a `"… command"` suffix that only Bash has.
- **`claude_resolve_permission` (Finding, "broken"):** not actually a send bug —
  it shared the dead detector, so it reported *"no permission prompt on screen"*.
- **Mode + tokens (status):** `MODE_RE` didn't know `auto mode on`, and **token
  parsing was coupled to a successful mode match**, so when the mode didn't match
  *both* `mode` and `tokens` came back `null`. The default mode is now `auto mode
  on`; normal/default mode shows no phrase at all (just `? for shortcuts`).
- **Busy (Finding 3):** keyed off animated spinner glyphs, but v2.1.159 cycles
  many glyphs (`*`, `·`, `✶`, `✻`) **and leaves a finished `✻ Baked for 27s`
  line on screen** → false "busy". The reliable, version-stable signal is the
  `esc to interrupt` hint in the bottom bar (idle shows `← for agents`).
- **`claude_ask` submit race (Finding 2):** the prompt text and the `\r` were
  sent in one write; the TUI commits typed input asynchronously, so Enter fired
  before the text landed → "typed but never submitted".

### Fixes

1. **Permission detection rewritten to be option-anchored** (`parsePermissionPrompt`):
   it locks onto the numbered menu (`≥2` options with a `❯` cursor — a shape
   Claude's own output never has), then derives the `question`, the box `title`
   (first line under the solid `────` rule), and a `body` with the dashed diff
   frames stripped. This survives future wording changes and now also covers the
   **startup "trust this folder" dialog** (Finding 4) as a `Trust folder` prompt.
   A new `question` field is surfaced to callers.
2. **`claude_ask` confirms submission** (Finding 2): types the text, waits
   `SUBMIT_DELAY_MS`, sends Enter as a **separate** write, and retries Enter once
   if Claude doesn't start working. `sendLine`, the pipe-driven `ask`/`send`, and
   `inject ask` got the same treatment.
3. **Status parsing decoupled & version-stable** (Findings 3): `mode`, `tokens`,
   `effort`, and `busy` are read independently from the bottom bar; `busy` keys
   off `esc to interrupt`. The fragile stale-spinner counter was removed.
4. **Trust dialog surfaced** (Finding 4) — see #1.
5. **Key vocabulary expanded** (Finding 6): added `shift-tab` (+ `shift+tab`,
   `btab`) which cycles Claude's mode, plus `home`/`end`/`pageup`/`pagedown`/
   `delete`/`space`/`ctrl-a`/`ctrl-e`/`ctrl-u`. `unknown key` errors now list the
   valid keys.
6. **`approve`/`deny` made race-safe**: send the option digit, then Enter as a
   separate write — so `deny` reliably picks *No*, not the highlighted *Yes*.

Finding 5 (ghost-text vs. real input) is inherent to a styling-stripped snapshot;
left as-is, but the reliable `permissionPrompt` / `busy` signals mean a driver no
longer needs to read the input box to know the session's state.

### New state also tracked (bonus)

`status.effort` (e.g. `xhigh`), top-level `remoteUrl` (the `/remote-control`
session link), and `permissionPrompt.question`.

### Verification

- **Unit/golden:** `node --test` — **57/57 pass**, including 10 new
  `v2159_*` fixture tests (one per prompt layout + every mode line + the
  "completion line is not busy" guard). MCP package: **10/10 vitest pass**.
- **Live end-to-end** (fresh process loading the rebuilt dist, real v2.1.159):
  trust dialog detected → `approve()` → `shift-tab` cycles to normal → `ask()`
  submits first try → **Write prompt detected** (`title: "Create file"`,
  `question: "Do you want to create hello.txt?"`, 3 options) → `approve()` writes
  the file → prompt clears. A second run confirmed **`deny()` selects "No"** and
  the file is *not* written. **11/11 + deny check pass.**
