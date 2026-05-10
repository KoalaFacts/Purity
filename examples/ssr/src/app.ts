// Shared component used by every entry — server (renderToString), SSG
// (renderStatic), and client (hydrate). The Vite plugin AOT-compiles each
// `html\`\`` call site for the appropriate build target (DOM builder for the
// client bundle; string builder for the SSR bundle).
//
// What this example exercises:
//   - currentPath() + matchRoute() + navigate() router primitives (ADR 0011)
//   - getRequest() for URL-aware route dispatch (ADR 0009)
//   - head() for per-route <title> and <meta> (ADR 0008)
//   - suspense() with a slow keyed resource()
//   - the standard hydration path (ADR 0005)
import {
  component,
  currentPath,
  eachSSR,
  head,
  html,
  matchRoute,
  navigate,
  resource,
  suspense,
} from '@purityjs/core';

component<{ count: number }>('demo-counter', ({ count }) => {
  return html`
    <div>
      <h2>Count: ${() => count}</h2>
      <p>Server-rendered, hydrated on the client.</p>
    </div>
  `;
});

// --- Route handlers --------------------------------------------------------

function HomePage() {
  head(html`<title>Purity SSR demo — home</title>`);
  head(html`<meta name="description" content="Reactive SSR with streaming." />`);

  return html`
    <main>
      <h1>Hello from /</h1>
      <demo-counter :count=${42}></demo-counter>
      <p>
        <a
          href="/about"
          @click=${(e: Event) => {
            e.preventDefault();
            navigate('/about');
          }}
          >→ about</a
        >
      </p>
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

function AboutPage(_match: { params: Record<string, string> }) {
  head(html`<title>About — Purity SSR demo</title>`);
  head(html`<meta name="description" content="About this demo." />`);

  return html`
    <main>
      <h1>About</h1>
      <p>This page uses currentPath() / matchRoute() / navigate().</p>
      <p>
        <a
          href="/"
          @click=${(e: Event) => {
            e.preventDefault();
            navigate('/');
          }}
          >← home</a
        >
      </p>
    </main>
  `;
}

function UserProfilePage(match: { params: Record<string, string> }) {
  head(html`<title>User ${match.params.id} — Purity SSR demo</title>`);
  return html`
    <main>
      <h1>User profile</h1>
      <p>User id: <code>${match.params.id}</code></p>
      <p>
        <a
          href="/"
          @click=${(e: Event) => {
            e.preventDefault();
            navigate('/');
          }}
          >← home</a
        >
      </p>
    </main>
  `;
}

function NotFoundPage() {
  const path = currentPath();
  head(html`<title>Not found — Purity SSR demo</title>`);
  return html`
    <main>
      <h1>404</h1>
      <p>No route matches <code>${path}</code>.</p>
      <p>
        <a
          href="/"
          @click=${(e: Event) => {
            e.preventDefault();
            navigate('/');
          }}
          >← home</a
        >
      </p>
    </main>
  `;
}

// --- Route table -----------------------------------------------------------
//
// Plain array of `{ pattern, view }` tuples. Dispatch is one matchRoute()
// call per entry, in declaration order. First-match wins. Real apps will
// likely extract this into a tiny helper; the example keeps it inline so
// every step is visible.

export function App() {
  if (matchRoute('/')) return HomePage();
  const aboutMatch = matchRoute('/about');
  if (aboutMatch) return AboutPage(aboutMatch);
  const userMatch = matchRoute('/users/:id');
  if (userMatch) return UserProfilePage(userMatch);
  return NotFoundPage();
}
