// Shared by CSR control flow and its independently loaded hydration adapter.
// Do not import control.ts here: hydration-only bundles must not pull in lists.

/** @internal Snapshot a fragment without moving its children. */
export function extractNodes(content: Node | DocumentFragment | string): Node[] {
  if (content instanceof DocumentFragment) {
    const fc = content.firstChild;
    if (fc && !fc.nextSibling) return [fc];
    return Array.from(content.childNodes);
  }
  if (content instanceof Node) return [content];
  return [document.createTextNode(String(content ?? ''))];
}

/** @internal Detach only the supplied nodes, without detaching their descendants. */
export function detachNodes(nodes: Node[]): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    node.parentNode?.removeChild(node);
  }
}
