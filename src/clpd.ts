#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dispatchDesktop } from './desktop/commands.js';

process.exitCode = await dispatchDesktop(process.argv.slice(2), {
    selfCommand: [
        process.execPath,
        realpathSync(fileURLToPath(import.meta.url))
    ]
});
