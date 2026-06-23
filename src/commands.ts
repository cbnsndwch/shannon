import { createInterface } from "node:readline/promises";
import {
  clearDefault,
  cloneProfile,
  createProfile,
  deleteProfile,
  getDefault,
  listProfiles,
  profileExists,
  resolveActive,
  setDefault,
} from "./core/profiles.js";
import { profileDir } from "./core/paths.js";
import { assertValidName } from "./core/validate.js";
import { ShannonError } from "./core/errors.js";
import { launchClaude } from "./launch.js";

const VERSION = "0.1.0";

/** First tokens that mean "manage profiles" rather than "launch claude". */
const MANAGEMENT = new Set<string>([
  "create", "list", "ls", "default", "which", "delete", "rm",
  "use", "clone", "status", "st", "init", "help", "-h", "--help", "--version",
]);

export async function dispatch(argv: string[]): Promise<number> {
  const cmd = argv[0];

  // Launch semantics: a bare `shannon`, an explicit `run`/`--`, or any token
  // that isn't one of our subcommands is passed straight through to claude.
  if (cmd === undefined) return safe(() => launchClaude([]));
  if (cmd === "run") return safe(() => launchClaude(argv.slice(1)));
  if (cmd === "--") return safe(() => launchClaude(argv.slice(1)));
  if (!MANAGEMENT.has(cmd)) return safe(() => launchClaude(argv));

  return safe(async () => {
    switch (cmd) {
      case "create": return cmdCreate(argv.slice(1));
      case "list":
      case "ls": return cmdList();
      case "default": return cmdDefault(argv.slice(1));
      case "which": return cmdWhich(argv.slice(1));
      case "delete":
      case "rm": return cmdDelete(argv.slice(1));
      case "use": return cmdUse(argv.slice(1));
      case "clone": return cmdClone(argv.slice(1));
      case "status":
      case "st": return cmdStatus();
      case "init": return cmdInit(argv.slice(1));
      case "help":
      case "-h":
      case "--help": return printHelp();
      case "--version": return printVersion();
      default: return printHelp();
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
  const name = args[0];
  if (!name) {
    throw new ShannonError("usage: shannon create <name>");
  }
  const dir = createProfile(name);
  process.stdout.write(`Created profile: ${name}\n`);
  process.stdout.write(`Config directory: ${dir}\n`);
  return 0;
}

function cmdList(): number {
  const names = listProfiles();
  if (names.length === 0) {
    process.stdout.write("No profiles found. Create one with: shannon create <name>\n");
    return 0;
  }
  const def = getDefault();
  const active = resolveActive().name;
  for (const name of names) {
    const isDefault = name === def;
    const isActive = name === active;
    let prefix = "  ";
    if (isDefault && isActive) prefix = ">*";
    else if (isDefault) prefix = " *";
    else if (isActive) prefix = "> ";
    let tag = "";
    if (isDefault && isActive) tag = " (default, active)";
    else if (isDefault) tag = " (default)";
    else if (isActive) tag = " (active)";
    process.stdout.write(`${prefix} ${name}${tag}\n`);
  }
  return 0;
}

function cmdDefault(args: string[]): number {
  const name = args[0];
  if (!name) {
    const def = getDefault();
    if (!def) {
      throw new ShannonError("no default profile set. Set one with: shannon default <name>");
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
      throw new ShannonError(`profile '${name}' does not exist. Create it with: shannon create ${name}`);
    }
    process.stdout.write(`${profileDir(name)}\n`);
    return 0;
  }
  const def = getDefault();
  if (!def) {
    throw new ShannonError("no default profile set. Use: shannon default <name>");
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
    throw new ShannonError("usage: shannon delete <name>");
  }
  assertValidName(name);
  if (!profileExists(name)) {
    throw new ShannonError(`profile '${name}' does not exist`);
  }
  const force = args.includes("--yes") || args.includes("-y") || args.includes("--force");
  if (!force && !(await confirm(`Delete profile "${name}" and all its data? [y/N] `))) {
    process.stdout.write("Cancelled.\n");
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
  const name = args[0];
  if (!name) {
    throw new ShannonError("usage: shannon use <name>");
  }
  assertValidName(name);
  if (!profileExists(name)) {
    throw new ShannonError(`profile '${name}' does not exist. Create it with: shannon create ${name}`);
  }
  const dir = profileDir(name);

  // Used by the (forthcoming) `shannon init` shell functions: emit just the
  // raw export line for the calling shell to eval into its own environment.
  const emit = flagValue(args, "--emit");
  if (emit) {
    process.stdout.write(exportLine(emit, "CLAUDE_CONFIG_DIR", dir) + "\n");
    return 0;
  }

  // Standalone: a child process cannot mutate the parent shell, so show how.
  process.stderr.write(
    `Profile '${name}' resolved. Seamless 'use' arrives with 'shannon init'; until then activate it with:\n`,
  );
  process.stdout.write(`${exportLine("posix", "CLAUDE_CONFIG_DIR", dir)}      # bash / zsh\n`);
  process.stdout.write(`${exportLine("pwsh", "CLAUDE_CONFIG_DIR", dir)}   # PowerShell\n`);
  return 0;
}

function cmdClone(args: string[]): number {
  const positional = args.filter((a) => !a.startsWith("-"));
  const src = positional[0];
  const dst = positional[1];
  if (!src || !dst) {
    throw new ShannonError("usage: shannon clone <source> <dest> [--with-credentials]");
  }
  const withCredentials = args.includes("--with-credentials");
  const dir = cloneProfile(src, dst, { withCredentials });
  process.stdout.write(`Cloned '${src}' -> '${dst}'\n`);
  process.stdout.write(`Config directory: ${dir}\n`);
  if (!withCredentials) {
    process.stdout.write(
      "(credentials omitted — sign in under the new profile, or re-run with --with-credentials)\n",
    );
  }
  return 0;
}

function cmdStatus(): number {
  const resolved = resolveActive();
  if (resolved.name) {
    process.stdout.write(`Active profile: ${resolved.name}\n`);
    process.stdout.write(`Config directory: ${resolved.dir}\n`);
  } else if (resolved.dir) {
    process.stdout.write(`Active config directory: ${resolved.dir} (not a managed profile)\n`);
  } else {
    process.stdout.write("No active profile\n");
  }
  const def = getDefault();
  process.stdout.write(def ? `Default profile: ${def}\n` : "No default profile set\n");
  return 0;
}

function cmdInit(args: string[]): number {
  const shell = args[0];
  process.stderr.write(
    "shannon init: shell integration (seamless 'use' + per-directory auto-select) ships in the next release.\n",
  );
  if (shell) {
    process.stderr.write(`(requested shell: ${shell})\n`);
  }
  return 0;
}

function printVersion(): number {
  process.stdout.write(`${VERSION}\n`);
  return 0;
}

function printHelp(): number {
  process.stdout.write(HELP);
  return 0;
}

// --- helpers ---

function flagValue(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  if (i >= 0 && args[i + 1]) {
    return args[i + 1]!;
  }
  return null;
}

function posixQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function pwshQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function exportLine(shell: string, key: string, value: string): string {
  switch (shell) {
    case "pwsh":
    case "powershell":
      return `$env:${key} = ${pwshQuote(value)}`;
    case "fish":
      return `set -gx ${key} ${posixQuote(value)}`;
    default:
      return `export ${key}=${posixQuote(value)}`;
  }
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(prompt)).trim();
    return /^y(es)?$/i.test(answer);
  } finally {
    rl.close();
  }
}

const HELP = `shannon — manage isolated Claude Code configuration profiles

Usage:
  shannon [claude args...]        Launch Claude Code with the active profile
  shannon run [claude args...]    Same, explicit (use -- to end shannon parsing)
  shannon <command> [args...]

Commands:
  create <name>            Create a new profile
  list, ls                 List profiles (marks default/active)
  default [name]           Get or set the default profile
  which [name]             Print a profile's config directory
  use <name>               Activate a profile for this shell session
  clone <src> <dst>        Copy a profile (omits credentials; --with-credentials to include)
  delete, rm <name>        Delete a profile (--yes to skip confirmation)
  status, st               Show active + default profile
  init <shell>             Print shell integration (bash | zsh | fish | pwsh)
  help, --help             Show this help
  --version                Show version

Profiles are stored in the same location as the original shell tool, so
existing profiles are picked up automatically. Commands shannon, claudep, and
clp are interchangeable. Not affiliated with Anthropic.
`;
