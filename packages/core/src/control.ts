import { getCurrentContext } from './component';
import type { StateAccessor } from './signals';
import { state, watch } from './signals';

// ---------------------------------------------------------------------------
// match(sourceFn, cases, fallback?) — reactive pattern matching
// NOW CACHES DOM per case key — toggling reuses nodes instead of recreating
// ---------------------------------------------------------------------------

type MatchView = () => Node | DocumentFragment | string;
type MatchCases<T extends string | number | boolean> = Partial<Record<`${T}`, MatchView>>;

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
): DocumentFragment {
  const endMarker = document.createComment('m');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(endMarker);

  let currentNodes: Node[] = [];
  let prevKey: string | undefined;
  const cache = new Map<string, Node[]>();

  // Render helper — used for both initial + reactive updates
  const renderKey = (key: string, parent: Node) => {
    // Detach current
    for (let i = 0; i < currentNodes.length; i++) {
      const node = currentNodes[i];
      /* v8 ignore next -- defensive guard; nodes always have parent here */
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    if (prevKey !== undefined && currentNodes.length > 0) {
      cache.set(prevKey, currentNodes);
    }
    prevKey = key;

    // Check cache
    const cached = cache.get(key);
    if (cached) {
      currentNodes = cached;
      for (let i = 0; i < cached.length; i++) parent.insertBefore(cached[i], endMarker);
      return;
    }

    const viewFn = cases[key as `${T}`] ?? fallback;
    if (!viewFn) {
      currentNodes = [];
      return;
    }

    const content = viewFn();
    if (content instanceof DocumentFragment) {
      currentNodes = Array.from(content.childNodes);
      parent.insertBefore(content, endMarker);
    } else if (content instanceof Node) {
      currentNodes = [content];
      parent.insertBefore(content, endMarker);
    } else {
      const textNode = document.createTextNode(String(content));
      currentNodes = [textNode];
      parent.insertBefore(textNode, endMarker);
    }
  };

  // Initial render — synchronous, no watch overhead
  const initKey = String(sourceFn()) as `${T}`;
  const initView = cases[initKey] ?? fallback;
  if (initView) {
    prevKey = initKey;
    const content = initView();
    if (content instanceof DocumentFragment) {
      currentNodes = Array.from(content.childNodes);
      fragment.insertBefore(content, endMarker);
    } else if (content instanceof Node) {
      currentNodes = [content];
      fragment.insertBefore(content, endMarker);
    } else {
      const textNode = document.createTextNode(String(content));
      currentNodes = [textNode];
      fragment.insertBefore(textNode, endMarker);
    }
  }

  // Reactive updates — watch for changes
  const dispose = watch(() => {
    const key = String(sourceFn()) as `${T}`;
    if (key === prevKey) return;
    const parent = endMarker.parentNode;
    /* v8 ignore next -- defensive; if endMarker is detached, watch is disposed */
    if (!parent) return;
    renderKey(key, parent);
  });

  // Auto-dispose watcher + clear cached DOM on component unmount
  const ctx = getCurrentContext();
  if (ctx) {
    (ctx.disposers ??= []).push(() => {
      dispose();
      cache.clear();
      currentNodes = [];
    });
  }

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
): DocumentFragment {
  return match((() => String(conditionFn())) as () => 'true' | 'false', {
    true: thenFn,
    ...(elseFn ? { false: elseFn } : {}),
  });
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
  dispose?: () => void;
}

// Bulk remove all managed nodes using Range API — O(1) native batch removal
function bulkClear(
  _parent: Node,
  prevKeys: unknown[],
  keyToEntry: Map<unknown, EachEntry<unknown>>,
  endMarker: Node,
): void {
  const prevLen = prevKeys.length;
  if (prevLen === 0) return;

  // Use Range API for batch removal — single native operation
  const firstEntry = keyToEntry.get(prevKeys[0]);
  if (firstEntry?.nodes[0]?.parentNode) {
    const range = document.createRange();
    range.setStartBefore(firstEntry.nodes[0]);
    range.setEndBefore(endMarker);
    range.deleteContents();
  }

  // Run disposers
  for (let i = 0; i < prevLen; i++) {
    const entry = keyToEntry.get(prevKeys[i])!;
    if (entry.dispose) entry.dispose();
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
): DocumentFragment {
  const endMarker = document.createComment('e');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(endMarker);

  let keyToEntry = new Map<unknown, EachEntry<T>>();
  let prevKeys: unknown[] = [];

  const getList =
    typeof listAccessor === 'function' ? (listAccessor as () => T[]) : () => listAccessor;

  const dispose = watch(() => {
    const list = getList() || [];
    const parent = endMarker.parentNode;
    if (!parent) return;

    const len = list.length;
    const prevLen = prevKeys.length;
    const getKey = keyFn ?? ((item: T, _i: number) => item as unknown);

    // Fast path: same keys in same order — just update data signals
    if (len === prevLen) {
      let same = true;
      for (let i = 0; i < len; i++) {
        if (prevKeys[i] !== getKey(list[i], i)) {
          same = false;
          break;
        }
      }
      if (same) {
        // Keys match — update data signals in place (zero DOM creation)
        for (let i = 0; i < len; i++) {
          const entry = keyToEntry.get(prevKeys[i])!;
          entry.data(list[i]);
        }
        return;
      }
    }

    // Fast path: clear all — bulk remove via Range API
    if (len === 0) {
      if (prevLen > 0) {
        bulkClear(parent, prevKeys, keyToEntry, endMarker);
        keyToEntry = new Map();
      }
      prevKeys = [];
      return;
    }

    // Fast path: all new items (first render or full replace with new keys)
    // Single pass — create + append + build map in one loop
    if (prevLen === 0) {
      const newKeys2: unknown[] = new Array(len);
      const frag = document.createDocumentFragment();
      for (let i = 0; i < len; i++) {
        const item = list[i];
        newKeys2[i] = getKey(item, i);
        const data = state(item);
        const content = mapFn(data, i);
        let nodes: Node[];
        if (content instanceof DocumentFragment) {
          const fc = content.firstChild;
          nodes = fc && !fc.nextSibling ? [fc] : Array.from(content.childNodes);
          frag.appendChild(content);
        } else if (content instanceof Node) {
          nodes = [content];
          frag.appendChild(content);
        } else {
          const tn = document.createTextNode(String(content ?? ''));
          nodes = [tn];
          frag.appendChild(tn);
        }
        keyToEntry.set(newKeys2[i], { nodes, data });
      }
      parent.insertBefore(frag, endMarker);
      prevKeys = newKeys2;
      return;
    }

    const newKeys: unknown[] = new Array(len);
    const newEntries = new Map<unknown, EachEntry<T>>();
    let reuseCount = 0;

    for (let i = 0; i < len; i++) {
      const item = list[i];
      const key = getKey(item, i);
      newKeys[i] = key;

      const _existing = keyToEntry.get(key) as EachEntry<T> | undefined;
      if (_existing) {
        _existing.data(item);
        newEntries.set(key, _existing);
        reuseCount++;
      } else {
        const data = state(item);
        newEntries.set(key, { nodes: extractNodes(mapFn(data, i)), data });
      }
    }

    // Fast path: no reuse — full replace → bulk remove + single-pass bulk insert
    if (reuseCount === 0) {
      bulkClear(parent, prevKeys, keyToEntry, endMarker);
      const frag = document.createDocumentFragment();
      for (let i = 0; i < len; i++) {
        const entry = newEntries.get(newKeys[i])!;
        for (let j = 0; j < entry.nodes.length; j++) frag.appendChild(entry.nodes[j]);
      }
      parent.insertBefore(frag, endMarker);
      keyToEntry = newEntries;
      prevKeys = newKeys;
      return;
    }

    // Remove deleted entries
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
            if (entry.dispose) entry.dispose();
          }
        }
      }
    }

    // --- Reorder: detect append, prepend, swap, or full LIS ---
    // Fast path: all old keys at start in same order = pure append
    let isAppend = len > prevLen;
    if (isAppend) {
      for (let i = 0; i < prevLen; i++) {
        if (prevKeys[i] !== newKeys[i]) {
          isAppend = false;
          break;
        }
      }
    }

    // Fast path: all old keys at end in same order = pure prepend
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
      // Pure append — just insert new items before endMarker, no LIS
      const frag = document.createDocumentFragment();
      for (let i = prevLen; i < len; i++) {
        const entry = newEntries.get(newKeys[i])!;
        for (let j = 0; j < entry.nodes.length; j++) frag.appendChild(entry.nodes[j]);
      }
      parent.insertBefore(frag, endMarker);
    } else if (isPrepend) {
      // Pure prepend — insert new items before the first existing entry, no LIS.
      // Suffix-match implies every prevKey is preserved, so the deletion loop
      // above was a no-op and all old entry nodes are still attached.
      const newCount = len - prevLen;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < newCount; i++) {
        const entry = newEntries.get(newKeys[i])!;
        for (let j = 0; j < entry.nodes.length; j++) frag.appendChild(entry.nodes[j]);
      }
      const firstExisting = newEntries.get(newKeys[newCount])!.nodes[0];
      parent.insertBefore(frag, firstExisting);
    } else {
      // Fast path: swap — exactly 2 positions differ, same length, all reused
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
            // Correct DOM swap using a temporary marker
            const marker = document.createComment('');
            parent.insertBefore(marker, nodeA);
            parent.insertBefore(nodeA, nodeB);
            parent.insertBefore(nodeB, marker);
            parent.removeChild(marker);
          }
        }
      }

      if (!swapped) {
        // Full LIS-based reorder
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

        // Reverse pass: collect batch in array, flush in correct order
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
            // Stable item — flush batch if pending
            if (batch) {
              const frag = document.createDocumentFragment();
              for (let j = batch.length - 1; j >= 0; j--) frag.appendChild(batch[j]);
              parent.insertBefore(frag, batchTarget);
              batch = null;
            }
          }

          nextSibling = entry.nodes[0] || nextSibling;
        }

        // Flush remaining batch
        if (batch) {
          const frag = document.createDocumentFragment();
          for (let j = batch.length - 1; j >= 0; j--) frag.appendChild(batch[j]);
          parent.insertBefore(frag, batchTarget);
        }
      }
    }

    keyToEntry = newEntries;
    prevKeys = newKeys;
  });

  // Auto-dispose watcher + clean up entries on component unmount
  const ctx = getCurrentContext();
  if (ctx) {
    (ctx.disposers ??= []).push(() => {
      dispose();
      for (const entry of keyToEntry.values()) {
        if (entry.dispose) entry.dispose();
      }
      keyToEntry.clear();
      prevKeys = [];
    });
  }

  return fragment;
}

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
    const list = getList() || [];
    const parent = endMarker.parentNode;
    if (!parent) return;

    const len = list.length;
    const prevLen = prevKeys.length;

    // Fast path: same keys — update in place
    if (len === prevLen) {
      let same = true;
      for (let i = 0; i < len; i++) {
        if (prevKeys[i] !== getKey(list[i], i)) {
          same = false;
          break;
        }
      }
      if (same) {
        for (let i = 0; i < len; i++) {
          updateEntry(keyToEntry.get(prevKeys[i])!, list[i], i);
        }
        return;
      }
    }

    // Fast path: clear all — bulk remove via Range
    if (len === 0) {
      if (prevLen > 0) {
        const firstEntry = keyToEntry.get(prevKeys[0]);
        if (firstEntry?.node.parentNode) {
          const range = document.createRange();
          range.setStartBefore(firstEntry.node);
          range.setEndBefore(endMarker);
          range.deleteContents();
        }
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
        const item = list[i];
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
      const item = list[i];
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
      if (prevLen > 0) {
        const firstEntry = keyToEntry.get(prevKeys[0]);
        if (firstEntry?.node.parentNode) {
          const range = document.createRange();
          range.setStartBefore(firstEntry.node);
          range.setEndBefore(endMarker);
          range.deleteContents();
        }
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
