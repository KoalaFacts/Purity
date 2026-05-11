# 0033: Eager manifest emit for non-Vite consumers

**Status:** Accepted
**Date:** 2026-05-11

## Context

ADR [0032](./0032-on-disk-manifest-emit.md) added the `emitTo` plugin
option, which writes the generated route manifest to disk every time the
virtual `purity:routes` module is `load()`'d. Apps using the manifest
get `tsc` + IDE jump-to-definition for free.

That trigger only fires when some module in the Vite build graph
imports `purity:routes`. For consumers that bundle the manifest's
emitted file OUTSIDE Vite — Cloudflare Workers via `wrangler`, Deno
Deploy, custom Node entries that pre-build a single artefact, plain
`tsc` typecheck of a package that doesn't import the virtual ID — the
manifest never gets written because nothing inside Vite ever resolves
the virtual module.

The cf-workers SSR adapter example (`examples/ssr-stream-cf-workers/`)
makes this concrete: wrangler bundles `src/worker.ts` directly. Vite
isn't in the bundle pipeline at all. We want the workflow:

```bash
npm run gen-routes    # vite build → emits src/.purity/routes.ts
wrangler deploy        # bundles + ships the worker
```

…but with `emitTo` alone, `npm run gen-routes` runs Vite to completion
without ever loading `purity:routes`, so the file isn't written.

## Decision

**Wire the emit into the plugin's `buildStart` hook.** When `emitTo`
is set, the plugin regenerates the on-disk file at the start of every
`vite build` / `vite dev`, regardless of whether anything imports
`purity:routes` in this run. Same code path as `load()`; same skip-if-
unchanged guard. The virtual-module `load()` continues to emit on its
own — both triggers are idempotent because both compare existing
content byte-for-byte before writing.

```ts
buildStart() {
  if (!routesOpts || emitToAbs === null || routesAbsDir === null) return;
  const source = generateManifestSource(this, routesAbsDir, routesExt);
  emitManifestToDisk(emitToAbs, source, (msg) => this.warn?.(msg));
}
```

This makes the emit a side-effect of starting a Vite build, not a
side-effect of resolving the virtual module. Apps that already drive
the emit via the virtual module (canonical SSR demo) see no behavioral
change — `buildStart` writes the same source `load()` would, and the
no-op equality check means the second call after `load()` skips the
write.

### Use cases unlocked

- **Cloudflare Workers via wrangler.** `vite build` emits the manifest;
  wrangler bundles the worker which imports the emitted file. No code
  path goes through the virtual module.
- **Deno Deploy / Bun / standalone `node`.** Same pattern — Vite is a
  build-time tool for the manifest, the deploy target consumes the
  emitted file directly.
- **Pure-`tsc` typecheck.** `tsc --noEmit` against an example folder
  picks up the emitted file as a real source. Useful in CI where the
  Vite build runs separately.

### Explicit non-features

- **No build-graph entry stub required.** Earlier-iteration scratch
  configurations used a `src/.routes-emit-entry.ts` stub that did
  nothing but trigger a Vite build of the virtual module. With
  `buildStart`, no stub is needed — `vite build` (against the worker
  entry, or any entry, or even an empty config) emits the manifest as
  a side effect. The single source of truth stays the plugin's own
  manifest generator.
- **No CLI sub-command.** Rejected in ADR 0032 as drift-prone (two code
  paths). Same reasoning applies here — `buildStart` keeps the emit
  inside the plugin.
- **No standalone `purity emit` command.** Users running pure-`tsc`
  pipelines can still trigger the emit by running `vite build` in a
  prebuild step. Adding a separate CLI command would re-introduce the
  drift problem.
- **No emit on `configResolved`.** `configResolved` fires for every
  Vite invocation including `vite --help`, `vite preview`, plugin-
  config validation, etc. `buildStart` is the right scope — it fires
  exactly when a real build (or dev server) starts.
- **No multi-target emit.** Same as ADR 0032: one file per plugin
  instance.

## Consequences

**Positive:**

- Closes the manifest-for-non-Vite-consumers gap. The cf-workers SSR
  adapter (and the parallel `ssr-stream-vercel-edge/`,
  `ssr-stream-deno/` examples that ship next) can drive the emit with
  a one-line `vite build` prebuild.
- Backward-compatible. Apps already on ADR 0032's `emitTo` see no
  behavioral change — same content, same no-op equality check, same
  warnings via `this.warn`.
- Single source of truth. Both `load()` and `buildStart` call the
  same `generateManifestSource` + `emitManifestToDisk` helpers.

**Negative:**

- Slight Vite startup cost (`~1ms`) on every build/dev start when
  `emitTo` is configured. Same fs read + compare overhead ADR 0032
  documented for `load()`. Skipped silently when the file already
  matches.
- Two emit triggers (buildStart + load) mean a Vite build that also
  loads `purity:routes` writes twice — once at start, once at load.
  Both writes hit the same equality guard so the second is a fast
  no-op; the cost is one extra fs read.

**Neutral:**

- No new plugin option. Existing `emitTo` semantics are preserved;
  the change is internal (an extra trigger).
- Tests in `packages/vite-plugin/tests/routes.test.ts` cover the new
  buildStart path: emit-without-resolveId/load, no-op when `emitTo`
  is omitted, no-op when `routes` is disabled, equality-guard on
  repeat invocation.

## Alternatives considered

**Emit on `configResolved` instead of `buildStart`.** Rejected.
`configResolved` fires for every Vite invocation including `--help`
and config-validation calls — writing filesystem state from
`configResolved` would surprise users running plugin-introspection
commands. `buildStart` cleanly gates the side-effect on a real build
or dev server starting.

**Add a `force?: boolean` option that always rewrites.** Rejected for
this iteration. The skip-if-unchanged guard is the established
behavior; an unconditional rewrite is just `touch` and doesn't help
any documented use case.

**Ship a separate `@purityjs/cli` command (`npx purity emit`).**
Rejected for the same reason as ADR 0032: adds a parallel code path
that drifts from the plugin's. The plugin-driven emit stays in sync
because both paths use the same generator.

**Auto-detect non-Vite consumers and only emit eagerly then.**
Surprising default; non-Vite consumers aren't visible from the plugin
context anyway (the plugin only knows about the current Vite build).
Explicit opt-in via `emitTo` is the right interface — the only
question is when to fire, and `buildStart` is more aligned with user
intent than `load()` for non-Vite-consuming builds.
