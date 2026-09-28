# Get started

Create a project with the published CLI, install dependencies, and start the development server:

```bash
npx @purityjs/cli my-app
cd my-app
npm install
npm run dev
```

The starter includes a counter component and a Vite configuration with the Purity compiler. Edit `src/main.ts` to see changes immediately.

## The three building blocks

`state()` stores a value, `compute()` derives one, and `html` describes the DOM. Reactive expressions update when the state they read changes.

```ts
import { compute, html, mount, state } from '@purityjs/core';

const count = state(0);
const doubled = compute(() => count() * 2);

mount(
  () => html`
    <button @click=${() => count((value) => value + 1)}>Add one</button>
    <p>Double: ${() => doubled()}</p>
  `,
  document.getElementById('app')!,
);
```

## Build for production

For a client-only project, run `npm run build` and publish the generated `dist` directory to a static host.

For a server-rendered project, create it with `--ssr`, then run `npm run build` and `npm start`. The generated README explains which files to deploy to a Node host.

## Go deeper

- [TypeScript](../../../docs/typescript.md) explains inferred and explicit types.
- [Shadow DOM](../../../docs/shadow-dom-rationale.md) explains component styling and boundaries.
- [Accessibility](../../../docs/accessibility.md) covers focus and form patterns.
- [Architecture decisions](../../../docs/decisions/README.md) record why features work the way they do.
