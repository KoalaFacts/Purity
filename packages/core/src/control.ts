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
  for (let i = 0; i < keys.length; i++) {
    const rowNodes = keyToEntry.get(keys[i])!.nodes;
    for (let j = 0; j < rowNodes.length; j++) nodes.push(rowNodes[j]);
  }
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
  const nextKeys: unknown[] = [];
  let same = len === prevKeys.length;
  for (let i = 0; i < len; i++) {
    const key = getKey(items[i], i);
    nextKeys.push(key);
    if (same && key !== prevKeys[i]) same = false;
  }
  // Same keys in the same order: no row is created, removed or moved, so the
  // owner node lists stay valid and need no rewrite (CQ-02).
  if (same) {
    const { keyToEntry } = eachState;
    for (let i = 0; i < len; i++) ops.update(keyToEntry.get(prevKeys[i])!, items[i], i);
    return;
  }
  const owners = nodeOwners.get(endMarker);
  if (!owners) {
    reconcileKeys(eachState, items, nextKeys, parent, endMarker, ops, null);
    return;
  }
  const containers = owners instanceof Set ? [...owners] : [owners];
  const oldNodes = ownedEntryNodes(eachState);
  const diff: RowDiff = { added: [], removed: [], all: false };
  reconcileKeys(eachState, items, nextKeys, parent, endMarker, ops, diff);
  const next = ownedEntryNodes(eachState);
  const oldLen = oldNodes.length;
  let old: Set<Node> | null = null;
  for (const owner of containers) {
    const currentOwners = nodeOwners.get(endMarker);
    if (currentOwners !== owner && !(currentOwners instanceof Set && currentOwners.has(owner)))
      continue;
    const nodes = owner.nodes;
    const marker = nodes.lastIndexOf(endMarker);
    if (marker === -1) continue;
    const from = marker - oldLen;
    if (
      !diff.all &&
      from >= 0 &&
      (oldLen === 0 || (nodes[from] === oldNodes[0] && nodes[marker - 1] === oldNodes[oldLen - 1]))
    ) {
      // The rows sit as one run just before the end marker: splice the run and
      // re-track only the rows this reconcile added or removed.
      owner.nodes = nodes.slice(0, from).concat(next, nodes.slice(marker));
      untrackOwnedNodes(owner, diff.removed);
      trackOwnedNodes(owner, diff.added);
      continue;
    }
    old ??= new Set(oldNodes);
    const remaining = nodes.filter((node) => !old!.has(node));
    const at = remaining.indexOf(endMarker);
    if (at === -1) continue;
    untrackOwnedNodes(owner, oldNodes);
    owner.nodes = [...remaining.slice(0, at), ...next, ...remaining.slice(at)];
    trackOwnedNodes(owner, next);
  }
}

/** Nodes of the rows one reconcile added and removed; `all` marks a full replace. */
interface RowDiff {
  added: Node[];
  removed: Node[];
  all: boolean;
}

function pushNodes(target: Node[], nodes: Node[]): void {
  for (let k = 0; k < nodes.length; k++) target.push(nodes[k]);
}

// Window-map values: an unclaimed old row stores its old index (>= 0), a
// claimed old row stores `CLAIMED - oldIndex`, a new row stores NEW_ROW.
const NEW_ROW = -1;
const CLAIMED = -2;

function reconcileKeys<T, E extends KeyedEntry>(
  eachState: EachState<T, E>,
  items: T[],
  nextKeys: unknown[],
  parent: Node,
  endMarker: Node,
  ops: RowOps<T, E>,
  diff: RowDiff | null,
): void {
  const { keyToEntry } = eachState;
  const prevKeys = eachState.keys;
  const prevLen = prevKeys.length;
  const len = items.length;

  if (len === 0) {
    if (diff) diff.all = true;
    bulkClear(parent, prevKeys, keyToEntry, endMarker, ops.release);
    keyToEntry.clear();
    eachState.keys = [];
    return;
  }

  // Trim the common head and tail (Solid's reconcileArrays does the same):
  // only the changed window is indexed, diffed and moved. Head and tail keys
  // match unique previous keys, so they cannot be duplicates.
  const min = len < prevLen ? len : prevLen;
  let start = 0;
  while (start < min && nextKeys[start] === prevKeys[start]) start++;
  let oldEnd = prevLen;
  let newEnd = len;
  while (oldEnd > start && newEnd > start && nextKeys[newEnd - 1] === prevKeys[oldEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  let win: Map<unknown, number>;
  let winKeys: unknown[];
  let winItems: number[];
  let sources: number[];
  let dupes: number[] | null;
  let reused: number;
  scan: for (;;) {
    win = new Map();
    for (let i = start; i < oldEnd; i++) win.set(prevKeys[i], i);
    winKeys = [];
    winItems = [];
    sources = [];
    dupes = null;
    reused = 0;
    for (let i = start; i < newEnd; i++) {
      const key = nextKeys[i];
      const v = win.get(key);
      if (v === undefined) {
        if (keyToEntry.has(key)) {
          // The key's row sits in the trimmed head or tail. A tail match is a
          // later occurrence, so first-occurrence-wins needs an untrimmed tail.
          if (newEnd < len && prevKeys.indexOf(key, oldEnd) !== -1) {
            oldEnd = prevLen;
            newEnd = len;
            continue scan;
          }
          (dupes ??= []).push(i);
          continue;
        }
        win.set(key, NEW_ROW);
        sources.push(-1);
      } else if (v >= 0) {
        win.set(key, CLAIMED - v);
        sources.push(v);
        reused++;
      } else {
        (dupes ??= []).push(i);
        continue;
      }
      winKeys.push(key);
      winItems.push(i);
    }
    break;
  }

  if (dupes)
    for (let d = 0; d < dupes.length; d++) warnDuplicateKey(nextKeys[dupes[d]], dupes[d], ops.api);

  const winLen = winKeys.length;
  const winEntries: E[] = [];
  // When every window row is new, rows are staged in one fragment as they are
  // created, so a row's mapFn already sees earlier rows attached to it.
  const staged = reused === 0 ? document.createDocumentFragment() : null;
  try {
    for (let j = 0; j < winLen; j++) {
      const index = winItems[j];
      if (sources[j] !== -1) {
        winEntries.push(keyToEntry.get(winKeys[j])!);
        continue;
      }
      const entry = ops.create(items[index], index);
      winEntries.push(entry);
      if (staged) for (let k = 0; k < entry.nodes.length; k++) staged.appendChild(entry.nodes[k]);
    }
    for (let i = 0; i < start; i++) ops.update(keyToEntry.get(nextKeys[i])!, items[i], i);
    for (let j = 0; j < winLen; j++) {
      if (sources[j] !== -1) ops.update(winEntries[j], items[winItems[j]], winItems[j]);
    }
    for (let i = newEnd; i < len; i++) ops.update(keyToEntry.get(nextKeys[i])!, items[i], i);
  } catch (error) {
    for (let j = 0; j < winEntries.length; j++) if (sources[j] === -1) ops.release(winEntries[j]);
    throw error;
  }

  eachState.keys = dupes
    ? nextKeys.slice(0, start).concat(winKeys, nextKeys.slice(newEnd))
    : nextKeys;

  if (start === 0 && newEnd === len && reused === 0) {
    // Nothing survives: clear in bulk and insert every row in one fragment.
    if (diff) diff.all = true;
    bulkClear(parent, prevKeys, keyToEntry, endMarker, ops.release);
    keyToEntry.clear();
    for (let j = 0; j < winLen; j++) keyToEntry.set(winKeys[j], winEntries[j]);
    parent.insertBefore(staged!, endMarker);
    return;
  }

  for (let i = start; i < oldEnd; i++) {
    const key = prevKeys[i];
    if (win.get(key)! >= 0) {
      const entry = keyToEntry.get(key)!;
      if (diff) pushNodes(diff.removed, entry.nodes);
      detachNodes(entry.nodes);
      ops.release(entry);
      keyToEntry.delete(key);
    }
  }
  for (let j = 0; j < winLen; j++) {
    if (sources[j] !== -1) continue;
    keyToEntry.set(winKeys[j], winEntries[j]);
    if (diff) pushNodes(diff.added, winEntries[j].nodes);
  }

  let anchor: Node = endMarker;
  for (let i = newEnd; i < len; i++) {
    const first = keyToEntry.get(nextKeys[i])?.nodes[0];
    if (first) {
      anchor = first;
      break;
    }
  }

  if (staged) {
    parent.insertBefore(staged, anchor);
    return;
  }

  const stay = lis(sources);
  let s = stay.length - 1;
  let nextSibling: Node = anchor;
  let batch: Node[] | null = null;
  let batchTarget: Node = anchor;

  for (let j = winLen - 1; j >= 0; j--) {
    const entry = winEntries[j];
    if (s >= 0 && stay[s] === j) {
      s--;
      if (batch) {
        const frag = document.createDocumentFragment();
        for (let k = batch.length - 1; k >= 0; k--) frag.appendChild(batch[k]);
        parent.insertBefore(frag, batchTarget);
        batch = null;
      }
    } else if (hasMoveBefore) {
      for (let k = 0; k < entry.nodes.length; k++)
        moveOrInsert(parent, entry.nodes[k], nextSibling);
    } else {
      if (!batch) {
        batch = [];
        batchTarget = nextSibling;
      }
      for (let k = entry.nodes.length - 1; k >= 0; k--) batch.push(entry.nodes[k]);
    }
    nextSibling = entry.nodes[0] || nextSibling;
  }

  if (batch) {
    const frag = document.createDocumentFragment();
    for (let k = batch.length - 1; k >= 0; k--) frag.appendChild(batch[k]);
    parent.insertBefore(frag, batchTarget);
  }
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
