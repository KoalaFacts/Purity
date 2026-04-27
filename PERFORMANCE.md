# Performance Suggestions

Prioritized list of potential performance improvements across the Purity
monorepo. Each item has a file:line reference, the cost it pays today, and a
proposed change. None of these are bugs — the codebase is already heavily
optimized — but each is a measurable opportunity.

Benchmarks live in `packages/core/tests/benchmark.test.ts`. Verify any change
against that suite (and add a focused micro-benchmark where relevant) before
merging.

---

## Tier 1 — High impact, low effort

### 1. Cache scoped selectors in reactive `css()`

**Where:** `packages/core/src/styles.ts:92-100` (and the `scopeSelectors`
implementation at `packages/core/src/styles.ts:121-152`).

**Today:** When a `css\`...\`` block contains reactive interpolations, every
dependency change re-runs the full string-scanning `scopeSelectors` over the
entire CSS text — even if only a value (not a selector) changed.

```ts
// styles.ts:92-100
if (hasReactive) {
  let prevCss = '';
  const dispose = watch(() => {
    const newCss = scopeSelectors(buildCss(), `.${scopeClass}`);
    if (newCss !== prevCss) {
      prevCss = newCss;
      styleEl.textContent = newCss;
    }
  });
```

**Proposal:** Split scoping from value substitution. Scope selectors **once**
(the selector text is static — it lives in the template strings, not in the
expressions), then on each reactive update only re-stringify the dynamic
values into the pre-scoped template.

**Impact:** Avoids an O(n) scan over the whole CSS on every reactive style
update. Largest wins on components with frequently-changing reactive theme
values (e.g. `${() => isDark() ? '#000' : '#fff'}`).

---

### 2. Skip `Set` allocation for tiny effect batches

**Where:** `packages/core/src/signals.ts:94-116`.

**Today:** Every flush with >1 pending effect allocates a fresh `Set` purely
to dedupe the polyfill's duplicated entries.

```ts
// signals.ts:108-116
const seen = new Set<Signal.Computed<void>>();
for (let i = 0; i < raw.length; i++) {
  seen.add(raw[i]);
}
for (const s of seen) {
  watcher.watch(s);
  s.get();
}
```

A single-pending fast path already exists at `signals.ts:97-101`. Most flushes
in real apps have ≤3 effects.

**Proposal:** Add a small-array fast path (e.g. n ≤ 4) that dedupes via linear
scan into a stack-allocated array, falling back to `Set` only for larger
batches. The existing comment at `signals.ts:105-107` documents *why* dedup is
needed — keep it.

**Impact:** Removes one `Set` allocation + iterator per flush in the common
case. Micro, but the flush is the central hot path.

---

## Tier 2 — Targeted wins

### 3. Buffer template-extraction string growth in the Vite plugin

**Where:** `packages/vite-plugin/src/index.ts:320-358` (especially line 353).

**Today:** Character-by-character `current += source[pos]` makes
`extractTemplateLiteral` quadratic for large templates.

```ts
// vite-plugin/src/index.ts:353
current += source[pos];
pos++;
```

**Proposal:** Track template segments by index pairs (start/end) into the
original `source` and use `source.slice(start, end)` once per segment, or
push character ranges into an array and `.join('')` at the end. Also applies
to the `inString` / `inTemplate` branches in `extractExpression`
(`packages/vite-plugin/src/index.ts:360-434`).

**Impact:** Build-time only, but speeds up dev-server cold starts and CI
build times on projects with many or large `html\`\`` templates.

---

### 4. Add a "prepend-only" fast path to `each()`

**Where:** `packages/core/src/control.ts` — append-only path is already at
~`control.ts:406-424`; LIS allocations begin at ~`control.ts:458-509`.

**Today:** Append-only updates short-circuit nicely. Prepend-only updates
(common in chat/feed UIs) fall through to the full LIS path, allocating
`oldKeyIndex`, `sources`, `newIndexToSource`, and an `lisIndices` `Set`.

**Proposal:** Detect `len > prevLen` where the *suffix* of `newKeys` equals
`prevKeys` (i.e. only new items prepended). Insert the new nodes before the
first existing entry in a single `Range`/`DocumentFragment` operation and
skip LIS entirely. Mirror the structure of the existing append-only branch.

**Impact:** Removes 4 allocations and the LIS computation for a common UI
pattern. Especially valuable for long lists (e.g. `1000+` items).

---

### 5. Trim template fragment edges in a single pass

**Where:** `packages/core/src/compiler/codegen.ts` — `trimFragmentEdges`
(approx. lines 72-88).

**Today:** Each candidate text node calls `value.trim()` (allocates) **and**
`value.includes('\n')` (second scan).

**Proposal:** Inline a single-pass check: walk characters once; bail early on
any non-whitespace; remember whether a `\n` was seen. Avoids the trim
allocation entirely.

**Impact:** Compile-time only; small but free. Worth doing while touching the
file.

---

## Tier 3 — Considered, recommend leaving as-is

These showed up during the audit but the current code is the right call.

- **Slot accessor `Proxy`** (`packages/core/src/elements.ts:58-74`). API
  ergonomics dominate; per-access overhead is negligible at typical slot
  counts (≤5).
- **`match()` cache unboundedness** (`packages/core/src/control.ts:37`).
  Bounded in practice by the number of cases. Document the high-cardinality
  caveat if it ever becomes a real-world concern; don't add eviction yet.
- **Recursive `unmountContext`** (`packages/core/src/component.ts:244-302`).
  Iterative rewrite would only matter for component trees deeper than ~100
  levels, which isn't a realistic Purity app shape.
- **Pre-bound `state()` getters/setters** (`packages/core/src/signals.ts:158-159`).
  Already optimal; documenting here so future refactors don't accidentally
  regress it.
- **`signal-polyfill` overhead.** Out of scope. Will improve naturally when
  TC39 Signals ship natively.

---

## Suggested verification workflow

1. Add a focused benchmark next to `packages/core/tests/benchmark.test.ts`
   for the specific path being changed (reactive CSS update, small-batch
   flush, prepend-only list update).
2. Capture before/after numbers in the PR description.
3. Run the full benchmark suite to check for regressions in adjacent paths
   (signal read/write, 1000-item keyed list, deep compute chain).
4. Run `npm test --workspaces` and `npx biome check --write .` before
   committing.
