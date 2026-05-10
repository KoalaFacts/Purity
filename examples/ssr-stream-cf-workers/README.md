# purity-ssr-stream-cf-workers

Streaming SSR on **Cloudflare Workers**, using `@purityjs/ssr`'s
`renderToStream` directly with the Workers `fetch` handler. ADR 0006
Phase 4.

The Worker returns a `ReadableStream<Uint8Array>` that flushes the page
shell immediately, then streams each `suspense()` boundary's resolved
HTML as a separate chunk. The `__purity_swap(N)` helper splices each
chunk into place in the browser as it arrives.

## Run

```bash
npm install
npm run dev   # wrangler dev — local Workers runtime on http://127.0.0.1:8787
```

Deploy to your account with `npm run deploy` (after `wrangler login`).

## What to look at

- `src/worker.ts` — the `fetch` handler. Builds the response with the
  streamed body in three lines:
  ```ts
  const stream = renderToStream(App, { doctype: '<!doctype html>', signal: req.signal });
  return new Response(stream, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  ```
  `req.signal` cancels the renderer when the visitor disconnects.
- `wrangler.toml` — Workers runtime config. `compatibility_date` should
  be on or after 2024-04-05 so `ReadableStream` + `TextEncoder` are
  available without flags.

## Expected wire format

```
<!doctype html>
<html>
  …
  <main>
    <h1>Hello</h1>
    <!--s:1--><aside class="loading">…</aside><!--/s:1-->
  </main>
  <script>window.__purity_swap=function(n){…};</script>
  <!-- ~150 ms later -->
  <template id="purity-s-1"><aside>RESOLVED</aside></template>
  <script type="application/json" id="__purity_resources_1__">{"keyed":{…}}</script>
  <script>__purity_swap(1);</script>
</html>
```

Chunked HTTP is automatic — Workers wraps any streamed `Response` body
as `transfer-encoding: chunked`. No header tuning required.

## CSP

If your Worker sends a strict `Content-Security-Policy`, generate a
nonce per request and pass it through:

```ts
const nonce = crypto.randomUUID().replace(/-/g, '');
const stream = renderToStream(App, { nonce });
return new Response(stream, {
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `script-src 'nonce-${nonce}' 'self'; default-src 'self'`,
  },
});
```

The nonce is applied to every inline `<script>` Purity emits (resource
cache prime, swap helper, per-boundary swap calls, per-boundary cache
primes).
