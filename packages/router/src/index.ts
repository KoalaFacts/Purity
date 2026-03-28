import type { ComputedAccessor, StateAccessor } from '@purity/core';
import { compute, state, watch } from '@purity/core';

// ---------------------------------------------------------------------------
// Router — minimal, signal-based SPA router
//
//   import { router, route, link } from '@purity/router';
//
//   const { path, query, hash, push, replace, back } = router();
//
//   html`${route({
//     '/':           () => html`<p-home></p-home>`,
//     '/user/:id':   ({ id }) => html`<p-user :id=${id}></p-user>`,
//     '*':           () => html`<p-404></p-404>`,
//   })}`;
// ---------------------------------------------------------------------------

export interface RouteParams {
  [key: string]: string;
}

export interface RouterInstance {
  path: ComputedAccessor<string>;
  hash: ComputedAccessor<string>;
  query: ComputedAccessor<URLSearchParams>;
  params: StateAccessor<RouteParams>;
  push: (url: string) => void;
  replace: (url: string) => void;
  back: () => void;
  forward: () => void;
}

// Singleton state
const _url = state(location.href);

function syncFromLocation(): void {
  _url(location.href);
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', syncFromLocation);
}

const _path = compute(() => new URL(_url()).pathname);
const _hash = compute(() => new URL(_url()).hash);
const _query = compute(() => new URL(_url()).searchParams);
const _currentParams = state<RouteParams>({});

function push(url: string): void {
  history.pushState(null, '', url);
  _url(location.href);
}

function replace(url: string): void {
  history.replaceState(null, '', url);
  _url(location.href);
}

function back(): void {
  history.back();
}

function forward(): void {
  history.forward();
}

export function router(): RouterInstance {
  return {
    path: _path,
    hash: _hash,
    query: _query,
    params: _currentParams,
    push,
    replace,
    back,
    forward,
  };
}

// ---------------------------------------------------------------------------
// route(routes) — declarative route matching
// ---------------------------------------------------------------------------

type RouteView = (params: RouteParams) => Node | DocumentFragment;
type RouteMap = Record<string, RouteView>;

interface CompiledRoute {
  pattern: string;
  regex: RegExp;
  paramNames: string[];
  view: RouteView;
}

function compileRoutes(routes: RouteMap): CompiledRoute[] {
  return Object.entries(routes).map(([pattern, view]) => {
    if (pattern === '*') {
      return { pattern, regex: /.*/, paramNames: [], view };
    }

    const paramNames: string[] = [];
    const regexStr = pattern
      .replace(/:([a-zA-Z_]\w*)/g, (_m, name) => {
        paramNames.push(name);
        return '([^/]+)';
      })
      .replace(/\*/g, '.*');

    return {
      pattern,
      regex: new RegExp(`^${regexStr}$`),
      paramNames,
      view,
    };
  });
}

export function route(routes: RouteMap): DocumentFragment {
  const compiled = compileRoutes(routes);

  const startMarker = document.createComment('route-start');
  const endMarker = document.createComment('route-end');

  const fragment = document.createDocumentFragment();
  fragment.appendChild(startMarker);
  fragment.appendChild(endMarker);

  let currentNodes: Node[] = [];
  let currentPattern = '';

  watch(() => {
    const currentPath = _path();

    let matched: CompiledRoute | null = null;
    let params: RouteParams = {};

    for (const r of compiled) {
      const match = currentPath.match(r.regex);
      if (match) {
        matched = r;
        params = {};
        for (let i = 0; i < r.paramNames.length; i++) {
          params[r.paramNames[i]] = decodeURIComponent(match[i + 1]);
        }
        break;
      }
    }

    const patternKey = matched ? `${matched.pattern}:${JSON.stringify(params)}` : '';
    if (patternKey === currentPattern) return;
    currentPattern = patternKey;

    _currentParams(params);

    for (const node of currentNodes) {
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    currentNodes = [];

    const parent = endMarker.parentNode;
    if (!parent || !matched) return;

    const content = matched.view(params);
    if (content instanceof DocumentFragment) {
      currentNodes = Array.from(content.childNodes);
      parent.insertBefore(content, endMarker);
    } else if (content instanceof Node) {
      currentNodes = [content];
      parent.insertBefore(content, endMarker);
    }
  });

  return fragment;
}

// ---------------------------------------------------------------------------
// link(href) — navigate via push
// ---------------------------------------------------------------------------

export function link(href: string): (e: Event) => void {
  return (e: Event) => {
    e.preventDefault();
    push(href);
  };
}
