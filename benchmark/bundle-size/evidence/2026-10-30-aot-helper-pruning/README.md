# SV2-015: focused AOT helper pruning (2026-10-30)

This is a bounded measurement of client-side AOT helper pruning. It does not
establish whole-capability acceptance for SV2-015 or represent a release or CI
result. The sizes are complete, synthetic application payloads, not isolated
framework sizes.

The [before](./focused-before.json) run used the previously built plugin from
the committed main baseline `d6722f93a583b5274b028a33222e8d09f94539f4`.
Its working tree was dirty, including new tests; the report is not a clean
checkout measurement. The [after](./focused-after.json) run used the rebuilt
plugin with the uncommitted helper-pruning implementation, also on a dirty
working tree at the same revision. The revision field alone therefore does not
identify the measured implementation.

Both reports record matching fixture source hashes, Node, Vite and parser
versions, and settings; each also records the resulting output hashes. Vite built minified production output
for ES2022 with browser/production conditions, client-only AOT, gzip level 9
and Brotli quality 11. Each measurement is one emitted JavaScript chunk with
no lazy imports. The focused measurement can be repeated against the currently
built plugin and package dependencies with:

```sh
node --experimental-strip-types benchmark/bundle-size/measure-aot-pruning.ts --out focused.json
```

| Fixture                              | Raw before → after | Gzip before → after | Brotli before → after |
| ------------------------------------ | -----------------: | ------------------: | --------------------: |
| Static                               |        3,735 → 265 |         1,540 → 171 |           1,387 → 120 |
| Event                                |        3,698 → 228 |         1,546 → 186 |           1,391 → 118 |
| Static with mount                    |      5,051 → 2,307 |         1,991 → 961 |           1,803 → 843 |
| Event with mount                     |      5,018 → 2,274 |         2,001 → 976 |           1,815 → 861 |
| Reactive counter                     |      8,481 → 8,481 |       3,084 → 3,084 |         2,841 → 2,841 |
| Counter with helper-prefix collision |      8,978 → 8,491 |       3,327 → 3,096 |         3,052 → 2,853 |

The no-mount static and event fixtures no longer retain rendered signals code;
the mount fixtures retain some signals code for their runtime behavior. The
collision fixture no longer contains the URL validator marker when it does not
use URL bindings; the ordinary counter output hash remains unchanged. Marker
absence and these narrow fixtures do not prove all runtime behavior or security
properties, nor do these figures measure hydration or browser execution.

The separate [baseline](./before.json) and [after](./after.json) reports cover
the existing package budgets and production fixture profiles. Both passed the
budget checks and browser verification on Chromium, Firefox, and WebKit; they
were collected with dirty working trees and are not CI results.
