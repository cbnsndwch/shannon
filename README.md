# Shannon

Manage isolated [Claude Code](https://claude.com/product/claude-code) and [Codex CLI](https://learn.chatgpt.com/docs/cli) configuration profiles — switch between work and personal accounts, different MCP setups, or separate settings without logging in and out. A zero-dependency TypeScript re-implementation of `claude-code-profiles`, extended with `gpt` for your ChatGPT subscriptions through Codex CLI.

> Shannon is an independent project, **not affiliated with or endorsed by Anthropic or OpenAI**. The name is a nod to Claude Shannon. It interoperates with Claude Code via `CLAUDE_CONFIG_DIR` and Codex CLI via `CODEX_HOME`.

## Contents

- [Why Shannon](#why-shannon)
- [Install](#install)
- [Quickstart](#quickstart)
- [ChatGPT subscriptions with gpt](#chatgpt-subscriptions-with-gpt)
- [Claude desktop app per profile with clpd (macOS)](#claude-desktop-app-per-profile-with-clpd-macos)
- [Commands](#commands)
- [Shell integration](#shell-integration)
- [Environment](#environment)
- [Profiles](#profiles)
- [Troubleshooting](#troubleshooting)
- [Features](#features)
- [Contributing](#contributing)
- [License](#license)

## Why Shannon

Each Claude Code profile is a complete, isolated config directory — its own settings, credentials, MCP servers, and history. Shannon creates them, switches between them, and launches Claude Code pointed at the right one. It does this by setting `CLAUDE_CONFIG_DIR`; it never wraps or shadows the real `claude` binary.

It is built to be boring on purpose:

- **Zero runtime dependencies** — nothing to audit at install time but the package itself.
- **Nothing fetched-and-executed** — no `curl | sh` installer, no post-install scripts.
- **Pinned, integrity-checked tooling** — the build pipeline pins every GitHub Action by commit SHA and provisions pnpm via corepack from a hashed `packageManager` field.
- **No telemetry** — Shannon phones nobody home.
- **Authenticated distribution** — the npm package is published with [provenance](https://docs.npmjs.com/generating-provenance-statements).

See [`RELEASING.md`](./RELEASING.md#supply-chain-notes) for the full supply-chain notes, and [`SECURITY.md`](./SECURITY.md) to report a vulnerability.

## Install

```sh
pnpm add -g @cbnsndwch/shannon
# or: npm i -g @cbnsndwch/shannon
```

This installs three interchangeable Claude Code commands — `shannon`, `claudep`, and `clp` — plus `gpt` for Codex CLI and `clpd` for the Claude desktop app on macOS. Requires Node 22 or newer. (pnpm is only required to *develop* Shannon; you can install the published package with any client.) Install the real `claude` and/or `codex` CLI separately.

To uninstall: `pnpm rm -g @cbnsndwch/shannon` (or `npm rm -g @cbnsndwch/shannon`).

### Prebuilt binaries

Each release also ships standalone single-file binaries for Linux, macOS, and Windows on the [Releases page](https://github.com/cbnsndwch/shannon/releases). They embed their own Node runtime, so they work without a system Node — handy on machines where you don't want to install one. Download the asset for your platform, check it against the `.sha256` sidecar, then put it on your `PATH`:

```sh
# example: Linux x64
curl -fLO https://github.com/cbnsndwch/shannon/releases/latest/download/shannon-linux-x64
curl -fLO https://github.com/cbnsndwch/shannon/releases/latest/download/shannon-linux-x64.sha256
sha256sum -c shannon-linux-x64.sha256
chmod +x shannon-linux-x64
mv shannon-linux-x64 ~/.local/bin/shannon
```

Available targets: `shannon-linux-x64`, `shannon-linux-arm64`, `shannon-macos-x64`, `shannon-macos-arm64`, `shannon-win-x64.exe`. The binary behaves identically under any of the `shannon` / `claudep` / `clp` names — copy or symlink it to whichever you want. Copy or symlink it as `gpt` (`gpt.exe` on Windows) to manage Codex profiles instead, or as `clpd` (macOS) for the [desktop launcher](#claude-desktop-app-per-profile-with-clpd-macos).

- **macOS:** the binaries are ad-hoc-signed and not notarized. Clear quarantine before first run with `xattr -d com.apple.quarantine ./shannon-macos-arm64`, or right-click → Open.
- **Windows:** the binary is unsigned, so SmartScreen may warn until it builds reputation; it still runs.

The `.sha256` sidecar lives in the same release as the binary, so it only confirms the download arrived intact — it is **not** an authenticity guarantee against a tampered release, and the binaries are unsigned (Windows) / ad-hoc-signed and not notarized (macOS). For an authenticated, tamper-evident channel prefer the npm package, which is published with [provenance](https://docs.npmjs.com/generating-provenance-statements). npm is the canonical channel; the binaries are a convenience for Node-less installs. See [`RELEASING.md`](./RELEASING.md) for how releases are built.

## Quickstart

```sh
pnpm add -g @cbnsndwch/shannon     # 1. install
shannon create work                # 2. create a profile and...
shannon default work               #    make it the default
shannon run                        # 3. launch Claude Code with that profile
```

That covers a single default profile. To switch profiles per-session with `shannon use` and to auto-select a profile when you `cd` into a project, set up [shell integration](#shell-integration) once — it is the recommended one-time setup.

## ChatGPT subscriptions with gpt

`gpt` provides the same profile commands for Codex CLI. Each profile has its own ChatGPT login, settings, MCP configuration, and history. It launches the real `codex` executable with `CODEX_HOME` set to the selected profile. It manages terminal sessions; ChatGPT browser and desktop sessions keep their own accounts.

Set up shell integration once with `gpt setup` (or `gpt setup pwsh` on PowerShell), then restart your shell. Sign in to each subscription once:

```sh
gpt create personal
gpt create work
gpt default personal
gpt use personal
gpt run login             # sign in with your personal ChatGPT account
gpt use work
gpt run login             # sign in with your work ChatGPT account
gpt run                   # launch Codex using work
gpt use personal
gpt run                   # launch Codex using personal
```

Choose **Sign in with ChatGPT** in each login flow to use that account's subscription. If the browser is already signed into another account, switch to the intended account before completing login. `gpt run login --device-auth` is also passed through to Codex. See [OpenAI's authentication documentation](https://learn.chatgpt.com/docs/auth).

As with Shannon, bare `gpt` prints status. `gpt run …`, `gpt -- …`, and unrecognized subcommands such as `gpt login` pass arguments to Codex. All management commands below work with `gpt` in place of `shannon`, including `create --from`, `clone`, `delete`, `default`, `which`, `list`, `status`, `setup`, and `init`.

| | Claude Code | Codex CLI |
| --- | --- | --- |
| Commands | `shannon`, `claudep`, `clp` | `gpt` |
| Profile environment | `CLAUDE_CONFIG_DIR` | `CODEX_HOME` |
| Storage folder | `claude-profiles` | `codex-profiles` |
| Directory marker | `.shannon` | `.gpt` |
| Auto-selection state | `SHANNON_AUTO` | `GPT_AUTO` |
| Credentials omitted when copying | `.credentials.json` | `auth.json` |

Codex profiles live under `%LOCALAPPDATA%\codex-profiles\` on Windows, or `$XDG_DATA_HOME/codex-profiles/` on Linux/macOS (default `~/.local/share/codex-profiles/`). They have their own `.default` marker and remain separate from Claude profiles and the usual `~/.codex` directory. An explicit `CODEX_HOME` overrides the saved default, just as `CLAUDE_CONFIG_DIR` does for Claude. With no selected or default profile, Codex uses its normal configuration.

When a Codex home is selected, `gpt` supplies `-c "cli_auth_credentials_store='file'"` so the login is stored in that home's `auth.json`. This gives `clone` and `delete` predictable credential handling. `clone` and `create --from` omit `auth.json` and all saved login slots unless `--with-credentials` is given. Codex still honors admin-enforced authentication requirements.

For directory auto-selection, put a Codex profile name in `.gpt`. Both integrations can be loaded in the same shell; `.shannon` and `.gpt` independently select their respective profiles. To add the Codex integration by hand:

```sh
# bash — ~/.bashrc
eval "$(gpt init bash)"
# zsh — ~/.zshrc
eval "$(gpt init zsh)"
# fish — ~/.config/fish/config.fish
gpt init fish | source
# PowerShell — $PROFILE
gpt init pwsh | Out-String | Invoke-Expression
```

### Multiple logins in one profile

A profile holds your client context: history, saved conversations, settings, and MCP configuration. Named logins within that profile let you choose which subscription to use while keeping that context in place.

For a profile where you have already signed in, save that login under a name, then sign in to the second account:

```sh
gpt use client-a
gpt account save primary
gpt account login secondary       # complete the second ChatGPT login
gpt account list                  # primary remains selected
```

For a fresh profile, start with `gpt account login primary` instead of `account save`. Each `account login` uses a temporary login home; failed or cancelled sign-ins leave the current profile login in place. Repeating `account login <name>` renews that named login. Add `--device-auth` to use Codex's device login flow.

After exiting the current Codex session, switch accounts and continue the saved conversation:

```sh
gpt account use secondary --resume
# Exit Codex when you want to change accounts again:
gpt account next --resume
```

`--resume` launches `codex resume --last` in the same profile and current directory. For a specific saved conversation, use `gpt account use secondary`, then `gpt run resume <session-id>`. Switching preserves the profile's configuration and local transcripts. Resuming still depends on Codex and the selected account's access to any workspace, provider, or cloud resources the conversation uses. See [Codex resume](https://learn.chatgpt.com/docs/developer-commands#codex-resume).

| Command | Effect |
| --- | --- |
| `gpt account list` (or bare `gpt account`) | List cached logins; `>` marks the selected login. |
| `gpt account save <name>` | Save the profile's existing login under a name. |
| `gpt account login <name> [--device-auth]` | Add or renew a login. The first login is selected automatically. |
| `gpt account use <name> [--resume]` | Select a saved login, optionally continuing the last conversation. |
| `gpt account next [--resume]` | Cycle through cached, signed-in slots by name. |
| `gpt account unlock --yes` | Recover a crashed launcher's lock after closing every Codex process using the profile. Refuses to clear a live launcher's lock. |

Saved credentials live in the profile's private `.gpt-accounts/<name>/auth.json` files. Switching saves any refreshed tokens before selecting the other login. A logout through `gpt` also clears that login's saved credentials; the other named logins remain available. Expired credentials are handled by Codex when the account is next used.

Close existing Codex sessions before enabling named logins. Once enabled, a profile lock permits one `gpt`-launched Codex process at a time and prevents switching, cloning, or deleting the profile while that process runs. Named-login launches use `--no-daemon` so a shared background server cannot retain the previous account. Use a Codex CLI version that supports this flag. These locks coordinate `gpt`; close any processes using the same home through the real `codex` command before switching. Switching is explicit; `next` cycles once when invoked.

`gpt clone` and `gpt create --from` omit the entire login store by default. `--with-credentials` copies every saved login as well as the current one; use fresh sign-ins for independently refreshed credentials in different profiles. Runtime lock files are never copied.

## Claude desktop app per profile with clpd (macOS)

`clpd` runs the Claude desktop app once per Shannon profile, side by side with the normal app. Each instance gets:

- the profile's `CLAUDE_CONFIG_DIR`, so Code sessions started from the app use that profile's settings, MCP servers, plugins and history instead of `~/.claude`;
- its own app data folder (`~/Library/Application Support/Claude Profiles/<profile>`), so it has its own claude.ai login and window state;
- its own name and a badged icon (`Claude ING`, `Claude CBN`, …) in the Dock and Cmd-Tab.

```sh
shannon create ING                       # Shannon profiles, as usual
clpd app ING --color '#176047'           # build the ING app with a green badge
clpd app CBN --color '#fbbf24'           # and CBN with a yellow one
clpd ING                                 # open it (or bring it to the front)
```

Then drag `~/Applications/Claude ING.app` into the Dock. Pin that launcher, not the running instance's tile: the running tile would reopen the app without the profile's settings.

| Command | What it does |
| --- | --- |
| `clpd [run] [profile] [--dry-run] [-- app args…]` | Open the profile's instance (the default profile when omitted), or bring it to the front if it is already running. Builds the instance on first use and rebuilds it after a Claude update. `--dry-run` prints what would run. |
| `clpd app <profile> [--color #rrggbb] [--no-icon]` | Build or rebuild the profile's instance and its `~/Applications/Claude <profile>.app` launcher. The badge text is white or near-black depending on the colour; the colour is kept on later rebuilds (default `#d97757`). `--no-icon` keeps the stock icon. |
| `clpd app-remove <profile>` (`unapp`) | Delete that launcher and instance. The profile and its app data stay. |
| `clpd quit <profile>` | Quit the instance running a profile. |
| `clpd status` (`st`) | List running instances with their profile and `CLAUDE_CONFIG_DIR`, and the built apps. |

**How it works.** The instance is a hidden bundle under `~/Library/Application Support/shannon-desktop/instances/`. Every executable in it is a hard link to the file in `/Applications/Claude.app` (other files are hard links or APFS clones, so it takes no extra disk space), which keeps the signed binary that Gatekeeper and the Keychain already trust. Only the name (through localized `InfoPlist.strings`) and the icon are changed; the icon is drawn by a small Swift program compiled once with `swiftc` from the Xcode Command Line Tools (without them the instance keeps the stock icon). `clpd` opens the instance through LaunchServices as a new instance with `--user-data-dir` and `CLAUDE_CONFIG_DIR` set. The launcher in `~/Applications` is a small ad-hoc-signed app that runs `clpd run <profile>` and shows an alert if that fails.

**App Management permission.** Building an instance links files out of `Claude.app`, which macOS only allows to apps with the App Management permission. Before the first `clpd app` (or first launch), open *System Settings → Privacy & Security → App Management* and turn it on for the app you run `clpd` from (Terminal, iTerm, Ghostty, your editor…). Without it the build stops with an error saying so. Opening an already-built instance needs no permission.

Overrides: `SHANNON_DESKTOP_APP` (a Claude.app elsewhere), `SHANNON_DESKTOP_DATA_DIR`, `SHANNON_DESKTOP_INSTANCES_DIR`, `SHANNON_DESKTOP_APPS_DIR`. `clpd` is macOS-only for now; on other systems it exits with a "not supported on this platform yet" error.

## Commands

Run `shannon help` for the same reference in your terminal. Aliases are shown in parentheses.

### Launch

A bare `shannon` (or `claudep` / `clp`) prints profile status — it never launches `claude` implicitly. Launching is always explicit:

| Form | What it does |
| --- | --- |
| `shannon run [args…]` | Launch Claude Code with the active profile, passing the rest through to `claude`. |
| `shannon -- [args…]` | Same, ending Shannon's own argument parsing. |
| `shannon <args…>` | Any token that isn't a subcommand launches `claude` with the args passed through (`shannon --resume`, `shannon -p "…"`). |

> On PowerShell, use `shannon run …` rather than `shannon -- …`: PowerShell strips a bare `--` before Shannon sees it.

### Manage

| Command | What it does |
| --- | --- |
| `create <name> [--from <src> [--with-credentials]]` | Create a profile. `--from <src>` copies an existing profile (credentials omitted unless `--with-credentials`). |
| `list` (`ls`) | List profiles, marking the default and active ones. |
| `default [name]` | Print the default profile, or set it when `name` is given. |
| `which [name]` | Print a profile's config directory (the default profile if `name` is omitted). |
| `use <name>` | Activate a profile in the current shell. Requires [shell integration](#shell-integration); without it, the command prints the export line to run yourself. |
| `clone <src> <dst> [--with-credentials]` | Copy a profile. Credentials are omitted unless `--with-credentials`. |
| `delete <name> [--yes]` (`rm`) | Delete a profile and its data. `--yes` (aliases `-y`, `--force`) skips the confirmation prompt. |
| `status` (`st`) | Show the active and default profile. |
| `setup [shell]` | Install shell integration interactively — adds one line to your startup file for you, or shows it to paste (see below). |
| `init <bash\|zsh\|fish\|pwsh>` | Print the raw shell integration snippet for that shell (what `setup`'s one line re-generates at startup). |
| `update` (`upgrade`) | Check the npm registry for a newer release and print how to upgrade. |
| `help` (`-h`, `--help`) | Show the command reference. |
| `--version` | Print the version. |

`shannon list` prefixes each profile to show its state. The markers are:

```
>* default and active
 * default
>  active
   (neither)
```

`>` means active (the profile Claude Code would launch with right now) and `*` means default. There is exactly one default and at most one active profile, so each marker appears on at most one line in a real listing.

## Shell integration

The launcher already resolves the default profile, but two things need a shell function: making `use` switch the *live* shell, and auto-selecting a profile when you `cd` into a project.

The easiest way is to let Shannon set it up for you:

```sh
shannon setup        # detects your shell, offers to add one line to its startup file
```

`setup` is interactive: it either adds the line for you or prints just that line to paste — your call. To do it by hand, add the line for your shell to its startup file:

```sh
# bash — ~/.bashrc
eval "$(shannon init bash)"

# zsh — ~/.zshrc
eval "$(shannon init zsh)"

# fish — ~/.config/fish/config.fish
shannon init fish | source

# PowerShell — $PROFILE
shannon init pwsh | Out-String | Invoke-Expression
```

(`shannon init <shell>` prints the full integration that the one line above re-generates on each shell launch — you don't paste that yourself.)

This defines `shannon` / `claudep` / `clp` as thin wrappers around the binary. With it loaded:

```sh
shannon use personal   # switches CLAUDE_CONFIG_DIR in the current shell
```

### Per-directory auto-select

Drop a `.shannon` file containing a profile name into a project, and entering that directory (or any subdirectory) automatically selects the profile:

```sh
echo work > ~/projects/acme/.shannon
cd ~/projects/acme       # CLAUDE_CONFIG_DIR now points at the "work" profile
```

Leaving the directory reverts to the default profile. A manual `shannon use` overrides auto-select until you change directories. The nearest `.shannon` walking up from the current directory wins; an empty file means "no auto-selection here". A `.shannon` naming a missing or invalid profile is ignored.

## Environment

- **`CLAUDE_CONFIG_DIR`** — the variable Claude Code reads to find its config directory; setting it is how Shannon selects a profile. An explicit value in your environment **overrides the default profile** for that session, and that is what `status` and `list` report as *active*. `shannon use` (with shell integration) sets it for you.
- **`SHANNON_AUTO`** — internal state managed by the shell hooks to track which profile was auto-selected from a `.shannon` file. You don't set this yourself.
- **`SHANNON_BANNER`** — controls the portrait banner shown above `status` and `help` (only when stdout is a terminal — it's suppressed for pipes, scripts, and the shell-integration wrappers). By default Shannon auto-detects whether your terminal supports Unicode and falls back to an ASCII rendering otherwise; set `SHANNON_BANNER=ascii` or `SHANNON_BANNER=unicode` to force one.
- **`NO_COLOR` / `FORCE_COLOR`** — Shannon colorizes output only when stdout is a terminal; set `NO_COLOR` to force plain output or `FORCE_COLOR` to keep colors when piping. (Colors are never written to captured/eval'd output, so copied text and shell snippets stay clean regardless.)
- **`SHANNON_NO_UPDATE_CHECK`** — set to any value to disable the update check. Shannon otherwise checks the npm registry at most once a day (in a detached background process, never blocking a command) and appends a one-line notice when a newer release exists; the check sends no identifying data. `NO_UPDATE_NOTIFIER` and `CI` are also honored, and the notice is suppressed when output isn't a terminal.

## Profiles

Profiles are stored at `%LOCALAPPDATA%\claude-profiles\` (Windows) or `$XDG_DATA_HOME/claude-profiles/` (Linux/macOS, default `~/.local/share`) — the same layout as the original shell tool, so existing profiles are picked up automatically. Each profile directory is a complete Claude Code config directory.

Profile names may contain letters, digits, hyphens, and underscores.

## Troubleshooting

**`shannon: 'claude' binary not found in PATH. Is Claude Code installed?`**
Shannon launches the real `claude`; it doesn't bundle it. Install [Claude Code](https://claude.com/product/claude-code) and make sure `claude` is on your `PATH`.

**`shannon: command not found` right after a global install.**
Your package manager's global bin directory isn't on `PATH`. Find it with `pnpm bin -g` (or `npm bin -g`) and add it to your shell's `PATH`. With pnpm, `pnpm setup` configures this for you.

**`shannon use <name>` seems to do nothing.**
A child process can't change its parent shell's environment, so on its own `use` only prints the export line for you to run. To make it switch the live shell, run `shannon setup` once (see [shell integration](#shell-integration)). Until then, copy the printed `export …` / `$env:…` line.

**Migrating from `claude-code-profiles`.**
Shannon's storage is byte-compatible with the original shell tool (same directory layout, same `.default` file). Your existing profiles just work — there's no migration step. Install Shannon, run `shannon list`, and they'll be there.

**`clone` (or `create --from`) didn't copy my login.**
That's intentional: copies omit `.credentials.json` so you don't accidentally share credentials between profiles. Either sign in under the new profile, or re-run with `--with-credentials` to copy them.

**`clpd`: macOS says "Claude ING" is damaged and can't be opened.**
The instance's main executable must be a hard link to the one in `/Applications/Claude.app`; a copy is a new, unassessed file and Gatekeeper rejects the modified bundle. This happens when the build ran without the App Management permission or across volumes. Grant the permission (see [clpd](#claude-desktop-app-per-profile-with-clpd-macos)), keep your home folder on the same volume as `/Applications`, then rebuild with `clpd app <profile>`. If the dialog names the launcher in `~/Applications` instead, rebuild it the same way: `clpd` clears its quarantine flag and re-signs it.

**`clpd`: the Dock shows the plain Claude icon or the name "Claude".**
Rebuild with `clpd app <profile>` while the instance is not running (`clpd quit <profile>` first), then relaunch it. If the badge is missing, install the Xcode Command Line Tools (`xcode-select --install`) so `swiftc` can draw it. A tile pinned from the running instance shows that bundle as it was when pinned; pin `~/Applications/Claude <profile>.app` instead.

**`clpd`: clicking the launcher shows "Claude ING could not be opened".**
The alert shows the error `clpd` printed. Apps started from the Dock get a minimal `PATH`, so the launcher runs the exact `node` and `clpd` that built it, then falls back to `clpd` on a `PATH` extended with the usual node locations (fnm's default alias, Volta, Homebrew, `~/.local/bin`, pnpm's global bin). If you have since moved or upgraded Node, or removed the checkout `clpd` was built from, run `clpd app <profile>` again from a terminal to re-record it.

**`clpd`: clicking the launcher opens the normal Claude window.**
That happens when the instance is opened without LaunchServices' new-instance flag, for example by double-clicking the hidden instance bundle. Use the launcher or `clpd <profile>`.

## Features

- Create, list, clone, and delete isolated Claude Code config profiles.
- Set a default profile and launch Claude Code with it — Shannon never shadows the real `claude`.
- Per-session switching (`shannon use`) and per-directory auto-select via a `.shannon` file, through shell integration for bash, zsh, fish, and PowerShell.
- Copy-on-create (`clone`, `create --from <src>`), with credentials omitted by default.
- Storage byte-compatible with `claude-code-profiles`, so existing profiles work with no migration.
- `clpd` (macOS): the Claude desktop app once per profile, each with its own login, Code config, name and badged Dock icon.
- Distributed via npm (with provenance) and prebuilt single-file binaries on GitHub Releases.

## Contributing

Issues and pull requests are welcome — see the [issue tracker](https://github.com/cbnsndwch/shannon/issues). A few hard rules keep Shannon small and trustworthy: it's **pnpm-native** (never npm) for development, runtime dependencies stay at **zero**, and it must **never shadow the real `claude`**. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the dev loop and the full list.

```sh
pnpm install
pnpm build       # tsc -> dist/
pnpm test        # build, then run the test suite
pnpm test:src    # run tests directly from TypeScript (Node 22.6+)
```

## License

MIT. Derived from [claude-code-profiles](https://github.com/quinnjr/claude-code-profiles) (MIT, © Joseph R. Quinn). See [`NOTICE`](./NOTICE.md).
