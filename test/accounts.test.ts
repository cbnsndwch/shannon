import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ACCOUNT_DIR,
    ACCOUNT_LOCK,
    activeAccount,
    finishAccountLogin,
    listAccounts,
    nextAccount,
    prepareAccountLogin,
    saveAccount,
    syncActiveAccount,
    unlockAccounts,
    useAccount,
    withAccountLock
} from '../src/core/accounts.js';
import {
    copyProfile,
    createProfile,
    deleteProfile,
    resolveActive,
    setDefault
} from '../src/core/profiles.js';
import { CODEX } from '../src/core/provider.js';

const entry = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'src',
    'gpt.js'
);

function fixture(t: TestContext) {
    const root = mkdtempSync(join(tmpdir(), 'shannon-accounts-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        LOCALAPPDATA: root,
        XDG_DATA_HOME: root,
        SHANNON_NO_UPDATE_CHECK: '1',
        NO_COLOR: '1'
    };
    delete env.CODEX_HOME;
    const home = createProfile('client', env, CODEX);
    setDefault('client', env, CODEX);
    return { root, home, env };
}

function auth(name: string): string {
    return JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
            account_id: name,
            access_token: `test-access-${name}`,
            refresh_token: `test-refresh-${name}`
        }
    });
}

function current(home: string): string {
    return readFileSync(join(home, 'auth.json'), 'utf8');
}

function addLogin(home: string, name: string): void {
    const temporary = prepareAccountLogin(home, name);
    try {
        writeFileSync(join(temporary, 'auth.json'), auth(name));
        finishAccountLogin(home, name, temporary);
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}

function twoLogins(home: string): void {
    withAccountLock(home, () => {
        addLogin(home, 'primary');
        addLogin(home, 'secondary');
    });
}

test('named logins share one context and retain refreshed credentials when switching', t => {
    const { home } = fixture(t);
    writeFileSync(join(home, 'config.toml'), 'model = "test-model"');
    writeFileSync(join(home, 'history.jsonl'), '{"text":"client context"}\n');
    mkdirSync(join(home, 'sessions'));
    writeFileSync(
        join(home, 'sessions', 'saved.jsonl'),
        '{"text":"saved conversation"}\n'
    );
    twoLogins(home);
    assert.equal(activeAccount(home), 'primary');
    assert.equal(current(home), auth('primary'));
    writeFileSync(join(home, 'auth.json'), auth('primary-refreshed'));
    withAccountLock(home, () => useAccount(home, 'secondary'));
    assert.equal(current(home), auth('secondary'));
    assert.equal(
        readFileSync(join(home, ACCOUNT_DIR, 'primary', 'auth.json'), 'utf8'),
        auth('primary-refreshed')
    );
    withAccountLock(home, () => useAccount(home, 'primary'));
    assert.equal(current(home), auth('primary-refreshed'));
    assert.equal(
        withAccountLock(home, () => nextAccount(home)),
        'secondary'
    );
    assert.equal(
        withAccountLock(home, () => nextAccount(home)),
        'primary'
    );
    assert.equal(
        readFileSync(join(home, 'config.toml'), 'utf8'),
        'model = "test-model"'
    );
    assert.equal(
        readFileSync(join(home, 'history.jsonl'), 'utf8'),
        '{"text":"client context"}\n'
    );
    assert.equal(
        readFileSync(join(home, 'sessions', 'saved.jsonl'), 'utf8'),
        '{"text":"saved conversation"}\n'
    );
});

test('existing logins must be saved before adding another, and malformed secrets never reach errors', t => {
    const { home } = fixture(t);
    writeFileSync(join(home, 'auth.json'), auth('existing'));
    assert.throws(
        () => prepareAccountLogin(home, 'secondary'),
        /save the existing/
    );
    withAccountLock(home, () => saveAccount(home, 'primary'));
    assert.equal(activeAccount(home), 'primary');
    assert.throws(() => saveAccount(home, 'another'), /already named/);
    assert.throws(() => useAccount(home, '../escape'), /invalid profile name/);
    assert.throws(() => useAccount(home, 'missing'), /no saved credentials/);
    addLogin(home, 'secondary');
    writeFileSync(
        join(home, ACCOUNT_DIR, 'secondary', 'auth.json'),
        '{"secret":"DO_NOT_SHOW"'
    );
    assert.throws(
        () => useAccount(home, 'secondary'),
        error => {
            assert.doesNotMatch(String(error), /DO_NOT_SHOW/);
            return /invalid Codex auth.json/.test(String(error));
        }
    );
    assert.equal(current(home), auth('existing'));
    assert.equal(activeAccount(home), 'primary');
});

test('logging out invalidates the saved slot and cannot resurrect cached credentials', t => {
    const { home } = fixture(t);
    twoLogins(home);
    rmSync(join(home, 'auth.json'));
    withAccountLock(home, () => syncActiveAccount(home));
    assert.equal(
        listAccounts(home).find(account => account.name === 'primary')!
            .signedIn,
        false
    );
    assert.throws(() => useAccount(home, 'primary'), /signed out/);
    assert.throws(() => nextAccount(home), /at least two/);
    withAccountLock(home, () => useAccount(home, 'secondary'));
    assert.throws(() => useAccount(home, 'primary'), /no saved credentials/);
    assert.equal(current(home), auth('secondary'));
});

test('clones omit every saved login by default and never copy runtime locks', t => {
    const { home, env } = fixture(t);
    twoLogins(home);
    writeFileSync(join(home, 'history.jsonl'), 'client context');
    const clean = copyProfile('client', 'clean', {}, env, CODEX);
    assert.equal(existsSync(join(clean, 'auth.json')), false);
    assert.equal(existsSync(join(clean, ACCOUNT_DIR)), false);
    assert.equal(
        readFileSync(join(clean, 'history.jsonl'), 'utf8'),
        'client context'
    );
    const withAuth = copyProfile(
        'client',
        'with-auth',
        { withCredentials: true },
        env,
        CODEX
    );
    assert.equal(current(withAuth), auth('primary'));
    assert.equal(listAccounts(withAuth).length, 2);
    assert.equal(existsSync(join(withAuth, ACCOUNT_LOCK)), false);
    withAccountLock(home, () => {
        assert.throws(
            () => copyProfile('client', 'busy-copy', {}, env, CODEX),
            /profile is in use/
        );
        assert.throws(
            () => deleteProfile('client', env, CODEX),
            /profile is in use/
        );
        assert.throws(() => unlockAccounts(home), /still in use/);
    });
    assert.equal(existsSync(join(home, ACCOUNT_LOCK)), false);
});

test('interrupted account switches recover before launching; invalid journals fail without changing auth', t => {
    const { home } = fixture(t);
    twoLogins(home);
    const pending = join(home, ACCOUNT_DIR, 'pending-switch.json');
    writeFileSync(pending, JSON.stringify({ target: 'secondary' }));
    withAccountLock(home, () => {
        assert.equal(activeAccount(home), 'secondary');
        assert.equal(current(home), auth('secondary'));
    });
    assert.equal(existsSync(pending), false);
    writeFileSync(pending, JSON.stringify({ target: '../escape' }));
    assert.throws(
        () => withAccountLock(home, () => assert.fail('must not run')),
        /invalid pending/
    );
    assert.equal(current(home), auth('secondary'));
    assert.equal(existsSync(join(home, ACCOUNT_LOCK)), false);
});

test('explicit unlock recovers a crashed launcher and requires confirmation in the CLI', t => {
    const { home, env } = fixture(t);
    const exited = spawnSync(
        process.execPath,
        ['-e', 'process.stdout.write(String(process.pid))'],
        { encoding: 'utf8' }
    );
    assert.equal(exited.status, 0);
    mkdirSync(join(home, ACCOUNT_LOCK));
    writeFileSync(join(home, ACCOUNT_LOCK, 'owner'), exited.stdout);
    assert.equal(cli(['account', 'unlock'], env).status, 1);
    assert.ok(existsSync(join(home, ACCOUNT_LOCK)));
    const result = cli(['account', 'unlock', '--yes'], env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(home, ACCOUNT_LOCK)), false);
});

function mockCodex(root: string): string {
    const bin = join(root, 'mock bin');
    mkdirSync(bin);
    const script = join(bin, 'mock.cjs');
    writeFileSync(
        script,
        `
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2), home = process.env.CODEX_HOME;
const file = path.join(home, 'auth.json');
if (args.includes('login')) {
    if (process.env.TEST_LOGIN_FAIL) process.exit(9);
    if (!process.env.TEST_LOGIN_NO_AUTH) fs.writeFileSync(file, process.env.TEST_LOGIN_AUTH);
} else {
    const raw = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(process.env.TEST_CAPTURE, JSON.stringify({ args, home, auth: raw, locked: fs.existsSync(path.join(home, '${ACCOUNT_LOCK}')) }));
    if (process.env.TEST_REFRESH_AUTH) fs.writeFileSync(file, process.env.TEST_REFRESH_AUTH);
}
if (process.env.TEST_READY) {
    fs.writeFileSync(process.env.TEST_READY, 'ready');
    const timer = setInterval(() => {
        if (fs.existsSync(process.env.TEST_RELEASE)) { clearInterval(timer); process.exit(0); }
    }, 20);
    setTimeout(() => process.exit(3), 10000);
}
`
    );
    const executable = join(
        bin,
        process.platform === 'win32' ? 'codex.cmd' : 'codex'
    );
    writeFileSync(
        executable,
        process.platform === 'win32'
            ? `@"${process.execPath}" "${script}" %*\r\n`
            : `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`
    );
    chmodSync(executable, 0o755);
    return bin;
}

function cli(args: string[], env: NodeJS.ProcessEnv) {
    return spawnSync(process.execPath, [entry, ...args], {
        env,
        encoding: 'utf8'
    });
}

test('CLI stages logins, switches and resumes in the original home, and preserves failed-login state', t => {
    const { root, home, env } = fixture(t);
    env.PATH = mockCodex(root) + delimiter + (env.PATH ?? env.Path ?? '');
    env.PATHEXT = '.EXE;.CMD';
    env.TEST_CAPTURE = join(root, 'capture.json');
    env.TEST_LOGIN_AUTH = auth('primary');
    assert.equal(cli(['account', 'login', 'primary'], env).status, 0);
    env.TEST_LOGIN_AUTH = auth('secondary');
    assert.equal(
        cli(['account', 'login', 'secondary', '--device-auth'], env).status,
        0
    );
    assert.equal(activeAccount(home), 'primary');
    assert.equal(current(home), auth('primary'));
    assert.match(cli(['status'], env).stdout, /Active login: primary/);
    assert.match(cli(['account', 'list'], env).stdout, /> primary/);
    env.TEST_REFRESH_AUTH = auth('secondary-refreshed');
    const resume = cli(['account', 'use', 'secondary', '--resume'], env);
    assert.equal(resume.status, 0, resume.stderr);
    const captured = JSON.parse(readFileSync(env.TEST_CAPTURE, 'utf8'));
    assert.equal(captured.home, home);
    assert.equal(captured.auth, auth('secondary'));
    assert.equal(captured.locked, true);
    assert.deepEqual(captured.args, [
        '-c',
        "cli_auth_credentials_store='file'",
        '--no-daemon',
        'resume',
        '--last'
    ]);
    assert.equal(
        readFileSync(join(home, ACCOUNT_DIR, 'secondary', 'auth.json'), 'utf8'),
        auth('secondary-refreshed')
    );
    delete env.TEST_REFRESH_AUTH;
    assert.equal(cli(['account', 'next', '--resume'], env).status, 0);
    assert.equal(current(home), auth('primary'));
    env.TEST_LOGIN_FAIL = '1';
    assert.equal(cli(['account', 'login', 'secondary'], env).status, 9);
    delete env.TEST_LOGIN_FAIL;
    env.TEST_LOGIN_NO_AUTH = '1';
    assert.equal(cli(['account', 'login', 'secondary'], env).status, 1);
    assert.equal(current(home), auth('primary'));
    assert.equal(
        readFileSync(join(home, ACCOUNT_DIR, 'secondary', 'auth.json'), 'utf8'),
        auth('secondary-refreshed')
    );
    assert.equal(
        readdirSync(join(home, ACCOUNT_DIR)).some(name =>
            name.startsWith('.login-')
        ),
        false
    );
    assert.equal(cli(['account', 'use', 'missing', '--typo'], env).status, 1);
    assert.doesNotMatch(
        resume.stdout + resume.stderr,
        /test-access|test-refresh/
    );
    const custom = join(root, 'unmanaged');
    mkdirSync(custom);
    assert.equal(
        cli(['account', 'list'], { ...env, CODEX_HOME: custom }).status,
        1
    );
    const nested = join(home, 'nested');
    mkdirSync(nested);
    assert.equal(
        resolveActive({ ...env, CODEX_HOME: nested }, CODEX).name,
        null
    );
});

test('another terminal cannot switch, clone, delete, or unlock while a Codex session runs', async t => {
    const { root, home, env } = fixture(t);
    twoLogins(home);
    env.PATH = mockCodex(root) + delimiter + (env.PATH ?? env.Path ?? '');
    env.PATHEXT = '.EXE;.CMD';
    env.TEST_CAPTURE = join(root, 'capture.json');
    const ready = join(root, 'ready');
    const release = join(root, 'release');
    const child = spawn(process.execPath, [entry, 'run'], {
        env: { ...env, TEST_READY: ready, TEST_RELEASE: release },
        stdio: 'pipe'
    });
    let stderr = '';
    child.stderr.on('data', data => {
        stderr += data;
    });
    const ended = new Promise<number | null>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
    });
    try {
        const deadline = Date.now() + 5000;
        while (!existsSync(ready) && Date.now() < deadline)
            await new Promise(resolve => setTimeout(resolve, 20));
        assert.ok(existsSync(ready), stderr || 'fake Codex did not start');
        for (const args of [
            ['account', 'use', 'secondary'],
            ['clone', 'client', 'blocked'],
            ['delete', 'client', '--yes'],
            ['account', 'unlock', '--yes']
        ]) {
            const result = cli(args, env);
            assert.equal(result.status, 1, result.stderr);
            assert.match(result.stderr, /in use/);
        }
        assert.equal(current(home), auth('primary'));
        writeFileSync(release, 'release');
        assert.equal(await ended, 0, stderr);
        assert.equal(cli(['account', 'use', 'secondary'], env).status, 0);
        assert.equal(current(home), auth('secondary'));
    } finally {
        writeFileSync(release, 'release');
        await ended;
    }
});
