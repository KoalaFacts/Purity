// Shared component used by every entry — server (renderToString), SSG
// (renderStatic), and client (hydrate). The Vite plugin AOT-compiles each
// `html\`\`` call site for the appropriate build target (DOM builder for the
// client bundle; string builder for the SSR bundle).
//
// What this example exercises:
//   - getRequest() for URL-aware route dispatch (ADR 0009)
//   - head() for per-route <title> and <meta> (ADR 0008)
//   - suspense() with a slow keyed resource()
//   - the standard hydration path (ADR 0005)
import { component, eachSSR, getRequest, head, html, resource, suspense } from '@purityjs/core';

component<{ count: number }>('demo-counter', ({ count }) => {
  return html`
    <div>
      <h2>Count: ${() => count}</h2>
      <p>Server-rendered, hydrated on the client.</p>
    </div>
  `;
});

// --- Route dispatch -------------------------------------------------------
//
// One App() function, three routes. We dispatch on `request.url`'s pathname
// inside the render so every entry point (renderToString / renderToStream /
// renderStatic / hydrate) goes through identical code. On the client,
// getRequest() returns null and we fall back to `window.location` so the
// hydrated page sees the same path the SSR-rendered HTML did.

function pathnameForRender(): string {
  const req = getRequest();
  if (req) return new URL(req.url).pathname;
  if (typeof window !== 'undefined') return window.location.pathname;
  return '/';
}

function HomePage() {
  head(html`<title>Purity SSR demo — home</title>`);
  head(html`<meta name="description" content="Reactive SSR with streaming." />`);

  return html`
    <main>
      <h1>Hello from /</h1>
      <demo-counter :count=${42}></demo-counter>
      <p><a href="/about">→ about</a></p>
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
            <h2>Todos</h2>
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
    </main>
  `;
}

function AboutPage() {
  head(html`<title>About — Purity SSR demo</title>`);
  head(html`<meta name="description" content="About this demo." />`);

  const sourceLabel = getRequest()
    ? 'rendered on the server'
    : 'rendered on the client (post-hydration update)';

  return html`
    <main>
      <h1>About</h1>
      <p>This page is ${sourceLabel}.</p>
      <p><a href="/">← home</a></p>
    </main>
  `;
}

function NotFoundPage(path: string) {
  head(html`<title>Not found — Purity SSR demo</title>`);
  return html`
    <main>
      <h1>404</h1>
      <p>No route matches <code>${path}</code>.</p>
      <p><a href="/">← home</a></p>
    </main>
  `;
}

export function App() {
  const path = pathnameForRender();
  if (path === '/' || path === '') return HomePage();
  if (path === '/about') return AboutPage();
  return NotFoundPage(path);
}
