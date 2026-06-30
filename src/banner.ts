// Portrait banner of Claude E. Shannon (the project's namesake), rendered from
// .local/c-e-shannon.jpg as a deliberately low-entropy halftone: just a handful
// of glyph weights — enough signal to recognize him, no more. Shown above the
// status output and the help screen. Plain string constants (no runtime cost,
// no dependency); regenerate by hand if the source image changes.

/** Dot-halftone (space · • ●). Needs a UTF-8-capable terminal. */
const BANNER_UNICODE = `
·············            ····
··········                 ·······
•••••••                      ········
••••••           ···          ············
•••••                 ···      ···········
●●●·             ···••●●●•·     ··········
●●●    ··•••••●●●●●●●●●●●••·     ·········
●●●    ·•••●●●●●●●●●●●●●●••·     ·········
●●●·   ·•••●●●●●●●●●●●●●●•••·    ·········
●●●•    ••••●●●●●●●●●●●●●●••••   •········
●●●●    ·••●●●●●●●●●•·······••· ·••·······
●●●●    ···  ··••●•·  ·  ··•••··••●••••···
●●●●·           ·●●••••••●●●●•··•●•••••••·
●●●●●·  ···•••••·•●●•●●●●●●●●•··••••••••••
●●●●●●·  ••••●●•··●●••●●●●●●••··••••••••••
●●●●●●●•··•••●●•··●●•••●●●●•••··••••••••••
●●●●●●●●●• ·••••··•••·•●●●●●••··••••••••••
●●●●●●●●●●· ··••····••●●•••●••····••••••••
●●●●●●●●●●●········••••·•••••···•· ·••••••
●●●●●●●●●••·  ·•· ····•••••··•·•●·   ··•••
●●●●●•··       ··•••●●●●●•···••●•       ··
●•··             ··••••••··••●●●·    ·
                ·   ···••••●●●●·        ··
                 •····•••●●●●•· ·  ···  ··
                 •●●•••●●●●●•·········· ··
                ·•··••●●●●●●··········· ··
                ·•··•••·●●●············
`;

/** ASCII fallback (space . o M) for terminals without Unicode support. */
const BANNER_ASCII = `
.............            ....
..........                 .......
ooooooo                      ........
oooooo           ...          ............
ooooo                 ...      ...........
MMM.             ...ooMMMo.     ..........
MMM    ..oooooMMMMMMMMMMMoo.     .........
MMM    .oooMMMMMMMMMMMMMMoo.     .........
MMM.   .oooMMMMMMMMMMMMMMooo.    .........
MMMo    ooooMMMMMMMMMMMMMMoooo   o........
MMMM    .ooMMMMMMMMMo.......oo. .oo.......
MMMM    ...  ..ooMo.  .  ..ooo..ooMoooo...
MMMM.           .MMooooooMMMMo..oMooooooo.
MMMMM.  ...ooooo.oMMoMMMMMMMMo..oooooooooo
MMMMMM.  ooooMMo..MMooMMMMMMoo..oooooooooo
MMMMMMMo..oooMMo..MMoooMMMMooo..oooooooooo
MMMMMMMMMo .oooo..ooo.oMMMMMoo..oooooooooo
MMMMMMMMMM. ..oo....ooMMoooMoo....oooooooo
MMMMMMMMMMM........oooo.ooooo...o. .oooooo
MMMMMMMMMoo.  .o. ....ooooo..o.oM.   ..ooo
MMMMMo..       ..oooMMMMMo...ooMo       ..
Mo..             ..oooooo..ooMMM.    .
                .   ...ooooMMMM.        ..
                 o....oooMMMMo. .  ...  ..
                 oMMoooMMMMMo.......... ..
                .o..ooMMMMMM........... ..
                .o..ooo.MMM............
`;

/**
 * Whether the terminal can render the Unicode dot glyphs. Mirrors the well-worn
 * `is-unicode-supported` heuristic (kept inline to honour the zero-dependency
 * rule). `SHANNON_BANNER=ascii|unicode` forces a choice; otherwise we infer from
 * the platform and terminal/locale environment, erring toward ASCII when unsure
 * so a legacy code page never prints mojibake.
 */
export function unicodeSupported(): boolean {
    const forced = process.env.SHANNON_BANNER;
    if (forced === 'ascii') return false;
    if (forced === 'unicode') return true;

    if (process.platform !== 'win32') {
        // The Linux virtual console (TERM=linux) can't render these; everything
        // else on POSIX is assumed UTF-8, as modern terminals are.
        return process.env.TERM !== 'linux';
    }

    // Windows: classic cmd.exe on code page 437/1252 can't, but every modern
    // host advertises itself. Treat any of these as Unicode-capable.
    return Boolean(
        process.env.WT_SESSION || // Windows Terminal
            process.env.TERM_PROGRAM === 'vscode' ||
            process.env.ConEmuTask === '{cmd::Cmder}' || // ConEmu / cmder
            process.env.TERM === 'xterm-256color' ||
            process.env.TERM === 'alacritty' ||
            process.env.TERMINAL_EMULATOR === 'JetBrains-JediTerm' ||
            process.env.CI
    );
}

/** The banner appropriate for the current terminal. */
export function banner(): string {
    return unicodeSupported() ? BANNER_UNICODE : BANNER_ASCII;
}
