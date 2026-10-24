# Reactive error recovery: bundle measurement and optimization

This records the first strict CI measurement of the error-recovery change in
[PR #288](https://github.com/KoalaFacts/Purity/pull/288). The original limits
failed. The complete reports retain those failures and the original budgets;
they are not rewritten to imply that the first run passed.

## Reproducible inputs

| Input           | Baseline                                                                                                     | Recovery implementation                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Source          | `50c80b31d48a5c5164aa7553c7509707d9284e9f`                                                                   | PR head `fad8db2460a99cf267d16bc884c414848f1de279`                                                           |
| CI checkout     | Same as source                                                                                               | Merge checkout `6ff070591757cf7966c513a94a7bf0afe5cc8b57` against the baseline                               |
| CI run and job  | [39935450471 / 120353745653](https://github.com/KoalaFacts/Purity/actions/runs/39935450471/job/120353745653) | [40083064348 / 120840394865](https://github.com/KoalaFacts/Purity/actions/runs/40083064348/job/120840394865) |
| Complete report | [baseline.json](./baseline.json)                                                                             | [current.json](./current.json)                                                                               |

Both reports record a clean checkout, core/plugin/SSR 0.5.0, Vite 1.3.0,
OXC parser 0.154.0, Node 24.21.0, zlib `1.3.2.1-motley-8002e91`, and Brotli
1.2.0. Both CI installs used the unchanged lockfile and npm 11.19.0. Their
measurement settings and every fixture-source hash match. The Vite plugin and
CLI are build-time tools and are not part of these runtime entry budgets.

Reproduce with the corresponding checkout and installed lockfile:

```sh
npm ci
npm run check:bundle
```

Install the supported browser engines and add `-- --verify` for the browser
acceptance run. See the [measurement methodology](../../README.md).

## Measured change

These are complete minified package payloads, with every export retained and
the same external-package boundaries. Raw sizes are emitted JavaScript bytes.

| Entry          | Metric | Baseline | Recovery implementation |        Change |
| -------------- | ------ | -------: | ----------------------: | ------------: |
| `core-actions` | Raw    |   15,921 |                  16,012 |           +91 |
| `core-actions` | gzip   |    5,792 |                   5,832 |           +40 |
| `core-actions` | Brotli |    5,234 |                   5,258 |  +24 (0.459%) |
| `core-all`     | Raw    |  147,936 |                 148,086 |          +150 |
| `core-all`     | gzip   |   45,736 |                  45,763 |           +27 |
| `core-all`     | Brotli |   40,696 |                  40,819 | +123 (0.302%) |

The original Brotli limits were 5,248 and 40,704, leaving only 14 and 8 bytes
above the baseline. The measured implementation exceeded those limits by
10 and 115 bytes. Both gzip measurements remain inside their existing limits.

The current report also records all ten runtime/AOT profiles passing in
Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. Every AOT profile has
zero direct `Function` constructor/call sites and passed its restrictive-CSP
interaction checks. These checks verify the named fixtures; they do not
certify arbitrary applications or establish rendering-speed improvements.

## Retained acceptance limits

Routing scheduled errors through component handlers must also give recovery
work a disposal owner. Independent source
review reproduced and corrected the recovery-watch leak; removing ownership
from the change would reintroduce that failure. The implementation adds no
runtime dependency, import edge, or permanent signal-node field. Its normal
effect-attempt path reads the existing owner; additional dispatch work occurs
on failure. `core-actions` retains scheduler support without retaining the
`ComponentContext` class.

An intermediate proposal increased the two limits to 5,376 and 40,960 after
source review. That proposal was withdrawn: the
[acceptance review](https://github.com/KoalaFacts/Purity/pull/288#issuecomment-6383011012)
requires the original **5,248 / 40,704** limits. A repository budget-change
policy and an implementation-cost explanation do not authorize changing that
standard. [Run 40084824809](https://github.com/KoalaFacts/Purity/actions/runs/40084824809)
passed all checks with the intermediate limits, but does not resolve the
original acceptance failure. The original limits are restored; gzip,
fixture-size, `Function`-site, and enforcing-mode requirements also remain.

One isolated alternate control-flow representation passed the same 14
ownership regressions but increased local Brotli output for both entries, so
it was rejected. Local Node 24.19.0/Vite 1.1.0 measurements differed from these
locked CI results and were not substituted for them.

## Optimization under the original limits

The final candidate uses the exact CI Node 24.21.0, Vite 1.3.0 and compression
libraries. The initial diagnostic reproduced both failing payloads and hashes
exactly before changing the implementation. The complete unchanged official
runner then passed with enforcement enabled and no violations; its full
[optimized report](./optimized.json) records every package and fixture.

| Entry          | Optimized raw | Optimized gzip | Optimized Brotli | Original Brotli limit |
| -------------- | ------------: | -------------: | ---------------: | --------------------: |
| `core-actions` |        16,008 |          5,821 |            5,248 |                 5,248 |
| `core-all`     |       147,997 |         45,741 |           40,698 |                40,704 |

Relative to the unchanged baseline, Brotli grows by 14 and 2 bytes. Relative
to the first implementation it falls by 10 and 121 bytes. The remaining
headroom is zero and six bytes; these results do not imply room for future
growth or justify a toolchain-independent size claim.

The implementation keeps every export, fixture, diagnostic, ownership rule,
and original regression. It removes the callback-child factory's duplicate
final render/mount tail; callback children still perform discovery and final
renders. Owner lookup reads its internal component field once. Scheduled
error dispatch and cleanup directly preserve/restore the active listener,
avoiding callback wrappers. Cleanup restores tracking after each callback,
so later callbacks must explicitly enter untracked execution again. This adds
per-callback listener assignments compared with one wrapper around the list;
no execution-speed improvement is claimed. A new public-API regression covers
multiple cleanups, a thrown `null`, continued cleanup and caller tracking.

Private scope storage is declared before the class and accessors that use it.
This has no new runtime operation or public API, but changes emitted symbol
and compression layout: with the same raw byte count, the complete payload's
Brotli size falls from 40,709 to 40,698. This small final difference is specific
to the recorded build, not an algorithmic speed gain. Other candidate
representations that increased compressed output were rejected.

This local report accurately records base revision `d711bac` and a dirty
working tree. The [source fingerprints](./source-files.sha256) identify the
three changed runtime files, added regression and restored budget file;
other executable inputs match that base. All 2,936 workspace tests passed
under Node 24.21.0, as did formatting/lint and the package builds. This report
does not claim a local browser run. The final submitted revision must also
pass the existing complete GitHub CI, including browser, memory and packaged
consumer checks. No evidence here establishes SolidJS parity.
