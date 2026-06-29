import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateName } from '../src/core/validate.js';

test('accepts valid names', () => {
    for (const name of [
        'work',
        'personal',
        'client-acme',
        'side_project',
        'a',
        'A1_-9'
    ]) {
        assert.equal(
            validateName(name).ok,
            true,
            `expected '${name}' to be valid`
        );
    }
});

test('rejects invalid names', () => {
    for (const name of [
        '',
        '.',
        '..',
        '.hidden',
        'a/b',
        'a\\b',
        'a..b',
        '../x',
        'foo!',
        'with space',
        'café'
    ]) {
        assert.equal(
            validateName(name).ok,
            false,
            `expected '${name}' to be invalid`
        );
    }
});
