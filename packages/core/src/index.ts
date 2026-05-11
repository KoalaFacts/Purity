// ---------------------------------------------------------------------------
// Purity Core — minimal, fast, signal-driven web framework
// ---------------------------------------------------------------------------

// Template rendering (JIT compiled)
export { disableHydrationWarnings, enableHydrationWarnings, html } from './compiler/compile.ts';
export type { ComponentFn, MountResult } from './component.ts';
// Lifecycle (3 hooks + error) + hydrate
export { hydrate, mount, onDestroy, onDispose, onError, onMount } from './component.ts';
export type { SuspenseErrorInfo, SuspenseErrorPhase, SuspenseOptions } from './control.ts';
// Control flow
export {
  each,
  eachSSR,
  list,
  listSSR,
  match,
  matchSSR,
  suspense,
  when,
  whenSSR,
} from './control.ts';
export type { DebouncedAccessor } from './debounced.ts';
// Debounced derived signal
export { debounced } from './debounced.ts';
export type { SlotAccessor } from './elements.ts';
// Components, slots, teleport
export {
  _getRegisteredComponent,
  _renderComponentSSR,
  component,
  slot,
  teleport,
} from './elements.ts';
export type {
  LazyResourceAccessor,
  ResourceAccessor,
  ResourceFetchInfo,
  ResourceOptions,
  ResourceRetryOptions,
  RetryDelay,
} from './resource.ts';
// Async resources (eager + lazy/imperative)
export { lazyResource, resource } from './resource.ts';
// SSR coordination (used by @purityjs/ssr; clearly internal — exposed for
// the package boundary, not for end users)
export type { SSRRenderContext } from './ssr-context.ts';
export {
  clearHydrationCache,
  getSSRRenderContext,
  popSSRRenderContext,
  primeHydrationCache,
  pushSSRRenderContext,
} from './ssr-context.ts';
export type { ComputedAccessor, Dispose, StateAccessor, WatchSource } from './signals.ts';
// Reactive primitives
export { batch, compute, state, watch } from './signals.ts';

// Scoped styles
export { css } from './styles.ts';
