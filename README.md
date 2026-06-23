# Shannon

Manage isolated [Claude Code](https://www.anthropic.com/claude-code) configuration profiles — switch between work and personal accounts, different MCP setups, or separate settings without logging in and out. A zero-dependency TypeScript re-implementation of `claude-code-profiles`.

> Shannon is an independent project, **not affiliated with or endorsed by Anthropic**. The name is a nod to Claude Shannon. It interoperates with Claude Code via the `CLAUDE_CONFIG_DIR` environment variable that Claude Code already supports.

## Install

```sh
pnpm add -g @cbnsndwch/shannon
```

This installs three interchangeable commands — `shannon`, `claudep`, and `clp`. Use whichever you like.

## Usage

```sh
shannon create work          # create a profile
shannon default work         # set it as the default
shannon                      # launch Claude Code with the active profile
shannon list                 # list profiles (marks default/active)
shannon clone work test      # copy a profile (credentials omitted)
```

`shannon` with no subcommand launches Claude Code with the resolved profile and passes through any extra arguments (`shannon --resume`, `shannon -p "..."`). Use `shannon run …` or `shannon -- …` to force pass-through.

Management subcommands: `create`, `list`, `default`, `which`, `use`, `clone`, `delete`, `status`, `init`. Run `shannon help` for details.

## Profiles

Profiles are stored at `%LOCALAPPDATA%\claude-profiles\` (Windows) or `$XDG_DATA_HOME/claude-profiles/` (Linux/macOS, default `~/.local/share`) — the same layout as the original shell tool, so existing profiles are picked up automatically. Each profile directory is a complete Claude Code config directory.

Profile names may contain letters, digits, hyphens, and underscores.

## Status

Early days. This release (M1) covers profile management and the launcher. Seamless session `use` and per-directory auto-select via `shannon init <shell>` land next.

## Development

```sh
pnpm install
pnpm build       # tsc -> dist/
pnpm test        # build, then run the test suite
pnpm test:src    # run tests directly from TypeScript (Node 22.6+)
```

## License

MIT. Derived from [claude-code-profiles](https://github.com/quinnjr/claude-code-profiles) (MIT, © Joseph R. Quinn). See [`NOTICE`](./NOTICE.md).
