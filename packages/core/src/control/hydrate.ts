// ---------------------------------------------------------------------------
// Control-Flow Hydration Adoption (each / virtualEach / match / when)
//
// Loaded only when DOM hydration is active (via `hydrate()` or `./runtime`),
// keeping CSR bundles 100% free of SSR marker parsers (`parseSSRRows`,
// `parseSSRMatchBoundary`) and keeping non-control hydration bundles 100%
// free of `control.ts` (`lis`, `reconcileEach`, `list`).
// ---------------------------------------------------------------------------

import { getCurrentContext, popContext, pushContext, state } from '@purityjs/signals';
import type {
  EachEntry,
  EachHydrationAdapter,
  EachState,
  MatchCases,
  MatchHydrationAdapter,
  MatchState,
  MatchView,
} from '../control.ts';
import { setEachHydrationHook, setMatchHydrationHook } from '../hooks.ts';
import { detachNodes, extractNodes } from './nodes.ts';
import {
  type DeferredTemplate,
  enterHydration,
  exitHydration,
  inflateDeferred,
  isDeferred,
  setInflateDeferredEach,
  setInflateDeferredMatch,
} from '../runtime/hydrate-runtime.ts';

function decodeRowKey(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

type SSRRow = Node[];

function parseSSRRows(contNodes: Node[]): {
  rows: SSRRow[];
  boundaryNodes: Node[];
  rowsByKey: Map<string, SSRRow>;
} {
  const rows: SSRRow[] = [];
  const boundaryNodes: Node[] = [];
  const rowsByKey = new Map<string, SSRRow>();
  let i = 0;
  const len = contNodes.length;
  while (i < len) {
    const node = contNodes[i];
    const startMatch = node.nodeType === 8 && /^er:(.*)$/.exec((node as Comment).data);
    if (!startMatch) {
      boundaryNodes.push(node);
      i++;
      continue;
    }
    const key = decodeRowKey(startMatch[1]);
    boundaryNodes.push(node);
    i++;
    const rowNodes: Node[] = [];
    let closed = false;
    while (i < len) {
      const inner = contNodes[i];
      if (inner.nodeType === 8 && (inner as Comment).data === '/er') {
        boundaryNodes.push(inner);
        i++;
        closed = true;
        break;
      }
      rowNodes.push(inner);
      i++;
    }
    if (closed) {
      rows.push(rowNodes);
      rowsByKey.set(key, rowNodes);
    } else {
      for (let k = 0; k < rowNodes.length; k++) boundaryNodes.push(rowNodes[k]);
    }
  }
  return { rows, boundaryNodes, rowsByKey };
}

export interface CapturedDeferredEach<T = unknown> {
  __purity_deferred_each__: true;
  listAccessor: (() => T[]) | T[];
  mapFn: (item: () => T, index: number) => Node | DocumentFragment | string;
  keyFn?: (item: T, index: number) => unknown;
  adapter: EachHydrationAdapter<T>;
}

export function inflateDeferredEach<T>(
  deferred: CapturedDeferredEach<T>,
  contNodes: Node[],
  closeMarker: Node,
): void {
  const parent = closeMarker.parentNode;
  /* v8 ignore next */
  if (!parent) return;

  const { listAccessor, mapFn, keyFn, adapter } = deferred;
  const getList =
    typeof listAccessor === 'function' ? (listAccessor as () => T[]) : () => listAccessor;
  const getKey = keyFn ?? ((item: T, _i: number) => item as unknown);

  const endMarker = document.createComment('e');
  parent.insertBefore(endMarker, closeMarker);

  const { rows: ssrRows, boundaryNodes, rowsByKey: ssrByKey } = parseSSRRows(contNodes);
  detachNodes(boundaryNodes);

  const ownerCtx = getCurrentContext();
  const items = getList() || [];
  const eachState: EachState<T> = { keyToEntry: new Map() };

  try {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const key = getKey(item, i);
      if (eachState.keyToEntry.has(key)) {
        adapter.warnDuplicateKey(key, i);
        continue;
      }

      const ssrRow = ssrByKey.get(String(key));
      if (ssrRow) {
        ssrByKey.delete(String(key));
      }
      const data = state(item);
      const entry: EachEntry<T> = { nodes: [], data, disposers: null };
      eachState.keyToEntry.set(key, entry);
      pushContext(entry);
      try {
        enterHydration();
        let content: Node | DocumentFragment | string | DeferredTemplate;
        try {
          content = mapFn(data, i) as Node | DocumentFragment | string | DeferredTemplate;
        } finally {
          exitHydration();
        }

        let nodes: Node[];
        if (isDeferred(content)) {
          const frag = document.createDocumentFragment();
          if (ssrRow) {
            for (let j = 0; j < ssrRow.length; j++) frag.appendChild(ssrRow[j]);
          }
          inflateDeferred(content as DeferredTemplate, frag, false, !ssrRow);
          nodes = Array.from(frag.childNodes);
          parent.insertBefore(frag, endMarker);
        } else {
          if (ssrRow) detachNodes(ssrRow);
          nodes = extractNodes(content as Node | DocumentFragment | string);
          parent.insertBefore(content instanceof Node ? content : nodes[0], endMarker);
        }

        entry.nodes = nodes;
        adapter.track(entry);
        // The row is now adopted or its old nodes have been detached. Clearing
        // its private snapshot leaves duplicate-key and unadopted rows intact
        // for the cleanup pass without a separate set of adopted rows.
        if (ssrRow) ssrRow.length = 0;
      } finally {
        popContext();
      }
    }

    for (let i = 0; i < ssrRows.length; i++) {
      const row = ssrRows[i];
      detachNodes(row);
    }

    adapter.finish(ownerCtx, eachState, getList, mapFn, getKey, parent, endMarker);
  } catch (error) {
    for (const entry of eachState.keyToEntry.values()) adapter.release(entry);
    eachState.keyToEntry.clear();
    throw error;
  }
}

interface SSRMatchBoundary {
  key: string | null;
  inner: Node[];
  boundaryNodes: Node[];
}

function parseSSRMatchBoundary(contNodes: Node[]): SSRMatchBoundary {
  let key: string | null = null;
  const inner: Node[] = [];
  const boundaryNodes: Node[] = [];

  let i = 0;
  while (i < contNodes.length) {
    const n = contNodes[i];
    if (n.nodeType === 8) {
      const data = (n as Comment).data;
      const m = /^m:(.*)$/.exec(data);
      if (m) {
        key = decodeRowKey(m[1]);
        boundaryNodes.push(n);
        i++;
        break;
      }
      if (data === 'm') {
        boundaryNodes.push(n);
        i++;
        break;
      }
    }
    boundaryNodes.push(n);
    i++;
  }

  let depth = 1;
  while (i < contNodes.length) {
    const n = contNodes[i];
    if (n.nodeType === 8) {
      const data = (n as Comment).data;
      if (data === 'm' || data.startsWith('m:')) depth++;
      else if (data === '/m' && --depth === 0) {
        boundaryNodes.push(n);
        i++;
        break;
      }
    }
    inner.push(n);
    i++;
  }

  while (i < contNodes.length) {
    boundaryNodes.push(contNodes[i]);
    i++;
  }

  return { key, inner, boundaryNodes };
}

export interface CapturedDeferredMatch<
  T extends string | number | boolean = string | number | boolean,
> {
  __purity_deferred_match__: true;
  sourceFn: () => T;
  cases: MatchCases<T>;
  fallback?: MatchView;
  adapter: MatchHydrationAdapter<T>;
}

export function inflateDeferredMatch<T extends string | number | boolean>(
  deferred: CapturedDeferredMatch<T>,
  contNodes: Node[],
  closeMarker: Node,
): void {
  const parent = closeMarker.parentNode;
  /* v8 ignore next */
  if (!parent) return;

  const { sourceFn, cases, fallback, adapter } = deferred;
  const boundary = parseSSRMatchBoundary(contNodes);

  const endMarker = document.createComment('m');
  parent.insertBefore(endMarker, closeMarker);
  detachNodes(boundary.boundaryNodes);

  const matchState: MatchState = { nodes: [], prevKey: null, branch: null };
  const initKey = String(sourceFn()) as `${T}`;
  const ssrKey = boundary.key;
  const initView = cases[initKey] ?? fallback;

  if (ssrKey === initKey && initView && boundary.inner.length > 0) {
    let adopted = false;
    const content = adapter.renderBranch(matchState, () => {
      let view: unknown;
      enterHydration();
      try {
        view = initView();
      } finally {
        exitHydration();
      }
      if (!isDeferred(view)) return view;
      adopted = true;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < boundary.inner.length; i++) frag.appendChild(boundary.inner[i]);
      inflateDeferred(view as DeferredTemplate, frag);
      return frag;
    });
    if (!adopted) {
      detachNodes(boundary.inner);
    }
    adapter.insertMatchView(matchState, parent, endMarker, content);
    matchState.prevKey = initKey;
  } else {
    detachNodes(boundary.inner);
    if (initView) {
      matchState.prevKey = initKey;
      adapter.insertMatchView(
        matchState,
        parent,
        endMarker,
        adapter.renderBranch(matchState, initView),
      );
    }
  }

  adapter.finish(getCurrentContext(), matchState, endMarker, sourceFn, cases, fallback);
}

let controlHydrationInstalled = false;

/** @internal Install control-flow hydration hooks (`each` / `virtualEach` / `match` / `when`). */
export function installControlHydration(): void {
  if (controlHydrationInstalled) return;
  controlHydrationInstalled = true;
  setMatchHydrationHook(
    <T extends string | number | boolean>(
      sourceFn: () => T,
      cases: MatchCases<T>,
      fallback?: MatchView,
      adapter?: unknown,
    ) => {
      setInflateDeferredMatch(
        inflateDeferredMatch as unknown as (d: unknown, c: Node[], m: Node) => void,
      );
      return {
        __purity_deferred_match__: true,
        sourceFn,
        cases,
        fallback,
        adapter: adapter as MatchHydrationAdapter<T>,
      };
    },
  );
  setEachHydrationHook(
    <T>(
      listAccessor: (() => T[]) | T[],
      mapFn: (item: () => T, index: number) => Node | DocumentFragment | string,
      keyFn?: (item: T, index: number) => unknown,
      adapter?: unknown,
    ) => {
      setInflateDeferredEach(inflateDeferredEach as (d: unknown, c: Node[], m: Node) => void);
      return {
        __purity_deferred_each__: true,
        listAccessor,
        mapFn,
        keyFn,
        adapter: adapter as EachHydrationAdapter<T>,
      };
    },
  );
}
