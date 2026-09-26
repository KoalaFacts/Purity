# Changelog

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
