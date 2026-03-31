import { watch } from './signals.js';

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

  // DOM cache per case key — avoids recreating on toggle
  const cache = new Map<string, Node[]>();

  watch(() => {
    const value = sourceFn();
    const key = String(value) as `${T}`;

    if (key === prevKey) return;

    const parent = endMarker.parentNode;
    if (!parent) return;

    // Detach current nodes (don't destroy — cache them)
    for (let i = 0; i < currentNodes.length; i++) {
      const node = currentNodes[i];
      if (node.parentNode) node.parentNode.removeChild(node);
    }

    // Cache previous nodes
    if (prevKey !== undefined && currentNodes.length > 0) {
      cache.set(prevKey, currentNodes);
    }

    prevKey = key;

    // Check cache first
    const cached = cache.get(key);
    if (cached) {
      currentNodes = cached;
      for (let i = 0; i < cached.length; i++) {
        parent.insertBefore(cached[i], endMarker);
      }
      return;
    }

    // Create new DOM
    const viewFn = cases[key] ?? fallback;
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
  });

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
  // indices[i] = index in arr of tails[i]
  const indices: number[] = [0];

  for (let i = 1; i < len; i++) {
    const val = arr[i];

    if (val > arr[tails[tails.length - 1]]) {
      predecessor[i] = tails[tails.length - 1];
      tails.push(i);
      indices.push(i);
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
      indices[lo] = i;
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
// each(listAccessor, mapFn, keyFn?) — list rendering with LIS-based diffing
// ---------------------------------------------------------------------------

interface EachEntry {
  nodes: Node[];
  dispose?: () => void;
}

/**
 * Reactive list rendering. Uses LIS algorithm for minimal DOM moves.
 *
 * @example
 * ```ts
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

  watch(() => {
    const list = getList() || [];
    const parent = endMarker.parentNode;
    if (!parent) return;

    const len = list.length;
    const prevLen = prevKeys.length;
    const getKey = keyFn ?? ((item: T, _i: number) => item as unknown);

    // Fast path: quick key scan
    if (len === prevLen) {
      let same = true;
      for (let i = 0; i < len; i++) {
        if (prevKeys[i] !== getKey(list[i], i)) {
          same = false;
          break;
        }
      }
      if (same) return;
    }

    const newKeys: unknown[] = new Array(len);
    const newEntries = new Map<unknown, EachEntry>();

    // Build new entries
    for (let i = 0; i < len; i++) {
      const item = list[i];
      const key = getKey(item, i);
      newKeys[i] = key;

      if (keyToEntry.has(key)) {
        newEntries.set(key, keyToEntry.get(key)!);
      } else {
        const content = mapFn(item, i);
        let nodes: Node[];
        if (content instanceof DocumentFragment) {
          nodes = Array.from(content.childNodes);
        } else if (content instanceof Node) {
          nodes = [content];
        } else {
          nodes = [document.createTextNode(String(content ?? ''))];
        }
        newEntries.set(key, { nodes });
      }
    }

    // Remove deleted entries
    if (prevLen > 0) {
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

    // --- LIS-based reorder: minimal DOM moves ---
    if (prevLen > 0 && len > 0) {
      // Map old keys to their positions
      const oldKeyIndex = new Map<unknown, number>();
      for (let i = 0; i < prevLen; i++) oldKeyIndex.set(prevKeys[i], i);

      // Build array of old indices for items that existed before
      const sources: number[] = [];
      const newIndexToSource: number[] = new Array(len).fill(-1);

      for (let i = 0; i < len; i++) {
        const oldIdx = oldKeyIndex.get(newKeys[i]);
        if (oldIdx !== undefined) {
          sources.push(oldIdx);
          newIndexToSource[i] = sources.length - 1;
        }
      }

      // Find LIS — these items don't need to move
      const lisIndices = new Set(lis(sources));

      // Items NOT in LIS need to be moved/inserted
      let nextSibling: Node = endMarker;

      for (let i = len - 1; i >= 0; i--) {
        const entry = newEntries.get(newKeys[i])!;
        const firstNode = entry.nodes[0];
        const sourceIdx = newIndexToSource[i];

        // If item is new or not in LIS, it needs to be (re)inserted
        if (sourceIdx === -1 || !lisIndices.has(sourceIdx)) {
          if (entry.nodes.length > 1) {
            const frag = document.createDocumentFragment();
            for (let j = 0; j < entry.nodes.length; j++) frag.appendChild(entry.nodes[j]);
            parent.insertBefore(frag, nextSibling);
          } else if (firstNode) {
            parent.insertBefore(firstNode, nextSibling);
          }
        }

        nextSibling = entry.nodes[0] || nextSibling;
      }
    } else {
      // Simple case: no previous items or all new
      let nextSibling: Node = endMarker;
      for (let i = len - 1; i >= 0; i--) {
        const entry = newEntries.get(newKeys[i])!;
        const firstNode = entry.nodes[0];
        if (firstNode) {
          if (entry.nodes.length > 1) {
            const frag = document.createDocumentFragment();
            for (let j = 0; j < entry.nodes.length; j++) frag.appendChild(entry.nodes[j]);
            parent.insertBefore(frag, nextSibling);
          } else {
            parent.insertBefore(firstNode, nextSibling);
          }
        }
        nextSibling = entry.nodes[0] || nextSibling;
      }
    }

    keyToEntry = newEntries;
    prevKeys = newKeys;
  });

  return fragment;
}
