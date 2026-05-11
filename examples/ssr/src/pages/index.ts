// Home page. Demonstrates ADRs 0022 + 0024:
//
//   - `loader` named export is detected by the plugin (hasLoader: true on
//     the manifest entry).
//   - The composer in src/app.ts awaits the loader's result and threads it
//     into the component as the second positional arg.
//   - ADR 0024's SSR-aware lazyResource is what lets the renderer await
//     the route module + loader resolution before pass 2 — that's why the
//     SSR HTML ships with `data.todos` already rendered, not the
//     suspense fallback.

import { component, each, head, html } from '@purityjs/core';

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

interface HomeData {
  todos: string[];
}

export default function HomePage(_params: Record<string, string>, data: HomeData): unknown {
  head(html`<title>Purity SSR demo — home</title>`);
  head(html`<meta name="description" content="Reactive SSR with streaming." />`);

  // `each()` is ADR-0023 isomorphic — the same call works in SSR (emits
  // the per-row marker grammar) and on the client (builds the DOM).
  return html`
    <h1>Hello from /</h1>
    <demo-counter :count=${42}></demo-counter>
    <h2>Todos (loaded via ADR 0022's loader)</h2>
    <ul>
      ${each(
        () => data.todos,
        (item) => html`<li>${() => item()}</li>`,
      )}
    </ul>
  `;
}
