# CLAUDE.md

Guidance for working in this repository.

## Project

**Shannon** is a zero-dependency TypeScript reimplementation of `claude-code-profiles`, extended with Codex CLI support. It manages isolated Claude Code profiles via `CLAUDE_CONFIG_DIR` and Codex profiles via `CODEX_HOME`. Each profile is a complete, isolated config directory (settings, credentials, MCP servers, history).

Published as **`@cbnsndwch/shannon`**. Installs three interchangeable Claude commands — `shannon`, `claudep`, `clp` — plus `gpt` for Codex CLI and ChatGPT subscriptions.

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
- `src/gpt.ts` — Codex entry; `await dispatch(argv, CODEX)`.
- `src/core/provider.ts` — provider metadata: command, binary, config env, storage, secrets, directory marker, and auto-selection state. Existing APIs default to `CLAUDE`; pass `CODEX` explicitly for Codex profiles. SEA binaries select Codex when invoked as `gpt`/`gpt.exe`.
- `src/core/shell.ts` — shared shell snippet generator. Provider-specific wrappers/hooks coexist; PowerShell shares a single saved original prompt.
- `src/core/accounts.ts` — per-profile Codex login slots in `.gpt-accounts`, active-login metadata, refreshed-token synchronization, journaled account switching, staged logins, and a profile lock. Call mutations while holding `withAccountLock`. Existing profiles without login slots retain their launch behavior. Once enabled, wrapper-launched Codex sessions hold the same lock for their full lifetime and use `--no-daemon`.
- `src/commands.ts` — dispatch (known subcommand → manage; bare / `run` / `--` / unknown token → launch) plus handlers and help text.
- `src/launch.ts` — provider-aware PATH/PATHEXT lookup and launch; legacy `findClaude`/`launchClaude` helpers remain available. Native executables receive an argv array; Windows batch shims escape both command parsing passes. Codex launches with a selected home add `-c "cli_auth_credentials_store='file'"` so credentials are stored inside the profile.
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

Codex uses the same layout under `codex-profiles` instead of `claude-profiles`, with an independent `.default`. Its session override is `CODEX_HOME`, project marker is `.gpt`, and hook state is `GPT_AUTO`. Clones omit `auth.json` unless `--with-credentials` is passed. No existing user login is imported or changed.

`gpt account` manages named logins independently of profile context: `save <name>`, `login <name> [--device-auth]`, `list`, `use <name> [--resume]`, `next [--resume]`, and `unlock --yes`. Sign-in is staged in a temporary home; commit only a successful file-based login. `use`/`next` switch only `auth.json`, preserving settings and transcripts. `--resume` performs the switch and launches `codex resume --last` under one lock. Switching requires closing the running CLI session. The lock never recovers itself automatically; explicit unlock refuses a live owner. Clones omit `.gpt-accounts` unless credentials are requested, and always omit `.gpt-lock`. Account commands require an existing managed profile; an arbitrary or nested `CODEX_HOME` is not a managed profile.

Profile names must match `[A-Za-z0-9_-]+` (reject empty, leading `.`, `..`, `/`, `\`). The name read from `.default` is re-validated before use (defense in depth).

## Command interface

`create <name> [--from <src>] [--with-credentials]`, `list`/`ls`, `default [name]`, `which [name]`, `use <name>`, `clone <src> <dst> [--with-credentials]`, `delete`/`rm <name> [--yes]`, `status`/`st`, `setup [shell]` (interactive integration installer — adds one `init` line to the shell startup file, or shows it), `init <shell>` (raw emit, eval target), `update`/`upgrade`, `help`, `--version`/`-v`/`-V`. Bare `shannon` (no args) prints profile status and never launches `claude` implicitly. `shannon run …`, `shannon -- …`, or any non-subcommand token launches `claude` with the active profile. `create --from <src>` copies an existing profile (same shared copy routine as `clone`); both omit `.credentials.json` unless `--with-credentials` is passed.

## Design constraints (do not violate)

1. **pnpm-native**, never npm.
2. **Zero / near-zero runtime deps** — if you reach for a dependency, stop and reconsider.
3. **Launcher launches; never shadow `claude`.**
4. Keep **"Claude" out of the package name/branding**; keep the "not affiliated with Anthropic" disclaimer.
5. **Storage stays byte-compatible** with the shell tool.
6. **Distribution**: publish to npm (`pnpm publish`) **and** ship prebuilt single-file binaries via GitHub Releases.
7. **No analytics / SEO cruft / telemetry.** The lone sanctioned network call is the npm-registry update check (`src/core/updates.ts`): a single GET for the `latest` version, no identifying data, cached ≤24h, opt-out via `SHANNON_NO_UPDATE_CHECK`/`NO_UPDATE_NOTIFIER`/`CI`, and never on the launch hot path. Anything beyond that is out of bounds.

## Roadmap

- **M1 (done)** — profile management, launcher, clone, tests.
- **M2 (done)** — `shannon init <bash|zsh|fish|pwsh>`: a shell-function overlay that `eval`s the CLI's `use --emit <shell>` line to mutate the live shell, plus a `cd`/prompt hook that runs the internal `__auto` command to apply a per-directory `.shannon` file. Verified live on bash and PowerShell.
- **M3 (done)** — `create <name> --from <src> [--with-credentials]`: create a profile by copying an existing one, sharing the single `copyProfile` routine behind `clone` (credentials omitted unless `--with-credentials`).
- **M4 (done)** — release CI: `.github/workflows/ci.yml` (build+test matrix) and `release.yml` (tag-triggered). On a `v*` tag it verifies the tag matches `package.json`, builds Node SEA single-file binaries for linux/macOS/Windows (esbuild bundles `build/sea-entry.ts` → CJS, `postject` injects the blob) uploaded to a GitHub Release via the `gh` CLI, then publishes to npm with provenance (`pnpm publish --provenance`, `id-token: write`, `NPM_TOKEN`). Every action is pinned by commit SHA; pnpm comes from corepack; build-only devDeps (`esbuild`, `postject`) are exact-pinned and runtime deps stay zero. See `RELEASING.md`.
- **M5 (done)** — docs polish (no analytics): self-contained README with a quickstart, a complete command reference matching the CLI help, shell-integration / per-directory `.shannon` docs, an environment-variable note, a troubleshooting/FAQ, and a short `CONTRIBUTING.md` + `SECURITY.md`. No analytics, tracking, or SEO cruft.
- **M7 (done)** — UX polish: banner gains a title/version/attribution footer; TTY-gated ANSI colour (`src/core/style.ts`, honoring `NO_COLOR`/`FORCE_COLOR`, never emitted to captured/eval'd output); and an interactive `setup [shell]` command (`src/core/integration.ts` for the pure bits) that adds a single `shannon init` line to the shell startup file for the user — or prints just that line to paste — instead of dumping the full snippet. `init` stays the raw eval target when piped, but is syntax-highlighted and padded when printed to a TTY (`src/core/highlight.ts`, a cosmetic additive-only scanner — stripping the colour restores the source byte for byte, guarded by a test).
- **M6 (done)** — branding + self-update: a low-entropy dot-halftone portrait banner (`src/banner.ts`) on `status`/`help` with terminal Unicode detection and an ASCII fallback (`SHANNON_BANNER` to force); a passive update check (`src/core/updates.ts`) that refreshes a ≤24h npm-registry cache in a detached background process and appends a one-line CTA to ordinary commands, plus an explicit `update`/`upgrade` command. Opt-out and zero-dep (built-in `fetch`); no runtime dependency added.

## When modifying

- Keep runtime deps at zero; run `pnpm test` before considering a change done.
- Any behavioral change → update `README.md`.
- `init` shell code must stay consistent across bash / zsh / fish / PowerShell.
- Respect owner edits to `README.md`, `.gitignore`, `package.json`, and the `.md` license/notice filenames.
- Commit messages: conventional and factual; no attribution or co-author trailers.
- Windows batch launch and combined PowerShell integration are covered by `test/gpt.test.ts` using isolated fake CLIs; real account login remains an interactive user step.
