import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatch } from '../src/commands.js';

/** The env var that points at the profiles data dir on this platform. */
const DATA_ENV =
    process.platform === 'win32' ? 'LOCALAPPDATA' : 'XDG_DATA_HOME';

/**
 * Run `fn` against a fresh, isolated profiles data dir with no active profile,
 * capturing everything written to stdout. `CLAUDE_CONFIG_DIR` is cleared so the
 * status output is deterministic regardless of the host environment.
 */
async function withCapturedStatus(
    fn: (out: () => string) => Promise<void>
): Promise<void> {
    const prevData = process.env[DATA_ENV];
    const prevCfg = process.env.CLAUDE_CONFIG_DIR;
    const origOut = process.stdout.write.bind(process.stdout);
    let buf = '';
    process.env[DATA_ENV] = mkdtempSync(join(tmpdir(), 'shannon-test-'));
    delete process.env.CLAUDE_CONFIG_DIR;
    process.stdout.write = ((s: string) => {
        buf += s;
        return true;
    }) as typeof process.stdout.write;
    try {
        await fn(() => buf);
    } finally {
        process.stdout.write = origOut;
        if (prevData === undefined) delete process.env[DATA_ENV];
        else process.env[DATA_ENV] = prevData;
        if (prevCfg === undefined) delete process.env.CLAUDE_CONFIG_DIR;
        else process.env.CLAUDE_CONFIG_DIR = prevCfg;
    }
}

// A bare invocation must show status, never launch claude implicitly. If it
// launched, it would try to spawn the real claude binary instead of printing
// these lines (and would not exit 0 deterministically in CI).
test('bare invocation prints profile status, does not launch', async () => {
    await withCapturedStatus(async out => {
        const code = await dispatch([]);
        assert.equal(code, 0);
        assert.match(out(), /No active profile/);
        assert.match(out(), /No default profile set/);
    });
});
