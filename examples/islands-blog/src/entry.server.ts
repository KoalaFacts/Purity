// Server entry. The whole page renders to a string; per-island
// wrappers are emitted automatically by island() during the render.
import { renderToString } from '@purityjs/ssr';
import { App } from './app.ts';

export async function render(request: Request): Promise<string> {
  return renderToString(App, { request });
}
