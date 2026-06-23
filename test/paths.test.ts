import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { dataDir, defaultFile, profileDir } from "../src/core/paths.js";

/** Build an env that drives dataDir to `base` on the current platform. */
function envFor(base: string): NodeJS.ProcessEnv {
  return process.platform === "win32" ? { LOCALAPPDATA: base } : { XDG_DATA_HOME: base };
}

test("dataDir honors the platform-appropriate env var", () => {
  const base = process.platform === "win32" ? "C:\\Data" : "/data";
  assert.equal(dataDir(envFor(base)), join(base, "claude-profiles"));
});

test("profileDir and defaultFile compose from dataDir", () => {
  const env = envFor(process.platform === "win32" ? "C:\\Data" : "/data");
  assert.equal(profileDir("work", env), join(dataDir(env), "work"));
  assert.equal(defaultFile(env), join(dataDir(env), ".default"));
});
