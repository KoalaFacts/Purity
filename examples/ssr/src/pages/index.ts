// Home page. Demonstrates two ADR-0022 details:
//
//   - The `loader` named export below is detected by `@purityjs/vite-plugin`
//     and the manifest entry for this route gets `hasLoader: true`. You can
//     verify by inspecting the generated `purity:routes` virtual module.
//
//   - The component itself does NOT use the loader's data in this demo
//     because the user-land async composer is gated on the runtime ADR
//     (`asyncRoute()` / `loaderData()`). The component falls back to the
//     existing `resource()` + `suspense()` primitives that already
//     register correctly with the SSR multipass context.

import { component, eachSSR, head, html, resource, suspense } from '@purityjs/core';

component<{ count: number }>('demo-counter', ({ count }) => {
  return html`
    <div>
      <h2>Count: ${() => count}</h2>
      <p>Server-rendered, hydrated on the client.</p>
    </div>
  `;
});

export async function loader(): Promise<{ todos: string[] }> {
  await new Promise((r) => setTimeout(r, 30));
  return { todos: ['Write tests', 'Ship SSR', 'Celebrate'] };
}

export default function HomePage(_params: Record<string, string>, _data: unknown): unknown {
  head(html`<title>Purity SSR demo — home</title>`);
  head(html`<meta name="description" content="Reactive SSR with streaming." />`);

  return html`
    <h1>Hello from /</h1>
    <demo-counter :count=${42}></demo-counter>
    ${suspense(
      () => {
        const todos = resource(
          () =>
            new Promise<string[]>((r) =>
              setTimeout(() => r(['Write tests', 'Ship SSR', 'Celebrate']), 30),
            ),
          { initialValue: [], key: 'todos' },
        );
        return html`
          <h2>Todos (via resource — runtime composer ships in next ADR)</h2>
          <ul>
            ${eachSSR(
              () => todos() ?? [],
              (item) => html`<li>${() => item()}</li>`,
            )}
          </ul>
        `;
      },
      () => html`<p class="loading">loading todos…</p>`,
      { timeout: 5000 },
    )}
  `;
}
