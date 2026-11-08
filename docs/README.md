# Purity docs

Long-form guides that don't fit cleanly in a README.

Read them on the [public documentation site](https://koalafacts.github.io/Purity/docs/), which is built with Purity and published from this repository. The site also has a [category browser](https://koalafacts.github.io/Purity/docs/categories/) for finding related pages.

Every Markdown file under `docs/` is reachable from this page; `npm run check:docs` fails when one is not, or when a relative link, anchor, named path or npm script in a current doc is wrong.

## Guides (current, for application authors)

| Doc                                                        | What it covers                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [`framework-capabilities.md`](./framework-capabilities.md) | Implemented framework features, evidence, and remaining verification gaps                                                    |
| [`reactivity.md`](./reactivity.md)                         | State, computed values, template bindings, and keyed lists                                                                   |
| [`typescript.md`](./typescript.md)                         | Type inference for `state`/`compute`/`resource`, generic component props, scoped slots, `WatchSource<T>` for custom helpers  |
| [`core-entry-points.md`](./core-entry-points.md)           | Which package entry provides each feature, and the 0.4 → 0.5 import mapping                                                  |
| [`client-first-aot.md`](./client-first-aot.md)             | Strict client-only AOT by default, `hydratable: true` for SSR clients and islands                                            |
| [`server-rendering.md`](./server-rendering.md)             | CLI SSR and mixed-mode starters, route responses, Node deployment, and hydration                                             |
| [`islands.md`](./islands.md)                               | Opt-in hydration for interactive regions                                                                                     |
| [`shadow-dom-rationale.md`](./shadow-dom-rationale.md)     | Why `component()` uses Shadow DOM by default, when it pays, when it hurts, escape hatches, Tailwind / global-CSS integration |
| [`accessibility.md`](./accessibility.md)                   | ARIA across shadow boundaries, focus delegation, screen-reader-friendly slot patterns, a worked `p-tabs` example             |
| [`security.md`](./security.md)                             | Security boundaries: template data escaping, server modules and actions, request handling                                    |
| [`migration.md`](./migration.md)                           | Side-by-side cheatsheet: React / SolidJS / Vue / Svelte → Purity equivalents                                                 |
| [`debugging.md`](./debugging.md)                           | The `__purity_inspect__` hook — inspecting the reactive graph from the browser console                                       |
| [`licensing.md`](./licensing.md)                           | Licence scope: Apache-2.0 from 0.5.0, MIT for releases through 0.4.0                                                         |

## Decisions and plans (current, for contributors)

| Doc                                                                    | What it covers                                                                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [`decisions/`](./decisions/README.md)                                  | Architecture Decision Records (ADRs), numbered; superseded ADRs are marked, never rewritten                             |
| [`plans/surpass-solid.md`](./plans/surpass-solid.md)                   | Active ledger of the surpass-Solid plan: ordered items, status, evidence and run log                                    |
| [`solid-competitor-roadmap.md`](./solid-competitor-roadmap.md)         | Execution roadmap against Solid v2 (SV2 row order)                                                                      |
| [`solid-v2-gap-analysis.md`](./solid-v2-gap-analysis.md)               | Capability-level gaps versus Solid v2 with acceptance scenarios; machine-readable rows in `solid-v2-gaps.json`          |
| [`2026-execution-model-roadmap.md`](./2026-execution-model-roadmap.md) | Research note: execution modes (resumability, server-driven interactivity) other frameworks ship and Purity doesn't yet |

## Dated records (historical, for reference)

| Doc                                                                      | What it records                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [`code-quality-audit-2026-11-05.md`](./code-quality-audit-2026-11-05.md) | Code-level audit CQ-01..CQ-13 against Solid v2 rc.20; findings tracked in the ledger |
| [`security-audit-2026-10-03.md`](./security-audit-2026-10-03.md)         | Request and script security audit of 0.3.2 and its fixes                             |
| [`releases/0.5.0.md`](./releases/0.5.0.md)                               | 0.5.0 release notes                                                                  |
| [`releases/0.5.1.md`](./releases/0.5.1.md)                               | 0.5.1 release notes                                                                  |
| [`releases/0.5.2.md`](./releases/0.5.2.md)                               | 0.5.2 release notes                                                                  |

These are pre-1.0 working docs. If something's wrong or missing, please
open an issue.

## See also

- [Live polling-dashboard demo](https://koalafacts.github.io/Purity/dashboard/) — end-to-end Purity app exercising `resource`, `lazyResource`, `debounced`, retry, polling, and the falsy-source pause pattern. Source under [`examples/dashboard`](../examples/dashboard).
