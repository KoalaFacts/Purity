import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type RouteInfo = { pattern: string; mode: 'static' | 'server' | 'client' } | null;
type ServerEntry = {
  routeFor: (path: string) => Promise<RouteInfo>;
  render: (request: Request) => Promise<{ body: string; head: string }>;
};

const root = dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3000);
const contentTypes: Record<string, string> = {
  '.css': 'text/css',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mjs': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function shell(template: string, body: string, head: string): string {
  return template.split('<!--head-outlet-->').join(head).split('<!--ssr-outlet-->').join(body);
}

function send(
  res: ServerResponse,
  status: number,
  type: string,
  body: string | Buffer,
  head: boolean,
): void {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.end(head ? undefined : body);
}

function requestFor(msg: IncomingMessage): Request {
  const host = msg.headers.host ?? 'localhost';
  const url = new URL(msg.url ?? '/', `http://${host}`);
  return new Request(url, { method: msg.method ?? 'GET', headers: msg.headers as HeadersInit });
}

async function start(): Promise<void> {
  let template = '';
  let entry: ServerEntry | undefined;
  let staticPaths: Set<string>;
  let clientDir: string;
  let vite: Awaited<ReturnType<(typeof import('vite'))['createServer']>> | undefined;
  if (production) {
    clientDir = resolve(root, 'client');
    template = await readFile(resolve(root, 'template.html'), 'utf8');
    entry = (await import(
      pathToFileURL(resolve(root, 'server/entry.server.js')).href
    )) as ServerEntry;
    staticPaths = new Set(
      JSON.parse(await readFile(resolve(root, 'static-routes.json'), 'utf8')) as string[],
    );
  } else {
    clientDir = root;
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({ server: { middlewareMode: true }, appType: 'custom' });
    staticPaths = new Set();
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const head = req.method === 'HEAD';
    if (req.method !== 'GET' && !head) {
      send(res, 405, 'text/plain; charset=utf-8', 'Method Not Allowed', head);
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      send(res, 400, 'text/plain; charset=utf-8', 'Bad Request', head);
      return;
    }
    const currentTemplate = vite
      ? await vite.transformIndexHtml(
          req.url ?? '/',
          await readFile(resolve(root, 'index.html'), 'utf8'),
        )
      : template;
    const currentEntry = vite
      ? ((await vite.ssrLoadModule('/src/entry.server.ts')) as ServerEntry)
      : entry;
    if (!currentEntry) throw new Error('Server entry is unavailable');
    if (production) {
      const asset = resolve(clientDir, '.' + pathname);
      const rel = relative(clientDir, asset);
      if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
        send(res, 400, 'text/plain; charset=utf-8', 'Bad Request', head);
        return;
      }
      if (rel && (pathname.startsWith('/assets/') || extname(pathname))) {
        const info = await stat(asset).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
          throw error;
        });
        if (info?.isFile()) {
          const type = contentTypes[extname(asset)] ?? 'application/octet-stream';
          send(res, 200, type, head ? '' : await readFile(asset), head);
          return;
        }
        if (pathname.startsWith('/assets/')) {
          send(res, 404, 'text/plain; charset=utf-8', 'Not Found', head);
          return;
        }
      }
    }
    if (production) {
      const key = pathname === '/' ? '/' : pathname.replace(/\/$/, '');
      if (staticPaths.has(key)) {
        const file =
          key === '/'
            ? resolve(clientDir, 'index.html')
            : resolve(clientDir, '.' + key, 'index.html');
        send(res, 200, 'text/html; charset=utf-8', head ? '' : await readFile(file), head);
        return;
      }
    }
    const route = await currentEntry.routeFor(pathname);
    if (route?.mode === 'static' && production) {
      send(res, 404, 'text/plain; charset=utf-8', 'Not Found', head);
      return;
    }
    if (route?.mode === 'client') {
      send(res, 200, 'text/html; charset=utf-8', shell(currentTemplate, '', ''), head);
      return;
    }
    const status = !route ? 404 : 200;
    const result = await currentEntry.render(requestFor(req));
    send(
      res,
      status,
      'text/html; charset=utf-8',
      shell(currentTemplate, result.body, result.head),
      head,
    );
  }

  createServer((req, res) => {
    const run = () => {
      void handle(req, res).catch((error: unknown) => {
        console.error(error);
        if (!res.headersSent)
          send(
            res,
            500,
            'text/plain; charset=utf-8',
            'Internal Server Error',
            req.method === 'HEAD',
          );
        else res.end();
      });
    };
    if (vite) vite.middlewares(req, res, run);
    else run();
  }).listen(port, () => console.log(`Purity app listening on http://localhost:${port}`));
}

await start();
