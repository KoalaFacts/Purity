# Client-first AOT: breaking migration

Purity's default Vite build is now strict client-only AOT. The compiler generates create/update factories directly; it does not generate template hydration walkers or call the runtime hydration selector for these templates. No runtime parser or code generator is permitted in a strict production build.

## Choose by application behavior

- Pure client application or widget: use `purity()`.
- SSR client, hydrated island or a component library whose views must adopt server DOM: use `purity({ hydratable: true })` in the client compilation. Server transforms still produce SSR output.
- Deliberate runtime-template fallback: opt into `strictAot: false`; this does not remove the requirement to opt into hydration separately.

This intentionally breaks the previous implicit hydration and permissive-AOT defaults. There is no automatic compatibility fallback. Rebuild precompiled component libraries with the correct mode; do not use client-only compiled views as hydration views.

The existing hydration runtime remains for applications that use it, not as a shim in every generated template. Shared control-flow, component and lifecycle modules may still contain hydration coordination. This change is not a claim that every hydration-related byte is absent from every client application. It changes generated program dependencies rather than renaming npm packages. URL validation, ownership, forms, custom elements and SSR features are not removed.

## Reproducible acceptance

The original 14 package entries and 12 full-hydration/JIT application profiles remain measured. Schema 5 adds five same-source client-only AOT profiles (counter, client-JIT-import counter, keyed controls, form and resource), each with explicit compilation identity and every emitted JS chunk. The SSR/hydration workload never opts out of hydration. Original v3/v4 schemas and budgets remain frozen. Three-browser verification runs every profile, including CSP for all AOT profiles.

Compare client-only and hydratable builds only for workloads that do not require hydration. Do not relabel that mode choice as a reduction in the all-feature core, and do not add independent application payloads together as one download. The frozen core-all 40,679 B baseline, <=34,577 B goal and original hard caps are unchanged. This work alone does not establish Solid v2 parity, speed, allocation or retained-heap improvements.
