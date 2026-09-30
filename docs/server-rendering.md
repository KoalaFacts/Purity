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
page's HTTP status and headers. Server pages stream the shell first, then
deferred `suspense()` regions. Static pages continue to render at build time.

### Submit forms to server actions

The app starter's `/greeting` page works with JavaScript disabled. Put action
modules under `src/actions/**/*.server.ts` and export registered handlers with
`serverAction(url, handler)`. The server eagerly loads them before the first
request, dispatches POST, PUT, PATCH, and DELETE before SSR, and sends the
handler's Web `Response` with its status, headers, cookies, and body.

```ts
// src/actions/save.server.ts
import { serverAction } from '@purityjs/core';

export const save = serverAction('/actions/save', async (request) => {
  const form = await request.formData();
  // Validate input and authorize the write before saving.
  await saveRecord(form);
  return Response.redirect(new URL('/records', request.url), 303);
});
```

A native `<form action="/actions/save" method="POST">` uses the same handler
as a browser `fetch()` call. Action modules are loaded only by the server entry;
share URL constants from a separate ordinary module when the client needs them.

For in-place submission, mark the form with `data-purity-enhance`. The generated
client entry already calls `enhanceForms(root)`. Existing forms work without
JavaScript and keep their native submission path.

```ts
import { enhanceForms } from '@purityjs/core';

const forms = enhanceForms(document.getElementById('app')!);
// When installing outside a component scope, dispose during application teardown.
// forms.dispose();
```

```html
<form action="/actions/save" method="POST" data-purity-enhance>
  <label for="title">Title</label>
  <input id="title" name="title" required />
  <button>Save</button>
  <p data-purity-form-status role="status"></p>
</form>
```

When `Accept` includes `application/json`, the action returns JSON matching
`FormActionResult`: `{ message?: string, fieldErrors?: Record<string, string>, invalidate?: readonly QueryKey[] }`.
For validation failures use HTTP 422 with errors keyed by control name; success
uses a successful HTTP status. The enhancer preserves input, exposes reactive
`forms.getState(form)()` (`idle`, `pending`, `success`, or `error`), disables
submit buttons, blocks duplicate submissions, associates field errors, focuses
the first invalid control, and announces results. The status region is created
if absent. Localize default messages through `enhanceForms(root, { messages })`.

#### Refresh queries after a successful write

An enhanced action can declare the browser queries affected by a write:

```ts
// Server action, after validation, authorization, and a successful save.
return Response.json({
  message: 'Record saved.',
  invalidate: [['records'], ['record', recordId]],
});
```

Send JSON-safe keys matching the keys passed to `query({ key, fetcher })` in the client. The
enhancer invokes `invalidateQuery` for each distinct key after a successful HTTP
response with no nonempty field errors, even if the entry's `staleTime` has not
expired. Matching is exact; string and array keys occupy distinct namespaces.
Unknown keys are no-ops. Queries not named in the response retain their cache.
Validation failures, failed requests, and responses ignored after disposal do
not invalidate queries. Native submissions refresh their destination page as
usual.

Submission success is shown immediately; reads refresh independently. A failed
read remains in that query's `error()` state while retaining its last value. It
does not turn a successful write into a failed submission or repeat the write.
Malformed invalidation hints and synchronous refresh exceptions are logged and
isolated so other valid keys can still refresh. This updates the browser query
cache; route loader data and external server caches require their own refresh
strategy.

Removed forms and roots, component teardown, or `forms.dispose()` abort requests
and prevent stale updates. The default timeout is 30 seconds (configurable with
`timeoutMs`). Aborting cannot roll back an accepted server write; use idempotency
in handlers when retrying a write could duplicate it. Network failures and
invalid responses preserve input for an explicit retry.

Enhancement applies to same-origin POST forms targeting the current window,
with URL-encoded or multipart data. Other forms keep native behavior. Enhanced
responses must use the JSON contract; redirects and non-JSON responses show a
failure without repeating the POST. Native requests still receive a page or 303
redirect. Use `requestSubmit()` instead of `form.submit()` to trigger enhancement.

The generated adapter requires `Origin` to match the public request origin and
limits buffered bodies to 1 MiB (`MAX_ACTION_BODY_BYTES` can change the limit).
Missing or mismatched origins return 403; oversized bodies return 413; unknown
actions return 404. API clients send `Origin` explicitly. Configure
`PUBLIC_ORIGIN` or a trusted proxy for the deployment's public URL. The generated
README describes validation responses and the request contract in more detail.

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
