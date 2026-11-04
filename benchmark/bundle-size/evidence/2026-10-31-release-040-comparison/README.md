# SV2-015: published 0.4.0 comparison

The [report](./report.json) compares published npm `@purityjs/core` and
`@purityjs/vite-plugin` 0.4.0 with the current uncommitted workspace. It is a
bounded measurement, not a release or CI result. Both versions build identical
counter, controls and resource source files with the same Vite production configuration,
ES2022 target, gzip level 9 and Brotli quality 11. The 0.5.0 AOT builds in the
table enable hydration. Each fixture emits one JavaScript chunk and has no
dynamic imports.

| Application | Mode | 0.4.0 gzip | Workspace gzip | Change |
| ----------- | ---- | ---------: | -------------: | -----: |
| Counter     | JIT  |      9,098 |          8,701 |  -4.4% |
| Counter     | AOT  |      3,484 |          2,868 | -17.7% |
| Controls    | JIT  |     16,591 |         10,712 | -35.4% |
| Controls    | AOT  |      8,502 |          5,580 | -34.4% |
| Resource    | JIT  |     10,329 |          9,846 |  -4.7% |
| Resource    | AOT  |      5,079 |          4,370 | -14.0% |

The report records package integrity, input and output hashes and tool versions.
It also records client-only AOT results for the current version: 2,504 B for
the counter, 4,868 B for controls, and 3,828 B for resource (gzip). These fixtures do not exercise
hydration, so they cannot establish parity for applications that require it.
The current workspace was dirty; its revision does not identify the measured
source by itself. Both versions passed basic counter increment, row reversal
and details-toggle interactions, as well as resource reload and save, in Chromium, Firefox and WebKit. This does not
prove complete behavioral parity, and the comparison does not include lazy
routes or an SSR hydration application. Do not treat these preliminary figures
as a release-wide 50% result.

To reproduce, build current packages, then install the released baseline and
run the comparison:

```sh
npm run build:packages
npm install --prefix benchmark/dist/release-040 --legacy-peer-deps --ignore-scripts --no-audit --no-fund @purityjs/core@0.4.0 @purityjs/vite-plugin@0.4.0
node --experimental-strip-types benchmark/bundle-size/compare-release-040.ts --verify --out benchmark/dist/release-comparison.json
```
