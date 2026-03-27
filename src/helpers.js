import { effect } from './signals.js';

// ---------------------------------------------------------------------------
// show(conditionFn, viewFn, elseFn?) — conditional rendering
//
// Returns a DocumentFragment with start/end marker comments. An effect
// watches the condition and swaps DOM content between the markers.
//
//   html`<div>${show(() => isVisible(), () => html`<p>Hello</p>`)}</div>`
//   html`<div>${show(() => ok(), () => html`<p>Yes</p>`, () => html`<p>No</p>`)}</div>`
// ---------------------------------------------------------------------------

export function show(conditionFn, viewFn, elseFn) {
  const startMarker = document.createComment('show-start');
  const endMarker = document.createComment('show-end');

  const fragment = document.createDocumentFragment();
  fragment.appendChild(startMarker);
  fragment.appendChild(endMarker);

  let currentNodes = [];

  effect(() => {
    const shouldShow = conditionFn();

    // Remove current nodes between markers
    for (const node of currentNodes) {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    }
    currentNodes = [];

    // Insert new content
    const parent = endMarker.parentNode;
    if (!parent) return;

    let content;
    if (shouldShow) {
      content = typeof viewFn === 'function' ? viewFn() : null;
    } else {
      content = typeof elseFn === 'function' ? elseFn() : null;
    }

    if (content != null) {
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
        content instanceof DocumentFragment ? content : content,
        endMarker
      );
    }
  });

  return fragment;
}

// ---------------------------------------------------------------------------
// each(listAccessor, mapFn, keyFn?) — list rendering
//
// Renders a list reactively. When the list changes, items are added, removed,
// or reordered efficiently using an optional key function.
//
//   html`<ul>${each(() => items(), (item, i) => html`<li>${item}</li>`)}</ul>`
//   html`<ul>${each(items, (item) => html`<li>${item}</li>`, (item) => item.id)}</ul>`
// ---------------------------------------------------------------------------

export function each(listAccessor, mapFn, keyFn) {
  const startMarker = document.createComment('each-start');
  const endMarker = document.createComment('each-end');

  const fragment = document.createDocumentFragment();
  fragment.appendChild(startMarker);
  fragment.appendChild(endMarker);

  // Map from key → { nodes: Node[], dispose?: Function }
  let keyToEntry = new Map();
  let prevKeys = [];

  // Normalize listAccessor: if it's a signal accessor, call it; if array, wrap
  const getList = typeof listAccessor === 'function'
    ? listAccessor
    : () => listAccessor;

  effect(() => {
    const list = getList() || [];
    const parent = endMarker.parentNode;
    if (!parent) return;

    const newKeys = [];
    const newEntries = new Map();

    // 1. Build new key → entry map
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const key = keyFn ? keyFn(item, i) : i;
      newKeys.push(key);

      if (keyToEntry.has(key)) {
        // Reuse existing entry
        newEntries.set(key, keyToEntry.get(key));
      } else {
        // Create new entry
        const content = mapFn(item, i);
        let nodes;

        if (content instanceof DocumentFragment) {
          nodes = Array.from(content.childNodes);
        } else if (content instanceof Node) {
          nodes = [content];
        } else {
          const text = document.createTextNode(String(content ?? ''));
          nodes = [text];
        }

        newEntries.set(key, { nodes });
      }
    }

    // 2. Remove entries that are no longer in the list
    for (const [key, entry] of keyToEntry) {
      if (!newEntries.has(key)) {
        for (const node of entry.nodes) {
          if (node.parentNode) node.parentNode.removeChild(node);
        }
        if (entry.dispose) entry.dispose();
      }
    }

    // 3. Insert/reorder nodes in correct order before endMarker
    // We work backwards from endMarker for efficient insertBefore
    let nextSibling = endMarker;

    for (let i = newKeys.length - 1; i >= 0; i--) {
      const key = newKeys[i];
      const entry = newEntries.get(key);
      const nodes = entry.nodes;

      // Check if nodes are already in correct position
      const firstNode = nodes[0];
      if (firstNode && firstNode.nextSibling !== nextSibling &&
          firstNode !== nextSibling) {
        // Need to move — insert all nodes of this entry before nextSibling
        for (const node of nodes) {
          parent.insertBefore(node, nextSibling);
        }
      }

      nextSibling = nodes[0] || nextSibling;
    }

    // 4. Update state
    keyToEntry = newEntries;
    prevKeys = newKeys;
  });

  return fragment;
}
