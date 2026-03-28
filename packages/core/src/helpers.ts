import { watch } from './signals.js';

// ---------------------------------------------------------------------------
// match(sourceFn, cases, fallback?) — reactive pattern matching
// ---------------------------------------------------------------------------

type MatchView = () => Node | DocumentFragment | string;
type MatchCases<T extends string | number | boolean> = Partial<Record<`${T}`, MatchView>>;

export function match<T extends string | number | boolean>(
  sourceFn: () => T,
  cases: MatchCases<T>,
  fallback?: MatchView,
): DocumentFragment {
  // Single anchor marker (no unused startMarker)
  const endMarker = document.createComment('m');

  const fragment = document.createDocumentFragment();
  fragment.appendChild(endMarker);

  let currentNodes: Node[] = [];
  let prevKey: string | undefined;

  watch(() => {
    const value = sourceFn();
    const key = String(value) as `${T}`;

    // Skip if same key
    if (key === prevKey) return;
    prevKey = key;

    // Remove current nodes
    for (let i = 0; i < currentNodes.length; i++) {
      const node = currentNodes[i];
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    currentNodes = [];

    const parent = endMarker.parentNode;
    if (!parent) return;

    const viewFn = cases[key] ?? fallback;
    if (!viewFn) return;

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
// when(conditionFn, thenFn, elseFn?) — boolean conditional rendering
// ---------------------------------------------------------------------------

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
// each(listAccessor, mapFn, keyFn?) — list rendering
// ---------------------------------------------------------------------------

interface EachEntry {
  nodes: Node[];
  dispose?: () => void;
}

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

    // Fast path: quick key scan before allocating
    if (len === prevLen) {
      let same = true;
      for (let i = 0; i < len; i++) {
        const key = keyFn ? keyFn(list[i], i) : i;
        if (prevKeys[i] !== key) { same = false; break; }
      }
      if (same) return;
    }

    const newKeys: unknown[] = new Array(len);
    const newEntries = new Map<unknown, EachEntry>();

    for (let i = 0; i < len; i++) {
      const item = list[i];
      const key = keyFn ? keyFn(item, i) : i;
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

    // Remove entries no longer in list — use Set diff for speed
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

    // Insert/reorder — work backwards from endMarker
    let nextSibling: Node = endMarker;
    for (let i = len - 1; i >= 0; i--) {
      const entry = newEntries.get(newKeys[i])!;
      const nodes = entry.nodes;
      const firstNode = nodes[0];

      if (firstNode && firstNode.nextSibling !== nextSibling && firstNode !== nextSibling) {
        if (nodes.length > 1) {
          const frag = document.createDocumentFragment();
          for (let j = 0; j < nodes.length; j++) frag.appendChild(nodes[j]);
          parent.insertBefore(frag, nextSibling);
        } else {
          parent.insertBefore(firstNode, nextSibling);
        }
      }

      nextSibling = nodes[0] || nextSibling;
    }

    keyToEntry = newEntries;
    prevKeys = newKeys;
  });

  return fragment;
}
