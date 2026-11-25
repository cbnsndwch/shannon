import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    closeSync,
    constants,
    copyFileSync,
    existsSync,
    linkSync,
    lstatSync,
    mkdirSync,
    openSync,
    readdirSync,
    readFileSync,
    readlinkSync,
    readSync,
    renameSync,
    rmSync,
    statSync,
    symlinkSync,
    utimesSync,
    writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { posix } from 'node:path';

import { ShannonError } from '../core/errors.js';
import {
    BADGE_SWIFT,
    DEFAULT_COLOR,
    hexToRgb,
    ICONSET_SIZES,
    normalizeColor,
    rgbArg,
    textRgb
} from './mac-icon.js';
import type {
    BuildRequest,
    DesktopPlatform,
    LaunchRequest,
    PlatformOptions
} from './platform.js';

// macOS paths are always POSIX; using `posix` keeps the module's behaviour (and
// its tests) identical when the suite runs on Windows.
const { dirname, join } = posix;

/** Result of running an external command. */
export interface RunResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

/**
 * The system calls the macOS launcher makes. Production uses the real ones;
 * tests inject fakes so the suite runs on any OS.
 */
export interface MacSystem {
    run(command: string, args: string[]): RunResult;
    /** Hard-link `src` to `dst` (throws EPERM when macOS refuses). */
    link(src: string, dst: string): void;
    /** APFS clone of `src` to `dst`, falling back to a copy. */
    clone(src: string, dst: string): void;
}

export const realMacSystem: MacSystem = {
    run(command, args) {
        const r = spawnSync(command, args, { encoding: 'utf8' });
        if (r.error) {
            return { status: null, stdout: '', stderr: r.error.message };
        }
        return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    },
    link(src, dst) {
        linkSync(src, dst);
    },
    clone(src, dst) {
        copyFileSync(src, dst, constants.COPYFILE_FICLONE);
        chmodSync(dst, statSync(src).mode & 0o7777);
    }
};

export interface MacOptions extends PlatformOptions {
    system?: MacSystem;
}

/** Marker file in an instance bundle (format shared with shannon-desktop). */
export const MARKER = 'shannon-desktop.marker';
const PLIST_BUDDY = '/usr/libexec/PlistBuddy';
const LSREGISTER =
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const MACHO_MAGIC = new Set([
    'cffaedfe',
    'cefaedfe',
    'cafebabe',
    'feedfacf',
    'feedface'
]);

/** Shown whenever macOS refuses to let us link or modify app files. */
const APP_MANAGEMENT_HINT =
    'macOS refused to link or modify app files. Give the app you run clpd from (Terminal, iTerm, your editor, …) the App Management permission in System Settings > Privacy & Security > App Management, then run the command again. The instances folder must also be on the same volume as Claude.app.';

export interface Marker {
    profile: string;
    version: string;
    source: string;
    color: string;
    noicon: string;
}

export interface RunningInstance {
    pid: number;
    /** Profile name, or null for the standard app / a custom data folder. */
    profile: string | null;
    userDataDir: string | null;
    configDir: string | null;
}

export interface MirrorResult {
    linked: number;
    cloned: number;
    /** Mach-O files (relative paths) that had to be cloned. */
    clonedMachO: string[];
}

/** Quote for bash/zsh: a single-quoted word. */
export function shellQuote(s: string): string {
    return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

export function parseMarker(text: string): Marker {
    const get = (key: string) =>
        new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1] ?? '';
    return {
        profile: get('profile'),
        version: get('version'),
        source: get('source'),
        color: get('color'),
        noicon: get('noicon')
    };
}

export function formatMarker(m: Marker): string {
    return `profile=${m.profile}\nversion=${m.version}\nsource=${m.source}\ncolor=${m.color}\nnoicon=${m.noicon}\n`;
}

/** `InfoPlist.strings`: the localized name the Dock and Cmd-Tab show. */
export function infoPlistStrings(displayName: string): string {
    const q = displayName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `CFBundleDisplayName = "${q}";\nCFBundleName = "${q}";\n`;
}

function xml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Info.plist of the small Dock launcher app. */
export function launcherInfoPlist(profile: string): string {
    const name = xml(`Claude ${profile}`);
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>${name}</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>launcher</string>
  <key>CFBundleIdentifier</key><string>com.cbnsndwch.shannon-desktop.${xml(profile)}</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>${name}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;
}

/**
 * The launcher's executable: runs `clpd run <profile>` (the exact CLI that
 * built it first, then `clpd` on PATH) and shows an alert if that fails.
 */
export function launcherScript(profile: string, selfCommand: string[]): string {
    const title = `Claude ${profile} could not be opened`;
    const pathDirs = [
        ...(selfCommand.length ? [dirname(selfCommand[0])] : []),
        // Apps started from the Dock get a minimal PATH; add the usual homes
        // of node and global bins so a `clpd` shim on PATH can still run.
        '$HOME/.local/share/fnm/aliases/default/bin',
        '$HOME/.volta/bin',
        '$HOME/.local/bin',
        '$HOME/Library/pnpm',
        '/opt/homebrew/bin',
        '/usr/local/bin'
    ];
    const self = selfCommand.length
        ? `if ${selfCommand.map(p => `[ -e ${shellQuote(p)} ]`).join(' && ')}; then
  out=$(${selfCommand.map(shellQuote).join(' ')} run ${shellQuote(profile)} 2>&1) && exit 0
el`
        : '';
    return `#!/bin/bash
# Dock launcher for the Shannon profile "${profile}" (built by clpd).
export PATH="${pathDirs.map(d => d.replace(/"/g, '\\"')).join(':')}:$PATH"
${self}if command -v clpd >/dev/null 2>&1; then
  out=$(clpd run ${shellQuote(profile)} 2>&1) && exit 0
else
  out="clpd was not found. Install Shannon (pnpm add -g @cbnsndwch/shannon), then run: clpd app ${shellQuote(profile)}"
fi
/usr/bin/osascript -e 'on run argv' -e 'display alert (item 1 of argv) message (item 2 of argv)' -e 'end run' ${shellQuote(title)} "$out" >/dev/null 2>&1
exit 1
`;
}

/**
 * Parse `ps -axo pid=,args=` into running Claude main processes (helpers carry
 * `--type=` and are skipped). The profile comes from a `--user-data-dir` under
 * `dataRoot`.
 */
export function parseInstances(
    psOutput: string,
    dataRoot: string
): RunningInstance[] {
    const found: RunningInstance[] = [];
    for (const raw of psOutput.split('\n')) {
        const line = raw.trim();
        const m = /^(\d+) (\/.+\.app\/Contents\/MacOS\/Claude)( --.*)?$/.exec(
            line
        );
        if (!m) continue;
        const rest = m[3] ?? '';
        if (rest.includes('--type=')) continue;
        let userDataDir: string | null = null;
        const at = rest.indexOf('--user-data-dir=');
        if (at >= 0) {
            userDataDir = rest
                .slice(at + '--user-data-dir='.length)
                .split(' --')[0];
        }
        let profile: string | null = null;
        if (userDataDir?.startsWith(dataRoot + '/')) {
            profile = userDataDir.slice(dataRoot.length + 1).split('/')[0];
        }
        found.push({
            pid: Number(m[1]),
            profile,
            userDataDir,
            configDir: null
        });
    }
    return found;
}

function isMachO(path: string): boolean {
    let fd: number | undefined;
    try {
        fd = openSync(path, 'r');
        const buf = Buffer.alloc(4);
        if (readSync(fd, buf, 0, 4, 0) !== 4) return false;
        return MACHO_MAGIC.has(buf.toString('hex'));
    } catch {
        return false;
    } finally {
        if (fd !== undefined) closeSync(fd);
    }
}

function isPermissionError(e: unknown): boolean {
    const code = (e as NodeJS.ErrnoException)?.code;
    return code === 'EPERM' || code === 'EACCES';
}

/**
 * Recreate `src` at `dst`: symlinks as symlinks, every file hard-linked when
 * macOS allows it and cloned otherwise. Mach-O executables must stay hard
 * links so Gatekeeper keeps trusting the very file it already assessed.
 */
export function mirrorBundle(
    src: string,
    dst: string,
    system: MacSystem
): MirrorResult {
    const result: MirrorResult = { linked: 0, cloned: 0, clonedMachO: [] };
    const walk = (rel: string) => {
        const from = rel ? join(src, rel) : src;
        const to = rel ? join(dst, rel) : dst;
        mkdirSync(to, { recursive: true });
        for (const entry of readdirSync(from, { withFileTypes: true })) {
            const r = rel ? join(rel, entry.name) : entry.name;
            const p = join(src, r);
            const q = join(dst, r);
            if (entry.isSymbolicLink()) {
                symlinkSync(readlinkSync(p), q);
            } else if (entry.isDirectory()) {
                walk(r);
            } else {
                try {
                    system.link(p, q);
                    result.linked++;
                } catch (e) {
                    if (!isPermissionError(e)) throw e;
                    if (isMachO(p)) result.clonedMachO.push(r);
                    system.clone(p, q);
                    result.cloned++;
                }
            }
        }
    };
    walk('');
    return result;
}

export class MacDesktop implements DesktopPlatform {
    readonly env: NodeJS.ProcessEnv;
    readonly home: string;
    readonly system: MacSystem;
    readonly out: (text: string) => void;
    readonly selfCommand: string[];
    readonly dataRoot: string;
    readonly appsRoot: string;
    readonly instancesRoot: string;
    readonly cacheDir: string;

    constructor(options: MacOptions = {}) {
        this.env = options.env ?? process.env;
        this.home = options.home ?? homedir();
        this.system = options.system ?? realMacSystem;
        this.out = options.out ?? (text => process.stdout.write(text));
        this.selfCommand = options.selfCommand ?? [];
        const support = join(this.home, 'Library', 'Application Support');
        this.dataRoot =
            this.env.SHANNON_DESKTOP_DATA_DIR ||
            join(support, 'Claude Profiles');
        this.appsRoot =
            this.env.SHANNON_DESKTOP_APPS_DIR ||
            join(this.home, 'Applications');
        this.instancesRoot =
            this.env.SHANNON_DESKTOP_INSTANCES_DIR ||
            join(support, 'shannon-desktop', 'instances');
        this.cacheDir = join(this.home, 'Library', 'Caches', 'shannon-desktop');
    }

    // ---------------------------------------------------------------- paths

    findApp(): string {
        const explicit = this.env.SHANNON_DESKTOP_APP;
        if (explicit) {
            if (!existsSync(explicit)) {
                throw new ShannonError(`app not found: ${explicit}`);
            }
            return explicit;
        }
        for (const candidate of [
            '/Applications/Claude.app',
            join(this.home, 'Applications', 'Claude.app')
        ]) {
            if (existsSync(candidate)) return candidate;
        }
        throw new ShannonError(
            'Claude.app not found in /Applications or ~/Applications (set SHANNON_DESKTOP_APP)'
        );
    }

    instancePath(profile: string): string {
        return join(this.instancesRoot, `Claude ${profile}.app`);
    }

    launcherPath(profile: string): string {
        return join(this.appsRoot, `Claude ${profile}.app`);
    }

    dataDir(profile: string): string {
        return join(this.dataRoot, profile);
    }

    plistValue(plist: string, key: string): string | null {
        const r = this.system.run(PLIST_BUDDY, ['-c', `Print :${key}`, plist]);
        const value = r.stdout.trim();
        return r.status === 0 && value ? value : null;
    }

    appVersion(app: string): string {
        return (
            this.plistValue(
                join(app, 'Contents', 'Info.plist'),
                'CFBundleShortVersionString'
            ) ?? 'unknown'
        );
    }

    readMarker(profile: string): Marker | null {
        const file = join(this.instancePath(profile), MARKER);
        return existsSync(file)
            ? parseMarker(readFileSync(file, 'utf8'))
            : null;
    }

    // ------------------------------------------------------------ processes

    instances(): RunningInstance[] {
        const ps = this.system.run('ps', ['-axo', 'pid=,args=']);
        const found = parseInstances(ps.stdout, this.dataRoot);
        for (const i of found) {
            const envOut = this.system.run('ps', [
                '-E',
                '-o',
                'args=',
                '-p',
                String(i.pid)
            ]).stdout;
            i.configDir =
                /(?:^| )CLAUDE_CONFIG_DIR=(\S+)/.exec(envOut)?.[1] ?? null;
        }
        return found;
    }

    runningPids(profile: string): number[] {
        const ps = this.system.run('ps', ['-axo', 'pid=,args=']);
        return parseInstances(ps.stdout, this.dataRoot)
            .filter(i => i.profile === profile)
            .map(i => i.pid);
    }

    /**
     * Bring a running app to the front by pid through the AppKit bridge, which
     * sends no Apple events and so needs no Automation permission.
     */
    activate(pid: number): void {
        this.system.run('osascript', [
            '-l',
            'JavaScript',
            '-e',
            'function run(argv) { ObjC.import("AppKit"); var a = $.NSRunningApplication.runningApplicationWithProcessIdentifier(parseInt(argv[0])); if (!a.isNil()) a.activateWithOptions($.NSApplicationActivateIgnoringOtherApps); }',
            String(pid)
        ]);
    }

    // --------------------------------------------------------------- launch

    launch({ profile, appArgs, dryRun }: LaunchRequest): void {
        const name = profile.name;
        const app = this.findApp();
        const version = this.appVersion(app);
        const inst = this.instancePath(name);
        const data = this.dataDir(name);
        const running = this.runningPids(name)[0];

        if (running !== undefined && !dryRun) {
            this.activate(running);
            this.out(
                `Profile '${name}' is already running (pid ${running}); brought to the front.\n`
            );
            return;
        }

        const marker = this.readMarker(name);
        const build = !marker
            ? 'missing'
            : marker.version !== version
              ? 'outdated'
              : null;
        const argv = this.openArgs(inst, profile.configDir, data, appArgs);

        if (dryRun) {
            this.out(
                `profile:            ${name}\n` +
                    `CLAUDE_CONFIG_DIR:  ${profile.configDir}\n` +
                    `app data folder:    ${data}\n` +
                    `instance bundle:    ${inst}\n`
            );
            if (build === 'missing') {
                this.out(
                    `build:              would build the instance and launcher first\n`
                );
            } else if (build === 'outdated') {
                this.out(
                    `build:              would rebuild (built for Claude ${marker?.version}, installed is ${version})\n`
                );
            }
            if (running !== undefined) {
                this.out(
                    `already running:    pid ${running} (would be activated, not relaunched)\n`
                );
            }
            this.out(`command:            ${argv.map(shellQuote).join(' ')}\n`);
            return;
        }

        if (build === 'missing') {
            this.out(`Building the '${name}' app (first launch) ...\n`);
            this.buildApp({ profile });
        } else if (build === 'outdated') {
            this.out(`Claude was updated; rebuilding the '${name}' app ...\n`);
            this.buildApp({ profile });
        }

        mkdirSync(data, { recursive: true });
        const r = this.system.run(argv[0], argv.slice(1));
        if (r.status !== 0) {
            throw new ShannonError(
                `could not open ${inst}: ${r.stderr.trim() || `open exited with ${r.status}`}`
            );
        }
        this.out(
            `Opened profile '${name}' (Claude ${version}).\n` +
                `  Code config:  ${profile.configDir}\n` +
                `  App data:     ${data}\n`
        );
    }

    /**
     * Launch through LaunchServices as a forced new instance (`-n`): without
     * it LaunchServices matches the stock app by bundle id and activates that
     * one, and a binary exec'd from a background process gets no window.
     */
    openArgs(
        inst: string,
        configDir: string,
        data: string,
        appArgs: string[]
    ): string[] {
        return [
            'open',
            '-n',
            '-a',
            inst,
            '--env',
            `CLAUDE_CONFIG_DIR=${configDir}`,
            '--args',
            `--user-data-dir=${data}`,
            ...appArgs
        ];
    }

    // ---------------------------------------------------------------- build

    buildApp({ profile, color, noIcon }: BuildRequest): void {
        const name = profile.name;
        const running = this.runningPids(name)[0];
        if (running !== undefined) {
            throw new ShannonError(
                `profile '${name}' is running (pid ${running}). Quit it first: clpd quit ${name}`
            );
        }
        const app = this.findApp();
        const version = this.appVersion(app);
        const inst = this.instancePath(name);
        const launcher = this.launcherPath(name);

        let badge = color === undefined ? undefined : normalizeColor(color);
        if (badge === null) {
            throw new ShannonError(`colour must be #rrggbb, got: ${color}`);
        }
        let plain = noIcon ?? false;
        const previous = this.readMarker(name);
        if (badge === undefined && previous) {
            badge = normalizeColor(previous.color) ?? undefined;
            if (noIcon === undefined) plain = previous.noicon === '1';
        }
        badge ??= DEFAULT_COLOR;

        try {
            mkdirSync(this.instancesRoot, { recursive: true });
            mkdirSync(this.appsRoot, { recursive: true });
            mkdirSync(this.cacheDir, { recursive: true });
        } catch (e) {
            throw this.buildError(e);
        }

        // 1. Instance bundle: hard links (Mach-O must be), clones otherwise.
        const tmp = join(this.instancesRoot, `.Claude ${name}.app.build`);
        rmSync(tmp, { recursive: true, force: true });
        let mirror: MirrorResult;
        try {
            mirror = mirrorBundle(app, tmp, this.system);
        } catch (e) {
            rmSync(tmp, { recursive: true, force: true });
            throw this.buildError(e);
        }
        const mainExe = mirror.clonedMachO.filter(
            p => dirname(p) === 'Contents/MacOS'
        );
        if (mainExe.length) {
            rmSync(tmp, { recursive: true, force: true });
            throw new ShannonError(
                `could not hard-link ${mainExe.join(', ')} (a copy would make macOS call the app damaged). ${APP_MANAGEMENT_HINT}`
            );
        }
        if (mirror.clonedMachO.length) {
            this.out(
                `note: ${mirror.clonedMachO.length} executables had to be cloned instead of linked:\n  ${mirror.clonedMachO.join('\n  ')}\n`
            );
        }

        // 2. Icon: the stock icon with a coloured badge carrying the name.
        // Files in `tmp` may be hard links into Claude.app: always remove
        // before writing, never write through them.
        const resources = join(tmp, 'Contents', 'Resources');
        let iconFile =
            this.plistValue(
                join(app, 'Contents', 'Info.plist'),
                'CFBundleIconFile'
            ) ?? 'electron.icns';
        if (!iconFile.endsWith('.icns')) iconFile += '.icns';
        const stockIcon = join(app, 'Contents', 'Resources', iconFile);
        const icns = join(this.cacheDir, `${name}.icns`);
        rmSync(icns, { force: true });
        let iconNote = 'stock icon';
        if (!plain) {
            if (this.makeIcon(name, badge, stockIcon, icns)) {
                rmSync(join(resources, iconFile), { force: true });
                copyFileSync(icns, join(resources, iconFile));
                iconNote = `badge ${badge}`;
            } else {
                iconNote = 'stock icon (swiftc not available to draw a badge)';
            }
        }
        if (!existsSync(icns) && existsSync(stockIcon)) {
            copyFileSync(stockIcon, icns);
        }

        // 3. Display name through the localized strings, so the signed
        // Info.plist stays byte-identical: Dock and Cmd-Tab show the name.
        if (existsSync(resources)) {
            for (const entry of readdirSync(resources, {
                withFileTypes: true
            })) {
                if (!entry.isDirectory() || !entry.name.endsWith('.lproj')) {
                    continue;
                }
                const file = join(resources, entry.name, 'InfoPlist.strings');
                rmSync(file, { force: true });
                writeFileSync(file, infoPlistStrings(`Claude ${name}`));
            }
        }
        writeFileSync(
            join(tmp, MARKER),
            formatMarker({
                profile: name,
                version,
                source: app,
                color: badge,
                noicon: plain ? '1' : ''
            })
        );
        rmSync(inst, { recursive: true, force: true });
        renameSync(tmp, inst);

        // Modern apps take their Dock icon from Assets.car, not the .icns, so
        // the badge must also be the bundle's Finder custom icon, which
        // LaunchServices prefers over both.
        if (iconNote.startsWith('badge')) this.setCustomIcon(icns, inst);

        // 4. Launcher app to pin in the Dock.
        const ltmp = join(this.appsRoot, `.Claude ${name}.app.build`);
        rmSync(ltmp, { recursive: true, force: true });
        mkdirSync(join(ltmp, 'Contents', 'MacOS'), { recursive: true });
        mkdirSync(join(ltmp, 'Contents', 'Resources'), { recursive: true });
        if (existsSync(icns)) {
            copyFileSync(
                icns,
                join(ltmp, 'Contents', 'Resources', 'launcher.icns')
            );
        }
        writeFileSync(
            join(ltmp, 'Contents', 'Info.plist'),
            launcherInfoPlist(name)
        );
        const script = join(ltmp, 'Contents', 'MacOS', 'launch');
        writeFileSync(script, launcherScript(name, this.selfCommand));
        chmodSync(script, 0o755);
        rmSync(launcher, { recursive: true, force: true });
        renameSync(ltmp, launcher);

        // A quarantine-propagating parent marks new files, and Gatekeeper then
        // calls the unsigned launcher damaged: clear the flag, sign ad hoc.
        this.system.run('xattr', [
            '-dr',
            'com.apple.quarantine',
            launcher,
            inst
        ]);
        this.system.run('codesign', [
            '--force',
            '--deep',
            '--sign',
            '-',
            launcher
        ]);
        // Set after signing (the seal ignores it). Without it macOS 26 shows
        // the launcher's plain .icns shrunk inside a grey placeholder tile.
        if (iconNote.startsWith('badge')) this.setCustomIcon(icns, launcher);
        this.system.run(LSREGISTER, ['-f', launcher]);
        const now = new Date();
        utimesSync(launcher, now, now);

        this.out(
            `Built for profile '${name}' (Claude ${version}, ${iconNote}):\n` +
                `  launcher:  ${launcher}   <- drag this to the Dock\n` +
                `  instance:  ${inst}\n`
        );
    }

    private buildError(e: unknown): Error {
        if (e instanceof ShannonError) return e;
        const message = e instanceof Error ? e.message : String(e);
        return new ShannonError(
            `could not build the instance bundle in ${this.instancesRoot}: ${message}. ${APP_MANAGEMENT_HINT}`
        );
    }

    /** Compile the badge tool once; null when swiftc is unavailable. */
    badgeTool(): string | null {
        const src = join(this.cacheDir, 'badge.swift');
        const bin = join(this.cacheDir, 'badge');
        const current = existsSync(src) ? readFileSync(src, 'utf8') : null;
        if (current === BADGE_SWIFT && existsSync(bin)) return bin;
        writeFileSync(src, BADGE_SWIFT);
        rmSync(bin, { force: true });
        const r = this.system.run('swiftc', ['-O', '-o', bin, src]);
        return r.status === 0 && existsSync(bin) ? bin : null;
    }

    /** Draw the badged `.icns`; false when the badge cannot be drawn. */
    makeIcon(
        profile: string,
        color: string,
        src: string,
        out: string
    ): boolean {
        const tool = this.badgeTool();
        if (!tool) return false;
        const rgb = hexToRgb(color);
        const png = join(this.cacheDir, `${profile}.png`);
        const set = join(this.cacheDir, `${profile}.iconset`);
        const drawn = this.system.run(tool, [
            src,
            profile,
            png,
            rgbArg(rgb),
            rgbArg(textRgb(rgb))
        ]);
        if (drawn.status !== 0) return false;
        rmSync(set, { recursive: true, force: true });
        mkdirSync(set, { recursive: true });
        for (const s of ICONSET_SIZES) {
            for (const [size, suffix] of [
                [s, ''],
                [s * 2, '@2x']
            ] as const) {
                this.system.run('sips', [
                    '-z',
                    String(size),
                    String(size),
                    png,
                    '--out',
                    join(set, `icon_${s}x${s}${suffix}.png`)
                ]);
            }
        }
        const r = this.system.run('iconutil', ['-c', 'icns', set, '-o', out]);
        rmSync(set, { recursive: true, force: true });
        return r.status === 0 && existsSync(out);
    }

    setCustomIcon(icns: string, target: string): void {
        this.system.run('osascript', [
            '-l',
            'JavaScript',
            '-e',
            'function run(argv) { ObjC.import("AppKit"); var img = $.NSImage.alloc.initWithContentsOfFile(argv[0]); $.NSWorkspace.sharedWorkspace.setIconForFileOptions(img, argv[1], 0); }',
            icns,
            target
        ]);
    }

    // ------------------------------------------------------- remove / quit

    removeApp(profile: string): void {
        const running = this.runningPids(profile)[0];
        if (running !== undefined) {
            throw new ShannonError(
                `profile '${profile}' is running (pid ${running}). Quit it first: clpd quit ${profile}`
            );
        }
        const inst = this.instancePath(profile);
        const launcher = this.launcherPath(profile);
        const hasInst = existsSync(join(inst, MARKER));
        const hasLauncher = existsSync(
            join(launcher, 'Contents', 'MacOS', 'launch')
        );
        if (!hasInst && !hasLauncher) {
            throw new ShannonError(`nothing built for profile '${profile}'`);
        }
        if (hasInst) rmSync(inst, { recursive: true, force: true });
        if (hasLauncher) rmSync(launcher, { recursive: true, force: true });
        this.out(`Removed the '${profile}' launcher and instance bundle.\n`);
    }

    quit(profile: string): void {
        const pids = this.runningPids(profile);
        if (!pids.length) {
            throw new ShannonError(
                `no running instance for profile '${profile}'`
            );
        }
        const r = this.system.run('kill', pids.map(String));
        if (r.status !== 0) {
            throw new ShannonError(
                `could not quit profile '${profile}': ${r.stderr.trim()}`
            );
        }
        this.out(
            `Sent quit to profile '${profile}' (pid ${pids.join(' ')}).\n`
        );
    }

    // --------------------------------------------------------------- status

    status(): void {
        const running = this.instances();
        if (!running.length) {
            this.out('Claude desktop app is not running.\n');
        }
        for (const i of running) {
            const label = i.profile
                ? `profile '${i.profile}'`
                : i.userDataDir
                  ? `custom data folder ${i.userDataDir}`
                  : 'standard app (no profile data folder)';
            this.out(
                `pid ${String(i.pid).padEnd(7)} ${label}\n` +
                    `            CLAUDE_CONFIG_DIR: ${i.configDir ?? '-'}\n`
            );
        }
        this.out('\nbuilt apps (clpd app <profile>):\n');
        const installed = this.appVersion(this.findApp());
        const built = existsSync(this.instancesRoot)
            ? readdirSync(this.instancesRoot)
                  .filter(n => n.startsWith('Claude ') && n.endsWith('.app'))
                  .toSorted()
            : [];
        let any = false;
        for (const dir of built) {
            const file = join(this.instancesRoot, dir, MARKER);
            if (!existsSync(file) || !lstatSync(file).isFile()) continue;
            const m = parseMarker(readFileSync(file, 'utf8'));
            any = true;
            const note =
                m.version === installed
                    ? `(Claude ${m.version})`
                    : `(built for Claude ${m.version}, installed is ${installed}; rebuilds on next launch)`;
            this.out(
                `  ${m.profile}: ${this.launcherPath(m.profile)}  ${note}\n`
            );
        }
        if (!any) this.out('  none\n');
    }
}
