# @purity/vite-plugin — AI Agent Context

AOT template compiler for Purity. Vite plugin.

## Setup
```ts
// vite.config.ts
import { purity } from '@purity/vite-plugin';
export default defineConfig({ plugins: [purity()] });
```

## What It Compiles
```ts
// Input
html`<div @click=${fn}>${() => count()}</div>`

// Output
const _e0 = document.createElement('div');
_e0.addEventListener('click', fn);
const _x0 = document.createTextNode('');
__purity_w__(() => { _x0.data = String(count()); });
_e0.appendChild(_x0);
```

## Options
```ts
purity({ include: ['.ts', '.js', '.tsx', '.jsx'] })
```

## Important
- Only transforms user code, skips @purity/core internals
- Removes `html` from imports after compilation
- Auto-injects `watch as __purity_w__` import
