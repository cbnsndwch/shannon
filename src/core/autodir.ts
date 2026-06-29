import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { profileDir } from './paths.js';
import { profileExists } from './profiles.js';
import { validateName } from './validate.js';

/** Per-directory marker file: plain text, a single profile name. */
export const MARKER = '.shannon';

/**
 * Walk up from `cwd` to the filesystem root looking for the nearest `.shannon`
 * marker file (the same way `.nvmrc` / `.git` are discovered). Returns the
 * trimmed file contents (a profile name) or null when none is found. An empty
 * marker resolves to null — it explicitly means "no auto-selection here".
 */
export function findMarker(cwd: string): string | null {
    let dir = cwd;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const file = join(dir, MARKER);
        if (existsSync(file) && statSync(file).isFile()) {
            const name = readFileSync(file, 'utf8').trim();
            return name || null;
        }
        const parent = dirname(dir);
        if (parent === dir) {
            return null;
        }
        dir = parent;
    }
}

/**
 * The reconciliation the shell hook should apply on entering a directory.
 * - `set`   — point CLAUDE_CONFIG_DIR at a profile and remember it (SHANNON_AUTO)
 * - `unset` — we previously auto-selected, but the new directory has no (valid)
 *             marker, so clear both vars and fall back to default resolution
 * - `none`  — nothing to do (state already matches)
 */
export type AutoAction =
    | { kind: 'set'; name: string; dir: string }
    | { kind: 'unset' }
    | { kind: 'none' };

/**
 * Decide how to reconcile the auto-selected profile for `cwd`. `SHANNON_AUTO`
 * tracks the profile name we last auto-applied; a manual `use` does not set it,
 * so an explicit override is left untouched until the directory changes.
 *
 * The marker name is validated and the profile's existence checked here, so a
 * bogus or stale `.shannon` is ignored rather than handed to claude.
 */
export function resolveAuto(
    cwd: string,
    env: NodeJS.ProcessEnv = process.env
): AutoAction {
    const have = env.SHANNON_AUTO ?? '';
    const raw = findMarker(cwd);

    let want = '';
    if (raw && validateName(raw).ok && profileExists(raw, env)) {
        want = raw;
    }

    if (want === have) {
        return { kind: 'none' };
    }
    if (want) {
        return { kind: 'set', name: want, dir: profileDir(want, env) };
    }
    return { kind: 'unset' };
}
