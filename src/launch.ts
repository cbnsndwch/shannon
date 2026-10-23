import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { resolveActive } from './core/profiles.js';
import { ShannonError } from './core/errors.js';
import { CLAUDE, CODEX, type Provider } from './core/provider.js';
import {
    accountsEnabled,
    syncActiveAccount,
    withAccountLock
} from './core/accounts.js';

/**
 * Locate the real `claude` executable on PATH (honoring PATHEXT on Windows).
 * No self-shadowing to worry about: our bins are shannon/claudep/clp, never
 * `claude`, so the first PATH match is always the genuine Claude Code binary.
 */
export function findClaude(
    env: NodeJS.ProcessEnv = process.env
): string | null {
    return findExecutable(env, CLAUDE);
}

export function findExecutable(
    env: NodeJS.ProcessEnv = process.env,
    provider: Provider = CLAUDE
): string | null {
    const pathVar = env.PATH ?? env.Path ?? '';
    const isWin = process.platform === 'win32';
    const exts = isWin
        ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
        : [''];
    for (const dir of pathVar.split(delimiter).filter(Boolean)) {
        for (const ext of exts) {
            const candidate = join(dir, provider.binary + ext);
            if (existsSync(candidate) && statSync(candidate).isFile()) {
                return candidate;
            }
        }
    }
    return null;
}

/** Escape cmd metacharacters for both cmd.exe and a forwarding batch shim. */
function cmdEscape(s: string): string {
    return s.replace(/[()%!^"`<>&|;, *?[\]]/g, '^$&');
}

function winQuote(s: string): string {
    const escaped = s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
    return cmdEscape(cmdEscape(`"${escaped}"`));
}

/**
 * Launch the real claude binary with CLAUDE_CONFIG_DIR set to the resolved
 * profile, inheriting stdio, and return its exit code.
 */
export function launchClaude(
    args: string[],
    env: NodeJS.ProcessEnv = process.env
): number {
    return launch(args, env, CLAUDE);
}

/** Launch the selected CLI; profile management never replaces the real binary. */
export function launch(
    args: string[],
    env: NodeJS.ProcessEnv = process.env,
    provider: Provider = CLAUDE,
    beforeLaunch?: () => void
): number {
    const resolved = resolveActive(env, provider);
    const childEnv: NodeJS.ProcessEnv = { ...env };
    if (resolved.dir) {
        childEnv[provider.configEnv] = resolved.dir;
    }

    const executable = findExecutable(env, provider);
    if (!executable) {
        throw new ShannonError(
            `'${provider.binary}' binary not found in PATH. Is ${provider.label} installed?`
        );
    }

    // File-based storage gives named logins and profile copies the same
    // credential contract on every OS.
    const accountHome =
        provider === CODEX && resolved.dir && accountsEnabled(resolved.dir)
            ? resolved.dir
            : null;
    const childArgs =
        provider === CODEX && resolved.dir
            ? [
                  '-c',
                  "cli_auth_credentials_store='file'",
                  ...(accountHome ? ['--no-daemon'] : []),
                  ...args
              ]
            : args;

    // Native executables take an argv array directly. Only batch shims need
    // cmd.exe; escape both parsing passes so prompts remain literal arguments.
    const batch =
        process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
    const commandLine = batch
        ? `"${cmdEscape(executable)} ${childArgs.map(winQuote).join(' ')}"`
        : '';
    const run = () => {
        beforeLaunch?.();
        const result = batch
            ? spawnSync(
                  env.ComSpec ?? env.COMSPEC ?? 'cmd.exe',
                  ['/d', '/s', '/c', commandLine],
                  {
                      stdio: 'inherit',
                      env: childEnv,
                      windowsVerbatimArguments: true
                  }
              )
            : spawnSync(executable, childArgs, {
                  stdio: 'inherit',
                  env: childEnv
              });

        if (result.error) {
            throw new ShannonError(
                `failed to launch ${provider.binary}: ${result.error.message}`
            );
        }
        if (accountHome) syncActiveAccount(accountHome);
        return result.status ?? 1;
    };
    return accountHome ? withAccountLock(accountHome, run) : run();
}
