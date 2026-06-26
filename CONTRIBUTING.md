# Contributing

Thanks for your interest in Shannon. Bug reports, feature requests, and pull
requests are welcome via the [issue tracker](https://github.com/cbnsndwch/shannon/issues).

## Dev loop

Shannon is **pnpm-native**; the pnpm version is pinned in `package.json`'s
`packageManager` field and provisioned by corepack.

```sh
pnpm install     # devDeps only (typescript, @types/node, and build-only esbuild/postject)
pnpm build       # tsc -> dist/
pnpm test        # build, then run the node:test suite
pnpm test:src    # run the tests directly from TypeScript (Node 22.6+)
```

Run the built CLI read-only while developing with `node dist/src/cli.js list`.
Run `pnpm test` and make sure it's green before opening a PR.

## Hard constraints (please don't break these)

1. **pnpm-native** — never npm for development.
2. **Zero / near-zero runtime dependencies.** If you reach for a runtime
   dependency, stop and reconsider — Shannon's value is having almost nothing to
   audit. (`esbuild` / `postject` are build-only devDependencies and never ship.)
3. **Launcher launches; never shadow `claude`.** Shannon sets
   `CLAUDE_CONFIG_DIR` and spawns the real `claude`; it must not define a
   `claude` wrapper.
4. **Keep "Claude" out of the package name / branding** and keep the
   "not affiliated with or endorsed by Anthropic" disclaimer. Nominative
   references that describe interop are fine.
5. **Storage stays byte-compatible** with the original shell tool, so existing
   profiles keep working with no migration.
6. **No analytics, tracking, telemetry, or SEO cruft.**

## Commits & PRs

- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`,
  `fix:`, `docs:`, …). Keep messages factual.
- Do not add attribution or co-author trailers.
- Any behavioral change should update `README.md` (and `CLAUDE.md` if it touches
  the architecture or roadmap).
