import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE, CODEX, providerForExecutable } from '../src/core/provider.js';
import { dataDir, defaultFile, profileDir } from '../src/core/paths.js';
import {
    clearDefault,
    copyProfile,
    createProfile,
    deleteProfile,
    getDefault,
    listProfiles,
    resolveActive,
    setDefault
} from '../src/core/profiles.js';
import { findMarker, resolveAuto } from '../src/core/autodir.js';
import {
    alreadyInstalled,
    blockToAppend,
    integrationLine
} from '../src/core/integration.js';
import { initSnippet } from '../src/core/shell.js';

const binDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function sandbox(t: TestContext): { root: string; env: NodeJS.ProcessEnv } {
    const root = mkdtempSync(join(tmpdir(), 'shannon-gpt-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        LOCALAPPDATA: root,
        XDG_DATA_HOME: root,
        SHANNON_NO_UPDATE_CHECK: '1',
        NO_COLOR: '1'
    };
    for (const key of [
        'CODEX_HOME',
        'CLAUDE_CONFIG_DIR',
        'GPT_AUTO',
        'SHANNON_AUTO'
    ]) {
        delete env[key];
    }
    return { root, env };
}

function cli(args: string[], env: NodeJS.ProcessEnv, command = 'gpt') {
    return spawnSync(
        process.execPath,
        [join(binDir, command === 'gpt' ? 'gpt.js' : 'cli.js'), ...args],
        { env, encoding: 'utf8' }
    );
}

test('Codex profiles, defaults, overrides, and deletes are independent of Claude', t => {
    const { env } = sandbox(t);
    const claude = createProfile('work', env);
    const codex = createProfile('work', env, CODEX);
    assert.notEqual(claude, codex);
    assert.equal(codex, join(dataDir(env, CODEX), 'work'));
    setDefault('work', env);
    setDefault('work', env, CODEX);
    assert.equal(readFileSync(defaultFile(env, CODEX), 'utf8'), 'work');
    assert.equal(resolveActive(env).dir, claude);
    assert.equal(
        resolveActive({ ...env, CLAUDE_CONFIG_DIR: claude }, CODEX).dir,
        codex
    );
    assert.equal(
        resolveActive({ ...env, CODEX_HOME: '/custom/codex' }, CODEX).dir,
        '/custom/codex'
    );
    createProfile('personal', env, CODEX);
    assert.deepEqual(listProfiles(env, CODEX), ['personal', 'work']);
    assert.deepEqual(listProfiles(env), ['work']);
    deleteProfile('work', env, CODEX);
    clearDefault(env, CODEX);
    assert.equal(getDefault(env, CODEX), null);
    assert.equal(getDefault(env), 'work');
    assert.ok(existsSync(claude));
});

test('Codex clone omits auth.json unless credentials are explicitly requested', t => {
    const { env } = sandbox(t);
    const source = createProfile('work', env, CODEX);
    writeFileSync(join(source, 'auth.json'), 'test-secret');
    writeFileSync(join(source, 'config.toml'), 'model = "example"');
    const copy = copyProfile('work', 'copy', {}, env, CODEX);
    assert.equal(existsSync(join(copy, 'auth.json')), false);
    assert.equal(
        readFileSync(join(copy, 'config.toml'), 'utf8'),
        'model = "example"'
    );
    const withAuth = copyProfile(
        'work',
        'with-auth',
        { withCredentials: true },
        env,
        CODEX
    );
    assert.equal(
        readFileSync(join(withAuth, 'auth.json'), 'utf8'),
        'test-secret'
    );
});

test('Codex markers and auto-selection state do not collide with Shannon', t => {
    const { root, env } = sandbox(t);
    createProfile('personal', env, CODEX);
    createProfile('work', env);
    const project = join(root, 'project');
    const nested = join(project, 'nested');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(project, '.shannon'), 'work');
    writeFileSync(join(project, '.gpt'), 'personal');
    assert.equal(findMarker(nested, CODEX), 'personal');
    assert.equal(findMarker(nested), 'work');
    assert.deepEqual(resolveAuto(nested, env, CODEX), {
        kind: 'set',
        name: 'personal',
        dir: profileDir('personal', env, CODEX)
    });
    assert.deepEqual(
        resolveAuto(root, { ...env, GPT_AUTO: 'personal' }, CODEX),
        { kind: 'unset' }
    );
    assert.deepEqual(
        resolveAuto(root, { ...env, SHANNON_AUTO: 'work' }, CODEX),
        { kind: 'none' }
    );
    for (const marker of ['', '../escape', 'missing']) {
        writeFileSync(join(nested, '.gpt'), marker);
        assert.equal(findMarker(nested, CODEX), marker || null);
        assert.deepEqual(resolveAuto(nested, env, CODEX), { kind: 'none' });
    }
});

test('gpt entry point manages profiles, emits CODEX_HOME, and reports its own usage', t => {
    const { env } = sandbox(t);
    const run = (args: string[], command = 'gpt') => {
        const r = cli(args, env, command);
        assert.equal(r.status, 0, r.stderr);
        return r;
    };
    assert.match(run([]).stdout, /No active profile/);
    assert.match(run(['help']).stdout, /gpt.*Codex CLI/);
    assert.match(run(['create', 'work']).stdout, /codex-profiles/);
    run(['default', 'work']);
    assert.equal(run(['default']).stdout.trim(), 'work');
    assert.equal(run(['which']).stdout.trim(), profileDir('work', env, CODEX));
    assert.match(run(['list']).stdout, />\* work/);
    assert.match(
        run(['use', 'work', '--emit', 'pwsh']).stdout,
        /^\$env:CODEX_HOME = '/
    );
    assert.match(
        run(['use', 'work', '--emit', 'fish']).stdout,
        /^set -gx CODEX_HOME /
    );
    run(['create', 'copy', '--from', 'work']);
    run(['clone', 'work', 'another']);
    run(['delete', 'work', '--yes']);
    assert.match(run(['status']).stdout, /No default profile set/);
    assert.match(run(['list'], 'shannon').stdout, /No profiles found/);
    assert.match(
        cli(['use', 'missing'], env).stderr,
        /^gpt:.*gpt create missing/
    );
    assert.equal(cli(['use'], env).status, 1);
});

test('gpt setup and shell snippets use independent commands and hooks', () => {
    for (const shell of ['bash', 'zsh', 'fish', 'pwsh'] as const) {
        const line = integrationLine(shell, 'gpt');
        assert.match(line, /gpt init/);
        assert.equal(alreadyInstalled(blockToAppend(shell), 'gpt'), false);
        assert.equal(
            alreadyInstalled(blockToAppend(shell, 'gpt'), 'shannon'),
            false
        );
        assert.equal(
            alreadyInstalled(blockToAppend(shell, 'gpt'), 'gpt'),
            true
        );
        const snippet = initSnippet(shell, CODEX)!;
        assert.match(snippet, / __auto /);
        assert.match(snippet, /--emit /);
        assert.doesNotMatch(
            snippet,
            /Set-Alias -Name clp|function clp|clp\(\)/
        );
    }
    assert.equal(initSnippet('unsupported', CODEX), null);
    assert.equal(providerForExecutable('/bin/gpt'), CODEX);
    assert.equal(providerForExecutable(join('somewhere', 'GPT.exe')), CODEX);
    assert.equal(providerForExecutable('/bin/clp'), CLAUDE);
});

/** Fake the real CLI so passthrough is checked without logging in or making requests. */
function fakeCodex(root: string, binary = 'codex'): string {
    const bin = join(root, 'fake bin');
    mkdirSync(bin);
    const script = join(bin, 'capture.cjs');
    writeFileSync(
        script,
        `const fs = require('node:fs'); fs.writeFileSync(process.env.GPT_CAPTURE, JSON.stringify({ args: process.argv.slice(2), home: process.env.CODEX_HOME, claude: process.env.CLAUDE_CONFIG_DIR })); process.exit(Number(process.env.GPT_EXIT || 0));`
    );
    if (process.platform === 'win32') {
        writeFileSync(
            join(bin, `${binary}.cmd`),
            `@"${process.execPath}" "${script}" %*\r\n`
        );
    } else {
        writeFileSync(
            join(bin, binary),
            `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${script.replaceAll("'", "'\\''")}' "$@"\n`
        );
        chmodSync(join(bin, binary), 0o755);
    }
    return bin;
}

test('Claude launch keeps its profile, literal arguments, and exit status without Codex flags', t => {
    const { root, env } = sandbox(t);
    const bin = fakeCodex(root, 'claude');
    env.PATH = bin + delimiter + (env.PATH ?? env.Path ?? '');
    env.PATHEXT = '.EXE;.CMD';
    env.GPT_CAPTURE = join(root, 'capture.json');
    env.CODEX_HOME = join(root, 'unchanged-codex-home');
    const home = createProfile('work', env, CLAUDE);
    setDefault('work', env, CLAUDE);
    const args = ['-p', 'a prompt with "quotes" & literal symbols', ''];
    const result = cli(['run', ...args], env, 'shannon');
    assert.equal(result.status, 0, result.stderr);
    const captured = JSON.parse(readFileSync(env.GPT_CAPTURE, 'utf8'));
    assert.deepEqual(captured.args, args);
    assert.equal(captured.claude, home);
    assert.equal(captured.home, env.CODEX_HOME);
    env.GPT_EXIT = '17';
    assert.equal(cli(['run'], env, 'shannon').status, 17);
});

test('gpt launches Codex with its selected home, literal args, and child exit status', t => {
    const { root, env } = sandbox(t);
    const bin = fakeCodex(root);
    env.PATH = bin + delimiter + (env.PATH ?? env.Path ?? '');
    env.PATHEXT = '.EXE;.CMD';
    env.GPT_CAPTURE = join(root, 'capture.json');
    env.CLAUDE_CONFIG_DIR = '/unchanged/claude';
    createProfile('personal', env, CODEX);
    setDefault('personal', env, CODEX);
    const args = [
        'exec',
        'hello world',
        'a&b|c',
        'say "hello"',
        '',
        'C:\\with space\\',
        '%GPT_TEST_VALUE%',
        '(nested)',
        'x^y',
        '!bang!'
    ];
    env.GPT_TEST_VALUE = 'MUST_NOT_EXPAND';
    for (const prefix of [['run'], ['--'], []]) {
        const result = cli([...prefix, ...args], env);
        assert.equal(result.status, 0, result.stderr);
        const captured = JSON.parse(readFileSync(env.GPT_CAPTURE, 'utf8'));
        assert.deepEqual(captured.args, [
            '-c',
            "cli_auth_credentials_store='file'",
            ...args
        ]);
        assert.equal(captured.home, profileDir('personal', env, CODEX));
        assert.equal(captured.claude, '/unchanged/claude');
    }
    env.GPT_EXIT = '17';
    assert.equal(cli(['run'], env).status, 17);
    env.CODEX_HOME = join(root, 'explicit');
    assert.equal(cli(['login', 'status'], { ...env, GPT_EXIT: '0' }).status, 0);
    assert.equal(
        JSON.parse(readFileSync(env.GPT_CAPTURE, 'utf8')).home,
        env.CODEX_HOME
    );
});

test('gpt without a profile preserves native Codex defaults and reports missing Codex', t => {
    const { root, env } = sandbox(t);
    const bin = fakeCodex(root);
    env.PATH = bin;
    env.PATHEXT = '.CMD';
    env.GPT_CAPTURE = join(root, 'capture.json');
    assert.equal(cli(['login', 'status'], env).status, 0);
    const captured = JSON.parse(readFileSync(env.GPT_CAPTURE, 'utf8'));
    assert.deepEqual(captured.args, ['login', 'status']);
    assert.equal(captured.home, undefined);
    const missing = cli(['run'], { ...env, PATH: root });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /gpt: 'codex' binary not found/);
});

function installTestCommands(root: string): string {
    const bin = join(root, 'commands');
    mkdirSync(bin);
    for (const command of ['gpt', 'shannon']) {
        const script = join(binDir, command === 'gpt' ? 'gpt.js' : 'cli.js');
        const file = join(
            bin,
            command + (process.platform === 'win32' ? '.cmd' : '')
        );
        writeFileSync(
            file,
            process.platform === 'win32'
                ? `@"${process.execPath}" "${script}" %*\r\n`
                : `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`
        );
        chmodSync(file, 0o755);
    }
    return bin;
}

test('PowerShell integrations coexist, reload, and auto-select both accounts', t => {
    const probe = spawnSync('pwsh', [
        '-NoProfile',
        '-Command',
        '$PSVersionTable.PSVersion.Major'
    ]);
    if (probe.error) return t.skip('PowerShell is not installed');
    const { root, env } = sandbox(t);
    const bin = installTestCommands(root);
    env.PATH = bin + delimiter + (env.PATH ?? env.Path ?? '');
    const project = join(root, 'project with spaces');
    mkdirSync(project);
    for (const provider of [CLAUDE, CODEX]) {
        createProfile('work', env, provider);
        createProfile('personal', env, provider);
        writeFileSync(join(project, provider.marker), 'work');
    }
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const session = join(root, 'session.ps1');
    writeFileSync(
        session,
        `
$ErrorActionPreference = 'Stop'
function prompt { 'original prompt' }
${initSnippet('pwsh', CLAUDE)}
${initSnippet('pwsh', CODEX)}
${initSnippet('pwsh', CLAUDE)}
${initSnippet('pwsh', CODEX)}
Set-Location ${quote(project)}
if ((prompt) -ne 'original prompt') { throw 'original prompt was lost' }
if ($env:CODEX_HOME -ne ${quote(profileDir('work', env, CODEX))}) { throw 'wrong Codex auto-selection' }
if ($env:CLAUDE_CONFIG_DIR -ne ${quote(profileDir('work', env))}) { throw 'wrong Claude auto-selection' }
gpt use personal
if ($LASTEXITCODE -ne 0) { throw 'use failed' }
$null = prompt
if ($env:CODEX_HOME -ne ${quote(profileDir('personal', env, CODEX))}) { throw 'manual selection was lost' }
if ($env:CLAUDE_CONFIG_DIR -ne ${quote(profileDir('work', env))}) { throw 'Claude selection changed' }
gpt use missing
if ($LASTEXITCODE -ne 1) { throw 'missing profile should fail' }
if ($env:CODEX_HOME -ne ${quote(profileDir('personal', env, CODEX))}) { throw 'failed use changed profile' }
Set-Location ${quote(root)}
$null = prompt
if ($env:CODEX_HOME -or $env:CLAUDE_CONFIG_DIR) { throw 'auto-selection was not cleared' }
'integration ok'
`
    );
    const result = spawnSync('pwsh', ['-NoProfile', '-File', session], {
        env,
        encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /integration ok/);
});
