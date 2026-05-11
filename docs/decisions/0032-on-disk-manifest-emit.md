# 0032: `emitTo` — on-disk manifest emit

**Status:** Accepted
**Date:** 2026-05-11

## Context

ADR [0019](./0019-file-system-routing.md) exposes the route
manifest via a **virtual module** (`purity:routes`). The plugin's
`load()` hook returns generated JavaScript when the virtual ID is
requested; nothing is written to disk. This is great for runtime
(Vite serves it, code-splits per route, HMRs cleanly) but leaves
two gaps the existing ADRs flag:

1. **`tsc` blindness.** A bare `tsc --noEmit` over the project
   can't see what `purity:routes` exports — there's no file to
   inspect. Apps work around this with an ambient
   `declare module 'purity:routes' { … }` block (the example does
   this in `purity-routes.d.ts`). Manual + drifts as the manifest
   shape evolves.
2. **IDE go-to-definition.** Hovering / cmd-clicking
   `routes`/`notFound`/`notFoundChain` in user code lands in the
   ambient declaration (or fails) instead of the actual data the
   plugin emits. Hides the per-route detail apps frequently want
   to inspect (which file is `/users/:id`'s `entry.filePath`?).

ADR [0031](./0031-typed-route-params.md) shipped `RouteParams<P>`
as a manual annotation users add per-route module. It's enough
when the author knows the pattern. The on-disk emit is the
complement: a real file `tsc` can read directly, no ambient
declaration needed.

This ADR adds an opt-in `emitTo` plugin option. When set, the
plugin's `load()` writes the same generated source to a real file
on disk in addition to returning it as the virtual module. Apps
get `tsc` visibility, IDE jump-to-def, and the existing virtual-
module consumers keep working unchanged.

## Decision

**Add `emitTo?: string` to `RoutesOptions`.** Path is relative to
Vite's project root. On every `load()` of the virtual module
(which happens on initial build + every HMR invalidation), the
plugin compares the file's existing content to the freshly-
generated source and writes only on change. Apps wire it up with
a single line plus a `.gitignore` entry:

```ts
// vite.config.ts
purity({
  routes: {
    dir: 'src/pages',
    emitTo: 'src/.purity/routes.ts',
  },
});
```

```
# .gitignore
src/.purity/
```

Consumers can keep importing from `'purity:routes'` (no change),
or switch to the real file path (`'./.purity/routes.ts'`) for
better `tsc` + IDE behavior. Both yield identical runtime values
because the file's content IS the virtual module's content.

Concretely:

- **`emitTo: string`** — path relative to Vite's `root`. Resolved
  via `resolvePath(config.root, emitTo)`. The plugin creates
  parent directories as needed.
- **Atomic-ish write**: read existing content first; skip the
  write if it matches the new content byte-for-byte. Prevents
  filesystem-watch loops in dev (file → reload → re-emit →
  same content → silent skip).
- **Content is identical to the virtual module.** Same
  `generateRouteManifestSource` output; same `routes` / `notFound`
  / `notFoundChain` exports. No type-narrowing changes — apps
  that want narrow types use `RouteParams<'/users/:id'>` per
  ADR 0031.
- **No bundler integration**. The emit is a pure side-effect.
  Vite's bundling continues to use the virtual module; the
  emitted file is purely for `tsc` / IDE. Apps that import
  from the real path get the same code as the virtual module
  (the file is part of the source graph; Vite resolves it
  normally).
- **Failure is non-fatal.** If the write fails (permission
  denied, etc.) the plugin logs a warning via `this.warn` and
  continues — the virtual module still returns the source, so
  the runtime is unaffected. Apps with read-only filesystems
  (some CI sandboxes) just don't get the on-disk artefact.
- **Default: off.** Apps that don't set `emitTo` see no
  filesystem activity — back-compat with every ADR 0019-0031
  consumer.

### Explicit non-features

- **No `gitignore` auto-management.** Apps add the entry
  manually. Plugin-managed gitignore is fragile (per-monorepo
  conventions vary; nested gitignore files conflict; CI
  configurations differ). Documented.
- **No type-narrowing tweaks.** The emitted file's
  `pattern: string` doesn't change to `pattern: '/users/:id'`
  via `as const`. Adding `as const` deepens readonliness and
  breaks the existing virtual-module-shape contract. Apps that
  want narrow types use `RouteParams<P>` per ADR 0031 — the
  pattern is a string literal the author writes, not derived
  from manifest iteration.
- **No multi-target emit.** One file per plugin instance. Apps
  with multiple manifests (rare) configure separate plugin
  instances.
- **No build artifact**. The emitted file is a development
  artefact; including it in `.gitignore` is the documented
  pattern. Apps that want it tracked can commit it, but Vite
  HMR will rewrite on every restart — diff noise unless your
  page tree is fully frozen.
- **No declaration file (`.d.ts`) variant.** The emit is a
  full `.ts` source — `tsc` infers types automatically. A
  `.d.ts`-only variant would require generating ambient types
  separately; cost > value when the runtime file is already
  there.
- **No content-hash short-circuit**. The implementation reads
  the existing file each `load()` for the no-write check. Fine
  at scale (manifest is small, fs read is cheap); a future
  optimization could cache the last-written hash in memory.

## Consequences

**Positive:**

- Closes the on-disk-emit half of ADR 0019's "build-time route
  table emit" deferred non-feature.
- Apps get `tsc`-friendly + IDE-friendly typed entries without
  hand-maintaining ambient declarations. The example's
  `purity-routes.d.ts` becomes optional (still works; just
  redundant once `emitTo` ships).
- Single one-line opt-in. Tree-shakes to nothing when off.
- Round-trip with the virtual module is byte-exact. Apps can
  flip between importing `'purity:routes'` and the real path
  and get identical runtime behavior.

**Negative:**

- The emitted file's contents include absolute paths (the
  `importFn` calls). Committing the file to git would leak
  developer-machine paths into history. Documented;
  `.gitignore` is the recommended setup.
- File-watch loops are a real risk if the no-write check
  fails (e.g. trailing-newline mismatch). The implementation
  uses a strict equality check + writes only on change;
  monitored by tests.
- Per-`load()` fs read + compare adds ~1ms overhead vs the
  pure virtual-module case. Negligible during dev; sub-noise
  during build.

**Neutral:**

- One new plugin option (`emitTo`). Existing options +
  manifest output unchanged.
- Tests: a tmpdir-based integration test verifies the file is
  written on `load()`, that re-`load()` with no manifest change
  skips the write (the file's mtime stays the same), and that
  manifest changes (new file added) re-emit.

## Alternatives considered

**Emit on demand via a separate CLI command** (`npx purity emit`).
Decouples emit from Vite. Rejected: adds a separate code path
that drifts from the plugin's. Plugin-driven emit stays in sync
because both paths use the same `generateRouteManifestSource`
output.

**Emit as a side-effect of `vite build`** (not `vite dev`).
Build-only emit means tsc is happy in CI but IDEs in dev still
see the ambient declaration. Rejected: defeats half the value.
Dev emit is cheap; both modes get it.

**Emit a sidecar `.d.ts` (declaration-only) instead of a `.ts`
source.** Smaller artefact, no absolute paths. Rejected: would
require maintaining a separate type emitter parallel to
`generateRouteManifestSource`. Cost of two emitters > benefit
of clean d.ts (which apps can always derive from the source).

**Generate `routes` with `as const` for tight pattern types.**
Considered but rejected this iteration — narrows `pattern` to
its literal type but also makes the whole array readonly, which
breaks consumers expecting `RouteEntry[]`. Apps wanting narrow
types use `RouteParams<P>` (ADR 0031). A future ADR could add
a `narrow: true` option to `emitTo` that emits with `as const`

- exports a `RouteFor<P>` helper.

**Embed the emit path in the virtual-module specifier**
(`purity:routes:emit=src/.purity/routes.ts`). Avoids a separate
option. Rejected: violates the "specifier is opaque" convention
and complicates the `resolveId` hook.

**Auto-derive `emitTo` from the routes dir** (`{ dir: 'src/pages',
emitTo: 'src/pages/.purity.ts' }` by default). Surprising default;
some apps want the file outside their pages dir. Explicit opt-in
keeps the plugin's "no surprises" posture.
