#!/usr/bin/env node
import { dispatch } from './commands.js';
import { CODEX } from './core/provider.js';

process.exitCode = await dispatch(process.argv.slice(2), CODEX);
