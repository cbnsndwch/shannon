import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VERSION } from '../src/commands.js';

/**
 * Walk up from this test file to the repo root and read package.json's version.
 * Works whether the test runs compiled (dist/test) or from source (test/).
 */
function readPackageVersion(): string {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (;;) {
        const pkg = join(dir, 'package.json');
        if (existsSync(pkg)) {
            return JSON.parse(readFileSync(pkg, 'utf8')).version;
        }
        const parent = dirname(dir);
        if (parent === dir) throw new Error('package.json not found');
        dir = parent;
    }
}

// The CLI hardcodes VERSION; npm reads package.json. This guard fails the build
// (and so the release `verify` job) if a version bump forgets the constant,
// preventing `shannon --version` and the SEA binaries from drifting stale.
test('VERSION constant matches package.json (guards release drift)', () => {
    assert.equal(VERSION, readPackageVersion());
});
