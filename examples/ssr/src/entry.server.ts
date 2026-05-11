// Server entry — `vite build --ssr src/entry.server.ts` produces a Node
// bundle whose default export is `render(url): Promise<string>`. The bundled
// `<html>` shell from index.html is provided by `server.js` which inlines
// the rendered string at the `<!--ssr-outlet-->` marker.
import { renderToString } from '@purityjs/ssr';
import { App } from './app.ts';

export async function render(_url: string): Promise<string> {
  return renderToString(App);
}
