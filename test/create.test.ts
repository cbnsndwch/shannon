import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch } from "../src/commands.js";
import { createProfile } from "../src/core/profiles.js";
import { profileDir } from "../src/core/paths.js";

/** The env var that points at the profiles data dir on this platform. */
const DATA_ENV = process.platform === "win32" ? "LOCALAPPDATA" : "XDG_DATA_HOME";

/**
 * Run `fn` against a fresh, isolated profiles data dir (freshEnv pattern, but on
 * `process.env` since the command layer reads it directly). Stdout/stderr are
 * silenced for the duration so the dispatched command's output doesn't clutter
 * the test report; everything is restored afterward.
 */
async function withFreshData(fn: () => Promise<void>): Promise<void> {
  const prevEnv = process.env[DATA_ENV];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.env[DATA_ENV] = mkdtempSync(join(tmpdir(), "shannon-test-"));
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    await fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    if (prevEnv === undefined) {
      delete process.env[DATA_ENV];
    } else {
      process.env[DATA_ENV] = prevEnv;
    }
  }
}

test("create makes a fresh empty profile (no --from)", async () => {
  await withFreshData(async () => {
    const code = await dispatch(["create", "foo"]);
    assert.equal(code, 0);
    assert.equal(existsSync(profileDir("foo")), true, "profile created");
  });
});

test("create --from=<src> (equals form) copies the source profile", async () => {
  await withFreshData(async () => {
    const src = createProfile("work");
    writeFileSync(join(src, "settings.json"), "{}");

    const code = await dispatch(["create", "copy", "--from=work"]);
    assert.equal(code, 0);
    assert.equal(existsSync(join(profileDir("copy"), "settings.json")), true, "settings copied");
  });
});

test("create rejects an unknown option instead of creating a blank profile", async () => {
  await withFreshData(async () => {
    createProfile("work");

    const code = await dispatch(["create", "copy", "--form=work"]);
    assert.equal(code, 1);
    assert.equal(existsSync(profileDir("copy")), false, "nothing created");
  });
});

test("create rejects --with-credentials without --from", async () => {
  await withFreshData(async () => {
    const code = await dispatch(["create", "foo", "--with-credentials"]);
    assert.equal(code, 1);
    assert.equal(existsSync(profileDir("foo")), false, "nothing created");
  });
});

test("create --from copies files from the source profile", async () => {
  await withFreshData(async () => {
    const src = createProfile("work");
    writeFileSync(join(src, "settings.json"), "{}");

    const code = await dispatch(["create", "copy", "--from", "work"]);
    assert.equal(code, 0);
    assert.equal(existsSync(join(profileDir("copy"), "settings.json")), true, "settings copied");
  });
});

test("create --from omits credentials by default", async () => {
  await withFreshData(async () => {
    const src = createProfile("work");
    writeFileSync(join(src, "settings.json"), "{}");
    writeFileSync(join(src, ".credentials.json"), "secret");

    const code = await dispatch(["create", "copy", "--from", "work"]);
    assert.equal(code, 0);
    assert.equal(existsSync(join(profileDir("copy"), "settings.json")), true, "settings copied");
    assert.equal(
      existsSync(join(profileDir("copy"), ".credentials.json")),
      false,
      "credentials omitted",
    );
  });
});

test("create --from --with-credentials includes credentials", async () => {
  await withFreshData(async () => {
    const src = createProfile("work");
    writeFileSync(join(src, ".credentials.json"), "secret");

    const code = await dispatch(["create", "copy", "--from", "work", "--with-credentials"]);
    assert.equal(code, 0);
    assert.equal(
      existsSync(join(profileDir("copy"), ".credentials.json")),
      true,
      "credentials included",
    );
  });
});

test("create --from errors when the source profile is missing", async () => {
  await withFreshData(async () => {
    const code = await dispatch(["create", "copy", "--from", "nope"]);
    assert.equal(code, 1);
    assert.equal(existsSync(profileDir("copy")), false, "nothing created");
  });
});

test("create --from errors when the destination already exists", async () => {
  await withFreshData(async () => {
    createProfile("work");
    createProfile("copy");

    const code = await dispatch(["create", "copy", "--from", "work"]);
    assert.equal(code, 1);
  });
});

test("create --from errors on an invalid profile name", async () => {
  await withFreshData(async () => {
    createProfile("work");

    const code = await dispatch(["create", "bad/name", "--from", "work"]);
    assert.equal(code, 1);
    assert.equal(existsSync(profileDir("bad")), false, "nothing created");
  });
});
