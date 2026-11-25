import { ShannonError } from '../core/errors.js';

/** A Shannon profile resolved for the desktop app. */
export interface DesktopProfile {
    /** Profile name, e.g. `ING`. */
    name: string;
    /** The profile's Claude Code config directory (`CLAUDE_CONFIG_DIR`). */
    configDir: string;
}

export interface LaunchRequest {
    profile: DesktopProfile;
    /** Extra arguments passed through to the desktop app. */
    appArgs: string[];
    /** Print what would happen instead of doing it. */
    dryRun: boolean;
}

export interface BuildRequest {
    profile: DesktopProfile;
    /** Badge colour as `#rrggbb`; omitted keeps the previous one. */
    color?: string;
    /** Keep the stock icon (no badge). */
    noIcon?: boolean;
}

/**
 * What `clpd` needs from an operating system: run the Claude desktop app once
 * per profile, each instance recognisable by name and icon. Each OS gets its
 * own module next to this one (`mac.ts`, …); `clpd`'s argument parsing and
 * profile resolution stay shared in `commands.ts`.
 */
export interface DesktopPlatform {
    /** Open the profile's instance, or bring it to the front if running. */
    launch(request: LaunchRequest): void;
    /** Build (or rebuild) the profile's instance and its Dock launcher. */
    buildApp(request: BuildRequest): void;
    /** Delete what `buildApp` created for a profile. */
    removeApp(profile: string): void;
    /** Quit the instance running a profile. */
    quit(profile: string): void;
    /** Print running instances and built apps. */
    status(): void;
}

/** Shared construction options; each platform adds its own system seam. */
export interface PlatformOptions {
    env?: NodeJS.ProcessEnv;
    home?: string;
    /** Where human-readable output goes (stdout by default). */
    out?: (text: string) => void;
    /**
     * argv that re-runs this CLI (`[node, clpd.js]`, or `[binary]` for a
     * single-file build). Written into the Dock launcher.
     */
    selfCommand?: string[];
}

/**
 * Pick the implementation for `platform`. Loaded lazily so a platform module
 * is only evaluated where it can run.
 */
export async function desktopPlatform(
    platform: NodeJS.Platform = process.platform,
    options: PlatformOptions = {}
): Promise<DesktopPlatform> {
    switch (platform) {
        case 'darwin': {
            const { MacDesktop } = await import('./mac.js');
            return new MacDesktop(options);
        }
        default:
            throw new ShannonError(
                `the desktop launcher is not supported on this platform yet (${platform}); it currently runs on macOS only`
            );
    }
}
