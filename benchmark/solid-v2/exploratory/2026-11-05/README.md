# Exploratory Purity vs Solid snapshot — 2026-11-05

**Status: exploratory, not auditable as a baseline.** These artifacts back the bottleneck reading in [the code quality audit](../../../../docs/code-quality-audit-2026-11-05.md#2-exploratory-benchmark-snapshot-not-an-sv2-015-baseline). They are not the frozen rc.18 comparison required by SV2-001/SV2-015 and do not count as progress on either row.

## Inputs

| Item                   | Value                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Purity source          | `1c76af6cf7fe` (main), no local source changes                                                                             |
| Lockfile               | `package-lock.json` sha256 `e66806cfc5550ee4aeda8a06dd8fe42abc818da74435fff08e878ababa3df5ef`                              |
| `solid-js`             | 2.0.0-rc.20 `sha512-FxaEI7LHupehFoR9j2CfJAGCoRgiKgeNlzii4szUS6lnD8RkpdtvX1k6WFG71vl5bskXRRsmEQVAXsbIemQOuw==`              |
| `@solidjs/web`         | 2.0.0-rc.20 `sha512-ACGUZ1XBNxiHnWW274na+1JZfuIhiS/BN5XM72wVKNYSopR/NyjVPR4O/nvshtbYlEk1lKJ9d1uBaXDaz6ddYg==`              |
| `@solidjs/signals`     | 2.0.0-rc.21 (transitive) `sha512-F1TUMO/nd1XC//+tcaWxibOOgXBHQGmNQnAeiDnpLh+1smnlwIgKF6pc20evlyfQwqf0gP6rH4sNEqCPBNcpgg==` |
| `@solidjs/vite-plugin` | 3.0.0-next.55 `sha512-jMR8P9O+0qYW05xpQgLYRsHjgdSHyZRCXqgHhT3QpO63eXWt3H4tIwONxmm/r47Sed9Prk8N7EnMX2byro+FTA==`            |
| `playwright`           | 1.64.1                                                                                                                     |
| Browser                | `/usr/bin/google-chrome`, Google Chrome for Testing 153.0.8010.12, headless                                                |
| Runtime                | Node v24.22.2 (V8 13.6.233.17-node.63), npm 11.21.2, linux x64                                                             |
| Machine                | Intel Xeon @ 2.10 GHz, 2 logical CPUs, 8 GB RAM, shared cloud container                                                    |

Each run JSON also carries its own `provenance` and `environment` blocks written by the runner.

## Invocation

```bash
npm ci && npm run build:packages
cd benchmark
npm run build
npm run preview -- --port 4173 &
CHROMIUM_PATH=/usr/bin/google-chrome FRAMEWORKS=purity,solid WARMUP=3 ITERATIONS=5 PAGES=index \
  node --conditions=development --experimental-strip-types run-bench.ts   # run 1
CHROMIUM_PATH=/usr/bin/google-chrome FRAMEWORKS=purity,solid WARMUP=3 ITERATIONS=5 \
  node --conditions=development --experimental-strip-types run-bench.ts   # run 2, all pages
```

Profiles: `tools/profile.ts` ignores `CHROMIUM_PATH` (audit CQ-13), so it was run from a temporary copy whose only change was `chromium.launch()` → `chromium.launch({ executablePath: process.env.CHROMIUM_PATH })`, as `node --conditions=development --experimental-strip-types tools/_profile-tmp.ts purity <create|swap>`, then `tools/analyze.ts <dir> 25`.

## Files

| File                                                   | What                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| `2026-11-05T10-19-36-998Z-….json`                      | Run 1, `index` page only                                     |
| `2026-11-05T10-29-17-487Z-….json`                      | Run 2, all pages, timings and memory                         |
| `profiles/purity-create-…/metrics.json`, `analyze.txt` | 10k-row create: timeline metrics and top self-time functions |
| `profiles/purity-swap-…/metrics.json`, `analyze.txt`   | 10k-row swap: same                                           |

The run JSON files were reformatted by the repository formatter on commit (`vp fmt`); their parsed content is identical to the runner output. Runner-output sha256: run 1 `e108c5b4138809e17d5ae89c32caa90dfb7f959208730c0a0c01de8579cbd9ca`, run 2 `c6dfaa033c274a210757d94637cce11c7e968252264f98b6f0ed089654fe3c25`.

The raw `cpu.cpuprofile` and heap snapshots (111 MB and 216 MB) are not committed. Their sha256: create `2a722ea45ee973f32e675555c202c87cd97ef36fcd8a0fc815027eb76b909ffa`, swap `d7bbe5af747174cb3dc6c82d2c4529575cca71dfe14895700acea1f6e63c10ea`. Re-run the invocation above to regenerate them.
