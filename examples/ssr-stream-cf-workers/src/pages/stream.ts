// /stream — exercises the streaming pipeline. The page shell flushes
// immediately with the `loading…` fallback inside a `suspense()` boundary;
// once the resource resolves the Worker streams a chunk that
// `__purity_swap(N)` splices into place in the browser.

import { head, html, resource, suspense } from '@purityjs/core';

export default function StreamPage(): unknown {
  head(html`<title>/stream — Purity SSR streaming on Workers</title>`);
  return html`
    <h1>Streaming boundary</h1>
    ${suspense(
      () => {
        // In a real Worker the fetcher would be a `fetch()` to your origin,
        // a D1 query, a KV read, etc. Here we simulate latency so the shell
        // ships before the boundary resolves.
        const fact = resource(
          () =>
            new Promise<string>((r) =>
              setTimeout(() => r('The Workers runtime started in 2017'), 150),
            ),
          { initialValue: undefined, key: 'fact' },
        );
        return html`<aside>${() => fact() ?? '…'}</aside>`;
      },
      () => html`<aside class="loading">loading the slow region…</aside>`,
      { timeout: 5000 },
    )}
  `;
}
