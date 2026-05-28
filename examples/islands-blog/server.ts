// Minimal SSR server, copied from examples/ssr/server.ts. Reads
// index.html, runs the app via Vite's ssrLoadModule (dev) or the
// pre-built bundle (prod), splices the body in.

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
const port = Number(process.env.PORT ?? 3001);

function toRequest(msg: IncomingMessage): Request {
  const host = msg.headers.host ?? 'localhost';
  const proto = (msg.headers['x-forwarded-proto'] as string) ?? 'http';
  const url = `${proto}://${host}${msg.url ?? '/'}`;
  return new Request(url, {
    method: msg.method ?? 'GET',
    headers: msg.headers as HeadersInit,
  });
}

function spliceShell(template: string, body: string): string {
  return template.replace('<!--ssr-outlet-->', body);
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
        render: (request: Request) => Promise<string>;
      };
      const body = await mod.render(toRequest(req));
      res.setHeader('Content-Type', 'text/html');
      res.end(spliceShell(template, body));
    } catch (err) {
      vite.ssrFixStacktrace?.(err as Error);
      sendError(res, err);
    }
  };

  const server = createHttpServer((req, res) => {
    vite.middlewares(req, res, () => handler(req, res));
  });
  server.listen(port, () => {
    console.log(`[purity-islands-blog-demo] dev server running at http://localhost:${port}`);
  });
}

async function startProd(): Promise<void> {
  const template = await readFile(resolve(__dirname, 'dist/client/index.html'), 'utf-8');
  const mod = (await import(resolve(__dirname, 'dist/server/entry.server.js'))) as {
    render: (request: Request) => Promise<string>;
  };
  const server = createHttpServer(async (req, res) => {
    try {
      const body = await mod.render(toRequest(req));
      res.setHeader('Content-Type', 'text/html');
      res.end(spliceShell(template, body));
    } catch (err) {
      sendError(res, err);
    }
  });
  server.listen(port, () => {
    console.log(`[purity-islands-blog-demo] prod server running at http://localhost:${port}`);
  });
}

if (isProd) await startProd();
else await startDev();
