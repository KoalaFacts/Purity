// Compatibility facade and SSR pass owner. Context readers and client cache
// consumers use the passive modules directly to avoid importing server adapters.

import { setSSRResources } from './resource/dispatch.ts';
import { ssrResourceFlow } from './resource/ssr.ts';
import { setSSRControls } from './control/dispatch.ts';
import { ssrControlFlow } from './control/ssr.ts';
import { disposeScope } from './signals.ts';
import { popContext, pushContext, type Scope } from './scope.ts';
import { contextStack, type SSRRenderContext } from './ssr/state.ts';

export {
  type SSRRenderContext,
  cancelSSRBoundary,
  currentBoundaryId,
  getSSRRenderContext,
  nextSSRBoundaryDeadline,
} from './ssr/state.ts';
export {
  clearHydrationCache,
  consumeHydrationValue,
  primeHydrationCache,
} from './ssr/hydration-cache.ts';

// One reactive scope per SSR pass, parallel to contextStack. Watches and
// computes created while rendering register on it and are disposed when the
// pass ends; otherwise every request left them subscribed to module-level
// state on the server.
const scopeStack: Scope[] = [];

/** @internal */
export function pushSSRRenderContext(ctx: SSRRenderContext): void {
  // Keep registration inside the server entry path. Module-load registration
  // would retain the server renderers in every client that reads the context.
  setSSRControls(ssrControlFlow);
  setSSRResources(ssrResourceFlow);
  contextStack.push(ctx);
  const scope: Scope = { disposers: null };
  scopeStack.push(scope);
  pushContext(scope);
}

/** @internal */
export function popSSRRenderContext(): void {
  // No-op on an empty stack — defensive against stray pops (e.g. an outer
  // `finally` running after a callee already popped the same frame). Was
  // previously a silent overwrite-to-null, which had the same effect.
  if (contextStack.length === 0) return;
  contextStack.pop();
  popContext();
  disposeScope(scopeStack.pop()!);
}
