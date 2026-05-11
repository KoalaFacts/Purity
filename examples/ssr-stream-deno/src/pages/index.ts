import { head, html } from '@purityjs/core';

export default function HomePage(): unknown {
  head(html`<meta name="description" content="Streaming SSR on Deno." />`);
  return html`
    <h1>Hello from Deno</h1>
    <p>
      File-system routing + <code>asyncRoute()</code> end-to-end on Deno's
      TypeScript-aware runtime. Visit <a href="/stream">/stream</a> for
      the streaming-suspense demo.
    </p>
  `;
}
