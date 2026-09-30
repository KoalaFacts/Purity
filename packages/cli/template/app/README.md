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

### Loader cancellation

Page and layout loaders follow a shared route scope and receive individual
`signal` values. Forward each signal to cancellable
operations, for example `fetch(url, { signal })`. On the client it aborts when
the route's owning render scope is disposed; a cached branch that is only
hidden stays alive. A custom request's signal also cancels its loaders.

During SSR, loader signals combine the request and the route's owning resource
operation. Render cancellation, failure, global timeout, stream reader
cancellation, and enclosing Suspense deadlines cancel unfinished loaders. Page
and layout loaders follow the same route cancellation. Boundary timeouts leave the original
request and neighboring routes active. Forward `LoaderContext.signal` instead
of `request.signal` to make underlying work obey render deadlines. Successful
route pipelines detach their forwarding listeners and are not canceled later.
If a page or layout loader fails or returns a Web `Response`, unfinished peer
loaders are canceled with the original outcome. The route can still load its
error boundary or deliver the HTTP response.
The settled loader returning a `Response` keeps its signal live, preserving its
fetch body while unfinished peers are canceled.

The Node server connects the request signal to incomplete uploads and response
connections closed before completion, with listeners installed before middleware
or route loading. Normal
GET/POST reception, completed responses, and keep-alive reuse do not cancel it.
Listeners are removed when the response finishes or closes.

Custom adapters must connect request cancellation to `Request.signal` themselves.
Rendering cancellation does not abort the original request signal. Custom
`asyncRoute` request signals also participate in loader cancellation. Canceled
routes ignore late values, errors, and redirects, but arbitrary promises and already completed
operations cannot be undone. Aborting an action does not roll back accepted writes.

### SSR resource cancellation

Use the fetcher's signal for deferred data as well:

```ts
const data = resource(
  ({ signal }) => fetch(apiUrl, { signal }).then((response) => response.json()),
  { key: 'page-data' },
);
```

SSR `resource()`, keyed `lazyResource()`, and `query()` fetchers automatically
follow request cancellation and the render's optional `signal`. Canceling the
stream reader, render failures, global timeouts, and render/stream completion
cancel unfinished resources. Late values and errors cannot enter the hydration
cache. Settled resources remove their forwarding listeners.

Global buffered and streaming-shell deadlines throw `SSRTimeoutError` from
`@purityjs/ssr`, with `code: 'PURITY_SSR_TIMEOUT'`, `phase: 'render' | 'shell'`,
and `timeout` in milliseconds. Pending resources and loaders are canceled with
that same error. Caller abort reasons and ordinary user errors remain unchanged.
The server entry handles this class with HTTP 503, `Cache-Control: no-store`,
and a generic `Service Unavailable` body, while logging details on the server.
HEAD returns the same status and headers without a body. Customize this policy
in `src/entry.server.ts`; it does not assume an upstream gateway timeout or a
known retry interval. Static builds still fail on timeout. A render budget bounds
async waiting; it cannot interrupt synchronous CPU work.

Pass `{ timeout: 1000 }` as the third argument to `suspense(view, fallback,
options)` to cancel that view's unfinished resources immediately at its deadline
and keep the fallback. Parent timeouts cancel nested view resources; child
timeouts leave parent and sibling work active. Fallback resources receive an
active signal. A thrown view cancels its work with the original error.

Deadlines start at the first SSR encounter, including the streaming shell.
Queued views that have already expired are skipped. Timeout signals carry a
`TimeoutError`; the existing `onError(undefined, { phase: 'timeout', boundaryId })`
callback is unchanged. Completed boundaries stay complete while slower neighbors
load, and new render passes reuse unfinished requests. Streaming chunks retain
declaration order. Give conditional resources stable keys.

Forward the fetcher's signal to cancellable operations; arbitrary promises cannot
be forcibly stopped. SSR route loaders inherit these limits through
`LoaderContext.signal`, including loaders inside deferred boundaries.

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

### Forms and server actions

The `/greeting` page demonstrates a native form submission, server validation,
and a 303 redirect back to the page. It works with JavaScript disabled. The
example returns a greeting and does not persist data. Invalid input returns
to the form with an accessible error message and HTTP 422.

Export actions from `src/actions/**/*.server.ts` using `serverAction()`:

```ts
import { serverAction } from '@purityjs/core';

export const save = serverAction('/actions/save', async (request) => {
  const form = await request.formData();
  // Validate the fields and authorize the operation here.
  await saveRecord(form);
  return Response.redirect(new URL('/records', request.url), 303);
});
```

The server entry eagerly registers exported actions before handling requests,
including a POST sent directly after startup. Actions run before page rendering
and can return any Web `Response`, including JSON, cookies, or redirects.
Action modules and their imports stay in the server bundle. Put shared URL
constants in ordinary modules, as the greeting example does.

Use `<form action="/actions/save" method="POST">` for native submission. Add
`data-purity-enhance` to submit in place when JavaScript is available. The app
entry enables `enhanceForms(root)` once; dynamically inserted marked forms also
work. The greeting page uses this option, with no custom submit handler.

```html
<form action="/actions/greet" method="POST" data-purity-enhance>
  <label for="name">Your name</label>
  <input id="name" name="name" required />
  <button>Send greeting</button>
  <p data-purity-form-status role="status"></p>
</form>
```

For enhanced requests (`Accept: application/json`), return JSON with an optional
`message` and `fieldErrors` keyed by form control name. Use HTTP 422 for invalid
input, and a successful HTTP status for success:

```ts
return Response.json(
  { message: 'Check your name.', fieldErrors: { name: 'Enter a name.' } },
  { status: 422 },
);
```

The helper retains inputs, manages `aria-busy` and `data-purity-pending`, disables
submit buttons while pending, and rejects duplicate submissions. It renders
field errors as text, associates them with controls, focuses the first invalid
field, and announces results in the status region (created if omitted). Network
or malformed-response failures show a retry message; requests time out after
30 seconds. Removed forms, removed roots, component disposal, and HMR abort
pending requests and ignore late responses. Aborting a request does not undo a
write already accepted by the server; handlers that need retry-safe writes must
implement idempotency.

After a successful write, include `invalidate` with the exact query keys that
need fresh data. The marked form automatically refreshes matching `query()`
entries, coalesces duplicate keys, and leaves other entries cached:

```ts
return Response.json({
  message: 'Saved.',
  invalidate: [['records'], ['record', recordId]],
});
```

Only successful responses without nonempty field errors trigger invalidation.
Missing query keys are no-ops. String keys and array keys are distinct. Reads
refresh independently of submission success, so a read error is shown through
that query's `error()` state and does not tell the user to repeat a successful
write. Invalid hints and synchronous refresh errors are logged while other
valid keys continue. This refreshes browser queries; route loader data and
server caches have separate lifecycles.

To open another page after a successful enhanced submission, return JSON with
`redirect`. Native submissions can return HTTP 303 to the same destination:

```ts
const destination = new URL('/records?created=1', request.url);
if (request.headers.get('accept')?.includes('application/json')) {
  return Response.json({ message: 'Saved.', redirect: destination.href });
}
return Response.redirect(destination, 303);
```

The enhancer uses `location.assign` by default, so SSR destinations rerun their
server loaders and static destinations load their prebuilt page. An installed
SPA router can be connected through the
optional `enhanceForms(root, { navigate })` adapter, which receives a validated
absolute URL. Relative destinations resolve against the submitted action URL.
Only same-origin HTTP(S) URLs without credentials are accepted. Validation
errors, failed requests, disposal, and removal prevent navigation. Invalid hints
and navigation errors are logged while the completed write remains successful.
Pending UI is restored before navigation; declared queries invalidate first.

Only marked same-origin POST forms targeting the current window with URL-encoded
or multipart data are enhanced. Submitter URL, encoding, and named value are
honored. Other forms retain native behavior. Enhanced handlers must return the
JSON contract; redirects, HTML, and malformed JSON are reported as failures and
are never automatically retried. For native requests, keep the existing page or
303 redirect response. Calling `form.submit()` directly bypasses submit events;
use `requestSubmit()` for programmatic submission.

Custom clients can still call the endpoint with `fetch()`:

```ts
const response = await fetch('/actions/greet', {
  method: 'POST',
  headers: { Accept: 'application/json' },
  body: new FormData(form),
});
const result = await response.json(); // HTTP 200 or 422; no redirect.
```

The adapter dispatches POST, PUT, PATCH, and DELETE; handlers can restrict their
own methods. An unknown action returns 404. Submissions require an `Origin`
header equal to the request's public origin; missing, `null`, and cross-origin
values return 403. Browser submissions normally supply this header. API clients
must send it explicitly. Keep authorization in each handler. Policies that
produce an opaque form origin, such as `Referrer-Policy: no-referrer`, are
incompatible with this requirement.

Request bodies are buffered up to 1 MiB before a handler runs. Both declared
and chunked bodies above that limit return 413. Set `MAX_ACTION_BODY_BYTES` to a
positive integer to change the limit. Form data (including multipart uploads),
JSON, and text reach handlers through the standard `Request` parsing methods.
Behind a proxy, configure the public origin as described below so browser
submissions compare against the public URL.

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
