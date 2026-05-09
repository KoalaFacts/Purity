# Purity Live Dashboard

End-to-end demo: polling stats, retry on transient failures, debounced
search, optimistic event submission, dark mode. ~250 lines of `src/main.ts`
plus a client-side mock backend.

Live at: <https://koalafacts.github.io/Purity/dashboard/>

## What it exercises

| Primitive        | Where                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `state`          | `paused`, `simulateFailure`, `dark`, `searchTerm`, `levelFilter`, `latencyHistory`                           |
| `compute`        | `filteredEvents`, `status` pill                                                                              |
| `debounced`      | search input → events filter (200 ms quiet)                                                                  |
| `resource`       | polling stats with `pollInterval: 2_000` and `retry: 3`; falsy source on `paused()` to stop without teardown |
| `lazyResource`   | "Send test event" button (imperative trigger via `.fetch(args)`)                                             |
| `each`           | events list keyed by `evt.id`                                                                                |
| `match` / `when` | status pill (ok / error / paused) and empty-state text                                                       |
| `mount`          | renders the app into `#app` (no Shadow DOM — light-DOM render)                                               |
| `onDispose`      | cleans up the latency-history watcher                                                                        |

## Run locally

```bash
# From repo root, build the framework deps first (one-time):
npm run build -w packages/core
npm run build -w packages/vite-plugin

# Then either dev-server or build:
npm run dev   -w examples/dashboard   # http://localhost:5173/
npm run build -w examples/dashboard   # static dist/ for hosting
```

## Deployment

Lives at `/Purity/dashboard/` on GitHub Pages. The `benchmark.yml`
workflow builds the demo and copies it into `gh-pages/dashboard/`
alongside the benchmark site. Currently redeploys whenever the
benchmark workflow runs (`workflow_dispatch`).
