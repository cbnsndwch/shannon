import { ShannonError } from './errors.js';

/** Profile names: letters, digits, hyphens, underscores. Nothing else. */
const VALID_NAME = /^[A-Za-z0-9_-]+$/;

export interface ValidationResult {
    ok: boolean;
    error?: string;
}

/**
 * Validate a profile name. The checks before the final regex exist only to
 * produce specific, actionable error messages; the regex alone is sufficient
 * for safety (it forbids `.`, `/`, `\`, `..`, and everything else that could
 * escape the profiles directory).
 */
export function validateName(name: string): ValidationResult {
    if (!name) {
        return { ok: false, error: 'profile name must not be empty' };
    }
    if (name.startsWith('.')) {
        return {
            ok: false,
            error: `invalid profile name '${name}': must not start with '.'`
        };
    }
    if (name.includes('..')) {
        return {
            ok: false,
            error: `invalid profile name '${name}': must not contain '..'`
        };
    }
    if (name.includes('/')) {
        return {
            ok: false,
            error: `invalid profile name '${name}': must not contain '/'`
        };
    }
    if (name.includes('\\')) {
        return {
            ok: false,
            error: `invalid profile name '${name}': must not contain '\\'`
        };
    }
    if (!VALID_NAME.test(name)) {
        return {
            ok: false,
            error: `invalid profile name '${name}': use only letters, digits, hyphens, underscores`
        };
    }
    return { ok: true };
}

export function assertValidName(name: string): void {
    const result = validateName(name);
    if (!result.ok) {
        throw new ShannonError(
            result.error ?? `invalid profile name '${name}'`
        );
    }
}
