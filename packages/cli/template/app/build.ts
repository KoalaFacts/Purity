import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { staticPaths as staticPathEntries } from './src/static-paths.ts';

type ServerEntry = typeof import('./src/entry.server.ts');
const root = import.meta.dirname;
const clientDir = resolve(root, 'dist/client');
const template = await readFile(resolve(clientDir, 'index.html'), 'utf8');
const entry = (await import(
  pathToFileURL(resolve(root, 'dist/server/entry.server.js')).href
)) as ServerEntry;

function normalize(path: string): string {
  if (typeof path !== 'string' || !/^\/[A-Za-z0-9._~/-]*$/.test(path) || path.startsWith('//')) {
    throw new Error(`Unsafe static path: ${String(path)}`);
  }
  const segments = path.split('/');
  if (segments.some((part) => part === '.' || part === '..') || path.includes('//')) {
    throw new Error(`Unsafe static path: ${path}`);
  }
  return path === '/' ? '/' : path.replace(/\/$/, '');
}

const staticPaths = new Set<string>();
const planned: string[] = [];
const routes = await entry.staticRoutes();
for (const pattern of Object.keys(staticPathEntries)) {
  if (!routes.some((route) => route.pattern === pattern && route.dynamic)) {
    throw new Error(`No dynamic static route matches ${pattern} in src/static-paths.ts`);
  }
}
for (const route of routes) {
  const entries = staticPathEntries[route.pattern];
  if (route.dynamic && !entries) {
    throw new Error(`Static dynamic route ${route.pattern} needs an entry in src/static-paths.ts`);
  }
  if (!route.dynamic && entries) {
    throw new Error(`Only dynamic static routes belong in src/static-paths.ts: ${route.pattern}`);
  }
  const paths = entries ? await entries() : [route.pattern];
  if (!Array.isArray(paths)) {
    throw new Error(`Static paths for ${route.pattern} must be an array`);
  }
  for (const candidate of paths) {
    const path = normalize(candidate);
    const resolved = await entry.routeFor(path);
    if (resolved?.pattern !== route.pattern || resolved.mode !== 'static') {
      throw new Error(`Static path ${path} does not resolve to ${route.pattern}`);
    }
    if (staticPaths.has(path)) throw new Error(`Duplicate static path: ${path}`);
    staticPaths.add(path);
    planned.push(path);
  }
}

await writeFile(resolve(root, 'dist/template.html'), template);
await writeFile(resolve(root, 'dist/static-routes.json'), JSON.stringify(planned));
for (const path of planned) {
  const rendered = await entry.render(new Request(`http://localhost${path}`));
  if (rendered instanceof Response) {
    throw new Error(
      `Static route ${path} returned a Response (${rendered.status}); use server mode for request-time responses`,
    );
  }
  if (rendered.status !== undefined && rendered.status !== 200) {
    throw new Error(
      `Static route ${path} rendered with status ${rendered.status}; static pages must return 200`,
    );
  }
  if (rendered.headers && [...rendered.headers].length > 0) {
    throw new Error(
      `Static route ${path} set response headers; use server mode for request-time headers`,
    );
  }
  const { body, head } = rendered;
  const html = template
    .split('<!--head-outlet-->')
    .join(head)
    .split('<!--ssr-outlet-->')
    .join(body);
  const file =
    path === '/' ? resolve(clientDir, 'index.html') : resolve(clientDir, '.' + path, 'index.html');
  if (!file.startsWith(clientDir + sep) && file !== resolve(clientDir, 'index.html')) {
    throw new Error(`Static output escapes client directory: ${path}`);
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
  console.log(`Generated ${path}`);
}
