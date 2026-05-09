// Minimal Node SSR server — zero deps beyond Node + Vite (dev mode) or the
// pre-built bundles (production mode). Demonstrates the canonical SSR flow:
//
//   1. Read the index.html template.
//   2. Run the app via Vite's ssrLoadModule (dev) or the pre-built server
//      bundle (prod) to produce an HTML string.
//   3. Replace the <!--ssr-outlet--> marker with the rendered HTML.
//   4. Send the result.

import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3000);

async function startDev() {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'custom',
  });

  const handler = async (req, res) => {
    try {
      let template = await readFile(resolve(__dirname, 'index.html'), 'utf-8');
      template = await vite.transformIndexHtml(req.url ?? '/', template);
      const { render } = await vite.ssrLoadModule('/src/entry.server.ts');
      const html = await render(req.url ?? '/');
      res.setHeader('Content-Type', 'text/html');
      res.end(template.replace('<!--ssr-outlet-->', html));
    } catch (err) {
      vite.ssrFixStacktrace?.(err);
      console.error(err);
      res.statusCode = 500;
      res.end(String(err?.stack ?? err));
    }
  };

  const server = createHttpServer((req, res) => {
    vite.middlewares(req, res, () => handler(req, res));
  });
  server.listen(port, () => {
    console.log(`[purity-ssr-demo] dev server running at http://localhost:${port}`);
  });
}

async function startProd() {
  const template = await readFile(resolve(__dirname, 'dist/client/index.html'), 'utf-8');
  const { render } = await import(resolve(__dirname, 'dist/server/entry.server.js'));
  const server = createHttpServer(async (req, res) => {
    try {
      const html = await render(req.url ?? '/');
      res.setHeader('Content-Type', 'text/html');
      res.end(template.replace('<!--ssr-outlet-->', html));
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      res.end(String(err?.stack ?? err));
    }
  });
  server.listen(port, () => {
    console.log(`[purity-ssr-demo] prod server running at http://localhost:${port}`);
  });
}

if (isProd) await startProd();
else await startDev();
