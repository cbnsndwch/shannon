import { spawnSync } from 'node:child_process';
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync
} from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
    clearDefault,
    copyProfile,
    createProfile,
    deleteProfile,
    getDefault,
    listProfiles,
    profileExists,
    resolveActive,
    setDefault
} from './core/profiles.js';
import { profileDir } from './core/paths.js';
import { assertValidName } from './core/validate.js';
import { resolveAuto } from './core/autodir.js';
import { ShannonError } from './core/errors.js';
import { launch } from './launch.js';
import { CLAUDE, CODEX, type Provider } from './core/provider.js';
import {
    accountsEnabled,
    activeAccount,
    finishAccountLogin,
    listAccounts,
    nextAccount,
    prepareAccountLogin,
    saveAccount,
    unlockAccounts,
    useAccount,
    withAccountLock
} from './core/accounts.js';
import { initSnippet } from './core/shell.js';
import { banner } from './banner.js';
import {
    isNewer,
    pendingUpdate,
    refreshCache,
    refreshInBackground,
    updatesDisabled
} from './core/updates.js';
import {
    type Shell,
    SUPPORTED_SHELLS,
    alreadyInstalled,
    blockToAppend,
    detectShell,
    integrationLine,
    isSupportedShell,
    startupFile
} from './core/integration.js';
import { bold, cyan, dim, green, yellow } from './core/style.js';
import { flavorFor, highlight } from './core/highlight.js';

// Single-sourced against package.json by test/version.test.ts, so a release
// bump cannot ship a stale self-reported version on npm or the SEA binaries.
export const VERSION = '0.2.0-rc.1';

/** First tokens that mean "manage profiles" rather than "launch claude". */
const MANAGEMENT = new Set<string>([
    'create',
    'list',
    'ls',
    'default',
    'which',
    'delete',
    'rm',
    'use',
    'clone',
    'status',
    'st',
    'init',
    'setup',
    'update',
    'upgrade',
    'help',
    '-h',
    '--help',
    '--version',
    '-v',
    '-V',
    // Internal: invoked by the `shannon init` shell hooks and the detached
    // update-check spawn respectively, not by users.
    '__auto',
    '__check-updates'
]);

/**
 * Commands that must never have an update CTA appended: the shell-integration
 * hooks emit eval'd code to stdout (a stray line would break them), and the
 * update commands speak for themselves.
 */
const NO_UPDATE_NOTICE = new Set<string>([
    '__auto',
    '__check-updates',
    'update',
    'upgrade'
]);

export async function dispatch(
    argv: string[],
    provider: Provider = CLAUDE
): Promise<number> {
    const cmd = argv[0];

    // Passive update check: on any ordinary interactive invocation, refresh the
    // cached "latest" in a detached background process (never blocking) and
    // append a one-line CTA afterward if a newer release is known. Suppressed
    // for the shell hooks, for `use --emit`, and when stderr isn't a TTY so it
    // can't corrupt eval'd output or spam pipes/scripts.
    const notice =
        cmd !== undefined &&
        !NO_UPDATE_NOTICE.has(cmd) &&
        !(cmd === 'use' && argv.includes('--emit')) &&
        process.stderr.isTTY &&
        !updatesDisabled();
    if (notice) refreshInBackground();
    const code = await route(argv, provider);
    if (notice) emitUpdateNotice(provider);
    return code;
}

async function route(argv: string[], provider: Provider): Promise<number> {
    const cmd = argv[0];

    // A bare invocation (`shannon` / `claudep` / `clp` with no args) shows
    // profile status, matching the original shell tool — it never launches
    // claude implicitly. Launching is always explicit: `run`, `--`, or any
    // token that isn't one of our subcommands is passed straight through.
    if (cmd === undefined) return safe(() => cmdStatus(provider), provider);
    if (cmd === 'run' || cmd === '--') {
        return safe(
            () => launch(argv.slice(1), process.env, provider),
            provider
        );
    }
    if (cmd === 'account' && provider === CODEX) {
        return safe(() => cmdAccount(argv.slice(1)), provider);
    }
    if (!MANAGEMENT.has(cmd)) {
        return safe(() => launch(argv, process.env, provider), provider);
    }

    return safe(async () => {
        switch (cmd) {
            case 'create':
                return cmdCreate(argv.slice(1), provider);
            case 'list':
            case 'ls':
                return cmdList(provider);
            case 'default':
                return cmdDefault(argv.slice(1), provider);
            case 'which':
                return cmdWhich(argv.slice(1), provider);
            case 'delete':
            case 'rm':
                return cmdDelete(argv.slice(1), provider);
            case 'use':
                return cmdUse(argv.slice(1), provider);
            case 'clone':
                return cmdClone(argv.slice(1), provider);
            case 'status':
            case 'st':
                return cmdStatus(provider);
            case 'init':
                return cmdInit(argv.slice(1), provider);
            case 'setup':
                return cmdSetup(argv.slice(1), provider);
            case 'update':
            case 'upgrade':
                return cmdUpdate();
            case '__check-updates':
                return cmdCheckUpdates();
            case '__auto':
                return cmdAuto(argv.slice(1), provider);
            case 'help':
            case '-h':
            case '--help':
                return printHelp(provider);
            case '--version':
            case '-v':
            case '-V':
                return printVersion();
            default:
                return printHelp(provider);
        }
    }, provider);
}

async function safe(
    fn: () => number | Promise<number>,
    provider: Provider
): Promise<number> {
    try {
        return await fn();
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`${provider.command}: ${msg}\n`);
        return 1;
    }
}

function cmdCreate(args: string[], provider: Provider): number {
    const { name, from, withCredentials, hasFrom } = parseCreate(args);
    if (!name) {
        throw new ShannonError(
            `usage: ${provider.command} create <name> [--from <src> [--with-credentials]]`
        );
    }

    // `create --from <src>` copies an existing profile, exactly like `clone`
    // (same shared copy routine, same credential handling and error messages).
    if (hasFrom) {
        if (!from) {
            throw new ShannonError(
                `usage: ${provider.command} create <name> --from <src> [--with-credentials]`
            );
        }
        const dir = copyProfile(
            from,
            name,
            { withCredentials },
            process.env,
            provider
        );
        process.stdout.write(`Created profile: ${name} (from '${from}')\n`);
        printCopyResult(dir, withCredentials);
        return 0;
    }

    // The credentials flag only makes sense when copying a source profile; reject
    // it on a fresh create rather than silently ignoring it.
    if (withCredentials) {
        throw new ShannonError(
            "--with-credentials only applies to 'create --from <src>'"
        );
    }

    const dir = createProfile(name, process.env, provider);
    process.stdout.write(`Created profile: ${name}\n`);
    process.stdout.write(`Config directory: ${dir}\n`);
    return 0;
}

/**
 * Print the shared footer for copy operations (`clone` and `create --from`):
 * the new config directory plus, unless credentials were copied, a note that
 * they were omitted.
 */
function printCopyResult(dir: string, withCredentials: boolean): void {
    process.stdout.write(`Config directory: ${dir}\n`);
    if (!withCredentials) {
        process.stdout.write(
            '(credentials omitted — sign in under the new profile, or re-run with --with-credentials)\n'
        );
    }
}

/**
 * Parse `create` args: the first non-flag token is the profile name. `--from
 * <src>` (or `--from=<src>`) selects a source profile to copy; the space-form
 * value is consumed only when it isn't itself a flag, so a missing value
 * surfaces as a usage error instead of swallowing the next option. `hasFrom`
 * distinguishes a missing `--from` from one given without a value.
 * `--with-credentials` includes secret files in a copy. Unknown options are
 * rejected rather than silently ignored, so a typo (e.g. `--form=work`) or a
 * `-`-prefixed name fails loudly instead of producing a blank profile.
 */
function parseCreate(args: string[]): {
    name: string | null;
    from: string | null;
    withCredentials: boolean;
    hasFrom: boolean;
} {
    let name: string | null = null;
    let from: string | null = null;
    let withCredentials = false;
    let hasFrom = false;
    for (let i = 0; i < args.length; i++) {
        const a = args[i]!;
        if (a === '--from' || a.startsWith('--from=')) {
            hasFrom = true;
            if (a.startsWith('--from=')) {
                from = a.slice('--from='.length) || null;
            } else {
                const next = args[i + 1];
                if (next !== undefined && !next.startsWith('-')) {
                    from = next;
                    i++;
                }
            }
            continue;
        }
        if (a === '--with-credentials') {
            withCredentials = true;
            continue;
        }
        if (a.startsWith('-')) {
            throw new ShannonError(`unknown option '${a}' for create`);
        }
        if (name === null) {
            name = a;
        }
    }
    return { name, from, withCredentials, hasFrom };
}

function cmdList(provider: Provider): number {
    const names = listProfiles(process.env, provider);
    if (names.length === 0) {
        process.stdout.write(
            `No profiles found. Create one with: ${provider.command} create <name>\n`
        );
        return 0;
    }
    const def = getDefault(process.env, provider);
    const active = resolveActive(process.env, provider).name;
    for (const name of names) {
        const isDefault = name === def;
        const isActive = name === active;
        let prefix = '  ';
        if (isDefault && isActive) prefix = '>*';
        else if (isDefault) prefix = ' *';
        else if (isActive) prefix = '> ';
        let tag = '';
        if (isDefault && isActive) tag = ' (default, active)';
        else if (isDefault) tag = ' (default)';
        else if (isActive) tag = ' (active)';
        process.stdout.write(`${prefix} ${name}${tag}\n`);
    }
    return 0;
}

function cmdDefault(args: string[], provider: Provider): number {
    const name = args[0];
    if (!name) {
        const def = getDefault(process.env, provider);
        if (!def) {
            throw new ShannonError(
                `no default profile set. Set one with: ${provider.command} default <name>`
            );
        }
        process.stdout.write(`${def}\n`);
        return 0;
    }
    setDefault(name, process.env, provider);
    process.stdout.write(`Default profile set to: ${name}\n`);
    return 0;
}

function cmdWhich(args: string[], provider: Provider): number {
    const name = args[0];
    if (name) {
        assertValidName(name);
        if (!profileExists(name, process.env, provider)) {
            throw new ShannonError(
                `profile '${name}' does not exist. Create it with: ${provider.command} create ${name}`
            );
        }
        process.stdout.write(`${profileDir(name, process.env, provider)}\n`);
        return 0;
    }
    const def = getDefault(process.env, provider);
    if (!def) {
        throw new ShannonError(
            `no default profile set. Use: ${provider.command} default <name>`
        );
    }
    assertValidName(def);
    if (!profileExists(def, process.env, provider)) {
        throw new ShannonError(`default profile '${def}' does not exist`);
    }
    process.stdout.write(`${profileDir(def, process.env, provider)}\n`);
    return 0;
}

async function cmdDelete(args: string[], provider: Provider): Promise<number> {
    const name = args[0];
    if (!name) {
        throw new ShannonError(`usage: ${provider.command} delete <name>`);
    }
    assertValidName(name);
    if (!profileExists(name, process.env, provider)) {
        throw new ShannonError(`profile '${name}' does not exist`);
    }
    const force =
        args.includes('--yes') ||
        args.includes('-y') ||
        args.includes('--force');
    if (
        !force &&
        !(await confirm(`Delete profile "${name}" and all its data? [y/N] `))
    ) {
        process.stdout.write('Cancelled.\n');
        return 0;
    }
    deleteProfile(name, process.env, provider);
    process.stdout.write(`Deleted profile: ${name}\n`);
    if (getDefault(process.env, provider) === name) {
        clearDefault(process.env, provider);
        process.stdout.write(`Cleared default profile (was "${name}")\n`);
    }
    return 0;
}

function cmdUse(args: string[], provider: Provider): number {
    const { name, emit } = parseUse(args);
    if (!name) {
        throw new ShannonError(`usage: ${provider.command} use <name>`);
    }
    assertValidName(name);
    if (!profileExists(name, process.env, provider)) {
        throw new ShannonError(
            `profile '${name}' does not exist. Create it with: ${provider.command} create ${name}`
        );
    }
    const dir = profileDir(name, process.env, provider);

    // Used by the `shannon init` shell functions: emit just the raw export line
    // (on stdout, to be eval'd) and a confirmation (on stderr, for the human).
    if (emit) {
        process.stdout.write(exportLine(emit, provider.configEnv, dir) + '\n');
        process.stderr.write(`Switched to profile: ${name}\n`);
        return 0;
    }

    // Standalone: a child process cannot mutate the parent shell, so show how.
    // The human-facing lines go to stderr; the copy/eval-able export lines go to
    // stdout (plain, so `eval`/redirect capture them cleanly).
    process.stderr.write(`Profile ${bold(name)} → ${dim(dir)}\n`);
    process.stderr.write(
        `For automatic switching, run ${bold(`${provider.command} setup`)} once. ` +
            `Or set it in this shell now:\n`
    );
    process.stdout.write(
        `${exportLine('posix', provider.configEnv, dir)}      # bash / zsh\n`
    );
    process.stdout.write(
        `${exportLine('pwsh', provider.configEnv, dir)}   # PowerShell\n`
    );
    return 0;
}

/**
 * Parse `use` args: the first non-flag token is the profile name; `--emit
 * <shell>` selects the export-line dialect. Consuming the flag's value here
 * keeps it from being mistaken for the profile name (the shell wrappers always
 * append `--emit <shell>`, even to a bare `shannon use`).
 */
function parseUse(args: string[]): {
    name: string | null;
    emit: string | null;
} {
    let name: string | null = null;
    let emit: string | null = null;
    for (let i = 0; i < args.length; i++) {
        const a = args[i]!;
        if (a === '--emit') {
            emit = args[i + 1] ?? null;
            i++;
            continue;
        }
        if (a.startsWith('-')) {
            continue;
        }
        if (name === null) {
            name = a;
        }
    }
    return { name, emit };
}

function cmdClone(args: string[], provider: Provider): number {
    const positional = args.filter(a => !a.startsWith('-'));
    const src = positional[0];
    const dst = positional[1];
    if (!src || !dst) {
        throw new ShannonError(
            `usage: ${provider.command} clone <source> <dest> [--with-credentials]`
        );
    }
    const withCredentials = args.includes('--with-credentials');
    const dir = copyProfile(
        src,
        dst,
        { withCredentials },
        process.env,
        provider
    );
    process.stdout.write(`Cloned '${src}' -> '${dst}'\n`);
    printCopyResult(dir, withCredentials);
    return 0;
}

function cmdStatus(provider: Provider): number {
    printBanner(provider);
    const resolved = resolveActive(process.env, provider);
    if (resolved.name) {
        process.stdout.write(`Active profile: ${resolved.name}\n`);
        process.stdout.write(`Config directory: ${resolved.dir}\n`);
    } else if (resolved.dir) {
        process.stdout.write(
            `Active config directory: ${resolved.dir} (not a managed profile)\n`
        );
    } else {
        process.stdout.write('No active profile\n');
    }
    const def = getDefault(process.env, provider);
    process.stdout.write(
        def ? `Default profile: ${def}\n` : 'No default profile set\n'
    );
    if (provider === CODEX && resolved.dir && accountsEnabled(resolved.dir)) {
        process.stdout.write(
            `Active login: ${activeAccount(resolved.dir) ?? '(none selected)'}\n`
        );
    }
    return 0;
}

function cmdAccount(args: string[]): number {
    const action = args[0] ?? 'list';
    const rest = args.slice(1);
    const usage =
        'usage: gpt account <list|save <name>|login <name> [--device-auth]|use <name> [--resume]|next [--resume]|unlock --yes>';
    if (action === 'help' || action === '--help') {
        process.stdout.write(`gpt account — saved logins for the active profile

  list                       List saved logins (> marks the selected one)
  save <name>                Name and save the profile's existing login
  login <name> [--device-auth]  Sign in to a named login; preserve other logins
  use <name> [--resume]       Select a login; optionally resume the last chat
  next [--resume]            Cycle to the next saved login
  unlock --yes              Recover a crashed launcher's lock after closing Codex

History and settings stay in the same profile. Exit the running Codex session
before switching. --resume continues the latest chat in the current directory.
`);
        return 0;
    }
    const resolved = resolveActive(process.env, CODEX);
    if (!resolved.name || !resolved.dir) {
        throw new ShannonError(
            'select a managed profile first with gpt default <profile> or gpt use <profile>'
        );
    }
    const home = resolved.dir;
    if (action === 'list' || action === 'ls') {
        if (rest.length) throw new ShannonError(usage);
        const accounts = listAccounts(home);
        if (!accounts.length)
            process.stdout.write(
                'No saved logins. Save the current login with gpt account save <name>, or add one with gpt account login <name>.\n'
            );
        for (const account of accounts) {
            process.stdout.write(
                `${account.active ? '>' : ' '} ${account.name}${account.signedIn ? '' : ' (signed out)'}\n`
            );
        }
        return 0;
    }
    if (action === 'unlock') {
        if (rest.length !== 1 || rest[0] !== '--yes') {
            throw new ShannonError(
                'close all Codex processes for this profile, then run: gpt account unlock --yes'
            );
        }
        unlockAccounts(home);
        process.stdout.write('Profile lock cleared.\n');
        return 0;
    }
    if (action === 'save') {
        if (rest.length !== 1 || rest[0]!.startsWith('-'))
            throw new ShannonError(usage);
        withAccountLock(home, () => saveAccount(home, rest[0]!));
        process.stdout.write(`Saved current login as: ${rest[0]}\n`);
        return 0;
    }
    if (action === 'login' || action === 'add') {
        const name = rest[0];
        if (
            !name ||
            name.startsWith('-') ||
            rest.length > 2 ||
            (rest[1] !== undefined && rest[1] !== '--device-auth')
        ) {
            throw new ShannonError(usage);
        }
        return withAccountLock(home, () => {
            const temporary = prepareAccountLogin(home, name);
            try {
                const code = launch(
                    ['login', ...rest.slice(1)],
                    { ...process.env, CODEX_HOME: temporary },
                    CODEX
                );
                if (code !== 0) return code;
                finishAccountLogin(home, name, temporary);
                process.stdout.write(
                    `Saved login: ${name}\nActive login: ${activeAccount(home)}\n`
                );
                return 0;
            } finally {
                rmSync(temporary, { recursive: true, force: true });
            }
        });
    }
    if (action === 'use' || action === 'next') {
        const resume = rest.includes('--resume');
        const positional = rest.filter(arg => arg !== '--resume');
        if (
            rest.filter(arg => arg === '--resume').length > 1 ||
            (action === 'next'
                ? positional.length !== 0
                : positional.length !== 1 || positional[0]!.startsWith('-'))
        ) {
            throw new ShannonError(usage);
        }
        const select = () => {
            let name: string;
            if (action === 'next') name = nextAccount(home);
            else {
                name = positional[0]!;
                useAccount(home, name);
            }
            process.stdout.write(`Selected login: ${name}\n`);
        };
        if (resume)
            return launch(['resume', '--last'], process.env, CODEX, select);
        withAccountLock(home, select);
        process.stdout.write(
            'Continue the saved conversation with: gpt run resume --last\n'
        );
        return 0;
    }
    throw new ShannonError(usage);
}

function cmdInit(args: string[], provider: Provider): number {
    const shell = args[0];
    if (!shell) {
        throw new ShannonError(
            `usage: ${provider.command} init <bash|zsh|fish|pwsh>`
        );
    }
    const snippet = initSnippet(shell, provider);
    if (!snippet) {
        throw new ShannonError(
            `unsupported shell '${shell}'. Supported: bash, zsh, fish, pwsh`
        );
    }
    // Piped/eval (the normal `eval "$(shannon init …)"` path) gets the raw
    // snippet, byte for byte. Shown in a terminal, it's syntax-highlighted and
    // padded so it reads as code rather than a wall — the colour is cosmetic and
    // strips cleanly, so copying it still yields the exact same text.
    if (process.stdout.isTTY) {
        printSnippetPretty(shell, snippet, provider);
    } else {
        process.stdout.write(snippet);
    }
    return 0;
}

/** Render an `init` snippet for human eyes: highlighted, indented, breathing. */
function printSnippetPretty(
    shell: string,
    snippet: string,
    provider: Provider
): void {
    const body = highlight(snippet.replace(/\n+$/, ''), flavorFor(shell))
        .split('\n')
        .map(line => (line ? `    ${line}` : ''))
        .join('\n');
    process.stdout.write(`\n${body}\n\n`);
    process.stdout.write(
        `    ${dim('Tip: run')} ${bold(`${provider.command} setup`)} ${dim('to add this for you.')}\n\n`
    );
}

/**
 * Interactive shell-integration installer. Rather than dumping the full snippet
 * (which belongs at shell-startup, not in the user's hands), it offers to add a
 * single `shannon init` line to the appropriate startup file for them, or to
 * print just that line to paste. Non-interactively it only prints instructions —
 * it never edits a file without a yes.
 */
async function cmdSetup(args: string[], provider: Provider): Promise<number> {
    const requested = args[0];
    let shell: Shell;
    if (requested !== undefined) {
        if (!isSupportedShell(requested)) {
            throw new ShannonError(
                `unsupported shell '${requested}'. Supported: ${SUPPORTED_SHELLS.join(', ')}`
            );
        }
        shell = requested;
    } else {
        shell = detectShell();
    }
    const line = integrationLine(shell, provider.command);
    const file = resolveStartupFile(shell);

    if (
        file &&
        existsSync(file) &&
        alreadyInstalled(readFileSync(file, 'utf8'), provider.command)
    ) {
        process.stdout.write(
            `${green('✓')} Shell integration already set up in ${bold(file)}.\n`
        );
        process.stdout.write(
            dim(`  Restart your shell to pick up any changes.\n`)
        );
        return 0;
    }

    // No prompting unless we have a real terminal both ways — otherwise just
    // show the manual steps so we never edit a file behind the user's back.
    if (!(process.stdin.isTTY && process.stdout.isTTY)) {
        printManualSetup(shell, line, file);
        return 0;
    }

    process.stdout.write(
        `\nSet up ${bold(shell)} integration so ${bold(`${provider.command} use`)} switches the ` +
            `live shell and a ${bold(provider.marker)} file auto-selects a profile per directory.\n\n`
    );
    const choice = await promptMenu([
        file
            ? `Set it up for me   ${dim(`(adds one line to ${file})`)}`
            : 'Set it up for me',
        'Show me the line to add myself',
        'Cancel'
    ]);

    if (choice === 0) {
        if (!file) {
            process.stdout.write(
                yellow(
                    '\nCould not locate your PowerShell $PROFILE automatically.\n'
                )
            );
            printManualSetup(shell, line, file);
            return 0;
        }
        mkdirSync(dirname(file), { recursive: true });
        appendFileSync(file, blockToAppend(shell, provider.command));
        process.stdout.write(
            `\n${green('✓')} Added ${provider.command} integration to ${bold(file)}.\n`
        );
        process.stdout.write(
            dim(
                `  Restart your shell (or run ${reloadHint(shell)}) to activate it.\n`
            )
        );
        return 0;
    }
    if (choice === 1) {
        printManualSetup(shell, line, file);
        return 0;
    }
    process.stdout.write('Cancelled.\n');
    return 0;
}

/** Print the one line and where it goes, for manual copy/paste. */
function printManualSetup(
    shell: Shell,
    line: string,
    file: string | null
): void {
    const where = file ? bold(file) : 'your shell startup file';
    process.stdout.write(`\nAdd this line to ${where}:\n\n`);
    process.stdout.write(`    ${cyan(line)}\n\n`);
    process.stdout.write(
        dim(`Then restart your shell or run ${reloadHint(shell)}.\n`)
    );
}

/** The command to reload a shell's startup file in place. */
function reloadHint(shell: Shell): string {
    switch (shell) {
        case 'pwsh':
            return '. $PROFILE';
        case 'fish':
            return 'source ~/.config/fish/config.fish';
        case 'zsh':
            return 'source ~/.zshrc';
        default:
            return 'source ~/.bashrc';
    }
}

/**
 * Resolve the startup file to edit: the conventional path for POSIX shells, or
 * the live `$PROFILE` for PowerShell (queried by spawning pwsh/powershell, since
 * it varies — e.g. OneDrive-redirected Documents). Null if it can't be found.
 */
function resolveStartupFile(shell: Shell): string | null {
    if (shell !== 'pwsh') return startupFile(shell);
    for (const exe of ['pwsh', 'powershell']) {
        try {
            const r = spawnSync(
                exe,
                [
                    '-NoProfile',
                    '-NoLogo',
                    '-Command',
                    '$PROFILE.CurrentUserCurrentHost'
                ],
                { encoding: 'utf8' }
            );
            if (!r.error && r.status === 0) {
                const path = (r.stdout ?? '').trim();
                if (path) return path;
            }
        } catch {
            // Try the next executable.
        }
    }
    return null;
}

/**
 * Print a numbered menu and return the chosen zero-based index. An empty answer
 * selects the first (recommended) option; out-of-range answers re-prompt.
 */
async function promptMenu(options: string[]): Promise<number> {
    options.forEach((opt, i) =>
        process.stdout.write(`  ${bold(String(i + 1))}  ${opt}\n`)
    );
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout
    });
    try {
        for (;;) {
            const answer = (await rl.question(dim('\nChoose [1]: '))).trim();
            if (answer === '') return 0;
            const n = Number.parseInt(answer, 10);
            if (n >= 1 && n <= options.length) return n - 1;
            process.stdout.write(
                yellow(
                    `Please enter a number between 1 and ${options.length}.\n`
                )
            );
        }
    } finally {
        rl.close();
    }
}

/**
 * Internal: invoked by the `shannon init` directory hook. Emits the shell
 * commands needed to reconcile the auto-selected profile for the working
 * directory passed by the hook (falling back to this process's cwd). PowerShell
 * is the reason the directory is passed explicitly — its location is not always
 * reflected in the spawned process's cwd.
 */
function cmdAuto(args: string[], provider: Provider): number {
    const shell = args[0] ?? 'posix';
    const cwd = args[1] ?? process.cwd();
    const action = resolveAuto(cwd, process.env, provider);
    if (action.kind === 'set') {
        process.stdout.write(
            exportLine(shell, provider.configEnv, action.dir) + '\n'
        );
        process.stdout.write(
            exportLine(shell, provider.autoEnv, action.name) + '\n'
        );
    } else if (action.kind === 'unset') {
        process.stdout.write(unsetLine(shell, provider.configEnv) + '\n');
        process.stdout.write(unsetLine(shell, provider.autoEnv) + '\n');
    }
    return 0;
}

function printVersion(): number {
    process.stdout.write(`${VERSION}\n`);
    return 0;
}

/**
 * Explicit `update` / `upgrade`: do a fresh, awaited registry check (this is
 * the one place a check blocks, because the user asked for it) and report
 * whether a newer release exists, with the commands to get it.
 */
async function cmdUpdate(): Promise<number> {
    process.stdout.write(`Current version: ${VERSION}\n`);
    const latest = await refreshCache(VERSION);
    if (!latest) {
        process.stdout.write(
            'Could not reach the registry to check for updates (offline?).\n'
        );
        return 0;
    }
    if (isNewer(latest, VERSION)) {
        process.stdout.write(
            `Latest version:  ${latest}  (update available)\n\n`
        );
        process.stdout.write(upgradeHint());
    } else {
        process.stdout.write(`You're on the latest version.\n`);
    }
    return 0;
}

/**
 * Internal: the detached background spawn's entry point. Silently refreshes the
 * update cache and exits; its output is discarded by the parent.
 */
async function cmdCheckUpdates(): Promise<number> {
    await refreshCache(VERSION);
    return 0;
}

/** The one-line CTA appended to ordinary commands when an update is pending. */
function emitUpdateNotice(provider: Provider): void {
    const latest = pendingUpdate(VERSION);
    if (!latest) return;
    process.stderr.write(
        `\nA new shannon release is available: ${VERSION} → ${latest}. ` +
            `Run '${provider.command} update' to upgrade.\n`
    );
}

/** Upgrade instructions, shared by the `update` command. */
function upgradeHint(): string {
    return (
        'To upgrade:\n' +
        '  pnpm add -g @cbnsndwch/shannon       # or: npm i -g @cbnsndwch/shannon@latest\n' +
        'Prebuilt binaries: https://github.com/cbnsndwch/shannon/releases/latest\n'
    );
}

function printHelp(provider: Provider): number {
    printBanner(provider);
    process.stdout.write(help(provider));
    return 0;
}

/**
 * Write the portrait banner — but only for a real interactive user. When stdout
 * is captured (a pipe, a script, or the shell-integration wrappers that eval
 * Shannon's output), the portrait would be noise or corrupt the consumed text,
 * so it is suppressed there.
 */
function printBanner(provider: Provider): void {
    if (!process.stdout.isTTY) return;
    process.stdout.write(banner() + '\n');
    process.stdout.write(
        `${bold(cyan(provider.command))} ${dim(`v${VERSION}`)} ` +
            `${dim(`— isolated ${provider.label} configuration profiles`)}\n`
    );
    process.stdout.write(dim(`  ${provider.attribution}\n`));
}

// --- helpers ---

function posixQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

function pwshQuote(s: string): string {
    return `'${s.replace(/'/g, "''")}'`;
}

function exportLine(shell: string, key: string, value: string): string {
    switch (shell) {
        case 'pwsh':
        case 'powershell':
            return `$env:${key} = ${pwshQuote(value)}`;
        case 'fish':
            return `set -gx ${key} ${posixQuote(value)}`;
        default:
            return `export ${key}=${posixQuote(value)}`;
    }
}

function unsetLine(shell: string, key: string): string {
    switch (shell) {
        case 'pwsh':
        case 'powershell':
            return `Remove-Item "Env:${key}" -ErrorAction SilentlyContinue`;
        case 'fish':
            return `set -e ${key}`;
        default:
            return `unset ${key}`;
    }
}

async function confirm(prompt: string): Promise<boolean> {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout
    });
    try {
        const answer = (await rl.question(prompt)).trim();
        return /^y(es)?$/i.test(answer);
    } finally {
        rl.close();
    }
}

function help(provider: Provider): string {
    const storage =
        provider === CLAUDE
            ? "Profiles use the original shell tool's storage, so existing profiles are picked up automatically."
            : 'Profiles use codex-profiles storage, separate from Claude profiles and ~/.codex.\nSign in to each account with gpt run login after selecting its profile.';
    return `${provider.command} — manage isolated ${provider.label} configuration profiles

Usage:
  ${provider.command}                         Show active + default profile status
  ${provider.command} <command> [args...]     Manage profiles (see commands below)
  ${provider.command} run [${provider.binary} args...]    Launch ${provider.label} with the active profile (use -- to end ${provider.command} parsing)

Commands:
  create <name>            Create a new profile (--from <src> [--with-credentials] copies one)
  list, ls                 List profiles (marks default/active)
  default [name]           Get or set the default profile
  which [name]             Print a profile's config directory
  use <name>               Activate a profile for this shell session
  clone <src> <dst>        Copy a profile (omits credentials; --with-credentials to include)
  delete, rm <name>        Delete a profile (--yes/-y/--force to skip confirmation)
  status, st               Show active + default profile
${provider === CODEX ? '  account                 Manage saved logins within the active profile (account help)\n' : ''}  setup [shell]            Install shell integration (interactive; does it for you)
  init <shell>             Print raw shell integration (bash | zsh | fish | pwsh)
  update, upgrade          Check for a newer release and show how to upgrade
  help, -h, --help         Show this help
  --version, -v            Show version

Shell integration (recommended):
  Add the matching line to your shell startup file, then 'use' switches the
  live shell and a '${provider.marker}' file in a directory auto-selects its profile:
    bash   eval "$(${provider.command} init bash)"          # ~/.bashrc
    zsh    eval "$(${provider.command} init zsh)"            # ~/.zshrc
    fish   ${provider.command} init fish | source           # ~/.config/fish/config.fish
    pwsh   ${provider.command} init pwsh | Out-String | Invoke-Expression   # $PROFILE

${storage}
${provider.aliases.length ? `Commands ${provider.command}, ${provider.aliases.join(', ')} are interchangeable. ` : ''}${provider.attribution}.
`;
}
