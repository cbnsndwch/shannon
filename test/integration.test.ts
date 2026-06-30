import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MARKER,
    alreadyInstalled,
    blockToAppend,
    detectShell,
    integrationLine,
    isSupportedShell,
    startupFile
} from '../src/core/integration.js';

test('integrationLine is a single startup line per shell', () => {
    assert.equal(integrationLine('bash'), 'eval "$(shannon init bash)"');
    assert.equal(integrationLine('zsh'), 'eval "$(shannon init zsh)"');
    assert.equal(integrationLine('fish'), 'shannon init fish | source');
    assert.equal(
        integrationLine('pwsh'),
        'shannon init pwsh | Out-String | Invoke-Expression'
    );
});

test('isSupportedShell accepts only the four known shells', () => {
    for (const s of ['bash', 'zsh', 'fish', 'pwsh']) {
        assert.equal(isSupportedShell(s), true);
    }
    assert.equal(isSupportedShell('powershell'), false);
    assert.equal(isSupportedShell('nu'), false);
    assert.equal(isSupportedShell(''), false);
});

test('startupFile gives the conventional path; pwsh is runtime-resolved', () => {
    assert.ok(startupFile('bash')!.endsWith('.bashrc'));
    assert.ok(startupFile('zsh')!.endsWith('.zshrc'));
    assert.ok(startupFile('fish')!.endsWith('config.fish'));
    assert.equal(startupFile('pwsh'), null);
});

test('alreadyInstalled detects the marker or any shannon init line', () => {
    assert.equal(alreadyInstalled(`x\n${MARKER}\ny`), true);
    assert.equal(alreadyInstalled('eval "$(shannon init bash)"'), true);
    assert.equal(alreadyInstalled('shannon init pwsh | Out-String'), true);
    assert.equal(alreadyInstalled('# nothing here\nalias ll=ls'), false);
});

test('blockToAppend wraps the marker and the one line', () => {
    const block = blockToAppend('zsh');
    assert.ok(block.includes(MARKER));
    assert.ok(block.includes(integrationLine('zsh')));
    assert.ok(alreadyInstalled(block));
});

test('detectShell returns a supported shell', () => {
    assert.equal(isSupportedShell(detectShell()), true);
    if (process.platform !== 'win32') {
        assert.equal(detectShell({ SHELL: '/usr/bin/zsh' }), 'zsh');
        assert.equal(detectShell({ SHELL: '/usr/local/bin/fish' }), 'fish');
        assert.equal(detectShell({ SHELL: '/bin/bash' }), 'bash');
    }
});
