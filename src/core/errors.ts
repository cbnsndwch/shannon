/**
 * Error type for expected, user-facing failures (bad input, missing profile,
 * etc.). The CLI prints these as `shannon: <message>` and exits non-zero,
 * without a stack trace. Anything else bubbles up as an unexpected crash.
 */
export class ShannonError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ShannonError';
    }
}
