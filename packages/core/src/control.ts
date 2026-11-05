import {
  disposeScope,
  getCurrentComponent,
  getCurrentContext,
  popContext,
  pushContext,
  type Scope,
  type ComponentContext,
  state as createState,
  type StateAccessor,
  watchEffectInternal,
} from '@purityjs/signals';
import { warnDuplicateKey } from './control/keys.ts';
import {
  captureHydratingEach,
  captureHydratingMatch,
  ENABLE_SSR,
  isHydratingPassive,
  setSlotNodesReplaced,
  type SSRHtml,
} from './hooks.ts';
import { ssrControls } from './control/dispatch.ts';
import { getSSRRenderContext } from './ssr/state.ts';

// ---------------------------------------------------------------------------
// State-preserving DOM moves (ADR 0037)
// ---------------------------------------------------------------------------

const hasMoveBefore =
  typeof Element !== 'undefined' &&
  typeof (Element.prototype as { moveBefore?: unknown }).moveBefore === 'function';

type MovableParent = Node & { moveBefore: (node: Node, ref: Node | null) => void };

function moveOrInsert(parent: Node, node: Node, ref: Node | null): void {
  if (hasMoveBefore && node.parentNode === parent) {
    try {
      (parent as MovableParent).moveBefore(node, ref);
      return;
    } catch {
      /* fall through */
    }
  }
  parent.insertBefore(node, ref);
}

// ---------------------------------------------------------------------------
// match(sourceFn, cases, fallback?) — reactive pattern matching
// ---------------------------------------------------------------------------

export type MatchView = () => unknown;
export type MatchCases<T extends string | number | boolean> = Partial<Record<`${T}`, MatchView>>;

interface NodeOwner {
  nodes: Node[];
}

export interface MatchState extends NodeOwner {
  prevKey: string | null;
  branch: Scope | null;
}

export interface DeferredMatch<T extends string | number | boolean = string | number | boolean> {
  __purity_deferred_match__: true;
  sourceFn: () => T;
  cases: MatchCases<T>;
  fallback?: MatchView;
}

const nodeOwners = new WeakMap<Node, NodeOwner | Set<NodeOwner>>();

function trackOwnedNodes(state: NodeOwner, nodes: Node[]): void {
  for (const node of nodes) {
    const owners = nodeOwners.get(node);
    if (!owners) nodeOwners.set(node, state);
    else if (owners instanceof Set) owners.add(state);
    else if (owners !== state) nodeOwners.set(node, new Set([owners, state]));
  }
}

function untrackOwnedNodes(state: NodeOwner, nodes: Node[]): void {
  for (const node of nodes) {
    const owners = nodeOwners.get(node);
    if (owners === state) nodeOwners.delete(node);
    else if (owners instanceof Set) {
      owners.delete(state);
      if (owners.size === 1) nodeOwners.set(node, owners.values().next().value!);
      else if (owners.size === 0) nodeOwners.delete(node);
    }
  }
}

/** @internal */
export function replaceOwnedNodes(oldNodes: Node[], newNodes: Node[]): void {
  const old = new Set(oldNodes);
  const affected = new Set<NodeOwner>();
  for (const node of oldNodes) {
    const owners = nodeOwners.get(node);
    if (owners instanceof Set) for (const owner of owners) affected.add(owner);
    else if (owners) affected.add(owners);
  }
  for (const owner of affected) {
    const index = owner.nodes.findIndex((node) => old.has(node));
    if (index === -1) continue;
    untrackOwnedNodes(owner, oldNodes);
    const remaining = owner.nodes.filter((node) => !old.has(node));
    owner.nodes = [...remaining.slice(0, index), ...newNodes, ...remaining.slice(index)];
    trackOwnedNodes(owner, newNodes);
  }
}

function renderBranch(matchState: MatchState, render: () => unknown): unknown {
  const scope: Scope = { disposers: null };
  matchState.branch = scope;
  pushContext(scope);
  try {
    return render();
  } catch (e) {
    matchState.prevKey = null;
    disposeBranch(matchState);
    throw e;
  } finally {
    popContext();
  }
}

function disposeBranch(matchState: MatchState): void {
  const scope = matchState.branch;
  if (scope === null) return;
  matchState.branch = null;
  untrackOwnedNodes(matchState, matchState.nodes);
  disposeScope(scope);
}

function insertMatchView(
  matchState: MatchState,
  parent: Node,
  endMarker: Node,
  content: unknown,
): void {
  if (content == null) {
    replaceOwnedNodes(matchState.nodes, []);
    matchState.nodes = [];
    return;
  }
  const nodes = extractNodes(content as Node | DocumentFragment | string);
  replaceOwnedNodes(matchState.nodes, nodes);
  matchState.nodes = nodes;
  trackOwnedNodes(matchState, nodes);
  setSlotNodesReplaced(replaceOwnedNodes);
  parent.insertBefore(content instanceof Node ? content : nodes[0], endMarker);
}

function reconcileMatch<T extends string | number | boolean>(
  matchState: MatchState,
  parent: Node,
  endMarker: Node,
  sourceFn: () => T,
  cases: MatchCases<T>,
  fallback?: MatchView,
): void {
  for (let runs = 0; ;) {
    detachNodes(matchState.nodes);
    disposeBranch(matchState);
    const key = String(sourceFn());
    matchState.prevKey = key;

    const viewFn = cases[key as `${T}`] ?? fallback;
    if (!viewFn) {
      replaceOwnedNodes(matchState.nodes, []);
      matchState.nodes = [];
      return;
    }
    insertMatchView(matchState, parent, endMarker, renderBranch(matchState, viewFn));
    if (String(sourceFn()) === key) return;
    if (++runs > 100) {
      console.error('[Purity] match() selector did not settle.');
      return;
    }
  }
}

function installMatchWatch<T extends string | number | boolean>(
  matchState: MatchState,
  endMarker: Node,
  sourceFn: () => T,
  cases: MatchCases<T>,
  fallback?: MatchView,
): () => void {
  return watchEffectInternal(() => {
    const key = String(sourceFn()) as `${T}`;
    if (key === matchState.prevKey) return;
    const parent = endMarker.parentNode;
    /* v8 ignore next */
    if (!parent) return;
    reconcileMatch(matchState, parent, endMarker, sourceFn, cases, fallback);
  });
}

function registerMatchAutoDispose(
  ownerCtx: Scope | null,
  dispose: () => void,
  matchState: MatchState,
  endMarker: Node,
): void {
  if (!ownerCtx) return;
  const component = getCurrentComponent();
  (ownerCtx.disposers ??= []).push(() => {
    dispose();
    if (removeOwnedNodesOnDispose(component, endMarker)) {
      detachNodes(matchState.nodes);
      endMarker.parentNode?.removeChild(endMarker);
    }
    disposeBranch(matchState);
    matchState.nodes = [];
  });
}

export interface MatchHydrationAdapter<T extends string | number | boolean = any> {
  renderBranch: typeof renderBranch;
  insertMatchView: typeof insertMatchView;
  finish(
    ownerCtx: Scope | null,
    matchState: MatchState,
    endMarker: Node,
    sourceFn: () => T,
    cases: MatchCases<T>,
    fallback?: MatchView,
  ): void;
}

const matchHydrationAdapter: MatchHydrationAdapter = {
  renderBranch,
  insertMatchView,
  finish(ownerCtx, matchState, endMarker, sourceFn, cases, fallback) {
    const dispose = installMatchWatch(matchState, endMarker, sourceFn, cases, fallback);
    registerMatchAutoDispose(ownerCtx, dispose, matchState, endMarker);
  },
};

/**
 * Reactive pattern matching. Renders different content based on a signal value.
 */
export function match<T extends string | number | boolean>(
  sourceFn: () => T,
  cases: MatchCases<T>,
  fallback?: MatchView,
): DocumentFragment | DeferredMatch<T> | SSRHtml {
  if (isHydratingPassive() && captureHydratingMatch) {
    return captureHydratingMatch(
      sourceFn,
      cases,
      fallback,
      matchHydrationAdapter as unknown as never,
    ) as DeferredMatch<T>;
  }

  if (ENABLE_SSR && getSSRRenderContext()) {
    return ssrControls.match(sourceFn, cases, fallback);
  }

  const endMarker = document.createComment('m');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(endMarker);

  const matchState: MatchState = { nodes: [], prevKey: null, branch: null };

  const initKey = String(sourceFn()) as `${T}`;
  const initView = cases[initKey] ?? fallback;
  if (initView) {
    matchState.prevKey = initKey;
    insertMatchView(matchState, fragment, endMarker, renderBranch(matchState, initView));
  }

  const dispose = installMatchWatch(matchState, endMarker, sourceFn, cases, fallback);
  registerMatchAutoDispose(getCurrentContext(), dispose, matchState, endMarker);
  return fragment;
}

/**
 * Conditional rendering. Shorthand for boolean `match()`.
 */
export function when(
  conditionFn: () => boolean,
  thenFn: MatchView,
  elseFn?: MatchView,
): DocumentFragment | SSRHtml {
  if (ENABLE_SSR && getSSRRenderContext()) {
    return ssrControls.when(conditionFn, thenFn, elseFn);
  }
  return match(conditionFn, { true: thenFn, false: elseFn }) as DocumentFragment;
}

// ---------------------------------------------------------------------------
// LIS (Longest Increasing Subsequence) — O(n log n) minimal DOM moves
// ---------------------------------------------------------------------------

function lis(arr: number[]): number[] {
  const len = arr.length;
  const tails: number[] = [];
  const predecessor: number[] = new Array(len);

  for (let i = 0; i < len; i++) {
    const val = arr[i];
    if (val === -1) continue;

    if (tails.length === 0 || val > arr[tails[tails.length - 1]]) {
      predecessor[i] = tails[tails.length - 1];
      tails.push(i);
      continue;
    }

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

  const result: number[] = new Array(tails.length);
  let k = tails[tails.length - 1];
  for (let i = result.length - 1; i >= 0; i--) {
    result[i] = k;
    k = predecessor[k];
  }

  return result;
}

// ---------------------------------------------------------------------------
// each(listAccessor, mapFn, keyFn?) — keyed/unkeyed list rendering
// (Virtual windowing lives in `@purityjs/core/virtual` as `virtualEach`.)
// ---------------------------------------------------------------------------

/** @internal */
export interface EachEntry<T = unknown> extends Scope {
  nodes: Node[];
  data: StateAccessor<T>;
}

/** @internal */
export function trackEntry<T>(entry: EachEntry<T>): void {
  trackOwnedNodes(entry, entry.nodes);
  setSlotNodesReplaced(replaceOwnedNodes);
}

/** @internal */
export function disposeEntry<T>(entry: EachEntry<T>): void {
  untrackOwnedNodes(entry, entry.nodes);
  disposeScope(entry);
}

/** @internal */
export interface KeyedEntry {
  nodes: Node[];
}

/** @internal */
export interface RowOps<T, E extends KeyedEntry> {
  create(item: T, index: number): E;
  update(entry: E, item: T, index: number): void;
  release(entry: E): void;
  api?: string;
}

/** @internal */
export function eachRowOps<T>(
  mapFn: (item: () => T, index: number) => Node | DocumentFragment | string,
): RowOps<T, EachEntry<T>> {
  return {
    create(item, index) {
      const data = createState(item);
      const entry: EachEntry<T> = { nodes: [], data, disposers: null };
      pushContext(entry);
      let content: Node | DocumentFragment | string;
      try {
        try {
          content = mapFn(data, index);
        } finally {
          popContext();
        }
      } catch (error) {
        disposeScope(entry);
        throw error;
      }
      entry.nodes = extractNodes(content);
      trackEntry(entry);
      return entry;
    },
    update(entry, item) {
      entry.data(item);
    },
    release: disposeEntry,
  };
}

function canReplaceOwnedRange(
  parent: Node,
  prevKeys: unknown[],
  keyToEntry: Map<unknown, KeyedEntry>,
  endMarker: Node,
): boolean {
  const firstEntry = keyToEntry.get(prevKeys[0]);
  return (
    prevKeys.length > 32 &&
    !!firstEntry &&
    firstEntry.nodes[0]?.parentNode === parent &&
    firstEntry.nodes[0] === parent.firstChild &&
    endMarker.parentNode === parent &&
    endMarker.nextSibling === null &&
    'replaceChildren' in parent
  );
}

function bulkClear<E extends KeyedEntry>(
  parent: Node,
  prevKeys: unknown[],
  keyToEntry: Map<unknown, E>,
  endMarker: Node,
  release: (entry: E) => void,
): void {
  const prevLen = prevKeys.length;
  if (prevLen === 0) return;

  const canReplaceChildren = canReplaceOwnedRange(parent, prevKeys, keyToEntry, endMarker);
  if (canReplaceChildren) {
    (parent as ParentNode).replaceChildren(endMarker);
  }

  for (let i = 0; i < prevLen; i++) {
    const entry = keyToEntry.get(prevKeys[i]);
    if (!entry) continue;
    if (!canReplaceChildren) detachNodes(entry.nodes);
    release(entry);
  }
}

/** @internal */
export function extractNodes(content: Node | DocumentFragment | string): Node[] {
  if (content instanceof DocumentFragment) {
    const fc = content.firstChild;
    if (fc && !fc.nextSibling) return [fc];
    return Array.from(content.childNodes);
  }
  if (content instanceof Node) return [content];
  return [document.createTextNode(String(content ?? ''))];
}

/** @internal */
export function detachNodes(nodes: Node[]): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    node.parentNode?.removeChild(node);
  }
}

/** @internal */
export interface EachState<T, E extends KeyedEntry = EachEntry<T>> {
  keyToEntry: Map<unknown, E>;
  /** Row keys in DOM order. `keyToEntry` insertion order is not maintained. */
  keys: unknown[];
}

/** @internal */
function ownedEntryNodes<T, E extends KeyedEntry>(state: EachState<T, E>): Node[] {
  const nodes: Node[] = [];
  const { keys, keyToEntry } = state;
  for (let i = 0; i < keys.length; i++) nodes.push(...keyToEntry.get(keys[i])!.nodes);
  return nodes;
}

/** @internal */
export function reconcileEach<T, E extends KeyedEntry>(
  eachState: EachState<T, E>,
  items: T[],
  parent: Node,
  endMarker: Node,
  getKey: (item: T, index: number) => unknown,
  ops: RowOps<T, E>,
): void {
  const len = items.length;
  const prevKeys = eachState.keys;
  const keys: unknown[] = [];
  let same = len === prevKeys.length;
  for (let i = 0; i < len; i++) {
    const key = getKey(items[i], i);
    keys.push(key);
    same &&= key === prevKeys[i];
  }
  // Same keys in the same order: no row is created, removed or moved, so the
  // owner node lists stay valid and need no rewrite (CQ-02).
  if (same) {
    for (let i = 0; i < len; i++) ops.update(eachState.keyToEntry.get(keys[i])!, items[i], i);
    return;
  }
  const owners = nodeOwners.get(endMarker);
  const containers = owners instanceof Set ? [...owners] : owners ? [owners] : null;
  const oldNodes = owners ? ownedEntryNodes(eachState) : null;
  reconcileKeys(eachState, items, keys, parent, endMarker, ops);
  if (!containers || !oldNodes) return;
  const old = new Set(oldNodes);
  const next = ownedEntryNodes(eachState);
  for (const owner of containers) {
    const currentOwners = nodeOwners.get(endMarker);
    if (currentOwners !== owner && !(currentOwners instanceof Set && currentOwners.has(owner)))
      continue;
    const remaining = owner.nodes.filter((node) => !old.has(node));
    const marker = remaining.indexOf(endMarker);
    if (marker === -1) continue;
    untrackOwnedNodes(owner, oldNodes);
    owner.nodes = [...remaining.slice(0, marker), ...next, ...remaining.slice(marker)];
    trackOwnedNodes(owner, next);
  }
}

function reconcileKeys<T, E extends KeyedEntry>(
  eachState: EachState<T, E>,
  items: T[],
  keys: unknown[],
  parent: Node,
  endMarker: Node,
  ops: RowOps<T, E>,
): void {
  const len = items.length;
  const { keyToEntry } = eachState;
  const prevKeys = eachState.keys;
  const prevLen = prevKeys.length;

  const newKeys: unknown[] = [];
  const newEntries = new Map<unknown, E>();
  const initialFragment = prevLen === 0 ? document.createDocumentFragment() : null;
  const sourceIndices: number[] = [];
  let reuseCount = 0;

  try {
    for (let i = 0; i < len; i++) {
      const key = keys[i];
      if (newEntries.has(key)) {
        warnDuplicateKey(key, i, ops.api);
        continue;
      }
      sourceIndices.push(i);
      newKeys.push(key);

      const existing = keyToEntry.get(key);
      if (existing) {
        newEntries.set(key, existing);
        reuseCount++;
      } else {
        const entry = ops.create(items[i], i);
        initialFragment?.append(...entry.nodes);
        newEntries.set(key, entry);
      }
    }
    if (reuseCount > 0) {
      for (let i = 0; i < newKeys.length; i++) {
        const existing = keyToEntry.get(newKeys[i]);
        if (existing) {
          const index = sourceIndices[i];
          ops.update(existing, items[index], index);
        }
      }
    }
  } catch (error) {
    for (const [key, entry] of newEntries) {
      if (!keyToEntry.has(key)) ops.release(entry);
    }
    throw error;
  }

  const newLen = newKeys.length;
  eachState.keyToEntry = newEntries;
  eachState.keys = newKeys;

  if (reuseCount === 0) {
    bulkClear(parent, prevKeys, keyToEntry, endMarker, ops.release);
    if (initialFragment) parent.insertBefore(initialFragment, endMarker);
    else {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < newLen; i++) frag.append(...newEntries.get(newKeys[i])!.nodes);
      parent.insertBefore(frag, endMarker);
    }
    return;
  }

  // Trim the equal head and tail (as Solid's reconcileArrays): only rows in
  // the changed window are released, indexed and moved.
  let start = 0;
  while (start < newLen && start < prevLen && newKeys[start] === prevKeys[start]) start++;
  let oldEnd = prevLen;
  let newEnd = newLen;
  while (oldEnd > start && newEnd > start && newKeys[newEnd - 1] === prevKeys[oldEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  const oldKeyIndex = new Map<unknown, number>();
  for (let i = start; i < oldEnd; i++) {
    const key = prevKeys[i];
    if (newEntries.has(key)) oldKeyIndex.set(key, i);
    else {
      const entry = keyToEntry.get(key)!;
      detachNodes(entry.nodes);
      ops.release(entry);
    }
  }

  const sources = newKeys.slice(start, newEnd).map((key) => oldKeyIndex.get(key) ?? -1);
  const stay = lis(sources);
  let s = stay.length - 1;

  // The anchor is the first node of the retained tail. Rows may render no
  // nodes (an empty fragment), so walk the tail back to its first real node.
  let nextSibling: Node = endMarker;
  for (let i = newLen; i-- > newEnd;)
    nextSibling = newEntries.get(newKeys[i])!.nodes[0] || nextSibling;
  let batch: DocumentFragment | null = null;
  let batchTarget = nextSibling;

  // Walk the window backwards. LIS rows stay; existing rows move with
  // moveBefore where available; new rows and the fallback batch into one
  // fragment per run.
  for (let j = newEnd - start - 1; j >= 0; j--) {
    const nodes = newEntries.get(newKeys[start + j])!.nodes;
    const stays = s >= 0 && stay[s] === j;
    if (stays) s--;
    if (!stays && (!hasMoveBefore || sources[j] < 0)) {
      if (!batch) {
        batch = document.createDocumentFragment();
        batchTarget = nextSibling;
      }
      batch.prepend(...nodes);
    } else {
      if (batch) parent.insertBefore(batch, batchTarget);
      batch = null;
      if (!stays)
        for (let k = 0; k < nodes.length; k++) moveOrInsert(parent, nodes[k], nextSibling);
    }
    nextSibling = nodes[0] || nextSibling;
  }
  if (batch) parent.insertBefore(batch, batchTarget);
}

/** @internal */
function removeOwnedNodesOnDispose(component: ComponentContext | null, marker: Node): boolean {
  if (!component?._isDestroyed) return marker.parentNode === null;
  if (component.nodes !== null) return false;
  let owner: ComponentContext | null | undefined = component;
  while (owner && owner._rootContainer == null) owner = owner.parent;
  return marker.parentNode === null || marker.parentNode === owner?._rootContainer;
}

export function registerEachAutoDispose<T, E extends KeyedEntry>(
  ownerCtx: Scope | null,
  dispose: () => void,
  eachState: EachState<T, E>,
  endMarker: Node,
  release: (entry: E) => void,
  removeExtras?: () => void,
): void {
  if (!ownerCtx) return;
  const component = getCurrentComponent();
  (ownerCtx.disposers ??= []).push(() => {
    dispose();
    const remove = removeOwnedNodesOnDispose(component, endMarker);
    for (const entry of eachState.keyToEntry.values()) {
      if (remove) detachNodes(entry.nodes);
      release(entry);
    }
    if (remove) {
      removeExtras?.();
      endMarker.parentNode?.removeChild(endMarker);
    }
    eachState.keyToEntry.clear();
    eachState.keys = [];
  });
}

export interface DeferredEach<T = unknown> {
  __purity_deferred_each__: true;
  listAccessor: (() => T[]) | T[];
  mapFn: (item: () => T, index: number) => Node | DocumentFragment | string;
  keyFn?: (item: T, index: number) => unknown;
}

export interface EachHydrationAdapter<T = any> {
  warnDuplicateKey: typeof warnDuplicateKey;
  track(entry: EachEntry<T>): void;
  release(entry: EachEntry<T>): void;
  finish(
    ownerCtx: Scope | null,
    eachState: EachState<T>,
    getList: () => T[],
    mapFn: (item: () => T, index: number) => Node | DocumentFragment | string,
    getKey: (item: T, index: number) => unknown,
    parent: Node,
    endMarker: Node,
  ): void;
}

export const defaultEachHydrationAdapter: EachHydrationAdapter = {
  warnDuplicateKey,
  track: trackEntry,
  release: disposeEntry,
  finish(ownerCtx, eachState, getList, mapFn, getKey, _parent, endMarker) {
    const ops = eachRowOps(mapFn);
    const dispose = watchEffectInternal(() => {
      const next = getList() || [];
      const p = endMarker.parentNode;
      if (!p) return;
      reconcileEach(eachState, next, p, endMarker, getKey, ops);
    });
    registerEachAutoDispose(ownerCtx, dispose, eachState, endMarker, disposeEntry);
  },
};

/**
 * Reactive list rendering. Reuses DOM via per-item signals + LIS reorder.
 * For virtualized viewport windowing of massive lists, use `virtualEach` from `@purityjs/core/virtual`.
 */
export function each<T>(
  listAccessor: (() => T[]) | T[],
  mapFn: (item: () => T, index: number) => Node | DocumentFragment | string,
  keyFn?: (item: T, index: number) => unknown,
): DocumentFragment | DeferredEach<T> | SSRHtml {
  if (isHydratingPassive() && captureHydratingEach) {
    return captureHydratingEach(
      listAccessor,
      mapFn,
      keyFn,
      defaultEachHydrationAdapter,
    ) as DeferredEach<T>;
  }

  if (ENABLE_SSR && getSSRRenderContext()) {
    return ssrControls.each(listAccessor, mapFn, keyFn);
  }

  const endMarker = document.createComment('e');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(endMarker);

  const eachState: EachState<T> = { keyToEntry: new Map(), keys: [] };
  const getList =
    typeof listAccessor === 'function' ? (listAccessor as () => T[]) : () => listAccessor;
  const getKey = keyFn ?? ((item: T, _i: number) => item as unknown);
  const ops = eachRowOps(mapFn);

  const dispose = watchEffectInternal(() => {
    const items = getList() || [];
    const parent = endMarker.parentNode;
    if (!parent) return;
    reconcileEach(eachState, items, parent, endMarker, getKey, ops);
  });

  registerEachAutoDispose(getCurrentContext(), dispose, eachState, endMarker, disposeEntry);
  return fragment;
}

// ---------------------------------------------------------------------------
// list() — fastest possible single-element list rendering
// ---------------------------------------------------------------------------

export interface ListOptions<T> {
  text?: (item: T, index: number) => string;
  class?: (item: T, index: number) => string;
  style?: (item: T, index: number) => string;
  attrs?: Record<string, (item: T, index: number) => string>;
  events?: Record<string, (item: T, index: number) => (e: Event) => void>;
  key?: (item: T, index: number) => unknown;
}

type ListTextFn<T> = (item: T, index: number) => string;

interface ListEntry extends KeyedEntry {
  nodes: [Element];
  textNode: Text | null;
  boundEvents: Map<string, EventListener> | null;
}

export function list<T>(
  tag: string,
  listAccessor: (() => T[]) | T[],
  textOrOptions: ListTextFn<T> | ListOptions<T>,
  keyFnOrNothing?: (item: T, index: number) => unknown,
): DocumentFragment {
  const endMarker = document.createComment('l');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(endMarker);

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

  const listState: EachState<T, ListEntry> = { keyToEntry: new Map(), keys: [] };
  const getList =
    typeof listAccessor === 'function' ? (listAccessor as () => T[]) : () => listAccessor;

  const safeCall = <R>(
    fn: (item: T, index: number) => R,
    item: T,
    index: number,
    label: string,
    key: string,
  ): R | undefined => {
    try {
      return fn(item, index);
    } catch (err) {
      console.error(`[Purity] list() ${label}[${key}] threw for row ${index}:`, err);
      return undefined;
    }
  };

  const createEntry = (item: T, index: number): ListEntry => {
    const el = document.createElement(tag);
    let textNode: Text | null = null;

    if (getText) {
      textNode = document.createTextNode(getText(item, index));
      el.appendChild(textNode);
    }
    const entry: ListEntry = { nodes: [el], textNode, boundEvents: null };
    applyEntry(entry, item, index, true);
    return entry;
  };

  const applyEntry = (entry: ListEntry, item: T, index: number, initial = false): void => {
    const node = entry.nodes[0];
    if (!initial && getText && entry.textNode) entry.textNode.data = getText(item, index);
    if (getClass) (node as HTMLElement).className = getClass(item, index);
    if (getStyle) (node as HTMLElement).style.cssText = getStyle(item, index);
    if (getAttrs) {
      for (const [k, fn] of Object.entries(getAttrs)) {
        const v = safeCall(fn, item, index, 'getAttrs', k);
        if (v != null) node.setAttribute(k, v);
        else if (!initial) node.removeAttribute(k);
      }
    }
    if (getEvents) {
      const prev = entry.boundEvents;
      if (prev) {
        for (const [k, h] of prev) node.removeEventListener(k, h);
        prev.clear();
      }
      const next = prev ?? new Map<string, EventListener>();
      for (const [k, fn] of Object.entries(getEvents)) {
        const handler = safeCall(fn, item, index, 'getEvents', k);
        if (typeof handler === 'function') {
          node.addEventListener(k, handler);
          next.set(k, handler);
        }
      }
      entry.boundEvents = next;
    }
  };

  const releaseEntry = (entry: ListEntry): void => {
    const events = entry.boundEvents;
    if (!events) return;
    for (const [k, h] of events) entry.nodes[0].removeEventListener(k, h);
    events.clear();
    entry.boundEvents = null;
  };

  const ops: RowOps<T, ListEntry> = {
    create: createEntry,
    update: applyEntry,
    release: releaseEntry,
    api: 'list()',
  };
  const dispose = watchEffectInternal(() => {
    const items = getList() || [];
    const parent = endMarker.parentNode;
    if (parent) reconcileEach(listState, items, parent, endMarker, getKey, ops);
  });

  registerEachAutoDispose(getCurrentContext(), dispose, listState, endMarker, releaseEntry);

  return fragment;
}

// ---------------------------------------------------------------------------
// suspense(view, fallback) — error-isolating render boundary
// ---------------------------------------------------------------------------

export type SuspenseErrorPhase = 'view' | 'fallback' | 'timeout';

export interface SuspenseErrorInfo {
  boundaryId: number;
  phase: SuspenseErrorPhase;
}

export interface SuspenseOptions {
  timeout?: number;
  onError?: (error: unknown, info: SuspenseErrorInfo) => void;
}

export function suspense<T>(
  view: () => T,
  fallback: () => T,
  options?: SuspenseOptions,
): T | SSRHtml {
  return ENABLE_SSR && getSSRRenderContext()
    ? ssrControls.suspense(view, fallback, options)
    : view();
}
