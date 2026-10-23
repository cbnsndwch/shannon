import { basename } from 'node:path';

/** The CLI and storage contract for one family of isolated profiles. */
export interface Provider {
    command: string;
    binary: string;
    label: string;
    configEnv: string;
    dataDirectory: string;
    autoEnv: string;
    marker: string;
    aliases: readonly string[];
    secretFiles: readonly string[];
    attribution: string;
}

export const CLAUDE: Provider = {
    command: 'shannon',
    binary: 'claude',
    label: 'Claude Code',
    configEnv: 'CLAUDE_CONFIG_DIR',
    dataDirectory: 'claude-profiles',
    autoEnv: 'SHANNON_AUTO',
    marker: '.shannon',
    aliases: ['claudep', 'clp'],
    secretFiles: ['.credentials.json'],
    attribution: 'Not affiliated with Anthropic · a nod to Claude Shannon'
};

export const CODEX: Provider = {
    command: 'gpt',
    binary: 'codex',
    label: 'Codex CLI',
    configEnv: 'CODEX_HOME',
    dataDirectory: 'codex-profiles',
    autoEnv: 'GPT_AUTO',
    marker: '.gpt',
    aliases: [],
    secretFiles: ['auth.json', '.credentials.json', '.gpt-accounts'],
    attribution: 'Not affiliated with OpenAI · part of Shannon'
};

/** SEA binaries can be copied or symlinked to gpt (gpt.exe on Windows). */
export function providerForExecutable(path: string): Provider {
    return basename(path)
        .toLowerCase()
        .replace(/\.exe$/, '') === 'gpt'
        ? CODEX
        : CLAUDE;
}
