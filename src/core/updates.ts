import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dataDir, updateCacheFile } from './paths.js';

// The published package and the registry endpoint for its current `latest`
// dist-tag. The check sends no identifying data — just a GET for a version
// number — and is fully opt-out (see updatesDisabled). This is the only place
// Shannon ever reaches the network on its own behalf.
const PACKAGE = '@cbnsndwch/shannon';
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE}/latest`;

/** How long a cached result is considered fresh (24h). */
const TTL_MS = 24 * 60 * 60 * 1000;

/** Network timeout for a single registry probe. */
const FETCH_TIMEOUT_MS = 2500;

interface UpdateCache {
    checkedAt: number;
    latest: string;
}

/**
 * Whether update checking is switched off. Honors Shannon's own opt-out plus
 * the de-facto `NO_UPDATE_NOTIFIER` convention, and never runs under CI.
 */
export function updatesDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(
        env.SHANNON_NO_UPDATE_CHECK || env.NO_UPDATE_NOTIFIER || env.CI
    );
}

/** Compare two dotted versions numerically, ignoring any prerelease suffix. */
function compareVersions(a: string, b: string): number {
    const parse = (v: string) =>
        v
            .split('-')[0]!
            .split('.')
            .map(n => parseInt(n, 10) || 0);
    const pa = parse(a);
    const pb = parse(b);
    for (let i = 0; i < 3; i++) {
        const x = pa[i] ?? 0;
        const y = pb[i] ?? 0;
        if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
}

/** True when `latest` is a strictly newer release than `current`. */
export function isNewer(latest: string, current: string): boolean {
    return compareVersions(latest, current) > 0;
}

function readCache(env: NodeJS.ProcessEnv = process.env): UpdateCache | null {
    try {
        const raw = readFileSync(updateCacheFile(env), 'utf8');
        const data = JSON.parse(raw) as UpdateCache;
        if (typeof data.latest === 'string' && typeof data.checkedAt === 'number') {
            return data;
        }
    } catch {
        // Missing or corrupt cache — treat as no cache.
    }
    return null;
}

function writeCache(latest: string, env: NodeJS.ProcessEnv = process.env): void {
    try {
        mkdirSync(dataDir(env), { recursive: true });
        const data: UpdateCache = { checkedAt: Date.now(), latest };
        writeFileSync(updateCacheFile(env), JSON.stringify(data));
    } catch {
        // A cache we can't write just means we'll re-check next time.
    }
}

function cacheIsFresh(cache: UpdateCache | null): boolean {
    return cache !== null && Date.now() - cache.checkedAt < TTL_MS;
}

/**
 * Fetch the registry's current `latest` version, or null on any failure
 * (offline, timeout, malformed response). Never throws.
 */
async function fetchLatest(): Promise<string | null> {
    try {
        const res = await fetch(REGISTRY_URL, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: { accept: 'application/json' }
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { version?: unknown };
        return typeof data.version === 'string' ? data.version : null;
    } catch {
        return null;
    }
}

/**
 * Refresh the cache from the registry. Always stamps `checkedAt` (even on a
 * failed fetch, falling back to the last known version or `current`) so a flaky
 * network throttles retries to once per TTL instead of every invocation.
 * Returns the latest known version, or null if it could never be determined.
 */
export async function refreshCache(
    current: string,
    env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
    const fetched = await fetchLatest();
    const fallback = readCache(env)?.latest ?? current;
    const latest = fetched ?? fallback;
    writeCache(latest, env);
    return fetched ?? readCache(env)?.latest ?? null;
}

/**
 * The cached newer version to advertise, or null when up to date / unknown /
 * disabled. Pure read — never touches the network.
 */
export function pendingUpdate(
    current: string,
    env: NodeJS.ProcessEnv = process.env
): string | null {
    if (updatesDisabled(env)) return null;
    const cache = readCache(env);
    if (cache && isNewer(cache.latest, current)) return cache.latest;
    return null;
}

/**
 * If the cache is stale (and checks are enabled), kick off a detached child
 * that refreshes it in the background, then returns immediately. The child runs
 * the internal `__check-updates` command with its stdio fully detached and is
 * unref'd, so it never blocks or delays the parent's exit.
 */
export function refreshInBackground(env: NodeJS.ProcessEnv = process.env): void {
    try {
        if (updatesDisabled(env)) return;
        if (cacheIsFresh(readCache(env))) return;
        const entry = process.argv[1];
        const args = entry ? [entry, '__check-updates'] : ['__check-updates'];
        const child = spawn(process.execPath, args, {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        });
        child.unref();
    } catch {
        // Best-effort: a failed spawn must never affect the foreground command.
    }
}
