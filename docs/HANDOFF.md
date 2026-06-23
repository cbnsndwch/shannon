# Shannon — Session Handoff

_Point-in-time handoff (2026-06-23). The always-current project guide is [`../CLAUDE.md`](../CLAUDE.md); this doc is the narrative onboarding / continuation prompt. It is self-contained — prior-session memory is scoped to a different directory and won't auto-load here. You can paste the body below as the first message of a fresh session._

---

I'm picking up an in-progress project, **Shannon**, in this directory. Read this, ensure `CLAUDE.md` exists and is accurate, then confirm the build/tests are green before doing anything else.

## What Shannon is
A from-scratch **TypeScript reimplementation** of `claude-code-profiles` — a tool that manages multiple isolated Claude Code configuration profiles via the `CLAUDE_CONFIG_DIR` environment variable. Published as **`@cbnsndwch/shannon`**; the binary is **`shannon`**, with **`claudep`** and **`clp`** as additional `bin` aliases (all three are the same CLI). The name is a nod to *Claude Shannon* — chosen to keep "Claude" out of the package name for trademark hygiene. Not affiliated with Anthropic; it only interoperates via `CLAUDE_CONFIG_DIR`.

## Where this comes from (motivation)
The original `claude-code-profiles` (upstream `github.com/quinnjr/claude-code-profiles`, formerly the `pegasusheavy` org) is a shell tool. It changed ownership/namespaces, and its `curl | sh` installer still points at the old `pegasusheavy` namespace via a **revocable GitHub redirect** — a latent repo-jacking vector. The owner is **supply-chain-conscious and wants to own/control his tooling**, so we're rebuilding it clean. Guiding values: **zero/minimal dependencies, pinned versions, nothing fetched-and-executed, no telemetry**. A read-only copy of the original shell implementations (for behavior-parity reference) is at `D:\GIT_REPOS\AI\claude-code-profiles`.

## What's implemented — M1 (in the repo, tested, working)
- **Commands**: `create`, `list`/`ls`, `default`, `which`, `use`, `clone`, `delete`/`rm`, `status`/`st`, `init` (stub), `help`, `--version`, `run`.
- **Launcher (no shadowing of `claude`)**: bare `shannon`, `shannon run …`, `shannon -- …`, or any non-subcommand token → spawns the real `claude` (found on PATH) with the resolved `CLAUDE_CONFIG_DIR`, passing args through. We deliberately do **not** define a `claude` wrapper.
- **`clone <src> <dst>`** copies a profile but **omits `.credentials.json`** unless `--with-credentials`.
- **Validation**: names must match `[A-Za-z0-9_-]+` (reject empty, leading `.`, `..`, `/`, `\`); re-validated when read from `.default`.
- **Storage is byte-compatible** with the shell tool: `%LOCALAPPDATA%\claude-profiles\` (Windows) or `$XDG_DATA_HOME/claude-profiles/` (else), with a no-trailing-newline `.default` file. Existing profiles work with zero migration.
- **Zero runtime deps**; devDeps are only `typescript` + `@types/node`. **7/7 tests pass** (`node:test`).
- **pnpm-native**: `pnpm-lock.yaml`, pnpm pinned via `packageManager`. Use pnpm, never npm.

## Architecture map
- `src/cli.ts` — entry; `await dispatch(argv)`.
- `src/commands.ts` — dispatch (known subcommand → manage; else → launch) + handlers + help.
- `src/launch.ts` — `findClaude()` (PATH/PATHEXT) + `launchClaude()` (spawns real claude).
- `src/core/paths.ts` — data dir + `.default` + profile dir.
- `src/core/validate.ts` — name rules.
- `src/core/profiles.ts` — create/list/delete/default/clone + `resolveActive` (explicit `CLAUDE_CONFIG_DIR` wins).
- `src/core/errors.ts` — `ShannonError`.
- `test/*.test.ts` — validate / paths / profiles.
- Build: `tsc` → `dist/` (`rootDir: "."`, so bins resolve to `dist/src/cli.js`).

## Locked decisions — do not re-litigate or violate
1. **pnpm-native**, never npm.
2. **Zero/near-zero runtime deps.**
3. **Launcher launches; never shadow `claude`.**
4. Keep **"Claude" out of the package name/branding**; keep the not-affiliated disclaimer.
5. **Storage stays byte-compatible** with the shell tool.
6. **Distribution**: npm (`pnpm publish`) **and** prebuilt single-file binaries via GitHub Releases.
7. **No analytics / SEO cruft.**

## What's next
- **M2 — shell integration (`shannon init <bash|zsh|fish|pwsh>`)**: emit a snippet the user `eval`s in their rc. It defines a `shannon`/`claudep`/`clp` shell function that forwards to the binary but special-cases `use` by `eval`-ing the binary's `--emit <shell>` export line so it mutates the *live* shell (the plumbing already exists — see `cmdUse` + `exportLine` in `src/commands.ts`). Also install a `cd`/prompt hook that reads a per-directory **`.shannon`** file (a profile name) and auto-selects it. Replace the current `init` stub.
- **M3** — clone/template polish (`create --from <src>`; basic clone already works).
- **M4** — release CI (GitHub Actions: `pnpm publish` + build/attach binaries; pin actions by commit SHA).
- **M5** — docs polish (README is already solid; no analytics).

## Conventions & gotchas
- **Respect owner edits** to `README.md`, `.gitignore` (intentionally ignores `.local`), `package.json` (pnpm version pin), and the `.md` license/notice filenames. Don't revert them.
- The Windows **launch→spawn path is not yet verified against a real `claude`** (it would start an interactive session). Verify it live at some point.
- Build/test/run: `pnpm install`, `pnpm test`, `pnpm build`, and try it read-only with `node dist\src\cli.js list`.
- **Commit messages**: conventional, factual, no co-author/attribution trailers.

## Current status
- M1 staged on branch `main` — verify with `git log --oneline` and `git status` (may not be committed yet).
- Build/test green: `pnpm test` → 7/7.
