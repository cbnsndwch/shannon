import { homedir } from 'node:os';
import { join } from 'node:path';

// Pure helpers for the `setup` command: which shells we support, the single line
// a user adds to their startup file, where that file lives, and whether it's
// already wired up. The interactive bits (prompting, file writes, resolving the
// PowerShell $PROFILE) live in commands.ts; everything here is side-effect-free
// and unit-tested.

export const SUPPORTED_SHELLS = ['bash', 'zsh', 'fish', 'pwsh'] as const;
export type Shell = (typeof SUPPORTED_SHELLS)[number];

export function isSupportedShell(value: string): value is Shell {
    return (SUPPORTED_SHELLS as readonly string[]).includes(value);
}

/** Best-effort guess of the current shell from the environment. */
export function detectShell(env: NodeJS.ProcessEnv = process.env): Shell {
    if (process.platform === 'win32') return 'pwsh';
    const sh = (env.SHELL ?? '').toLowerCase();
    if (sh.includes('zsh')) return 'zsh';
    if (sh.includes('fish')) return 'fish';
    return 'bash';
}

/**
 * The single line that belongs in a shell startup file. It re-generates the full
 * integration on every shell launch via `shannon init`, so the startup file
 * stays one readable line instead of a wall of function definitions.
 */
export function integrationLine(shell: Shell, command = 'shannon'): string {
    switch (shell) {
        case 'fish':
            return `${command} init fish | source`;
        case 'pwsh':
            return `${command} init pwsh | Out-String | Invoke-Expression`;
        default:
            return `eval "$(${command} init ${shell})"`;
    }
}

/**
 * The conventional startup file for a POSIX shell. Returns null for pwsh, whose
 * `$PROFILE` path is resolved at runtime (it varies, e.g. under OneDrive).
 */
export function startupFile(
    shell: Shell,
    env: NodeJS.ProcessEnv = process.env
): string | null {
    const home = homedir();
    switch (shell) {
        case 'bash':
            return join(home, '.bashrc');
        case 'zsh':
            return join(env.ZDOTDIR ?? home, '.zshrc');
        case 'fish':
            return join(
                env.XDG_CONFIG_HOME ?? join(home, '.config'),
                'fish',
                'config.fish'
            );
        default:
            return null;
    }
}

/** Comment marker delimiting the block `setup` appends, for idempotency. */
export const MARKER = '# shannon shell integration (added by: shannon setup)';

/** Whether a startup file's contents already wire up shannon. */
export function alreadyInstalled(
    content: string,
    command = 'shannon'
): boolean {
    return (
        content.includes(integrationMarker(command)) ||
        new RegExp(`\\b${command} init\\b`).test(content)
    );
}

function integrationMarker(command: string): string {
    return `# ${command} shell integration (added by: ${command} setup)`;
}

/** The block `setup` appends to a startup file (marker + the one line). */
export function blockToAppend(shell: Shell, command = 'shannon'): string {
    return `\n${integrationMarker(command)}\n${integrationLine(shell, command)}\n`;
}
