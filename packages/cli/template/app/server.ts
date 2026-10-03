import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

type RouteInfo = { pattern: string; mode: 'static' | 'server' | 'client' } | null;
type ServerEntry = {
  dispatchAction: (request: Request) => Promise<Response | null>;
  routeFor: (path: string) => Promise<RouteInfo>;
  renderStream: (
    request: Request,
    nonce: string,
  ) => Promise<
    | { body: ReadableStream<Uint8Array>; head: string; status?: number; headers?: Headers }
    | Response
  >;
};

const root = dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3000);
const maxActionBodyBytes = Number(process.env.MAX_ACTION_BODY_BYTES ?? 1_048_576);
if (!Number.isSafeInteger(maxActionBodyBytes) || maxActionBodyBytes <= 0) {
  throw new Error('MAX_ACTION_BODY_BYTES must be a positive safe integer');
}
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

async function sendStreamedHtml(
  res: ServerResponse,
  template: string,
  result: { body: ReadableStream<Uint8Array>; head: string; status?: number; headers?: Headers },
  status: number,
  head: boolean,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    await result.body.cancel();
    signal.throwIfAborted();
  }
  const marker = '<!--ssr-outlet-->';
  const outlet = template.indexOf(marker);
  if (outlet < 0) throw new Error('HTML template is missing the SSR outlet');
  const prefix = template.slice(0, outlet).split('<!--head-outlet-->').join(result.head);
  const suffix = template
    .slice(outlet + marker.length)
    .split('<!--head-outlet-->')
    .join(result.head);
  res.statusCode = result.status ?? status;
  if (result.headers) copyHeaders(res, result.headers);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (head) {
    await result.body.cancel();
    signal.throwIfAborted();
    res.end();
    return;
  }
  const body = Readable.fromWeb(result.body as Parameters<typeof Readable.fromWeb>[0]);
  async function* chunks(): AsyncGenerator<string | Uint8Array> {
    yield prefix;
    yield* body;
    yield suffix;
  }
  try {
    await pipeline(Readable.from(chunks()), res, { signal });
  } finally {
    // Also cancel a body whose iterator never started before a disconnect.
    body.destroy();
  }
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
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    await response.body?.cancel();
    signal.throwIfAborted();
  }
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
    signal.throwIfAborted();
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), res, {
    signal,
  });
}

function requestFor(
  msg: IncomingMessage,
  signal: AbortSignal,
  nonce: string,
  body?: Uint8Array<ArrayBuffer>,
): Request {
  const trustedProxy = process.env.TRUST_PROXY === '1';
  const firstHeader = (value: string | string[] | undefined): string | undefined =>
    (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim();
  const forwardedProto = trustedProxy ? firstHeader(msg.headers['x-forwarded-proto']) : undefined;
  const forwardedHost = trustedProxy ? firstHeader(msg.headers['x-forwarded-host']) : undefined;
  const protocol = forwardedProto === 'https' ? 'https' : 'http';
  const host = forwardedHost || msg.headers.host || 'localhost';
  const origin = process.env.PUBLIC_ORIGIN || `${protocol}://${host}`;
  const base = new URL(origin);
  const url = new URL(msg.url ?? '/', base);
  if (url.origin !== base.origin) throw new URIError('Invalid request origin');
  const headers = new Headers(msg.headers as HeadersInit);
  // Replace any client-supplied value with the nonce used by this render.
  // Loaders can read it when constructing their own strict CSP policy.
  headers.set('X-Purity-CSP-Nonce', nonce);
  return new Request(url, {
    method: msg.method ?? 'GET',
    headers,
    signal,
    body,
  });
}

async function readActionBody(req: IncomingMessage): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(req.headers['content-length']) > maxActionBodyBytes) {
    req.resume();
    return null;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  // Keep the socket open on an early exit so the client can receive HTTP 413.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxActionBodyBytes) {
      req.resume();
      return null;
    }
    chunks.push(buffer);
  }
  return new Uint8Array(Buffer.concat(chunks, bytes));
}

async function start(): Promise<void> {
  let template = '';
  let entry: ServerEntry | undefined;
  let staticPaths: Set<string>;
  let clientDir: string;
  let realClientDir = '';
  let vite: Awaited<ReturnType<(typeof import('vite'))['createServer']>> | undefined;
  if (production) {
    clientDir = resolve(root, 'client');
    realClientDir = await realpath(clientDir);
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

  async function publicFile(candidate: string): Promise<string | null | false> {
    const file = await realpath(candidate).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
      throw error;
    });
    if (!file) return null;
    // Lexical containment does not stop a symlink/junction from exposing server files.
    const rel = relative(realClientDir, file);
    if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) return false;
    return file;
  }

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const head = req.method === 'HEAD';
    const actionMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? '');
    if (req.method !== 'GET' && !head && !actionMethod) {
      req.resume();
      res.setHeader('Allow', 'GET, HEAD, POST, PUT, PATCH, DELETE');
      send(res, 405, 'text/plain; charset=utf-8', 'Method Not Allowed', head);
      return;
    }
    let rawPathname: string;
    let filePathname: string;
    try {
      const rawUrl = req.url ?? '/';
      if (!rawUrl.startsWith('/') || rawUrl.startsWith('//') || rawUrl.includes('\\'))
        throw new URIError('Invalid path');
      rawPathname = new URL(rawUrl, 'http://localhost').pathname;
      filePathname = decodeURIComponent(rawPathname);
    } catch {
      send(res, 400, 'text/plain; charset=utf-8', 'Bad Request', head);
      return;
    }
    const currentEntry = vite
      ? ((await vite.ssrLoadModule('/src/entry.server.ts')) as ServerEntry)
      : entry;
    signal.throwIfAborted();
    if (!currentEntry) throw new Error('Server entry is unavailable');
    if (actionMethod) {
      const nonce = randomBytes(16).toString('base64');
      const request = requestFor(req, signal, nonce);
      // Browser submissions must come from this origin. Non-browser clients
      // also supply Origin; authentication belongs in the action handler.
      if (request.headers.get('origin') !== new URL(request.url).origin) {
        req.resume();
        send(res, 403, 'text/plain; charset=utf-8', 'Forbidden request origin', false);
        return;
      }
      const body = await readActionBody(req);
      signal.throwIfAborted();
      if (body === null) {
        send(res, 413, 'text/plain; charset=utf-8', 'Request body too large', false);
        return;
      }
      const response = await currentEntry.dispatchAction(requestFor(req, signal, nonce, body));
      if (response) await sendWebResponse(res, response, false, signal);
      else {
        signal.throwIfAborted();
        send(res, 404, 'text/plain; charset=utf-8', 'Action Not Found', false);
      }
      return;
    }
    const currentTemplate = vite
      ? await vite.transformIndexHtml(
          req.url ?? '/',
          await readFile(resolve(root, 'index.html'), 'utf8'),
        )
      : template;
    signal.throwIfAborted();
    if (production) {
      const asset = resolve(clientDir, '.' + filePathname);
      const rel = relative(clientDir, asset);
      if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
        send(res, 400, 'text/plain; charset=utf-8', 'Bad Request', head);
        return;
      }
      if (rel) {
        const file = await publicFile(asset);
        if (file === false) {
          send(res, 400, 'text/plain; charset=utf-8', 'Bad Request', head);
          return;
        }
        const info = file
          ? await stat(file).catch((error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
              throw error;
            })
          : null;
        if (info?.isFile()) {
          const type = contentTypes[extname(asset)] ?? 'application/octet-stream';
          send(res, 200, type, head ? '' : await readFile(file as string), head);
          return;
        }
      }
    }
    if (production) {
      const key = rawPathname === '/' ? '/' : rawPathname.replace(/\/$/, '');
      if (staticPaths.has(key)) {
        const candidate =
          key === '/'
            ? resolve(clientDir, 'index.html')
            : resolve(clientDir, '.' + key, 'index.html');
        const file = await publicFile(candidate);
        if (!file) {
          send(res, file === false ? 400 : 404, 'text/plain; charset=utf-8', 'Not Found', head);
          return;
        }
        send(res, 200, 'text/html; charset=utf-8', head ? '' : await readFile(file), head);
        return;
      }
    }
    const route = await currentEntry.routeFor(rawPathname);
    signal.throwIfAborted();
    if (route?.mode === 'static' && production) {
      send(res, 404, 'text/plain; charset=utf-8', 'Not Found', head);
      return;
    }
    if (route?.mode === 'client') {
      send(res, 200, 'text/html; charset=utf-8', shell(currentTemplate, '', ''), head);
      return;
    }
    const status = !route ? 404 : 200;
    const nonce = randomBytes(16).toString('base64');
    const result = await currentEntry.renderStream(requestFor(req, signal, nonce), nonce);
    if (result instanceof Response) {
      await sendWebResponse(res, result, head, signal);
      return;
    }
    await sendStreamedHtml(res, currentTemplate, result, status, head, signal);
  }

  createServer((req, res) => {
    // Install before Vite middleware, module loading, or route lookup can await.
    const abort = new AbortController();
    const cleanup = () => {
      req.off('close', onRequestClose);
      res.off('close', onResponseClose);
      res.off('finish', cleanup);
    };
    const onRequestClose = () => {
      // IncomingMessage close also fires for a fully received GET or POST.
      // Only an incomplete upload is cancellation; the response owns GET lifetime.
      if (!req.complete) abort.abort();
    };
    const onResponseClose = () => {
      if (!res.writableFinished) abort.abort();
      cleanup();
    };
    req.once('close', onRequestClose);
    res.once('close', onResponseClose);
    res.once('finish', cleanup);
    const run = () => {
      void handle(req, res, abort.signal).catch((error: unknown) => {
        // Suppress expected disconnect errors while preserving real stream
        // failures, even when pipeline() has already destroyed the response.
        const code = (error as NodeJS.ErrnoException)?.code;
        if (
          (abort.signal.aborted || res.destroyed) &&
          (error === abort.signal.reason ||
            code === 'ERR_STREAM_PREMATURE_CLOSE' ||
            code === 'ECONNRESET' ||
            code === 'ABORT_ERR' ||
            (error as Error)?.name === 'AbortError')
        )
          return;
        console.error(error);
        if (res.destroyed) return;
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
