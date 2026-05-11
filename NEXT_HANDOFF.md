# Next handoff

This branch (`claude/path-k-m-server-action-strip-typed-routes`)
shipped both deferred follow-up items from the prior handoff:
**Path K** (smart `serverAction()` body-only stripping) and **Path M**
(sibling `routes.d.ts` emit for typed virtual-module imports). Plus a
pair of pre-existing Windows path bugs in the routes-emit pipeline
that surfaced once Path M's tests started exercising it on a
non-POSIX host. **1016 tests passing** across the three publishable
packages (up from 986 in the prior handoff: +30 new tests, +20
pre-existing failures fixed).

**ADR 0035 — smart `serverAction()` body-only stripping.** Adds
`oxc-parser` as the first hard JS-parser dep of `@purityjs/vite-plugin`
(natural fit alongside the existing `oxlint` / `oxfmt` toolchain).
The transform runs in client builds, parses each non-server-convention
file, finds `serverAction(url, handler)` calls bound to
`@purityjs/core` (direct, aliased, or namespace member), and replaces
just the inline arrow / function-expression handler with a stub
thrower. `.url` and `.invoke()` survive on the client; handler body
and its server-only imports stop shipping (tree-shaking handles the
imports). Cheap precheck — skip files that don't textually mention
both `@purityjs/core` and `serverAction` — keeps parser cost on
hits only. Defense-in-depth on top of ADR 0018's filename
convention; composes cleanly (a `*.server.ts` file is stripped
whole before reaching the per-call pass). Default-on, opt out with
`purity({ stripServerActions: false })`.

**ADR 0036 — sibling `routes.d.ts` with per-route typed `importFn`.**
ADR 0034 (`LoaderDataOf<P, R>`) typed loader data through the on-disk
emitted manifest's `() => import('<abs>')` calls, but the user-authored
ambient declaration for `'purity:routes'` types `importFn` as
`() => Promise<unknown>` — so virtual-module imports lose the per-
route shape. ADR 0036 has the plugin auto-emit a sibling `.d.ts`
next to the `emitTo` `.ts` (path swap `.ts → .d.ts`, append `.d.ts`
for any other extension). The `.d.ts` `declare module 'purity:routes'`
block emits literal tuple types whose `importFn` is
`() => Promise<typeof import('<abs>')>` per-entry; `LoaderDataOf<'/users/:id',
typeof routes>` now resolves equally well against the virtual
specifier and the on-disk one. Same content-equality skip as the
`.ts` emit — no extra filesystem-watch loops in dev.

**Side-fixes shipped this iteration.** Two pre-existing Windows
path bugs in the routes-emit pipeline (turned out to be the root
cause of the 18 pre-existing failures on Windows that the prior
handoff didn't surface):

1. **`emitManifestToDisk` parent-dir computation.** Used a POSIX-only
   regex (`/\/[^/]+$/`) to derive the parent directory before
   `mkdirSync`. Silent no-op on Windows backslash paths → ENOENT on
   `writeFileSync`. Replaced with `node:path.dirname`.
2. **Mixed-separator emit paths.** `posix.join(dir, file)` with a
   Windows-native `dir` produced strings like
   `C:\Users\...\pages/index.ts`. Now normalises `dir` to forward
   slashes before joining so emit paths stay POSIX-consistent. TS
   dynamic-import specifiers and the new typed `import('<abs>')`
   references both prefer forward slashes.

Plus the long-standing `fuzz.test.ts` not running because
`fast-check` wasn't in `@purityjs/vite-plugin`'s devDependencies
(only at root) — now pinned at `4.7.0` alongside the rest.

**Plugin build fix.** `oxc-parser` and its `@oxc-parser/*` native
bindings have to be externalised in `vite.config.ts` alongside the
existing `@purityjs/*` and `node:*` externals — otherwise Rolldown
fails on the unresolvable `@oxc-parser/binding-wasm32-wasi` fallback
path. Plugin bundle is now 20.49 kB ESM / 15.76 kB CJS (parser is a
real runtime dep, not bundled).

## Test count by package (current)

```
core         635 passing  (31 files)
ssr          145 passing  (11 files)
vite-plugin  236 passing  (13 files)   ← was 200 (18 pre-existing fails on Windows)
total        1016
```

## ADRs accepted on this branch

| ADR  | Title                                                                                                | One-line summary                                                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0035 | [Smart serverAction body-only strip](docs/decisions/0035-smart-server-action-strip.md)               | `oxc-parser`-backed per-call strip in client builds. Replaces just the inline handler with a thrower stub; preserves `.url` + `.invoke()`.        |
| 0036 | [Sibling routes.d.ts with per-route typed importFn](docs/decisions/0036-virtual-routes-typed-dts.md) | Auto-emits a `.d.ts` next to the `emitTo` `.ts`. Declares `'purity:routes'` with literal tuple types so virtual-module imports get strong typing. |

## Public API map (deltas this branch)

`@purityjs/vite-plugin`:

- New plugin option `stripServerActions?: boolean` (default `true`).
- Internal exports `generateRouteManifestTypes()` (used by the disk
  emitter when `emitTo` is set).
- New runtime dep `oxc-parser@^0.129.0` (externalised in the
  plugin's own build).

`@purityjs/vite-plugin/tests`:

- New `tests/server-action-strip.test.ts` (16 tests).
- New `tests/routes-types-emit.test.ts` (14 tests).

`@purityjs/core` exports: unchanged. `@purityjs/ssr` exports: unchanged.

## Files most worth re-reading before the next session

- `packages/vite-plugin/src/server-action-strip.ts` — `oxc-parser`-
  backed strip helper. Import-bound resolution, inline-handler-only
  scope, cheap precheck, edits applied right-to-left.
- `packages/vite-plugin/src/index.ts` — `transform()` wiring:
  precheck-then-strip-then-html``pipeline, plus the`buildStart`/`load`hooks that now write both the`.ts`and`.d.ts`.
- `packages/vite-plugin/src/routes.ts` — adds
  `generateRouteManifestTypes(manifest, absPathFor)` alongside the
  existing `generateRouteManifestSource()`. Same shape, different
  output (literal tuple types vs runtime array literals).
- `docs/decisions/0035-smart-server-action-strip.md`,
  `docs/decisions/0036-virtual-routes-typed-dts.md` — design
  records for both items, including rejected alternatives.

## What's still open

### Server-action ergonomics — Phase K+

- **`*.server.ts` boundary checker (compile error)**. ADR 0018
  silently strips a `*.server.ts` module from client bundles, but a
  client file importing the action's `.url` only works because the
  stripped file still exports its top-level bindings (the URL
  string lives at module scope). A friendly compile-error / warning
  when a client file imports a `*.server` module would surface the
  intent. Out of scope for K/M; potential follow-up.
- **`serverAction()` build-time URL derivation**. Next-style stable
  opaque IDs derived from the file path + export name. Would let
  the plugin guarantee URL uniqueness across the app. ADR 0035
  documents this as a deferred non-feature.
- **CSRF helper / wrapper around stripped handlers**. ADR 0012
  non-feature. Could compose with the stripped-handler stub to fail
  closed when a client accidentally calls `.handler()`.

### Type-surface polish — Phase M+

- **`'purity:routes'` virtual-module type-only mode.** Today the
  `.d.ts` only fires alongside `emitTo`. Some teams may prefer a
  default-location `.d.ts` even without `emitTo`. Would need an
  extra option; not worth the API surface for Phase 1.
- **Auto-include the emitted `.d.ts` in tsconfig.** A `purity init`
  command that touches `tsconfig.json` is out of scope.
- **Smart strip's identifier-reference handlers.** ADR 0035 only
  strips inline arrow / function-expression handlers; named-
  identifier handlers (`const handler = …; serverAction(url, handler);`)
  fall back to the `*.server.ts` filename convention. Tracking the
  binding flow to also strip those would need use-def analysis;
  rare enough to be Phase 2.

### Pre-existing items still open

- **Server-module strip — explicit non-feature carry-over from
  ADR 0018**: `"use server"` directive-style detection instead of
  filename convention. Both ADR 0018 and ADR 0035 are convention-
  based; a directive-based mode would let users mark individual
  files / blocks without renaming.
- **`@purityjs/ssr` build TS errors on `render-to-string.ts`
  (TS2367)**. Pre-existing on main; the `'settled'` vs `'global'` /
  `'boundary'` literal-union comparisons trip tsc. Tests pass; the
  type lattice for `SuspenseState` probably needs a tightening pass.
  Not blocking package publish (vite build still produces the
  artefact), but worth fixing before the 1.0 cut.
- **Loader-data revalidation primitives, ISR/PPR patterns, selective
  per-boundary hydration timing** — all documented as deferred
  non-features in the relevant ADRs. No change this iteration.

## Recommended next sprint

K + M shipped together as planned. The "deploy anywhere with a Web
Standards fetch handler" matrix (Path H/H'/H'') plus the typed-route-
surface story (Paths L + M) plus the security-and-payload story
(Path K) are all closed. The plugin's transform pipeline is now:

```
*.server.ts (ADR 0018)
  → serverAction() bodies (ADR 0035)
    → html`` AOT compile (ADR 0019-era + parser fix from ADR 0006)
```

Three plausible next directions:

1. **`@purityjs/ssr` TS2367 cleanup** — pre-existing on main,
   blocks `npm run build` on `@purityjs/ssr` even though tests
   pass. Small focused fix; worthwhile before the 1.0 cut.
2. **`"use server"` directive variant** — directive-style detection
   on top of ADR 0035's per-call strip. Lets users mark individual
   handlers as server-only without renaming the file. Composes
   with ADR 0018's filename convention (either is sufficient).
3. **Smart strip — body-only when `serverAction()` is called with a
   referenced identifier** — extends ADR 0035 to strip
   `const handler = …` declarations whose only consumer is the
   `serverAction()` call. Requires use-def tracking; the AST is
   already available via the existing `oxc-parser` pass.

Pick (1) if you want to clear pre-existing build errors before the
next ADR. Pick (2) or (3) if the server-action story has more
runway to mine before it's truly "done".
