# Purity docs

Long-form guides that don't fit cleanly in a README.

| Doc                                                    | What it covers                                                                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| [`typescript.md`](./typescript.md)                     | Type inference for `state`/`compute`/`resource`, generic component props, scoped slots, `WatchSource<T>` for custom helpers  |
| [`shadow-dom-rationale.md`](./shadow-dom-rationale.md) | Why `component()` uses Shadow DOM by default, when it pays, when it hurts, escape hatches, Tailwind / global-CSS integration |
| [`accessibility.md`](./accessibility.md)               | ARIA across shadow boundaries, focus delegation, screen-reader-friendly slot patterns, a worked `p-tabs` example             |
| [`migration.md`](./migration.md)                       | Side-by-side cheatsheet: React / SolidJS / Vue / Svelte → Purity equivalents                                                 |
| [`debugging.md`](./debugging.md)                       | The `__purity_inspect__` hook — inspecting the reactive graph from the browser console                                       |
| [`decisions/`](./decisions/)                           | Architecture Decision Records (ADRs) — SSR strategy, devtools approach, path to 1.0                                          |

These are pre-1.0 working docs. If something's wrong or missing, please
open an issue.

## See also

- [Live polling-dashboard demo](https://koalafacts.github.io/Purity/dashboard/) — end-to-end Purity app exercising `resource`, `lazyResource`, `debounced`, retry, polling, and the falsy-source pause pattern. Source under [`examples/dashboard`](../examples/dashboard).
