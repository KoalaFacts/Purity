import { matchRoute } from '@purityjs/core';
import { renderToString } from '@purityjs/ssr';
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

export async function render(request: Request): Promise<{ body: string; head: string }> {
  return renderToString(App, { request, extractHead: true });
}
