import { matchRoute } from '@purityjs/core';
import { renderToString } from '@purityjs/ssr';
import { routes } from 'purity:routes';
import { App } from './app.ts';

export type RenderMode = 'static' | 'server' | 'client';

type PageModule = {
  renderMode?: RenderMode;
};

export async function routeFor(path: string): Promise<{
  pattern: string;
  mode: RenderMode;
} | null> {
  for (const route of routes) {
    if (!matchRoute(route.pattern, path)) continue;
    const page = (await route.importFn()) as PageModule;
    const mode = page.renderMode ?? 'server';
    if (mode !== 'static' && mode !== 'server' && mode !== 'client') {
      throw new Error(`Invalid renderMode for ${route.pattern}: ${String(mode)}`);
    }
    return { pattern: route.pattern, mode };
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
    const page = (await route.importFn()) as PageModule;
    const mode = page.renderMode ?? 'server';
    if (mode !== 'static' && mode !== 'server' && mode !== 'client') {
      throw new Error(`Invalid renderMode for ${route.pattern}: ${String(mode)}`);
    }
    if (mode !== 'static') continue;
    const dynamic = route.pattern.includes(':') || route.pattern.includes('*');
    result.push({ pattern: route.pattern, dynamic });
  }
  return result;
}

export async function render(request: Request): Promise<{ body: string; head: string }> {
  return renderToString(App, { request, extractHead: true });
}
