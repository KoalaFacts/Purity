import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

type RouteInfo = { pattern: string; mode: 'static' | 'server' | 'client' } | null;
type ServerEntry = {
  routeFor: (path: string) => Promise<RouteInfo>;
  render: (
    request: Request,
  ) => Promise<{ body: string; head: string; status?: number; headers?: Headers } | Response>;
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
  headers?: Headers,
): void {
  res.statusCode = status;
  if (headers) copyHeaders(res, headers);
  res.setHeader('Content-Type', type);
  res.end(head ? undefined : body);
}

function copyHeaders(res: ServerResponse, headers: Headers): void {
  headers.forEach((value, key) => {
    // The rendered HTML body and Node transport determine these fields.
    if (
      key !== 'set-cookie' &&
      key !== 'content-type' &&
      key !== 'content-length' &&
      key !== 'transfer-encoding'
    )
      res.setHeader(key, value);
  });
  const cookies = headers.getSetCookie();
  if (cookies.length > 0) res.setHeader('Set-Cookie', cookies);
}

async function sendWebResponse(
  res: ServerResponse,
  response: Response,
  head: boolean,
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie' && key !== 'content-length' && key !== 'transfer-encoding') {
      res.setHeader(key, value);
    }
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader('Set-Cookie', cookies);
  if (head || !response.body) {
    if (response.body) await response.body.cancel();
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), res);
}

function requestFor(msg: IncomingMessage): Request {
  const trustedProxy = process.env.TRUST_PROXY === '1';
  const firstHeader = (value: string | string[] | undefined): string | undefined =>
    (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim();
  const forwardedProto = trustedProxy ? firstHeader(msg.headers['x-forwarded-proto']) : undefined;
  const forwardedHost = trustedProxy ? firstHeader(msg.headers['x-forwarded-host']) : undefined;
  const protocol = forwardedProto === 'https' ? 'https' : 'http';
  const host = forwardedHost || msg.headers.host || 'localhost';
  const origin = process.env.PUBLIC_ORIGIN || `${protocol}://${host}`;
  const url = new URL(msg.url ?? '/', origin);
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
    let rawPathname: string;
    let filePathname: string;
    try {
      const rawUrl = req.url ?? '/';
      if (!rawUrl.startsWith('/') || rawUrl.startsWith('//')) throw new URIError('Invalid path');
      rawPathname = new URL(rawUrl, 'http://localhost').pathname;
      filePathname = decodeURIComponent(rawPathname);
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
      const asset = resolve(clientDir, '.' + filePathname);
      const rel = relative(clientDir, asset);
      if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
        send(res, 400, 'text/plain; charset=utf-8', 'Bad Request', head);
        return;
      }
      if (rel) {
        const info = await stat(asset).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
          throw error;
        });
        if (info?.isFile()) {
          const type = contentTypes[extname(asset)] ?? 'application/octet-stream';
          send(res, 200, type, head ? '' : await readFile(asset), head);
          return;
        }
      }
    }
    if (production) {
      const key = rawPathname === '/' ? '/' : rawPathname.replace(/\/$/, '');
      if (staticPaths.has(key)) {
        const file =
          key === '/'
            ? resolve(clientDir, 'index.html')
            : resolve(clientDir, '.' + key, 'index.html');
        send(res, 200, 'text/html; charset=utf-8', head ? '' : await readFile(file), head);
        return;
      }
    }
    const route = await currentEntry.routeFor(rawPathname);
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
    if (result instanceof Response) {
      await sendWebResponse(res, result, head);
      return;
    }
    send(
      res,
      result.status ?? status,
      'text/html; charset=utf-8',
      shell(currentTemplate, result.body, result.head),
      head,
      result.headers,
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
