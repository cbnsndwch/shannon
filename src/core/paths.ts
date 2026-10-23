import { homedir } from 'node:os';
import { join } from 'node:path';
import { CLAUDE, type Provider } from './provider.js';

/**
 * Resolve the profiles data directory. Kept byte-compatible with the original
 * shell tool so existing profiles are picked up with zero migration:
 *   - Windows:        %LOCALAPPDATA%\claude-profiles
 *   - everything else: $XDG_DATA_HOME/claude-profiles (default ~/.local/share)
 */
export function dataDir(
    env: NodeJS.ProcessEnv = process.env,
    provider: Provider = CLAUDE
): string {
    if (process.platform === 'win32') {
        const local = env.LOCALAPPDATA;
        if (local) {
            return join(local, provider.dataDirectory);
        }
        return join(homedir(), 'AppData', 'Local', provider.dataDirectory);
    }
    const xdg = env.XDG_DATA_HOME;
    if (xdg) {
        return join(xdg, provider.dataDirectory);
    }
    return join(homedir(), '.local', 'share', provider.dataDirectory);
}

/** Path to the `.default` marker file (plain text, profile name, no newline). */
export function defaultFile(
    env: NodeJS.ProcessEnv = process.env,
    provider: Provider = CLAUDE
): string {
    return join(dataDir(env, provider), '.default');
}

/**
 * Path to the update-check cache (JSON: `{ checkedAt, latest }`). Lives in the
 * data dir alongside `.default`; the leading dot keeps it out of `list`, which
 * only surfaces real profile directories.
 */
export function updateCacheFile(env: NodeJS.ProcessEnv = process.env): string {
    return join(dataDir(env), '.update-check');
}

/** Path to a named profile's config directory. */
export function profileDir(
    name: string,
    env: NodeJS.ProcessEnv = process.env,
    provider: Provider = CLAUDE
): string {
    return join(dataDir(env, provider), name);
}
