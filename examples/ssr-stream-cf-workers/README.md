# purity-ssr-stream-cf-workers

Streaming SSR on **Cloudflare Workers**, driven by Purity's file-system
route manifest. ADR 0006 Phase 4 + ADR 0033.

The Worker calls `renderToStream(App, …)` which returns a
`ReadableStream<Uint8Array>` that flushes the shell immediately, then
streams each `suspense()` boundary's resolved HTML as a separate chunk.
`App` is a manifest-driven composer (`asyncRoute` + `asyncNotFound`,
same shape as the canonical Node SSR demo).

## How the manifest reaches the Worker

Wrangler does not bundle Purity's `html\`\`` templates directly — the
runtime `html` tag emits DOM nodes, which fails under a Workers runtime
that has no `document`. We use Vite (in SSR build mode) to AOT-compile
every `html\`\`` call in the worker + pages into string-builder
factories, plus emit the route manifest. Wrangler then deploys the
Vite output as a single ES-Modules Worker.

```bash
npm run build    # vite build --ssr → dist/worker.js + manifest emit (ADR 0033)
npm run dev      # build + wrangler dev
npm run deploy   # build + wrangler deploy
```

`src/.purity/routes.ts` (the emitted manifest) and `dist/` are
gitignored.

## Files

```
src/
  pages/
    _layout.ts      — root layout (page shell, ADR 0020)
    _404.ts         — root not-found page (ADRs 0021 + 0028)
    index.ts        — /
    stream.ts       — /stream — exercises suspense() + resource()
  app.ts            — asyncRoute / asyncNotFound composer
  worker.ts         — `export default { fetch }` — calls renderToStream
  .purity/
    routes.ts       — emitted manifest (gitignored)
vite.config.ts      — wires the plugin + SSR build mode for the worker
wrangler.toml       — Workers runtime config (compatibility_date ≥ 2024-04-05)
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

Chunked HTTP is automatic — Workers wraps any streamed `Response` body
as `transfer-encoding: chunked`. No header tuning required.

## CSP

If your Worker sends a strict `Content-Security-Policy`, generate a
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

The nonce is applied to every inline `<script>` Purity emits (resource
cache prime, swap helper, per-boundary swap calls, per-boundary cache
primes).
