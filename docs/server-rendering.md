# Server rendering

Use the CLI's `--ssr` option to create a Purity app that renders HTML on a Node server and hydrates it in the browser. The generated project includes a server entry, a client entry, and a production Node server.

```bash
npx @purityjs/cli my-ssr-app --ssr
cd my-ssr-app
npm install
npm run dev
```

The development command runs the generated server with Vite middleware. Open the local address printed by the server, then edit `src/app.ts` to see the server-rendered page update.

## Build and run locally

Use Node.js 24 or newer for the generated project.

```bash
npm run build
npm start
```

The build produces `dist/client`, `dist/server`, and `dist/server.js`. `npm start` runs the built server, which renders pages and serves the client assets. Set `PORT` if the host requires a specific port; otherwise the server uses 3000.

## Deploy to a Node host

On a host that builds from source, deploy the project and run `npm ci`, `npm run build`, then `npm start`. Set the host's start command to `npm start` and give it the port through `PORT`.

If you build before deployment, copy `dist/`, `package.json`, and `package-lock.json` to the host. Run `npm ci --omit=dev` there, then `npm start`. Keep the three built outputs together. The generated README includes the same deployment steps.

## What hydrates

The server entry calls `renderToString()` from `@purityjs/ssr`. The client entry calls `hydrate()` from `@purityjs/core` against the rendered app root. Hydration attaches interactivity to the existing DOM. If a component uses Shadow DOM, the server emits Declarative Shadow DOM so its content can appear before client JavaScript runs.

For mostly static pages with a few interactive regions, see [Islands](./islands.md). For the lower-level rendering API, resource serialization, and streaming, see the [`@purityjs/ssr` reference](../packages/ssr/README.md).

## Mixed static and server pages

The `--app` starter combines static generation, server rendering, and client
rendering in one file-based router:

```bash
npx @purityjs/cli my-app --app
cd my-app
npm install
npm run dev
```

Pages in `src/pages/` default to server rendering. Set `renderMode` to
`'static'` for build-time HTML or `'client'` for a browser-rendered page. The
generated app uses normal document navigation so the browser receives each
page's HTTP status and headers.

### Status and headers from a loader

Use `routeData(value, { status, headers })` when a page should render with
loader data and set HTTP metadata. The page receives only `value`:

```ts
import { html, routeData, type LoaderContext } from '@purityjs/core';

const posts: Record<string, string> = { hello: 'Hello' };

export function loader({ params }: LoaderContext) {
  const post = posts[params.slug] ?? null;
  return routeData(post, {
    status: post ? 200 : 404,
    headers: { 'Cache-Control': post ? 'public, max-age=60' : 'no-store' },
  });
}

export default function Post(_params: Record<string, string>, post: string | null): unknown {
  return html`<main><h1>${post ?? 'Post not found'}</h1></main>`;
}
```

For a redirect or a complete response body, return a Web `Response` from the
loader. For example, `Response.redirect(new URL('/login', request.url), 302)`
sends a redirect without rendering the page. Layout response metadata is merged
from outermost to innermost, then the page wins on duplicate headers or status;
`Set-Cookie` values append. Unhandled loader errors render the route's error
boundary with HTTP 500 when one exists.

Custom Node or edge adapters can call `renderToString(App, { request,
extractResponse: true })` and send the returned `body`, optional `status`, and
optional `headers`. `extractHead: true` also includes the response metadata.

For progressive SSR, `await renderToStreamResponse(App, { request })` returns
`{ body, head, status?, headers? }` after the shell is ready and before any
bytes are sent. An adapter can use the status and headers for the HTTP response,
insert `head` into its document template, then stream `body`. A loader's Web
`Response` is returned as a rejection before the stream begins; catch and send
that response directly. Status, headers, and head content must be produced by
the shell. Deferred Suspense views run after the first flush and cannot change
the response metadata.

Static pages must render with status 200 and no response headers. The build
reports an error if a static loader returns a `Response` or sets status or
headers. Use server mode for redirects, cookies, and request-time cache rules.
