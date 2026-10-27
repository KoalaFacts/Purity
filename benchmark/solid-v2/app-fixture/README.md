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

This demonstrates reproducible **input resolution and buildability**, not
whole-row acceptance. Browser DOM/click parity, server export conditions,
full comparative app workloads, startup/update timings, allocation and
retained heap are still unproved; those require separate executed traces
and the matched Purity fixture. Core-all and core-actions budgets remain
unchanged. No size reduction or Solid performance advantage is claimed.
