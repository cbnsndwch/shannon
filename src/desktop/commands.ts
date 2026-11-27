import { VERSION } from '../commands.js';
import { ShannonError } from '../core/errors.js';
import { profileDir } from '../core/paths.js';
import { getDefault, profileExists } from '../core/profiles.js';
import { CLAUDE } from '../core/provider.js';
import { assertValidName } from '../core/validate.js';
import {
    desktopPlatform,
    type DesktopPlatform,
    type DesktopProfile,
    type PlatformOptions
} from './platform.js';

export const DESKTOP_COMMAND = 'clpd';

export interface DesktopDispatchOptions extends PlatformOptions {
    platform?: NodeJS.Platform;
    /** Override platform selection entirely (tests). */
    desktop?: DesktopPlatform;
}

/** SEA binaries run the desktop launcher when invoked as `clpd`. */
export function isDesktopExecutable(path: string): boolean {
    return (
        (path.split(/[\\/]/).pop() ?? '')
            .toLowerCase()
            .replace(/\.exe$/, '') === DESKTOP_COMMAND
    );
}

/**
 * Resolve a Shannon (Claude Code) profile for the desktop app: the named one,
 * or the default profile when `name` is omitted.
 */
export function resolveDesktopProfile(
    name: string | undefined,
    env: NodeJS.ProcessEnv = process.env
): DesktopProfile {
    const chosen = name ?? getDefault(env, CLAUDE);
    if (!chosen) {
        throw new ShannonError(
            'no profile given and no default profile set. Use: clpd <profile>, or shannon default <name>'
        );
    }
    assertValidName(chosen);
    if (!profileExists(chosen, env, CLAUDE)) {
        throw new ShannonError(
            `profile '${chosen}' does not exist. Create it with: shannon create ${chosen}`
        );
    }
    return { name: chosen, configDir: profileDir(chosen, env, CLAUDE) };
}

/** `clpd` entry: parse argv, run the subcommand, return the exit code. */
export async function dispatchDesktop(
    argv: string[],
    options: DesktopDispatchOptions = {}
): Promise<number> {
    const out = options.out ?? ((text: string) => process.stdout.write(text));
    const env = options.env ?? process.env;
    try {
        const cmd = argv[0];
        switch (cmd) {
            case 'help':
            case '-h':
            case '--help':
                out(desktopHelp());
                return 0;
            case '--version':
            case '-v':
            case '-V':
                out(`${VERSION}\n`);
                return 0;
        }
        const desktop =
            options.desktop ??
            (await desktopPlatform(options.platform, { ...options, env, out }));
        switch (cmd) {
            case 'status':
            case 'st':
                desktop.status();
                return 0;
            case 'app':
                return cmdApp(argv.slice(1), desktop, env);
            case 'app-remove':
            case 'unapp':
                desktop.removeApp(requireName(argv[1], 'app-remove'));
                return 0;
            case 'quit':
                desktop.quit(requireName(argv[1], 'quit'));
                return 0;
            case 'run':
                return cmdRun(argv.slice(1), desktop, env);
            default:
                return cmdRun(argv, desktop, env);
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`${DESKTOP_COMMAND}: ${msg}\n`);
        return 1;
    }
}

function requireName(name: string | undefined, command: string): string {
    if (!name) {
        throw new ShannonError(`usage: clpd ${command} <profile>`);
    }
    assertValidName(name);
    return name;
}

function cmdRun(
    args: string[],
    desktop: DesktopPlatform,
    env: NodeJS.ProcessEnv
): number {
    let name: string | undefined;
    let dryRun = false;
    let appArgs: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--') {
            appArgs = args.slice(i + 1);
            break;
        }
        if (arg === '--dry-run') {
            dryRun = true;
        } else if (arg.startsWith('-')) {
            throw new ShannonError(`unknown option: ${arg} (see: clpd help)`);
        } else if (name !== undefined) {
            throw new ShannonError('only one profile name allowed');
        } else {
            name = arg;
        }
    }
    desktop.launch({
        profile: resolveDesktopProfile(name, env),
        appArgs,
        dryRun
    });
    return 0;
}

function cmdApp(
    args: string[],
    desktop: DesktopPlatform,
    env: NodeJS.ProcessEnv
): number {
    let name: string | undefined;
    let color: string | undefined;
    let noIcon: boolean | undefined;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--color') {
            color = args[++i];
            if (!color) throw new ShannonError('--color needs a value');
        } else if (arg.startsWith('--color=')) {
            color = arg.slice('--color='.length);
        } else if (arg === '--no-icon') {
            noIcon = true;
        } else if (arg.startsWith('-')) {
            throw new ShannonError(`unknown option: ${arg} (see: clpd help)`);
        } else if (name !== undefined) {
            throw new ShannonError('only one profile name allowed');
        } else {
            name = arg;
        }
    }
    if (!name) {
        throw new ShannonError(
            'usage: clpd app <profile> [--color #rrggbb] [--no-icon]'
        );
    }
    desktop.buildApp({
        profile: resolveDesktopProfile(name, env),
        color,
        noIcon
    });
    return 0;
}

export function desktopHelp(): string {
    return `clpd — run the Claude desktop app once per Shannon profile

Usage:
  clpd [run] [profile] [--dry-run] [-- app args...]
                             Open the profile's instance (the default profile if
                             omitted), or bring it to the front if it is running.
                             Builds the instance on first use and rebuilds it
                             after a Claude update.
  clpd app <profile> [--color #rrggbb] [--no-icon]
                             Build the profile's instance and the
                             "Claude <profile>.app" launcher in ~/Applications
                             (pin that one to the Dock), badged with the profile
                             name. The colour is kept on later rebuilds.
  clpd app-remove <profile>  Delete that launcher and instance
  clpd quit <profile>        Quit the instance running a profile
  clpd status, st            Running instances and built apps
  clpd help                  Show this help

Each profile gets its own CLAUDE_CONFIG_DIR (Code sessions use the profile's
settings, MCP servers and history) and its own app data folder (own claude.ai
login and window state), so profiles run side by side with the normal app.

Building needs the App Management permission (System Settings > Privacy &
Security > App Management) for the app you run clpd from.
macOS only for now. Profiles are managed with shannon (create, list, default).
Not affiliated with Anthropic.
`;
}
