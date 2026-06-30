import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flavorFor, highlight } from '../src/core/highlight.js';

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

/** Force colour on for the duration of `fn`, restoring the env after. */
function withColor(fn: () => void): void {
    const prev = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = '1';
    try {
        fn();
    } finally {
        if (prev === undefined) delete process.env.FORCE_COLOR;
        else process.env.FORCE_COLOR = prev;
    }
}

test('flavorFor maps shells to sh / pwsh', () => {
    assert.equal(flavorFor('bash'), 'sh');
    assert.equal(flavorFor('zsh'), 'sh');
    assert.equal(flavorFor('fish'), 'sh');
    assert.equal(flavorFor('pwsh'), 'pwsh');
    assert.equal(flavorFor('powershell'), 'pwsh');
});

// The load-bearing invariant: highlighting is purely additive. Stripping the
// ANSI must return the input unchanged, so an eval'd / copied snippet is byte
// identical to the raw one.
test('highlight only adds colour — stripping it restores the source', () => {
    withColor(() => {
        const samples = [
            'function shannon() {\n  command shannon "$@"\n}',
            'export CLAUDE_CONFIG_DIR=\'/home/u/.x\'   # comment',
            'case ";${PROMPT_COMMAND:-};" in',
            '$__out = & $__exe @args --emit pwsh',
            'Set-Alias -Name clp -Value shannon -Force  # note',
            'if ($PWD.Path -eq $Global:__ShannonLastPwd) { return }'
        ];
        for (const flavor of ['sh', 'pwsh'] as const) {
            for (const src of samples) {
                const out = highlight(src, flavor);
                assert.ok(out.includes('\x1b['), 'expected colour codes');
                assert.equal(stripAnsi(out), src, 'content must be preserved');
            }
        }
    });
});

test('highlight emits no codes when colour is disabled', () => {
    const prev = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    try {
        const src = 'function f() { return 0; }  # x';
        assert.equal(highlight(src, 'sh'), src);
    } finally {
        if (prev === undefined) delete process.env.NO_COLOR;
        else process.env.NO_COLOR = prev;
    }
});
