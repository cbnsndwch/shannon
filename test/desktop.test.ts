import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    copyFileSync,
    existsSync,
    linkSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    statSync,
    symlinkSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';

import {
    infoPlistStrings,
    launcherInfoPlist,
    launcherScript,
    MacDesktop,
    MARKER,
    parseInstances,
    parseMarker,
    type MacSystem,
    type RunResult
} from '../src/desktop/mac.js';
import {
    hexToRgb,
    normalizeColor,
    rgbArg,
    textRgb
} from '../src/desktop/mac-icon.js';
import {
    desktopPlatform,
    type BuildRequest,
    type DesktopPlatform,
    type LaunchRequest
} from '../src/desktop/platform.js';
import {
    dispatchDesktop,
    isDesktopExecutable,
    resolveDesktopProfile
} from '../src/desktop/commands.js';

const { join } = posix;
const MACHO = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3, 4]);
const canSymlink = process.platform !== 'win32';

interface Fixture {
    root: string;
    home: string;
    app: string;
    env: NodeJS.ProcessEnv;
    calls: string[][];
    sys: FakeSystem;
    output: () => string;
    desktop: MacDesktop;
    profile: { name: string; configDir: string };
}

const ok = (stdout = ''): RunResult => ({ status: 0, stdout, stderr: '' });

class FakeSystem implements MacSystem {
    calls: string[][] = [];
    version = '1.0.0';
    ps = '';
    /** Relative paths (inside the app) whose hard link fails with EPERM. */
    deniedLinks = new Set<string>();
    linkRoot = '';

    run(command: string, args: string[]): RunResult {
        this.calls.push([command, ...args]);
        const name = posix.basename(command);
        if (name === 'PlistBuddy') {
            const key = args[1].replace('Print :', '');
            if (key === 'CFBundleShortVersionString') return ok(this.version);
            if (key === 'CFBundleIconFile') return ok('electron');
            return { status: 1, stdout: '', stderr: 'Does Not Exist' };
        }
        if (name === 'ps') {
            return ok(args[0] === '-axo' ? this.ps : '');
        }
        if (name === 'swiftc') {
            writeFileSync(args[args.indexOf('-o') + 1], 'badge-bin');
            return ok();
        }
        if (name === 'badge') {
            writeFileSync(args[2], 'png');
            return ok();
        }
        if (name === 'iconutil') {
            writeFileSync(args[args.indexOf('-o') + 1], 'BADGED-ICNS');
            return ok();
        }
        return ok();
    }

    link(src: string, dst: string): void {
        const rel = posix.relative(this.linkRoot, src.replace(/\\/g, '/'));
        if (this.deniedLinks.has(rel)) {
            const e = new Error(
                `EPERM: operation not permitted, link '${src}'`
            );
            (e as NodeJS.ErrnoException).code = 'EPERM';
            throw e;
        }
        linkSync(src, dst);
    }

    clone(src: string, dst: string): void {
        copyFileSync(src, dst);
    }
}

function fixture(): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'clpd-test-'));
    const home = join(root, 'home');
    const app = join(root, 'Claude.app');
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
    mkdirSync(join(app, 'Contents', 'Resources', 'en.lproj'), {
        recursive: true
    });
    mkdirSync(join(app, 'Contents', 'Resources', 'fr.lproj'), {
        recursive: true
    });
    writeFileSync(join(app, 'Contents', 'Info.plist'), '<plist>stock</plist>');
    writeFileSync(join(app, 'Contents', 'MacOS', 'Claude'), MACHO);
    writeFileSync(join(app, 'Contents', 'Resources', 'electron.icns'), 'STOCK');
    writeFileSync(join(app, 'Contents', 'Resources', 'app.asar'), 'asar');
    writeFileSync(
        join(app, 'Contents', 'Resources', 'en.lproj', 'InfoPlist.strings'),
        'stock strings'
    );
    if (canSymlink) {
        const fw = join(app, 'Contents', 'Frameworks', 'E.framework');
        mkdirSync(join(fw, 'Versions', 'A'), { recursive: true });
        writeFileSync(join(fw, 'Versions', 'A', 'E'), MACHO);
        symlinkSync('A', join(fw, 'Versions', 'Current'));
    }
    const data = join(root, 'xdg');
    const configDir = join(data, 'claude-profiles', 'ING');
    mkdirSync(configDir, { recursive: true });
    mkdirSync(join(data, 'claude-profiles', 'CBN'), { recursive: true });
    const env: NodeJS.ProcessEnv = {
        SHANNON_DESKTOP_APP: app,
        XDG_DATA_HOME: data,
        LOCALAPPDATA: data
    };
    const sys = new FakeSystem();
    sys.linkRoot = app.replace(/\\/g, '/');
    let buf = '';
    const desktop = new MacDesktop({
        env,
        home,
        system: sys,
        out: t => {
            buf += t;
        },
        selfCommand: ['/usr/local/bin/node', '/opt/shannon/dist/src/clpd.js']
    });
    return {
        root,
        home,
        app,
        env,
        calls: sys.calls,
        sys,
        output: () => buf,
        desktop,
        profile: {
            name: 'ING',
            configDir: resolveDesktopProfile('ING', env).configDir
        }
    };
}

const commandsRun = (f: Fixture, name: string) =>
    f.calls.filter(c => posix.basename(c[0]) === name);

// ------------------------------------------------------------ pure helpers

test('infoPlistStrings sets the localized display and bundle name', () => {
    assert.equal(
        infoPlistStrings('Claude ING'),
        'CFBundleDisplayName = "Claude ING";\nCFBundleName = "Claude ING";\n'
    );
    assert.match(infoPlistStrings('a"b'), /"a\\"b"/);
});

test('launcherInfoPlist names the launcher and gives it its own bundle id', () => {
    const plist = launcherInfoPlist('CBN');
    assert.match(plist, /<key>CFBundleName<\/key><string>Claude CBN<\/string>/);
    assert.match(
        plist,
        /<key>CFBundleDisplayName<\/key><string>Claude CBN<\/string>/
    );
    assert.match(
        plist,
        /<key>CFBundleIdentifier<\/key><string>com\.cbnsndwch\.shannon-desktop\.CBN<\/string>/
    );
    assert.match(
        plist,
        /<key>CFBundleExecutable<\/key><string>launch<\/string>/
    );
    assert.match(plist, /<key>LSUIElement<\/key><true\/>/);
});

test('launcherScript runs the recorded CLI, falls back to PATH, alerts on failure', () => {
    const script = launcherScript('ING', [
        '/usr/local/bin/node',
        '/Users/me/shannon/dist/src/clpd.js'
    ]);
    assert.ok(script.startsWith('#!/bin/bash\n'));
    assert.match(
        script,
        /out=\$\(\/usr\/local\/bin\/node \/Users\/me\/shannon\/dist\/src\/clpd\.js run ING 2>&1\) && exit 0/
    );
    assert.match(script, /out=\$\(clpd run ING 2>&1\) && exit 0/);
    assert.match(script, /display alert/);
    assert.match(script, /'Claude ING could not be opened'/);
    assert.match(script, /export PATH="\/usr\/local\/bin:/);
});

test('colour helpers', () => {
    assert.equal(normalizeColor('176047'), '#176047');
    assert.equal(normalizeColor('#FBBF24'), '#fbbf24');
    assert.equal(normalizeColor('green'), null);
    assert.equal(rgbArg(hexToRgb('#ff0000')), '1.0000,0.0000,0.0000');
    assert.deepEqual(textRgb(hexToRgb('#176047')), [1, 1, 1]);
    assert.deepEqual(textRgb(hexToRgb('#fbbf24')), [0.11, 0.1, 0.09]);
});

test('parseInstances finds main processes and their profiles, skips helpers', () => {
    const root = '/Users/me/Library/Application Support/Claude Profiles';
    const ps = [
        '  501 /Applications/Claude.app/Contents/MacOS/Claude',
        `  612 /Users/me/Library/Application Support/shannon-desktop/instances/Claude ING.app/Contents/MacOS/Claude --user-data-dir=${root}/ING`,
        `  613 /Users/me/x/Claude ING.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper --type=renderer --user-data-dir=${root}/ING`,
        `  614 /Users/me/x/Claude ING.app/Contents/MacOS/Claude --type=gpu-process --user-data-dir=${root}/ING`,
        `  700 /Applications/Claude.app/Contents/MacOS/Claude --user-data-dir=/tmp/other --foo`,
        '  800 /bin/zsh'
    ].join('\n');
    assert.deepEqual(parseInstances(ps, root), [
        { pid: 501, profile: null, userDataDir: null, configDir: null },
        {
            pid: 612,
            profile: 'ING',
            userDataDir: `${root}/ING`,
            configDir: null
        },
        {
            pid: 700,
            profile: null,
            userDataDir: '/tmp/other',
            configDir: null
        }
    ]);
});

// ------------------------------------------------------------------ build

test('buildApp hard-links executables, renames via InfoPlist.strings, badges the icon', () => {
    const f = fixture();
    f.desktop.buildApp({ profile: f.profile, color: '#176047' });

    const inst = f.desktop.instancePath('ING');
    assert.equal(
        inst,
        join(
            f.home,
            'Library/Application Support/shannon-desktop/instances/Claude ING.app'
        )
    );
    // The main executable and Info.plist are the very same files.
    const same = (rel: string) =>
        statSync(join(inst, rel)).ino === statSync(join(f.app, rel)).ino;
    assert.ok(same('Contents/MacOS/Claude'));
    assert.ok(same('Contents/Info.plist'));
    assert.ok(same('Contents/Resources/app.asar'));
    if (canSymlink) {
        assert.ok(
            existsSync(
                join(inst, 'Contents/Frameworks/E.framework/Versions/Current/E')
            )
        );
    }

    // Localized names in every .lproj; the hard-linked originals are untouched.
    for (const lproj of ['en.lproj', 'fr.lproj']) {
        assert.equal(
            readFileSync(
                join(inst, 'Contents/Resources', lproj, 'InfoPlist.strings'),
                'utf8'
            ),
            infoPlistStrings('Claude ING')
        );
    }
    assert.equal(
        readFileSync(
            join(f.app, 'Contents/Resources/en.lproj/InfoPlist.strings'),
            'utf8'
        ),
        'stock strings'
    );
    assert.equal(
        readFileSync(join(f.app, 'Contents/Info.plist'), 'utf8'),
        '<plist>stock</plist>'
    );

    // Badged icon replaces the instance's .icns but not the stock one.
    assert.equal(
        readFileSync(join(inst, 'Contents/Resources/electron.icns'), 'utf8'),
        'BADGED-ICNS'
    );
    assert.equal(
        readFileSync(join(f.app, 'Contents/Resources/electron.icns'), 'utf8'),
        'STOCK'
    );
    const badge = commandsRun(f, 'badge')[0];
    assert.equal(badge[2], 'ING');
    assert.equal(badge[4], rgbArg(hexToRgb('#176047')));

    // Marker drives rebuilds.
    assert.deepEqual(parseMarker(readFileSync(join(inst, MARKER), 'utf8')), {
        profile: 'ING',
        version: '1.0.0',
        source: f.app,
        color: '#176047',
        noicon: ''
    });

    // Finder custom icon on the instance (what the Dock actually shows).
    const setIcon = commandsRun(f, 'osascript').filter(c =>
        c.join(' ').includes('setIconForFileOptions')
    );
    assert.deepEqual(
        setIcon.map(c => c.at(-1)),
        [inst, f.desktop.launcherPath('ING')]
    );
    // The launcher's custom icon comes after its ad-hoc signature.
    const order = f.calls.map(c => posix.basename(c[0]));
    assert.ok(order.indexOf('codesign') < order.lastIndexOf('osascript'));

    // Launcher app in ~/Applications, quarantine cleared and ad-hoc signed.
    const launcher = f.desktop.launcherPath('ING');
    assert.equal(launcher, join(f.home, 'Applications', 'Claude ING.app'));
    assert.equal(
        readFileSync(join(launcher, 'Contents/Info.plist'), 'utf8'),
        launcherInfoPlist('ING')
    );
    assert.match(
        readFileSync(join(launcher, 'Contents/MacOS/launch'), 'utf8'),
        /dist\/src\/clpd\.js run ING/
    );
    assert.equal(
        readFileSync(
            join(launcher, 'Contents/Resources/launcher.icns'),
            'utf8'
        ),
        'BADGED-ICNS'
    );
    assert.deepEqual(commandsRun(f, 'xattr')[0], [
        'xattr',
        '-dr',
        'com.apple.quarantine',
        launcher,
        inst
    ]);
    assert.deepEqual(commandsRun(f, 'codesign')[0], [
        'codesign',
        '--force',
        '--deep',
        '--sign',
        '-',
        launcher
    ]);
    assert.match(
        f.output(),
        /Built for profile 'ING' \(Claude 1\.0\.0, badge #176047\)/
    );
});

test('buildApp clones data files macOS will not link', () => {
    const f = fixture();
    f.sys.deniedLinks.add('Contents/Resources/app.asar');
    f.desktop.buildApp({ profile: f.profile });
    const inst = f.desktop.instancePath('ING');
    assert.equal(
        readFileSync(join(inst, 'Contents/Resources/app.asar'), 'utf8'),
        'asar'
    );
    assert.notEqual(
        statSync(join(inst, 'Contents/Resources/app.asar')).ino,
        statSync(join(f.app, 'Contents/Resources/app.asar')).ino
    );
});

test('buildApp refuses with an App Management hint when the main binary cannot be linked', () => {
    const f = fixture();
    f.sys.deniedLinks.add('Contents/MacOS/Claude');
    assert.throws(
        () => f.desktop.buildApp({ profile: f.profile }),
        /could not hard-link Contents\/MacOS\/Claude.*App Management/s
    );
    assert.ok(!existsSync(f.desktop.instancePath('ING')));
    assert.ok(
        !existsSync(join(f.desktop.instancesRoot, '.Claude ING.app.build'))
    );
});

test('buildApp keeps the previous colour and rejects bad colours', () => {
    const f = fixture();
    f.desktop.buildApp({ profile: f.profile, color: 'fbbf24' });
    f.desktop.buildApp({ profile: f.profile });
    assert.equal(f.desktop.readMarker('ING')?.color, '#fbbf24');
    assert.throws(
        () => f.desktop.buildApp({ profile: f.profile, color: 'yellow' }),
        /colour must be #rrggbb/
    );
});

test('buildApp refuses while the profile is running', () => {
    const f = fixture();
    f.sys.ps = `42 /x/Claude ING.app/Contents/MacOS/Claude --user-data-dir=${f.desktop.dataRoot}/ING`;
    assert.throws(
        () => f.desktop.buildApp({ profile: f.profile }),
        /running \(pid 42\)\. Quit it first: clpd quit ING/
    );
});

// ----------------------------------------------------------------- launch

const openCalls = (f: Fixture) => commandsRun(f, 'open');

test('launch builds on first use and opens a forced new instance', () => {
    const f = fixture();
    f.desktop.launch({ profile: f.profile, appArgs: ['--foo'], dryRun: false });
    const inst = f.desktop.instancePath('ING');
    const data = join(
        f.home,
        'Library/Application Support/Claude Profiles/ING'
    );
    assert.ok(existsSync(join(inst, MARKER)));
    assert.deepEqual(openCalls(f), [
        [
            'open',
            '-n',
            '-a',
            inst,
            '--env',
            `CLAUDE_CONFIG_DIR=${f.profile.configDir}`,
            '--args',
            `--user-data-dir=${data}`,
            '--foo'
        ]
    ]);
    assert.ok(existsSync(data));
    assert.match(f.output(), /Opened profile 'ING'/);
});

test('launch reuses a current instance without rebuilding', () => {
    const f = fixture();
    f.desktop.buildApp({ profile: f.profile });
    f.calls.length = 0;
    f.desktop.launch({ profile: f.profile, appArgs: [], dryRun: false });
    assert.equal(commandsRun(f, 'badge').length, 0);
    assert.equal(commandsRun(f, 'codesign').length, 0);
    assert.equal(openCalls(f).length, 1);
});

test('launch rebuilds the instance after a Claude update', () => {
    const f = fixture();
    f.desktop.buildApp({ profile: f.profile, color: '#176047' });
    f.sys.version = '2.0.0';
    f.calls.length = 0;
    f.desktop.launch({ profile: f.profile, appArgs: [], dryRun: false });
    assert.match(f.output(), /Claude was updated; rebuilding the 'ING' app/);
    const marker = f.desktop.readMarker('ING');
    assert.equal(marker?.version, '2.0.0');
    assert.equal(marker?.color, '#176047');
    assert.equal(openCalls(f).length, 1);
});

test('launch activates an instance that is already running', () => {
    const f = fixture();
    f.desktop.buildApp({ profile: f.profile });
    f.sys.ps = [
        '10 /Applications/Claude.app/Contents/MacOS/Claude',
        `42 ${f.desktop.instancePath('ING')}/Contents/MacOS/Claude --user-data-dir=${f.desktop.dataRoot}/ING`
    ].join('\n');
    f.calls.length = 0;
    f.desktop.launch({ profile: f.profile, appArgs: [], dryRun: false });
    assert.equal(openCalls(f).length, 0);
    const activate = commandsRun(f, 'osascript');
    assert.equal(activate.length, 1);
    assert.match(activate[0].join(' '), /activateWithOptions/);
    assert.equal(activate[0].at(-1), '42');
    assert.match(f.output(), /already running \(pid 42\)/);
});

test('launch --dry-run prints the plan without building or opening', () => {
    const f = fixture();
    f.desktop.launch({ profile: f.profile, appArgs: [], dryRun: true });
    assert.equal(openCalls(f).length, 0);
    assert.ok(!existsSync(f.desktop.instancePath('ING')));
    assert.match(f.output(), /would build the instance and launcher first/);
    assert.match(f.output(), /command: +open -n -a '.*Claude ING\.app' --env/);
});

test('quit sends SIGTERM to the profile instance', () => {
    const f = fixture();
    f.sys.ps = `42 /x/Claude ING.app/Contents/MacOS/Claude --user-data-dir=${f.desktop.dataRoot}/ING`;
    f.desktop.quit('ING');
    assert.deepEqual(commandsRun(f, 'kill'), [['kill', '42']]);
    assert.throws(() => f.desktop.quit('CBN'), /no running instance/);
});

test('removeApp deletes the instance and launcher only', () => {
    const f = fixture();
    f.desktop.buildApp({ profile: f.profile });
    f.desktop.removeApp('ING');
    assert.ok(!existsSync(f.desktop.instancePath('ING')));
    assert.ok(!existsSync(f.desktop.launcherPath('ING')));
    assert.ok(existsSync(join(f.app, 'Contents/MacOS/Claude')));
    assert.throws(() => f.desktop.removeApp('ING'), /nothing built/);
});

test('status lists running instances and built apps', () => {
    const f = fixture();
    f.desktop.buildApp({ profile: f.profile });
    f.sys.version = '2.0.0';
    f.desktop.status();
    assert.match(f.output(), /Claude desktop app is not running/);
    assert.match(
        f.output(),
        /ING: .*Claude ING\.app {2}\(built for Claude 1\.0\.0, installed is 2\.0\.0/
    );
});

// ---------------------------------------------------------------- dispatch

class RecordingDesktop implements DesktopPlatform {
    launches: LaunchRequest[] = [];
    builds: BuildRequest[] = [];
    removed: string[] = [];
    quits: string[] = [];
    statuses = 0;
    launch(r: LaunchRequest) {
        this.launches.push(r);
    }
    buildApp(r: BuildRequest) {
        this.builds.push(r);
    }
    removeApp(p: string) {
        this.removed.push(p);
    }
    quit(p: string) {
        this.quits.push(p);
    }
    status() {
        this.statuses++;
    }
}

async function captureStderr<T>(fn: () => Promise<T>): Promise<[T, string]> {
    const orig = process.stderr.write.bind(process.stderr);
    let buf = '';
    process.stderr.write = ((s: string) => {
        buf += s;
        return true;
    }) as typeof process.stderr.write;
    try {
        return [await fn(), buf];
    } finally {
        process.stderr.write = orig;
    }
}

test('clpd parses launch, app, quit and status', async () => {
    const f = fixture();
    writeFileSync(
        join(f.env.XDG_DATA_HOME!, 'claude-profiles', '.default'),
        'CBN'
    );
    const d = new RecordingDesktop();
    const run = (argv: string[]) =>
        dispatchDesktop(argv, { desktop: d, env: f.env, out: () => {} });

    assert.equal(await run(['ING', '--dry-run', '--', '--inspect']), 0);
    assert.equal(d.launches[0].profile.name, 'ING');
    assert.equal(d.launches[0].dryRun, true);
    assert.deepEqual(d.launches[0].appArgs, ['--inspect']);

    assert.equal(await run([]), 0);
    assert.equal(d.launches[1].profile.name, 'CBN');
    assert.equal(await run(['run', 'ING']), 0);
    assert.equal(d.launches[2].profile.name, 'ING');

    assert.equal(await run(['app', 'ING', '--color', '#176047']), 0);
    assert.equal(await run(['app', 'CBN', '--color=#fbbf24', '--no-icon']), 0);
    assert.deepEqual(
        d.builds.map(b => [b.profile.name, b.color, b.noIcon]),
        [
            ['ING', '#176047', undefined],
            ['CBN', '#fbbf24', true]
        ]
    );

    assert.equal(await run(['quit', 'ING']), 0);
    assert.equal(await run(['app-remove', 'CBN']), 0);
    assert.equal(await run(['st']), 0);
    assert.deepEqual(d.quits, ['ING']);
    assert.deepEqual(d.removed, ['CBN']);
    assert.equal(d.statuses, 1);

    const [code, err] = await captureStderr(() => run(['nope']));
    assert.equal(code, 1);
    assert.match(err, /clpd: profile 'nope' does not exist/);
    const [code2, err2] = await captureStderr(() => run(['../x']));
    assert.equal(code2, 1);
    assert.match(err2, /^clpd: /);
});

test('clpd fails clearly on platforms without an implementation', async () => {
    await assert.rejects(
        desktopPlatform('linux'),
        /not supported on this platform yet \(linux\)/
    );
    const [code, err] = await captureStderr(() =>
        dispatchDesktop(['status'], { platform: 'win32', out: () => {} })
    );
    assert.equal(code, 1);
    assert.match(
        err,
        /clpd: the desktop launcher is not supported on this platform yet \(win32\)/
    );
    // help still works everywhere
    let help = '';
    assert.equal(
        await dispatchDesktop(['help'], {
            platform: 'linux',
            out: t => {
                help += t;
            }
        }),
        0
    );
    assert.match(help, /clpd — run the Claude desktop app/);
});

test('SEA binaries select clpd by executable name', () => {
    assert.ok(isDesktopExecutable('/usr/local/bin/clpd'));
    assert.ok(isDesktopExecutable('C:\\bin\\CLPD.exe'));
    assert.ok(!isDesktopExecutable('/usr/local/bin/clp'));
    assert.ok(!isDesktopExecutable('/usr/local/bin/shannon'));
});
