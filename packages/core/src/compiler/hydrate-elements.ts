// Custom Element adoption traversal, shared without importing root orchestration.
export function hydratePendingCustomElements(root: ParentNode): void {
  const elements = root.querySelectorAll('*');
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    const hydrateElement = (element as Element & { _hydrateSSR?: () => void })._hydrateSSR;
    if (typeof hydrateElement === 'function') hydrateElement.call(element);
  }
}
