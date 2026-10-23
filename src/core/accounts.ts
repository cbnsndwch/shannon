import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { ShannonError } from './errors.js';
import { assertValidName } from './validate.js';

/** Private login slots belong to one context/profile, never to the whole machine. */
export const ACCOUNT_DIR = '.gpt-accounts';
export const ACCOUNT_LOCK = '.gpt-lock';
const ACTIVE = 'active';
const PENDING = 'pending-switch.json';

function store(home: string): string {
    return join(home, ACCOUNT_DIR);
}

export function accountsEnabled(home: string): boolean {
    return existsSync(store(home));
}

function accountHome(home: string, name: string): string {
    assertValidName(name);
    return join(store(home), name);
}

/** Replace a file atomically, with restrictive permissions on POSIX. */
function atomicWrite(
    file: string,
    contents: string,
    temporaryDirectory = dirname(file)
): void {
    const temporary = join(
        temporaryDirectory,
        `.${basename(file)}-${randomUUID()}.tmp`
    );
    try {
        writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' });
        renameSync(temporary, file);
    } finally {
        rmSync(temporary, { force: true });
    }
}

function credentials(home: string): string | null {
    const file = join(home, 'auth.json');
    if (!existsSync(file)) return null;
    const raw = readFileSync(file, 'utf8');
    try {
        const parsed: unknown = JSON.parse(raw);
        if (
            !parsed ||
            typeof parsed !== 'object' ||
            Array.isArray(parsed) ||
            Object.keys(parsed).length === 0
        ) {
            throw new Error('invalid credentials');
        }
    } catch {
        // JSON parser errors can include token contents. Never print them.
        throw new ShannonError(
            'invalid Codex auth.json; sign in again before switching logins'
        );
    }
    return raw;
}

function writeCredentials(
    home: string,
    raw: string,
    temporaryDirectory = home
): void {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    atomicWrite(join(home, 'auth.json'), raw, temporaryDirectory);
}

export function activeAccount(home: string): string | null {
    const file = join(store(home), ACTIVE);
    if (!existsSync(file)) return null;
    const name = readFileSync(file, 'utf8').trim();
    assertValidName(name);
    return name;
}

export interface Account {
    name: string;
    active: boolean;
    signedIn: boolean;
}

export function listAccounts(home: string): Account[] {
    if (!existsSync(store(home))) return [];
    const active = activeAccount(home);
    return readdirSync(store(home), { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => ({
            name: entry.name,
            active: entry.name === active,
            signedIn: existsSync(
                join(accountHome(home, entry.name), 'auth.json')
            )
        }))
        .toSorted((a, b) => a.name.localeCompare(b.name));
}

/** Save refreshed tokens; a deliberate logout must also invalidate the saved slot. */
export function syncActiveAccount(home: string): void {
    const name = activeAccount(home);
    if (!name) return;
    const destination = accountHome(home, name);
    const raw = credentials(home);
    if (raw === null) rmSync(join(destination, 'auth.json'), { force: true });
    else writeCredentials(destination, raw);
}

/** Complete a journaled switch after a crash, before any CLI can use this home. */
function recoverSwitch(home: string): void {
    const journal = join(store(home), PENDING);
    if (!existsSync(journal)) return;
    let name: string;
    try {
        const parsed = JSON.parse(readFileSync(journal, 'utf8')) as {
            target?: unknown;
        };
        if (typeof parsed.target !== 'string')
            throw new Error('invalid target');
        name = parsed.target;
        assertValidName(name);
    } catch {
        throw new ShannonError(
            'invalid pending account switch; account files were left untouched'
        );
    }
    const raw = credentials(accountHome(home, name));
    if (raw === null)
        throw new ShannonError(`login '${name}' is signed out; sign in again`);
    // Keep even crash-leftover token files in the vault, which ordinary clones omit.
    writeCredentials(home, raw, store(home));
    atomicWrite(join(store(home), ACTIVE), name);
    rmSync(journal);
}

/** All mutations and wrapper-launched Codex sessions hold the same profile lock. */
export function withAccountLock<T>(home: string, fn: () => T): T {
    const lock = join(home, ACCOUNT_LOCK);
    try {
        mkdirSync(lock, { mode: 0o700 });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        throw new ShannonError(
            'this profile is in use. Exit its running Codex session before switching logins. ' +
                'After a crashed launcher, close all Codex processes for this profile and run gpt account unlock --yes'
        );
    }
    try {
        writeFileSync(join(lock, 'owner'), String(process.pid), {
            mode: 0o600
        });
        recoverSwitch(home);
        return fn();
    } finally {
        rmSync(lock, { recursive: true, force: true });
    }
}

/** Explicit crash recovery only; never guess that another live launcher is stale. */
export function unlockAccounts(home: string): void {
    const lock = join(home, ACCOUNT_LOCK);
    if (!existsSync(lock)) return;
    const pid = Number(readFileSync(join(lock, 'owner'), 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) {
        throw new ShannonError(
            'cannot identify the profile lock owner; lock left untouched'
        );
    }
    try {
        process.kill(pid, 0);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
            rmSync(lock, { recursive: true, force: true });
            return;
        }
        throw new ShannonError(
            'cannot verify the profile lock owner; lock left untouched'
        );
    }
    throw new ShannonError(
        `profile is still in use by process ${pid}; exit it before unlocking`
    );
}

export function saveAccount(home: string, name: string): void {
    assertValidName(name);
    const current = activeAccount(home);
    if (current && current !== name) {
        throw new ShannonError(
            `current login is already named '${current}'; add another with: gpt account login ${name}`
        );
    }
    const raw = credentials(home);
    if (raw === null)
        throw new ShannonError(
            'no current login to save. Use: gpt account login <name>'
        );
    const destination = accountHome(home, name);
    if (current !== name && existsSync(destination)) {
        throw new ShannonError(
            `login '${name}' already exists. Select it with: gpt account use ${name}`
        );
    }
    writeCredentials(destination, raw);
    atomicWrite(join(store(home), ACTIVE), name);
}

export function useAccount(home: string, name: string): void {
    assertValidName(name);
    const current = activeAccount(home);
    if (current === name) {
        if (credentials(home) === null)
            throw new ShannonError(
                `login '${name}' is signed out. Use: gpt account login ${name}`
            );
        syncActiveAccount(home);
        return;
    }
    const raw = credentials(accountHome(home, name));
    if (raw === null)
        throw new ShannonError(
            `no saved credentials for login '${name}'. Use: gpt account login ${name}`
        );
    if (!current && credentials(home) !== null) {
        throw new ShannonError(
            'save the existing profile login first: gpt account save <name>'
        );
    }
    syncActiveAccount(home);
    // The journal makes the auth.json + active-name update recoverable as a unit.
    atomicWrite(join(store(home), PENDING), JSON.stringify({ target: name }));
    recoverSwitch(home);
}

export function nextAccount(home: string): string {
    const names = listAccounts(home)
        .filter(account => account.signedIn)
        .map(account => account.name);
    if (names.length < 2)
        throw new ShannonError(
            'save at least two signed-in logins before using gpt account next'
        );
    const index = names.indexOf(activeAccount(home) ?? '');
    const name = names[(index + 1) % names.length]!;
    useAccount(home, name);
    return name;
}

/** Login happens in a fresh temporary home, leaving the profile's login in place. */
export function prepareAccountLogin(home: string, name: string): string {
    assertValidName(name);
    if (!activeAccount(home) && credentials(home) !== null) {
        throw new ShannonError(
            'save the existing profile login first: gpt account save <name>'
        );
    }
    syncActiveAccount(home);
    mkdirSync(store(home), { recursive: true, mode: 0o700 });
    const temporary = mkdtempSync(join(store(home), '.login-'));
    const config = join(home, 'config.toml');
    try {
        if (existsSync(config))
            atomicWrite(
                join(temporary, 'config.toml'),
                readFileSync(config, 'utf8')
            );
    } catch (error) {
        rmSync(temporary, { recursive: true, force: true });
        throw error;
    }
    return temporary;
}

export function finishAccountLogin(
    home: string,
    name: string,
    temporary: string
): void {
    const raw = credentials(temporary);
    if (raw === null)
        throw new ShannonError(
            'Codex did not write file-based credentials; the profile login was left unchanged'
        );
    const current = activeAccount(home);
    writeCredentials(accountHome(home, name), raw);
    if (!current || current === name) {
        atomicWrite(
            join(store(home), PENDING),
            JSON.stringify({ target: name })
        );
        recoverSwitch(home);
    }
}
