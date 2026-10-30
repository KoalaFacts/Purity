// Aggregate the old core surface across split packages. SSR and compiler runtime
// exports are included as well, so this is a conservative new scope, not an
// identical reproduction of the historical pre-split core-all fixture.
export {
  disableHydrationTextRewrite,
  disableHydrationWarnings,
  enableHydrationTextRewrite,
  enableHydrationWarnings,
} from '@purityjs/core/runtime';
export { html } from '@purityjs/core/jit';
export {
  bindComponentState,
  hydrate,
  mount,
  onDestroy,
  onDispose,
  onError,
  onMount,
  each,
  list,
  match,
  suspense,
  when,
  debounced,
  component,
  internals,
  slot,
  teleport,
  lazyResource,
  resource,
  batch,
  compute,
  state,
  watch,
  css,
} from '@purityjs/core';
export {
  onFormAssociated,
  onFormDisabled,
  onFormReset,
  onFormStateRestore,
} from '@purityjs/core/forms';
export * from '@purityjs/ssr/runtime';
export * from '@purityjs/ssr';
export * from '@purityjs/compiler';
export * from '@purityjs/signals';
export {
  head,
  getRequest,
  currentHash,
  currentPath,
  currentSearch,
  matchRoute,
  navigate,
  onNavigate,
  interceptLinks,
  manageNavScroll,
  manageNavFocus,
  manageNavAnnounce,
  manageNavTransitions,
  configureNavigation,
  prefetchManifestLinks,
  manageTitle,
  asyncNotFound,
  asyncRoute,
  routeData,
  loaderData,
} from '@purityjs/router';
export { getIslandBrand, island, isIsland, mountIslands } from '@purityjs/platform/islands';
export {
  findAction,
  handleAction,
  serverAction,
  enhanceForms,
  optimistic,
} from '@purityjs/platform/actions';
export {
  localSignal,
  broadcastSignal,
  pageVisibilitySignal,
  pageLifecycleSignal,
  bfcacheRestoreSignal,
  intersectionSignal,
  mutationSignal,
  mediaSignal,
  resizeSignal,
  onlineSignal,
  prefersColorSchemeSignal,
  prefersReducedMotionSignal,
  prefersContrastSignal,
  screenOrientationSignal,
  localeSignal,
  devicePixelRatioSignal,
  fullscreenSignal,
  permissionSignal,
  batterySignal,
  networkInformationSignal,
  idleSignal,
  eventSourceSignal,
  webSocketSignal,
} from '@purityjs/platform/signals';
export { invalidateQuery, query } from '@purityjs/platform/query';

export { each as compiledEach } from '@purityjs/core/list-runtime';
