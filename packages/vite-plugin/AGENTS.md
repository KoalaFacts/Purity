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

// Client output hoists both a DOM factory and a hydration walker.
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
- Auto-injects `renderCompiledTemplate` from `@purityjs/core/compiler` in client builds
- Uses the precompiled hydration walker against SSR nodes; hydration does not invoke the runtime parser or code generator
