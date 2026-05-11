// Minimal Node SSR server — zero deps beyond Node + Vite (dev mode) or the
// pre-built bundles (production mode). Demonstrates the canonical SSR flow:
//
//   1. Read the index.html template.
//   2. Convert IncomingMessage → Request (ADR 0009 contract — the framework
//      expects a Web Request).
//   3. Run the app via Vite's ssrLoadModule (dev) or the pre-built server
//      bundle (prod) to produce { body, head }.
//   4. Splice body into <!--ssr-outlet--> and head into <!--head-outlet-->.
//   5. Send the result.
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

// Convert Node's IncomingMessage to a Web Platform Request so the framework's
// per-render context (getRequest()) sees the standard shape. The framework
// accepts a real Request on every supported runtime (edge / Node / Bun /
// Deno) — only old Node `http` servers need this one-line shim.
function toRequest(msg: IncomingMessage): Request {
  const host = msg.headers.host ?? 'localhost';
  const proto = (msg.headers['x-forwarded-proto'] as string) ?? 'http';
  const url = `${proto}://${host}${msg.url ?? '/'}`;
  return new Request(url, {
    method: msg.method ?? 'GET',
    headers: msg.headers as HeadersInit,
  });
}

// Splice `body` into <!--ssr-outlet--> and `head` into <!--head-outlet-->.
// Plain string replacement — index.html owns the surrounding shell.
function spliceShell(template: string, body: string, head: string): string {
  return template.replace('<!--head-outlet-->', head).replace('<!--ssr-outlet-->', body);
}

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
        render: (request: Request) => Promise<{ body: string; head: string }>;
      };
      const { body, head } = await mod.render(toRequest(req));
      res.setHeader('Content-Type', 'text/html');
      res.end(spliceShell(template, body, head));
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
    render: (request: Request) => Promise<{ body: string; head: string }>;
  };
  const server = createHttpServer(async (req, res) => {
    try {
      const { body, head } = await mod.render(toRequest(req));
      res.setHeader('Content-Type', 'text/html');
      res.end(spliceShell(template, body, head));
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
