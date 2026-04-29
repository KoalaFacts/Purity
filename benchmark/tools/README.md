# benchmark/tools — long-running profiler

CPU + memory + I/O profiling for the head-to-head bench scenarios. Use these
tools to find bottlenecks once the bench has identified a regression you want
to dig into.

## Prereqs

The vite preview must be running on port 4173:

```bash
cd benchmark
npm run build
npx vite preview --port 4173 &
```

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

Profiles all four frameworks back-to-back and prints a Markdown table.

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
