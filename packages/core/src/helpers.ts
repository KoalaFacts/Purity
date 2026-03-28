import { watch } from './signals.js';

// ---------------------------------------------------------------------------
// match(sourceFn, cases, fallback?) — reactive pattern matching
//
//   match(() => status(), {
//     loading: () => html`<p>Loading...</p>`,
//     error:   () => html`<p>Error!</p>`,
//     success: () => html`<p>Done</p>`,
//   })
//
//   // boolean shorthand (if/else)
//   match(() => loggedIn(), {
//     true:  () => html`<p>Welcome</p>`,
//     false: () => html`<p>Login</p>`,
//   })
// ---------------------------------------------------------------------------

type MatchView = () => Node | DocumentFragment | string;
type MatchCases<T extends string | number | boolean> = Partial<Record<`${T}`, MatchView>>;

export function match<T extends string | number | boolean>(
  sourceFn: () => T,
  cases: MatchCases<T>,
  fallback?: MatchView,
): DocumentFragment {
  const startMarker = document.createComment('match-start');
  const endMarker = document.createComment('match-end');

  const fragment = document.createDocumentFragment();
  fragment.appendChild(startMarker);
  fragment.appendChild(endMarker);

  let currentNodes: Node[] = [];

  watch(() => {
    const value = sourceFn();

    for (const node of currentNodes) {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    }
    currentNodes = [];

    const parent = endMarker.parentNode;
    if (!parent) return;

    const key = String(value) as `${T}`;
    const viewFn = cases[key] ?? fallback;

    if (!viewFn) return;

    let content: Node | DocumentFragment | string = viewFn();

    if (content instanceof DocumentFragment) {
      currentNodes = Array.from(content.childNodes);
    } else if (content instanceof Node) {
      currentNodes = [content];
    } else {
      const textNode = document.createTextNode(String(content));
      currentNodes = [textNode];
      content = textNode;
    }

    parent.insertBefore(
      content instanceof Node ? content : document.createTextNode(String(content)),
      endMarker,
    );
  });

  return fragment;
}

// ---------------------------------------------------------------------------
// when(conditionFn, thenFn, elseFn?) — boolean conditional rendering
//
//   when(() => loggedIn(),
//     () => html`<p>Welcome</p>`,
//     () => html`<p>Login</p>`
//   )
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
  const startMarker = document.createComment('each-start');
  const endMarker = document.createComment('each-end');

  const fragment = document.createDocumentFragment();
  fragment.appendChild(startMarker);
  fragment.appendChild(endMarker);

  let keyToEntry = new Map<unknown, EachEntry>();
  // Reusable arrays — avoid allocating per watch cycle
  let prevKeys: unknown[] = [];

  const getList =
    typeof listAccessor === 'function' ? (listAccessor as () => T[]) : () => listAccessor;

  watch(() => {
    const list = getList() || [];
    const parent = endMarker.parentNode;
    if (!parent) return;

    const len = list.length;
    const newKeys: unknown[] = new Array(len);
    const newEntries = new Map<unknown, EachEntry>();
    let changed = len !== prevKeys.length;

    // Build new key → entry map
    for (let i = 0; i < len; i++) {
      const item = list[i];
      const key = keyFn ? keyFn(item, i) : i;
      newKeys[i] = key;
      if (!changed && prevKeys[i] !== key) changed = true;

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

    // Skip DOM work if keys haven't changed
    if (!changed) return;

    // Remove entries no longer in list
    for (const [key, entry] of keyToEntry) {
      if (!newEntries.has(key)) {
        for (const node of entry.nodes) {
          if (node.parentNode) node.parentNode.removeChild(node);
        }
        if (entry.dispose) entry.dispose();
      }
    }

    // Insert/reorder — work backwards from endMarker
    let nextSibling: Node = endMarker;
    for (let i = len - 1; i >= 0; i--) {
      const entry = newEntries.get(newKeys[i])!;
      const nodes = entry.nodes;
      const firstNode = nodes[0];

      if (firstNode && firstNode.nextSibling !== nextSibling && firstNode !== nextSibling) {
        // Batch: if entry has multiple nodes, use a fragment
        if (nodes.length > 1) {
          const frag = document.createDocumentFragment();
          for (const node of nodes) frag.appendChild(node);
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
