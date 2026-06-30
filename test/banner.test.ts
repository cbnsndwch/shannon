import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banner, unicodeSupported } from '../src/banner.js';

/** Run `fn` with SHANNON_BANNER set to `val`, restoring the prior value after. */
function withForced(val: string | undefined, fn: () => void): void {
    const prev = process.env.SHANNON_BANNER;
    if (val === undefined) delete process.env.SHANNON_BANNER;
    else process.env.SHANNON_BANNER = val;
    try {
        fn();
    } finally {
        if (prev === undefined) delete process.env.SHANNON_BANNER;
        else process.env.SHANNON_BANNER = prev;
    }
}

// The dot glyph that only the Unicode banner uses, and a run of the ASCII
// banner's darkest glyph — each unambiguously identifies one variant.
const UNICODE_MARK = '●'; // ●
const ASCII_MARK = 'MMM';

test('SHANNON_BANNER=unicode forces the dot-halftone banner', () => {
    withForced('unicode', () => {
        assert.equal(unicodeSupported(), true);
        assert.ok(banner().includes(UNICODE_MARK));
    });
});

test('SHANNON_BANNER=ascii forces the ASCII fallback banner', () => {
    withForced('ascii', () => {
        assert.equal(unicodeSupported(), false);
        const b = banner();
        assert.ok(b.includes(ASCII_MARK));
        assert.ok(!b.includes(UNICODE_MARK));
    });
});
