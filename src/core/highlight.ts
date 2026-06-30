import { blue, cyan, dim, green, magenta, yellow } from './style.js';

// A deliberately small, cosmetic syntax highlighter for the `init` snippets. It
// scans each line left to right and wraps tokens in ANSI — it never changes the
// underlying characters, so stripping the colour yields the original byte for
// byte (guarded by a test). Because it is only ever applied when stdout is a
// TTY (the piped/eval path stays raw), any imperfect tokenisation is purely
// visual and can never break the shell code it renders.

export type Flavor = 'sh' | 'pwsh';

export function flavorFor(shell: string): Flavor {
    return shell === 'pwsh' || shell === 'powershell' ? 'pwsh' : 'sh';
}

const KEYWORDS: Record<Flavor, Set<string>> = {
    sh: new Set([
        'function', 'if', 'then', 'elif', 'else', 'fi', 'for', 'while',
        'until', 'in', 'do', 'done', 'case', 'esac', 'return', 'local',
        'export', 'unset', 'set', 'eval', 'command', 'autoload', 'source',
        'add-zsh-hook', 'test', 'end'
    ]),
    pwsh: new Set([
        'function', 'if', 'elseif', 'else', 'return', 'param', 'for',
        'foreach', 'while', 'switch', 'Set-Alias', 'Get-Command',
        'Select-Object', 'ForEach-Object', 'Invoke-Expression', 'Write-Error',
        'Test-Path', 'Rename-Item', 'Remove-Item', 'Out-String'
    ])
};

/** Highlight a multi-line snippet. */
export function highlight(code: string, flavor: Flavor): string {
    return code
        .split('\n')
        .map(line => highlightLine(line, flavor))
        .join('\n');
}

function highlightLine(line: string, flavor: Flavor): string {
    let out = '';
    let i = 0;
    const n = line.length;
    const atWordStart = (idx: number) => idx === 0 || /\s/.test(line[idx - 1]!);

    while (i < n) {
        const c = line[i]!;

        // Comment to end of line (`#` only when it starts a word, so `${x#y}`
        // and the like are left alone).
        if (c === '#' && atWordStart(i)) {
            out += dim(line.slice(i));
            break;
        }

        // Quoted string (single or double); no inner highlighting, kept as one
        // span so there is never nested ANSI.
        if (c === '"' || c === "'") {
            const end = stringEnd(line, i, c);
            out += green(line.slice(i, end));
            i = end;
            continue;
        }

        // Variable reference.
        const vlen = variableLength(line, i, flavor);
        if (vlen > 0) {
            out += cyan(line.slice(i, i + vlen));
            i += vlen;
            continue;
        }

        // Number literal.
        if (/[0-9]/.test(c) && atWordStart(i)) {
            const m = /^[0-9]+/.exec(line.slice(i))!;
            out += yellow(m[0]);
            i += m[0].length;
            continue;
        }

        // Bareword: colour it if it's a keyword, otherwise leave default.
        const wmatch = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(line.slice(i));
        if (wmatch) {
            const word = wmatch[0];
            out += KEYWORDS[flavor].has(word) ? magenta(word) : word;
            i += word.length;
            continue;
        }

        // PowerShell parameter flags (-Name, -Value) read better with colour.
        if (flavor === 'pwsh' && c === '-' && /[A-Za-z]/.test(line[i + 1] ?? '')) {
            const m = /^-[A-Za-z]+/.exec(line.slice(i))!;
            out += blue(m[0]);
            i += m[0].length;
            continue;
        }

        out += c;
        i++;
    }
    return out;
}

/** Index just past the closing quote, or end of line if unterminated. */
function stringEnd(line: string, start: number, quote: string): number {
    for (let j = start + 1; j < line.length; j++) {
        if (line[j] === '\\') {
            j++;
            continue;
        }
        if (line[j] === quote) return j + 1;
    }
    return line.length;
}

/** Length of a `$…` variable reference at `i`, or 0 if none. */
function variableLength(line: string, i: number, flavor: Flavor): number {
    if (line[i] !== '$') return 0;
    const rest = line.slice(i);
    if (rest[1] === '{') {
        const close = rest.indexOf('}');
        return close > 0 ? close + 1 : 0;
    }
    const re =
        flavor === 'pwsh'
            ? /^\$[A-Za-z_][\w]*(?::[A-Za-z_][\w]*)?/
            : /^\$(?:[A-Za-z_]\w*|[@*#?$!0-9-])/;
    const m = re.exec(rest);
    return m ? m[0].length : 0;
}
