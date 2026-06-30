// Minimal ANSI styling, zero-dependency. Colour is emitted only when stdout is
// a real terminal (honoring the NO_COLOR / FORCE_COLOR conventions), so piped
// output, eval'd shell snippets, and text copied from the terminal stay plain —
// terminals render ANSI rather than storing it, so an on-screen highlight copies
// as clean text.

function colorEnabled(): boolean {
    if (process.env.NO_COLOR != null) return false;
    if (process.env.FORCE_COLOR != null) return true;
    return Boolean(process.stdout.isTTY);
}

function style(open: number, close: number): (s: string) => string {
    return s => (colorEnabled() ? `\x1b[${open}m${s}\x1b[${close}m` : s);
}

export const bold = style(1, 22);
export const dim = style(2, 22);
export const cyan = style(36, 39);
export const green = style(32, 39);
export const yellow = style(33, 39);
