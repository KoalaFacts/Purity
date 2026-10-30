# SV2-015: architecture redesign evidence (2026-10-30)

This is a bounded, in-progress record for SV2-015. It does not mark the gap or
the architecture plan complete. The after measurements below refer to an
uncommitted working-tree snapshot, not a release or a CI run.

## Before: committed baseline

The baseline was built from clean commit `08eecf9f24c3150f361a0ea97662e9189b909674`
in an isolated checkout. `npm ci`, the core, SSR and Vite plugin builds, and
`node --experimental-strip-types benchmark/bundle-size/measure.ts --measure-only`
completed. The complete machine-readable result, fixture hashes, compression
settings and tool versions are in [before.json](./before.json). Node was
24.22.1, Vite 1.3.0, and the parser 0.154.0; the check did not run browsers
or enforce budgets. Examples: counter AOT was 3,529 B gzip / 3,234 B Brotli;
controls CSR AOT was 7,433 B gzip / 6,730 B Brotli. These are complete
fixture payloads, not standalone framework-size claims.

## After: fixture comparison and gate

The after snapshot was measured with
`node --experimental-strip-types benchmark/bundle-size/measure.ts --verify`
after the package builds completed. [after.json](./after.json) records a dirty
working tree based on `08eecf9`, the same Node, Vite and parser versions and
the output hashes. All fixture source hashes match the baseline except
`form.ts`, whose package import changed; it is excluded from this comparison.
The following complete application payloads use the same source fixtures and
compression settings:

| Profile                | Before gzip | After gzip | Change | Before Brotli | After Brotli |
| ---------------------- | ----------: | ---------: | -----: | ------------: | -----------: |
| counter runtime        |       9,141 |      9,204 |    +63 |         8,303 |        8,396 |
| counter AOT            |       3,529 |      3,476 |    -53 |         3,234 |        3,202 |
| counter CSR AOT        |       3,160 |      3,084 |    -76 |         2,895 |        2,841 |
| counter-client runtime |       9,101 |      9,161 |    +60 |         8,273 |        8,358 |
| counter-client AOT     |       3,529 |      3,476 |    -53 |         3,234 |        3,202 |
| counter-client CSR AOT |       3,160 |      3,084 |    -76 |         2,895 |        2,841 |
| controls runtime       |      16,350 |     13,846 | -2,504 |        14,848 |       12,577 |
| controls AOT           |       8,275 |      8,377 |   +102 |         7,414 |        7,507 |
| controls CSR AOT       |       7,433 |      5,506 | -1,927 |         6,730 |        5,007 |
| hydration runtime      |      17,173 |     14,659 | -2,514 |        15,600 |       13,320 |
| hydration AOT          |       9,107 |      9,214 |   +107 |         8,181 |        8,269 |
| resource runtime       |      10,371 |     10,347 |    -24 |         9,526 |        9,470 |
| resource AOT           |       5,123 |      5,029 |    -94 |         4,657 |        4,583 |
| resource CSR AOT       |       4,526 |      4,403 |   -123 |         4,149 |        4,048 |

The after run verified all 17 production fixture profiles in Chromium
156.0.8078.4, Firefox 157.0 and WebKit 27.2; the before run did not include
browser verification. The command exited 1 because the unchanged budget
checks failed:

- Both gzip and Brotli budgets are unset for `reactive-signals`, `core-forms`,
  `core-csr-runtime` and `ssr-runtime`.
- The broader `runtime-all` aggregate is 47,907 B gzip / 42,217 B Brotli
  against the retained `core-all` caps of 46,080 / 40,704 B.
- The expanded SSR entry is 8,920 B gzip / 8,088 B Brotli against its old
  caps of 5,376 / 4,864 B.

The aggregate now includes all split runtime packages, including the SSR and
compiler entries; the SSR entry also owns implementations formerly in core.
Neither package comparison is like-for-like with the old budget scope. No
budget was changed, and a failed gate is not an acceptance result.

## New package budgets

The package topology now has its own budget set. The measured baseline covers
every runtime package export plus the combined `runtime-all` fixture. For each
entry and compression method, its limit is the measured byte count plus 10%,
rounded up to the next 128 bytes. The fixture limits remain unchanged. The
schema 7 `budget-baseline.json` records the new scope, measurements and limits;
the schema 5 `before.json` retains the old limits for historical comparisons.
The two aggregate budgets have different scopes and are not comparable as a
single package-size delta.

The new baseline was recorded with `measure.ts --verify`: all 21 package
measurements passed their gzip and Brotli limits, and all 17 production fixture
profiles passed in Chromium, Firefox and WebKit. The report was generated
from the uncommitted working tree and is not CI evidence.

## Bounded CSR isolation within the redesign

A separate full-entry browser consumer was built at three points during the
redesign. Its entry imported every export from `@purityjs/core/csr` and
assigned the namespace to `globalThis`. Vite used `configFile: false`,
`browser` and `production` conditions, ES library output, `write: false`,
and no minification. The number below is the sum of UTF-8 bytes in all emitted
JavaScript chunks, without compression:

| Redesign step                     |  Bytes | Observation                                                                                           |
| --------------------------------- | -----: | ----------------------------------------------------------------------------------------------------- |
| Before passive hydration dispatch | 53,375 | Included the `__purity_deferred__` marker.                                                            |
| After passive hydration dispatch  | 45,517 | No `__purity_deferred__`, `getSSRRenderContext`, `ssrControls`, or `resolvedDataByKey` in the output. |
| After extracting virtual lists    | 35,964 | The same markers and `data-purity-window-spacer` were absent.                                         |

These are intermediate working-tree measurements of one all-exports CSR
consumer, not a comparison against the original commit's nonexistent CSR
entry or a gzip/Brotli budget result. The source-level regression test is
`packages/vite-plugin/tests/browser-exports.test.ts`, which built a CSR
consumer and checked that hydration, SSR and virtual-list markers were absent.
Its two tests passed when run with
`npx vp test run --config packages/vite-plugin/vitest.config.ts packages/vite-plugin/tests/browser-exports.test.ts`.
Marker absence alone does not prove all server-only behavior was eliminated.

The virtual-list browser check passed in Chromium 156, Firefox 157 and WebKit
27.2 using `node --conditions=development --experimental-strip-types
benchmark/tools/virtual-browser-check.ts`. It exercised approximately 18–19
rendered virtual rows at the start/end, scrolling through 10,000 rows inside
Shadow DOM, ordinary nonvirtual rows and multi-root reorder. This check used
the development condition; it is not production-bundle browser verification.

Separately, `npm run test:browser:islands` passed in Chromium 156.0.8078.4,
Firefox 157.0 and WebKit 27.2. It checked first interaction, keyboard input,
forms, external submitters and SVG interaction after the islands move.

## Remaining acceptance

- Repeat production-profile browser verification and the full repository
  checks after the final source revision is fixed. Local runs are not CI
  evidence.
- Keep the original fixture caps. The split-package budget applies to the new
  topology; do not present its aggregate as a like-for-like `core-all` delta.
- Recheck all result artifacts against the final source revision and evaluate
  the remaining SV2-015 capability criteria before changing gap status.
