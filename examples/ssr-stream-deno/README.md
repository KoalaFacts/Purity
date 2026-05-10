# purity-ssr-stream-deno

Streaming SSR on **Deno**, using `@purityjs/ssr`'s `renderToStream`
directly with `Deno.serve`. ADR 0006 Phase 4.

The handler returns a `ReadableStream<Uint8Array>` that flushes the
page shell immediately, then streams each `suspense()` boundary's
resolved HTML as a separate chunk.

## Run

```bash
deno run --allow-net --allow-read serve.ts
# → http://localhost:8000
```

Deno 1.40+. `--allow-net` is for the listening socket; `--allow-read`
is only required if your `suspense()` views read files (the bare demo
in `serve.ts` doesn't).

If you have not installed the packages via Deno's npm specifiers
locally, the imports use `npm:@purityjs/core` and `npm:@purityjs/ssr`
which Deno resolves on first run.

## What to look at

- `serve.ts` — the entire example. ~50 lines. Demonstrates:
  - `Deno.serve(handler)` — the platform's HTTP entry.
  - `renderToStream(App, { signal: req.signal })` — wired directly to
    the request's abort signal so a disconnect cancels the renderer.
  - A `suspense()` boundary with a slow keyed `resource()` so the
    streaming wire format is visible end-to-end.

## Curl the streaming output

```bash
curl --no-buffer http://localhost:8000
```

`--no-buffer` disables curl's output buffering so you see the shell
arrive before the resolved chunk.

## CSP

Same pattern as the Workers / Vercel Edge examples — generate a nonce
per request, pass it through, set the header:

```ts
const nonce = crypto.randomUUID().replaceAll('-', '');
const stream = renderToStream(App, { nonce });
return new Response(stream, {
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `script-src 'nonce-${nonce}' 'self'; default-src 'self'`,
  },
});
```

## Deno Deploy

The same `serve.ts` runs on Deno Deploy without changes. Push the
single file as the entry; Deploy uses the standard Deno runtime.
