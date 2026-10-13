import type { ssrControlFlow } from './ssr.ts';

// Installed only when an SSR pass starts. Client rendering must not import the
// server implementations to initialize this table.
export let ssrControls: typeof ssrControlFlow;

export function setSSRControls(controls: typeof ssrControlFlow): void {
  ssrControls = controls;
}
