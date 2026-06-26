# CLAUDE.md

Guidance for working in this repository.

## Project

**Shannon** is a zero-dependency TypeScript reimplementation of `claude-code-profiles`. It manages multiple isolated Claude Code configuration profiles by resolving the `CLAUDE_CONFIG_DIR` environment variable that the `claude` CLI honors. Each profile is a complete, isolated config directory (settings, credentials, MCP servers, history).

Published as **`@cbnsndwch/shannon`**. Installs three interchangeable commands — `shannon`, `claudep`, `clp` — all the same CLI.

Shannon is an independent project, **not affiliated with or endorsed by Anthropic**; the name is a nod to Claude Shannon. It interoperates only through the public `CLAUDE_CONFIG_DIR` variable. Keep "Claude" out of the package name and branding; nominative references that merely describe interop are fine. See `NOTICE.md`.

## Origin & motivation

A from-scratch rewrite of the shell-based `claude-code-profiles` (upstream `github.com/quinnjr/claude-code-profiles`, formerly under `pegasusheavy`). The point is to **own and control the tooling**: the upstream changed ownership/namespaces and ships a `curl | sh` installer riding a revocable GitHub redirect (a repo-jacking vector). Core values: zero/minimal dependencies, pinned versions, nothing fetched-and-executed, no telemetry. A read-only reference copy of the original shell implementations is at `D:\GIT_REPOS\AI\claude-code-profiles`.

## Toolchain & commands

**pnpm-native** (never npm). The pnpm version is pinned via the `packageManager` field.

- `pnpm install` — install devDeps (`typescript`, `@types/node` only)
- `pnpm build` — `tsc` → `dist/`
- `pnpm test` — build, then run the `node:test` suite
- `pnpm test:src` — run tests directly from TypeScript (Node 22.6+)
- `node dist/src/cli.js <args>` — run the built CLI

## Architecture

The binary does everything (management + launching) and **never shadows the real `claude`**. Shell integration (M2) only adds the parts a child process physically cannot do: session `use` and per-directory auto-select.

- `src/core/autodir.ts` — `findMarker` (walk up for a `.shannon` file) + `resolveAuto` (decide set/unset/none against the `SHANNON_AUTO` marker env var). Used by the internal `__auto` command the shell hooks call on each directory change.

- `src/cli.ts` — entry (`#!/usr/bin/env node`); `await dispatch(argv)`.
- `src/commands.ts` — dispatch (known subcommand → manage; bare / `run` / `--` / unknown token → launch) plus handlers and help text.
- `src/launch.ts` — `findClaude()` (PATH/PATHEXT scan) + `launchClaude()` (spawns the real claude with the resolved `CLAUDE_CONFIG_DIR`).
- `src/core/paths.ts` — platform data dir + `.default` + profile dir.
- `src/core/validate.ts` — profile-name rules.
- `src/core/profiles.ts` — create/list/delete/default/clone + `resolveActive` (an explicit `CLAUDE_CONFIG_DIR` wins over the default profile).
- `src/core/errors.ts` — `ShannonError` (expected, user-facing failures; printed as `shannon: <msg>`, exit 1, no stack).
- `test/*.test.ts` — unit tests.

Build uses `rootDir: "."`, so bins resolve to `dist/src/cli.js`. Published `files`: `dist/src`, `LICENSE.md`, `NOTICE.md`, `README.md`.

## Storage & validation

Byte-compatible with the original shell tool, so existing profiles work with zero migration:

- Windows: `%LOCALAPPDATA%\claude-profiles\`
- otherwise: `$XDG_DATA_HOME/claude-profiles/` (default `~/.local/share/claude-profiles/`)
- `.default` — plain text, the default profile name, **no trailing newline**

Profile names must match `[A-Za-z0-9_-]+` (reject empty, leading `.`, `..`, `/`, `\`). The name read from `.default` is re-validated before use (defense in depth).

## Command interface

`create <name> [--from <src>] [--with-credentials]`, `list`/`ls`, `default [name]`, `which [name]`, `use <name>`, `clone <src> <dst> [--with-credentials]`, `delete`/`rm <name> [--yes]`, `status`/`st`, `init <shell>`, `help`, `--version`. Bare `shannon`, `shannon run …`, `shannon -- …`, or any non-subcommand token launches `claude` with the active profile. `create --from <src>` copies an existing profile (same shared copy routine as `clone`); both omit `.credentials.json` unless `--with-credentials` is passed.

## Design constraints (do not violate)

1. **pnpm-native**, never npm.
2. **Zero / near-zero runtime deps** — if you reach for a dependency, stop and reconsider.
3. **Launcher launches; never shadow `claude`.**
4. Keep **"Claude" out of the package name/branding**; keep the "not affiliated with Anthropic" disclaimer.
5. **Storage stays byte-compatible** with the shell tool.
6. **Distribution**: publish to npm (`pnpm publish`) **and** ship prebuilt single-file binaries via GitHub Releases.
7. **No analytics / SEO cruft.**

## Roadmap

- **M1 (done)** — profile management, launcher, clone, tests.
- **M2 (done)** — `shannon init <bash|zsh|fish|pwsh>`: a shell-function overlay that `eval`s the CLI's `use --emit <shell>` line to mutate the live shell, plus a `cd`/prompt hook that runs the internal `__auto` command to apply a per-directory `.shannon` file. Verified live on bash and PowerShell.
- **M3 (done)** — `create <name> --from <src> [--with-credentials]`: create a profile by copying an existing one, sharing the single `copyProfile` routine behind `clone` (credentials omitted unless `--with-credentials`).
- **M4** — release CI (publish + binaries; pin GitHub Actions by commit SHA).
- **M5** — docs polish (no analytics).

## When modifying

- Keep runtime deps at zero; run `pnpm test` before considering a change done.
- Any behavioral change → update `README.md`.
- `init` shell code must stay consistent across bash / zsh / fish / PowerShell.
- Respect owner edits to `README.md`, `.gitignore`, `package.json`, and the `.md` license/notice filenames.
- Commit messages: conventional and factual; no attribution or co-author trailers.
- The Windows launch→spawn path in `src/launch.ts` is written but not yet verified against a real `claude`.
