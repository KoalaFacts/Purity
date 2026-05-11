# purity-ssr-stream-vercel-edge

Streaming SSR on **Vercel Edge Functions**, driven by Purity's
file-system route manifest. ADR 0006 Phase 4 + ADRs 0019-0033.

The function returns a `ReadableStream<Uint8Array>` that flushes the
page shell immediately, then streams each `suspense()` boundary's
resolved HTML as a separate chunk. `App` is a manifest-driven
composer (`asyncRoute` + `asyncNotFound`, identical shape to the
canonical Node SSR demo and the cf-workers example).

## Architecture

Vite SSR-builds `src/edge.ts` to `api/stream.js`. Vercel's Edge runtime
picks the file up automatically. The plugin's `buildStart` hook
(ADR 0033) writes `src/.purity/routes.ts` as a side effect of the
build so the manifest is always in sync with `src/pages/`.

`vercel.json` rewrites every request to `/api/stream`; the route
match happens inside the handler via `matchRoute` over the manifest.

```bash
npm run build    # vite build → api/stream.js + manifest emit
npm run dev      # build + vercel dev
npm run deploy   # build + vercel deploy --prod
```

`src/.purity/routes.ts`, `api/stream.js`, and `api/chunks/` are
gitignored (per-machine paths + build artefacts).

## Files

```
src/
  pages/
    _layout.ts      — root layout (page shell, ADR 0020)
    _404.ts         — root not-found page (ADRs 0021 + 0028)
    index.ts        — /
    stream.ts       — /stream — exercises suspense() + resource()
  app.ts            — asyncRoute / asyncNotFound composer
  edge.ts           — Vercel Edge handler — `export default fetch`
  .purity/
    routes.ts       — emitted manifest (gitignored)
api/
  stream.js         — built artefact (gitignored)
vite.config.ts      — wires the plugin + SSR build mode for the edge entry
vercel.json         — rewrites all paths to /api/stream
```

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

Vercel Edge serves any streamed `Response` body as `transfer-encoding:
chunked` automatically. No header tuning required.

## CSP

If your function sends a strict `Content-Security-Policy`, generate a
nonce per request and pass it through:

```ts
const nonce = crypto.randomUUID().replace(/-/g, '');
const stream = renderToStream(App, { nonce, request: req, signal: req.signal });
return new Response(stream, {
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `script-src 'nonce-${nonce}' 'self'; default-src 'self'`,
  },
});
```

The nonce is applied to every inline `<script>` Purity emits.

## Caveats

- Edge Functions don't have Node built-ins. Don't import `node:fs`,
  `node:crypto`, etc. — use Web Platform alternatives (`crypto.subtle`,
  `Request`, `Response`, `URL`).
- For per-request data fetching inside `suspense()` boundaries, the
  edge runtime's global `fetch()` works exactly the same as Workers'.
