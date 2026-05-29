# purity-islands-blog-demo

A runnable demonstration of [ADR 0038](../../docs/decisions/0038-islands.md):
opt-in per-subtree hydration. See [`docs/islands.md`](../../docs/islands.md)
for the user guide.

```bash
npm install                # from the repo root
npm run dev -w purity-islands-blog-demo   # http://localhost:3001
npm run build -w purity-islands-blog-demo
npm run preview -w purity-islands-blog-demo
```

## What it shows

- **Static shell, zero JS for the bulk of the page.** Headings, paragraphs,
  the article structure — none of this ships any JavaScript.
- **Two islands, two triggers.**
  - `src/islands/counter.ts` uses `hydrate: 'load'` (default) and wires up
    on the next microtask.
  - `src/islands/like.ts` uses `hydrate: 'visible'` — its chunk isn't
    requested until the wrapper enters the viewport. Watch the Network
    panel and scroll.
- **Per-island chunk splitting via dynamic imports.** `entry.client.ts`
  passes each island as `() => import('./…').then(m => m.X)`. Rollup
  splits each into its own chunk; the shell ships only `mountIslands`
  and the thunks.

## File layout

```
src/
  app.ts                  — the page (mostly static html)
  entry.client.ts         — the only client-side wiring
  entry.server.ts         — renderToString(App, { request })
  islands/
    counter.ts            — island(View) with default trigger
    like.ts               — island(View, { hydrate: 'visible' })
index.html                — shell + <!--ssr-outlet-->
server.ts                 — minimal Node HTTP server
vite.config.ts            — purity() plugin + workspace aliases
```
