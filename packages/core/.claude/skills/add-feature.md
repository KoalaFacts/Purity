# Skill: Add a Feature to Purity Core

When asked to add a new feature to the framework:

## Pre-flight
1. Read CLAUDE.md for current API surface
2. Check if the feature already exists or overlaps with existing API
3. Decide: core or separate package?
   - Core: fundamental to the framework (signals, templates, components)
   - Package: opinionated or optional (routing, store, DI)

## Implementation Checklist
1. **Design the API** — what does the developer write?
2. **Choose the file** — which src file does it belong in?
3. **Write the code** — follow existing patterns:
   - for-loops with index (not for-of)
   - Nullable arrays with ??= lazy init
   - console.error for errors (never silent catch)
   - assertSafeName() for codegen inputs
4. **Export from index.ts** — add to public API
5. **Write tests** — in packages/core/tests/
6. **Type-check** — `npx tsc --noEmit`
7. **Format** — `npx biome check --write .`
8. **Run all tests** — `npm test --workspaces`

## Design Principles
- **One function, one job** — no multi-purpose utilities
- **No aliases** — one name per concept
- **Functions as props** — events are just callback props, no emit system
- **Context-aware** — hooks read from component context (like onMount)
- **Reactive by default** — if it can be reactive, make it reactive
- **Zero config** — it should just work

## Performance Rules
- Pre-compile regex as module constants
- Cache closures (peek, slot accessors)
- Pre-allocate arrays when size is known
- Swap refs instead of allocating (watch old/new values)
- Skip work when nothing changed (match prevKey, each key scan)
- Use charCode comparisons over string methods in hot paths

## What NOT to add to core
- Routing (opinionated, separate package)
- State management (userland composable)
- DI / provide-inject (separate package)
- CSS-in-JS beyond scoped css`` (use Shadow DOM)
- Animation/transition system (separate package)
- SSR/SSG (future, separate)
