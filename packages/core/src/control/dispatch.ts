import type { SSRControlHooks } from '../hooks.ts';

// Installed only when an SSR pass starts. Client rendering must not import the
// server implementations to initialize this table.
export let ssrControls: SSRControlHooks;

export function setSSRControls(controls: SSRControlHooks): void {
  ssrControls = controls;
}
