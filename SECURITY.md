# Security Policy

## Reporting a vulnerability

Please report security issues privately by email to **serge@cbnsndwch.io** rather
than opening a public issue. Include enough detail to reproduce the problem
(affected version, platform, and steps). You can expect an acknowledgement and,
where applicable, a coordinated disclosure once a fix is available.

## Supported versions

Shannon is pre-1.0; fixes land on the latest released version. Please make sure
you can reproduce on the most recent release before reporting.

## Supply-chain posture

Shannon is deliberately minimal to keep its attack surface small:

- **Zero runtime dependencies.**
- **Nothing fetched-and-executed** — no `curl | sh` installer, no post-install scripts.
- **Pinned, integrity-checked build tooling** — every GitHub Action is pinned by
  commit SHA, and pnpm is provisioned by corepack from a hashed `packageManager` field.
- **Authenticated distribution** — the npm package is published with
  [provenance](https://docs.npmjs.com/generating-provenance-statements).

The prebuilt GitHub Release binaries are unsigned (Windows) / ad-hoc-signed and
not notarized (macOS); their `.sha256` sidecars detect transport corruption but
are **not** an authenticity guarantee. For an authenticated, tamper-evident
channel, prefer the npm package. See
[`RELEASING.md`](./RELEASING.md#supply-chain-notes) for the full details.
