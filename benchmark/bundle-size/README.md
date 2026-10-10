# Production bundle size evidence

From the repository root:

```bash
npm run check:bundle
npm run check:bundle -- --verify
```

The first command rebuilds core, SSR, and the Vite plugin, builds four fixtures
with and without AOT, and enforces the [budgets](./budgets.json). The second
verifies all eight production builds in Chromium, Firefox, and WebKit. Every
AOT page uses a Content Security Policy without `unsafe-eval`.
Install engines with `npx playwright install chromium firefox webkit` if needed.

CI runs measurement after building the shipped packages. The browser job also
runs the interaction checks. Both write a job summary and upload `report.json`
and `report.md` as workflow artifacts, including on budget or browser failures.

## What is measured

- Production ES2022, minified ESM JavaScript from built package exports.
- Every emitted JavaScript chunk, including fixture application code.
- Raw UTF-8 bytes, gzip at level 9, and Brotli at quality 11. Each file is
  compressed separately before adding its size, matching separate responses.
- No HTML, source maps, HTTP headers, server bundle, or other framework.

The runner checks that AOT actually compiled the fixture and that the runtime
fixture kept its template. It rejects missing entries, source-only package
resolution, external imports, hidden dynamic chunks, and unexpected assets.
It does not claim that AOT eliminates every runtime compiler path in the core.

Report schema version 2 records the Git revision and dirty state, package
versions, Node and compression-library versions, normalized hashes for all
fixture sources, built entry hashes, settings, per-chunk sizes, budgets, and
optional browser verification with exact engine versions. A verified SSR
body has its own hash. Verification failures retain the size report and exit
nonzero; their diagnostics go to the job log.
Machine names and absolute filesystem paths are excluded.

## Feature profiles

| Profile     | Included functionality                                                              | Browser acceptance                                                                     |
| ----------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `counter`   | [Counter](./counter.ts), signal, template, click handler, mounting.                 | Count advances from 0 to 3.                                                            |
| `controls`  | [Shared view](./controls-view.ts), keyed each, match, nested templates, mounting.   | Reverse keeps row identity; labels update; branch toggling reuses the original branch. |
| `form`      | [Enhanced form](./form.ts), two-way input, enhanceForms, response/error handling.   | Empty submission focuses the error field; retry succeeds, keeps the input and URL.     |
| `hydration` | [Hydration entry](./hydration.ts), the same controls view and server-rendered HTML. | Preserve SSR row identity, then perform the same controls interactions.                |

Each profile's runtime/AOT pair uses the same entry and template source.
Hydration HTML is generated from that shared view by an actual SSR build
and `renderToString`, with shared built package imports. Before releasing the
client script, the browser verifier records the existing SSR nodes; this
verification instrumentation is outside the measured application payload.

The form endpoint is a local verification transport returning action-result
JSON, not a production Server Actions adapter or a deployment check. No
framework-runtime helper or other framework is added to the measured bundles.
These profiles do not certify every application, native submissions without
JavaScript, assistive technology, network-failure paths, or rendering speed.

### Expanded reference

Main `bf3b241` with these fixtures, core/SSR/plugin `0.2.4`, Vite `1.0.0`,
and Node `24.17.0` measured:

| Profile       | Runtime gzip | AOT gzip | Runtime Brotli | AOT Brotli |
| ------------- | -----------: | -------: | -------------: | ---------: |
| Counter       |        7,305 |    3,505 |          6,531 |      3,129 |
| Controls      |       14,899 |   16,755 |         13,333 |     14,796 |
| Enhanced form |       10,127 |    6,602 |          9,077 |      5,860 |
| Hydration     |       15,508 |   17,365 |         13,836 |     15,335 |

All 24 browser/profile combinations passed with Chromium `148.0.7778.96`,
Firefox `150.0.2`, and WebKit `26.4`. The controls AOT payload is about 12.5%
larger than runtime; hydration AOT is about 12.0% larger. Counter and form
AOT are smaller. Applying the counter's earlier savings to all applications
would therefore be incorrect.

The report also counts direct global `Function` call/constructor sites in
emitted JavaScript using the installed parser. Controls/hydration AOT retain
two such JIT fallback sites; counter/form AOT retain none. CSP verification
shows these fallbacks were not executed by the recorded AOT interactions.
This inventory is not a security audit or a count of compiler bytes: aliases,
other dynamic-code mechanisms, and broader user paths are outside its scope.
Removing unnecessary JIT dependencies from these controls is still open.

## Initial reference

The first local run used core/plugin `0.2.4`, Vite `1.0.0`, Node `24.17.0`, and
built framework artifacts from main after PR #174. It measured:

| Counter build       | Raw bytes | gzip bytes | Brotli bytes |
| ------------------- | --------: | ---------: | -----------: |
| Runtime compilation |    44,886 |     13,986 |       12,544 |
| AOT compilation     |    47,003 |     14,557 |       13,041 |

For this fixture AOT is slightly larger. These are complete application
payloads, not a universal framework size, runtime-speed comparison, or claim
about every application's AOT savings. Follow the current CI report for new
revisions rather than reusing this table as a permanent baseline.

## Hydration registration optimization

Moving each/match hydration callback registration from module initialization to
handle creation allows applications that do not use those controls to discard
their adoption logic and its runtime compiler dependencies. Each callback is
registered before its deferred handle reaches a template's hydration walker.
The JIT fallback and control hydration remain available when used.

The same fixture and toolchain above, compared with main at `fc6661c`, measured:

| Counter build       | Raw bytes | gzip bytes | Brotli bytes | gzip reduction |
| ------------------- | --------: | ---------: | -----------: | -------------: |
| Runtime compilation |    24,101 |      7,305 |        6,531 |          47.8% |
| AOT compilation     |     9,518 |      3,449 |        3,080 |          76.3% |

Both production counters passed Chromium interaction verification. This is
unused-code removal for this fixture, not a measured rendering-speed gain or
a promise that applications using each/match remove those dependencies.

## Budget changes

Limits allow roughly 5% growth over the optimized measurements, rounded up
to 256-byte boundaries.
Both gzip and Brotli, and the direct `Function` call-site count, must remain
within their profile's limit. A failure exits
nonzero and records the measured value and limit; it never updates budgets
automatically. Review the current report and the code/toolchain change before
editing a budget.

Recorded change: `counter-runtime` gzip 7680 to 7808 and Brotli 6912 to 7040
(+128 bytes each). The increase pays for the shared SSR/CSR value-coercion
helpers (`flattenValue` / `valueText`) that keep client array and text output
identical to SSR, enforced by the cross-path conformance suite. No other budget
changed.

For an investigation that deliberately exceeds a budget, use:

```bash
npm run check:bundle -- --measure-only
```

This records violations and explicitly marks the budget as unenforced. It
does not suppress browser failures when combined with `--verify`. CI
uses the enforcing mode. Sizes may change with the toolchain or compression
library, so a budget failure requires investigation rather than automatically
proving a framework regression.
