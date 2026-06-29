import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    copyProfile,
    createProfile,
    getDefault,
    listProfiles,
    profileExists,
    setDefault
} from '../src/core/profiles.js';
import { profileDir } from '../src/core/paths.js';

/** Fresh temp data dir, exposed via the platform-appropriate env var. */
function freshEnv(): NodeJS.ProcessEnv {
    const base = mkdtempSync(join(tmpdir(), 'shannon-test-'));
    return process.platform === 'win32'
        ? { LOCALAPPDATA: base }
        : { XDG_DATA_HOME: base };
}

test('create, list, and existence checks', () => {
    const env = freshEnv();
    createProfile('work', env);
    createProfile('personal', env);
    assert.deepEqual(listProfiles(env), ['personal', 'work']);
    assert.equal(profileExists('work', env), true);
    assert.equal(profileExists('nope', env), false);
});

test('default round-trips', () => {
    const env = freshEnv();
    createProfile('work', env);
    setDefault('work', env);
    assert.equal(getDefault(env), 'work');
});

test('clone omits credentials by default and includes them with the flag', () => {
    const env = freshEnv();
    const dir = createProfile('work', env);
    writeFileSync(join(dir, 'settings.json'), '{}');
    writeFileSync(join(dir, '.credentials.json'), 'secret');

    copyProfile('work', 'copy', {}, env);
    const copy = profileDir('copy', env);
    assert.equal(
        existsSync(join(copy, 'settings.json')),
        true,
        'settings copied'
    );
    assert.equal(
        existsSync(join(copy, '.credentials.json')),
        false,
        'credentials omitted'
    );

    copyProfile('work', 'copy-secrets', { withCredentials: true }, env);
    const copy2 = profileDir('copy-secrets', env);
    assert.equal(
        existsSync(join(copy2, '.credentials.json')),
        true,
        'credentials included'
    );
});
