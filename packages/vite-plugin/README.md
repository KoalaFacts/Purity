# @purityjs/vite-plugin

[![npm version](https://img.shields.io/npm/v/@purityjs/vite-plugin.svg)](https://www.npmjs.com/package/@purityjs/vite-plugin)
[![npm downloads](https://img.shields.io/npm/dm/@purityjs/vite-plugin.svg)](https://www.npmjs.com/package/@purityjs/vite-plugin)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@purityjs/vite-plugin?label=gzipped)](https://bundlephobia.com/package/@purityjs/vite-plugin)
[![license](https://img.shields.io/npm/l/@purityjs/vite-plugin.svg)](../../LICENSE)

AOT template compilation for Purity. Compiles `html` tagged templates at build time into direct DOM creation code.

## Why

|                    | Without plugin      | With plugin           |
| ------------------ | ------------------- | --------------------- |
| **Bundle**         | 8.13 kB gzip        | **6.02 kB gzip**      |
| **First render**   | JIT compile + cache | Pre-compiled, instant |
| **CSP**            | Needs `unsafe-eval` | **CSP-safe**          |
| **Runtime parser** | Shipped to browser  | **Eliminated**        |

## Install

```bash
npm install -D @purityjs/vite-plugin
```

## Setup

```ts
// vite.config.ts
import { purity } from '@purityjs/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [purity()],
});
```

That's it. No other config needed.

## What It Does

Your code:

```ts
html`<div @click=${handler}>${() => count()}</div>`;
```

Compiled output:

```js
const _e0 = document.createElement('div');
_e0.addEventListener('click', handler);
const _x0 = document.createTextNode('');
__watch(() => {
  _x0.data = String(count());
});
_e0.appendChild(_x0);
```

No runtime parsing. No `new Function()`. Direct DOM calls.

## Options

```ts
purity({
  include: ['.ts', '.js', '.tsx', '.jsx'], // file extensions to transform (default)
});
```

## How It Works

1. Finds `html` tagged template literals in your source
2. Extracts template strings and expression positions
3. Parses into AST using `@purityjs/core`'s parser
4. Generates optimized JS using `@purityjs/core`'s codegen
5. Replaces the `html`...`` call with the compiled output
6. Removes `html` from imports (dead code eliminated)
7. Adds `watch` import alias for reactive bindings

The plugin only transforms user code — framework internals are skipped.

## License

MIT
