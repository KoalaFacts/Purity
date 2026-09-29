import { matchRoute } from '@purityjs/core';
import { renderToStreamResponse, renderToString, type RenderToStreamResponse } from '@purityjs/ssr';
import { routes } from 'purity:routes';
import { App } from './app.ts';

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

export async function renderStream(request: Request): Promise<RenderToStreamResponse | Response> {
  try {
    return await renderToStreamResponse(App, { request, signal: request.signal });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
