// ---------------------------------------------------------------------------
// Purity Core — minimal, fast, signal-driven web framework
// ---------------------------------------------------------------------------

// Template rendering (JIT compiled)
export {
  disableHydrationTextRewrite,
  disableHydrationWarnings,
  enableHydrationTextRewrite,
  enableHydrationWarnings,
  html,
} from './compiler/compile.ts';
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

// Streaming SSR — client splice helper for ADR 0006 Phase 3.
export { __purity_swap, PURITY_SWAP_SOURCE } from './__purity_swap.ts';
// Head / meta tag management — ADR 0008.
export { head } from './head.ts';
// Request context — ADR 0009.
export { getRequest } from './request-context.ts';
// Router primitives — ADR 0011 (path / navigate / match) + ADR 0014 (search /
// hash) + ADR 0015 (onNavigate listener hook).
export {
  currentHash,
  currentPath,
  currentSearch,
  matchRoute,
  navigate,
  type NavigateListener,
  type NavigateOptions,
  onNavigate,
  type RouteMatch,
} from './router.ts';
// Link auto-interception — ADR 0013.
export { interceptLinks, type InterceptLinksOptions } from './router-intercept.ts';
// Navigation scroll management — ADR 0015.
export { manageNavScroll, type ManageNavScrollOptions } from './router-scroll.ts';
// Navigation focus management — ADR 0016.
export { manageNavFocus, type ManageNavFocusOptions } from './router-focus.ts';
// Navigation view transitions — ADR 0017.
export { manageNavTransitions, type ManageNavTransitionsOptions } from './router-transitions.ts';
// Navigation consolidator — ADR 0027.
export { configureNavigation, type ConfigureNavigationOptions } from './router-configure.ts';
// Async-route runtime composer — ADR 0025.
export {
  asyncNotFound,
  asyncRoute,
  type AsyncNotFoundEntry,
  type AsyncRouteEntry,
  type AsyncRouteOptions,
  type LoaderContext,
} from './async-route.ts';
// Loader-data accessor — ADR 0026.
export { loaderData } from './loader-data.ts';
// Server actions — ADR 0012.
export {
  findAction,
  handleAction,
  type ServerAction,
  type ServerActionHandler,
  serverAction,
} from './server-action.ts';

// Scoped styles
export { css } from './styles.ts';
