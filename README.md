# Purity

A minimal, lightweight, super performant web framework built on native signals.

- **17 functions** — that's the entire API
- **6 kB gzipped** — with AOT compilation
- **No virtual DOM** — signals drive DOM updates directly
- **One dependency** — `signal-polyfill`

## Quick Start

```bash
npx @purity/cli my-app
cd my-app
npm install
npm run dev
```

## Packages

| Package | Description | Docs |
|---------|-------------|------|
| [`@purity/core`](./packages/core) | The framework — 17 functions | [README](./packages/core/README.md) |
| [`@purity/vite-plugin`](./packages/vite-plugin) | AOT template compilation | [README](./packages/vite-plugin/README.md) |
| [`@purity/cli`](./packages/cli) | Project scaffolding | [README](./packages/cli/README.md) |

## At a Glance

```ts
import { state, compute, html, css, component, mount } from '@purity/core';

component('p-counter', () => {
  const count = state(0);
  const doubled = compute(() => count() * 2);

  css`button { padding: 0.5rem 1rem; }`;

  return html`
    <p>${() => count()} (x2: ${() => doubled()})</p>
    <button @click=${() => count(v => v + 1)}>+1</button>
  `;
});

mount(() => html`<p-counter></p-counter>`, document.getElementById('app')!);
```

See each package README for full API documentation.

## License

MIT
