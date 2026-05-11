// Home route — no streaming boundary. Shows that the manifest-driven
// composer (asyncRoute) renders synchronously when no `suspense()` is in
// scope; the Worker still streams the shell, just without per-boundary
// chunks.

import { head, html } from '@purityjs/core';

export default function HomePage(): unknown {
  head(html`<meta name="description" content="Streaming SSR on Cloudflare Workers." />`);
  return html`
    <h1>Hello from Workers</h1>
    <p>
      File-system routing + <code>asyncRoute()</code> end-to-end on top of
      <code>renderToStream</code>. Visit <a href="/stream">/stream</a> for a streaming-suspense
      demo.
    </p>
  `;
}
