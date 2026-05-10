// Server entry — `vite build --ssr src/entry.server.ts` produces a Node
// bundle whose default export is `render(request)`. The buffered SSR HTML
// (body + head) is returned for `server.ts` to splice into index.html.
//
// `extractHead: true` so head() calls in app.ts surface in the response;
// `request` propagates through so getRequest() in the App returns the
// real per-request URL / headers / cookies.
import { renderToString } from '@purityjs/ssr';
import { App } from './app.ts';

export async function render(request: Request): Promise<{ body: string; head: string }> {
  return renderToString(App, { request, extractHead: true });
}
