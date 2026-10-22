# benchmark/tools — long-running profiler

CPU + memory + I/O profiling for the head-to-head bench scenarios. Use these
tools to find bottlenecks once the bench has identified a regression you want
to dig into.

## Production bundle sizes

Use `npm run check:bundle` from the repository root for matched runtime/AOT
counter builds, compressed-size budgets, and CI reports. Add `-- --verify`
to check both built counters in Chromium. See the
[bundle measurement guide](../bundle-size/README.md) for the scope and limits.

## Prereqs

The vite preview must be running on port 4173:

```bash
cd benchmark
npm run build       # uses development condition → no rebuild of @purityjs/core needed
npm run preview &   # likewise
```

`npm run build` and `npm run preview` set `NODE_OPTIONS='--conditions=development'`,
which makes Node resolve `@purityjs/core/compiler` to the package's source via
the `"development"` conditional export (see `packages/core/package.json`). This
means edits to `packages/core/src/compiler/codegen.ts` flow through one bench
build — you do not need to `npm run build -w @purityjs/core` first.

## Single-framework profile

```bash
node tools/profile.ts <framework> <scenario>
node tools/analyze.ts <profile-dir>
```

(Node 22+ runs `.ts` files natively — no bundler step.)

Frameworks: `purity | solid | svelte | vue`
Scenarios: `create | append | replace | update | swap | clear-after-create`

Each run writes artifacts to `/tmp/profiles/<framework>-<scenario>-<timestamp>/`:

- `cpu.cpuprofile` — Chrome CPU profile. Drag into DevTools "Performance" tab
  to view a flame chart.
- `heap-before.heapsnapshot`, `heap-after.heapsnapshot` — heap snapshots taken
  before and after the captured operation. Drag into DevTools "Memory" tab.
- `metrics.json` — `Performance.getMetrics` deltas (DOM nodes, layout count,
  paint count, script duration), network bytes, and timeline metadata.

`analyze.mjs` prints CPU buckets (jsUser / domOps / GC / program), memory and
DOM deltas, and the top-N hot functions by self time.

## Cross-framework comparison

```bash
node tools/compare.ts <scenario>
```

## Accessibility fixtures

Run the benchmark development server, then scan the form fixtures in all
three Playwright browser engines:

```bash
npm run dev
npm run a11y -- http://localhost:5173/Purity/a11y/form.html all
npm run a11y -- http://localhost:5173/Purity/a11y/ssr-form.html all
npm run a11y -- http://localhost:5173/Purity/a11y/complex.html all
npm run a11y:form -- http://localhost:5173/Purity/
npm run a11y:matrix -- http://localhost:5173/Purity/
```

Install missing browser engines with `npx playwright install firefox webkit`.
The scanner reports axe-core findings, including incomplete rules. The
matrix prints per-scenario metrics as JSON and fails when an assertion fails.
It uses a 320 CSS pixel viewport for reflow, 200% root font size as a text
resize proxy, and browser-emulated forced colors. These do not verify actual
browser zoom, operating-system high contrast, NVDA, or VoiceOver. See the
[accessibility audit](../../docs/accessibility.md) for results and the
screen-reader acceptance criteria that remain unverified.

## Functional sanity check

`npm run test:browser:binding -w purity-benchmark` builds the production
benchmark and checks both Purity and Solid in Chromium, Firefox and WebKit.
It verifies that Clear All clears user-entered values after creation, a bulk
update, a previous clear and recreation with the same numeric IDs. All 100
inputs must have explicit associated labels; clicking a label must focus its
input.

After building, `npm run test:browser:parity -w purity-benchmark` compares the
row and binding fixtures' semantic DOM under `#main` after create, append, update, selection,
removal, swap, clear, recreation and reload actions. Elements, attributes,
input values and text must match. Framework comments, split text nodes,
formatting whitespace and CSS serialization are normalized; semantic wrappers
and accessibility attributes are not excluded. Gzipped raw JSON snapshots are
saved under `benchmark/dist/fixture-parity` and uploaded by CI.

The row fixtures generate the same LCG data inside the original actions. The
seed starts at 1 and IDs start at 1 on page load; neither resets on create or
clear. A fixed first-label sequence and reload check guard this contract. The
field fixture keeps object identity keys and both pages retain all original
selectors, including `#result-container` (now present in Solid too).

Both checks default to all three engines. For an explicitly scoped local run,
use `node benchmark/tools/binding-browser-check.ts chromium` and
`node benchmark/tools/fixture-parity-browser-check.ts chromium` after building.
CI rejects a single-engine selection; a local Chromium result never implies
Firefox or WebKit passed.

This is fixture correctness evidence, not a runtime optimization or a new
performance ranking. Row state-update strategies still differ: Purity copies
row objects, while Solid updates individual label signals. Versions, timing
boundaries, operation sizes and size budgets stay unchanged. Old measurements
remain attached to their source SHA. Continuing comparison work is tracked in
[#276](https://github.com/KoalaFacts/Purity/issues/276).

```bash
npm run sanity
# or: node --conditions=development tools/sanity.ts
```

Loads each Purity bench app, exercises the typical interactions (create /
append / replace / update / select / remove / two-way bind / conditional
toggle / cart increment) and asserts the **rendered output is correct** —
not just that the node counts are right. Catches regressions that a
benchmark can't see: a template where every row renders `undefined` still
counts the right number of `<tr>`s. Run after any change that touches
the reactivity, codegen, or `each()` paths.

Profiles all four frameworks back-to-back and prints a Markdown table.

## Memory retention check

`npm run test:browser:memory` builds a Purity-only production fixture and runs
it in Chromium. CI repeats keyed-list updates and virtual-list scrolling across
mount/unmount cycles, forces garbage collection between batches, and reports
heap size, DOM nodes, and weakly referenced detached hosts, rows, and state
accessors. It fails if retained objects exceed a small allowance or if heap
growth after warmup exceeds 1.5 MB over 75 cycles. The heap limit is a
regression guard, not proof that every
possible resource is leak-free; other browser engines do not expose the same
heap controls. A positive control deliberately retains 10 mounts to verify
that the probe detects them. The result appears in the CI job summary.

## Caveats

- CDP profiling adds ~3× overhead vs the raw bench. Use these numbers for
  **relative comparison** between frameworks, not absolute timings.
- Function names in production builds are minified. To get readable names,
  rebuild with `--mode development` (or pass `build.minify: false` in
  `vite.config.ts`).
- The synthetic frame `(program)` covers everything V8 attributes outside a JS
  function — typically layout, paint, parsing, and some DOM internals.
- Native DOM ops (`cloneNode`, `appendChild`, `replaceWith`, etc.) appear as
  separate self-time entries because V8 surfaces them.
