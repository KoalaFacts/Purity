import { head } from '@purityjs/router';
import { html } from '@purityjs/core/jit';

export default function HomePage(): unknown {
  head(html`<meta name="description" content="Streaming SSR on Vercel Edge." />`);
  return html`
    <h1>Hello from Vercel Edge</h1>
    <p>
      File-system routing + <code>asyncRoute()</code> end-to-end on V8 isolates. Visit
      <a href="/stream">/stream</a> for a streaming- suspense demo.
    </p>
  `;
}
