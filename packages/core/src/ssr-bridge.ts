// Shared server-side integration points. These bindings are owned by core so
// that components and SSR renderers use the same registry and render context.
export type { RawTextSpan, SSRHtml } from './hooks.ts';
export { _getRegisteredComponentEntry } from './elements.ts';
export { setSSRControls } from './control/dispatch.ts';
export { warnDuplicateKey } from './control/keys.ts';
export { setSSRResources } from './resource/dispatch.ts';
export { withRetry } from './resource/retry.ts';
export {
  type SSRRenderContext,
  cancelSSRBoundary,
  currentBoundaryId,
  getSSRRenderContext,
  nextSSRBoundaryDeadline,
  popSSRRenderContext,
  pushSSRRenderContext,
} from './ssr-context.ts';
export { __purity_swap, PURITY_SWAP_SOURCE } from './__purity_swap.ts';
export { setSSRMarkup, ssrMarkup } from './ssr/state.ts';
export type { SSRMarkupHooks } from './hooks.ts';
