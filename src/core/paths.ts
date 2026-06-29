import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve the profiles data directory. Kept byte-compatible with the original
 * shell tool so existing profiles are picked up with zero migration:
 *   - Windows:        %LOCALAPPDATA%\claude-profiles
 *   - everything else: $XDG_DATA_HOME/claude-profiles (default ~/.local/share)
 */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
    if (process.platform === 'win32') {
        const local = env.LOCALAPPDATA;
        if (local) {
            return join(local, 'claude-profiles');
        }
        return join(homedir(), 'AppData', 'Local', 'claude-profiles');
    }
    const xdg = env.XDG_DATA_HOME;
    if (xdg) {
        return join(xdg, 'claude-profiles');
    }
    return join(homedir(), '.local', 'share', 'claude-profiles');
}

/** Path to the `.default` marker file (plain text, profile name, no newline). */
export function defaultFile(env: NodeJS.ProcessEnv = process.env): string {
    return join(dataDir(env), '.default');
}

/** Path to a named profile's config directory. */
export function profileDir(
    name: string,
    env: NodeJS.ProcessEnv = process.env
): string {
    return join(dataDir(env), name);
}
