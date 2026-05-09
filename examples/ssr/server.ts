// Minimal Node SSR server — zero deps beyond Node + Vite (dev mode) or the
// pre-built bundles (production mode). Demonstrates the canonical SSR flow:
//
//   1. Read the index.html template.
//   2. Run the app via Vite's ssrLoadModule (dev) or the pre-built server
//      bundle (prod) to produce an HTML string.
//   3. Replace the <!--ssr-outlet--> marker with the rendered HTML.
//   4. Send the result.
//
// Run with `node --experimental-strip-types server.ts` (Node 22.6+) or just
// `node server.ts` on Node 23.6+ where the flag is on by default.

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3000);

// Always log errors server-side; never leak stack traces or unescaped
// exception text to the client (info disclosure + reflected XSS via the
// HTML-typed response).
function sendError(res: ServerResponse, err: unknown): void {
  console.error(err);
  res.statusCode = 500;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Internal Server Error');
}

async function startDev(): Promise<void> {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'custom',
  });

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      let template = await readFile(resolve(__dirname, 'index.html'), 'utf-8');
      template = await vite.transformIndexHtml(req.url ?? '/', template);
      const mod = (await vite.ssrLoadModule('/src/entry.server.ts')) as {
        render: (url: string) => Promise<string>;
      };
      const html = await mod.render(req.url ?? '/');
      res.setHeader('Content-Type', 'text/html');
      res.end(template.replace('<!--ssr-outlet-->', html));
    } catch (err) {
      vite.ssrFixStacktrace?.(err as Error);
      sendError(res, err);
    }
  };

  const server = createHttpServer((req, res) => {
    vite.middlewares(req, res, () => handler(req, res));
  });
  server.listen(port, () => {
    console.log(`[purity-ssr-demo] dev server running at http://localhost:${port}`);
  });
}

async function startProd(): Promise<void> {
  const template = await readFile(resolve(__dirname, 'dist/client/index.html'), 'utf-8');
  const mod = (await import(resolve(__dirname, 'dist/server/entry.server.js'))) as {
    render: (url: string) => Promise<string>;
  };
  const server = createHttpServer(async (req, res) => {
    try {
      const html = await mod.render(req.url ?? '/');
      res.setHeader('Content-Type', 'text/html');
      res.end(template.replace('<!--ssr-outlet-->', html));
    } catch (err) {
      sendError(res, err);
    }
  });
  server.listen(port, () => {
    console.log(`[purity-ssr-demo] prod server running at http://localhost:${port}`);
  });
}

if (isProd) await startProd();
else await startDev();
