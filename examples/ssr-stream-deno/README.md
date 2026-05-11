# purity-ssr-stream-deno

Streaming SSR on **Deno**, driven by Purity's file-system route
manifest. ADR 0006 Phase 4 + ADRs 0019-0033.

The handler returns a `ReadableStream<Uint8Array>` that flushes the
page shell immediately, then streams each `suspense()` boundary's
resolved HTML as a separate chunk. `App` is a manifest-driven
composer (`asyncRoute` + `asyncNotFound`, identical shape to the
cf-workers + Vercel Edge examples).

## Architecture

Deno has no `document`, so the runtime `html\`\``tag from`@purityjs/core`(which builds DOM nodes on first call) can't run
unmodified. We use Vite to SSR-build`src/serve.ts`into`dist/serve.js`— that pass AOT-compiles every`html\`\``into a
string-builder factory. Deno then runs`dist/serve.js` directly with
no further dependencies.

```bash
npm install
npm run build    # vite build → dist/serve.js + manifest emit (ADR 0033)
npm run dev      # build + deno run --allow-net dist/serve.js
# → http://localhost:8000
```

Deno 1.40+. `--allow-net` is for the listening socket.

`src/.purity/routes.ts` and `dist/` are gitignored (per-machine
absolute paths + build artefacts).

## Files

```
src/
  pages/
    _layout.ts      — root layout (page shell, ADR 0020)
    _404.ts         — root not-found page (ADRs 0021 + 0028)
    index.ts        — /
    stream.ts       — /stream — exercises suspense() + resource()
  app.ts            — asyncRoute / asyncNotFound composer
  serve.ts          — `Deno.serve(...)` entry — calls renderToStream
  .purity/
    routes.ts       — emitted manifest (gitignored)
dist/
  serve.js          — built artefact (gitignored)
vite.config.ts      — wires the plugin + SSR build mode for the Deno entry
deno.json           — Deno runtime config — `deno task dev` runs the built file
```

## Curl the streaming output

```bash
curl --no-buffer http://localhost:8000/stream
```

`--no-buffer` disables curl's output buffering so you see the shell
arrive before the resolved chunk (~150 ms later).

## Deno Deploy

Push `dist/serve.js` after running `npm run build`. Deno Deploy's
runtime is the same Deno that runs the file locally — no adapter
code changes needed.

## CSP

```ts
const nonce = crypto.randomUUID().replaceAll('-', '');
const stream = renderToStream(App, { nonce, request: req, signal: req.signal });
return new Response(stream, {
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `script-src 'nonce-${nonce}' 'self'; default-src 'self'`,
  },
});
```

The nonce is applied to every inline `<script>` Purity emits.
