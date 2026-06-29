import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProfile } from '../src/core/profiles.js';
import { profileDir } from '../src/core/paths.js';
import { findMarker, resolveAuto } from '../src/core/autodir.js';

/** Fresh temp data dir, exposed via the platform-appropriate env var. */
function freshEnv(): NodeJS.ProcessEnv {
    const base = mkdtempSync(join(tmpdir(), 'shannon-test-'));
    return process.platform === 'win32'
        ? { LOCALAPPDATA: base }
        : { XDG_DATA_HOME: base };
}

/** A scratch working tree, separate from the profiles data dir. */
function freshTree(): string {
    return mkdtempSync(join(tmpdir(), 'shannon-tree-'));
}

test('findMarker walks up to the nearest .shannon', () => {
    const root = freshTree();
    const nested = join(root, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, 'a', '.shannon'), 'work\n');

    assert.equal(findMarker(nested), 'work');
    assert.equal(findMarker(join(root, 'a')), 'work');
    assert.equal(findMarker(root), null, 'no marker above the one we planted');
});

test('findMarker treats an empty marker as none', () => {
    const root = freshTree();
    writeFileSync(join(root, '.shannon'), '   \n');
    assert.equal(findMarker(root), null);
});

test('resolveAuto sets when a valid marker points at an existing profile', () => {
    const env = freshEnv();
    createProfile('work', env);
    const tree = freshTree();
    writeFileSync(join(tree, '.shannon'), 'work');

    const action = resolveAuto(tree, env);
    assert.deepEqual(action, {
        kind: 'set',
        name: 'work',
        dir: profileDir('work', env)
    });
});

test('resolveAuto is a no-op when state already matches', () => {
    const env = { ...freshEnv(), SHANNON_AUTO: 'work' };
    createProfile('work', env);
    const tree = freshTree();
    writeFileSync(join(tree, '.shannon'), 'work');

    assert.deepEqual(resolveAuto(tree, env), { kind: 'none' });
});

test('resolveAuto unsets when leaving an auto-selected directory', () => {
    const env = { ...freshEnv(), SHANNON_AUTO: 'work' };
    createProfile('work', env);
    const tree = freshTree(); // no marker here

    assert.deepEqual(resolveAuto(tree, env), { kind: 'unset' });
});

test('resolveAuto ignores a marker naming a missing or invalid profile', () => {
    const env = freshEnv(); // SHANNON_AUTO unset
    const tree = freshTree();

    writeFileSync(join(tree, '.shannon'), 'ghost'); // valid name, no such profile
    assert.deepEqual(resolveAuto(tree, env), { kind: 'none' });

    writeFileSync(join(tree, '.shannon'), '../escape'); // invalid name
    assert.deepEqual(resolveAuto(tree, env), { kind: 'none' });
});
