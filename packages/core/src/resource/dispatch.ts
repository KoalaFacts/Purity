import type { ssrResourceFlow } from './ssr.ts';

// Installed at SSR entry, without retaining a request or boundary context.
export let ssrResources: typeof ssrResourceFlow;

export function setSSRResources(resources: typeof ssrResourceFlow): void {
  ssrResources = resources;
}
