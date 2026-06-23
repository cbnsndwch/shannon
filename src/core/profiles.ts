import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { dataDir, defaultFile, profileDir } from "./paths.js";
import { assertValidName, validateName } from "./validate.js";
import { ShannonError } from "./errors.js";

export function listProfiles(env: NodeJS.ProcessEnv = process.env): string[] {
  const dir = dataDir(env);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function profileExists(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const dir = profileDir(name, env);
  return existsSync(dir) && statSync(dir).isDirectory();
}

export function createProfile(name: string, env: NodeJS.ProcessEnv = process.env): string {
  assertValidName(name);
  const dir = profileDir(name, env);
  if (existsSync(dir)) {
    throw new ShannonError(`profile '${name}' already exists`);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function deleteProfile(name: string, env: NodeJS.ProcessEnv = process.env): void {
  assertValidName(name);
  if (!profileExists(name, env)) {
    throw new ShannonError(`profile '${name}' does not exist`);
  }
  rmSync(profileDir(name, env), { recursive: true, force: true });
}

/** Read the default profile name, or null if unset/empty. */
export function getDefault(env: NodeJS.ProcessEnv = process.env): string | null {
  const file = defaultFile(env);
  if (!existsSync(file)) {
    return null;
  }
  const name = readFileSync(file, "utf8").trim();
  return name || null;
}

export function setDefault(name: string, env: NodeJS.ProcessEnv = process.env): void {
  assertValidName(name);
  if (!profileExists(name, env)) {
    throw new ShannonError(`profile '${name}' does not exist. Create it with: shannon create ${name}`);
  }
  mkdirSync(dataDir(env), { recursive: true });
  // No trailing newline, matching the original shell tool's .default format.
  writeFileSync(defaultFile(env), name);
}

export function clearDefault(env: NodeJS.ProcessEnv = process.env): void {
  const file = defaultFile(env);
  if (existsSync(file)) {
    rmSync(file, { force: true });
  }
}

export interface CloneOptions {
  withCredentials?: boolean;
}

/** Files never copied by `clone` unless --with-credentials is passed. */
const SECRET_FILES = new Set([".credentials.json"]);

export function cloneProfile(
  src: string,
  dst: string,
  opts: CloneOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): string {
  assertValidName(src);
  assertValidName(dst);
  if (!profileExists(src, env)) {
    throw new ShannonError(`source profile '${src}' does not exist`);
  }
  const dstDir = profileDir(dst, env);
  if (existsSync(dstDir)) {
    throw new ShannonError(`profile '${dst}' already exists`);
  }
  const srcDir = profileDir(src, env);
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (!opts.withCredentials && SECRET_FILES.has(entry.name)) {
      continue;
    }
    cpSync(join(srcDir, entry.name), join(dstDir, entry.name), { recursive: true });
  }
  return dstDir;
}

export type ResolveSource = "env" | "default" | "none";

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
export function resolveActive(env: NodeJS.ProcessEnv = process.env): Resolved {
  const explicit = env.CLAUDE_CONFIG_DIR;
  if (explicit) {
    const base = dataDir(env).replace(/\\/g, "/");
    const norm = explicit.replace(/\\/g, "/");
    let name: string | null = null;
    if (norm.startsWith(base + "/")) {
      name = norm.slice(base.length + 1).split("/")[0] || null;
    }
    return { dir: explicit, name, source: "env" };
  }
  const def = getDefault(env);
  if (def && validateName(def).ok && profileExists(def, env)) {
    return { dir: profileDir(def, env), name: def, source: "default" };
  }
  return { dir: null, name: null, source: "none" };
}
