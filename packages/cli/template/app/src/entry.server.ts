import { handleAction, matchRoute } from '@purityjs/core';
import { renderToStreamResponse, renderToString, type RenderToStreamResponse } from '@purityjs/ssr';
import { routes } from 'purity:routes';
import { App } from './app.ts';

// Register every action before the first request, including direct POSTs.
const actionModules = import.meta.glob<Record<string, unknown>>('./actions/**/*.server.ts', {
  eager: true,
});
const actionUrls = new Set<string>();
for (const module of Object.values(actionModules)) {
  for (const value of Object.values(module)) {
    if (
      value &&
      typeof value === 'object' &&
      'url' in value &&
      typeof value.url === 'string' &&
      'handler' in value &&
      typeof value.handler === 'function'
    ) {
      actionUrls.add(value.url);
    }
  }
}

export async function dispatchAction(request: Request): Promise<Response | null> {
  // The core registry survives Vite reloads; only dispatch currently exported
  // actions so deleting or renaming a module also removes its old endpoint.
  if (!actionUrls.has(new URL(request.url).pathname)) return null;
  return handleAction(request);
}

export type RenderMode = 'static' | 'server' | 'client';

function modeFor(route: { pattern: string; renderMode?: RenderMode }): RenderMode {
  return route.renderMode ?? 'server';
}

export async function routeFor(path: string): Promise<{
  pattern: string;
  mode: RenderMode;
} | null> {
  for (const route of routes) {
    if (!matchRoute(route.pattern, path)) continue;
    return { pattern: route.pattern, mode: modeFor(route) };
  }
  return null;
}

export async function staticRoutes(): Promise<
  Array<{
    pattern: string;
    dynamic: boolean;
  }>
> {
  const result: Array<{ pattern: string; dynamic: boolean }> = [];
  for (const route of routes) {
    if (modeFor(route) !== 'static') continue;
    const dynamic = route.pattern.includes(':') || route.pattern.includes('*');
    result.push({ pattern: route.pattern, dynamic });
  }
  return result;
}

export async function render(
  request: Request,
): Promise<{ body: string; head: string; status?: number; headers?: Headers } | Response> {
  try {
    return await renderToString(App, { request, extractHead: true });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

export async function renderStream(
  request: Request,
  nonce: string,
): Promise<RenderToStreamResponse | Response> {
  try {
    return await renderToStreamResponse(App, { request, signal: request.signal, nonce });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
