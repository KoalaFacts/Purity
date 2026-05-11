import { head, html, resource, suspense } from '@purityjs/core';

export default function StreamPage(): unknown {
  head(html`<title>/stream — Purity SSR streaming on Vercel Edge</title>`);
  return html`
    <h1>Streaming boundary</h1>
    ${suspense(
      () => {
        const fact = resource(
          () =>
            new Promise<string>((r) =>
              setTimeout(() => r('Vercel Edge runs on V8 isolates'), 150),
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
