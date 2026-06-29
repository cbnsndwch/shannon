// Build-only entry point for the Node SEA (single-executable application)
// binaries. It is bundled to CommonJS by esbuild (`pnpm sea:bundle`) and is not
// part of the published npm package or the `tsc` build (it lives outside the
// tsconfig `include`). The published entry stays `src/cli.ts`.
//
// One difference from `src/cli.ts` that this wrapper handles: CommonJS output
// cannot use top-level await, so we call `dispatch` and assign the resolved exit
// code in a `.then` instead.
//
// Argument offset: user args live at index 2, exactly as for `src/cli.ts`. A
// normal `node script.js a b` run yields ["node", "script.js", "a", "b"]. A SEA
// on the pinned build Node (see release.yml NODE_VERSION) always doubles the
// program — argv[0] is the resolved executable, argv[1] is the program *as
// invoked*, and user args follow at index 2:
//   ./app a       -> ["/abs/app", "./app",     "a"]
//   app a (PATH)  -> ["/abs/app", "app",       "a"]
//   /abs/app a    -> ["/abs/app", "/abs/app",  "a"]
// So `slice(2)` is correct for both entry paths. (A previous `argv[1] !==
// execPath ? 1 : 2` heuristic broke on POSIX for every non-absolute invocation,
// because argv[1] there is the as-invoked path, not the resolved execPath.)
import { dispatch } from '../src/commands.js';

const args = process.argv.slice(2);

// `dispatch` resolves to a numeric exit code and never rejects (it wraps every
// handler in an internal try/catch), so no `.catch` is needed here.
dispatch(args).then(code => {
    process.exitCode = code;
});
