import { head, html, resource, suspense } from '@purityjs/core';

export default function StreamPage(): unknown {
  head(html`<title>/stream — Purity SSR streaming on Deno</title>`);
  return html`
    <h1>Streaming boundary</h1>
    ${suspense(
      () => {
        const fact = resource(
          () =>
            new Promise<string>((r) =>
              setTimeout(() => r('Deno ships with a TypeScript-aware runtime'), 150),
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
