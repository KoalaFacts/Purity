import { getCurrentContext } from './component';
import type { StateAccessor } from './signals';
import { watch } from './signals';

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

interface EachEntry {
  nodes: Node[];
  data: StateAccessor<any> | null; // lazily created — only when item is reused
  index: number;
  dispose?: () => void;
}

// Bulk remove all managed nodes using Range API — O(1) native batch removal
function bulkClear(
  parent: Node,
  prevKeys: unknown[],
  keyToEntry: Map<unknown, EachEntry>,
  endMarker: Node,
): void {
  const prevLen = prevKeys.length;
  if (prevLen === 0) return;

  // Use Range API for batch removal — single native operation
  const firstEntry = keyToEntry.get(prevKeys[0]);
  if (firstEntry?.nodes[0]?.parentNode) {
    if (firstEntry.nodes[0] === parent.firstChild && endMarker.nextSibling === null) {
      if ('replaceChildren' in parent) {
        (parent as Element | DocumentFragment).replaceChildren(endMarker);
      } else {
        parent.textContent = '';
        parent.appendChild(endMarker);
      }
      return;
    }
    const range = document.createRange();
    range.setStartBefore(firstEntry.nodes[0]);
    range.setEndBefore(endMarker);
    range.deleteContents();
  }
}

// Extract nodes from mapFn result — optimized for single-node case
function extractNodes(content: Node | DocumentFragment | string): Node[] {
  if (content instanceof Node) {
    if (content.nodeType === 11) {
      // Fast path: single child (common for html`` templates)
      const fc = content.firstChild;
      if (fc && !fc.nextSibling) return [fc];
      return Array.from(content.childNodes);
    }
    return [content];
  }
  return [document.createTextNode(String(content ?? ''))];
}

function updateEntryIndexes(entries: Map<unknown, EachEntry>, keys: unknown[]): void {
  for (let i = 0; i < keys.length; i++) {
    const entry = entries.get(keys[i]);
    if (entry) entry.index = i;
  }
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
 * @example
 * ```ts
 * // mapFn receives a reactive accessor — use () => item() for reactive text
 * each(
 *   () => todos(),
 *   (todo) => html`<li>${todo.text}</li>`,
 *   (todo) => todo.id
 * )
 * ```
 */
export function each<T>(
  listAccessor: (() => T[]) | T[],
  mapFn: (item: T, index: number) => Node | DocumentFragment | string,
  keyFn?: (item: T, index: number) => unknown,
): DocumentFragment {
  const endMarker = document.createComment('e');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(endMarker);

  let keyToEntry = new Map<unknown, EachEntry>();
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
      let diffCount = 0;
      let swapA = -1;
      let swapB = -1;
      const newKeys2: unknown[] = new Array(len);
      for (let i = 0; i < len; i++) {
        const key = getKey(list[i], i);
        newKeys2[i] = key;
        if (prevKeys[i] !== key) {
          same = false;
          if (diffCount === 0) swapA = i;
          else if (diffCount === 1) swapB = i;
          diffCount++;
          if (diffCount > 2) break;
        }
      }
      if (same) {
        // Keys match — update data signals in place (zero DOM creation)
        for (let i = 0; i < len; i++) {
          const entry = keyToEntry.get(prevKeys[i]);
          if (entry?.data) entry.data(list[i]);
        }
        return;
      }
      if (
        diffCount === 2 &&
        swapA >= 0 &&
        swapB >= 0 &&
        prevKeys[swapA] === newKeys2[swapB] &&
        prevKeys[swapB] === newKeys2[swapA]
      ) {
        const entryA = keyToEntry.get(newKeys2[swapA]);
        const entryB = keyToEntry.get(newKeys2[swapB]);
        if (entryA?.nodes.length === 1 && entryB?.nodes.length === 1) {
          if (entryA.data) entryA.data(list[swapA]);
          if (entryB.data) entryB.data(list[swapB]);
          const nodeA = entryA.nodes[0];
          const nodeB = entryB.nodes[0];
          const nodeANext = nodeA.nextSibling;
          const nodeBNext = nodeB.nextSibling;
          if (nodeANext === nodeB) {
            parent.insertBefore(nodeB, nodeA);
          } else if (nodeBNext === nodeA) {
            parent.insertBefore(nodeA, nodeB);
          } else if (nodeA.compareDocumentPosition(nodeB) & Node.DOCUMENT_POSITION_FOLLOWING) {
            parent.insertBefore(nodeB, nodeANext);
            parent.insertBefore(nodeA, nodeBNext);
          } else {
            parent.insertBefore(nodeA, nodeBNext);
            parent.insertBefore(nodeB, nodeANext);
          }
          prevKeys = newKeys2;
          entryA.index = swapA;
          entryB.index = swapB;
          return;
        }
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
      const ownsParent = endMarker === parent.firstChild && endMarker.nextSibling === null;
      for (let i = 0; i < len; i++) {
        const item = list[i];
        newKeys2[i] = getKey(item, i);
        const content = mapFn(item, i);
        let nodes: Node[];
        if (content instanceof Node) {
          if (content.nodeType === 11) {
            const fc = content.firstChild;
            nodes = fc && !fc.nextSibling ? [fc] : Array.from(content.childNodes);
          } else {
            nodes = [content];
          }
          frag.appendChild(content);
        } else {
          const tn = document.createTextNode(String(content ?? ''));
          nodes = [tn];
          frag.appendChild(tn);
        }
        keyToEntry.set(newKeys2[i], { nodes, data: null, index: i });
      }
      if (
        ownsParent &&
        'replaceChildren' in parent &&
        !(typeof HTMLTableSectionElement !== 'undefined' && parent instanceof HTMLTableSectionElement)
      ) {
        frag.appendChild(endMarker);
        (parent as Element | DocumentFragment).replaceChildren(frag);
      } else {
        parent.insertBefore(frag, endMarker);
      }
      prevKeys = newKeys2;
      return;
    }

    // Fast path: full replacement with no reused keys. This is common for
    // benchmark-style "replace all" and avoids building a general reconcile
    // plan only to throw every old node away.
    {
      const newKeys2: unknown[] = new Array(len);
      let hasReuse = false;
      for (let i = 0; i < len; i++) {
        const key = getKey(list[i], i);
        newKeys2[i] = key;
        if (keyToEntry.has(key)) {
          hasReuse = true;
          break;
        }
      }
      if (!hasReuse) {
        const firstEntry = keyToEntry.get(prevKeys[0]);
        const ownsParent =
          firstEntry?.nodes[0] === parent.firstChild && endMarker.nextSibling === null;
        const newEntries = new Map<unknown, EachEntry>();
        const frag = document.createDocumentFragment();
        for (let i = 0; i < len; i++) {
          const item = list[i];
          const key = newKeys2[i];
          const content = mapFn(item, i);
          let nodes: Node[];
          if (content instanceof Node) {
            if (content.nodeType === 11) {
              const fc = content.firstChild;
              nodes = fc && !fc.nextSibling ? [fc] : Array.from(content.childNodes);
            } else {
              nodes = [content];
            }
            frag.appendChild(content);
          } else {
            const tn = document.createTextNode(String(content ?? ''));
            nodes = [tn];
            frag.appendChild(tn);
          }
          newEntries.set(key, { nodes, data: null, index: i });
        }
        if (
          ownsParent &&
          'replaceChildren' in parent &&
          !(typeof HTMLTableSectionElement !== 'undefined' && parent instanceof HTMLTableSectionElement)
        ) {
          frag.appendChild(endMarker);
          (parent as Element | DocumentFragment).replaceChildren(frag);
        } else {
          bulkClear(parent, prevKeys, keyToEntry, endMarker);
          parent.insertBefore(frag, endMarker);
        }
        keyToEntry = newEntries;
        prevKeys = newKeys2;
        return;
      }
    }

    // Fast path: pure append — existing prefix is unchanged, so avoid the
    // full reconciliation pass over old entries.
    if (len > prevLen) {
      const newKeys2: unknown[] = new Array(len);
      let isAppend = true;
      for (let i = 0; i < prevLen; i++) {
        const key = getKey(list[i], i);
        newKeys2[i] = key;
        if (prevKeys[i] !== key) {
          isAppend = false;
          break;
        }
      }
      if (isAppend) {
        const frag = document.createDocumentFragment();
        for (let i = prevLen; i < len; i++) {
          const item = list[i];
          const key = getKey(item, i);
          newKeys2[i] = key;
          const content = mapFn(item, i);
          let nodes: Node[];
          if (content instanceof Node) {
            if (content.nodeType === 11) {
              const fc = content.firstChild;
              nodes = fc && !fc.nextSibling ? [fc] : Array.from(content.childNodes);
            } else {
              nodes = [content];
            }
            frag.appendChild(content);
          } else {
            const tn = document.createTextNode(String(content ?? ''));
            nodes = [tn];
            frag.appendChild(tn);
          }
          keyToEntry.set(key, { nodes, data: null, index: i });
        }
        parent.insertBefore(frag, endMarker);
        prevKeys = newKeys2;
        return;
      }
    }

    // Fast path: stable shrink before the generic reconciliation map is
    // built. Filtering commonly produces a subsequence of the previous list;
    // this path updates kept entries and deletes gaps without the extra
    // newEntries construction pass used by arbitrary reorders.
    if (len < prevLen) {
      const newKeys2: unknown[] = new Array(len);
      for (let i = 0; i < len; i++) newKeys2[i] = getKey(list[i], i);

      let newCursor = 0;
      let removedRuns = 0;
      let inRemovedRun = false;
      for (let i = 0; i < prevLen; i++) {
        if (newCursor < len && prevKeys[i] === newKeys2[newCursor]) {
          newCursor++;
          inRemovedRun = false;
        } else if (!inRemovedRun) {
          removedRuns++;
          inRemovedRun = true;
        }
      }

      if (newCursor === len) {
        let keepCursor = 0;

        if (removedRuns <= 32) {
          let runStart: Node | null = null;
          const deleteRunBefore = (anchor: Node) => {
            if (!runStart) return;
            const range = document.createRange();
            range.setStartBefore(runStart);
            range.setEndBefore(anchor);
            range.deleteContents();
            runStart = null;
          };

          for (let i = 0; i < prevLen; i++) {
            const key = prevKeys[i];
            if (keepCursor < len && key === newKeys2[keepCursor]) {
              const entry = keyToEntry.get(key)!;
              deleteRunBefore(entry.nodes[0]);
              keepCursor++;
            } else {
              const entry = keyToEntry.get(key);
              if (entry) {
                runStart ??= entry.nodes[0];
                if (entry.dispose) entry.dispose();
              }
            }
          }

          deleteRunBefore(endMarker);
        } else {
          for (let i = 0; i < prevLen; i++) {
            const key = prevKeys[i];
            if (keepCursor < len && key === newKeys2[keepCursor]) {
              keepCursor++;
            } else {
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

        const newEntries = new Map<unknown, EachEntry>();
        for (let i = 0; i < len; i++) {
          const key = newKeys2[i];
          const entry = keyToEntry.get(key)!;
          if (entry.data) entry.data(list[i]);
          entry.index = i;
          newEntries.set(key, entry);
        }
        keyToEntry = newEntries;
        prevKeys = newKeys2;
        return;
      }
    }

    // Fast path: exact reverse. Avoid LIS and map planning for common
    // descending sort toggles where every existing node is retained and only
    // order is inverted.
    if (len === prevLen && len > 32) {
      const newKeys2: unknown[] = new Array(len);
      let isReverse = true;
      for (let i = 0; i < len; i++) {
        const key = getKey(list[i], i);
        newKeys2[i] = key;
        if (key !== prevKeys[len - 1 - i]) {
          isReverse = false;
          break;
        }
      }

      if (isReverse) {
        const newEntries = new Map<unknown, EachEntry>();
        const firstEntry = keyToEntry.get(prevKeys[0]);
        const ownsParent = firstEntry?.nodes[0] === parent.firstChild && endMarker.nextSibling === null;
        if (len > 4096 && ownsParent && 'replaceChildren' in parent) {
          const ordered: Node[] = [];
          for (let i = 0; i < len; i++) {
            const key = newKeys2[i];
            const entry = keyToEntry.get(key)!;
            if (entry.data) entry.data(list[i]);
            entry.index = i;
            newEntries.set(key, entry);
            for (let j = 0; j < entry.nodes.length; j++) ordered.push(entry.nodes[j]);
          }
          ordered.push(endMarker);
          (parent as Element | DocumentFragment).replaceChildren(...ordered);
        } else if (len > 512) {
          parent.removeChild(endMarker);
          for (let i = 0; i < len; i++) {
            const key = newKeys2[i];
            const entry = keyToEntry.get(key)!;
            if (entry.data) entry.data(list[i]);
            entry.index = i;
            newEntries.set(key, entry);
            for (let j = 0; j < entry.nodes.length; j++) parent.appendChild(entry.nodes[j]);
          }
          parent.appendChild(endMarker);
        } else {
          for (let i = 0; i < len; i++) {
            const key = newKeys2[i];
            const entry = keyToEntry.get(key)!;
            if (entry.data) entry.data(list[i]);
            entry.index = i;
            newEntries.set(key, entry);
            for (let j = 0; j < entry.nodes.length; j++) {
              parent.insertBefore(entry.nodes[j], endMarker);
            }
          }
        }

        keyToEntry = newEntries;
        prevKeys = newKeys2;
        return;
      }
    }

    const newKeys: unknown[] = new Array(len);
    const newEntries = new Map<unknown, EachEntry>();
    let reuseCount = 0;

    for (let i = 0; i < len; i++) {
      const item = list[i];
      const key = getKey(item, i);
      newKeys[i] = key;

      const _existing = keyToEntry.get(key);
      if (_existing) {
        const entry = _existing;
        if (entry.data) entry.data(item);
        newEntries.set(key, entry);
        reuseCount++;
      } else {
        newEntries.set(key, { nodes: extractNodes(mapFn(item, i)), data: null, index: -1 });
      }
    }

    // Fast path: no reuse — full replace → bulk remove + single-pass bulk insert
    if (reuseCount === 0) {
      const firstEntry = keyToEntry.get(prevKeys[0]);
      const ownsParent = firstEntry?.nodes[0] === parent.firstChild && endMarker.nextSibling === null;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < len; i++) {
        const entry = newEntries.get(newKeys[i])!;
        for (let j = 0; j < entry.nodes.length; j++) frag.appendChild(entry.nodes[j]);
      }
      if (
        ownsParent &&
        'replaceChildren' in parent &&
        !(typeof HTMLTableSectionElement !== 'undefined' && parent instanceof HTMLTableSectionElement)
      ) {
        frag.appendChild(endMarker);
        (parent as Element | DocumentFragment).replaceChildren(frag);
      } else {
        bulkClear(parent, prevKeys, keyToEntry, endMarker);
        parent.insertBefore(frag, endMarker);
      }
      keyToEntry = newEntries;
      prevKeys = newKeys;
      updateEntryIndexes(keyToEntry, prevKeys);
      return;
    }

    // Fast path: stable shrink. The new list is a subsequence of the old
    // list, with no new keys and no reordered keys. Delete removed runs in
    // batches instead of removing each old node one by one.
    if (len < prevLen && reuseCount === len) {
      let newCursor = 0;
      let removedRuns = 0;
      let inRemovedRun = false;
      for (let i = 0; i < prevLen; i++) {
        if (newCursor < len && prevKeys[i] === newKeys[newCursor]) {
          newCursor++;
          inRemovedRun = false;
        } else if (!inRemovedRun) {
          removedRuns++;
          inRemovedRun = true;
        }
      }

      if (newCursor === len) {
        let keepCursor = 0;

        if (removedRuns <= 32) {
          let runStart: Node | null = null;
          const deleteRunBefore = (anchor: Node) => {
            if (!runStart) return;
            const range = document.createRange();
            range.setStartBefore(runStart);
            range.setEndBefore(anchor);
            range.deleteContents();
            runStart = null;
          };

          for (let i = 0; i < prevLen; i++) {
            const key = prevKeys[i];
            if (keepCursor < len && key === newKeys[keepCursor]) {
              const entry = keyToEntry.get(key)!;
              deleteRunBefore(entry.nodes[0]);
              keepCursor++;
            } else {
              const entry = keyToEntry.get(key);
              if (entry) {
                runStart ??= entry.nodes[0];
                if (entry.dispose) entry.dispose();
              }
            }
          }

          deleteRunBefore(endMarker);
        } else {
          for (let i = 0; i < prevLen; i++) {
            const key = prevKeys[i];
            if (keepCursor < len && key === newKeys[keepCursor]) {
              keepCursor++;
            } else {
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

        keyToEntry = newEntries;
        prevKeys = newKeys;
        updateEntryIndexes(keyToEntry, prevKeys);
        return;
      }
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

    // --- Reorder: detect append, swap, or full LIS ---
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

    if (isAppend) {
      // Pure append — just insert new items before endMarker, no LIS
      const frag = document.createDocumentFragment();
      for (let i = prevLen; i < len; i++) {
        const entry = newEntries.get(newKeys[i])!;
        for (let j = 0; j < entry.nodes.length; j++) frag.appendChild(entry.nodes[j]);
      }
      parent.insertBefore(frag, endMarker);
    } else {
      // Fast path: stable expansion. All previous keys remain in the same
      // relative order, with new items inserted between them. This is common
      // when clearing a filtered list back to the original full list.
      if (len > prevLen && reuseCount === prevLen) {
        let oldCursor = 0;
        let stableExpansion = true;
        for (let i = 0; i < len; i++) {
          const key = newKeys[i];
          if (keyToEntry.has(key) && key !== prevKeys[oldCursor++]) {
            stableExpansion = false;
            break;
          }
        }

        if (stableExpansion) {
          let batch: Node[] | null = null;
          const flushBatch = (anchor: Node) => {
            if (!batch) return;
            if (batch.length === 1) {
              parent.insertBefore(batch[0], anchor);
            } else {
              const frag = document.createDocumentFragment();
              for (let j = 0; j < batch.length; j++) frag.appendChild(batch[j]);
              parent.insertBefore(frag, anchor);
            }
            batch = null;
          };

          for (let i = 0; i < len; i++) {
            const key = newKeys[i];
            const oldEntry = keyToEntry.get(key);
            if (oldEntry) {
              flushBatch(oldEntry.nodes[0]);
            } else {
              batch ??= [];
              const entry = newEntries.get(key)!;
              for (let j = 0; j < entry.nodes.length; j++) batch.push(entry.nodes[j]);
            }
          }
          flushBatch(endMarker);
          keyToEntry = newEntries;
          prevKeys = newKeys;
          updateEntryIndexes(keyToEntry, prevKeys);
          return;
        }
      }

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
            const nodeANext = nodeA.nextSibling;
            const nodeBNext = nodeB.nextSibling;
            if (nodeANext === nodeB) {
              parent.insertBefore(nodeB, nodeA);
            } else if (nodeBNext === nodeA) {
              parent.insertBefore(nodeA, nodeB);
            } else if (nodeA.compareDocumentPosition(nodeB) & Node.DOCUMENT_POSITION_FOLLOWING) {
              parent.insertBefore(nodeB, nodeANext);
              parent.insertBefore(nodeA, nodeBNext);
            } else {
              parent.insertBefore(nodeA, nodeBNext);
              parent.insertBefore(nodeB, nodeANext);
            }
            entryA.index = sa;
            entryB.index = sb;
          }
        }
      }

      if (!swapped) {
        // Full LIS-based reorder
        if (len > 128 && reuseCount === len) {
          let lastOldIdx = -1;
          let decreases = 0;
          let samples = 0;
          const stride = Math.max(1, len >> 6);
          for (let i = 0; i < len; i += stride) {
            const oldIdx = newEntries.get(newKeys[i])!.index;
            if (oldIdx < lastOldIdx) decreases++;
            lastOldIdx = oldIdx;
            samples++;
          }

          if (decreases * 4 > samples) {
            if (len > 4096) {
              parent.removeChild(endMarker);
              for (let i = 0; i < len; i++) {
                const entry = newEntries.get(newKeys[i])!;
                for (let j = 0; j < entry.nodes.length; j++) {
                  parent.appendChild(entry.nodes[j]);
                }
              }
              parent.appendChild(endMarker);
            } else {
              for (let i = 0; i < len; i++) {
                const entry = newEntries.get(newKeys[i])!;
                for (let j = 0; j < entry.nodes.length; j++) {
                  parent.insertBefore(entry.nodes[j], endMarker);
                }
              }
            }
            keyToEntry = newEntries;
            prevKeys = newKeys;
            updateEntryIndexes(keyToEntry, prevKeys);
            return;
          }
        }

        const sources: number[] = [];
        const newIndexToSource: number[] = new Array(len).fill(-1);

        for (let i = 0; i < len; i++) {
          const oldIdx = newEntries.get(newKeys[i])!.index;
          if (oldIdx >= 0) {
            sources.push(oldIdx);
            newIndexToSource[i] = sources.length - 1;
          }
        }

        const lisIndices = new Set(lis(sources));

        if (len > 128 && lisIndices.size * 2 < len) {
          const frag = document.createDocumentFragment();
          for (let i = 0; i < len; i++) {
            const entry = newEntries.get(newKeys[i])!;
            for (let j = 0; j < entry.nodes.length; j++) frag.appendChild(entry.nodes[j]);
          }
          parent.insertBefore(frag, endMarker);
        } else {
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
    }

    keyToEntry = newEntries;
    prevKeys = newKeys;
    updateEntryIndexes(keyToEntry, prevKeys);
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

    // Reorder — append-only fast path or LIS
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

      if (isAppend) {
        const frag = document.createDocumentFragment();
        for (let i = prevLen; i < len; i++) frag.appendChild(newEntries.get(newKeys[i])!.node);
        parent.insertBefore(frag, endMarker);
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
    } else {
      // All new — batch insert
      const frag = document.createDocumentFragment();
      for (let i = 0; i < len; i++) frag.appendChild(newEntries.get(newKeys[i])!.node);
      parent.insertBefore(frag, endMarker);
    }

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
