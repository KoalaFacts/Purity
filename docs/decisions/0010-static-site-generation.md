# 0010: Static site generation driver

**Status:** Accepted
**Date:** 2026-05-10

## Context

`renderToString` (ADR [0004](./0004-ssr-mvp.md)) renders a Purity
component to HTML for one request. `renderToStream` (ADR
[0006](./0006-streaming-suspense.md)) does the same with a streaming
output. Both are designed for live request handling — the runtime
calls them inside the HTTP handler and returns the result to the user.

A second mode is also useful: render a list of routes at build time,
write the HTML to disk, serve it statically from a CDN. This is the
classic Static Site Generation (SSG) flow popularised by Next, Astro,
Eleventy, and Gatsby. It pairs especially well with Purity's
zero-runtime-cost philosophy — the entire application's HTML can ship
as plain files, with `hydrate()` taking over for any reactive bits
when the user actually clicks something.

Nothing in `renderToString` blocks SSG today. A user can write a
top-level loop:

```ts
for (const path of routes) {
  const html = await renderToString(() => App({ path }));
  await writeFile(out(path), html);
}
```

But that loop misses several details that recurring SSG drivers
provide:

- **Per-route `Request`.** ADR [0009](./0009-request-context.md) gave
  components access to the incoming `Request` via `getRequest()`.
  Static renders also have a "request" — synthesised from
  `baseUrl + path` — and components should see it through the same
  API so route-aware code paths (canonical URLs, language detection,
  `if (path === '/blog/*') …`) work uniformly.
- **`head()` capture.** ADR [0008](./0008-head-meta-management.md)
  ships `head()` with `renderToString({ extractHead: true })`. SSG
  always wants `extractHead: true` so the per-route `<title>` and
  `<meta>` tags land in the output's `<head>`.
- **Shell templating.** Every output file needs the same `<html>`
  `<head>` `<body>` shell. The driver should splice body + head into
  a user-supplied template so the user only writes it once.
- **Error isolation.** One bad route shouldn't abort the whole batch
  — common for SSG'ing 10k+ marketing pages where a single stale
  fetch URL would otherwise fail the entire build.
- **Bounded concurrency.** Naïve `Promise.all(routes.map(…))` opens
  one render per route. For thousands of routes that opens thousands
  of concurrent fetches; memory and socket budgets blow up. A
  concurrency cap is the standard fix.
- **Filesystem I/O is platform-specific.** Node has `fs/promises`,
  Bun and Deno have their own. Each user's deploy target may want
  different filename conventions (`index.html` vs `path.html`). The
  driver shouldn't pick.

These are individually small, but together represent enough
boilerplate that every Purity user shipping a static site would
re-implement them. A focused driver is the right shape.

## Decision

**Add `renderStatic(options)` to `@purityjs/ssr`. It iterates a list
of routes, synthesises a `Request` for each, runs `renderToString`
with `{ extractHead: true, request }`, splices the body + head into
an optional shell template, and returns the final HTML strings as a
`Map<path, html>` — without touching the filesystem.**

```ts
import { renderStatic } from '@purityjs/ssr';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const { files, errors } = await renderStatic({
  routes: ['/', '/about', '/blog/hello-world'],
  handler: (req) => () => App({ url: req.url }),
  shellTemplate:
    '<!doctype html><html><head>{{head}}</head>' +
    '<body><div id="app">{{body}}</div></body></html>',
  baseUrl: 'https://example.com',
  concurrency: 8,
});

for (const [route, html] of files) {
  const out = join('dist', route === '/' ? 'index.html' : `${route.replace(/^\//, '')}/index.html`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html);
}
for (const [route, err] of errors) console.error('SSG failure:', route, err);
```

Concretely:

- **`routes: ReadonlyArray<string | RenderStaticRoute>`** — list of
  URL paths to render. `RenderStaticRoute` is `{ path, request? }`;
  supplying a `request` lets the caller pass a fully-constructed
  `Request` (custom headers, method, etc.) instead of letting the
  driver synthesise one from `baseUrl + path`.
- **`handler(req: Request) => () => unknown`** — resolves a request
  to the component thunk the renderer should invoke. The thunk shape
  (`() => unknown`) is the same one `renderToString` accepts, so the
  handler is the only piece of route-dispatch the user writes.
- **`shellTemplate?: string`** — optional. `{{body}}` is replaced
  with the rendered HTML; `{{head}}` is replaced with the
  `head()`-collected markup (or empty if `head()` wasn't called). If
  `{{head}}` is absent and head markup exists, the head is prepended
  to the body so it isn't silently lost. If the template itself is
  omitted, the rendered body is returned as-is.
- **`baseUrl?: string`** — base for synthesising per-route requests.
  Default `'http://localhost'`. Set to your production origin so
  components computing canonical URLs via `req.url` get the right
  hostname during SSG.
- **`doctype?: string`, `renderOptions?: …`** — forwarded to
  `renderToString`. `renderOptions` excludes `extractHead` (always
  forced to `true`) and `request` (supplied per-route).
- **`concurrency?: number`** — render in parallel up to this cap.
  Default unbounded. A small bounded worker pool drains the route
  list deterministically.
- **`onRoute?: (path, html) => void | Promise<void>`** — called per
  route as it completes. Useful for streaming output to disk one
  route at a time instead of holding the entire `files` map in
  memory.
- **`Map<path, html>` return.** Successful renders only. Failures go
  to `errors: Map<path, unknown>` so the build script can decide
  whether to fail the deploy or publish what made it through.

The driver **does not touch the filesystem**. That responsibility
stays with the caller — Node, Bun, and Deno each have their own
`fs/promises` (or `Deno.writeTextFile`), and the file-layout
convention (`/blog/hello.html` vs `/blog/hello/index.html`) is a
user decision. A six-line user loop closes the I/O side.

## Consequences

**Positive:**

- One composable function fully covers the SSG use case. The
  primitives below it (`renderToString`, `head()`, `getRequest()`)
  are already shipping; `renderStatic` is mostly orchestration.
- Identical render path between SSG and live SSR. A page that
  renders correctly under `renderToString` renders correctly under
  `renderStatic` — `getRequest()` works, `head()` works, `resource()`
  awaiting works, suspense boundaries resolve buffered (same as the
  buffered renderer).
- Runtime-agnostic. No `node:fs` import. Bun, Deno, even running SSG
  from the browser (writing files to an OPFS-backed virtual FS) all
  work the same way.
- Errors are per-route. SSG'ing 10k marketing pages doesn't fail the
  build for one stale fetch.

**Negative:**

- The caller writes the filesystem loop. Six lines of
  `writeFile + mkdir` per project. Acceptable given the
  cross-runtime portability win.
- Routing is still flat. SSG works for "I know my route list ahead
  of time" sites; dynamic route generation (sitemap from a CMS,
  paginated archives) is the user's concern. Future ADRs may add a
  `getRoutes()` discovery primitive when filesystem-based routing
  lands.
- `Map<path, html>` is held in memory for the full batch when
  `onRoute` isn't used. For very large sites users should pass
  `onRoute` and stream to disk; we don't enforce it.

**Neutral:**

- `concurrency: 1` deserialises the renders, matching what users
  expect for debugging or CI memory caps. `concurrency:
Infinity` (the default) is fast for typical sites (< 1 000 routes)
  and easy to override.
- Shell template uses `{{body}}` / `{{head}}` placeholders rather
  than HTML comment markers. Pragma: build-time templating is the
  user's familiar pattern (Mustache, Handlebars, EJS) and a literal
  string replacement avoids parser surface. The marker grammar
  Purity uses internally (`<!--[-->`, `<!--s:N-->`, etc.) is
  reserved for runtime hydration semantics, not user-facing
  templating.

## Alternatives considered

**A CLI subcommand (`purity build:static`).** Would auto-detect
routes, run the renders, and write files. Rejected for Phase 1:
forces a routing convention before file-system routing has its own
ADR, and CLIs tend to harden the wrong defaults early. A focused
library function is more portable; CLI sugar can wrap it later.

**A Vite plugin mode.** Build the SSR bundle then auto-call
`renderStatic` as a post-build hook. Rejected for the same reason —
ties SSG to one build tool. Users on esbuild, tsup, or vanilla `node
--experimental-strip-types` are equally entitled to SSG. The plugin
can be a thin wrapper later.

**Include filesystem I/O inline.** `renderStatic({ outDir: 'dist' })`
writes files itself. Rejected because runtime-specific imports
(`node:fs/promises`) pin the module to one platform. The `onRoute`
callback covers streaming-to-disk; the `files` map covers
collect-then-write. Both work everywhere.

**Take an HTML template file path instead of a string.** Lets users
keep their shell in `index.html` next to their dev-mode template.
Rejected for the same I/O reason — a one-line
`readFile('index.html')` in the caller is sufficient and stays
runtime-agnostic.

**Use a streaming `ReadableStream<{path, html}>` return.** Matches
the per-route emit model of `renderToStream`. Rejected: SSG is a
build-time batch operation, not a request response. `Map` plus the
`onRoute` callback covers the same cases without forcing the user
to consume an async iterable.
