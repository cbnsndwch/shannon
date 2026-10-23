import {
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync
} from 'node:fs';
import { join, relative, sep } from 'node:path';

import { dataDir, defaultFile, profileDir } from './paths.js';
import { assertValidName, validateName } from './validate.js';
import { ShannonError } from './errors.js';
import { CLAUDE, CODEX, type Provider } from './provider.js';
import {
    ACCOUNT_LOCK,
    accountsEnabled,
    syncActiveAccount,
    withAccountLock
} from './accounts.js';

export function listProfiles(
    env: NodeJS.ProcessEnv = process.env,
    provider: Provider = CLAUDE
): string[] {
    const dir = dataDir(env, provider);
    if (!existsSync(dir)) {
        return [];
    }
    return readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .toSorted();
}

export function profileExists(
    name: string,
    env: NodeJS.ProcessEnv = process.env,
    provider: Provider = CLAUDE
): boolean {
    const dir = profileDir(name, env, provider);
    return existsSync(dir) && statSync(dir).isDirectory();
}

export function createProfile(
    name: string,
    env: NodeJS.ProcessEnv = process.env,
    provider: Provider = CLAUDE
): string {
    assertValidName(name);
    const dir = profileDir(name, env, provider);
    if (existsSync(dir)) {
        throw new ShannonError(`profile '${name}' already exists`);
    }
    mkdirSync(dir, { recursive: true });
    return dir;
}

export function deleteProfile(
    name: string,
    env: NodeJS.ProcessEnv = process.env,
    provider: Provider = CLAUDE
): void {
    assertValidName(name);
    if (!profileExists(name, env, provider)) {
        throw new ShannonError(`profile '${name}' does not exist`);
    }
    const dir = profileDir(name, env, provider);
    const remove = () => rmSync(dir, { recursive: true, force: true });
    if (provider === CODEX && accountsEnabled(dir))
        withAccountLock(dir, remove);
    else remove();
}

/** Read the default profile name, or null if unset/empty. */
export function getDefault(
    env: NodeJS.ProcessEnv = process.env,
    provider: Provider = CLAUDE
): string | null {
    const file = defaultFile(env, provider);
    if (!existsSync(file)) {
        return null;
    }
    const name = readFileSync(file, 'utf8').trim();
    return name || null;
}

export function setDefault(
    name: string,
    env: NodeJS.ProcessEnv = process.env,
    provider: Provider = CLAUDE
): void {
    assertValidName(name);
    if (!profileExists(name, env, provider)) {
        throw new ShannonError(
            `profile '${name}' does not exist. Create it with: ${provider.command} create ${name}`
        );
    }
    mkdirSync(dataDir(env, provider), { recursive: true });
    // No trailing newline, matching the original shell tool's .default format.
    writeFileSync(defaultFile(env, provider), name);
}

export function clearDefault(
    env: NodeJS.ProcessEnv = process.env,
    provider: Provider = CLAUDE
): void {
    const file = defaultFile(env, provider);
    if (existsSync(file)) {
        rmSync(file, { force: true });
    }
}

export interface CloneOptions {
    withCredentials?: boolean;
}

/**
 * Shared copy routine behind both `clone` and `create --from`: validate both
 * names, require <src> to exist and <dst> to be free, then recursively copy
 * <src>'s contents into a fresh <dst> profile directory, omitting credential
 * files unless `withCredentials` is set. Returns the new profile's directory.
 */
export function copyProfile(
    src: string,
    dst: string,
    opts: CloneOptions = {},
    env: NodeJS.ProcessEnv = process.env,
    provider: Provider = CLAUDE
): string {
    assertValidName(src);
    assertValidName(dst);
    if (!profileExists(src, env, provider)) {
        throw new ShannonError(`source profile '${src}' does not exist`);
    }
    const dstDir = profileDir(dst, env, provider);
    if (existsSync(dstDir)) {
        throw new ShannonError(`profile '${dst}' already exists`);
    }
    const srcDir = profileDir(src, env, provider);
    const copy = () => {
        if (provider === CODEX && accountsEnabled(srcDir))
            syncActiveAccount(srcDir);
        mkdirSync(dstDir, { recursive: true });
        for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
            if (provider === CODEX && entry.name === ACCOUNT_LOCK) continue;
            if (
                !opts.withCredentials &&
                provider.secretFiles.includes(entry.name)
            ) {
                continue;
            }
            cpSync(join(srcDir, entry.name), join(dstDir, entry.name), {
                recursive: true
            });
        }
    };
    if (provider === CODEX && accountsEnabled(srcDir))
        withAccountLock(srcDir, copy);
    else copy();
    return dstDir;
}

export type ResolveSource = 'env' | 'default' | 'none';

export interface Resolved {
    dir: string | null;
    name: string | null;
    source: ResolveSource;
}

/**
 * Resolve the config directory to use: an explicit CLAUDE_CONFIG_DIR wins
 * (session override), otherwise the default profile. The default name is
 * re-validated here — defense in depth, in case `.default` was hand-edited —
 * so a tampered marker can never be turned into a path we hand to claude.
 */
export function resolveActive(
    env: NodeJS.ProcessEnv = process.env,
    provider: Provider = CLAUDE
): Resolved {
    const explicit = env[provider.configEnv];
    if (explicit) {
        const candidate = relative(dataDir(env, provider), explicit);
        let name: string | null = null;
        if (
            candidate &&
            !candidate.includes(sep) &&
            validateName(candidate).ok &&
            profileExists(candidate, env, provider)
        ) {
            name = candidate;
        }
        return { dir: explicit, name, source: 'env' };
    }
    const def = getDefault(env, provider);
    if (def && validateName(def).ok && profileExists(def, env, provider)) {
        return {
            dir: profileDir(def, env, provider),
            name: def,
            source: 'default'
        };
    }
    return { dir: null, name: null, source: 'none' };
}
