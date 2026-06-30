import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isNewer, pendingUpdate, updatesDisabled } from '../src/core/updates.js';
import { dataDir, updateCacheFile } from '../src/core/paths.js';

/** The env var that points at the profiles data dir on this platform. */
const DATA_ENV =
    process.platform === 'win32' ? 'LOCALAPPDATA' : 'XDG_DATA_HOME';

/** A minimal env pointing at a fresh temp data dir, with a seeded cache. */
function envWithCache(latest: string | null): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
        [DATA_ENV]: mkdtempSync(join(tmpdir(), 'shannon-upd-'))
    };
    mkdirSync(dataDir(env), { recursive: true });
    if (latest !== null) {
        writeFileSync(
            updateCacheFile(env),
            JSON.stringify({ checkedAt: Date.now(), latest })
        );
    }
    return env;
}

test('isNewer compares versions numerically, ignoring prerelease', () => {
    assert.equal(isNewer('0.1.2', '0.1.1'), true);
    assert.equal(isNewer('1.0.0', '0.9.9'), true);
    assert.equal(isNewer('0.2.0', '0.10.0'), false); // numeric, not lexical
    assert.equal(isNewer('0.1.1', '0.1.1'), false);
    assert.equal(isNewer('0.1.0', '0.1.1'), false);
    assert.equal(isNewer('0.1.2-beta.1', '0.1.1'), true);
});

test('updatesDisabled honors opt-out env vars', () => {
    assert.equal(updatesDisabled({}), false);
    assert.equal(updatesDisabled({ SHANNON_NO_UPDATE_CHECK: '1' }), true);
    assert.equal(updatesDisabled({ NO_UPDATE_NOTIFIER: '1' }), true);
    assert.equal(updatesDisabled({ CI: 'true' }), true);
});

test('pendingUpdate reports a cached newer version, else null', () => {
    assert.equal(pendingUpdate('0.1.1', envWithCache('0.1.2')), '0.1.2');
    assert.equal(pendingUpdate('0.1.1', envWithCache('0.1.1')), null);
    assert.equal(pendingUpdate('0.1.1', envWithCache(null)), null);
});

test('pendingUpdate stays silent when checks are disabled', () => {
    const env = envWithCache('9.9.9');
    env.SHANNON_NO_UPDATE_CHECK = '1';
    assert.equal(pendingUpdate('0.1.1', env), null);
});
