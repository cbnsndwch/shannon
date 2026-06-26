# Shannon

Manage isolated [Claude Code](https://www.anthropic.com/claude-code) configuration profiles — switch between work and personal accounts, different MCP setups, or separate settings without logging in and out. A zero-dependency TypeScript re-implementation of `claude-code-profiles`.

> Shannon is an independent project, **not affiliated with or endorsed by Anthropic**. The name is a nod to Claude Shannon. It interoperates with Claude Code via the `CLAUDE_CONFIG_DIR` environment variable that Claude Code already supports.

## Install

```sh
pnpm add -g @cbnsndwch/shannon
```

This installs three interchangeable commands — `shannon`, `claudep`, and `clp`. Use whichever you like. Requires Node 20 or newer.

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

Available targets: `shannon-linux-x64`, `shannon-linux-arm64`, `shannon-macos-x64`, `shannon-macos-arm64`, `shannon-win-x64.exe`. The binary behaves identically under any of the `shannon` / `claudep` / `clp` names — copy or symlink it to whichever you want.

- **macOS:** the binaries are ad-hoc-signed and not notarized. Clear quarantine before first run with `xattr -d com.apple.quarantine ./shannon-macos-arm64`, or right-click → Open.
- **Windows:** the binary is unsigned, so SmartScreen may warn until it builds reputation; it still runs.

The `.sha256` sidecar lives in the same release as the binary, so it only confirms the download arrived intact — it is **not** an authenticity guarantee against a tampered release, and the binaries are unsigned (Windows) / ad-hoc-signed and not notarized (macOS). For an authenticated, tamper-evident channel prefer the npm package, which is published with [provenance](https://docs.npmjs.com/generating-provenance-statements). npm is the canonical channel; the binaries are a convenience for Node-less installs. See [`RELEASING.md`](./RELEASING.md) for how releases are built.

## Usage

```sh
shannon create work          # create a profile
shannon default work         # set it as the default
shannon                      # launch Claude Code with the active profile
shannon list                 # list profiles (marks default/active)
shannon clone work test      # copy a profile (credentials omitted)
shannon create test --from work   # create a new profile by copying another
```

`shannon` with no subcommand launches Claude Code with the resolved profile and passes through any extra arguments (`shannon --resume`, `shannon -p "..."`). Use `shannon run …` or `shannon -- …` to force pass-through.

Management subcommands: `create`, `list`, `default`, `which`, `use`, `clone`, `delete`, `status`, `init`. Run `shannon help` for details.

## Shell integration

The launcher already resolves the default profile, but two things need a shell function: making `use` switch the *live* shell, and auto-selecting a profile when you `cd` into a project. Add the line for your shell to its startup file:

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

## Profiles

Profiles are stored at `%LOCALAPPDATA%\claude-profiles\` (Windows) or `$XDG_DATA_HOME/claude-profiles/` (Linux/macOS, default `~/.local/share`) — the same layout as the original shell tool, so existing profiles are picked up automatically. Each profile directory is a complete Claude Code config directory.

Profile names may contain letters, digits, hyphens, and underscores.

## Status

Profile management, the launcher, seamless session `use`, per-directory auto-select (`shannon init <shell>`), copy-on-create (`clone`, `create --from <src>`), and release CI (npm publish with provenance + prebuilt binaries via GitHub Releases) are all in. Next up: docs polish.

## Development

```sh
pnpm install
pnpm build       # tsc -> dist/
pnpm test        # build, then run the test suite
pnpm test:src    # run tests directly from TypeScript (Node 22.6+)
```

## License

MIT. Derived from [claude-code-profiles](https://github.com/quinnjr/claude-code-profiles) (MIT, © Joseph R. Quinn). See [`NOTICE`](./NOTICE.md).
