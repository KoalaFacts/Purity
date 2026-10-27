# @purityjs/vite-plugin — AI Agent Context

AOT template compiler for Purity. Vite plugin.

## Setup

```ts
// vite.config.ts
import { purity } from '@purityjs/vite-plugin';
export default defineConfig({ plugins: [purity()] });
```

## What It Compiles

```text
// Input
html`<div @click=${fn}>${() => count()}</div>`;

// With hydratable: true, client output hoists a DOM factory and hydration walker.
const __purity_tpl_0 = <precompiled DOM factory>;
const __purity_tpl_0_hydrate = <precompiled hydration walker>;
const view = __purity_renderCompiled__(__purity_tpl_0, __purity_tpl_0_hydrate, [fn, () => count()]);
```

## Options

```ts
purity({ include: ['.ts', '.js', '.tsx', '.jsx'] });
```

## Important

- Only transforms user code, skips @purityjs/core internals
- Removes `html` from imports after compilation
- Auto-injects `renderCompiledTemplate` from `@purityjs/core/runtime` in client builds
- Uses the precompiled hydration walker against SSR nodes; hydration does not invoke the runtime parser or code generator

- Redirects proven ordinary named `each` imports to `@purityjs/core/list-runtime`; dynamic options and virtual lists retain the public implementation.

## Client-first default (breaking)

`purity()` uses strict client-only AOT. It emits create-factory calls with shared `watch`, without hydration walkers or `renderCompiledTemplate`. Use `hydratable: true` for SSR clients and hydrated component libraries. Only explicit `strictAot: false` allows runtime fallback. Preserve all original behavior tests in their declared mode and exercise the default client mode independently.
