# Fixed-version reactive observations

Four small observations compare Purity source at `58ff714a336ee1fb34a3d9f77f4e0601e64a2d8f` with the **client production** runtime of `solid-js@2.0.0-rc.18` and `@solidjs/signals@2.0.0-rc.18` (upstream commit `225014bf8757421a2ea0a9c6ddc148b965eed000`). The archived result is [`trace.json`](./trace.json).

The final-path downloader and observation commands both exited 0. The archived observation was recorded at `2026-10-24T17:54:18.555Z` (2026-10-25 in Sydney); its final harness and input-manifest hashes are included in the trace.

This is behavioral evidence only: no performance measurements, browser/DOM execution, or framework-wide conformance claim. Purity source runs directly through **Node v24.21.0 native TypeScript stripping**. There is no Purity bundle/build step and no Vite/tsx transform. Solid is imported directly from `solid-js/dist/solid.js`, bypassing the Node/server export; its engine entry is `@solidjs/signals/dist/prod/index.js`.

## Rerun

Requirements: Node v24.21.0, `tar`, access to the official npm registry, and a complete Purity checkout at the pinned commit. Keep the full `packages/core/src` tree and package manifests so source imports resolve; no dependency installation in that checkout is needed.

From this directory, set `PURITY_NODE_24` to that Node executable and `PURITY_SOURCE_ROOT` to the pinned checkout:

```sh
PURITY_V2_DEPS="$(mktemp -d)"
PURITY_V2_OUTPUT="$(mktemp -d)"

"$PURITY_NODE_24" --use-env-proxy fetch-packages.ts --dest "$PURITY_V2_DEPS"
NODE_OPTIONS= NODE_ENV=production "$PURITY_NODE_24" observations.ts \
  --purity-root "$PURITY_SOURCE_ROOT" \
  --deps-root "$PURITY_V2_DEPS/node_modules" \
  --output "$PURITY_V2_OUTPUT/trace.json"
```

The downloader requires an explicitly chosen empty destination. The Node flag uses any existing environment proxy settings; it changes no proxy configuration and can be omitted on a direct-network host. It reads the fixed versions and SHA512 integrity values from [`inputs.json`](./inputs.json), GETs only `https://registry.npmjs.org`, checks metadata and downloaded bytes against those pins, and invokes `tar` with an argument array in an isolated directory. No npm installation or lifecycle scripts run. It retains extracted packages and a small provenance record in the destination; temporary tarballs are removed. Do not add those dependencies to this evidence directory.

The observation script requires an explicit `--output` and refuses to overwrite an existing file, protecting the archived trace. It normally reads the downloader's provenance record next to `node_modules`; `--provenance` can select another record. `--inputs` can select an explicit manifest, although changing its pins defines a different comparison.

## Input identity

The source revision is the recorded frozen checkout commit. Before running, the script verifies the SHA256 hashes of `signals.ts`, `scope.ts`, and `component.ts`, plus the **actual extracted Solid client and engine entry files** against the recorded values. It also checks installed package versions and the downloaded provenance. It does not merely trust provenance strings. The full package tarballs are pinned by SHA512; the individual entry hashes do not independently inventory every transitive package file.

Before importing either runtime, the harness also calls `createRequire(solidEntry).resolve('@solidjs/signals')` and requires the result to be the fixed production entry. The pinned rc.18 signals export map has no separate import/require branches, so this check detects an alternate dev/test/observe entry selected by conditions from either CLI flags or `NODE_OPTIONS`. The trace records the actual resolved entry relative to `--deps-root`, `process.execArgv`, and `NODE_OPTIONS`. `NODE_ENV=production` alone does not control Node export conditions. The replay command clears `NODE_OPTIONS`; the resolver guard still rejects conflicting CLI conditions.

The guard was exercised with CLI `--conditions=development` and separately with `NODE_OPTIONS=--conditions=development`, both while `NODE_ENV=production`. Both commands exited 1 before runtime import, reported `@solidjs/signals/dist/dev.js`, and created no output file. With no conflicting conditions, the same four observations exited 0; the trace records `execArgv: []`, empty `NODE_OPTIONS`, and the resolved production entry.

The Purity commit identifies the full source tree; the three individual hashes identify the directly audited primitive/ownership files, not a produced bundle or a full-tree hash. Current whole-repository dirty status is not used, so documentation edits outside these inputs do not masquerade as changed runtime source. The trace records runtime version, inputs, entry/source hashes, the final harness hash, and UTC time. Paths in the evidence are portable identifiers rather than machine-specific absolute paths.

All rerun inputs are delivered here (`observations.ts`, `fetch-packages.ts`, `inputs.json`, and the minimal module-type `package.json`) or identified above (Node, `tar`, pinned Purity checkout, and two registry packages). [`package-provenance.json`](./package-provenance.json) records the actual package inputs used for the archived run. No binary tarballs, installed dependencies, or duplicate full registry metadata belong in this directory.

## Observations and limits

| Observation                               | Purity                                                                                         | Solid v2 rc.18                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Read immediately after writing 0 → 1      | State/memo are 1/2 in the same stack.                                                          | State/memo remain 0/0 until the next microtask, then become 1/2.      |
| Initial and subsequent user effect timing | Auto-track watch applies before creation returns; later apply follows the write.               | Initial apply follows creation; later apply follows the write.        |
| Callback/apply reads an unrelated signal  | Changing that signal alone does not invoke the explicit callback. Initial callback is skipped. | Changing that signal alone does not invoke apply. Initial apply runs. |
| Nested disposable owner cleanup           | `parent:A`, `parent:B`, `child:A`, `child:B`.                                                  | `child:B`, `child:A`, `parent:B`, `parent:A`.                         |

The cleanup case uses Purity source-free nested **watches** with `onDispose` and Solid nested **roots** with `onCleanup`. This result must not be generalized to Purity component DOM unmount order, which has a separate child-component traversal. The effect observation does not establish complete DOM/render-effect ordering.

No keyed rows, user input state, async resource composition, error/loading boundaries, stores, actions, SSR, hydration, or browser engines were exercised. This is not a performance run or a framework-wide compatibility result. Open PR #294 is not included; the callback observation concerns the isolation already merged in #292, not initial double sampling or parent-subscription pollution.
