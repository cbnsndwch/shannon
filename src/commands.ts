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
import { resolveAuto } from "./core/autodir.js";
import { ShannonError } from "./core/errors.js";
import { launchClaude } from "./launch.js";

const VERSION = "0.1.0";

/** First tokens that mean "manage profiles" rather than "launch claude". */
const MANAGEMENT = new Set<string>([
  "create", "list", "ls", "default", "which", "delete", "rm",
  "use", "clone", "status", "st", "init", "help", "-h", "--help", "--version",
  // Internal: invoked by the `shannon init` shell hooks, not by users.
  "__auto",
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
      case "__auto": return cmdAuto(argv.slice(1));
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
  const { name, emit } = parseUse(args);
  if (!name) {
    throw new ShannonError("usage: shannon use <name>");
  }
  assertValidName(name);
  if (!profileExists(name)) {
    throw new ShannonError(`profile '${name}' does not exist. Create it with: shannon create ${name}`);
  }
  const dir = profileDir(name);

  // Used by the `shannon init` shell functions: emit just the raw export line
  // (on stdout, to be eval'd) and a confirmation (on stderr, for the human).
  if (emit) {
    process.stdout.write(exportLine(emit, "CLAUDE_CONFIG_DIR", dir) + "\n");
    process.stderr.write(`Switched to profile: ${name}\n`);
    return 0;
  }

  // Standalone: a child process cannot mutate the parent shell, so show how.
  process.stderr.write(
    `Profile '${name}' resolved. For seamless 'use', run 'shannon init <shell>' (see help); until then activate it with:\n`,
  );
  process.stdout.write(`${exportLine("posix", "CLAUDE_CONFIG_DIR", dir)}      # bash / zsh\n`);
  process.stdout.write(`${exportLine("pwsh", "CLAUDE_CONFIG_DIR", dir)}   # PowerShell\n`);
  return 0;
}

/**
 * Parse `use` args: the first non-flag token is the profile name; `--emit
 * <shell>` selects the export-line dialect. Consuming the flag's value here
 * keeps it from being mistaken for the profile name (the shell wrappers always
 * append `--emit <shell>`, even to a bare `shannon use`).
 */
function parseUse(args: string[]): { name: string | null; emit: string | null } {
  let name: string | null = null;
  let emit: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--emit") {
      emit = args[i + 1] ?? null;
      i++;
      continue;
    }
    if (a.startsWith("-")) {
      continue;
    }
    if (name === null) {
      name = a;
    }
  }
  return { name, emit };
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
  if (!shell) {
    throw new ShannonError("usage: shannon init <bash|zsh|fish|pwsh>");
  }
  const snippet = INIT_SNIPPETS[shell];
  if (!snippet) {
    throw new ShannonError(`unsupported shell '${shell}'. Supported: bash, zsh, fish, pwsh`);
  }
  process.stdout.write(snippet);
  return 0;
}

/**
 * Internal: invoked by the `shannon init` directory hook. Emits the shell
 * commands needed to reconcile the auto-selected profile for the working
 * directory passed by the hook (falling back to this process's cwd). PowerShell
 * is the reason the directory is passed explicitly — its location is not always
 * reflected in the spawned process's cwd.
 */
function cmdAuto(args: string[]): number {
  const shell = args[0] ?? "posix";
  const cwd = args[1] ?? process.cwd();
  const action = resolveAuto(cwd);
  if (action.kind === "set") {
    process.stdout.write(exportLine(shell, "CLAUDE_CONFIG_DIR", action.dir) + "\n");
    process.stdout.write(exportLine(shell, "SHANNON_AUTO", action.name) + "\n");
  } else if (action.kind === "unset") {
    process.stdout.write(unsetLine(shell, "CLAUDE_CONFIG_DIR") + "\n");
    process.stdout.write(unsetLine(shell, "SHANNON_AUTO") + "\n");
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

function unsetLine(shell: string, key: string): string {
  switch (shell) {
    case "pwsh":
    case "powershell":
      return `Remove-Item "Env:${key}" -ErrorAction SilentlyContinue`;
    case "fish":
      return `set -e ${key}`;
    default:
      return `unset ${key}`;
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
  powershell: PWSH_INIT,
};

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
