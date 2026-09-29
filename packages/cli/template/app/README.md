# **PROJECT_NAME**

Purity app with page-level rendering. Requires Node.js 24 or newer.

```bash
npm install
npm run dev
```

Pages live in `src/pages/`. Each page exports a default component and may set
`renderMode` to `'static'`, `'server'`, or `'client'`:

- `static`: generate HTML during `npm run build`.
- `server`: render HTML for every request (the default).
- `client`: serve the app shell and render in the browser.

For dynamic static pages, list their paths in `src/static-paths.ts`. That file
only runs during the build, so its data sources stay out of the browser bundle.
The build rejects paths that do not match their page, duplicate paths, and
unsafe output paths. The same app can use all three modes. A client-only page
requires the Node server for direct navigation unless your static host serves
the app shell for that path.

Server pages use progressive SSR. The server resolves the page shell, status,
headers, and `head()` content before sending HTTP headers, then streams the
shell and any deferred `suspense()` regions. Put slow, independent content in
`suspense()` to let the rest of the page arrive first. Static pages use buffered
rendering during the build.

For a strict Content Security Policy on server pages, the Node server creates
a fresh nonce for each request and uses it on Purity's inline streaming
scripts. A loader can read that nonce from its server-side `request` and put it
in the policy it returns:

```ts
import { routeData } from '@purityjs/core';

export function loader({ request }) {
  const nonce = request.headers.get('X-Purity-CSP-Nonce');
  return routeData(null, {
    headers: {
      'Content-Security-Policy': `script-src 'self' 'nonce-${nonce}'`,
    },
  });
}
```

The generated server replaces any incoming `X-Purity-CSP-Nonce` value before
the loader runs. Add the nonce to every applicable page or layout policy; a
policy that allows only `'self'` blocks the deferred inline swap scripts.

### Loader responses

On a server-rendered page, a route or layout loader can return `routeData(value,
{ status, headers })`. The page receives `value` as its loader data, while the
Node server sends the status and headers with the rendered HTML. This is useful
for a missing record or cache policy:

```ts
import { routeData } from '@purityjs/core';

export async function loader({ params }) {
  const post = await findPost(params.slug);
  return routeData(post, {
    status: post ? 200 : 404,
    headers: { 'Cache-Control': post ? 'public, max-age=60' : 'no-store' },
  });
}
```

The page component can render a suitable message when `post` is `null`.
Layout headers are applied from outermost to innermost; page headers win on
duplicate names, and `Set-Cookie` values append. A page status overrides a
layout status. For a redirect or a response that replaces the page entirely,
return a standard Web `Response` from the loader:

```ts
export function loader({ request }) {
  if (!hasSession(request)) {
    return Response.redirect(new URL('/login', request.url), 302);
  }
  return loadPrivateData(request);
}
```

A returned `Response` bypasses the page and its error boundary. Ordinary loader
errors still reach the nearest error boundary and produce HTTP 500. Unmatched
paths produce HTTP 404. Static pages must render successfully with status 200
and no response headers; the build stops with a clear error if a static loader
returns a `Response` or sets status or headers. Use `renderMode = 'server'` for
request-time redirects, cookies, and cache headers.

Links in this mixed-mode template use normal browser navigation. Each visit
therefore receives the route's actual HTTP status and headers. Applications
that implement reactive client-side route composition can opt into
`configureNavigation()` separately.

```bash
npm run build
npm start
```

`dist/client/` contains client assets and generated static HTML. `dist/server/`
contains the server-rendering bundle. `dist/server.js` serves all three modes.
Deploy `dist/`, `package.json`, and the lockfile together, then install
production dependencies and run `npm start` on a Node host. Set `PORT` to change
the listening port. Set `PUBLIC_ORIGIN` to the site's public URL when a reverse
proxy terminates HTTPS. Alternatively, set `TRUST_PROXY=1` only behind a trusted
proxy that supplies `X-Forwarded-Proto` and `X-Forwarded-Host`.
