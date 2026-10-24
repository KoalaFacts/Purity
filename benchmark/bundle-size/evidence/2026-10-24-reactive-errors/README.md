# Reactive error recovery: reviewed bundle cost

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

## Decision and limits

Accept the measured cost of routing scheduled errors through component
handlers and giving recovery work a disposal owner. Independent source
review reproduced and corrected the recovery-watch leak; removing ownership
from the change would reintroduce that failure. The implementation adds no
runtime dependency, import edge, or permanent signal-node field. Its normal
effect-attempt path reads the existing owner; additional dispatch work occurs
on failure. `core-actions` retains scheduler support without retaining the
`ComponentContext` class.

After an independent review of the source and authentic CI reports, revise
only the two affected Brotli limits:

| Entry          | Original limit | Reviewed limit | Headroom over this measurement |
| -------------- | -------------: | -------------: | -----------------------------: |
| `core-actions` |          5,248 |          5,376 |                   118 (2.244%) |
| `core-all`     |         40,704 |         40,960 |                   141 (0.345%) |

These are the next 256-byte boundaries. This is a deliberately tighter
allowance than resetting the usual roughly 5% headroom, which would produce
5,632 and 43,008. It is an explicit acceptance of a correctness feature's
cost, not a performance optimization or an automatic budget update. The
gzip, fixture-size and `Function`-site limits and the enforcing CI mode retain
their existing values and scope.

One isolated alternate control-flow representation passed the same 14
ownership regressions but increased local Brotli output for both entries, so
it was rejected. Local Node 24.19.0/Vite 1.1.0 measurements differed from these
locked CI results and were not substituted for them.

This evidence predates the concurrent dependency-audit repair. The final PR
revision must pass a fresh enforcing CI run, including audit, all workspace
tests, packaging and browser checks. Future changes need their own evidence;
this allowance does not approve further growth or prove SolidJS parity.
