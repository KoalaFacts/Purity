# Isolated Solid v2 rc.18 application comparator inputs

SV2-001 input work package. This directory is deliberately **not** part of
the root npm workspaces: the legacy benchmark remains pinned to rc.14/rc.15
components and must never be relabelled as rc.18.

Exact direct versions are drawn from `../target.json`: core, signals,
web, compiler and Babel plugin `2.0.0-rc.18`; Vite plugin
`3.0.0-next.51`; router `2.0.0-next.42`. Vite is fixed to `8.3.5`.
SolidStart `2.1.0` is excluded because of its Solid v1 peer requirements.

The original #302 build used Vite `8.0.0`. Its archived sizes and hashes remain
historical evidence for that toolchain; they must not be relabelled as results
of this dependency update. New reports have their own source and lock identity.
The frozen Solid target and legacy benchmark inputs remain unchanged.

This folder has a **committed full transitive npm lock**, produced with Node
24.21.0, reinstalled with `npm ci --ignore-scripts` and cross-verified
against the seven official package integrities in the frozen target. The
isolated build compiles the same minimal button/counter shape as
`../../bundle-size/counter.ts` through the rc.18 Solid plugin and inventories
**all** emitted JavaScript chunks using the original gzip(9)/Brotli(11)
parameters. CI archives the exact installed entry hashes, lock identity,
build output and chunk inventory without touching the legacy benchmark lock.

## Row and binding inputs

`rows.html` and `binding.html` use isolated rc.18 compilation of the existing
Solid row/binding source shapes. Their action selectors, LCG data sequence,
per-row label signals and object-keyed field ownership match the established
Purity workloads. The legacy fixture sources and snapshots remain unchanged.
The copied HTML omits the legacy dangling stylesheet link; these checks compare
semantic DOM and state, not visual styling, layout cost or rendering speed.

Build these inputs separately from the counter:

```sh
npm exec -- vite build --config vite.workloads.config.ts
node inventory-chunks.ts --workloads
node --experimental-vm-modules --test workloads.test.ts
```

The Node DOM tests execute the emitted modules in jsdom. They are not real
browser or performance results. `dist-workloads` has its own manifest and
complete chunk inventory, including shared chunks counted once; it does not
replace the historical counter payload report.

After building the unchanged root benchmark, the existing browser checks can
explicitly target these inputs with `SOLID_V2_FIXTURE=1`. The same row/binding
actions, DOM normalization, labels, input-clear and reload assertions run against
Purity and the rc.18 build in all three engines in CI. New snapshots and source,
root-lock, isolated-lock and workload hashes are archived separately under
`benchmark/dist/fixture-parity-rc18`; default legacy checks retain their original
targets and output directory. Do not infer a pass without the exact-source CI
receipt. The dedicated workflow has read-only repository permissions and no
publishing step.

These are bounded input and semantic checks, not whole-row acceptance. Server
export conditions, full comparative app workloads, startup/update timings,
allocation and retained heap still require separate executed evidence. No timing
runner or measurement boundary is changed. Core-all and core-actions budgets
remain unchanged. No size reduction or Solid performance advantage is claimed.
