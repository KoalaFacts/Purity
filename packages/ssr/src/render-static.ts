// ---------------------------------------------------------------------------
// renderStatic — build-time driver for Static Site Generation. ADR 0010.
//
// Composes the existing `renderToString` + `getRequest()` primitives to
// render a list of routes to HTML strings. Filesystem I/O is intentionally
// out of scope — the caller writes the returned map to disk however they
// want, so this module stays runtime-agnostic (Node + Bun + Deno) and pulls
// no node:fs imports.
//
//   import { renderStatic } from '@purityjs/ssr';
//   import { writeFile, mkdir } from 'node:fs/promises';
//   import { dirname, join } from 'node:path';
//
//   const { files, errors } = await renderStatic({
//     routes: ['/', '/about', '/blog/hello-world'],
//     handler: (req) => () => App(),
//     shellTemplate: '<!doctype html><html><head>{{head}}</head>' +
//                    '<body><div id="app">{{body}}</div></body></html>',
//   });
//   for (const [route, html] of files) {
//     const out = join('dist', route === '/' ? 'index.html'
//       : `${route.replace(/^\//, '')}/index.html`);
//     await mkdir(dirname(out), { recursive: true });
//     await writeFile(out, html);
//   }
//   for (const [route, err] of errors) console.error('SSG', route, err);
// ---------------------------------------------------------------------------

import { renderToString, type RenderToStringOptions } from './render-to-string.ts';

/** A single static route. The path is the URL path; `request` lets the user
 * supply a fully-constructed `Request` (custom headers, method, etc.) instead
 * of letting `renderStatic` synthesize one from `baseUrl + path`. */
export interface RenderStaticRoute {
  path: string;
  request?: Request;
}

export interface RenderStaticOptions {
  /** Routes to render. Plain strings are converted to `{ path }`. */
  routes: ReadonlyArray<string | RenderStaticRoute>;
  /**
   * Resolves a `Request` to the component function the renderer should
   * call. The handler returns a thunk so the same shape is used by all
   * three entries (`renderToString` / `renderToStream` / `renderStatic`).
   * Typically the user uses `req.url`'s path segment to dispatch.
   */
  handler: (request: Request) => () => unknown;
  /**
   * Shell template with `{{body}}` and (optionally) `{{head}}` placeholders.
   * `{{body}}` is the rendered SSR HTML; `{{head}}` is the `head()`-
   * collected markup (omit `{{head}}` if you don't call `head()`).
   * If omitted, the rendered body is returned as the file content directly
   * (no shell) — useful when the user assembles the page themselves.
   */
  shellTemplate?: string;
  /** Doctype prefix passed through to `renderToString`. */
  doctype?: string;
  /** Base URL used to synthesize a `Request` per route. Default `'http://localhost'`. */
  baseUrl?: string;
  /**
   * Per-render options forwarded to `renderToString`. `extractHead` is
   * always set to `true` so `head()` works in SSG renders regardless of
   * what the caller supplies. `request` is supplied per-route and cannot
   * be overridden here.
   */
  renderOptions?: Omit<RenderToStringOptions, 'extractHead' | 'request'>;
  /**
   * Maximum number of routes to render concurrently. Default unbounded
   * (`Number.POSITIVE_INFINITY`). Set a finite cap when SSG'ing thousands
   * of routes to keep memory + fetch socket usage bounded.
   */
  concurrency?: number;
  /**
   * Receive each route's result as it completes. Useful for streaming the
   * output to disk one route at a time instead of buffering the full
   * `files` map. Called with the route path + the final HTML (already
   * spliced into `shellTemplate`).
   */
  onRoute?: (path: string, html: string) => void | Promise<void>;
}

export interface RenderStaticResult {
  /** Successful renders, keyed by route path. */
  files: Map<string, string>;
  /** Failed renders, keyed by route path. */
  errors: Map<string, unknown>;
  /**
   * Failures from the `onRoute` sink callback, keyed by route path. The
   * HTML for these routes is still present in `files` — only the
   * user-supplied side-effect (typically a disk write) threw. Kept
   * separate from `errors` so callers can distinguish render failures
   * from sink failures without double-bookkeeping.
   */
  onRouteErrors: Map<string, unknown>;
}

/**
 * Render a batch of routes to HTML strings. Composable build-time SSG —
 * no filesystem I/O, no node:fs dependency, runs on any runtime that
 * speaks `renderToString`.
 *
 * Each route gets its own `Request` (synthesized from `baseUrl + path`
 * by default, or supplied verbatim if the user provides one). The
 * `handler` resolves it to a component function, which `renderToString`
 * runs with `{ extractHead: true, request }` so `head()` calls during
 * the render populate the `{{head}}` placeholder.
 *
 * Errors are collected per-route rather than thrown — one route's
 * failure doesn't abort the batch. Check `result.errors.size === 0`
 * before publishing.
 *
 * @example
 * ```ts
 * const { files, errors } = await renderStatic({
 *   routes: ['/', '/about'],
 *   handler: (req) => () => App({ url: req.url }),
 *   shellTemplate:
 *     '<!doctype html><html><head>{{head}}</head>' +
 *     '<body><div id="app">{{body}}</div></body></html>',
 * });
 * ```
 */
export async function renderStatic(options: RenderStaticOptions): Promise<RenderStaticResult> {
  const baseUrl = options.baseUrl ?? 'http://localhost';
  // Validate `baseUrl` up-front so a malformed value (e.g. a path-only
  // string, missing scheme, embedded markup) fails the whole batch with
  // a clear error rather than producing N indistinguishable per-route
  // `TypeError: Invalid URL` entries in `errors`.
  try {
    // `new URL(baseUrl)` throws on non-absolute / scheme-less inputs.
    void new URL(baseUrl);
  } catch {
    throw new Error(
      `[Purity] renderStatic: invalid baseUrl ${JSON.stringify(baseUrl)}. ` +
        `Must be an absolute URL (e.g. 'http://localhost' or 'https://example.com').`,
    );
  }
  const shellTemplate = options.shellTemplate;
  // When a shell template is supplied, the doctype must live at the very
  // start of the final document — not embedded inside the `{{body}}`
  // splice. We strip it from the renderToString options and prepend it
  // around the spliced shell output instead. Callers who want the
  // doctype inline in their shell can keep `options.doctype` undefined
  // and write `<!doctype html>` directly into `shellTemplate`.
  const doctype = options.doctype;
  const innerDoctype = shellTemplate ? undefined : doctype;
  const renderOpts = options.renderOptions ?? {};
  const concurrency = options.concurrency ?? Number.POSITIVE_INFINITY;
  const onRoute = options.onRoute;

  const files = new Map<string, string>();
  const errors = new Map<string, unknown>();
  const onRouteErrors = new Map<string, unknown>();

  const normalised = options.routes.map((r) => (typeof r === 'string' ? { path: r } : r));

  const renderOne = async (route: RenderStaticRoute): Promise<void> => {
    // Reject paths that would let `baseUrl + path` escape the intended
    // origin or trick downstream filesystem writes (the file-header
    // example does `join('dist', route.replace(/^\//, ''), 'index.html')`,
    // which would happily resolve `'../../etc/passwd'`). The check runs
    // before `Request` construction so `onRoute` and `files`/`errors`
    // bookkeeping never see a hostile path.
    if (!isSafePath(route.path)) {
      errors.set(
        route.path,
        new Error(
          `[Purity] renderStatic: unsafe route path ${JSON.stringify(route.path)}. ` +
            `Paths must start with '/', contain no '..' segments, scheme, ` +
            `protocol-relative '//' prefix, or control characters.`,
        ),
      );
      return;
    }
    // Clone any user-supplied Request so the second/third call to
    // `renderStatic` (or a retry) doesn't see a consumed body. The
    // synthesized Request is fresh per render and needs no clone.
    const request = route.request ? route.request.clone() : new Request(baseUrl + route.path);
    let final: string;
    try {
      const component = options.handler(request);
      const out = await renderToString(component, {
        ...renderOpts,
        extractHead: true,
        request,
        doctype: innerDoctype,
      });
      final = shellTemplate
        ? (doctype ?? '') + applyShell(shellTemplate, out.body, out.head)
        : out.body;
      files.set(route.path, final);
    } catch (err) {
      errors.set(route.path, err);
      return;
    }
    // `onRoute` is the user's sink (typically disk write). Failures here
    // are *not* render failures — the HTML is already in `files`. Keep
    // them in a dedicated bucket so callers can distinguish "render
    // failed" from "sink failed" and avoid the bookkeeping ambiguity of
    // the same path appearing in both `files` and `errors`.
    if (onRoute) {
      try {
        await onRoute(route.path, final);
      } catch (err) {
        onRouteErrors.set(route.path, err);
      }
    }
  };

  if (!Number.isFinite(concurrency) || concurrency >= normalised.length) {
    await Promise.all(normalised.map(renderOne));
  } else {
    // Bounded concurrency. Pulls one route per worker and refills as each
    // resolves. Keeps memory bounded for sitemaps with thousands of routes.
    const cap = Math.max(1, Math.floor(concurrency));
    let i = 0;
    const workers = Array.from({ length: Math.min(cap, normalised.length) }, async () => {
      while (i < normalised.length) {
        const idx = i++;
        await renderOne(normalised[idx]);
      }
    });
    await Promise.all(workers);
  }

  return { files, errors, onRouteErrors };
}

/**
 * Reject route paths that would let `baseUrl + path` escape the intended
 * origin (`'//host'`, `'http://host'`), traverse out of the SSG output
 * directory (`'../etc'`), or carry control characters that would break
 * downstream tooling. Empty paths and paths not starting with `/` are
 * also rejected so the synthesized URL is always well-formed.
 */
function isSafePath(path: string): boolean {
  if (typeof path !== 'string' || path === '') return false;
  if (!path.startsWith('/')) return false;
  // Protocol-relative `//host/...` — `new Request(base + '//x')` would
  // resolve to `//x` against `base`, escaping the origin.
  if (path.startsWith('//')) return false;
  // ASCII control + DEL — CR/LF would let a hostile path inject
  // additional Request lines or break downstream filesystem tooling.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberate
  if (/[ -]/.test(path)) return false;
  // `..` as a path segment. Matches `/..`, `/../`, `/..?`, `/..#`.
  for (const seg of path.split(/[/?#]/)) {
    if (seg === '..') return false;
  }
  // Reject anything containing a `:` before the first `/` would be a
  // scheme (`'http:/...'` after the leading `/` strip). Since we already
  // required a leading `/`, a colon can still appear later (`/foo:bar`)
  // which is harmless for URL resolution against an absolute base — so
  // no further check here.
  return true;
}

/**
 * Splice rendered `body` + `head` into the shell template. `{{body}}` is
 * required; `{{head}}` is optional — if it's absent and `head` is
 * non-empty, the head markup is prepended to the body so it isn't lost.
 *
 * Both placeholders are replaced in a single pass via a function
 * replacer so that a `{{body}}` literal occurring inside the rendered
 * `head` markup (e.g. a user-controlled `<meta>` content) is *not*
 * subsequently expanded as a placeholder, and vice versa. The function
 * replacer also sidesteps `String.prototype.replace`'s `$&` / `$1`
 * substitution magic that would otherwise apply to a string replacement.
 */
function applyShell(template: string, body: string, head: string): string {
  const hasHeadPlaceholder = template.includes('{{head}}');
  const prefix = !hasHeadPlaceholder && head ? head : '';
  const out = (prefix + template).replace(/\{\{(head|body)\}\}/g, (_, key) =>
    key === 'head' ? head : body,
  );
  return out;
}
