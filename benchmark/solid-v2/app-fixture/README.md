# Isolated Solid v2 rc.18 application comparator inputs

SV2-001 input work package. This directory is deliberately **not** part of
the root npm workspaces: the legacy benchmark remains pinned to its original
rc.14/rc.15 components and must never be relabelled as rc.18.

Exact direct versions are drawn from `../target.json`: core, signals, web,
compiler and Babel plugin `2.0.0-rc.18`; Vite plugin `3.0.0-next.51`;
router `2.0.0-next.42`. Vite is independently fixed to `8.0.0`.
SolidStart `2.1.0` is **not** installed: it has Solid v1 peer requirements.

The separate PR workflow uses Node 24, resolves a **real full transitive
npm lock** with no lifecycle scripts, reinstalls it with `npm ci`, verifies
each selected package's integrity against the frozen target and hashes the
installed client entries. It archives the lock and an identity report. The
generated lock is **candidate evidence until reviewed and committed**;
target metadata by itself is not an application lockfile.

This first input slice does not execute browser DOM or server rendering and
does not claim framework parity, emitted-app bundle sizes, startup/update
timing, allocations or retained heap. A following slice requires actual
same-function client/server fixtures, locked build outputs, export-condition
verification and per-chunk comparison. Existing Purity Brotli caps are
unchanged.
