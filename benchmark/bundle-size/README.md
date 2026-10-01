# Production bundle size evidence

From the repository root:

```bash
npm run check:bundle
npm run check:bundle -- --verify
```

The first command rebuilds the core and Vite plugin, builds the same
[counter fixture](./counter.ts) with and without AOT, and checks the
[compressed-size budgets](./budgets.json). The second also launches Chromium
and verifies that both production buttons advance from 0 to 3 without browser
errors. Install the browser with `npx playwright install chromium` if needed.

CI runs measurement after building the shipped packages. The browser job also
runs the interaction check. Both write a job summary and upload `report.json`
and `report.md` as workflow artifacts, including when a size budget fails.

## What is measured

- Production ES2022, minified ESM JavaScript from built package exports.
- Every emitted JavaScript chunk, including the counter application code.
- Raw UTF-8 bytes, gzip at level 9, and Brotli at quality 11. Each file is
  compressed separately before adding its size, matching separate responses.
- No HTML, source maps, HTTP headers, server bundle, or other framework.

The runner checks that AOT actually compiled the fixture and that the runtime
fixture kept its template. It rejects missing entries, source-only package
resolution, external imports, hidden dynamic chunks, and unexpected assets.
It does not claim that AOT eliminates every runtime compiler path in the core.

The report records the Git revision and dirty state, core/plugin/Vite versions,
Node and compression-library versions, a normalized fixture hash, built entry
hashes, settings, per-chunk sizes, budgets, and optional browser verification.
Machine names and absolute filesystem paths are excluded.

## Initial reference

The first local run used core/plugin `0.2.4`, Vite `1.0.0`, Node `24.17.0`, and
built framework artifacts from main after PR #174. It measured:

| Counter build       | Raw bytes | gzip bytes | Brotli bytes |
| ------------------- | --------: | ---------: | -----------: |
| Runtime compilation |    44,886 |     13,986 |       12,544 |
| AOT compilation     |    47,007 |     14,559 |       13,033 |

For this fixture AOT is slightly larger. These are complete application
payloads, not a universal framework size, runtime-speed comparison, or claim
about every application's AOT savings. Follow the current CI report for new
revisions rather than reusing this table as a permanent baseline.

## Budget changes

Initial limits allow roughly 5% growth, rounded up to 256-byte boundaries.
Both gzip and Brotli must remain within their profile's limit. A failure exits
nonzero and records the measured value and limit; it never updates budgets
automatically. Review the current report and the code/toolchain change before
editing a budget.

For an investigation that deliberately exceeds a budget, use:

```bash
npm run check:bundle -- --measure-only
```

This records violations and explicitly marks the budget as unenforced. CI
uses the enforcing mode. Sizes may change with the toolchain or compression
library, so a budget failure requires investigation rather than automatically
proving a framework regression.
