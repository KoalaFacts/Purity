# Changelog

## 0.3.0 — 2026-10-03

Coordinated release of `@purityjs/core`, `@purityjs/ssr`,
`@purityjs/vite-plugin`, and `@purityjs/cli`.

### Added

- A deployable `--app` starter with route render modes, SSR streaming, static
  generation, route response metadata, and forms connected to Server Actions.
- Progressive form enhancement with pending state, duplicate submission
  prevention, field errors, cancellation, query refresh, and action redirects.
- Automatic visible-row rendering for `each()` and an opt-in development
  reactive graph panel through `purity({ devtools: true })`.
- Reproducible production bundle budgets, browser checks, and memory retention
  checks for the inspector, client components, and SSR boundaries.

### Fixed and improved

- Template arrays hydrate against existing server-rendered nodes. This includes
  the fix required by source-linked consumers such as Press Floor.
- Node client disconnects, render deadlines, and independent Suspense deadlines
  cancel route loaders and async resources.
- Streaming respects backpressure, encodes output incrementally, and releases
  consumed boundary callbacks and shell snapshots.
- WebSocket state survives back/forward cache reconnection, and control-flow
  hydration callbacks register on demand.
- The workspace toolchain uses Vite+ 1.0 and Vitest 5.

### Upgrade notes

- Update all four packages together to 0.3.0. The SSR and Vite plugin packages
  now require `@purityjs/core` `^0.3.0`; generated projects use the same range.
- The API remains pre-1.0. Review the route, form, SSR, and debugging guides
  before adopting the new options.
- Production bundle figures describe the checked fixtures. Control-flow and
  hydration AOT bundles still retain JIT fallback dependencies; this release
  does not claim a universal size or speed advantage.

## 0.2.4 — 2026-09-27

Ship the AOT hydration fix merged after 0.2.3: production SSR projects now
retain server-rendered Custom Element hosts and Shadow DOM controls while
attaching client behavior. The first interaction on lazy islands is also
replayed against the live DOM target. Browser checks cover node retention and
the first click in Chromium, Firefox, and WebKit.

## 0.2.3 — 2026-09-26

Fixed typed component props during SSR hydration. The parent now binds
properties before Declarative Shadow DOM children hydrate, preserving numbers,
booleans, objects, and null without rebuilding their existing nodes. Object
and function props are no longer reflected into SSR host attributes, avoiding
accidental disclosure through string conversion.

## 0.2.2 — 2026-09-26

The CLI's SSR starter now runs `npm run preview` on Windows, loads the server
bundle with a file URL, serves built client assets, and hydrates its counter
without producing `NaN`. The public `html` return type no longer exposes the
internal hydration template, so a scaffolded TypeScript project type-checks.
Generated builds now run a TypeScript check before bundling.

## 0.2.1 — 2026-09-26

This coordinated patch release verifies npm Trusted Publishing for all four
packages. It contains no framework API or runtime changes. The CLI now
scaffolds projects with the 0.2.1 package versions.

## 0.2.0 — 2026-09-26

Purity 0.2.0 is a coordinated release of `@purityjs/core`,
`@purityjs/vite-plugin`, and `@purityjs/cli`. It is the first npm release of
`@purityjs/ssr`.

### Added

- Server rendering with streaming, static generation, hydration, and opt-in
  islands.
- Router primitives, file-system route manifests, layouts, data loaders,
  error boundaries, and server actions.
- Form-associated custom elements, focus delegation, and documented browser
  accessibility checks.
- Query, optimistic update, persistence, lifecycle, observer, environment,
  capability, and live-data signal primitives.
- A built-in reactive graph inspection hook and an SSR project option in the CLI.

### Upgrade notes

- Update the framework packages together to 0.2.0. The SSR and Vite plugin
  packages require `@purityjs/core` `^0.2.0`.
- Server action dispatch no longer accepts `GET` or `HEAD` requests. Use a
  mutation method such as `POST`; `handleAction()` returns `null` for other
  methods so the surrounding router can handle them.
- The default `interceptLinks()` behavior now handles only same-origin
  `http:` and `https:` links. Other URL schemes use their native browser
  behavior.
- Invalid `listSSR()` tag and attribute names are now rejected or omitted.
  `renderToString()` rejects a `doctype` option that is not a single doctype
  declaration. Correct any previously accepted unsafe markup inputs.
- The CLI now requires a safe project directory name. Names that escape the
  current directory or contain shell or HTML metacharacters are rejected.

The public API remains pre-1.0 and may change between minor releases.
