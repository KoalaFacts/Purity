# purity-ssr-stream-vercel-edge

Streaming SSR on **Vercel Edge Functions**, using `@purityjs/ssr`'s
`renderToStream` directly with the standard Web `Request → Response`
edge handler. ADR 0006 Phase 4.

The function returns a `ReadableStream<Uint8Array>` that flushes the
page shell immediately, then streams each `suspense()` boundary's
resolved HTML as a separate chunk.

## Run

```bash
npm install
npm run dev      # vercel dev — local edge runtime on http://localhost:3000
npm run deploy   # vercel deploy --prod
```

## What to look at

- `api/stream.ts` — the edge handler. `export const config = { runtime:
'edge' }` opts into the Edge runtime. The handler is two lines:
  ```ts
  const stream = renderToStream(App, { doctype: '<!doctype html>', signal: req.signal });
  return new Response(stream, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  ```
  `req.signal` cancels the renderer when the visitor disconnects.
- `vercel.json` — routes `/` to the edge function.

## Why an edge function (vs an SSR framework adapter)

Vercel's framework adapters (Next, SvelteKit, etc.) all eventually
return a `Response`. Purity has no framework adapter — instead you
write a one-file Edge Function that calls `renderToStream` directly.
Same primitive, smaller dependency surface.

## CSP

Strict CSP works the same way as on Cloudflare Workers — generate a
nonce per request, pass it through, set the header:

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

## Caveats

- Edge Functions don't have Node built-ins. Don't import `node:fs`,
  `node:crypto`, etc. — use Web Platform alternatives (`crypto.subtle`,
  `Request`, `Response`, `URL`).
- For per-request data fetching inside `suspense()` boundaries, the
  edge runtime's global `fetch()` works exactly the same as Workers'.
