// Home page. Demonstrates the full loader pipeline end-to-end:
//
//   - ADR 0022: `loader` named export detected by the manifest.
//   - ADR 0025: `asyncRoute()` invokes the loader before the view.
//   - ADR 0026: the view reads its loader data via `loaderData()` instead
//     of the positional `data` arg — decouples the component signature
//     from the loader's return type.

import { component, each, head, html, loaderData } from '@purityjs/core';

component<{ count: number }>('demo-counter', ({ count }) => {
  return html`
    <div>
      <h2>Count: ${() => count}</h2>
      <p>Server-rendered, hydrated on the client.</p>
    </div>
  `;
});

export async function loader(): Promise<{ todos: string[] }> {
  // Simulate a slow server-side fetch — the renderer awaits this before
  // pass 2 (ADR 0024), so the SSR HTML ships with the data inlined.
  await new Promise((r) => setTimeout(r, 30));
  return { todos: ['Write tests', 'Ship SSR', 'Celebrate'] };
}

export default function HomePage(): unknown {
  head(html`<title>Purity SSR demo — home</title>`);
  head(html`<meta name="description" content="Reactive SSR with streaming." />`);

  const data = loaderData<{ todos: string[] }>();
  const todos = data?.todos ?? [];

  // `each()` is ADR-0023 isomorphic — the same call works in SSR (emits
  // the per-row marker grammar) and on the client (builds the DOM).
  return html`
    <h1>Hello from /</h1>
    <demo-counter :count=${42}></demo-counter>
    <h2>Todos (loaded via ADR 0022, read via ADR 0026's loaderData())</h2>
    <ul>
      ${each(
        () => todos,
        (item) => html`<li>${() => item()}</li>`,
      )}
    </ul>
  `;
}
