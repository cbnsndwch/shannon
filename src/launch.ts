import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { resolveActive } from './core/profiles.js';
import { ShannonError } from './core/errors.js';

/**
 * Locate the real `claude` executable on PATH (honoring PATHEXT on Windows).
 * No self-shadowing to worry about: our bins are shannon/claudep/clp, never
 * `claude`, so the first PATH match is always the genuine Claude Code binary.
 */
export function findClaude(
    env: NodeJS.ProcessEnv = process.env
): string | null {
    const pathVar = env.PATH ?? env.Path ?? '';
    const isWin = process.platform === 'win32';
    const exts = isWin
        ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
        : [''];
    for (const dir of pathVar.split(delimiter).filter(Boolean)) {
        for (const ext of exts) {
            const candidate = join(dir, 'claude' + ext);
            if (existsSync(candidate)) {
                return candidate;
            }
        }
    }
    return null;
}

/** Quote an argument for a Windows command line (cmd.exe via shell:true). */
function winQuote(s: string): string {
    if (s === '') {
        return '""';
    }
    if (!/[\s"]/.test(s)) {
        return s;
    }
    const escaped = s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
    return `"${escaped}"`;
}

/**
 * Launch the real claude binary with CLAUDE_CONFIG_DIR set to the resolved
 * profile, inheriting stdio, and return its exit code.
 */
export function launchClaude(
    args: string[],
    env: NodeJS.ProcessEnv = process.env
): number {
    const resolved = resolveActive(env);
    const childEnv: NodeJS.ProcessEnv = { ...env };
    if (resolved.dir) {
        childEnv.CLAUDE_CONFIG_DIR = resolved.dir;
    }

    const claude = findClaude(env);
    if (!claude) {
        throw new ShannonError(
            "'claude' binary not found in PATH. Is Claude Code installed?"
        );
    }

    // On Windows the binary is typically a .cmd shim, which Node refuses to spawn
    // directly without a shell; build a properly quoted command line instead.
    const result =
        process.platform === 'win32'
            ? spawnSync([claude, ...args].map(winQuote).join(' '), {
                  stdio: 'inherit',
                  env: childEnv,
                  shell: true
              })
            : spawnSync(claude, args, { stdio: 'inherit', env: childEnv });

    if (result.error) {
        throw new ShannonError(
            `failed to launch claude: ${result.error.message}`
        );
    }
    return result.status ?? 0;
}
