# Releasing

Shannon ships through two channels from a single tag:

- **npm** — `@cbnsndwch/shannon` (the canonical install), published with provenance.
- **GitHub Releases** — prebuilt single-file binaries (Node SEA) for linux/macOS/Windows.

Both are produced by `.github/workflows/release.yml`, triggered by pushing a `v*` tag.

## One-time setup

Add a repository secret used by the `publish` job:

- **`NPM_TOKEN`** — an npm **granular automation token** with publish access to the
  `@cbnsndwch` scope. (`GITHUB_TOKEN` is provided automatically and is used to
  create the release and upload assets — no secret needed for that.)

Provenance requires the `id-token: write` permission, which the workflow already
grants on the `publish` job. The package sets `"publishConfig": { "access": "public" }`
so the first publish of this scoped package is public rather than restricted.

Optional, recommended later: configure an npm **trusted publisher** (OIDC) for the
package and drop `NPM_TOKEN` entirely. `id-token: write` is still required either way.
Verify the installed pnpm version supports OIDC trusted publishing before switching.

## Cut a release

1. Make sure `main` is green in CI.
2. Bump `"version"` in `package.json`.
3. Commit the bump.
4. Tag it **exactly** matching the version, prefixed with `v`:
   ```sh
   git tag v0.1.0
   git push origin main --tags
   ```

The tag push runs the `release` workflow:

1. **verify** — `pnpm test`, and a guard that the tag (minus the `v`) equals
   `package.json` version. A mismatch fails the release before anything is published.
2. **release** — creates the GitHub Release (idempotent; `--verify-tag`,
   `--generate-notes`).
3. **binaries** — builds one SEA binary per OS/arch, smoke-tests it (asserts
   `--version` equals the tag, runs `list`), writes a `.sha256` sidecar, and
   uploads both.
4. **publish** — `pnpm publish --provenance` to npm. This runs **last**, gated on the
   binaries succeeding, so a binary failure never leaves npm ahead of the artifacts.

### Prereleases

A tag containing a hyphen (e.g. `v0.2.0-rc.1`) is treated as a prerelease, provided
`package.json` matches it. The workflow then routes both channels away from the
stable lines automatically: `gh release create` is passed `--prerelease`, and
`pnpm publish` uses `--tag next` so the rc never moves npm's `latest`. A clean
`vX.Y.Z` tag publishes under `latest` and marks a normal Release.

To exercise verify → release → binaries without publishing at all, you can still
temporarily change the publish step to add `--dry-run`. Re-enable the real publish
for the final tag.

## The embedded Node version

`NODE_VERSION` in `release.yml` is the Node runtime baked into every binary. Pin it
**exact**. Node's SEA (single-executable application) feature is experimental, so on
each bump re-run the local SEA build (below) and confirm both `--version` and `list`
behave. `setup-node` downloads this Node from nodejs.org and checksum-verifies it —
that download is the one unavoidable fetch in the pipeline.

## Build a binary locally (verification)

```sh
pnpm install
pnpm build
pnpm sea:bundle           # esbuild bundles build/sea-entry.ts -> build/sea-bundle.cjs (CJS)
pnpm sea:blob             # node --experimental-sea-config -> build/sea-prep.blob

# copy the running node, then inject the blob:
node -e "require('fs').copyFileSync(process.execPath,'shannon')"     # 'shannon.exe' on Windows
# macOS only: codesign --remove-signature shannon
pnpm exec postject shannon NODE_SEA_BLOB build/sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
#   add --macho-segment-name NODE_SEA on macOS
# macOS only: codesign --sign - shannon

./shannon --version       # prints the package version
./shannon list            # must run shannon, NOT launch claude (proves the argv offset)
```

`list` is the load-bearing check: a wrong argument offset in `build/sea-entry.ts`
would make the binary fall through to launching `claude` instead of listing profiles.

## Supply-chain notes

- Every GitHub Action is pinned to a 40-char commit SHA (see the `uses:` lines).
- pnpm is provisioned and integrity-verified by corepack from the `packageManager`
  field's sha512 — no `pnpm/action-setup`, no `curl | sh`.
- Build tools (`esbuild`, `postject`) are exact-pinned and integrity-hashed in
  `pnpm-lock.yaml`. esbuild's install script is intentionally **not** run
  (`ignoredBuiltDependencies` in `pnpm-workspace.yaml`); its compiler is a
  prebuilt platform binary resolved at runtime.
- Runtime dependencies remain **zero**; `esbuild`/`postject` are build-only
  devDependencies and never ship in the npm tarball (`files` is `dist/src` only).
- Releases are created and uploaded with the preinstalled `gh` CLI rather than a
  third-party release action.
- **Binary authenticity.** The `.sha256` sidecar is hosted in the same Release as
  the binary, so it only detects download/transport corruption — it is not an
  authenticity control, since anyone who could replace a release asset could
  replace its checksum too. The binaries are also unsigned (Windows) /
  ad-hoc-signed and not notarized (macOS). The authenticated, tamper-evident
  channel is **npm with provenance** (`--provenance` + `id-token: write`), which
  covers the npm package only. If the prebuilt channel needs independent
  authenticity later, add `actions/attest-build-provenance` (SHA-pinned, with
  `attestations: write`/`id-token: write` on the `binaries` job) and/or sign the
  binaries with a key published out-of-band.

## Consumer notes

- **npm (recommended):**
  ```sh
  pnpm add -g @cbnsndwch/shannon   # needs Node >= 20
  ```
  Installs the `shannon`, `claudep`, and `clp` commands.
- **Prebuilt binaries:** download the asset for your platform from the Release page,
  check it against the `.sha256` sidecar (a download-integrity check, not an
  authenticity guarantee — see *Binary authenticity* above), then make it
  executable / put it on PATH. The binaries embed their own Node and do not
  require a system Node.
  - macOS: the binaries are ad-hoc-signed and not notarized. Clear quarantine before
    first run: `xattr -d com.apple.quarantine ./shannon-macos-arm64` (or right-click →
    Open). Notarization is deferred.
  - Windows: the binary is unsigned, so SmartScreen may warn until reputation accrues;
    it still runs.
  - The three command names are interchangeable; to get `claudep`/`clp`, copy or
    symlink the downloaded binary under those names.
