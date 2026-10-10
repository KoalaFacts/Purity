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

### Slow readers and stream buffering

`renderToStream()` and `renderToStreamResponse()` honor reader demand: their
internal Web Stream queue holds at most one transport chunk of up to 64 KiB.
When it is full, the renderer pauses and does not start subsequent deferred
boundaries. Reading resumes production in declaration order. This follows the
[Streams backpressure model](https://streams.spec.whatwg.org/#example-rs-push-backpressure)
and requires no caller option. Node's response pipeline propagates downstream
pressure; Node, socket, proxy, and browser buffers have their own limits.

Large shell and boundary output is UTF-8 encoded incrementally into owned
buffers of at most 64 KiB, as the reader requests more output. The renderer
does not allocate a UTF-8 buffer for the entire HTML string before sending it.
Small output keeps a single exact-sized encoding allocation. Valid surrogate
pairs remain intact across encoding windows; lone surrogates follow standard
`TextEncoder` replacement semantics.

A boundary's explicit timeout still starts when the shell first encounters it.
Waiting for a reader does not reset that deadline; an expired queued view is
skipped and retains its fallback. Consumer cancellation and external request
abort detach listeners and cancel active resource/loader work even while output
is paused.

Each deferred boundary leaves the pending callback map when its render starts.
Its view and fallback are no longer kept in that map while later boundaries
wait. Cancellation, errors, and normal completion clear the remaining map.
The active boundary still owns its callbacks for the duration of its work.

Once shell resource data has been serialized into the output string, its
ordered and keyed server snapshots are cleared before encoding starts. They
are also cleared when serialization is disabled or fails. Resource accessors
captured by deferred views keep their own values; boundary rendering uses
separate caches. The renderer drops its shell HTML reference before encoding
and its assembled shell string after the shell has drained.

`npm run test:ssr:memory` checks this on built packages under Node with forced
GC: 32 completed boundaries each capture a 1 MiB payload, while a final
boundary keeps the response open. All 32 payloads must become unreachable;
the final boundary must remain active until explicit cancellation. This
fixture checks callback retention, not total process memory or a throughput
benchmark. The check also creates 32 shell resource payloads and verifies that
their snapshots are released while another boundary waits, for ordered/keyed
caches with serialization enabled/disabled. CI runs deterministic snapshot,
hydration, queue, cancellation, and error regressions too.

Transport chunks can split HTML and scripts. When
reading manually, use `TextDecoder.decode(chunk, { stream: true })` and flush
with `decode()` at the end, or use `Response.text()`. Do not assume one chunk is
a whole Suspense boundary. The queue bound does not bound total request memory:
the renderer still constructs the shell, one current boundary's HTML, and
serialized hydration text while emitting them. Values captured by live accessors
or application code may still occupy memory. An unconsumed stream stays open
until its reader cancels or an external signal aborts; adapters own any overall
connection deadline.

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
`FormActionResult`: `{ message?: string, fieldErrors?: Record<string, string>, invalidate?: readonly QueryKey[], redirect?: string }`.
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

#### Navigate after a successful write

Return a JSON `redirect` when a successful enhanced submission should open a
destination page. Native submissions can return HTTP 303 to the same destination:

```ts
const destination = new URL('/records?created=1', request.url);
if (request.headers.get('accept')?.includes('application/json')) {
  return Response.json({ message: 'Saved.', redirect: destination.href });
}
return Response.redirect(destination, 303);
```

Only successful responses without nonempty field errors navigate. Pending UI is
restored first and any declared queries are invalidated before navigation.
Relative destinations resolve against the submitted action URL, including
submitter overrides. Targets must use HTTP(S), share the document's origin, and
contain no URL credentials. Invalid hints are logged and skipped while retaining
submission success. Disposed or removed forms and aborted requests cannot navigate.

By default `location.assign` loads the destination. SSR destinations rerun their
server loaders; static destinations load their prebuilt page.
Applications with an installed SPA router may supply
`enhanceForms(root, { navigate: (url) => router.navigate(url) })` instead. The
adapter receives the validated absolute URL and may return a promise; thrown or
rejected navigation errors are logged without repeating or failing the completed
write. No destination means the existing in-place result behavior continues.

Removed forms and roots, component teardown, or `forms.dispose()` abort requests
and prevent stale updates. The default timeout is 30 seconds (configurable with
`timeoutMs`). Aborting cannot roll back an accepted server write; use idempotency
in handlers when retrying a write could duplicate it. Network failures and
invalid responses preserve input for an explicit retry.

Enhancement applies to same-origin POST forms targeting the current window,
with URL-encoded or multipart data. Other forms keep native behavior. Enhanced
responses must use the JSON contract; HTTP redirects and non-JSON responses show a
failure without repeating the POST. Native requests still receive a page or 303
redirect. Use `requestSubmit()` instead of `form.submit()` to trigger enhancement.

The generated adapter requires `Origin` to match the public request origin and
limits buffered bodies to 1 MiB (`MAX_ACTION_BODY_BYTES` can change the limit).
Missing or mismatched origins return 403; oversized bodies return 413; unknown
actions return 404. API clients send `Origin` explicitly. Configure
`PUBLIC_ORIGIN` or a trusted proxy for the deployment's public URL. The generated
README describes validation responses and the request contract in more detail.

### Loader cancellation

Page and layout loaders follow a shared route cancellation scope. Each loader
receives its own `LoaderContext.signal`. Pass it to operations that support cancellation:

```ts
import type { LoaderContext } from '@purityjs/core';

export async function loader({ params, request, signal }: LoaderContext) {
  const url = new URL(`/api/posts/${encodeURIComponent(params.slug)}`, request.url);
  const response = await fetch(url, { signal });
  return response.json();
}
```

On the client, the signal aborts when the route's owning render scope is
disposed, including `mount().unmount()`. A custom `asyncRoute` request's signal
also cancels its loaders. Hiding a `when()` or `match()` branch disposes the
branch's scope: its watchers stop and its resources stop re-fetching, but a
request already in flight is not aborted. Showing the branch again renders it
fresh.

On the server, the signal combines the route's request with its owning SSR
resource operation. Render cancellation, render failure, global timeout, stream
reader cancellation, and an enclosing Suspense deadline cancel unfinished page
and layout loaders. A boundary timeout leaves the original request and sibling
routes active. Forward `LoaderContext.signal`, rather than `request.signal`, to
make loader work obey these rendering limits. Successful route pipelines detach
their forwarding listeners; their loader signals are not canceled later.
When a page or layout loader fails or returns a Web `Response`, unfinished peer
loaders are canceled with that outcome as the reason. Error-boundary loading and
HTTP response handling continue in the route's active scope.
The loader returning a `Response` has already settled and keeps its signal live,
so canceling unfinished peers does not cut off the winning response's fetch body.

The generated Node adapter listens for disconnects before middleware, module
loading, and route lookup begin. An incomplete upload or a response connection closed before
completion aborts the request, its loaders, and streaming output. Fully receiving
a GET or POST and successfully finishing its response do not cancel it; normal
keep-alive reuse remains supported. The adapter removes its listeners on response
completion or closure.

Custom adapters must wire request cancellation into `Request.signal` to propagate
disconnects. Rendering cancellation does not abort the original request signal.
Custom `asyncRoute` requests also participate in the route's combined signal.

Cancellation stops the route pipeline from waiting and prevents late values,
errors, or redirects from rendering or navigating. It cannot forcibly stop
arbitrary promises or undo completed work. Forward the signal to `fetch` and
other cancellable operations to stop their underlying work.

### Resource cancellation during SSR

`resource()` and keyed `lazyResource()` fetchers automatically receive a signal
for their active SSR operation. Forward it to the underlying work, including
inside deferred `suspense()` views:

```ts
const post = resource(
  ({ signal }) => fetch(apiUrl, { signal }).then((response) => response.json()),
  { key: 'post' },
);
```

The signal follows both the render's `Request.signal` and its optional `signal`
option. Canceling a returned stream with `reader.cancel(reason)` also cancels
pending resource fetchers. A render failure, global timeout, or render/stream
completion cancels unfinished resource work. Cancel reasons are forwarded and
late results or errors are excluded from the hydration cache. SSR `query()`
fetchers inherit the same behavior through `resource()`.

Forwarding listeners are removed when each resource settles, so completed
resource operations are not canceled later. A suspense boundary's deadline
immediately cancels its unfinished resources, including those in nested
boundaries, and keeps its fallback. A child deadline leaves parent and sibling
resources active. A view that throws also cancels its unfinished work using the
original error as the reason. Fallback resources use a separate, active scope.

```ts
suspense(
  () => {
    const data = resource(
      ({ signal }) => fetch(apiUrl, { signal }).then((response) => response.json()),
      { key: 'sidebar-data' },
    );
    return html`<aside>${() => data()?.title ?? 'Loading'}</aside>`;
  },
  () => html`<aside>Sidebar unavailable</aside>`,
  { timeout: 1000 },
);
```

Boundary deadlines are anchored to their first SSR encounter, including the
streaming shell; waiting for the shell or an earlier chunk does not reset them.
A streaming view whose deadline has already passed is skipped. Timeout signals
use a `TimeoutError` reason, while `onError` retains its existing
`onError(undefined, { boundaryId, phase: 'timeout' })` contract. Completed
boundaries do not expire while a slower neighbor is loading. A new render pass
reuses the neighbor's in-flight operation, so it does not issue a duplicate
request. Use stable resource keys for conditional or reordered resources.

Streaming chunks still arrive in declaration order. This cancellation behavior
does not change that order or forcibly stop promises that ignore their signal.

SSR route loaders inherit the owning resource's cancellation through
`LoaderContext.signal`, including loaders inside deferred boundaries. Cancellation
cannot force an arbitrary promise to stop or roll back an accepted write.

### Render timeout errors and HTTP responses

`renderToString()` rejects with an exported `SSRTimeoutError` when pending
resources exhaust its render budget. `renderToStreamResponse()` rejects with
the same class when its shell budget expires before it returns HTTP metadata.
For `renderToStream()`, consume the body to observe a shell timeout as a stream
error. The error extends `Error` and exposes:

- `code: 'PURITY_SSR_TIMEOUT'`
- `phase: 'render' | 'shell'`
- `timeout`: the configured budget in milliseconds (default 5000)

Unfinished fetchers and route loaders receive that same error as their signal's
abort reason. Caller cancellation preserves the caller's reason. Ordinary user
errors remain unchanged; do not classify errors by matching their message or
the string `name` alone.

The `--app` server entry recognizes `error instanceof SSRTimeoutError` and
returns HTTP 503 with `Cache-Control: no-store` and a generic text body. It logs
the detailed error on the server. This is the template's policy for a render
that cannot finish within its budget; applications can customize it in
`src/entry.server.ts`. It does not set `Retry-After` because it cannot predict
recovery. Existing loader Responses and redirects pass through unchanged;
unhandled programming errors still produce HTTP 500. HEAD returns the same
status and headers without a body. A local render budget does not identify an
upstream gateway timeout; 504 has that separate meaning in
[HTTP semantics](https://www.rfc-editor.org/rfc/rfc9110.html#name-504-gateway-timeout).

Suspense boundary timeouts keep their existing `TimeoutError` cancellation and
local fallback behavior. They do not reject the whole render or change a
stream's HTTP status after the shell has been sent. Static builds still fail
on a render timeout; the static generator does not convert it into a successful
503 page. This budget bounds waiting for async resources, not synchronous CPU
work that prevents timers from running.

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
