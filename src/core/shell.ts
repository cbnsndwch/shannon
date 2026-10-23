import { CLAUDE, type Provider } from './provider.js';

/** Each integration has its own function and directory hook, so both can coexist. */
export function initSnippet(
    shell: string,
    provider: Provider = CLAUDE
): string | null {
    const { command, aliases } = provider;
    const hook = `__${command}_auto`;
    const lastPwd = `__${command}_last_pwd`;
    if (shell === 'bash' || shell === 'zsh') {
        const startup = shell === 'bash' ? '~/.bashrc' : '~/.zshrc';
        const wrappers = aliases
            .map(alias => `${alias}() { ${command} "$@"; }`)
            .join('\n');
        const register =
            shell === 'bash'
                ? `case ";\${PROMPT_COMMAND:-};" in
  *";${hook};"*) ;;
  *) PROMPT_COMMAND="${hook}\${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
esac`
                : `autoload -Uz add-zsh-hook 2>/dev/null && add-zsh-hook precmd ${hook}`;
        return `# ${command} shell integration — add to ${startup}:
#   eval "$(${command} init ${shell})"
${command}() {
  if [ "\${1:-}" = "use" ]; then
    local __out
    __out="$(command ${command} "$@" --emit posix)" || return $?
    [ -n "$__out" ] && eval "$__out"
    return 0
  fi
  command ${command} "$@"
}
${wrappers}

${hook}() {
  [ "$PWD" = "\${${lastPwd}:-}" ] && return 0
  ${lastPwd}="$PWD"
  local __out
  __out="$(command ${command} __auto posix "$PWD" 2>/dev/null)" || return 0
  [ -n "$__out" ] && eval "$__out"
}
${register}
`;
    }
    if (shell === 'fish') {
        const wrappers = aliases
            .map(alias => `function ${alias}; ${command} $argv; end`)
            .join('\n');
        return `# ${command} shell integration — add to ~/.config/fish/config.fish:
#   ${command} init fish | source
function ${command}
    if test (count $argv) -ge 1; and test "$argv[1]" = use
        set -l __out (command ${command} $argv --emit fish)
        set -l __code $status
        if test $__code -ne 0; return $__code; end
        for __line in $__out
            eval $__line
        end
        return 0
    end
    command ${command} $argv
end
${wrappers}

function ${hook} --on-variable PWD
    for __line in (command ${command} __auto fish "$PWD" 2>/dev/null)
        eval $__line
    end
end
${hook}
`;
    }
    if (shell === 'pwsh' || shell === 'powershell') {
        const wrappers = aliases
            .map(alias => `Set-Alias -Name ${alias} -Value ${command} -Force`)
            .join('\n');
        // Both integrations share one saved prompt. Reloading either snippet
        // preserves the other hook and the user's original prompt function.
        return `# ${command} shell integration — add to your $PROFILE:
#   ${command} init pwsh | Out-String | Invoke-Expression
function ${command} {
    $__exe = (Get-Command ${command} -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if (-not $__exe) { Write-Error "${command}: binary not found on PATH"; return }
    if ($args.Count -ge 1 -and $args[0] -eq 'use') {
        $__out = & $__exe @args --emit pwsh
        if ($LASTEXITCODE -eq 0 -and $__out) { $__out | ForEach-Object { Invoke-Expression $_ } }
        return
    }
    & $__exe @args
}
${wrappers}

function ${hook} {
    if ($PWD.Path -eq $Global:${lastPwd}) { return }
    $Global:${lastPwd} = $PWD.Path
    $__exe = (Get-Command ${command} -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if (-not $__exe) { return }
    $__out = & $__exe __auto pwsh $PWD.Path 2>$null
    if ($LASTEXITCODE -eq 0 -and $__out) { $__out | ForEach-Object { Invoke-Expression $_ } }
}
if (-not (Test-Path Function:\\__Shannon-OrigPrompt)) {
    if (Test-Path Function:\\prompt) {
        Rename-Item Function:\\prompt -NewName __Shannon-OrigPrompt
    }
}
function prompt {
    if (Test-Path Function:\\__shannon_auto) { __shannon_auto }
    if (Test-Path Function:\\__gpt_auto) { __gpt_auto }
    if (Test-Path Function:\\__Shannon-OrigPrompt) { __Shannon-OrigPrompt } else { "PS $($PWD.Path)> " }
}
`;
    }
    return null;
}
