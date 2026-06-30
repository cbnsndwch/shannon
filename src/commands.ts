import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
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
import { launchClaude } from './launch.js';
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
export const VERSION = '0.1.4';

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

export async function dispatch(argv: string[]): Promise<number> {
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
    const code = await route(argv);
    if (notice) emitUpdateNotice();
    return code;
}

async function route(argv: string[]): Promise<number> {
    const cmd = argv[0];

    // A bare invocation (`shannon` / `claudep` / `clp` with no args) shows
    // profile status, matching the original shell tool — it never launches
    // claude implicitly. Launching is always explicit: `run`, `--`, or any
    // token that isn't one of our subcommands is passed straight through.
    if (cmd === undefined) return safe(() => cmdStatus());
    if (cmd === 'run') return safe(() => launchClaude(argv.slice(1)));
    if (cmd === '--') return safe(() => launchClaude(argv.slice(1)));
    if (!MANAGEMENT.has(cmd)) return safe(() => launchClaude(argv));

    return safe(async () => {
        switch (cmd) {
            case 'create':
                return cmdCreate(argv.slice(1));
            case 'list':
            case 'ls':
                return cmdList();
            case 'default':
                return cmdDefault(argv.slice(1));
            case 'which':
                return cmdWhich(argv.slice(1));
            case 'delete':
            case 'rm':
                return cmdDelete(argv.slice(1));
            case 'use':
                return cmdUse(argv.slice(1));
            case 'clone':
                return cmdClone(argv.slice(1));
            case 'status':
            case 'st':
                return cmdStatus();
            case 'init':
                return cmdInit(argv.slice(1));
            case 'setup':
                return cmdSetup(argv.slice(1));
            case 'update':
            case 'upgrade':
                return cmdUpdate();
            case '__check-updates':
                return cmdCheckUpdates();
            case '__auto':
                return cmdAuto(argv.slice(1));
            case 'help':
            case '-h':
            case '--help':
                return printHelp();
            case '--version':
                return printVersion();
            default:
                return printHelp();
        }
    });
}

async function safe(fn: () => number | Promise<number>): Promise<number> {
    try {
        return await fn();
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`shannon: ${msg}\n`);
        return 1;
    }
}

function cmdCreate(args: string[]): number {
    const { name, from, withCredentials, hasFrom } = parseCreate(args);
    if (!name) {
        throw new ShannonError(
            'usage: shannon create <name> [--from <src> [--with-credentials]]'
        );
    }

    // `create --from <src>` copies an existing profile, exactly like `clone`
    // (same shared copy routine, same credential handling and error messages).
    if (hasFrom) {
        if (!from) {
            throw new ShannonError(
                'usage: shannon create <name> --from <src> [--with-credentials]'
            );
        }
        const dir = copyProfile(from, name, { withCredentials });
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

    const dir = createProfile(name);
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

function cmdList(): number {
    const names = listProfiles();
    if (names.length === 0) {
        process.stdout.write(
            'No profiles found. Create one with: shannon create <name>\n'
        );
        return 0;
    }
    const def = getDefault();
    const active = resolveActive().name;
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

function cmdDefault(args: string[]): number {
    const name = args[0];
    if (!name) {
        const def = getDefault();
        if (!def) {
            throw new ShannonError(
                'no default profile set. Set one with: shannon default <name>'
            );
        }
        process.stdout.write(`${def}\n`);
        return 0;
    }
    setDefault(name);
    process.stdout.write(`Default profile set to: ${name}\n`);
    return 0;
}

function cmdWhich(args: string[]): number {
    const name = args[0];
    if (name) {
        assertValidName(name);
        if (!profileExists(name)) {
            throw new ShannonError(
                `profile '${name}' does not exist. Create it with: shannon create ${name}`
            );
        }
        process.stdout.write(`${profileDir(name)}\n`);
        return 0;
    }
    const def = getDefault();
    if (!def) {
        throw new ShannonError(
            'no default profile set. Use: shannon default <name>'
        );
    }
    assertValidName(def);
    if (!profileExists(def)) {
        throw new ShannonError(`default profile '${def}' does not exist`);
    }
    process.stdout.write(`${profileDir(def)}\n`);
    return 0;
}

async function cmdDelete(args: string[]): Promise<number> {
    const name = args[0];
    if (!name) {
        throw new ShannonError('usage: shannon delete <name>');
    }
    assertValidName(name);
    if (!profileExists(name)) {
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
    deleteProfile(name);
    process.stdout.write(`Deleted profile: ${name}\n`);
    if (getDefault() === name) {
        clearDefault();
        process.stdout.write(`Cleared default profile (was "${name}")\n`);
    }
    return 0;
}

function cmdUse(args: string[]): number {
    const { name, emit } = parseUse(args);
    if (!name) {
        throw new ShannonError('usage: shannon use <name>');
    }
    assertValidName(name);
    if (!profileExists(name)) {
        throw new ShannonError(
            `profile '${name}' does not exist. Create it with: shannon create ${name}`
        );
    }
    const dir = profileDir(name);

    // Used by the `shannon init` shell functions: emit just the raw export line
    // (on stdout, to be eval'd) and a confirmation (on stderr, for the human).
    if (emit) {
        process.stdout.write(exportLine(emit, 'CLAUDE_CONFIG_DIR', dir) + '\n');
        process.stderr.write(`Switched to profile: ${name}\n`);
        return 0;
    }

    // Standalone: a child process cannot mutate the parent shell, so show how.
    // The human-facing lines go to stderr; the copy/eval-able export lines go to
    // stdout (plain, so `eval`/redirect capture them cleanly).
    process.stderr.write(`Profile ${bold(name)} → ${dim(dir)}\n`);
    process.stderr.write(
        `For automatic switching, run ${bold('shannon setup')} once. ` +
            `Or set it in this shell now:\n`
    );
    process.stdout.write(
        `${exportLine('posix', 'CLAUDE_CONFIG_DIR', dir)}      # bash / zsh\n`
    );
    process.stdout.write(
        `${exportLine('pwsh', 'CLAUDE_CONFIG_DIR', dir)}   # PowerShell\n`
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

function cmdClone(args: string[]): number {
    const positional = args.filter(a => !a.startsWith('-'));
    const src = positional[0];
    const dst = positional[1];
    if (!src || !dst) {
        throw new ShannonError(
            'usage: shannon clone <source> <dest> [--with-credentials]'
        );
    }
    const withCredentials = args.includes('--with-credentials');
    const dir = copyProfile(src, dst, { withCredentials });
    process.stdout.write(`Cloned '${src}' -> '${dst}'\n`);
    printCopyResult(dir, withCredentials);
    return 0;
}

function cmdStatus(): number {
    printBanner();
    const resolved = resolveActive();
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
    const def = getDefault();
    process.stdout.write(
        def ? `Default profile: ${def}\n` : 'No default profile set\n'
    );
    return 0;
}

function cmdInit(args: string[]): number {
    const shell = args[0];
    if (!shell) {
        throw new ShannonError('usage: shannon init <bash|zsh|fish|pwsh>');
    }
    const snippet = INIT_SNIPPETS[shell];
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
        printSnippetPretty(shell, snippet);
    } else {
        process.stdout.write(snippet);
    }
    return 0;
}

/** Render an `init` snippet for human eyes: highlighted, indented, breathing. */
function printSnippetPretty(shell: string, snippet: string): void {
    const body = highlight(snippet.replace(/\n+$/, ''), flavorFor(shell))
        .split('\n')
        .map(line => (line ? `    ${line}` : ''))
        .join('\n');
    process.stdout.write(`\n${body}\n\n`);
    process.stdout.write(
        `    ${dim('Tip: run')} ${bold('shannon setup')} ${dim('to add this for you.')}\n\n`
    );
}

/**
 * Interactive shell-integration installer. Rather than dumping the full snippet
 * (which belongs at shell-startup, not in the user's hands), it offers to add a
 * single `shannon init` line to the appropriate startup file for them, or to
 * print just that line to paste. Non-interactively it only prints instructions —
 * it never edits a file without a yes.
 */
async function cmdSetup(args: string[]): Promise<number> {
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
    const line = integrationLine(shell);
    const file = resolveStartupFile(shell);

    if (file && existsSync(file) && alreadyInstalled(readFileSync(file, 'utf8'))) {
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
        `\nSet up ${bold(shell)} integration so ${bold('shannon use')} switches the ` +
            `live shell and a ${bold('.shannon')} file auto-selects a profile per directory.\n\n`
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
                yellow('\nCould not locate your PowerShell $PROFILE automatically.\n')
            );
            printManualSetup(shell, line, file);
            return 0;
        }
        mkdirSync(dirname(file), { recursive: true });
        appendFileSync(file, blockToAppend(shell));
        process.stdout.write(
            `\n${green('✓')} Added shannon integration to ${bold(file)}.\n`
        );
        process.stdout.write(
            dim(`  Restart your shell (or run ${reloadHint(shell)}) to activate it.\n`)
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
                yellow(`Please enter a number between 1 and ${options.length}.\n`)
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
function cmdAuto(args: string[]): number {
    const shell = args[0] ?? 'posix';
    const cwd = args[1] ?? process.cwd();
    const action = resolveAuto(cwd);
    if (action.kind === 'set') {
        process.stdout.write(
            exportLine(shell, 'CLAUDE_CONFIG_DIR', action.dir) + '\n'
        );
        process.stdout.write(
            exportLine(shell, 'SHANNON_AUTO', action.name) + '\n'
        );
    } else if (action.kind === 'unset') {
        process.stdout.write(unsetLine(shell, 'CLAUDE_CONFIG_DIR') + '\n');
        process.stdout.write(unsetLine(shell, 'SHANNON_AUTO') + '\n');
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
        process.stdout.write(`Latest version:  ${latest}  (update available)\n\n`);
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
function emitUpdateNotice(): void {
    const latest = pendingUpdate(VERSION);
    if (!latest) return;
    process.stderr.write(
        `\nA new shannon release is available: ${VERSION} → ${latest}. ` +
            `Run 'shannon update' to upgrade.\n`
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

function printHelp(): number {
    printBanner();
    process.stdout.write(HELP);
    return 0;
}

/**
 * Write the portrait banner — but only for a real interactive user. When stdout
 * is captured (a pipe, a script, or the shell-integration wrappers that eval
 * Shannon's output), the portrait would be noise or corrupt the consumed text,
 * so it is suppressed there.
 */
function printBanner(): void {
    if (!process.stdout.isTTY) return;
    process.stdout.write(banner() + '\n');
    process.stdout.write(
        `${bold(cyan('shannon'))} ${dim(`v${VERSION}`)} ` +
            `${dim('— isolated Claude Code configuration profiles')}\n`
    );
    process.stdout.write(
        dim('  Not affiliated with Anthropic · a nod to Claude Shannon\n')
    );
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

// --- shell integration snippets (emitted by `shannon init <shell>`) ---
//
// Each defines shannon/claudep/clp wrappers that forward to the real binary
// (`command shannon`), but special-case `use` by eval'ing the binary's emitted
// export line so it mutates the *live* shell. A directory hook runs `__auto` on
// every change of working directory to apply per-directory `.shannon` files.
// The wrappers call the `shannon` binary by name, so it must be on PATH (it is
// installed alongside claudep/clp).

const BASH_INIT = `# shannon shell integration — add to ~/.bashrc:
#   eval "$(shannon init bash)"
shannon() {
  if [ "\${1:-}" = "use" ]; then
    local __out
    __out="$(command shannon "$@" --emit posix)" || return $?
    [ -n "$__out" ] && eval "$__out"
    return 0
  fi
  command shannon "$@"
}
claudep() { shannon "$@"; }
clp() { shannon "$@"; }

__shannon_auto() {
  [ "$PWD" = "\${__shannon_last_pwd:-}" ] && return 0
  __shannon_last_pwd="$PWD"
  local __out
  __out="$(command shannon __auto posix "$PWD" 2>/dev/null)" || return 0
  [ -n "$__out" ] && eval "$__out"
}
case ";\${PROMPT_COMMAND:-};" in
  *";__shannon_auto;"*) ;;
  *) PROMPT_COMMAND="__shannon_auto\${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
esac
`;

const ZSH_INIT = `# shannon shell integration — add to ~/.zshrc:
#   eval "$(shannon init zsh)"
shannon() {
  if [ "\${1:-}" = "use" ]; then
    local __out
    __out="$(command shannon "$@" --emit posix)" || return $?
    [ -n "$__out" ] && eval "$__out"
    return 0
  fi
  command shannon "$@"
}
claudep() { shannon "$@"; }
clp() { shannon "$@"; }

__shannon_auto() {
  [ "$PWD" = "\${__shannon_last_pwd:-}" ] && return 0
  __shannon_last_pwd="$PWD"
  local __out
  __out="$(command shannon __auto posix "$PWD" 2>/dev/null)" || return 0
  [ -n "$__out" ] && eval "$__out"
}
autoload -Uz add-zsh-hook 2>/dev/null && add-zsh-hook precmd __shannon_auto
`;

const FISH_INIT = `# shannon shell integration — add to ~/.config/fish/config.fish:
#   shannon init fish | source
function shannon
    if test (count $argv) -ge 1; and test "$argv[1]" = use
        for __line in (command shannon $argv --emit fish)
            eval $__line
        end
        return 0
    end
    command shannon $argv
end
function claudep; shannon $argv; end
function clp; shannon $argv; end

function __shannon_auto --on-variable PWD
    for __line in (command shannon __auto fish "$PWD" 2>/dev/null)
        eval $__line
    end
end
__shannon_auto
`;

const PWSH_INIT = `# shannon shell integration — add to your $PROFILE:
#   shannon init pwsh | Out-String | Invoke-Expression
function shannon {
    $__exe = (Get-Command shannon -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if (-not $__exe) { Write-Error "shannon: binary not found on PATH"; return }
    if ($args.Count -ge 1 -and $args[0] -eq 'use') {
        $__out = & $__exe @args --emit pwsh
        if ($__out) { $__out | ForEach-Object { Invoke-Expression $_ } }
        return
    }
    & $__exe @args
}
Set-Alias -Name claudep -Value shannon -Force
Set-Alias -Name clp -Value shannon -Force  # -Force: clp is a read-only built-in alias

function __Shannon-Auto {
    if ($PWD.Path -eq $Global:__ShannonLastPwd) { return }
    $Global:__ShannonLastPwd = $PWD.Path
    $__exe = (Get-Command shannon -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if (-not $__exe) { return }
    $__out = & $__exe __auto pwsh $PWD.Path 2>$null
    if ($__out) { $__out | ForEach-Object { Invoke-Expression $_ } }
}
if (-not (Test-Path Function:\\__Shannon-OrigPrompt)) {
    if (Test-Path Function:\\prompt) {
        Rename-Item Function:\\prompt Function:\\__Shannon-OrigPrompt
    }
}
function prompt {
    __Shannon-Auto
    if (Test-Path Function:\\__Shannon-OrigPrompt) { __Shannon-OrigPrompt } else { "PS $($PWD.Path)> " }
}
`;

const INIT_SNIPPETS: Record<string, string> = {
    bash: BASH_INIT,
    zsh: ZSH_INIT,
    fish: FISH_INIT,
    pwsh: PWSH_INIT,
    powershell: PWSH_INIT
};

const HELP = `shannon — manage isolated Claude Code configuration profiles

Usage:
  shannon                         Show active + default profile status
  shannon <command> [args...]     Manage profiles (see commands below)
  shannon run [claude args...]    Launch Claude Code with the active profile (use -- to end shannon parsing)

Commands:
  create <name>            Create a new profile (--from <src> [--with-credentials] copies one)
  list, ls                 List profiles (marks default/active)
  default [name]           Get or set the default profile
  which [name]             Print a profile's config directory
  use <name>               Activate a profile for this shell session
  clone <src> <dst>        Copy a profile (omits credentials; --with-credentials to include)
  delete, rm <name>        Delete a profile (--yes/-y/--force to skip confirmation)
  status, st               Show active + default profile
  setup [shell]            Install shell integration (interactive; does it for you)
  init <shell>             Print raw shell integration (bash | zsh | fish | pwsh)
  update, upgrade          Check for a newer release and show how to upgrade
  help, -h, --help         Show this help
  --version                Show version

Shell integration (recommended):
  Add the matching line to your shell startup file, then 'use' switches the
  live shell and a '.shannon' file in a directory auto-selects its profile:
    bash   eval "$(shannon init bash)"          # ~/.bashrc
    zsh    eval "$(shannon init zsh)"            # ~/.zshrc
    fish   shannon init fish | source           # ~/.config/fish/config.fish
    pwsh   shannon init pwsh | Out-String | Invoke-Expression   # $PROFILE

Profiles are stored in the same location as the original shell tool, so
existing profiles are picked up automatically. Commands shannon, claudep, and
clp are interchangeable. Not affiliated with Anthropic.
`;
