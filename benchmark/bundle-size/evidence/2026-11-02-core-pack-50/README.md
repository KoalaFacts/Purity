# SV2-015: core installation archive target

The agreed 50% metric is the combined compressed npm archives needed to
install the core package. Published `@purityjs/core` 0.4.0 has no runtime or
peer dependencies. The unpublished 0.5.0 core depends on the matching
`@purityjs/signals` and `@purityjs/compiler` packages; both are counted once.
Neither has additional runtime or peer dependencies.

| Actual npm archive | Version | Compressed bytes |
| ------------------ | ------: | ---------------: |
| Published core     |   0.4.0 |          947,461 |
| Workspace core     |   0.5.0 |          218,693 |
| Workspace signals  |   0.5.0 |           40,433 |
| Workspace compiler |   0.5.0 |           71,499 |
| Workspace total    |   0.5.0 |          330,625 |

The [machine-readable report](./report.json) records archive integrities and
the checked browser bundle hashes. The current archives are 65.1% smaller than
the published baseline; half the
baseline is 473,730.5 B. All three workspaces were rebuilt before packing.
The actual `.tgz` bytes were checked against their npm SHA-512 metadata. The
baseline archive also matched the published 0.4.0 integrity and the installed
baseline's 254 files were checked against the published archive.

CI checks the combined compressed size against the 473,730 B limit in
`core-install-budget.json`, using npm pack metadata and checking the dependency
closure. This measurement leaves 143,105 B of headroom at the recorded size.
The CI size check does not run the browser or installed-package smoke checks.

The three workspace archives were installed together offline into an isolated
consumer. Its package metadata and local archive integrities were checked,
and its ESM/CJS entrypoints exposed matching names: 28 core, 15 signals and
13 compiler exports. The installed root API and the published root have the
same 28 names in a production browser bundle. Chromium, Firefox and WebKit
passed the comparison's state/watch, mount/unmount and automatic native-form
submission smoke checks. Source-map validation checked 124 local source
references in the installed packages. Three focused component/form test files
passed (66 tests); prior focused control, SSR hydration and browser checks are
recorded in adjacent evidence reports. These are targeted checks, not a proof
of every possible application behavior.

This is a local package-build result: version 0.5.0 has not been published by
this audit. It is not a complete monorepo installation comparison. For context,
the separately measured 28-export browser bundle is 16,571 B gzip for 0.4.0
and 13,535 B for the current pack, a reduction of about 18.3%, not 50%.

To reproduce from a clean, built workspace and isolated consumer:

```sh
node -e "require('node:fs').mkdirSync('benchmark/dist/core-pack-audit',{recursive:true})"
npm run build -w @purityjs/signals
npm run build -w @purityjs/compiler
npm run build -w @purityjs/core
npm install --prefix benchmark/dist/release-040 --legacy-peer-deps --ignore-scripts --no-audit --no-fund @purityjs/core@0.4.0 @purityjs/vite-plugin@0.4.0
npm pack --ignore-scripts --json --pack-destination benchmark/dist/core-pack-audit -w @purityjs/core -w @purityjs/signals -w @purityjs/compiler > benchmark/dist/core-pack-audit/current.json
node benchmark/bundle-size/check-core-install-budget.mjs benchmark/dist/core-pack-audit/current.json
npm pack --ignore-scripts --json --pack-destination benchmark/dist/core-pack-audit @purityjs/core@0.4.0 > benchmark/dist/core-pack-audit/baseline.json
npm install --prefix benchmark/dist/core-pack-consumer --no-save --ignore-scripts --offline --no-audit --no-fund ./benchmark/dist/core-pack-audit/purityjs-core-0.5.0.tgz ./benchmark/dist/core-pack-audit/purityjs-signals-0.5.0.tgz ./benchmark/dist/core-pack-audit/purityjs-compiler-0.5.0.tgz
node --experimental-strip-types benchmark/bundle-size/compare-public-api-040.ts --current-root benchmark/dist/core-pack-consumer --verify --out benchmark/dist/core-pack-audit/browser-comparison.json
node benchmark/bundle-size/verify-core-pack-budget.mjs
```
