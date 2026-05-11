import { currentPath, head, html } from '@purityjs/core';

export default function NotFoundPage(): unknown {
  head(html`<title>Not found</title>`);
  return html`
    <h1>404</h1>
    <p>No route matches <code>${() => currentPath()}</code>.</p>
  `;
}
