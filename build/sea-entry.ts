// Build-only entry point for the Node SEA (single-executable application)
// binaries. It is bundled to CommonJS by esbuild (`pnpm sea:bundle`) and is not
// part of the published npm package or the `tsc` build (it lives outside the
// tsconfig `include`). The published entry stays `src/cli.ts`.
//
// Two differences from `src/cli.ts` that this wrapper handles:
//   1. CommonJS output cannot use top-level await, so we call `dispatch` and
//      assign the resolved exit code in a `.then` instead.
//   2. Argument offset. A normal `node script.js a b` run yields
//      ["node", "script.js", "a", "b"] (user args at index 2). A SEA on current
//      Node repeats the executable path at argv[0] and argv[1]
//      (["app", "app", "a", "b"] — user args also at index 2); some older Node
//      SEA builds omit the duplicate (["app", "a", "b"] — user args at index 1).
//      The check below covers all three so the same bundle behaves correctly
//      however it is launched.
import { isSea } from 'node:sea';
import { dispatch } from '../src/commands.js';

const start = isSea() && process.argv[1] !== process.execPath ? 1 : 2;
const args = process.argv.slice(start);

// `dispatch` resolves to a numeric exit code and never rejects (it wraps every
// handler in an internal try/catch), so no `.catch` is needed here.
dispatch(args).then(code => {
    process.exitCode = code;
});
