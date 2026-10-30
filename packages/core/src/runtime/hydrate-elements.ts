// Custom Element adoption traversal, shared without importing root orchestration.
export function hydratePendingCustomElements(root: ParentNode): void {
  const ownerIsland = root instanceof Element ? root.closest('purity-island') : null;
  const elements = root.querySelectorAll('*');
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    // Nested islands are independent hydration roots. Their Custom Elements
    // must stay dormant until the island's own trigger fires.
    if (element.closest('purity-island') !== ownerIsland) continue;
    const hydrateElement = (element as Element & { _hydrateSSR?: () => void })._hydrateSSR;
    if (typeof hydrateElement === 'function') hydrateElement.call(element);
  }
}
