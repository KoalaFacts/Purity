import {
  inflateDeferred,
  setInflateDeferredEach,
  setInflateDeferredMatch,
} from './compiler/compile.ts';
import {
  type DeferredTemplate,
  enterHydration,
  exitHydration,
  isDeferred,
  isHydrating,
} from './compiler/hydrate-runtime.ts';
import { markSSRHtml, type SSRHtml, valueToHtml } from './compiler/ssr-runtime.ts';
import { getCurrentContext, popContext, pushContext, type Scope } from './component.ts';
import type { StateAccessor } from './signals.ts';
import { state, watch } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

// ---------------------------------------------------------------------------
// match(sourceFn, cases, fallback?) — reactive pattern matching
// NOW CACHES DOM per case key — toggling reuses nodes instead of recreating
// ---------------------------------------------------------------------------

type MatchView = () => Node | DocumentFragment | string;
type MatchCases<T extends string | number | boolean> = Partial<Record<`${T}`, MatchView>>;

interface MatchState {
  currentNodes: Node[];
  prevKey: string | undefined;
  cache: Map<string, Node[]>;
}

// Insert the result of viewFn() before endMarker and update matchState. Shared
// between match()'s initial render and the reactive update path.
function insertMatchView(
  matchState: MatchState,
  parent: Node,
  endMarker: Node,
  content: Node | DocumentFragment | string,
): void {
  if (content instanceof DocumentFragment) {
    matchState.currentNodes = Array.from(content.childNodes);
    parent.insertBefore(content, endMarker);
  } else if (content instanceof Node) {
    matchState.currentNodes = [content];
    parent.insertBefore(content, endMarker);
  } else {
    const textNode = document.createTextNode(String(content));
    matchState.currentNodes = [textNode];
    parent.insertBefore(textNode, endMarker);
  }
}

// Detach current nodes, archive them in the per-case cache (so toggling back
// reuses them), then render the new key. Reused by client + hydration paths.
function reconcileMatch<T extends string | number | boolean>(
  matchState: MatchState,
  parent: Node,
  endMarker: Node,
  key: string,
  cases: MatchCases<T>,
  fallback?: MatchView,
): void {
  for (let i = 0; i < matchState.currentNodes.length; i++) {
    const node = matchState.currentNodes[i];
    /* v8 ignore next -- defensive guard; nodes always have parent here */
    if (node.parentNode) node.parentNode.removeChild(node);
  }
  if (matchState.prevKey !== undefined && matchState.currentNodes.length > 0) {
    matchState.cache.set(matchState.prevKey, matchState.currentNodes);
  }
  matchState.prevKey = key;

  const cached = matchState.cache.get(key);
  if (cached) {
    matchState.currentNodes = cached;
    for (let i = 0; i < cached.length; i++) parent.insertBefore(cached[i], endMarker);
    return;
  }

  const viewFn = cases[key as `${T}`] ?? fallback;
  if (!viewFn) {
    matchState.currentNodes = [];
    return;
  }
  insertMatchView(matchState, parent, endMarker, viewFn());
}

function installMatchWatch<T extends string | number | boolean>(
  matchState: MatchState,
  endMarker: Node,
  sourceFn: () => T,
  cases: MatchCases<T>,
  fallback?: MatchView,
): () => void {
  return watch(() => {
    const key = String(sourceFn()) as `${T}`;
    if (key === matchState.prevKey) return;
    const parent = endMarker.parentNode;
    /* v8 ignore next -- defensive; if endMarker is detached, watch is disposed */
    if (!parent) return;
    reconcileMatch(matchState, parent, endMarker, key, cases, fallback);
  });
}

function registerMatchAutoDispose(
  ownerCtx: Scope | null,
  dispose: () => void,
  matchState: MatchState,
): void {
  if (!ownerCtx) return;
  (ownerCtx.disposers ??= []).push(() => {
    dispose();
    matchState.cache.clear();
    matchState.currentNodes = [];
  });
}

/**
 * Reactive pattern matching. Renders different content based on a signal value.
 * **Caches DOM** per case — switching back reuses the previous DOM, no recreation.
 *
 * @example
 * ```ts
 * match(() => status(), {
 *   loading: () => html`<p>Loading...</p>`,
 *   error:   () => html`<p>Error!</p>`,
 *   success: () => html`<p>Done</p>`,
 * })
 * ```
 */
export function match<T extends string | number | boolean>(
  sourceFn: () => T,
  cases: MatchCases<T>,
  fallback?: MatchView,
): DocumentFragment | DeferredMatch<T> | SSRHtml {
  // Hydration mode: defer DOM creation. The hydrate factory sees the handle,
  // routes through inflateDeferredMatch, which adopts the SSR-rendered case in
  // place and seeds the per-case cache so toggling back reuses it. Closes the
  // when()/match() half of the ADR 0005 control-flow lossy gap.
  if (isHydrating()) return makeDeferredMatch(sourceFn, cases, fallback);

  // SSR-context dispatch (ADR 0023). Inside a `renderToString` /
  // `renderToStream` / `renderStatic` pass, return SSRHtml string output
  // instead of touching `document`. Lets `match()` be called from
  // manifest-driven composers without needing the explicit `matchSSR`.
  if (getSSRRenderContext() !== null) return matchSSR(sourceFn, cases, fallback);

  const endMarker = document.createComment('m');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(endMarker);

  const matchState: MatchState = { currentNodes: [], prevKey: undefined, cache: new Map() };

  const initKey = String(sourceFn()) as `${T}`;
  const initView = cases[initKey] ?? fallback;
  if (initView) {
    matchState.prevKey = initKey;
    insertMatchView(matchState, fragment, endMarker, initView());
  }

  const dispose = installMatchWatch(matchState, endMarker, sourceFn, cases, fallback);
  registerMatchAutoDispose(getCurrentContext(), dispose, matchState);
  return fragment;
}

// ---------------------------------------------------------------------------
// when — boolean conditional, delegates to match with caching
// ---------------------------------------------------------------------------

/**
 * Conditional rendering. Shorthand for boolean `match()`.
 * **Caches both branches** — toggling reuses DOM, no recreation.
 *
 * @example
 * ```ts
 * when(() => loggedIn(),
 *   () => html`<p>Welcome back!</p>`,
 *   () => html`<p>Please login</p>`
 * )
 * ```
 */
export function when(
  conditionFn: () => boolean,
  thenFn: MatchView,
  elseFn?: MatchView,
): DocumentFragment | SSRHtml {
  // SSR-context fast path (ADR 0023). Bypasses match()'s reactive plumbing
  // entirely on the server — whenSSR returns the picked branch as a tagged
  // string. `match()` itself ALSO dispatches in SSR (so the recursion would
  // be safe), but going direct is clearer + slightly faster.
  if (getSSRRenderContext() !== null) return whenSSR(conditionFn, thenFn, elseFn);
  return match((() => String(conditionFn())) as () => 'true' | 'false', {
    true: thenFn,
    ...(elseFn ? { false: elseFn } : {}),
  }) as DocumentFragment;
}

// ---------------------------------------------------------------------------
// LIS (Longest Increasing Subsequence) — for minimal DOM moves in each()
// O(n log n) algorithm used by Solid, Inferno, ivi
// ---------------------------------------------------------------------------

function lis(arr: number[]): number[] {
  const len = arr.length;
  if (len === 0) return [];

  // tails[i] = smallest tail element for increasing subsequence of length i+1
  const tails: number[] = [0];
  // predecessor[i] = index of previous element in LIS ending at i
  const predecessor: number[] = new Array(len);

  for (let i = 1; i < len; i++) {
    const val = arr[i];

    if (val > arr[tails[tails.length - 1]]) {
      predecessor[i] = tails[tails.length - 1];
      tails.push(i);
      continue;
    }

    // Binary search for the leftmost tail >= val
    let lo = 0;
    let hi = tails.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[tails[mid]] < val) lo = mid + 1;
      else hi = mid;
    }

    if (val < arr[tails[lo]]) {
      if (lo > 0) predecessor[i] = tails[lo - 1];
      tails[lo] = i;
    }
  }

  // Reconstruct LIS
  const result: number[] = new Array(tails.length);
  let k = tails[tails.length - 1];
  for (let i = result.length - 1; i >= 0; i--) {
    result[i] = k;
    k = predecessor[k];
  }

  return result;
}

// ---------------------------------------------------------------------------
// each(listAccessor, mapFn, keyFn?) — list rendering
//
// Two modes:
// 1. Keyed (keyFn provided): LIS-based reorder + in-place signal update
//    Each entry owns a state signal. On update, signal value changes →
//    existing DOM mutates in place. Zero DOM creation for existing keys.
//
// 2. Unkeyed (no keyFn): item identity as key, same algorithm
// ---------------------------------------------------------------------------

interface EachEntry<T = unknown> {
  nodes: Node[];
  // Per-item state signal. mapFn receives `() => data()` as the item accessor;
  // on key reuse with new data, we set this signal and any reactive bindings
  // inside the template re-fire — zero DOM creation.
  data: StateAccessor<T>;
  // Per-entry scope. Reactive bindings created inside mapFn auto-register
  // their dispose here (via watch() -> getCurrentContext()). Walked when the
  // entry is removed to release the watcher references. We use a lean
  // 1-field { disposers } shape rather than a full ComponentContext — row
  // entries don't participate in mount/destroy/error lifecycle, and the
  // per-row alloc cost adds up: 10k rows × ~80 bytes class instance vs
  // ~24 bytes plain object trims about a megabyte of heap on Create 10k.
  ctx: Scope;
}

// Run mapFn under a fresh per-entry scope so reactive bindings register
// their dispose with the entry, not the outer scope. The scope object is
// intentionally minimal — `disposers` is the only slot anything reads.
function runEntryMapFn<T>(
  mapFn: (item: () => T, index: number) => Node | DocumentFragment | string,
  data: StateAccessor<T>,
  index: number,
  _parentCtx: Scope | null,
): { entry: EachEntry<T>; content: Node | DocumentFragment | string } {
  const ctx: Scope = { disposers: null };
  pushContext(ctx);
  let content: Node | DocumentFragment | string;
  try {
    content = mapFn(data, index);
  } finally {
    popContext();
  }
  return { entry: { nodes: [], data, ctx }, content };
}

function disposeEntry<T>(entry: EachEntry<T>): void {
  const disposers = entry.ctx.disposers;
  if (!disposers) return;
  for (let i = 0; i < disposers.length; i++) {
    try {
      disposers[i]();
    } catch (e) {
      console.error('[Purity] Error during each() entry dispose:', e);
    }
  }
  entry.ctx.disposers = null;
}

// Detach all managed nodes from the parent and release their reactive scopes.
function bulkClear<T>(
  _parent: Node,
  prevKeys: unknown[],
  keyToEntry: Map<unknown, EachEntry<T>>,
  _endMarker: Node,
): void {
  const prevLen = prevKeys.length;
  if (prevLen === 0) return;

  // Detach + dispose each entry. We walk per-entry nodes rather than calling
  // Range.deleteContents because jsdom's Range is O(N^2) on long sibling
  // lists; the per-node loop is O(N) and roughly the same speed in real
  // browsers (the parent is the same for every removeChild).
  for (let i = 0; i < prevLen; i++) {
    const entry = keyToEntry.get(prevKeys[i]);
    if (!entry) continue;
    const nodes = entry.nodes;
    for (let j = 0; j < nodes.length; j++) {
      const node = nodes[j];
      const p = node.parentNode;
      if (p) p.removeChild(node);
    }
    disposeEntry(entry);
  }
}

// Extract nodes from mapFn result — optimized for single-node case
function extractNodes(content: Node | DocumentFragment | string): Node[] {
  if (content instanceof DocumentFragment) {
    // Fast path: single child (common for html`` templates)
    const fc = content.firstChild;
    if (fc && !fc.nextSibling) return [fc];
    return Array.from(content.childNodes);
  }
  if (content instanceof Node) return [content];
  return [document.createTextNode(String(content ?? ''))];
}

// Mutable state shared between each()'s watch and inflateDeferredEach's hydration
// pre-population so a hydrated each() can fall straight through into the same
// reconciliation logic on subsequent reactive updates.
interface EachState<T> {
  keyToEntry: Map<unknown, EachEntry<T>>;
  prevKeys: unknown[];
}

function reconcileEach<T>(
  eachState: EachState<T>,
  items: T[],
  parent: Node,
  endMarker: Node,
  mapFn: (item: () => T, index: number) => Node | DocumentFragment | string,
  getKey: (item: T, index: number) => unknown,
  ownerCtx: Scope | null,
): void {
  const len = items.length;
  const { keyToEntry, prevKeys } = eachState;
  const prevLen = prevKeys.length;

  // Fast path: same keys in same order — just update data signals
  if (len === prevLen) {
    let same = true;
    for (let i = 0; i < len; i++) {
      if (prevKeys[i] !== getKey(items[i], i)) {
        same = false;
        break;
      }
    }
    if (same) {
      for (let i = 0; i < len; i++) {
        const entry = keyToEntry.get(prevKeys[i])!;
        entry.data(items[i]);
      }
      return;
    }
  }

  if (len === 0) {
    if (prevLen > 0) {
      bulkClear(parent, prevKeys, keyToEntry, endMarker);
      eachState.keyToEntry = new Map();
    }
    eachState.prevKeys = [];
    return;
  }

  if (prevLen === 0) {
    const newKeys2: unknown[] = new Array(len);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < len; i++) {
      const item = items[i];
      newKeys2[i] = getKey(item, i);
      const data = state(item);
      const { entry, content } = runEntryMapFn(mapFn, data, i, ownerCtx);
      if (content instanceof DocumentFragment) {
        const fc = content.firstChild;
        entry.nodes = fc && !fc.nextSibling ? [fc] : Array.from(content.childNodes);
        frag.appendChild(content);
      } else if (content instanceof Node) {
        entry.nodes = [content];
        frag.appendChild(content);
      } else {
        const tn = document.createTextNode(String(content ?? ''));
        entry.nodes = [tn];
        frag.appendChild(tn);
      }
      keyToEntry.set(newKeys2[i], entry);
    }
    parent.insertBefore(frag, endMarker);
    eachState.prevKeys = newKeys2;
    return;
  }

  const newKeys: unknown[] = new Array(len);
  const newEntries = new Map<unknown, EachEntry<T>>();
  let reuseCount = 0;

  for (let i = 0; i < len; i++) {
    const item = items[i];
    const key = getKey(item, i);
    newKeys[i] = key;

    const _existing = keyToEntry.get(key) as EachEntry<T> | undefined;
    if (_existing) {
      _existing.data(item);
      newEntries.set(key, _existing);
      reuseCount++;
    } else {
      const data = state(item);
      const { entry, content } = runEntryMapFn(mapFn, data, i, ownerCtx);
      entry.nodes = extractNodes(content);
      newEntries.set(key, entry);
    }
  }

  if (reuseCount === 0) {
    bulkClear(parent, prevKeys, keyToEntry, endMarker);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < len; i++) {
      const entry = newEntries.get(newKeys[i])!;
      for (let j = 0; j < entry.nodes.length; j++) frag.appendChild(entry.nodes[j]);
    }
    parent.insertBefore(frag, endMarker);
    eachState.keyToEntry = newEntries;
    eachState.prevKeys = newKeys;
    return;
  }

  if (reuseCount < prevLen) {
    const newKeySet = new Set(newKeys);
    for (let i = 0; i < prevLen; i++) {
      const key = prevKeys[i];
      if (!newKeySet.has(key)) {
        const entry = keyToEntry.get(key);
        if (entry) {
          for (let j = 0; j < entry.nodes.length; j++) {
            const node = entry.nodes[j];
            if (node.parentNode) node.parentNode.removeChild(node);
          }
          disposeEntry(entry);
        }
      }
    }
  }

  let isAppend = len > prevLen;
  if (isAppend) {
    for (let i = 0; i < prevLen; i++) {
      if (prevKeys[i] !== newKeys[i]) {
        isAppend = false;
        break;
      }
    }
  }

  let isPrepend = !isAppend && len > prevLen;
  if (isPrepend) {
    const offset = len - prevLen;
    for (let i = 0; i < prevLen; i++) {
      if (prevKeys[i] !== newKeys[i + offset]) {
        isPrepend = false;
        break;
      }
    }
  }

  if (isAppend) {
    const frag = document.createDocumentFragment();
    for (let i = prevLen; i < len; i++) {
      const entry = newEntries.get(newKeys[i])!;
      for (let j = 0; j < entry.nodes.length; j++) frag.appendChild(entry.nodes[j]);
    }
    parent.insertBefore(frag, endMarker);
  } else if (isPrepend) {
    const newCount = len - prevLen;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < newCount; i++) {
      const entry = newEntries.get(newKeys[i])!;
      for (let j = 0; j < entry.nodes.length; j++) frag.appendChild(entry.nodes[j]);
    }
    const firstExisting = newEntries.get(newKeys[newCount])!.nodes[0];
    parent.insertBefore(frag, firstExisting);
  } else {
    let swapped = false;
    if (len === prevLen && reuseCount === len) {
      let sc = 0;
      let sa = -1;
      let sb = -1;
      for (let i = 0; i < len; i++) {
        if (prevKeys[i] !== newKeys[i]) {
          if (sc === 0) sa = i;
          else if (sc === 1) sb = i;
          sc++;
          if (sc > 2) break;
        }
      }
      if (sc === 2 && sa >= 0 && sb >= 0) {
        const entryA = newEntries.get(newKeys[sa])!;
        const entryB = newEntries.get(newKeys[sb])!;
        if (entryA.nodes.length === 1 && entryB.nodes.length === 1) {
          swapped = true;
          const nodeA = entryA.nodes[0];
          const nodeB = entryB.nodes[0];
          const marker = document.createComment('');
          parent.insertBefore(marker, nodeA);
          parent.insertBefore(nodeA, nodeB);
          parent.insertBefore(nodeB, marker);
          parent.removeChild(marker);
        }
      }
    }

    if (!swapped) {
      const oldKeyIndex = new Map<unknown, number>();
      for (let i = 0; i < prevLen; i++) oldKeyIndex.set(prevKeys[i], i);

      const sources: number[] = [];
      const newIndexToSource: number[] = new Array(len).fill(-1);

      for (let i = 0; i < len; i++) {
        const oldIdx = oldKeyIndex.get(newKeys[i]);
        if (oldIdx !== undefined) {
          sources.push(oldIdx);
          newIndexToSource[i] = sources.length - 1;
        }
      }

      const lisIndices = new Set(lis(sources));

      let nextSibling: Node = endMarker;
      let batch: Node[] | null = null;
      let batchTarget: Node = endMarker;

      for (let i = len - 1; i >= 0; i--) {
        const entry = newEntries.get(newKeys[i])!;
        const firstNode = entry.nodes[0];
        const sourceIdx = newIndexToSource[i];
        const needsMove = sourceIdx === -1 || !lisIndices.has(sourceIdx);

        if (needsMove) {
          if (!batch) {
            batch = [];
            batchTarget = nextSibling;
          }
          batch.push(firstNode);
        } else {
          if (batch) {
            const frag = document.createDocumentFragment();
            for (let j = batch.length - 1; j >= 0; j--) frag.appendChild(batch[j]);
            parent.insertBefore(frag, batchTarget);
            batch = null;
          }
        }

        nextSibling = entry.nodes[0] || nextSibling;
      }

      if (batch) {
        const frag = document.createDocumentFragment();
        for (let j = batch.length - 1; j >= 0; j--) frag.appendChild(batch[j]);
        parent.insertBefore(frag, batchTarget);
      }
    }
  }

  eachState.keyToEntry = newEntries;
  eachState.prevKeys = newKeys;
}

// Set up the auto-disposer that releases per-row watchers and the outer
// reconcile watch when the surrounding component unmounts. Shared between
// each()'s synchronous build and inflateDeferredEach's hydration adoption.
function registerEachAutoDispose<T>(
  ownerCtx: Scope | null,
  dispose: () => void,
  eachState: EachState<T>,
): void {
  if (!ownerCtx) return;
  (ownerCtx.disposers ??= []).push(() => {
    dispose();
    for (const entry of eachState.keyToEntry.values()) disposeEntry(entry);
    eachState.keyToEntry.clear();
    eachState.prevKeys = [];
  });
}

/**
 * Reactive list rendering. Reuses DOM via per-item signals + LIS reorder.
 *
 * When the list changes:
 * - Existing items: signal updated → DOM mutates in place (zero creation)
 * - New items: DOM created once
 * - Removed items: DOM detached
 * - Reordered items: minimal DOM moves via LIS
 *
 * `mapFn` receives `item` as a **reactive accessor** — call `item()` to read.
 * Wrap reads in `${() => item().field}` so the binding re-fires when the
 * underlying data changes for the same key.
 *
 * @example
 * ```ts
 * each(
 *   () => todos(),
 *   (todo) => html`<li>${() => todo().text}</li>`,
 *   (todo) => todo.id,
 * )
 * ```
 */
export function each<T>(
  listAccessor: (() => T[]) | T[],
  mapFn: (item: () => T, index: number) => Node | DocumentFragment | string,
  keyFn?: (item: T, index: number) => unknown,
): DocumentFragment | DeferredEach<T> | SSRHtml {
  // Hydration mode: defer DOM creation. The hydrate factory recognises the
  // returned handle and routes it through inflateDeferredEach, which adopts
  // the SSR-rendered rows in place rather than rebuilding the slot. See
  // ADR 0005 / handoff item "Per-row reconciliation in each()".
  if (isHydrating()) return makeDeferredEach(listAccessor, mapFn, keyFn);

  // SSR-context dispatch (ADR 0023). Inside a server render pass, return
  // SSRHtml string output. Same per-row marker grammar as eachSSR, so
  // hydration adoption still works against the resulting markup.
  if (getSSRRenderContext() !== null) return eachSSR(listAccessor, mapFn, keyFn);

  const endMarker = document.createComment('e');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(endMarker);

  const eachState: EachState<T> = { keyToEntry: new Map(), prevKeys: [] };
  const getList =
    typeof listAccessor === 'function' ? (listAccessor as () => T[]) : () => listAccessor;
  const getKey = keyFn ?? ((item: T, _i: number) => item as unknown);

  const dispose = watch(() => {
    const items = getList() || [];
    const parent = endMarker.parentNode;
    if (!parent) return;
    reconcileEach(eachState, items, parent, endMarker, mapFn, getKey, getCurrentContext());
  });

  registerEachAutoDispose(getCurrentContext(), dispose, eachState);
  return fragment;
}

// ---------------------------------------------------------------------------
// Deferred-each handle + hydration adoption
//
// `each()` is called eagerly inside `html` template values, so during a
// `hydrate()` call it runs before the hydrate factory has located the
// expression slot. Returning a deferred handle lets the hydrate factory
// recognise the slot's user-supplied value and route it through a
// keyed-row-adoption helper. See ADR 0005's "non-lossy hydration" thread —
// this closes the per-row gap that was deferred there.
// ---------------------------------------------------------------------------

/** A reified `each()` call captured during hydration; adopted against an SSR row run. */
export interface DeferredEach<T = unknown> {
  __purity_deferred_each__: true;
  listAccessor: (() => T[]) | T[];
  mapFn: (item: () => T, index: number) => Node | DocumentFragment | string;
  keyFn?: (item: T, index: number) => unknown;
}

function makeDeferredEach<T>(
  listAccessor: (() => T[]) | T[],
  mapFn: (item: () => T, index: number) => Node | DocumentFragment | string,
  keyFn?: (item: T, index: number) => unknown,
): DeferredEach<T> {
  return { __purity_deferred_each__: true, listAccessor, mapFn, keyFn };
}

/** Type guard for {@link DeferredEach}. @internal */
export function isDeferredEach(v: unknown): v is DeferredEach {
  return (
    v != null &&
    typeof v === 'object' &&
    (v as { __purity_deferred_each__?: unknown }).__purity_deferred_each__ === true
  );
}

// Encode an arbitrary key into a comment-data-safe string. encodeURIComponent
// escapes everything except `A-Za-z0-9-_.!~*'()`; we additionally rewrite `-`
// to `%2D` so two consecutive dashes can never appear in the encoded form
// (HTML comments forbid `--`). decodeURIComponent inverts both transforms in
// one step, since `%2D` round-trips to `-`. See WHATWG comment grammar.
function encodeRowKey(key: unknown): string {
  return encodeURIComponent(String(key)).replace(/-/g, '%2D');
}

function decodeRowKey(s: string): string {
  return decodeURIComponent(s);
}

// Walk an each() slot's SSR content nodes and split into rows by `<!--er:K-->`
// markers. Rows whose end marker is missing or which lack a leading marker are
// dropped from the map (caller treats them as orphan SSR content and replaces
// with fresh DOM). The boundary markers (`<!--e-->` / `<!--/e-->`) — and any
// orphan stragglers — are also returned so the caller can detach them.
interface SSRRow {
  key: string;
  nodes: Node[];
}

function parseSSRRows(contNodes: Node[]): { rows: SSRRow[]; boundaryNodes: Node[] } {
  const rows: SSRRow[] = [];
  const boundaryNodes: Node[] = [];
  let i = 0;
  const len = contNodes.length;
  while (i < len) {
    const node = contNodes[i];
    if (node.nodeType !== 8) {
      // Whitespace / orphan content between markers — drop it. The renderer's
      // inner output is comment-prefixed, so only stray whitespace ends up
      // here in practice (the template tag's own marker pair sits outside).
      boundaryNodes.push(node);
      i++;
      continue;
    }
    const data = (node as Comment).data;
    if (data === 'e' || data === '/e') {
      boundaryNodes.push(node);
      i++;
      continue;
    }
    const startMatch = /^er:(.*)$/.exec(data);
    if (!startMatch) {
      // Unknown comment between rows — drop it.
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
    if (closed) rows.push({ key, nodes: rowNodes });
    // If unclosed, the SSR was malformed — discard the partial row's nodes
    // (they're already in rowNodes; we don't push them anywhere, but they're
    // still in the DOM. The caller falls through to lossy replace.)
    else {
      // Add rowNodes to boundaryNodes so caller can detach them on lossy fallback.
      for (let k = 0; k < rowNodes.length; k++) boundaryNodes.push(rowNodes[k]);
    }
  }
  return { rows, boundaryNodes };
}

/**
 * Adopt the SSR-rendered rows in `contNodes` for a `each()` call, reusing
 * existing row DOM where keys match the current items list. Sets up the
 * reactive watch for subsequent updates.
 *
 * Called from compiled hydrate factories when an expression slot's value is
 * a {@link DeferredEach} handle (i.e. the user wrote `${each(...)}`).
 *
 * @internal
 */
export function inflateDeferredEach<T>(
  deferred: DeferredEach<T>,
  contNodes: Node[],
  closeMarker: Node,
): void {
  const parent = closeMarker.parentNode;
  /* v8 ignore next -- defensive; close marker always has a parent here */
  if (!parent) return;

  const { listAccessor, mapFn, keyFn } = deferred;
  const getList =
    typeof listAccessor === 'function' ? (listAccessor as () => T[]) : () => listAccessor;
  const getKey = keyFn ?? ((item: T, _i: number) => item as unknown);

  // Insert the live `each()` end marker just before the slot close — keeps
  // future inserts/removes scoped to this slot the same way they would be in
  // a fresh client render.
  const endMarker = document.createComment('e');
  parent.insertBefore(endMarker, closeMarker);

  const { rows: ssrRows, boundaryNodes } = parseSSRRows(contNodes);
  // Detach the SSR `<!--e-->` / `<!--/e-->` markers and any orphan content —
  // the new endMarker replaces them. Row content is left in place and adopted.
  for (let i = 0; i < boundaryNodes.length; i++) {
    const n = boundaryNodes[i];
    if (n.parentNode) n.parentNode.removeChild(n);
  }

  const ssrByKey = new Map<string, SSRRow>();
  for (let i = 0; i < ssrRows.length; i++) ssrByKey.set(ssrRows[i].key, ssrRows[i]);

  const ownerCtx = getCurrentContext();
  const items = getList() || [];
  const eachState: EachState<T> = { keyToEntry: new Map(), prevKeys: new Array(items.length) };

  // Adopt rows in items order. For each item, if a matching SSR row exists,
  // run mapFn under the entry scope (yielding a DeferredTemplate when the
  // user uses `html\`\``) and inflate against that row's nodes. Otherwise
  // build fresh DOM.
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const key = getKey(item, i);
    eachState.prevKeys[i] = key;

    // Items match SSR rows by `String(key)` — same coercion that eachSSR's
    // encoder applies (round-trip through encodeURIComponent / decode).
    const ssrRow = ssrByKey.get(String(key));
    const data = state(item);
    const ctx: Scope = { disposers: null };
    pushContext(ctx);
    // Re-enter hydration mode while mapFn runs so nested `html\`\`` calls
    // return DeferredTemplate handles (which we then inflate against the
    // matching SSR row) instead of building fresh DOM. The outer hydrate()
    // exits hydration mode before invoking inflate helpers, so each row
    // toggles it locally.
    enterHydration();
    let content: Node | DocumentFragment | string | DeferredTemplate;
    try {
      content = mapFn(data, i) as Node | DocumentFragment | string | DeferredTemplate;
    } finally {
      exitHydration();
      popContext();
    }

    let nodes: Node[];
    if (ssrRow && isDeferred(content)) {
      // Inflate the row template against a fragment carved from this row's
      // SSR nodes. The hydrate factory mutates row DOM in place; we then
      // re-attach the (now bound) nodes to the parent in their original
      // position before the slot close marker.
      const frag = document.createDocumentFragment();
      for (let j = 0; j < ssrRow.nodes.length; j++) frag.appendChild(ssrRow.nodes[j]);
      inflateDeferred(content as DeferredTemplate, frag);
      nodes = Array.from(frag.childNodes);
      parent.insertBefore(frag, endMarker);
    } else {
      // No SSR row OR mapFn returned non-deferred (string / static Node /
      // fragment). Detach any SSR row nodes for this key — they're stale —
      // and insert the fresh content.
      if (ssrRow) {
        for (let j = 0; j < ssrRow.nodes.length; j++) {
          const n = ssrRow.nodes[j];
          if (n.parentNode) n.parentNode.removeChild(n);
        }
      }
      if (isDeferred(content)) {
        // No SSR row to adopt — inflate against an empty fragment. The
        // factory builds fresh DOM under that fragment via the same path
        // used for top-level mismatched-slot recovery; we then move it in.
        const frag = document.createDocumentFragment();
        inflateDeferred(content as DeferredTemplate, frag);
        nodes = Array.from(frag.childNodes);
        parent.insertBefore(frag, endMarker);
      } else if (content instanceof DocumentFragment) {
        const fc = content.firstChild;
        nodes = fc && !fc.nextSibling ? [fc] : Array.from(content.childNodes);
        parent.insertBefore(content, endMarker);
      } else if (content instanceof Node) {
        nodes = [content];
        parent.insertBefore(content, endMarker);
      } else {
        const tn = document.createTextNode(String(content ?? ''));
        nodes = [tn];
        parent.insertBefore(tn, endMarker);
      }
    }

    eachState.keyToEntry.set(key, { nodes, data, ctx });
    ssrByKey.delete(String(key));
  }

  // Detach any SSR rows that didn't match a current key (rare — implies the
  // data changed between SSR and hydration).
  for (const stale of ssrByKey.values()) {
    for (let j = 0; j < stale.nodes.length; j++) {
      const n = stale.nodes[j];
      if (n.parentNode) n.parentNode.removeChild(n);
    }
  }

  // Set up the reactive watch for subsequent updates. The first invocation
  // hits the "same keys" fast path (we just built them), so it's a cheap
  // dependency-tracking pass.
  const dispose = watch(() => {
    const next = getList() || [];
    const p = endMarker.parentNode;
    if (!p) return;
    reconcileEach(eachState, next, p, endMarker, mapFn, getKey, ownerCtx);
  });

  registerEachAutoDispose(ownerCtx, dispose, eachState);
}

// ---------------------------------------------------------------------------
// Deferred-match handle + hydration adoption
//
// Mirrors the each() story for `match()` / `when()` (which both run through
// match() on the client). During hydration `match()` returns a handle
// instead of building a fresh DOM tree; the hydrate factory's expression-
// slot dispatch routes it through inflateDeferredMatch, which adopts the
// SSR-rendered case in place and seeds the per-case cache so toggling back
// reuses the SSR-derived nodes.
// ---------------------------------------------------------------------------

/** A reified `match()` call captured during hydration. */
export interface DeferredMatch<T extends string | number | boolean = string | number | boolean> {
  __purity_deferred_match__: true;
  sourceFn: () => T;
  cases: MatchCases<T>;
  fallback?: MatchView;
}

function makeDeferredMatch<T extends string | number | boolean>(
  sourceFn: () => T,
  cases: MatchCases<T>,
  fallback?: MatchView,
): DeferredMatch<T> {
  return { __purity_deferred_match__: true, sourceFn, cases, fallback };
}

/** Type guard for {@link DeferredMatch}. @internal */
export function isDeferredMatch(v: unknown): v is DeferredMatch {
  return (
    v != null &&
    typeof v === 'object' &&
    (v as { __purity_deferred_match__?: unknown }).__purity_deferred_match__ === true
  );
}

// Locate the `<!--m:KEY-->...<!--/m-->` boundary inside a slot's content
// nodes and return the boundary markers, key, and inner content nodes.
// The slot also holds whitespace text nodes around the boundary in some
// SSR layouts; those are returned in `boundaryNodes` so the caller can
// detach them alongside the markers.
interface SSRMatchBoundary {
  key: string | null;
  startMarker: Comment | null;
  endMarker: Comment | null;
  inner: Node[];
  boundaryNodes: Node[];
}

function parseSSRMatchBoundary(contNodes: Node[]): SSRMatchBoundary {
  let startMarker: Comment | null = null;
  let endMarker: Comment | null = null;
  let key: string | null = null;
  const inner: Node[] = [];
  const boundaryNodes: Node[] = [];

  let i = 0;
  // Skip leading non-marker noise (whitespace text nodes, etc.).
  while (i < contNodes.length) {
    const n = contNodes[i];
    if (n.nodeType === 8) {
      const data = (n as Comment).data;
      const m = /^m:(.*)$/.exec(data);
      if (m) {
        startMarker = n as Comment;
        key = decodeRowKey(m[1]);
        boundaryNodes.push(n);
        i++;
        break;
      }
      // Bare `<!--m-->` (unkeyed legacy form) — adopt with key=null.
      if (data === 'm') {
        startMarker = n as Comment;
        key = null;
        boundaryNodes.push(n);
        i++;
        break;
      }
    }
    boundaryNodes.push(n);
    i++;
  }

  while (i < contNodes.length) {
    const n = contNodes[i];
    if (n.nodeType === 8 && (n as Comment).data === '/m') {
      endMarker = n as Comment;
      boundaryNodes.push(n);
      i++;
      break;
    }
    inner.push(n);
    i++;
  }

  // Trailing noise after `<!--/m-->` (whitespace, stray comments).
  while (i < contNodes.length) {
    boundaryNodes.push(contNodes[i]);
    i++;
  }

  return { key, startMarker, endMarker, inner, boundaryNodes };
}

/**
 * Adopt the SSR-rendered case for a `match()` / `when()` slot. Inflates the
 * matching case's deferred template against the SSR boundary content, seeds
 * the per-case cache so toggling back reuses adopted DOM, and installs the
 * reactive watch.
 *
 * Called from compiled hydrate factories when an expression slot's value is
 * a {@link DeferredMatch} handle.
 *
 * @internal
 */
export function inflateDeferredMatch<T extends string | number | boolean>(
  deferred: DeferredMatch<T>,
  contNodes: Node[],
  closeMarker: Node,
): void {
  const parent = closeMarker.parentNode;
  /* v8 ignore next -- defensive; close marker always has a parent here */
  if (!parent) return;

  const { sourceFn, cases, fallback } = deferred;
  const boundary = parseSSRMatchBoundary(contNodes);

  // Insert the live end marker before the slot close and detach SSR
  // boundary scaffolding (the `<!--m:K-->` / `<!--/m-->` markers themselves
  // plus any whitespace text nodes around them). The view content stays put
  // for adoption.
  const endMarker = document.createComment('m');
  parent.insertBefore(endMarker, closeMarker);
  for (let i = 0; i < boundary.boundaryNodes.length; i++) {
    const n = boundary.boundaryNodes[i];
    if (n.parentNode) n.parentNode.removeChild(n);
  }

  const matchState: MatchState = { currentNodes: [], prevKey: undefined, cache: new Map() };
  const initKey = String(sourceFn()) as `${T}`;
  const ssrKey = boundary.key;
  const initView = cases[initKey] ?? fallback;

  if (ssrKey === initKey && initView && boundary.inner.length > 0) {
    // Keys match — run the view under hydration mode so html`` produces a
    // DeferredTemplate, then inflate against the boundary's existing nodes.
    enterHydration();
    let content: unknown;
    try {
      content = initView();
    } finally {
      exitHydration();
    }

    if (isDeferred(content)) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < boundary.inner.length; i++) frag.appendChild(boundary.inner[i]);
      inflateDeferred(content as DeferredTemplate, frag);
      matchState.currentNodes = Array.from(frag.childNodes);
      parent.insertBefore(frag, endMarker);
    } else {
      // View returned a non-deferred value (raw Node, string, etc.) — can't
      // adopt; lossy-replace the boundary content with the new value.
      for (let i = 0; i < boundary.inner.length; i++) {
        const n = boundary.inner[i];
        if (n.parentNode) n.parentNode.removeChild(n);
      }
      insertMatchView(matchState, parent, endMarker, content as Node | DocumentFragment | string);
    }
    matchState.prevKey = initKey;
  } else {
    // Either no view was rendered server-side (key === undefined / no inner
    // content) or the SSR key disagrees with the current key. Detach SSR
    // inner content and render the current view fresh.
    for (let i = 0; i < boundary.inner.length; i++) {
      const n = boundary.inner[i];
      if (n.parentNode) n.parentNode.removeChild(n);
    }
    if (initView) {
      matchState.prevKey = initKey;
      insertMatchView(matchState, parent, endMarker, initView());
    }
  }

  const dispose = installMatchWatch(matchState, endMarker, sourceFn, cases, fallback);
  registerMatchAutoDispose(getCurrentContext(), dispose, matchState);
}

// Wire up the compiler's hydrate-runtime entry points. Compile.ts calls these
// thunks when a hydrate factory encounters a deferred control-flow value in
// an expression slot. Registering at module-top avoids static import cycles
// (compile.ts already exports symbols control.ts imports above).
setInflateDeferredEach(inflateDeferredEach as (d: unknown, c: Node[], m: Node) => void);
setInflateDeferredMatch(
  inflateDeferredMatch as unknown as (d: unknown, c: Node[], m: Node) => void,
);

// ---------------------------------------------------------------------------
// list() — fastest possible list rendering
//
// Separates template from data. Zero per-item function call overhead
// for DOM creation. ONE tight loop with direct createElement.
//
//   // Simple: tag + text
//   list('li', () => items(), (item) => item.text, (item) => item.id)
//
//   // With attributes:
//   list('li', () => items(), {
//     text: (item) => item.name,
//     class: (item) => item.done ? 'done' : '',
//     '@click': (item) => () => toggle(item.id),
//     key: (item) => item.id,
//   })
// ---------------------------------------------------------------------------

interface ListOptions<T> {
  text?: (item: T, index: number) => string;
  class?: (item: T, index: number) => string;
  style?: (item: T, index: number) => string;
  attrs?: Record<string, (item: T, index: number) => string>;
  events?: Record<string, (item: T, index: number) => (e: Event) => void>;
  key?: (item: T, index: number) => unknown;
}

type ListTextFn<T> = (item: T, index: number) => string;

interface ListEntry {
  node: Element;
  textNode: Text | null;
}

/**
 * High-performance list rendering. Separates template from data for
 * zero per-item overhead. Uses direct createElement in a tight loop.
 *
 * @example
 * ```ts
 * // Simple — tag + text accessor:
 * list('li', () => todos(), (t) => t.text, (t) => t.id)
 *
 * // With options:
 * list('div', () => users(), {
 *   text: (u) => u.name,
 *   class: (u) => u.active ? 'active' : '',
 *   key: (u) => u.id,
 * })
 * ```
 */
export function list<T>(
  tag: string,
  listAccessor: (() => T[]) | T[],
  textOrOptions: ListTextFn<T> | ListOptions<T>,
  keyFnOrNothing?: (item: T, index: number) => unknown,
): DocumentFragment {
  const endMarker = document.createComment('l');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(endMarker);

  // Normalize options
  let getText: ListTextFn<T> | undefined;
  let getClass: ((item: T, index: number) => string) | undefined;
  let getStyle: ((item: T, index: number) => string) | undefined;
  let getAttrs: Record<string, (item: T, index: number) => string> | undefined;
  let getEvents: Record<string, (item: T, index: number) => (e: Event) => void> | undefined;
  let getKey: (item: T, index: number) => unknown;

  if (typeof textOrOptions === 'function') {
    getText = textOrOptions;
    getKey = keyFnOrNothing ?? ((item: T) => item as unknown);
  } else {
    getText = textOrOptions.text;
    getClass = textOrOptions.class;
    getStyle = textOrOptions.style;
    getAttrs = textOrOptions.attrs;
    getEvents = textOrOptions.events;
    getKey = textOrOptions.key ?? ((item: T) => item as unknown);
  }

  let keyToEntry = new Map<unknown, ListEntry>();
  let prevKeys: unknown[] = [];

  const getList =
    typeof listAccessor === 'function' ? (listAccessor as () => T[]) : () => listAccessor;

  // Create a single element — the tightest possible code
  const createEntry = (item: T, index: number): ListEntry => {
    const el = document.createElement(tag);
    let textNode: Text | null = null;

    if (getText) {
      textNode = document.createTextNode(getText(item, index));
      el.appendChild(textNode);
    }
    if (getClass) (el as HTMLElement).className = getClass(item, index);
    if (getStyle) (el as HTMLElement).style.cssText = getStyle(item, index);
    if (getAttrs) {
      for (const [k, fn] of Object.entries(getAttrs)) el.setAttribute(k, fn(item, index));
    }
    if (getEvents) {
      for (const [k, fn] of Object.entries(getEvents)) el.addEventListener(k, fn(item, index));
    }

    return { node: el, textNode };
  };

  // Update an existing element in place — zero DOM creation
  const updateEntry = (entry: ListEntry, item: T, index: number): void => {
    if (getText && entry.textNode) entry.textNode.data = getText(item, index);
    if (getClass) (entry.node as HTMLElement).className = getClass(item, index);
    if (getStyle) (entry.node as HTMLElement).style.cssText = getStyle(item, index);
    if (getAttrs) {
      for (const [k, fn] of Object.entries(getAttrs)) entry.node.setAttribute(k, fn(item, index));
    }
  };

  const dispose = watch(() => {
    const items = getList() || [];
    const parent = endMarker.parentNode;
    if (!parent) return;

    const len = items.length;
    const prevLen = prevKeys.length;

    // Fast path: same keys — update in place
    if (len === prevLen) {
      let same = true;
      for (let i = 0; i < len; i++) {
        if (prevKeys[i] !== getKey(items[i], i)) {
          same = false;
          break;
        }
      }
      if (same) {
        for (let i = 0; i < len; i++) {
          updateEntry(keyToEntry.get(prevKeys[i])!, items[i], i);
        }
        return;
      }
    }

    // Fast path: clear all — per-node detach (matches each())
    if (len === 0) {
      for (let i = 0; i < prevLen; i++) {
        const entry = keyToEntry.get(prevKeys[i]);
        const p = entry?.node.parentNode;
        if (entry && p) p.removeChild(entry.node);
      }
      keyToEntry = new Map();
      prevKeys = [];
      return;
    }

    // Fast path: all new (first render) — single pass, no Map lookups
    if (prevLen === 0) {
      const newKeys2: unknown[] = new Array(len);
      const frag = document.createDocumentFragment();
      for (let i = 0; i < len; i++) {
        const item = items[i];
        newKeys2[i] = getKey(item, i);
        const entry = createEntry(item, i);
        keyToEntry.set(newKeys2[i], entry);
        frag.appendChild(entry.node);
      }
      parent.insertBefore(frag, endMarker);
      prevKeys = newKeys2;
      return;
    }

    const newKeys: unknown[] = new Array(len);
    const newEntries = new Map<unknown, ListEntry>();
    let reuseCount = 0;

    // Tight creation loop — NO function call overhead per item
    for (let i = 0; i < len; i++) {
      const item = items[i];
      const key = getKey(item, i);
      newKeys[i] = key;

      const _existing = keyToEntry.get(key);
      if (_existing) {
        const entry = _existing;
        updateEntry(entry, item, i);
        newEntries.set(key, entry);
        reuseCount++;
      } else {
        newEntries.set(key, createEntry(item, i));
      }
    }

    // Fast path: no reuse — bulk remove + bulk insert
    if (reuseCount === 0) {
      for (let i = 0; i < prevLen; i++) {
        const entry = keyToEntry.get(prevKeys[i]);
        const p = entry?.node.parentNode;
        if (entry && p) p.removeChild(entry.node);
      }
      const frag = document.createDocumentFragment();
      for (let i = 0; i < len; i++) frag.appendChild(newEntries.get(newKeys[i])!.node);
      parent.insertBefore(frag, endMarker);
      keyToEntry = newEntries;
      prevKeys = newKeys;
      return;
    }

    // Remove deleted
    if (reuseCount < prevLen) {
      const newKeySet = new Set(newKeys);
      for (let i = 0; i < prevLen; i++) {
        if (!newKeySet.has(prevKeys[i])) {
          const entry = keyToEntry.get(prevKeys[i]);
          if (entry?.node.parentNode) entry.node.parentNode.removeChild(entry.node);
        }
      }
    }

    // Reorder — append-only / prepend-only fast paths or LIS
    if (prevLen > 0 && len > 0) {
      let isAppend = len > prevLen;
      if (isAppend) {
        for (let i = 0; i < prevLen; i++) {
          if (prevKeys[i] !== newKeys[i]) {
            isAppend = false;
            break;
          }
        }
      }

      let isPrepend = !isAppend && len > prevLen;
      if (isPrepend) {
        const offset = len - prevLen;
        for (let i = 0; i < prevLen; i++) {
          if (prevKeys[i] !== newKeys[i + offset]) {
            isPrepend = false;
            break;
          }
        }
      }

      if (isAppend) {
        const frag = document.createDocumentFragment();
        for (let i = prevLen; i < len; i++) frag.appendChild(newEntries.get(newKeys[i])!.node);
        parent.insertBefore(frag, endMarker);
      } else if (isPrepend) {
        // Pure prepend — see each() for the reuseCount-equals-prevLen invariant.
        const newCount = len - prevLen;
        const frag = document.createDocumentFragment();
        for (let i = 0; i < newCount; i++) frag.appendChild(newEntries.get(newKeys[i])!.node);
        const firstExisting = newEntries.get(newKeys[newCount])!.node;
        parent.insertBefore(frag, firstExisting);
      } else {
        // LIS reorder
        const oldKeyIndex = new Map<unknown, number>();
        for (let i = 0; i < prevLen; i++) oldKeyIndex.set(prevKeys[i], i);

        const sources: number[] = [];
        const srcMap: number[] = new Array(len).fill(-1);
        for (let i = 0; i < len; i++) {
          const oi = oldKeyIndex.get(newKeys[i]);
          if (oi !== undefined) {
            sources.push(oi);
            srcMap[i] = sources.length - 1;
          }
        }

        const stableSet = new Set(lis(sources));
        let next: Node = endMarker;
        for (let i = len - 1; i >= 0; i--) {
          const entry = newEntries.get(newKeys[i])!;
          if (srcMap[i] === -1 || !stableSet.has(srcMap[i])) {
            parent.insertBefore(entry.node, next);
          }
          next = entry.node;
        }
      }
      /* v8 ignore start -- prevLen===0 caught by earlier fast path; len===0 caught above */
    } else {
      // All new — batch insert
      const frag = document.createDocumentFragment();
      for (let i = 0; i < len; i++) frag.appendChild(newEntries.get(newKeys[i])!.node);
      parent.insertBefore(frag, endMarker);
    }
    /* v8 ignore stop */

    keyToEntry = newEntries;
    prevKeys = newKeys;
  });

  // Auto-dispose watcher + clean up entries on component unmount
  const ctx = getCurrentContext();
  if (ctx) {
    (ctx.disposers ??= []).push(() => {
      dispose();
      keyToEntry.clear();
      prevKeys = [];
    });
  }

  return fragment;
}

// ---------------------------------------------------------------------------
// SSR variants — return branded HTML strings, no DOM, no watchers.
//
// These are pulled in by @purityjs/ssr's renderToString during server render.
// Each region is bracketed by start + end comment markers so the PR 4
// hydrator can locate control-flow boundaries on the parsed DOM:
//
//   match / when:  <!--m-->...<!--/m-->
//   each:          <!--e-->...<!--/e-->
//   list:          <!--l-->...<!--/l-->
//
// Accessors are called once. Returns from view/map functions are normalized
// via valueToHtml — which handles branded SSR HTML, primitives, arrays, and
// signal accessors transparently.
// ---------------------------------------------------------------------------

/**
 * SSR variant of {@link match}. Renders the matching case once, returns HTML.
 *
 * The boundary marker carries the rendered case key (URL-encoded) so the
 * client-side hydrator can tell whether to adopt the SSR-rendered subtree
 * (when the current key matches what SSR produced) or fall through to a
 * fresh render (data drift between server and client). Encoding follows
 * the same scheme as `eachSSR`'s row markers — see {@link encodeRowKey}.
 */
export function matchSSR<T extends string | number | boolean>(
  sourceFn: () => T,
  cases: Partial<Record<`${T}`, () => unknown>>,
  fallback?: () => unknown,
): SSRHtml {
  const key = String(sourceFn()) as `${T}`;
  const view = cases[key] ?? fallback;
  const inner = view ? valueToHtml(view()) : '';
  return markSSRHtml(`<!--m:${encodeRowKey(key)}-->${inner}<!--/m-->`);
}

/** SSR variant of {@link when}. Picks then/else once, returns HTML. */
export function whenSSR(
  conditionFn: () => boolean,
  thenFn: () => unknown,
  elseFn?: () => unknown,
): SSRHtml {
  const cond = conditionFn();
  const view = cond ? thenFn : elseFn;
  const inner = view ? valueToHtml(view()) : '';
  return markSSRHtml(`<!--m:${cond ? 'true' : 'false'}-->${inner}<!--/m-->`);
}

/**
 * SSR variant of {@link each}. Maps each item once, concatenates HTML.
 *
 * Each row is wrapped in `<!--er:KEY-->...<!--/er-->` markers so the client-
 * side hydrator can split the SSR output back into individual rows and
 * adopt their DOM in place when keys match the hydration items list. KEY
 * is the result of `keyFn(item, i)` (or the item itself when no keyFn is
 * supplied), encoded via {@link encodeRowKey} so it survives HTML comment
 * data restrictions. See ADR 0005 / `inflateDeferredEach`.
 */
export function eachSSR<T>(
  listAccessor: (() => T[]) | T[],
  mapFn: (item: () => T, index: number) => unknown,
  keyFn?: (item: T, index: number) => unknown,
): SSRHtml {
  const items = (typeof listAccessor === 'function' ? listAccessor() : listAccessor) || [];
  const getKey = keyFn ?? ((item: T, _i: number) => item as unknown);
  let inner = '';
  for (let i = 0; i < items.length; i++) {
    // Pass a frozen accessor so user code that calls `item()` works the same
    // shape as the client. No reactivity — the value is captured at render.
    const value = items[i];
    const accessor = () => value;
    const keyHex = encodeRowKey(getKey(value, i));
    inner += `<!--er:${keyHex}-->${valueToHtml(mapFn(accessor, i))}<!--/er-->`;
  }
  return markSSRHtml(`<!--e-->${inner}<!--/e-->`);
}

interface ListSSROptions<T> {
  text?: (item: T, index: number) => string;
  class?: (item: T, index: number) => string;
  style?: (item: T, index: number) => string;
  attrs?: Record<string, (item: T, index: number) => string>;
  events?: Record<string, (item: T, index: number) => (e: Event) => void>;
  key?: (item: T, index: number) => unknown;
}

/** SSR variant of {@link list}. Builds a flat list of single-tag rows as HTML. */
export function listSSR<T>(
  tag: string,
  listAccessor: (() => T[]) | T[],
  textOrOptions: ((item: T, index: number) => string) | ListSSROptions<T>,
  _keyFn?: (item: T, index: number) => unknown,
): SSRHtml {
  const items = (typeof listAccessor === 'function' ? listAccessor() : listAccessor) || [];
  let getText: ((item: T, index: number) => string) | undefined;
  let getClass: ((item: T, index: number) => string) | undefined;
  let getStyle: ((item: T, index: number) => string) | undefined;
  let getAttrs: Record<string, (item: T, index: number) => string> | undefined;

  if (typeof textOrOptions === 'function') {
    getText = textOrOptions;
  } else {
    getText = textOrOptions.text;
    getClass = textOrOptions.class;
    getStyle = textOrOptions.style;
    getAttrs = textOrOptions.attrs;
    // events skipped on the server — listeners attach during client hydration
  }

  let inner = '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let attrs = '';
    if (getClass) {
      const cls = getClass(item, i);
      if (cls) attrs += ` class="${escapeAttrLocal(cls)}"`;
    }
    if (getStyle) {
      const sty = getStyle(item, i);
      if (sty) attrs += ` style="${escapeAttrLocal(sty)}"`;
    }
    if (getAttrs) {
      for (const k of Object.keys(getAttrs)) {
        const v = getAttrs[k](item, i);
        if (v != null) attrs += ` ${k}="${escapeAttrLocal(v)}"`;
      }
    }
    const text = getText ? escapeHtmlLocal(getText(item, i)) : '';
    inner += `<${tag}${attrs}>${text}</${tag}>`;
  }
  return markSSRHtml(`<!--l-->${inner}<!--/l-->`);
}

// Local copies — escape helpers from ssr-runtime are imported indirectly via
// valueToHtml, but listSSR builds attribute markup directly without going
// through the converter. Inlining keeps control.ts free of cross-file calls
// in the hot path.
function escapeHtmlLocal(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttrLocal(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// suspense(view, fallback) — error-isolating render boundary
//
// Phase 1 of ADR 0006. The boundary serves two purposes today and one
// forward-compat purpose:
//
//   - **SSR error isolation.** If `view()` throws synchronously during
//     server render, the boundary catches the error, logs it, and emits
//     `fallback()` instead. The outer renderToString call still completes;
//     a single failing region can't take down the page.
//   - **Marker grammar in SSR output.** The rendered region is wrapped in
//     `<!--s:N--><!--/s:N-->` comment markers (N from the per-render
//     suspenseCounter on SSRRenderContext). The hydrate factory's
//     deferred-template inflate path strips these markers when carving
//     the slot's subtree.
//   - **Forward-compat for streaming (Phase 3).** The same markers will
//     let `__purity_swap(N)` find and replace each boundary's content as
//     it resolves over a `ReadableStream`.
//
// Per-boundary timeout / fallback-on-pending-resource is **not** in
// Phase 1 — see ADR 0006 for the staged plan. Today, view's resources
// share the outer renderToString resource-resolution loop.
// ---------------------------------------------------------------------------

/** Why `onError` was invoked. */
export type SuspenseErrorPhase = 'view' | 'fallback' | 'timeout';

/** Metadata passed to a `suspense({ onError })` callback. */
export interface SuspenseErrorInfo {
  /** Monotonic per-render boundary ID (matches the `<!--s:N-->` marker). */
  boundaryId: number;
  /**
   * What raised the error:
   *   * `'view'`     — `view()` threw synchronously; fallback is being rendered.
   *   * `'fallback'` — the fallback ALSO threw; an empty boundary is emitted.
   *   * `'timeout'`  — the per-boundary deadline fired; fallback is being rendered.
   *                    `error` is undefined for this phase.
   */
  phase: SuspenseErrorPhase;
}

/** Per-boundary options for `suspense()`. */
export interface SuspenseOptions {
  /**
   * Maximum ms `view()` may take before the boundary surrenders to its
   * fallback. Measured from the first SSR pass that encounters the
   * boundary. When unset, the boundary is bound only by the outer
   * renderToString timeout. The renderer races pending promises against
   * the soonest deadline; when a boundary times out the next pass
   * renders the fallback instead of the view.
   */
  timeout?: number;
  /**
   * Observer for per-boundary errors and timeouts. Receives the original
   * error (if any) plus a small info object. Use to forward to error
   * tracking (Sentry, Honeybadger, …) or to log richer context than
   * `console.error` does. The framework still emits its own
   * `console.error` after the hook returns, so the hook can replace
   * tracking but not silence the default log — use a separate logger
   * config for that.
   */
  onError?: (error: unknown, info: SuspenseErrorInfo) => void;
}

/**
 * Render `view()` with synchronous error isolation and an optional
 * per-boundary timeout. On error or timeout, render `fallback()` instead.
 * In SSR mode the rendered region is wrapped in `<!--s:N--><!--/s:N-->`
 * boundary markers; on the client this is just `view()` (the fallback is
 * unused — use `when()` against your resource's `loading()` accessor for
 * client loading states).
 *
 * @example
 * ```ts
 * suspense(
 *   () => html`<aside>${() => slowResource()}</aside>`,
 *   () => html`<aside class="loading">…</aside>`,
 *   { timeout: 1000 },
 * )
 * ```
 */
export function suspense<T>(
  view: () => T,
  fallback: () => T,
  options?: SuspenseOptions,
): T | SSRHtml {
  const ssrCtx = getSSRRenderContext();
  if (!ssrCtx) {
    // Client path — render the view; the fallback is forward-compat for
    // Phase 3 streaming where it shows while a streamed boundary is in
    // flight. For now it's unused.
    return view();
  }
  const id = ++ssrCtx.suspenseCounter;

  // Record the first-encounter time so deadlines stay anchored to pass 1
  // even when later passes re-execute view() with resolved data. If a
  // timeout is supplied, register the deadline once.
  if (!ssrCtx.boundaryStartTimes.has(id)) {
    const start = Date.now();
    ssrCtx.boundaryStartTimes.set(id, start);
    if (options?.timeout !== undefined) {
      ssrCtx.boundaryDeadlines.set(id, start + options.timeout);
    }
  }

  const onError = options?.onError;
  const reportError = (err: unknown, phase: SuspenseErrorPhase): void => {
    if (onError) {
      try {
        onError(err, { boundaryId: id, phase });
      } catch (hookErr) {
        // The hook itself threw — log but don't propagate; one bad reporter
        // shouldn't take down the whole render.
        console.error(
          `[Purity] suspense() onError hook threw (boundary ${id}, phase ${phase}):`,
          hookErr,
        );
      }
    }
  };

  const isTimedOut = ssrCtx.timedOutBoundaries.has(id);

  // Streaming branch (ADR 0006 Phase 3) — `renderToStream` flips
  // ssrCtx.streamingMode and provides a streamingBoundaries registry.
  // For each boundary we emit the fallback HTML in the shell and queue
  // the view (+ its fallback for re-render on timeout) for later
  // streaming, so the shell can flush immediately without awaiting the
  // boundary's resources. The marker grammar is identical — only the
  // body is the fallback rather than the resolved view.
  if (ssrCtx.streamingMode && ssrCtx.streamingBoundaries) {
    let body: string;
    if (isTimedOut) {
      reportError(undefined, 'timeout');
      try {
        body = valueToHtml(fallback());
      } catch (fallbackErr) {
        reportError(fallbackErr, 'fallback');
        body = '';
      }
    } else {
      try {
        body = valueToHtml(fallback());
      } catch (fallbackErr) {
        reportError(fallbackErr, 'fallback');
        console.error(
          `[Purity] suspense() shell fallback threw (boundary ${id}); emitting empty fallback:`,
          fallbackErr,
        );
        body = '';
      }
      // Don't queue boundaries that already timed out — the shell already
      // shows their fallback; there's nothing left to stream.
      ssrCtx.streamingBoundaries.set(id, {
        view: view as () => unknown,
        fallback: fallback as () => unknown,
        onError,
      });
    }
    return markSSRHtml(`<!--s:${id}-->${body}<!--/s:${id}-->`);
  }

  let body: string;
  if (isTimedOut) {
    reportError(undefined, 'timeout');
    try {
      body = valueToHtml(fallback());
    } catch (fallbackErr) {
      reportError(fallbackErr, 'fallback');
      console.error(
        `[Purity] suspense() fallback threw after timeout (boundary ${id}); emitting empty boundary:`,
        fallbackErr,
      );
      body = '';
    }
  } else {
    try {
      body = valueToHtml(view());
    } catch (err) {
      reportError(err, 'view');
      console.error(
        `[Purity] suspense() view threw during SSR (boundary ${id}); rendering fallback:`,
        err,
      );
      try {
        body = valueToHtml(fallback());
      } catch (fallbackErr) {
        reportError(fallbackErr, 'fallback');
        // Fallback also threw — emit an empty boundary rather than blowing
        // up the entire render. The error logs above identify the boundary.
        console.error(
          `[Purity] suspense() fallback also threw (boundary ${id}); emitting empty boundary:`,
          fallbackErr,
        );
        body = '';
      }
    }
  }
  return markSSRHtml(`<!--s:${id}-->${body}<!--/s:${id}-->`);
}
